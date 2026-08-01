import { test, expect } from "bun:test"
import tuiModule from "../src/tui.js"

// Regression: our TUI entrypoint must default-export the { id, tui } module shape
// opencode's loader requires, and tui(api) must register a `/profile` slash
// command. This is the correct seam for OUR code: it stays green regardless of
// opencode's (separate) limitation that only loads the `./tui` entrypoint from a
// published npm package — proving that when opencode does load us, /profile works.
// See .scratch/profile-switcher/debug/ for the loader investigation.

test("default export is the { id, tui } module shape", () => {
  expect(tuiModule.id).toBe("opencode-profile-switcher")
  expect(typeof tuiModule.tui).toBe("function")
})

test("tui(api) registers a /profile slash command", async () => {
  const layers: Array<{ commands?: Array<{ slashName?: string }> }> = []
  const fakeApi = {
    keymap: { registerLayer: (layer: { commands?: Array<{ slashName?: string }> }) => layers.push(layer) },
    ui: { toast() {}, dialog: { replace() {}, clear() {} } },
    state: { provider: [] },
    client: {},
  }

  await tuiModule.tui(fakeApi as never, undefined as never, undefined as never)

  const commands = layers.flatMap((l) => l.commands ?? [])
  expect(commands.some((c) => c.slashName === "profile")).toBe(true)
})
