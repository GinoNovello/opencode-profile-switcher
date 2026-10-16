import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { jsx } from "@opentui/solid/jsx-runtime"
import { EventEmitter } from "node:events"
import type { Plugin } from "@opencode/plugin/tui"
import { setupTui, switchMessage } from "../src/tui-plugin.js"
import type { StatusOutput } from "../src/rpc.js"
import type { ProfilesFile } from "../../../src/core/schema.js"

const profile = { heavy: { model: "p/heavy", variant: "max" }, rest: { model: "p/rest" }, placements: {}, specifics: {} }
const file: ProfilesFile = { active: "one", profiles: { one: profile, two: profile }, effective: {} }
function status(overrides: Partial<StatusOutput> = {}): StatusOutput {
  return { ready: true, phase: "ready", path: "/fake/profiles.json", profiles: ["one", "two"], active: "one", applied: true, reason: null, error: null, partial: false, fixedByConfig: [], unapplied: [], unassigned: [], invalidSlots: [], agents: [{ id: "custom", placement: "heavy", planned: { providerID: "p", id: "heavy", variant: "max" }, model: { providerID: "config", id: "effective", variant: "high" }, fixedByConfig: true }], ...overrides }
}
function fake(route: { type: string; sessionID?: string } = { type: "session", sessionID: "focused" }) {
  const calls: unknown[][] = []
  const toasts: { message: string; variant: string }[] = []
  const renderer = Object.assign(new EventEmitter(), { width: 100 })
  let command: { run: () => Promise<void> }
  let event: () => void = () => {}
  let slot: { append: string; render: () => unknown }
  let stopped = false
  let slotStopped = false
  let state = status()
  let failure: string | undefined
  let response: unknown = { kind: "profile", name: "two" }
  const loc = { directory: "/test" }
  let queue: unknown[] | undefined
  const rpc = {
    status: async (_: unknown, options: unknown) => { calls.push(["status", options]); return state },
    readProfiles: async () => file,
    switch: async (input: unknown, options: unknown) => { calls.push(["switch", input, options]); if (failure) throw new Error(failure); return { ...state, active: "two" } },
    saveProfiles: async (input: { profiles: ProfilesFile["profiles"]; active: string }, options: unknown) => { calls.push(["saveProfiles", input, options]); return { ...input, effective: {} } },
    events: { on: (_: unknown, callback: () => void) => { event = callback; return () => { stopped = true } } },
  }
  const ctx = {
    location: undefined,
    client: { rpc: () => rpc, session: {
      get: async (input: unknown) => { calls.push(["get", input]); return { agent: "custom" } },
      switchModel: async (input: unknown) => { calls.push(["switchModel", input]) },
    } },
    renderer, theme: { text: { muted: "#888888" } },
    data: { location: { default: () => loc, agent: {
      invalidate: (location: unknown) => { calls.push(["invalidate", location]) },
      sync: async (location: unknown) => { calls.push(["sync", location]) },
      list: () => [{ id: "custom", name: "Display name", mode: "primary", hidden: false }],
    }, provider: { sync: async () => {}, list: () => [{ id: "p", name: "Provider", activation: "enabled" }] },
    model: { sync: async () => {}, list: () => [{ id: "heavy", providerID: "p", name: "Heavy", enabled: true, variants: [{ id: "max" }] }] } } },
    keymap: { layer: (factory: () => { commands: { run: () => Promise<void> }[] }) => { command = factory().commands[0]! } },
    ui: { router: { current: () => route }, dialog: { select: async () => queue ? queue.shift() : response, prompt: async () => queue?.shift(), confirm: async () => queue?.shift() },
      toast: { show: (toast: { message: string; variant: string }) => toasts.push(toast) },
      slot: (claim: { append: string; render: () => unknown }) => { slot = claim; return () => { slotStopped = true } },
    },
  } as unknown as Plugin.Context
  const cleanup = setupTui(ctx)
  return { calls, toasts, renderer, cleanup, run: async () => command.run(), event: () => event(),
    state: (value: StatusOutput) => { state = value }, fail: (value: string) => { failure = value },
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
  for (const code of ["unknown_profile", "invalid_profiles", "reload_failed"]) test(`reports ${code} without moving sessions`, async () => {
    const host = fake(); await tick(); host.fail(code); await host.run()
    expect(host.toasts.at(-1)).toEqual({ message: `Profile switcher: ${code}`, variant: "error" })
    expect(host.calls.map(([name]) => name)).not.toContain("sync"); host.cleanup()
  })
  test("cancelled picker has no writes", async () => {
    const host = fake(); await tick(); host.choice(undefined); await host.run()
    expect(host.calls.map(([name]) => name)).not.toContain("switch"); host.cleanup()
  })
  test("failed boot reports its error and does not allow switching", async () => {
    const host = fake(); await tick(); host.state(status({ ready: false, phase: "failed", error: "reload unavailable" })); await host.run()
    expect(host.toasts.at(-1)?.message).toContain("reload unavailable")
    expect(host.calls.map(([name]) => name)).not.toContain("switch"); host.cleanup()
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
  host.choices([{ kind: "configure" }, "one", "Duplicate", "copy"]); await host.run()
  const save = host.calls.find(([name]) => name === "saveProfiles")?.[1] as { profiles: ProfilesFile["profiles"]; active: string }
  expect(save.active).toBe("one"); expect(save.profiles.copy).toEqual(profile)
  expect(save.profiles.copy).not.toBe(profile)
  expect(host.calls.map(([name]) => name)).not.toContain("switch")
  host.cleanup()
})
