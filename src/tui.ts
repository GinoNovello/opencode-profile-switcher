import type { TuiPlugin } from "@opencode-ai/plugin/tui"

/**
 * TUI plugin entry (`opencode-profile-switcher/tui`).
 *
 * STUB — the interactive UI (the `/profile` command, the wizard, and the live
 * switch trigger) is built in ticket #18. It will consume the server-side API
 * re-exported from `opencode-profile-switcher/server` (`switchProfile`,
 * `readProfiles`, `applyProfile`, `enumerateAgentNames`, ...).
 *
 * For now this registers nothing so the package loads cleanly if referenced.
 */
export const tui: TuiPlugin = async () => {
  // Intentionally empty until #18.
}

export default tui
