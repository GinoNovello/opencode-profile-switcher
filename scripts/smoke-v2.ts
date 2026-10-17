// Opt-in integration harness. No imports from the developer's OpenCode install.
import { strict as assert } from "node:assert"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const version = "2.0.29"
const repo = resolve(import.meta.dir, "..")
let sandbox: string | undefined
let server: ReturnType<typeof Bun.spawn> | undefined
let output = ""
const children = new Set<ReturnType<typeof Bun.spawn>>()
function signalGroup(child: ReturnType<typeof Bun.spawn>, signal: NodeJS.Signals | 0) {
  try { process.kill(-child.pid, signal); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error }
}
async function terminate(child: ReturnType<typeof Bun.spawn>) {
  // The leader may already have exited while postinstall descendants survive.
  if (signalGroup(child, 0)) {
    signalGroup(child, "SIGTERM")
    const until = Date.now() + 3000
    while (signalGroup(child, 0) && Date.now() < until) await Bun.sleep(50)
    if (signalGroup(child, 0)) signalGroup(child, "SIGKILL")
  }
  await child.exited
  children.delete(child)
}
let cleaning: Promise<void> | undefined
function cleanup() {
  return cleaning ??= (async () => {
    try {
      const failures = await Promise.allSettled([...children].map(terminate))
      for (const result of failures) if (result.status === "rejected") throw result.reason
    } finally { if (sandbox) rmSync(sandbox, { recursive: true, force: true }) }
  })()
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.on(signal, () => { void cleanup().catch(console.error).finally(() => process.exit(code)) })
}
class OfflineSkip extends Error {}
async function bounded<T>(work: Promise<T>, timeout: number, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${description} timed out after ${timeout}ms`)), timeout)
    })])
  } finally { clearTimeout(timer) }
}
const results: Record<string, unknown> = { version }
const json = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const record = (name: string, value: unknown = "PASS") => { results[name] = value; console.log(`${name}: ${JSON.stringify(value)}`) }
async function eventually<T>(probe: (signal: AbortSignal) => Promise<T>, accept: (value: T) => boolean, timeout = 30_000): Promise<T> {
  const until = Date.now() + timeout
  let last: unknown
  while (Date.now() < until) {
    const remaining = until - Date.now()
    const attempt = Math.min(1500, remaining)
    try {
      const value = await bounded(probe(AbortSignal.timeout(attempt)), attempt, "Probe")
      last = value
      if (accept(value)) return value
    } catch (error) { last = error }
    await Bun.sleep(Math.min(100, Math.max(0, until - Date.now())))
  }
  throw new Error(`Timed out after ${timeout}ms: ${last instanceof Error ? last.message : JSON.stringify(last)}`)
}
async function stop() {
  if (!server) return
  await terminate(server)
  server = undefined
}
try {
  sandbox = mkdtempSync(join(tmpdir(), "profile-switcher-v2-"))
  const config = join(sandbox, "config", "opencode")
  const project = join(sandbox, "project")
  const install = join(sandbox, "install")
  const password = crypto.randomUUID()
  // Explicit environment is equivalent to env -i; no user service or credentials.
  const env: Record<string, string> = {
    PATH: "/usr/local/bin:/usr/bin:/bin", HOME: join(sandbox, "home"),
    XDG_CONFIG_HOME: join(sandbox, "config"), XDG_DATA_HOME: join(sandbox, "data"),
    XDG_STATE_HOME: join(sandbox, "state"), XDG_CACHE_HOME: join(sandbox, "cache"),
    OPENCODE_SERVER_PASSWORD: password, TERM: "xterm-256color",
  }
  for (const path of [...Object.values(env).filter(p => p.startsWith(sandbox!)), config, project, install]) mkdirSync(path, { recursive: true })
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
    throw new OfflineSkip("npm registry unreachable")
  }
  json(join(install, "package.json"), { private: true, type: "module", trustedDependencies: ["@opencode/cli"], dependencies: { "@opencode/cli": version, "@opencode/client": version, "@opencode/plugin": version, zod: "4.1.8" } })
  const installed = Bun.spawn([process.execPath, "install", "--cwd", install], { env, detached: true, stdout: "pipe", stderr: "pipe" })
  children.add(installed)
  const installLogs = Promise.all([new Response(installed.stdout).text(), new Response(installed.stderr).text()])
  let installCode: number
  try { installCode = await bounded(installed.exited, 120_000, "Install") }
  finally { await terminate(installed) }
  assert.equal(installCode, 0, (await installLogs).join("\n"))
  const plugin = join(install, "node_modules", "opencode-profile-switcher-v2")
  mkdirSync(plugin, { recursive: true })
  cpSync(join(repo, "packages/v2/dist"), join(plugin, "dist"), { recursive: true })
  cpSync(join(repo, "packages/v2/package.json"), join(plugin, "package.json"))
  const binary = join(install, "node_modules/.bin/opencode")
  const checked = Bun.spawn([binary, "--version"], { env, detached: true, stdout: "pipe", stderr: "pipe" })
  children.add(checked)
  const versionOutput = new Response(checked.stdout).text()
  try { assert.equal(await bounded(checked.exited, 15_000, "Version probe"), 0) }
  finally { await terminate(checked) }
  assert.equal((await versionOutput).trim(), `opencode v${version}`)
  console.log(`Sandbox: ${sandbox}`)
  console.log(`Pinned binary: ${binary}`)
  const { OpenCode } = await import(join(install, "node_modules/@opencode/client/dist/promise/index.js"))
  const { ProfileSwitcherRpc } = await import(join(plugin, "dist/rpc.js"))
  const alpha = { heavy: { model: "opencode/big-pickle", variant: "high" }, rest: { model: "opencode/nemotron-3.5-lightning-free" }, placements: { build: "heavy", plan: "heavy", explore: "rest", loose: "heavy", pinnedglobal: "heavy", pinneddefault: "rest", pinnedrepo: "heavy", pinnedmd: "heavy", phantom: "heavy" }, specifics: {} }
  const beta = { heavy: { model: "opencode/space-bunny-free", variant: "low" }, rest: { model: "opencode/big-pickle" }, placements: { ...alpha.placements, build: "excluded" }, specifics: {} }
  const profilesPath = join(config, "profiles.json")
  json(profilesPath, { profiles: { alpha, beta }, active: "alpha", effective: {} })
  json(join(config, "opencode.jsonc"), { plugins: ["*", join(plugin, "dist")], model: "opencode/space-bunny-free", agents: { pinneddefault: { model: "opencode/nemotron-3.5-lightning-free#default" }, pinnedglobal: { model: "opencode/space-bunny-free#high", prompt: "Global fixed agent" } } })
  mkdirSync(join(project, ".opencode"), { recursive: true })
  json(join(project, "opencode.jsonc"), { agents: { pinnedrepo: { model: "opencode/big-pickle#default", prompt: "Repo fixed agent" } } })
  mkdirSync(join(config, "agents"), { recursive: true })
  writeFileSync(join(config, "agents/pinnedmd.md"), "---\nmodel: opencode/space-bunny-free#max\n---\nPinned markdown agent.\n")
  writeFileSync(join(config, "agents/loose.md"), "---\ndescription: Unpinned markdown agent\n---\nBe concise.\n")
  let baseUrl = ""
  const start = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const reserved = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
      const port = reserved.port!
      await reserved.stop(true)
      baseUrl = `http://127.0.0.1:${port}`
      let startupOutput = ""
      server = Bun.spawn([binary, "serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs"], { cwd: project, env, detached: true, stdout: "pipe", stderr: "pipe" })
      children.add(server)
      for (const stream of [server.stdout, server.stderr]) void (async () => { for await (const chunk of stream as ReadableStream<Uint8Array>) { const text = new TextDecoder().decode(chunk); output += text; startupOutput += text } })()
      try {
        await eventually(async signal => {
          if (server!.exitCode !== null || server!.signalCode) throw new Error(startupOutput)
          return (await fetch(`${baseUrl}/api/server`, { signal })).status
        }, code => code === 401)
        return
      } catch (error) {
        await stop()
        if (attempt === 2 || !/address already in use|EADDRINUSE|port \d+ in use/i.test(startupOutput)) throw error
      }
    }
  }
  await start()
  const client = OpenCode.make({ baseUrl, fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(String(input).replace(/^http:\/\/127\.0\.0\.1:\d+/, baseUrl), {
    ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  }), headers: { Authorization: `Basic ${btoa(`opencode:${password}`)}` } })
  const location = { directory: project }
  const rpc = client.rpc(ProfileSwitcherRpc)
  const status = (signal?: AbortSignal) => rpc.status({}, { location, signal })
  const agents = async () => (await client.agent.list({ location })).data
  await eventually(async () => (await fetch(`${baseUrl}/api/server`, { signal: AbortSignal.timeout(1000) })).status, code => code === 401)
  record("authenticated-private-server")
  let boot = await eventually(status, (s: any) => s.phase === "ready")
  record("boot-status", boot)
  const list = await agents()
  const find = (id: string) => list.find((a: any) => a.id === id)
  for (const id of ["build", "plan"]) assert.deepEqual(find(id).model, { providerID: "opencode", id: "big-pickle", variant: "high" })
  assert.deepEqual(find("explore").model, { providerID: "opencode", id: "nemotron-3.5-lightning-free" })
  for (const id of ["title", "summary", "compaction"]) { assert.equal(find(id).model.id, "nemotron-3.5-lightning-free"); assert.equal(find(id).hidden, true) }
  assert.equal(find("loose").model.id, "big-pickle")
  assert.equal(find("phantom"), undefined)
  assert.equal(boot.partial, true)
  assert.deepEqual([...boot.fixedByConfig].sort(), ["pinnedglobal", "pinnedmd", "pinnedrepo"])
  record("boot-agents", list.map((agent: any) => ({ id: agent.id, model: agent.model, hidden: agent.hidden })))
  const configuredDefault = await client.model.default({ location })
  assert.equal(configuredDefault.data.id, "space-bunny-free")
  record("config-model-beats-catalog-transform", configuredDefault)
  assert.deepEqual(find("pinnedglobal").model, { providerID: "opencode", id: "space-bunny-free", variant: "high" })
  assert.deepEqual(find("pinnedrepo").model, { providerID: "opencode", id: "big-pickle", variant: "default" })
  assert.deepEqual(find("pinnedmd").model, { providerID: "opencode", id: "space-bunny-free", variant: "max" })
  assert.deepEqual(find("pinneddefault").model, { providerID: "opencode", id: "nemotron-3.5-lightning-free", variant: "default" })
  assert.deepEqual(boot.unapplied, [])
  assert.equal(find("title").model.variant, undefined)
  assert.equal(boot.agents.find((a: any) => a.id === "pinneddefault").fixedByConfig, false)
  record("variant-default-effective-equivalence", boot.agents.find((a: any) => a.id === "pinneddefault"))
  record("variant-on-disk", { repo: find("pinnedrepo").model, markdown: find("pinnedmd").model, omitted: find("title").model })
  // The catalog lists Big Pickle with no named variants and Space Bunny with
  // low; only agents that took the profile's big-pickle#high are warned about.
  const catalog = (await client.model.list({ location })).data
  const offered = (id: string) => catalog.find((m: any) => m.providerID === "opencode" && m.id === id)?.variants.map((v: any) => v.id)
  assert.deepEqual(offered("big-pickle"), [])
  assert(offered("space-bunny-free")?.includes("low"))
  assert.deepEqual(boot.unavailableVariants.map((v: any) => v.agent).sort(), ["build", "loose", "plan"])
  for (const v of boot.unavailableVariants) assert.deepEqual({ model: v.model, variant: v.variant, offered: v.offered }, { model: "opencode/big-pickle", variant: "high", offered: [] })
  assert.equal(find("build").model.variant, "high")
  await eventually(async () => output, text => text.includes('variant not offered by the model, prompts will fail: "opencode/big-pickle#high"'), 5_000)
  record("variant-not-offered-warning", { catalog: { "big-pickle": offered("big-pickle"), "space-bunny-free": offered("space-bunny-free") }, warnings: boot.unavailableVariants })
  const abort = new AbortController()
  const events: unknown[] = []
  const unsubscribe = rpc.events.on("switched", (event: unknown) => events.push(event), { signal: abort.signal })
  let subscribed = false
  const stream = (async () => { for await (const _ of client.event.subscribe({ signal: abort.signal, onActivity: () => { subscribed = true } })) {} })().catch(() => {})
  try {
    await eventually(async () => subscribed, ready => ready)
    const pid = server!.pid
    const switched = await rpc.switch({ profile: "beta" }, { location })
    assert.equal(switched.active, "beta")
    await eventually(async () => events, (e) => e.length > 0)
    assert.equal(server!.pid, pid)
    assert.equal(server!.exitCode, null)
    assert.equal((await agents()).find((a: any) => a.id === "plan").model.id, "space-bunny-free")
    assert.equal(switched.agents.find((a: any) => a.id === "build").model.id, "big-pickle")
    // Beta's heavy space-bunny-free#low is offered; excluded build keeps big-pickle#high.
    assert.deepEqual(switched.unavailableVariants.map((v: any) => [v.agent, v.placement]), [["build", "excluded"]])
    record("live-switch-event", events)
  } finally { abort.abort(); unsubscribe?.(); void stream }
  rmSync(join(config, "agents/loose.md"))
  // Reload until the host has invalidated its debounced markdown cache.
  await eventually(async signal => {
    await rpc.switch({ profile: "alpha" }, { location, signal })
    return (await client.agent.list({ location, signal })).data
  }, list => !list.some((a: any) => a.id === "loose"))
  assert.equal((await agents()).some((a: any) => a.id === "loose"), false)
  await rpc.switch({ profile: "beta" }, { location })
  record("markdown-deletion-no-ghost")
  assert.deepEqual(read(profilesPath).effective.build, { model: "opencode/big-pickle", variant: "high" })
  const globalConfig = read(join(config, "opencode.jsonc"))
  delete globalConfig.model
  json(join(config, "opencode.jsonc"), globalConfig)
  await stop()
  await start()
  boot = await eventually(status, (s: any) => s.phase === "ready")
  assert.equal(boot.active, "beta")
  assert.deepEqual(boot.agents.find((a: any) => a.id === "build").model, { providerID: "opencode", id: "big-pickle", variant: "high" })
  record("excluded-after-restart")
  const heavyDefault = await client.model.default({ location })
  assert.equal(heavyDefault.data.id, "space-bunny-free")
  record("catalog-heavy-without-config-model", heavyDefault)
  const restarted = await agents()
  for (const id of ["explore", "title", "summary", "compaction"]) assert.deepEqual(restarted.find((a: any) => a.id === id).model, { providerID: "opencode", id: "big-pickle" })
  record("rest-distinct-from-catalog-after-restart", restarted.filter((a: any) => ["explore", "title", "summary", "compaction"].includes(a.id)).map((a: any) => ({ id: a.id, model: a.model, hidden: a.hidden })))
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
  const dialog = { ...ctx.ui.dialog, async select(options) {
    appendFileSync(trace, JSON.stringify({ event: "dialog-open", title: options.title }) + "\\n");
    const selected = await ctx.ui.dialog.select(options);
    appendFileSync(trace, JSON.stringify({ event: "dialog-selected", selected }) + "\\n");
    return selected;
  } };
  const ui = { ...ctx.ui, dialog };
  return original.setup(new Proxy(ctx, { get(target, key) { return key === "keymap" ? keymap : key === "ui" ? ui : Reflect.get(target, key); } }));
} };`)
  const tuiProbe = async (name: string, explicit: boolean) => {
    rmSync(trace, { force: true })
    if (explicit) json(join(config, "cli.json"), { plugins: [join(plugin, "dist")] })
    else rmSync(join(config, "cli.json"), { force: true })
    let terminalOutput = ""
    const terminal = new Bun.Terminal({ cols: 100, rows: 30, data(_terminal, data) { terminalOutput += new TextDecoder().decode(data) } })
    const tui = Bun.spawn([binary, "--server", baseUrl, "--print-logs"], { cwd: project, env, terminal, detached: true })
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
      if (!explicit) {
        terminal.write("/profile")
        await eventually(async () => terminalOutput.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ""), text => text.includes("Switch model profile"), 15_000)
        terminal.write("\r")
        // The first Enter accepts slash completion; the second runs it.
        terminal.write("\r")
        await eventually(async () => readFileSync(trace, "utf8"), text => text.includes('"event":"dialog-open","title":"Model profile"'), 15_000)
        // Active beta is first; the next picker row is alpha.
        terminal.write("\u001b[B\r")
        const picked = await eventually(status, (s: any) => s.active === "alpha" && s.phase === "ready")
        assert.equal(picked.active, "alpha")
        record("tui-profile-picker", { active: picked.active })
      }
    } catch (error) { throw new Error(`${error}\nTUI output: ${terminalOutput.slice(-8000)}`) }
    finally {
      try { await terminate(tui) } finally { terminal.close() }
    }
  }
  await tuiProbe("tui-automatic", false)
  await tuiProbe("tui-both-sources-deduplicated", true)
  // Session metadata proves the next turn's selected model without asserting
  // nondeterministic response text. These models need no user credentials.
  await rpc.switch({ profile: "alpha" }, { location })
  // Big Pickle has no named variants: high is valid agent metadata but is
  // rejected for inference by the host. Start its real turn with the default.
  const session = await client.session.create({ agent: "plan", model: { providerID: "opencode", id: "big-pickle" }, location })
  const turn = async (text: string) => {
    await client.session.prompt({ sessionID: session.id, text, location })
    await client.session.wait({ sessionID: session.id, location })
    return (await client.message.list({ sessionID: session.id, location })).data.filter((m: any) => m.type === "assistant")
  }
  const first = await turn("Reply with exactly ONE. Do not use tools.")
  assert(first.some((m: any) => m.model.id === "big-pickle" && m.model.variant === "default" && !m.error), JSON.stringify(first))
  const switchedSession = await rpc.switch({ profile: "beta" }, { location })
  const beforeSwitchModel = await client.session.get({ sessionID: session.id, location })
  assert.deepEqual(beforeSwitchModel.model, { providerID: "opencode", id: "big-pickle", variant: "default" })
  record("reload-preserves-open-session", beforeSwitchModel.model)
  const target = switchedSession.agents.find((a: any) => a.id === "plan").model
  assert.deepEqual(target, { providerID: "opencode", id: "space-bunny-free", variant: "low" })
  await client.session.switchModel({ sessionID: session.id, model: target, location })
  const second = await turn("Reply with exactly TWO. Do not use tools.")
  assert(second.some((m: any) => m.model.id === "space-bunny-free" && m.model.variant === "low" && !m.error), JSON.stringify(second))
  record("session-switchModel", second.map((message: any) => ({ id: message.id, model: message.model, finish: message.finish, error: message.error })))
  await stop()
  globalConfig.model = "opencode/nemotron-3.5-lightning-free"
  json(join(config, "opencode.jsonc"), globalConfig)
  const projectConfig = read(join(project, "opencode.jsonc"))
  projectConfig.model = "opencode/big-pickle"
  json(join(project, "opencode.jsonc"), projectConfig)
  await start()
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
  await start()
  const overridden = await eventually(status, (s: any) => s.phase === "ready")
  assert.equal(overridden.path, join(override, "profiles.json"))
  record("explicit-config-dir", overridden.path)
} catch (error) {
  if (!(error instanceof OfflineSkip)) { console.error(error); console.error(output); process.exitCode = 1 }
} finally {
  try {
    if (process.env.SMOKE_V2_EVIDENCE) json(resolve(process.env.SMOKE_V2_EVIDENCE), results)
  } finally {
    await cleanup()
  }
}
