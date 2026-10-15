import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Resolve the path to `profiles.json`.
 *
 * Precedence:
 * 1. `OPENCODE_PROFILES_PATH` — explicit override (used by tests, never the
 *    user's real config).
 * 2. `$XDG_CONFIG_HOME/opencode/profiles.json`.
 * 3. `~/.config/opencode/profiles.json` (the opencode default global config dir).
 */
export function defaultProfilesPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCODE_PROFILES_PATH
  if (override && override.length > 0) return override

  const xdg = env.XDG_CONFIG_HOME
  const configBase = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config")
  return join(configBase, "opencode", "profiles.json")
}
