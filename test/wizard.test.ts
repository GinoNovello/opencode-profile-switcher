import { describe, expect, test } from "bun:test"
import type { AgentInfo } from "../src/agents.js"
import type { Profile, ProfilesFile } from "../src/schema.js"
import {
  buildAssignmentOptions,
  buildProfile,
  commitProfile,
  defaultAssignment,
  defaultPlacement,
  deleteProfile,
  nextPlacement,
  placementOf,
  renameProfile,
  setPlacement,
  updateProfileModels,
  validateProfileName,
} from "../src/wizard.js"

const agents: AgentInfo[] = [
  { name: "build", mode: "primary", hidden: false },
  { name: "plan", mode: "all", hidden: false },
  { name: "explore", mode: "subagent", hidden: false },
  { name: "summarizer", mode: "subagent", hidden: true },
]

function makeFile(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    assignment: { build: "heavy", explore: "rest" },
    exclusions: ["vision"],
    profiles: {
      glm: { heavy: { model: "zai/glm-5" }, rest: { model: "zai/glm-4" } },
    },
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

describe("defaultAssignment", () => {
  test("assigns every agent a tier per the defaults", () => {
    expect(defaultAssignment(agents)).toEqual({
      build: "heavy",
      plan: "heavy",
      explore: "rest",
      summarizer: "rest",
    })
  })
})

describe("placement editing", () => {
  const file = makeFile()

  test("placementOf reads assignment and exclusions", () => {
    expect(placementOf(file, "build")).toBe("heavy")
    expect(placementOf(file, "explore")).toBe("rest")
    expect(placementOf(file, "vision")).toBe("excluded")
    expect(placementOf(file, "unknown")).toBe("rest")
  })

  test("nextPlacement cycles heavy -> rest -> excluded -> heavy", () => {
    expect(nextPlacement("heavy")).toBe("rest")
    expect(nextPlacement("rest")).toBe("excluded")
    expect(nextPlacement("excluded")).toBe("heavy")
  })

  test("setPlacement to excluded moves the agent into exclusions", () => {
    const next = setPlacement(file, "build", "excluded")
    expect(next.assignment.build).toBeUndefined()
    expect(next.exclusions).toContain("build")
  })

  test("setPlacement to a tier removes it from exclusions", () => {
    const next = setPlacement(file, "vision", "heavy")
    expect(next.exclusions).not.toContain("vision")
    expect(next.assignment.vision).toBe("heavy")
  })

  test("setPlacement does not mutate the input", () => {
    setPlacement(file, "build", "excluded")
    expect(file.assignment.build).toBe("heavy")
    expect(file.exclusions).toEqual(["vision"])
  })
})

describe("buildAssignmentOptions", () => {
  test("one row per agent plus a Done row", () => {
    const options = buildAssignmentOptions(makeFile(), agents)
    expect(options).toHaveLength(agents.length + 1)
    expect(options.at(-1)?.value).toEqual({ kind: "done" })
    expect(options[0]).toMatchObject({ value: { kind: "agent", name: "build" }, description: "→ heavy" })
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
  test("includes a heavy variant when given", () => {
    expect(buildProfile("zai/glm-5", "zai/glm-4", "max")).toEqual({
      heavy: { model: "zai/glm-5", variant: "max" },
      rest: { model: "zai/glm-4" },
    })
  })
  test("omits the variant when empty", () => {
    const p = buildProfile("zai/glm-5", "zai/glm-4", "")
    expect(p.heavy).toEqual({ model: "zai/glm-5" })
  })
})

describe("commitProfile", () => {
  const profile: Profile = { heavy: { model: "a/b" }, rest: { model: "a/c" } }

  test("adds the profile, sets it active, keeps shared maps by default", () => {
    const file = makeFile()
    const next = commitProfile(file, { name: "new", profile })
    expect(next.profiles.new).toEqual(profile)
    expect(next.active).toBe("new")
    expect(next.assignment).toBe(file.assignment)
  })

  test("replaces shared maps when provided (first-run)", () => {
    const next = commitProfile(makeFile(), {
      name: "new",
      profile,
      assignment: { agent: "heavy" },
      exclusions: ["x"],
    })
    expect(next.assignment).toEqual({ agent: "heavy" })
    expect(next.exclusions).toEqual(["x"])
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
        glm: { heavy: { model: "a/b" }, rest: { model: "a/c" } },
        other: { heavy: { model: "d/e" }, rest: { model: "d/f" } },
      },
    })
    expect(deleteProfile(file, "other").active).toBe("glm")
  })
})

describe("updateProfileModels", () => {
  test("replaces the model slots", () => {
    const p: Profile = { heavy: { model: "x/y" }, rest: { model: "x/z" } }
    const next = updateProfileModels(makeFile(), "glm", p)
    expect(next.profiles.glm).toEqual(p)
  })
  test("no-op for an unknown profile", () => {
    const file = makeFile()
    expect(updateProfileModels(file, "nope", { heavy: { model: "a/b" }, rest: { model: "a/c" } })).toEqual(file)
  })
})
