#!/usr/bin/env python3
"""Caju x Go x Rust x Python: the same CPU-heavy programs, at several sizes.

    python3 bench/compare/run.py [--runs=3] [--langs=caju,go] [challenge ...]
    (with --langs the results are only printed, not saved)

Builds every program (caju build, go build, rustc -C opt-level=3; Python runs as is), runs each
one at each size (best wall time of up to --runs runs; a run over 5 s is not repeated), checks
that all languages print the same result, and writes RESULTS.md and results.json next to this
file. Needs build/caju (node bootstrap/caju.js build -o build/caju compiler/main.caju), go,
rustc (~/.cargo/bin is searched too) and python3.
"""
import json, os, platform, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "build", "compare")

CHALLENGES = [
    ("fib", "recursive calls (fib(n), exponential)", [25, 30, 35]),
    ("sieve", "sieve of Eratosthenes up to n", [100_000, 1_000_000, 10_000_000]),
    ("nbody", "5-body simulation, n steps (floating point)", [10_000, 100_000, 1_000_000]),
    ("mandelbrot", "Mandelbrot set on an n×n grid (floating point)", [250, 500, 1000]),
    ("matmul", "n×n integer matrix product (nested loops)", [100, 200, 300]),
    ("sort", "quicksort of n pseudo-random integers", [100_000, 500_000, 2_000_000]),
    ("maps", "n inserts and n lookups in a hash map (int keys)", [100_000, 1_000_000, 3_000_000]),
]
LANGS = ["caju", "go", "rust", "python"]


def tool(name):
    p = shutil.which(name) or os.path.expanduser(f"~/.cargo/bin/{name}")
    if not os.path.exists(p):
        sys.exit(f"{name} not found")
    return p


def version(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip().splitlines()[0]


CAJU = os.path.join(ROOT, "build", "caju")


def build(name):
    os.makedirs(OUT, exist_ok=True)
    src = lambda ext: os.path.join(HERE, f"{name}.{ext}")
    exe = lambda lang: os.path.join(OUT, f"{name}-{lang}")
    cmds = {
        "caju": [CAJU, "build", "-o", exe("caju"), src("caju")],
        "go": [tool("go"), "build", "-o", exe("go"), src("go")],
        "rust": [tool("rustc"), "-C", "opt-level=3", "-o", exe("rust"), src("rs")],
    }
    info = {}
    for lang, cmd in list(cmds.items()):
        if lang not in LANGS:
            del cmds[lang]
            continue
        t = time.perf_counter()
        r = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "GO111MODULE": "off"})
        if r.returncode != 0:
            sys.exit(f"build {name} ({lang}) failed:\n{r.stdout}{r.stderr}")
        info[lang] = {"compile_s": time.perf_counter() - t, "size": os.path.getsize(exe(lang))}
    run = {lang: [exe(lang)] for lang in cmds}
    if "python" in LANGS:
        run["python"] = [sys.executable, src("py")]
    return run, info


def measure(cmd, n, runs):
    """best wall time (s), peak memory (KB) and output of `cmd n`"""
    best, mem, out = None, 0, None
    for _ in range(runs):
        t = time.perf_counter()
        r = subprocess.run(["/usr/bin/time", "-f", "%M"] + cmd + [str(n)], capture_output=True, text=True, timeout=600)
        dt = time.perf_counter() - t
        if r.returncode != 0:
            return None, 0, f"<exit {r.returncode}: {r.stderr.strip()[-200:]}>"
        out = r.stdout.strip()
        mem = max(mem, int(r.stderr.strip().splitlines()[-1]))
        best = dt if best is None else min(best, dt)
        if dt > 5:
            break
    return best, mem, out


def fmt_time(s):
    if s is None:
        return "—"
    if s < 1:
        return f"{s * 1000:.0f} ms"
    return f"{s:.2f} s"


