import { z } from "zod"

/**
 * The two capability tiers every agent is mapped onto. `heavy` is for
 * reasoning/orchestration; `rest` is everything else. `small_model` follows the
 * `rest` tier. See CONTEXT.md ("tier", "asignación").
 */
export const TIERS = ["heavy", "rest"] as const
export type TierName = (typeof TIERS)[number]

/**
 * A model slot for the `heavy` tier. `variant` is an optional model variant
 * (e.g. a reasoning-effort flavour) applied per agent.
 */
export const heavyTierSchema = z.object({
  model: z.string().min(1),
  variant: z.string().min(1).optional(),
})

/** A model slot for the `rest` tier. */
export const restTierSchema = z.object({
  model: z.string().min(1),
})

/**
 * A single profile: one model per tier. Creating a profile costs two choices,
 * not one per agent — the agent-to-tier assignment is shared across profiles.
 */
export const profileSchema = z.object({
  heavy: heavyTierSchema,
  rest: restTierSchema,
})

/**
 * The full on-disk shape of `~/.config/opencode/profiles.json` (decision #13):
 * - `assignment`: shared agent -> tier map.
 * - `exclusions`: agents the switch must never touch.
 * - `profiles`: named profiles, each `{ heavy, rest }`.
 * - `active`: the currently applied profile name.
 *
 * Every field has a default so a partial/hand-edited file still parses into a
 * complete, well-formed value.
 */
export const profilesFileSchema = z.object({
  assignment: z.record(z.string(), z.enum(TIERS)).default({}),
  exclusions: z.array(z.string()).default([]),
  profiles: z.record(z.string(), profileSchema).default({}),
  active: z.string().default(""),
})

export type HeavyTier = z.infer<typeof heavyTierSchema>
export type RestTier = z.infer<typeof restTierSchema>
export type Profile = z.infer<typeof profileSchema>
export type ProfilesFile = z.infer<typeof profilesFileSchema>

/** An empty, valid profiles file — the fallback for a missing/corrupt file. */
export function emptyProfilesFile(): ProfilesFile {
  return { assignment: {}, exclusions: [], profiles: {}, active: "" }
}
