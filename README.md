# opencode-profile-switcher

An [opencode](https://opencode.ai) plugin that lets you define **model profiles** —
one model per capability tier, applied to every agent at once — and **switch
between them live from the UI**, without editing config by hand or restarting.

Built for people who mix providers (e.g. xAI + GLM) and otherwise have to change
~14 model assignments by hand every time one provider runs out of usage.

## Install

> **Agents:** fetch and follow the self-contained install guide
> [`docs/README.opencode.md`](./docs/README.opencode.md)
> ([raw](https://raw.githubusercontent.com/GinoNovello/opencode-profile-switcher/main/docs/README.opencode.md)).
> It has everything needed to install and verify this plugin from a single Markdown file.

Requires **opencode >= 1.18.11**. Install the plugin globally with opencode's
plugin installer:

```sh
opencode plugin opencode-profile-switcher --global
```

The installer detects the package's `./server` and `./tui` exports and
registers the package for both targets. Restart opencode after installation,
then run `/profile`.

To configure the plugin manually, add it to both global config files. The
server target is configured in `~/.config/opencode/opencode.json` (or
`opencode.jsonc`):

```jsonc
{
  "plugin": ["opencode-profile-switcher"]
}
```

The TUI target is configured in `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-profile-switcher"]
}
```

Adding the package only to `opencode.json` loads the config hook but does not
register the `/profile` command. Installing it with `bun add` alone also does
not register either entrypoint with opencode.

## Usage

Run **`/profile`** in opencode:

- **First time** (no profiles yet) → a setup wizard runs: it proposes a default
  agent→tier assignment (primary agents to `heavy`, everything else to `rest`),
  which you can accept or tweak, then asks for a profile name and a model for each
  tier (from your connected providers).
- **After that** → `/profile` opens a fuzzy picker: pick a profile to switch to
  it live, or use **＋ New profile** / **⚙ Configure…** to manage them.

Switching a profile applies its models to `model`, `small_model` and every agent,
then reloads the running instance in place — your open sessions survive and no
manual restart is needed.

> **TUI model overrides:** if you manually select a model in opencode's model
> picker, that per-agent choice stays in TUI memory and takes priority over the
> profile after an in-place re-bootstrap. Restart the TUI to clear the manual
> choice and use the active profile again. Switching works normally when no
> manual model choice is active.

## How a profile works

A **profile** is one model per **tier**. There are two tiers:

- **`heavy`** — reasoning / orchestration agents (and the global `model`).
- **`rest`** — everything else (and the global `small_model`).

The **agent→tier assignment** is defined once and shared across all profiles, so
adding a new profile costs two choices (a heavy model and a rest model), not one
per agent. Agents can be **excluded** so the switch never touches them (e.g. a
vision agent that needs a specific multimodal model). An agent with no assignment
falls back to `rest`.

## Configuration

Profiles live in `~/.config/opencode/profiles.json`. The wizard writes it for you,
but you can also edit it by hand:

```json
{
  "assignment": {
    "build": "heavy",
    "plan": "heavy",
    "general": "heavy",
    "explore": "rest"
  },
  "exclusions": ["vision"],
  "profiles": {
    "xai": {
      "heavy": { "model": "xai/grok-4.5", "variant": "high" },
      "rest": { "model": "xai/grok-4.20-0309-non-reasoning" }
    },
    "glm": {
      "heavy": { "model": "zai-coding-plan/glm-5.2", "variant": "max" },
      "rest": { "model": "zai-coding-plan/glm-4.7" }
    }
  },
  "active": "xai"
}
```

- `assignment` — shared agent → tier (`heavy` | `rest`) map.
- `exclusions` — agents the switch never modifies.
- `profiles` — named profiles, each `{ heavy: { model, variant? }, rest: { model } }`.
  `variant` is an optional per-model variant (e.g. a reasoning-effort flavour) and
  applies to the `heavy` slot.
- `active` — the currently applied profile. The plugin re-applies it on every
  start.

If a profile references a model whose provider isn't connected, the switch still
applies and warns you (`/connect` to add the provider). A corrupt `profiles.json`
never breaks startup — `/profile` offers to run the wizard.

## Development

```sh
bun run typecheck
bun test
bun run test:smoke
```

The smoke test requires `opencode` on `PATH`. It builds and loads the shipped
server entrypoint in an isolated XDG sandbox, switches between fake profiles,
and verifies `GET /config`, `GET /agent`, process identity and session survival.
It never uses your real opencode config, credentials or providers.

The TUI override caveat was source-verified against opencode 1.18.11: its local
model store gives a manual per-agent choice priority over refreshed agent/config
models, and the instance-disposed bootstrap refresh does not clear that local
store. It cannot be reproduced by the headless smoke test.

## Out of scope

Credentials / provider setup (opencode handles that via `/connect`) and
organization-level profiles.

## License

MIT — see [LICENSE](./LICENSE).
