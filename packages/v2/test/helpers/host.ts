import type { HostModel } from "../../src/apply.js"
import type { HostContext } from "../../src/plugin.js"

interface FakeAgent {
  id: string
  name: string
  mode: "primary" | "subagent" | "all"
  hidden: boolean
  model?: HostModel
}

export interface ConfigAgent {
  /** A config-defined model; when set it overrides the plugin (ADR-0003). */
  model?: HostModel
}

export interface FakeHostOptions {
  /** Built-in agents: the ones the transform's editor sees. */
  builtins?: Record<string, HostModel | undefined>
  /**
   * Agents from the user's config/markdown, applied after user plugins like
   * opencode's `opencode.config.agent`: created when missing, `model`
   * overwritten only when the config defines one.
   */
  config?: Record<string, ConfigAgent>
  /** `agent.list()` rejects this many times before answering. */
  listFailures?: number
}

type AgentCallback = (editor: unknown) => void
type ModelCallback = (editor: unknown) => void

export interface RpcCall {
  handlers: Record<string, (input: unknown, context: unknown) => Promise<unknown>>
  emitted: { name: string; data: unknown }[]
  disposed: boolean
}

/**
 * A fake of the 2.0 plugin context covering what the switcher drives: the
 * agent pipeline (built-ins → user transforms → config pass), `agent.list`,
 * the model default and RPC registration.
 */
export class FakeHost {
  builtins: Record<string, HostModel | undefined>
  config: Record<string, ConfigAgent>
  listFailures: number
  agents: FakeAgent[] = []
  defaultModel: { providerID: string; modelID: string } | undefined
  agentReloads = 0
  listCalls = 0
  modelReloads = 0
  failReload = false
  /** Agents the host leaves without a model after every pass, whatever wrote one. */
  dropModel = new Set<string>()
  rpc: RpcCall | undefined
  transformsDisposed = 0

  private agentCallbacks: AgentCallback[] = []
  private modelCallbacks: ModelCallback[] = []
  private loaded = false
  private onLoaded: (() => void)[] = []

  constructor(options: FakeHostOptions = {}) {
    this.builtins = options.builtins ?? {
      build: undefined,
      plan: undefined,
      explore: undefined,
      title: undefined,
      summary: undefined,
      compaction: undefined,
    }
    this.config = options.config ?? {}
    this.listFailures = options.listFailures ?? 0
  }

  /** Recompute the agent list: built-ins, then user transforms, then config. */
  private run(): void {
    const agents = new Map<string, FakeAgent>()
    for (const [id, model] of Object.entries(this.builtins)) {
      agents.set(id, { id, name: id, mode: "primary", hidden: false, ...(model ? { model } : {}) })
    }
    const editor = {
      list: () => [...agents.values()],
      get: (id: string) => agents.get(id),
      update: (id: string, update: (agent: FakeAgent) => void) => {
        let agent = agents.get(id)
        if (!agent) {
          agent = { id, name: id, mode: "primary", hidden: false }
          agents.set(id, agent)
        }
        update(agent)
      },
      remove: (id: string) => agents.delete(id),
      default: () => {},
    }
    for (const callback of this.agentCallbacks) callback(editor)
    for (const [id, entry] of Object.entries(this.config)) {
      const agent = agents.get(id) ?? { id, name: id, mode: "subagent" as const, hidden: false }
      if (entry.model) agent.model = { ...entry.model }
      agents.set(id, agent)
    }
    for (const id of this.dropModel) delete agents.get(id)?.model
    this.agents = [...agents.values()].map((agent) => ({ ...agent }))

    const modelEditor = {
      default: {
        get: () => this.defaultModel,
        set: (providerID: string, modelID: string) => {
          this.defaultModel = { providerID, modelID }
        },
      },
    }
    for (const callback of this.modelCallbacks) callback(modelEditor)
  }

  /** The location's initial load, which the host runs after every setup. */
  load(): void {
    this.run()
    this.loaded = true
    for (const done of this.onLoaded.splice(0)) done()
  }

  agent(id: string): FakeAgent | undefined {
    return this.agents.find((agent) => agent.id === id)
  }

  context(): HostContext {
    const ctx = {
      agent: {
        transform: async (callback: AgentCallback) => {
          this.agentCallbacks.push(callback)
          return {
            dispose: async () => {
              this.agentCallbacks = this.agentCallbacks.filter((entry) => entry !== callback)
              this.transformsDisposed++
            },
          }
        },
        reload: async () => {
          if (this.failReload) throw new Error("reload exploded")
          this.agentReloads++
          this.run()
        },
        list: async () => {
          this.listCalls++
          if (this.listFailures > 0) {
            this.listFailures--
            throw new Error("location not ready")
          }
          // Like the host: a list during the initial load waits for it.
          if (!this.loaded) await new Promise<void>((done) => this.onLoaded.push(done))
          return { location: { directory: "/repo" }, data: this.agents.map((agent) => ({ ...agent })) }
        },
      },
      model: {
        transform: async (callback: ModelCallback) => {
          this.modelCallbacks.push(callback)
          return {
            dispose: async () => {
              this.modelCallbacks = this.modelCallbacks.filter((entry) => entry !== callback)
              this.transformsDisposed++
            },
          }
        },
        reload: async () => {
          this.modelReloads++
          this.run()
        },
      },
      rpc: {
        register: async (_definition: unknown, handlers: RpcCall["handlers"]) => {
          const call: RpcCall = { handlers, emitted: [], disposed: false }
          this.rpc = call
          return {
            events: {
              emit: async (name: string, data: unknown) => {
                call.emitted.push({ name, data })
              },
            },
            dispose: async () => {
              call.disposed = true
            },
          }
        },
      },
    }
    return ctx as unknown as HostContext
  }

  /** Call an RPC method the way the host would, with an error factory. */
  async call(method: string, input: unknown = {}): Promise<unknown> {
    if (!this.rpc) throw new Error("rpc not registered")
    const handler = this.rpc.handlers[method]
    if (!handler) throw new Error(`no handler ${method}`)
    const context = {
      signal: new AbortController().signal,
      error: (type: string, message: string, data: unknown) => ({ rpcError: true, type, message, data }),
    }
    return handler(input, context)
  }
}
