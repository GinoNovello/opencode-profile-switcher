import { planApply, type ReadyApplyPlan } from "../../../src/core/apply-plan.js"
import { slotToModelRef, type ModelRef } from "../../../src/core/model-ref.js"
import type { EffectiveSlot, ProfilesFile } from "../../../src/core/schema.js"
import type { AgentStatus, ModelJson } from "./rpc.js"

/** A model as opencode 2.0 keeps it at runtime (`Agent.Info["model"]`). */
export interface HostModel {
  providerID: string
  id: string
  variant?: string
}

/**
 * The part of opencode's `AgentEditor` (the `agent.transform` input) this
 * module uses. The real editor is structurally assignable to it.
 */
export interface AgentEditorLike {
  list(): readonly { id: string }[]
  get(id: string): unknown
  update(id: string, update: (agent: { model?: HostModel }) => void): void
}

/** An entry of `ctx.agent.list()`'s `data`. */
export interface ListedAgent {
  id: string
  model?: HostModel
}

function toHostModel(ref: ModelRef): HostModel {
  return ref.variant
    ? { providerID: ref.providerID, id: ref.modelID, variant: ref.variant }
    : { providerID: ref.providerID, id: ref.modelID }
}

function toModelJson(model: HostModel | undefined): ModelJson | null {
  if (!model) return null
  return { providerID: model.providerID, id: model.id, variant: model.variant ?? null }
}

/**
 * The active profile's model for every agent the transform can address.
 *
 * Runs inside `ctx.agent.transform`, so it is synchronous and only writes to
 * `editor`. An agent is written only when it exists: either the editor already
 * has it (built-in agents, hidden ones included) or it is in `learned`, the
 * ids `ctx.agent.list()` reported after the host's own config pass (markdown
 * and config-only agents, which this transform runs too early to see).
 * `editor.update` creates any id it is given, so a profile placement for an
 * agent the location does not have is skipped rather than turned into a ghost.
 *
 * Returns the ids the editor already had, which tells the caller whether
 * `learned` brought anything the editor could not see.
 */
export function writeAgentModels(
  editor: AgentEditorLike,
  profiles: ProfilesFile,
  learned: ReadonlySet<string>,
): string[] {
  const seen = editor.list().map((agent) => agent.id)
  const plan = planApply(profiles, { agents: [...seen, ...learned] })
  if (!plan.applied) return seen

  for (const agent of plan.agents) {
    if (agent.action !== "set") continue
    if (editor.get(agent.name) === undefined && !learned.has(agent.name)) continue
    const ref = slotToModelRef(agent.slot)
    if (!ref) continue
    const model = toHostModel(ref)
    editor.update(agent.name, (target) => {
      target.model = model
    })
  }
  return seen
}

/**
 * The catalog default model: the active profile's `heavy` tier (decision 3 of
 * #36). opencode 2.0's `model.default.set` takes no variant, so `heavy`'s
 * variant only reaches the agents placed as `heavy`.
 */
export function defaultModel(profiles: ProfilesFile): ModelRef | undefined {
  const plan = planApply(profiles)
  if (!plan.applied) return undefined
  const ref = slotToModelRef(plan.defaults.heavy)
  return ref && { providerID: ref.providerID, modelID: ref.modelID }
}

/** What applying the profile did to the location's agents. */
export interface Inspection {
  /** The plan for exactly the listed agents. */
  plan: ReadyApplyPlan
  agents: AgentStatus[]
  /** Agents whose config model beat the profile's (ADR-0003). */
  pinned: string[]
  /** Agents that took the profile's model, with the slot they took. */
  applied: Record<string, EffectiveSlot>
}

/**
 * Whether an agent kept the model the profile wrote. A planned model without a
 * variant matches a listed one without a variant or with the host's implicit
 * `default`.
 */
function landed(planned: HostModel, actual: HostModel | undefined): boolean {
  if (!actual) return false
  if (planned.providerID !== actual.providerID || planned.id !== actual.id) return false
  if (planned.variant === undefined) {
    return actual.variant === undefined || actual.variant === "default"
  }
  return planned.variant === actual.variant
}

/**
 * Compare the agents the host lists after a reload with what the profile
 * asked for. An agent the profile wrote but that lists a different model is
 * pinned by config: the user's config runs after this plugin and wins
 * (ADR-0003). Returns `undefined` when no profile applies.
 */
export function inspectAgents(
  profiles: ProfilesFile,
  listed: readonly ListedAgent[],
): Inspection | undefined {
  const plan = planApply(profiles, { agents: listed.map((agent) => agent.id) })
  if (!plan.applied) return undefined

  const active = profiles.profiles[plan.active]!
  const byId = new Map(listed.map((agent) => [agent.id, agent]))
  const agents: AgentStatus[] = []
  const pinned: string[] = []
  const applied: Record<string, EffectiveSlot> = {}

  for (const entry of plan.agents) {
    const agent = byId.get(entry.name)
    // A placement for an agent this location does not have.
    if (!agent) continue

    const ref = entry.action === "set" ? slotToModelRef(entry.slot) : undefined
    const planned = ref && toHostModel(ref)
    const isPinned = planned !== undefined && !landed(planned, agent.model)
    if (isPinned) pinned.push(agent.id)
    if (planned && !isPinned && entry.action === "set") applied[agent.id] = entry.slot

    agents.push({
      id: agent.id,
      placement: active.placements[agent.id] ?? null,
      planned: toModelJson(planned),
      model: toModelJson(agent.model),
      pinned: isPinned,
    })
  }

  return { plan, agents, pinned, applied }
}

/**
 * The effective map to persist (ADR-0002): the last model the plugin actually
 * applied per agent. Only agents that took the profile's model are recorded;
 * a pinned agent keeps whatever was remembered for it, because the plugin
 * never applied anything to it.
 */
export function nextEffective(
  prior: Record<string, EffectiveSlot>,
  applied: Record<string, EffectiveSlot>,
): { effective: Record<string, EffectiveSlot>; changed: boolean } {
  const effective = { ...prior }
  let changed = false
  for (const [id, slot] of Object.entries(applied)) {
    const before = prior[id]
    if (before?.model !== slot.model || before?.variant !== slot.variant) changed = true
    effective[id] = slot.variant ? { model: slot.model, variant: slot.variant } : { model: slot.model }
  }
  return { effective, changed }
}
