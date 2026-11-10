// Compila um .caju para nativo e compara a saída com a da VM.
// Uso: node run.js arquivo.caju [linux|windows]
const path = require("path"), os = require("os"), fs = require("fs"), cp = require("child_process");
const E = require(path.join(__dirname, "..", "build", "core.js"));
const TMP = os.tmpdir();
const WINE64 = process.env.WINE64 || (fs.existsSync("/usr/lib/wine/wine64") ? "/usr/lib/wine/wine64" : "wine64");
// um exemplo da página é um texto (um arquivo) ou { files: [[nome, código], ...] }
const filesOf = (src) => (typeof src === "string" ? [{ name: "main.caju", src }] : src.files.map(([name, s]) => ({ name, src: s })));
async function vm(src) {
  const out = [], files = filesOf(src);
  try { await E.runVM(E.compile(E.link(files)), { token: {}, skipSleep: true, print: (l) => out.push(l), sleeping() {}, awake() {} }); }
  catch (e) { if (!e.stage) throw e; out.push(`Erro de ${e.stage.replace(/^de /, "")} em ${(files[Math.floor(e.line / 100000)] || files[0]).name}, linha ${e.line % 100000}: ${e.message}.`); }
  return out.join("\n");
}
function nat(src, tag, target = "linux") {
  const bin = E.compileNative(filesOf(src), { target });
  const f = path.join(TMP, `caju-nat-${process.pid}-${tag}${target === "windows" ? ".exe" : ""}`);
  fs.writeFileSync(f, bin, { mode: 0o755 });
  const r = target === "windows"
    ? cp.spawnSync(WINE64, [f], { env: { ...process.env, CAJU_SKIP_SLEEP: "1", WINEDEBUG: "-all", WINEPREFIX: process.env.WINEPREFIX || path.join(TMP, "caju-wineprefix") }, encoding: "utf8" })
    : cp.spawnSync(f, [], { env: { CAJU_SKIP_SLEEP: "1" }, encoding: "utf8", timeout: 20000 });
  return { out: (r.stdout || "").replace(/\r\n/g, "\n").replace(/\n$/, ""), code: r.status, sig: r.signal, err: r.stderr, f };
}
module.exports = { vm, nat, E, filesOf };
if (require.main === module) (async () => {
  const src = fs.readFileSync(process.argv[2], "utf8");
  const target = process.argv[3] || "linux";
  const a = await vm(src);
  let b;
  try { b = nat(src, "x", target); } catch (e) { console.log("ERRO DE COMPILAÇÃO:", e.message, e.line, e.stack); return; }
  console.log(a === b.out ? "IGUAL" : "DIFERENTE", "exit", b.code, b.sig || "");
  if (a !== b.out) { console.log("--- vm\n" + a + "\n--- nativo\n" + b.out); }
})();
