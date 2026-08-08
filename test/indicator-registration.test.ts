import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { jsx } from "@opentui/solid/jsx-runtime"
import tuiModule from "../src/tui.js"
import type { ProfilesFile } from "../src/schema.js"

/**
 * These tests mount the indicator slot with opentui's headless test renderer,
 * under a real `box` parent — the same way opencode hosts the prompt-right
 * slot.
 *
 * They used to mock `@opentui/solid/jsx-runtime` and assert only the *shape*
 * of the element the slot built. That seam was too shallow: returning a bare
 * `span` (a text node, illegal as a direct child of a box) satisfied every
 * assertion and still took down the whole TUI at startup with "Orphan text
 * error". Only a real mount runs opentui's parent checks, so the mock is gone.
 */

const TMP = join(tmpdir(), `ps-indicator-${process.pid}-${Date.now()}`)
const FILE = join(TMP, "profiles.json")

function writeProfilesFile(file: ProfilesFile): void {
  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`, "utf8")
}

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

type SlotRenderer = (ctx: unknown) => unknown

function slotRenderers(plugin: unknown): Record<string, SlotRenderer> {
  return (plugin as { slots: Record<string, SlotRenderer> }).slots
}

const MUTED = "#888888"
const HOME_CTX = { theme: { current: { textMuted: MUTED } } }

const PERFORMANCE: ProfilesFile = {
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
}

/** Mount one slot renderer under a `box`, as opencode does, and paint a frame. */
async function mount(slot: SlotRenderer, slotCtx: unknown = HOME_CTX) {
  const setup = await testRender(() => jsx("box", { children: slot(slotCtx) as never }) as never, {
    width: 60,
    height: 3,
  })
  await setup.renderOnce()
  return setup
}

async function frameOf(slot: SlotRenderer, slotCtx?: unknown): Promise<string> {
  const { captureCharFrame } = await mount(slot, slotCtx)
  return captureCharFrame()
}

describe("profile indicator slot registration", () => {
  beforeEach(() => {
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

  test("renders `name · shortHeavyModel` under a box without an orphan-text crash", async () => {
    // Regression: a `span` here is an orphan text node under the prompt box and
    // crashed the TUI ("Orphan text error: ... must have a <text> as a parent").
    // Mounting for real is what catches it.
    writeProfilesFile(PERFORMANCE)
    const { api, registered } = fakeApi(120)

    await tuiModule.tui(api as never, undefined as never, undefined as never)

    expect(await frameOf(slotRenderers(registered.value).home_prompt_right)).toContain("performance · glm-5.2")
  })

  test("paints the indicator in the theme's muted colour", async () => {
    writeProfilesFile(PERFORMANCE)
    const { api, registered } = fakeApi(120)

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const { captureSpans } = await mount(slotRenderers(registered.value).home_prompt_right)

    const span = captureSpans().lines[0]?.spans.find((s) => s.text.includes("performance"))
    expect(span).toBeDefined()
    // #888888, normalised to 0..1 per channel.
    expect(span?.fg.r).toBeCloseTo(0x88 / 255, 2)
    expect(span?.fg.g).toBeCloseTo(0x88 / 255, 2)
    expect(span?.fg.b).toBeCloseTo(0x88 / 255, 2)
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

    expect(await frameOf(slots.home_prompt_right)).toContain("fast · glm-4")
    expect(await frameOf(slots.session_prompt_right, { ...HOME_CTX, session_id: "s1" })).toContain("fast · glm-4")
  })

  test("renders nothing when there is no active profile", async () => {
    writeProfilesFile({ profiles: {}, active: "", effective: {} })
    const { api, registered } = fakeApi(120)

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const slots = slotRenderers(registered.value)

    expect(slots.home_prompt_right(HOME_CTX)).toBeNull()
    // …and mounting that empty slot must not crash either.
    expect((await frameOf(slots.home_prompt_right)).trim()).toBe("")
  })

  test("collapses to just the name on a narrow terminal", async () => {
    writeProfilesFile(PERFORMANCE)
    const { api, registered } = fakeApi(40)

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const frame = await frameOf(slotRenderers(registered.value).home_prompt_right)

    expect(frame).toContain("performance")
    expect(frame).not.toContain("glm-5.2")
  })

  test("updates immediately when server.instance.disposed fires", async () => {
    // Start with no active profile: indicator hidden.
    writeProfilesFile({ profiles: {}, active: "", effective: {} })
    const { api, registered, handlers } = fakeApi(120)

    await tuiModule.tui(api as never, undefined as never, undefined as never)
    const slots = slotRenderers(registered.value)
    expect(slots.home_prompt_right(HOME_CTX)).toBeNull()

    // A live switch persists a new active profile and disposes the instance.
    writeProfilesFile(PERFORMANCE)
    handlers["server.instance.disposed"]?.({ type: "server.instance.disposed", properties: { directory: "" } })

    // No re-registration: the same renderer now reflects the new profile.
    expect(await frameOf(slots.home_prompt_right)).toContain("performance · glm-5.2")
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
