#!/usr/bin/env bash
# THROWAWAY PROTOTYPE HARNESS — profile-switcher ticket #14
# Validates "persistir + dispose": live model switch in opencode WITHOUT restarting
# the process. Fully isolated from the user's real ~/.config/opencode and
# ~/.local/share/opencode via XDG_* overrides into a throwaway sandbox.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/oc-proto-XXXXXX")"
PORT=45711
BASE="http://127.0.0.1:${PORT}"

# --- Fully isolated environment (NEVER touches the user's real config/state) ---
export XDG_CONFIG_HOME="$SANDBOX/config"   # -> global config becomes $XDG_CONFIG_HOME/opencode
export XDG_DATA_HOME="$SANDBOX/data"        # -> DB, auth, sessions
export XDG_STATE_HOME="$SANDBOX/state"
export OPENCODE_DISABLE_PROJECT_CONFIG=1    # ignore any project .opencode
export PROTO_STATE_FILE="$SANDBOX/active-profile"   # the "persisted" profile

CFGDIR="$XDG_CONFIG_HOME/opencode"
PROJDIR="$SANDBOX/project"
mkdir -p "$CFGDIR/plugins" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$PROJDIR"

# Base config with a SEED model that the plugin must override (proves the hook runs).
cat > "$CFGDIR/opencode.json" <<'JSON'
{ "$schema": "https://opencode.ai/config.json", "model": "SEED/should-be-overridden" }
JSON
cp "$HERE/plugin.ts" "$CFGDIR/plugins/proto.ts"

# Seed the persisted profile = A
echo "A" > "$PROTO_STATE_FILE"

LOG="$SANDBOX/serve.log"
echo "sandbox : $SANDBOX"
echo "config  : $CFGDIR"
echo

# --- Start headless server ---
( cd "$PROJDIR" && exec opencode serve --port "$PORT" --hostname 127.0.0.1 --print-logs ) \
  >"$LOG" 2>&1 &
SERVE_PID=$!
echo "serve PID (start): $SERVE_PID"

cleanup() { kill "$SERVE_PID" 2>/dev/null; wait "$SERVE_PID" 2>/dev/null; }
trap cleanup EXIT

# Wait until the server answers.
for i in $(seq 1 60); do
  curl -sf "$BASE/config" >/dev/null 2>&1 && break
  kill -0 "$SERVE_PID" 2>/dev/null || { echo "server died early; log:"; cat "$LOG"; exit 1; }
  sleep 0.5
done

model()  { curl -sf "$BASE/config" | jq -r '.model'; }
small()  { curl -sf "$BASE/config" | jq -r '.small_model'; }
agentm() { curl -sf "$BASE/agent" | jq -rc "[.[] | select(.name==\"$1\") | .model] | .[0]"; }

echo
echo "=== PROBE 1: profile A active ==="
echo "config.model       = $(model)"
echo "config.small_model = $(small)"
echo "agent[build].model = $(agentm build)"
echo "agent[plan].model  = $(agentm plan)"

echo
echo "=== create a session BEFORE the switch (to prove sessions survive) ==="
SID=$(curl -sf -X POST "$BASE/session" -H 'Content-Type: application/json' \
        -d '{"title":"proto-survives-dispose"}' | jq -r '.id')
echo "created session id = $SID"

echo
echo "=== SWITCH: persist profile B, then POST /instance/dispose ==="
echo "B" > "$PROTO_STATE_FILE"
DISP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/instance/dispose")
echo "POST /instance/dispose -> HTTP $DISP"

# Next request re-boots the instance and re-runs the config hook. Poll until it flips.
echo "waiting for re-bootstrap..."
START=$(python3 -c 'import time;print(time.time())')
NEWMODEL=""
for i in $(seq 1 60); do
  NEWMODEL="$(model)"
  [ "$NEWMODEL" = "beta-provider/beta-heavy" ] && break
  sleep 0.25
done
END=$(python3 -c 'import time;print(time.time())')
LAT=$(python3 -c "print(f'{($END-$START)*1000:.0f} ms')")

echo
echo "=== PROBE 2: after dispose (NO restart) ==="
echo "config.model       = $(model)"
echo "config.small_model = $(small)"
echo "agent[build].model = $(agentm build)"
echo "agent[plan].model  = $(agentm plan)"
echo "re-bootstrap latency (first flipped read): $LAT"

echo
echo "=== PROCESS IDENTITY ==="
if kill -0 "$SERVE_PID" 2>/dev/null; then
  echo "serve PID still alive: $SERVE_PID"
  ps -p "$SERVE_PID" -o pid=,etime=,command= | sed 's/^/  /'
else
  echo "serve PID $SERVE_PID is DEAD (unexpected)"
fi

echo
echo "=== SESSION SURVIVAL (created pre-dispose, checked post-dispose) ==="
if [ -n "${SID:-}" ] && [ "$SID" != "null" ]; then
  FOUND=$(curl -sf "$BASE/session" | jq -r --arg id "$SID" '[.[]|select(.id==$id)]|length')
  echo "session $SID present after dispose? count=$FOUND"
fi

echo
echo "=== plugin boot log lines (proves hook re-ran) ==="
grep -i "BOOT profile" "$LOG" | sed 's/^/  /' || echo "  (none found)"

echo
echo "sandbox left at: $SANDBOX (delete when done)"
