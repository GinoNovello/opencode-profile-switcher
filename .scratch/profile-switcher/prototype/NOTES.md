# Prototype — ticket #14: live model switch (no opencode restart)

THROWAWAY prototype. Answers ONE question against opencode **v1.18.10**:

> Can an opencode plugin change the **effective model** (global `model`, `small_model`,
> and per-agent models) of a **running** server, **without restarting the process**?

Mechanism under test (research verdict "persistir + dispose"): the plugin's
`config(cfg)` hook applies the active profile on every boot; switching profile = persist
the new profile + `POST /instance/dispose`. Disposal re-creates the instance, which
re-reads config and re-runs the hook. Sessions live in the DB and survive.

## Success criteria (defined before running)

- (a) With profile **A** active, the effective model reported by the API is A.
- (b) The switch persists profile **B** and fires `POST /instance/dispose`.
- (c) WITHOUT killing the process, the effective model reported flips to **B**
      (global + agents), and the `serve` PID is unchanged.
- (+) A session created before the dispose still exists afterward.

## Files

- `plugin.ts` — test plugin. `config(cfg)` hook reads the active profile name from
  `$PROTO_STATE_FILE` and sets `cfg.model`, `cfg.small_model`, and `cfg.agent.{build,plan,general}.model`.
  It persists nothing itself; the harness writes the profile file (simulating the real
  plugin's persist step) and calls dispose. Profiles use fake model ids (`alpha-*`, `beta-*`)
  — we only observe which model is *effective*, we never call a provider, so no tokens spent.
- `run.sh` — one-command harness. **Fully isolated** from the user's real config/state via
  `XDG_CONFIG_HOME` + `XDG_DATA_HOME` + `XDG_STATE_HOME` pointing into a throwaway `mktemp -d`
  sandbox, plus `OPENCODE_DISABLE_PROJECT_CONFIG=1`. Never touches `~/.config/opencode` or
  `~/.local/share/opencode`. (Note: `OPENCODE_CONFIG_DIR` is *additive* over the real global
  config — issue #12607 workaround — so XDG overrides are used instead for true isolation.)
- `last-run.txt` — captured output of the run below.

## How to run

```
bash .scratch/profile-switcher/prototype/run.sh
```

Needs `opencode` (1.18.10), `curl`, `jq`, `python3` on PATH. Prints the sandbox path; it is
self-cleaning of the server process, delete the temp sandbox dir when done.

## Evidence (see last-run.txt)

Same server process throughout — `serve` PID **31492**, never restarted.

| Endpoint                 | Profile A (probe 1)          | After persist B + dispose (probe 2) |
|--------------------------|------------------------------|-------------------------------------|
| `GET /config` .model     | `alpha-provider/alpha-heavy` | `beta-provider/beta-heavy`          |
| `GET /config` .small_model | `alpha-provider/alpha-small` | `beta-provider/beta-small`        |
| `GET /agent` build.model | `alpha-provider/alpha-heavy` | `beta-provider/beta-heavy`          |
| `GET /agent` plan.model  | `alpha-provider/alpha-heavy` | `beta-provider/beta-heavy`          |

- `POST /instance/dispose` -> HTTP **200**.
- The `config` hook re-ran: two log lines in the SAME server run —
  `BOOT profile=A ...` then `BOOT profile=B ...`.
- Re-bootstrap latency (first request that read the flipped model): **~30 ms**.
- Session created pre-dispose (`ses_044d...`) present post-dispose: **count=1** (survived).
- Base config seeded `model: "SEED/should-be-overridden"` — never appeared, confirming the
  hook is what sets the effective model.

## Verdict

**VIABLE.** "Persistir + dispose" changes the live effective model (global, small, and
per-agent) with the process intact and sessions preserved. Plan B (`chat.message`) not needed.

## Caveats / surprises

- Re-boot is lazy: the instance is re-created on the *next request* after dispose, not eagerly.
  So the model flips on the first API call following the dispose (~30 ms here, cold provider
  catalog may add more on a real machine).
- Headless only was validated (`opencode serve` + HTTP). The TUI path (research §3) claims it
  re-bootstraps on the `server.instance.disposed` event, but that was NOT exercised here; the
  known TUI caveat — a manual in-session model pick lives in TUI memory and would survive the
  re-bootstrap, masking the new profile until the TUI is restarted — remains unverified.
- The plugin loaded from `$XDG_CONFIG_HOME/opencode/plugins/` with no `node_modules` present
  (the `import type` lines are erased at load), so no dependency install was needed.
