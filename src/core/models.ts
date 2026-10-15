import type { SelectOption } from "./select.js"

/**
 * The subset of a `Model` (`@opencode-ai/sdk/v2`) the wizard consumes. Kept
 * structural so the real SDK `Model` is assignable without a hard dependency.
 */
export interface ModelLike {
  id: string
  name?: string
  variants?: Record<string, unknown>
}

/**
 * The subset of a `Provider` (`@opencode-ai/sdk/v2`) we read. `api.state.provider`
 * (the TUI's list of configured/connected providers) yields exactly this shape.
 */
export interface ProviderLike {
  id: string
  name?: string
  models: Record<string, ModelLike>
}

/** A single selectable model, flattened across providers. */
export interface ModelChoice {
  /** The `providerID/modelID` string stored in a profile and read by opencode. */
  modelString: string
  providerID: string
  providerName: string
  modelID: string
  modelName: string
  /** Variant keys available for this model (e.g. reasoning-effort flavours). */
  variants: string[]
}

/** Build the canonical `providerID/modelID` reference opencode expects. */
export function modelString(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

/**
 * Flatten every connected provider's models into a sorted, de-duplicated list of
 * choices. Providers with no models are skipped. Sorted by provider name then
 * model name for a stable, browsable picker.
 */
export function listModels(providers: readonly ProviderLike[]): ModelChoice[] {
  const choices: ModelChoice[] = []

  for (const provider of providers) {
    const providerName = provider.name && provider.name.length > 0 ? provider.name : provider.id
    for (const [key, model] of Object.entries(provider.models ?? {})) {
      const modelID = model.id && model.id.length > 0 ? model.id : key
      choices.push({
        modelString: modelString(provider.id, modelID),
        providerID: provider.id,
        providerName,
        modelID,
        modelName: model.name && model.name.length > 0 ? model.name : modelID,
        variants: Object.keys(model.variants ?? {}),
      })
    }
  }

  choices.sort(
    (a, b) =>
      a.providerName.localeCompare(b.providerName) || a.modelName.localeCompare(b.modelName),
  )
  return choices
}

/** Look up a single choice by its `providerID/modelID` string. */
export function findModel(
  providers: readonly ProviderLike[],
  wanted: string,
): ModelChoice | undefined {
  return listModels(providers).find((choice) => choice.modelString === wanted)
}

/**
 * Turn the model list into picker options grouped by provider. `value` is the
 * `providerID/modelID` string ready to store in a profile.
 */
export function buildModelOptions(providers: readonly ProviderLike[]): SelectOption<string>[] {
  return listModels(providers).map((choice) => ({
    title: choice.modelName,
    value: choice.modelString,
    description: choice.modelString,
    category: choice.providerName,
  }))
}

/** The sentinel value used by the "no variant" option in the variant picker. */
export const NO_VARIANT = ""

/**
 * Build variant options for a heavy-tier model. Always includes a leading
 * "no variant" entry (value `NO_VARIANT`). Returns just the single default
 * entry when the model has no variants.
 */
export function buildVariantOptions(variants: readonly string[]): SelectOption<string>[] {
  const options: SelectOption<string>[] = [{ title: "Default (no variant)", value: NO_VARIANT }]
  for (const variant of variants) options.push({ title: variant, value: variant })
  return options
}
