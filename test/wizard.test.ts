import { describe, expect, test } from "bun:test"
import type { AgentInfo } from "../src/agents.js"
import type { Placement, Profile, ProfilesFile } from "../src/schema.js"
import {
  buildPlacementOptions,
  buildProfile,
  buildSpecificOptions,
  commitProfile,
  copyPlacements,
  copySpecifics,
  cycleAgentPlacement,
  defaultPlacement,
  defaultPlacements,
  deleteProfile,
  missingSpecificAgents,
  nextPlacement,
  placementOf,
  renameProfile,
  setPlacement,
  setSpecific,
  specificAgentNames,
  specificsComplete,
  specificsProgress,
  updateProfile,
  validateProfileName,
} from "../src/wizard.js"

const agents: AgentInfo[] = [
  { name: "build", mode: "primary", hidden: false },
  { name: "plan", mode: "all", hidden: false },
  { name: "explore", mode: "subagent", hidden: false },
  { name: "summarizer", mode: "subagent", hidden: true },
]

const glm: Profile = {
  heavy: { model: "zai/glm-5" },
  rest: { model: "zai/glm-4" },
  placements: { build: "heavy", explore: "rest", vision: "excluded", docs: "specific" },
  specifics: { docs: { model: "anthropic/claude-docs", variant: "high" } },
}

function makeFile(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    profiles: { glm },
    active: "glm",
    ...overrides,
  }
}

describe("defaultPlacement", () => {
  test("primary -> heavy", () => expect(defaultPlacement(agents[0]!)).toBe("heavy"))
  test("all -> heavy", () => expect(defaultPlacement(agents[1]!)).toBe("heavy"))
  test("subagent -> rest", () => expect(defaultPlacement(agents[2]!)).toBe("rest"))
  test("hidden -> rest even if not subagent", () =>
    expect(defaultPlacement({ name: "x", mode: "primary", hidden: true })).toBe("rest"))
})

describe("defaultPlacements", () => {
  test("primary/primary-capable -> heavy, subagents/hidden -> rest", () => {
    expect(defaultPlacements(agents)).toEqual({
      build: "heavy",
      plan: "heavy",
      explore: "rest",
      summarizer: "rest",
    })
  })
})

describe("placement editing", () => {
  const placements: Record<string, Placement> = {
    build: "heavy",
    explore: "rest",
    docs: "specific",
    vision: "excluded",
  }

  test("placementOf reads placements, defaulting absent agents to rest", () => {
    expect(placementOf(placements, "build")).toBe("heavy")
    expect(placementOf(placements, "explore")).toBe("rest")
    expect(placementOf(placements, "docs")).toBe("specific")
    expect(placementOf(placements, "vision")).toBe("excluded")
    expect(placementOf(placements, "unknown")).toBe("rest")
  })

  test("nextPlacement cycles heavy -> rest -> specific -> excluded -> heavy", () => {
    expect(nextPlacement("heavy")).toBe("rest")
    expect(nextPlacement("rest")).toBe("specific")
    expect(nextPlacement("specific")).toBe("excluded")
    expect(nextPlacement("excluded")).toBe("heavy")
  })

  test("setPlacement to excluded records the exclusion", () => {
    const next = setPlacement(placements, "build", "excluded")
    expect(next.build).toBe("excluded")
  })

  test("setPlacement to a tier replaces an exclusion", () => {
    const next = setPlacement(placements, "vision", "heavy")
    expect(next.vision).toBe("heavy")
  })

  test("setPlacement does not mutate the input", () => {
    setPlacement(placements, "build", "excluded")
    expect(placements.build).toBe("heavy")
    expect(placements.vision).toBe("excluded")
  })
})

describe("cycleAgentPlacement", () => {
  test("leaving specific drops the slot", () => {
    const result = cycleAgentPlacement(
      { docs: "specific", build: "heavy" },
      { docs: { model: "a/docs", variant: "high" } },
      "docs",
    )
    expect(result.placements.docs).toBe("excluded")
    expect(result.specifics.docs).toBeUndefined()
    expect(result.specifics).toEqual({})
  })

  test("returning to specific starts without a model", () => {
    let state = {
      placements: { docs: "specific" } as Record<string, Placement>,
      specifics: { docs: { model: "a/docs" } },
    }
    // specific → excluded → heavy → rest → specific
    state = cycleAgentPlacement(state.placements, state.specifics, "docs")
    state = cycleAgentPlacement(state.placements, state.specifics, "docs")
    state = cycleAgentPlacement(state.placements, state.specifics, "docs")
    state = cycleAgentPlacement(state.placements, state.specifics, "docs")
    expect(state.placements.docs).toBe("specific")
    expect(state.specifics.docs).toBeUndefined()
  })

  test("cycling a non-specific agent leaves specifics untouched", () => {
    const specifics = { docs: { model: "a/docs" } }
    const result = cycleAgentPlacement(
      { build: "heavy", docs: "specific" },
      specifics,
      "build",
    )
    expect(result.placements.build).toBe("rest")
    expect(result.specifics).toEqual(specifics)
  })

  test("does not mutate inputs", () => {
    const placements: Record<string, Placement> = { docs: "specific" }
    const specifics = { docs: { model: "a/docs" } }
    cycleAgentPlacement(placements, specifics, "docs")
    expect(placements.docs).toBe("specific")
    expect(specifics.docs).toEqual({ model: "a/docs" })
  })
})

