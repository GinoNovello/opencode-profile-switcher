import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { applyProfile, type MutableConfig } from "./apply.js"
import { readProfiles, writeEffectiveState } from "./config.js"

const LOG_SERVICE = "profile-switcher"

type LogLevel = "info" | "warn" | "error"

/** Best-effort server-side log; never throws. */
async function log(client: OpencodeClient, level: LogLevel, message: string): Promise<void> {
  try {
    await client.app.log({ body: { service: LOG_SERVICE, level, message } })
  } catch {
    // logging is non-critical
  }
}

/**
 * Server-side plugin entry (`opencode-profile-switcher/server`).
 *
 * The `config` hook reads `profiles.json` and applies the active profile's
 * tiers to the resolved config on every boot. opencode re-runs this hook after
 * `instance.dispose()`, which is how a live switch (see `switchProfile`) takes
 * effect without restarting the process.
 *
 * Note: the `config` hook runs before opencode's built-in agents are
 * enumerable, so agents are derived from the active profile's placements +
 * existing config here.
 * Runtime enumeration (`enumerateAgentNames`) is exported for callers that run
 * after boot (e.g. the TUI switch flow in #18).
 */
export const server: Plugin = async ({ client }) => {
  return {
    config: async (cfg) => {
      const read = readProfiles()

      if (read.status === "invalid") {
        await log(
          client,
          "warn",
          `profiles.json could not be read (${read.error}); leaving models untouched`,
        )
        return
      }

      const result = applyProfile(cfg as unknown as MutableConfig, read.profiles)

      if (!result.applied) {
        if (result.reason === "unknown-active") {
          await log(
            client,
            "warn",
            `active profile "${result.active}" is not defined; run the profile-switcher wizard`,
          )
        }
        return
      }

      // Persist last-applied model/variant per agent so later exclusions can
      // restore them across switches and restarts. Never write when the file
      // was invalid (already bailed above) or when nothing changed.
      if (result.effectiveChanged) {
        const written = writeEffectiveState(result.effective, read.path)
        if (written.status === "invalid") {
          await log(
            client,
            "warn",
            `profile applied but effective state not persisted (${written.error})`,
          )
        }
      }

      const parts = [`profile "${result.active}" applied`]
      if (result.unassigned.length > 0) {
        parts.push(`unassigned agents fell back to rest: ${result.unassigned.join(", ")}`)
      }
      if (read.migrated) {
        parts.push("migrated from the 0.1.2 format")
      }
      await log(client, "info", parts.join(" | "))
    },
  }
}

// `id` is REQUIRED when opencode loads this module from an absolute file path
// (the `plugin` array in opencode.jsonc uses `source: "file"`). Without it,
// opencode's `resolvePluginId` throws "Path plugin ... must export id" and drops
// the plugin, so the profile is never applied. See test/plugin-loading.test.ts.
export default { id: "opencode-profile-switcher", server } satisfies PluginModule

// Public API consumed by the TUI (#18) and downstream tooling.
export * from "./schema.js"
export * from "./config.js"
export * from "./apply.js"
export * from "./switch.js"
export * from "./agents.js"
export { defaultProfilesPath } from "./paths.js"
