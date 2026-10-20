// The contract between the server half (registers the handlers) and the TUI
// half (calls them through `ctx.client.rpc(ProfileSwitcherRpc)`). Published as
// `opencode-profile-switcher-v2/rpc`. Self-contained on purpose: it imports
// nothing from the core, so its declarations ship as they are.
import { Rpc } from "@opencode/plugin/rpc"

/** Server plugin id. Fixed: the host keys the plugin's storage by it. */
export const PLUGIN_ID = "opencode-profile-switcher-v2"

/**
 * RPC id. Fixed: clients see the event as `rpc.opencode-profile-switcher.switched`.
 * Host-neutral on purpose, so a later TUI plugin with its own id can share it.
 */
export const RPC_ID = "opencode-profile-switcher"

/** A model as opencode 2.0 addresses it. `variant` is `null` when unset. */
export interface ModelJson {
  providerID: string
  id: string
  variant: string | null
}

export type PlacementName = "heavy" | "rest" | "specific" | "excluded"

/** One agent of the location as the profile left it (after the last reload). */
export interface AgentStatus {
  /** The agent id, which is also its key in `profiles.json` placements. */
  id: string
  /** The agent's placement in the active profile; `null` when it has none. */
  placement: PlacementName | null
  /** The model the profile asked for; `null` when it leaves the agent alone. */
  planned: ModelJson | null
  /**
   * The model the agent ended up with — what a session on this agent should
   * switch to. Differs from `planned` when the agent is fixed by config.
   */
  model: ModelJson | null
  /**
   * The user's config defines this agent's model, so the profile lost
   * ("agente fijado por config", ADR-0003).
   */
  fixedByConfig: boolean
}

/**
 * A slot of the active profile whose model is not `provider/model` (e.g.
 * `"zai/glm-5#max"`: the variant goes in its own field). Nothing is applied
 * from it. `agent` is `null` for a tier slot.
 */
export interface InvalidSlot {
  placement: PlacementName
  agent: string | null
  model: string
}

/**
 * An agent that took a profile model whose variant the model does not offer
 * according to opencode's model catalog (`ModelInfo.variants`). The host accepts
 * it on the agent but fails on the next prompt (`VariantUnavailableError`). A
 * warning only: the model is applied as the profile says. Never reported for an
 * omitted or `default` variant, nor for a model the catalog does not list.
 */
export interface UnavailableVariant {
  agent: string
  placement: PlacementName | null
  /** `provider/model`. */
  model: string
  variant: string
  /** The variants the catalog offers for `model`; empty when it offers none. */
  offered: string[]
}

/**
 * Where the server is with the location's agents:
 * - `pending` — learning the agent ids and applying the profile (boot or switch).
 * - `ready`   — applied; `agents`, `fixedByConfig` and `partial` describe it.
 * - `failed`  — the last pass could not finish (`error` says why). Models may
 *               be half applied; the next `switch` runs a full pass again.
 */
export type Phase = "pending" | "ready" | "failed"

export interface StatusOutput {
  /** `phase === "ready"`. */
  ready: boolean
  phase: Phase
  /** Where `profiles.json` lives for this server. */
  path: string
  /** Names of every profile defined in `profiles.json`, read on each call. */
  profiles: string[]
  /**
   * The profile the server applies, or `null` when none is set. An `active`
   * edited into the file by hand takes effect on the next switch or restart.
   */
  active: string | null
  /** Whether the active profile is being applied. */
  applied: boolean
  /** Why nothing is applied, when `applied` is false. */
  reason: "no-active" | "unknown-active" | "invalid-file" | null
  /** A corrupt `profiles.json`, or why the last pass failed. */
  error: string | null
  /** Some agents of the active profile are fixed by config. */
  partial: boolean
  /** Ids of the agents fixed by config. */
  fixedByConfig: string[]
  /**
   * Agents the profile wrote that list no model after the reload — not a
   * config override, just a model that did not land.
   */
  unapplied: string[]
  /** Agents with no placement in the active profile, applied as `rest`. */
  unassigned: string[]
  /** Slots of the active profile that cannot be applied. */
  invalidSlots: InvalidSlot[]
  /**
   * Agents applied with a variant their model does not offer. Empty unless
   * `ready`, and empty when the catalog could not be read.
   */
  unavailableVariants: UnavailableVariant[]
  /** Empty unless `ready`. */
  agents: AgentStatus[]
}

export interface SwitchInput {
  profile: string
}

/** Host-neutral profiles document used by the TUI wizard. */
export interface ProfileJson {
  heavy: { model: string; variant?: string }
  rest: { model: string }
  placements: Record<string, PlacementName>
  specifics: Record<string, { model: string; variant?: string }>
}

