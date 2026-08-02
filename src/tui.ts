import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
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
  buildPlacementOptions,
  buildProfile,
  buildSpecificOptions,
  commitProfile,
  copyPlacements,
  copySpecifics,
  cycleAgentPlacement,
  defaultPlacements,
  deleteProfile,
  renameProfile,
  setSpecific,
  specificAgentNames,
  specificsComplete,
  specificsProgress,
  updateProfile,
  validateProfileName,
  type Placements,
  type Specifics,
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
 * Pick a single model (+ optional variant). Falls back to a free-text prompt
 * when no providers are connected. Reused for heavy/rest tiers and for each
 * `specific` agent slot.
 */
function pickOneModel(
  ctx: Ctx,
  title: string,
  onDone: (model: string, variant?: string) => void,
): void {
  const list = providers(ctx)

  if (list.length === 0) {
    showPrompt(ctx, {
      title: `${title} (provider/model)`,
      placeholder: "anthropic/claude-...",
      onConfirm: (raw) => onDone(raw.trim()),
    })
    return
  }

  const modelOptions = buildModelOptions(list)
  showSelect<string>(ctx, {
    title,
    placeholder: "Filter models…",
    options: modelOptions,
    onSelect: (model) => {
      const choice = findModel(list, model)
      if (choice && choice.variants.length > 0) {
        showSelect<string>(ctx, {
          title: `Variant — ${choice.modelName}`,
          options: buildVariantOptions(choice.variants),
          onSelect: (variant) => onDone(model, variant === NO_VARIANT ? undefined : variant),
        })
      } else {
        onDone(model)
      }
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
 * The per-profile placement editor: cycle each agent
 * heavy → rest → specific → excluded, then "Done". Loops by re-rendering the
 * dialog after each change. Tracks specifics so leaving `specific` drops the
 * slot. When agents cannot be enumerated it keeps the initial state so the
 * flow never blocks.
 */
async function editPlacements(
  ctx: Ctx,
  initialPlacements: Placements,
  initialSpecifics: Specifics,
  onDone: (placements: Placements, specifics: Specifics) => void,
): Promise<void> {
  const agents = await enumerateAgents(ctx.api.client as unknown as AgentListerClient)

  if (agents.length === 0) {
    toast(ctx, "warning", "Could not enumerate agents — keeping the current placements.")
    onDone(initialPlacements, initialSpecifics)
    return
  }

  let placements: Placements = { ...initialPlacements }
  let specifics: Specifics = { ...initialSpecifics }

  const render = () => {
    showSelect(ctx, {
      title: "Placements — select an agent to cycle heavy → rest → specific → excluded",
      options: buildPlacementOptions(placements, agents),
      onSelect: (value) => {
        if (value.kind === "done") {
          onDone(placements, specifics)
          return
        }
        const next = cycleAgentPlacement(placements, specifics, value.name)
        placements = next.placements
        specifics = next.specifics
        render()
      },
    })
  }
  render()
}

/**
 * Configure direct models for every agent placed as `specific`. Agents can be
 * filled in any order; "Done" is blocked until all have a non-empty model.
 * Skips entirely when there are no specific agents.
 */
function configureSpecifics(
  ctx: Ctx,
  placements: Placements,
  initial: Specifics,
  onDone: (specifics: Specifics) => void,
): void {
  if (specificAgentNames(placements).length === 0) {
    onDone(initial)
    return
  }

  let specifics: Specifics = { ...initial }

  const render = () => {
    const progress = specificsProgress(placements, specifics)
    showSelect(ctx, {
      title: `Specific models — ${progress.done}/${progress.total} set (any order)`,
      options: buildSpecificOptions(placements, specifics),
      onSelect: (value) => {
        if (value.kind === "done") {
          if (!specificsComplete(placements, specifics)) {
            toast(
              ctx,
              "error",
              `Set a model for: ${progress.missing.join(", ")}`,
            )
            render()
            return
          }
          onDone(specifics)
          return
        }
        pickOneModel(ctx, `Model for ${value.name}`, (model, variant) => {
          specifics = setSpecific(specifics, value.name, model, variant)
          render()
        })
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

/** First-run wizard: default placements → review → name → models. */
async function runFirstRunWizard(ctx: Ctx): Promise<void> {
  const agents = await enumerateAgents(ctx.api.client as unknown as AgentListerClient)
  const initial = defaultPlacements(agents)

  const toDetails = (placements: Placements, specifics: Specifics) => {
    promptName(ctx, [], undefined, (name) => {
      pickModels(ctx, (heavy, rest, variant) => {
        configureSpecifics(ctx, placements, specifics, (finalSpecifics) => {
          const base = readProfiles(ctx.path).profiles
          const next = commitProfile(base, {
            name,
            profile: buildProfile(heavy, rest, placements, variant, finalSpecifics),
            setActive: true,
          })
          void persistAndSwitch(ctx, next, name)
        })
      })
    })
  }

  if (agents.length === 0) {
    toDetails(initial, {})
    return
  }

  const heavyCount = Object.values(initial).filter((placement) => placement === "heavy").length
  const restCount = agents.length - heavyCount
  showConfirm(ctx, {
    title: "Set up profiles",
    message: `Default placements: ${heavyCount} primary agent(s) → heavy, ${restCount} other(s) → rest. Customize it?`,
    onConfirm: () => void editPlacements(ctx, initial, {}, toDetails),
    onCancel: () => toDetails(initial, {}),
  })
}

/**
 * New-profile wizard: copy the active profile's placements (including
 * `specific` designations) but start with empty specific models so the user
 * must choose fresh direct models. Heavy/rest models are also chosen fresh.
 */
function runNewProfileWizard(ctx: Ctx, file: ProfilesFile): void {
  const activeProfile = file.profiles[file.active]
  const seedPlacements: Placements = activeProfile ? copyPlacements(activeProfile) : {}
  // Intentionally empty: designations copy, models do not.
  const seedSpecifics: Specifics = {}

  promptName(ctx, Object.keys(file.profiles), undefined, (name) => {
    void editPlacements(ctx, seedPlacements, seedSpecifics, (placements, specifics) => {
      pickModels(ctx, (heavy, rest, variant) => {
        configureSpecifics(ctx, placements, specifics, (finalSpecifics) => {
          const next = commitProfile(file, {
            name,
            profile: buildProfile(heavy, rest, placements, variant, finalSpecifics),
            setActive: true,
          })
          void persistAndSwitch(ctx, next, name)
        })
      })
    })
  })
}

// --- configure menu ---------------------------------------------------------

type ConfigAction = { kind: "edit" } | { kind: "rename" } | { kind: "delete" }

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
  if (Object.keys(file.profiles).length === 0) {
    toast(ctx, "info", "No profiles yet — create one first.")
    closeDialogs(ctx)
    return
  }

  const options: SelectOption<ConfigAction>[] = [
    {
      title: "Edit profile…",
      value: { kind: "edit" },
      description: "Review a profile's placements and models",
    },
    { title: "Rename profile…", value: { kind: "rename" } },
    { title: "Delete profile…", value: { kind: "delete" } },
  ]

  showSelect<ConfigAction>(ctx, {
    title: "Configure profiles",
    options,
    onSelect: (action) => {
      switch (action.kind) {
        case "edit":
          pickProfile(ctx, file, "Edit which profile?", (name) => {
            const profile = file.profiles[name]
            if (!profile) return
            // Edit preserves existing specific models.
            void editPlacements(ctx, copyPlacements(profile), copySpecifics(profile), (placements, specifics) => {
              pickModels(ctx, (heavy, rest, variant) => {
                configureSpecifics(ctx, placements, specifics, (finalSpecifics) => {
                  const next = updateProfile(
                    file,
                    name,
                    buildProfile(heavy, rest, placements, variant, finalSpecifics),
                  )
                  void saveConfigEdit(ctx, next, name === file.active)
                })
              })
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

// `id` is REQUIRED when opencode loads this module from an absolute file path
// (the `plugin` array in opencode.jsonc uses `source: "file"`). Without it,
// opencode's `resolvePluginId` throws "Path plugin ... must export id" and drops
// the plugin, so `/profile` never registers. See test/plugin-loading.test.ts.
export default { id: "opencode-profile-switcher", tui } satisfies TuiPluginModule
