# opencode-profile-switcher-v2

> **Experimental.** This is the OpenCode **2.x** build of
> [opencode-profile-switcher](https://github.com/GinoNovello/opencode-profile-switcher).
> For opencode 1.x, install `opencode-profile-switcher` instead.

Define **model profiles** — one model per capability tier, applied to every
agent at once — and switch between them live with `/profile`, without editing
config by hand or restarting.

## Install

Requires **OpenCode >= 2.0.29**. Add the package to `plugins` in your
`opencode.jsonc` (`"*"` keeps OpenCode's built-in plugins):

```jsonc
{
  "plugins": ["*", "opencode-profile-switcher-v2"]
}
```

Restart OpenCode and run `/profile`. The first run starts a setup wizard.

Profiles live in `profiles.json` inside `OPENCODE_CONFIG_DIR` when it is set,
and in `~/.config/opencode/` otherwise. The 1.x plugin always reads
`~/.config/opencode/`, so with `OPENCODE_CONFIG_DIR` set the two can read
different files.

Usage, profile format and known limitations are documented in the
[repository](https://github.com/GinoNovello/opencode-profile-switcher).

## License

MIT
