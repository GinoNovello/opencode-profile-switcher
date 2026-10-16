import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import type { AgentInfo } from "../../../src/core/agent.js"
import type { ProviderLike } from "../../../src/core/models.js"
import type { ProfilesFile } from "../../../src/core/schema.js"
import { configureProfile, editProfile, type WizardAgent } from "../src/tui-wizard.js"

type Step = { title: string; result: unknown }
type Dialog = { title: string; options?: { title: string; value: unknown; description?: string }[]; current?: unknown; value?: string }
const step = (title: string, result: unknown): Step => ({ title, result })
function fakeUI(steps: Step[]) {
  const pending = [...steps]
  const dialogs: Dialog[] = []
  const toasts: { message: string; variant: string }[] = []
  const answer = async (dialog: Dialog) => {
    dialogs.push(dialog)
    const next = pending.shift()
    if (!next) throw new Error(`Unexpected dialog: ${dialog.title}`)
    expect(dialog.title).toBe(next.title)
    return next.result
  }
  const ui = {
    dialog: { select: answer, prompt: answer, confirm: answer },
    toast: { show: (toast: { message: string; variant: string }) => toasts.push(toast) },
  } as unknown as Plugin.Context["ui"]
  return { ui, dialogs, toasts, pending }
}
const providers: ProviderLike[] = [{ id: "live", models: {
  heavy: { id: "heavy", variants: { max: {}, low: {} } }, rest: { id: "rest" },
} }]
const agents: AgentInfo[] = [
  { name: "build", mode: "primary", hidden: false }, { name: "worker", mode: "subagent", hidden: false },
  { name: "both", mode: "all", hidden: false }, { name: "title", mode: "primary", hidden: true },
]
const done = { kind: "done" }
const agent = { kind: "agent", name: "worker" }
function file(): ProfilesFile {
  return { profiles: { current: {
    heavy: { model: "live/heavy", variant: "max" }, rest: { model: "live/rest" },
    placements: { build: "heavy", worker: "specific", title: "excluded" },
    specifics: { worker: { model: "live/heavy", variant: "low" } },
  } }, active: "current", effective: { build: { model: "live/heavy", variant: "max" } } }
}
const flow = [
  step("Profile name", "new"), step("Heavy model", "live/heavy"), step("Model variant", ""),
  step("Rest model", "live/rest"), step("Agent placements (select to cycle)", done),
  step("Specific models", agent), step("Model for worker", "live/heavy"), step("Model variant", "low"),
  step("Specific models", done), step("Save profile", true), step("Activate profile", false),
]

