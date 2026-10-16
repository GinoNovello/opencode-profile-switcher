import type { ModelInfo, ProviderInfo } from "@opencode/client"
import type { ProviderLike } from "../../../src/core/models.js"

/** Adapt the live v2 collections; profile keys use the public model id. */
export function mapProviders(
  providers: readonly Pick<ProviderInfo, "id" | "name" | "activation">[],
  models: readonly Pick<ModelInfo, "id" | "providerID" | "name" | "enabled" | "variants">[],
): ProviderLike[] {
  return providers.filter((provider) => provider.activation !== "disabled").map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: Object.fromEntries(models
      .filter((model) => model.providerID === provider.id && model.enabled)
      .map((model) => [model.id, {
        id: model.id,
        name: model.name,
        variants: Object.fromEntries(model.variants.map((variant) => [variant.id, {}])),
      }])),
  }))
}
