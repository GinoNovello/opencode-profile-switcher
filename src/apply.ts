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
   * derived from the assignment keys plus whatever already exists in
   * `cfg.agent` — the best a `config` hook can do, since it runs before the
   * built-in agents are enumerable.
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
   * Agents that had no explicit assignment and fell back to the `rest` tier.
   * Surface these to the user (toast) suggesting they run the wizard.
   */
  unassigned: string[]
}

/** Resolve the model slot for a tier within a profile. */
function tierSlot(profile: Profile, tier: TierName): { model: string; variant?: string } {
  return tier === "heavy" ? profile.heavy : profile.rest
}

/** Write a tier's model (and variant, heavy-only) onto an agent config entry. */
function applyTier(target: MutableAgentConfig, profile: Profile, tier: TierName): void {
  const slot = tierSlot(profile, tier)
  target.model = slot.model
  if ("variant" in slot && slot.variant) target.variant = slot.variant
  else delete target.variant
}

/**
 * Apply the active profile onto a resolved opencode config, in place.
 *
 * Rules (decisions #11, #13):
 * - `cfg.model` = heavy tier model; `cfg.small_model` = rest tier model.
 * - Each considered agent gets the model of its assigned tier.
 * - Excluded agents are left completely untouched.
 * - An agent with no assignment falls back to the `rest` tier and is reported
 *   in `unassigned` (never breaks the switch).
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

  // Consider the union of: runtime-enumerated agents, assigned agents, and any
  // agents already present in the config.
  const names = new Set<string>()
  for (const name of options.agents ?? []) names.add(name)
  for (const name of Object.keys(profiles.assignment)) names.add(name)
  for (const name of Object.keys(agentConfig)) names.add(name)

  const exclusions = new Set(profiles.exclusions)
  const changedAgents: string[] = []
  const unassigned: string[] = []

  for (const name of names) {
    if (exclusions.has(name)) continue

    const assigned = profiles.assignment[name]
    const tier: TierName = assigned ?? "rest"
    if (!assigned) unassigned.push(name)

    const target = (agentConfig[name] ??= {})
    applyTier(target, profile, tier)
    changedAgents.push(name)
  }

  return { applied: true, active, changedAgents, unassigned }
}
