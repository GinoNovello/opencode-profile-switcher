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

The copied build is frozen for the run under the sandbox installation. For a
local plugin, OpenCode 2.0.29 expects a **directory with `server.js` and `tui.js`
at its root**: the harness points `plugins` to the copied package's `dist`
directory. Neither the package root containing only `dist/` nor a direct
`server.js` path is an equivalent local plugin target. `"*"` retains the host's
builtin plugins.

The harness verifies:

- Ready boot, build and plan using `big-pickle#high`, explore and hidden agents using rest,
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
- A real successful public-model turn with `opencode/big-pickle`, followed by
  an RPC profile switch and `session.switchModel`, and another successful turn
  using `opencode/space-bunny-free#low`. A session read between RPC reload and
  `switchModel` asserts that reload preserved `big-pickle#default`. Assistant metadata
  establishes the model and named variant
  used; response text is deliberately not asserted.
- Variants the model does not offer: the catalog (`client.model.list()`) lists
  `big-pickle` with `variants: []`, so the boot status reports
  `unavailableVariants` for exactly the agents that took alpha's
  `big-pickle#high` (`build`, `plan`, markdown `loose`; not the agents fixed by
  config), the server log carries the warning, and the agents still list
  `variant: "high"`. Switching to beta clears it except for excluded `build`,
  which restores its remembered `big-pickle#high`.
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

## Loading the published package by name (opt-in)

Set `SMOKE_V2_NPM=1` to also load `opencode-profile-switcher-v2` from npm by
its bare name, or set it to a full spec such as
`SMOKE_V2_NPM=opencode-profile-switcher-v2@0.1.1` to pin a version. It is off
by default because it downloads the published package, not the local build.
The scenario runs first, in the same sandbox and isolated environment, with
`plugins: ["*", "<spec>"]` in place of the copied `dist`, then restores the
dist configuration and `profiles.json` for the scenarios above. It asserts:

- `plugin.list` reports one non-builtin plugin, `opencode-profile-switcher-v2`,
  from source `package` with the configured target, features `server`, `tui`
  and `rpc`, and status `active`;
- the package is installed at
  `$XDG_CACHE_HOME/opencode/npm/<spec>/<generation>/node_modules/opencode-profile-switcher-v2`,
  where the bare name is keyed as `<name>@latest`, with the version the host
  reports;
- the RPC (imported from that installed copy) reports `ready` against the
  sandbox `profiles.json`, and two switches apply to the `plan` agent;
- in a real TUI attached through the pty, `/profile` completes as
  "Switch model profile", opens the picker, and selecting a profile there
  changes the RPC's active profile.

Both the bare name and `@0.1.1` passed against 2.0.29. How the host resolves
a package entry comes from reading the pinned binary, not from a harness
assertion: it installs the spec with npm's Arborist under the cache path above
(no lifecycle scripts) and resolves the `<name>/server` export (falling back to
`<name>`), `<name>/tui` and `<name>/rpc` from that directory. The host
installs the package's peer dependencies with it, at the newest version in
range: under 2.0.29 the installed tree had `@opencode/plugin` 2.0.32. A pin to
another published version installs exactly that version (checked manually with
`0.0.0-stage`, a release whose tarball has no `dist`). The package is
installed in the background after the location's first request, so agents can
answer before the plugin is loaded.

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

The named variant `low` is asserted on successful Space Bunny assistant message
metadata. Big Pickle advertises no named variants: an attempted `high` inference
failed with `VariantUnavailableError`, so its real turn uses the default and
asserts `message.model.variant === "default"` for an omitted session variant.
This verifies selection transport, not the provider's internal reasoning behavior. Other named reasoning variants and the
interaction with the host's `/models` command remain open manual checks.

The catalog assertions establish which default model wins (profile, global,
repository). The explanation that `opencode.config.provider` runs in post and
calls `model.default.set` comes from reading the pinned binary, not a harness
assertion. Likewise, dropping the heavy variant from the catalog default is the
switcher's `defaultModel()` implementation decision; the catalog response does
not expose the selected variant and cannot prove that mechanism.
