import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readProfiles,
  setActiveProfile,
  writeEffectiveState,
  writeProfiles,
} from "../src/config.js"
import { applyProfile, type MutableConfig } from "../src/apply.js"
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
  effective: {
    build: { model: "zai/glm-5", variant: "max" },
    explore: { model: "zai/glm-4" },
  },
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
    expect(result.profiles).toEqual({ profiles: {}, active: "", effective: {} })
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

  test("preserves effective state when changing active", () => {
    writeProfiles(sample, path)
    setActiveProfile("grok", path)
    expect(readProfiles(path).profiles.effective).toEqual(sample.effective)
  })

  test("does not touch the real HOME config path", () => {
    // Guard: tests only ever use temp paths.
    expect(path.startsWith(tmpdir())).toBe(true)
  })
})

describe("writeEffectiveState", () => {
  test("persists effective agent state without changing active or profiles", () => {
    writeProfiles(sample, path)
    const next = {
      build: { model: "xai/grok-heavy" },
      vision: { model: "anthropic/claude-vision", variant: "high" },
    }
    const result = writeEffectiveState(next, path)
    expect(result.status).toBe("ok")
    const read = readProfiles(path)
    expect(read.profiles.effective).toEqual(next)
    expect(read.profiles.active).toBe("glm")
    expect(read.profiles.profiles.glm.heavy.model).toBe("zai/glm-5")
  })

  test("refuses to clobber a corrupt file when writing effective state", () => {
    const p = join(dir, "corrupt-eff.json")
    writeFileSync(p, "{{{", "utf8")
    const result = writeEffectiveState({ build: { model: "a/b" } }, p)
    expect(result.status).toBe("invalid")
    expect(readProfiles(p).status).toBe("invalid")
  })
})

describe("migration from the 0.1.2 format", () => {
  /** A profiles.json exactly as released 0.1.2 wrote it. */
  const legacy = {
    assignment: { build: "heavy", explore: "rest", plan: "heavy" },
    exclusions: ["vision"],
    profiles: {
      xai: {
        heavy: { model: "xai/grok-4.5", variant: "high" },
        rest: { model: "xai/grok-mini" },
      },
      zai: {
        heavy: { model: "zai/glm-5" },
        rest: { model: "zai/glm-4" },
      },
    },
    active: "xai",
  }

  function writeLegacy(name = "legacy.json"): string {
    const p = join(dir, name)
    writeFileSync(p, JSON.stringify(legacy, null, 2), "utf8")
    return p
  }

  test("copies the shared assignment into every profile's placements", () => {
    const result = readProfiles(writeLegacy())
    expect(result.status).toBe("ok")
    expect(result.profiles.profiles.xai.placements).toEqual({
      build: "heavy",
      explore: "rest",
      plan: "heavy",
      vision: "excluded",
    })
    expect(result.profiles.profiles.zai.placements).toEqual({
      build: "heavy",
      explore: "rest",
      plan: "heavy",
      vision: "excluded",
    })
  })

  test("preserves profile names, tier models, variants and the active profile", () => {
    const result = readProfiles(writeLegacy())
    expect(Object.keys(result.profiles.profiles).sort()).toEqual(["xai", "zai"])
    expect(result.profiles.profiles.xai.heavy).toEqual({ model: "xai/grok-4.5", variant: "high" })
    expect(result.profiles.profiles.xai.rest).toEqual({ model: "xai/grok-mini" })
    expect(result.profiles.profiles.zai.heavy).toEqual({ model: "zai/glm-5" })
    expect(result.profiles.active).toBe("xai")
    expect(result.migrated).toBe(true)
  })

  test("invents no specific placements and no prior effective state", () => {
    const result = readProfiles(writeLegacy())
    for (const profile of Object.values(result.profiles.profiles)) {
      expect(profile.specifics).toEqual({})
      expect(Object.values(profile.placements)).not.toContain("specific")
    }
    expect(result.profiles.effective).toEqual({})
  })

  test("a migrated profile is immediately applicable with the new behavior", () => {
    const migrated = readProfiles(writeLegacy()).profiles
    const cfg: MutableConfig = { agent: { vision: { model: "anthropic/claude-vision" } } }

    const result = applyProfile(cfg, migrated)

    expect(result.applied).toBe(true)
    expect(cfg.model).toBe("xai/grok-4.5")
    expect(cfg.small_model).toBe("xai/grok-mini")
    expect(cfg.agent?.build).toEqual({ model: "xai/grok-4.5", variant: "high" })
    expect(cfg.agent?.explore).toEqual({ model: "xai/grok-mini" })
    // Excluded with no plugin history: its original opencode config survives.
    expect(cfg.agent?.vision).toEqual({ model: "anthropic/claude-vision" })
  })

  test("reading alone never rewrites the file on disk", () => {
    const p = writeLegacy()
    const before = readFileSync(p, "utf8")
    readProfiles(p)
    expect(readFileSync(p, "utf8")).toBe(before)
  })

  test("the next successful save persists only the current format", () => {
    const p = writeLegacy()
    // A switch is the ordinary first write after an upgrade.
    setActiveProfile("zai", p)

    const onDisk = JSON.parse(readFileSync(p, "utf8"))
    expect(onDisk).not.toHaveProperty("assignment")
    expect(onDisk).not.toHaveProperty("exclusions")
    expect(onDisk.active).toBe("zai")
    expect(onDisk.profiles.xai.placements.vision).toBe("excluded")
    expect(onDisk.effective).toEqual({})
  })

  test("migration is idempotent — re-reading the saved file changes nothing", () => {
    const p = writeLegacy()
    const migrated = readProfiles(p).profiles
    writeProfiles(migrated, p)

    const reread = readProfiles(p)
    expect(reread.status).toBe("ok")
    expect(reread.migrated).toBeUndefined()
    expect(reread.profiles).toEqual(migrated)
  })

  test("a malformed 0.1.2 file stays invalid and is left untouched", () => {
    const p = join(dir, "bad-legacy.json")
    const broken = JSON.stringify({
      assignment: { build: "nonsense-tier" },
      profiles: { xai: { heavy: { model: "xai/grok" }, rest: { model: "xai/mini" } } },
      active: "xai",
    })
    writeFileSync(p, broken, "utf8")

    expect(readProfiles(p).status).toBe("invalid")
    expect(setActiveProfile("xai", p).status).toBe("invalid")
    expect(readFileSync(p, "utf8")).toBe(broken)
  })
})
