# Real OpenCode 2.0 smoke harness

Run `bun run test:smoke:v2` from the repository root. This opt-in command builds
`packages/v2`, then installs `@opencode/cli`, `@opencode/client`, and
`@opencode/plugin` at exactly `2.0.29` in a fresh temporary directory. It is
excluded from `bun run check` and both unit test suites. Bun 1.4 with terminal
support is required for the TUI probes.

The harness passes an explicit environment to every child, equivalent to
`env -i`: a private `HOME`, all four `XDG_*_HOME` directories, a basic system
`PATH`, terminal type, and a random `OPENCODE_SERVER_PASSWORD`. It never invokes
the global `opencode` command or reads the user's OpenCode configuration or
provider credentials. It starts its own `serve` on a dynamically reserved
loopback port, authenticates as `opencode`, and attaches TUI children with
`--server` to that address. It does not use the background service. An explicit
sandbox `OPENCODE_CONFIG_DIR` is introduced only in the final scenario.

OpenCode 2.0.29 also loads `.opencode`, `.claude`, `.agents`, `opencode.json`
and `opencode.jsonc` from every ancestor of the project directory, up to `/`,
whether or not there is a git repository. The sandbox lives under `TMPDIR`, so
its ancestors are `TMPDIR`'s. Before installing anything, the harness fails if
any of those names exists above the sandbox (an empty directory is ignored).
Under `/tmp` there is usually nothing to find. With `TMPDIR` under a home
directory that has `~/.claude` or `~/.opencode`, either pick another
`TMPDIR` or mask them with empty directories, for example (the `TMPDIR`
directory must exist):

```sh
bwrap --dev-bind / / --tmpfs ~/.claude --tmpfs ~/.agents --tmpfs ~/.opencode \
  --die-with-parent -- env TMPDIR="$HOME/smoke-tmp" bun run test:smoke:v2
```

## Catalog and model selection

