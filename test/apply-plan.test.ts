import { describe, expect, test } from "bun:test"
import { planApply } from "../src/core/apply-plan.js"
import type { ProfilesFile } from "../src/core/schema.js"

function makeProfiles(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
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
        },
        specifics: { docs: { model: "anthropic/claude-docs", variant: "high" } },
      },
    },
    active: "glm",
    effective: {},
    ...overrides,
  }
}

describe("planApply", () => {
  test("no active profile skips without touching effective", () => {
    const effective = { build: { model: "a/b" } }
    const plan = planApply(makeProfiles({ active: "", effective }))
    expect(plan).toEqual({
      applied: false,
      active: "",
      reason: "no-active",
      changedAgents: [],
      unassigned: [],
      effective,
      effectiveChanged: false,
    })
    expect(plan.effective).not.toBe(effective)
  })

  test("unknown active profile skips", () => {
    const plan = planApply(makeProfiles({ active: "ghost" }))
    expect(plan.applied).toBe(false)
    if (plan.applied) return
    expect(plan.reason).toBe("unknown-active")
  })

  test("defaults carry the heavy and rest tier slots", () => {
    const plan = planApply(makeProfiles())
    if (!plan.applied) throw new Error("expected a ready plan")
    expect(plan.defaults).toEqual({
      heavy: { model: "zai/glm-5", variant: "max" },
      rest: { model: "zai/glm-4" },
    })
  })

  test("resolves each agent to a set or keep target", () => {
    const plan = planApply(makeProfiles())
    if (!plan.applied) throw new Error("expected a ready plan")
    expect(plan.agents).toEqual([
      {
        name: "build",
        action: "set",
        placement: "heavy",
        slot: { model: "zai/glm-5", variant: "max" },
        unassigned: false,
      },
      { name: "explore", action: "set", placement: "rest", slot: { model: "zai/glm-4" }, unassigned: false },
      { name: "vision", action: "keep", placement: "excluded" },
      {
        name: "docs",
        action: "set",
        placement: "specific",
        slot: { model: "anthropic/claude-docs", variant: "high" },
        unassigned: false,
      },
    ])
    expect(plan.changedAgents).toEqual(["build", "explore", "docs"])
  })

  test("considers runtime agents, then placements, then configured agents", () => {
    const plan = planApply(makeProfiles(), { agents: ["newbie", "build"], configured: ["custom", "explore"] })
    if (!plan.applied) throw new Error("expected a ready plan")
    expect(plan.agents.map((agent) => agent.name)).toEqual([
      "newbie",
      "build",
      "explore",
      "vision",
      "docs",
      "custom",
    ])
  })

  test("agents outside the placements fall back to rest and are reported unassigned", () => {
    const plan = planApply(makeProfiles(), { agents: ["newbie"] })
    if (!plan.applied) throw new Error("expected a ready plan")
    expect(plan.agents[0]).toEqual({
      name: "newbie",
      action: "set",
      placement: "rest",
      slot: { model: "zai/glm-4" },
      unassigned: true,
    })
    expect(plan.unassigned).toEqual(["newbie"])
  })

  test("excluded agent restores its remembered effective slot", () => {
    const plan = planApply(
      makeProfiles({ effective: { vision: { model: "openai/gpt-5", variant: "low" } } }),
    )
    if (!plan.applied) throw new Error("expected a ready plan")
    expect(plan.agents.find((agent) => agent.name === "vision")).toEqual({
      name: "vision",
      action: "set",
      placement: "excluded",
      slot: { model: "openai/gpt-5", variant: "low" },
      unassigned: false,
    })
    expect(plan.effective.vision).toEqual({ model: "openai/gpt-5", variant: "low" })
  })

  test("specific agent with an incomplete slot is kept", () => {
    const base = makeProfiles()
    const profiles = makeProfiles({
      profiles: { glm: { ...base.profiles.glm!, specifics: {} } },
    })
    const plan = planApply(profiles)
    if (!plan.applied) throw new Error("expected a ready plan")
    expect(plan.agents.find((agent) => agent.name === "docs")).toEqual({
      name: "docs",
      action: "keep",
      placement: "specific",
    })
    expect(plan.changedAgents).not.toContain("docs")
    expect(plan.effective.docs).toBeUndefined()
  })

  test("effective records every set slot and reports whether it changed", () => {
    const first = planApply(makeProfiles())
    expect(first.effective).toEqual({
      build: { model: "zai/glm-5", variant: "max" },
      explore: { model: "zai/glm-4" },
      docs: { model: "anthropic/claude-docs", variant: "high" },
    })
    expect(first.effectiveChanged).toBe(true)

    const again = planApply(makeProfiles({ effective: first.effective }))
    expect(again.effectiveChanged).toBe(false)
  })

  test("does not mutate its input", () => {
    const profiles = makeProfiles({ effective: { vision: { model: "openai/gpt-5" } } })
    const snapshot = structuredClone(profiles)
    planApply(profiles, { agents: ["newbie"] })
    expect(profiles).toEqual(snapshot)
  })
})
