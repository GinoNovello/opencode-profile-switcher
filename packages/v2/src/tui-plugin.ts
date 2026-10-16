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
  let refreshing: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let busy = false
  const errorToast = (error: unknown) => ctx.ui.toast.show({ message: `Profile switcher: ${error instanceof Error ? error.message : String(error)}`, variant: "error" })
  const schedule = () => {
    if (!disposed && timer === undefined) timer = setTimeout(() => { timer = undefined; void refresh() }, 250)
  }
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (refreshing) return refreshing
    refreshing = (async () => {
      try {
        const status = await rpc.status({}, { location: location() }) as StatusOutput
        if (disposed) return
        setSnapshot(status)
        if (status.phase === "pending") { schedule(); return }
        if (status.phase === "failed") { errorToast(status.error ?? "Profile application failed"); return }
        const file = await rpc.readProfiles({}, { location: location() }) as ProfilesFile
        if (!disposed) setDocument(file)
      } catch (error) { if (!disposed) errorToast(error) }
    })().finally(() => { refreshing = undefined })
    return refreshing
  }
  const switchProfile = async (profile: string) => {
    const result = await rpc.switch({ profile }, { location: location() }) as StatusOutput
    if (disposed) return
    setSnapshot(result)
    ctx.data.location.agent.invalidate(location())
    await ctx.data.location.agent.sync(location())
    const route = ctx.ui.router.current()
    if (route.type === "session") {
      const session = await ctx.client.session.get({ sessionID: route.sessionID })
      const model = result.agents.find((agent) => agent.id === session.agent)?.model
      if (model) await ctx.client.session.switchModel({
        sessionID: route.sessionID,
        model: { providerID: model.providerID, id: model.id, ...(model.variant !== null ? { variant: model.variant } : {}) },
      })
    }
    ctx.ui.toast.show({ message: switchMessage(result), variant: result.partial || result.invalidSlots.length > 0 || result.unapplied.length > 0 ? "warning" : "success" })
  }
  const run = async () => {
    if (busy || disposed) return
    busy = true
    try {
      await refresh()
      const status = snapshot()
      if (!status || status.phase !== "ready") {
        if (status?.phase === "pending") ctx.ui.toast.show({ message: "Profiles are still loading. Try again shortly.", variant: "info" })
        return
      }
      const file = await rpc.readProfiles({}, { location: location() }) as ProfilesFile
      setDocument(file)
      const options = buildPickerOptions({ ...file, active: status.active ?? "" })
        .filter((option) => option.value.kind !== "profile" || status.profiles.includes(option.value.name))
      const action = await ctx.ui.dialog.select({ title: "Model profile", options })
      if (action === undefined) return
      if (action.kind === "profile") { await switchProfile(action.name); await refresh(); return }
      await Promise.all([
        ctx.data.location.agent.sync(location()), ctx.data.location.provider.sync(location()), ctx.data.location.model.sync(location()),
      ])
      const providers = mapProviders(ctx.data.location.provider.list(location()) ?? [], ctx.data.location.model.list(location()) ?? [])
      const agents = (ctx.data.location.agent.list(location()) ?? []).map((agent) => ({ name: agent.id, mode: agent.mode, hidden: agent.hidden }))
      const draft = action.kind === "new"
        ? await editProfile(ctx.ui, file, providers, agents)
        : await configureProfile(ctx.ui, file, providers, agents)
      if (!draft) return
      const saved = await rpc.saveProfiles({ profiles: draft.profiles, active: draft.active, expected: { profiles: file.profiles, active: file.active } }, { location: location() }) as ProfilesFile
      setDocument(saved)
      if (draft.active && (draft.active !== file.active || JSON.stringify(draft.profiles[draft.active]) !== JSON.stringify(file.profiles[file.active]))) await switchProfile(draft.active)
      else {
        if (!draft.active && file.active) {
          ctx.data.location.agent.invalidate(location())
          await ctx.data.location.agent.sync(location())
        }
        ctx.ui.toast.show({ message: "Profiles saved.", variant: "success" })
      }
      await refresh()
    } catch (error) { if (!disposed) { errorToast(error); await refresh() } }
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
    if (timer !== undefined) clearTimeout(timer)
    stopEvent()
    stopSlot()
    ctx.renderer.off("resize", onResize)
  }
}
