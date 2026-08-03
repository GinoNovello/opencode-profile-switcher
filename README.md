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

- **First time** (no profiles yet) → a setup wizard runs: it proposes default
  agent placements (primary agents to `heavy`, everything else to `rest`), which
  you can accept or tweak, then asks for a profile name and a model for each tier
  (from your connected providers).
- **After that** → `/profile` opens a fuzzy picker: pick a profile to switch to
  it live, or use **＋ New profile** / **⚙ Configure…** to manage them. Creating a
  new profile copies the active profile's placements (including `specific`
  designations) but asks for fresh `heavy`/`rest` models and fresh direct models
  for every `specific` agent.

Switching a profile applies its models to `model`, `small_model` and every agent,
then reloads the running instance in place — your open sessions survive and no
manual restart is needed.

> **TUI model overrides:** if you manually select a model in opencode's model
> picker, that per-agent choice stays in TUI memory and takes priority over the
> profile after an in-place re-bootstrap. Restart the TUI to clear the manual
> choice and use the active profile again. Switching works normally when no
> manual model choice is active.

## How a profile works

A **profile** owns one model per **tier**, its own agent **placements**, and a
direct model for every agent placed as **`specific`**. There are two tiers:

- **`heavy`** — reasoning / orchestration agents (and the global `model`).
- **`rest`** — everything else (and the global `small_model`).

Each profile places every agent in `heavy`, `rest`, **`specific`**, or
**`excluded`**:

- **`specific`** — the agent gets a direct model (and optional variant) from the
  profile's `specifics` map, without going through a tier.
- **`excluded`** — the agent keeps its last **effective** model and variant (the
  ones the plugin last applied, even from another profile). If the plugin has
  never applied a model to that agent, its original opencode config is left
  untouched. Effective state is persisted in `profiles.json` and survives
  restarts.

Placements belong to the profile, so the same agent can be `heavy` in one
profile, `specific` in another and `excluded` in a third. An agent absent from
the active profile's placements falls back to `rest` and is reported.

## Configuration

Profiles live in `~/.config/opencode/profiles.json`. The wizard writes it for you,
but you can also edit it by hand:

```json
{
  "profiles": {
    "xai": {
      "heavy": { "model": "xai/grok-4.5", "variant": "high" },
      "rest": { "model": "xai/grok-4.20-0309-non-reasoning" },
      "placements": {
        "build": "heavy",
        "plan": "heavy",
        "explore": "rest",
        "docs": "specific",
        "vision": "excluded"
      },
      "specifics": { "docs": { "model": "anthropic/claude-sonnet-4", "variant": "high" } }
    },
    "glm": {
      "heavy": { "model": "zai-coding-plan/glm-5.2", "variant": "max" },
      "rest": { "model": "zai-coding-plan/glm-4.7" },
      "placements": { "build": "heavy", "explore": "rest", "vision": "excluded" },
      "specifics": {}
    }
  },
  "active": "xai",
  "effective": {
    "build": { "model": "xai/grok-4.5", "variant": "high" },
    "explore": { "model": "xai/grok-4.20-0309-non-reasoning" },
    "docs": { "model": "anthropic/claude-sonnet-4", "variant": "high" }
  }
}
```

- `profiles` — named profiles, each
  `{ heavy: { model, variant? }, rest: { model }, placements, specifics }`.
  `variant` is an optional per-model variant (e.g. a reasoning-effort flavour).
- `placements` — this profile's agent → placement
  (`heavy` | `rest` | `specific` | `excluded`) map. Owned by the profile, so it
  can differ between profiles.
- `specifics` — direct `{ model, variant? }` slots for every agent placed as
  `specific`. Every `specific` placement must have a non-empty model; orphan
  slots (without a matching placement) are invalid.
- `active` — the currently applied profile. The plugin re-applies it on every
  start.
- `effective` — last model and optional variant the plugin applied to each
  agent. Written automatically on apply; used when a profile places an agent as
  `excluded`. Hand-editing is rarely needed.

If a profile references a model whose provider isn't connected, the switch still
applies and warns you (`/connect` to add the provider). A corrupt `profiles.json`
never breaks startup — `/profile` offers to run the wizard.

### Upgrading from 0.1.2

`0.1.2` kept a single top-level `assignment` and `exclusions` pair shared by all
profiles. Those files are migrated automatically on read: the shared assignment
and exclusions are copied into every existing profile's `placements`, and your
profile names, `heavy`/`rest` models, variants and `active` profile are kept as
they were. Migration adds no `specific` placements and invents no `effective`
state, so nothing changes model until you edit a profile.

The upgrade needs no manual step. Reading never rewrites the file by itself; the
current format is persisted by the next successful save, which in practice is
the first start after upgrading (applying the active profile records `effective`
state). A `0.1.2` file that fails validation is reported as corrupt and left
untouched, exactly like any other invalid `profiles.json`.

## Development

```sh
bun run typecheck
bun test
bun run test:smoke
```

The smoke test requires `opencode` on `PATH`. It builds and loads the shipped
server entrypoint in an isolated XDG sandbox, switches between fake profiles
(including an exclusion that preserves a prior effective model+variant),
restarts the process, and verifies `GET /config`, `GET /agent`, process
identity and session survival. It never uses your real opencode config,
credentials or providers.

The TUI override caveat was source-verified against opencode 1.18.11: its local
model store gives a manual per-agent choice priority over refreshed agent/config
models, and the instance-disposed bootstrap refresh does not clear that local
store. It cannot be reproduced by the headless smoke test.

## Out of scope

Credentials / provider setup (opencode handles that via `/connect`) and
organization-level profiles.

## License

MIT — see [LICENSE](./LICENSE).
