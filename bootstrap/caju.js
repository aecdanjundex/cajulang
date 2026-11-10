#!/usr/bin/env node
// Bootstrap command line (JavaScript). Used only until the compiler written in Caju can
// build itself; after that the `caju` binary replaces it.
//
//   caju.js build [-o out] [--target linux|windows] file.caju
//   caju.js run file.caju [args...]
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const { E, loadProject, formatError } = require("./project.js");

function usage() {
  console.error("usage:\n  caju build [-o output] [--target linux|windows] file.caju\n  caju run file.caju [args...]");
  process.exit(2);
}

function compileFile(entry, target) {
  let files;
  try {
    files = loadProject(entry);
    return E.compileNative(files, { target });
  } catch (e) {
    if (!e || !e.stage) throw e;
    console.error(formatError(e, files));
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const cmd = argv.shift();
if (cmd === "build") {
  let out = null, target = "linux", entry = null;
  while (argv.length) {
    const a = argv.shift();
    if (a === "-o") out = argv.shift();
    else if (a === "--target") target = argv.shift();
    else if (!entry) entry = a;
    else usage();
  }
  if (!entry) usage();
  if (!out) out = path.basename(entry).replace(/\.caju$/, "") + (target === "windows" ? ".exe" : "");
  fs.writeFileSync(out, compileFile(entry, target), { mode: 0o755 });
} else if (cmd === "run") {
  const entry = argv.shift();
  if (!entry) usage();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caju-run-"));
  const exe = path.join(dir, path.basename(entry).replace(/\.caju$/, ""));
  fs.writeFileSync(exe, compileFile(entry, "linux"), { mode: 0o755 });
  const r = cp.spawnSync(exe, argv, { stdio: "inherit" });
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(r.status ?? 1);
} else usage();
