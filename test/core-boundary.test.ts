import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

/**
 * `src/core/` is shared by every host adapter (1.x today, 2.0 as a sibling
 * package — see ADR-0004), so it must never depend on a host. A core module
 * may only import other core modules and the host-neutral packages listed in
 * `ALLOWED_PACKAGES` (plus `node:*` built-ins). Anything else — opencode's
 * plugin/SDK, OpenTUI, Solid, an adapter such as `src/v1/`, or a package added
 * later — fails here until it is deliberately allowed.
 */

const CORE = resolve(import.meta.dir, "..", "src", "core")
const ALLOWED_PACKAGES = ["zod"]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : []
  })
}

/** Every module specifier a file references: static, re-export and dynamic. */
function specifiers(source: string): string[] {
  const found: string[] = []
  const patterns = [
    /\b(?:import|export)\b[^'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!)
  }
  return found
}

/** Whether `file` (inside `src/core/`) may import `specifier`. */
function isAllowed(file: string, specifier: string): boolean {
  if (specifier.startsWith(".")) {
    return !relative(CORE, resolve(dirname(file), specifier)).startsWith("..")
  }
  if (specifier.startsWith("node:")) return true
  return ALLOWED_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`))
}

describe("src/core boundary", () => {
  const files = sourceFiles(CORE)

  test("finds the core modules and their imports", () => {
    expect(files.length).toBeGreaterThan(0)
    const all = files.flatMap((file) => specifiers(readFileSync(file, "utf8")))
    // Guards against a regex that silently matches nothing.
    expect(all).toContain("zod")
    expect(all).toContain("./schema.js")
  })

  test("rejects host packages, adapters and unlisted packages", () => {
    const sample = [
      'import type { Plugin } from "@opencode-ai/plugin"',
      'import { jsx } from "@opentui/solid/jsx-runtime"',
      "import { createSignal } from 'solid-js'",
      'export * from "../v1/agents.js"',
      'const tui = await import("../v1/tui.js")',
      'import { something } from "some-new-host-sdk"',
      'import { zodish } from "zod-extra"',
    ].join("\n")
    const fake = join(CORE, "fake.ts")
    const rejected = specifiers(sample).filter((specifier) => !isAllowed(fake, specifier))
    expect(rejected).toHaveLength(7)
  })

  test("accepts core-relative imports, node built-ins and allowed packages", () => {
    const sample = [
      'import { z } from "zod"',
      'import { readFileSync } from "node:fs"',
      'import type { Profile } from "./schema.js"',
      'export * from "./nested/../picker.js"',
    ].join("\n")
    const fake = join(CORE, "fake.ts")
    const rejected = specifiers(sample).filter((specifier) => !isAllowed(fake, specifier))
    expect(rejected).toEqual([])
  })

  for (const file of files) {
    test(`${relative(CORE, file)} imports only core modules and allowed packages`, () => {
      const offending = specifiers(readFileSync(file, "utf8")).filter(
        (specifier) => !isAllowed(file, specifier),
      )
      expect(offending).toEqual([])
    })
  }
})
