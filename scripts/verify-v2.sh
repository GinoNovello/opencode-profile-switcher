#!/usr/bin/env bash
#
# ############################################################################
# DO NOT RUN. Three known defects, found in review; see docs/verify-runtime.md.
#
#   1. `--plugin <version>` pins nothing. opencode2 builds its own npm project
#      under $XDG_CACHE_HOME/opencode/packages/<spec>/ and resolves the bare
#      name to `latest`, so this would test the published stable build while
#      printing the version it thinks it installed. A false pass.
#   2. Only 2 of the 4 XDG dirs are isolated. opencode2 also uses
#      XDG_CACHE_HOME and XDG_STATE_HOME, under the same directory names as
#      1.x, so a preview build would overwrite the real plugin cache and
#      service state.
#   3. `--clean` leaves the background service alive holding the copied
#      credentials, with the deleted sandbox files still open.
#
# The guard below stops execution. Fix 1-3 before removing it.
# ############################################################################
#
# Launch a throwaway OpenCode 2.0 preview (`opencode2`) with a published build
# of this plugin installed, so the TUI half can be exercised for real.
#
# Why this exists: opencode loads a plugin's `./tui` export only from a
# published npm package, so `/profile`, the wizard and the profile indicator
# cannot be tested from a local checkout. See docs/verify-runtime.md.
#
# v2 ships as a SEPARATE package with its own binary:
#   package: @opencode-ai/cli@next   binary: opencode2
# It does NOT replace the 1.x `opencode` binary, which keeps working.
#
# But v2 reads the SAME config and data directories as 1.x
# (~/.config/opencode and ~/.local/share/opencode, the latter holding the
# session database). Verified with `strings` on the binary, and empirically:
# pointing XDG_CONFIG_HOME/XDG_DATA_HOME at a sandbox makes opencode2 create
# its tree there instead. That is why this script isolates both — running
# opencode2 unsandboxed would let a preview build touch your real session DB.
#
# Usage:
#   scripts/verify-v2.sh                       # opencode2@next + plugin@next
#   scripts/verify-v2.sh --plugin 0.1.8-next.0
#   scripts/verify-v2.sh --opencode 0.0.0-next-17074
#   scripts/verify-v2.sh --setup-only          # build the sandbox, don't launch
#   scripts/verify-v2.sh --clean               # delete the sandbox and exit

set -euo pipefail

cat >&2 <<'GUARD'
verify-v2.sh is not safe to run yet — three known defects, see the header:
  1. --plugin pins nothing (would silently test the stable build)
  2. XDG_CACHE_HOME / XDG_STATE_HOME are not isolated (writes to real dirs)
  3. --clean leaves the background service alive with copied credentials
Remove this guard once they are fixed.
GUARD
exit 1

OPENCODE_VERSION="next"
PLUGIN_VERSION="next"
SANDBOX="${TMPDIR:-/tmp}/opencode-profile-switcher-verify"
SETUP_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --opencode)   OPENCODE_VERSION="$2"; shift 2 ;;
    --plugin)     PLUGIN_VERSION="$2";   shift 2 ;;
    --sandbox)    SANDBOX="$2";          shift 2 ;;
    --setup-only) SETUP_ONLY=1;          shift ;;
    --clean)      rm -rf "$SANDBOX"; echo "removed $SANDBOX"; exit 0 ;;
    -h|--help)    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

CONFIG_DIR="$SANDBOX/config/opencode"
DATA_DIR="$SANDBOX/data"
CLI_DIR="$SANDBOX/cli"
REAL_AUTH="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json"

mkdir -p "$CONFIG_DIR" "$DATA_DIR/opencode" "$CLI_DIR"

# The setup wizard only offers models from providers that are actually
# connected, and credentials live in the data dir we just isolated. Copy the
# auth file in so the wizard has something to work with; the sandbox is
# deleted with --clean when you are done.
if [ -f "$REAL_AUTH" ]; then
  cp "$REAL_AUTH" "$DATA_DIR/opencode/auth.json"
  chmod 600 "$DATA_DIR/opencode/auth.json"
  echo "copied provider credentials into the sandbox"
else
  echo "WARNING: no auth.json found at $REAL_AUTH" >&2
  echo "         no providers will be connected; log in inside the sandbox." >&2
fi

# Install opencode2 into the sandbox rather than globally, so it never lands on
# your PATH. --trust is required: the real binary arrives through an
# optionalDependency picked by a postinstall script, and without it you get a
# stub that exits 1 with "postinstall script was not run".
echo "installing @opencode-ai/cli@$OPENCODE_VERSION ..."
echo '{"dependencies":{}}' > "$CLI_DIR/package.json"
(cd "$CLI_DIR" && bun add --trust "@opencode-ai/cli@$OPENCODE_VERSION" --silent)
OPENCODE_BIN="$CLI_DIR/node_modules/.bin/opencode2"

if [ ! -x "$OPENCODE_BIN" ]; then
  echo "ERROR: opencode2 was not installed at $OPENCODE_BIN" >&2
  exit 1
fi

# Pin the plugin by installing it into the sandbox config dir. opencode
# resolves plugins from this directory's node_modules, so the bare name in the
# config files below picks up exactly what we install here.
echo "installing opencode-profile-switcher@$PLUGIN_VERSION ..."
echo '{"dependencies":{}}' > "$CONFIG_DIR/package.json"
(cd "$CONFIG_DIR" && bun add "opencode-profile-switcher@$PLUGIN_VERSION" --silent)

RESOLVED=$(cd "$CONFIG_DIR" && node -p \
  "require('./node_modules/opencode-profile-switcher/package.json').version")

# Server target.
cat > "$CONFIG_DIR/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-profile-switcher"]
}
JSON

# TUI target — this is the one that registers /profile and the indicator.
# NOTE: that v2 still splits plugin registration across these two files is
# carried over from 1.x and is NOT yet confirmed for v2. If /profile does not
# appear, suspect this first.
cat > "$CONFIG_DIR/tui.json" <<'JSON'
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-profile-switcher"]
}
JSON

echo
echo "sandbox:  $SANDBOX"
echo "plugin:   opencode-profile-switcher@$RESOLVED"
echo "opencode: $("$OPENCODE_BIN" --version 2>&1 | tail -1)"
echo
echo "Run through the checklist in docs/verify-runtime.md."
echo "When you are done: scripts/verify-v2.sh --clean"
echo

# --standalone gives this run a private server. By default v2 talks to a shared
# background service, which would outlive the sandbox and could be reused by
# another opencode2 invocation with different config.
if [ "$SETUP_ONLY" = "1" ]; then
  echo "--setup-only: sandbox ready, not launching opencode2."
  echo "Launch it yourself with:"
  echo "  XDG_CONFIG_HOME=$SANDBOX/config XDG_DATA_HOME=$DATA_DIR $OPENCODE_BIN --standalone"
  exit 0
fi

XDG_CONFIG_HOME="$SANDBOX/config" \
XDG_DATA_HOME="$DATA_DIR" \
  exec "$OPENCODE_BIN" --standalone
