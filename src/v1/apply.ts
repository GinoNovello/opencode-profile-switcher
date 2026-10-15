import { planApply } from "../core/apply-plan.js"
import type { EffectiveSlot, ProfilesFile } from "../core/schema.js"

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

/** Write a model (and optional variant) onto an agent config entry. */
function applySlot(target: MutableAgentConfig, slot: EffectiveSlot): void {
  target.model = slot.model
  if (slot.variant) target.variant = slot.variant
  else delete target.variant
}

/**
 * Apply the active profile onto a resolved opencode config, in place.
 *
 * The decisions live in `planApply` (host-independent); this is the 1.x
 * writer for its plan:
 * - `cfg.model` = heavy tier model; `cfg.small_model` = rest tier model.
 * - Every `set` agent gets the planned model/variant, creating its
 *   `cfg.agent` entry when missing.
 * - `keep` agents (excluded with no remembered model, incomplete `specific`)
 *   are left completely untouched.
 * - Nothing is written when there is no usable active profile.
 *
 * Pure except for the in-place mutation of `cfg`; returns a report for toasts
 * and the next effective map for persistence.
 */
export function applyProfile(
  cfg: MutableConfig,
  profiles: ProfilesFile,
  options: ApplyOptions = {},
): ApplyResult {
  const plan = planApply(profiles, {
    agents: options.agents,
    configured: Object.keys(cfg.agent ?? {}),
  })

  if (!plan.applied) {
    return {
      applied: false,
      active: plan.active,
      reason: plan.reason,
      changedAgents: plan.changedAgents,
      unassigned: plan.unassigned,
      effective: plan.effective,
      effectiveChanged: plan.effectiveChanged,
    }
  }

  // Global fallbacks: heavy -> model, rest -> small_model.
  cfg.model = plan.defaults.heavy.model
  cfg.small_model = plan.defaults.rest.model

  const agentConfig = (cfg.agent ??= {})
  for (const agent of plan.agents) {
    if (agent.action !== "set") continue
    applySlot((agentConfig[agent.name] ??= {}), agent.slot)
  }

  return {
    applied: true,
    active: plan.active,
    changedAgents: plan.changedAgents,
    unassigned: plan.unassigned,
    effective: plan.effective,
    effectiveChanged: plan.effectiveChanged,
  }
}
