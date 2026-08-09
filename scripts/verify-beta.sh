#!/usr/bin/env bash
#
# Launch a throwaway opencode instance — by default the `beta` build, the one
# people mean when they say "opencode v2" — with a published build of this
# plugin installed, so the TUI half can be exercised for real.
#
# Why this exists: opencode only loads a plugin's `./tui` export from a
# published npm package, so `/profile`, the wizard and the profile indicator
# cannot be tested from a local checkout. See docs/verify-runtime.md.
#
# Everything lives in a sandbox directory. The real config (~/.config/opencode)
# and the real data dir (~/.local/share/opencode, which holds the session DB)
# are never written to.
#
# Usage:
#   scripts/verify-beta.sh                     # opencode@beta + plugin@next
#   scripts/verify-beta.sh --plugin 0.1.8-next.0
#   scripts/verify-beta.sh --opencode 1.18.15  # compare against stable
#   scripts/verify-beta.sh --setup-only        # build the sandbox, don't launch
#   scripts/verify-beta.sh --clean             # delete the sandbox and exit

set -euo pipefail

OPENCODE_VERSION="beta"
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
REAL_AUTH="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json"

mkdir -p "$CONFIG_DIR" "$DATA_DIR/opencode"

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
  echo "         no providers will be connected; run /connect inside the sandbox." >&2
fi

# Pin the plugin by installing it into the sandbox config dir. opencode
# resolves plugins from this directory's node_modules, so the bare name in the
# config files below picks up exactly what we install here.
cat > "$CONFIG_DIR/package.json" <<'JSON'
{
  "dependencies": {}
}
JSON

echo "installing opencode-profile-switcher@$PLUGIN_VERSION ..."
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
cat > "$CONFIG_DIR/tui.json" <<'JSON'
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-profile-switcher"]
}
JSON

echo
echo "sandbox:  $SANDBOX"
echo "plugin:   opencode-profile-switcher@$RESOLVED"
echo "opencode: opencode-ai@$OPENCODE_VERSION"
echo
echo "Run through the checklist in docs/verify-runtime.md."
echo "When you are done: scripts/verify-beta.sh --clean"
echo

if [ "$SETUP_ONLY" = "1" ]; then
  echo "--setup-only: sandbox ready, not launching opencode."
  echo "Launch it yourself with:"
  echo "  XDG_CONFIG_HOME=$SANDBOX/config XDG_DATA_HOME=$DATA_DIR bunx opencode-ai@$OPENCODE_VERSION"
  exit 0
fi

XDG_CONFIG_HOME="$SANDBOX/config" \
XDG_DATA_HOME="$DATA_DIR" \
  exec bunx "opencode-ai@$OPENCODE_VERSION"
