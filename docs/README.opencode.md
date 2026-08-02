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

## How it works (short)

**Tiers:** `heavy` (reasoning/orchestration + global `model`) and `rest`
(everything else + global `small_model`).

**Assignment** agent→tier is shared across all profiles. Unassigned agents fall
back to `rest`. **Exclusions** are never touched by a switch.

**On disk:** `~/.config/opencode/profiles.json` (wizard writes it):

```json
{
  "assignment": { "build": "heavy", "explore": "rest" },
  "exclusions": ["vision"],
  "profiles": {
    "xai": {
      "heavy": { "model": "xai/grok-4.5", "variant": "high" },
      "rest": { "model": "xai/grok-4.20-0309-non-reasoning" }
    }
  },
  "active": "xai"
}
```

- `variant` is optional on the `heavy` slot.
- `active` is re-applied on every start via the server `config` hook.
- Corrupt `profiles.json` never breaks startup; `/profile` can offer the wizard.

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
| Unknown model / provider | Switch still applies and warns; `/connect` |
| Corrupt `profiles.json` | `/profile` offers wizard (overwrites file) |

## Help

- Human README: https://github.com/GinoNovello/opencode-profile-switcher
- Issues: https://github.com/GinoNovello/opencode-profile-switcher/issues
- OpenCode docs: https://opencode.ai/docs/
- This file (raw): https://raw.githubusercontent.com/GinoNovello/opencode-profile-switcher/main/docs/README.opencode.md
