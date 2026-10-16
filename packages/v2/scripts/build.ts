// Build the publishable package into `dist/`.
//
// The adapter imports the shared core from `../../src/core` (ADR-0004: one
// repo, one core), which is outside this package, so `tsc` cannot emit it into
// a self-contained `dist/`. Instead:
// - JS: Bun bundles each entry with the core inlined. `@opencode/plugin` stays
//   external (the host hands plugins its own instance) and so does `zod` (a
//   regular dependency).
// - Types: `tsc` emits declarations for the entries only, and the build fails
//   if one of them reaches for a file that is not shipped.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const dist = join(root, "dist")
const entries = ["server", "rpc", "tui"]

rmSync(dist, { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: entries.map((name) => join(root, "src", `${name}.ts`)),
  outdir: dist,
  target: "node",
  format: "esm",
  external: ["@opencode/plugin", "zod", "@opentui/core", "@opentui/solid", "solid-js"],
  sourcemap: "linked",
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const types = mkdtempSync(join(tmpdir(), "profile-switcher-v2-types-"))
try {
  const tsc = Bun.spawnSync(
    [
      "bunx",
      "tsc",
      "--declaration",
      "--emitDeclarationOnly",
      "--skipLibCheck",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--verbatimModuleSyntax",
      "--types",
      "node",
      "--rootDir",
      resolve(root, "..", ".."),
      "--outDir",
      types,
      ...entries.map((name) => join(root, "src", `${name}.ts`)),
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  )
  if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1)

  for (const name of entries) {
    const declaration = readFileSync(join(types, "packages", "v2", "src", `${name}.d.ts`), "utf8")
    const local = [...declaration.matchAll(/from\s+["'](\.[^"']*)["']/g)].map((match) => match[1])
    if (local.length > 0) {
      console.error(`${name}.d.ts imports unshipped files: ${local.join(", ")}`)
      process.exit(1)
    }
    writeFileSync(join(dist, `${name}.d.ts`), declaration)
  }
} finally {
  rmSync(types, { recursive: true, force: true })
}

console.log(`built ${result.outputs.map((output) => output.path.slice(root.length + 1)).join(", ")}`)
