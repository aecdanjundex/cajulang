#!/usr/bin/env node
// Test runner. Every test is a program (a .caju file, or a directory with main.caju) with its
// expected output next to it (foo.caju -> foo.out, dir/ -> dir/expected.out).
//
//   node tests/run.js [options] [filter]
//     --compiler=boot     compile with the bootstrap compiler (JavaScript), default
//     --compiler=PATH     compile with a caju binary (the self-hosted compiler): PATH build ...
//     --vm                run on the bootstrap VM instead of compiling
//     --update            rewrite the .out files from the bootstrap VM (the reference)
//     --json=FILE         also write the results as JSON
//     --record            append a summary to tests/history.jsonl (date, commit, counts, failures)
//     --dirs=a,b          test directories (default: lang, examples, parity, native, std)
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const filter = args.find((a) => !a.startsWith("--"));
const DIRS = opt("dirs", "lang,examples,parity,native,std").split(",");
const compiler = opt("compiler", "boot");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "caju-test-"));
const boot = () => require(path.join(ROOT, "bootstrap", "project.js"));

function listTests() {
  const out = [];
  for (const d of DIRS) {
    const dir = path.join(__dirname, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { if (fs.existsSync(path.join(p, "main.caju"))) out.push({ name: `${d}/${f}`, entry: path.join(p, "main.caju"), expect: path.join(p, "expected.out") }); }
      else if (f.endsWith(".caju")) out.push({ name: `${d}/${f.slice(0, -5)}`, entry: p, expect: p.slice(0, -5) + ".out" });
    }
  }
  return filter ? out.filter((t) => t.name.includes(filter)) : out;
}

function runCompiled(t, i) {
  const exe = path.join(TMP, `t${i}`);
  const t0 = process.hrtime.bigint();
  if (compiler === "boot") {
    const B = boot();
    let files;
    try { files = B.loadProject(t.entry); fs.writeFileSync(exe, B.E.compileNative(files, { target: "linux" }), { mode: 0o755 }); }
    catch (e) {
      if (e && e.stage) {
        if (/not supported yet|ainda não é suportad/.test(e.message)) return { unsupported: e.message };
        return { out: B.formatError(e, files) };
      }
      throw e;
    }
  } else {
    const r = cp.spawnSync(compiler, ["build", "-o", exe, t.entry], { encoding: "utf8", maxBuffer: 1 << 26 });
    if (r.status !== 0) {
      const msg = (r.stdout + r.stderr).replace(/\n$/, "");
      if (/not supported yet/.test(msg)) return { unsupported: msg };
      return { out: msg };
    }
  }
  const tc = Number(process.hrtime.bigint() - t0) / 1e6;
  const r = cp.spawnSync(exe, [], { env: { CAJU_SKIP_SLEEP: "1", PATH: process.env.PATH }, encoding: "utf8", timeout: 30000, maxBuffer: 1 << 26 });
  if (r.signal) return { out: (r.stdout || "") + `\n<signal ${r.signal}>`, compileMs: tc };
  return { out: (r.stdout || "").replace(/\n$/, ""), compileMs: tc };
}

async function runVM(t) {
  const B = boot();
  return { out: await B.runOnVM(t.entry) };
}

(async () => {
  const tests = listTests();
  const results = [];
  let ok = 0, bad = 0, skip = 0;
  for (const [i, t] of tests.entries()) {
    if (flag("update")) {
      const { out } = await runVM(t);
      fs.writeFileSync(t.expect, out + "\n");
      console.log(`wrote ${path.relative(ROOT, t.expect)}`);
      continue;
    }
    if (!fs.existsSync(t.expect)) { console.log(`?    ${t.name} (no expected output)`); skip++; continue; }
    const want = fs.readFileSync(t.expect, "utf8").replace(/\n$/, "");
    let r;
    try { r = flag("vm") ? await runVM(t) : runCompiled(t, i); }
    catch (e) { r = { out: `<crash: ${e.stack || e}>` }; }
    if (r.unsupported) { skip++; results.push({ name: t.name, status: "unsupported" }); console.log(`skip ${t.name}: ${r.unsupported}`); continue; }
    if (r.out === want) { ok++; results.push({ name: t.name, status: "ok" }); if (!flag("quiet")) console.log(`ok   ${t.name}`); continue; }
    bad++;
    results.push({ name: t.name, status: "fail" });
    const a = want.split("\n"), b = r.out.split("\n");
    const k = a.findIndex((l, j) => l !== b[j]);
    const line = k < 0 ? a.length : k;
    console.log(`FAIL ${t.name} (first difference at line ${line + 1})\n  want: ${JSON.stringify(a[line])}\n  got : ${JSON.stringify(b[line])}`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  if (flag("update")) return;
  console.log(`\n${ok} passed, ${bad} failed, ${skip} skipped`);
  if (flag("record")) {
    const git = (a) => { try { return cp.execSync(`git -C ${ROOT} ${a}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
    const commit = (git("rev-parse --short HEAD") || "none") + (git("status --porcelain") ? "+" : "");
    fs.appendFileSync(path.join(__dirname, "history.jsonl"), JSON.stringify({ date: new Date().toISOString(), commit,
      compiler: compiler === "boot" ? "boot" : "self", passed: ok, failed: bad, skipped: skip,
      failures: results.filter((r) => r.status === "fail").map((r) => r.name) }) + "\n");
  }
  const json = opt("json");
  if (json) fs.writeFileSync(json, JSON.stringify({ ok, failed: bad, skipped: skip, results }, null, 1));
  process.exitCode = bad ? 1 : 0;
})();
