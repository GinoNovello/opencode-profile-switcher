import { describe, expect, test } from "bun:test"
import { emptyProfilesFile, profilesFileSchema } from "../src/schema.js"

describe("profilesFileSchema", () => {
  test("parses a fully valid file", () => {
    const input = {
      assignment: { build: "heavy", explore: "rest" },
      exclusions: ["vision"],
      profiles: {
        glm: {
          heavy: { model: "zai-coding-plan/glm-5.2", variant: "max" },
          rest: { model: "zai-coding-plan/glm-4.7" },
        },
      },
      active: "glm",
    }
    const parsed = profilesFileSchema.parse(input)
    expect(parsed.assignment.build).toBe("heavy")
    expect(parsed.profiles.glm.heavy.variant).toBe("max")
    expect(parsed.active).toBe("glm")
  })

  test("fills defaults for a partial file", () => {
    const parsed = profilesFileSchema.parse({ active: "x" })
    expect(parsed.assignment).toEqual({})
    expect(parsed.exclusions).toEqual([])
    expect(parsed.profiles).toEqual({})
    expect(parsed.active).toBe("x")
  })

  test("parses an empty object into empty state", () => {
    expect(profilesFileSchema.parse({})).toEqual(emptyProfilesFile())
  })

  test("rejects an invalid tier value in assignment", () => {
    const result = profilesFileSchema.safeParse({ assignment: { build: "medium" } })
    expect(result.success).toBe(false)
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