export interface ProfilesFileJson {
  profiles: Record<string, ProfileJson>
  active: string
  effective: Record<string, { model: string; variant?: string }>
}

/** A saved document, with confirmation that its applied snapshot was retargeted. */
export interface SaveProfilesOutput extends ProfilesFileJson {
  renamed: boolean
}

export interface SaveProfilesInput {
  profiles: Record<string, ProfileJson>
  active: string
  /** Snapshot the wizard opened; prevents overwriting a concurrent edit or switch. */
  expected?: { profiles: Record<string, ProfileJson>; active: string }
}

export interface SwitchedEvent {
  profile: string
  partial: boolean
  fixedByConfig: string[]
}

const strings = { type: "array", items: { type: "string" } } as const

// Nullable fields carry no `type`: the host validates outputs against these
// schemas, and plain keywords are what every JSON Schema validator agrees on.
const status = {
  type: "object",
  properties: {
    ready: { type: "boolean" },
    phase: { type: "string", enum: ["pending", "ready", "failed"] },
    path: { type: "string" },
    profiles: strings,
    active: {},
    applied: { type: "boolean" },
    reason: {},
    error: {},
    partial: { type: "boolean" },
    fixedByConfig: strings,
    unapplied: strings,
    unassigned: strings,
    invalidSlots: {
      type: "array",
      items: {
        type: "object",
        properties: { placement: { type: "string" }, agent: {}, model: { type: "string" } },
        required: ["placement", "agent", "model"],
      },
    },
    unavailableVariants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agent: { type: "string" },
          placement: {},
          model: { type: "string" },
          variant: { type: "string" },
          offered: strings,
        },
        required: ["agent", "placement", "model", "variant", "offered"],
      },
    },
    agents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          placement: {},
          planned: {},
          model: {},
          fixedByConfig: { type: "boolean" },
        },
        required: ["id", "placement", "planned", "model", "fixedByConfig"],
      },
    },
  },
  required: [
    "ready",
    "phase",
    "path",
    "profiles",
    "active",
    "applied",
    "reason",
    "error",
    "partial",
    "fixedByConfig",
    "unapplied",
    "unassigned",
    "invalidSlots",
    "unavailableVariants",
    "agents",
  ],
} as const

const failure = { type: "null" } as const

const profilesDocument = {
  type: "object",
  properties: { profiles: { type: "object" }, active: { type: "string" }, effective: { type: "object" } },
  required: ["profiles", "active", "effective"],
} as const

export const ProfileSwitcherRpc = Rpc.define({
  id: RPC_ID,
  methods: {
    /** Read the document on the server; a remote TUI has no filesystem access. */
    readProfiles: {
      input: { type: "object" },
      output: profilesDocument,
      errors: { invalid_profiles: failure },
    },
    /**
     * Save a wizard draft; `effective` stays server-owned. Applying a nonempty
     * active profile still needs `switch`; clearing it reloads the empty state.
     */
    saveProfiles: {
      input: {
        type: "object",
        properties: {
          profiles: { type: "object" },
          active: { type: "string" },
          expected: {
            type: "object",
            properties: { profiles: { type: "object" }, active: { type: "string" } },
            required: ["profiles", "active"],
          },
        },
        required: ["profiles", "active"],
      },
      output: {
        ...profilesDocument,
        properties: { ...profilesDocument.properties, renamed: { type: "boolean" } },
        required: [...profilesDocument.required, "renamed"],
      },
      errors: { invalid_profiles: failure, invalid_profile: failure, conflict: failure, reload_failed: failure },
    },
    /** The active profile and how it landed on the location's agents. */
    status: {
      input: { type: "object" },
      output: status,
    },
    /**
     * Persist `profile` as active, reload the agents (and the default model)
     * and emit `switched`. Returns the status after the switch.
     */
    switch: {
      input: {
        type: "object",
        properties: { profile: { type: "string", minLength: 1 } },
        required: ["profile"],
      },
      output: status,
      errors: {
        /** No profile by that name in `profiles.json`. */
        unknown_profile: failure,
        /** `profiles.json` is corrupt; it is never overwritten. */
        invalid_profiles: failure,
        /** The profile was persisted but the host failed to reload. */
        reload_failed: failure,
      },
    },
  },
  events: {
    switched: {
      schema: {
        type: "object",
        properties: {
          profile: { type: "string" },
          partial: { type: "boolean" },
          fixedByConfig: strings,
        },
        required: ["profile", "partial", "fixedByConfig"],
      },
    },
  },
})
