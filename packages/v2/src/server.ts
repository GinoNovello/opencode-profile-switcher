import { Plugin } from "@opencode/plugin"
import { setupProfileSwitcher } from "./plugin.js"
import { PLUGIN_ID } from "./rpc.js"

/**
 * Server plugin entry (`opencode-profile-switcher-v2` and `/server`).
 *
 * Applies the active profile of `profiles.json` to the location's agents and
 * default model, and registers the RPC (`./rpc`) the TUI switches through.
 * The entry only exports the plugin so its published declarations depend on
 * nothing but `@opencode/plugin`.
 */
export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const switcher = await setupProfileSwitcher(ctx)
    return switcher.cleanup
  },
})
