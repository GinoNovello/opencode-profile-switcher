/**
 * Minimal shape of the plugin `client` needed to enumerate agents. Kept loose
 * so callers can pass the real opencode SDK client without a hard type coupling.
 */
export interface AgentListerClient {
  app: {
    agents: () => Promise<unknown>
  }
}

interface RawAgent {
  name?: unknown
  mode?: unknown
  native?: unknown
  hidden?: unknown
  /** Legacy field name in the v1 SDK types; wire format uses `native`. */
  builtIn?: unknown
}

/**
 * An agent's identity plus the two flags the wizard needs to pick a default
 * tier: its `mode` (primary agents default to `heavy`, subagents to `rest`) and
 * whether it is `hidden` (hidden system agents default to `rest`).
 */
export interface AgentInfo {
  name: string
  mode: "primary" | "subagent" | "all"
  hidden: boolean
}

function normalizeMode(value: unknown): AgentInfo["mode"] {
  return value === "primary" || value === "subagent" || value === "all" ? value : "all"
}

function unwrap(result: unknown): RawAgent[] {
  if (Array.isArray(result)) return result as RawAgent[]
  if (result && typeof result === "object" && Array.isArray((result as { data?: unknown }).data)) {
    return (result as { data: RawAgent[] }).data
  }
  return []
}

/**
 * Enumerate every agent name opencode knows about (built-in + custom, including
 * hidden system agents) via `client.app.agents()` (`GET /agent`).
 *
 * This is the correct enumeration source (research #11 §3): the `config` hook's
 * `cfg.agent` does NOT contain built-ins, so this must be called from a context
 * where the server is up (e.g. the switch flow / TUI in #18) and the result
 * passed to `applyProfile` via `options.agents`. Never throws — returns `[]` on
 * any failure.
 */
export async function enumerateAgentNames(client: AgentListerClient): Promise<string[]> {
  try {
    const agents = unwrap(await client.app.agents())
    return agents
      .map((agent) => agent.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
  } catch {
    return []
  }
}

/**
 * Like `enumerateAgentNames`, but also returns each agent's `mode` and `hidden`
 * flag so the wizard can pick sensible default tiers (see `defaultAssignment`).
 * Never throws — returns `[]` on any failure.
 */
export async function enumerateAgents(client: AgentListerClient): Promise<AgentInfo[]> {
  try {
    const agents = unwrap(await client.app.agents())
    return agents
      .filter((agent): agent is RawAgent & { name: string } =>
        typeof agent.name === "string" && agent.name.length > 0,
      )
      .map((agent) => ({
        name: agent.name,
        mode: normalizeMode(agent.mode),
        hidden: agent.hidden === true,
      }))
  } catch {
    return []
  }
}