def fmt_n(n):
    for div, suf in ((1_000_000, "M"), (1_000, "k")):
        if n >= div and n % (div // 10) == 0:
            v = n / div
            return f"{v:g}{suf}"
    return str(n)


def main():
    global LANGS, CAJU
    runs = 3
    only = []
    save = True
    save_to = None
    caju_bin = None
    for a in sys.argv[1:]:
        if a.startswith("--save="):
            save_to = a[7:]
            continue
        if a.startswith("--caju="):
            CAJU = os.path.abspath(a[7:])
            continue
        if a.startswith("--runs="):
            runs = int(a[7:])
        elif a.startswith("--langs="):
            LANGS = a[8:].split(",")
            save = False
        else:
            only.append(a)
    results = {"date": time.strftime("%Y-%m-%d %H:%M"), "machine": platform.processor() or platform.machine(),
               "versions": {"caju": version([CAJU, "version"]),
                            "go": version([tool("go"), "version"]), "rust": version([tool("rustc"), "--version"]),
                            "python": "Python " + platform.python_version()},
               "challenges": []}
    cpu = ""
    try:
        cpu = next(l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name"))
    except Exception:
        pass
    results["cpu"] = cpu
    for name, desc, sizes in CHALLENGES:
        if only and name not in only:
            continue
        run, info = build(name)
        ch = {"name": name, "description": desc, "build": info, "sizes": []}
        for n in sizes:
            row = {"n": n}
            outs = {}
            for lang in LANGS:
                t, mem, out = measure(run[lang], n, runs)
                row[lang] = {"time": t, "mem_kb": mem}
                outs[lang] = out
            row["output"] = outs[LANGS[0]]
            row["agree"] = len(set(outs.values())) == 1
            if not row["agree"]:
                print(f"  OUTPUTS DIFFER {name} n={n}: {outs}")
            ch["sizes"].append(row)
            print(f"{name:11} n={fmt_n(n):>5}  " + "  ".join(f"{l}={fmt_time(row[l]['time']):>9}" for l in LANGS)
                  + ("" if row["agree"] else "  (outputs differ!)"), flush=True)
        results["challenges"].append(ch)
    if save_to:
        with open(save_to, "w") as f:
            json.dump(results, f, indent=1)
    if not save:
        return
    with open(os.path.join(HERE, "results.json"), "w") as f:
        json.dump(results, f, indent=1)
    write_markdown(results)


def write_markdown(res):
    L = []
    L.append("# Caju × Go × Rust × Python")
    L.append("")
    L.append(f"{res['date']} — {res['cpu']}")
    L.append("")
    L.append("Versions: " + ", ".join(res["versions"][l] for l in LANGS) + ".")
    L.append("Same algorithm and the same order of operations in every language (see the sources next to this")
    L.append("file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall")
    L.append("clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.")
    L.append("")
    L.append("## Time")
    L.append("")
    L.append("| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |")
    L.append("|---|--:|--:|--:|--:|--:|--:|--:|--:|")
    for ch in res["challenges"]:
        for row in ch["sizes"]:
            t = {l: row[l]["time"] for l in LANGS}
            ratio = lambda a, b: f"{t[a] / t[b]:.1f}×" if t[a] and t[b] else "—"
            ok = "" if row["agree"] else " ⚠"
            L.append(f"| {ch['name']}{ok} | {fmt_n(row['n'])} | " + " | ".join(fmt_time(t[l]) for l in LANGS)
                     + f" | {ratio('caju', 'go')} | {ratio('caju', 'rust')} | {ratio('python', 'caju')} |")
    L.append("")
    L.append("## Peak memory (largest size)")
    L.append("")
    L.append("| challenge | n | Caju | Go | Rust | Python |")
    L.append("|---|--:|--:|--:|--:|--:|")
    for ch in res["challenges"]:
        row = ch["sizes"][-1]
        L.append(f"| {ch['name']} | {fmt_n(row['n'])} | " + " | ".join(f"{row[l]['mem_kb'] / 1024:.1f} MB" for l in LANGS) + " |")
    L.append("")
    L.append("## Executable size and compile time")
    L.append("")
    L.append("| challenge | Caju | Go | Rust |")
    L.append("|---|--:|--:|--:|")
    for ch in res["challenges"]:
        b = ch["build"]
        L.append(f"| {ch['name']} | " + " | ".join(f"{b[l]['size'] / 1024:.0f} KB, {b[l]['compile_s'] * 1000:.0f} ms" for l in ("caju", "go", "rust")) + " |")
    L.append("")
    L.append("## The challenges")
    L.append("")
    for ch in res["challenges"]:
        L.append(f"- **{ch['name']}**: {ch['description']}; sizes " + ", ".join(fmt_n(r["n"]) for r in ch["sizes"]) + ".")
    with open(os.path.join(HERE, "RESULTS.md"), "w") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
