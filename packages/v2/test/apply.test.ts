import { describe, expect, test } from "bun:test"
import { planApply } from "../../../src/core/apply-plan.js"
import type { ProfilesFile } from "../../../src/core/schema.js"
import {
  defaultModel,
  describeInvalidSlot,
  inspectAgents,
  invalidSlots,
  nextEffective,
  writeAgentModels,
  type AgentEditorLike,
  type HostModel,
  type ListedAgent,
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

  /** Inspect `listed` against the plan for exactly those agents. */
  function inspect(file: ProfilesFile, listed: ListedAgent[]) {
    const plan = planApply(file, { agents: listed.map((agent) => agent.id) })
    if (!plan.applied) throw new Error("expected a ready plan")
    return inspectAgents(file, plan, listed)
  }

  test("an agent listing the planned model is not fixed by config", () => {
    const report = inspect(profiles(), [
      { id: "build", model: glm5 },
      { id: "explore", model: { ...glm4, variant: "default" } },
    ])
    expect(report.fixedByConfig).toEqual([])
    expect(report.unapplied).toEqual([])
    expect(report.agents).toEqual([
      {
        id: "build",
        placement: "heavy",
        planned: { ...glm5 },
        model: { ...glm5 },
        fixedByConfig: false,
      },
      {
        id: "explore",
        placement: "rest",
        planned: { ...glm4, variant: null },
        model: { ...glm4, variant: "default" },
        fixedByConfig: false,
      },
    ])
    expect(report.applied).toEqual({
      build: { model: "zai/glm-5", variant: "max" },
      explore: { model: "zai/glm-4" },
    })
  })

  test("an agent whose config model won is fixed by config", () => {
    const report = inspect(profiles(), [
      { id: "build", model: { providerID: "openai", id: "gpt" } },
      { id: "explore", model: { ...glm4, variant: "high" } },
      { id: "docs", model: { providerID: "anthropic", id: "claude-docs" } },
    ])
    expect(report.fixedByConfig).toEqual(["build", "explore", "docs"])
    expect(report.applied).toEqual({})
    expect(report.agents.every((agent) => agent.fixedByConfig)).toBe(true)
  })

  test("an agent with no model after the reload is unapplied, not fixed by config", () => {
    const report = inspect(profiles(), [{ id: "build" }])
    expect(report.fixedByConfig).toEqual([])
    expect(report.unapplied).toEqual(["build"])
    expect(report.applied).toEqual({})
    expect(report.agents[0]!.fixedByConfig).toBe(false)
  })

  test("an excluded agent left alone is not fixed by config and plans nothing", () => {
    const report = inspect(profiles(), [{ id: "vision", model: glm4 }])
    expect(report.agents).toEqual([
      {
        id: "vision",
        placement: "excluded",
        planned: null,
        model: { ...glm4, variant: null },
        fixedByConfig: false,
      },
    ])
  })

  test("unplaced agents are reported unassigned with a null placement", () => {
    const report = inspect(profiles(), [{ id: "reviewer", model: glm4 }])
    expect(report.plan.unassigned).toEqual(["reviewer"])
    expect(report.agents[0]!.placement).toBeNull()
  })

  test("placements for agents the location lacks are not reported", () => {
    expect(inspect(profiles(), []).agents).toEqual([])
  })
})

describe("invalidSlots", () => {
  test("a valid profile has none", () => {
    expect(invalidSlots(profiles())).toEqual([])
    expect(invalidSlots(profiles({ active: "" }))).toEqual([])
  })

  test("reports tiers, specifics and remembered exclusions whose model is not provider/model", () => {
    const file = profiles({ effective: { vision: { model: "nope" } } })
    file.profiles.glm!.heavy = { model: "zai/glm-5#max" }
    file.profiles.glm!.specifics.docs = { model: "claude-docs" }
    const invalid = invalidSlots(file)
    expect(invalid).toEqual([
      { placement: "heavy", agent: null, model: "zai/glm-5#max" },
      { placement: "excluded", agent: "vision", model: "nope" },
      { placement: "specific", agent: "docs", model: "claude-docs" },
    ])
    expect(invalid.map(describeInvalidSlot)).toEqual([
      '"zai/glm-5#max" for the heavy tier',
      '"nope" for excluded agent "vision"',
      '"claude-docs" for specific agent "docs"',
    ])
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
