import type { Plugin } from "@opencode/plugin"
import { planApply } from "../../../src/core/apply-plan.js"
import {
  readProfiles,
  setActiveProfile,
  writeEffectiveState,
  type ReadResult,
} from "../../../src/core/config.js"
import { defaultProfilesPath } from "../../../src/core/paths.js"
import {
  defaultModel,
  inspectAgents,
  nextEffective,
  writeAgentModels,
  type AgentEditorLike,
  type Inspection,
  type ListedAgent,
} from "./apply.js"
import { ProfileSwitcherRpc, type StatusOutput, type SwitchInput } from "./rpc.js"

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
 * or another switch.
 *
 * Pinned agents. After the last reload of a pass the listed agents are
 * compared with the plan: any whose model differs was pinned by the user's
 * config (ADR-0003), which makes the profile partial. Only agents that took
 * the profile's model are recorded in `effective` (ADR-0002).
 */
export async function setupProfileSwitcher(
  ctx: HostContext,
  options: SwitcherOptions = {},
): Promise<ProfileSwitcher> {
  const path = options.path ?? defaultProfilesPath(process.env, { configDir: true })
  const log = options.log ?? consoleLog
  const attempts = Math.max(1, options.learnAttempts ?? 8)
  const baseDelay = options.learnDelayMs ?? 100
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))

  let read: ReadResult = readProfiles(path)
  let learned: ReadonlySet<string> = new Set()
  // Ids the transform's editor listed on its last run (undefined: never ran).
  let seen: ReadonlySet<string> | undefined
  let inspection: Inspection | undefined
  let ready = false
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

  /** Learned ids the transform did not see, i.e. ones a reload still has to write. */
  function unseen(listed: readonly ListedAgent[]): boolean {
    if (!seen) return true
    return listed.some((agent) => !seen!.has(agent.id))
  }

  /**
   * Finish a pass from the agents just listed: learn their ids, reload once
   * more if the transform could not see some of them, then record what landed
   * and persist the effective state.
   */
  async function settle(listed: ListedAgent[]): Promise<void> {
    learned = new Set(listed.map((agent) => agent.id))
    if (unseen(listed)) {
      await ctx.agent.reload()
      listed = await listAgents()
    }
    ready = true

    if (read.status === "invalid") {
      inspection = undefined
      return
    }
    inspection = inspectAgents(read.profiles, listed)
    if (!inspection) {
      const plan = planApply(read.profiles)
      if (!plan.applied && plan.reason === "unknown-active") {
        log("warn", `active profile "${plan.active}" is not defined; run the profile-switcher wizard`)
      }
      return
    }

    const { effective, changed } = nextEffective(read.profiles.effective, inspection.applied)
    if (changed) {
      const written = writeEffectiveState(effective, path)
      if (written.status === "invalid") {
        log("warn", `profile applied but effective state not persisted (${written.error})`)
      } else {
        read = { ...read, profiles: written.profiles }
      }
    }

    const parts = [`profile "${inspection.plan.active}" applied`]
    if (inspection.plan.unassigned.length > 0) {
      parts.push(`unassigned agents fell back to rest: ${inspection.plan.unassigned.join(", ")}`)
    }
    if (inspection.pinned.length > 0) {
      parts.push(`partial, model pinned by config: ${inspection.pinned.join(", ")}`)
    }
    log(inspection.pinned.length > 0 ? "warn" : "log", parts.join(" | "))
  }

  async function boot(): Promise<void> {
    await firstRun
    for (let attempt = 0; attempt < attempts && !disposed; attempt++) {
      let listed: ListedAgent[]
      try {
        listed = await listAgents()
      } catch (error) {
        if (attempt === attempts - 1) {
          log("warn", `could not list agents (${(error as Error).message}); markdown agents wait for the next switch`)
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
    const partial = !invalid && plan.applied && (inspection?.pinned.length ?? 0) > 0
    return {
      ready,
      path,
      profiles: Object.keys(read.profiles.profiles),
      active: read.profiles.active || null,
      applied: !invalid && plan.applied,
      reason: invalid ? "invalid-file" : plan.applied ? null : plan.reason,
      error: invalid ? (read.error ?? "invalid profiles.json") : null,
      partial,
      pinned: invalid ? [] : [...(inspection?.pinned ?? [])],
      unassigned: invalid ? [] : [...(inspection?.plan.unassigned ?? [])],
      agents: invalid ? [] : (inspection?.agents ?? []).map((agent) => ({ ...agent })),
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

    const previous = learned
    try {
      await ctx.model.reload()
      learned = new Set()
      await ctx.agent.reload()
      await settle(await listAgents())
    } catch (error) {
      if (learned.size === 0) learned = previous
      return {
        ok: false,
        error: "reload_failed",
        message: `profile "${profile}" persisted but the reload failed: ${(error as Error).message}`,
      }
    }
    return { ok: true, status: status() }
  }

  const registration = await ctx.rpc.register(ProfileSwitcherRpc, {
    status: async () => status(),
    switch: async (input, context) => {
      const outcome = await serial(() => switchTo((input as SwitchInput).profile))
      if (!outcome.ok) return context.error(outcome.error, outcome.message, null)
      try {
        await registration.events.emit("switched", {
          profile: (input as SwitchInput).profile,
          partial: outcome.status.partial,
          pinned: outcome.status.pinned,
        })
      } catch (error) {
        log("warn", `switched event not delivered (${(error as Error).message})`)
      }
      return outcome.status
    },
  })

  const bootPass = serial(boot).catch((error) => {
    log("error", `boot pass failed: ${(error as Error).message}`)
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
