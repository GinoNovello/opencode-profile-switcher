import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { defaultProfilesPath } from "./paths.js"
import {
  emptyProfilesFile,
  profilesFileSchema,
  type EffectiveSlot,
  type ProfilesFile,
} from "./schema.js"

/**
 * Outcome of reading `profiles.json`:
 * - `ok`      — file present and valid.
 * - `missing` — file does not exist (or is unreadable); a fresh empty state is returned.
 * - `invalid` — file exists but is not valid JSON / fails the schema; an empty
 *               state is returned so the caller never crashes, plus `error`.
 */
export type ReadStatus = "ok" | "missing" | "invalid"

export interface ReadResult {
  status: ReadStatus
  profiles: ProfilesFile
  path: string
  /** Human-readable reason present when `status` is `missing` or `invalid`. */
  error?: string
}

/**
 * Read and validate `profiles.json`. Never throws: a missing or corrupt file
 * resolves to an empty (but valid) profiles state plus a status signal, so the
 * `config` hook can no-op gracefully instead of breaking the boot.
 */
export function readProfiles(path: string = defaultProfilesPath()): ReadResult {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    return {
      status: "missing",
      profiles: emptyProfilesFile(),
      path,
      error: (error as Error).message,
    }
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (error) {
    return {
      status: "invalid",
      profiles: emptyProfilesFile(),
      path,
      error: `invalid JSON: ${(error as Error).message}`,
    }
  }

  const parsed = profilesFileSchema.safeParse(json)
  if (!parsed.success) {
    return {
      status: "invalid",
      profiles: emptyProfilesFile(),
      path,
      error: `schema validation failed: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    }
  }

  return { status: "ok", profiles: parsed.data, path }
}

/**
 * Persist a profiles file. Validates before writing and creates the parent
 * directory if needed. Output is pretty-printed and newline-terminated so the
 * file stays hand-editable and diff-friendly.
 */
export function writeProfiles(profiles: ProfilesFile, path: string = defaultProfilesPath()): void {
  const data = profilesFileSchema.parse(profiles)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

/**
 * Set the active profile and persist it, preserving all other content.
 *
 * Refuses to write when the existing file is corrupt (`status: "invalid"`) so a
 * transient hand-edit mistake is never clobbered — the caller gets the error
 * back instead.
 */
export function setActiveProfile(name: string, path: string = defaultProfilesPath()): ReadResult {
  const current = readProfiles(path)
  if (current.status === "invalid") return current

  const next: ProfilesFile = { ...current.profiles, active: name }
  writeProfiles(next, path)
  return { status: "ok", profiles: next, path }
}

/**
 * Persist the plugin's per-agent effective model/variant map, preserving
 * profiles and the active name.
 *
 * Refuses to write when the existing file is corrupt (`status: "invalid"`) so
 * effective-state bookkeeping never clobbers a hand-edit mistake or leaves a
 * half-applied profiles file.
 */
export function writeEffectiveState(
  effective: Record<string, EffectiveSlot>,
  path: string = defaultProfilesPath(),
): ReadResult {
  const current = readProfiles(path)
  if (current.status === "invalid") return current

  const next: ProfilesFile = { ...current.profiles, effective }
  writeProfiles(next, path)
  return { status: "ok", profiles: next, path }
}
