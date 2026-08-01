// THROWAWAY PROTOTYPE PLUGIN — profile-switcher ticket #14
// Question it answers: can the `config(cfg)` hook + POST /instance/dispose change
// the effective model in a LIVE opencode server (no process restart)?
//
// This plugin persists NOTHING itself. It reads the "active profile" from a state
// file whose path comes from env PROTO_STATE_FILE. The harness (run.sh) writes the
// profile name into that file (simulating the real plugin's "persist" step) and then
// triggers POST /instance/dispose. On the next request opencode re-boots the instance,
// re-runs this hook, re-reads the state file, and applies the new profile's models.
import { readFileSync } from "node:fs"
import type { Plugin } from "@opencode-ai/plugin"

type Tier = { model: string }
const PROFILES: Record<string, { heavy: Tier; small: Tier }> = {
  A: { heavy: { model: "alpha-provider/alpha-heavy" }, small: { model: "alpha-provider/alpha-small" } },
  B: { heavy: { model: "beta-provider/beta-heavy" }, small: { model: "beta-provider/beta-small" } },
}
// Agents we force to the heavy model so we can observe per-agent switching too.
const HEAVY_AGENTS = ["build", "plan", "general"]

function activeProfile(): string {
  try {
    return readFileSync(process.env.PROTO_STATE_FILE!, "utf8").trim()
  } catch {
    return "A"
  }
}

export default (async ({ client }) => {
  return {
    config: async (cfg: any) => {
      const name = activeProfile()
      const def = PROFILES[name]
      if (!def) return

      cfg.model = def.heavy.model
      cfg.small_model = def.small.model

      if (!cfg.agent) cfg.agent = {}
      for (const agent of HEAVY_AGENTS) {
        if (!cfg.agent[agent]) cfg.agent[agent] = {}
        cfg.agent[agent].model = def.heavy.model
      }

      try {
        await client.app.log({
          body: {
            service: "proto-switcher",
            level: "info",
            message: `BOOT profile=${name} model=${cfg.model} small=${cfg.small_model}`,
          },
        })
      } catch {}
    },
  }
}) satisfies Plugin
