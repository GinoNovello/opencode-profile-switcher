import type { Plugin } from "@opencode/plugin/tui"
type Context = Plugin.Context
import type { AgentInfo } from "../../../src/core/agent.js"
import { buildModelOptions, buildVariantOptions, findModel, type ProviderLike } from "../../../src/core/models.js"
import type { Profile, ProfilesFile } from "../../../src/core/schema.js"
import {
  buildPlacementOptions, buildProfile, buildSpecificOptions, commitProfile, copyPlacements,
  copySpecifics, cycleAgentPlacement, defaultPlacements, deleteProfile, duplicateProfile,
  renameProfile, setSpecific, specificsComplete, suggestedDuplicateName, updateProfile,
  validateProfileName,
} from "../../../src/core/wizard.js"

type UI = Context["ui"]

async function profileName(ui: UI, file: ProfilesFile, value = "", self?: string): Promise<string | undefined> {
  while (true) {
    const raw = await ui.dialog.prompt({ title: "Profile name", value })
    if (raw === undefined) return
    const valid = validateProfileName(raw, Object.keys(file.profiles), self)
    if (valid.ok) return raw.trim()
    ui.toast.show({ message: valid.error!, variant: "error" })
    value = raw
  }
}

async function model(ui: UI, providers: ProviderLike[], title: string, current?: string): Promise<string | undefined> {
  const options = buildModelOptions(providers)
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ title: `Keep current: ${current}`, value: current })
  }
  return ui.dialog.select({ title, options, current })
}

async function variant(ui: UI, providers: ProviderLike[], selected: string, current?: string): Promise<string | undefined> {
  const options = buildVariantOptions(findModel(providers, selected)?.variants ?? [])
  if (current && !options.some((option) => option.value === current)) options.push({ title: `Keep current: ${current}`, value: current })
  return ui.dialog.select({ title: "Model variant", options, current: current ?? "" })
}

/** All edits stay in a draft; Esc at any step leaves persistence untouched. */
export async function editProfile(ui: UI, file: ProfilesFile, providers: ProviderLike[], agents: AgentInfo[], name?: string): Promise<ProfilesFile | undefined> {
  const original = name ? file.profiles[name] : undefined
  const target = name ?? await profileName(ui, file)
  if (target === undefined) return
  const heavy = await model(ui, providers, "Heavy model", original?.heavy.model)
  if (heavy === undefined) return
  const heavyVariant = await variant(ui, providers, heavy, original?.heavy.model === heavy ? original.heavy.variant : undefined)
  if (heavyVariant === undefined) return
  const rest = await model(ui, providers, "Rest model", original?.rest.model)
  if (rest === undefined) return
  const source = original ?? file.profiles[file.active]
  let placements = source ? copyPlacements(source) : defaultPlacements(agents)
  let specifics = original ? copySpecifics(original) : {}
  while (true) {
    const choice = await ui.dialog.select({ title: "Agent placements (select to cycle)", options: buildPlacementOptions(placements, agents) })
    if (choice === undefined) return
    if (choice.kind === "done") break
    ;({ placements, specifics } = cycleAgentPlacement(placements, specifics, choice.name))
  }
  while (Object.values(placements).includes("specific")) {
    const choice = await ui.dialog.select({ title: "Specific models", options: buildSpecificOptions(placements, specifics) })
    if (choice === undefined) return
    if (choice.kind === "done") {
      if (specificsComplete(placements, specifics)) break
      ui.toast.show({ message: "Choose a model for every specific agent.", variant: "warning" })
      continue
    }
    const current = specifics[choice.name]
    const selected = await model(ui, providers, `Model for ${choice.name}`, current?.model)
    if (selected === undefined) return
    const selectedVariant = await variant(ui, providers, selected, current?.model === selected ? current.variant : undefined)
    if (selectedVariant === undefined) return
    specifics = setSpecific(specifics, choice.name, selected, selectedVariant)
  }
  const profile = buildProfile(heavy, rest, placements, heavyVariant, specifics)
  const confirmed = await ui.dialog.confirm({ title: "Save profile", message: `Save "${target}"?` })
  if (confirmed !== true) return
  if (name) return updateProfile(file, name, profile)
  const active = await ui.dialog.confirm({ title: "Activate profile", message: `Activate "${target}" now?` })
  if (active === undefined) return
  return commitProfile(file, { name: target, profile, setActive: active })
}

export async function configureProfile(ui: UI, file: ProfilesFile, providers: ProviderLike[], agents: AgentInfo[]): Promise<ProfilesFile | undefined> {
  const name = await ui.dialog.select({ title: "Configure profile", options: Object.keys(file.profiles).sort().map((name) => ({ title: name, value: name })) })
  if (name === undefined) return
  const action = await ui.dialog.select({ title: name, options: ["Edit", "Rename", "Duplicate", "Delete"].map((value) => ({ title: value, value })) })
  if (action === "Edit") return editProfile(ui, file, providers, agents, name)
  if (action === "Rename") {
    const target = await profileName(ui, file, name, name)
    if (target !== undefined) return renameProfile(file, name, target)
  }
  if (action === "Duplicate") {
    const target = await profileName(ui, file, suggestedDuplicateName(name, Object.keys(file.profiles)))
    if (target !== undefined) return commitProfile(file, { name: target, profile: duplicateProfile(file.profiles[name]!), setActive: false })
  }
  if (action === "Delete" && await ui.dialog.confirm({ title: "Delete profile", message: `Delete "${name}"?` }) === true) return deleteProfile(file, name)
}
