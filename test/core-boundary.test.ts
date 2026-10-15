import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

/**
 * `src/core/` is shared by every host adapter (1.x today, 2.0 as a sibling
 * package — see ADR-0004), so it must never depend on a host. A core module
 * may import other core modules and host-neutral packages (`zod`, `node:*`),
 * but not opencode's plugin/SDK, OpenTUI or Solid — neither directly nor by
 * reaching into an adapter such as `src/v1/`.
 */

const CORE = resolve(import.meta.dir, "..", "src", "core")
const FORBIDDEN = ["@opencode-ai/", "@opentui/", "solid-js"]

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

function isForbiddenPackage(specifier: string): boolean {
  return FORBIDDEN.some((prefix) => specifier === prefix.replace(/\/$/, "") || specifier.startsWith(prefix))
}

function escapesCore(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false
  const target = relative(CORE, resolve(dirname(file), specifier))
  return target.startsWith("..") || target.startsWith(sep)
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

  test("detects forbidden specifiers", () => {
    const sample = [
      'import type { Plugin } from "@opencode-ai/plugin"',
      'import { jsx } from "@opentui/solid/jsx-runtime"',
      "import { createSignal } from 'solid-js'",
      'export * from "../v1/agents.js"',
      'const tui = await import("../v1/tui.js")',
    ].join("\n")
    const fake = join(CORE, "fake.ts")
    const bad = specifiers(sample).filter(
      (specifier) => isForbiddenPackage(specifier) || escapesCore(fake, specifier),
    )
    expect(bad).toHaveLength(5)
  })

  for (const file of files) {
    test(`${relative(CORE, file)} imports no host module`, () => {
      const offending = specifiers(readFileSync(file, "utf8")).filter(
        (specifier) => isForbiddenPackage(specifier) || escapesCore(file, specifier),
      )
      expect(offending).toEqual([])
    })
  }
})
