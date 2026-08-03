import { describe, expect, test } from "bun:test"
import { emptyProfilesFile, profilesFileSchema } from "../src/schema.js"

describe("profilesFileSchema", () => {
  test("parses a fully valid file", () => {
    const input = {
      profiles: {
        glm: {
          heavy: { model: "zai-coding-plan/glm-5.2", variant: "max" },
          rest: { model: "zai-coding-plan/glm-4.7" },
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
    }
    const parsed = profilesFileSchema.parse(input)
    expect(parsed.profiles.glm.placements.build).toBe("heavy")
    expect(parsed.profiles.glm.placements.vision).toBe("excluded")
    expect(parsed.profiles.glm.placements.docs).toBe("specific")
    expect(parsed.profiles.glm.specifics.docs).toEqual({
      model: "anthropic/claude-docs",
      variant: "high",
    })
    expect(parsed.profiles.glm.heavy.variant).toBe("max")
    expect(parsed.active).toBe("glm")
  })

  test("fills defaults for a partial file", () => {
    const parsed = profilesFileSchema.parse({ active: "x" })
    expect(parsed.profiles).toEqual({})
    expect(parsed.active).toBe("x")
    expect(parsed.effective).toEqual({})
  })

  test("parses persisted effective agent state", () => {
    const parsed = profilesFileSchema.parse({
      profiles: {
        p: { heavy: { model: "a/b" }, rest: { model: "a/c" }, placements: {}, specifics: {} },
      },
      active: "p",
      effective: {
        build: { model: "a/b", variant: "max" },
        explore: { model: "a/c" },
      },
    })
    expect(parsed.effective.build).toEqual({ model: "a/b", variant: "max" })
    expect(parsed.effective.explore).toEqual({ model: "a/c" })
  })

  test("defaults effective to an empty map", () => {
    const parsed = profilesFileSchema.parse({
      profiles: { p: { heavy: { model: "a/b" }, rest: { model: "a/c" } } },
      active: "p",
    })
    expect(parsed.effective).toEqual({})
  })

  test("rejects an effective slot with an empty model", () => {
    const result = profilesFileSchema.safeParse({
      profiles: { p: { heavy: { model: "a/b" }, rest: { model: "a/c" } } },
      effective: { build: { model: "" } },
    })
    expect(result.success).toBe(false)
  })

  test("defaults placements and specifics to empty maps on a profile", () => {
    const parsed = profilesFileSchema.parse({
      profiles: { p: { heavy: { model: "a/b" }, rest: { model: "a/c" } } },
    })
    expect(parsed.profiles.p.placements).toEqual({})
    expect(parsed.profiles.p.specifics).toEqual({})
  })

  test("parses an empty object into empty state", () => {
    expect(profilesFileSchema.parse({})).toEqual(emptyProfilesFile())
  })

  test("rejects an invalid placement value", () => {
    const result = profilesFileSchema.safeParse({
      profiles: { p: { heavy: { model: "a/b" }, rest: { model: "a/c" }, placements: { build: "medium" } } },
    })
    expect(result.success).toBe(false)
  })

  test("rejects a specific placement without a model slot", () => {
    const result = profilesFileSchema.safeParse({
      profiles: {
        p: {
          heavy: { model: "a/b" },
          rest: { model: "a/c" },
          placements: { docs: "specific" },
          specifics: {},
        },
      },
    })
    expect(result.success).toBe(false)
  })

  test("rejects a specific placement with an empty model string", () => {
    const result = profilesFileSchema.safeParse({
      profiles: {
        p: {
          heavy: { model: "a/b" },
          rest: { model: "a/c" },
          placements: { docs: "specific" },
          specifics: { docs: { model: "" } },
        },
      },
    })
    expect(result.success).toBe(false)
  })

  test("rejects an orphan specific model without a specific placement", () => {
    const result = profilesFileSchema.safeParse({
      profiles: {
        p: {
          heavy: { model: "a/b" },
          rest: { model: "a/c" },
          placements: { docs: "rest" },
          specifics: { docs: { model: "a/docs" } },
        },
      },
    })
    expect(result.success).toBe(false)
  })

  test("accepts a specific slot without a variant", () => {
    const parsed = profilesFileSchema.parse({
      profiles: {
        p: {
          heavy: { model: "a/b" },
          rest: { model: "a/c" },
          placements: { docs: "specific" },
          specifics: { docs: { model: "a/docs" } },
        },
      },
    })
    expect(parsed.profiles.p.specifics.docs).toEqual({ model: "a/docs" })
  })

  test("rejects a profile missing a tier model", () => {
    const result = profilesFileSchema.safeParse({
      profiles: { p: { heavy: {}, rest: { model: "a/b" } } },
    })
    expect(result.success).toBe(false)
  })

  test("rejects an empty model string", () => {
    const result = profilesFileSchema.safeParse({
      profiles: { p: { heavy: { model: "" }, rest: { model: "a/b" } } },
    })
    expect(result.success).toBe(false)
  })

  test("rejects a non-object", () => {
    expect(profilesFileSchema.safeParse("nope").success).toBe(false)
    expect(profilesFileSchema.safeParse([]).success).toBe(false)
  })
})
