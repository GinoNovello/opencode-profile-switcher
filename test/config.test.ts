import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readProfiles, setActiveProfile, writeProfiles } from "../src/config.js"
import type { ProfilesFile } from "../src/schema.js"

let dir: string
let path: string

const sample: ProfilesFile = {
  profiles: {
    glm: {
      heavy: { model: "zai/glm-5", variant: "max" },
      rest: { model: "zai/glm-4" },
      placements: { build: "heavy", explore: "rest", vision: "excluded", docs: "specific" },
      specifics: { docs: { model: "anthropic/claude-docs", variant: "high" } },
    },
    grok: {
      heavy: { model: "xai/grok-heavy" },
      rest: { model: "xai/grok-mini" },
      placements: { build: "heavy" },
      specifics: {},
    },
  },
  active: "glm",
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "profiles-test-"))
  path = join(dir, "nested", "profiles.json")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("readProfiles", () => {
  test("missing file returns empty state with signal", () => {
    const result = readProfiles(path)
    expect(result.status).toBe("missing")
    expect(result.profiles).toEqual({ profiles: {}, active: "" })
    expect(result.error).toBeDefined()
  })

  test("corrupt JSON returns invalid + empty state, does not throw", () => {
    writeFileSync(path.replace("/nested", ""), "{ not json ", "utf8")
    const result = readProfiles(path.replace("/nested", ""))
    expect(result.status).toBe("invalid")
    expect(result.profiles.active).toBe("")
    expect(result.error).toContain("invalid JSON")
  })

  test("schema-invalid content returns invalid", () => {
    const p = join(dir, "bad.json")
    writeFileSync(p, JSON.stringify({ profiles: { glm: { heavy: {}, rest: { model: "a/b" } } } }), "utf8")
    const result = readProfiles(p)
    expect(result.status).toBe("invalid")
    expect(result.error).toContain("schema validation failed")
  })

  test("valid file round-trips through write then read", () => {
    writeProfiles(sample, path)
    const result = readProfiles(path)
    expect(result.status).toBe("ok")
    expect(result.profiles).toEqual(sample)
  })
})

describe("setActiveProfile", () => {
  test("updates active while preserving other content", () => {
    writeProfiles(sample, path)
    const result = setActiveProfile("grok", path)
    expect(result.status).toBe("ok")
    expect(result.profiles.active).toBe("grok")
    // persisted
    expect(readProfiles(path).profiles.active).toBe("grok")
    // other content intact
    expect(readProfiles(path).profiles.profiles.glm.heavy.model).toBe("zai/glm-5")
  })

  test("refuses to clobber a corrupt file", () => {
    const p = join(dir, "corrupt.json")
    writeFileSync(p, "{{{", "utf8")
    const result = setActiveProfile("glm", p)
    expect(result.status).toBe("invalid")
    // file left untouched
    expect(readProfiles(p).status).toBe("invalid")
  })

  test("does not touch the real HOME config path", () => {
    // Guard: tests only ever use temp paths.
    expect(path.startsWith(tmpdir())).toBe(true)
  })
})