describe("v2 wizard", () => {
  for (let index = 0; index < flow.length; index++) {
    test(`Esc cancels step ${index + 1}: ${flow[index]!.title}`, async () => {
      const original = file()
      const before = structuredClone(original)
      const fake = fakeUI([...flow.slice(0, index), { ...flow[index]!, result: undefined }])
      expect(await editProfile(fake.ui, original, providers, agents)).toBeUndefined()
      expect(original).toEqual(before)
      expect(fake.pending).toEqual([])
    })
  }
  test("first profile uses agent defaults and default variant omits the variant field", async () => {
    const empty: ProfilesFile = { profiles: {}, active: "", effective: {} }
    const fake = fakeUI([...flow.slice(0, 5), step("Save profile", true), step("Activate profile", true)])
    expect(await editProfile(fake.ui, empty, providers, agents)).toEqual({ profiles: { new: {
      heavy: { model: "live/heavy" }, rest: { model: "live/rest" }, specifics: {},
      placements: { build: "heavy", worker: "rest", both: "heavy", title: "rest" },
    } }, active: "new", effective: {} })
    expect(fake.dialogs[2]!.options?.map((option) => option.value)).toEqual(["", "max", "low"])
    expect(empty.profiles).toEqual({})
  })
  test("new profile copies placements but starts specific slots empty and blocks incomplete Done", async () => {
    const original = file()
    const fake = fakeUI([...flow.slice(0, 5), step("Specific models", done), ...flow.slice(5)])
    const result = await editProfile(fake.ui, original, providers, agents)
    expect(result!.active).toBe("current")
    expect(result!.effective).toEqual(original.effective)
    expect(result!.profiles.new!.placements).toEqual(original.profiles.current!.placements)
    expect(fake.dialogs[5]!.options?.[0]!.description).toBe("not set")
    expect(fake.toasts).toEqual([{ message: "Choose a model for every specific agent.", variant: "warning" }])
    expect(result!.profiles.new!.specifics.worker).toEqual({ model: "live/heavy", variant: "low" })
  })
  test("edit preserves specifics and offers stale current models and variants", async () => {
    const original = file()
    original.profiles.current!.heavy = { model: "removed/heavy", variant: "retired" }
    const fake = fakeUI([
      step("Heavy model", "removed/heavy"), step("Model variant", "retired"), step("Rest model", "live/rest"),
      step("Agent placements (select to cycle)", done), step("Specific models", done), step("Save profile", true),
    ])
    const result = await editProfile(fake.ui, original, providers, agents, "current")
    expect(result).toEqual(original)
    expect(result!.profiles.current).not.toBe(original.profiles.current)
    expect(fake.dialogs[0]!.options?.[0]).toEqual({ title: "Keep current: removed/heavy", value: "removed/heavy" })
    expect(fake.dialogs[1]!.options?.map((option) => option.value)).toEqual(["", "retired"])
    expect(fake.dialogs[1]!.current).toBe("retired")
  })
  test("cycling specific to excluded removes its direct model", async () => {
    const original = file()
    const fake = fakeUI([
      step("Heavy model", "live/heavy"), step("Model variant", ""), step("Rest model", "live/rest"),
      step("Agent placements (select to cycle)", agent), step("Agent placements (select to cycle)", done), step("Save profile", true),
    ])
    const result = await editProfile(fake.ui, original, providers, agents, "current")
    expect(result!.profiles.current!.placements.worker).toBe("excluded")
    expect(result!.profiles.current!.specifics).toEqual({})
    expect(original.profiles.current!.placements.worker).toBe("specific")
  })
  test("invalid names retry; rejecting save discards the draft", async () => {
    const original = file()
    const fake = fakeUI([
      step("Profile name", " "), step("Profile name", "current"), step("Profile name", " new "),
      ...flow.slice(1, 9), step("Save profile", false),
    ])
    expect(await editProfile(fake.ui, original, providers, agents)).toBeUndefined()
    expect(fake.toasts.map((toast) => toast.variant)).toEqual(["error", "error"])
    expect(Object.keys(original.profiles)).toEqual(["current"])
  })
  test("empty catalog warns and validates manually entered models", async () => {
    const fake = fakeUI([
      step("Profile name", "manual"), step("Heavy model (provider/model)", ""),
      step("Heavy model (provider/model)", "missing-provider"),
      step("Heavy model (provider/model)", "provider/model#variant"),
      step("Heavy model (provider/model)", " provider/nested/model "), step("Model variant", ""),
      step("Rest model (provider/model)", "other/rest"), step("Agent placements (select to cycle)", done),
      step("Save profile", true), step("Activate profile", true),
    ])
    const result = await editProfile(fake.ui, { profiles: {}, active: "", effective: {} }, [{ id: "empty", models: {} }], agents)
    expect(result!.profiles.manual!.heavy.model).toBe("provider/nested/model")
    expect(result!.profiles.manual!.rest.model).toBe("other/rest")
    expect(fake.toasts.map((toast) => toast.variant)).toEqual(["warning", "error", "error", "error", "warning"])
    expect(fake.pending).toEqual([])
  })
  test("manual model entry can be cancelled without changing profiles", async () => {
    const original = file()
    const before = structuredClone(original)
    const fake = fakeUI([step("Heavy model (provider/model)", undefined)])
    expect(await editProfile(fake.ui, original, [], agents, "current")).toBeUndefined()
    expect(original).toEqual(before)
  })
  test("display names label placements and specific models while retaining agent ids", async () => {
    const named: WizardAgent[] = agents.map((agent) => ({ ...agent, displayName: agent.name === "worker" ? "Helpful worker" : agent.name }))
    const fake = fakeUI([
      step("Heavy model", "live/heavy"), step("Model variant", ""), step("Rest model", "live/rest"),
      step("Agent placements (select to cycle)", done), step("Specific models", agent),
      step("Model for Helpful worker (worker)", "live/rest"), step("Model variant", ""),
      step("Specific models", done), step("Save profile", true),
    ])
    const result = await editProfile(fake.ui, file(), providers, named, "current")
    expect(fake.dialogs[3]!.options?.find((option) => option.title === "Helpful worker (worker)")?.value).toEqual(agent)
    expect(fake.dialogs[3]!.options?.[0]!.title).toBe("build")
    expect(fake.dialogs[4]!.options?.[0]!.title).toBe("✓ Helpful worker (worker)")
    expect(result!.profiles.current!.specifics.worker).toEqual({ model: "live/rest" })
    expect(result!.profiles.current!.placements["Helpful worker"]).toBeUndefined()
  })
})

