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
