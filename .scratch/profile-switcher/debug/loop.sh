#!/usr/bin/env bash
# Feedback loop for: opencode drops the profile-switcher plugin at load.
# Boots the REAL opencode binary headlessly (opencode run) in an isolated XDG
# sandbox with a given `plugin` array entry, then asserts on opencode's own log
# whether the plugin loaded. RED = "failed to load plugin"; GREEN = no such error.
# Usage: loop.sh '<json-entry>'   e.g. loop.sh '"/abs/dist/tui.js"'
set -u
ENTRY="${1:?pass a plugin array entry as JSON}"
SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT
export XDG_CONFIG_HOME="$SB/config" XDG_DATA_HOME="$SB/data" XDG_STATE_HOME="$SB/state" XDG_CACHE_HOME="$SB/cache"
unset OPENCODE_CONFIG_DIR ORCA_OPENCODE_CONFIG_DIR
mkdir -p "$XDG_CONFIG_HOME/opencode" "$SB/proj"
cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<JSON
{ "\$schema": "https://opencode.ai/config.json", "plugin": [ $ENTRY ] }
JSON
( cd "$SB/proj" && /Users/ginonovello/.opencode/bin/opencode run "hi" >/dev/null 2>&1 ) &
P=$!; sleep 8; kill "$P" 2>/dev/null; wait "$P" 2>/dev/null
LOG=$(find "$SB" -name "opencode.log" 2>/dev/null | head -1)
echo "--- plugin log lines ---"
grep -iE "load plugin|plugin.*(fail|error)|resolved plugin" "$LOG" 2>/dev/null | tail -10
if grep -qiE "failed to load plugin" "$LOG" 2>/dev/null; then echo "VERDICT: RED (plugin dropped)"; 
elif [ -z "$LOG" ]; then echo "VERDICT: INCONCLUSIVE (no log)"; 
else echo "VERDICT: GREEN (no load error)"; fi
