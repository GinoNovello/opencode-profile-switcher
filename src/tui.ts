import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { enumerateAgents, type AgentListerClient } from "./agents.js"
import { readProfiles, writeProfiles } from "./config.js"
import {
  buildModelOptions,
  buildVariantOptions,
  findModel,
  NO_VARIANT,
  type ProviderLike,
} from "./models.js"
import { defaultProfilesPath } from "./paths.js"
import {
  buildPickerOptions,
  switchResultToast,
  formatAlreadyActiveToast,
  type PickerAction,
} from "./picker.js"
import type { ProfilesFile } from "./schema.js"
import type { SelectOption } from "./select.js"
import { switchProfile, type DisposableClient } from "./switch.js"
import {
  buildAssignmentOptions,
  buildProfile,
  commitProfile,
  defaultAssignment,
  deleteProfile,
  nextPlacement,
  placementOf,
  renameProfile,
  setPlacement,
  updateProfileModels,
  validateProfileName,
} from "./wizard.js"

/**
 * TUI plugin entry (`opencode-profile-switcher/tui`) — ticket #18.
 *
 * Registers the `/profile` slash command. Because plugin slash commands receive
 * no arguments (research §2.2), `/profile` opens a fuzzy `DialogSelect` picker
 * rather than parsing a name. From there the user switches a profile, creates a
 * new one, or opens the configure menu.
 *
 * This module is deliberately thin: all decision logic (which options to show,
 * how to transform `profiles.json`, how to phrase a toast) lives in the pure,
 * unit-tested modules `picker.ts`, `wizard.ts` and `models.ts`. Everything here
 * just wires `api.ui.*` dialogs to those functions. The dialog wiring cannot be
 * exercised headlessly, so it is kept as small as possible.
 */

/** Bundles the bits of the TUI API + resolved path each flow needs. */
interface Ctx {
  api: TuiPluginApi
  path: string
}

// --- thin dialog wrappers ---------------------------------------------------

function toast(ctx: Ctx, variant: "info" | "success" | "warning" | "error", message: string): void {
  ctx.api.ui.toast({ variant, message })
}

function closeDialogs(ctx: Ctx): void {
  ctx.api.ui.dialog.clear()
}

function showSelect<Value>(
  ctx: Ctx,
  input: {
    title: string
    placeholder?: string
    options: SelectOption<Value>[]
    onSelect: (value: Value) => void
  },
): void {
  ctx.api.ui.dialog.replace(() =>
    ctx.api.ui.DialogSelect<Value>({
      title: input.title,
      placeholder: input.placeholder,
      options: input.options.map((option) => ({
        title: option.title,
        value: option.value,
        description: option.description,
        category: option.category,
      })),
      onSelect: (option: { value: Value }) => input.onSelect(option.value),
    }),
  )
}

function showPrompt(
  ctx: Ctx,
  input: { title: string; placeholder?: string; value?: string; onConfirm: (value: string) => void },
): void {
  ctx.api.ui.dialog.replace(() =>
    ctx.api.ui.DialogPrompt({
      title: input.title,
      placeholder: input.placeholder,
      value: input.value,
      onConfirm: (value: string) => input.onConfirm(value),
      onCancel: () => closeDialogs(ctx),
    }),
  )
}

function showConfirm(
  ctx: Ctx,
  input: { title: string; message: string; onConfirm: () => void; onCancel?: () => void },
): void {
  ctx.api.ui.dialog.replace(() =>
    ctx.api.ui.DialogConfirm({
      title: input.title,
      message: input.message,
      onConfirm: input.onConfirm,
      onCancel: input.onCancel ?? (() => closeDialogs(ctx)),
    }),
  )
}

// --- shared building blocks -------------------------------------------------

/** The connected providers, structurally narrowed to what the wizard reads. */
function providers(ctx: Ctx): ProviderLike[] {
  return (ctx.api.state.provider ?? []) as unknown as ProviderLike[]
}

