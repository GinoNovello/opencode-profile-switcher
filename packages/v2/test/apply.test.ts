import { describe, expect, test } from "bun:test"
import type { ProfilesFile } from "../../../src/core/schema.js"
import {
  defaultModel,
  inspectAgents,
  nextEffective,
  writeAgentModels,
  type AgentEditorLike,
  type HostModel,
} from "../src/apply.js"

function profiles(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    profiles: {
      glm: {
        heavy: { model: "zai/glm-5", variant: "max" },
        rest: { model: "zai/glm-4" },
        placements: {
          build: "heavy",
          explore: "rest",
          vision: "excluded",
          docs: "specific",
          gone: "heavy",
        },
        specifics: { docs: { model: "anthropic/claude-docs", variant: "high" } },
      },
    },
    active: "glm",
    effective: {},
    ...overrides,
  }
}

/** An editor over `ids`, recording what was written. */
function editor(ids: string[]) {
  const agents = new Map<string, { id: string; model?: HostModel }>(ids.map((id) => [id, { id }]))
  const updated: string[] = []
  const fake: AgentEditorLike = {
    list: () => [...agents.values()],
    get: (id) => agents.get(id),
    update: (id, update) => {
      updated.push(id)
      const agent = agents.get(id) ?? { id }
      agents.set(id, agent)
      update(agent)
    },
  }
  return { fake, agents, updated }
}

describe("writeAgentModels", () => {
  test("writes each placement's model and variant onto the agents the editor has", () => {
    const { fake, agents } = editor(["build", "explore", "docs", "title"])
    const seen = writeAgentModels(fake, profiles(), new Set())
    expect(seen).toEqual(["build", "explore", "docs", "title"])
    expect(agents.get("build")!.model).toEqual({ providerID: "zai", id: "glm-5", variant: "max" })
    expect(agents.get("explore")!.model).toEqual({ providerID: "zai", id: "glm-4" })
    expect(agents.get("docs")!.model).toEqual({
      providerID: "anthropic",
      id: "claude-docs",
      variant: "high",
    })
    // A hidden agent without a placement takes the rest tier (decision 3 of #36).
    expect(agents.get("title")!.model).toEqual({ providerID: "zai", id: "glm-4" })
  })

  test("never creates an agent the location does not have", () => {
    const { fake, agents, updated } = editor(["build"])
    writeAgentModels(fake, profiles(), new Set())
    expect(updated).toEqual(["build"])
    expect([...agents.keys()]).toEqual(["build"])
  })

  test("writes learned ids the editor cannot see yet (markdown agents)", () => {
    const { fake, agents } = editor(["build"])
    writeAgentModels(fake, profiles(), new Set(["build", "reviewer", "explore"]))
    expect(agents.get("reviewer")!.model).toEqual({ providerID: "zai", id: "glm-4" })
    expect(agents.get("explore")!.model).toEqual({ providerID: "zai", id: "glm-4" })
    expect(agents.has("gone")).toBe(false)
  })

  test("leaves an excluded agent with no remembered model alone", () => {
    const { fake, updated } = editor(["vision"])
    writeAgentModels(fake, profiles(), new Set())
    expect(updated).toEqual([])
  })

  test("restores an excluded agent's remembered model", () => {
    const { fake, agents } = editor(["vision"])
    writeAgentModels(fake, profiles({ effective: { vision: { model: "x/old", variant: "v" } } }), new Set())
    expect(agents.get("vision")!.model).toEqual({ providerID: "x", id: "old", variant: "v" })
  })

  test("writes nothing without a usable active profile", () => {
    const { fake, updated } = editor(["build"])
    writeAgentModels(fake, profiles({ active: "" }), new Set())
    writeAgentModels(fake, profiles({ active: "ghost" }), new Set())
    expect(updated).toEqual([])
  })

  test("skips a slot whose model is not provider/model", () => {
    const { fake, updated } = editor(["build"])
    const file = profiles()
    file.profiles.glm!.heavy = { model: "glm-5" }
    writeAgentModels(fake, file, new Set())
    expect(updated).toEqual([])
  })
})

