import type { Plugin } from "@opencode/plugin/tui"
type Context = Plugin.Context
import { jsx } from "@opentui/solid/jsx-runtime"
import { createSignal } from "solid-js"
import { formatProfileIndicator } from "../../../src/core/indicator.js"
import { buildPickerOptions } from "../../../src/core/picker.js"
import type { ProfilesFile } from "../../../src/core/schema.js"
import { ProfileSwitcherRpc, type StatusOutput } from "./rpc.js"
import { mapProviders } from "./tui-models.js"
import { configureProfile, editProfile } from "./tui-wizard.js"

export function switchMessage(status: StatusOutput): string {
  const details = [`Profile "${status.active}" applied`, "Other tabs keep their models."]
  if (status.partial) details.push(`parcial — fixed by config: ${status.fixedByConfig.join(", ")}`)
  if (status.invalidSlots.length) details.push(`Invalid slots: ${status.invalidSlots.map((slot) => `${slot.agent ?? slot.placement}: ${slot.model}`).join(", ")}`)
  if (status.unapplied.length) details.push(`Unapplied: ${status.unapplied.join(", ")}`)
  return details.join(" · ")
}

export function setupTui(ctx: Context): () => void {
  const rpc = ctx.client.rpc(ProfileSwitcherRpc)
  const location = () => ctx.location ?? ctx.data.location.default()
  const [snapshot, setSnapshot] = createSignal<StatusOutput>()
  const [document, setDocument] = createSignal<ProfilesFile>()
  const [width, setWidth] = createSignal(ctx.renderer.width)
  let disposed = false
  type Location = ReturnType<typeof location>
  let generation = 0
  let refreshing: { generation: number; promise: Promise<StatusOutput | undefined> } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  let lastFailure: string | undefined
  let busy = false
  const errorToast = (error: unknown) => {
    const failure = error && typeof error === "object" ? error : undefined
    const type = failure && "type" in failure ? String(failure.type) : ""
    const labels: Record<string, string> = {
      unknown_profile: "Unknown profile", invalid_profiles: "Invalid profiles file",
      reload_failed: "Could not reload models", conflict: "Profiles changed; reopen the wizard",
      invalid_profile: "Invalid profile",
    }
    const message = failure && "message" in failure ? String(failure.message) : String(error)
    ctx.ui.toast.show({ message: `Profile switcher: ${labels[type] ? `${labels[type]}: ` : ""}${message}`, variant: "error" })
  }
  const schedule = (delay = 250) => {
    if (!disposed && timer === undefined) timer = setTimeout(() => { timer = undefined; void refresh() }, delay)
  }
  const refresh = (at = location(), fresh = false): Promise<StatusOutput | undefined> => {
    if (disposed) return Promise.resolve(undefined)
    if (fresh) generation++
    if (refreshing?.generation === generation) return refreshing.promise
    const current = generation
    const promise = (async () => {
      try {
        const status = await rpc.status({}, { location: at }) as StatusOutput
        if (disposed || current !== generation) return
        setSnapshot(status)
        if (status.phase === "failed") {
          const message = status.error ?? "Profile application failed"
          if (lastFailure !== message) errorToast(message)
          lastFailure = message
        } else lastFailure = undefined
        const file = await rpc.readProfiles({}, { location: at }) as ProfilesFile
        if (disposed || current !== generation) return
        setDocument(file)
        retries = 0
        if (status.phase === "pending") schedule()
        return status
      } catch (error) {
        if (!disposed && current === generation) {
          if (retries === 0) errorToast(error)
          if (retries < 5) schedule(Math.min(250 * 2 ** retries++, 2000))
        }
      }
    })().finally(() => { if (refreshing?.generation === current) refreshing = undefined })
    refreshing = { generation: current, promise }
    return promise
  }
  const sessionModel = async (result: StatusOutput, at: Location): Promise<boolean> => {
    if (disposed) return false
    ctx.data.location.agent.invalidate(at)
    await ctx.data.location.agent.sync(at)
    if (disposed) return false
    const route = ctx.ui.router.current()
    if (route.type !== "session") return false
    const session = await ctx.client.session.get({ sessionID: route.sessionID })
    if (disposed) return false
    const model = result.agents.find((agent) => agent.id === session.agent)?.model
    if (!model) return true
    await ctx.client.session.switchModel({
      sessionID: route.sessionID,
      model: { providerID: model.providerID, id: model.id, ...(model.variant !== null ? { variant: model.variant } : {}) },
    })
    return false
  }
  const switchProfile = async (profile: string, at: Location) => {
    if (disposed) return
    generation++
    const result = await rpc.switch({ profile }, { location: at }) as StatusOutput
    if (disposed) return
    generation++
    setSnapshot(result)
    await sessionModel(result, at)
    if (disposed) return
    ctx.ui.toast.show({ message: switchMessage(result), variant: result.partial || result.invalidSlots.length > 0 || result.unapplied.length > 0 ? "warning" : "success" })
    await refresh(at, true)
  }
  const run = async () => {
    if (busy || disposed) return
    busy = true
    const at = location()
    // A closed plugin must not continue a wizard after an outstanding dialog resolves.
    const ui = { ...ctx.ui, dialog: { ...ctx.ui.dialog,
      select: async (...args: Parameters<typeof ctx.ui.dialog.select>) => disposed ? undefined : await ctx.ui.dialog.select(...args).then((value) => disposed ? undefined : value),
      prompt: async (...args: Parameters<typeof ctx.ui.dialog.prompt>) => disposed ? undefined : await ctx.ui.dialog.prompt(...args).then((value) => disposed ? undefined : value),
      confirm: async (...args: Parameters<typeof ctx.ui.dialog.confirm>) => disposed ? undefined : await ctx.ui.dialog.confirm(...args).then((value) => disposed ? undefined : value),
    } } as Context["ui"]
    try {
      await refresh(at)
      if (disposed) return
      const status = snapshot()
      if (!status || status.phase === "pending") {
        if (status?.phase === "pending") ctx.ui.toast.show({ message: "Profiles are still loading. Try again shortly.", variant: "info" })
        return
      }
      const file = await rpc.readProfiles({}, { location: at }) as ProfilesFile
      if (disposed) return
      setDocument(file)
      const options = buildPickerOptions({ ...file, active: status.active ?? "" })
        .filter((option) => option.value.kind !== "profile" || status.profiles.includes(option.value.name))
      const action = Object.keys(file.profiles).length === 0 ? { kind: "new" as const } : await ui.dialog.select({ title: "Model profile", options })
      if (disposed || action === undefined) return
      if (action.kind === "profile") { await switchProfile(action.name, at); return }
      await Promise.all([
        ctx.data.location.agent.sync(at), ctx.data.location.provider.sync(at), ctx.data.location.model.sync(at),
      ])
      if (disposed) return
      const providers = mapProviders(ctx.data.location.provider.list(at) ?? [], ctx.data.location.model.list(at) ?? [])
      const agents = (ctx.data.location.agent.list(at) ?? []).map((agent) => ({ name: agent.id, displayName: agent.name, mode: agent.mode, hidden: agent.hidden }))
      const draft = action.kind === "new"
        ? await editProfile(ui, file, providers, agents)
        : await configureProfile(ui, file, providers, agents)
      if (!draft || disposed) return
      generation++
      const saved = await rpc.saveProfiles({ profiles: draft.profiles, active: draft.active, expected: { profiles: file.profiles, active: file.active } }, { location: at }) as ProfilesFile
      if (disposed) return
      generation++
      setDocument(saved)
      const sameModels = JSON.stringify(draft.profiles[draft.active]) === JSON.stringify(file.profiles[file.active])
      const renamed = draft.active !== file.active && !Object.hasOwn(draft.profiles, file.active) && sameModels
      if (draft.active && (!sameModels || (draft.active !== file.active && !renamed))) await switchProfile(draft.active, at)
      else {
        let retained = false
        if (!draft.active && file.active) {
          const cleared = await refresh(at, true)
          if (cleared) retained = await sessionModel(cleared, at)
        }
        if (disposed) return
        ctx.ui.toast.show({ message: !draft.active && file.active
          ? `Profiles saved. ${retained ? "The open session keeps its model until you choose another. " : ""}Other tabs keep their models.`
          : "Profiles saved.", variant: retained ? "warning" : "success" })
        await refresh(at, true)
      }
    } catch (error) { if (!disposed) { errorToast(error); await refresh(at, true) } }
    finally { busy = false }
  }
  ctx.keymap.layer(() => ({ mode: "global", enabled: () => !disposed, commands: [{
    id: "opencode-profile-switcher-v2.profile", title: "Switch model profile", palette: true,
    slash: { name: "profile" }, run,
  }] }))
  const stopEvent = rpc.events.on("switched", () => { void refresh() })
  const onResize = () => { setWidth(ctx.renderer.width); void refresh() }
  ctx.renderer.on("resize", onResize)
  const stopSlot = ctx.ui.slot({ append: "prompt.footer.status", render: () => jsx(() => () => {
    const status = snapshot()
    const file = document()
    const label = formatProfileIndicator({ active: status?.active ?? "", profile: file?.profiles[status?.active ?? ""], width: width() })
    if (label === null) return null
    return jsx("text", { fg: ctx.theme.text.muted, children: `${label}${status?.partial ? " · parcial" : ""}` })
  }) })
  void refresh()
  return () => {
    disposed = true
    generation++
    ctx.ui.dialog.clear()
    if (timer !== undefined) clearTimeout(timer)
    stopEvent()
    stopSlot()
    ctx.renderer.off("resize", onResize)
  }
}
