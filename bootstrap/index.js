// Loads the bootstrap compiler. It uses its own frozen copy of the runtime (bootstrap/rt): it only
// compiles the first stage of the Caju compiler, which then uses rt/.
// The pieces share one scope (they were written as a single
// script), so they are concatenated in order and evaluated together.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const PARTS = ["errors", "lexer", "parser", "types", "values", "linker", "compiler", "optimizer", "vm"];
const RT = { core: "core", gc: "gc", values: "values", dynamic: "dynamic", panic: "panic", linux: "linux", windows: "windows" };
function load() {
  const src = PARTS.map((p) => fs.readFileSync(path.join(__dirname, p + ".js"), "utf8")).join("\n")
    + fs.readFileSync(path.join(__dirname, "native.js"), "utf8")
    + "\nreturn { lex, parse, link, compile, optimizeProgram, runVM, CajuError, typecheck, compileNative };";
  const NATIVE_RT = {};
  for (const [k, f] of Object.entries(RT)) NATIVE_RT[k] = fs.readFileSync(path.join(__dirname, "rt", f + ".caju"), "utf8");
  return new Function("NATIVE_RT", src)(NATIVE_RT);
}
module.exports = load();
