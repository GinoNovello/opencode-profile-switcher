import { Plugin } from "@opencode/plugin/tui"
import { setupTui } from "./tui-plugin.js"

export default Plugin.define({ id: "opencode-profile-switcher-v2.tui", setup: setupTui })
