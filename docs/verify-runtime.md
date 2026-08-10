# Runtime verification against OpenCode 2.0 preview

Type-level compatibility with a new opencode build can be checked from a
checkout. Runtime behaviour cannot: opencode loads a plugin's `./tui` export
**only from a published npm package**, so `/profile`, the setup wizard and the
profile indicator never run in a local install. This document closes that gap.

## What v2 is

OpenCode 2.0 is real and documented at <https://opencode.ai/v2/docs> — *"These
docs are for the beta version of OpenCode, which will become OpenCode 2.0"*.
It ships as a **separate package with its own binary**:

| | 1.x (current) | 2.0 preview |
| --- | --- | --- |
| package | `opencode-ai` | `@opencode-ai/cli@next` |
| binary | `opencode` | **`opencode2`** |
| plugin API | `@opencode-ai/plugin` (`1.18.x`) | `@opencode-ai/plugin@next` (`0.0.0-next-*`) |

The two binaries coexist; installing v2 does not disturb a 1.x install.

Do **not** confuse this with the `beta` dist-tag of the `opencode-ai` package —
that is the nightly of the 1.x line, not v2. An earlier research pass made
exactly that mistake; see the invalidation banner on
`.scratch/profile-switcher/research/05-opencode-v2.md`.

### What is known so far

Verified by unpacking `@opencode-ai/plugin@next`:

- Exports are restructured: `.` now resolves to `dist/promise/`, alongside
  `./v1`, `./tui` and `./effect`.
- There is a **`v1/` compatibility layer**. `dist/v1/index.d.ts` is
  byte-identical to `1.18.10`'s `index.d.ts`, hook `config` included.
  `dist/v1/tui.d.ts` differs in 88 lines but keeps the
  `home_prompt_right` / `session_prompt_right` slots and the `keymap` API.
- **`dispose` appears nowhere in `@opencode-ai/client@next`** — zero
  occurrences in the whole package — and `@opencode-ai/schema@next` has no
  `server.instance.*` events. The `v1` layer still depends on
  `@opencode-ai/sdk@1.18.5`, which does know `/instance/dispose` and
  `server.instance.disposed`.

**This is the open risk.** The live switch is built on
`client.instance.dispose()`. Whether the v2 server still serves that endpoint
is a runtime question that types cannot answer — which is precisely what
checklist row 4 below exists to settle.

## Step 1 — publish a `next` build

The release workflow takes a `channel` input:

- **`latest`** — patch bump, published to `latest`. Normal releases.
- **`next`** — prerelease bump (`0.1.7` → `0.1.8-next.0`), published to the
  `next` dist-tag **only**. `latest` keeps pointing at the last stable version,
  so `npm i opencode-profile-switcher` and existing installs are unaffected.

Run it from the Actions tab (`release` → *Run workflow* → channel `next`), or:

```sh
gh workflow run release.yml -f channel=next
```

Confirm `latest` did not move:

```sh
npm view opencode-profile-switcher dist-tags
```

## Step 2 — launch a sandboxed opencode2

```sh
scripts/verify-v2.sh
```

You do not need to install anything first — the script installs `opencode2`
into the sandbox, not onto your PATH.

**The isolation is mandatory, not a nicety.** `opencode2` reads the *same*
config and data directories as 1.x (`~/.config/opencode` and
`~/.local/share/opencode`) — verified with `strings` on the binary, which
contains no `opencode2`-specific paths. The data dir holds the session
database. Letting a preview build migrate it is not reversible. The script
redirects `XDG_CONFIG_HOME` and `XDG_DATA_HOME` into the sandbox; this was
confirmed empirically by watching `opencode2` create its tree there instead.

Two details the script handles that are easy to get wrong by hand:

- `bun add --trust` is required. The real binary arrives via an
  `optionalDependency` selected by a postinstall script; without `--trust` you
  get a stub that exits silently.
- `--standalone` is passed. By default v2 talks to a shared **background
  service** that would outlive the sandbox and could be reused by another
  invocation running different config.

Useful variants:

```sh
scripts/verify-v2.sh --plugin 0.1.8-next.0     # pin an exact plugin build
scripts/verify-v2.sh --opencode 0.0.0-next-17074 # pin an exact opencode2 build
scripts/verify-v2.sh --setup-only               # prepare without launching
```

## Step 3 — the checklist

One row per API surface the plugin depends on. Run them in order; each assumes
the previous one passed.

| # | Surface | Check | Pass condition |
|---|---------|-------|----------------|
| 1 | `./tui` export + slash command registration | Type `/profile` | The command exists. If it is unknown, the TUI target did not load — everything below is moot. Suspect the two-file registration (`opencode.json` + `tui.json`), which is carried over from 1.x and unconfirmed for v2. |
| 2 | Setup wizard | First run, with no `profiles.json` in the sandbox | The wizard offers agent placements, then real models from your connected providers. |
| 3 | Hook `config` | Finish the wizard, quit, relaunch | The profile you created is still active — the hook re-applied it at boot. |
| 4 | `client.instance.dispose()` (live switch) | Create a second profile, then switch to it from the picker | Models change **without restarting**, and open sessions survive. **This is the one most likely to break** — see the open risk above. If it fails, stop and report; the rest is cosmetic by comparison. |
| 5 | `api.slots.register` (indicator) | Look to the right of the prompt, on home and in a session | `nombre · modelo-corto-heavy` is rendered. |
| 6 | Indicator refresh | Switch profiles again, and resize the terminal | The indicator updates on the `server.instance.disposed` event and on resize, without a restart. Narrow terminal collapses to the name only. |

Known non-issue: if you manually pick a model in opencode's model picker, that
per-agent choice stays in TUI memory and outranks the profile after an
in-place re-bootstrap. Restart the TUI to clear it. This is documented
behaviour on 1.x, not a v2 regression.

## Step 4 — clean up

```sh
scripts/verify-v2.sh --clean
```

Deletes the sandbox, including the copied credentials.

## Step 5 — record the result

The `next` dist-tag of `@opencode-ai/cli` moves several times a day, so always
pin the exact version from the script's output when reporting anything.

- **If row 4 passes**, v2 support is largely a packaging question: decide
  whether to target the `v1` compat layer or migrate to the new
  `promise`/`effect` API, then widen `engines.opencode` in `package.json` and
  update `README.md` and `docs/README.opencode.md`.
- **If row 4 fails**, the live switch — the product's central concept — has no
  foundation on v2, and that is a design problem rather than a port. Open an
  issue with the exact `opencode2` version and take it to `/wayfinder`, not
  straight to implementation.
