import { describe, expect, test } from "bun:test"
import {
  formatProfileIndicator,
  INDICATOR_SEPARATOR,
  NARROW_WIDTH,
  shortModelName,
} from "../src/indicator.js"
import type { Profile } from "../src/schema.js"

const heavyProfile = (model: string): Profile => ({
  heavy: { model },
  rest: { model: "rest/model" },
  placements: {},
  specifics: {},
})

describe("shortModelName", () => {
  test("drops the provider segment of a provider/model string", () => {
    expect(shortModelName("zai/glm-5.2")).toBe("glm-5.2")
    expect(shortModelName("anthropic/claude-opus-5")).toBe("claude-opus-5")
  })

  test("returns a bare model id unchanged", () => {
    expect(shortModelName("glm-5.2")).toBe("glm-5.2")
  })

  test("trims surrounding whitespace", () => {
    expect(shortModelName("  zai/glm-5.2  ")).toBe("glm-5.2")
    expect(shortModelName("  ")).toBe("")
    expect(shortModelName("")).toBe("")
  })

  test("handles a malformed trailing slash as empty", () => {
    expect(shortModelName("zai/")).toBe("")
  })

  test("only splits on the last slash", () => {
    expect(shortModelName("a/b/glm-5.2")).toBe("glm-5.2")
  })
})

describe("formatProfileIndicator", () => {
  test("returns null when there is no active profile", () => {
    expect(formatProfileIndicator({ active: "", profile: undefined, width: 120 })).toBeNull()
  })

  test("returns null when the active name has no matching profile object", () => {
    expect(formatProfileIndicator({ active: "ghost", profile: undefined, width: 120 })).toBeNull()
  })

  test("renders the full hint on a wide terminal", () => {
    const out = formatProfileIndicator({
      active: "performance",
      profile: heavyProfile("zai/glm-5.2"),
      width: 120,
    })
    expect(out).toBe(`performance${INDICATOR_SEPARATOR}glm-5.2`)
  })

  test("uses the short heavy model even when stored without a provider", () => {
    expect(
      formatProfileIndicator({
        active: "fast",
        profile: heavyProfile("glm-4"),
        width: 100,
      }),
    ).toBe(`fast${INDICATOR_SEPARATOR}glm-4`)
  })

  test("collapses to just the name below NARROW_WIDTH", () => {
    expect(
      formatProfileIndicator({
        active: "performance",
        profile: heavyProfile("zai/glm-5.2"),
        width: NARROW_WIDTH - 1,
      }),
    ).toBe("performance")
  })

  test("renders the full hint exactly at NARROW_WIDTH", () => {
    expect(
      formatProfileIndicator({
        active: "performance",
        profile: heavyProfile("zai/glm-5.2"),
        width: NARROW_WIDTH,
      }),
    ).toBe(`performance${INDICATOR_SEPARATOR}glm-5.2`)
  })

  test("shows only the name when the heavy model is absent/invalid", () => {
    // A profile whose heavy.model is empty — defensive: the schema would not
    // normally allow this, but the indicator must never crash or show garbage.
    expect(
      formatProfileIndicator({
        active: "broken",
        profile: heavyProfile(""),
        width: 120,
      }),
    ).toBe("broken")
  })

  test("separator is the muted middle-dot form from the requirement", () => {
    expect(INDICATOR_SEPARATOR).toBe(" · ")
  })
})
