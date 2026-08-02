import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { writeProfiles } from "../src/config.js"
import type { ProfilesFile } from "../src/schema.js"
import { switchProfile, type DisposableClient } from "../src/switch.js"

const repo = resolve(import.meta.dir, "..")
const opencode = Bun.which("opencode")

interface AgentResponse {
  name: string
  model?: { providerID: string; modelID: string }
}

async function reservePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("reserved") })
  const port = server.port
  await server.stop(true)
  return port
}

async function waitFor<T>(probe: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (accept(value)) return value
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }

  throw new Error(`timed out waiting for opencode${lastError ? `: ${(lastError as Error).message}` : ""}`)
}

test("switches the shipped server plugin live without restarting opencode", async () => {
  expect(opencode, "opencode must be installed to run bun run test:smoke").not.toBeNull()

  const sandbox = mkdtempSync(join(tmpdir(), "profile-switcher-smoke-"))
  const configHome = join(sandbox, "config")
  const configDir = join(configHome, "opencode")
  const projectDir = join(sandbox, "project")
  const profilesPath = join(configDir, "profiles.json")
  mkdirSync(configDir, { recursive: true })
  mkdirSync(projectDir, { recursive: true })

  writeFileSync(
    join(configDir, "opencode.json"),
    `${JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      model: "seed/should-be-overridden",
      plugin: [resolve(repo, "dist/server.js")],
    })}\n`,
  )

  const profiles: ProfilesFile = {
    assignment: { build: "heavy", plan: "heavy", explore: "rest" },
    exclusions: [],
    profiles: {
      alpha: {
        heavy: { model: "alpha-provider/alpha-heavy" },
        rest: { model: "alpha-provider/alpha-rest" },
      },
      beta: {
        heavy: { model: "beta-provider/beta-heavy" },
        rest: { model: "beta-provider/beta-rest" },
      },
    },
    active: "alpha",
  }
  writeProfiles(profiles, profilesPath)

  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: join(sandbox, "data"),
    XDG_STATE_HOME: join(sandbox, "state"),
    XDG_CACHE_HOME: join(sandbox, "cache"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  }
  delete env.OPENCODE_CONFIG_DIR
  delete env.ORCA_OPENCODE_CONFIG_DIR

  const serverProcess = Bun.spawn(
    [opencode!, "serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs"],
    { cwd: projectDir, env, stdout: "pipe", stderr: "pipe" },
  )
  const stdout = new Response(serverProcess.stdout).text()
  const stderr = new Response(serverProcess.stderr).text()

  const getJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, init)
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
    return response.json() as Promise<T>
  }

  let failure: unknown
  try {
    const initialConfig = await waitFor(
      () => getJson<{ model?: string; small_model?: string }>("/config"),
      (config) => config.model === "alpha-provider/alpha-heavy",
    )
    expect(initialConfig.small_model).toBe("alpha-provider/alpha-rest")

    const initialAgents = await getJson<AgentResponse[]>("/agent")
    expect(initialAgents.find((agent) => agent.name === "build")?.model).toEqual({
      providerID: "alpha-provider",
      modelID: "alpha-heavy",
    })
    expect(initialAgents.find((agent) => agent.name === "explore")?.model).toEqual({
      providerID: "alpha-provider",
      modelID: "alpha-rest",
    })

    const session = await getJson<{ id: string }>("/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "live-switch-smoke" }),
    })
    const pid = serverProcess.pid
    const client: DisposableClient = {
      instance: {
        async dispose() {
          await getJson("/instance/dispose", { method: "POST" })
        },
      },
    }

    const switched = await switchProfile("beta", client, { path: profilesPath })
    expect(switched).toEqual({ ok: true, active: "beta", disposed: true })

    const activeConfig = await waitFor(
      () => getJson<{ model?: string; small_model?: string }>("/config"),
      (config) => config.model === "beta-provider/beta-heavy",
    )
    expect(activeConfig.small_model).toBe("beta-provider/beta-rest")

    const activeAgents = await getJson<AgentResponse[]>("/agent")
    expect(activeAgents.find((agent) => agent.name === "build")?.model).toEqual({
      providerID: "beta-provider",
      modelID: "beta-heavy",
    })
    expect(activeAgents.find((agent) => agent.name === "explore")?.model).toEqual({
      providerID: "beta-provider",
      modelID: "beta-rest",
    })

    const sessions = await getJson<Array<{ id: string }>>("/session")
    expect(sessions.some((item) => item.id === session.id)).toBe(true)
    expect(serverProcess.pid).toBe(pid)
    expect(serverProcess.exitCode).toBeNull()
  } catch (error) {
    failure = error
  } finally {
    serverProcess.kill("SIGTERM")
    await serverProcess.exited
    const logs = `${await stdout}\n${await stderr}`.trim()
    rmSync(sandbox, { recursive: true, force: true })
    if (failure) {
      throw new Error(`${(failure as Error).stack ?? failure}\n\nopencode output:\n${logs}`)
    }
  }
}, 30_000)
