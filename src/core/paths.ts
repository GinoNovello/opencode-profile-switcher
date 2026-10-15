import { homedir } from "node:os"
import { join } from "node:path"

export interface ProfilesPathOptions {
  /**
   * Honour `OPENCODE_CONFIG_DIR` (`$OPENCODE_CONFIG_DIR/profiles.json`) ahead
   * of the XDG location. opencode 2.0 reads its config from that directory, so
   * the 2.0 adapter opts in; the 1.x adapter does not, because existing 1.x
   * installs keep `profiles.json` in the global config dir even when the
   * variable is set (Orca, for one, exports it), and moving the file under
   * them would look like every profile vanished.
   */
  configDir?: boolean
}

/**
 * Resolve the path to `profiles.json`.
 *
 * Precedence:
 * 1. `OPENCODE_PROFILES_PATH` — explicit override (used by tests, never the
 *    user's real config).
 * 2. `$OPENCODE_CONFIG_DIR/profiles.json`, only with `options.configDir`.
 * 3. `$XDG_CONFIG_HOME/opencode/profiles.json`.
 * 4. `~/.config/opencode/profiles.json` (the opencode default global config dir).
 */
export function defaultProfilesPath(
  env: NodeJS.ProcessEnv = process.env,
  options: ProfilesPathOptions = {},
): string {
  const override = env.OPENCODE_PROFILES_PATH
  if (override && override.length > 0) return override

  const configDir = env.OPENCODE_CONFIG_DIR
  if (options.configDir && configDir && configDir.length > 0) {
    return join(configDir, "profiles.json")
  }

  const xdg = env.XDG_CONFIG_HOME
  const configBase = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config")
  return join(configBase, "opencode", "profiles.json")
}
