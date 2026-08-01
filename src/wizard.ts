import type { AgentInfo } from "./agents.js"
import type { Profile, ProfilesFile, TierName } from "./schema.js"
import type { SelectOption } from "./select.js"

/**
 * The wizard's per-agent placement: either a capability tier or "excluded"
 * (the switch never touches that agent's model). This is what the assignment
 * editor cycles an agent through.
 */
export type Placement = TierName | "excluded"

/**
 * Default placement for one enumerated agent (decision #15): primary agents go
 * to `heavy`; subagents and hidden agents go to `rest`. Nothing is excluded by
 * default. `mode: "all"` is primary-capable, so it is treated as `heavy`.
 */
export function defaultPlacement(agent: AgentInfo): TierName {
  if (agent.hidden) return "rest"
  return agent.mode === "primary" || agent.mode === "all" ? "heavy" : "rest"
}

/** Build the shared agent→tier assignment map from enumerated agents. */
export function defaultAssignment(agents: readonly AgentInfo[]): Record<string, TierName> {
  const assignment: Record<string, TierName> = {}
  for (const agent of agents) assignment[agent.name] = defaultPlacement(agent)
  return assignment
}

/** Resolve an agent's current placement given an assignment + exclusion list. */
export function placementOf(
  file: Pick<ProfilesFile, "assignment" | "exclusions">,
  name: string,
): Placement {
  if (file.exclusions.includes(name)) return "excluded"
  return file.assignment[name] ?? "rest"
}

/** Cycle a placement heavy → rest → excluded → heavy for the assignment editor. */
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

/**
 * Apply a placement to an agent, returning a new (assignment, exclusions) pair.
 * "excluded" removes the assignment and adds the name to exclusions; a tier does
 * the inverse.
 */
export function setPlacement(
  file: Pick<ProfilesFile, "assignment" | "exclusions">,
  name: string,
  placement: Placement,
): Pick<ProfilesFile, "assignment" | "exclusions"> {
  const assignment = { ...file.assignment }
  const exclusions = file.exclusions.filter((agent) => agent !== name)

  if (placement === "excluded") {
    delete assignment[name]
    exclusions.push(name)
  } else {
    assignment[name] = placement
  }
  return { assignment, exclusions }
}

const PLACEMENT_LABEL: Record<Placement, string> = {
  heavy: "heavy",
  rest: "rest",
  excluded: "excluded",
}

/**
 * Options for the assignment editor: one row per agent showing its current
 * placement, plus a trailing "Done" row. Selecting an agent row cycles its
 * placement; selecting "Done" leaves the editor.
 */
export function buildAssignmentOptions(
  file: Pick<ProfilesFile, "assignment" | "exclusions">,
  agents: readonly AgentInfo[],
): SelectOption<{ kind: "agent"; name: string } | { kind: "done" }>[] {
  const options: SelectOption<{ kind: "agent"; name: string } | { kind: "done" }>[] = agents.map(
    (agent) => {
      const placement = placementOf(file, agent.name)
      return {
        title: agent.name,
        value: { kind: "agent" as const, name: agent.name },
        description: `→ ${PLACEMENT_LABEL[placement]}`,
        category: "Agents",
      }
    },
  )
  options.push({ title: "✓ Done", value: { kind: "done" }, description: "Save assignment" })
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

/** Assemble a profile from the two chosen model slots. */
export function buildProfile(
  heavyModel: string,
  restModel: string,
  heavyVariant?: string,
): Profile {
  const heavy: Profile["heavy"] = { model: heavyModel }
  if (heavyVariant && heavyVariant.length > 0) heavy.variant = heavyVariant
  return { heavy, rest: { model: restModel } }
}

/**
 * Commit a new (or replacement) profile into the file and make it active. When
 * `assignment`/`exclusions` are provided (first-run wizard) they replace the
 * shared maps; otherwise the existing shared maps are kept.
 */
export function commitProfile(
  file: ProfilesFile,
  input: {
    name: string
    profile: Profile
    assignment?: Record<string, TierName>
    exclusions?: string[]
    setActive?: boolean
  },
): ProfilesFile {
  return {
    assignment: input.assignment ?? file.assignment,
    exclusions: input.exclusions ?? file.exclusions,
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

/** Replace a profile's model slots in place (used by "edit models…"). */
export function updateProfileModels(
  file: ProfilesFile,
  name: string,
  profile: Profile,
): ProfilesFile {
  if (!file.profiles[name]) return file
  return { ...file, profiles: { ...file.profiles, [name]: profile } }
}