describe("v2 profile management", () => {
  test("duplicate is complete, independent and inactive", async () => {
    const original = file()
    const fake = fakeUI([
      step("Configure profile", "current"), step("current", "Duplicate"), step("Profile name", "copy"),
      step("Heavy & rest models", "keep"), step("Agent placements (select to cycle)", done),
      step("Specific models", done), step("Save profile", true),
    ])
    const result = await configureProfile(fake.ui, original, providers, agents)
    expect(result!.profiles.copy).toEqual(original.profiles.current)
    expect(result!.active).toBe("current")
    expect(result!.effective).toEqual(original.effective)
    result!.profiles.copy!.specifics.worker!.model = "changed/model"
    expect(original.profiles.current!.specifics.worker!.model).toBe("live/heavy")
    expect(fake.dialogs[2]!.value).toBe("current copy")
    expect(fake.dialogs[3]!.options?.[0]!.title).toBe("Keep current models")
    expect(fake.pending).toEqual([])
  })
  test("duplicate opens an editable draft and can change models without changing the source", async () => {
    const original = file()
    const fake = fakeUI([
      step("Configure profile", "current"), step("current", "Duplicate"), step("Profile name", "copy"),
      step("Heavy & rest models", "change"), step("Heavy model", "live/rest"), step("Model variant", ""),
      step("Rest model", "live/heavy"), step("Agent placements (select to cycle)", done),
      step("Specific models", done), step("Save profile", true),
    ])
    const result = await configureProfile(fake.ui, original, providers, agents)
    expect(result!.profiles.copy!.heavy).toEqual({ model: "live/rest" })
    expect(result!.profiles.copy!.rest).toEqual({ model: "live/heavy" })
    expect(result!.profiles.current).toEqual(original.profiles.current)
    expect(result!.active).toBe("current")
  })
  test("rename updates active and keeps the full profile", async () => {
    const original = file()
    const fake = fakeUI([step("Configure profile", "current"), step("current", "Rename"), step("Profile name", "renamed")])
    const result = await configureProfile(fake.ui, original, providers, agents)
    expect(result!.active).toBe("renamed")
    expect(result!.profiles.renamed).toEqual(original.profiles.current)
    expect(result!.profiles.current).toBeUndefined()
  })
  test("delete final active profile clears active, preserving effective history", async () => {
    const original = file()
    const fake = fakeUI([step("Configure profile", "current"), step("current", "Delete"), step("Delete profile", true)])
    expect(await configureProfile(fake.ui, original, providers, agents)).toEqual({ profiles: {}, active: "", effective: original.effective })
    expect(original.active).toBe("current")
  })
  for (const script of [
    [step("Configure profile", undefined)],
    [step("Configure profile", "current"), step("current", undefined)],
    [step("Configure profile", "current"), step("current", "Rename"), step("Profile name", undefined)],
    [step("Configure profile", "current"), step("current", "Duplicate"), step("Profile name", undefined)],
    [step("Configure profile", "current"), step("current", "Duplicate"), step("Profile name", "copy"), step("Heavy & rest models", undefined)],
    [step("Configure profile", "current"), step("current", "Duplicate"), step("Profile name", "copy"), step("Heavy & rest models", "keep"), step("Agent placements (select to cycle)", undefined)],
    [step("Configure profile", "current"), step("current", "Delete"), step("Delete profile", undefined)],
    [step("Configure profile", "current"), step("current", "Delete"), step("Delete profile", false)],
  ]) {
    test(`cancel ${script.map((item) => item.title).join(" / ")} (${String(script.at(-1)!.result)})`, async () => {
      const original = file()
      const before = structuredClone(original)
      const fake = fakeUI(script)
      expect(await configureProfile(fake.ui, original, providers, agents)).toBeUndefined()
      expect(original).toEqual(before)
    })
  }
})
