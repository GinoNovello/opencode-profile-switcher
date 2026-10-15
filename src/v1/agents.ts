import type { AgentInfo } from "../core/agent.js"

export type { AgentInfo } from "../core/agent.js"

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

/**
 * A client that can both list agents and re-bootstrap the instance they were
 * enumerated from. The real opencode SDK client satisfies this.
 */
export interface AgentRefreshClient extends AgentListerClient {
  instance: {
    dispose: (options?: unknown) => Promise<unknown>
  }
}

/**
 * Like `enumerateAgents`, but first invalidates opencode's agent list.
 *
 * opencode builds the `GET /agent` list once per instance, at bootstrap. An
 * agent markdown file created while opencode is running never invalidates it,
 * so a plain `enumerateAgents` keeps returning the pre-existing set and the
 * wizard silently omits the agent the user just created. Waiting does not help;
 * `instance.dispose()` is the only invalidation opencode exposes (it is the
 * same re-bootstrap the live switch relies on — see `switchProfile`).
 *
 * Any wizard flow that shows the user a list of agents must use this, not
 * `enumerateAgents`. Never throws: a failed dispose falls through to the
 * possibly-stale list, which still beats showing nothing.
 */
export async function refreshAgents(client: AgentRefreshClient): Promise<AgentInfo[]> {
  try {
    await client.instance.dispose()
  } catch {
    // A stale agent list is a better outcome than an empty one.
  }
  return enumerateAgents(client)
}
