# opencode-profile-switcher-v2

> **Experimental.** This is the OpenCode **2.x** build of
> [opencode-profile-switcher](https://github.com/GinoNovello/opencode-profile-switcher).
> For opencode 1.x, install `opencode-profile-switcher` instead.

Define **model profiles** — one model per capability tier, applied to every
agent at once — and switch between them live with `/profile`, without editing
config by hand or restarting.

## Install

Tested only against OpenCode **2.0.29**
([`docs/testing-v2.md`](https://github.com/GinoNovello/opencode-profile-switcher/blob/main/docs/testing-v2.md)).

**By package name (tested).** Add the package to `plugins` in
`~/.config/opencode/opencode.jsonc` (`"*"` keeps OpenCode's built-in plugins):

```jsonc
{
  "plugins": ["*", "opencode-profile-switcher-v2"]
}
```

To pin a version, use `"opencode-profile-switcher-v2@0.1.1"`. OpenCode
downloads the package from npm itself; there is nothing to `bun add` or
`npm install`. It installs it in the background the first time it opens a
project with this entry, so on that first start `/profile` can take a moment
to appear. It keeps the package in `$XDG_CACHE_HOME/opencode/npm/<spec>/`
(`~/.cache/opencode/npm/<spec>/` when `XDG_CACHE_HOME` is not set), where
`<spec>` is the `plugins` entry; the bare name is stored as
`opencode-profile-switcher-v2@latest`. The smoke harness checks both forms
against OpenCode 2.0.29 when `SMOKE_V2_NPM` is set; what it asserts and what
was checked by hand is in
[`docs/testing-v2.md`](https://github.com/GinoNovello/opencode-profile-switcher/blob/main/docs/testing-v2.md#loading-the-published-package-by-name-opt-in).

**From a local build (tested).** This is the same way of loading the plugin
(`plugins` pointing at a local `dist`) that the smoke harness verifies in its
own sandbox:

```sh
git clone https://github.com/GinoNovello/opencode-profile-switcher
cd opencode-profile-switcher
bun install
bun run build:v2
```

Then list the build's `dist` directory under `plugins`. OpenCode 2.0.29 expects
a local plugin to be a directory with `server.js` and `tui.js` at its root, so
point at `dist` itself, not the package root:

```jsonc
{
  "plugins": ["*", "/absolute/path/to/opencode-profile-switcher/packages/v2/dist"]
}
```

Restart OpenCode and run `/profile`. The first run starts a setup wizard.

With either form, that one `plugins` entry loads both the server and the TUI
half; no `tui.json` or `cli.json` entry is needed. The harness checks
`/profile` and its picker with either form; the footer indicator is a manual
check. For the local build, also listing it in `cli.json` does not register
`/profile` twice.

## Where `profiles.json` lives

v2 reads `$OPENCODE_CONFIG_DIR/profiles.json` when `OPENCODE_CONFIG_DIR` is set.
Otherwise it uses `$XDG_CONFIG_HOME/opencode/profiles.json`, or
`~/.config/opencode/profiles.json` when `XDG_CONFIG_HOME` is not set. 1.x
follows the same rule but ignores `OPENCODE_CONFIG_DIR`, so with that variable
set the two packages read **different** files.

## More

How v2 differs from 1.x (your opencode config wins over the profile, a switch
reaches the focused session only, no `small_model`) and what is not verified
yet: [Differences in OpenCode 2.x](https://github.com/GinoNovello/opencode-profile-switcher#differences-in-opencode-2x)
in the repository README, and
[`docs/testing-v2.md`](https://github.com/GinoNovello/opencode-profile-switcher/blob/main/docs/testing-v2.md).

## License

MIT
