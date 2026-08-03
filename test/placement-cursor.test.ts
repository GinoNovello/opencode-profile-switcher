import { test, expect, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import tuiModule from "../src/tui.js"

// Regression (cursor jump): the placement editor re-renders its DialogSelect
// after every cycle via `dialog.replace`, which mounts a fresh dialog whose
// selection starts at row 0. Without passing `current`, cycling the 4th agent
// throws the user back to the top of the list. opencode's DialogSelect accepts
// `current` and seeks to the matching option on mount, so the re-render must
// carry the row the user just acted on.

interface Rendered {
  kind: "select" | "confirm" | "prompt"
  props: any
}

function harness(profilesPath: string, agentNames: string[]) {
  const renders: Rendered[] = []
  const api = {
    keymap: { registerLayer(_l: unknown) {} },
    ui: {
      toast() {},
      dialog: {
        replace(fn: () => unknown) {
          fn()
        },
        clear() {},
      },
      DialogSelect(props: any) {
        renders.push({ kind: "select", props })
        return {}
      },
      DialogConfirm(props: any) {
        renders.push({ kind: "confirm", props })
        return {}
      },
      DialogPrompt(props: any) {
        renders.push({ kind: "prompt", props })
        return {}
      },
    },
    state: { provider: [] },
    client: {
      app: {
        agents: async () => agentNames.map((name) => ({ name, mode: "subagent", hidden: false })),
      },
    },
  }
  process.env.OPENCODE_PROFILES_PATH = profilesPath
  return { api, renders, last: () => renders[renders.length - 1]! }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
  delete process.env.OPENCODE_PROFILES_PATH
})

test("cycling a placement keeps the cursor on the agent just changed", async () => {
  dir = mkdtempSync(join(tmpdir(), "profile-switcher-cursor-"))
  const agents = ["alpha", "bravo", "charlie", "delta", "echo"]
  const { api, renders, last } = harness(join(dir, "profiles.json"), agents)

  const layers: any[] = []
  api.keymap.registerLayer = (layer: any) => layers.push(layer)
  await tuiModule.tui(api as never, undefined as never, undefined as never)
  layers[0].commands[0].run()
  await tick()

  // First-run wizard asks whether to customize the default placements.
  const confirm = last()
  expect(confirm.kind).toBe("confirm")
  confirm.props.onConfirm()
  await tick()

  // Placement editor is up. Cycle the 4th agent ("delta").
  const editor = last()
  expect(editor.kind).toBe("select")
  const deltaRow = editor.props.options.find((o: any) => o.title === "delta")
  expect(deltaRow.description).toBe("→ rest")
  const before = renders.length
  editor.props.onSelect(deltaRow)
  await tick()

  // It re-rendered with delta cycled...
  expect(renders.length).toBeGreaterThan(before)
  const rerender = last()
  expect(
    rerender.props.options.find((o: any) => o.title === "delta").description,
  ).toBe("→ specific")

  // ...and must hand the dialog the row to seek back to, or the cursor
  // silently jumps to the top of the list.
  const currentRow = rerender.props.options.find(
    (o: any) => rerender.props.current !== undefined && o.value === rerender.props.current,
  )
  expect(currentRow?.title).toBe("delta")
})