The scenarios do not name fixed models. OpenCode boots from a models.dev
snapshot bundled in its binary and replaces it in the background with the live
catalog, which it caches in its database. Deprecated models drop out of
`client.model.list()`, and the host ignores a deprecated config `model`, so a
fixed id breaks as soon as the public catalog rotates (#61: `space-bunny-free`).
The live catalog can also differ from the snapshot the server answers with at
first.

So the harness first boots the sandbox server once, without the plugin, and
waits until that server has cached the live catalog (the `models-dev:catalog`
key of its `kv` table). From then on every child runs with
`OPENCODE_DISABLE_MODELS_FETCH=1`, which makes each boot read that cache and
never refresh it, so the whole run sees one catalog. A second boot reads
`client.model.list()` and `client.model.default()` from that cache, and the
harness picks three models from the list. The catalog comes from the sandbox
server, never from models.dev directly. Usable models are those
with provider `opencode`, `status: "active"`, `enabled`, and every cost tier at
zero input and output (public models that need no credentials), ordered
by release date, oldest first. Newly released free models are the ones that
rotate out, so the oldest survive longest. In that order:

- **tiered**: the first that offers a named variant (any id other than
  `default`) and is not the host's own default model. If tiered were the host
  default, the catalog default would look the same whether or not the profile
  transform ran. Beta's heavy uses its first variant (`tier`); the config- and
  frontmatter-pinned agents use its last.
- **plain**: the first with no variants at all, the Big Pickle case. Alpha's
  heavy uses it with `high`, which it does not offer.
- **rest**: the first that is neither of those. Alpha's rest uses it.

When the catalog has no model for a role, the harness fails before writing
any fixture with `Catalog drift: the sandbox catalog of OpenCode 2.0.29 no
longer has a model that is <criterion>`, followed by the usable models and
their variants and the host default. When the sandbox server does not cache
the catalog within 60 s, the message is `The sandbox server did not cache the
models.dev catalog`. The `catalog-selection` record, also in
`SMOKE_V2_EVIDENCE`, shows the choice. On 2026-10-20 it was tiered
`glm-5.3-flash-free` (`low`, `high`, `max`), plain `big-pickle`, rest
`nemotron-3-ultra-free`, with host default `minimax-m3.1-flash-free`.

Inference still goes to the public service. A model the catalog lists can
still fail a real turn, and that fails the run.

The copied build is frozen for the run under the sandbox installation. For a
local plugin, OpenCode 2.0.29 expects a **directory with `server.js` and `tui.js`
at its root**: the harness points `plugins` to the copied package's `dist`
directory. Neither the package root containing only `dist/` nor a direct
`server.js` path is an equivalent local plugin target. `"*"` retains the host's
builtin plugins.

The harness verifies:

- Ready boot, build and plan using `plain#high`, explore and hidden agents using rest,
  with distinct heavy/rest/catalog models, exact config model and variant overrides
  at global/repository/markdown scope, and markdown agents
  without models inheriting their profile.
- Live RPC switching, the `switched` event, and unchanged server process.
- Deleted markdown agents disappearing after the host's filesystem debounce
  and a switch, without profile placements creating phantom agents.
- Excluded agents remembering their effective model and variant across restart.
- Catalog default ordering: profile heavy without config, global `model`
  overriding the profile transform, and repository `model` overriding both.
- Host config/frontmatter `provider/model#variant`, including explicit
  `#default`, versus separate variant fields in `profiles.json`.
- The actual shipped TUI setup and `/profile` command registration, both
  automatically through server plugin discovery and with the same TUI target
  also listed in `cli.json`. A wrapper observes setup and keymap calls while
  delegating to the built plugin. One setup is required; reactive keymap
  factory reevaluations are allowed.
- A real successful public-model turn with plain, followed by
  an RPC profile switch and `session.switchModel`, and another successful turn
  using `tiered#tier`. A session read between RPC reload and
  `switchModel` asserts that reload preserved `plain#default`. Assistant metadata
  establishes the model and named variant
  used; response text is deliberately not asserted.
- Variants the model does not offer: the catalog (`client.model.list()`) lists
  plain with `variants: []`, so the boot status reports
  `unavailableVariants` for exactly the agents that took alpha's
  `plain#high` (`build`, `plan`, markdown `loose`; not the agents fixed by
  config), the server log carries the warning, and the agents still list
  `variant: "high"`. Switching to beta clears it except for excluded `build`,
  which restores its remembered `plain#high`.
- `OPENCODE_CONFIG_DIR` selecting the sandbox override's `profiles.json`.

A missing registry network connection prints an explicit `SKIP`. Registry HTTP
errors, installation errors, server errors, unavailable models, and assertion
failures fail the command. Public inference can depend on service availability;
no credentials are substituted when it fails. Installation and requests have
bounded deadlines, including each poll attempt and the version probe. Port bind
collisions retry with a new reserved loopback port. Children run in private process
groups; cleanup terminates the whole group, including install descendants whose
parent already exited, and handles repeated interrupts. Every owned process and
the sandbox are removed on success, failure, SIGINT, or SIGTERM. As usual, SIGKILL cannot run cleanup handlers.

Set `SMOKE_V2_EVIDENCE=/absolute/path/results.json` to retain scenario snapshots
outside the sandbox. Failures print the captured server output; TUI failures
also include recent terminal output. The temporary sandbox is always removed.

The harness also sends `/profile` through the terminal, waits for the real
picker dialog, selects alpha with Down/Enter, and asserts RPC active alpha.

The wizard, footer rendering, and switching the focused session from the TUI
remain manual checks. Use the same isolated environment and pinned installation,
configure `plugins: ["*", "/path/to/copied/dist"]`, start an authenticated private
`serve`, and attach that installation's `opencode --server http://127.0.0.1:PORT`.
Open two sessions or tabs with known models. Focus one, enter `/profile`, and
select another profile. Verify its footer and next turn use the selected profile,
then revisit the second session and verify its model did not change (ADR-0005).
Stop only these private processes afterward.

The harness asserts that agent listings preserve an omitted variant as absent
and explicit `#default` as `"default"`. The matching `pinneddefault` agent has the
exact rest model with `variant: "default"`, is not fixed by config, and the boot
has no unapplied agents. This proves the switcher's effective equivalence case.
It does not exercise the host's internal absent-versus-default comparison inside
`switchModel`; the successful Big Pickle turn separately asserts session
normalization.

`plain`, `tiered`, `tier` and `rest` stand for the models picked from the
catalog (see above).

## Loading the published package by name (opt-in)

Set `SMOKE_V2_NPM=1` to also load `opencode-profile-switcher-v2` from npm by
its bare name, or set it to a full spec such as
`SMOKE_V2_NPM=opencode-profile-switcher-v2@0.1.1` to pin a version. It is off
by default because it downloads the published package, not the local build.
The scenario runs first, in the same sandbox and isolated environment, with
`plugins: ["*", "<spec>"]` in place of the copied `dist`, then restores the
dist configuration and `profiles.json` for the scenarios above. It asserts:

- the package is installed at
  `$XDG_CACHE_HOME/opencode/npm/<spec>/<generation>/node_modules/opencode-profile-switcher-v2`,
  where `<spec>` is the `plugins` entry and the bare name is keyed as
  `opencode-profile-switcher-v2@latest`;
- `plugin.list` reports one non-builtin plugin, `opencode-profile-switcher-v2`,
  from source `package` with the configured target and the installed
  `package.json` version, features `server`, `tui` and `rpc`, and status
  `active`;
- with an exact version in the spec, the installed `package.json` has that
  version;
- the server log has `msg="loading plugin"` with that target and
  `entrypoint=file://<installed copy>/dist/server.js`, and does not mention the
  dist copied into the install (the TUI logs its entrypoint only at debug
  level, so its copy is not asserted);
- `plugin.list` reports it `active`; a `failed` load fails with the plugin's
  state instead of a later missing-directory error;
- the RPC (imported from that installed copy) reports `ready` against the
  sandbox `profiles.json`, and two switches apply to the `plan` agent;
- in a real TUI attached through the pty, `/profile` completes as
  "Switch model profile", opens the picker, and selecting a profile there
  changes the RPC's active profile.

`SMOKE_V2_NPM` accepts only `1` or a spec starting with
`opencode-profile-switcher-v2`; any other value fails before anything is
installed. Both the bare name and `@0.1.1` passed against 2.0.29.

Checked by hand, not asserted by the harness:

- `0.1.1` is also `latest`, so the pinned run cannot tell a respected pin from
  latest. A pin to another published version, `0.0.0-stage`, installed exactly
  that version under the key `opencode-profile-switcher-v2@0.0.0-stage` (that
  release's tarball has no `dist`, so it does not load).
- Observed in a manual run: the host installs the package's peer dependencies
  with it at the newest version in range; under 2.0.29 the installed tree had
  `@opencode/plugin` 2.0.32.

From reading the pinned binary: the host installs the spec with npm's Arborist
under the cache path above (no lifecycle scripts), where the cache is
`$XDG_CACHE_HOME/opencode`, or `~/.cache/opencode` without `XDG_CACHE_HOME`. It
resolves the `<name>/server` export (falling back to `<name>`), `<name>/tui`
and `<name>/rpc` from that directory. The package is installed in the
background after the location's first request, so agents can answer before the
plugin is loaded.

On 2026-10-20 the committed harness ran to the end with `SMOKE_V2_NPM=1`
against 2.0.29: the npm scenario, then every dist scenario including the TUI
probes and both real turns. The state the npm server and TUI leave in the
sandbox's `XDG_STATE_HOME` and `XDG_DATA_HOME` did not affect them. That run
installed `0.1.1`.

The peers are resolved at install time, so this scenario depends on the npm
registry's state at that moment. One run failed with `No matching version found
for @opencode/protocol@2.1.1`: `@opencode/plugin@2.1.1` had been published
eleven minutes before `@opencode/protocol@2.1.1`, and the install ran in that
window. A rerun once both were up passed.

## Variant warning in the RPC status

`status` (and the `switch` result) carries `unavailableVariants`: one entry
`{ agent, placement, model: "provider/model", variant, offered }` per agent that
took a profile model whose variant is not among the catalog's
`ModelInfo.variants[].id` for that model. It is a warning only; the switcher
applies the slot as written. It is empty unless `phase` is `ready`, and empty
when the catalog cannot be read or does not answer within the pass's timeout
(5 s by default). The catalog is read before the pass is published, so a
`ready` status always carries the agents and warnings of that pass. An omitted or `default` variant, a model the
catalog does not list, and an agent fixed by config are never reported. An
empty `variants` array is information, not its absence: the host rejects any
named variant for such a model (see Big Pickle below). The TUI shows the
warning in the switch toast; the `switched` event does not carry it.

The named variant `tier` is asserted on successful tiered assistant message
metadata. Plain advertises no named variants: an attempted `high` inference on
Big Pickle failed with `VariantUnavailableError`, so its real turn uses the
default and asserts `message.model.variant === "default"` for an omitted
session variant.
This verifies selection transport, not the provider's internal reasoning behavior. Other named reasoning variants and the
interaction with the host's `/models` command remain open manual checks.

The catalog assertions establish which default model wins (profile, global,
repository). The explanation that `opencode.config.provider` runs in post and
calls `model.default.set` comes from reading the pinned binary, not a harness
assertion. Likewise, dropping the heavy variant from the catalog default is the
switcher's `defaultModel()` implementation decision; the catalog response does
not expose the selected variant and cannot prove that mechanism.
