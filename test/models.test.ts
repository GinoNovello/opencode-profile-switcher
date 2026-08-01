import { describe, expect, test } from "bun:test"
import {
  buildModelOptions,
  buildVariantOptions,
  findModel,
  listModels,
  modelString,
  NO_VARIANT,
  type ProviderLike,
} from "../src/models.js"

const providers: ProviderLike[] = [
  {
    id: "zai",
    name: "Z.ai",
    models: {
      "glm-5": { id: "glm-5", name: "GLM 5", variants: { max: {}, min: {} } },
      "glm-4": { id: "glm-4", name: "GLM 4" },
    },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: {
      opus: { id: "claude-opus", name: "Claude Opus" },
    },
  },
]

describe("modelString", () => {
  test("joins provider and model with a slash", () => {
    expect(modelString("zai", "glm-5")).toBe("zai/glm-5")
  })
})

describe("listModels", () => {
  test("flattens every provider's models sorted by provider then model name", () => {
    const models = listModels(providers)
    expect(models.map((m) => m.modelString)).toEqual(["anthropic/claude-opus", "zai/glm-4", "zai/glm-5"])
  })

  test("captures variant keys", () => {
    const glm5 = listModels(providers).find((m) => m.modelString === "zai/glm-5")
    expect(glm5?.variants.sort()).toEqual(["max", "min"])
  })

  test("model with no variants yields an empty variant list", () => {
    const glm4 = listModels(providers).find((m) => m.modelString === "zai/glm-4")
    expect(glm4?.variants).toEqual([])
  })

  test("falls back to the map key when model id is missing", () => {
    const models = listModels([{ id: "x", models: { "the-key": { id: "" } } }])
    expect(models[0]?.modelString).toBe("x/the-key")
  })

  test("empty provider list yields no models", () => {
    expect(listModels([])).toEqual([])
  })
})

describe("findModel", () => {
  test("locates a model by its provider/model string", () => {
    expect(findModel(providers, "zai/glm-5")?.modelName).toBe("GLM 5")
  })
  test("returns undefined when absent", () => {
    expect(findModel(providers, "zai/nope")).toBeUndefined()
  })
})

describe("buildModelOptions", () => {
  test("produces one option per model, categorized by provider", () => {
    const options = buildModelOptions(providers)
    expect(options).toHaveLength(3)
    const glm5 = options.find((o) => o.value === "zai/glm-5")
    expect(glm5?.title).toBe("GLM 5")
    expect(glm5?.category).toBe("Z.ai")
    expect(glm5?.description).toBe("zai/glm-5")
  })
})

describe("buildVariantOptions", () => {
  test("always leads with a no-variant option", () => {
    const options = buildVariantOptions(["max", "min"])
    expect(options[0]?.value).toBe(NO_VARIANT)
    expect(options.map((o) => o.value)).toEqual([NO_VARIANT, "max", "min"])
  })
  test("no variants yields just the default option", () => {
    expect(buildVariantOptions([])).toHaveLength(1)
  })
})
