import type { AgentInfo } from "./agents.js"
import type { Placement, Profile, ProfilesFile } from "./schema.js"
import type { SelectOption } from "./select.js"

export type { Placement } from "./schema.js"

/** A profile's agent → placement map. */
export type Placements = Record<string, Placement>

/**
 * Default placement for one enumerated agent: primary agents go to `heavy`;
 * subagents and hidden agents go to `rest`. Nothing is excluded by default.
 * `mode: "all"` is primary-capable, so it is treated as `heavy`.
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

/** Copy a profile's placements (including exclusions) into a detached map. */
export function copyPlacements(profile: Profile): Placements {
  return { ...profile.placements }
}

/** Resolve an agent's placement, defaulting an absent agent to the `rest` tier. */
export function placementOf(placements: Placements, name: string): Placement {
  return placements[name] ?? "rest"
}

/** Cycle a placement heavy → rest → excluded → heavy for the placement editor. */
export function nextPlacement(current: Placement): Placement {
  switch (current) {
    case "heavy":
      return "rest"
    case "rest":
      return "excluded"
    default:
      return "heavy"
  }
}

/** Set an agent's placement, returning a new placement map (input untouched). */
export function setPlacement(placements: Placements, name: string, placement: Placement): Placements {
  return { ...placements, [name]: placement }
}

const PLACEMENT_LABEL: Record<Placement, string> = {
  heavy: "heavy",
  rest: "rest",
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

/** Assemble a profile from the two chosen model slots and its placements. */
export function buildProfile(
  heavyModel: string,
  restModel: string,
  placements: Placements,
  heavyVariant?: string,
): Profile {
  const heavy: Profile["heavy"] = { model: heavyModel }
  if (heavyVariant && heavyVariant.length > 0) heavy.variant = heavyVariant
  return { heavy, rest: { model: restModel }, placements: { ...placements } }
}

/** Commit a new (or replacement) profile into the file, optionally activating it. */
export function commitProfile(
  file: ProfilesFile,
  input: { name: string; profile: Profile; setActive?: boolean },
): ProfilesFile {
  return {
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
