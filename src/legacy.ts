import { z } from "zod"
import {
  heavyTierSchema,
  restTierSchema,
  TIERS,
  type Placement,
  type Profile,
  type ProfilesFile,
} from "./schema.js"

/**
 * Everything needed to read the `0.1.2` on-disk format and nothing else. Kept
 * in one file so that dropping support for it later is a single deletion (plus
 * the branch in `readProfiles`).
 */

/**
 * The on-disk shape written by `0.1.2`, kept only to migrate it. Back then
 * placements lived in a single top-level `assignment` + `exclusions` pair
 * shared by every profile, and a profile was just its two tier models.
 */
export const legacyProfileSchema = z.object({
  heavy: heavyTierSchema,
  rest: restTierSchema,
})

export const legacyProfilesFileSchema = z.object({
  assignment: z.record(z.string(), z.enum(TIERS)).default({}),
  exclusions: z.array(z.string()).default([]),
  profiles: z.record(z.string(), legacyProfileSchema).default({}),
  active: z.string().default(""),
})

export type LegacyProfilesFile = z.infer<typeof legacyProfilesFileSchema>

/**
 * True when `json` is a `0.1.2` profiles file. A current-format file has
 * neither key, and a `0.1.2` file would otherwise parse cleanly against the
 * current schema — silently dropping the user's shared placements — so this
 * check has to run *before* the current schema gets a look at the data.
 */
export function isLegacyProfilesFile(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false
  return "assignment" in json || "exclusions" in json
}

/**
 * Translate a `0.1.2` file into the current shape: the one shared assignment
 * and exclusion list are copied into *every* profile, since back then all
 * profiles observed the same placements.
 *
 * Deliberately conservative — it invents nothing. No agent becomes `specific`
 * (that placement did not exist in `0.1.2`), and `effective` starts empty
 * because no plugin-applied model history was ever recorded.
 */
export function migrateLegacyProfilesFile(legacy: LegacyProfilesFile): ProfilesFile {
  const placements: Record<string, Placement> = { ...legacy.assignment }
  for (const agent of legacy.exclusions) placements[agent] = "excluded"

  const profiles: Record<string, Profile> = {}
  for (const [name, profile] of Object.entries(legacy.profiles)) {
    profiles[name] = {
      heavy: profile.heavy,
      rest: profile.rest,
      placements: { ...placements },
      specifics: {},
    }
  }

  return { profiles, active: legacy.active, effective: {} }
}
