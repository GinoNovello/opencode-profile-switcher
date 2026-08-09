# Runtime verification against opencode `beta` ("v2")

Type-level compatibility with a new opencode build can be checked from a
checkout. Runtime behaviour cannot: opencode loads a plugin's `./tui` export
**only from a published npm package**, so `/profile`, the setup wizard and the
profile indicator never run in a local install. This document closes that gap.

## What "v2" means here

There is no `2.x` release of opencode. `latest` on npm is the `1.x` line; the
`v2`/`2.0` branches upstream are abandoned. The active development line is the
**`beta`** branch of `anomalyco/opencode`, published to the npm dist-tag
`beta` — that is what people mean by "opencode v2". See
`.scratch/profile-switcher/research/05-opencode-v2.md` for the full findings.

The `.d.ts` files of `@opencode-ai/plugin@beta` and `@opencode-ai/sdk@beta` are
byte-identical to the `1.18.10` ones this plugin builds against, so no source
change is expected. This procedure exists to confirm that at runtime, not to
fix a known break.

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

The run typechecks, tests, builds, bumps, tags, pushes and publishes. Confirm:

```sh
npm view opencode-profile-switcher dist-tags
```

`latest` must still be the previous stable version.

## Step 2 — launch a sandboxed opencode

```sh
scripts/verify-beta.sh
```

This builds a throwaway environment under `$TMPDIR` and launches
`opencode-ai@beta` against it:

- `XDG_CONFIG_HOME` and `XDG_DATA_HOME` are redirected into the sandbox, so
  your real `~/.config/opencode` and `~/.local/share/opencode` — including the
  session database — are never written to. **Do not skip this.** A beta build
  may migrate the session DB schema, and that is not reversible.
- Your provider credentials (`auth.json`) are **copied** into the sandbox so
  the wizard can offer real models. They are plain credentials in a temp
  directory; remove the sandbox when you are done.
- The plugin is installed from the `next` dist-tag and pinned, so the bare name
  in the config files resolves to exactly that build.

Useful variants:

```sh
scripts/verify-beta.sh --opencode 1.18.15   # same checklist against stable, as a control
scripts/verify-beta.sh --plugin 0.1.8-next.0 # pin an exact build
scripts/verify-beta.sh --setup-only          # prepare the sandbox without launching
```

## Step 3 — the checklist

One item per API surface the plugin depends on. Run them in order; each
assumes the previous one passed.

| # | Surface | Check | Pass condition |
|---|---------|-------|----------------|
| 1 | `./tui` export + slash command registration | Type `/profile` | The command exists. If it is unknown, the TUI target did not load — everything below is moot. |
| 2 | Setup wizard | First run, with no `profiles.json` in the sandbox | The wizard offers agent placements, then real models from your connected providers. |
| 3 | Hook `config` | Finish the wizard, quit, relaunch | The profile you created is still active — the hook re-applied it at boot. |
| 4 | `client.instance.dispose()` (live switch) | Create a second profile, then switch to it from the picker | Models change **without restarting**, and open sessions survive. This is the highest-risk item. |
| 5 | `api.slots.register` (indicator) | Look to the right of the prompt, on home and in a session | `nombre · modelo-corto-heavy` is rendered. |
| 6 | Indicator refresh | Switch profiles again, and resize the terminal | The indicator updates on the `server.instance.disposed` event and on resize, without a restart. Narrow terminal collapses to the name only. |

Known non-issue: if you manually pick a model in opencode's model picker, that
per-agent choice stays in TUI memory and outranks the profile after an
in-place re-bootstrap. Restart the TUI to clear it. This is documented
behaviour on `latest`, not a beta regression.

## Step 4 — clean up

```sh
scripts/verify-beta.sh --clean
```

This deletes the sandbox, including the copied credentials.

## Step 5 — record the result

If everything passes, widen the supported range in `package.json`
(`engines.opencode`) and say so in `README.md` and
`docs/README.opencode.md`. If something fails, open an issue with the checklist
row that broke and the opencode build you used — the `beta` dist-tag moves
daily, so pin the exact version from `bunx opencode-ai@beta --version`.
