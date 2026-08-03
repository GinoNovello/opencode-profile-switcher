import type { AgentInfo } from "./agents.js"
import type { Placement, Profile, ProfilesFile, SpecificSlot } from "./schema.js"
import type { SelectOption } from "./select.js"

export type { Placement, SpecificSlot } from "./schema.js"

/** A profile's agent → placement map. */
export type Placements = Record<string, Placement>

/** A profile's agent → direct model slot map for `specific` placements. */
export type Specifics = Record<string, SpecificSlot>

/**
 * Default placement for one enumerated agent: primary agents go to `heavy`;
 * subagents and hidden agents go to `rest`. Nothing is excluded or specific by
 * default. `mode: "all"` is primary-capable, so it is treated as `heavy`.
 */
export function defaultPlacement(agent: AgentInfo): Placement {
  if (agent.hidden) return "rest"
  return agent.mode === "primary" || agent.mode === "all" ? "heavy" : "rest"
}

/**
 * Build the default placement map for a fresh (first) profile from the
 * enumerated agents. Primary/primary-capable agents land in `heavy`; subagents
 * and hidden agents land in `rest`.
 */
export function defaultPlacements(agents: readonly AgentInfo[]): Placements {
  const placements: Placements = {}
  for (const agent of agents) placements[agent.name] = defaultPlacement(agent)
  return placements
}

/** Copy a profile's placements (including exclusions and specific designations). */
export function copyPlacements(profile: Profile): Placements {
  return { ...profile.placements }
}

/**
 * Copy a profile's specific model slots. Used when editing an existing profile
 * so its direct models are preserved. New-profile flows intentionally skip this
 * and start with an empty map (designations copy, models do not).
 */
export function copySpecifics(profile: Profile): Specifics {
  const specifics: Specifics = {}
  for (const [name, slot] of Object.entries(profile.specifics)) {
    specifics[name] = { ...slot }
  }
  return specifics
}

/** Resolve an agent's placement, defaulting an absent agent to the `rest` tier. */
export function placementOf(placements: Placements, name: string): Placement {
  return placements[name] ?? "rest"
}

/** Cycle a placement heavy → rest → specific → excluded → heavy. */
export function nextPlacement(current: Placement): Placement {
  switch (current) {
    case "heavy":
      return "rest"
    case "rest":
      return "specific"
    case "specific":
      return "excluded"
    default:
      return "heavy"
  }
}

/** Set an agent's placement, returning a new placement map (input untouched). */
export function setPlacement(placements: Placements, name: string, placement: Placement): Placements {
  return { ...placements, [name]: placement }
}

/**
 * Cycle one agent's placement and drop its specific slot when leaving
 * `specific`. Returning to `specific` starts without a model (must be chosen
 * again). Inputs are not mutated.
 */
export function cycleAgentPlacement(
  placements: Placements,
  specifics: Specifics,
  name: string,
): { placements: Placements; specifics: Specifics } {
  const current = placementOf(placements, name)
  const next = nextPlacement(current)
  const nextPlacements = setPlacement(placements, name, next)
  if (current !== "specific" || next === "specific") {
    return { placements: nextPlacements, specifics }
  }
  const nextSpecifics = { ...specifics }
  delete nextSpecifics[name]
  return { placements: nextPlacements, specifics: nextSpecifics }
}

/** Agent names currently placed as `specific`, in stable alphabetical order. */
export function specificAgentNames(placements: Placements): string[] {
  return Object.entries(placements)
    .filter(([, placement]) => placement === "specific")
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))
}

/** Specific agents that still need a non-empty direct model. */
export function missingSpecificAgents(placements: Placements, specifics: Specifics): string[] {
  return specificAgentNames(placements).filter((name) => {
    const model = specifics[name]?.model
    return !model || model.length === 0
  })
}

/** Whether every `specific` agent has a direct model ready to save. */
export function specificsComplete(placements: Placements, specifics: Specifics): boolean {
  return missingSpecificAgents(placements, specifics).length === 0
}

/** Progress counters for the specific-model configuration step. */
export function specificsProgress(
  placements: Placements,
  specifics: Specifics,
): { done: number; total: number; missing: string[] } {
  const total = specificAgentNames(placements).length
  const missing = missingSpecificAgents(placements, specifics)
  return { done: total - missing.length, total, missing }
}

/**
 * Set (or replace) one agent's direct model slot. Empty variants are omitted.
 * Does not mutate the input map.
 */
export function setSpecific(
  specifics: Specifics,
  name: string,
  model: string,
  variant?: string,
): Specifics {
  const slot: SpecificSlot = { model }
  if (variant && variant.length > 0) slot.variant = variant
  return { ...specifics, [name]: slot }
}

const PLACEMENT_LABEL: Record<Placement, string> = {
  heavy: "heavy",
  rest: "rest",
  specific: "specific",
  excluded: "excluded",
}

/**
 * Options for the placement editor: one row per agent showing its current
 * placement, plus a trailing "Done" row. Selecting an agent row cycles its
 * placement; selecting "Done" leaves the editor.
 */
