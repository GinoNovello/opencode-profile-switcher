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

opencode 1.x and 2.x have incompatible plugin APIs, so there are two packages
built from this repository ([ADR-0004](./docs/adr/0004-v2-se-publica-como-paquete-hermano.md)).
Install the one that matches your opencode version:

| opencode | Package | Status |
| --- | --- | --- |
| 1.x, >= 1.18.11 | `opencode-profile-switcher` | Stable, on npm |
| 2.x, >= 2.0.29 | `opencode-profile-switcher-v2` | **Experimental**, no npm release yet — see [opencode 2.x](#opencode-2x-experimental) |

### opencode 1.x

Install the plugin globally with opencode's plugin installer:

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

### opencode 2.x (experimental)

`opencode-profile-switcher-v2` lives in [`packages/v2`](./packages/v2). Its
install steps are in the package README,
[`packages/v2/README.md`](./packages/v2/README.md): a `plugins` entry in
`~/.config/opencode/opencode.jsonc`, either by package name (not verified) or
pointing at a local build's `dist` (the setup the
[v2 smoke harness](./docs/testing-v2.md) verifies, against opencode 2.0.29
only). There is no npm release of it yet.

v2 behaves differently from 1.x in a few places; see
[Differences in opencode 2.x](#differences-in-opencode-2x).

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

On opencode 1.x, switching a profile applies its models to `model`,
`small_model` and every agent, then reloads the running instance in place —
your open sessions survive and no manual restart is needed. opencode 2.x
switches differently (see [Differences in opencode 2.x](#differences-in-opencode-2x)).

> **TUI model overrides (1.x):** if you manually select a model in opencode's model
> picker, that per-agent choice stays in TUI memory and takes priority over the
> profile after an in-place re-bootstrap. Restart the TUI to clear the manual
> choice and use the active profile again. Switching works normally when no
> manual model choice is active.

## How a profile works

A **profile** owns one model per **tier**, its own agent **placements**, and a
direct model for every agent placed as **`specific`**. There are two tiers:

- **`heavy`** — reasoning / orchestration agents (and the global `model`).
- **`rest`** — everything else (and, on 1.x, the global `small_model`).

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

Profiles live in `~/.config/opencode/profiles.json` (under `$XDG_CONFIG_HOME`
when it is set). On opencode 2.x, `OPENCODE_CONFIG_DIR` takes precedence — see
[Where `profiles.json` lives](#where-profilesjson-lives). The wizard writes it
for you, but you can also edit it by hand:

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

## Differences in opencode 2.x

`opencode-profile-switcher-v2` shares its core with 1.x: the same profiles,
tiers, placements and `profiles.json` format, and the same picker and wizard
logic behind `/profile`. What changes:

### Where `profiles.json` lives

v2 reads `$OPENCODE_CONFIG_DIR/profiles.json` when `OPENCODE_CONFIG_DIR` is
set, because opencode 2.x reads its config from that directory. 1.x ignores the
variable and always uses `~/.config/opencode/profiles.json` (or
`$XDG_CONFIG_HOME/opencode/profiles.json`). With `OPENCODE_CONFIG_DIR` set, the
two packages therefore read **different files**: profiles created from one host
do not show up in the other. Without it, both use the same file.

### Your opencode config wins over the profile

In 2.x the host applies its agent config after plugins, so an agent whose
`model` is set in your global config, your repository config or a markdown
agent's frontmatter keeps that model ([ADR-0003](./docs/adr/0003-v2-config-del-usuario-gana-y-se-avisa.md)).
The profile is still applied to every other agent; the switch toast lists the
agents fixed by config and the indicator adds `· parcial` (partial). An `excluded`
placement only has an effect on agents that are not fixed by config. The same
goes for the default model: a `model` in your global or repository config beats
the profile's.

### A switch reaches the focused session only

In 2.x the model belongs to each session. `/profile` updates the agents (new
sessions and subagents) and switches the model of the session you are in; other
open sessions and tabs keep theirs, and the toast says so
([ADR-0005](./docs/adr/0005-v2-switch-en-vivo-alcanza-la-sesion-enfocada.md)).
Nothing is restarted.

### No `small_model`

opencode 2.x has no `small_model`. The `rest` tier is applied to its hidden
agents (`title`, `summary`, `compaction`) like to any other agent. `heavy` sets
the default model, but without its variant (the host's default model takes
none); the variant still reaches the agents placed as `heavy`.

### Other differences

- **Variants in `profiles.json`:** keep the variant in its own `variant` field.
  A slot written as `provider/model#variant` is not applied and is listed as
  invalid in the switch toast. opencode's own config and agent frontmatter use
  `provider/model#variant`, and v2 reads those as usual.
- **Variant the model does not offer:** if a profile gives an agent a variant
  that the model's catalog entry does not list, the slot is still applied as
  written, but prompts on that agent will fail. The switch toast is a warning
  (`Variant not offered, prompts will fail: …`) and the server log carries the
  same warning. An omitted or `default` variant, a model the catalog does not
  list, and an agent fixed by config are never reported.
- **Corrupt `profiles.json`:** models are left untouched and `/profile` shows an
  error toast; unlike 1.x, it does not offer to run the wizard. Fix or remove
  the file by hand.
- **Indicator:** shown in the prompt footer (`prompt.footer.status`) and
  refreshed after every switch.
- **Logs** go to the server's console (2.x has no plugin log API).

### Not verified yet

The [v2 smoke harness](./docs/testing-v2.md) runs against a real opencode
2.0.29 (boot, RPC switching, config precedence, exclusions across restarts,
`/profile` registration and the picker, a real turn before and after a switch,
`OPENCODE_CONFIG_DIR`). It does not cover, and these remain manual checks or
open questions:

- the wizard flow in the real TUI, the footer rendering and switching the
  focused session from the TUI;
- named reasoning variants other than the one the harness uses, and how a model
  picked with opencode's `/models` command interacts with a switch (the 1.x
  [TUI model override](#usage) caveat has not been checked on 2.x);
- installing the package by name from npm;
- opencode versions other than 2.0.29.

## Development

```sh
bun run typecheck
bun test
bun run test:smoke
bun run check          # typecheck, test and build both packages
bun run test:smoke:v2  # real opencode 2.0.29, see docs/testing-v2.md
```

The 1.x smoke test (`test:smoke`) requires opencode 1.x on `PATH` (opencode
2.0 does not serve the `/config` endpoint it checks). It builds and loads the
shipped server entrypoint in an isolated XDG sandbox, switches between fake profiles
(including an exclusion that preserves a prior effective model+variant),
restarts the process, and verifies `GET /config`, `GET /agent`, process
identity and session survival. It never uses your real opencode config,
credentials or providers.

The v2 smoke test (`test:smoke:v2`) installs opencode 2.0.29 into a temporary
sandbox instead of using the one on `PATH`, and also never touches your config,
credentials or background service. What it checks and what is left to manual
testing is described in [`docs/testing-v2.md`](./docs/testing-v2.md).

The TUI override caveat was source-verified against opencode 1.18.11: its local
model store gives a manual per-agent choice priority over refreshed agent/config
models, and the instance-disposed bootstrap refresh does not clear that local
store. It cannot be reproduced by the headless smoke test.

## Out of scope

Credentials / provider setup (opencode handles that via `/connect`) and
organization-level profiles.

## License

MIT — see [LICENSE](./LICENSE).
