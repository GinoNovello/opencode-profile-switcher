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
  native?: unknown
  hidden?: unknown
  /** Legacy field name in the v1 SDK types; wire format uses `native`. */
  builtIn?: unknown
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
