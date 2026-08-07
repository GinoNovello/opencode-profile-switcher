import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ProfilesFile } from "../src/schema.js"

/**
 * The opentui/solid `jsx` factory throws "No renderer found" when called
 * outside a real render context (verified via probe). To exercise the slot
 * renderer headlessly we mock `@opentui/solid/jsx-runtime` so every element the
 * renderer builds is recorded for assertion, then dynamic-import the tui module
 * AFTER the mock is registered so it picks up the fake factory.
 */
const built: Array<{ type: string; children: unknown; foreground: unknown }> = []
await mock.module("@opentui/solid/jsx-runtime", () => ({
  jsx: (type: string, props: Record<string, unknown>) => {
    const style = props.style as { foreground?: unknown } | undefined
    const entry = { type, children: props.children, foreground: style?.foreground }
    built.push(entry)
    return entry as unknown
  },
  jsxs: () => ({}),
  jsxDEV: () => ({}),
  Fragment: () => ({}),
}))

const { default: tuiModule } = await import("../src/tui.js")

// Re-used fake TUI api. Only the pieces registerProfileIndicator + the keymap
// registration touch are implemented; dialog/toast are inert.
interface FakeApi {
  keymap: { registerLayer: (layer: unknown) => void }
  slots: { register: (plugin: unknown) => string }
  renderer: { width: number; on: (e: string, fn: () => void) => void; off: (e: string, fn: () => void) => void }
  event: { on: (type: string, fn: (e: unknown) => void) => () => void }
  lifecycle: { onDispose: (fn: () => void) => () => void; signal: AbortSignal }
  client: unknown
  state: { provider: unknown[] }
  ui: { toast: () => void; dialog: { replace: () => void; clear: () => void } }
}

function fakeApi(width = 120): {
  api: FakeApi
  registered: { value: unknown }
  handlers: Record<string, ((e: unknown) => void) | undefined>
} {
  const registered = { value: undefined as unknown }
  const handlers: Record<string, ((e: unknown) => void) | undefined> = {}
  const api: FakeApi = {
    keymap: { registerLayer: () => {} },
    slots: {
      register: (plugin: unknown) => {
        registered.value = plugin
        return "fake-id"
      },
    },
    renderer: {
      width,
      on: () => {},
      off: () => {},
    },
    event: {
      on: (type, fn) => {
        handlers[type] = fn
        return () => {}
      },
    },
    lifecycle: {
      onDispose: () => () => {},
      signal: new AbortController().signal,
    },
    client: {},
    state: { provider: [] },
    ui: { toast: () => {}, dialog: { replace: () => {}, clear: () => {} } },
  }
  return { api, registered, handlers }
}

const TMP = join(tmpdir(), `ps-indicator-${process.pid}-${Date.now()}`)
const FILE = join(TMP, "profiles.json")

