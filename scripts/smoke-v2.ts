// Opt-in integration harness. No imports from the developer's OpenCode install.
import { strict as assert } from "node:assert"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const version = "2.0.29"
const repo = resolve(import.meta.dir, "..")
const sandbox = mkdtempSync(join(tmpdir(), "profile-switcher-v2-"))
const config = join(sandbox, "config", "opencode")
const project = join(sandbox, "project")
const install = join(sandbox, "install")
const password = crypto.randomUUID()
// Explicit environment is equivalent to env -i. Never inherit OPENCODE_*,
// provider keys, HOME, XDG paths, or the user's background service address.
const env: Record<string, string> = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: join(sandbox, "home"),
  XDG_CONFIG_HOME: join(sandbox, "config"),
  XDG_DATA_HOME: join(sandbox, "data"),
  XDG_STATE_HOME: join(sandbox, "state"),
  XDG_CACHE_HOME: join(sandbox, "cache"),
  OPENCODE_SERVER_PASSWORD: password,
  TERM: "xterm-256color",
}
for (const path of [...Object.values(env).filter((p) => p.startsWith(sandbox)), config, project, install]) mkdirSync(path, { recursive: true })
let server: ReturnType<typeof Bun.spawn> | undefined
let output = ""
const children = new Set<ReturnType<typeof Bun.spawn>>()
async function terminate(child: ReturnType<typeof Bun.spawn>) {
  if (child.exitCode === null) child.kill("SIGTERM")
  await Promise.race([child.exited, Bun.sleep(3000)])
  if (child.exitCode === null) child.kill("SIGKILL")
  await child.exited
  children.delete(child)
}
async function cleanup() {
  await Promise.all([...children].map(terminate))
  rmSync(sandbox, { recursive: true, force: true })
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(code)) })
}
const results: Record<string, unknown> = { version }
const json = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const record = (name: string, value: unknown = "PASS") => { results[name] = value; console.log(`${name}: ${JSON.stringify(value)}`) }
async function eventually<T>(probe: () => Promise<T>, accept: (value: T) => boolean, timeout = 30_000): Promise<T> {
  const until = Date.now() + timeout
  let last: unknown
  while (Date.now() < until) {
    try { const value = await probe(); last = value; if (accept(value)) return value } catch (error) { last = error }
    await Bun.sleep(100)
  }
  throw new Error(`Timed out: ${JSON.stringify(last)}`)
}
async function stop() {
  if (!server) return
  await terminate(server)
  server = undefined
}
try {
  // Only missing network is a skip. Install, boot and assertion failures fail.
  try {
    const response = await fetch(`https://registry.npmjs.org/@opencode%2fcli/${version}`, { signal: AbortSignal.timeout(15_000) })
    assert.equal(response.status, 200, `registry returned ${response.status}`)
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error
    console.log(`SKIP smoke v2: npm registry is unreachable (${error})`)
    results.skipped = "npm registry unreachable"
    process.exitCode = 0
    // finally still owns sandbox cleanup.
    throw { offline: true }
  }
  json(join(install, "package.json"), { private: true, type: "module", trustedDependencies: ["@opencode/cli"], dependencies: { "@opencode/cli": version, "@opencode/client": version, "@opencode/plugin": version, zod: "4.1.8" } })
  const installed = Bun.spawn([process.execPath, "install", "--cwd", install], { env, stdout: "pipe", stderr: "pipe" })
  children.add(installed)
  const installLogs = Promise.all([new Response(installed.stdout).text(), new Response(installed.stderr).text()])
  const installTimeout = setTimeout(() => installed.kill("SIGKILL"), 120_000)
  try { assert.equal(await installed.exited, 0, (await installLogs).join("\n")) }
  finally { clearTimeout(installTimeout); children.delete(installed) }
  const plugin = join(install, "node_modules", "opencode-profile-switcher-v2")
  mkdirSync(plugin, { recursive: true })
  cpSync(join(repo, "packages/v2/dist"), join(plugin, "dist"), { recursive: true })
  cpSync(join(repo, "packages/v2/package.json"), join(plugin, "package.json"))
  const binary = join(install, "node_modules/.bin/opencode")
  const checked = Bun.spawnSync([binary, "--version"], { env })
  assert.equal(checked.stdout.toString().trim(), `opencode v${version}`)
  console.log(`Sandbox: ${sandbox}`)
  console.log(`Pinned binary: ${binary}`)
  const { OpenCode } = await import(join(install, "node_modules/@opencode/client/dist/promise/index.js"))
  const { ProfileSwitcherRpc } = await import(join(plugin, "dist/rpc.js"))
  const alpha = { heavy: { model: "opencode/big-pickle", variant: "high" }, rest: { model: "opencode/nemotron-3.5-lightning-free" }, placements: { build: "heavy", plan: "heavy", explore: "rest", loose: "heavy", pinnedglobal: "heavy", pinneddefault: "rest", pinnedrepo: "heavy", pinnedmd: "heavy", phantom: "heavy" }, specifics: {} }
  const beta = { heavy: { model: "opencode/space-bunny-free" }, rest: { model: "opencode/big-pickle" }, placements: { ...alpha.placements, build: "excluded" }, specifics: {} }
  const profilesPath = join(config, "profiles.json")
  json(profilesPath, { profiles: { alpha, beta }, active: "alpha", effective: {} })
  json(join(config, "opencode.jsonc"), { plugins: ["*", join(plugin, "dist")], model: "opencode/nemotron-3.5-lightning-free", agents: { pinneddefault: { model: "opencode/nemotron-3.5-lightning-free#default" }, pinnedglobal: { model: "opencode/space-bunny-free#high", prompt: "Global fixed agent" } } })
  mkdirSync(join(project, ".opencode"), { recursive: true })
  json(join(project, "opencode.jsonc"), { agents: { pinnedrepo: { model: "opencode/big-pickle#default", prompt: "Repo fixed agent" } } })
  mkdirSync(join(config, "agents"), { recursive: true })
  writeFileSync(join(config, "agents/pinnedmd.md"), "---\nmodel: opencode/space-bunny-free#max\n---\nPinned markdown agent.\n")
  writeFileSync(join(config, "agents/loose.md"), "---\ndescription: Unpinned markdown agent\n---\nBe concise.\n")
  const reserved = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = reserved.port!
  await reserved.stop(true)
  const baseUrl = `http://127.0.0.1:${port}`
  const start = () => {
    server = Bun.spawn([binary, "serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs"], { cwd: project, env, stdout: "pipe", stderr: "pipe" })
    children.add(server)
    for (const stream of [server.stdout, server.stderr]) void (async () => { for await (const chunk of stream as ReadableStream<Uint8Array>) output += new TextDecoder().decode(chunk) })()
  }
  start()
  const client = OpenCode.make({ baseUrl, fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
    ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  }), headers: { Authorization: `Basic ${btoa(`opencode:${password}`)}` } })
  const location = { directory: project }
  const rpc = client.rpc(ProfileSwitcherRpc)
  const status = () => rpc.status({}, { location })
  const agents = async () => (await client.agent.list({ location })).data
  await eventually(async () => (await fetch(`${baseUrl}/api/server`, { signal: AbortSignal.timeout(1000) })).status, code => code === 401)
  record("authenticated-private-server")
  let boot = await eventually(status, (s: any) => s.phase === "ready")
  record("boot-status", boot)
  const list = await agents()
  const find = (id: string) => list.find((a: any) => a.id === id)
  assert.deepEqual(find("build").model, { providerID: "opencode", id: "big-pickle", variant: "high" })
  for (const id of ["title", "summary", "compaction"]) { assert.equal(find(id).model.id, "nemotron-3.5-lightning-free"); assert.equal(find(id).hidden, true) }
  assert.equal(find("loose").model.id, "big-pickle")
  assert.equal(find("phantom"), undefined)
  assert.equal(boot.partial, true)
  assert.deepEqual([...boot.fixedByConfig].sort(), ["pinnedglobal", "pinnedmd", "pinnedrepo"])
  record("boot-agents", list.map((agent: any) => ({ id: agent.id, model: agent.model, hidden: agent.hidden })))
  const configuredDefault = await client.model.default({ location })
  assert.equal(configuredDefault.data.id, "nemotron-3.5-lightning-free")
  record("config-model-beats-catalog-transform", configuredDefault)
  assert.equal(find("pinnedrepo").model.variant, "default")
  assert.equal(find("pinnedmd").model.variant, "max")
  assert.equal(find("title").model.variant, undefined)
  assert.equal(boot.agents.find((a: any) => a.id === "pinneddefault").fixedByConfig, false)
  record("variant-default-effective-equivalence", boot.agents.find((a: any) => a.id === "pinneddefault"))
  record("variant-on-disk", { repo: find("pinnedrepo").model, markdown: find("pinnedmd").model, omitted: find("title").model })
  const abort = new AbortController()
  const events: unknown[] = []
  const unsubscribe = rpc.events.on("switched", (event: unknown) => events.push(event), { signal: abort.signal })
  try {
    await Bun.sleep(500)
    const pid = server!.pid
    const switched = await rpc.switch({ profile: "beta" }, { location })
    assert.equal(switched.active, "beta")
    await eventually(async () => events, (e) => e.length > 0)
    assert.equal(server!.pid, pid)
    assert.equal(server!.exitCode, null)
    assert.equal((await agents()).find((a: any) => a.id === "plan").model.id, "space-bunny-free")
    assert.equal(switched.agents.find((a: any) => a.id === "build").model.id, "big-pickle")
    record("live-switch-event", events)
  } finally { abort.abort(); unsubscribe?.() }
  rmSync(join(config, "agents/loose.md"))
  // The host debounces filesystem configuration updates.
  await Bun.sleep(1000)
  await rpc.switch({ profile: "alpha" }, { location })
  assert.equal((await agents()).some((a: any) => a.id === "loose"), false)
  await rpc.switch({ profile: "beta" }, { location })
  record("markdown-deletion-no-ghost")
  assert.deepEqual(read(profilesPath).effective.build, { model: "opencode/big-pickle", variant: "high" })
  const globalConfig = read(join(config, "opencode.jsonc"))
  delete globalConfig.model
  json(join(config, "opencode.jsonc"), globalConfig)
  await stop()
  start()
  boot = await eventually(status, (s: any) => s.phase === "ready")
  assert.equal(boot.active, "beta")
  assert.deepEqual(boot.agents.find((a: any) => a.id === "build").model, { providerID: "opencode", id: "big-pickle", variant: "high" })
  record("excluded-after-restart")
  const heavyDefault = await client.model.default({ location })
  assert.equal(heavyDefault.data.id, "space-bunny-free")
  record("catalog-heavy-without-config-model", heavyDefault)
  // The wrapper observes the shipped TUI setup and actual keymap registration.
  // It does not replace the plugin with a fake registration.
  const tuiEntry = join(plugin, "dist/tui.js")
  cpSync(tuiEntry, join(plugin, "dist/tui-original.js"))
  const trace = join(sandbox, "tui-trace.jsonl")
  writeFileSync(tuiEntry, `import original from "./tui-original.js";
import { appendFileSync } from "node:fs";
const trace = ${JSON.stringify(trace)};
export default { ...original, setup(ctx) {
  appendFileSync(trace, JSON.stringify({ event: "setup", id: original.id }) + "\\n");
  const keymap = new Proxy(ctx.keymap, { get(target, key) {
    if (key === "layer") return factory => target.layer(() => {
      const layer = factory();
      appendFileSync(trace, JSON.stringify({ event: "commands", commands: layer.commands.map(c => ({ id: c.id, slash: c.slash })) }) + "\\n");
      return layer;
    });
    return Reflect.get(target, key);
  } });
  return original.setup(new Proxy(ctx, { get(target, key) { return key === "keymap" ? keymap : Reflect.get(target, key); } }));
} };`)
  const tuiProbe = async (name: string, explicit: boolean) => {
    rmSync(trace, { force: true })
    if (explicit) json(join(config, "cli.json"), { plugins: [join(plugin, "dist")] })
    else rmSync(join(config, "cli.json"), { force: true })
    let terminalOutput = ""
    const terminal = new Bun.Terminal({ cols: 100, rows: 30, data(_terminal, data) { terminalOutput += new TextDecoder().decode(data) } })
    const tui = Bun.spawn([binary, "--server", baseUrl, "--print-logs"], { cwd: project, env, terminal })
    children.add(tui)
    try {
      const entries = await eventually(async () => {
        try { return readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) } catch { return [] }
      }, entries => entries.some(e => e.event === "commands"), 20_000)
      assert.equal(entries.filter(e => e.event === "setup").length, 1, JSON.stringify(entries))
      const commands = entries.filter(e => e.event === "commands").flatMap(e => e.commands)
      // A reactive layer may evaluate more than once; the stable command id
      // and one setup distinguish reevaluation from duplicate registration.
      assert(commands.some(c => c.slash?.name === "profile"))
      record(name, entries)
    } catch (error) { throw new Error(`${error}\nTUI output: ${terminalOutput.slice(-8000)}`) }
    finally {
      await terminate(tui)
      terminal.close()
    }
  }
  await tuiProbe("tui-automatic", false)
  await tuiProbe("tui-both-sources-deduplicated", true)
  // Session metadata proves the next turn's selected model without asserting
  // nondeterministic response text. These models need no user credentials.
  await rpc.switch({ profile: "alpha" }, { location })
  const session = await client.session.create({ agent: "plan", model: { providerID: "opencode", id: "big-pickle" }, location })
  const turn = async (text: string) => {
    await client.session.prompt({ sessionID: session.id, text, location })
    await client.session.wait({ sessionID: session.id, location })
    return (await client.message.list({ sessionID: session.id, location })).data.filter((m: any) => m.type === "assistant")
  }
  const first = await turn("Reply with exactly ONE. Do not use tools.")
  assert(first.some((m: any) => m.model.id === "big-pickle" && !m.error), JSON.stringify(first))
  await rpc.switch({ profile: "beta" }, { location })
  await client.session.switchModel({ sessionID: session.id, model: { providerID: "opencode", id: "space-bunny-free" }, location })
  const second = await turn("Reply with exactly TWO. Do not use tools.")
  assert(second.some((m: any) => m.model.id === "space-bunny-free" && !m.error), JSON.stringify(second))
  record("session-switchModel", second.map((message: any) => ({ id: message.id, model: message.model, finish: message.finish, error: message.error })))
  await stop()
  globalConfig.model = "opencode/nemotron-3.5-lightning-free"
  json(join(config, "opencode.jsonc"), globalConfig)
  const projectConfig = read(join(project, "opencode.jsonc"))
  projectConfig.model = "opencode/big-pickle"
  json(join(project, "opencode.jsonc"), projectConfig)
  start()
  await eventually(status, (s: any) => s.phase === "ready")
  const repoDefault = await client.model.default({ location })
  assert.equal(repoDefault.data.id, "big-pickle")
  record("repo-config-model-beats-global-and-profile", repoDefault.data.id)
  await stop()
  const override = join(sandbox, "override")
  mkdirSync(override)
  cpSync(profilesPath, join(override, "profiles.json"))
  cpSync(join(config, "opencode.jsonc"), join(override, "opencode.jsonc"))
  env.OPENCODE_CONFIG_DIR = override
  start()
  const overridden = await eventually(status, (s: any) => s.phase === "ready")
  assert.equal(overridden.path, join(override, "profiles.json"))
  record("explicit-config-dir", overridden.path)
} catch (error) {
  if (!(error && typeof error === "object" && "offline" in error)) { console.error(error); console.error(output); process.exitCode = 1 }
} finally {
  await stop()
  try {
    if (process.env.SMOKE_V2_EVIDENCE) json(resolve(process.env.SMOKE_V2_EVIDENCE), results)
  } finally {
    await cleanup()
  }
}
