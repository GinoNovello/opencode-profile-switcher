import type { EffectiveSlot, Profile, ProfilesFile, TierName } from "./schema.js"

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
  /**
   * Full effective map after this apply. Callers that own persistence should
   * write it when `effectiveChanged` is true (and the on-disk file is valid).
   */
  effective: Record<string, EffectiveSlot>
  /** True when `effective` differs from the input `profiles.effective`. */
  effectiveChanged: boolean
}

/** Resolve the model slot for a tier within a profile. */
function tierSlot(profile: Profile, tier: TierName): EffectiveSlot {
  return tier === "heavy" ? profile.heavy : profile.rest
}

/** Snapshot a complete effective slot (model + optional variant, no extras). */
function snapshotSlot(slot: EffectiveSlot): EffectiveSlot {
  return slot.variant ? { model: slot.model, variant: slot.variant } : { model: slot.model }
}

/** Write a model (and optional variant) onto an agent config entry. */
function applySlot(target: MutableAgentConfig, slot: EffectiveSlot): void {
  target.model = slot.model
  if (slot.variant) target.variant = slot.variant
  else delete target.variant
}

function slotsEqual(a: EffectiveSlot | undefined, b: EffectiveSlot | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.model === b.model && a.variant === b.variant
}

function effectiveMapsEqual(
  a: Record<string, EffectiveSlot>,
  b: Record<string, EffectiveSlot>,
): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!slotsEqual(a[key], b[key])) return false
  }
  return true
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
 * - Agents the profile places as `excluded` restore their last persisted
 *   effective model/variant when the plugin has one; otherwise they are left
 *   completely untouched (original opencode config).
 * - Applying `heavy`, `rest` or `specific` records the chosen complete slot in
 *   the returned `effective` map (variant absent ⇒ cleared, never merged with
 *   a prior profile's variant).
 * - An agent absent from the profile's placements falls back to the `rest` tier
 *   and is reported in `unassigned` (never breaks the switch).
 *
 * Pure except for the in-place mutation of `cfg`; returns a report for toasts
 * and the next effective map for persistence.
 */
export function applyProfile(
  cfg: MutableConfig,
  profiles: ProfilesFile,
  options: ApplyOptions = {},
): ApplyResult {
  const active = profiles.active
  const priorEffective = profiles.effective ?? {}

  if (!active) {
    return {
      applied: false,
      active,
      reason: "no-active",
      changedAgents: [],
      unassigned: [],
      effective: { ...priorEffective },
      effectiveChanged: false,
    }
  }
  const profile = profiles.profiles[active]
  if (!profile) {
    return {
      applied: false,
      active,
      reason: "unknown-active",
      changedAgents: [],
      unassigned: [],
      effective: { ...priorEffective },
      effectiveChanged: false,
    }
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
  const effective: Record<string, EffectiveSlot> = { ...priorEffective }

  for (const name of names) {
    const placement = profile.placements[name]

    if (placement === "excluded") {
      const remembered = priorEffective[name]
      if (!remembered?.model) continue
      const slot = snapshotSlot(remembered)
      const target = (agentConfig[name] ??= {})
      applySlot(target, slot)
      effective[name] = slot
      changedAgents.push(name)
      continue
    }

    if (placement === "specific") {
      const slot = specifics[name]
      // Defensive: incomplete hand-edited JSON must not throw or half-write.
      if (!slot?.model) continue
      const chosen = snapshotSlot(slot)
      const target = (agentConfig[name] ??= {})
      applySlot(target, chosen)
      effective[name] = chosen
      changedAgents.push(name)
      continue
    }

    const tier: TierName = placement ?? "rest"
    if (!placement) unassigned.push(name)

    const chosen = snapshotSlot(tierSlot(profile, tier))
    const target = (agentConfig[name] ??= {})
    applySlot(target, chosen)
    effective[name] = chosen
    changedAgents.push(name)
  }

  return {
    applied: true,
    active,
    changedAgents,
    unassigned,
    effective,
    effectiveChanged: !effectiveMapsEqual(priorEffective, effective),
  }
}
