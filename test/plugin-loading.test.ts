import { describe, expect, test } from "bun:test"

/**
 * Regression loop for the "`/profile` never appears in the `/` autocomplete" bug.
 *
 * Root cause: the plugin is loaded from the user's `opencode.jsonc` `plugin`
 * array as **absolute file paths** (`.../dist/server.js`, `.../dist/tui.js`).
 * When opencode loads a plugin whose spec is a path, the loader treats its
 * source as `"file"` and REQUIRES the module's default export to carry a
 * string `id`. Without it, `resolvePluginId` throws
 * `Path plugin ... must export id` and the plugin is silently dropped — so the
 * `tui()` entry never runs and `/profile` is never registered (and the
 * `server()` config hook never applies either).
 *
 * The three functions below are copied verbatim from opencode
 * `packages/opencode/src/plugin/shared.ts` at tag **v1.18.11** (the version the
 * user runs; identical in v1.18.10). Running our REAL built module through them,
 * simulating `source: "file"`, reproduces opencode's exact accept/drop decision
 * without needing a live TUI or a human watching the autocomplete.
 *
 * Upstream proof this is the real contract:
 *  - test "rejects v1 file server plugin without id"
 *    (packages/opencode/test/plugin/loader-shared.test.ts)
 *  - test "does not wait on permanent tui plugin startup failures" — a file-path
 *    tui plugin with `export default { tui }` (no id) is absent from
 *    `TuiPluginRuntime.list()` (packages/opencode/test/cli/tui/plugin-loader.test.ts)
 */

// --- verbatim from opencode shared.ts @ v1.18.11 ---------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type PluginKind = "server" | "tui"
type PluginMode = "strict" | "detect"
type PluginSource = "file" | "npm"

function readPluginId(id: unknown, spec: string) {
  if (id === undefined) return
  if (typeof id !== "string") throw new TypeError(`Plugin ${spec} has invalid id type ${typeof id}`)
  const value = id.trim()
  if (!value) throw new TypeError(`Plugin ${spec} has an empty id`)
  return value
}

function readV1Plugin(mod: Record<string, unknown>, spec: string, kind: PluginKind, mode: PluginMode = "strict") {
  const value = mod.default
  if (!isRecord(value)) {
    if (mode === "detect") return
    throw new TypeError(`Plugin ${spec} must default export an object with ${kind}()`)
  }
  if (mode === "detect" && !("id" in value) && !("server" in value) && !("tui" in value)) return

  const server = "server" in value ? value.server : undefined
  const tui = "tui" in value ? value.tui : undefined
  if (server !== undefined && typeof server !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid server export`)
  }
  if (tui !== undefined && typeof tui !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid tui export`)
  }
  if (server !== undefined && tui !== undefined) {
    throw new TypeError(`Plugin ${spec} must default export either server() or tui(), not both`)
  }
  if (kind === "server" && server === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with server()`)
  }
  if (kind === "tui" && tui === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with tui()`)
  }

  return value
}

// file-source branch of resolvePluginId (the npm branch is not reachable here)
function resolvePluginIdFile(source: PluginSource, spec: string, id: string | undefined) {
  if (source === "file") {
    if (id) return id
    throw new TypeError(`Path plugin ${spec} must export id`)
  }
  throw new Error("test only exercises the file source branch")
}

/**
 * Replays opencode's load pipeline for a plugin declared as an absolute file
 * path. Throws exactly where opencode would drop the plugin; returns the
 * resolved id on success.
 */
function loadAsFilePathPlugin(mod: Record<string, unknown>, spec: string, kind: PluginKind): string {
  const value = readV1Plugin(mod, spec, kind)!
  return resolvePluginIdFile("file", spec, readPluginId(value.id, spec))
}

// --- the loop --------------------------------------------------------------

describe("loading the built plugin from an absolute file path (as the user's opencode.jsonc does)", () => {
  test("the /tui entry survives opencode's file-path loader (registers /profile)", async () => {
    const mod = (await import("../src/tui.js")) as unknown as Record<string, unknown>
    expect(() =>
      loadAsFilePathPlugin(mod, "/abs/path/to/dist/tui.js", "tui"),
    ).not.toThrow()
  })

  test("the /server entry survives opencode's file-path loader (applies the profile)", async () => {
    const mod = (await import("../src/server.js")) as unknown as Record<string, unknown>
    expect(() =>
      loadAsFilePathPlugin(mod, "/abs/path/to/dist/server.js", "server"),
    ).not.toThrow()
  })
})
