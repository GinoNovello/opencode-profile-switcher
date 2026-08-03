import { describe, expect, test } from "bun:test"
import { applyProfile, type MutableConfig } from "../src/apply.js"
import type { ProfilesFile } from "../src/schema.js"

function makeProfiles(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    profiles: {
      glm: {
        heavy: { model: "zai/glm-5", variant: "max" },
        rest: { model: "zai/glm-4" },
        placements: {
          build: "heavy",
          plan: "heavy",
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

  test("specific agent gets its direct model and variant without using a tier", () => {
    const cfg: MutableConfig = {}
    applyProfile(cfg, makeProfiles())
    expect(cfg.agent?.docs).toEqual({ model: "anthropic/claude-docs", variant: "high" })
  })

  test("specific agent without a variant clears a stale variant", () => {
    const profiles = makeProfiles({
      profiles: {
        glm: {
          heavy: { model: "zai/glm-5" },
          rest: { model: "zai/glm-4" },
          placements: { docs: "specific" },
          specifics: { docs: { model: "anthropic/claude-docs" } },
        },
      },
    })
    const cfg: MutableConfig = { agent: { docs: { model: "old", variant: "reasoning" } } }
    applyProfile(cfg, profiles)
    expect(cfg.agent?.docs).toEqual({ model: "anthropic/claude-docs" })
    expect(cfg.agent?.docs?.variant).toBeUndefined()
  })

  test("clears a stale variant when tier has none", () => {
    const cfg: MutableConfig = { agent: { explore: { model: "old", variant: "reasoning" } } }
    applyProfile(cfg, makeProfiles())
    expect(cfg.agent?.explore?.variant).toBeUndefined()
    expect(cfg.agent?.explore?.model).toBe("zai/glm-4")
  })

  test("excluded agent with no effective history is left completely untouched", () => {
    const cfg: MutableConfig = { agent: { vision: { model: "anthropic/claude-vision" } } }
    const result = applyProfile(cfg, makeProfiles())
    expect(cfg.agent?.vision).toEqual({ model: "anthropic/claude-vision" })
    expect(result.changedAgents).not.toContain("vision")
  })

  test("applying heavy/rest/specific records the chosen model and variant as effective", () => {
    const cfg: MutableConfig = {}
    const result = applyProfile(cfg, makeProfiles())
    expect(result.effective.build).toEqual({ model: "zai/glm-5", variant: "max" })
    expect(result.effective.explore).toEqual({ model: "zai/glm-4" })
    expect(result.effective.docs).toEqual({ model: "anthropic/claude-docs", variant: "high" })
    expect(result.effective.vision).toBeUndefined()
    expect(result.effectiveChanged).toBe(true)
  })

  test("excluded agent restores its last persisted effective model and variant", () => {
    const profiles = makeProfiles({
      effective: { vision: { model: "xai/grok-vision", variant: "high" } },
    })
    const cfg: MutableConfig = { agent: { vision: { model: "anthropic/claude-vision" } } }
    const result = applyProfile(cfg, profiles)
    expect(cfg.agent?.vision).toEqual({ model: "xai/grok-vision", variant: "high" })
    expect(result.changedAgents).toContain("vision")
    // Restoring does not invent a new effective entry shape.
    expect(result.effective.vision).toEqual({ model: "xai/grok-vision", variant: "high" })
  })

  test("excluded agent restores a complete effective slot without a variant, clearing stale ones", () => {
    const profiles = makeProfiles({
      effective: { vision: { model: "xai/grok-vision" } },
    })
    const cfg: MutableConfig = {
      agent: { vision: { model: "anthropic/claude-vision", variant: "reasoning" } },
    }
    applyProfile(cfg, profiles)
    expect(cfg.agent?.vision).toEqual({ model: "xai/grok-vision" })
    expect(cfg.agent?.vision?.variant).toBeUndefined()
  })

  test("switching from applied to excluded preserves the prior profile's effective state", () => {
    const profiles: ProfilesFile = {
      profiles: {
        glm: {
          heavy: { model: "zai/glm-5", variant: "max" },
          rest: { model: "zai/glm-4" },
          placements: { build: "heavy" },
          specifics: {},
        },
        pin: {
          heavy: { model: "xai/grok-heavy" },
          rest: { model: "xai/grok-mini" },
          placements: { build: "excluded" },
          specifics: {},
        },
      },
      active: "glm",
      effective: {},
    }
    const cfg: MutableConfig = {}
    const afterGlm = applyProfile(cfg, profiles)
    expect(cfg.agent?.build).toEqual({ model: "zai/glm-5", variant: "max" })
    expect(afterGlm.effective.build).toEqual({ model: "zai/glm-5", variant: "max" })

    // Activate the excluding profile with the effective state from the prior apply.
    const pinProfiles: ProfilesFile = {
      ...profiles,
      active: "pin",
      effective: afterGlm.effective,
    }
    const afterPin = applyProfile(cfg, pinProfiles)
    expect(cfg.agent?.build).toEqual({ model: "zai/glm-5", variant: "max" })
    expect(afterPin.effective.build).toEqual({ model: "zai/glm-5", variant: "max" })
  })

  test("applying a different placement overwrites prior effective state completely", () => {
    const profiles = makeProfiles({
      effective: { build: { model: "old/model", variant: "old-var" } },
    })
    // rest tier has no variant — must replace the whole prior slot, not merge.
    const restOnly = makeProfiles({
      profiles: {
        glm: {
          heavy: { model: "zai/glm-5" },
          rest: { model: "zai/glm-4" },
          placements: { build: "rest" },
          specifics: {},
        },
      },
      effective: profiles.effective,
    })
    const cfg: MutableConfig = {}
    const result = applyProfile(cfg, restOnly)
    expect(cfg.agent?.build).toEqual({ model: "zai/glm-4" })
    expect(result.effective.build).toEqual({ model: "zai/glm-4" })
    expect(result.effective.build?.variant).toBeUndefined()
  })

  test("incomplete specific does not update effective state for that agent", () => {
    const profiles = {
      profiles: {
        glm: {
          heavy: { model: "zai/glm-5" },
          rest: { model: "zai/glm-4" },
          placements: { docs: "specific" as const },
          specifics: {},
        },
      },
      active: "glm",
      effective: { docs: { model: "keep/effective", variant: "v" } },
    } as ProfilesFile
    const cfg: MutableConfig = {}
    const result = applyProfile(cfg, profiles)
    expect(result.effective.docs).toEqual({ model: "keep/effective", variant: "v" })
    expect(result.changedAgents).not.toContain("docs")
  })

  test("the same agent can be placed differently per profile", () => {
    const profiles: ProfilesFile = {
      profiles: {
        glm: {
          heavy: { model: "zai/glm-5" },
          rest: { model: "zai/glm-4" },
          placements: { build: "heavy" },
          specifics: {},
        },
        grok: {
          heavy: { model: "xai/grok-heavy" },
          rest: { model: "xai/grok-mini" },
          placements: { build: "rest" },
          specifics: {},
        },
      },
      active: "grok",
      effective: {},
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
      agents: ["build", "explore", "vision", "newbie", "docs"],
    })
    // vision excluded, others applied (including specific docs)
    expect(result.changedAgents.sort()).toEqual(["build", "docs", "explore", "newbie", "plan"])
    expect(cfg.agent?.newbie).toEqual({ model: "zai/glm-4" })
    expect(cfg.agent?.docs).toEqual({ model: "anthropic/claude-docs", variant: "high" })
  })

  test("incomplete specific slot is skipped defensively without breaking the switch", () => {
    const profiles = {
      profiles: {
        glm: {
          heavy: { model: "zai/glm-5" },
          rest: { model: "zai/glm-4" },
          placements: { build: "heavy", docs: "specific" as const },
          // Bypass schema: missing slot for a specific agent.
          specifics: {},
        },
      },
      active: "glm",
      effective: {},
    } as ProfilesFile
    const cfg: MutableConfig = { agent: { docs: { model: "keep-me", variant: "old" } } }
    const result = applyProfile(cfg, profiles)
    expect(result.applied).toBe(true)
    expect(cfg.model).toBe("zai/glm-5")
    expect(cfg.agent?.build).toEqual({ model: "zai/glm-5" })
    // Incomplete specific must not partially overwrite the agent.
    expect(cfg.agent?.docs).toEqual({ model: "keep-me", variant: "old" })
    expect(result.changedAgents).not.toContain("docs")
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
          specifics: {},
        },
      },
    })
    const cfg: MutableConfig = {}
    applyProfile(cfg, profiles)
    expect(cfg.agent?.build).toEqual({ model: "xai/grok-heavy" })
    expect(cfg.agent?.build?.variant).toBeUndefined()
  })
})
