// Project loading for the bootstrap tools: reads the entry file and every file it imports.
// Import paths are relative to the entry file's directory; paths starting with "std/" come
// from the standard library (lib/ at the repository root).
const fs = require("fs"), path = require("path");
const E = require("./index.js");
const ROOT = path.join(__dirname, "..");
const LIB = process.env.CAJU_LIB || path.join(ROOT, "lib");

function resolveImport(base, name) {
  if (name.startsWith("std/")) return path.join(LIB, name.slice(4));
  return path.join(base, name);
}

// [{ name, src }], entry first, in the order the imports were found
function loadProject(entry) {
  const base = path.dirname(path.resolve(entry));
  const files = [], seen = new Set();
  const add = (name, file) => {
    if (seen.has(name)) return;
    seen.add(name);
    if (!fs.existsSync(file)) return;          // the linker reports the missing file
    const src = fs.readFileSync(file, "utf8");
    files.push({ name, src });
    let toks;
    try { toks = E.lex(src, files.length - 1); } catch { return; }
    for (let i = 0; i + 1 < toks.length; i++) {
      if (toks[i].type !== "KEYWORD" || toks[i].value !== "import") continue;
      let j = i + 1;
      if (toks[j].value === "{") { while (j < toks.length && toks[j].value !== "}") j++; j += 2; }
      if (toks[j] && toks[j].type === "NAME") j++;      // import alias "path"
      if (toks[j] && toks[j].type === "STRING") {
        const name = toks[j].value.endsWith(".caju") ? toks[j].value : toks[j].value + ".caju";
        add(name, resolveImport(base, name));
      }
    }
  };
  add(path.basename(entry), path.resolve(entry));
  return files;
}

const fileOf = (e, files) => ((files && files[Math.floor(e.line / 100000)]) || (files && files[0]) || { name: "main.caju" }).name;
function formatError(e, files) {
  return `${e.stage[0].toUpperCase() + e.stage.slice(1)} error in ${fileOf(e, files)}, line ${e.line % 100000}: ${e.message}.`;
}

async function runOnVM(entry, { print = null, skipSleep = true } = {}) {
  const out = [];
  let files;
  try {
    files = loadProject(entry);
    await E.runVM(E.compile(E.link(files)), {
      token: {}, skipSleep, sleeping() {}, awake() {},
      print: print || ((l) => out.push(l)),
    });
  } catch (e) {
    if (!e || !e.stage) throw e;
    const msg = formatError(e, files);
    if (print) print(msg); else out.push(msg);
    return print ? 1 : out.join("\n");
  }
  return print ? 0 : out.join("\n");
}

module.exports = { E, loadProject, formatError, runOnVM, resolveImport, ROOT, LIB };
