# Server on fixed cores (taskset), load generator on the others; reports req/s and server
# CPU microseconds per request (utime+stime of the server and its children, from /proc).
import subprocess, time, os, sys, re, urllib.request
B = os.path.dirname(os.path.abspath(__file__))
LOAD = B + "/load/load"
TICK = os.sysconf("SC_CLK_TCK")
body = '{"id":5,"name":"Ana","email":"ana@x.com","active":true}'
routes = [("GET /users/:id", ["-p", "/users/7"]), ("GET /users (50)", ["-p", "/users"]),
          ("POST /users", ["-m", "POST", "-p", "/users", "-b", body])]
def cpu(pid):
    pids = [pid] + [int(x) for x in subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True).stdout.split()]
    t = 0
    for p in pids:
        try: f = open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split(); t += int(f[11]) + int(f[12])
        except Exception: pass
    return t / TICK
def run(name, exe, cores, env, secs=4, conns=50, extra=()):
    port = 19200 + hash(name) % 500
    p = subprocess.Popen(["taskset", "-c", cores, exe], env={**os.environ, **env, "PORT": str(port)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(200):
        try: urllib.request.urlopen(f"http://127.0.0.1:{port}/users/1"); break
        except Exception: time.sleep(0.05)
    time.sleep(0.3)
    out = []
    for rname, a in routes:
        lg = ["taskset", "-c", os.environ.get("LGC","8-15"), LOAD, "-port", str(port), "-c", str(conns)] + a + list(extra)
        subprocess.run(lg + ["-d", "1s"], capture_output=True)
        c0 = cpu(p.pid)
        r = subprocess.run(lg + ["-d", f"{secs}s"], capture_output=True, text=True, env={**os.environ, "GOMAXPROCS": "10"}).stdout.strip()
        c1 = cpu(p.pid)
        rps = float(r.split()[0])
        us = (c1 - c0) * 1e6 / (rps * secs) if rps else 0
        out.append((rname, rps, us, r))
        print(f"{name:22} {rname:16} {r}   CPU/req {us:.1f} µs", flush=True)
    p.kill(); p.wait()
    subprocess.run(["pkill", "-f", exe], capture_output=True)
    return out

caju = B + "/caju/server"
for label, cores, w, conns in [("1 CPU", "0", "1", 50), ("4 núcleos físicos", "0,2,4,6", "4", 1000)]:
    run(f"Caju {label}", caju, cores, {"WORKERS": w}, conns=conns)
    run(f"Gin {label}", B + "/gin/server", cores, {"GOMAXPROCS": w}, conns=conns)
    run(f"net/http {label}", B + "/nethttp/server", cores, {"GOMAXPROCS": w}, conns=conns)
