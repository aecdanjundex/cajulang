
const EXTRA = {
 "st: básico": 'struct P { x: num, y: num, nome: str, ok: bool }\nfn (p: P) soma() -> num { return p.x + p.y }\nfn (p: *P) dobra() { p.x = p.x * 2\n p.y = p.y * 2 }\nlet a = P{x: 1.5, y: 2, nome: "um \\"a\\""}\nlet b = a\nb.dobra()\nprint(a, b, a.soma(), b.soma(), a == b, a == P{x: 1.5, y: 2, nome: "um \\"a\\""})\nprint("texto: " + a)',
 "st: any": 'struct C { r: num }\nfn (c: C) area() -> num { return 3 * c.r * c.r }\nfn (c: *C) cresce(k) { c.r = c.r + k }\nlet xs: any = C{r: 1}\nxs.cresce(2)\nprint(xs.area(), xs.r)\nlet n: any = 5\nprint(n.area())',
 "st: campo errado": 'struct C { r: num }\nlet v: any = C{}\nprint(v)\nprint(v.q)',
 "st: aridade": 'struct C { r: num }\nfn (c: C) f(a) { return a }\nlet v: any = C{}\nprint(v.f(1))\nprint(v.f())',
 "st: lixo": 'struct No { v: int, prox: any }\nlet total = 0\nfor i = 1 to 200000 {\n  let a = No{v: i}\n  let b = No{v: i * 2, prox: a}\n  total = total + b.prox.v + b.v\n}\nprint(total)',
 "st: lista": 'struct No { v: int, prox: any }\nlet lista: any = 0\nfor i = 1 to 50 { lista = No{v: i, prox: lista} }\nlet s = 0\nlet p = lista\nwhile p != 0 { s = s + p.v\n p = p.prox }\nprint(s)',
 "st: interface": 'interface F { area() -> num\n nome() -> str }\nstruct Q { l: num }\nstruct R { a: num, b: num }\nfn (q: Q) area() -> num { return q.l ** 2 }\nfn (q: Q) nome() -> str { return "quadrado" }\nfn (r: R) area() -> num { return r.a * r.b }\nfn (r: R) nome() -> str { return "ret" }\nfn total(a: F, b: F) -> num { return a.area() + b.area() }\nlet f: F = Q{l: 3}\nprint(f.nome(), f.area(), total(f, R{a: 2, b: 5}))\nf = R{a: 1, b: 1}\nprint(f.nome(), f)',
 "st: aninhada": 'struct P { x: num }\nstruct L { a: P, b: P, t: str }\nfn (p: *P) anda(d: num) { p.x = p.x + d }\nlet l = L{a: P{x: 1}}\nl.b.anda(5)\nl.a.anda(1)\nlet c = l.a\nc.anda(100)\nprint(l, c, l.a == P{x: 2})',
 "fn: fatorial": 'fn fatorial(n) {\n  if n <= 1 { return 1 }\n  return n * fatorial(n - 1)\n}\nprint(fatorial(10), fatorial(20), fatorial(170))',
 "fn: fib": 'fn fib(n) {\n  if n < 2 { return n }\n  return fib(n - 1) + fib(n - 2)\n}\nfor i = 0 to 22 { print(i, fib(i)) }',
 "fn: globais": 'let contador = 0\nfn incrementa(q) {\n  contador = contador + q\n}\nincrementa(5)\nincrementa(7)\nprint(contador, incrementa(1))',
 "fn: sombra": 'const PI = 3\nlet x = 10\nfn f(x) {\n  let PI = 99\n  return x + PI\n}\nprint(f(1), x, PI)',
 "fn: for recursivo": 'fn soma(n) {\n  if n == 0 { return 0 }\n  let t = 0\n  for i = 1 to n { t = t + i }\n  return t + soma(n - 1)\n}\nprint(soma(60))',
 "fn: mútua": 'fn par(n) { if n == 0 { return true }\n return impar(n - 1) }\nfn impar(n) { if n == 0 { return false }\n return par(n - 1) }\nprint(par(1000), impar(777), par(7))',
 "fn: profundo": 'fn desce(n) { return desce(n + 1) }\nprint(desce(0))',
 "fn: textos": 'fn repete(t, n) {\n  let r = ""\n  for i = 1 to n { r = r + t }\n  return r\n}\nprint(repete("ab", 5), repete("é", 3))',
 "fn: erro dentro": 'fn divide(a, b) { return a / b }\nprint(divide(1, 2))\nprint(divide(1, 0))',
 "fn: local antes": 'fn f() {\n  if false { let q = 1 }\n  return q\n}\nprint(f())',
 "mem: básico": 'let p = alloc(16)\npoke32(p, 123456)\npoke16(p + 4, 65535)\npoke8(p + 6, 300)\nprint(peek32(p), peek16(p + 4), peek8(p + 6), peek64(p))\nfree(p)',
 "mem: wstr": 'let p = alloc(16)\npoke16(p, 79)\npoke16(p + 2, 105)\npoke16(p + 4, 225)\nprint(readwstr(p), readstr(p))\nfree(p)\nfree(0)',
 "mem: erros": 'print(peek32(0))',
 "mem: tipos": 'let p = alloc(8)\npoke32(p, true)\nprint(peek32(p))\npoke32(p, "x")',
};
Object.assign(EXAMPLES, EXTRA);
// programas com os recursos do Go (slices, maps, closures, defer/panic, goroutines, canais...)
for (const f of require("fs").readdirSync(CAJU_RT + "/tests/go").sort())
  if (f.endsWith(".caju")) EXAMPLES["go: " + f.replace(/\.caju$/, "")] = require("fs").readFileSync(CAJU_RT + "/tests/go/" + f, "utf8");