describe("defaultModel", () => {
  test("is the heavy tier without its variant", () => {
    expect(defaultModel(profiles())).toEqual({ providerID: "zai", modelID: "glm-5" })
  })

  test("is undefined without an active profile", () => {
    expect(defaultModel(profiles({ active: "" }))).toBeUndefined()
  })
})

describe("inspectAgents", () => {
  const glm5 = { providerID: "zai", id: "glm-5", variant: "max" }
  const glm4 = { providerID: "zai", id: "glm-4" }

  test("an agent listing the planned model is not pinned", () => {
    const report = inspectAgents(profiles(), [
      { id: "build", model: glm5 },
      { id: "explore", model: { ...glm4, variant: "default" } },
    ])!
    expect(report.pinned).toEqual([])
    expect(report.agents).toEqual([
      {
        id: "build",
        placement: "heavy",
        planned: { ...glm5 },
        model: { ...glm5 },
        pinned: false,
      },
      {
        id: "explore",
        placement: "rest",
        planned: { ...glm4, variant: null },
        model: { ...glm4, variant: "default" },
        pinned: false,
      },
    ])
    expect(report.applied).toEqual({
      build: { model: "zai/glm-5", variant: "max" },
      explore: { model: "zai/glm-4" },
    })
  })

  test("an agent whose config model won is pinned", () => {
    const report = inspectAgents(profiles(), [
      { id: "build", model: { providerID: "openai", id: "gpt" } },
      { id: "explore", model: { ...glm4, variant: "high" } },
      { id: "docs", model: { providerID: "anthropic", id: "claude-docs" } },
    ])!
    expect(report.pinned).toEqual(["build", "explore", "docs"])
    expect(report.applied).toEqual({})
    expect(report.agents.every((agent) => agent.pinned)).toBe(true)
  })

  test("an agent with no model after the reload is pinned too", () => {
    expect(inspectAgents(profiles(), [{ id: "build" }])!.pinned).toEqual(["build"])
  })

  test("an excluded agent left alone is not pinned and plans nothing", () => {
    const report = inspectAgents(profiles(), [{ id: "vision", model: glm4 }])!
    expect(report.agents).toEqual([
      { id: "vision", placement: "excluded", planned: null, model: { ...glm4, variant: null }, pinned: false },
    ])
  })

  test("unplaced agents are reported unassigned with a null placement", () => {
    const report = inspectAgents(profiles(), [{ id: "reviewer", model: glm4 }])!
    expect(report.plan.unassigned).toEqual(["reviewer"])
    expect(report.agents[0]!.placement).toBeNull()
  })

  test("placements for agents the location lacks are not reported", () => {
    const report = inspectAgents(profiles(), [])!
    expect(report.agents).toEqual([])
  })

  test("is undefined without an active profile", () => {
    expect(inspectAgents(profiles({ active: "" }), [{ id: "build" }])).toBeUndefined()
  })
})

describe("nextEffective", () => {
  test("records applied agents and keeps the rest of the prior map", () => {
    const prior = { vision: { model: "x/old" }, build: { model: "zai/glm-5", variant: "max" } }
    const next = nextEffective(prior, { explore: { model: "zai/glm-4" } })
    expect(next.changed).toBe(true)
    expect(next.effective).toEqual({ ...prior, explore: { model: "zai/glm-4" } })
  })

  test("reports no change when every applied slot was already recorded", () => {
    const prior = { build: { model: "zai/glm-5", variant: "max" } }
    expect(nextEffective(prior, { build: { model: "zai/glm-5", variant: "max" } }).changed).toBe(false)
  })

  test("a variant change counts as a change", () => {
    const prior = { build: { model: "zai/glm-5", variant: "max" } }
    const next = nextEffective(prior, { build: { model: "zai/glm-5" } })
    expect(next.changed).toBe(true)
    expect(next.effective.build).toEqual({ model: "zai/glm-5" })
  })
})