/** Persist the file, trigger a live switch to `name`, and toast the outcome. */
async function persistAndSwitch(ctx: Ctx, next: ProfilesFile, name: string): Promise<void> {
  writeProfiles(next, ctx.path)
  const result = await switchProfile(name, ctx.api.client as unknown as DisposableClient, {
    path: ctx.path,
  })
  const profile = next.profiles[name]
  if (profile) {
    const t = switchResultToast(name, profile, result)
    toast(ctx, t.variant, t.message)
  }
  closeDialogs(ctx)
}

/** Prompt for a valid, unique profile name, re-prompting on validation errors. */
function promptName(
  ctx: Ctx,
  existing: string[],
  self: string | undefined,
  onValid: (name: string) => void,
): void {
  showPrompt(ctx, {
    title: self ? "Rename profile" : "Profile name",
    placeholder: "e.g. glm",
    value: self,
    onConfirm: (raw) => {
      const check = validateProfileName(raw, existing, self)
      if (!check.ok) {
        toast(ctx, "error", check.error ?? "Invalid name.")
        promptName(ctx, existing, self, onValid)
        return
      }
      onValid(raw.trim())
    },
  })
}

/**
 * Pick heavy model (+ optional variant) then rest model. Falls back to free-text
 * prompts when no providers are connected (documented limitation: we cannot
 * enumerate models without a connected provider list).
 */
function pickModels(
  ctx: Ctx,
  onDone: (heavyModel: string, restModel: string, heavyVariant?: string) => void,
): void {
  const list = providers(ctx)

  if (list.length === 0) {
    toast(ctx, "warning", "No connected providers found — enter model ids manually.")
    showPrompt(ctx, {
      title: "Heavy tier model (provider/model)",
      placeholder: "anthropic/claude-...",
      onConfirm: (heavy) =>
        showPrompt(ctx, {
          title: "Rest tier model (provider/model)",
          placeholder: "anthropic/claude-...",
          onConfirm: (rest) => onDone(heavy.trim(), rest.trim()),
        }),
    })
    return
  }

  const modelOptions = buildModelOptions(list)
  showSelect<string>(ctx, {
    title: "Heavy tier model",
    placeholder: "Filter models…",
    options: modelOptions,
    onSelect: (heavy) => {
      const choice = findModel(list, heavy)
      const chooseRest = (variant?: string) =>
        showSelect<string>(ctx, {
          title: "Rest tier model",
          placeholder: "Filter models…",
          options: modelOptions,
          onSelect: (rest) => onDone(heavy, rest, variant),
        })

      if (choice && choice.variants.length > 0) {
        showSelect<string>(ctx, {
          title: `Heavy variant — ${choice.modelName}`,
          options: buildVariantOptions(choice.variants),
          onSelect: (variant) => chooseRest(variant === NO_VARIANT ? undefined : variant),
        })
      } else {
        chooseRest()
      }
    },
  })
}

/**
 * The assignment/exclusion editor: cycle each agent heavy → rest → excluded,
 * then "Done". Loops by re-rendering the dialog after each change.
 */
async function editAssignment(
  ctx: Ctx,
  initial: Pick<ProfilesFile, "assignment" | "exclusions">,
  onDone: (maps: Pick<ProfilesFile, "assignment" | "exclusions">) => void,
): Promise<void> {
  const agents = await enumerateAgents(ctx.api.client as unknown as AgentListerClient)

  if (agents.length === 0) {
    toast(ctx, "warning", "Could not enumerate agents — keeping the current assignment.")
    onDone(initial)
    return
  }

  let working: Pick<ProfilesFile, "assignment" | "exclusions"> = {
    assignment: { ...initial.assignment },
    exclusions: [...initial.exclusions],
  }

  const render = () => {
    showSelect(ctx, {
      title: "Assignment — select an agent to cycle heavy → rest → excluded",
      options: buildAssignmentOptions(working, agents),
      onSelect: (value) => {
        if (value.kind === "done") {
          onDone(working)
          return
        }
        working = setPlacement(working, value.name, nextPlacement(placementOf(working, value.name)))
        render()
      },
    })
  }
  render()
}

