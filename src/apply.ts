import type { Profile, ProfilesFile, TierName } from "./schema.js"

/**
 * The subset of an agent's config we mutate. Structurally compatible with
 * opencode's per-agent config entries.
 */
export interface MutableAgentConfig {
  model?: string
  variant?: string
  [key: string]: unknown
}

/**
 * The subset of opencode's resolved `Config` (the `config` hook input) that we
 * mutate. The real `Config` is structurally assignable to this.
 */
export interface MutableConfig {
  model?: string
  small_model?: string
  agent?: Record<string, MutableAgentConfig>
  [key: string]: unknown
}

export interface ApplyOptions {
  /**
   * Agent names to apply tiers to, typically enumerated at runtime via
   * `client.app.agents()` (see `enumerateAgentNames`). When omitted, the set is
   * derived from the active profile's placement keys plus whatever already
   * exists in `cfg.agent` — the best a `config` hook can do, since it runs
   * before the built-in agents are enumerable.
   */
  agents?: string[]
}

export interface ApplyResult {
  /** Whether a profile was applied. False when there is no usable active profile. */
  applied: boolean
  /** The active profile name that was consulted. */
  active: string
  /** Why nothing was applied, when `applied` is false. */
  reason?: "no-active" | "unknown-active"
  /** Agents whose model was written. */
  changedAgents: string[]
  /**
   * Agents absent from the active profile's placements that fell back to the
   * `rest` tier. Surface these to the user (toast) suggesting they run the
   * wizard to place them explicitly.
   */
  unassigned: string[]
}

/** Resolve the model slot for a tier within a profile. */
function tierSlot(profile: Profile, tier: TierName): { model: string; variant?: string } {
  return tier === "heavy" ? profile.heavy : profile.rest
}

/** Write a model (and optional variant) onto an agent config entry. */
function applySlot(
  target: MutableAgentConfig,
  slot: { model: string; variant?: string },
): void {
  target.model = slot.model
  if (slot.variant) target.variant = slot.variant
  else delete target.variant
}

/** Write a tier's model (and variant, heavy-only) onto an agent config entry. */
function applyTier(target: MutableAgentConfig, profile: Profile, tier: TierName): void {
  applySlot(target, tierSlot(profile, tier))
}

/**
 * Apply the active profile onto a resolved opencode config, in place.
 *
 * Rules:
 * - `cfg.model` = heavy tier model; `cfg.small_model` = rest tier model.
 * - Each considered agent gets the model of its placement in the active profile.
 * - Agents placed as `specific` receive their direct model/variant from
 *   `profile.specifics` (no tier indirection). A missing/empty slot is skipped
 *   defensively so a hand-edited incomplete file cannot crash the switch.
 * - Agents the profile places as `excluded` are left completely untouched.
 * - An agent absent from the profile's placements falls back to the `rest` tier
 *   and is reported in `unassigned` (never breaks the switch).
 *
 * Pure except for the in-place mutation of `cfg`; returns a report for toasts.
 */
export function applyProfile(
  cfg: MutableConfig,
  profiles: ProfilesFile,
  options: ApplyOptions = {},
): ApplyResult {
  const active = profiles.active

  if (!active) {
    return { applied: false, active, reason: "no-active", changedAgents: [], unassigned: [] }
  }
  const profile = profiles.profiles[active]
  if (!profile) {
    return { applied: false, active, reason: "unknown-active", changedAgents: [], unassigned: [] }
  }

  // Global fallbacks: heavy -> model, rest -> small_model.
  cfg.model = profile.heavy.model
  cfg.small_model = profile.rest.model

  const agentConfig = (cfg.agent ??= {})

  // Consider the union of: runtime-enumerated agents, the profile's placed
  // agents, and any agents already present in the config.
  const names = new Set<string>()
  for (const name of options.agents ?? []) names.add(name)
  for (const name of Object.keys(profile.placements)) names.add(name)
  for (const name of Object.keys(agentConfig)) names.add(name)

  const changedAgents: string[] = []
  const unassigned: string[] = []
  const specifics = profile.specifics ?? {}

  for (const name of names) {
    const placement = profile.placements[name]
    if (placement === "excluded") continue

    if (placement === "specific") {
      const slot = specifics[name]
      // Defensive: incomplete hand-edited JSON must not throw or half-write.
      if (!slot?.model) continue
      const target = (agentConfig[name] ??= {})
      applySlot(target, slot)
      changedAgents.push(name)
      continue
    }

    const tier: TierName = placement ?? "rest"
    if (!placement) unassigned.push(name)

    const target = (agentConfig[name] ??= {})
    applyTier(target, profile, tier)
    changedAgents.push(name)
  }

  return { applied: true, active, changedAgents, unassigned }
}
