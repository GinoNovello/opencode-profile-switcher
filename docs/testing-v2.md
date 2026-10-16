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

- Ready boot, built-in heavy models and variants, hidden agents using rest,
  config overrides at global/repository/markdown scope, and markdown agents
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
  using `opencode/space-bunny-free`. Assistant metadata establishes the model
  used; response text is deliberately not asserted.
- `OPENCODE_CONFIG_DIR` selecting the sandbox override's `profiles.json`.

A missing registry network connection prints an explicit `SKIP`. Registry HTTP
errors, installation errors, server errors, unavailable models, and assertion
failures fail the command. Public inference can depend on service availability;
no credentials are substituted when it fails. Installation and requests have
bounded deadlines. Every owned process and the sandbox are removed on success,
failure, SIGINT, or SIGTERM. As usual, SIGKILL cannot run cleanup handlers.

Set `SMOKE_V2_EVIDENCE=/absolute/path/results.json` to retain scenario snapshots
outside the sandbox. Failures print the captured server output; TUI failures
also include recent terminal output. The temporary sandbox is always removed.

The TUI picker, wizard, footer rendering, keyboard navigation, and selecting a
profile in an already open TUI session remain manual checks. To reproduce those
checks independently, use the same isolated environment and pinned installation,
configure `plugins: ["*", "/path/to/copied/dist"]`, start an authenticated private
`serve`, and attach that installation's `opencode --server http://127.0.0.1:PORT`.
Enter `/profile` and select a profile, then verify the footer and next turn in
the current session. Stop only these private processes afterward.

OpenCode's agent listing preserves an omitted variant as absent and preserves
an explicit `#default` as `"default"`. Sessions normalize an omitted variant to
`"default"`; the host treats these as the same effective selection during
`switchModel`. The switcher's `landed()` comparison intentionally accepts that
equivalence. A same-model explicit `#default` therefore does not make the profile
partial, while a different model or named variant does.
