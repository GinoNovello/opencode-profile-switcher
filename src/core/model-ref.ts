import type { EffectiveSlot } from "./schema.js"

/**
 * A model split into the parts a host addresses it by: opencode 2.0 keeps
 * `{ providerID, id, variant? }` at runtime and writes `provider/model#variant`
 * on disk, while `profiles.json` keeps `"provider/model"` with the variant
 * apart. The model id may itself contain `/` (e.g. `openrouter/anthropic/x`);
 * the provider is everything before the first `/`.
 */
export interface ModelRef {
  providerID: string
  modelID: string
  variant?: string
}

/**
 * Parse `provider/model` or `provider/model#variant`, with the same rules as
 * opencode 2.0's own parser: a non-empty provider before the first `/`, a
 * non-empty model id, and at most one `#` (after the provider) introducing a
 * non-empty variant. Returns `undefined` instead of throwing so a hand-edited
 * `profiles.json` can never break a boot.
 */
export function parseModelRef(input: string): ModelRef | undefined {
  const providerEnd = input.indexOf("/")
  if (providerEnd <= 0) return undefined
  const providerID = input.slice(0, providerEnd)
  const variantStart = input.indexOf("#", providerEnd + 1)
  const modelID = input.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
  const variant = variantStart === -1 ? undefined : input.slice(variantStart + 1)
  if (!modelID || providerID.includes("#")) return undefined
  if (variant !== undefined && (!variant || variant.includes("#"))) return undefined
  return variant ? { providerID, modelID, variant } : { providerID, modelID }
}

/** Serialize to `provider/model`, plus `#variant` when there is one. */
export function formatModelRef(ref: ModelRef): string {
  const base = `${ref.providerID}/${ref.modelID}`
  return ref.variant ? `${base}#${ref.variant}` : base
}

/**
 * A `profiles.json` slot as a model ref. The slot's `variant` field wins; a
 * `#variant` embedded in `model` is not part of the `profiles.json` format, so
 * such a slot is rejected rather than guessed at.
 */
export function slotToModelRef(slot: EffectiveSlot): ModelRef | undefined {
  const ref = parseModelRef(slot.model)
  if (!ref || ref.variant !== undefined) return undefined
  return slot.variant ? { ...ref, variant: slot.variant } : ref
}

/** A model ref as a `profiles.json` slot (`"provider/model"` + variant apart). */
export function modelRefToSlot(ref: ModelRef): EffectiveSlot {
  const model = formatModelRef({ providerID: ref.providerID, modelID: ref.modelID })
  return ref.variant ? { model, variant: ref.variant } : { model }
}
