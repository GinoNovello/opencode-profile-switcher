import { z } from "zod"

/**
 * The two capability tiers every agent is mapped onto. `heavy` is for
 * reasoning/orchestration; `rest` is everything else. `small_model` follows the
 * `rest` tier. See CONTEXT.md ("tier", "asignación").
 */
export const TIERS = ["heavy", "rest"] as const
export type TierName = (typeof TIERS)[number]

/**
 * A per-agent placement within a profile: a capability tier, a direct
 * `specific` model, or `excluded` (the switch never touches that agent's
 * model). Placements belong to each profile — the same agent can be `heavy` in
 * one profile, `specific` in another and `excluded` in a third. See CONTEXT.md
 * ("asignación", "exclusión", "modelo específico").
 */
export const PLACEMENTS = [...TIERS, "specific", "excluded"] as const
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
 * A direct model slot for an agent placed as `specific`. Same shape as heavy
 * (model + optional variant) but owned per agent, not shared via a tier.
 */
export const specificSlotSchema = heavyTierSchema

/**
 * A single profile: one model per tier, its own agent placements, and a direct
 * model slot for every agent placed as `specific`. Activating a profile fully
 * describes how every agent is modelled — no shared, global assignment.
 */
export const profileSchema = z
  .object({
    heavy: heavyTierSchema,
    rest: restTierSchema,
    placements: z.record(z.string(), z.enum(PLACEMENTS)).default({}),
    specifics: z.record(z.string(), specificSlotSchema).default({}),
  })
  .superRefine((profile, ctx) => {
    for (const [agent, placement] of Object.entries(profile.placements)) {
      if (placement !== "specific") continue
      const slot = profile.specifics[agent]
      if (!slot?.model) {
        ctx.addIssue({
          code: "custom",
          message: `Agent "${agent}" is placed as specific but has no model`,
          path: ["specifics", agent],
        })
      }
    }
    for (const agent of Object.keys(profile.specifics)) {
      if (profile.placements[agent] !== "specific") {
        ctx.addIssue({
          code: "custom",
          message: `Orphan specific model for agent "${agent}" without a specific placement`,
          path: ["specifics", agent],
        })
      }
    }
  })

/**
 * The full on-disk shape of `~/.config/opencode/profiles.json`:
 * - `profiles`: named profiles, each `{ heavy, rest, placements, specifics }`.
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
export type SpecificSlot = z.infer<typeof specificSlotSchema>
export type Profile = z.infer<typeof profileSchema>
export type ProfilesFile = z.infer<typeof profilesFileSchema>

/** An empty, valid profiles file — the fallback for a missing/corrupt file. */
export function emptyProfilesFile(): ProfilesFile {
  return { profiles: {}, active: "" }
}