describe("specific draft helpers", () => {
  const placements: Record<string, Placement> = {
    docs: "specific",
    vision: "specific",
    build: "heavy",
  }

  test("specificAgentNames lists only specific agents, sorted", () => {
    expect(specificAgentNames(placements)).toEqual(["docs", "vision"])
  })

  test("missingSpecificAgents reports incomplete slots", () => {
    expect(missingSpecificAgents(placements, { docs: { model: "a/docs" } })).toEqual(["vision"])
    expect(missingSpecificAgents(placements, {})).toEqual(["docs", "vision"])
  })

  test("specificsComplete is true only when every specific has a model", () => {
    expect(specificsComplete(placements, { docs: { model: "a/docs" } })).toBe(false)
    expect(
      specificsComplete(placements, {
        docs: { model: "a/docs" },
        vision: { model: "a/vision" },
      }),
    ).toBe(true)
    expect(specificsComplete({ build: "heavy" }, {})).toBe(true)
  })

  test("specificsProgress tracks done/total/missing", () => {
    expect(specificsProgress(placements, { docs: { model: "a/docs" } })).toEqual({
      done: 1,
      total: 2,
      missing: ["vision"],
    })
  })

  test("setSpecific writes model and optional variant without mutating input", () => {
    const base = { docs: { model: "old" } }
    const next = setSpecific(base, "vision", "a/vision", "high")
    expect(next).toEqual({
      docs: { model: "old" },
      vision: { model: "a/vision", variant: "high" },
    })
    expect(base).toEqual({ docs: { model: "old" } })
    expect(setSpecific({}, "docs", "a/docs", "")).toEqual({ docs: { model: "a/docs" } })
  })
})

describe("copyPlacements", () => {
  test("copies a profile's placements, including exclusions and specific", () => {
    expect(copyPlacements(glm)).toEqual({
      build: "heavy",
      explore: "rest",
      vision: "excluded",
      docs: "specific",
    })
  })
  test("returns a detached copy", () => {
    const copy = copyPlacements(glm)
    copy.build = "rest"
    expect(glm.placements.build).toBe("heavy")
  })
})

describe("copySpecifics", () => {
  test("copies specific slots for edit flows", () => {
    expect(copySpecifics(glm)).toEqual({
      docs: { model: "anthropic/claude-docs", variant: "high" },
    })
  })
  test("returns a detached deep-enough copy", () => {
    const copy = copySpecifics(glm)
    copy.docs = { model: "other" }
    expect(glm.specifics.docs.model).toBe("anthropic/claude-docs")
  })
})

describe("buildPlacementOptions", () => {
  test("one row per agent plus a Done row", () => {
    const options = buildPlacementOptions(glm.placements, agents)
    expect(options).toHaveLength(agents.length + 1)
    expect(options.at(-1)?.value).toEqual({ kind: "done" })
    expect(options[0]).toMatchObject({ value: { kind: "agent", name: "build" }, description: "→ heavy" })
  })
  test("agents absent from placements show as rest", () => {
    const options = buildPlacementOptions(glm.placements, agents)
    expect(options[1]).toMatchObject({ value: { kind: "agent", name: "plan" }, description: "→ rest" })
  })
})

describe("buildSpecificOptions", () => {
  test("lists specific agents in free order with progress and Done", () => {
    const options = buildSpecificOptions(
      { docs: "specific", vision: "specific", build: "heavy" },
      { docs: { model: "a/docs", variant: "high" } },
    )
    expect(options).toHaveLength(3)
    expect(options[0]).toMatchObject({
      title: "✓ docs",
      value: { kind: "agent", name: "docs" },
      description: "a/docs (high)",
    })
    expect(options[1]).toMatchObject({
      title: "○ vision",
      value: { kind: "agent", name: "vision" },
      description: "not set",
    })
    expect(options[2]).toMatchObject({
      title: "✓ Done (1/2 set)",
      value: { kind: "done" },
    })
    expect(options[2]?.description).toContain("vision")
  })

  test("Done is ready when every specific has a model", () => {
    const options = buildSpecificOptions(
      { docs: "specific" },
      { docs: { model: "a/docs" } },
    )
    expect(options.at(-1)).toMatchObject({
      title: "✓ Done",
      description: "Save specific models",
    })
  })
})

