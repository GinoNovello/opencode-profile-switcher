# opencode-profile-switcher — agent install guide

Self-contained install guide for
[`opencode-profile-switcher`](https://www.npmjs.com/package/opencode-profile-switcher).
An agent that fetches **only this file** has everything needed to install and
verify the plugin.

**What it does:** define **model profiles** (one model per capability tier,
applied to every agent at once) and **switch them live from the UI** without
hand-editing config or restarting for each switch.

| | |
| --- | --- |
| **Package** | `opencode-profile-switcher` (npm) |
| **Requires** | [opencode](https://opencode.ai) **1.x, >= 1.18.11** (for opencode 2.x see [below](#opencode-2x-experimental)) |
| **Repo** | https://github.com/GinoNovello/opencode-profile-switcher |
| **License** | MIT |

**Prerequisite:** at least one LLM provider connected (`/connect`) so the setup
wizard can offer real models.

**Check the opencode version first** (`opencode --version`). 1.x and 2.x need
different packages, and each one is incompatible with the other host:

| opencode | Package | Follow |
| --- | --- | --- |
| 1.x, >= 1.18.11 | `opencode-profile-switcher` | [Preferred installation](#preferred-installation) below |
| 2.x, >= 2.0.29 | `opencode-profile-switcher-v2` (**experimental**) | [opencode 2.x](#opencode-2x-experimental) |

## Preferred installation

```sh
opencode plugin opencode-profile-switcher --global
```

The installer detects the package's `./server` and `./tui` exports and registers
**both** targets.

**Quit and restart opencode**, then verify:

```text
/profile
```

- First time (no profiles) → setup wizard.
- After that → fuzzy picker to switch or manage profiles.

If `/profile` is unknown, the TUI target is not registered (see Troubleshooting).

## Manual installation (fallback)

Only if the preferred installer is unavailable. Add the package to **both**
global config files, then restart.

**1. Server** — `~/.config/opencode/opencode.json` (or `opencode.jsonc`):

```jsonc
{
  "plugin": ["opencode-profile-switcher"]
}
```

Merge into any existing `plugin` array; do not replace other plugins.

**2. TUI** — `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-profile-switcher"]
}
```

**3.** Quit and restart opencode, then run `/profile`.

## opencode 2.x (experimental)

The 2.x package is `opencode-profile-switcher-v2`, built from
[`packages/v2`](https://github.com/GinoNovello/opencode-profile-switcher/tree/main/packages/v2).
It has no npm release yet. **Fetch and follow its own README for the
install steps:**
[`packages/v2/README.md`](https://github.com/GinoNovello/opencode-profile-switcher/blob/main/packages/v2/README.md)
([raw](https://raw.githubusercontent.com/GinoNovello/opencode-profile-switcher/main/packages/v2/README.md)).
In short: one `plugins` entry in `~/.config/opencode/opencode.jsonc`, either by
package name (not verified) or pointing at a local build's `dist` (verified by
the smoke harness, against opencode 2.0.29 only). The 1.x steps above are for
1.x only.

**`profiles.json` on 2.x:** `$OPENCODE_CONFIG_DIR/profiles.json` when
`OPENCODE_CONFIG_DIR` is set, otherwise the same path as 1.x. The 1.x package
ignores `OPENCODE_CONFIG_DIR`, so with that variable set the two packages read
**different** files.

**Differs from 1.x** (details in the
[human README](https://github.com/GinoNovello/opencode-profile-switcher#differences-in-opencode-2x)):

- A `model` set in the user's opencode config (global, repository, or a
  markdown agent's frontmatter) wins over the profile; the switch toast lists
  those agents and the indicator shows `· parcial` (partial). `excluded` has
  no effect on them.
- A switch updates the agents and the **focused session** only; other open
  sessions keep their model.
- No `small_model`: `rest` goes to the hidden agents (`title`, `summary`,
  `compaction`). The default model follows `heavy` without its variant.
- `provider/model#variant` inside `profiles.json` is invalid and not applied;
  use the separate `variant` field.
- A variant the model's catalog entry does not offer is still applied, but
  prompts on that agent will fail; the switch toast warns
  (`Variant not offered, prompts will fail: …`) and so does the server log.
- A corrupt `profiles.json` shows an error toast; `/profile` does not offer the
  wizard.

**Not verified on 2.x:** the wizard flow in the real TUI, footer rendering and
focused-session switch from the TUI are manual checks; so are named variants
beyond the harness's, interaction with `/models`, install by package name, and
versions other than 2.0.29
([`docs/testing-v2.md`](https://github.com/GinoNovello/opencode-profile-switcher/blob/main/docs/testing-v2.md)).

## Anti-patterns (do not)

| Wrong | Why it fails |
| --- | --- |
| `bun add opencode-profile-switcher` alone | Does not register either entrypoint with opencode |
| Package only in `opencode.json` | Config hook loads; **`/profile` does not** |
| Skip restart after install | Running sessions keep already-loaded config |
| `git+https://…` install specs | Unsupported; use the npm package name |
| `opencode-profile-switcher` on opencode 2.x | The 1.x package is incompatible with 2.x; use `opencode-profile-switcher-v2` |

## Minimal usage

1. Run **`/profile`**.
2. **First time:** accept or tweak default agent→tier assignment (primary →
   `heavy`, else → `rest`), name a profile, pick a model per tier.
3. **Later:** pick a profile to switch live, or **＋ New profile** /
   **⚙ Configure…**.

On 1.x, a switch applies models to `model`, `small_model`, and every assigned
agent, then reloads in place — sessions survive; no restart needed for the
switch itself. (2.x: see [opencode 2.x](#opencode-2x-experimental).)

**TUI caveat (1.x):** a model chosen manually in opencode's model picker is kept in
TUI memory per agent and has priority over the profile after an in-place
re-bootstrap. If a manual choice is masking the active profile, restart the TUI
to clear it.

## How it works (short)

**Tiers:** `heavy` (reasoning/orchestration + global `model`) and `rest`
(everything else + global `small_model` on 1.x).

**Placements** belong to each profile: an agent is `heavy`, `rest`, `specific`
(a direct model) or `excluded` (a switch never touches it). The same agent can
be placed differently in each profile. Agents absent from the active profile
fall back to `rest`.

**On disk:** `~/.config/opencode/profiles.json` (wizard writes it; on 2.x,
`$OPENCODE_CONFIG_DIR/profiles.json` when that is set):

```json
{
  "profiles": {
    "xai": {
      "heavy": { "model": "xai/grok-4.5", "variant": "high" },
      "rest": { "model": "xai/grok-4.20-0309-non-reasoning" },
      "placements": { "build": "heavy", "explore": "rest", "docs": "specific", "vision": "excluded" },
      "specifics": { "docs": { "model": "anthropic/claude-sonnet-4", "variant": "high" } }
    }
  },
  "active": "xai",
  "effective": { "build": { "model": "xai/grok-4.5", "variant": "high" } }
}
```

- `variant` is optional on the `heavy` and `specific` slots.
- `active` is re-applied on every start via the server `config` hook.
- `effective` records the last model the plugin applied per agent, so `excluded`
  agents keep it across switches and restarts.
- Corrupt `profiles.json` never breaks startup; `/profile` can offer the wizard.

**Upgrading from 0.1.2:** files with the old top-level `assignment` and
`exclusions` are migrated automatically on read — both are copied into every
existing profile's `placements`, keeping profile names, models, variants and the
active profile. No `specific` placements are created. Reading never rewrites the
file by itself — the current format lands on the next successful save, normally
the first start after upgrading.

| Export | Config | Role |
| --- | --- | --- |
| `./server` | `opencode.json` / `.jsonc` | Apply active profile on boot |
| `./tui` | `tui.json` | Register `/profile` |

Both targets are required for full functionality on 1.x (on 2.x the single
`plugins` entry covers both).

## Updating

1.x:

```sh
opencode plugin opencode-profile-switcher --global
```

Restart opencode after updating. Keep both config entries pointing at
`opencode-profile-switcher` if you manage them manually.

2.x: see the [package README](https://github.com/GinoNovello/opencode-profile-switcher/blob/main/packages/v2/README.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/profile` not found | List plugin in `tui.json`; restart |
| Models not applied on start | List plugin in `opencode.json`; check `active` in `profiles.json` |
| Wizard has no models | `/connect` a provider |
| Switch saved but not live | Restart opencode (live reload may have failed) |
| Active profile is not the displayed model | Restart the TUI to clear a manual model choice |
| Unknown model / provider | Switch still applies and warns; `/connect` |
| Corrupt `profiles.json` | `/profile` offers wizard (overwrites file); on 2.x it shows an error, fix the file by hand |
| 2.x: profiles missing or different from 1.x | `OPENCODE_CONFIG_DIR` is set; 2.x reads `profiles.json` from there |
| 2.x: an agent ignores the profile | Its `model` is set in opencode config or frontmatter (indicator shows `· parcial`) |
| 2.x: other tabs kept the old model | Expected; only the focused session switches |
| 2.x: toast `Variant not offered, prompts will fail` | Pick a variant the model offers (or none) for that slot and switch again |

## Help

- Human README: https://github.com/GinoNovello/opencode-profile-switcher
- Issues: https://github.com/GinoNovello/opencode-profile-switcher/issues
- OpenCode docs: https://opencode.ai/docs/
- This file (raw): https://raw.githubusercontent.com/GinoNovello/opencode-profile-switcher/main/docs/README.opencode.md
