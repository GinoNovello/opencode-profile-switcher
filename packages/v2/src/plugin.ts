import type { Plugin } from "@opencode/plugin"
import { isDeepStrictEqual } from "node:util"
import { planApply } from "../../../src/core/apply-plan.js"
import {
  readProfiles,
  setActiveProfile,
  writeProfiles,
  writeEffectiveState,
  type ReadResult,
} from "../../../src/core/config.js"
import { defaultProfilesPath } from "../../../src/core/paths.js"
import { profilesFileSchema } from "../../../src/core/schema.js"
import {
  defaultModel,
  describeInvalidSlot,
  describeUnavailableVariants,
  inspectAgents,
  invalidSlots,
  nextEffective,
  writeAgentModels,
  type AgentEditorLike,
  type CatalogModel,
  type Inspection,
  type ListedAgent,
} from "./apply.js"
import { ProfileSwitcherRpc, type Phase, type SaveProfilesInput, type StatusOutput, type SwitchInput } from "./rpc.js"

/** The part of the plugin context the switcher drives. */
export type HostContext = Pick<Plugin.Context, "agent" | "model" | "rpc">

type LogLevel = "log" | "warn" | "error"

export interface SwitcherOptions {
  /** Path to `profiles.json`. Defaults to the 2.0 path (`OPENCODE_CONFIG_DIR` first). */
  path?: string
  /** Where to log. opencode 2.0 has no log API; defaults to the console. */
  log?: (level: LogLevel, message: string) => void
  /** Tries for the first `ctx.agent.list()` at boot, which may fail while the location loads. */
  learnAttempts?: number
  /** Delay before the first retry; doubles on each one. */
  learnDelayMs?: number
  /** How long a pass waits for `ctx.model.list()` before reporting no variant warnings. */
  catalogTimeoutMs?: number
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

export type SwitchFailure = "unknown_profile" | "invalid_profiles" | "reload_failed"

export type SwitchOutcome =
  | { ok: true; status: StatusOutput }
  | { ok: false; error: SwitchFailure; message: string }

export interface ProfileSwitcher {
  /** Settles when the boot pass is over, whether or not it learned the agents. */
  ready: Promise<void>
  status(): StatusOutput
  switchTo(profile: string): Promise<SwitchOutcome>
  cleanup(): Promise<void>
}

const PREFIX = "[opencode-profile-switcher]"

function consoleLog(level: LogLevel, message: string): void {
  console[level](`${PREFIX} ${message}`)
}

/**
 * The 2.0 server half: applies the active profile through `ctx.agent.transform`
 * and `ctx.model.transform`, and serves the RPC the TUI switches with.
 *
 * Agent ids. The transform runs before opencode's config pass, so its editor
 * lists the built-in agents but not the markdown or config-only ones, and
 * `editor.update` creates any id it is handed. The switcher therefore learns
 * the full set from `ctx.agent.list()` and writes only ids that exist:
 * - At boot the first transform has no learned ids. A background task (not
 *   awaited by `setup`, which would deadlock the location load) waits for the
 *   transform's first run instead of a timer, lists the agents, retrying while
 *   the host is not ready, then reloads once with the learned ids when they
 *   include agents the editor could not see.
 * - On a switch the learned ids are dropped before the first reload, so an
 *   agent removed since the last pass is not recreated as a ghost, then
 *   relearned from that reload's list (a second reload only when it found
 *   agents the editor could not see).
 * Every pass is serialized, so a switch never interleaves with the boot pass
 * or another switch. A pass that cannot finish leaves the status `failed`
 * (never a mix of the old and new profile); the next switch runs a full pass.
 *
 * Agents fixed by config. After the last reload of a pass the listed agents
 * are compared with the plan: any that lists a different model was fixed by
 * the user's config (ADR-0003), which makes the profile partial. Only agents
 * that took the profile's model are recorded in `effective` (ADR-0002).
 *
 * Variants. Those agents are also checked against the model catalog
 * (`ctx.model.list()`): a variant the model does not offer is applied anyway
 * but reported, because the host only rejects it on the next prompt. A catalog
 * that cannot be read, or does not answer within `catalogTimeoutMs`, reports
 * nothing. It is read before the pass is published, so `status()` never answers
 * `ready` without what the pass found.
 */
export async function setupProfileSwitcher(
  ctx: HostContext,
  options: SwitcherOptions = {},
): Promise<ProfileSwitcher> {
  const path = options.path ?? defaultProfilesPath(process.env, { configDir: true })
  const log = options.log ?? consoleLog
  const attempts = Math.max(1, options.learnAttempts ?? 8)
  const baseDelay = options.learnDelayMs ?? 100
  const catalogTimeout = options.catalogTimeoutMs ?? 5000
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))

  let read: ReadResult = readProfiles(path)
  let learned: ReadonlySet<string> = new Set()
  // Ids the transform's editor listed on its last run (undefined: never ran).
  let seen: ReadonlySet<string> | undefined
  // What the last finished pass left; only meaningful while `phase` is ready.
  let inspection: Inspection | undefined
  let phase: Phase = "pending"
  let passError: string | null = null
  let disposed = false
  // Settles on the transform's first run (or on cleanup): the boot pass lists
  // the agents only after it, so the list it gets already went through it.
  let transformed!: () => void
  const firstRun = new Promise<void>((done) => (transformed = done))

  if (read.status === "invalid") {
    log("warn", `profiles.json could not be read (${read.error}); leaving models untouched`)
  }

  const agentTransform = await ctx.agent.transform((editor) => {
    transformed()
    if (read.status === "invalid") return
    // The editor's `DeepMutable` turns branded ids (`Agent.ID`, `Model.ID`)
    // into object types, though they are plain strings at runtime; the cast
    // only restores that.
    const plain = editor as unknown as AgentEditorLike
    seen = new Set(writeAgentModels(plain, read.profiles, learned))
  })

  const modelTransform = await ctx.model.transform((editor) => {
    if (read.status === "invalid") return
    const model = defaultModel(read.profiles)
    if (model) editor.default.set(model.providerID, model.modelID)
  })

  let queue: Promise<unknown> = Promise.resolve()
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function listAgents(): Promise<ListedAgent[]> {
    const listed = await ctx.agent.list()
    return listed.data.map((agent) => ({ id: agent.id, model: agent.model }))
  }

  /**
   * The location's model catalog; empty (nothing to check against) when it
   * cannot be read or does not answer in time, so a hung listing cannot hold
   * the pass queue.
   */
  async function listCatalog(): Promise<CatalogModel[]> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<"timeout">((done) => (timer = setTimeout(() => done("timeout"), catalogTimeout)))
    try {
      const catalog = await Promise.race([ctx.model.list(), timeout])
      if (catalog === "timeout") {
        log("warn", `model catalog did not answer within ${catalogTimeout}ms; variants not checked`)
        return []
      }
      return catalog.data.map((model) => ({ providerID: model.providerID, id: model.id, variants: model.variants }))
    } catch (error) {
      const reason = error instanceof Error ? error.message
        : error && typeof error === "object" && "message" in error ? String(error.message) : String(error)
      log("warn", `model catalog unavailable (${reason}); variants not checked`)
      return []
    } finally {
      clearTimeout(timer)
    }
  }

  /** Whether the listing has agents the transform did not see, which a reload still has to write. */
  function hasUnseenAgents(listed: readonly ListedAgent[]): boolean {
    if (!seen) return true
    return listed.some((agent) => !seen!.has(agent.id))
  }

  function fail(message: string): void {
    phase = "failed"
    passError = message
    inspection = undefined
  }

  /**
   * Finish a pass from the agents just listed: learn their ids, reload once
   * more if the transform could not see some of them, then record what landed
   * and persist the effective state.
   */
  async function settle(listed: ListedAgent[]): Promise<void> {
    learned = new Set(listed.map((agent) => agent.id))
    if (hasUnseenAgents(listed)) {
      await ctx.agent.reload()
      listed = await listAgents()
    }
    // Everything the pass reports is gathered before it is published: until
    // then `status()` keeps answering `pending`.
    const plan = read.status === "invalid"
      ? undefined
      : planApply(read.profiles, { agents: listed.map((agent) => agent.id) })
    const catalog = plan?.applied ? await listCatalog() : []
    phase = "ready"
    passError = null
    inspection = undefined
    if (!plan) return

    if (!plan.applied) {
      if (plan.reason === "unknown-active") {
        log("warn", `active profile "${plan.active}" is not defined; run the profile-switcher wizard`)
      }
      return
    }
    inspection = inspectAgents(read.profiles, plan, listed, catalog)

    const { effective, changed } = nextEffective(read.profiles.effective, inspection.applied)
    if (changed) {
      const written = writeEffectiveState(effective, path)
      if (written.status === "invalid") {
        log("warn", `profile applied but effective state not persisted (${written.error})`)
      } else {
        read = { ...read, profiles: written.profiles }
      }
    }

    const invalid = invalidSlots(read.profiles)
    if (invalid.length > 0) {
      log(
        "warn",
        `invalid model, expected provider/model with the variant apart; left untouched: ${invalid
          .map(describeInvalidSlot)
          .join(", ")}`,
      )
    }

    const parts = [`profile "${plan.active}" applied`]
    if (plan.unassigned.length > 0) {
      parts.push(`unassigned agents fell back to rest: ${plan.unassigned.join(", ")}`)
    }
    if (inspection.fixedByConfig.length > 0) {
      parts.push(`partial, model fixed by config: ${inspection.fixedByConfig.join(", ")}`)
    }
    if (inspection.unapplied.length > 0) {
      parts.push(`no model after the reload: ${inspection.unapplied.join(", ")}`)
    }
    if (inspection.unavailableVariants.length > 0) {
      parts.push(`variant not offered by the model, prompts will fail: ${describeUnavailableVariants(inspection.unavailableVariants)}`)
    }
    const clean = inspection.fixedByConfig.length === 0 && inspection.unapplied.length === 0
      && inspection.unavailableVariants.length === 0
    log(clean ? "log" : "warn", parts.join(" | "))
  }

  async function boot(): Promise<void> {
    await firstRun
    for (let attempt = 0; attempt < attempts && !disposed; attempt++) {
      let listed: ListedAgent[]
      try {
        listed = await listAgents()
      } catch (error) {
        if (attempt === attempts - 1) {
          const message = `could not list agents (${(error as Error).message})`
          log("warn", `${message}; markdown agents wait for the next switch`)
          fail(message)
          return
        }
        await sleep(baseDelay * 2 ** attempt)
        continue
      }
      if (disposed) return
      await settle(listed)
      return
    }
  }

  function status(): StatusOutput {
    const invalid = read.status === "invalid"
    const plan = planApply(read.profiles)
    // Profile names come from disk on every call so a profile the wizard just
    // wrote shows up; what is applied stays the last pass's.
    const fresh = readProfiles(path)
    const names = Object.keys((fresh.status === "invalid" ? read : fresh).profiles.profiles)
    const settled = phase === "ready" && !invalid ? inspection : undefined
    const fixedByConfig = settled?.fixedByConfig ?? []
    return {
      ready: phase === "ready",
      phase,
      path,
      profiles: names,
      active: read.profiles.active || null,
      applied: !invalid && plan.applied,
      reason: invalid ? "invalid-file" : plan.applied ? null : plan.reason,
      error: invalid ? (read.error ?? "invalid profiles.json") : passError,
      partial: fixedByConfig.length > 0,
      fixedByConfig: [...fixedByConfig],
      unapplied: [...(settled?.unapplied ?? [])],
      unassigned: [...(settled?.plan.unassigned ?? [])],
      invalidSlots: invalid ? [] : invalidSlots(read.profiles),
      unavailableVariants: (settled?.unavailableVariants ?? []).map((entry) => ({ ...entry, offered: [...entry.offered] })),
      agents: (settled?.agents ?? []).map((agent) => ({ ...agent })),
    }
  }

  async function switchTo(profile: string): Promise<SwitchOutcome> {
    const current = readProfiles(path)
    if (current.status === "invalid") {
      return { ok: false, error: "invalid_profiles", message: `profiles.json is corrupt: ${current.error}` }
    }
    if (!current.profiles.profiles[profile]) {
      return { ok: false, error: "unknown_profile", message: `unknown profile: "${profile}"` }
    }

    const persisted = setActiveProfile(profile, path)
    if (persisted.status === "invalid") {
      return { ok: false, error: "invalid_profiles", message: `profiles.json is corrupt: ${persisted.error}` }
    }
    read = persisted
    // From here the previous pass no longer describes the agents.
    phase = "pending"
    passError = null
    inspection = undefined

    const previous = learned
    try {
      await ctx.model.reload()
      learned = new Set()
      await ctx.agent.reload()
      await settle(await listAgents())
    } catch (error) {
      if (learned.size === 0) learned = previous
      const message = `profile "${profile}" persisted but the reload failed: ${(error as Error).message}`
      log("error", message)
      fail(message)
      return { ok: false, error: "reload_failed", message }
    }
    return { ok: true, status: status() }
  }

  const registration = await ctx.rpc.register(ProfileSwitcherRpc, {
    readProfiles: async (_input, context) => {
      const current = readProfiles(path)
      if (current.status === "invalid") {
        return context.error("invalid_profiles", `profiles.json is corrupt: ${current.error}`, null)
      }
      return current.profiles
    },
    saveProfiles: async (input, context) => serial(async () => {
      const current = readProfiles(path)
      if (current.status === "invalid") {
        return context.error("invalid_profiles", `profiles.json is corrupt: ${current.error}`, null)
      }
      const draft = input as SaveProfilesInput
      if (draft.expected && !isDeepStrictEqual(draft.expected, {
        profiles: current.profiles.profiles,
        active: current.profiles.active,
      })) {
        return context.error("conflict", "Profiles changed while the wizard was open; reopen it and try again", null)
      }
      const parsed = profilesFileSchema.safeParse({
        profiles: draft.profiles,
        active: draft.active,
        effective: current.profiles.effective,
      })
      if (!parsed.success) {
        return context.error("invalid_profile", parsed.error.message, null)
      }
      if (parsed.data.active && !Object.hasOwn(parsed.data.profiles, parsed.data.active)) {
        return context.error("invalid_profile", "The active profile is not defined", null)
      }
      // Retarget a pure active rename without reloading identical transforms.
      const previous = read.profiles
      const renamed = read.status !== "invalid" && phase === "ready"
        && previous.active === current.profiles.active
        && parsed.data.active !== previous.active
        && !Object.hasOwn(parsed.data.profiles, previous.active)
        && isDeepStrictEqual(previous.profiles[previous.active], current.profiles.profiles[previous.active])
        && isDeepStrictEqual(previous.profiles[previous.active], parsed.data.profiles[parsed.data.active])
        && isDeepStrictEqual(
          Object.fromEntries(Object.entries(current.profiles.profiles).filter(([name]) => name !== previous.active)),
          Object.fromEntries(Object.entries(parsed.data.profiles).filter(([name]) => name !== parsed.data.active)),
        )
      writeProfiles(parsed.data, path)
      if (renamed) {
        const profiles = { ...previous.profiles, [parsed.data.active]: previous.profiles[previous.active]! }
        delete profiles[previous.active]
        read = { status: "ok", profiles: { ...previous, active: parsed.data.active, profiles }, path }
      }
      if (!parsed.data.active && read.profiles.active) {
        read = { status: "ok", profiles: parsed.data, path }
        phase = "pending"
        inspection = undefined
        passError = null
        try {
          await ctx.model.reload()
          learned = new Set()
          await ctx.agent.reload()
          await settle(await listAgents())
        } catch (error) {
          const message = `profiles saved but clearing the active profile failed: ${(error as Error).message}`
          fail(message)
          return context.error("reload_failed", message, null)
        }
        try {
          await registration.events.emit("switched", { profile: "", partial: false, fixedByConfig: [] })
        } catch (error) {
          log("warn", `switched event not delivered (${(error as Error).message})`)
        }
      }
      // Apart from a pure rename, the applied snapshot stays intact until
      // an explicit switch: editing an active profile cannot change transforms.
      if (renamed) {
        const result = status()
        try {
          await registration.events.emit("switched", { profile: parsed.data.active, partial: result.partial, fixedByConfig: result.fixedByConfig })
        } catch (error) {
          log("warn", `switched event not delivered (${(error as Error).message})`)
        }
      }
      return { ...parsed.data, renamed }
    }),
    status: async () => status(),
    switch: async (input, context) => {
      const { profile } = input as SwitchInput
      const outcome = await serial(() => switchTo(profile))
      if (!outcome.ok) return context.error(outcome.error, outcome.message, null)
      try {
        await registration.events.emit("switched", {
          profile,
          partial: outcome.status.partial,
          fixedByConfig: outcome.status.fixedByConfig,
        })
      } catch (error) {
        log("warn", `switched event not delivered (${(error as Error).message})`)
      }
      return outcome.status
    },
  })

  const bootPass = serial(boot).catch((error) => {
    const message = `boot pass failed: ${(error as Error).message}`
    log("error", message)
    fail(message)
  })

  return {
    ready: bootPass,
    status,
    switchTo: (profile) => serial(() => switchTo(profile)),
    async cleanup() {
      disposed = true
      transformed()
      await Promise.allSettled([
        registration.dispose(),
        agentTransform.dispose(),
        modelTransform.dispose(),
      ])
    },
  }
}
