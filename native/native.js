  // =====================================================================
  // 5. Compilador nativo (x86-64), fase 5
  // =====================================================================
  // Transforma o projeto direto em código de máquina, sem a VM: um executável ELF (Linux, para
  // os testes) ou PE (Windows). O runtime (saída, memória, números em texto, erros) é escrito
  // em Caju (NATIVE_RT) e compilado junto. Fase 1: inteiros, num, bool, textos, funções com
  // tipos, if/while/for/switch, print, sleep, conversões e externs do runtime. Fase 2: slices,
  // arrays, structs (com métodos e embutidas), ponteiros, maps, range e atribuição múltipla.
  // Struct e array são um objeto no heap com uma palavra de 8 bytes por campo/elemento; *T
  // aponta para o próprio objeto. Os descritores de tipo (nos dados) dizem ao runtime como
  // copiar, zerar, comparar e escrever cada valor.
  // Fase 3: any e interfaces (0 = nil, ou uma caixa [descritor, valor] no heap; as contas com any
  // seguem as regras da VM), x.(T), switch de tipos, chamada de método pelo nome, closures
  // ([código, células]; o objeto vai empilhado antes dos argumentos), métodos como valores,
  // vários resultados (o 1º em RAX, os outros em g.ret), resultados com nome e errors.New.
  // Fase 4: coletor de lixo (rt/gc.caju), conservador. A entrada grava o topo da pilha e a
  // faixa das globais (g.data_lo..g.data_hi); por isso nenhum ponteiro vivo fica só num
  // registrador durante uma chamada: tudo que importa está na pilha ou nas globais.
  // Fase 5: defer, panic e recover (rt/panico.caju). Uma função com defer guarda um registro
  // no quadro; o panic roda os defers e, se alguém recuperar, salta para o "recuperado" da função.
  //
  // Todo valor cabe em 64 bits: inteiros e bool como inteiro, num como os bits do double,
  // texto como ponteiro para [tamanho][bytes][0]. Cada expressão deixa o valor em RAX.
  // Chamadas: argumentos empilhados da esquerda para a direita, resultado em RAX, quem chama
  // tira os argumentos. A convenção do Windows só aparece nos "thunks" dos externs.

  // ---- montador x86-64 ----
  const RAX = 0, RCX = 1, RDX = 2, RBX = 3, RSP = 4, RBP = 5, RSI = 6, RDI = 7, R8 = 8, R9 = 9, R10 = 10, R11 = 11;
  const CC = { o: 0, b: 2, ae: 3, e: 4, ne: 5, be: 6, a: 7, s: 8, ns: 9, p: 10, np: 11, l: 12, ge: 13, le: 14, g: 15 };
  class X64 {
    constructor() { this.b = []; this.syms = new Map(); this.fix = []; this.nlab = 0; }
    get pos() { return this.b.length; }
    byte(...xs) { for (const x of xs) this.b.push(x & 255); }
    d32(v) { this.byte(v, v >> 8, v >> 16, v >> 24); }
    d64(v) { let x = BigInt.asUintN(64, BigInt(v)); for (let i = 0; i < 8; i++) { this.byte(Number(x & 255n)); x >>= 8n; } }
    rex(w, r, bb, force) { const v = 0x40 | (w ? 8 : 0) | (((r >> 3) & 1) << 2) | ((bb >> 3) & 1); if (v !== 0x40 || force) this.byte(v); }
    // registrador com registrador: modrm 11 reg rm
    rr(op, reg, rm, w = 1, pre = []) { this.byte(...pre); this.rex(w, reg, rm); this.byte(...op, 0xC0 | ((reg & 7) << 3) | (rm & 7)); }
    // registrador com [base + disp32]
    rm(op, reg, base, disp, w = 1, pre = []) {
      this.byte(...pre); this.rex(w, reg, base); this.byte(...op, 0x80 | ((reg & 7) << 3) | (base & 7));
      if ((base & 7) === 4) this.byte(0x24);
      this.d32(disp);
    }
    // registrador com [rip + símbolo]
    rip(op, reg, sym, w = 1, pre = [], after = 0) {
      this.byte(...pre); this.rex(w, reg, 0); this.byte(...op, 0x05 | ((reg & 7) << 3));
      const at = this.pos; this.d32(0); this.fix.push({ at, sym, end: at + 4 + after });
    }
    label() { return `.L${this.nlab++}`; }
    bind(sym) { this.syms.set(sym, { sec: "text", off: this.pos }); }
    jmp(sym) { this.byte(0xE9); const at = this.pos; this.d32(0); this.fix.push({ at, sym, end: at + 4 }); }
    jcc(cc, sym) { this.byte(0x0F, 0x80 + cc); const at = this.pos; this.d32(0); this.fix.push({ at, sym, end: at + 4 }); }
    call(sym) { this.byte(0xE8); const at = this.pos; this.d32(0); this.fix.push({ at, sym, end: at + 4 }); }
    ret() { this.byte(0xC3); }
    movImm(r, v) {
      const x = BigInt.asIntN(64, BigInt(v));
      if (x === 0n) { this.rr([0x31], r, r, 0); return; }              // xor r32, r32
      if (x > 0n && x < 0x80000000n) { this.rex(0, 0, r); this.byte(0xB8 + (r & 7)); this.d32(Number(x)); return; }
      this.rex(1, 0, r); this.byte(0xB8 + (r & 7)); this.d64(x);
    }
    mov(dst, src) { this.rr([0x89], src, dst); }
    load(r, base, disp) { this.rm([0x8B], r, base, disp); }
    store(base, disp, r) { this.rm([0x89], r, base, disp); }
    loadSym(r, sym) { this.rip([0x8B], r, sym); }
    storeSym(sym, r) { this.rip([0x89], r, sym); }
    lea(r, sym) { this.rip([0x8D], r, sym); }
    push(r) { if (r >= 8) this.byte(0x41); this.byte(0x50 + (r & 7)); }
    pop(r) { if (r >= 8) this.byte(0x41); this.byte(0x58 + (r & 7)); }
    alu(op, dst, src) { this.rr([{ add: 0x01, sub: 0x29, and: 0x21, or: 0x09, xor: 0x31, cmp: 0x39, test: 0x85 }[op]], src, dst); }
    imul(dst, src) { this.rr([0x0F, 0xAF], dst, src); }
    addImm(r, v) { this.rex(1, 0, r); this.byte(0x81, 0xC0 | (r & 7)); this.d32(v); }
    subImm(r, v) { this.rex(1, 0, r); this.byte(0x81, 0xE8 | (r & 7)); this.d32(v); }
    cmpImm(r, v) { this.rex(1, 0, r); this.byte(0x81, 0xF8 | (r & 7)); this.d32(v); }
    unary(ext, r) { this.rex(1, 0, r); this.byte(0xF7, 0xC0 | (ext << 3) | (r & 7)); }   // 2 not, 3 neg, 6 div, 7 idiv
    shiftCl(ext, r) { this.rex(1, 0, r); this.byte(0xD3, 0xC0 | (ext << 3) | (r & 7)); }  // 4 shl, 5 shr, 7 sar
    cqo() { this.byte(0x48, 0x99); }
    setcc(cc, r8 = RAX) { this.rex(0, 0, r8, r8 >= 4); this.byte(0x0F, 0x90 + cc, 0xC0 | (r8 & 7)); }
    movzxb(dst, src) { this.rr([0x0F, 0xB6], dst, src, 0); }                  // movzx r32, r8 (zera o resto)
    // ponto flutuante
    movqX(x, r) { this.rr([0x0F, 0x6E], x, r, 1, [0x66]); }                  // movq xmm, r64
    movqR(r, x) { this.rr([0x0F, 0x7E], x, r, 1, [0x66]); }                  // movq r64, xmm
    sse(op, a, b, pre = 0xF2) { this.rr([0x0F, op], a, b, 0, [pre]); }       // addsd 58, mulsd 59, subsd 5C, divsd 5E, sqrtsd 51
    ucomisd(a, b) { this.rr([0x0F, 0x2E], a, b, 0, [0x66]); }
    cvtsi2sd(x, r) { this.rr([0x0F, 0x2A], x, r, 1, [0xF2]); }
    cvttsd2si(r, x) { this.rr([0x0F, 0x2C], r, x, 1, [0xF2]); }
  }

  // ---- runtime em Caju (o código fica em NATIVE_RT, mais abaixo) ----
  const NATIVE_KIND_SIGNED = new Set([0, 1, 2, 3, 4]);

  function compileNative(files, { target = "linux" } = {}) {
    const fileNames = files.map((f) => f.name);
    const fail = (msg, n) => { throw new CajuError("de compilação", `Compilador nativo: ${msg}`, n ? n.line : 1, n ? n.col ?? null : null); };
    // o programa do usuário passa antes por todas as verificações do compilador de bytecode
    const ast = link(files);
    const uTypes = compile(ast).types;
    const rtSrc = [NATIVE_RT.comum, NATIVE_RT.gc, NATIVE_RT.valores, NATIVE_RT.dinamico, NATIVE_RT.panico, NATIVE_RT[target]].join("\n");
    const rtAst = link([{ name: "rt.caju", src: rtSrc }]);
    const rTypes = typecheck(rtAst, { intrinsics: true });

    const A = new X64();
    const data = [];                 // seção de dados: globais, textos e descritores de tipo
    const dataRelocs = [];           // palavras de 64 bits com o endereço absoluto de um símbolo
    const dataSym = (sym, bytes, align = 8) => {
      while (data.length % align) data.push(0);
      A.syms.set(sym, { sec: "data", off: data.length });
      for (const x of bytes) data.push(x & 255);
    };
    const word = (v) => { const out = []; let x = BigInt.asUintN(64, BigInt(v)); for (let i = 0; i < 8; i++) { out.push(Number(x & 255n)); x >>= 8n; } return out; };
    const strSyms = new Map();
    const enc = new TextEncoder();
    const strLit = (s) => {
      if (!strSyms.has(s)) {
        const b = enc.encode(s), sym = `str.${strSyms.size}`;
        dataSym(sym, [...word(b.length), ...b, 0]);
        strSyms.set(s, sym);
      }
      return strSyms.get(s);
    };
    dataSym("g.data_lo", []);       // começo das globais: o coletor lê daqui até g.data_hi
    dataSym("g.argp", word(0));
    dataSym("g.ret", new Array(8 * 16).fill(0));    // resultados 2, 3... de uma função com vários resultados
    const imports = new Map();       // dll → Set(símbolo), para a tabela de importação do PE

    // ---- tipos ----
    const allStructs = new Map([...rTypes.structTable, ...uTypes.structTable]);
    const FLOATS = new Set(["num", "float32", "flit"]);
    const allIfaces = new Map([...rTypes.ifaceTable, ...uTypes.ifaceTable]);
    const isStruct = (t) => allStructs.has(dflt(t));
    const isIfaceT = (t) => !!t && (loose(t) || allIfaces.has(dflt(t)));
    const isFuncT = (t) => !!t && !isIfaceT(t) && !isStruct(t) && tinfo(dflt(t)).k === "func";
    const resultsOfT = (r) => (!r || r === "void" ? [] : r.startsWith("(") ? tinfo(r).items : [r]);
    const kindOfT = (t) => (t && !isStruct(t) ? tinfo(dflt(t)).k : null);
    const isValueType = (t) => !!t && (isStruct(t) || kindOfT(t) === "array");
    const cls = (t, n) => {
      const d = dflt(t || "any");
      if (FLOATS.has(t) || FLOATS.has(d)) return "f";
      if (d === "bool" || d in KIND_CODE) return "i";
      if (d === "str") return "s";
      if (d === "void") return "v";
      if (d === "nil" || isIfaceT(d) || isStruct(d) || ["slice", "array", "map", "ptr", "func"].includes(tinfo(d).k)) return "p";
      fail(`o tipo ${showT(t)} ainda não é suportado (vem nas próximas fases)`, n);
    };
    const kindCode = (t) => KIND_CODE[dflt(t)] ?? 0;
    const isUnsigned = (t) => { const k = kindCode(t); return k >= 5 && k <= 9; };
    const structFields = (t) => allStructs.get(dflt(t)).node.fields;
    const fieldIndex = (t, name, n) => {
      const i = structFields(t.replace(/^\*/, "")).findIndex((f) => f.name === name);
      if (i < 0) fail(`campo ${name} não encontrado`, n);
      return i;
    };
    // descritor de tipo, nos dados: usado pelo runtime para copiar, zerar, comparar e escrever valores
    const descs = new Map();
    function desc(t, n) {
      t = dflt(t);
      if (descs.has(t)) return descs.get(t);
      const sym = `desc.${descs.size}`;
      descs.set(t, sym);
      const fields = new Array(8).fill(0n);
      const refs = { 4: strLit(t === "·errstr" ? "*errors.errorString" : bare(t)) };   // posição → símbolo
      if (t === "str") fields[0] = 5n;
      else if (t === "bool") fields[0] = 4n;
      else if (FLOATS.has(t)) fields[0] = 3n;
      else if (t in KIND_CODE) { fields[0] = isUnsigned(t) ? 2n : 1n; fields[6] = BigInt(kindCode(t)); }
      else if (t === "·errstr") { fields[0] = 13n; refs[7] = methodTable(null); }
      else if (t === "any" || loose(t)) fields[0] = 11n;
      else if (allIfaces.has(t)) {
        fields[0] = 12n;
        const names = [...allIfaces.get(t).methods.keys()];
        const lst = `${sym}.m`;
        dataSym(lst, [].concat(word(names.length), ...names.map(() => word(0))));
        const base = A.syms.get(lst).off;
        names.forEach((m, i) => dataRelocs.push({ off: base + 8 + 8 * i, sym: strLit(m) }));
        refs[7] = lst;
      } else if (isStruct(t)) {
        const fs = structFields(t);
        fields[0] = 8n; fields[1] = BigInt(fs.length);
        const tab = `${sym}.f`;
        const bytes = [];
        const tabRefs = [];
        fs.forEach((f, i) => {
          tabRefs.push([24 * i, strLit(f.name)], [24 * i + 8, desc(f.type, n)]);
          bytes.push(...word(0), ...word(0), ...word(isValueType(f.type) ? 1 : 0));
        });
        if (!bytes.length) bytes.push(...word(0));
        dataSym(tab, bytes);
        const base = A.syms.get(tab).off;
        for (const [o, s] of tabRefs) dataRelocs.push({ off: base + o, sym: s });
        refs[5] = tab;
        const mt = methodTable(t);
        if (mt) refs[7] = mt;
      } else {
        const ti = tinfo(t);
        if (ti.k === "slice") { fields[0] = 6n; refs[2] = desc(ti.elem, n); }
        else if (ti.k === "array") { fields[0] = 7n; fields[1] = BigInt(ti.n); refs[2] = desc(ti.elem, n); }
        else if (ti.k === "ptr") {
          fields[0] = 9n; refs[2] = desc(ti.elem, n);
          if (isStruct(ti.elem)) { const mt = methodTable(dflt(ti.elem)); if (mt) refs[7] = mt; }
        }
        else if (ti.k === "map") { fields[0] = 10n; refs[2] = desc(ti.val, n); refs[3] = desc(ti.key, n); }
        else if (ti.k === "func") fields[0] = 14n;
        else fields[0] = 15n;
      }
      dataSym(sym, [].concat(...fields.map(word)));
      const base = A.syms.get(sym).off;
      for (const [i, s] of Object.entries(refs)) dataRelocs.push({ off: base + 8 * i, sym: s });
      return sym;
    }
    // tabela de métodos de uma struct (null: a do erro de errors.New), para chamadas por interface
    const mtabs = new Map();
    function methodTable(sname) {
      if (mtabs.has(sname)) return mtabs.get(sname);
      let entries;
      if (sname === null) entries = [{ name: "Error", code: "r.f.rt_err_error", path: [], copy: null, vset: true, ret: "str" }];
      else {
        if (!uTypes.structTable.has(sname)) { mtabs.set(sname, null); return null; }
        const all = uTypes.methodSet(sname, true), vset = uTypes.methodSet(sname, false);
        entries = [...all].map(([m, mm]) => {
          // índices dos campos embutidos, da struct até o receptor
          let st = sname;
          const path = mm.path.map((p) => { const i = fieldIndex(st, p); st = dflt(structFields(st)[i].type).replace(/^\*/, ""); return i; });
          const r = mm.info.node.retTy || mm.info.node.rtype || "void";
          return { name: m, code: `u.f.${mm.info.node.name}`, path, copy: mm.ptr ? null : mm.info.node.ptypes[0], vset: vset.has(m),
                   ret: r === "void" || r.startsWith("(") || isIfaceT(r) ? null : r };
        });
      }
      const sym = `mt.${mtabs.size}`;
      mtabs.set(sname, sym);
      dataSym(sym, [].concat(word(entries.length), ...entries.map((e) => [].concat(word(0), word(0), word(0), word(0), word(e.vset ? 1 : 0), word(0)))));
      const base = A.syms.get(sym).off;
      entries.forEach((e, i) => {
        const at = base + 8 + 48 * i;
        dataRelocs.push({ off: at, sym: strLit(e.name) }, { off: at + 8, sym: e.code });
        if (e.path.length) {
          const ps = `${sym}.p${i}`;
          dataSym(ps, [].concat(word(e.path.length), ...e.path.map(word)));
          dataRelocs.push({ off: at + 16, sym: ps });
        }
        if (e.copy) dataRelocs.push({ off: at + 24, sym: desc(e.copy) });
        if (e.ret) dataRelocs.push({ off: at + 40, sym: desc(e.ret) });
      });
      return sym;
    }
    const keyKind = (t, n) => {
      if (isValueType(t) || isIfaceT(t)) fail("maps com chaves struct, array, any ou interface ainda não são suportados", n);
      return FLOATS.has(dflt(t)) ? 1 : dflt(t) === "str" ? 2 : 0;
    };

    // ajusta RAX ao tamanho do tipo inteiro k (int8 dá a volta em 8 bits etc.)
    function wrapKind(k) {
      switch (k) {
        case 1: A.rr([0x0F, 0xBE], RAX, RAX); break;           // movsx rax, al
        case 2: A.rr([0x0F, 0xBF], RAX, RAX); break;           // movsx rax, ax
        case 3: A.rr([0x63], RAX, RAX); break;                 // movsxd rax, eax
        case 6: A.movzxb(RAX, RAX); break;
        case 7: A.rr([0x0F, 0xB7], RAX, RAX, 0); break;        // movzx eax, ax
        case 8: A.rr([0x89], RAX, RAX, 0); break;              // mov eax, eax
        case 10: A.movqX(0, RAX); A.sse(0x5A, 0, 0, 0xF2); A.sse(0x5A, 0, 0, 0xF3); A.movqR(RAX, 0); break; // arredonda para float32
      }
    }
    // converte RAX do tipo "from" para o tipo "to" (int → num quando um int vai onde se espera num)
    function coerce(from, to, n) {
      if (!from || !to || to === "void" || from === "void") return;
      // valor concreto entrando num any ou numa interface: ganha uma caixa com o tipo
      const fi = isIfaceT(from), ti = isIfaceT(to);
      if (ti && !fi) {
        if (dflt(from) === "nil") return;
        if (from.startsWith("(")) fail("vários resultados não cabem num valor só", n);
        if (dflt(from) === "int") { A.push(RAX); A.call(rtCall("rt_box_int")); A.addImm(RSP, 8); return; }
        A.push(RAX); A.lea(RAX, desc(from, n)); A.push(RAX); A.call(rtCall("rt_box")); A.addImm(RSP, 16);
        return;
      }
      // any indo para onde se espera um tipo concreto (tipagem gradual)
      if (fi && !ti) {
        if (dflt(to) === "nil") return;
        A.mov(RCX, RAX);
        A.lea(RAX, strLit(whereText(n))); A.push(RAX); A.push(RCX);
        A.lea(RAX, desc(to, n)); A.push(RAX);
        A.call(rtCall("rt_unbox")); A.addImm(RSP, 24);
        return;
      }
      if (fi && ti) return;
      const a = cls(from, n), b = cls(to, n);
      if (a === "i" && b === "f") {
        if (kindCode(from) === 5 || kindCode(from) === 9) {
          // uint64 acima de 2^63: metade, converte, dobra
          const big = A.label(), done = A.label();
          A.alu("test", RAX, RAX); A.jcc(CC.s, big);
          A.cvtsi2sd(0, RAX); A.jmp(done);
          A.bind(big); A.mov(RCX, RAX); A.byte(0x48, 0xD1, 0xE8); A.byte(0x83, 0xE1, 0x01); A.alu("or", RAX, RCX);
          A.cvtsi2sd(0, RAX); A.sse(0x58, 0, 0);
          A.bind(done);
        } else A.cvtsi2sd(0, RAX);
        A.movqR(RAX, 0);
        if (dflt(to) === "float32") wrapKind(10);
      } else if (a === "f" && b === "f" && dflt(to) === "float32" && dflt(from) !== "float32") wrapKind(10);
    }

    // ---- unidades: o runtime e o programa ----
    function unit(ast, P, isRuntime, types) {
      const funcs = new Map(), externs = new Map();
      // os módulos (arquivos importados) entram como blocos no topo
      const flat = (body) => body.flatMap((st) => (st.kind === "Módulo" ? flat(st.body) : [st]));
      for (const st of flat(ast.body)) {
        if (st.kind === "Função") funcs.set(st.name, st);
        else if (st.kind === "Externa") externs.set(st.name, st);
        else if (st.kind === "Importação") fail("vários arquivos ainda não são suportados", st);
      }
      return { ast, P, isRuntime, funcs, externs, globals: new Map(), celled: types.globalCelled || new Set() };
    }
    const rtU = unit(rtAst, "r", true, rTypes);
    const uU = unit(ast, "u", false, uTypes);
    const whereText = (n) => `${fileNames[locFile(n ? n.line : 1)] || "main.caju"}, linha ${locLine(n ? n.line : 1)}`;
    const rtCall = (name) => {
      if (!rtU.funcs.has(name)) throw new Error(`runtime sem ${name}`);
      return `r.f.${name}`;
    };

    // declarações (nome → tipo) de um corpo, sem entrar em funções
    function collectDecls(body, add) {
      (function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) return n.forEach(walk);
        switch (n.kind) {
          case "Função": case "FuncLit": case "Externa": case "Struct": return;
          case "Atribuição": if (n.decl) add(n.name, n.ty, n); break;
          case "Para": add(n.name, n.ty, n); break;
          case "Declara": n.names.forEach((nm, i) => add(nm, n.types[i], n)); break;
          case "Range": if (n.decl) n.vars.forEach((v) => add(v.name, v.ty, n)); break;
          case "TipoSwitch": if (n.bind && n.bind !== "_") add(n.bind, "·mista", n); n.cases.forEach((c) => walk(c.body)); break;
          case "Seleciona": fail("select ainda não é suportado", n);
        }
        for (const k of ["body", "then", "otherwise", "init", "post"]) walk(n[k]);
        if (n.kind === "Escolha") n.cases.forEach((c) => walk(c.body));
      })(body);
    }

    // ---- uma função (ou o código de topo) ----
    function genFunction(U, label, params, ptypes, body, retT, isTop, celledSet, fnode = null, isLit = false, capTypes = []) {
      const locals = new Map();      // nome → { off, t, celled }
      let nloc = 0;
      const newSlot = () => -8 * ++nloc;
      if (!isTop) params.forEach((p, i) => locals.set(p, { off: 16 + 8 * (params.length - 1 - i), t: ptypes[i], celled: celledSet.has(p) }));
      // closure: as variáveis capturadas vêm em células, no objeto da closure (empilhado antes dos argumentos)
      const envOff = 16 + 8 * params.length;
      const caps = new Map(isLit ? (fnode.captures || []).map((nm, i) => [nm, { cap: i, celled: true, t: capTypes[i] }]) : []);
      const rnames = fnode && fnode.rnames ? fnode.rnames : null;
      const addDecl = (name, t, n) => {
        if (name === "_") return;
        const scope = isTop ? U.globals : locals;
        if (scope.has(name)) {
          const prev = scope.get(name).t;
          if (t !== "·mista" && prev !== "any" && cls(prev, n) !== cls(t, n)) fail(`a variável "${bare(name)}" é declarada com tipos diferentes`, n);
          return;
        }
        if (t === "·mista") t = "any";
        if (isTop) { const sym = `${U.P}.g.${name}`; dataSym(sym, word(0)); scope.set(name, { sym, t, celled: U.celled.has(name) }); }
        else scope.set(name, { off: newSlot(), t, celled: celledSet.has(name) });
      };
      if (rnames) rnames.forEach((nm, i) => addDecl(nm, resultsOfT(retT)[i], fnode));
      collectDecls(body, addDecl);
      const hidden = () => {
        if (isTop) { const sym = `${U.P}.h.${data.length}`; dataSym(sym, word(0)); return { sym }; }
        return { off: newSlot() };
      };
      const lookup = (name, n) => {
        if (locals.has(name)) return locals.get(name);
        if (caps.has(name)) return caps.get(name);
        if (U.globals.has(name)) return U.globals.get(name);
        fail(`variável "${bare(name)}" não encontrada`, n);
      };
      const loadSlot = (v, r = RAX) => {
        if (v.cap !== undefined) { A.load(r, RBP, envOff); A.load(r, r, 8 + 8 * v.cap); return; }
        if (v.sym) A.loadSym(r, v.sym); else A.load(r, RBP, v.off);
      };
      const storeSlot = (v, r = RAX) => (v.sym ? A.storeSym(v.sym, r) : A.store(RBP, v.off, r));
      const loadV = (v) => { loadSlot(v); if (v.celled) A.load(RAX, RAX, 0); };
      // grava RAX na variável; numa declaração, uma variável com célula ganha uma célula nova
      const storeV = (v, decl) => {
        if (!v.celled) { storeSlot(v); return; }
        if (decl) { A.push(RAX); A.call(rtCall("rt_cell")); A.addImm(RSP, 8); storeSlot(v); return; }
        loadSlot(v, RCX); A.store(RCX, 0, RAX);
      };

      A.bind(label);
      A.push(RBP); A.mov(RBP, RSP);
      A.subImm(RSP, 0);
      const frameAt = A.pos - 4;
      // parâmetros com célula (endereço tomado com &): a célula substitui o valor
      for (const [, v] of locals) if (v.off > 0 && v.celled) { A.load(RAX, RBP, v.off); A.push(RAX); A.call(rtCall("rt_cell")); A.addImm(RSP, 8); A.store(RBP, v.off, RAX); }
      // função com defer: registro no quadro (ver rt/panico.caju) ligado a rt_dtop
      const hasDefer = (function find(n) {
        if (!n || typeof n !== "object") return false;
        if (Array.isArray(n)) return n.some(find);
        if (n.kind === "Adia") return true;
        if (n.kind === "FuncLit" || n.kind === "Função") return false;
        return Object.keys(n).some((k) => k !== "ty" && typeof n[k] === "object" && find(n[k]));
      })(body);
      let rec = null, landing = null;
      const recAddr = (r = RAX) => { if (rec.sym) A.lea(r, rec.sym); else A.rm([0x8D], r, RBP, rec.off, 1); };
      if (hasDefer) {
        landing = A.label();
        if (isTop) { rec = { sym: `${U.P}.dr` }; dataSym(rec.sym, new Array(48).fill(0)); }
        else { for (let i = 0; i < 6; i++) rec = { off: newSlot() }; }
        recAddr(RCX);
        A.loadSym(RAX, "r.g.rt_dtop"); A.store(RCX, 0, RAX);
        A.movImm(RAX, 0); A.store(RCX, 8, RAX);
        A.store(RCX, 16, RBP);
        A.lea(RAX, landing); A.store(RCX, 24, RAX);
        A.loadSym(RAX, "r.g.rt_depth"); A.store(RCX, 32, RAX);
        A.storeSym("r.g.rt_dtop", RCX);
      }
      // resultados com nome começam com o valor zero
      if (rnames) rnames.forEach((nm, i) => { A.lea(RAX, desc(resultsOfT(retT)[i], fnode)); A.push(RAX); A.call(rtCall("rt_zero")); A.addImm(RSP, 8); storeV(locals.get(nm), true); });
      const exitL = A.label();
      const loops = [];              // { brk, cont, label }
      const where = (n) => `${fileNames[locFile(n.line)] || "main.caju"}, linha ${locLine(n.line)}`;
      const whereArg = (n) => { A.lea(RAX, strLit(where(n))); A.push(RAX); };
      // erro ao rodar: o runtime escreve a mensagem e termina
      function failHere(n, msg) { whereArg(n); A.lea(RAX, strLit(msg)); A.push(RAX); A.call(rtCall("rt_fail")); }
      // chama uma função do runtime com os argumentos já empilhados
      const rt = (name, nargs) => { A.call(rtCall(name)); if (nargs) A.addImm(RSP, 8 * nargs); };
      const pushDesc = (t, n) => { A.lea(RAX, desc(t, n)); A.push(RAX); };

      // ---- expressões: valor em RAX ----
      function truthy(t, n) {
        if (isIfaceT(t)) { A.push(RAX); rt("rt_truthy", 1); return; }
        const c = cls(t, n);
        if (c === "f") {
          A.movqX(0, RAX); A.rr([0x0F, 0x57], 1, 1, 0, [0x66]);
          A.ucomisd(0, 1); A.setcc(CC.ne, RAX); A.setcc(CC.p, RCX); A.rr([0x08], RCX, RAX, 0); A.movzxb(RAX, RAX);
        } else if (c === "s") { A.load(RAX, RAX, 0); A.alu("test", RAX, RAX); A.setcc(CC.ne); A.movzxb(RAX, RAX); }
        else { A.alu("test", RAX, RAX); A.setcc(CC.ne); A.movzxb(RAX, RAX); }
      }
      function toStr(t, n) {
        const c = cls(t, n);
        if (c === "s") return;
        A.push(RAX);
        if (c === "p") { pushDesc(t, n); rt("rt_val_str", 2); return; }
        if (c === "f") A.call(rtCall("rt_num_str"));
        else if (dflt(t) === "bool") A.call(rtCall("rt_bool_str"));
        else A.call(rtCall(isUnsigned(t) ? "rt_uint_str" : "rt_int_str"));
        A.addImm(RSP, 8);
      }
      function exprTo(n, t) { expr(n); coerce(n.ty, t, n); }
      const NONFRESH = new Set(["Variável", "Campo", "Índice", "Deref", "Afirma"]);
      const fresh = (n) => (n.kind === "Grupo" ? fresh(n.expr) : !NONFRESH.has(n.kind));
      // valor que vai ser guardado: structs e arrays são copiados (como no Go)
      function bindValue(n, t) {
        expr(n);
        if (!fresh(n) && isValueType(n.ty)) { A.push(RAX); pushDesc(n.ty, n); rt("rt_copy_val", 2); }
        coerce(n.ty, t || n.ty, n);
      }
      // conta com any: o runtime decide pelo tipo guardado (como a VM)
      const DYN_OP = { "+": 0, "-": 1, "*": 2, "/": 3, "%": 4, "**": 5, "<": 6, ">": 7, "<=": 8, ">=": 9 };
      function dynOp(n, fn = "rt_dyn_op") {
        if (!(n.op in DYN_OP)) fail(`a operação "${n.op}" com valores any ainda não é suportada`, n);
        whereArg(n); A.movImm(RAX, DYN_OP[n.op]); A.push(RAX);
        exprTo(n.left, "any"); A.push(RAX); exprTo(n.right, "any"); A.push(RAX);
        rt(fn, 4);
      }
      function intOp(op, k, n) {
        // RAX = esquerda, RCX = direita
        const uns = k >= 5 && k <= 9;
        switch (op) {
          case "+": A.alu("add", RAX, RCX); break;
          case "-": A.alu("sub", RAX, RCX); break;
          case "*": A.imul(RAX, RCX); break;
          case "&": A.alu("and", RAX, RCX); break;
          case "|": A.alu("or", RAX, RCX); break;
          case "^": A.alu("xor", RAX, RCX); break;
          case "&^": A.unary(2, RCX); A.alu("and", RAX, RCX); break;
          case "/": case "%": {
            const ok = A.label(), done = A.label();
            A.alu("test", RCX, RCX); A.jcc(CC.ne, ok);
            failHere(n, op === "/" ? "Divisão inteira por zero" : "Resto de divisão inteira por zero");
            A.bind(ok);
            if (uns) { A.rr([0x31], RDX, RDX, 0); A.unary(6, RCX); }
            else {
              const normal = A.label();
              A.cmpImm(RCX, -1); A.jcc(CC.ne, normal);
              if (op === "/") A.unary(3, RAX); else A.rr([0x31], RAX, RAX, 0);
              A.jmp(done);
              A.bind(normal); A.cqo(); A.unary(7, RCX);
            }
            if (op === "%") A.mov(RAX, RDX);
            A.bind(done);
            break;
          }
          case "<<": case ">>": {
            const ok = A.label(), small = A.label(), done = A.label();
            A.alu("test", RCX, RCX); A.jcc(CC.ns, ok);
            failHere(n, "Deslocamento negativo");
            A.bind(ok);
            A.cmpImm(RCX, 64); A.jcc(CC.l, small);
            if (op === "<<" || uns) A.rr([0x31], RAX, RAX, 0); else A.byte(0x48, 0xC1, 0xF8, 63);
            A.jmp(done);
            A.bind(small);
            A.shiftCl(op === "<<" ? 4 : uns ? 5 : 7, RAX);
            A.bind(done);
            break;
          }
          default: fail(`operação "${op}" com inteiros não suportada`, n);
        }
        wrapKind(k);
      }
      function floatOp(op, n) {
        switch (op) {
          case "+": A.sse(0x58, 0, 1); break;
          case "-": A.sse(0x5C, 0, 1); break;
          case "*": A.sse(0x59, 0, 1); break;
          case "/": case "%": {
            const ok = A.label();
            A.rr([0x0F, 0x57], 2, 2, 0, [0x66]); A.ucomisd(1, 2);
            A.jcc(CC.ne, ok); A.jcc(CC.p, ok);
            failHere(n, op === "/" ? "Divisão por zero" : "Resto de divisão por zero");
            A.bind(ok);
            if (op === "/") A.sse(0x5E, 0, 1); else fmodX87();
            break;
          }
          default: fail(`operação "${op}" com números não suportada`, n);
        }
      }
      function fmodX87() {
        A.subImm(RSP, 16);
        A.rm([0x0F, 0x11], 1, RSP, 8, 0, [0xF2]);
        A.rm([0x0F, 0x11], 0, RSP, 0, 0, [0xF2]);
        A.rm([0xDD], 0, RSP, 8, 0);
        A.rm([0xDD], 0, RSP, 0, 0);
        const again = A.label(); A.bind(again);
        A.byte(0xD9, 0xF8); A.byte(0xDF, 0xE0); A.byte(0x9E);
        A.jcc(CC.p, again);
        A.byte(0xDD, 0xD9);
        A.rm([0xDD], 3, RSP, 0, 0);
        A.rm([0x0F, 0x10], 0, RSP, 0, 0, [0xF2]);
        A.addImm(RSP, 16);
      }
      function compare(n) {
        const op = n.op, lt = n.left.ty, rtT = n.right.ty;
        if (isIfaceT(lt) || isIfaceT(rtT)) {
          if (op === "==" || op === "!=") {
            exprTo(n.left, "any"); A.push(RAX); exprTo(n.right, "any"); A.push(RAX); rt("rt_dyn_eq", 2);
            if (op === "!=") A.byte(0x48, 0x83, 0xF0, 0x01);
            return;
          }
          dynOp(n, "rt_dyn_cmp");
          return;
        }
        const lc = cls(lt, n), rc = cls(rtT, n);
        if (lc === "s" || rc === "s") {
          if (lc !== "s" || rc !== "s") { expr(n.left); expr(n.right); A.movImm(RAX, op === "!=" ? 1 : 0); return; }
          expr(n.left); A.push(RAX); expr(n.right); A.push(RAX);
          rt("rt_strcmp", 2);
          A.cmpImm(RAX, 0);
          A.setcc({ "==": CC.e, "!=": CC.ne, "<": CC.l, ">": CC.g, "<=": CC.le, ">=": CC.ge }[op]);
          A.movzxb(RAX, RAX);
          return;
        }
        if (lc === "f" || rc === "f") {
          exprTo(n.left, "num"); A.push(RAX); exprTo(n.right, "num"); A.movqX(1, RAX); A.pop(RAX); A.movqX(0, RAX);
          switch (op) {
            case "<": A.ucomisd(1, 0); A.setcc(CC.a); break;
            case "<=": A.ucomisd(1, 0); A.setcc(CC.ae); break;
            case ">": A.ucomisd(0, 1); A.setcc(CC.a); break;
            case ">=": A.ucomisd(0, 1); A.setcc(CC.ae); break;
            case "==": A.ucomisd(0, 1); A.setcc(CC.e, RAX); A.setcc(CC.np, RCX); A.rr([0x20], RCX, RAX, 0); break;
            case "!=": A.ucomisd(0, 1); A.setcc(CC.ne, RAX); A.setcc(CC.p, RCX); A.rr([0x08], RCX, RAX, 0); break;
          }
          A.movzxb(RAX, RAX);
          return;
        }
        // structs e arrays: campo a campo
        const vt = isValueType(lt) ? lt : isValueType(rtT) ? rtT : null;
        if (vt && (op === "==" || op === "!=")) {
          expr(n.left); A.push(RAX); expr(n.right); A.push(RAX); pushDesc(vt, n); rt("rt_eq", 3);
          if (op === "!=") A.byte(0x48, 0x83, 0xF0, 0x01);
          return;
        }
        expr(n.left); A.push(RAX); expr(n.right); A.mov(RCX, RAX); A.pop(RAX);
        A.alu("cmp", RAX, RCX);
        const uns = isUnsigned(lt) || isUnsigned(rtT);
        A.setcc((uns ? { "==": CC.e, "!=": CC.ne, "<": CC.b, ">": CC.a, "<=": CC.be, ">=": CC.ae }
                      : { "==": CC.e, "!=": CC.ne, "<": CC.l, ">": CC.g, "<=": CC.le, ">=": CC.ge })[op]);
        A.movzxb(RAX, RAX);
      }
      function binary(n) {
        const op = n.op;
        if (["==", "!=", "<", ">", "<=", ">="].includes(op)) { compare(n); return; }
        if (op === "+" && cls(n.ty, n) === "s") {
          expr(n.left); toStr(n.left.ty, n.left); A.push(RAX);
          expr(n.right); toStr(n.right.ty, n.right); A.push(RAX);
          rt("rt_concat", 2);
          return;
        }
        if (isIfaceT(n.left.ty) || isIfaceT(n.right.ty)) { dynOp(n); coerce("any", n.ty, n); return; }
        if (n.ik !== undefined && op !== "**") {
          expr(n.left); A.push(RAX); expr(n.right); A.mov(RCX, RAX); A.pop(RAX);
          intOp(op, n.ik, n);
          return;
        }
        exprTo(n.left, "num"); A.push(RAX); exprTo(n.right, "num");
        if (op === "**") { A.push(RAX); rt("rt_pow", 2); }
        else { A.movqX(1, RAX); A.pop(RAX); A.movqX(0, RAX); floatOp(op, n); A.movqR(RAX, 0); }
        if (cls(n.ty, n) === "i") { A.movqX(0, RAX); A.cvttsd2si(RAX, 0); wrapKind(kindCode(n.ty)); }
        else if (n.fk !== undefined) wrapKind(n.fk);
      }
      // ---- campos, índices e ponteiros ----
      // objeto de uma struct (segue os campos embutidos do caminho); erro se for um ponteiro nil
      function structObj(obj, path, name, n) {
        expr(obj);
        let t = dflt(obj.ty).replace(/^\*/, "");
        for (const p of path || []) {
          nilCheck(n, `Acesso ao campo "${p}" por um ponteiro nil`);
          A.load(RAX, RAX, 8 * fieldIndex(t, p, n));
          t = dflt(structFields(t).find((f) => f.name === p).type).replace(/^\*/, "");
        }
        nilCheck(n, `Acesso ao campo "${name}" por um ponteiro nil`);
        return t;
      }
      function nilCheck(n, msg) {
        const ok = A.label();
        A.alu("test", RAX, RAX); A.jcc(CC.ne, ok);
        failHere(n, msg);
        A.bind(ok);
      }
      // endereço do elemento obj[i] (slice, array ou texto) em RAX, com o limite conferido
      function elemAddr(n, write = false) {
        const ot = dflt(n.obj.ty).replace(/^\*/, ""), k = kindOfT(ot);
        expr(n.obj); A.push(RAX); exprTo(n.index, "int"); A.mov(RCX, RAX); A.pop(RAX);
        const ok = A.label();
        if (k === "array") {
          A.movImm(RDX, tinfo(ot).n); A.alu("cmp", RCX, RDX); A.jcc(CC.b, ok);
          whereArg(n); A.push(RCX); A.push(RDX); A.lea(RAX, strLit("do array")); A.push(RAX); rt("rt_index_fail", 4);
          A.bind(ok);
        } else {
          const notNil = A.label();
          A.alu("test", RAX, RAX); A.jcc(CC.ne, notNil);
          whereArg(n); A.push(RCX); A.movImm(RAX, write ? 1 : 0); A.push(RAX); rt("rt_nil_index", 3);
          A.bind(notNil);
          A.load(RDX, RAX, 8); A.alu("cmp", RCX, RDX); A.jcc(CC.b, ok);
          whereArg(n); A.push(RCX); A.push(RDX); A.lea(RAX, strLit("do slice")); A.push(RAX); rt("rt_index_fail", 4);
          A.bind(ok);
          A.load(RAX, RAX, 0);
        }
        A.byte(0x48, 0x8D, 0x04, 0xC8);                    // lea rax, [rax + rcx*8]
      }
      function strIndex(n) {
        expr(n.obj); A.push(RAX); exprTo(n.index, "int"); A.mov(RCX, RAX); A.pop(RAX);
        const ok = A.label();
        A.load(RDX, RAX, 0); A.alu("cmp", RCX, RDX); A.jcc(CC.b, ok);
        whereArg(n); A.push(RCX); A.push(RDX); A.lea(RAX, strLit("do texto")); A.push(RAX); rt("rt_index_fail", 4);
        A.bind(ok);
        A.byte(0x48, 0x0F, 0xB6, 0x44, 0x08, 0x08);        // movzx rax, byte [rax + rcx + 8]
      }
      function index(n) {
        const ot = dflt(n.obj.ty);
        if (ot === "str") { strIndex(n); return; }
        if (kindOfT(ot) === "map") {
          const vt = tinfo(ot).val, mh = hidden();
          expr(n.obj); storeSlot(mh); A.push(RAX); exprTo(n.index, tinfo(ot).key); A.push(RAX); rt("rt_map_find", 2);
          const miss = A.label(), done = A.label();
          A.alu("test", RAX, RAX); A.jcc(CC.s, miss);
          A.mov(RCX, RAX); loadSlot(mh); A.push(RAX); A.push(RCX); rt("rt_map_val", 2);
          A.movImm(RCX, 1);
          A.jmp(done);
          A.bind(miss);
          pushDesc(vt, n); rt("rt_zero", 1);
          A.movImm(RCX, 0);
          A.bind(done);
          return;                                         // rax = valor, rcx = achou
        }
        elemAddr(n); A.load(RAX, RAX, 0);
      }
      // endereço de um alvo (&x, &s.f, &a[i]) em RAX
      function address(a, n) {
        if (a.kind === "Grupo") return address(a.expr, n);
        if (a.kind === "NovoStruct" || a.kind === "Composto") { expr(a); if (!isValueType(a.ty)) { A.push(RAX); rt("rt_cell", 1); } return; }
        if (a.kind === "Deref") { expr(a.arg); return; }
        if (isValueType(a.ty)) { expr(a); return; }
        if (a.kind === "Variável") {
          const v = lookup(a.name, a);
          if (v.celled) { loadSlot(v); return; }
          if (v.sym) { A.lea(RAX, v.sym); return; }
          fail(`não dá para pegar o endereço de "${bare(a.name)}"`, n);
        }
        if (a.kind === "Campo") { const t = structObj(a.obj, a.path, a.name, a); A.addImm(RAX, 8 * fieldIndex(t, a.name, a)); return; }
        if (a.kind === "Índice") { elemAddr(a); return; }
        fail("não dá para pegar o endereço desta expressão", n);
      }
      function deref(n) {
        expr(n.arg);
        if (isValueType(n.ty)) { nilCheck(n, "Ponteiro nil: não aponta para nada"); return; }
        nilCheck(n, "Ponteiro nil: não aponta para nada");
        A.load(RAX, RAX, 0);
      }
      function composite(n) {
        if (n.stype) {
          const fs = structFields(n.stype);
          A.movImm(RAX, 8 * fs.length + 8); A.push(RAX); rt("rt_alloc", 1); A.push(RAX);
          fs.forEach((d, i) => {
            const given = n.sfields.find((f) => f.name === d.name);
            if (given) bindValue(given.value, d.type); else { pushDesc(d.type, n); rt("rt_zero", 1); }
            A.load(RCX, RSP, 0); A.store(RCX, 8 * i, RAX);
          });
          A.pop(RAX);
          return;
        }
        const ti = tinfo(dflt(n.type));
        if (ti.k === "slice" || ti.k === "array") {
          const cnt = ti.k === "array" ? ti.n : n.elems.length;
          A.movImm(RAX, 8 * cnt + 8); A.push(RAX); rt("rt_alloc", 1); A.push(RAX);
          for (let i = 0; i < cnt; i++) {
            if (i < n.elems.length) bindValue(n.elems[i].value, ti.elem); else { pushDesc(ti.elem, n); rt("rt_zero", 1); }
            A.load(RCX, RSP, 0); A.store(RCX, 8 * i, RAX);
          }
          if (ti.k === "slice") { A.movImm(RAX, cnt); A.push(RAX); A.push(RAX); rt("rt_hdr", 3); } else A.pop(RAX);
          return;
        }
        if (ti.k === "map") {
          A.movImm(RAX, keyKind(ti.key)); A.push(RAX); rt("rt_map_new", 1); A.push(RAX);
          for (const e of n.elems) {
            whereArg(n); A.load(RAX, RSP, 8); A.push(RAX);
            exprTo(e.key, ti.key); A.push(RAX); bindValue(e.value, ti.val); A.push(RAX);
            rt("rt_map_set", 4);
          }
          A.pop(RAX);
          return;
        }
        fail("literal ainda não suportado", n);
      }
      function fatia(n) {
        const ot = dflt(n.obj.ty), k = ot === "str" ? "str" : kindOfT(ot.replace(/^\*/, ""));
        whereArg(n);
        expr(n.obj); A.push(RAX);
        if (k === "array") { A.movImm(RAX, tinfo(ot.replace(/^\*/, "")).n); A.push(RAX); }
        if (n.lo) exprTo(n.lo, "int"); else A.movImm(RAX, 0);
        A.push(RAX);
        if (n.hi) exprTo(n.hi, "int"); else A.movImm(RAX, -1);
        A.push(RAX);
        if (k === "str") rt("rt_sub_str", 4);
        else if (k === "array") rt("rt_sub_array", 5);
        else rt("rt_sub_slice", 4);
      }
      // ---- chamadas ----
      function call(n) {
        const nm = n.name;
        if (n.callKind === "builtin") return builtin(n);
        if (n.callKind === "conv") return conversion(n, n.convTo, n.args[0]);
        if (n.callKind === "func") {
          const f = U.funcs.get(nm);
          if (!f) fail(`função ${bare(nm)} não encontrada`, n);
          const pt = paramTypes(f);
          n.args.forEach((a, i) => { bindValue(a, pt[i]); A.push(RAX); });
          callUser(U, nm, n, n.args.length);
          return;
        }
        if (n.callKind === "extern") {
          const e = U.externs.get(nm);
          if (target !== "windows") fail(`chamadas a DLL (${e.symbol}) só existem no Windows`, n);
          e.params.forEach((p, i) => { exprTo(n.args[i], FFI_LANG[p.type] || "int"); A.push(RAX); });
          A.call(externThunk(e));
          if (e.params.length) A.addImm(RSP, 8 * e.params.length);
          return;
        }
        if (n.callKind === "value") {
          const v = lookup(nm, n);
          callValue(n, () => loadV(v), v.t, n.args);
          return;
        }
        fail(`chamada de ${bare(nm)} ainda não suportada`, n);
      }
      // chamada de um valor função: [código, células...]; o objeto vai empilhado antes dos argumentos
      function callValue(n, loadFn, ft, args) {
        if (!isFuncT(ft)) fail("chamar um valor any como função ainda não é suportado", n);
        const ps = tinfo(dflt(ft)).params;
        const h = hidden();
        loadFn(); storeSlot(h);
        const ok = A.label();
        A.alu("test", RAX, RAX); A.jcc(CC.ne, ok);
        whereArg(n); rt("rt_nil_call", 1);
        A.bind(ok);
        A.push(RAX);
        args.forEach((a, i) => { bindValue(a, ps[i]); A.push(RAX); });
        depthIn(n);
        A.load(RAX, RSP, 8 * args.length); A.load(RAX, RAX, 0);
        A.byte(0xFF, 0xD0);                                    // call rax
        depthOut();
        A.addImm(RSP, 8 * (args.length + 1));
      }
      function depthIn(n) {
        if (U.isRuntime) return;
        A.loadSym(RAX, "r.g.rt_depth"); A.cmpImm(RAX, 10000);
        const ok = A.label(); A.jcc(CC.l, ok);
        failHere(n, "Recursão demais: mais de 10.000 chamadas de função abertas ao mesmo tempo");
        A.bind(ok);
        A.rip([0xFF], 0, "r.g.rt_depth");
      }
      function depthOut() { if (!U.isRuntime) A.rip([0xFF], 1, "r.g.rt_depth"); }
      function callUser(U, nm, n, nargs) {
        if (!U.isRuntime) {
          A.loadSym(RAX, "r.g.rt_depth"); A.cmpImm(RAX, 10000);
          const ok = A.label(); A.jcc(CC.l, ok);
          failHere(n, "Recursão demais: mais de 10.000 chamadas de função abertas ao mesmo tempo");
          A.bind(ok);
          A.rip([0xFF], 0, "r.g.rt_depth");
          A.call(`${U.P}.f.${nm}`);
          A.rip([0xFF], 1, "r.g.rt_depth");
        } else A.call(`${U.P}.f.${nm}`);
        if (nargs) A.addImm(RSP, 8 * nargs);
      }
      function method(n) {
        if (n.callKind === "errnew") {
          exprTo(n.args[0], "str"); A.push(RAX); A.lea(RAX, desc("·errstr", n)); A.push(RAX); rt("rt_box", 2);
          return;
        }
        if (n.fieldCall) {
          const fty = structFields(fieldOwner(n)).find((f) => f.name === n.name).type;
          callValue(n, () => { const st = structObj(n.obj, n.path, n.name, n); A.load(RAX, RAX, 8 * fieldIndex(st, n.name, n)); }, fty, n.args);
          return;
        }
        if (!n.target || !U.funcs.has(n.target)) return ifaceCall(n);
        const f = U.funcs.get(n.target), pt = paramTypes(f);
        // receptor: segue os campos embutidos; por valor, o método recebe uma cópia
        expr(n.obj);
        let t = dflt(n.obj.ty).replace(/^\*/, "");
        for (const p of n.path || []) {
          nilCheck(n, `Acesso ao campo "${p}" por um ponteiro nil`);
          A.load(RAX, RAX, 8 * fieldIndex(t, p, n));
          t = dflt(structFields(t).find((x) => x.name === p).type).replace(/^\*/, "");
        }
        if (!n.recvPtr && (!fresh(n.obj) || (n.path && n.path.length))) { A.push(RAX); pushDesc(t, n); rt("rt_copy_val", 2); }
        A.push(RAX);
        n.args.forEach((a, i) => { bindValue(a, pt[i + 1]); A.push(RAX); });
        callUser(U, n.target, n, n.args.length + 1);
      }
      // struct dona do campo, depois dos campos embutidos do caminho
      function fieldOwner(n) {
        let t = dflt(n.obj.ty).replace(/^\*/, "");
        for (const p of n.path || []) t = dflt(structFields(t).find((x) => x.name === p).type).replace(/^\*/, "");
        return t;
      }
      // método chamado por uma interface: procura pelo nome no tipo guardado, na hora de rodar
      function ifaceCall(n) {
        const it = dflt(n.obj.ty);
        // num any, os argumentos vão com o tipo que têm
        const sig = allIfaces.has(it) ? allIfaces.get(it).methods.get(n.name) : { ptypes: n.args.map((x) => x.ty) };
        const ho = hidden(), he = hidden();
        expr(n.obj); storeSlot(ho);
        const argSlots = n.args.map((a, i) => { bindValue(a, sig.ptypes[i]); const h = hidden(); storeSlot(h); return h; });
        whereArg(n); loadSlot(ho); A.push(RAX); A.lea(RAX, strLit(n.name)); A.push(RAX); rt("rt_method", 3);
        storeSlot(he);
        loadSlot(ho); A.push(RAX); loadSlot(he); A.push(RAX); rt("rt_method_recv", 2);
        A.push(RAX);
        for (const h of argSlots) { loadSlot(h); A.push(RAX); }
        depthIn(n);
        loadSlot(he); A.load(RAX, RAX, 8);
        A.byte(0xFF, 0xD0);
        depthOut();
        A.addImm(RSP, 8 * (n.args.length + 1));
        // num any, o resultado ganha a caixa com o tipo que o método devolve
        if (!allIfaces.has(it) && isIfaceT(n.ty)) {
          const skip = A.label();
          A.mov(RCX, RAX); loadSlot(he); A.load(RAX, RAX, 40);
          A.alu("test", RAX, RAX); A.jcc(CC.e, skip);
          A.push(RCX); A.push(RAX); rt("rt_box", 2); A.mov(RCX, RAX);
          A.bind(skip); A.mov(RAX, RCX);
        }
      }
      function conversion(n, to, arg) {
        let mode = n.convMode;
        // conversão de um any: a VM não converte; aqui o valor sai do any no tipo pedido
        if (!mode && isIfaceT(arg.ty)) {
          if (isIfaceT(to)) { expr(arg); return; }
          if (dflt(to) === "str") mode = "fmt";
          else if (to in KIND_CODE || FLOATS.has(dflt(to))) mode = "num";
          else { exprTo(arg, to); return; }
        }
        expr(arg);
        let from = arg.ty;
        if (isIfaceT(from)) {
          if (mode === "num") { A.mov(RCX, RAX); whereArg(n); A.push(RCX); rt("rt_unbox_num", 2); from = "num"; }
          else if (mode !== "fmt") fail("esta conversão de um valor any ainda não é suportada", n);
        }
        const fc = cls(from, arg);
        switch (mode) {
          case "fmt": toStr(from, arg); return;
          case "rune": A.push(RAX); rt("rt_rune_str", 1); return;
          case "bytes": A.push(RAX); rt("rt_bytes_str", 1); return;
          case "runes": A.push(RAX); rt("rt_runes_str", 1); return;
          case "tobytes": A.push(RAX); rt("rt_str_bytes", 1); return;
          case "torunes": A.push(RAX); rt("rt_str_runes", 1); return;
          case "num": break;
          default: return;
        }
        const tc = cls(to, n);
        if (fc === "i" && tc === "i") wrapKind(kindCode(to));
        else if (fc === "i" && tc === "f") coerce(from, to, n);
        else if (fc === "f" && tc === "f") { if (dflt(to) === "float32") wrapKind(10); }
        else if (fc === "f" && tc === "i") {
          const ok = A.label();
          A.movqX(0, RAX); A.cvttsd2si(RAX, 0);
          A.movImm(RCX, -9223372036854775808n); A.alu("cmp", RAX, RCX); A.jcc(CC.ne, ok);
          A.ucomisd(0, 0); const nan = A.label(); A.jcc(CC.p, nan);
          A.movqR(RAX, 0); A.byte(0x48, 0x0F, 0xBA, 0xF0, 63);
          A.movImm(RCX, 0x7FF0000000000000n); A.alu("cmp", RAX, RCX);
          A.movImm(RAX, -9223372036854775808n);
          A.jcc(CC.ne, ok);
          A.bind(nan); A.rr([0x31], RAX, RAX, 0);
          A.bind(ok);
          wrapKind(kindCode(to));
        }
      }
      function builtin(n) {
        const nm = n.name, args = n.args;
        switch (nm) {
          case "print": {
            // avalia tudo antes de escrever, como a VM
            const vals = [];
            const simple = args.every((a) => ["Número", "Texto", "Booleano", "Variável", "Nil"].includes(a.kind));
            args.forEach((a) => {
              if (a.ty && a.ty.startsWith("(")) { const items = resultsOfT(a.ty); unpackCall(a).forEach((h, j) => vals.push({ h, t: items[j], n: a })); return; }
              if (simple) { vals.push({ a, t: a.ty, n: a }); return; }
              expr(a); const h = hidden(); storeSlot(h); vals.push({ h, t: a.ty, n: a });
            });
            vals.forEach(({ h, a, t, n: an }, i) => {
              if (i > 0) A.call(rtCall("rt_out_space"));
              if (h) loadSlot(h); else expr(a);
              A.push(RAX);
              const c = cls(t, an);
              if (c === "p") { pushDesc(t, an); rt("rt_out_val", 2); return; }
              rt(c === "s" ? "rt_out_str" : c === "f" ? "rt_out_num" : dflt(t) === "bool" ? "rt_out_bool" : isUnsigned(t) ? "rt_out_uint" : "rt_out_int", 1);
            });
            A.call(rtCall("rt_out_nl"));
            return;
          }
          case "sleep":
            whereArg(n); exprTo(args[0], "num"); A.push(RAX); rt("rt_sleep", 2);
            return;
          case "len": case "cap": {
            const t = dflt(args[0].ty).replace(/^\*/, ""), k = t === "str" ? "str" : kindOfT(t);
            if (k === "array") { expr(args[0]); A.movImm(RAX, tinfo(t).n); return; }
            expr(args[0]);
            if (k === "str") { A.load(RAX, RAX, 0); return; }
            A.push(RAX);
            rt(k === "map" ? "rt_map_len" : nm === "len" ? "rt_slen" : "rt_scap", 1);
            return;
          }
          case "append": {
            const ed = tinfo(dflt(n.appendT)).elem;
            if (args.spread) {
              const h = hidden();
              expr(args[0]); A.push(RAX);
              expr(args[1]);
              if (dflt(args[1].ty) === "str") { A.push(RAX); rt("rt_str_bytes", 1); }
              storeSlot(h);
              A.push(RAX); rt("rt_sdata", 1); A.push(RAX);
              loadSlot(h); A.push(RAX); rt("rt_slen", 1); A.push(RAX);
              pushDesc(ed, n); rt("rt_append", 4);
              return;
            }
            const k = args.length - 1;
            expr(args[0]); A.push(RAX);
            A.movImm(RAX, 8 * k + 8); A.push(RAX); rt("rt_alloc", 1); A.push(RAX);
            args.slice(1).forEach((a, i) => { bindValue(a, ed); A.load(RCX, RSP, 0); A.store(RCX, 8 * i, RAX); });
            A.movImm(RAX, k); A.push(RAX); pushDesc(ed, n); rt("rt_append", 4);
            return;
          }
          case "copy": {
            expr(args[0]); A.push(RAX); expr(args[1]); A.push(RAX);
            if (dflt(args[1].ty) === "str") { rt("rt_copy_str", 2); return; }
            pushDesc(tinfo(dflt(args[0].ty)).elem, n); rt("rt_copy_slice", 3);
            return;
          }
          case "delete": expr(args[0]); A.push(RAX); exprTo(args[1], tinfo(dflt(args[0].ty)).key); A.push(RAX); rt("rt_map_del", 2); return;
          case "make": {
            const t = dflt(n.typeArg), ti = tinfo(t);
            if (ti.k === "map") { A.movImm(RAX, keyKind(ti.key)); A.push(RAX); rt("rt_map_new", 1); return; }
            if (ti.k !== "slice") fail(`make(${showT(t)}) ainda não é suportado`, n);
            const nh = hidden(), ch = hidden();
            exprTo(args[0], "int"); storeSlot(nh);
            if (args[1]) exprTo(args[1], "int");
            storeSlot(ch);
            whereArg(n); loadSlot(nh); A.push(RAX); loadSlot(ch); A.push(RAX); rt("rt_make_check", 3);
            pushDesc(ti.elem, n); loadSlot(nh); A.push(RAX); loadSlot(ch); A.push(RAX);
            rt("rt_make_slice", 3);
            return;
          }
          case "new": {
            const t = n.typeArg;
            pushDesc(t, n); rt("rt_zero", 1);
            if (!isValueType(t)) { A.push(RAX); rt("rt_cell", 1); }
            return;
          }
        }
        if (nm === "panic") { whereArg(n); exprTo(args[0], "any"); A.push(RAX); rt("rt_panic_val", 2); return; }
        if (nm === "recover") { rt("rt_recover", 0); return; }
        if (!U.isRuntime) fail(`a função ${nm} ainda não é suportada`, n);
        // operações de baixo nível do runtime
        const two = () => { expr(args[0]); A.push(RAX); expr(args[1]); A.mov(RCX, RAX); A.pop(RAX); };
        switch (nm) {
          case "__load8": expr(args[0]); A.byte(0x48, 0x0F, 0xB6, 0x00); return;
          case "__load64": expr(args[0]); A.byte(0x48, 0x8B, 0x00); return;
          case "__store8": two(); A.byte(0x88, 0x08); return;
          case "__store64": two(); A.byte(0x48, 0x89, 0x08); return;
          case "__strp": case "__pstr": case "__fbits": case "__bitsf": expr(args[0]); return;
          case "__argp": A.loadSym(RAX, "g.argp"); return;
          case "__sp": A.mov(RAX, RSP); return;
          case "__sqrt": expr(args[0]); A.movqX(0, RAX); A.sse(0x51, 0, 0); A.movqR(RAX, 0); return;
          case "__fmod": expr(args[0]); A.push(RAX); expr(args[1]); A.movqX(1, RAX); A.pop(RAX); A.movqX(0, RAX); fmodX87(); A.movqR(RAX, 0); return;
          case "__calldefer": expr(args[0]); A.push(RAX); A.call("rt.calldefer"); A.addImm(RSP, 8); return;
          case "__jump": two(); A.mov(RBP, RAX); A.byte(0xFF, 0xE1); return;          // mov rbp, rax; jmp rcx
          case "__syscall": {
            args.forEach((a) => { expr(a); A.push(RAX); });
            for (const r of [R9, R8, R10, RDX, RSI, RDI, RAX]) A.pop(r);
            A.byte(0x0F, 0x05);
            return;
          }
        }
        fail(`função ${nm} não suportada`, n);
      }
      // closure nova: [código, células das variáveis capturadas]
      function makeClosure(fnode, n) {
        const label = `${U.P}.l.${lits.length}`;
        const capsList = fnode.captures || [];
        lits.push({ U, label, fnode, capTypes: capsList.map((nm) => lookup(nm, n).t) });
        A.movImm(RAX, 8 + 8 * capsList.length); A.push(RAX); rt("rt_alloc", 1);
        const h = hidden(); storeSlot(h);
        A.lea(RCX, label); A.store(RAX, 0, RCX);
        capsList.forEach((nm, i) => {
          const v = lookup(nm, n);
          if (v.sym) {
            // global capturada pelo código de topo: pega a célula (cria se ainda não existe)
            if (!v.celled) fail(`"${bare(nm)}" não pôde ser capturada pela função`, n);
            A.lea(RAX, v.sym); A.push(RAX); rt("rt_cellref", 1);
          } else {
            if (!v.celled) fail(`"${bare(nm)}" não pôde ser capturada pela função`, n);
            loadSlot(v);
          }
          loadSlot(h, RCX); A.store(RCX, 8 + 8 * i, RAX);
        });
        loadSlot(h);
      }
      // método como valor (c.deposita): o receptor fica preso na closure
      function boundMethod(n) {
        const f = U.funcs.get(n.boundMethod);
        expr(n.obj);
        let t = dflt(n.obj.ty).replace(/^\*/, "");
        for (const p of n.path || []) {
          nilCheck(n, `Acesso ao campo "${p}" por um ponteiro nil`);
          A.load(RAX, RAX, 8 * fieldIndex(t, p, n));
          t = dflt(structFields(t).find((x) => x.name === p).type).replace(/^\*/, "");
        }
        if (!n.recvPtr) { A.push(RAX); pushDesc(f.ptypes[0], n); rt("rt_copy_val", 2); }
        const h = hidden(); storeSlot(h);
        A.movImm(RAX, 16); A.push(RAX); rt("rt_alloc", 1);
        A.lea(RCX, boundThunk(U, f)); A.store(RAX, 0, RCX);
        loadSlot(h, RCX); A.store(RAX, 8, RCX);
      }
      let tmpLoad = null;
      function expr(n) {
        switch (n.kind) {
          case "·tmp": loadSlot(tmpLoad); return;
          case "Número":
            if (cls(n.ty, n) === "f") { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, n.value, true); A.movImm(RAX, b.getBigInt64(0, true)); }
            else A.movImm(RAX, BigInt(Math.trunc(n.value)));
            return;
          case "Texto": A.lea(RAX, strLit(n.value)); return;
          case "Booleano": A.movImm(RAX, n.value ? 1 : 0); return;
          case "Nil": A.movImm(RAX, 0); return;
          case "Grupo": expr(n.expr); coerce(n.expr.ty, n.ty, n); return;
          case "Variável": {
            if (n.fnRef) { A.lea(RAX, staticClosure(U, n.name, n)); return; }
            loadV(lookup(n.name, n));
            return;
          }
          case "Negação":
            if (isIfaceT(n.arg.ty)) { whereArg(n); expr(n.arg); A.push(RAX); rt("rt_dyn_neg", 2); coerce("any", n.ty, n); return; }
            expr(n.arg);
            if (cls(n.ty, n) === "f") { coerce(n.arg.ty, n.ty, n); A.byte(0x48, 0x0F, 0xBA, 0xF8, 63); }
            else { A.unary(3, RAX); wrapKind(kindCode(n.ty)); }
            return;
          case "NãoBits": expr(n.arg); A.unary(2, RAX); wrapKind(kindCode(n.ty)); return;
          case "Não": expr(n.arg); truthy(n.arg.ty, n.arg); A.byte(0x48, 0x83, 0xF0, 0x01); return;
          case "Lógica": {
            const end = A.label();
            expr(n.left); truthy(n.left.ty, n.left);
            A.alu("test", RAX, RAX); A.jcc(n.op === "and" ? CC.e : CC.ne, end);
            expr(n.right); truthy(n.right.ty, n.right);
            A.bind(end);
            return;
          }
          case "Binária": binary(n); return;
          case "Chamada": call(n); return;
          case "ChamadaMétodo": method(n); return;
          case "NovoStruct": case "Composto": composite(n); return;
          case "Campo": {
            if (n.boundMethod) { boundMethod(n); return; }
            const t = structObj(n.obj, n.path, n.name, n);
            A.load(RAX, RAX, 8 * fieldIndex(t, n.name, n));
            return;
          }
          case "Índice": index(n); return;
          case "Fatia": fatia(n); return;
          case "FuncLit": makeClosure(n.fn, n); return;
          case "ChamadaValor": callValue(n, () => expr(n.fn), n.fn.ty, n.args); return;
          case "Afirma": {
            whereArg(n); expr(n.obj); A.push(RAX); pushDesc(n.type, n); A.movImm(RAX, n.commaOk ? 1 : 0); A.push(RAX);
            rt("rt_assert", 4);
            if (n.commaOk) A.loadSym(RCX, "r.g.rt_ok");
            return;
          }
          case "Endereço": address(n.arg, n); return;
          case "Deref": deref(n); return;
          case "Conversão": conversion(n, n.type, n.args[0]); return;
        }
        fail(`${n.kind} ainda não é suportado`, n);
      }

      // ---- instruções ----
      function assignVar(name, valueNode, n, decl) {
        if (name === "_") { expr(valueNode); return; }
        const v = lookup(name, n);
        if (!decl && isValueType(v.t)) {
          // struct ou array que já existe: copia por cima (ponteiros para ela continuam valendo)
          loadV(v); A.push(RAX); bindValue(valueNode, v.t); A.push(RAX); pushDesc(v.t, n); rt("rt_copy_into", 3);
          return;
        }
        if (valueNode === null) { pushDesc(v.t, n); rt("rt_zero", 1); }
        else bindValue(valueNode, v.t);
        storeV(v, decl);
      }
      // grava RAX num alvo já preparado (variável, índice, campo ou *p)
      function prepTarget(t) {
        if (t.kind === "Variável") return { t };
        const h = hidden();
        if (t.kind === "Índice") {
          if (kindOfT(dflt(t.obj.ty)) === "map") {
            expr(t.obj); storeSlot(h);
            const k = hidden(); exprTo(t.index, tinfo(dflt(t.obj.ty)).key); storeSlot(k);
            return { t, map: h, key: k };
          }
          elemAddr(t, true); storeSlot(h); return { t, addr: h };
        }
        if (t.kind === "Campo") { const st = structObj(t.obj, t.path, t.name, t); A.addImm(RAX, 8 * fieldIndex(st, t.name, t)); storeSlot(h); return { t, addr: h }; }
        if (t.kind === "Deref") { expr(t.arg); nilCheck(t, "Ponteiro nil: não aponta para nada"); storeSlot(h); return { t, addr: h, deref: true }; }
        fail("alvo de atribuição não suportado", t);
      }
      function storeTarget(p, decl, n) {
        const t = p.t;
        if (t.kind === "Variável") {
          if (t.name === "_") return;
          const v = lookup(t.name, t);
          if (!decl && isValueType(v.t)) { A.push(RAX); loadV(v); A.pop(RCX); A.push(RAX); A.push(RCX); pushDesc(v.t, t); rt("rt_copy_into", 3); return; }
          storeV(v, decl);
          return;
        }
        if (p.map) {
          A.push(RAX); A.pop(RCX);
          whereArg(n); loadSlot(p.map); A.push(RAX); loadSlot(p.key); A.push(RAX); A.push(RCX); rt("rt_map_set", 4);
          return;
        }
        if (isValueType(t.ty) && !p.deref) {
          A.mov(RCX, RAX); loadSlot(p.addr); A.load(RAX, RAX, 0); A.push(RAX); A.push(RCX); pushDesc(t.ty, t); rt("rt_copy_into", 3);
          return;
        }
        if (p.deref && isValueType(t.ty)) { A.mov(RCX, RAX); loadSlot(p.addr); A.push(RAX); A.push(RCX); pushDesc(t.ty, t); rt("rt_copy_into", 3); return; }
        loadSlot(p.addr, RCX); A.store(RCX, 0, RAX);
      }
      // a, b = b, a e v, ok := m[k]: avalia tudo antes de gravar, como no Go
      // chamada com vários resultados: o 1º vem em RAX, os outros em g.ret; tudo vai para lugares escondidos
      function unpackCall(v) {
        expr(v);
        const k = resultsOfT(v.ty).length;
        const hs = [];
        for (let i = 0; i < k; i++) {
          const h = hidden();
          if (i > 0) { A.lea(RCX, "g.ret"); A.load(RAX, RCX, 8 * i); }
          storeSlot(h); hs.push(h);
          if (i === 0) A.push(RAX), A.pop(RAX);
        }
        return hs;
      }
      function multi(targets, values, decl, n) {
        const prep = targets.map((t) => (typeof t === "string" ? { t: { kind: "Variável", name: t, line: n.line } } : prepTarget(t)));
        const vals = targets.map(() => hidden());
        if (values.length === targets.length) {
          values.forEach((v, i) => {
            const tt = prep[i].t.kind === "Variável" && prep[i].t.name !== "_" ? lookup(prep[i].t.name, n).t : prep[i].t.ty;
            bindValue(v, tt); storeSlot(vals[i]);
          });
        } else {
          const v = values[0];
          if ((v.kind === "Índice" || v.kind === "Afirma") && v.commaOk) { expr(v); storeSlot(vals[0]); A.mov(RAX, RCX); A.movzxb(RAX, RAX); storeSlot(vals[1]); }
          else if (v.unpack) {
            const items = resultsOfT(v.ty);
            unpackCall(v).forEach((h, i) => {
              const p = prep[i];
              const tt = p.t.kind === "Variável" ? (p.t.name === "_" ? items[i] : lookup(p.t.name, n).t) : p.t.ty;
              loadSlot(h); coerce(items[i], tt, n); storeSlot(vals[i]);
            });
          }
          else fail("vários resultados de um valor any ainda não são suportados", n);
        }
        prep.forEach((p, i) => { loadSlot(vals[i]); storeTarget(p, decl, n); });
      }
      // defer: a closure e os argumentos são avaliados agora e guardados num nó da lista do registro
      function deferStmt(n) {
        const c = n.call;
        const parts = [];          // lugares escondidos: a closure primeiro, depois os argumentos
        const keep = () => { const h = hidden(); storeSlot(h); parts.push(h); };
        const args = (as, ts) => as.forEach((a, i) => { bindValue(a, ts ? ts[i] : a.ty); keep(); });
        if (c.kind === "Chamada" && c.callKind === "func") {
          A.lea(RAX, staticClosure(U, c.name, c)); keep(); args(c.args, paramTypes(U.funcs.get(c.name)));
        } else if (c.kind === "Chamada" && c.callKind === "value") {
          const v = lookup(c.name, c); loadV(v); keep(); args(c.args, isFuncT(v.t) ? tinfo(dflt(v.t)).params : null);
        } else if (c.kind === "ChamadaValor") {
          expr(c.fn); keep(); args(c.args, isFuncT(c.fn.ty) ? tinfo(dflt(c.fn.ty)).params : null);
        } else if (c.kind === "ChamadaMétodo" && c.target && U.funcs.has(c.target)) {
          const f = U.funcs.get(c.target), pt = paramTypes(f);
          A.lea(RAX, staticClosure(U, c.target, c)); keep();
          expr(c.obj);
          let t = dflt(c.obj.ty).replace(/^\*/, "");
          for (const p of c.path || []) {
            nilCheck(c, `Acesso ao campo "${p}" por um ponteiro nil`);
            A.load(RAX, RAX, 8 * fieldIndex(t, p, c));
            t = dflt(structFields(t).find((x) => x.name === p).type).replace(/^\*/, "");
          }
          if (!c.recvPtr && (!fresh(c.obj) || (c.path && c.path.length))) { A.push(RAX); pushDesc(t, c); rt("rt_copy_val", 2); }
          keep();
          args(c.args, pt.slice(1));
        } else if (c.kind === "ChamadaMétodo" && c.fieldCall) {
          const fty = structFields(fieldOwner(c)).find((f) => f.name === c.name).type;
          const st = structObj(c.obj, c.path, c.name, c); A.load(RAX, RAX, 8 * fieldIndex(st, c.name, c)); keep();
          args(c.args, isFuncT(fty) ? tinfo(dflt(fty)).params : null);
        } else if (c.kind === "ChamadaMétodo" && c.callKind !== "errnew") {
          // método por interface: escolhido agora; a closure é [código] e o receptor vai como 1º argumento
          const it = dflt(c.obj.ty);
          const sig = allIfaces.has(it) ? allIfaces.get(it).methods.get(c.name) : { ptypes: c.args.map((x) => x.ty) };
          const ho = hidden(), he = hidden();
          expr(c.obj); storeSlot(ho);
          whereArg(c); loadSlot(ho); A.push(RAX); A.lea(RAX, strLit(c.name)); A.push(RAX); rt("rt_method", 3); storeSlot(he);
          A.movImm(RAX, 8); A.push(RAX); rt("rt_alloc", 1); A.mov(RCX, RAX); loadSlot(he); A.load(RAX, RAX, 8); A.store(RCX, 0, RAX); A.mov(RAX, RCX); keep();
          loadSlot(ho); A.push(RAX); loadSlot(he); A.push(RAX); rt("rt_method_recv", 2); keep();
          args(c.args, sig.ptypes);
        } else {
          // print, panic, close...: uma função de embrulho com os argumentos já avaliados
          const params = c.args.map((_, i) => `·a${i}`);
          const call = { ...c, args: c.args.map((a, i) => ({ kind: "Variável", name: params[i], ty: a.ty, line: c.line, col: c.col })) };
          const wrapper = { kind: "Função", name: `·embrulho${lits.length}`, params, ptypes: c.args.map((a) => a.ty), rtype: "void", retTy: "void",
            body: { kind: "Bloco", body: [{ kind: "Expressão", expr: call, line: c.line, col: c.col }] }, line: c.line, col: c.col };
          makeClosure(wrapper, c); keep();
          args(c.args, null);
        }
        // closure nil: erro já no defer, como na VM
        const ok = A.label();
        loadSlot(parts[0]); A.alu("test", RAX, RAX); A.jcc(CC.ne, ok);
        whereArg(n); rt("rt_defer_nil", 1);
        A.bind(ok);
        const k = parts.length - 1;
        A.movImm(RAX, 8 * (3 + k)); A.push(RAX); rt("rt_alloc", 1);
        A.mov(RCX, RAX);
        recAddr(RDX); A.load(RAX, RDX, 8); A.store(RCX, 0, RAX); A.store(RDX, 8, RCX);
        A.push(RCX);
        loadSlot(parts[0]); A.load(RCX, RSP, 0); A.store(RCX, 8, RAX);
        A.movImm(RAX, k); A.store(RCX, 16, RAX);
        for (let i = 0; i < k; i++) { loadSlot(parts[i + 1]); A.load(RCX, RSP, 0); A.store(RCX, 24 + 8 * i, RAX); }
        A.pop(RCX);
      }
      // resultados com nome: o 1º em RAX, os outros em g.ret
      function loadResults() {
        for (let i = rnames.length - 1; i >= 0; i--) { loadV(lookup(rnames[i])); if (i > 0) { A.lea(RCX, "g.ret"); A.store(RCX, 8 * i, RAX); } }
      }
      function stmt(n) {
        switch (n.kind) {
          case "Expressão": expr(n.expr); return;
          case "Bloco": case "Módulo": n.body.forEach(stmt); return;
          case "Função": case "Externa": case "Struct": case "Interface": case "Fallthrough": return;
          case "Atribuição": assignVar(n.name, n.value, n, !!n.decl); return;
          case "Declara": multi(n.names, n.values, true, n); return;
          case "Atrib": multi(n.targets, n.values, false, n); return;
          case "AtribuiçãoCampo": {
            const t = structObj(n.obj, n.path, n.name, n);
            const off = 8 * fieldIndex(t, n.name, n);
            if (isValueType(n.fty)) { A.load(RAX, RAX, off); A.push(RAX); bindValue(n.value, n.fty); A.push(RAX); pushDesc(n.fty, n); rt("rt_copy_into", 3); return; }
            A.push(RAX); bindValue(n.value, n.fty); A.pop(RCX); A.store(RCX, off, RAX);
            return;
          }
          case "AtribOp": {
            const tg = n.target;
            if (tg.kind === "Variável") {
              const v = lookup(tg.name, n);
              const fake = { kind: "Binária", op: n.op, left: tg, right: n.value, ik: n.ik, fk: n.fk, ty: v.t, line: n.line, col: n.col };
              expr(fake); storeV(v, false);
              return;
            }
            // alvo composto: prepara uma vez, lê, calcula e grava
            const p = prepTarget(tg);
            const cur = hidden();
            if (p.map) {
              loadSlot(p.map); A.push(RAX); loadSlot(p.key); A.push(RAX); rt("rt_map_find", 2);
              const miss = A.label(), got = A.label();
              A.alu("test", RAX, RAX); A.jcc(CC.s, miss);
              A.push(RAX); loadSlot(p.map); A.pop(RCX); A.push(RAX); A.push(RCX); rt("rt_map_val", 2); A.jmp(got);
              A.bind(miss); pushDesc(tg.ty, n); rt("rt_zero", 1);
              A.bind(got);
            } else { loadSlot(p.addr); A.load(RAX, RAX, 0); }
            storeSlot(cur);
            tmpLoad = cur;
            const fake = { kind: "Binária", op: n.op, left: { kind: "·tmp", ty: tg.ty }, right: n.value, ik: n.ik, fk: n.fk, ty: tg.ty, line: n.line, col: n.col };
            expr(fake);
            storeTarget(p, false, n);
            return;
          }
          case "Se": {
            const els = A.label(), end = A.label();
            if (n.init) stmt(n.init);
            expr(n.cond); truthy(n.cond.ty, n.cond); A.alu("test", RAX, RAX); A.jcc(CC.e, els);
            stmt(n.then);
            if (n.otherwise) { A.jmp(end); A.bind(els); stmt(n.otherwise); A.bind(end); }
            else A.bind(els);
            return;
          }
          case "Enquanto": {
            const top = A.label(), end = A.label();
            loops.push({ brk: end, cont: top, label: n.label });
            A.bind(top);
            expr(n.cond); truthy(n.cond.ty, n.cond); A.alu("test", RAX, RAX); A.jcc(CC.e, end);
            stmt(n.body); A.jmp(top); A.bind(end);
            loops.pop();
            return;
          }
          case "ParaC": {
            const top = A.label(), next = A.label(), end = A.label();
            if (n.init) stmt(n.init);
            loops.push({ brk: end, cont: next, label: n.label });
            A.bind(top);
            if (n.cond) { expr(n.cond); truthy(n.cond.ty, n.cond); A.alu("test", RAX, RAX); A.jcc(CC.e, end); }
            stmt(n.body);
            A.bind(next);
            // variável do laço capturada por uma closure: cada volta tem a sua célula (Go 1.22)
            const lv = !n.init ? [] : n.init.kind === "Atribuição" && n.init.decl ? [n.init.name] : n.init.kind === "Declara" ? n.init.names : [];
            for (const nm of lv) {
              const v = nm !== "_" && lookup(nm, n);
              if (v && v.celled) { loadV(v); A.push(RAX); rt("rt_cell", 1); storeSlot(v); }
            }
            if (n.post) stmt(n.post);
            A.jmp(top); A.bind(end);
            loops.pop();
            return;
          }
          case "Para": return paraNum(n);
          case "Adia": return deferStmt(n);
          case "TipoSwitch": {
            const end = A.label();
            if (n.init) stmt(n.init);
            const sv = hidden();
            exprTo(n.subject, "any"); storeSlot(sv);
            const bodies = n.cases.map(() => A.label());
            let defIdx = -1;
            n.cases.forEach((c, i) => {
              if (!c.types) { defIdx = i; return; }
              for (const t of c.types) {
                loadSlot(sv);
                if (t !== "nil") { A.push(RAX); pushDesc(t, c); rt("rt_type_is", 2); A.alu("test", RAX, RAX); A.jcc(CC.ne, bodies[i]); }
                else { A.alu("test", RAX, RAX); A.jcc(CC.e, bodies[i]); }
              }
            });
            A.jmp(defIdx >= 0 ? bodies[defIdx] : end);
            loops.push({ brk: end, cont: null, label: n.label });
            n.cases.forEach((c, i) => {
              A.bind(bodies[i]);
              if (n.bind && n.bind !== "_") {
                loadSlot(sv);
                const t = c.types && c.types.length === 1 ? c.types[0] : null;
                if (t && t !== "nil" && !isIfaceT(t)) A.load(RAX, RAX, 8);
                storeV(lookup(n.bind, n), true);
              }
              c.body.forEach(stmt);
              A.jmp(end);
            });
            loops.pop();
            A.bind(end);
            return;
          }
          case "Range": return range(n);
          case "Quebra": case "Continua": {
            const l = n.label ? [...loops].reverse().find((x) => x.label === n.label) : n.kind === "Continua" ? [...loops].reverse().find((x) => x.cont) : loops[loops.length - 1];
            if (!l || (n.kind === "Continua" && !l.cont)) fail("break ou continue fora de um laço", n);
            A.jmp(n.kind === "Quebra" ? l.brk : l.cont);
            return;
          }
          case "Escolha": {
            const end = A.label();
            if (n.init) stmt(n.init);
            const tagT = n.tag ? n.tag.ty : "bool";
            const tmp = hidden();
            if (n.tag) { expr(n.tag); storeSlot(tmp); }
            const bodies = n.cases.map(() => A.label());
            let defIdx = -1;
            n.cases.forEach((c, i) => {
              if (!c.exprs) { defIdx = i; return; }
              for (const e of c.exprs) {
                if (n.tag) { tmpLoad = tmp; compare({ kind: "Binária", op: "==", left: { kind: "·tmp", ty: tagT }, right: e, ty: "bool", line: e.line, col: e.col }); }
                else { expr(e); truthy(e.ty, e); }
                A.alu("test", RAX, RAX); A.jcc(CC.ne, bodies[i]);
              }
            });
            A.jmp(defIdx >= 0 ? bodies[defIdx] : end);
            loops.push({ brk: end, cont: null, label: n.label });
            n.cases.forEach((c, i) => {
              A.bind(bodies[i]);
              c.body.forEach((s) => { if (s.kind !== "Fallthrough") stmt(s); });
              const ft = c.body.length && c.body[c.body.length - 1].kind === "Fallthrough";
              A.jmp(ft && i + 1 < n.cases.length ? bodies[i + 1] : end);
            });
            loops.pop();
            A.bind(end);
            return;
          }
          case "Retorno": {
            if (isTop) fail("return fora de uma função", n);
            const vals = n.values || (n.value ? [n.value] : []);
            const want = resultsOfT(retT);
            if (!vals.length && rnames) { loadResults(); A.jmp(exitL); return; }
            if (want.length <= 1 && vals.length === 1 && !vals[0].unpack) {
              bindValue(vals[0], retT);
              if (rnames) storeV(lookup(rnames[0], n), false);       // o defer vê (e pode mudar) o resultado
              A.jmp(exitL); return;
            }
            let hs;
            if (vals.length === 1 && vals[0].unpack) {
              const items = resultsOfT(vals[0].ty);
              hs = unpackCall(vals[0]);
              hs.forEach((h, i) => { loadSlot(h); coerce(items[i], want[i], n); storeSlot(h); });
            } else hs = vals.map((v, i) => { bindValue(v, want[i]); const h = hidden(); storeSlot(h); return h; });
            if (rnames) hs.forEach((h, i) => { loadSlot(h); storeV(lookup(rnames[i], n), false); });
            for (let i = hs.length - 1; i >= 0; i--) { loadSlot(hs[i]); if (i > 0) { A.lea(RCX, "g.ret"); A.store(RCX, 8 * i, RAX); } }
            A.jmp(exitL);
            return;
          }
        }
        fail(`${n.kind} ainda não é suportado`, n);
      }
      // for i = a to b: contador, fim e passo (+1 ou -1) escondidos, como na VM
      function paraNum(n) {
        const v = lookup(n.name, n), t = v.t, f = cls(t, n) === "f";
        const c = hidden(), e = hidden(), s = hidden();
        exprTo(n.from, t); storeSlot(c); exprTo(n.to, t); storeSlot(e);
        loadSlot(c); loadSlot(e, RCX);
        if (f) { A.movqX(0, RAX); A.movqX(1, RCX); A.ucomisd(1, 0); A.setcc(CC.ae); } else { A.alu("cmp", RAX, RCX); A.setcc(CC.le); }
        A.movzxb(RAX, RAX); storeSlot(s);
        const top = A.label(), next = A.label(), end = A.label(), down = A.label(), body = A.label();
        loops.push({ brk: end, cont: next, label: n.label });
        A.bind(top);
        loadSlot(s, RDX); loadSlot(c); loadSlot(e, RCX);
        if (f) { A.movqX(0, RAX); A.movqX(1, RCX); }
        A.alu("test", RDX, RDX); A.jcc(CC.e, down);
        if (f) { A.ucomisd(1, 0); A.jcc(CC.b, end); A.jcc(CC.p, end); } else { A.alu("cmp", RAX, RCX); A.jcc(CC.g, end); }
        A.jmp(body);
        A.bind(down);
        if (f) { A.ucomisd(0, 1); A.jcc(CC.b, end); A.jcc(CC.p, end); } else { A.alu("cmp", RAX, RCX); A.jcc(CC.l, end); }
        A.bind(body);
        loadSlot(c); storeV(v, true);
        stmt(n.body);
        A.bind(next);
        loadSlot(s, RDX); loadSlot(c);
        const minus = A.label(), stored = A.label();
        A.alu("test", RDX, RDX); A.jcc(CC.e, minus);
        if (f) { A.movqX(0, RAX); A.movImm(RCX, 0x3FF0000000000000n); A.movqX(1, RCX); A.sse(0x58, 0, 1); A.movqR(RAX, 0); } else A.addImm(RAX, 1);
        A.jmp(stored);
        A.bind(minus);
        if (f) { A.movqX(0, RAX); A.movImm(RCX, 0x3FF0000000000000n); A.movqX(1, RCX); A.sse(0x5C, 0, 1); A.movqR(RAX, 0); } else A.subImm(RAX, 1);
        A.bind(stored); storeSlot(c);
        A.jmp(top); A.bind(end);
        loops.pop();
      }
      // for k, v := range x: slice, array, texto, map ou número
      function range(n) {
        const st = dflt(n.subject.ty).replace(/^\*/, ""), rk = st === "str" ? "str" : st in KIND_CODE ? "int" : kindOfT(st);
        const obj = hidden(), i = hidden(), lim = hidden();
        expr(n.subject);
        if (rk === "array" && !fresh(n.subject)) { A.push(RAX); pushDesc(st, n); rt("rt_copy_val", 2); }
        storeSlot(obj);
        A.movImm(RAX, 0); storeSlot(i);
        loadSlot(obj);
        if (rk === "slice") { A.push(RAX); rt("rt_slen", 1); }
        else if (rk === "array") A.movImm(RAX, tinfo(st).n);
        else if (rk === "str") A.load(RAX, RAX, 0);
        else if (rk === "map") { A.push(RAX); rt("rt_map_used", 1); }
        else if (rk !== "int") fail(`range sobre ${showT(n.subject.ty)} ainda não é suportado`, n);
        storeSlot(lim);
        const top = A.label(), next = A.label(), end = A.label();
        const [kv, vv] = n.vars;
        const ti = rk === "int" || rk === "str" ? null : tinfo(st);
        const kT = rk === "map" ? ti.key : "int", vT = rk === "str" ? "int32" : rk === "map" ? ti.val : ti && ti.elem;
        const put = (target, srcT) => {
          if (!target || target.name === "_") return;
          coerce(srcT, target.kind === "Variável" || !target.kind ? lookup(target.name, n).t : target.ty, n);
          storeTarget({ t: target }, n.decl, n);
        };
        loops.push({ brk: end, cont: next, label: n.label });
        A.bind(top);
        loadSlot(i); loadSlot(lim, RCX); A.alu("cmp", RAX, RCX); A.jcc(CC.ge, end);
        if (rk === "map") {
          const live = A.label();
          loadSlot(obj); A.push(RAX); loadSlot(i); A.push(RAX); rt("rt_map_live", 2);
          A.alu("test", RAX, RAX); A.jcc(CC.ne, live); A.jmp(next);
          A.bind(live);
          if (vv && vv.name !== "_") { loadSlot(obj); A.push(RAX); loadSlot(i); A.push(RAX); rt("rt_map_val", 2); put(vv, vT); }
          if (kv && kv.name !== "_") { loadSlot(obj); A.push(RAX); loadSlot(i); A.push(RAX); rt("rt_map_key", 2); put(kv, kT); }
        } else if (rk === "str") {
          const step = hidden();
          loadSlot(obj); A.addImm(RAX, 8); A.push(RAX); loadSlot(i); A.push(RAX); rt("rt_rune_at", 2);
          if (vv && vv.name !== "_") put(vv, vT);
          A.loadSym(RAX, `r.g.rt_rune_n`); storeSlot(step);
          if (kv && kv.name !== "_") { loadSlot(i); put(kv, kT); }
          stmtBody();
          A.bind(next);
          loadSlot(i); loadSlot(step, RCX); A.alu("add", RAX, RCX); storeSlot(i);
          A.jmp(top); A.bind(end); loops.pop();
          return;
        } else {
          if (vv && vv.name !== "_") {
            if (rk === "int") fail("range sobre número só tem índice", n);
            loadSlot(obj);
            if (rk === "slice") A.load(RAX, RAX, 0);
            loadSlot(i, RCX); A.byte(0x48, 0x8B, 0x04, 0xC8);   // mov rax, [rax + rcx*8]
            if (isValueType(vv.ty)) { A.push(RAX); pushDesc(vv.ty, n); rt("rt_copy_val", 2); }
            put(vv, vT);
          }
          if (kv && kv.name !== "_") { loadSlot(i); put(kv, kT); }
        }
        stmtBody();
        A.bind(next);
        loadSlot(i); A.addImm(RAX, 1); storeSlot(i);
        A.jmp(top); A.bind(end);
        loops.pop();
        function stmtBody() { stmt(n.body); }
      }

      body.forEach(stmt);
      if (isTop) A.rr([0x31], RAX, RAX, 0);
      else if (rnames) loadResults();
      let landAt = -1;
      if (hasDefer) {
        const nres = isTop ? 0 : resultsOfT(retT).length;
        const saved = Array.from({ length: Math.max(nres, 1) }, () => hidden());
        A.jmp(exitL);
        // recuperado de um panic: os resultados sem nome voltam com o valor zero
        A.bind(landing);
        A.mov(RSP, RBP); A.subImm(RSP, 0); landAt = A.pos - 4;
        recAddr(RCX); A.storeSym("r.g.rt_dtop", RCX); A.load(RAX, RCX, 32); A.storeSym("r.g.rt_depth", RAX);
        if (!rnames) {
          resultsOfT(retT).forEach((t, i) => {
            pushDesc(t, fnode); rt("rt_zero", 1);
            if (i > 0) { A.lea(RCX, "g.ret"); A.store(RCX, 8 * i, RAX); } else storeSlot(saved[0]);
          });
          if (nres) loadSlot(saved[0]);
        }
        A.bind(exitL);
        // os defers rodam do último para o primeiro; os resultados ficam guardados enquanto isso
        storeSlot(saved[0]);
        for (let i = 1; i < nres; i++) { A.lea(RCX, "g.ret"); A.load(RAX, RCX, 8 * i); storeSlot(saved[i]); }
        recAddr(); A.push(RAX); rt("rt_run_defers", 1);
        for (let i = 1; i < nres; i++) { loadSlot(saved[i]); A.lea(RCX, "g.ret"); A.store(RCX, 8 * i, RAX); }
        if (rnames) loadResults(); else loadSlot(saved[0]);
      } else A.bind(exitL);
      A.mov(RSP, RBP); A.pop(RBP); A.ret();
      const size = Math.ceil((8 * nloc) / 16) * 16;
      for (const at of [frameAt, landAt]) if (at >= 0) { A.b[at] = size & 255; A.b[at + 1] = (size >> 8) & 255; A.b[at + 2] = (size >> 16) & 255; A.b[at + 3] = (size >> 24) & 255; }
    }
    // parâmetro sem tipo é any
    const paramTypes = (f) => f.params.map((p, i) => (f.ptypes && f.ptypes[i]) || "any");
    const lits = [];                 // closures esperando o código
    // função com nome usada como valor: closure fixa, nos dados
    const staticClos = new Map();
    function staticClosure(U, name, n) {
      const key = `${U.P}.c.${name}`;
      if (!staticClos.has(key)) {
        if (!U.funcs.has(name)) fail(`função ${bare(name)} não encontrada`, n);
        dataSym(key, word(0));
        dataRelocs.push({ off: A.syms.get(key).off, sym: `${U.P}.f.${name}` });
        staticClos.set(key, true);
      }
      return key;
    }
    // "thunk" de um método preso: tira o receptor da closure e chama o método
    const thunksM = new Map();
    function boundThunk(U, f) {
      const key = `${U.P}.t.${f.name}`;
      if (!thunksM.has(key)) thunksM.set(key, { U, f });
      return key;
    }
    function genBoundThunk(key, { U, f }) {
      const n = f.params.length - 1;
      A.bind(key);
      A.push(RBP); A.mov(RBP, RSP);
      A.load(RAX, RBP, 16 + 8 * n); A.load(RAX, RAX, 8);
      if (!f.ptypes[0].startsWith("*")) { A.push(RAX); A.lea(RAX, desc(f.ptypes[0], f)); A.push(RAX); A.call(rtCall("rt_copy_val")); A.addImm(RSP, 16); }
      A.push(RAX);
      for (let i = 0; i < n; i++) { A.load(RAX, RBP, 16 + 8 * (n - 1 - i)); A.push(RAX); }
      A.call(`${U.P}.f.${f.name}`);
      A.mov(RSP, RBP); A.pop(RBP); A.ret();
    }
    function genUnit(U) {
      for (const [name, f] of U.funcs) {
        const r = f.retTy || f.rtype || "void";
        genFunction(U, `${U.P}.f.${name}`, f.params, paramTypes(f), f.body.body, r, false, f.celled || new Set(), f);
      }
    }

    // ---- funções de DLL: o "thunk" passa da nossa convenção para a do Windows x64 ----
    const thunks = new Map();
    function externThunk(e) {
      const key = `x.${e.dll}.${e.symbol}`;
      if (thunks.has(key)) return key;
      thunks.set(key, e);
      const dll = e.dll.toLowerCase();
      if (!imports.has(dll)) imports.set(dll, new Set());
      imports.get(dll).add(e.symbol);
      return key;
    }
    function genThunk(key, e) {
      const n = e.params.length;
      A.bind(key);
      A.push(RBP); A.mov(RBP, RSP);
      A.byte(0x48, 0x83, 0xE4, 0xF0);
      const stackArgs = Math.max(0, n - 4);
      A.subImm(RSP, 32 + Math.ceil(stackArgs / 2) * 16);
      const regs = [RCX, RDX, R8, R9];
      e.params.forEach((p, i) => {
        const src = 16 + 8 * (n - 1 - i);
        if (i < 4) {
          A.load(regs[i], RBP, src);
          if (p.type === "f64") A.movqX(i, regs[i]);
          if (p.type === "f32") { A.movqX(i, regs[i]); A.sse(0x5A, i, i, 0xF2); }
        } else {
          A.load(RAX, RBP, src);
          if (p.type === "f32") { A.movqX(0, RAX); A.sse(0x5A, 0, 0, 0xF2); A.movqR(RAX, 0); }
          A.store(RSP, 32 + 8 * (i - 4), RAX);
        }
      });
      A.rip([0xFF], 2, `iat.${e.dll.toLowerCase()}.${e.symbol}`, 0);
      switch (e.ret) {
        case "i32": A.rr([0x63], RAX, RAX); break;
        case "u32": A.rr([0x89], RAX, RAX, 0); break;
        case "bool": A.rr([0x85], RAX, RAX, 0); A.setcc(CC.ne); A.movzxb(RAX, RAX); break;
        case "f64": A.movqR(RAX, 0); break;
        case "f32": A.sse(0x5A, 0, 0, 0xF3); A.movqR(RAX, 0); break;
      }
      A.mov(RSP, RBP); A.pop(RBP); A.ret();
    }

    // ---- entrada do programa ----
    A.bind("start");
    if (target === "linux") A.storeSym("g.argp", RSP);
    A.byte(0x48, 0x83, 0xE4, 0xF0);
    A.call("r.top");
    // o coletor precisa do topo da pilha e da faixa das globais
    A.storeSym("r.g.rt_stack_top", RSP);
    A.lea(RAX, "g.data_lo"); A.storeSym("r.g.rt_data_lo", RAX);
    A.lea(RAX, "g.data_hi"); A.storeSym("r.g.rt_data_hi", RAX);
    A.call(rtCall("rt_init"));
    for (const [g, t] of [["rt_d_int", "int"], ["rt_d_num", "num"], ["rt_d_bool", "bool"], ["rt_d_str", "str"], ["rt_d_any", "any"], ["rt_d_err", "·errstr"]]) {
      A.lea(RAX, desc(t)); A.storeSym(`r.g.${g}`, RAX);
    }
    A.call("u.top");
    A.rr([0x31], RAX, RAX, 0); A.push(RAX); A.call(rtCall("rt_exit"));
    A.byte(0xCC);
    genFunction(rtU, "r.top", [], [], rtAst.body, "void", true, new Set());
    genFunction(uU, "u.top", [], [], ast.body, "void", true, new Set());
    genUnit(rtU);
    genUnit(uU);
    // closures: cada uma pode criar outras
    for (let i = 0; i < lits.length; i++) {
      const { U, label, fnode, capTypes } = lits[i];
      genFunction(U, label, fnode.params, paramTypes(fnode), fnode.body.body, fnode.retTy || fnode.rtype || "void", false, fnode.celled || new Set(), fnode, true, capTypes);
    }
    for (const [key, t] of thunksM) genBoundThunk(key, t);
    // chama o nó de um defer: [próximo, closure, n, argumentos...]
    A.bind("rt.calldefer");
    A.push(RBP); A.mov(RBP, RSP);
    A.load(RDX, RBP, 16);
    A.load(RAX, RDX, 8); A.push(RAX);                 // a closure vai antes dos argumentos
    A.load(RCX, RDX, 16); A.addImm(RDX, 24);
    { const loop = A.label(), go = A.label();
      A.bind(loop); A.alu("test", RCX, RCX); A.jcc(CC.e, go);
      A.load(RAX, RDX, 0); A.push(RAX); A.addImm(RDX, 8); A.subImm(RCX, 1); A.jmp(loop);
      A.bind(go); }
    A.load(RAX, RBP, 16); A.load(RAX, RAX, 8); A.load(RAX, RAX, 0);
    A.byte(0xFF, 0xD0);
    A.mov(RSP, RBP); A.pop(RBP); A.ret();
    for (const [key, e] of thunks) genThunk(key, e);

    dataSym("g.data_hi", word(0));
    compileNative.lastSyms = A.syms;      // para depurar: rótulo → posição no código
    return target === "windows" ? writePE(A, data, imports, dataRelocs) : writeELF(A, data, dataRelocs);
  }


  // ---- resolve os saltos e referências quando os endereços das seções são conhecidos ----
  function resolveFixups(A, textVA, dataVA, data, dataRelocs) {
    const addr = (sym) => {
      const s = A.syms.get(sym);
      if (!s) throw new Error(`símbolo sem definição: ${sym}`);
      return (s.sec === "text" ? textVA : dataVA) + s.off;
    };
    for (const f of A.fix) {
      const v = addr(f.sym) - (textVA + f.end);
      A.b[f.at] = v & 255; A.b[f.at + 1] = (v >> 8) & 255; A.b[f.at + 2] = (v >> 16) & 255; A.b[f.at + 3] = (v >> 24) & 255;
    }
    // palavras nos dados com o endereço absoluto de um símbolo (os descritores de tipo)
    for (const r of dataRelocs) {
      let x = BigInt(addr(r.sym));
      for (let i = 0; i < 8; i++) { data[r.off + i] = Number(x & 255n); x >>= 8n; }
    }
    return addr("start");
  }
  const alignUp = (n, a) => Math.ceil(n / a) * a;

  // ---- ELF x86-64 (Linux): dois segmentos, código e dados ----
  function writeELF(A, data, dataRelocs) {
    const base = 0x400000, textOff = 0x1000;
    const textVA = base + textOff, dataOff = alignUp(textOff + A.b.length, 0x1000), dataVA = base + dataOff;
    const entry = resolveFixups(A, textVA, dataVA, data, dataRelocs);
    const size = dataOff + Math.max(data.length, 8);
    const out = new Uint8Array(size), dv = new DataView(out.buffer);
    out.set([0x7F, 0x45, 0x4C, 0x46, 2, 1, 1, 0], 0);
    dv.setUint16(16, 2, true); dv.setUint16(18, 0x3E, true); dv.setUint32(20, 1, true);
    dv.setBigUint64(24, BigInt(entry), true); dv.setBigUint64(32, 64n, true); dv.setBigUint64(40, 0n, true);
    dv.setUint16(52, 64, true); dv.setUint16(54, 56, true); dv.setUint16(56, 2, true); dv.setUint16(58, 64, true);
    const ph = (at, flags, off, va, sz) => {
      dv.setUint32(at, 1, true); dv.setUint32(at + 4, flags, true);
      dv.setBigUint64(at + 8, BigInt(off), true); dv.setBigUint64(at + 16, BigInt(va), true); dv.setBigUint64(at + 24, BigInt(va), true);
      dv.setBigUint64(at + 32, BigInt(sz), true); dv.setBigUint64(at + 40, BigInt(sz), true); dv.setBigUint64(at + 48, 0x1000n, true);
    };
    ph(64, 5, textOff, textVA, A.b.length);
    ph(64 + 56, 6, dataOff, dataVA, Math.max(data.length, 8));
    out.set(A.b, textOff);
    out.set(data, dataOff);
    return out;
  }

  // ---- PE32+ (Windows x64): .text e .data, com a tabela de importação dentro de .data ----
  function writePE(A, data, imports, dataRelocs) {
    const IMAGE_BASE = 0x140000000, SA = 0x1000, FA = 0x200, HDR = 0x400;
    const textRVA = SA, textSize = A.b.length, dataRVA = alignUp(textRVA + textSize, SA);
    // tabela de importação: descritores, listas de nomes (ILT), endereços (IAT) e nomes
    const dlls = [...imports.keys()];
    const put = (bytes, align = 8) => { while (data.length % align) data.push(0); const at = data.length; data.push(...bytes); return at; };
    const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];
    const u64 = (v) => [...u32(v), 0, 0, 0, 0];
    const descAt = put(new Array(20 * (dlls.length + 1)).fill(0), 4);
    dlls.forEach((dll, di) => {
      const syms = [...imports.get(dll)];
      const nameRVA = dataRVA + put([...new TextEncoder().encode(dll), 0], 2);
      const hints = syms.map((s) => dataRVA + put([0, 0, ...new TextEncoder().encode(s), 0], 2));
      const ilt = put([].concat(...hints.map(u64), u64(0)), 8);
      const iat = put([].concat(...hints.map(u64), u64(0)), 8);
      syms.forEach((s, i) => A.syms.set(`iat.${dll}.${s}`, { sec: "data", off: iat + 8 * i }));
      const d = [...u32(dataRVA + ilt), 0, 0, 0, 0, 0, 0, 0, 0, ...u32(nameRVA), ...u32(dataRVA + iat)];
      for (let k = 0; k < 20; k++) data[descAt + k + 20 * di] = d[k];
    });
    if (!data.length) data.push(0);
    const entry = resolveFixups(A, IMAGE_BASE + textRVA, IMAGE_BASE + dataRVA, data, dataRelocs) - IMAGE_BASE;
    const textRaw = alignUp(textSize, FA), dataRaw = alignUp(data.length, FA);
    const sizeOfImage = alignUp(dataRVA + data.length, SA);
    const out = new Uint8Array(HDR + textRaw + dataRaw), dv = new DataView(out.buffer);
    out[0] = 0x4D; out[1] = 0x5A; dv.setUint32(0x3C, 0x80, true);
    const pe = 0x80;
    out.set([0x50, 0x45, 0, 0], pe);
    dv.setUint16(pe + 4, 0x8664, true); dv.setUint16(pe + 6, 2, true); dv.setUint16(pe + 20, 240, true); dv.setUint16(pe + 22, 0x0023, true);
    const o = pe + 24;
    dv.setUint16(o, 0x20B, true); out[o + 2] = 14;
    dv.setUint32(o + 4, textRaw, true); dv.setUint32(o + 8, dataRaw, true);
    dv.setUint32(o + 16, entry, true); dv.setUint32(o + 20, textRVA, true);
    dv.setBigUint64(o + 24, BigInt(IMAGE_BASE), true);
    dv.setUint32(o + 32, SA, true); dv.setUint32(o + 36, FA, true);
    dv.setUint16(o + 40, 6, true); dv.setUint16(o + 48, 6, true);
    dv.setUint32(o + 56, sizeOfImage, true); dv.setUint32(o + 60, HDR, true);
    dv.setUint16(o + 68, 3, true); dv.setUint16(o + 70, 0x8100, true);
    dv.setBigUint64(o + 72, 64n << 20n, true); dv.setBigUint64(o + 80, 0x10000n, true);
    dv.setBigUint64(o + 88, 0x100000n, true); dv.setBigUint64(o + 96, 0x1000n, true);
    dv.setUint32(o + 108, 16, true);
    if (dlls.length) { dv.setUint32(o + 112 + 8, dataRVA + descAt, true); dv.setUint32(o + 112 + 12, 20 * (dlls.length + 1), true); }
    const sec = (at, name, vsize, rva, raw, rawAt, ch) => {
      out.set(new TextEncoder().encode(name), at);
      dv.setUint32(at + 8, vsize, true); dv.setUint32(at + 12, rva, true);
      dv.setUint32(at + 16, raw, true); dv.setUint32(at + 20, rawAt, true); dv.setUint32(at + 36, ch, true);
    };
    sec(o + 240, ".text", textSize, textRVA, textRaw, HDR, 0x60000020);
    sec(o + 280, ".data", data.length, dataRVA, dataRaw, HDR + textRaw, 0xC0000040);
    out.set(A.b, HDR);
    out.set(data, HDR + textRaw);
    return out;
  }
