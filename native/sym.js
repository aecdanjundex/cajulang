// uso: node sym.js arquivo.caju endereço...  → função que contém cada endereço (ELF)
// (para depurar um travamento: o gdb mostra o endereço, isto diz a função)
const E = require(require("path").join(__dirname, "..", "build", "core.js")), fs = require("fs");
E.compileNative([{ name: "main.caju", src: fs.readFileSync(process.argv[2], "utf8") }]);
const syms = [...E.compileNative.lastSyms].filter(([k, v]) => v.sec === "text" && !k.startsWith(".L")).sort((a, b) => a[1].off - b[1].off);
for (const a of process.argv.slice(3)) {
  const off = parseInt(a, 16) - 0x401000;
  let best = null;
  for (const [k, v] of syms) if (v.off <= off) best = [k, off - v.off];
  console.log(a, best);
}
