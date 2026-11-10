  // =====================================================================
  // 2b. Type checker
  // =====================================================================
  // Gradual typing: whatever has a type (annotated or inferred) is checked at compile time, as in Go;
  // whatever doesn't becomes any and is only checked at run time. A type is a canonical string
  // ("int", "[]str", "map[str]int", "*Point", "fn(int) -> (int, error)", "chan int").
  //   integers: int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 (byte = uint8, rune = int32)
  //   floats: num (= float64) float32      str (= string)     bool     any     error     void (no value)
  // Untyped numbers (5, 'a', 2.5) are constants that adapt to the requested type, as in Go.
  const INT_KINDS = ["int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64"];
  const FLOAT_KINDS = ["num", "float32"];
  // numeric kind code used by the IOP and CONV instructions
  const KIND_CODE = { int: 0, int8: 1, int16: 2, int32: 3, int64: 4, uint: 5, uint8: 6, uint16: 7, uint32: 8, uint64: 9, float32: 10, num: 11 };
  const KIND_NAMES = ["int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float32", "num"];
  const TYPE_ALIASES = { byte: "uint8", rune: "int32", string: "str", float64: "num" };
  const LANG_TYPES = ["int", "num", "str", "bool", "any", "error", ...INT_KINDS.slice(1), "float32"];
  const PRIM_TYPES = new Set([...LANG_TYPES, "void"]);
  const isTypeWord = (s) => PRIM_TYPES.has(s) || s in TYPE_ALIASES;
  const TYPE_WORDS = { has: isTypeWord };
  const FFI_ONLY = new Set(["i32", "u32", "i64", "u64", "f32", "f64", "ptr", "wstr"]);
  // conversions written as a call: int(x), uint8(x), num(x), str(x), string(x)...
  const CONVERSIONS = [...INT_KINDS, ...FLOAT_KINDS, "float64", "str", "string", "byte", "rune"];
  const FFI_LANG = { void: "void", i32: "int", u32: "int", i64: "int", u64: "int", ptr: "int", f32: "num", f64: "num", bool: "bool", str: "str", wstr: "str" };
  const NEVER = "never";   // provisional result of a recursive call while the function's return type is being inferred
  const isIntT = (t) => INT_KINDS.includes(t) || t === "lit" || t === "rlit";
  const isFloatT = (t) => FLOAT_KINDS.includes(t) || t === "flit";
  const isNumT = (t) => isIntT(t) || isFloatT(t);
  const isUntyped = (t) => t === "lit" || t === "rlit" || t === "flit";
  const loose = (t) => t === "any" || t === NEVER;
  const dflt = (t) => (t === "lit" ? "int" : t === "rlit" ? "int32" : t === "flit" ? "num" : t);
  const showT = (t) => (t === "lit" || t === "rlit" ? "int" : t === "flit" ? "num" : t);
  // strips the file from linked names: Point@geo.caju → Point, Point@geo.caju.area → Point.area
  const bare = (nm) => String(nm).replace(/@[^@\s]*?\.caju/g, "");
  const funcTypeText = (ps, res) => `fn(${ps.join(", ")})${res.length === 0 ? "" : res.length === 1 ? ` -> ${res[0]}` : ` -> (${res.join(", ")})`}`;

  // takes a canonical type apart: { k: "slice" | "array" | "map" | "ptr" | "chan" | "func" | "tuple" | "name", ... }
  const typeInfoCache = new Map();
  function tinfo(t) {
    if (typeInfoCache.has(t)) return typeInfoCache.get(t);
    let r;
    // splits on top-level commas
    const split = (s) => {
      const out = []; let depth = 0, cur = "";
      for (const c of s) {
        if ("([".includes(c)) depth++;
        if (")]".includes(c)) depth--;
        if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    // end of the first complete type inside s (for map[K]V and fn(...) -> R)
    const close = (s, i, open, shut) => { let d = 0; for (; i < s.length; i++) { if (s[i] === open) d++; if (s[i] === shut && --d === 0) return i; } return -1; };
    if (t.startsWith("[]")) r = { k: "slice", elem: t.slice(2) };
    else if (/^\[\d+\]/.test(t)) { const m = /^\[(\d+)\]/.exec(t); r = { k: "array", n: +m[1], elem: t.slice(m[0].length) }; }
    else if (t.startsWith("map[")) { const e = close(t, 3, "[", "]"); r = { k: "map", key: t.slice(4, e), val: t.slice(e + 1) }; }
    else if (t.startsWith("*")) r = { k: "ptr", elem: t.slice(1) };
    else if (t.startsWith("chan ")) r = { k: "chan", elem: t.slice(5) };
    else if (t.startsWith("fn(")) {
      const e = close(t, 2, "(", ")");
      const ps = split(t.slice(3, e));
      let rest = t.slice(e + 1).trim(), res = [];
      if (rest.startsWith("->")) { rest = rest.slice(2).trim(); res = rest.startsWith("(") ? split(rest.slice(1, -1)) : [rest]; }
      r = { k: "func", params: ps, results: res };
    } else if (t.startsWith("(")) r = { k: "tuple", items: split(t.slice(1, -1)) };
    else r = { k: "name" };
    typeInfoCache.set(t, r);
    return r;
  }
  const kindOf = (t) => tinfo(t).k;
  const BUILTIN_SIG = {
    sleep: [["num"], "void"], alloc: [["int"], "int"], free: [["any"], "void"],
    peek8: [["int"], "int"], peek16: [["int"], "int"], peek32: [["int"], "int"], peek64: [["int"], "int"],
    poke8: [["int", "int"], "void"], poke16: [["int", "int"], "void"], poke32: [["int", "int"], "void"],
    readstr: [["int"], "str"], readwstr: [["int"], "str"],
  };
  // Low-level operations, only for the native compiler's runtime (written in Caju):
  // read and write memory, make system calls, inspect the bits of a number
  const INTRINSIC_SIG = {
    __load8: [["int"], "int"], __load64: [["int"], "int"], __store8: [["int", "int"], "void"], __store64: [["int", "int"], "void"],
    __syscall: [["int", "int", "int", "int", "int", "int", "int"], "int"], __argp: [[], "int"], __sp: [[], "int"], __calldefer: [["int"], "void"], __jump: [["int", "int"], "void"],
    __strp: [["str"], "int"], __pstr: [["int"], "str"], __fbits: [["num"], "int"], __bitsf: [["int"], "num"],
    __sqrt: [["num"], "num"], __fmod: [["num", "num"], "num"],
    // for the standard library: a new string block [length n][bytes][0] (bytes not zeroed), flush print's buffer, exit
    __newstr: [["int"], "int"], __flush: [[], "void"], __exit: [["int"], "void"],
  };
  // language functions with their own typing rules
  const SPECIAL_BUILTINS = ["print", "len", "cap", "append", "copy", "delete", "make", "new", "panic", "recover", "close"];
  // does the statement always end in a return (or a panic, or an endless loop without break)?
  const alwaysReturns = (n) => !!n && (n.kind === "Return" || (n.kind === "Block" && n.body.some(alwaysReturns)) ||
    (n.kind === "If" && !!n.otherwise && alwaysReturns(n.then) && alwaysReturns(n.otherwise)) ||
    (n.kind === "ExprStmt" && n.expr.kind === "Call" && n.expr.name === "panic") ||
    (n.kind === "ForC" && !n.cond && !hasBreak(n.body)) ||
    ((n.kind === "Switch" || n.kind === "TypeSwitch") && n.cases.some((c) => !c.exprs && !c.types) && n.cases.every((c) => alwaysReturns({ kind: "Block", body: c.body }) || (c.body.length && c.body[c.body.length - 1].kind === "Fallthrough")) && !n.cases.some((c) => hasBreak({ kind: "Block", body: c.body }, true))));
  function hasBreak(n, any = false) {
    let found = false;
    (function walk(x, depth) {
      if (!x || typeof x !== "object" || found) return;
      if (Array.isArray(x)) return x.forEach((y) => walk(y, depth));
      if (x.kind === "FuncLit") return;
      if (x.kind === "Break" && (x.label || depth === 0)) found = true;
      const inner = ["ForC", "ForTo", "While", "Range", "Switch", "TypeSwitch", "Select"].includes(x.kind);
      for (const k of ["body", "then", "otherwise", "cases"]) walk(x[k], inner ? depth + 1 : depth);
    })(n.body || n, 0);
    return found;
  }

  // a function's local names (parameters, named results and everything it declares), without entering anonymous functions
  function localNamesOf(fn) {
    const names = [...fn.params, ...(fn.rnames || [])];
    const add = (nm) => { if (nm && nm !== "_" && !names.includes(nm)) names.push(nm); };
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.kind === "FuncLit") return;
      if ((n.kind === "Assign" && n.decl) || n.kind === "ForTo") add(n.name);
      if (n.kind === "VarDecl") n.names.forEach(add);
      if (n.kind === "Range" && n.decl) n.vars.forEach((v) => add(v.name));
      if (n.kind === "TypeSwitch") add(n.bind);
      if (n.kind === "Select") n.cases.forEach((c) => { if (c.kind === "recv" && c.decl) c.vars.forEach((v) => add(v.name)); });
      for (const k of ["body", "then", "otherwise", "init", "post", "cases"]) walk(n[k]);
    })(fn.body);
    return names;
  }

  function typecheck(ast, tcOpts = {}) {
    const err = (msg, n) => { throw new CajuError("type", bare(msg), n.line, n.col ?? null); };
    const globals = new Map();                 // nome → { type, node }
    const fns = new Map(), externs = new Map();
    const structs = new Map(), ifaces = new Map();
    // the error interface is predefined: Error() -> str
    ifaces.set("error", { node: { name: "error", line: 0 }, methods: new Map([["Error", { name: "Error", params: [], ptypes: [], rtype: "str" }]]), builtin: true });
    const fnInfo = (st, parent) => ({
      node: st, name: bare(st.name), params: st.params.map(bare),
      ptypes: st.params.map((_, i) => (st.ptypes && st.ptypes[i]) || "any"),
      declared: st.rtype || null, ret: st.rtype || null, inferring: false, locals: new Set(localNamesOf(st)), parent,
      // in a dllexport, messages show the C type as written (i32 is an int32)
      show: (t, i) => (st.dll ? (i === undefined ? st.dll.ret : st.dll.types[i]) : showT(t)),
    });
    forTop(ast.body, (st) => {
      if (st.kind === "Struct" || st.kind === "Interface") {
        const prev = structs.get(st.name) || ifaces.get(st.name);
        if (prev) err(`There is already a type named ${st.name} (line ${locLine(prev.node.line)})`, st);
        if (st.kind === "Struct") structs.set(st.name, { node: st, fields: new Map(st.fields.map((f) => [f.name, f])), methods: new Map() });
        else ifaces.set(st.name, { node: st, methods: new Map(st.methods.map((m) => [m.name, m])) });
      }
      if (st.kind === "Extern") externs.set(st.name, st);
      if (st.kind === "Func") fns.set(st.name, fnInfo(st, null));
    });

    // ---- validation of written types ----
    const isNamedT = (t) => structs.has(t) || ifaces.has(t);
    const isIface = (t) => t === "any" || ifaces.has(t);
    const isStruct = (t) => structs.has(t);
    function checkType(t, at) {
      if (!t || t === "void" || t === NEVER) return;
      const i = tinfo(t);
      if (i.k === "slice" || i.k === "ptr" || i.k === "chan" || i.k === "array") return checkType(i.elem, at);
      if (i.k === "map") {
        checkType(i.key, at); checkType(i.val, at);
        if (!isNumT(i.key) && i.key !== "str" && i.key !== "bool" && !loose(i.key)) err(`A map key must be a number, str or bool, not ${i.key}`, at);
        return;
      }
      if (i.k === "func") { i.params.forEach((p) => checkType(p, at)); i.results.forEach((r) => checkType(r, at)); return; }
      if (i.k === "tuple") { i.items.forEach((x) => checkType(x, at)); return; }
      if (!PRIM_TYPES.has(t) && !isNamedT(t)) err(`Type "${t}" does not exist. The types are int, num, str, bool, any, error, the sized integers (int8 ... uint64), []T, map[K]V, *T, chan T, fn(...), or a declared struct or interface`, at);
    }
    for (const S of structs.values()) S.node.fields.forEach((f) => {
      checkType(f.type, f);
      if (f.embedded && !structs.has(f.type.replace(/^\*/, ""))) err(`Only structs can be embedded; "${f.type}" is not a struct`, f);
    });
    // embedded interfaces: the methods of one are added to the other
    for (const [nm, I] of ifaces) if (!I.builtin) {
      I.node.methods.forEach((m) => { m.ptypes.forEach((t) => checkType(t, m)); checkType(m.rtype, m); });
      (function merge(J, seen) {
        for (const e of J.node.embeds || []) {
          const E = ifaces.get(e.name);
          if (!E) err(`"${e.name}" is not an interface; an interface can only embed another interface`, e);
          if (seen.includes(e.name)) err(`Interface ${nm} includes itself`, e);
          if (!E.builtin) merge(E, [...seen, e.name]);
          for (const [mn, m] of E.methods) if (!I.methods.has(mn)) I.methods.set(mn, m);
        }
      })(I, [nm]);
    }
    // a struct cannot contain itself by value: its value would be infinite
    for (const [nm, S] of structs) {
      (function walk(t, path) {
        const T = structs.get(t);
        if (!T) { const i = tinfo(t); if (i.k === "array") walk(i.elem, path); return; }
        for (const f of T.node.fields) {
          const ft = f.type;
          if (ft === nm) err(`Struct ${nm} contains itself (${[...path, f.name].join(".")}). Use a pointer (*${nm}), a slice or an interface`, S.node);
          if (!path.includes(f.name)) walk(ft, [...path, f.name]);
        }
      })(nm, [nm]);
    }
    for (const info of fns.values()) {
      const st = info.node;
      info.ptypes.forEach((t) => checkType(t, st));
      checkType(st.rtype, st);
      if (!st.recv) continue;
      const S = structs.get(st.recv.type);
      if (!S) err(ifaces.has(st.recv.type) ? `${st.recv.type} is an interface; methods can only be defined on structs` : `Struct "${st.recv.type}" does not exist`, st.recv);
      if (locFile(S.node.line) !== locFile(st.line)) err(`Methods of ${st.recv.type} can only be defined in the file where the struct is declared`, st.recv);
      if (S.fields.has(st.method)) err(`${st.recv.type} already has a field named ${st.method}; the method needs a different name`, st);
      if (S.methods.has(st.method)) err(`${st.recv.type} already has a method named ${st.method} (line ${locLine(S.methods.get(st.method).info.node.line)})`, st);
      S.methods.set(st.method, { info, ptr: st.recv.ptr });
    }

    // ---- promoted fields and methods (embedded structs) ----
    // breadth-first search: the shallowest wins; two at the same depth are ambiguous
    function lookup(sname, member) {
      let level = [{ s: sname, path: [] }];
      const seen = new Set();
      while (level.length) {
        const hits = [], next = [];
        for (const { s, path } of level) {
          if (seen.has(s)) continue;
          seen.add(s);
          const S = structs.get(s);
          if (!S) continue;
          if (S.fields.has(member)) hits.push({ kind: "field", type: S.fields.get(member).type, path, owner: s });
          else if (S.methods.has(member)) hits.push({ kind: "method", m: S.methods.get(member), path, owner: s });
          for (const f of S.node.fields) if (f.embedded) next.push({ s: f.type.replace(/^\*/, ""), path: [...path, f.name], viaPtr: f.type.startsWith("*") });
        }
        if (hits.length === 1) return hits[0];
        if (hits.length > 1) return { kind: "ambiguous" };
        level = next;
      }
      return null;
    }
    // method set of T (or of *T): name → { info, ptr, path }
    function methodSet(sname, ptr) {
      const out = new Map();
      (function walk(s, path, addressable, depth, seen) {
        const S = structs.get(s);
        if (!S || seen.has(s)) return;
        for (const [mn, mm] of S.methods) {
          if (out.has(mn) && out.get(mn).depth <= depth) continue;
          if (mm.ptr && !addressable) continue;
          out.set(mn, { info: mm.info, ptr: mm.ptr, path, depth });
        }
        for (const f of S.node.fields) if (f.embedded) {
          const isPtr = f.type.startsWith("*");
          walk(f.type.replace(/^\*/, ""), [...path, f.name], addressable || isPtr, depth + 1, new Set([...seen, s]));
        }
      })(sname, [], ptr, 0, new Set());
      return out;
    }
    const sigOf = (info) => ({ ptypes: info.ptypes.slice(1), rtype: retOf(info) });
    const sigText = (ps, r) => `(${ps.map(showT).join(", ")})${r && r !== "void" ? " -> " + showT(r) : ""}`;
    // why src does not satisfy interface dst; null if it does
    function missing(src, dst) {
      const I = ifaces.get(dst);
      if (!I) return null;
      let ms = null;
      const base = src.replace(/^\*/, "");
      if (structs.has(base)) ms = methodSet(base, src.startsWith("*"));
      for (const [m, sig] of I.methods) {
        if (ms) {
          const mm = ms.get(m);
          if (!mm) {
            if (!src.startsWith("*") && methodSet(base, true).has(m)) return `method ${m} has receiver *${base}; store a pointer (&value) in the interface`;
            return `missing method ${m}${sigText(sig.ptypes, sig.rtype)}`;
          }
          const s = sigOf(mm.info);
          if (s.ptypes.length !== sig.ptypes.length || s.ptypes.some((t, i) => t !== sig.ptypes[i]) || s.rtype !== sig.rtype)
            return `method ${m} of ${base} is ${sigText(s.ptypes, s.rtype)}, but ${dst} requires ${sigText(sig.ptypes, sig.rtype)}`;
        } else if (ifaces.has(src)) {
          const other = ifaces.get(src).methods.get(m);
          if (!other) return `missing method ${m}`;
          if (other.ptypes.join() !== sig.ptypes.join() || other.rtype !== sig.rtype) return `method ${m} has a different signature`;
        } else return `${showT(src)} has no methods`;
      }
      return null;
    }
    const nilable = (t) => isIface(t) || ["slice", "map", "ptr", "chan", "func"].includes(kindOf(t));
    function assignable(src, dst) {
      if (dst === "any" || loose(src) || src === dst || src === "void" && dst === "void") return true;
      if (src === "nil") return nilable(dst);
      if (src === "lit" || src === "rlit") return isNumT(dst);
      if (src === "flit") return isFloatT(dst);
      if (dst === "num" && (INT_KINDS.includes(src) || src === "float32")) return true;   // Caju accepts an integer where a num is expected
      if (ifaces.has(dst) && (structs.has(src.replace(/^\*/, "")) || ifaces.has(src) || PRIM_TYPES.has(src) || kindOf(src) !== "name")) return !missing(src, dst);
      return false;
    }
    // extra error-message text when a value does not satisfy an interface
    const why = (src, dst) => (ifaces.has(dst) && !loose(src) && src !== "nil" ? `: ${missing(src, dst)}` : "");
    const hint = (src, dst) => (INT_KINDS.includes(dst) && isFloatT(src) ? `. Use ${dst}(...) to convert` :
      isNumT(dst) && isNumT(src) ? `. Use ${showT(dst)}(...) to convert` : dst === "str" && src !== "str" ? ". Use str(...) to convert to a string" : why(src, dst));
    // a value stored in an interface carries its type along; some need a "box" so the exact type is not lost
    function conv(node, src, dst) {
      if (!node || !isIface(dst) || isIface(src) || loose(src) || src === "nil") return;
      const s = dflt(src);
      if ((INT_KINDS.includes(s) && s !== "int") || s === "num" || s === "float32" || (s.startsWith("*") && structs.has(s.slice(1)))) node.boxT = s;
    }
    // checks and annotates a value binding (assignment, argument, return, field, element)
    function bindCheck(node, t, dst, msg) {
      if (!assignable(t, dst)) err(`${msg} is ${showT(dst)}, but got ${showT(t)}${hint(t, dst)}`, node);
      conv(node, t, dst);
    }

    // ---- scopes ----
    const top = { fn: null, vars: globals };
    // looks up a name: local to the function, local to an enclosing function (captured by the closure), or global
    function resolve(sc, name) {
      let s = sc;
      const chain = [];
      while (s.fn) {
        if (s.fn.locals.has(name)) {
          // captured: the variable leaves the stack and moves into a shared "cell"
          if (chain.length) { s.fn.node.celled = s.fn.node.celled || new Set(); s.fn.node.celled.add(name); chain.forEach((c) => { c.fn.node.captures = c.fn.node.captures || []; if (!c.fn.node.captures.includes(name)) c.fn.node.captures.push(name); }); }
          return s.vars.get(name) || { type: "any", node: null, pending: true };
        }
        chain.push(s);
        s = s.parent;
      }
      const ge = globals.get(name);
      // closure created in top-level code: the global moves into a cell, captured when the closure is created
      if (ge && chain.length && chain.every((c) => c.fn.isLit)) {
        globalCelled.add(name);
        chain.forEach((c) => { c.fn.node.captures = c.fn.node.captures || []; if (!c.fn.node.captures.includes(name)) c.fn.node.captures.push(name); });
      }
      return ge;
    }
    const globalCelled = new Set();
    const isVarName = (sc, name) => { let s = sc; while (s.fn) { if (s.fn.locals.has(name)) return true; s = s.parent; } return globals.has(name); };
    function declare(sc, name, type, node) {
      if (name === "_") return type;
      const map = sc.fn && sc.fn.locals.has(name) ? sc.vars : globals;
      const old = map.get(name);
      if (old && old.node !== node) {
        if (!assignable(type, old.type)) err(`"${bare(name)}" was already declared as ${showT(old.type)} on line ${locLine(old.node.line)} and cannot become ${showT(type)}`, node);
        return old.type;
      }
      map.set(name, { type, node, inferred: !node.type && node.kind === "Assign" });
      return type;
    }

    function retOf(info) {
      if (info.ret) return info.ret;
      if (info.inferring) return NEVER;
      info.inferring = true;
      const r = checkFn(info, true);
      info.inferring = false;
      info.ret = r === NEVER ? (info.sawRet ? "any" : "void") : r;
      return info.ret;
    }
    function checkFn(info, infer, parentSc = info.parentSc || top) {
      const sc = { fn: info, vars: new Map(), rets: NEVER, infer, parent: parentSc };
      info.node.params.forEach((p, i) => sc.vars.set(p, { type: info.ptypes[i], node: info.node }));
      const results = info.declared ? resultsOf(info.declared) : [];
      (info.node.rnames || []).forEach((nm, i) => sc.vars.set(nm, { type: results[i], node: info.node }));
      stmt(info.node.body, sc);
      const ends = alwaysReturns(info.node.body);
      if (!infer && info.declared && info.declared !== "void" && !ends)
        err(`Function ${info.name} must return ${info.show(info.declared)}, but can reach the end without a return`, { line: info.node.endLine ?? info.node.line });
      return ends ? sc.rets : joinT(sc.rets, "void");
    }
    const resultsOf = (r) => (r === "void" ? [] : r.startsWith("(") ? tinfo(r).items : [r]);
    const joinT = (a, b) => (a === NEVER ? b : b === NEVER ? a : a === b ? a : isNumT(a) && isNumT(b) ? (isIntT(a) && isIntT(b) ? dflt(isUntyped(a) ? b : a) : "num") : "any");
    const sigTypeOf = (info) => funcTypeText(info.ptypes, resultsOf(retOf(info)));
    const fnType = (info, skipRecv) => funcTypeText(info.ptypes.slice(skipRecv ? 1 : 0), resultsOf(retOf(info)));

    // type of an expression that must produce exactly one value
    function val(n, sc, want) {
      const t = ty(n, sc, want);
      if (t === "void") err(n.kind === "Call" ? `${bare(n.name)}() returns no value, so its result cannot be used` : "This expression has no value", n);
      if (t.startsWith("(")) err(`This call returns ${tinfo(t).items.length} values; use a, b := ... to receive them`, n);
      return t;
    }
    function ty(n, sc, want) {
      const t = tyOf(n, sc, want);
      n.ty = t === NEVER ? "any" : t;
      return t;
    }
    // arithmetic between two numbers: the result type
    function unifyNum(a, b, n, op) {
      if (a === b) return a;
      if (isUntyped(a) && isUntyped(b)) return a === "flit" || b === "flit" ? "flit" : a === "rlit" || b === "rlit" ? "rlit" : "lit";
      if (isUntyped(a) || isUntyped(b)) {
        const [u, t] = isUntyped(a) ? [a, b] : [b, a];
        if (u !== "flit" || isFloatT(t)) return t;
        if (isIntT(t)) return "num";                                  // integer with 1.5: Caju does the math in num
      }
      if ((a === "num" && INT_KINDS.includes(b)) || (b === "num" && INT_KINDS.includes(a))) return "num";
      if ((a === "num" && b === "float32") || (b === "num" && a === "float32")) return "num";
      err(`"${op}" between ${showT(a)} and ${showT(b)}: the types differ. Convert one of them, e.g. ${showT(a)}(x)`, n);
    }
    function tyOf(n, sc, want) {
      switch (n.kind) {
        case "Number":
          if (n.rune) return "rlit";
          // integer literals are exact 64-bit values (up to the largest uint64)
          if (n.int !== false && n.raw != null) {
            if (BigInt(n.raw) >= 1n << 64n) err(`The integer ${n.raw} does not fit in 64 bits`, n);
            return "lit";
          }
          return n.int !== false && Number.isSafeInteger(n.value) ? "lit" : "flit";
        case "String": return "str";
        case "Bool": return "bool";
        case "Nil": return "nil";
        case "Paren": return ty(n.expr, sc, want);
        case "Var": {
          if (n.name === "_") err('"_" can only be used to discard a value in an assignment', n);
          const e = resolve(sc, n.name);
          if (e) return e.type;
          // function name used as a value
          if (fns.has(n.name) && !isVarName(sc, n.name)) { n.fnRef = true; return sigTypeOf(fns.get(n.name)); }
          return "any";
        }
        case "Neg": {
          const a = val(n.arg, sc);
          if (!isNumT(a) && !loose(a)) err(`Unary minus only works with numbers, but got ${showT(a)}`, n);
          return a;
        }
        case "BitNot": {
          const a = val(n.arg, sc);
          if (!isIntT(a) && !loose(a)) err(`^x flips the bits of an integer, but got ${showT(a)}`, n);
          return a;
        }
        case "Not": val(n.arg, sc); return "bool";
        case "Logical": val(n.left, sc); val(n.right, sc); return "bool";
        case "Binary": return binType(n, sc);
        case "Call": return callType(n, sc);
        case "StructLit": return structLitType(n, sc, n.type, n.fields.map((f) => ({ key: { kind: "Var", name: f.name, line: f.line, col: f.col }, value: f.value, line: f.line, col: f.col })));
        case "CompositeLit": return compositeType(n, sc, want);
        case "Field": return fieldType(n, sc);
        case "MethodCall": return methodType(n, sc);
        case "CallValue": {
          const f = val(n.fn, sc);
          if (loose(f)) { n.args.forEach((a) => val(a, sc)); return "any"; }
          const fi = tinfo(f);
          if (fi.k !== "func") err(`Only functions can be called, and this value is ${showT(f)}`, n);
          checkArgs(n, sc, fi.params, fi.params.map((_, i) => `#${i + 1}`), "the function");
          return fi.results.length === 0 ? "void" : fi.results.length === 1 ? fi.results[0] : `(${fi.results.join(", ")})`;
        }
        case "FuncLit": {
          const info = fnInfo(n.fn, sc);
          info.parentSc = sc;
          info.isLit = true;
          fns.set(n.fn.name, info);
          info.ptypes.forEach((t) => checkType(t, n));
          checkType(n.fn.rtype, n);
          retOf(info);
          checkFn(info, false, sc);
          info.node.retTy = info.ret;
          return fnType(info, false);
        }
        case "Index": {
          const o = val(n.obj, sc);
          if (loose(o)) { val(n.index, sc); return "any"; }
          const oi = tinfo(o.startsWith("*") && kindOf(o.slice(1)) === "array" ? o.slice(1) : o);
          if (oi.k === "map") {
            const k = val(n.index, sc);
            bindCheck(n.index, k, oi.key, "The map key");
            return oi.val;
          }
          const i = val(n.index, sc);
          if (!isIntT(i) && !loose(i)) err(`The index must be an integer, not ${showT(i)}`, n.index);
          if (o === "str") return "uint8";
          if (oi.k === "slice" || oi.k === "array") { if (oi.k === "array" && n.index.kind === "Number" && (n.index.value < 0 || n.index.value >= oi.n)) err(`Index ${n.index.value} out of range for array of length ${oi.n}`, n.index); return oi.elem; }
          err(`[ ] only works with slices, arrays, maps and strings, and this value is ${showT(o)}`, n);
        }
        case "SliceExpr": {
          const o = val(n.obj, sc);
          for (const x of [n.lo, n.hi]) if (x) { const t = val(x, sc); if (!isIntT(t) && !loose(t)) err(`Slice bounds must be integers, not ${showT(t)}`, x); }
          if (loose(o) || o === "str") return o;
          const oi = tinfo(o.startsWith("*") ? o.slice(1) : o);
          if (oi.k === "slice") return o;
          if (oi.k === "array") return "[]" + oi.elem;
          err(`Only slices, arrays and strings can be sliced, and this value is ${showT(o)}`, n);
        }
        case "AddrOf": {
          const a = n.arg;
          if (a.kind === "StructLit" || a.kind === "CompositeLit") return "*" + val(a, sc);
          if (!["Var", "Field", "Index", "Deref", "Paren"].includes(a.kind)) err("You can only take the address (&) of a variable, a field, an element or a new struct", n);
          const t = val(a, sc);
          if (a.kind === "Index" && kindOf(a.obj.ty || "any") === "map") err("Cannot take the address of a value inside a map", n);
          if (a.kind === "Var") markAddr(sc, a.name, t);
          return "*" + dflt(t);
        }
        case "Deref": {
          const p = val(n.arg, sc);
          if (loose(p)) return "any";
          if (kindOf(p) !== "ptr") err(`Only pointers can be dereferenced with *, and this value is ${showT(p)}`, n);
          return tinfo(p).elem;
        }
        case "Recv": {
          const c = val(n.arg, sc);
          if (loose(c)) return "any";
          if (kindOf(c) !== "chan") err(`<- receives from a channel, and this value is ${showT(c)}`, n);
          return tinfo(c).elem;
        }
        case "TypeAssert": {
          const o = val(n.obj, sc);
          checkType(n.type, n);
          if (!isIface(o) && !loose(o)) err(`x.(T) only works on interfaces and any, and this value is ${showT(o)}`, n);
          return n.type;
        }
        case "Conversion": return conversionType(n, sc, n.type, n.args);
        case "TypeOf": err("x.(type) can only appear in a type switch: switch v := x.(type) { ... }", n);
      }
      return "any";
    }
    function markAddr(sc, name, t) {
      // pointer to a local variable: it moves into a cell (structs and arrays are already objects)
      let s = sc;
      while (s.fn) {
        if (s.fn.locals.has(name)) {
          if (!isStruct(t) && kindOf(t) !== "array") { s.fn.node.celled = s.fn.node.celled || new Set(); s.fn.node.celled.add(name); }
          if (s !== sc) resolve(sc, name);
          return;
        }
        s = s.parent;
      }
    }
    function binType(n, sc) {
      const op = n.op;
      const a = val(n.left, sc), b = val(n.right, sc);
      if (op === "==" || op === "!=") {
        const ok = loose(a) || loose(b) || assignable(a, b) || assignable(b, a) || (isNumT(a) && isNumT(b));
        if (!ok) err(`Comparing ${showT(a)} with ${showT(b)} using "${op}" is always ${op === "==" ? "false" : "true"}, because the types differ`, n);
        for (const [x, y] of [[a, b], [b, a]]) if (["slice", "map", "func"].includes(kindOf(x)) && y !== "nil" && !loose(y)) err(`Slices, maps and functions can only be compared with nil`, n);
        if (isNumT(a) && isNumT(b) && !loose(a) && !loose(b)) n.nk = KIND_CODE[dflt(unifyNum(a, b, n, op))];
        // interface compared with a concrete value: the value gets boxed so the comparison takes the type into account
        if (isIface(a) && !isIface(b) && !loose(b)) conv(n.right, b, a);
        if (isIface(b) && !isIface(a) && !loose(a)) conv(n.left, a, b);
        return "bool";
      }
      if (op === "<" || op === ">" || op === "<=" || op === ">=") {
        if (loose(a) || loose(b)) return "bool";
        if (a === "str" && b === "str") return "bool";
        if (isNumT(a) && isNumT(b)) { n.nk = KIND_CODE[dflt(unifyNum(a, b, n, op))]; return "bool"; }
        err(`Cannot compare ${showT(a)} with ${showT(b)} using "${op}"`, n);
      }
      if (op === "+" && (a === "str" || b === "str")) return "str";
      if (loose(a) || loose(b)) {
        if (op === "/" || op === "**") return op === "/" && (isIntT(a) || isIntT(b)) ? "any" : "num";
        return "any";
      }
      if (["&", "|", "^", "&^", "<<", ">>"].includes(op)) {
        if (!isIntT(a) || !isIntT(b)) err(`"${op}" works on the bits of integers, but got ${showT(a)} and ${showT(b)}`, n);
        const r = op === "<<" || op === ">>" ? a : unifyNum(a, b, n, op);
        if (!isUntyped(r)) n.ik = KIND_CODE[r];
        else n.ik = 0;
        return r;
      }
      if (!isNumT(a) || !isNumT(b))
        err(op === "+" ? `"+" adds numbers or concatenates strings, but got ${showT(a)} and ${showT(b)}` : `Operator "${op}" only works with numbers, but got ${showT(a)} and ${showT(b)}`, n);
      if (op === "**") return a === "lit" && b === "lit" ? "lit" : "num";
      const r = unifyNum(a, b, n, op);
      if (isIntT(r)) n.ik = KIND_CODE[dflt(r)];               // integer math: division truncates, and the value wraps around at the limit
      else if (r === "float32") n.fk = 10;
      return r;
    }
    function checkArgs(n, sc, ptypes, pnames, label, info) {
      const args = n.args;
      if (args.spread) err("... can only be used on the last argument of append", n);
      if (args.length !== ptypes.length) err(`${label[0].toUpperCase() + label.slice(1)} expects ${plural(ptypes.length, "argument")}, but got ${args.length}`, n);
      args.forEach((a, i) => {
        const t = val(a, sc, ptypes[i]);
        const who = label.replace(/^(function|method|field) /i, "");
        bindCheck(a, t, ptypes[i], /^#\d+$/.test(pnames[i]) ? `Argument ${pnames[i].slice(1)} of ${who}` : `Parameter "${pnames[i]}" of ${who}`);
      });
    }
    function callType(n, sc) {
      const args = n.args;
      const nm = n.name;
      // a variable holding a function: call the value
      if (isVarName(sc, nm)) {
        n.callKind = "value";
        const f = val({ kind: "Var", name: nm, line: n.line, col: n.col }, sc);
        if (loose(f)) { args.forEach((a) => val(a, sc)); return "any"; }
        const fi = tinfo(f);
        if (fi.k !== "func") err(`"${bare(nm)}" is ${showT(f)}, not a function`, n);
        checkArgs(n, sc, fi.params, fi.params.map((_, i) => `#${i + 1}`), `function ${bare(nm)}`);
        return fi.results.length === 0 ? "void" : fi.results.length === 1 ? fi.results[0] : `(${fi.results.join(", ")})`;
      }
      if (CONVERSIONS.includes(nm) && !fns.has(nm)) { n.callKind = "conv"; return conversionType(n, sc, TYPE_ALIASES[nm] || nm, args); }
      if ((structs.has(nm) || ifaces.has(nm)) && !fns.has(nm)) { n.callKind = "conv"; return conversionType(n, sc, nm, args); }
      if (SPECIAL_BUILTINS.includes(nm) && !fns.has(nm)) { n.callKind = "builtin"; return builtinType(n, sc); }
      const bsig = BUILTIN_SIG[nm] || ((tcOpts.intrinsics || n.privileged) && INTRINSIC_SIG[nm]);
      if (bsig) {
        n.callKind = "builtin";
        const [ps, r] = bsig;
        if (args.length !== ps.length) err(`${nm} expects ${plural(ps.length, "argument")}, but got ${args.length}`, n);
        args.forEach((a, i) => {
          const t = val(a, sc);
          const okBool = i === 1 && nm.startsWith("poke") && t === "bool";
          if (!assignable(t, ps[i]) && !okBool && !(isNumT(t) && isNumT(ps[i]))) err(`${nm} expects ${ps[i]}${ps.length > 1 ? ` as argument ${i + 1}` : ""}, but got ${showT(t)}`, a);
        });
        return r;
      }
      if (externs.has(nm)) {
        n.callKind = "extern";
        const ext = externs.get(nm);
        if (args.length !== ext.params.length) err(`${ext.symbol} expects ${plural(ext.params.length, "argument")}, but got ${args.length}`, n);
        args.forEach((a, i) => {
          const t = val(a, sc), prm = ext.params[i];
          const text = prm.type === "str" || prm.type === "wstr";
          const ok = loose(t) || (text ? t === "str" || isNumT(t) || t === "nil" : prm.type === "bool" ? true : isNumT(t) || t === "bool" || t === "nil");
          if (!ok) err(`Parameter "${prm.name}" of ${ext.symbol} is ${prm.type}${text ? " (string or pointer)" : " (number)"}, but got ${showT(t)}`, a);
        });
        return FFI_LANG[ext.ret];
      }
      const info = fns.get(nm);
      if (!info) { n.callKind = "unknown"; args.forEach((a) => val(a, sc)); return "any"; }
      n.callKind = "func";
      checkArgs(n, sc, info.ptypes, info.params, `function ${info.name}`);
      return retOf(info);
    }
    function conversionType(n, sc, to, args) {
      if (args.length !== 1) err(`Conversion ${showT(to)}(x) takes one value`, n);
      checkType(to, n);
      const a = args[0];
      const t = val(a, sc, to);
      n.convTo = to;
      if (loose(t)) return to;
      if (to === "str") { n.convMode = "fmt"; if (n.name === "string") { if (isIntT(t)) n.convMode = "rune"; else if (t === "[]uint8") n.convMode = "bytes"; else if (t === "[]int32") n.convMode = "runes"; else if (t !== "str") err(`string(x) converts a rune, []byte or []rune; for other values use str(x)`, n); } else if (n.kind === "Conversion") err("Use str(x)", n); return "str"; }
      if (isNumT(to)) {
        if (!isNumT(t)) err(`${showT(to)}(x) converts numbers, but got ${showT(t)}`, n);
        n.convMode = "num";
        return to;
      }
      if (to === "[]uint8" || to === "[]int32") {
        if (t === "str") { n.convMode = to === "[]uint8" ? "tobytes" : "torunes"; return to; }
        if (t === to) { n.convMode = "same"; return to; }
        err(`${to}(x) converts a string, but got ${showT(t)}`, n);
      }
      if (isIface(to)) { bindCheck(a, t, to, "The converted value"); n.convMode = "same"; return to; }
      if (t === to) { n.convMode = "same"; return to; }
      err(`Cannot convert ${showT(t)} to ${showT(to)}`, n);
    }
    function builtinType(n, sc) {
      const nm = n.name, args = n.args;
      const want = (k) => { if (args.length !== k) err(`${nm} expects ${plural(k, "argument")}, but got ${args.length}`, n); };
      switch (nm) {
        case "print": args.forEach((a) => { const t = ty(a, sc); if (t === "void") err("This value does not exist: the function returns nothing", a); }); return "void";
        case "len": case "cap": {
          want(1);
          const t = val(args[0], sc);
          const k = kindOf(t.startsWith("*") ? t.slice(1) : t);
          const ok = loose(t) || (nm === "len" ? t === "str" || ["slice", "array", "map", "chan"].includes(k) : ["slice", "array", "chan"].includes(k));
          if (!ok) err(`${nm}(x) works with ${nm === "len" ? "strings, slices, arrays, maps and channels" : "slices, arrays and channels"}, not with ${showT(t)}`, n);
          return "int";
        }
        case "append": {
          if (!args.length) err("append(s, values...) needs at least the slice", n);
          const s = val(args[0], sc);
          if (loose(s)) { args.slice(1).forEach((a) => val(a, sc)); n.appendT = "[]any"; return "any"; }
          if (kindOf(s) !== "slice") err(`The first argument of append must be a slice, not ${showT(s)}`, args[0]);
          const elem = tinfo(s).elem;
          n.appendT = s;
          if (args.spread) {
            if (args.length !== 2) err("With ..., append takes only two arguments: append(a, b...)", n);
            const t = val(args[1], sc);
            if (!(t === s || (elem === "uint8" && t === "str") || loose(t))) err(`append(a, b...) joins two slices of the same type, but got ${showT(s)} and ${showT(t)}`, args[1]);
            return s;
          }
          args.slice(1).forEach((a) => { const t = val(a, sc, elem); bindCheck(a, t, elem, "The element"); });
          return s;
        }
        case "copy": {
          want(2);
          const d = val(args[0], sc), s = val(args[1], sc);
          if (!loose(d) && kindOf(d) !== "slice") err(`copy(dst, src) copies into a slice, not into ${showT(d)}`, args[0]);
          if (!loose(d) && !loose(s) && s !== d && !(s === "str" && d === "[]uint8")) err(`copy needs slices of the same type, but got ${showT(d)} and ${showT(s)}`, n);
          return "int";
        }
        case "delete": {
          want(2);
          const m = val(args[0], sc);
          if (loose(m)) { val(args[1], sc); return "void"; }
          if (kindOf(m) !== "map") err(`delete(m, key) deletes from a map, not from ${showT(m)}`, args[0]);
          bindCheck(args[1], val(args[1], sc), tinfo(m).key, "The key");
          return "void";
        }
        case "make": {
          const t = n.typeArg;
          if (!t) err("make(T, ...) takes a type: make([]int, 10), make(map[str]int) or make(chan int)", n);
          checkType(t, n);
          const k = kindOf(t);
          if (!["slice", "map", "chan"].includes(k)) err(`make creates slices, maps and channels, not ${showT(t)}`, n);
          if (k === "slice" && (args.length < 1 || args.length > 2)) err("Use make([]T, length) or make([]T, length, capacity)", n);
          if (k !== "slice" && args.length > 1) err(`make(${t}) takes at most one number`, n);
          args.forEach((a) => { const x = val(a, sc); if (!isIntT(x) && !loose(x)) err(`make sizes must be integers, not ${showT(x)}`, a); });
          return t;
        }
        case "new": {
          if (!n.typeArg || args.length) err("new(T) takes only a type, like new(int) or new(Point)", n);
          checkType(n.typeArg, n);
          return "*" + n.typeArg;
        }
        case "panic": want(1); val(args[0], sc); return "void";
        case "recover": want(0); return "any";
        case "close": {
          want(1);
          const c = val(args[0], sc);
          if (!loose(c) && kindOf(c) !== "chan") err(`close closes a channel, not ${showT(c)}`, args[0]);
          return "void";
        }
      }
    }
    function structLitType(n, sc, sname, elems) {
      const S = structs.get(sname);
      if (!S) err(ifaces.has(sname) ? `${sname} is an interface; only structs can be created with {...}` : `Struct "${sname}" does not exist`, n);
      const seen = new Set();
      const keyed = elems.length && elems.every((e) => e.key);
      if (elems.length && !keyed) {
        // Point{1, 2}: all fields, in order
        if (elems.some((e) => e.key)) err("Either all fields are named or none are", n);
        if (elems.length !== S.node.fields.length) err(`${sname}{...} without field names needs all ${S.node.fields.length} fields, in order`, n);
      }
      n.sfields = elems.map((e, i) => {
        const f = keyed ? e.key.name : S.node.fields[i].name;
        if (keyed && e.key.kind !== "Var") err("In a struct literal, the key is the field name", e);
        const fd = S.fields.get(f);
        if (!fd) err(`struct ${sname} has no field "${f}"`, e);
        if (seen.has(f)) err(`Field "${f}" appears twice`, e);
        seen.add(f);
        const t = val(e.value, sc, fd.type);
        bindCheck(e.value, t, fd.type, `Field ${f} of ${sname}`);
        return { name: f, value: e.value };
      });
      n.stype = sname;
      return sname;
    }
    function compositeType(n, sc, want) {
      const t = n.type || (want && !loose(want) ? want.replace(/^\*/, "") : null);
      if (!t) err("An untyped {...} can only appear inside another literal, like []Point{{1, 2}}", n);
      if (!n.type) n.type = t;
      checkType(t, n);
      if (structs.has(t)) { const r = structLitType(n, sc, t, n.elems); return want && want.startsWith("*") ? (n.addr = true, want) : r; }
      const ti = tinfo(t);
      if (ti.k === "slice" || ti.k === "array") {
        n.elems.forEach((e) => {
          if (e.key) err("Indexed elements ({2: x}) are not supported; write the values in order", e);
          bindCheck(e.value, val(e.value, sc, ti.elem), ti.elem, "The element");
        });
        if (ti.k === "array" && n.elems.length > ti.n) err(`The array has ${ti.n} elements, but got ${n.elems.length} values`, n);
        return t;
      }
      if (ti.k === "map") {
        n.elems.forEach((e) => {
          if (!e.key) err("Each map element must be key: value", e);
          bindCheck(e.key, val(e.key, sc, ti.key), ti.key, "The key");
          bindCheck(e.value, val(e.value, sc, ti.val), ti.val, "The value");
        });
        return t;
      }
      err(`Cannot create ${showT(t)} with {...}`, n);
    }
    function fieldType(n, sc) {
      // errors.New and other package names do not exist as variables
      const t = val(n.obj, sc);
      if (loose(t)) return "any";
      const base = t.startsWith("*") ? t.slice(1) : t;
      if (!structs.has(base)) err(ifaces.has(t) ? `${showT(t)} is an interface: interfaces have methods, not fields` : `Only structs have fields, and this value is ${showT(t)}`, n);
      const hit = lookup(base, n.name);
      if (!hit) err(`struct ${base} has no field "${n.name}"`, n);
      if (hit.kind === "ambiguous") err(`"${n.name}" is ambiguous: it exists in more than one embedded struct`, n);
      n.path = hit.path;
      if (hit.kind === "method") {
        // method as a value (p.method without calling it): a function with the receiver already bound
        n.boundMethod = hit.m.info.node.name; n.recvPtr = hit.m.ptr;
        return fnType(hit.m.info, true);
      }
      return hit.type;
    }
    function methodType(n, sc) {
      if (n.obj.kind === "Var" && n.obj.name === "errors" && !isVarName(sc, "errors") && n.name === "New") {
        n.callKind = "errnew";
        if (n.args.length !== 1) err("errors.New takes the error message", n);
        const t = val(n.args[0], sc);
        if (t !== "str" && !loose(t)) err(`errors.New takes a string, not ${showT(t)}`, n.args[0]);
        return "error";
      }
      const t = val(n.obj, sc);
      n.target = null;
      if (loose(t)) { n.args.forEach((a) => val(a, sc)); return "any"; }
      const base = t.startsWith("*") ? t.slice(1) : t;
      if (structs.has(base)) {
        const hit = lookup(base, n.name);
        if (!hit) err(`struct ${base} has no method "${n.name}"`, n);
        if (hit.kind === "ambiguous") err(`"${n.name}" is ambiguous: it exists in more than one embedded struct`, n);
        n.path = hit.path;
        if (hit.kind === "field") {
          // field holding a function: load the field and call the value
          n.fieldCall = true;
          const fi = tinfo(hit.type);
          if (loose(hit.type)) { n.args.forEach((a) => val(a, sc)); return "any"; }
          if (fi.k !== "func") err(`${n.name} is a field of type ${showT(hit.type)}, not a method`, n);
          checkArgs(n, sc, fi.params, fi.params.map((_, i) => `#${i + 1}`), `field ${n.name}`);
          return fi.results.length === 0 ? "void" : fi.results.length === 1 ? fi.results[0] : `(${fi.results.join(", ")})`;
        }
        const mm = hit.m;
        checkArgs(n, sc, mm.info.ptypes.slice(1), mm.info.params.slice(1), `method ${base}.${n.name}`);
        // known type: the call goes straight to the function, without looking up the method at run time
        n.target = mm.info.node.name; n.recvPtr = mm.ptr; n.recvIsPtr = t.startsWith("*");
        return retOf(mm.info);
      }
      if (ifaces.has(t)) {
        const sig = ifaces.get(t).methods.get(n.name);
        if (!sig) err(`Interface ${showT(t)} has no method "${n.name}"`, n);
        checkArgs(n, sc, sig.ptypes, sig.params, `method ${showT(t)}.${n.name}`);
        return sig.rtype;
      }
      err(`Only structs and interfaces have methods, and this value is ${showT(t)}`, n);
    }

    // ---- statements ----
    // types of the values on the right-hand side of a multiple assignment
    function rhsTypes(values, count, sc, node, wants = []) {
      if (values.length === 1 && count === 2 && ["Index", "TypeAssert", "Recv"].includes(values[0].kind)) {
        // v, ok := m[k]   v, ok := x.(T)   v, ok := <-ch
        const v = values[0];
        const t = val(v, sc);
        if (v.kind === "Index" && !loose(v.obj.ty) && kindOf(v.obj.ty) !== "map") err("The form v, ok := a[i] only works with maps", v);
        v.commaOk = true;
        return [t, "bool"];
      }
      if (values.length === 1 && count > 1) {
        const t = ty(values[0], sc);
        if (!t.startsWith("(")) { if (loose(t)) return Array(count).fill("any"); err(node.kind === "Return" ? `The function returns ${count} values, but the return has only one` : `${count} variables receiving a single value`, node); }
        const items = tinfo(t).items;
        if (items.length !== count) err(`The call returns ${items.length} values, but there are ${count} variables`, node);
        values[0].unpack = count;
        return items;
      }
      if (values.length !== count) err(node.kind === "Return" ? `The function returns ${plural(count, "value")}, but the return has ${values.length}` : `${count} ${count === 1 ? "variable" : "variables"} and ${values.length} ${values.length === 1 ? "value" : "values"}`, node);
      return values.map((v, i) => val(v, sc, wants[i]));
    }
    function targetType(e, sc) {
      if (e.kind === "Var") {
        if (e.name === "_") return "any";
        const v = resolve(sc, e.name);
        e.ty = v ? v.type : "any";
        return e.ty;
      }
      if (e.kind === "Index" && e.obj.ty === undefined) {
        const t = val(e, sc);
        if (e.obj.ty === "str") err("Strings are immutable: s[i] = x is not allowed", e);
        return t;
      }
      const t = val(e, sc);
      if (e.kind === "Index" && e.obj.ty === "str") err("Strings are immutable: s[i] = x is not allowed", e);
      return t;
    }
    const declOwn = (n, t) => (n.decl === "let" && (isIntT(t) && (t === "int" || isUntyped(t))) ? "num" : n.decl === "const" ? t : dflt(t));
    function stmt(n, sc) {
      if (!n) return;
      switch (n.kind) {
        case "ExprStmt": {
          const t = ty(n.expr, sc);
          n.expr.discard = t.startsWith("(") ? tinfo(t).items.length : t === "void" ? 0 : 1;
          return;
        }
        case "Block": case "Module": case "Program": n.body.forEach((s) => stmt(s, sc)); return;
        case "Func": case "Extern": case "Struct": case "Interface": case "Import": return;
        case "Return": {
          const info = sc.fn;
          const results = info.declared ? resultsOf(info.declared) : null;
          if (results) {
            const r = info.declared;
            if (!n.values.length) {
              if (results.length && !info.node.rnames) err(`Function ${info.name} must return ${info.show(r)}; write return followed by ${results.length === 1 ? "a value" : "the values"}`, n);
              n.named = !!info.node.rnames;
              return;
            }
            if (!results.length) err(`Function ${info.name} returns no value, so the return cannot return anything`, n);
            const ts = rhsTypes(n.values, results.length, sc, n, results);
            if (n.values.length === 1 && results.length === 1) bindCheck(n.values[0], ts[0], results[0], `Function ${info.name} must return ${info.show(r)}, but this return gives ${showT(ts[0])}. The result`);
            else ts.forEach((t, i) => { if (!assignable(t, results[i])) err(`Result ${i + 1} of ${info.name} is ${showT(results[i])}, but got ${showT(t)}${hint(t, results[i])}`, n.values[i] || n); conv(n.values[i], t, results[i]); });
            n.nres = results.length;
          } else {
            const ts = n.values.map((v) => val(v, sc));
            const t = ts.length === 0 ? "void" : ts.length === 1 ? dflt(ts[0]) : `(${ts.map(dflt).join(", ")})`;
            sc.rets = joinT(sc.rets, t);
            sc.fn.sawRet = true;
            n.nres = ts.length;
          }
          return;
        }
        case "FieldAssign": {
          const want = fieldType({ kind: "Field", obj: n.obj, name: n.name, line: n.line, col: n.col }, sc);
          n.path = n.obj.ty && lookup((n.obj.ty || "").replace(/^\*/, ""), n.name)?.path;
          n.fty = want;
          const t = val(n.value, sc, want);
          bindCheck(n.value, t, want, `Field ${n.name}`);
          return;
        }
        case "Assign": {
          checkType(n.type, n);
          if (n.value === null) { n.ty = declare(sc, n.name, n.type, n); return; }
          const t = val(n.value, sc, n.type || undefined);
          if (n.decl) {
            if (n.type) bindCheck(n.value, t, n.type, `"${bare(n.name)}"`);
            if (n.decl === "const" && !(isNumT(t) || t === "str" || t === "bool")) err("A constant can only hold numbers, strings or bool; for other values, use let", n);
            if (t === "nil" && !n.type) err("nil has no type; specify one: let x: *Point = nil", n.value);
            n.ty = declare(sc, n.name, n.type || (t === NEVER ? "any" : declOwn(n, t)), n);
          } else {
            const e = resolve(sc, n.name);
            if (e && e.node && e.node.decl === "const" && e.node.kind === "Assign") return;      // the compiler reports it
            if (e) {
              bindCheck(n.value, t, e.type, `"${bare(n.name)}"${e.node ? ` (line ${locLine(e.node.line)})` : ""}`);
              n.ty = e.type;
            }
          }
          return;
        }
        case "VarDecl": {
          const ts = rhsTypes(n.values, n.names.length, sc, n);
          n.types = n.names.map((nm, i) => {
            if (ts[i] === "nil") err("nil has no type; specify one with let x: T = nil", n);
            return declare(sc, nm, ts[i] === NEVER ? "any" : dflt(ts[i]), n);
          });
          n.names.forEach((nm, i) => conv(n.values.length === n.names.length ? n.values[i] : null, ts[i], n.types[i]));
          return;
        }
        case "MultiAssign": {
          const tts = n.targets.map((e) => targetType(e, sc));
          const ts = rhsTypes(n.values, n.targets.length, sc, n, tts);
          ts.forEach((t, i) => {
            if (n.targets[i].kind === "Var" && n.targets[i].name === "_") return;
            const v = n.values.length === n.targets.length ? n.values[i] : n;
            if (!assignable(t, tts[i])) err(`${n.targets.length > 1 ? `Target ${i + 1}` : "The target"} is ${showT(tts[i])}, but got ${showT(t)}${hint(t, tts[i])}`, v);
            if (v !== n) conv(v, t, tts[i]);
          });
          return;
        }
        case "OpAssign": {
          const tt = targetType(n.target, sc);
          const fake = { kind: "Binary", op: n.op, left: n.target, right: n.value, line: n.line, col: n.col };
          const r = binType(fake, sc);
          n.ik = fake.ik; n.fk = fake.fk;
          if (!assignable(r, tt)) err(`"${n.op}=" would produce ${showT(r)}, which does not fit in ${showT(tt)}`, n);
          return;
        }
        case "If":
          if (n.init) stmt(n.init, sc);
          val(n.cond, sc); stmt(n.then, sc); if (n.otherwise) stmt(n.otherwise, sc); return;
        case "While": val(n.cond, sc); stmt(n.body, sc); return;
        case "ForC":
          if (n.init) stmt(n.init, sc);
          if (n.cond) val(n.cond, sc);
          if (n.post) stmt(n.post, sc);
          stmt(n.body, sc);
          return;
        case "ForTo": {
          const a = val(n.from, sc), b = val(n.to, sc);
          for (const [t, at] of [[a, n.from], [b, n.to]]) if (!isNumT(t) && !loose(t)) err(`The for loop counts with numbers, but got ${showT(t)}`, at);
          n.ty = declare(sc, n.name, isFloatT(a) || isFloatT(b) ? "num" : isIntT(a) && isIntT(b) ? dflt(isUntyped(a) ? b : a) : "num", n);
          stmt(n.body, sc);
          return;
        }
        case "Range": {
          const s = val(n.subject, sc);
          let kt = "any", vt = "any", rk = "any";
          if (!loose(s)) {
            const si = tinfo(s.startsWith("*") && kindOf(s.slice(1)) === "array" ? s.slice(1) : s);
            if (s === "str") { kt = "int"; vt = "int32"; rk = "str"; }
            else if (isIntT(s)) { kt = dflt(s); vt = null; rk = "int"; }
            else if (si.k === "slice" || si.k === "array") { kt = "int"; vt = si.elem; rk = si.k; }
            else if (si.k === "map") { kt = si.key; vt = si.val; rk = "map"; }
            else if (si.k === "chan") { kt = si.elem; vt = null; rk = "chan"; }
            else err(`range iterates over strings, slices, arrays, maps, channels and integers, not ${showT(s)}`, n.subject);
          }
          n.rk = rk;
          if (n.vars.length === 2 && vt === null) err(`range over ${rk === "int" ? "an integer" : "a channel"} yields only one value`, n);
          const types = [kt, vt];
          n.vars.forEach((v, i) => {
            if (n.decl) { if (v.name !== "_") v.ty = declare(sc, v.name, types[i], n); }
            else { const tt = targetType(v, sc); if (!assignable(types[i], tt)) err(`range yields ${showT(types[i])}, which does not fit in ${showT(tt)}`, v); }
          });
          stmt(n.body, sc);
          return;
        }
        case "Switch": {
          if (n.init) stmt(n.init, sc);
          const tag = n.tag ? val(n.tag, sc) : "bool";
          for (const c of n.cases) {
            for (const e of c.exprs || []) {
              const t = val(e, sc);
              if (!n.tag) { if (t !== "bool" && !loose(t)) err(`In a switch without a value, each case is a condition (bool), not ${showT(t)}`, e); continue; }
              if (!(loose(t) || loose(tag) || assignable(t, tag) || assignable(tag, t) || (isNumT(t) && isNumT(tag))))
                err(`The case compares ${showT(t)} with the switch value, which is ${showT(tag)}`, e);
              if (isIface(tag) && !isIface(t)) conv(e, t, tag);
            }
            c.body.forEach((s) => stmt(s, sc));
          }
          return;
        }
        case "TypeSwitch": {
          if (n.init) stmt(n.init, sc);
          const s = val(n.subject, sc);
          if (!isIface(s) && !loose(s)) err(`A type switch needs an interface or any, and this value is ${showT(s)}`, n.subject);
          for (const c of n.cases) {
            (c.types || []).forEach((t) => { if (t !== "nil") checkType(t, c); });
            if (n.bind) {
              const bt = c.types && c.types.length === 1 && c.types[0] !== "nil" ? c.types[0] : s;
              // each case has its own variable, with the case's type
              c.bindType = bt;
              const saved = (sc.fn ? sc.vars : globals).get(n.bind);
              (sc.fn && sc.fn.locals.has(n.bind) ? sc.vars : globals).set(n.bind, { type: bt, node: c });
              c.body.forEach((x) => stmt(x, sc));
              if (saved) (sc.fn && sc.fn.locals.has(n.bind) ? sc.vars : globals).set(n.bind, saved);
            } else c.body.forEach((x) => stmt(x, sc));
          }
          return;
        }
        case "Select":
          for (const c of n.cases) {
            if (c.kind === "send") {
              const ch = val(c.ch, sc);
              if (!loose(ch)) { if (kindOf(ch) !== "chan") err(`You can only send on a channel, and this value is ${showT(ch)}`, c.ch); bindCheck(c.value, val(c.value, sc, tinfo(ch).elem), tinfo(ch).elem, "The sent value"); }
              else val(c.value, sc);
            } else if (c.kind === "recv") {
              const ch = val(c.ch, sc);
              const et = loose(ch) ? "any" : kindOf(ch) === "chan" ? tinfo(ch).elem : err(`You can only receive from a channel, and this value is ${showT(ch)}`, c.ch);
              const ts = [et, "bool"];
              if (c.vars.length > 2) err("A case receives at most two values: v, ok", c);
              c.vars.forEach((v, i) => {
                if (c.decl) { if (v.name !== "_") v.ty = declare(sc, v.name, ts[i], c); }
                else { const tt = targetType(v, sc); if (!assignable(ts[i], tt)) err(`The channel yields ${showT(ts[i])}, which does not fit in ${showT(tt)}`, v); }
              });
            }
            c.body.forEach((s) => stmt(s, sc));
          }
          return;
        case "Send": {
          const ch = val(n.ch, sc);
          if (loose(ch)) { val(n.value, sc); return; }
          if (kindOf(ch) !== "chan") err(`You can only send on a channel, and this value is ${showT(ch)}`, n.ch);
          const et = tinfo(ch).elem;
          bindCheck(n.value, val(n.value, sc, et), et, "The sent value");
          return;
        }
        case "Defer": case "Go": {
          const t = ty(n.call, sc);
          n.call.discard = t.startsWith("(") ? tinfo(t).items.length : t === "void" ? 0 : 1;
          if (n.call.kind === "Call" && n.call.callKind === "conv") err(`${n.kind === "Defer" ? "defer" : "go"} must be followed by a function call, not a conversion`, n);
          return;
        }
        case "Break": case "Continue": case "Fallthrough": return;
      }
    }

    stmt(ast, top);
    for (const info of [...fns.values()]) if (!info.isLit) { info.node.retTy = retOf(info); checkFn(info, false); }
    // summary for the Types tab
    const sig = (info) => ({ name: info.name, params: info.params.map((p, i) => ({ name: p, type: bare(showT(info.ptypes[i])), declared: !!(info.node.ptypes && info.node.ptypes[i]) })),
      ret: bare(showT(info.ret)), retDeclared: !!info.declared, dll: !!info.node.dll, line: info.node.line, node: info.node });
    const implementers = (I) => [...structs.keys()].flatMap((sn) => (!missing(sn, I) ? [bare(sn)] : !missing("*" + sn, I) ? ["*" + bare(sn)] : []));
    return {
      functions: [...fns.values()].filter((info) => !info.node.recv && !info.isLit).map(sig),
      structs: [...structs].map(([nm, S]) => ({ name: bare(nm), line: S.node.line, fields: S.node.fields.map((f) => ({ name: f.name, type: bare(f.type), embedded: !!f.embedded })),
        methods: [...S.methods].map(([m, mm]) => ({ name: m, ptr: mm.ptr, params: mm.info.params.slice(1).map((p, i) => ({ name: p, type: bare(showT(mm.info.ptypes[i + 1])) })), ret: bare(showT(mm.info.ret)), retDeclared: !!mm.info.declared })) })),
      interfaces: [...ifaces].filter(([, I]) => !I.builtin).map(([nm, I]) => ({ name: bare(nm), line: I.node.line, methods: [...I.methods.values()].map((m) => `${m.name}${bare(sigText(m.ptypes, m.rtype))}`), by: implementers(nm) })),
      globals: [...globals].filter(([nm]) => !nm.includes("·")).map(([nm, e]) => ({ name: nm, type: bare(showT(e.type)), inferred: e.inferred, isConst: e.node.decl === "const", line: e.node.line })),
      structTable: structs, ifaceTable: ifaces, methodSet, globalCelled,
    };
  }