const fs = require("fs"), cp = require("child_process");
const BIN = process.argv[2];
const runtime = fs.readFileSync(BIN); const WINE = /\.exe$/.test(BIN);
const where = (loc) => `main.caju, linha ${loc % LOC_BASE}`;
async function jsRun(prog) {
  const out = [];
  let err = null;
  try { await runVM(prog, { token: { stopped: false }, skipSleep: true, print: (l) => out.push(l), sleeping() {}, awake() {} }); }
  catch (e) { if (!(e instanceof CajuError)) throw e; err = e; }
  const stage = (e) => e.stage.replace(/^de /, "");
  if (err) out.push(`Erro de ${stage(err)} em ${where(err.line)}: ${err.message}.`);
  return out.join("\n");
}
function nativeRun(prog, tag) {
  const exe = buildExe(runtime, serializeProgram(prog, {}));
  const f = `${CAJU_TMP}/caju-test-${process.pid}-${tag}${WINE ? ".exe" : ""}`;
  fs.writeFileSync(f, exe, { mode: 0o755 });
  const t = Date.now();
  const r = cp.spawnSync(WINE ? (/x64/.test(BIN) ? CAJU_WINE64 : CAJU_WINE32) : f, WINE ? [f] : [], { env: { ...process.env, PATH: "/usr/lib/wine:" + process.env.PATH, CAJU_SKIP_SLEEP: "1", WINEDEBUG: "-all", WINEPREFIX: process.env.WINEPREFIX || CAJU_TMP + "/caju-wineprefix" }, encoding: "utf8", maxBuffer: 1 << 26 });
  fs.unlinkSync(f);
  return { out: r.stdout.replace(/\r\n/g, "\n").replace(/\n$/, ""), code: r.status, ms: Date.now() - t };
}
(async () => {
  const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
  let fails = 0, n = 0;
  for (const [name, src] of Object.entries(EXAMPLES)) {
    if (typeof src !== "string" || /^Windows:/.test(name)) continue;
    if (only && !only.test(name)) continue;
    let ast, p0, p1;
    try { ast = link([{ name: "main.caju", src }]); p0 = compile(ast); p1 = optimizeProgram(ast); } catch (e) { continue; }
    const heavy = /300 000|Área|Monte|perfeitos|Triplas/.test(name);
    const cases = [["orig", p0], ["opt", p1]];
    for (const [label, prog] of cases) {
      if (heavy && label !== "opt") continue;
      const expected = await jsRun(prog);
      const got = nativeRun(prog, n++);
      const ok = expected === got.out;
      if (!ok) {
        fails++;
        const e = expected.split("\n"), g = got.out.split("\n");
        const i = e.findIndex((l, k) => l !== g[k]);
        console.log(`FAIL ${name} [${label}] first diff at line ${i}:\n   js: ${JSON.stringify(e[i])}\n   nat: ${JSON.stringify(g[i])}`);
      } else console.log(`ok   ${name.padEnd(26)} [${label.padEnd(11)}] ${String(expected.split("\n").length).padStart(4)} linhas  exit ${got.code}  ${got.ms} ms`);
    }
  }
  console.log(fails ? `${fails} FALHAS` : "TODOS IGUAIS");
})();
