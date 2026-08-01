import type { Profile, ProfilesFile } from "./schema.js"
import type { SelectOption } from "./select.js"
import type { SwitchResult } from "./switch.js"

/**
 * The two synthetic actions that sit at the bottom of the `/profile` picker,
 * below the real profiles. Selecting one enters the wizard rather than
 * switching a profile.
 */
export type PickerAction =
  | { kind: "profile"; name: string }
  | { kind: "new" }
  | { kind: "configure" }

/** Short model label for summaries: the model id without its provider prefix. */
export function shortModel(model: string): string {
  const slash = model.lastIndexOf("/")
  return slash === -1 ? model : model.slice(slash + 1)
}

/** e.g. `heavy: glm-5.2 (max) · rest: glm-4.7`. */
export function describeProfile(profile: Profile): string {
  const heavy = profile.heavy.variant
    ? `${shortModel(profile.heavy.model)} (${profile.heavy.variant})`
    : shortModel(profile.heavy.model)
  return `heavy: ${heavy} · rest: ${shortModel(profile.rest.model)}`
}

/** Profile names in stable, display order (active first, then alphabetical). */
export function orderedProfileNames(profiles: ProfilesFile): string[] {
  const names = Object.keys(profiles.profiles).sort((a, b) => a.localeCompare(b))
  const active = profiles.active
  if (active && names.includes(active)) {
    return [active, ...names.filter((name) => name !== active)]
  }
  return names
}

/**
 * Build the `/profile` picker options: one entry per profile (the active one
 * marked, subtitle summarising its heavy/rest models) followed by the two
 * wizard actions.
 */
export function buildPickerOptions(profiles: ProfilesFile): SelectOption<PickerAction>[] {
  const options: SelectOption<PickerAction>[] = []

  for (const name of orderedProfileNames(profiles)) {
    const profile = profiles.profiles[name]
    if (!profile) continue
    const isActive = name === profiles.active
    options.push({
      title: `${isActive ? "● " : "  "}${name}`,
      value: { kind: "profile", name },
      description: describeProfile(profile),
      category: "Profiles",
    })
  }

  options.push({ title: "＋ New profile", value: { kind: "new" }, description: "Create a profile" })
  options.push({
    title: "⚙ Configure…",
    value: { kind: "configure" },
    description: "Edit, rename or delete profiles; adjust assignment",
  })

  return options
}

/** Toast shown when a profile becomes active. */
export function formatSwitchToast(name: string, profile: Profile): string {
  return `Profile "${name}" active — ${describeProfile(profile)}`
}

/** Toast shown when the picked profile was already the active one. */
export function formatAlreadyActiveToast(name: string): string {
  return `Profile "${name}" is already active`
}

export interface SwitchToast {
  variant: "success" | "warning" | "error"
  message: string
}

/**
 * Map a `switchProfile` result onto a toast. A partial success (persisted but
 * the live reload failed) becomes a warning telling the user to restart; a hard
 * failure becomes an error.
 */
export function switchResultToast(name: string, profile: Profile, result: SwitchResult): SwitchToast {
  if (!result.ok) {
    return { variant: "error", message: `Could not switch profile: ${result.error ?? "unknown error"}` }
  }
  if (!result.disposed) {
    return {
      variant: "warning",
      message: `Profile "${name}" saved but live reload failed — restart opencode to apply it.`,
    }
  }
  return { variant: "success", message: formatSwitchToast(name, profile) }
}
