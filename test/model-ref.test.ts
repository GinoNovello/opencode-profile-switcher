import { describe, expect, test } from "bun:test"
import {
  formatModelRef,
  modelRefToSlot,
  parseModelRef,
  slotToModelRef,
} from "../src/core/model-ref.js"

describe("parseModelRef", () => {
  test("splits provider and model at the first slash", () => {
    expect(parseModelRef("zai/glm-5")).toEqual({ providerID: "zai", modelID: "glm-5" })
    expect(parseModelRef("openrouter/anthropic/claude")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude",
    })
  })

  test("reads a #variant suffix", () => {
    expect(parseModelRef("zai/glm-5#max")).toEqual({
      providerID: "zai",
      modelID: "glm-5",
      variant: "max",
    })
  })

  test("rejects malformed references instead of throwing", () => {
    const malformed = ["", "glm-5", "/glm-5", "zai/", "zai/#max", "zai/glm#", "zai/glm#a#b", "z#ai/glm"]
    for (const input of malformed) {
      expect(parseModelRef(input)).toBeUndefined()
    }
  })
})

describe("formatModelRef", () => {
  test("round-trips with parseModelRef", () => {
    for (const input of ["zai/glm-5", "zai/glm-5#max", "openrouter/a/b#high"]) {
      expect(formatModelRef(parseModelRef(input)!)).toBe(input)
    }
  })
})

describe("slot conversion", () => {
  test("a slot's variant travels apart from the model", () => {
    expect(slotToModelRef({ model: "zai/glm-5", variant: "max" })).toEqual({
      providerID: "zai",
      modelID: "glm-5",
      variant: "max",
    })
    expect(slotToModelRef({ model: "zai/glm-4" })).toEqual({ providerID: "zai", modelID: "glm-4" })
  })

  test("a slot whose model is malformed or embeds #variant is rejected", () => {
    expect(slotToModelRef({ model: "glm-5" })).toBeUndefined()
    expect(slotToModelRef({ model: "zai/glm-5#max" })).toBeUndefined()
  })

  test("a ref becomes a profiles.json slot", () => {
    expect(modelRefToSlot({ providerID: "zai", modelID: "glm-5", variant: "max" })).toEqual({
      model: "zai/glm-5",
      variant: "max",
    })
    expect(modelRefToSlot({ providerID: "zai", modelID: "glm-4" })).toEqual({ model: "zai/glm-4" })
  })
})
