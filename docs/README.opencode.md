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
| **Requires** | [opencode](https://opencode.ai) **>= 1.18.11** |
| **Repo** | https://github.com/GinoNovello/opencode-profile-switcher |
| **License** | MIT |

**Prerequisite:** at least one LLM provider connected (`/connect`) so the setup
wizard can offer real models.

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

## Anti-patterns (do not)

| Wrong | Why it fails |
| --- | --- |
| `bun add opencode-profile-switcher` alone | Does not register either entrypoint with opencode |
| Package only in `opencode.json` | Config hook loads; **`/profile` does not** |
| Skip restart after install | Running sessions keep already-loaded config |
| `git+https://…` install specs | Unsupported; use the npm package name |

## Minimal usage

1. Run **`/profile`**.
2. **First time:** accept or tweak default agent→tier assignment (primary →
   `heavy`, else → `rest`), name a profile, pick a model per tier.
3. **Later:** pick a profile to switch live, or **＋ New profile** /
   **⚙ Configure…**.

A switch applies models to `model`, `small_model`, and every assigned agent,
then reloads in place — sessions survive; no restart needed for the switch
itself.

**TUI caveat:** a model chosen manually in opencode's model picker is kept in
TUI memory per agent and has priority over the profile after an in-place
re-bootstrap. If a manual choice is masking the active profile, restart the TUI
to clear it.

## How it works (short)

**Tiers:** `heavy` (reasoning/orchestration + global `model`) and `rest`
(everything else + global `small_model`).

**Placements** belong to each profile: an agent is `heavy`, `rest`, `specific`
(a direct model) or `excluded` (a switch never touches it). The same agent can
be placed differently in each profile. Agents absent from the active profile
fall back to `rest`.

**On disk:** `~/.config/opencode/profiles.json` (wizard writes it):

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

Both targets are required for full functionality.

## Updating

```sh
opencode plugin opencode-profile-switcher --global
```

Restart opencode after updating. Keep both config entries pointing at
`opencode-profile-switcher` if you manage them manually.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/profile` not found | List plugin in `tui.json`; restart |
| Models not applied on start | List plugin in `opencode.json`; check `active` in `profiles.json` |
| Wizard has no models | `/connect` a provider |
| Switch saved but not live | Restart opencode (live reload may have failed) |
| Active profile is not the displayed model | Restart the TUI to clear a manual model choice |
| Unknown model / provider | Switch still applies and warns; `/connect` |
| Corrupt `profiles.json` | `/profile` offers wizard (overwrites file) |

## Help

- Human README: https://github.com/GinoNovello/opencode-profile-switcher
- Issues: https://github.com/GinoNovello/opencode-profile-switcher/issues
- OpenCode docs: https://opencode.ai/docs/
- This file (raw): https://raw.githubusercontent.com/GinoNovello/opencode-profile-switcher/main/docs/README.opencode.md
