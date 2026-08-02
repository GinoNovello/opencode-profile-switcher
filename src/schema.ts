import { z } from "zod"

/**
 * The two capability tiers every agent is mapped onto. `heavy` is for
 * reasoning/orchestration; `rest` is everything else. `small_model` follows the
 * `rest` tier. See CONTEXT.md ("tier", "asignación").
 */
export const TIERS = ["heavy", "rest"] as const
export type TierName = (typeof TIERS)[number]

/**
 * A per-agent placement within a profile: a capability tier or `excluded` (the
 * switch never touches that agent's model). Placements belong to each profile —
 * the same agent can be `heavy` in one profile, `rest` in another and
 * `excluded` in a third. See CONTEXT.md ("asignación", "exclusión").
 */
export const PLACEMENTS = [...TIERS, "excluded"] as const
export type Placement = (typeof PLACEMENTS)[number]

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
 * A single profile: one model per tier plus its own agent placements. A profile
 * owns which agents are `heavy`, `rest` or `excluded`, so activating it fully
 * describes how every agent is modelled — no shared, global assignment.
 */
export const profileSchema = z.object({
  heavy: heavyTierSchema,
  rest: restTierSchema,
  placements: z.record(z.string(), z.enum(PLACEMENTS)).default({}),
})

/**
 * The full on-disk shape of `~/.config/opencode/profiles.json`:
 * - `profiles`: named profiles, each `{ heavy, rest, placements }`.
 * - `active`: the currently applied profile name.
 *
 * Every field has a default so a partial/hand-edited file still parses into a
 * complete, well-formed value.
 */
export const profilesFileSchema = z.object({
  profiles: z.record(z.string(), profileSchema).default({}),
  active: z.string().default(""),
})

export type HeavyTier = z.infer<typeof heavyTierSchema>
export type RestTier = z.infer<typeof restTierSchema>
export type Profile = z.infer<typeof profileSchema>
export type ProfilesFile = z.infer<typeof profilesFileSchema>

/** An empty, valid profiles file — the fallback for a missing/corrupt file. */
export function emptyProfilesFile(): ProfilesFile {
  return { profiles: {}, active: "" }
}