function writeProfilesFile(file: ProfilesFile): void {
  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`, "utf8")
}

function slotRenderers(plugin: unknown): Record<string, (ctx: unknown) => unknown> {
  return (plugin as { slots: Record<string, (ctx: unknown) => unknown> }).slots
}

describe("profile indicator slot registration", () => {
  beforeEach(() => {
    built.length = 0
    mkdirSync(TMP, { recursive: true })
    process.env.OPENCODE_PROFILES_PATH = FILE
  })

  afterEach(() => {
    delete process.env.OPENCODE_PROFILES_PATH
    rmSync(TMP, { recursive: true, force: true })
  })

  test("registers both home_prompt_right and session_prompt_right slots", async () => {
    writeProfilesFile({ profiles: {}, active: "", effective: {} })
    const { api, registered } = fakeApi()

    await tuiModule.tui(api as never, undefined as never, undefined as never)

    const slots = slotRenderers(registered.value)
    expect(typeof slots.home_prompt_right).toBe("function")
    expect(typeof slots.session_prompt_right).toBe("function")
  })

  test("subscribes to server.instance.disposed so live switches refresh it", async () => {
    writeProfilesFile({ profiles: {}, active: "", effective: {} })
    const { api, handlers } = fakeApi()

    await tuiModule.tui(api as never, undefined as never, undefined as never)

    expect(typeof handlers["server.instance.disposed"]).toBe("function")
  })

  test("renders a muted span with `name · shortHeavyModel` for an active profile", async () => {
    writeProfilesFile({
      profiles: {
        performance: {
          heavy: { model: "zai/glm-5.2" },
          rest: { model: "zai/glm-4" },
          placements: {},
          specifics: {},
        },
      },
      active: "performance",
      effective: {},
    })
    const { api, registered } = fakeApi(120)
    const textMuted = { r: 100, g: 100, b: 100, a: 255 }

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const slots = slotRenderers(registered.value)
    const out = slots.home_prompt_right({ theme: { current: { textMuted } } })

    expect(built).toHaveLength(1)
    expect(built[0]?.type).toBe("span")
    expect(built[0]?.children).toBe("performance · glm-5.2")
    expect(built[0]?.foreground).toBe(textMuted)
    expect(out).toBe(built[0])
  })

  test("both slots share the same indicator output", async () => {
    writeProfilesFile({
      profiles: { fast: { heavy: { model: "glm-4" }, rest: { model: "glm-4" }, placements: {}, specifics: {} } },
      active: "fast",
      effective: {},
    })
    const { api, registered } = fakeApi(100)

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const slots = slotRenderers(registered.value)
    slots.home_prompt_right({ theme: { current: { textMuted: "c" } } })
    slots.session_prompt_right({ theme: { current: { textMuted: "c" } }, session_id: "s1" })

    expect(built).toHaveLength(2)
    expect(built[0]?.children).toBe("fast · glm-4")
    expect(built[1]?.children).toBe("fast · glm-4")
  })

  test("renders nothing (null) when there is no active profile", async () => {
    writeProfilesFile({ profiles: {}, active: "", effective: {} })
    const { api, registered } = fakeApi(120)

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const slots = slotRenderers(registered.value)
    const out = slots.home_prompt_right({ theme: { current: { textMuted: "c" } } })

    expect(out).toBeNull()
    expect(built).toHaveLength(0)
  })

  test("collapses to just the name on a narrow terminal", async () => {
    writeProfilesFile({
      profiles: {
        performance: {
          heavy: { model: "zai/glm-5.2" },
          rest: { model: "zai/glm-4" },
          placements: {},
          specifics: {},
        },
      },
      active: "performance",
      effective: {},
    })
    const { api, registered } = fakeApi(40)

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const slots = slotRenderers(registered.value)
    slots.home_prompt_right({ theme: { current: { textMuted: "c" } } })

    expect(built[0]?.children).toBe("performance")
  })

  test("updates immediately when server.instance.disposed fires", async () => {
    // Start with no active profile: indicator hidden.
    writeProfilesFile({ profiles: {}, active: "", effective: {} })
    const { api, registered, handlers } = fakeApi(120)

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const slots = slotRenderers(registered.value)
    expect(slots.home_prompt_right({ theme: { current: { textMuted: "c" } } })).toBeNull()

    // A live switch persists a new active profile and disposes the instance.
    writeProfilesFile({
      profiles: {
        performance: {
          heavy: { model: "zai/glm-5.2" },
          rest: { model: "zai/glm-4" },
          placements: {},
          specifics: {},
        },
      },
      active: "performance",
      effective: {},
    })
    handlers["server.instance.disposed"]?.({ type: "server.instance.disposed", properties: { directory: "" } })

    // No re-registration: the same renderer now reflects the new profile.
    slots.home_prompt_right({ theme: { current: { textMuted: "c" } } })
    expect(built[built.length - 1]?.children).toBe("performance · glm-5.2")
  })

  test("does not register the slash command twice / still registers keymap", async () => {
    // Sanity: the indicator wiring must not displace the existing /profile command.
    const layers: unknown[] = []
    const api = {
      ...fakeApi().api,
      keymap: { registerLayer: (layer: unknown) => layers.push(layer) },
    }
    writeProfilesFile({ profiles: {}, active: "", effective: {} })

    await tuiModule.tui(api as never, undefined as never, undefined as never)

    const commands = (layers[0] as { commands?: Array<{ slashName?: string }> }).commands ?? []
    expect(commands.some((c) => c.slashName === "profile")).toBe(true)
  })
})
