import { describe, expect, test } from "bun:test"
import { enumerateAgents, type AgentListerClient } from "../src/agents.js"

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
