import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeProfiles } from "../src/config.js"
import type { ProfilesFile } from "../src/schema.js"
import { switchProfile, type DisposableClient } from "../src/switch.js"

let dir: string
let path: string

const sample: ProfilesFile = {
  profiles: {
    glm: {
      heavy: { model: "zai/glm-5" },
      rest: { model: "zai/glm-4" },
      placements: { build: "heavy" },
      specifics: {},
    },
    grok: {
      heavy: { model: "xai/grok-heavy" },
      rest: { model: "xai/grok-mini" },
      placements: {},
      specifics: {},
    },
  },
  active: "glm",
  effective: { build: { model: "zai/glm-5" } },
}

function mockClient(): DisposableClient & { calls: number } {
  const state = { calls: 0 }
  return {
    get calls() {
      return state.calls
    },
    instance: {
      async dispose() {
        state.calls++
        return { status: 200 }
      },
    },
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "switch-test-"))
  path = join(dir, "profiles.json")
  writeProfiles(sample, path)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("switchProfile", () => {
  test("persists active and calls dispose", async () => {
    const client = mockClient()
    const result = await switchProfile("grok", client, { path })
    expect(result.ok).toBe(true)
    expect(result.active).toBe("grok")
    expect(result.disposed).toBe(true)
    expect(client.calls).toBe(1)
  })

  test("rejects unknown profile without persisting or disposing", async () => {
    const client = mockClient()
    const result = await switchProfile("ghost", client, { path })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("unknown profile")
    expect(client.calls).toBe(0)
  })

  test("dispose=false persists but does not dispose", async () => {
    const client = mockClient()
    const result = await switchProfile("grok", client, { path, dispose: false })
    expect(result.ok).toBe(true)
    expect(result.disposed).toBe(false)
    expect(client.calls).toBe(0)
  })

  test("reports partial success when dispose throws", async () => {
    const client: DisposableClient = {
      instance: {
        async dispose() {
          throw new Error("server gone")
        },
      },
    }
    const result = await switchProfile("grok", client, { path })
    expect(result.ok).toBe(true)
    expect(result.disposed).toBe(false)
    expect(result.error).toContain("live reload failed")
  })
})
