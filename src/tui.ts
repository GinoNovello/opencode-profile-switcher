import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiSlotContext } from "@opencode-ai/plugin/tui"
import type { JSX } from "@opentui/solid"
import { jsx } from "@opentui/solid/jsx-runtime"
import { createSignal } from "solid-js"
import { enumerateAgents, type AgentListerClient } from "./agents.js"
import { readProfiles, writeProfiles } from "./config.js"
import { formatProfileIndicator } from "./indicator.js"
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
import type { Profile, ProfilesFile } from "./schema.js"
import type { SelectOption } from "./select.js"
import { switchProfile, type DisposableClient } from "./switch.js"
import {
  buildPlacementOptions,
  buildProfile,
  buildSpecificOptions,
  commitProfile,
  duplicateProfile,
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
  suggestedDuplicateName,
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
    /**
     * Row the dialog should seek to on mount. `dialog.replace` mounts a *fresh*
     * DialogSelect whose selection starts at row 0, so any flow that re-renders
     * itself in place must pass this or the cursor jumps to the top of the list.
     */
    current?: Value
    onSelect: (value: Value) => void
  },
): void {
  ctx.api.ui.dialog.replace(() =>
    ctx.api.ui.DialogSelect<Value>({
      title: input.title,
      placeholder: input.placeholder,
      current: input.current,
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

/** The value shape both agent-row editors below put on their select options. */
type AgentRow = { kind: "agent"; name: string } | { kind: "done" }

/**
 * Resolve `remembered` against a freshly built option list and return *that
 * list's* value object. Returning the new object (rather than the remembered
 * one) keeps reference identity with the option the dialog is rendering, so
 * `current` matches however opencode compares it. Returns `undefined` on the
 * first render or when the row no longer exists.
 */
function rowToSeek(options: SelectOption<AgentRow>[], remembered?: AgentRow): AgentRow | undefined {
  if (!remembered) return undefined
  return options.find(
    (option) =>
      option.value.kind === remembered.kind &&
      (option.value.kind !== "agent" ||
        remembered.kind !== "agent" ||
        option.value.name === remembered.name),
  )?.value
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
  /** Prefill when creating (e.g. a suggested duplicate name); rename uses `self`. */
  initial?: string,
): void {
  showPrompt(ctx, {
    title: self ? "Rename profile" : "Profile name",
    placeholder: "e.g. glm",
    value: initial ?? self,
    onConfirm: (raw) => {
      const check = validateProfileName(raw, existing, self)
      if (!check.ok) {
        toast(ctx, "error", check.error ?? "Invalid name.")
        promptName(ctx, existing, self, onValid, initial)
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
 *
 * When `current` is provided (duplicate flow), offer "Keep current models" first
 * so stale/disconnected model strings survive if the user leaves them untouched.
 */
function pickModels(
  ctx: Ctx,
  onDone: (heavyModel: string, restModel: string, heavyVariant?: string) => void,
  current?: Pick<Profile, "heavy" | "rest">,
): void {
  if (current) {
    const heavyLabel = current.heavy.variant
      ? `${current.heavy.model} (${current.heavy.variant})`
      : current.heavy.model
    showSelect<"keep" | "change">(ctx, {
      title: "Heavy & rest models",
      options: [
        {
          title: "Keep current models",
          value: "keep",
          description: `heavy: ${heavyLabel} · rest: ${current.rest.model}`,
        },
        {
          title: "Change models…",
          value: "change",
          description: "Pick new heavy and rest models",
        },
      ],
      onSelect: (choice) => {
        if (choice === "keep") {
          onDone(current.heavy.model, current.rest.model, current.heavy.variant)
        } else {
          pickModels(ctx, onDone)
        }
      },
    })
    return
  }

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

  // The row the user last acted on, so the re-render lands the cursor back on
  // it instead of snapping to the top of the agent list.
  let seek: AgentRow | undefined

  const render = () => {
    const options = buildPlacementOptions(placements, agents)
    showSelect(ctx, {
      title: "Placements — select an agent to cycle heavy → rest → specific → excluded",
      options,
      current: rowToSeek(options, seek),
      onSelect: (value) => {
        if (value.kind === "done") {
          onDone(placements, specifics)
          return
        }
        const next = cycleAgentPlacement(placements, specifics, value.name)
        placements = next.placements
        specifics = next.specifics
        seek = value
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
  let seek: AgentRow | undefined

  const render = () => {
    const progress = specificsProgress(placements, specifics)
    const options = buildSpecificOptions(placements, specifics)
    showSelect(ctx, {
      title: `Specific models — ${progress.done}/${progress.total} set (any order)`,
      options,
      current: rowToSeek(options, seek),
      onSelect: (value) => {
        if (value.kind === "done") {
          if (!specificsComplete(placements, specifics)) {
            toast(
              ctx,
              "error",
              `Set a model for: ${progress.missing.join(", ")}`,
            )
            seek = value
            render()
            return
          }
          onDone(specifics)
          return
        }
        pickOneModel(ctx, `Model for ${value.name}`, (model, variant) => {
          specifics = setSpecific(specifics, value.name, model, variant)
          seek = value
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

type ConfigAction =
  | { kind: "edit" }
  | { kind: "rename" }
  | { kind: "duplicate" }
  | { kind: "delete" }

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
    {
      title: "Duplicate profile…",
      value: { kind: "duplicate" },
      description: "Duplicate a profile into a new inactive one",
    },
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
        case "duplicate":
          pickProfile(ctx, file, "Duplicate which profile?", (sourceName) => {
            const source = file.profiles[sourceName]
            if (!source) return
            // Full independent draft: heavy/rest/variants/placements/specifics
            // (including stale model strings) are prefilled. Cancel at any
            // dialog writes nothing. Save commits inactive and leaves
            // active/effective untouched.
            const draft = duplicateProfile(source)
            const existing = Object.keys(file.profiles)
            const suggested = suggestedDuplicateName(sourceName, existing)
            promptName(ctx, existing, undefined, (name) => {
              void editPlacements(
                ctx,
                copyPlacements(draft),
                copySpecifics(draft),
                (placements, specifics) => {
                  pickModels(
                    ctx,
                    (heavy, rest, variant) => {
                      configureSpecifics(ctx, placements, specifics, (finalSpecifics) => {
                        const profile = buildProfile(
                          heavy,
                          rest,
                          placements,
                          variant,
                          finalSpecifics,
                        )
                        const next = commitProfile(file, {
                          name,
                          profile,
                          setActive: false,
                        })
                        void saveConfigEdit(ctx, next, false)
                      })
                    },
                    { heavy: draft.heavy, rest: draft.rest },
                  )
                },
              )
            }, suggested)
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

/**
 * Register the persistent profile indicator (`home_prompt_right` +
 * `session_prompt_right` slots) — ticket #24.
 *
 * The indicator shows `name · shortHeavyModel` in muted text to the right of
 * the prompt on both home and session screens. All formatting decisions live
 * in the pure `indicator.ts`; here we only:
 *   - hold the current label in a Solid signal (so the slot re-renders on
 *     change — opentui/solid runs each slot renderer inside a Solid memo, so
 *     reading the signal during render is enough to subscribe),
 *   - refresh that label on init, on terminal resize (drives the
 *     narrow/full collapse), and whenever a live switch lands (opencode emits
 *     `server.instance.disposed` after `instance.dispose()`, which is how
 *     `switchProfile` applies a new profile without restarting).
 *
 * The slot renderer returns `null` when there is no label, which opentui/solid
 * treats as "no output" (falls back to empty) — so with no active profile the
 * indicator renders nothing at all.
 */
function registerProfileIndicator(api: TuiPluginApi, path: string): void {
  const [label, setLabel] = createSignal<string | null>(null)

  const refresh = (): void => {
    const read = readProfiles(path)
    const active = read.status === "ok" ? read.profiles.active : ""
    const profile = active ? read.profiles.profiles[active] : undefined
    setLabel(formatProfileIndicator({ active, profile, width: api.renderer.width }))
  }

  const onResize = (): void => refresh()
  api.renderer.on("resize", onResize)
  const offDisposed = api.event.on("server.instance.disposed", () => refresh())

  api.lifecycle.onDispose(() => {
    api.renderer.off("resize", onResize)
    offDisposed()
  })

  // Initial paint. Reads `profiles.json`; a missing/corrupt file yields no
  // active profile, so the indicator stays hidden until a profile is applied.
  refresh()

  // The slot is mounted into a `box`, so the element we return must be a
  // renderable in its own right. A bare `span` is a text *node*: opentui/solid
  // rejects it with "Orphan text error: ... must have a <text> as a parent"
  // and crashes the TUI. `text` is the renderable that carries text under a
  // box, so the indicator is emitted as `text` directly.
  const render = (slotCtx: Readonly<TuiSlotContext>): JSX.Element => {
    const text = label()
    if (text === null) return null
    return jsx("text", {
      style: { fg: slotCtx.theme.current.textMuted },
      children: text,
    })
  }

  api.slots.register({
    slots: {
      home_prompt_right: (slotCtx: Readonly<TuiSlotContext>) => render(slotCtx),
      session_prompt_right: (slotCtx: Readonly<TuiSlotContext>) => render(slotCtx),
    },
  })
}

export const tui: TuiPlugin = async (api) => {
  const ctx: Ctx = { api, path: defaultProfilesPath() }

  registerProfileIndicator(api, ctx.path)

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
