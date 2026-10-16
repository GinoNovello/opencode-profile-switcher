import { describe, expect, test, spyOn } from "bun:test"
import { testRender } from "@opentui/solid"
import { jsx } from "@opentui/solid/jsx-runtime"
import { EventEmitter } from "node:events"
import type { Plugin } from "@opencode/plugin/tui"
import { setupTui, switchMessage } from "../src/tui-plugin.js"
import { ProfileSwitcherRpc, type StatusOutput } from "../src/rpc.js"
import type { RpcClient, RpcEventPayload } from "@opencode/client"
import type { ProfilesFile } from "../../../src/core/schema.js"

const profile = { heavy: { model: "p/heavy", variant: "max" }, rest: { model: "p/rest" }, placements: {}, specifics: {} }
const file: ProfilesFile = { active: "one", profiles: { one: profile, two: profile }, effective: {} }
function status(overrides: Partial<StatusOutput> = {}): StatusOutput {
  return { ready: true, phase: "ready", path: "/fake/profiles.json", profiles: ["one", "two"], active: "one", applied: true, reason: null, error: null, partial: false, fixedByConfig: [], unapplied: [], unassigned: [], invalidSlots: [], agents: [{ id: "custom", placement: "heavy", planned: { providerID: "p", id: "heavy", variant: "max" }, model: { providerID: "config", id: "effective", variant: "high" }, fixedByConfig: true }], ...overrides }
}
function fake(route: { type: string; sessionID?: string } = { type: "session", sessionID: "focused" }, initialStatus?: () => Promise<StatusOutput>) {
  const calls: unknown[][] = []
  const toasts: { message: string; variant: string }[] = []
  const renderer = Object.assign(new EventEmitter(), { width: 100 })
  let command: { run: () => Promise<void> }
  let event: () => void = () => {}
  let slot: { append: string; render: () => unknown }
  let stopped = false
  let slotStopped = false
  let state = status()
  let failure: { type: string; message: string } | undefined
  let statusHook: (() => Promise<StatusOutput>) | undefined = initialStatus
  let read = structuredClone(file)
  let readHook: (() => Promise<ProfilesFile>) | undefined
  let selectHook: (() => Promise<unknown>) | undefined
  let switchHook: (() => Promise<void>) | undefined
  let retarget = true
  let cacheModel: { providerID: string; id: string; variant?: string } | undefined
  let currentLocation = { directory: "/test" }
  let response: unknown = { kind: "profile", name: "two" }
  let queue: unknown[] | undefined
  const rpc: RpcClient<typeof ProfileSwitcherRpc> = {
    status: async (_: unknown, options: unknown) => { calls.push(["status", options]); return statusHook ? await statusHook() : state },
    readProfiles: async () => readHook ? await readHook() : read,
    switch: async (input: unknown, options: unknown) => { calls.push(["switch", input, options]); if (failure) throw failure; await switchHook?.(); state = { ...state, phase: "ready", active: (input as { profile: string }).profile }; return state },
    saveProfiles: async (input, options) => { const draft = input as Pick<ProfilesFile, "profiles" | "active">; calls.push(["saveProfiles", input, options]); const renamed = retarget && state.phase === "ready" && draft.active !== read.active && !Object.hasOwn(draft.profiles, read.active) && JSON.stringify(draft.profiles[draft.active]) === JSON.stringify(read.profiles[read.active]); read = { ...draft, effective: {} }; if (renamed) state = { ...state, active: draft.active }; else if (!draft.active) state = { ...state, active: null, agents: [] }; return { ...read, renamed } },
    events: { subscribe: async function* () {}, on: (name, callback) => { event = () => { void callback({ id: "event-test", created: 1, type: "rpc.opencode-profile-switcher.switched", data: { profile: state.active ?? "", partial: false, fixedByConfig: [] }, location: { directory: "/test" } } as RpcEventPayload<typeof ProfileSwitcherRpc, typeof name>) }; return () => { stopped = true } } },
  }
  const ctx = {
    location: undefined,
    client: { rpc: () => rpc, session: {
      get: async (input: unknown) => { calls.push(["get", input]); return { agent: "custom" } },
      switchModel: async (input: unknown) => { calls.push(["switchModel", input]) },
    } },
    renderer, theme: { text: { muted: "#888888" } },
    data: { location: { default: () => currentLocation, agent: {
      invalidate: (location: unknown) => { calls.push(["invalidate", location]) },
      sync: async (location: unknown) => { calls.push(["sync", location]) },
      list: (at: unknown) => { calls.push(["agents", at]); return [{ model: cacheModel, id: "custom", name: "Display name", mode: "primary", hidden: false }] },
    }, provider: { sync: async () => {}, list: () => [{ id: "p", name: "Provider", activation: "enabled" }] },
    model: { sync: async () => {}, list: () => [{ id: "heavy", providerID: "p", name: "Heavy", enabled: true, variants: [{ id: "max" }] }] } } },
    keymap: { layer: (factory: () => { commands: { run: () => Promise<void> }[] }) => { command = factory().commands[0]! } },
    ui: { router: { current: () => route }, dialog: { clear: () => { calls.push(["clear"]) }, select: async () => selectHook ? await selectHook() : queue ? queue.shift() : response, prompt: async () => queue?.shift(), confirm: async () => queue?.shift() },
      toast: { show: (toast: { message: string; variant: string }) => toasts.push(toast) },
      slot: (claim: { append: string; render: () => unknown }) => { slot = claim; return () => { slotStopped = true } },
    },
  } as unknown as Plugin.Context
  const cleanup = setupTui(ctx)
  return { calls, toasts, renderer, cleanup, run: async () => command.run(), event: () => event(),
    retarget: (value: boolean) => { retarget = value },
    cacheModel: (value: typeof cacheModel) => { cacheModel = value },
    state: (value: StatusOutput) => { state = value }, fail: (type: string) => { failure = { type, message: `Host detail for ${type}` } },
    statusHook: (value?: () => Promise<StatusOutput>) => { statusHook = value },
    readHook: (value?: () => Promise<ProfilesFile>) => { readHook = value },
    selectHook: (value: () => Promise<unknown>) => { selectHook = value },
    switchHook: (value: () => Promise<void>) => { switchHook = value },
    location: (value: { directory: string }) => { currentLocation = value },
    file: (value: ProfilesFile) => { read = value },
    choice: (value: unknown) => { response = value }, choices: (values: unknown[]) => { queue = values }, slot: () => slot, stopped: () => stopped && slotStopped }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("v2 /profile", () => {
  test("switches RPC, refreshes cache in order, then moves only the focused session using its agent's effective model", async () => {
    const host = fake()
    await tick()
    await host.run()
    expect(host.calls.filter(([name]) => name !== "status")).toEqual([
      ["switch", { profile: "two" }, { location: { directory: "/test" } }],
      ["invalidate", { directory: "/test" }], ["sync", { directory: "/test" }],
      ["get", { sessionID: "focused" }],
      ["switchModel", { sessionID: "focused", model: { providerID: "config", id: "effective", variant: "high" } }],
    ])
    expect(host.toasts.at(-1)?.message).toContain("Other tabs keep their models")
    host.cleanup()
  })
  for (const type of ["home", "custom"]) test(`does not write a session on the ${type} route`, async () => {
    const host = fake({ type }); await tick(); await host.run()
    expect(host.calls.map(([name]) => name)).not.toContain("switchModel")
    expect(host.calls.map(([name]) => name)).toContain("sync")
    host.cleanup()
  })
  test("omits null variants and leaves a session alone when its agent has no model", async () => {
    const host = fake(); await tick()
    host.state(status({ agents: [{ ...status().agents[0]!, model: { providerID: "p", id: "m", variant: null } }] }))
    await host.run()
    expect(host.calls.find(([name]) => name === "switchModel")?.[1]).toEqual({ sessionID: "focused", model: { providerID: "p", id: "m" } })
    host.cleanup()
    const missing = fake(); await tick(); missing.state(status({ agents: [] })); await missing.run()
    expect(missing.calls.map(([name]) => name)).not.toContain("switchModel"); missing.cleanup()
  })
  for (const code of ["unknown_profile", "invalid_profiles", "reload_failed", "conflict", "invalid_profile"]) test(`reports ${code} without moving sessions`, async () => {
    const host = fake(); await tick(); host.fail(code); await host.run()
    expect(host.toasts.at(-1)?.message).toContain(`Host detail for ${code}`)
    expect(host.toasts.at(-1)?.message).not.toContain("[object Object]")
    expect(host.calls.map(([name]) => name)).not.toContain("sync"); host.cleanup()
  })
  test("cancelled picker has no writes", async () => {
    const host = fake(); await tick(); host.choice(undefined); await host.run()
    expect(host.calls.map(([name]) => name)).not.toContain("switch"); host.cleanup()
  })
  test("failed boot reports once and allows switching to retry", async () => {
    const host = fake(); await tick(); host.state(status({ ready: false, phase: "failed", error: "reload unavailable" })); await host.run()
    expect(host.toasts.some((toast) => toast.message.includes("reload unavailable"))).toBe(true)
    expect(host.calls.map(([name]) => name)).toContain("switch"); host.cleanup()
  })
  test("polls pending until ready, refreshes events and resize, and disposes all listeners", async () => {
    const host = fake(); host.state(status({ ready: false, phase: "pending" })); await tick(); host.event(); await tick()
    const before = host.calls.length; host.state(status()); await new Promise((resolve) => setTimeout(resolve, 280))
    expect(host.calls.length).toBeGreaterThan(before)
    host.event(); await tick(); host.renderer.emit("resize"); await tick()
    host.cleanup(); expect(host.stopped()).toBe(true); expect(host.renderer.listenerCount("resize")).toBe(0)
    const count = host.calls.length; await new Promise((resolve) => setTimeout(resolve, 280)); expect(host.calls.length).toBe(count)
  })
  test("partial and invalid application outcomes identify affected agents", () => {
    expect(switchMessage(status({ partial: true, fixedByConfig: ["custom"], unapplied: ["title"], invalidSlots: [{ placement: "heavy", agent: null, model: "bad" }] }))).toContain("parcial — fixed by config: custom")
    expect(switchMessage(status({ unapplied: ["title"] }))).toContain("Unapplied: title")
    expect(switchMessage(status({ invalidSlots: [{ placement: "heavy", agent: null, model: "bad" }] }))).toContain("Invalid slots: heavy: bad")
  })
})


test("indicator paints muted text, reacts to events and width, and clears with no active profile", async () => {
  const host = fake(); await tick()
  expect(host.slot().append).toBe("prompt.footer.status")
  const view = await testRender(() => jsx("box", { children: host.slot().render() }) as never, { width: 80, height: 3 })
  await view.renderOnce()
  expect(view.captureCharFrame()).toContain("one · heavy")
  const span = view.captureSpans().lines[0]?.spans.find((span) => span.text.includes("one"))
  expect(span?.fg.r).toBeCloseTo(0x88 / 255, 2)
  host.state(status({ partial: true, fixedByConfig: ["custom"] })); host.event(); await tick(); await view.renderOnce()
  expect(view.captureCharFrame()).toContain("one · heavy · parcial")
  host.renderer.width = 40; host.renderer.emit("resize"); await tick(); await view.renderOnce()
  expect(view.captureCharFrame()).toContain("one · parcial")
  expect(view.captureCharFrame()).not.toContain("heavy")
  host.state(status({ active: null })); host.event(); await tick(); await view.renderOnce()
  expect(view.captureCharFrame().trim()).toBe("")
  host.cleanup(); view.renderer.destroy()
})


test("new-profile command maps live models and host agent ids, saves then activates", async () => {
  const host = fake({ type: "home" }); await tick()
  host.choices([{ kind: "new" }, "created", "p/heavy", "max", "p/heavy", { kind: "done" }, true, true])
  await host.run()
  const save = host.calls.find(([name]) => name === "saveProfiles")?.[1] as { profiles: ProfilesFile["profiles"]; active: string; expected: unknown }
  expect(save.active).toBe("created")
  expect(save.profiles.created?.heavy).toEqual({ model: "p/heavy", variant: "max" })
  expect(save.expected).toEqual({ profiles: file.profiles, active: file.active })
  expect(host.calls.find(([name]) => name === "switch")?.[1]).toEqual({ profile: "created" })
  host.cleanup()
})

test("duplicating from configure persists an independent inactive profile without switching", async () => {
  const host = fake(); await tick()
  host.choices([{ kind: "configure" }, "one", "Duplicate", "copy", "keep", { kind: "done" }, true]); await host.run()
  const save = host.calls.find(([name]) => name === "saveProfiles")?.[1] as { profiles: ProfilesFile["profiles"]; active: string }
  expect(save.active).toBe("one"); expect(save.profiles.copy).toEqual(profile)
  expect(save.profiles.copy).not.toBe(profile)
  expect(host.calls.map(([name]) => name)).not.toContain("switch")
  host.cleanup()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test("failed status loads indicator definitions and warns once until its failure changes", async () => {
  const host = fake(); await tick()
  host.state(status({ phase: "failed", ready: false, error: "reload unavailable" }))
  host.event(); await tick(); host.renderer.emit("resize"); await tick(); host.event(); await tick()
  expect(host.toasts.filter((toast) => toast.message.includes("reload unavailable"))).toHaveLength(1)
  const view = await testRender(() => jsx("box", { children: host.slot().render() }) as never, { width: 80, height: 3 })
  await view.renderOnce(); expect(view.captureCharFrame()).toContain("one · heavy")
  host.state(status({ phase: "failed", ready: false, error: "another failure" })); host.event(); await tick()
  expect(host.toasts.at(-1)?.message).toContain("another failure")
  host.cleanup(); view.renderer.destroy()
})

test("a stale in-flight status cannot overwrite a switch and its fresh follow-up", async () => {
  const host = fake(); await tick()
  const old = deferred<StatusOutput>()
  let reads = 0
  host.selectHook(async () => {
    host.statusHook(async () => ++reads === 1 ? old.promise : status({ active: "two" }))
    host.event(); await tick()
    return { kind: "profile", name: "two" }
  })
  await host.run()
  expect(reads).toBe(2)
  old.resolve(status({ active: "one" })); await tick()
  const view = await testRender(() => jsx("box", { children: host.slot().render() }) as never, { width: 80, height: 3 })
  await view.renderOnce(); expect(view.captureCharFrame()).toContain("two · heavy")
  host.cleanup(); view.renderer.destroy()
})

test("pending polling recovers from a transient status failure with backoff", async () => {
  const host = fake(); await tick()
  host.state(status({ phase: "pending", ready: false })); host.event(); await tick()
  let reads = 0
  host.statusHook(async () => {
    if (++reads === 1) throw { type: "transport", message: "temporarily unavailable" }
    return status()
  })
  await new Promise((done) => setTimeout(done, 850))
  expect(reads).toBe(2)
  host.choice(undefined); await host.run()
  expect(host.toasts.some((toast) => toast.message.includes("still loading"))).toBe(false)
  host.cleanup()
})

for (const effective of [true, false]) test(`clearing active profile updates focused session or explains host null limitation (${effective})`, async () => {
  const host = fake(); await tick()
  host.choices([{ kind: "configure" }, "one", "Delete", true])
  const cleared = status({ active: null, agents: [] })
  if (effective) host.cacheModel({ providerID: "host", id: "default", variant: "low" })
  host.statusHook(async () => host.calls.some(([name]) => name === "saveProfiles") ? cleared : status())
  await host.run()
  expect(host.calls.map(([name]) => name)).toContain("invalidate")
  if (effective) {
    expect(host.calls.find(([name]) => name === "switchModel")?.[1]).toEqual({ sessionID: "focused", model: { providerID: "host", id: "default", variant: "low" } })
    expect(host.calls.findIndex(([name]) => name === "sync")).toBeLessThan(host.calls.findIndex(([name]) => name === "switchModel"))
    expect(host.calls.find(([name]) => name === "agents")?.[1]).toEqual({ directory: "/test" })
  }
  expect(host.calls.filter(([name]) => name === "switchModel")).toHaveLength(effective ? 1 : 0)
  expect(host.toasts.at(-1)?.message).toContain("Other tabs keep their models")
  if (!effective) expect(host.toasts.at(-1)?.message).toContain("open session keeps its model until you choose another")
  host.cleanup()
})

test("cleanup clears the dialog and a late picker result cannot switch", async () => {
  const host = fake(); await tick()
  const dialog = deferred<unknown>(); host.selectHook(() => dialog.promise)
  const running = host.run(); await tick(); host.cleanup()
  dialog.resolve({ kind: "profile", name: "two" }); await running
  expect(host.calls.map(([name]) => name)).toContain("clear")
  expect(host.calls.map(([name]) => name)).not.toContain("switch")
})

test("cleanup during the final wizard confirmation prevents saving its late result", async () => {
  const host = fake(); await tick()
  const activation = deferred<unknown>()
  host.choices([{ kind: "new" }, "late", "p/heavy", "max", "p/heavy", { kind: "done" }, true, activation.promise])
  const running = host.run(); await tick(); host.cleanup()
  activation.resolve(true); await running
  expect(host.calls.map(([name]) => name)).not.toContain("saveProfiles")
  expect(host.calls.map(([name]) => name)).not.toContain("switch")
})

test("a command captures its location once across selection, RPC and cache refresh", async () => {
  const host = fake(); await tick()
  host.selectHook(async () => { host.location({ directory: "/other" }); return { kind: "profile", name: "two" } })
  await host.run()
  expect(host.calls.find(([name]) => name === "switch")?.[2]).toEqual({ location: { directory: "/test" } })
  expect(host.calls.find(([name]) => name === "invalidate")?.[1]).toEqual({ directory: "/test" })
  expect(host.calls.find(([name]) => name === "sync")?.[1]).toEqual({ directory: "/test" })
  host.cleanup()
})

test("pure active rename saves and refreshes without switching or reloading session", async () => {
  const host = fake(); await tick()
  host.choices([{ kind: "configure" }, "one", "Rename", "renamed"]); await host.run()
  expect(host.calls.map(([name]) => name)).toContain("saveProfiles")
  expect(host.calls.map(([name]) => name)).not.toContain("switch")
  expect(host.calls.map(([name]) => name)).not.toContain("switchModel")
  host.cleanup()
})

test("an empty profile document enters setup directly and seeds host agent defaults", async () => {
  const host = fake(); await tick()
  host.file({ profiles: {}, active: "", effective: {} }); host.state(status({ profiles: [], active: null }))
  host.choices(["first", "p/heavy", "max", "p/heavy", { kind: "done" }, true, false]); await host.run()
  const save = host.calls.find(([name]) => name === "saveProfiles")?.[1] as ProfilesFile
  expect(save.profiles.first?.placements).toEqual({ custom: "heavy" })
  expect(save.active).toBe("")
  host.cleanup()
})

for (const phase of ["failed", "ready"] as const) test(`active rename switches when server does not retarget (${phase})`, async () => {
  const host = fake(); await tick()
  host.state(status({ phase })); host.retarget(false)
  host.choices([{ kind: "configure" }, "one", "Rename", "renamed"]); await host.run()
  expect(host.calls.find(([name]) => name === "switch")?.[1]).toEqual({ profile: "renamed" })
  expect(host.calls.map(([name]) => name)).toContain("switchModel")
  host.cleanup()
})

test("polling survives more than five errors with capped backoff and one toast per streak", async () => {
  const host = fake(); await tick()
  const timeout = globalThis.setTimeout
  const delays: number[] = []
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) => {
    if (delay && delay >= 250) delays.push(delay)
    return timeout(callback, delay && delay >= 250 ? 1 : delay, ...args)
  }) as typeof setTimeout)
  try {
    let reads = 0
    host.statusHook(async () => {
      if (++reads <= 7) throw new Error(`transport failure ${reads}`)
      return status()
    })
    host.event()
    await new Promise((done) => timeout(done, 60))
    expect(reads).toBe(8)
    expect(delays).toEqual([250, 500, 1000, 2000, 2000, 2000, 2000])
    expect(host.toasts.filter((toast) => toast.message.includes("transport failure"))).toHaveLength(1)
    host.statusHook(async () => { throw new Error("second streak") }); host.event(); await tick()
    expect(host.toasts.filter((toast) => toast.message.includes("second streak"))).toHaveLength(1)
  } finally { host.cleanup(); timer.mockRestore() }
})

test("profile command reports the status error when no snapshot has loaded", async () => {
  const host = fake(undefined, async () => { throw new Error("no initial status") })
  await tick(); host.event(); await tick()
  const before = host.toasts.length
  await host.run()
  expect(host.toasts.length).toBe(before + 1)
  expect(host.toasts.at(-1)?.message).toContain("no initial status")
  expect(host.calls.map(([name]) => name)).not.toContain("switch")
  host.cleanup()
})

test("pending polling continues past five attempts with capped backoff until ready", async () => {
  const host = fake(); await tick()
  const timeout = globalThis.setTimeout
  const delays: number[] = []
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) => {
    if (delay && delay >= 250) delays.push(delay)
    return timeout(callback, delay && delay >= 250 ? 1 : delay, ...args)
  }) as typeof setTimeout)
  try {
    let reads = 0
    host.statusHook(async () => ++reads <= 7 ? status({ phase: "pending", ready: false }) : status())
    host.event()
    await new Promise((done) => timeout(done, 60))
    expect(reads).toBe(8)
    expect(delays).toEqual([250, 500, 1000, 2000, 2000, 2000, 2000])
    expect(host.toasts).toEqual([])
  } finally { host.cleanup(); timer.mockRestore() }
})
