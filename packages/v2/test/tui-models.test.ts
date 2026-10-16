import { expect, test } from "bun:test"
import { listModels } from "../../../src/core/models.js"
import { mapProviders } from "../src/tui-models.js"

test("maps live providers/models by public ids, filtering disabled entries and adapting variant arrays", () => {
  const providers = [
    { id: "online", name: "Connected", activation: "enabled" },
    { id: "auto", name: "Automatic", activation: "auto" },
    { id: "off", name: "Disabled", activation: "disabled" },
  ] as Parameters<typeof mapProviders>[0]
  const models = [
    { id: "public/model", providerID: "online", name: "Friendly", enabled: true, variants: [{ id: "max" }, { id: "low" }] },
    { id: "hidden", providerID: "online", name: "Hidden", enabled: false, variants: [] },
    { id: "small", providerID: "auto", name: "Small", enabled: true, variants: [] },
    { id: "disabled", providerID: "off", name: "Disabled", enabled: true, variants: [] },
    { id: "orphan", providerID: "missing", name: "Orphan", enabled: true, variants: [] },
  ] as Parameters<typeof mapProviders>[1]
  const mapped = mapProviders(providers, models)
  expect(mapped).toEqual([
    { id: "online", name: "Connected", models: { "public/model": { id: "public/model", name: "Friendly", variants: { max: {}, low: {} } } } },
    { id: "auto", name: "Automatic", models: { small: { id: "small", name: "Small", variants: {} } } },
  ])
  expect(listModels(mapped).map((model) => ({ ref: model.modelString, variants: model.variants }))).toEqual([
    { ref: "auto/small", variants: [] }, { ref: "online/public/model", variants: ["max", "low"] },
  ])
  expect(models[0]!.variants).toEqual([{ id: "max" }, { id: "low" }])
  expect(mapProviders(providers, [])).toEqual([
    { id: "online", name: "Connected", models: {} }, { id: "auto", name: "Automatic", models: {} },
  ])
  expect(mapProviders([], [])).toEqual([])
})