export function buildPlacementOptions(
  placements: Placements,
  agents: readonly AgentInfo[],
): SelectOption<{ kind: "agent"; name: string } | { kind: "done" }>[] {
  const options: SelectOption<{ kind: "agent"; name: string } | { kind: "done" }>[] = agents.map(
    (agent) => ({
      title: agent.name,
      value: { kind: "agent" as const, name: agent.name },
      description: `→ ${PLACEMENT_LABEL[placementOf(placements, agent.name)]}`,
      category: "Agents",
    }),
  )
  options.push({ title: "✓ Done", value: { kind: "done" }, description: "Save placements" })
  return options
}

/**
 * Options for the specific-model configuration step. Lists every `specific`
 * agent with a complete/incomplete marker, in any order the user prefers, plus
 * a trailing "Done" row. The wizard blocks finishing while any are incomplete.
 */
export function buildSpecificOptions(
  placements: Placements,
  specifics: Specifics,
): SelectOption<{ kind: "agent"; name: string } | { kind: "done" }>[] {
  const options: SelectOption<{ kind: "agent"; name: string } | { kind: "done" }>[] =
    specificAgentNames(placements).map((name) => {
      const slot = specifics[name]
      const complete = Boolean(slot?.model)
      const detail = complete
        ? slot!.variant
          ? `${slot!.model} (${slot!.variant})`
          : slot!.model
        : "not set"
      return {
        title: `${complete ? "✓" : "○"} ${name}`,
        value: { kind: "agent" as const, name },
        description: detail,
        category: "Specific models",
      }
    })

  const progress = specificsProgress(placements, specifics)
  const doneReady = progress.missing.length === 0
  options.push({
    title: doneReady ? "✓ Done" : `✓ Done (${progress.done}/${progress.total} set)`,
    value: { kind: "done" },
    description: doneReady
      ? "Save specific models"
      : `Still need: ${progress.missing.join(", ")}`,
  })
  return options
}

export interface NameValidation {
  ok: boolean
  error?: string
}

/**
 * Validate a profile name. `existing` are the current profile names; pass the
 * name being renamed as `self` so renaming to the same name is allowed.
 */
export function validateProfileName(
  raw: string,
  existing: readonly string[],
  self?: string,
): NameValidation {
  const name = raw.trim()
  if (name.length === 0) return { ok: false, error: "Name cannot be empty." }
  if (name !== self && existing.includes(name)) {
    return { ok: false, error: `A profile named "${name}" already exists.` }
  }
  return { ok: true }
}

/**
 * Assemble a profile from the two tier model slots, placements, and specific
 * slots. Normalises `specifics` so only agents currently placed as `specific`
 * keep a slot (orphans are dropped). Incomplete specific agents keep no slot —
 * callers must refuse to persist until `specificsComplete` is true.
 */
export function buildProfile(
  heavyModel: string,
  restModel: string,
  placements: Placements,
  heavyVariant?: string,
  specifics: Specifics = {},
): Profile {
  const heavy: Profile["heavy"] = { model: heavyModel }
  if (heavyVariant && heavyVariant.length > 0) heavy.variant = heavyVariant

  const normalized: Specifics = {}
  for (const [name, placement] of Object.entries(placements)) {
    if (placement !== "specific") continue
    const slot = specifics[name]
    if (!slot?.model) continue
    const next: SpecificSlot = { model: slot.model }
    if (slot.variant && slot.variant.length > 0) next.variant = slot.variant
    normalized[name] = next
  }

  return {
    heavy,
    rest: { model: restModel },
    placements: { ...placements },
    specifics: normalized,
  }
}

/** Commit a new (or replacement) profile into the file, optionally activating it. */
export function commitProfile(
  file: ProfilesFile,
  input: { name: string; profile: Profile; setActive?: boolean },
): ProfilesFile {
  return {
    ...file,
    profiles: { ...file.profiles, [input.name]: input.profile },
    active: input.setActive === false ? file.active : input.name,
  }
}

/** Rename a profile, preserving its definition and fixing `active` if needed. */
export function renameProfile(file: ProfilesFile, from: string, to: string): ProfilesFile {
  const profile = file.profiles[from]
  if (!profile) return file

  const profiles = { ...file.profiles }
  delete profiles[from]
  profiles[to] = profile

  return {
    ...file,
    profiles,
    active: file.active === from ? to : file.active,
  }
}

/** Delete a profile, clearing `active` if it pointed at the deleted profile. */
export function deleteProfile(file: ProfilesFile, name: string): ProfilesFile {
  const profiles = { ...file.profiles }
  delete profiles[name]
  return {
    ...file,
    profiles,
    active: file.active === name ? "" : file.active,
  }
}

/** Replace a profile's full definition (models and placements) in place. */
export function updateProfile(file: ProfilesFile, name: string, profile: Profile): ProfilesFile {
  if (!file.profiles[name]) return file
  return { ...file, profiles: { ...file.profiles, [name]: profile } }
}
