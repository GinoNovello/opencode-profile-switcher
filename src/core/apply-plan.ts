import type { EffectiveSlot, Placement, Profile, ProfilesFile, TierName } from "./schema.js"

export interface ApplyPlanInput {
  /**
   * Agent names the host enumerated at runtime (e.g. opencode 1.x's
   * `client.app.agents()`). Considered first, in this order.
   */
  agents?: readonly string[]
  /**
   * Agent names already present in the host's resolved config. Considered
   * after the runtime agents and the active profile's placements.
   */
  configured?: readonly string[]
}

/**
 * What the active profile asks for one agent:
 * - `set`  — write `slot` (model + optional variant; variant absent ⇒ clear it).
 *   `placement` is where the slot came from; `unassigned` marks an agent absent
 *   from the profile's placements that fell back to the `rest` tier.
 * - `keep` — leave the agent's host config untouched: an `excluded` agent the
 *   plugin never applied a model to, or a `specific` agent whose slot is
 *   missing/incomplete in a hand-edited file.
 */
export type AgentPlan =
  | { name: string; action: "set"; placement: Placement; slot: EffectiveSlot; unassigned: boolean }
  | { name: string; action: "keep"; placement: "excluded" | "specific" }

/** The report every plan carries, applied or not. */
export interface ApplyPlanSummary {
  /** The active profile name that was consulted. */
  active: string
  /** Agents whose model is written (the `set` entries of `agents`), in order. */
  changedAgents: string[]
  /**
   * Agents absent from the active profile's placements that fell back to the
   * `rest` tier. Surface these to the user (toast) suggesting they run the
   * wizard to place them explicitly.
   */
  unassigned: string[]
  /**
   * Full effective map after applying this plan. Callers that own persistence
   * should write it when `effectiveChanged` is true (and the on-disk file is
   * valid).
   */
  effective: Record<string, EffectiveSlot>
  /** True when `effective` differs from the input `profiles.effective`. */
  effectiveChanged: boolean
}

/** Nothing to apply: there is no usable active profile. */
export interface SkippedApplyPlan extends ApplyPlanSummary {
  applied: false
  reason: "no-active" | "unknown-active"
}

/** The active profile resolved to concrete per-agent and global slots. */
export interface ReadyApplyPlan extends ApplyPlanSummary {
  applied: true
  /**
   * The tier slots for the host's global defaults. In opencode 1.x the global
   * `model` follows `heavy` and `small_model` follows `rest`.
   */
  defaults: { heavy: EffectiveSlot; rest: EffectiveSlot }
  /** One entry per considered agent, in consideration order. */
  agents: AgentPlan[]
}

export type ApplyPlan = SkippedApplyPlan | ReadyApplyPlan

/** Resolve the model slot for a tier within a profile. */
function tierSlot(profile: Profile, tier: TierName): EffectiveSlot {
  return tier === "heavy" ? profile.heavy : profile.rest
}

/** Snapshot a complete effective slot (model + optional variant, no extras). */
function snapshotSlot(slot: EffectiveSlot): EffectiveSlot {
  return slot.variant ? { model: slot.model, variant: slot.variant } : { model: slot.model }
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
 * Decide what applying the active profile means, without touching any host
 * config. Each adapter writes the plan with its own config shape.
 *
 * Rules:
 * - The global defaults take the heavy and rest tier slots.
 * - Each considered agent gets the slot of its placement in the active profile.
 * - Agents placed as `specific` receive their direct model/variant from
 *   `profile.specifics` (no tier indirection). A missing/empty slot is kept
 *   untouched defensively so a hand-edited incomplete file cannot crash the
 *   switch.
 * - Agents the profile places as `excluded` restore their last persisted
 *   effective model/variant when the plugin has one; otherwise they are kept
 *   completely untouched (original host config).
 * - Applying `heavy`, `rest` or `specific` records the chosen complete slot in
 *   the returned `effective` map (variant absent ⇒ cleared, never merged with
 *   a prior profile's variant).
 * - An agent absent from the profile's placements falls back to the `rest` tier
 *   and is reported in `unassigned` (never breaks the switch).
 *
 * Considered agents are the union, in this order, of `input.agents`, the
 * profile's placement keys and `input.configured`.
 */
export function planApply(profiles: ProfilesFile, input: ApplyPlanInput = {}): ApplyPlan {
  const active = profiles.active
  const priorEffective = profiles.effective ?? {}

  if (!active) {
    return skipped(active, "no-active", priorEffective)
  }
  const profile = profiles.profiles[active]
  if (!profile) {
    return skipped(active, "unknown-active", priorEffective)
  }

  const names = new Set<string>()
  for (const name of input.agents ?? []) names.add(name)
  for (const name of Object.keys(profile.placements)) names.add(name)
  for (const name of input.configured ?? []) names.add(name)

  const agents: AgentPlan[] = []
  const changedAgents: string[] = []
  const unassigned: string[] = []
  const specifics = profile.specifics ?? {}
  const effective: Record<string, EffectiveSlot> = { ...priorEffective }

  const set = (name: string, placement: Placement, slot: EffectiveSlot, isUnassigned = false) => {
    agents.push({ name, action: "set", placement, slot, unassigned: isUnassigned })
    effective[name] = slot
    changedAgents.push(name)
  }

  for (const name of names) {
    const placement = profile.placements[name]

    if (placement === "excluded") {
      const remembered = priorEffective[name]
      if (!remembered?.model) {
        agents.push({ name, action: "keep", placement })
        continue
      }
      set(name, placement, snapshotSlot(remembered))
      continue
    }

    if (placement === "specific") {
      const slot = specifics[name]
      // Defensive: incomplete hand-edited JSON must not throw or half-write.
      if (!slot?.model) {
        agents.push({ name, action: "keep", placement })
        continue
      }
      set(name, placement, snapshotSlot(slot))
      continue
    }

    const tier: TierName = placement ?? "rest"
    if (!placement) unassigned.push(name)
    set(name, tier, snapshotSlot(tierSlot(profile, tier)), !placement)
  }

  return {
    applied: true,
    active,
    defaults: { heavy: snapshotSlot(profile.heavy), rest: snapshotSlot(profile.rest) },
    agents,
    changedAgents,
    unassigned,
    effective,
    effectiveChanged: !effectiveMapsEqual(priorEffective, effective),
  }
}

function skipped(
  active: string,
  reason: SkippedApplyPlan["reason"],
  priorEffective: Record<string, EffectiveSlot>,
): SkippedApplyPlan {
  return {
    applied: false,
    active,
    reason,
    changedAgents: [],
    unassigned: [],
    effective: { ...priorEffective },
    effectiveChanged: false,
  }
}
