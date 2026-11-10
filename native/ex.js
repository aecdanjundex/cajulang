const { vm, nat, E, filesOf } = require("./run.js");
(async () => {
  // --exemplos: todos os exemplos da página que o compilador nativo já aceita
  const names = process.argv.slice(2).flatMap((a) => a !== "--exemplos" ? [a] : Object.keys(E.EXAMPLES).filter((k) => {
    if (k === "Windows: caixa de mensagem") return false;      // depende de alguém clicar na janela

    try { E.compileNative(filesOf(E.EXAMPLES[k]), { target: process.env.TARGET || "linux" }); return true; } catch { return false; }
  }));
  let ok = 0, bad = 0;
  for (const name of names) {
    const src = E.EXAMPLES[name] ?? require("fs").readFileSync(name, "utf8");
    const a = await vm(src);
    let b;
    try { b = nat(src, ok + bad, process.env.TARGET || "linux"); }
    catch (e) { console.log(`NÃO COMPILA ${name}: ${e.message} (linha ${e.line % 100000})`); bad++; continue; }
    if (a === b.out) { ok++; console.log(`ok   ${name} (exit ${b.code})`); }
    else { bad++; const x = a.split("\n"), y = b.out.split("\n"); const i = x.findIndex((l, k) => l !== y[k]); console.log(`DIFF ${name} exit ${b.code} ${b.sig || ""} linha ${i}:\n  vm : ${JSON.stringify(x[i])}\n  nat: ${JSON.stringify(y[i])}`); }
  }
  console.log(`${ok} iguais, ${bad} diferentes`);
})();
