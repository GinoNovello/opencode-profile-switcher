// Isolate OUR code from opencode's loader: import the built tui module, call
// tui(api) with a fake TUI api, assert it registers a /profile slash command.
import mod from "../../../dist/tui.js"
let registered = []
const fakeApi = {
  keymap: { registerLayer: (layer) => { registered.push(layer) } },
  ui: { toast(){}, dialog:{ replace(){}, clear(){} }, DialogSelect(){}, DialogPrompt(){}, DialogConfirm(){} },
  state: { provider: [] },
  client: {},
}
console.log("default export keys:", Object.keys(mod))
if (typeof mod.tui !== "function") { console.log("RED: default.tui is not a function"); process.exit(1) }
try {
  await mod.tui(fakeApi)
} catch (e) {
  console.log("RED: tui(api) threw:", e && e.message); process.exit(1)
}
const cmds = registered.flatMap(l => l.commands || [])
const profile = cmds.find(c => c.slashName === "profile")
console.log("layers registered:", registered.length, "| commands:", cmds.map(c=>c.slashName))
console.log(profile ? "GREEN: /profile command registered by our code" : "RED: no /profile command")