/** Pick one existing profile by name. */
function pickProfile(
  ctx: Ctx,
  file: ProfilesFile,
  title: string,
  onPick: (name: string) => void,
): void {
  const options: SelectOption<string>[] = Object.keys(file.profiles)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ title: name, value: name }))
  showSelect<string>(ctx, { title, options, onSelect: onPick })
}

// --- wizards ----------------------------------------------------------------

/** First-run wizard: build the shared assignment, then name + models. */
async function runFirstRunWizard(ctx: Ctx): Promise<void> {
  const agents = await enumerateAgents(ctx.api.client as unknown as AgentListerClient)
  const initial: Pick<ProfilesFile, "assignment" | "exclusions"> = {
    assignment: defaultAssignment(agents),
    exclusions: [],
  }

  const toDetails = (maps: Pick<ProfilesFile, "assignment" | "exclusions">) => {
    promptName(ctx, [], undefined, (name) => {
      pickModels(ctx, (heavy, rest, variant) => {
        const base = readProfiles(ctx.path).profiles
        const next = commitProfile(base, {
          name,
          profile: buildProfile(heavy, rest, variant),
          assignment: maps.assignment,
          exclusions: maps.exclusions,
          setActive: true,
        })
        void persistAndSwitch(ctx, next, name)
      })
    })
  }

  if (agents.length === 0) {
    toDetails(initial)
    return
  }

  const heavyCount = Object.values(initial.assignment).filter((tier) => tier === "heavy").length
  const restCount = agents.length - heavyCount
  showConfirm(ctx, {
    title: "Set up profiles",
    message: `Default assignment: ${heavyCount} primary agent(s) → heavy, ${restCount} other(s) → rest. Customize it?`,
    onConfirm: () => void editAssignment(ctx, initial, toDetails),
    onCancel: () => toDetails(initial),
  })
}

/** New-profile wizard: reuse the shared assignment, ask name + models only. */
function runNewProfileWizard(ctx: Ctx, file: ProfilesFile): void {
  promptName(ctx, Object.keys(file.profiles), undefined, (name) => {
    pickModels(ctx, (heavy, rest, variant) => {
      const next = commitProfile(file, {
        name,
        profile: buildProfile(heavy, rest, variant),
        setActive: true,
      })
      void persistAndSwitch(ctx, next, name)
    })
  })
}

// --- configure menu ---------------------------------------------------------

type ConfigAction =
  | { kind: "edit" }
  | { kind: "rename" }
  | { kind: "delete" }
  | { kind: "assignment" }

/** Persist a configure edit and re-apply live if it changed the active profile. */
async function saveConfigEdit(ctx: Ctx, next: ProfilesFile, affectsActive: boolean): Promise<void> {
  writeProfiles(next, ctx.path)
  if (affectsActive && next.active && next.profiles[next.active]) {
    await switchProfile(next.active, ctx.api.client as unknown as DisposableClient, { path: ctx.path })
  }
  toast(ctx, "success", "Profiles updated.")
  closeDialogs(ctx)
}

