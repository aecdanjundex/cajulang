// Compara a velocidade: runtime em Rust (VM de bytecode) × código nativo. Só Linux.
// Uso: node bench.js "Nome do exemplo" arquivo.caju ...
const { E, filesOf } = require("./run.js"); const fs = require("fs"), cp = require("child_process"), path = require("path"), os = require("os");
const rt = fs.readFileSync(path.join(__dirname, "..", "runtime", "bin", "caju-rs-linux64"));
const VMB = path.join(os.tmpdir(), "caju-b-vm"), NATB = path.join(os.tmpdir(), "caju-b-nat");
for (const name of process.argv.slice(2)) {
  const src = E.EXAMPLES[name] ?? fs.readFileSync(name, "utf8");
  const files = filesOf(src);
  const pl = E.serializeProgram(E.optimizeProgram(E.link(files)), {});
  const len = Buffer.alloc(4); len.writeUInt32LE(pl.length);
  fs.writeFileSync(VMB, Buffer.concat([rt, Buffer.from(pl), len, Buffer.from("CAJUEXE1")]), { mode: 0o755 });
  fs.writeFileSync(NATB, E.compileNative(files), { mode: 0o755 });
  const t = (f) => { const s = process.hrtime.bigint(); cp.spawnSync(f, [], { env: { CAJU_SKIP_SLEEP: "1" } }); return Number(process.hrtime.bigint() - s) / 1e6; };
  const a = Math.min(t(VMB), t(VMB)), b = Math.min(t(NATB), t(NATB));
  console.log(`${name.padEnd(24)} Rust/VM ${a.toFixed(0).padStart(6)} ms   nativo ${b.toFixed(0).padStart(5)} ms   ${(a / b).toFixed(1)}x`);
}
