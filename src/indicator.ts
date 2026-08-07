import type { Profile } from "./schema.js"

/**
 * Persistent profile indicator shown to the right of the prompt
 * (`home_prompt_right` / `session_prompt_right` slots). See CONTEXT.md
 * ("Indicador de perfil").
 *
 * This module is pure and headless-testable: every formatting decision lives
 * here as a plain function. The TUI (`tui.ts`) only wires these functions to
 * Solid signals and the slot registry — it holds no logic of its own.
 */

/**
 * Terminal width below which the indicator collapses to just the profile name,
 * yielding the ` · model` suffix's space to the prompt. Tunable constant: the
 * full hint ("performance · glm-5.2") is ~22 chars, so we only collapse on
 * genuinely narrow terminals.
 */
export const NARROW_WIDTH = 60

/** Separator between profile name and short heavy model in the full hint. */
export const INDICATOR_SEPARATOR = " · "

/**
 * Derive the short heavy-model name shown next to the profile: the segment
 * after the last `/` of the stored `provider/model` string. A bare model id
 * (no provider) is returned as-is. Empty/whitespace input yields "".
 *
 *   "zai/glm-5.2"      -> "glm-5.2"
 *   "glm-5.2"          -> "glm-5.2"
 *   "anthropic/opus-5" -> "opus-5"
 *   ""                 -> ""
 */
export function shortModelName(modelString: string): string {
  const trimmed = (modelString ?? "").trim()
  if (trimmed.length === 0) return ""
  const slash = trimmed.lastIndexOf("/")
  const short = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  return short.trim()
}

export interface IndicatorInput {
  /** The currently active profile name (`profiles.json` `active`). */
  active: string
  /** The active profile object, or `undefined` when absent/invalid. */
  profile: Profile | undefined
  /** Current terminal width in columns. */
  width: number
}

/**
 * Format the persistent profile indicator text.
 *
 * Closed requirements:
 * - No active profile (`active` empty or `profile` missing) -> `null`, so the
 *   slot renders nothing at all.
 * - Narrow terminal (`width < NARROW_WIDTH`) -> just the profile name.
 * - Heavy model absent/invalid (empty short name) -> just the profile name.
 * - Otherwise -> `` `${active} · ${shortHeavyModel}` ``.
 *
 * Returns `null` (not `""`) so the slot's null-render path is taken and zero
 * output is produced, rather than an empty styled span.
 */
export function formatProfileIndicator(input: IndicatorInput): string | null {
  const { active, profile, width } = input
  if (!active || !profile) return null

  const heavyShort = shortModelName(profile.heavy.model)
  if (heavyShort.length === 0 || width < NARROW_WIDTH) return active
  return `${active}${INDICATOR_SEPARATOR}${heavyShort}`
}
