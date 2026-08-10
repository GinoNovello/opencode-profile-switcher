import { describe, expect, test } from "bun:test"
import {
  enumerateAgents,
  refreshAgents,
  type AgentListerClient,
  type AgentRefreshClient,
} from "../src/agents.js"

function client(result: unknown): AgentListerClient {
  return { app: { agents: async () => result } }
}

describe("enumerateAgents", () => {
  test("maps name, mode and hidden from a bare array", async () => {
    const agents = await enumerateAgents(
      client([
        { name: "build", mode: "primary" },
        { name: "explore", mode: "subagent", hidden: true },
      ]),
    )
    expect(agents).toEqual([
      { name: "build", mode: "primary", hidden: false },
      { name: "explore", mode: "subagent", hidden: true },
    ])
  })

  test("unwraps a { data } envelope", async () => {
    const agents = await enumerateAgents(client({ data: [{ name: "plan", mode: "all" }] }))
    expect(agents).toEqual([{ name: "plan", mode: "all", hidden: false }])
  })

  test("defaults an unknown mode to 'all'", async () => {
    const agents = await enumerateAgents(client([{ name: "x", mode: "weird" }]))
    expect(agents[0]?.mode).toBe("all")
  })

  test("skips entries without a usable name", async () => {
    const agents = await enumerateAgents(client([{ mode: "primary" }, { name: "", mode: "primary" }]))
    expect(agents).toEqual([])
  })

  test("returns [] when the call throws", async () => {
    const throwing: AgentListerClient = {
      app: {
        agents: async () => {
          throw new Error("no server")
        },
      },
    }
    expect(await enumerateAgents(throwing)).toEqual([])
  })
})

describe("refreshAgents", () => {
  /**
   * A client whose agent list only gains the agents created after boot once the
   * instance has been disposed — the behaviour of a real opencode server, whose
   * `GET /agent` list is built once per instance at bootstrap.
   */
  function staleClient(): AgentRefreshClient & { calls: string[] } {
    const calls: string[] = []
    let bootstrapped = false
    return {
      calls,
      instance: {
        dispose: async () => {
          calls.push("dispose")
          bootstrapped = true
          return true
        },
      },
      app: {
        agents: async () => {
          calls.push("agents")
          return bootstrapped
            ? [
                { name: "build", mode: "primary" },
                { name: "reviewer", mode: "subagent" },
              ]
            : [{ name: "build", mode: "primary" }]
        },
      },
    }
  }

  test("sees an agent created after opencode booted", async () => {
    const agents = await refreshAgents(staleClient())
    expect(agents.map((agent) => agent.name)).toEqual(["build", "reviewer"])
  })

  test("disposes the instance before listing, or the list is stale", async () => {
    const c = staleClient()
    await refreshAgents(c)
    expect(c.calls).toEqual(["dispose", "agents"])
  })

  test("falls back to the stale list when dispose fails", async () => {
    const c = staleClient()
    c.instance.dispose = async () => {
      throw new Error("dispose unavailable")
    }
    const agents = await refreshAgents(c)
    expect(agents.map((agent) => agent.name)).toEqual(["build"])
  })
})
