#!/usr/bin/env python3
# Boots the REAL opencode TUI with the user's REAL config/auth (so the plugin
# runtime actually runs) in a throwaway cwd, captures stdout+stderr from the pty,
# and extracts the [tui.plugin] runtime signal about our plugin. Read-only-ish:
# only boots + kills the TUI, same as the user does by hand.
import os, pty, time, select, tempfile, shutil, signal
BIN = "/Users/ginonovello/.opencode/bin/opencode"
proj = tempfile.mkdtemp()
env = dict(os.environ); env["TERM"] = "xterm-256color"
for k in ("OPENCODE_CONFIG_DIR","ORCA_OPENCODE_CONFIG_DIR"): env.pop(k, None)  # avoid Orca overlay
pid, fd = pty.fork()
if pid == 0:
    os.chdir(proj); os.execve(BIN, [BIN], env)
buf = b""; t0 = time.time()
try:
    while time.time() - t0 < 12:
        r,_,_ = select.select([fd], [], [], 0.5)
        if r:
            try: d = os.read(fd, 65536)
            except OSError: break
            if not d: break
            buf += d
finally:
    try: os.write(fd, b"\x03"); time.sleep(0.3); os.kill(pid, signal.SIGTERM)
    except Exception: pass
text = buf.decode("utf-8","replace")
sig = [l for l in text.splitlines() if "[tui.plugin]" in l or "profile-switcher" in l or "tui entrypoint" in l or "does not expose" in l]
print("=== [tui.plugin] / profile-switcher (real env) ===")
print("\n".join(sig[-30:]) if sig else "(nada capturado del runtime de tui plugin)")
print(f"\n(total bytes capturados: {len(buf)})")
shutil.rmtree(proj, ignore_errors=True)
