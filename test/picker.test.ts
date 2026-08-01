import { describe, expect, test } from "bun:test"
import {
  buildPickerOptions,
  describeProfile,
  formatAlreadyActiveToast,
  formatSwitchToast,
  orderedProfileNames,
  shortModel,
  switchResultToast,
} from "../src/picker.js"
import type { Profile, ProfilesFile } from "../src/schema.js"

const glm: Profile = { heavy: { model: "zai/glm-5", variant: "max" }, rest: { model: "zai/glm-4" } }
const claude: Profile = { heavy: { model: "anthropic/opus" }, rest: { model: "anthropic/haiku" } }

function makeFile(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    assignment: {},
    exclusions: [],
    profiles: { glm, claude },
    active: "glm",
    ...overrides,
  }
}

describe("shortModel", () => {
  test("strips the provider prefix", () => {
    expect(shortModel("zai/glm-5")).toBe("glm-5")
  })
  test("leaves an unprefixed model untouched", () => {
    expect(shortModel("glm-5")).toBe("glm-5")
  })
})

describe("describeProfile", () => {
  test("includes the heavy variant in parentheses", () => {
    expect(describeProfile(glm)).toBe("heavy: glm-5 (max) · rest: glm-4")
  })
  test("omits the variant when absent", () => {
    expect(describeProfile(claude)).toBe("heavy: opus · rest: haiku")
  })
})

describe("orderedProfileNames", () => {
  test("puts the active profile first", () => {
    expect(orderedProfileNames(makeFile({ active: "glm" }))).toEqual(["glm", "claude"])
  })
  test("alphabetical when active is unknown", () => {
    expect(orderedProfileNames(makeFile({ active: "" }))).toEqual(["claude", "glm"])
  })
})

describe("buildPickerOptions", () => {
  test("marks the active profile and lists both actions last", () => {
    const options = buildPickerOptions(makeFile())
    expect(options).toHaveLength(4)
    expect(options[0]?.title).toBe("● glm")
    expect(options[0]?.description).toBe("heavy: glm-5 (max) · rest: glm-4")
    expect(options[1]?.title).toBe("  claude")
    expect(options[2]?.value).toEqual({ kind: "new" })
    expect(options[3]?.value).toEqual({ kind: "configure" })
  })

  test("empty file still offers the two actions", () => {
    const options = buildPickerOptions(makeFile({ profiles: {}, active: "" }))
    expect(options.map((o) => o.value)).toEqual([{ kind: "new" }, { kind: "configure" }])
  })
})

describe("switch toasts", () => {
  test("formatSwitchToast summarizes the applied profile", () => {
    expect(formatSwitchToast("glm", glm)).toBe('Profile "glm" active — heavy: glm-5 (max) · rest: glm-4')
  })
  test("formatAlreadyActiveToast", () => {
    expect(formatAlreadyActiveToast("glm")).toBe('Profile "glm" is already active')
  })

  test("switchResultToast: success", () => {
    const t = switchResultToast("glm", glm, { ok: true, active: "glm", disposed: true })
    expect(t.variant).toBe("success")
    expect(t.message).toContain('Profile "glm" active')
  })
  test("switchResultToast: persisted but reload failed -> warning to restart", () => {
    const t = switchResultToast("glm", glm, { ok: true, active: "glm", disposed: false, error: "boom" })
    expect(t.variant).toBe("warning")
    expect(t.message).toContain("restart opencode")
  })
  test("switchResultToast: hard failure -> error", () => {
    const t = switchResultToast("glm", glm, { ok: false, disposed: false, error: "unknown profile" })
    expect(t.variant).toBe("error")
    expect(t.message).toContain("unknown profile")
  })
})
