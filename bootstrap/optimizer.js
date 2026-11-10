  // =====================================================================
  // 3b. Optimizer
  // =====================================================================
  // Layer 1, on the tree: constant folding, const propagation and dead code.
  function foldProgram(ast, report) {
    let known = new Map();       // top-level constants with a known literal value
    const NOFOLD = {};
    const isLit = (n) => n.kind === "Number" || n.kind === "String" || n.kind === "Bool";
    // the literal inherits the type of the expression it replaces (int stays int, num stays num)
    const lit = (v, from) => ({ kind: typeof v === "number" ? "Number" : typeof v === "string" ? "String" : "Bool", value: v, line: from.line, col: from.col,
      int: typeof v === "number" && Number.isInteger(v) && !(from.ty && isFloatT(from.ty)), ty: from.ty, boxT: from.boxT });
    const IOPS = { "+": 0, "-": 1, "*": 2, "/": 3, "%": 4, "<<": 5, ">>": 6, "&": 7, "|": 8, "^": 9, "&^": 10 };
    function fe(n) {
      switch (n.kind) {
        case "Paren": { const e = fe(n.expr); return isLit(e) ? e : { ...n, expr: e }; }
        case "Var":
          if (known.has(n.name)) { report.propagated++; return lit(known.get(n.name), n); }
          return n;
        case "Neg": {
          const a = fe(n.arg);
          if (a.kind === "Number") { report.folded++; return lit(INT_KINDS.includes(n.ty) && n.ty !== "int" ? wrapKind(-a.value, KIND_CODE[n.ty]) : -a.value, n); }
          return { ...n, arg: a };
        }
        case "Not": {
          const a = fe(n.arg);
          if (isLit(a)) { report.folded++; return lit(!truthy(a.value), n); }
          return { ...n, arg: a };
        }
        case "Logical": {
          const l = fe(n.left), r = fe(n.right);
          if (isLit(l)) {
            const t = truthy(l.value);
            if ((n.op === "and" && !t) || (n.op === "or" && t)) { report.folded++; return lit(n.op === "or", n); }
            if (isLit(r)) { report.folded++; return lit(truthy(r.value), n); }
          }
          return { ...n, left: l, right: r };
        }
        case "Binary": {
          const l = fe(n.left), r = fe(n.right);
          if (isLit(l) && isLit(r)) {
            // if the operation would fail (10 / 0, "a" - 1), do not fold: the error must happen at run time
            try {
              const nofold = () => { throw NOFOLD; };
              let v = n.ik !== undefined && n.op in IOPS ? intOp(IOPS[n.op], n.ik, l.value, r.value, nofold) : binop(n.op, l.value, r.value, nofold);
              if (n.fk !== undefined) v = Math.fround(v);
              report.folded++;
              return lit(v, n);
            } catch (e) { if (e !== NOFOLD) throw e; }
          }
          return { ...n, left: l, right: r };
        }
        case "Call": return { ...n, args: n.args.map(fe) };
        default: return n;
      }
    }
    function fs(st, top) {
      switch (st.kind) {
        case "ExprStmt": return { ...st, expr: fe(st.expr) };
        case "Assign": {
          const v = fe(st.value);
          if (top && st.decl === "const" && isLit(v)) known.set(st.name, v.value);
          return { ...st, value: v };
        }
        case "Return": return { ...st, value: st.value ? fe(st.value) : null };
        case "Func": {
          // const is not propagated inside functions: a local name may shadow the global,
          // and the function may be called before the constant gets its value
          const saved = known;
          known = new Map();
          const body = fs(st.body, false);
          known = saved;
          return { ...st, body };
        }
        case "Block": return { ...st, body: fb(st.body) };
        case "Module": return { ...st, body: fb(st.body, true) };
        case "If": {
          const c = fe(st.cond);
          if (isLit(c) && !st.init) {
            report.dead++;
            const pick = truthy(c.value) ? st.then : st.otherwise;
            return pick ? fs(pick, false) : null;
          }
          return { ...st, cond: c, then: fs(st.then, false), otherwise: st.otherwise ? fs(st.otherwise, false) : null };
        }
        case "While": {
          const c = fe(st.cond);
          if (isLit(c) && !truthy(c.value)) { report.dead++; return null; }
          return { ...st, cond: c, body: fs(st.body, false) };
        }
        case "ForTo": return { ...st, from: fe(st.from), to: fe(st.to), body: fs(st.body, false) };
        default: return st;
      }
    }
    const fb = (body, top = false) => body.map((s) => fs(s, top)).filter(Boolean);
    return { kind: "Program", body: fb(ast.body, true) };
  }

  // Layer 2, on the bytecode. First decodes the numbers into a list of instructions,
  // with jumps pointing to list indices; at the end, encodes back into numbers.
  function decode(prog) {
    const list = [], indexOf = new Map();
    for (let pc = 0; pc < prog.code.length; pc += 1 + ARITY[prog.code[pc]]) {
      indexOf.set(pc, list.length);
      list.push({ op: prog.code[pc], a: Array.from(prog.code.slice(pc + 1, pc + 1 + ARITY[prog.code[pc]])), line: prog.lines[pc] });
    }
    indexOf.set(prog.code.length, list.length);
    for (const ins of list) if (ins.op in JUMP_ARG) ins.a[JUMP_ARG[ins.op]] = indexOf.get(ins.a[JUMP_ARG[ins.op]]);
    return list;
  }
  function encode(list) {
    const addr = [];
    let at = 0;
    for (const ins of list) { addr.push(at); at += 1 + ins.a.length; }
    addr.push(at);
    const code = [], lines = [], entries = new Map();
    for (const ins of list) {
      if (ins.entry !== undefined) entries.set(ins.entry, code.length);
      const a = ins.a.slice();
      if (ins.op in JUMP_ARG) a[JUMP_ARG[ins.op]] = addr[a[JUMP_ARG[ins.op]]];
      code.push(ins.op, ...a);
      for (let i = 0; i <= a.length; i++) lines.push(ins.line);
    }
    return { code: Int32Array.from(code), lines, entries };
  }
  // jump targets and function entries: nothing may be fused over them
  const jumpTargets = (list) => {
    const t = new Set(list.filter((i) => i.op in JUMP_ARG).map((i) => i.a[JUMP_ARG[i.op]]));
    list.forEach((ins, i) => { if (ins.entry !== undefined) t.add(i); });
    return t;
  };
  function remap(list, map) {
    for (const ins of list) if (ins.op in JUMP_ARG) ins.a[JUMP_ARG[ins.op]] = map[ins.a[JUMP_ARG[ins.op]]];
    return list;
  }

  // Peephole: looks at windows of 2 or 3 instructions and replaces patterns with superinstructions.
  // A window is only fused if no instruction after the first is a jump target.
  const isBin = (ins) => ins && ins.op in BIN_INDEX_OF_OP;
  const isStore = (ins) => ins && (ins.op === OP.SET || ins.op === OP.STORE);
  function matchAt(list, i, targets) {
    const at = (k) => (i + k < list.length && !targets.has(i + k) ? list[i + k] : null);
    const x = list[i], y = at(1), z = y && at(2);
    const L = x.line;
    if (x.op === OP.LOAD && y?.op === OP.LOAD && isBin(z))
      return { len: 3, name: "LOAD2_BIN", ins: { op: OP.LOAD2_BIN, a: [x.a[0], y.a[0], BIN_INDEX_OF_OP[z.op]], line: L } };
    if (x.op === OP.CONST && isBin(y))
      return { len: 2, name: "BINK", ins: { op: OP.BINK, a: [BIN_INDEX_OF_OP[y.op], x.a[0]], line: y.line } };
    if (x.op === OP.LOAD && y?.op === OP.BINK)
      return { len: 2, name: "LOAD_BINK", ins: { op: OP.LOAD_BINK, a: [x.a[0], y.a[0], y.a[1]], line: L } };
    if (x.op === OP.LOAD_BINK && isStore(y) && y.a[0] === x.a[0])
      return { len: 2, name: "UPDATE_K", ins: { op: OP.UPDATE_K, a: [x.a[0], x.a[1], x.a[2]], line: L } };
    if (x.op === OP.LOAD2_BIN && isStore(y) && y.a[0] === x.a[0])
      return { len: 2, name: "UPDATE_S", ins: { op: OP.UPDATE_S, a: [x.a[0], x.a[2], x.a[1]], line: L } };
    if (isBin(x) && (y?.op === OP.JMP_IF_FALSE || y?.op === OP.JMP_IF_TRUE))
      return { len: 2, name: "JMP_UNLESS/WHEN", ins: { op: y.op === OP.JMP_IF_FALSE ? OP.JMP_UNLESS : OP.JMP_WHEN, a: [BIN_INDEX_OF_OP[x.op], y.a[0]], line: L } };
    if (x.op === OP.BINK && (y?.op === OP.JMP_IF_FALSE || y?.op === OP.JMP_IF_TRUE))
      return { len: 2, name: "JMP_UNLESS_K/WHEN_K", ins: { op: y.op === OP.JMP_IF_FALSE ? OP.JMP_UNLESS_K : OP.JMP_WHEN_K, a: [x.a[0], x.a[1], y.a[0]], line: L } };
    if (x.op === OP.NOT && (y?.op === OP.JMP_IF_FALSE || y?.op === OP.JMP_IF_TRUE))
      return { len: 2, name: "NOT inverted", ins: { op: y.op === OP.JMP_IF_FALSE ? OP.JMP_IF_TRUE : OP.JMP_IF_FALSE, a: [y.a[0]], line: L } };
    if (x.op === OP.TO_BOOL && (y?.op === OP.JMP_IF_FALSE || y?.op === OP.JMP_IF_TRUE))
      return { len: 2, name: "TO_BOOL removed", ins: { op: y.op, a: [y.a[0]], line: y.line } };
    if (x.op === OP.CALL && y?.op === OP.POP)
      return { len: 2, name: "CALL_VOID", ins: { op: OP.CALL_VOID, a: [x.a[0], x.a[1]], line: L } };
    if (x.op === OP.FOR_STEP && y?.op === OP.JMP) {
      const test = list[y.a[0]];
      if (test && test.op === OP.FOR_TEST && test.a[0] === x.a[0] && test.a[2] === i + 2)
        return { len: 2, name: "FOR_NEXT", ins: { op: OP.FOR_NEXT, a: [x.a[0], test.a[1], y.a[0] + 1], line: L } };
    }
    return null;
  }
  function fusePass(list, report) {
    const targets = jumpTargets(list);
    const out = [], map = new Array(list.length + 1);
    let changed = false;
    for (let i = 0; i < list.length;) {
      const m = matchAt(list, i, targets);
      if (m) {
        for (let k = 0; k < m.len; k++) map[i + k] = out.length;
        if (list[i].entry !== undefined) m.ins.entry = list[i].entry;
        out.push(m.ins);
        report.fused[m.name] = (report.fused[m.name] || 0) + 1;
        i += m.len; changed = true;
      } else {
        map[i] = out.length;
        out.push({ ...list[i], a: list[i].a.slice() });
        i++;
      }
    }
    map[list.length] = out.length;
    return { list: remap(out, map), changed };
  }
  // Jump threading: a jump that lands on a JMP goes straight to the final target.
  function threadPass(list, report) {
    let changed = false;
    for (const ins of list) {
      if (!(ins.op in JUMP_ARG) || ins.op === OP.CALLF) continue;   // a function entry stays where it is
      const k = JUMP_ARG[ins.op];
      let t = ins.a[k], hops = 0;
      while (list[t] && list[t].op === OP.JMP && list[t].a[0] !== t && hops < 16) { t = list[t].a[0]; hops++; }
      if (t !== ins.a[k]) { ins.a[k] = t; report.threaded++; changed = true; }
    }
    return { list, changed };
  }
  // Removes whatever no path reaches (including functions that are never called)
  // and unconditional jumps to the next instruction.
  const ENDS = new Set([OP.HALT, OP.RET, OP.RET_NULL]);
  function deadPass(list, report, roots) {
    const reach = new Array(list.length).fill(false);
    // besides the main program, exported functions are also entry points
    const work = [0];
    list.forEach((ins, i) => { if (ins.entry !== undefined && roots.has(ins.entry)) work.push(i); });
    while (work.length) {
      const i = work.pop();
      if (i >= list.length || reach[i]) continue;
      reach[i] = true;
      const ins = list[i];
      if (ENDS.has(ins.op)) continue;
      if (ins.op in JUMP_ARG) work.push(ins.a[JUMP_ARG[ins.op]]);
      if (ins.op !== OP.JMP) work.push(i + 1);
    }
    const keep = list.map((ins, i) => reach[i] && !(ins.op === OP.JMP && ins.a[0] === i + 1));
    const removedJumps = list.filter((ins, i) => reach[i] && !keep[i]).length;
    const unreachable = reach.filter((r) => !r).length;
    if (!removedJumps && !unreachable) return { list, changed: false };
    report.unreachable += unreachable;
    report.jumpsRemoved += removedJumps;
    const map = new Array(list.length + 1), out = [];
    let count = 0;
    for (let i = 0; i < list.length; i++) if (keep[i]) count++;
    let idx = count;
    map[list.length] = count;
    for (let i = list.length - 1; i >= 0; i--) { if (keep[i]) idx--; map[i] = idx; }
    // a removed jump that was a function entry hands the mark to the next instruction
    list.forEach((ins, i) => {
      if (reach[i] && !keep[i] && ins.entry !== undefined) {
        let j = i + 1;
        while (j < list.length && !keep[j]) j++;
        if (j < list.length && list[j].entry === undefined) list[j].entry = ins.entry;
      }
    });
    list.forEach((ins, i) => { if (keep[i]) out.push(ins); });
    return { list: remap(out, map), changed: true };
  }

  function optimizeProgram(ast) {
    const report = { folded: 0, propagated: 0, dead: 0, fused: {}, threaded: 0, unreachable: 0, jumpsRemoved: 0, rounds: 0 };
    typecheck(ast);   // annotates types (direct method calls, struct copies) before folding
    const folded = foldProgram(ast, report);
    const base = compile(folded, { optimize: true });
    let list = decode(base);
    const at = new Map();
    for (let pc = 0, i = 0; pc < base.code.length; pc += 1 + ARITY[base.code[pc]], i++) at.set(pc, i);
    base.functions.forEach((f, fi) => { if (f.entry >= 0) list[at.get(f.entry)].entry = fi; });
    // entry points besides the program: exported functions and methods (called by name at run time)
    // (closures, defers and goroutines also call functions by value: all of them stay as roots)
    const roots = new Set(base.functions.map((_, fi) => fi));
    for (let round = 0; round < 12; round++) {
      let any = false;
      for (const pass of [fusePass, threadPass, deadPass]) {
        const r = pass(list, report, roots);
        list = r.list; any = any || r.changed;
      }
      report.rounds = round + 1;
      if (!any) break;
    }
    const { code, lines, entries } = encode(list);
    // each function's entry has moved; those never called nor exported are gone
    const functions = base.functions.map((f, fi) => ({ ...f, entry: entries.has(fi) ? entries.get(fi) : -1 }));
    report.unusedFunctions = functions.filter((f) => f.entry < 0).map((f) => f.name);
    return { code, lines, consts: base.consts, slotNames: base.slotNames, functions, externs: base.externs, exports: base.exports, structs: base.structs, rtypes: base.rtypes, types: base.types, report };
  }


