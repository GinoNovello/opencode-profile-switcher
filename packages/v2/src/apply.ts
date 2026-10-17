import { planApply, type ReadyApplyPlan } from "../../../src/core/apply-plan.js"
import { slotToModelRef, type ModelRef } from "../../../src/core/model-ref.js"
import type { EffectiveSlot, ProfilesFile } from "../../../src/core/schema.js"
import type { AgentStatus, InvalidSlot, ModelJson, UnavailableVariant } from "./rpc.js"

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

/**
 * A model of opencode's catalog, as `ctx.model.list()` reports it (the part of
 * `ModelInfo` from `@opencode/client` this module uses). `variants` is always
 * present: an empty list means the model offers no named variant.
 */
export interface CatalogModel {
  providerID: string
  id: string
  variants: readonly { id: string }[]
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
 * A slot whose model is not `provider/model` is skipped too (see
 * `invalidSlots`, which reports it).
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
  fixedByConfig: string[]
  /**
   * Agents the profile wrote that list no model at all after the reload. The
   * config cannot be the cause (it only ever sets a model), so they are kept
   * apart from `fixedByConfig`.
   */
  unapplied: string[]
  /** Agents that took the profile's model, with the slot they took. */
  applied: Record<string, EffectiveSlot>
  /** Agents that took a variant their model does not offer (see `offeredWithoutVariant`). */
  unavailableVariants: UnavailableVariant[]
}

/**
 * Whether an agent kept the model the profile wrote. A planned model without a
 * variant matches a listed one without a variant or with the host's implicit
 * `default`.
 */
function landed(planned: HostModel, actual: HostModel): boolean {
  if (planned.providerID !== actual.providerID || planned.id !== actual.id) return false
  if (planned.variant === undefined) {
    return actual.variant === undefined || actual.variant === "default"
  }
  return planned.variant === actual.variant
}

/**
 * The variants `catalog` offers for `model` when they do not include its
 * variant; `undefined` when there is nothing to warn about. An omitted or
 * `default` variant always resolves, and a model the catalog does not list
 * gives no information, so neither is reported.
 */
export function offeredWithoutVariant(
  model: HostModel,
  catalog: readonly CatalogModel[],
): string[] | undefined {
  if (model.variant === undefined || model.variant === "default") return undefined
  const entry = catalog.find((candidate) => candidate.providerID === model.providerID && candidate.id === model.id)
  if (!entry) return undefined
  const offered = entry.variants.map((variant) => variant.id)
  return offered.includes(model.variant) ? undefined : offered
}

/**
 * Compare the agents the host lists after a reload with `plan`, the active
 * profile's plan for those same agents. An agent the profile wrote that lists
 * a different model is fixed by config: the user's config runs after this
 * plugin and wins (ADR-0003). An agent that took the profile's model is also
 * checked against `catalog` for a variant its model does not offer; the
 * variant of a model fixed by config is the user's, so it is not checked.
 */
export function inspectAgents(
  profiles: ProfilesFile,
  plan: ReadyApplyPlan,
  listed: readonly ListedAgent[],
  catalog: readonly CatalogModel[] = [],
): Inspection {
  const active = profiles.profiles[plan.active]!
  const byId = new Map(listed.map((agent) => [agent.id, agent]))
  const agents: AgentStatus[] = []
  const fixedByConfig: string[] = []
  const unapplied: string[] = []
  const applied: Record<string, EffectiveSlot> = {}
  const unavailableVariants: UnavailableVariant[] = []

  for (const entry of plan.agents) {
    const agent = byId.get(entry.name)
    // A placement for an agent this location does not have.
    if (!agent) continue

    const ref = entry.action === "set" ? slotToModelRef(entry.slot) : undefined
    const planned = ref && toHostModel(ref)
    let fixed = false
    if (planned && entry.action === "set") {
      if (!agent.model) unapplied.push(agent.id)
      else if (!landed(planned, agent.model)) fixed = true
      else {
        applied[agent.id] = entry.slot
        const offered = offeredWithoutVariant(planned, catalog)
        if (offered) {
          unavailableVariants.push({
            agent: agent.id,
            placement: active.placements[agent.id] ?? null,
            model: `${planned.providerID}/${planned.id}`,
            variant: planned.variant!,
            offered,
          })
        }
      }
    }
    if (fixed) fixedByConfig.push(agent.id)

    agents.push({
      id: agent.id,
      placement: active.placements[agent.id] ?? null,
      planned: toModelJson(planned),
      model: toModelJson(agent.model),
      fixedByConfig: fixed,
    })
  }

  return { plan, agents, fixedByConfig, unapplied, applied, unavailableVariants }
}

/**
 * Slots of the active profile that cannot be applied because their model is
 * not `provider/model` (a `#variant` embedded in `model` included: the variant
 * goes in its own field). The agents they reach are left untouched, and a bad
 * `heavy` also leaves the catalog default alone, so they are reported instead
 * of skipped in silence.
 */
export function invalidSlots(profiles: ProfilesFile): InvalidSlot[] {
  const plan = planApply(profiles)
  if (!plan.applied) return []
  const profile = profiles.profiles[plan.active]!
  const invalid: InvalidSlot[] = []
  for (const tier of ["heavy", "rest"] as const) {
    if (!slotToModelRef(profile[tier])) {
      invalid.push({ placement: tier, agent: null, model: profile[tier].model })
    }
  }
  for (const [agent, placement] of Object.entries(profile.placements)) {
    const slot =
      placement === "specific"
        ? profile.specifics[agent]
        : placement === "excluded"
          ? profiles.effective[agent]
          : undefined
    if (slot?.model && !slotToModelRef(slot)) {
      invalid.push({ placement, agent, model: slot.model })
    }
  }
  return invalid
}

/** A readable description of an invalid slot, for the log. */
export function describeInvalidSlot(slot: InvalidSlot): string {
  const where = slot.agent ? `${slot.placement} agent "${slot.agent}"` : `the ${slot.placement} tier`
  return `"${slot.model}" for ${where}`
}

/**
 * Unavailable variants grouped by `provider/model#variant`, for the log and the
 * TUI: `"opencode/big-pickle#high" for build, plan (offers: none)`.
 */
export function describeUnavailableVariants(entries: readonly UnavailableVariant[]): string {
  const groups = new Map<string, { agents: string[]; offered: string[] }>()
  for (const entry of entries) {
    const key = `${entry.model}#${entry.variant}`
    const group = groups.get(key) ?? { agents: [], offered: entry.offered }
    group.agents.push(entry.agent)
    groups.set(key, group)
  }
  return [...groups].map(([key, group]) =>
    `"${key}" for ${group.agents.join(", ")} (offers: ${group.offered.length ? group.offered.join(", ") : "none"})`,
  ).join("; ")
}

/**
 * The effective map to persist (ADR-0002): the last model the plugin actually
 * applied per agent. Only agents that took the profile's model are recorded;
 * an agent fixed by config keeps whatever was remembered for it, because the
 * plugin never applied anything to it.
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
