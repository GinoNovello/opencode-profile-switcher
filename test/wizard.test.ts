import { describe, expect, test } from "bun:test"
import type { AgentInfo } from "../src/agents.js"
import type { Placement, Profile, ProfilesFile } from "../src/schema.js"
import {
  buildPlacementOptions,
  buildProfile,
  commitProfile,
  copyPlacements,
  defaultPlacement,
  defaultPlacements,
  deleteProfile,
  nextPlacement,
  placementOf,
  renameProfile,
  setPlacement,
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
  placements: { build: "heavy", explore: "rest", vision: "excluded" },
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
  const placements: Record<string, Placement> = { build: "heavy", explore: "rest", vision: "excluded" }

  test("placementOf reads placements, defaulting absent agents to rest", () => {
    expect(placementOf(placements, "build")).toBe("heavy")
    expect(placementOf(placements, "explore")).toBe("rest")
    expect(placementOf(placements, "vision")).toBe("excluded")
    expect(placementOf(placements, "unknown")).toBe("rest")
  })

  test("nextPlacement cycles heavy -> rest -> excluded -> heavy", () => {
    expect(nextPlacement("heavy")).toBe("rest")
    expect(nextPlacement("rest")).toBe("excluded")
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

describe("copyPlacements", () => {
  test("copies a profile's placements, including exclusions", () => {
    expect(copyPlacements(glm)).toEqual({ build: "heavy", explore: "rest", vision: "excluded" })
  })
  test("returns a detached copy", () => {
    const copy = copyPlacements(glm)
    copy.build = "rest"
    expect(glm.placements.build).toBe("heavy")
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

describe("validateProfileName", () => {
  test("rejects empty", () => expect(validateProfileName("  ", []).ok).toBe(false))
  test("rejects a duplicate", () => expect(validateProfileName("glm", ["glm"]).ok).toBe(false))
  test("allows renaming to the same name (self)", () =>
    expect(validateProfileName("glm", ["glm"], "glm").ok).toBe(true))
  test("accepts a fresh name", () => expect(validateProfileName("new", ["glm"]).ok).toBe(true))
})

describe("buildProfile", () => {
  test("assembles models and placements, with a heavy variant when given", () => {
    const placements: Record<string, Placement> = { build: "heavy" }
    expect(buildProfile("zai/glm-5", "zai/glm-4", placements, "max")).toEqual({
      heavy: { model: "zai/glm-5", variant: "max" },
      rest: { model: "zai/glm-4" },
      placements: { build: "heavy" },
    })
  })
  test("omits the variant when empty and defaults placements to empty", () => {
    const p = buildProfile("zai/glm-5", "zai/glm-4", {}, "")
    expect(p.heavy).toEqual({ model: "zai/glm-5" })
    expect(p.placements).toEqual({})
  })
})

describe("commitProfile", () => {
  const profile: Profile = { heavy: { model: "a/b" }, rest: { model: "a/c" }, placements: {} }

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
        other: { heavy: { model: "d/e" }, rest: { model: "d/f" }, placements: {} },
      },
    })
    expect(deleteProfile(file, "other").active).toBe("glm")
  })
})

describe("updateProfile", () => {
  test("replaces the whole profile (models and placements)", () => {
    const p: Profile = { heavy: { model: "x/y" }, rest: { model: "x/z" }, placements: { build: "rest" } }
    const next = updateProfile(makeFile(), "glm", p)
    expect(next.profiles.glm).toEqual(p)
  })
  test("no-op for an unknown profile", () => {
    const file = makeFile()
    expect(
      updateProfile(file, "nope", { heavy: { model: "a/b" }, rest: { model: "a/c" }, placements: {} }),
    ).toEqual(file)
  })
})