describe("validateProfileName", () => {
  test("rejects empty", () => expect(validateProfileName("  ", []).ok).toBe(false))
  test("rejects a duplicate", () => expect(validateProfileName("glm", ["glm"]).ok).toBe(false))
  test("allows renaming to the same name (self)", () =>
    expect(validateProfileName("glm", ["glm"], "glm").ok).toBe(true))
  test("accepts a fresh name", () => expect(validateProfileName("new", ["glm"]).ok).toBe(true))
})

describe("buildProfile", () => {
  test("assembles models, placements and specifics, with a heavy variant when given", () => {
    const placements: Record<string, Placement> = { build: "heavy", docs: "specific" }
    expect(
      buildProfile("zai/glm-5", "zai/glm-4", placements, "max", {
        docs: { model: "a/docs", variant: "high" },
      }),
    ).toEqual({
      heavy: { model: "zai/glm-5", variant: "max" },
      rest: { model: "zai/glm-4" },
      placements: { build: "heavy", docs: "specific" },
      specifics: { docs: { model: "a/docs", variant: "high" } },
    })
  })

  test("omits the variant when empty and defaults specifics to empty", () => {
    const p = buildProfile("zai/glm-5", "zai/glm-4", {}, "")
    expect(p.heavy).toEqual({ model: "zai/glm-5" })
    expect(p.placements).toEqual({})
    expect(p.specifics).toEqual({})
  })

  test("drops orphan specific slots and incomplete specific agents", () => {
    const p = buildProfile(
      "zai/glm-5",
      "zai/glm-4",
      { docs: "specific", build: "heavy" },
      undefined,
      {
        docs: { model: "" },
        orphan: { model: "a/orphan" },
        build: { model: "should-drop" },
      },
    )
    expect(p.specifics).toEqual({})
  })

  test("keeps only slots for agents still placed as specific", () => {
    const p = buildProfile(
      "zai/glm-5",
      "zai/glm-4",
      { docs: "specific", vision: "rest" },
      undefined,
      {
        docs: { model: "a/docs" },
        vision: { model: "a/vision" },
      },
    )
    expect(p.specifics).toEqual({ docs: { model: "a/docs" } })
  })
})

describe("commitProfile", () => {
  const profile: Profile = {
    heavy: { model: "a/b" },
    rest: { model: "a/c" },
    placements: {},
    specifics: {},
  }

  test("adds the profile and sets it active by default", () => {
    const next = commitProfile(makeFile(), { name: "new", profile })
    expect(next.profiles.new).toEqual(profile)
    expect(next.active).toBe("new")
  })

  test("setActive:false keeps the previous active", () => {
    const next = commitProfile(makeFile(), { name: "new", profile, setActive: false })
    expect(next.active).toBe("glm")
  })
})

describe("renameProfile", () => {
  test("moves the definition and fixes active", () => {
    const next = renameProfile(makeFile(), "glm", "zai")
    expect(next.profiles.glm).toBeUndefined()
    expect(next.profiles.zai).toBeDefined()
    expect(next.active).toBe("zai")
  })
  test("no-op for an unknown profile", () => {
    const file = makeFile()
    expect(renameProfile(file, "nope", "x")).toEqual(file)
  })
})

describe("deleteProfile", () => {
  test("removes the profile and clears active when it was active", () => {
    const next = deleteProfile(makeFile(), "glm")
    expect(next.profiles.glm).toBeUndefined()
    expect(next.active).toBe("")
  })
  test("keeps active when a different profile is deleted", () => {
    const file = makeFile({
      profiles: {
        glm,
        other: { heavy: { model: "d/e" }, rest: { model: "d/f" }, placements: {}, specifics: {} },
      },
    })
    expect(deleteProfile(file, "other").active).toBe("glm")
  })
})

describe("updateProfile", () => {
  test("replaces the whole profile (models, placements and specifics)", () => {
    const p: Profile = {
      heavy: { model: "x/y" },
      rest: { model: "x/z" },
      placements: { build: "rest", docs: "specific" },
      specifics: { docs: { model: "x/docs" } },
    }
    const next = updateProfile(makeFile(), "glm", p)
    expect(next.profiles.glm).toEqual(p)
  })
  test("no-op for an unknown profile", () => {
    const file = makeFile()
    expect(
      updateProfile(file, "nope", {
        heavy: { model: "a/b" },
        rest: { model: "a/c" },
        placements: {},
        specifics: {},
      }),
    ).toEqual(file)
  })
})
