# Runtime verification against OpenCode 2.0 preview

> ## ⚠️ NOT USABLE YET — kept as the starting point for the v2 port
>
> **The checklist below cannot run.** It was written to answer "does this
> plugin still work on v2?", but the v2 migration guide answers that outright:
>
> > **"V1 plugins will not work in V2."**
> > — <https://opencode.ai/v2/docs/migrate-v1>
>
> The same page lists v2's three intentional breaking changes — a new plugin
> API, new server API contracts, and `tui.json` collapsing into a global
> `cli.json`. Those are precisely the three things this plugin is built on, so
> the checklist fails at row 1 and never reaches the rest.
>
> `scripts/verify-v2.sh` also has three defects found in review, and is
> guarded so it refuses to run. See its header.
>
> What survives, and why this file is still here: the sandbox approach is
> sound and will be needed to exercise a *ported* plugin. The `next` release
> channel it depends on is correct and verified. What has to change is the
> framing — this needs to become a **port map** (each API surface in `src/`
> against its v2 equivalent, or the absence of one), not a compatibility
> checklist.
>
> Findings so far: `.scratch/profile-switcher/research/06-opencode-v2-real.md`.

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
- There is a `v1/` directory whose `index.d.ts` is byte-identical to
  `1.18.10`'s, hook `config` included, and whose `tui.d.ts` still declares the
  `home_prompt_right` / `session_prompt_right` slots. **This is dead typing,
  not a compatibility layer** — v1 plugins do not run on v2. The new TUI API
  has a different `SlotMap` entirely (`app`, `home.footer`,
  `prompt.footer.end`, `session.composer.top`, `sidebar.content`,
  `sidebar.footer`); `prompt_right` has zero occurrences under `dist/tui/`.
- **`dispose` appears nowhere in `@opencode-ai/client@next`** — zero
  occurrences package-wide — and `@opencode-ai/schema@next` has no
  `server.instance.*` events. v2 replaced the `instance` concept with
  `location`. The nearest equivalent found is
  `client.debug.location.evict()`, which does perform the same full reboot but
  sits under a `debug` namespace and emits no event.
- The hook `config` has no v2 counterpart. v2 uses per-domain reactive
  transforms (`ctx.agent.transform`, `ctx.catalog.transform`), and
  `model` + `variant` fuse into `provider/model#variant`.

**The structural problem is bigger than any one of those.** v2's transforms are
only invocable inside the plugin server process, and there is no HTTP endpoint
for them — but this plugin is split across two processes, `./server` and
`./tui`, with the TUI half driving the switch. That split does not survive, so
v2 support is a redesign of the integration layer rather than a port.

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

**The isolation is mandatory, not a nicety.** `opencode2` uses the *same*
directory names as 1.x — confirmed in the v2 migration guide for config
(`~/.config/opencode/opencode.json(c)`) and by the binary's own XDG handling
for the rest. It touches **four** XDG dirs, not two:

| dir | what lives there |
| --- | --- |
| `XDG_CONFIG_HOME` | `opencode.json`, and in v2 `cli.json` (auto-migrated *from* `tui.json`, so v2 **writes** here) |
| `XDG_DATA_HOME` | the session database |
| `XDG_CACHE_HOME` | resolved plugin packages, under the bare plugin name |
| `XDG_STATE_HOME` | `service.json`, locks |

The script currently redirects only the first two — defect 2 in its header.
Any of the four is enough to do damage: a preview build migrating the session
DB is irreversible, and the plugin cache directory is named without a version,
so a v2 run overwrites the entry your 1.x install uses.

Two details the script handles that are easy to get wrong by hand:

- `bun add --trust` is required. The real binary arrives via an
  `optionalDependency` selected by a postinstall script; without `--trust` you
  get a stub that exits 1 with "postinstall script was not run".
- `--standalone` is passed. By default v2 talks to a shared **background
  service**. Note this is necessary but not sufficient — any `opencode2`
  invocation *without* it starts that service, and the first one to start it
  fixes the config for every later invocation, sandbox or not.

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

Deletes the sandbox directory — but **not** the background service, which
survives holding the copied credentials. That is defect 3 in the script header.

## Step 5 — record the result

The `next` dist-tag of `@opencode-ai/cli` moves several times a day, so always
pin the exact version from the script's output when reporting anything.

## What this file should become

The decision this checklist was meant to inform is already made: v2 support is
a redesign, not a port. So the useful successor is not a pass/fail run but a
**port map** — for each API surface `src/` depends on, its v2 equivalent or the
absence of one. The surfaces to cover, from a sweep of `src/`:

| surface | used in |
| --- | --- |
| hook `config`, mutating `model` / `small_model` / `agent[*].model` / `variant` | `src/config.ts`, `src/apply.ts` |
| `client.instance.dispose()` and `server.instance.disposed` | `src/switch.ts` |
| `api.slots.register` (`home_prompt_right`, `session_prompt_right`) | `src/tui.ts`, `src/indicator.ts` |
| `api.keymap.registerLayer` (the `/profile` command) | `src/tui.ts` |
| `api.ui.DialogSelect` / `DialogPrompt` / `DialogConfirm`, `api.ui.dialog.replace\|clear` | `src/tui.ts` |
| `api.lifecycle.onDispose` | `src/tui.ts` |
| `client.app.agents()` — the agent list the wizard offers | `src/agents.ts` |
| `client.app.log` | `src/server.ts` |
| two-file registration (`opencode.json` + `tui.json`) | install docs |
| `profiles.json` legacy migration | `src/legacy.ts`, `src/config.ts` |

The domain concepts most likely to need rework regardless of API shape are
**exclusiones**, **modelos específicos** and **variantes**, since v2 fuses
model and variant into one string.

Take that map to `/wayfinder`, not straight to implementation — the open
question is what this product *is* on v2 if live switching has no stable
primitive.
