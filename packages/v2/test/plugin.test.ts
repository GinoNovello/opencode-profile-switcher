import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ProfilesFile } from "../../../src/core/schema.js"
import { setupProfileSwitcher, type SwitcherOptions } from "../src/plugin.js"
import type { StatusOutput } from "../src/rpc.js"
import { FakeHost } from "./helpers/host.js"

const GLM5 = { providerID: "zai", id: "glm-5", variant: "max" }
const GLM4 = { providerID: "zai", id: "glm-4" }
const GPT = { providerID: "openai", id: "gpt-5", variant: "high" }
const MINI = { providerID: "openai", id: "gpt-5-mini" }

function file(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    profiles: {
      glm: {
        heavy: { model: "zai/glm-5", variant: "max" },
        rest: { model: "zai/glm-4" },
        placements: { build: "heavy", plan: "heavy", explore: "rest", title: "rest", summary: "rest", compaction: "rest", reviewer: "rest" },
        specifics: {},
      },
      gpt: {
        heavy: { model: "openai/gpt-5", variant: "high" },
        rest: { model: "openai/gpt-5-mini" },
        placements: { build: "heavy", plan: "heavy", explore: "rest", title: "rest", summary: "rest", compaction: "rest", reviewer: "heavy" },
        specifics: {},
      },
    },
    active: "glm",
    effective: {},
    ...overrides,
  }
}

let dir: string
let path: string
const logs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "profile-switcher-v2-"))
  path = join(dir, "profiles.json")
  logs.length = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function save(profiles: ProfilesFile): void {
  writeFileSync(path, `${JSON.stringify(profiles, null, 2)}\n`)
}

function onDisk(): ProfilesFile {
  return JSON.parse(readFileSync(path, "utf8")) as ProfilesFile
}

/** Set up the plugin, let the host run its initial load, wait for the boot pass. */
async function boot(host: FakeHost, options: SwitcherOptions = {}) {
  const switcher = await setupProfileSwitcher(host.context(), {
    path,
    sleep: async () => {},
    log: (level, message) => logs.push(`${level}: ${message}`),
    ...options,
  })
  host.load()
  await switcher.ready
  return switcher
}

