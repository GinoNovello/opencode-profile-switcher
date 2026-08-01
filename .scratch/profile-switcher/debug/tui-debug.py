#!/usr/bin/env python3
import os, pty, time, select, tempfile, shutil, signal
BIN="/Users/ginonovello/.opencode/bin/opencode"
proj=tempfile.mkdtemp(); env=dict(os.environ); env["TERM"]="xterm-256color"
for k in ("OPENCODE_CONFIG_DIR","ORCA_OPENCODE_CONFIG_DIR"): env.pop(k,None)
pid,fd=pty.fork()
if pid==0:
    os.chdir(proj); os.execve(BIN,[BIN,"--print-logs","--log-level","DEBUG"],env)
buf=b""; t0=time.time()
try:
    while time.time()-t0<14:
        r,_,_=select.select([fd],[],[],0.5)
        if r:
            try: d=os.read(fd,65536)
            except OSError: break
            if not d: break
            buf+=d
finally:
    try: os.write(fd,b"\x03"); time.sleep(0.3); os.kill(pid,signal.SIGTERM)
    except Exception: pass
text=buf.decode("utf-8","replace")
import re
pats=("tui.plugin","tui plugin","opencode-profile-switcher","registerLayer","does not expose","tui entrypoint","profile-switcher","must default export")
sig=[l for l in text.splitlines() if any(p in l for p in pats)]
print("=== señales de plugin (debug) ===")
print("\n".join(sig[-40:]) if sig else "(nada)")
shutil.rmtree(proj,ignore_errors=True)