function openConfigureMenu(ctx: Ctx, file: ProfilesFile): void {
  const options: SelectOption<ConfigAction>[] = []
  if (Object.keys(file.profiles).length > 0) {
    options.push(
      { title: "Edit models…", value: { kind: "edit" }, description: "Change a profile's heavy/rest models" },
      { title: "Rename profile…", value: { kind: "rename" } },
      { title: "Delete profile…", value: { kind: "delete" } },
    )
  }
  options.push({
    title: "Adjust assignment / exclusions…",
    value: { kind: "assignment" },
    description: "Shared agent → tier map",
  })

  showSelect<ConfigAction>(ctx, {
    title: "Configure profiles",
    options,
    onSelect: (action) => {
      switch (action.kind) {
        case "edit":
          pickProfile(ctx, file, "Edit which profile?", (name) => {
            pickModels(ctx, (heavy, rest, variant) => {
              const next = updateProfileModels(file, name, buildProfile(heavy, rest, variant))
              void saveConfigEdit(ctx, next, name === file.active)
            })
          })
          break
        case "rename":
          pickProfile(ctx, file, "Rename which profile?", (name) => {
            promptName(ctx, Object.keys(file.profiles), name, (renamed) => {
              const next = renameProfile(file, name, renamed)
              void saveConfigEdit(ctx, next, false)
            })
          })
          break
        case "delete":
          pickProfile(ctx, file, "Delete which profile?", (name) => {
            showConfirm(ctx, {
              title: "Delete profile",
              message: `Delete profile "${name}"? This cannot be undone.`,
              onConfirm: () => {
                const next = deleteProfile(file, name)
                writeProfiles(next, ctx.path)
                toast(ctx, "success", `Deleted profile "${name}".`)
                closeDialogs(ctx)
              },
            })
          })
          break
        case "assignment":
          void editAssignment(ctx, file, (maps) => {
            const next: ProfilesFile = { ...file, ...maps }
            void saveConfigEdit(ctx, next, true)
          })
          break
      }
    },
  })
}

// --- entry ------------------------------------------------------------------

/** Handle a selection from the top-level `/profile` picker. */
function handlePick(ctx: Ctx, file: ProfilesFile, action: PickerAction): void {
  switch (action.kind) {
    case "new":
      runNewProfileWizard(ctx, file)
      break
    case "configure":
      openConfigureMenu(ctx, file)
      break
    case "profile": {
      const { name } = action
      const profile = file.profiles[name]
      if (!profile) return
      if (name === file.active) {
        toast(ctx, "info", formatAlreadyActiveToast(name))
        closeDialogs(ctx)
        return
      }
      void (async () => {
        const result = await switchProfile(name, ctx.api.client as unknown as DisposableClient, {
          path: ctx.path,
        })
        const t = switchResultToast(name, profile, result)
        toast(ctx, t.variant, t.message)
        closeDialogs(ctx)
      })()
      break
    }
  }
}

/** Open the `/profile` picker, or route straight to the wizard when needed. */
function openProfileMenu(ctx: Ctx): void {
  const read = readProfiles(ctx.path)

  if (read.status === "invalid") {
    toast(ctx, "error", `profiles.json is corrupt: ${read.error ?? "unknown error"}`)
    showConfirm(ctx, {
      title: "Corrupt profiles.json",
      message: "Could not read profiles.json. Start the setup wizard? This overwrites the file.",
      onConfirm: () => void runFirstRunWizard(ctx),
    })
    return
  }

  if (read.status === "missing" || Object.keys(read.profiles.profiles).length === 0) {
    void runFirstRunWizard(ctx)
    return
  }

  showSelect<PickerAction>(ctx, {
    title: "Profiles",
    placeholder: "Filter profiles…",
    options: buildPickerOptions(read.profiles),
    onSelect: (action) => handlePick(ctx, read.profiles, action),
  })
}

export const tui: TuiPlugin = async (api) => {
  const ctx: Ctx = { api, path: defaultProfilesPath() }

  api.keymap.registerLayer({
    commands: [
      {
        name: "profile-switcher.open",
        title: "Switch profile",
        desc: "Pick, create or configure model profiles",
        category: "Profiles",
        namespace: "palette",
        slashName: "profile",
        run: () => {
          try {
            openProfileMenu(ctx)
          } catch (error) {
            toast(ctx, "error", `profile-switcher failed: ${(error as Error).message}`)
          }
        },
      },
    ],
  })
}

export default tui
