# roda um .caju compilado para nativo e mostra a memória máxima usada (Linux)
# Uso: python3 mem.py arquivo.caju
import os, subprocess, sys, tempfile, time
HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(tempfile.gettempdir(), 'caju-mem-bin')
subprocess.run(["node", "-e", """
const E=require(process.argv[3]);const fs=require('fs');
fs.writeFileSync(process.argv[2],E.compileNative([{name:'main.caju',src:fs.readFileSync(process.argv[1],'utf8')}]),{mode:0o755})""",
  sys.argv[1], BIN, os.path.join(HERE, '..', 'build', 'core.js')], check=True)
t = time.time()
p = subprocess.Popen([BIN], stdout=subprocess.PIPE, text=True)
out = p.stdout.read()
_, status, ru = os.wait4(p.pid, 0)
print(out.strip())
print(f"memória máxima: {ru.ru_maxrss / 1024:.1f} MB, tempo {time.time() - t:.2f} s, saída {os.waitstatus_to_exitcode(status)}")
