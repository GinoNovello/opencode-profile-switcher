import { describe, expect, test } from "bun:test"
import { applyProfile, type MutableConfig } from "../src/apply.js"
import type { ProfilesFile } from "../src/schema.js"

function makeProfiles(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    profiles: {
      glm: {
        heavy: { model: "zai/glm-5", variant: "max" },
        rest: { model: "zai/glm-4" },
        placements: { build: "heavy", plan: "heavy", explore: "rest", vision: "excluded" },
      },
    },
    active: "glm",
    ...overrides,
  }
}

describe("applyProfile", () => {
  test("sets global model=heavy and small_model=rest", () => {
    const cfg: MutableConfig = {}
    const result = applyProfile(cfg, makeProfiles())
    expect(result.applied).toBe(true)
    expect(cfg.model).toBe("zai/glm-5")
    expect(cfg.small_model).toBe("zai/glm-4")
  })

  test("heavy agent gets heavy model and variant", () => {
    const cfg: MutableConfig = {}
    applyProfile(cfg, makeProfiles())
    expect(cfg.agent?.build).toEqual({ model: "zai/glm-5", variant: "max" })
  })

  test("rest agent gets rest model and no variant", () => {
    const cfg: MutableConfig = {}
    applyProfile(cfg, makeProfiles())
    expect(cfg.agent?.explore).toEqual({ model: "zai/glm-4" })
    expect(cfg.agent?.explore?.variant).toBeUndefined()
  })

  test("clears a stale variant when tier has none", () => {
    const cfg: MutableConfig = { agent: { explore: { model: "old", variant: "reasoning" } } }
    applyProfile(cfg, makeProfiles())
    expect(cfg.agent?.explore?.variant).toBeUndefined()
    expect(cfg.agent?.explore?.model).toBe("zai/glm-4")
  })

  test("excluded agent is left completely untouched", () => {
    const cfg: MutableConfig = { agent: { vision: { model: "anthropic/claude-vision" } } }
    const result = applyProfile(cfg, makeProfiles())
    expect(cfg.agent?.vision).toEqual({ model: "anthropic/claude-vision" })
    expect(result.changedAgents).not.toContain("vision")
  })

  test("the same agent can be placed differently per profile", () => {
    const profiles: ProfilesFile = {
      profiles: {
        glm: {
          heavy: { model: "zai/glm-5" },
          rest: { model: "zai/glm-4" },
          placements: { build: "heavy" },
        },
        grok: {
          heavy: { model: "xai/grok-heavy" },
          rest: { model: "xai/grok-mini" },
          placements: { build: "rest" },
        },
      },
      active: "grok",
    }
    const cfg: MutableConfig = {}
    applyProfile(cfg, profiles)
    expect(cfg.agent?.build).toEqual({ model: "xai/grok-mini" })
  })

  test("an agent absent from the active profile falls back to rest and is reported", () => {
    const cfg: MutableConfig = {}
    const result = applyProfile(cfg, makeProfiles(), { agents: ["custom-agent"] })
    expect(cfg.agent?.["custom-agent"]).toEqual({ model: "zai/glm-4" })
    expect(result.unassigned).toContain("custom-agent")
  })

  test("enumerated agents are all considered", () => {
    const cfg: MutableConfig = {}
    const result = applyProfile(cfg, makeProfiles(), {
      agents: ["build", "explore", "vision", "newbie"],
    })
    // vision excluded, others applied
    expect(result.changedAgents.sort()).toEqual(["build", "explore", "newbie", "plan"])
    expect(cfg.agent?.newbie).toEqual({ model: "zai/glm-4" })
  })

  test("no active profile -> not applied, nothing mutated", () => {
    const cfg: MutableConfig = {}
    const result = applyProfile(cfg, makeProfiles({ active: "" }))
    expect(result.applied).toBe(false)
    expect(result.reason).toBe("no-active")
    expect(cfg.model).toBeUndefined()
    expect(cfg.agent).toBeUndefined()
  })

  test("unknown active profile -> not applied", () => {
    const cfg: MutableConfig = {}
    const result = applyProfile(cfg, makeProfiles({ active: "ghost" }))
    expect(result.applied).toBe(false)
    expect(result.reason).toBe("unknown-active")
    expect(cfg.model).toBeUndefined()
  })

  test("heavy profile without variant does not add one", () => {
    const profiles = makeProfiles({
      profiles: {
        glm: {
          heavy: { model: "xai/grok-heavy" },
          rest: { model: "xai/grok-mini" },
          placements: { build: "heavy" },
        },
      },
    })
    const cfg: MutableConfig = {}
    applyProfile(cfg, profiles)
    expect(cfg.agent?.build).toEqual({ model: "xai/grok-heavy" })
    expect(cfg.agent?.build?.variant).toBeUndefined()
  })
})
