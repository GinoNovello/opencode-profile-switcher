import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { defaultProfilesPath } from "../src/core/paths.js"

describe("defaultProfilesPath", () => {
  test("OPENCODE_PROFILES_PATH wins over everything", () => {
    const env = { OPENCODE_PROFILES_PATH: "/x/p.json", OPENCODE_CONFIG_DIR: "/cfg", XDG_CONFIG_HOME: "/xdg" }
    expect(defaultProfilesPath(env)).toBe("/x/p.json")
    expect(defaultProfilesPath(env, { configDir: true })).toBe("/x/p.json")
  })

  test("ignores OPENCODE_CONFIG_DIR by default (1.x behaviour)", () => {
    expect(defaultProfilesPath({ OPENCODE_CONFIG_DIR: "/cfg", XDG_CONFIG_HOME: "/xdg" })).toBe(
      join("/xdg", "opencode", "profiles.json"),
    )
  })

  test("honours OPENCODE_CONFIG_DIR when asked (2.0 adapter)", () => {
    const env = { OPENCODE_CONFIG_DIR: "/cfg", XDG_CONFIG_HOME: "/xdg" }
    expect(defaultProfilesPath(env, { configDir: true })).toBe(join("/cfg", "profiles.json"))
  })

  test("falls back to XDG, then ~/.config", () => {
    expect(defaultProfilesPath({ XDG_CONFIG_HOME: "/xdg" }, { configDir: true })).toBe(
      join("/xdg", "opencode", "profiles.json"),
    )
    expect(defaultProfilesPath({ OPENCODE_CONFIG_DIR: "" }, { configDir: true })).toBe(
      join(homedir(), ".config", "opencode", "profiles.json"),
    )
  })
})