describe("boot", () => {
  test("applies the active profile to built-in and hidden agents and the default model", async () => {
    save(file())
    const host = new FakeHost()
    const switcher = await boot(host)

    expect(host.agent("build")!.model).toEqual(GLM5)
    expect(host.agent("explore")!.model).toEqual(GLM4)
    for (const hidden of ["title", "summary", "compaction"]) {
      expect(host.agent(hidden)!.model).toEqual(GLM4)
    }
    // heavy becomes the catalog default, without its variant.
    expect(host.defaultModel).toEqual({ providerID: "zai", modelID: "glm-5" })
    // No markdown agents: the initial load already wrote everything.
    expect(host.agentReloads).toBe(0)
    expect(switcher.status()).toMatchObject({ ready: true, active: "glm", applied: true, partial: false })
  })

  test("learns markdown agents after the load and reloads once to reach them", async () => {
    save(file())
    const host = new FakeHost({ config: { reviewer: {} } })
    await boot(host)
    expect(host.agentReloads).toBe(1)
    expect(host.agent("reviewer")!.model).toEqual(GLM4)
  })

  test("never creates agents for placements the location lacks", async () => {
    save(file())
    const host = new FakeHost({ builtins: { build: undefined } })
    await boot(host)
    expect(host.agents.map((agent) => agent.id)).toEqual(["build"])
  })

  test("lists the agents only after the transform has run, not on a timer", async () => {
    save(file())
    const host = new FakeHost()
    const switcher = await setupProfileSwitcher(host.context(), { path, log: () => {} })
    await new Promise((done) => setTimeout(done, 5))
    expect(host.listCalls).toBe(0)
    host.load()
    await switcher.ready
    expect(host.listCalls).toBe(1)
  })

  test("retries the first agent list while the location is not ready", async () => {
    save(file())
    const host = new FakeHost({ config: { reviewer: {} }, listFailures: 2 })
    const waits: number[] = []
    const switcher = await boot(host, { sleep: async (ms) => void waits.push(ms), learnDelayMs: 10 })
    expect(waits).toEqual([10, 20])
    expect(host.agent("reviewer")!.model).toEqual(GLM4)
    expect(switcher.status().ready).toBe(true)
  })

  test("gives up after the configured attempts and keeps the built-ins applied", async () => {
    save(file())
    const host = new FakeHost({ config: { reviewer: {} }, listFailures: 99 })
    const switcher = await boot(host, { learnAttempts: 3 })
    expect(switcher.status()).toMatchObject({ ready: false, phase: "failed", agents: [] })
    expect(switcher.status().error).toContain("could not list agents (location not ready)")
    expect(host.agent("build")!.model).toEqual(GLM5)
    expect(host.agent("reviewer")!.model).toBeUndefined()
    expect(logs.some((line) => line.startsWith("warn: could not list agents"))).toBe(true)

    // Not stuck: the next switch learns the agents and settles.
    host.listFailures = 0
    await host.call("switch", { profile: "gpt" })
    expect(switcher.status()).toMatchObject({ ready: true, phase: "ready", error: null })
    expect(host.agent("reviewer")!.model).toEqual(GPT)
  })

  test("the status is pending until the boot pass settles", async () => {
    save(file())
    const host = new FakeHost()
    const switcher = await setupProfileSwitcher(host.context(), { path, log: () => {} })
    expect(switcher.status()).toMatchObject({ ready: false, phase: "pending", error: null })
    host.load()
    await switcher.ready
    expect(switcher.status()).toMatchObject({ ready: true, phase: "ready" })
  })

  test("detects agents fixed by config and reports the profile as partial", async () => {
    save(file())
    const host = new FakeHost({ config: { plan: { model: GPT }, reviewer: { model: MINI } } })
    const switcher = await boot(host)
    const status = switcher.status()
    expect(status.partial).toBe(true)
    expect(status.fixedByConfig).toEqual(["plan", "reviewer"])
    expect(status.agents.find((agent) => agent.id === "plan")).toEqual({
      id: "plan",
      placement: "heavy",
      planned: GLM5,
      model: GPT,
      fixedByConfig: true,
    })
    expect(logs.some((line) => line.includes("partial, model fixed by config: plan, reviewer"))).toBe(true)
  })

  test("persists the effective state of the agents that took the profile only", async () => {
    save(file({ effective: { plan: { model: "old/model" } } }))
    const host = new FakeHost({ config: { plan: { model: GPT } } })
    await boot(host)
    const effective = onDisk().effective
    expect(effective.build).toEqual({ model: "zai/glm-5", variant: "max" })
    expect(effective.title).toEqual({ model: "zai/glm-4" })
    // Fixed by config: the plugin never applied anything, the remembered slot stays.
    expect(effective.plan).toEqual({ model: "old/model" })
  })

  test("an invalid profiles.json leaves every model untouched and is never rewritten", async () => {
    writeFileSync(path, "{ not json")
    const host = new FakeHost({ builtins: { build: MINI } })
    const switcher = await boot(host)
    expect(host.agent("build")!.model).toEqual(MINI)
    expect(host.defaultModel).toBeUndefined()
    expect(readFileSync(path, "utf8")).toBe("{ not json")
    expect(switcher.status()).toMatchObject({ applied: false, reason: "invalid-file", partial: false })
    expect(switcher.status().error).toContain("invalid JSON")
  })

  test("a missing profiles.json is a quiet no-op", async () => {
    const host = new FakeHost()
    const switcher = await boot(host)
    expect(host.agent("build")!.model).toBeUndefined()
    expect(switcher.status()).toMatchObject({ active: null, applied: false, reason: "no-active", error: null })
  })

  test("a slot with an embedded #variant is reported and logged, not skipped in silence", async () => {
    const profiles = file()
    profiles.profiles.glm!.heavy = { model: "zai/glm-5#max" }
    save(profiles)
    const host = new FakeHost()
    const switcher = await boot(host)
    expect(host.agent("build")!.model).toBeUndefined()
    expect(host.defaultModel).toBeUndefined()
    expect(host.agent("explore")!.model).toEqual(GLM4)
    expect(switcher.status().invalidSlots).toEqual([
      { placement: "heavy", agent: null, model: "zai/glm-5#max" },
    ])
    expect(logs).toContain(
      'warn: invalid model, expected provider/model with the variant apart; left untouched: "zai/glm-5#max" for the heavy tier',
    )
  })

  test("an agent left with no model is reported unapplied, not fixed by config", async () => {
    save(file())
    const host = new FakeHost()
    host.dropModel.add("explore")
    const switcher = await boot(host)
    expect(switcher.status()).toMatchObject({ partial: false, fixedByConfig: [], unapplied: ["explore"] })
    expect(logs.some((line) => line.includes("no model after the reload: explore"))).toBe(true)
    expect(logs.some((line) => line.includes("fixed by config"))).toBe(false)
    expect(onDisk().effective.explore).toBeUndefined()
  })

  test("profile names are re-read on each status call", async () => {
    save(file())
    const host = new FakeHost()
    const switcher = await boot(host)
    const edited = file()
    edited.profiles.fresh = { ...edited.profiles.gpt! }
    save(edited)
    expect(switcher.status().profiles).toEqual(["glm", "gpt", "fresh"])
    // A corrupt file falls back to the names already known.
    writeFileSync(path, "{ broken")
    expect(switcher.status().profiles).toEqual(["glm", "gpt"])
  })
})

