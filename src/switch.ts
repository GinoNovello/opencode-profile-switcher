import { readProfiles, setActiveProfile } from "./config.js"
import { defaultProfilesPath } from "./paths.js"

/**
 * Minimal shape of the plugin `client` needed to trigger a live switch. The
 * real opencode SDK client (`PluginInput["client"]`) satisfies this.
 */
export interface DisposableClient {
  instance: {
    dispose: (options?: unknown) => Promise<unknown>
  }
}

export interface SwitchOptions {
  /** Path to `profiles.json`. Defaults to the resolved global path. */
  path?: string
  /**
   * Whether to trigger the live reload (`instance.dispose`) after persisting.
   * Defaults to true. Set false to persist only (the `config` hook applies it
   * on the next boot).
   */
  dispose?: boolean
}

export interface SwitchResult {
  /** True when the profile was persisted as active. */
  ok: boolean
  /** The now-active profile name (present on success). */
  active?: string
  /** Whether `instance.dispose()` was called successfully. */
  disposed: boolean
  /** Failure reason, or a partial-success note (persisted but dispose failed). */
  error?: string
}

/**
 * Switch the active profile live (decision #10, prototype #14): persist the new
 * active profile to `profiles.json`, then call `client.instance.dispose()`
 * (`POST /instance/dispose`). opencode re-bootstraps the instance on the next
 * request, re-runs the `config` hook, and the new profile's models take effect
 * without restarting the process; open sessions survive.
 *
 * This is the entry point the TUI (#18) consumes. It never throws:
 * - unknown profile -> `{ ok: false }` with an error.
 * - corrupt profiles.json -> `{ ok: false }` (never clobbers the file).
 * - persisted but dispose failed -> `{ ok: true, disposed: false, error }`.
 */
export async function switchProfile(
  name: string,
  client: DisposableClient,
  options: SwitchOptions = {},
): Promise<SwitchResult> {
  const path = options.path ?? defaultProfilesPath()

  const current = readProfiles(path)
  if (current.status === "invalid") {
    return { ok: false, disposed: false, error: `profiles.json is corrupt: ${current.error}` }
  }
  if (!current.profiles.profiles[name]) {
    return { ok: false, disposed: false, error: `unknown profile: "${name}"` }
  }

  setActiveProfile(name, path)

  if (options.dispose === false) {
    return { ok: true, active: name, disposed: false }
  }

  try {
    await client.instance.dispose()
    return { ok: true, active: name, disposed: true }
  } catch (error) {
    return {
      ok: true,
      active: name,
      disposed: false,
      error: `profile persisted but live reload failed: ${(error as Error).message}`,
    }
  }
}
