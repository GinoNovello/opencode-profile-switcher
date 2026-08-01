#!/usr/bin/env python3
# Boots the REAL opencode TUI headlessly in a pty, isolated XDG sandbox, captures
# stdout+stderr, and looks for the [tui.plugin] runtime signal about our plugin.
import os, pty, sys, time, select, tempfile, shutil, subprocess, json, signal

REPO = "/Users/ginonovello/workspace/repos/opencode-profile-switcher"
BIN = "/Users/ginonovello/.opencode/bin/opencode"
entry = sys.argv[1] if len(sys.argv) > 1 else f'"{REPO}/dist/server.js", "{REPO}/dist/tui.js"'

sb = tempfile.mkdtemp()
env = dict(os.environ)
for k in ("OPENCODE_CONFIG_DIR","ORCA_OPENCODE_CONFIG_DIR"): env.pop(k, None)
env.update(XDG_CONFIG_HOME=f"{sb}/config", XDG_DATA_HOME=f"{sb}/data",
           XDG_STATE_HOME=f"{sb}/state", XDG_CACHE_HOME=f"{sb}/cache", TERM="xterm-256color")
os.makedirs(f"{sb}/config/opencode"); os.makedirs(f"{sb}/proj")
json.dump({"$schema":"https://opencode.ai/config.json","plugin":json.loads("["+entry+"]")},
          open(f"{sb}/config/opencode/opencode.json","w"))

pid, fd = pty.fork()
if pid == 0:
    os.chdir(f"{sb}/proj")
    os.execve(BIN, [BIN], env)
buf = b""
t0 = time.time()
try:
    while time.time() - t0 < 10:
        r,_,_ = select.select([fd], [], [], 0.5)
        if r:
            try: data = os.read(fd, 65536)
            except OSError: break
            if not data: break
            buf += data
finally:
    try: os.write(fd, b"\x03"); time.sleep(0.3); os.kill(pid, signal.SIGTERM)
    except Exception: pass
    os.close(fd) if fd else None

text = buf.decode("utf-8","replace")
lines = [l for l in text.splitlines() if "[tui.plugin]" in l or "profile-switcher" in l or "tui entrypoint" in l or ("plugin" in l.lower() and ("fail" in l.lower() or "error" in l.lower()))]
print("=== señales [tui.plugin] / plugin del harness ===")
print("\n".join(lines[-25:]) if lines else "(ninguna línea de plugin capturada)")
# también revisá el log estructurado del sandbox
import glob
for lg in glob.glob(f"{sb}/data/opencode/log/*.log"):
    print("=== sandbox opencode.log (plugin) ===")
    for l in open(lg):
        if "plugin" in l.lower() and "duplicate skill" not in l: print(l.rstrip())
shutil.rmtree(sb, ignore_errors=True)