describe("rpc", () => {
  test("status answers JSON with null instead of undefined", async () => {
    save(file())
    const host = new FakeHost({ config: { plan: { model: GPT } } })
    await boot(host)
    const status = (await host.call("status")) as StatusOutput
    expect(JSON.parse(JSON.stringify(status))).toEqual(status)
    expect(status).toMatchObject({
      ready: true,
      path,
      profiles: ["glm", "gpt"],
      active: "glm",
      applied: true,
      reason: null,
      error: null,
      partial: true,
      fixedByConfig: ["plan"],
      unassigned: [],
    })
    expect(status.agents.find((agent) => agent.id === "explore")).toEqual({
      id: "explore",
      placement: "rest",
      planned: { ...GLM4, variant: null },
      model: { ...GLM4, variant: null },
      fixedByConfig: false,
    })
  })

  test("switch persists the active profile, reloads, emits switched and returns the status", async () => {
    save(file())
    const host = new FakeHost({ config: { reviewer: {} } })
    await boot(host)

    const status = (await host.call("switch", { profile: "gpt" })) as StatusOutput
    expect(onDisk().active).toBe("gpt")
    expect(host.modelReloads).toBe(1)
    expect(host.defaultModel).toEqual({ providerID: "openai", modelID: "gpt-5" })
    expect(host.agent("build")!.model).toEqual(GPT)
    expect(host.agent("explore")!.model).toEqual(MINI)
    // A markdown agent takes the new profile too.
    expect(host.agent("reviewer")!.model).toEqual(GPT)
    expect(status).toMatchObject({ active: "gpt", partial: false, fixedByConfig: [] })
    expect(host.rpc!.emitted).toEqual([
      { name: "switched", data: { profile: "gpt", partial: false, fixedByConfig: [] } },
    ])
    expect(onDisk().effective.reviewer).toEqual({ model: "openai/gpt-5", variant: "high" })
  })

  test("a switch without markdown agents costs a single agent reload", async () => {
    save(file())
    const host = new FakeHost()
    await boot(host)
    await host.call("switch", { profile: "gpt" })
    expect(host.agentReloads).toBe(1)
  })

  test("a markdown agent removed before a switch does not come back as a ghost", async () => {
    save(file())
    const host = new FakeHost({ config: { reviewer: {} } })
    await boot(host)
    expect(host.agent("reviewer")).toBeDefined()

    delete host.config.reviewer
    await host.call("switch", { profile: "gpt" })
    expect(host.agent("reviewer")).toBeUndefined()

    // A host-initiated reload after the switch must not resurrect it either.
    await host.context().agent.reload()
    expect(host.agent("reviewer")).toBeUndefined()
  })

  test("a markdown agent added after boot is picked up by the next switch", async () => {
    save(file())
    const host = new FakeHost()
    await boot(host)
    host.config.reviewer = {}
    await host.call("switch", { profile: "gpt" })
    expect(host.agent("reviewer")!.model).toEqual(GPT)
    expect(host.agentReloads).toBe(2)
  })

  test("switch reports agents fixed by config in the event", async () => {
    save(file())
    const host = new FakeHost({ config: { build: { model: MINI } } })
    await boot(host)
    await host.call("switch", { profile: "gpt" })
    expect(host.rpc!.emitted.at(-1)).toEqual({
      name: "switched",
      data: { profile: "gpt", partial: true, fixedByConfig: ["build"] },
    })
  })

  test("switch to an unknown profile fails without touching the file", async () => {
    save(file())
    const host = new FakeHost()
    await boot(host)
    const before = readFileSync(path, "utf8")
    const result = await host.call("switch", { profile: "nope" })
    expect(result).toMatchObject({ rpcError: true, type: "unknown_profile", data: null })
    expect(readFileSync(path, "utf8")).toBe(before)
    expect(host.rpc!.emitted).toEqual([])
  })

  test("switch refuses a corrupt profiles.json", async () => {
    save(file())
    const host = new FakeHost()
    await boot(host)
    writeFileSync(path, "{ broken")
    const result = await host.call("switch", { profile: "gpt" })
    expect(result).toMatchObject({ rpcError: true, type: "invalid_profiles" })
    expect(readFileSync(path, "utf8")).toBe("{ broken")
  })

  test("a failed reload is reported after persisting the profile", async () => {
    save(file())
    const host = new FakeHost()
    await boot(host)
    host.failReload = true
    const result = await host.call("switch", { profile: "gpt" })
    expect(result).toMatchObject({ rpcError: true, type: "reload_failed" })
    expect(onDisk().active).toBe("gpt")
    expect(host.rpc!.emitted).toEqual([])
  })

  test("after a failed reload the status reports the failure, never the old profile's agents", async () => {
    save(file())
    const host = new FakeHost({ config: { plan: { model: MINI } } })
    await boot(host)
    expect((await host.call("status")) as StatusOutput).toMatchObject({ partial: true })

    host.failReload = true
    await host.call("switch", { profile: "gpt" })
    const failed = (await host.call("status")) as StatusOutput
    expect(failed).toMatchObject({
      ready: false,
      phase: "failed",
      active: "gpt",
      partial: false,
      fixedByConfig: [],
      unassigned: [],
      agents: [],
    })
    expect(failed.error).toContain("reload exploded")

    // The next switch runs a full pass again.
    host.failReload = false
    await host.call("switch", { profile: "gpt" })
    expect((await host.call("status")) as StatusOutput).toMatchObject({
      ready: true,
      phase: "ready",
      error: null,
      fixedByConfig: ["plan"],
    })
  })

  test("concurrent switches run one after the other", async () => {
    save(file())
    const host = new FakeHost({ config: { reviewer: {} } })
    await boot(host)
    const [first, second] = (await Promise.all([
      host.call("switch", { profile: "gpt" }),
      host.call("switch", { profile: "glm" }),
    ])) as StatusOutput[]
    expect(first!.active).toBe("gpt")
    expect(second!.active).toBe("glm")
    expect(host.agent("reviewer")!.model).toEqual(GLM4)
    expect(host.rpc!.emitted.map((event) => (event.data as { profile: string }).profile)).toEqual(["gpt", "glm"])
  })
})

describe("cleanup", () => {
  test("disposes the RPC and both transforms", async () => {
    save(file())
    const host = new FakeHost()
    const switcher = await boot(host)
    await switcher.cleanup()
    expect(host.rpc!.disposed).toBe(true)
    expect(host.transformsDisposed).toBe(2)
  })
})
