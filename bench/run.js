#!/usr/bin/env node
// Benchmarks: compiles and runs every program in bench/programs, measures compile time, binary
// size, run time (best of N runs) and peak memory, checks the output against <name>.out, and
// appends the results to bench/history.jsonl so the evolution of the language can be followed.
//
//   node bench/run.js [--compiler=boot|PATH] [--runs=3] [--note="text"] [--no-save] [filter]
//     --compiler=boot   the bootstrap compiler (JavaScript), default
//     --compiler=PATH   a caju binary: PATH build -o out file.caju
//   node bench/run.js --history [name]    prints the recorded history (one benchmark or all)
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const ROOT = path.join(__dirname, "..");
const HISTORY = path.join(__dirname, "history.jsonl");
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const filter = args.find((a) => !a.startsWith("--"));
const compiler = opt("compiler", "boot");
const RUNS = Number(opt("runs", "3"));

function readHistory() {
  if (!fs.existsSync(HISTORY)) return [];
  return fs.readFileSync(HISTORY, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

if (flag("history")) {
  const hist = readHistory();
  const names = [...new Set(hist.flatMap((h) => Object.keys(h.results)))].filter((n) => !filter || n.includes(filter));
  for (const n of names) {
    console.log(`\n${n}`);
    console.log("  date                 commit    compiler   compile ms   size KB    run ms   memory MB");
    for (const h of hist) {
      const r = h.results[n];
      if (!r) continue;
      console.log(`  ${h.date.slice(0, 19).replace("T", " ")}  ${h.commit.padEnd(9)} ${h.compiler.padEnd(9)} ${String(r.compile_ms).padStart(11)} ${(r.size / 1024).toFixed(0).padStart(9)} ${String(r.run_ms).padStart(9)} ${(r.rss_kb / 1024).toFixed(1).padStart(11)}`);
    }
  }
  process.exit(0);
}

const git = (a) => { try { return cp.execSync(`git -C ${ROOT} ${a}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
const commit = (git("rev-parse --short HEAD") || "none") + (git("status --porcelain") ? "+" : "");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "caju-bench-"));
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

function build(src, exe) {
  const t0 = process.hrtime.bigint();
  const r = compiler === "boot"
    ? cp.spawnSync(process.execPath, [path.join(ROOT, "bootstrap", "caju.js"), "build", "-o", exe, src], { encoding: "utf8" })
    : cp.spawnSync(compiler, ["build", "-o", exe, src], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed: ${r.stdout}${r.stderr}`);
  return ms(t0);
}

function runOnce(exe) {
  const t0 = process.hrtime.bigint();
  const r = cp.spawnSync("/usr/bin/time", ["-f", "%M", exe], { encoding: "utf8", maxBuffer: 1 << 26 });
  const t = ms(t0);
  const rss = Number((r.stderr.trim().split("\n").pop() || "0"));
  return { t, rss, out: r.stdout, status: r.status };
}

const progs = fs.readdirSync(path.join(__dirname, "programs")).filter((f) => f.endsWith(".caju") && (!filter || f.includes(filter))).sort();
const last = readHistory().filter((h) => h.compiler === (compiler === "boot" ? "boot" : "self")).pop();
const results = {};
let bad = 0;
console.log("benchmark          compile ms   size KB    run ms   memory MB   vs last run");
for (const f of progs) {
  const name = f.slice(0, -5), src = path.join(__dirname, "programs", f), exe = path.join(TMP, name);
  let compileMs;
  try { compileMs = build(src, exe); } catch (e) { console.log(`${name.padEnd(18)} ${e.message}`); bad++; continue; }
  const size = fs.statSync(exe).size;
  let best = Infinity, rss = 0, out = null;
  for (let i = 0; i < RUNS; i++) {
    const r = runOnce(exe);
    if (r.t < best) best = r.t;
    rss = Math.max(rss, r.rss);
    out = r.out;
  }
  const expectFile = path.join(__dirname, "programs", name + ".out");
  let note = "";
  if (fs.existsSync(expectFile)) { if (fs.readFileSync(expectFile, "utf8") !== out) { note = "WRONG OUTPUT"; bad++; } }
  else fs.writeFileSync(expectFile, out);
  const r = { compile_ms: Math.round(compileMs), size, run_ms: Math.round(best), rss_kb: rss };
  results[name] = r;
  const prev = last && last.results[name];
  const delta = prev && prev.run_ms ? `${((r.run_ms / prev.run_ms - 1) * 100).toFixed(0).padStart(4)}% time` : "";
  console.log(`${name.padEnd(18)} ${String(r.compile_ms).padStart(10)} ${(size / 1024).toFixed(0).padStart(9)} ${String(r.run_ms).padStart(9)} ${(rss / 1024).toFixed(1).padStart(11)}   ${delta} ${note}`);
}
fs.rmSync(TMP, { recursive: true, force: true });
if (!flag("no-save") && !filter) {
  fs.appendFileSync(HISTORY, JSON.stringify({ date: new Date().toISOString(), commit, compiler: compiler === "boot" ? "boot" : "self", note: opt("note", ""), results }) + "\n");
  console.log(`\nsaved to bench/history.jsonl (commit ${commit})`);
}
process.exitCode = bad ? 1 : 0;
