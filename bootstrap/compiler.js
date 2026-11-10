  // =====================================================================
  // 3. Compiler: tree → bytecode
  // =====================================================================
  // The bytecode is a flat list of integers. Each instruction is an
  // opcode followed by 0 to 4 operands. Global variables become
  // non-negative indices into a table; a function's local variables become
  // negative indices (-1 is the first local), relative to the call frame.
  const OP_NAMES = ["HALT", "CONST", "LOAD", "STORE", "SET", "POP",
    "ADD", "SUB", "MUL", "DIV", "MOD", "POW", "NEG",
    "EQ", "NE", "LT", "GT", "LE", "GE", "NOT", "TO_BOOL",
    "JMP", "JMP_IF_FALSE", "JMP_IF_TRUE", "CALL", "FOR_INIT", "FOR_TEST", "FOR_STEP",
    // superinstructions, created only by the optimizer
    "BINK", "LOAD_BINK", "LOAD2_BIN", "UPDATE_K", "UPDATE_S",
    "JMP_UNLESS", "JMP_WHEN", "JMP_UNLESS_K", "JMP_WHEN_K", "CALL_VOID", "FOR_NEXT",
    // functions and DLLs
    "CALLF", "RET", "RET_NULL", "CALL_EXT",
    // structs and methods
    "NEW_STRUCT", "GET_FIELD", "SET_FIELD", "CALL_METHOD", "COPY",
    // integers, closures, defer/go/panic, collections, pointers, interfaces and channels
    "IOP", "CONV", "MAKE_CLOSURE", "CALL_VALUE", "LOAD_CELL", "STORE_CELL", "NEW_CELL", "LOAD_CELLREF", "LOAD_UP", "STORE_UP", "LOAD_UPREF", "REBOX",
    "RETN", "RET_NAMED", "DEFER", "GO", "PANIC", "RECOVER",
    "MAKE_SLICE", "MAKE_ARRAY", "MAKE_MAP", "MAKE", "ZERO", "INDEX", "INDEX_OK", "SET_INDEX", "SLICE", "LEN", "CAP", "APPEND", "APPEND_SPREAD",
    "COPY_SLICE", "DELETE", "ITER", "ITER_NEXT",
    "ADDR_GLOBAL", "ADDR_FIELD", "ADDR_INDEX", "MKPTR", "CELLPTR", "DEREF", "STORE_DEREF", "COPY_INTO",
    "BOX", "ASSERT", "ASSERT_OK", "TYPE_IS", "DUP", "DUP2",
    "CHAN_SEND", "CHAN_RECV", "CHAN_RECV_OK", "CHAN_CLOSE", "SELECT", "BIND_METHOD", "BIND_FN", "SCONV", "ERR_NEW"];
  const OP = Object.fromEntries(OP_NAMES.map((n, i) => [n, i]));
  const OPERANDS = { CONST: 1, LOAD: 1, STORE: 1, SET: 1, JMP: 1, JMP_IF_FALSE: 1, JMP_IF_TRUE: 1, CALL: 2, FOR_INIT: 1, FOR_TEST: 3, FOR_STEP: 1,
    BINK: 2, LOAD_BINK: 3, LOAD2_BIN: 3, UPDATE_K: 3, UPDATE_S: 3, JMP_UNLESS: 2, JMP_WHEN: 2, JMP_UNLESS_K: 3, JMP_WHEN_K: 3, CALL_VOID: 2, FOR_NEXT: 3,
    CALLF: 4, CALL_EXT: 2, NEW_STRUCT: 1, GET_FIELD: 1, SET_FIELD: 1, CALL_METHOD: 2,
    IOP: 1, CONV: 1, MAKE_CLOSURE: 2, CALL_VALUE: 2, LOAD_CELL: 1, STORE_CELL: 1, NEW_CELL: 1, LOAD_CELLREF: 1, LOAD_UP: 1, STORE_UP: 1, LOAD_UPREF: 1, REBOX: 1,
    RETN: 1, RET_NAMED: 2, DEFER: 1, GO: 1, MAKE_SLICE: 2, MAKE_ARRAY: 2, MAKE_MAP: 2, MAKE: 2, ZERO: 1, INDEX: 1, INDEX_OK: 1, SLICE: 2,
    APPEND: 2, APPEND_SPREAD: 1, ITER_NEXT: 1, ADDR_GLOBAL: 1, ADDR_FIELD: 1, BOX: 1, ASSERT: 1, ASSERT_OK: 1, TYPE_IS: 1, SELECT: 3,
    BIND_METHOD: 1, BIND_FN: 1, SCONV: 2 };
  const ARITY = OP_NAMES.map((n) => OPERANDS[n] || 0);
  // which operand of each instruction is a code address (jump or function entry)
  const JUMP_ARG = { [OP.JMP]: 0, [OP.JMP_IF_FALSE]: 0, [OP.JMP_IF_TRUE]: 0, [OP.FOR_TEST]: 2, [OP.JMP_UNLESS]: 1, [OP.JMP_WHEN]: 1,
    [OP.JMP_UNLESS_K]: 2, [OP.JMP_WHEN_K]: 2, [OP.FOR_NEXT]: 2, [OP.CALLF]: 0, [OP.ITER_NEXT]: 0 };
  // numbered binary operations, used as an operand of the superinstructions
  const BIN_SYMBOLS = ["+", "-", "*", "/", "%", "**", "==", "!=", "<", ">", "<=", ">="];
  const BIN_INDEX_OF_OP = { [OP.ADD]: 0, [OP.SUB]: 1, [OP.MUL]: 2, [OP.DIV]: 3, [OP.MOD]: 4, [OP.POW]: 5,
    [OP.EQ]: 6, [OP.NE]: 7, [OP.LT]: 8, [OP.GT]: 9, [OP.LE]: 10, [OP.GE]: 11 };
  const BIN_OP = { "+": OP.ADD, "-": OP.SUB, "*": OP.MUL, "/": OP.DIV, "%": OP.MOD, "**": OP.POW,
    "==": OP.EQ, "!=": OP.NE, "<": OP.LT, ">": OP.GT, "<=": OP.LE, ">=": OP.GE };
  const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;

  // Functions marked with dllexport: what the DLL offers to other languages
  const MAX_EXPORTS = 64;
  const RESERVED_EXPORTS = ["caju_last_error"];
  // C, C++ and C# words that cannot become a function name in the .h header or in the C# example
  const C_KEYWORDS = new Set("auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false class delete new this throw try catch namespace template typename public private protected virtual operator friend using asm explicit mutable export nullptr base object string decimal checked fixed lock out ref params sealed event implicit internal is as in foreach readonly stackalloc typeof uint ulong ushort sbyte byte def lambda pass None True False yield with global nonlocal assert del elif except finally from import raise not and or".split(" "));
  function dllExports(funcs, err) {
    const out = [], seen = new Map();
    funcs.forEach((f, fidx) => {
      const d = f.node.dll;
      if (!d) return;
      if (RESERVED_EXPORTS.includes(d.name)) err(`"${d.name}" is a reserved DLL name; choose another one`, f.node);
      if (C_KEYWORDS.has(d.name)) err(`"${d.name}" is a reserved word in C, C# or Python; choose another name for the exported function`, f.node);
      if (seen.has(d.name)) err(`There is already an exported function named "${d.name}" (line ${locLine(seen.get(d.name).line)})`, f.node);
      seen.set(d.name, f.node);
      out.push({ name: d.name, fidx, ret: d.ret, types: d.types, pnames: f.node.params.map((x) => x.replace(/@.*$/, "")) });
    });
    if (out.length > MAX_EXPORTS) err(`A Caju DLL exports at most ${MAX_EXPORTS} functions`, funcs.find((f) => f.node.dll).node);
    return out;
  }

  // With { optimize: true }, the compiler gets an already optimized and validated tree:
  // it skips semantic analysis and emits conditions as direct jumps.
  function compile(ast, opts = {}) {
    const optimize = !!opts.optimize;
    const code = [], lines = [], consts = [], constIndex = new Map();
    const slotOf = new Map(), slotNames = [];
    const err = (msg, n) => { throw new CajuError("compile", msg, n.line, n.col ?? null); };

    // Functions and externs can be called before their declaration: they are collected first
    const funcs = [], funcIndex = new Map(), externs = [], externIndex = new Map();
    const structs = [], structIndex = new Map();
    forTop(ast.body, (st) => {
      if (st.kind === "Struct") { structIndex.set(st.name, structs.length); structs.push({ name: st.name, node: st }); }
    });
    const addFunc = (st) => {
      funcIndex.set(st.name, funcs.length);
      const results = st.rtype && st.rtype !== "void" ? (st.rtype.startsWith("(") ? tinfo(st.rtype).items : [st.rtype]) : [];
      funcs.push({ node: st, name: st.name, params: st.params, localNames: localNamesOf(st), entry: -1, calls: [], results,
        nres: Math.max(1, results.length), celled: st.celled || new Set(), upvals: st.captures || [] });
      return funcs.length - 1;
    };
    forTop(ast.body, (st) => {
      if (st.kind !== "Func" && st.kind !== "Extern") return;
      if (BUILTINS.includes(st.name) || CONVERSIONS.includes(st.name) || SPECIAL_BUILTINS.includes(st.name)) err(`"${st.name}" is already a built-in function; choose another name`, st);
      if (isTypeWord(st.name)) err(`"${st.name}" is the name of a type; choose another name for the function`, st);
      const prev = funcIndex.has(st.name) ? funcs[funcIndex.get(st.name)].node : externIndex.has(st.name) ? externs[externIndex.get(st.name)].node : null;
      if (prev) err(st.recv ? `${bare(st.recv.type)} already has a method named ${st.method} (line ${locLine(prev.line)})` : `There is already a function named "${st.name}" (line ${locLine(prev.line)})`, st);
      if (st.kind === "Func") addFunc(st);
      else {
        const words = st.params.reduce((n, prm) => n + FFI_WORDS[prm.type], 0);
        if (words > MAX_FFI_WORDS) err(`The parameters of ${st.symbol} exceed the limit of ${MAX_FFI_WORDS} 32-bit words (i64, u64 and f64 take two)`, st);
        externIndex.set(st.name, externs.length);
        externs.push({ node: st, name: st.name, dll: st.dll, symbol: st.symbol, conv: st.conv, params: st.params, ret: st.ret });
      }
    });

    // Types: checked before generating code, which uses what they find out (which integer
    // operation to use, which method to call, when to copy a struct, when to box a value).
    const types = typecheck(ast);

    // Semantic analysis of global variables (function bodies have their own scope)
    const constDecl = new Map(), declared = new Set();
    (function collect(n) {
      if (!n || optimize || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(collect);
      switch (n.kind) {
        case "FuncLit": case "Func": return;
        case "Assign":
          if (n.decl === "const") {
            if (constDecl.has(n.name)) err(`The constant "${n.name}" was already declared on line ${locLine(constDecl.get(n.name).line)}`, n);
            constDecl.set(n.name, n);
          }
          if (n.decl) declared.add(n.name);
          return;
        case "VarDecl": n.names.forEach((nm) => declared.add(nm)); return;
        case "ForTo": declared.add(n.name); break;
        case "Range": if (n.decl) n.vars.forEach((v) => declared.add(v.name)); break;
        case "TypeSwitch": if (n.bind) declared.add(n.bind); break;
        case "Select": n.cases.forEach((c) => { if (c.decl) c.vars.forEach((v) => declared.add(v.name)); }); break;
      }
      for (const k of ["body", "then", "otherwise", "init", "post", "cases"]) collect(n[k]);
    })(ast);

    const slot = (name) => {
      if (!slotOf.has(name)) { slotOf.set(name, slotNames.length); slotNames.push(name); }
      return slotOf.get(name);
    };
    const constant = (v) => {
      const key = typeof v + ":" + (Object.is(v, -0) ? "-0" : v);
      if (!constIndex.has(key)) { constIndex.set(key, consts.length); consts.push(v); }
      return constIndex.get(key);
    };

    // ---- type table for the VM (type switches, x.(T), make, zero values, boxes) ----
    const rtypes = [], rtypeIndex = new Map();
    const tid = (t) => {
      t = dflt(t);
      if (rtypeIndex.has(t)) return rtypeIndex.get(t);
      const id = rtypes.length;
      rtypeIndex.set(t, id);
      const e = { name: bare(t), key: t };
      rtypes.push(e);
      const ti = tinfo(t);
      if (t in KIND_CODE) { e.k = "num"; e.nk = KIND_CODE[t]; }
      else if (t === "str" || t === "bool" || t === "any" || t === "nil") e.k = t;
      else if (types.structTable.has(t)) { e.k = "struct"; e.sidx = structIndex.get(t); }
      else if (types.ifaceTable.has(t)) { e.k = "iface"; e.methods = [...types.ifaceTable.get(t).methods.keys()].map(constant); }
      else if (ti.k === "slice" || ti.k === "array" || ti.k === "chan" || ti.k === "ptr") { e.k = ti.k; e.elem = tid(ti.elem); if (ti.k === "array") e.n = ti.n; }
      else if (ti.k === "map") { e.k = "map"; e.key = tid(ti.key); e.val = tid(ti.val); }
      else if (ti.k === "func") e.k = "func";
      else e.k = "any";
      return id;
    };
    ["int", "num", "str", "bool"].forEach(tid);
    tid("error");

    let line = 1;
    // function being compiled: { f, locals: Map name → index, consts, celled, upvals: Map name → index, loops }
    let fn = null;
    const emit = (op, ...args) => {
      code.push(op, ...args);
      for (let i = 0; i <= args.length; i++) lines.push(line);
      return code.length - 1;           // position of the last operand, to patch jumps later
    };
    const patch = (at) => { code[at] = code.length; };
    const patchAll = (list, to = code.length) => { for (const at of list) code[at] = to; };
    const isLocal = (name) => fn !== null && fn.locals.has(name);
    const isUpval = (name) => fn !== null && fn.upvals.has(name);
    const ref = (name) => (isLocal(name) ? -(fn.locals.get(name) + 1) : slot(name));
    const known = (name) => isLocal(name) || isUpval(name) || declared.has(name);
    const notConst = (name, n, what) => {
      if (optimize) return;
      const c = isLocal(name) ? fn.consts.get(name) : constDecl.get(name);
      if (c && c !== n) err(`"${name}" is a constant (line ${locLine(c.line)}) and cannot ${what}`, n);
    };
    // hidden slots: globals at the top level, locals inside a function
    const hidden = (label, count = 1) => {
      if (fn) {
        const k = fn.localNames.length;
        for (let i = 0; i < count; i++) fn.localNames.push(`${label}·${i}`);
        return -(k + 1);
      }
      const k = slotNames.length;
      for (let i = 0; i < count; i++) slotNames.push(`${label}·${i}`);
      return k;
    };
    const hiddenSlot = (base, i) => (base < 0 ? base - i : base + i);
    // three hidden slots for the classic for: counter, end and step (+1 or -1)
    const hiddenFor = (name) => {
      if (fn) {
        const k = fn.localNames.length;
        fn.localNames.push(`${name}·counter`, `${name}·end`, `${name}·step`);
        return -(k + 1);
      }
      const k = slotNames.length;
      slotNames.push(`${name}·counter`, `${name}·end`, `${name}·step`);
      return k;
    };
    const gCelled = types.globalCelled;
    const celled = (name) => (isLocal(name) ? fn.celled.has(name) : !isUpval(name) && gCelled.has(name));
    function loadVar(name) {
      if (isLocal(name)) emit(celled(name) ? OP.LOAD_CELL : OP.LOAD, ref(name));
      else if (isUpval(name)) emit(OP.LOAD_UP, fn.upvals.get(name));
      else emit(gCelled.has(name) ? OP.LOAD_CELL : OP.LOAD, slot(name));
    }
    function storeVar(name, decl) {
      if (name === "_") { emit(OP.POP); return; }
      if (isLocal(name)) {
        if (celled(name)) emit(decl ? OP.NEW_CELL : OP.STORE_CELL, ref(name));
        else emit(decl ? OP.STORE : OP.SET, ref(name));
      } else if (isUpval(name)) emit(OP.STORE_UP, fn.upvals.get(name));
      else if (gCelled.has(name)) emit(decl ? OP.NEW_CELL : OP.STORE_CELL, slot(name));
      else emit(decl ? OP.STORE : OP.SET, slot(name));
    }
    const isValueType = (t) => !!t && (types.structTable.has(t) || kindOf(t) === "array");
    const NONFRESH = new Set(["Var", "Field", "Index", "Deref", "TypeAssert"]);
    const fresh = (n) => (n.kind === "Paren" ? fresh(n.expr) : !NONFRESH.has(n.kind));
    const PRIMS = new Set(["int", "num", "str", "bool", "void", "lit", "rlit", "flit", "nil", ...INT_KINDS, "float32"]);
    // a struct (or array) stored in a variable, a field, an argument or a return is copied,
    // as in Go; only needed when the expression does not create a new value and the type may be a struct
    const mayCopy = (t) => !t || (!PRIMS.has(t) && !["slice", "map", "chan", "func", "ptr"].includes(kindOf(t)));
    function bindValue(v) {
      expr(v);
      if (!fresh(v) && mayCopy(v.ty) && !v.boxT) emit(OP.COPY);
    }
    // zero value of a type: 0, "", false, struct with zeroed fields, array of zeros or nil
    function zero(t) {
      t = dflt(t || "any");
      if (isNumT(t)) emit(OP.CONST, constant(0));
      else if (t === "str") emit(OP.CONST, constant(""));
      else if (t === "bool") emit(OP.CONST, constant(false));
      else if (structIndex.has(t)) { const si = structIndex.get(t); structs[si].node.fields.forEach((d) => zero(d.type)); emit(OP.NEW_STRUCT, si); }
      else if (kindOf(t) === "array") emit(OP.ZERO, tid(t));
      else emit(OP.CONST, constant(null));
    }
    // arithmetic operation with the types the checker found
    const IOPS = { "+": 0, "-": 1, "*": 2, "/": 3, "%": 4, "<<": 5, ">>": 6, "&": 7, "|": 8, "^": 9, "&^": 10 };
    function arith(op, ik, fk) {
      if (ik !== undefined && op in IOPS) { emit(OP.IOP, (IOPS[op] << 4) | ik); return; }
      emit(BIN_OP[op]);
      if (fk !== undefined) emit(OP.CONV, fk);
    }

    // ---- anonymous functions and calls ----
    function makeClosure(fnode) {
      const fi = addFunc(fnode);
      const f = funcs[fi];
      for (const nm of f.upvals) {
        if (isLocal(nm)) emit(OP.LOAD_CELLREF, ref(nm));
        else if (isUpval(nm)) emit(OP.LOAD_UPREF, fn.upvals.get(nm));
        else if (gCelled.has(nm)) emit(OP.LOAD_CELLREF, slot(nm));
        else err(`"${nm}" could not be captured by the function`, fnode);
      }
      emit(OP.MAKE_CLOSURE, fi, f.upvals.length);
      return fi;
    }
    // method receiver: follows embedded fields and copies when the method takes a value receiver
    function receiver(n) {
      expr(n.obj);
      for (const p of n.path || []) emit(OP.GET_FIELD, constant(p));
      if (!n.recvPtr && (!fresh(n.obj) || (n.path && n.path.length))) emit(OP.COPY);
    }
    // function value + arguments on the stack, for defer and go
    function callee(c) {
      if (c.kind === "Call" && c.callKind === "func") { emit(OP.MAKE_CLOSURE, funcIndex.get(c.name), 0); c.args.forEach(bindValue); return c.args.length; }
      if (c.kind === "Call" && c.callKind === "value") { loadVar(c.name); c.args.forEach(bindValue); return c.args.length; }
      if (c.kind === "CallValue") { expr(c.fn); c.args.forEach(bindValue); return c.args.length; }
      if (c.kind === "MethodCall" && c.target) { emit(OP.MAKE_CLOSURE, funcIndex.get(c.target), 0); receiver(c); c.args.forEach(bindValue); return c.args.length + 1; }
      if (c.kind === "MethodCall" && c.fieldCall) { expr(c.obj); for (const p of c.path || []) emit(OP.GET_FIELD, constant(p)); emit(OP.GET_FIELD, constant(c.name)); c.args.forEach(bindValue); return c.args.length; }
      if (c.kind === "MethodCall" && c.callKind !== "errnew") { expr(c.obj); emit(OP.BIND_METHOD, constant(c.name)); c.args.forEach(bindValue); return c.args.length; }
      // built-in function (print, close, panic...): becomes a wrapper function with the arguments already evaluated
      const params = c.args.map((_, i) => `·a${i}`);
      const call = { ...c, args: c.args.map((a, i) => ({ kind: "Var", name: params[i], ty: a.ty, line: c.line, col: c.col })) };
      const wrapper = { kind: "Func", name: `·wrapper@${locLine(c.line)}:${c.col}`, params, ptypes: c.args.map((a) => a.ty), rtype: null,
        body: { kind: "Block", body: [{ kind: "ExprStmt", expr: call, line: c.line, col: c.col }] }, line: c.line, col: c.col };
      call.discard = c.discard;
      emit(OP.MAKE_CLOSURE, addFunc(wrapper), 0);
      c.args.forEach(bindValue);
      return c.args.length;
    }

    function expr(n) {
      if (n.line) line = n.line;
      exprInner(n);
      // concrete value entering an interface: the box keeps the exact type (int8, num, *Point...)
      if (n.boxT) emit(OP.BOX, tid(n.boxT));
    }
    function exprInner(n) {
      switch (n.kind) {
        case "Number": case "String": case "Bool": emit(OP.CONST, constant(n.value)); return;
        case "Nil": emit(OP.CONST, constant(null)); return;
        case "Paren": expr(n.expr); return;
        case "Var":
          if (n.fnRef) { emit(OP.MAKE_CLOSURE, funcIndex.get(n.name), 0); return; }
          if (!optimize && !known(n.name)) err(`The variable "${n.name}" is not created anywhere in the program. Use let ${n.name} = ... or ${n.name} := ...`, n);
          loadVar(n.name); return;
        case "Neg": expr(n.arg); emit(OP.NEG); if (INT_KINDS.includes(n.ty) && n.ty !== "int") emit(OP.CONV, KIND_CODE[n.ty]); return;
        case "BitNot": expr(n.arg); emit(OP.IOP, (11 << 4) | KIND_CODE[dflt(n.ty)] | 0); return;
        case "Not": expr(n.arg); emit(OP.NOT); return;
        case "Logical": {
          // and: if the left side is false, jump straight to "false" without evaluating the right side
          expr(n.left);
          const skip = emit(n.op === "and" ? OP.JMP_IF_FALSE : OP.JMP_IF_TRUE, 0);
          expr(n.right);
          emit(OP.TO_BOOL);
          const end = emit(OP.JMP, 0);
          patch(skip);
          emit(OP.CONST, constant(n.op === "or"));
          patch(end);
          return;
        }
        case "Binary": expr(n.left); expr(n.right); line = n.line; arith(n.op, n.ik, n.fk); return;
        case "Call": return callExpr(n);
        case "StructLit": case "CompositeLit": return composite(n);
        case "Field": {
          expr(n.obj);
          for (const p of n.path || []) emit(OP.GET_FIELD, constant(p));
          line = n.line;
          if (n.boundMethod) {
            if (!n.recvPtr) emit(OP.COPY);
            emit(OP.BIND_FN, funcIndex.get(n.boundMethod));
            return;
          }
          emit(OP.GET_FIELD, constant(n.name));
          return;
        }
        case "MethodCall": {
          const count = n.args.length;
          if (n.callKind === "errnew") { expr(n.args[0]); line = n.line; emit(OP.ERR_NEW); return; }
          if (n.fieldCall) {
            expr(n.obj);
            for (const p of n.path || []) emit(OP.GET_FIELD, constant(p));
            emit(OP.GET_FIELD, constant(n.name));
            n.args.forEach(bindValue); line = n.line;
            emit(OP.CALL_VALUE, count, nresOf(n.ty));
            return;
          }
          if (n.target && funcIndex.has(n.target)) {
            // type known at compile time: direct call, like a plain function with the receiver first
            const fi = funcIndex.get(n.target), f = funcs[fi];
            receiver(n);
            n.args.forEach(bindValue); line = n.line;
            emit(OP.CALLF, 0, count + 1, 0, fi);
            f.calls.push(code.length - 4);
            return;
          }
          // interface or any: the method is looked up by name at run time
          expr(n.obj);
          n.args.forEach(bindValue); line = n.line;
          emit(OP.CALL_METHOD, constant(n.name), count);
          return;
        }
        case "CallValue": expr(n.fn); n.args.forEach(bindValue); line = n.line; emit(OP.CALL_VALUE, n.args.length, nresOf(n.ty)); return;
        case "FuncLit": makeClosure(n.fn); return;
        case "Index":
          expr(n.obj); expr(n.index); line = n.line;
          emit(n.commaOk ? OP.INDEX_OK : OP.INDEX, n.obj.ty && kindOf(n.obj.ty) === "map" ? tid(tinfo(n.obj.ty).val) : -1);
          return;
        case "SliceExpr":
          expr(n.obj);
          if (n.lo) expr(n.lo);
          if (n.hi) expr(n.hi);
          line = n.line;
          emit(OP.SLICE, (n.lo ? 1 : 0) | (n.hi ? 2 : 0), n.ty && kindOf(n.ty) === "slice" ? tid(n.ty) : -1);
          return;
        case "AddrOf": return address(n.arg, n);
        case "Deref": expr(n.arg); line = n.line; emit(OP.DEREF); return;
        case "Recv": expr(n.arg); line = n.line; emit(n.commaOk ? OP.CHAN_RECV_OK : OP.CHAN_RECV); return;
        case "TypeAssert": expr(n.obj); line = n.line; emit(n.commaOk ? OP.ASSERT_OK : OP.ASSERT, tid(n.type)); return;
        case "Conversion": return conversion(n, n.args[0]);
      }
      err(`Unknown expression: ${n.kind}`, n);
    }
    const nresOf = (t) => (t && t.startsWith("(") ? tinfo(t).items.length : 1);
    function address(a, n) {
      if (a.kind === "Paren") return address(a.expr, n);
      if (a.kind === "StructLit" || a.kind === "CompositeLit") { expr(a); if (!isValueType(a.ty)) emit(OP.MKPTR); return; }
      if (a.kind === "Deref") { expr(a.arg); return; }
      // structs and arrays are already objects: the pointer is the object itself
      if (isValueType(a.ty)) { expr(a); return; }
      line = n.line;
      if (a.kind === "Var") {
        if (isLocal(a.name)) { emit(OP.LOAD_CELLREF, ref(a.name)); emit(OP.CELLPTR); }
        else if (isUpval(a.name)) { emit(OP.LOAD_UPREF, fn.upvals.get(a.name)); emit(OP.CELLPTR); }
        else if (gCelled.has(a.name)) { emit(OP.LOAD_CELLREF, slot(a.name)); emit(OP.CELLPTR); }
        else emit(OP.ADDR_GLOBAL, slot(a.name));
        return;
      }
      if (a.kind === "Field") { expr(a.obj); for (const p of a.path || []) emit(OP.GET_FIELD, constant(p)); emit(OP.ADDR_FIELD, constant(a.name)); return; }
      if (a.kind === "Index") { expr(a.obj); expr(a.index); emit(OP.ADDR_INDEX); return; }
      err("Cannot take the address of this expression", n);
    }
    function conversion(n, a) {
      line = n.line;
      switch (n.convMode) {
        case "num": expr(a); line = n.line; emit(OP.CONV, KIND_CODE[n.convTo]); return;
        case "fmt": emit(OP.CONST, constant("")); expr(a); line = n.line; emit(OP.ADD); return;
        case "rune": expr(a); emit(OP.SCONV, 0, 0); return;
        case "bytes": expr(a); emit(OP.SCONV, 1, 0); return;
        case "runes": expr(a); emit(OP.SCONV, 2, 0); return;
        case "tobytes": expr(a); emit(OP.SCONV, 3, tid("[]uint8")); return;
        case "torunes": expr(a); emit(OP.SCONV, 4, tid("[]int32")); return;
        default: bindValue(a); return;
      }
    }
    function composite(n) {
      if (n.stype) {
        const si = structIndex.get(n.stype), S = structs[si];
        for (const d of S.node.fields) {
          const given = n.sfields.find((f) => f.name === d.name);
          if (given) bindValue(given.value); else zero(d.type);
        }
        line = n.line;
        emit(OP.NEW_STRUCT, si);
        return;
      }
      const ti = tinfo(n.type);
      if (ti.k === "slice") { n.elems.forEach((e) => bindValue(e.value)); line = n.line; emit(OP.MAKE_SLICE, tid(n.type), n.elems.length); return; }
      if (ti.k === "array") {
        n.elems.forEach((e) => bindValue(e.value));
        for (let i = n.elems.length; i < ti.n; i++) zero(ti.elem);
        line = n.line;
        emit(OP.MAKE_ARRAY, tid(n.type), ti.n);
        return;
      }
      if (ti.k === "map") { n.elems.forEach((e) => { expr(e.key); bindValue(e.value); }); line = n.line; emit(OP.MAKE_MAP, tid(n.type), n.elems.length); return; }
      err("Unknown literal", n);
    }
    function callExpr(n) {
      const count = n.args.length;
      switch (n.callKind) {
        case "conv": return conversion(n, n.args[0]);
        case "value": loadVar(n.name); n.args.forEach(bindValue); line = n.line; emit(OP.CALL_VALUE, count, nresOf(n.ty)); return;
        case "extern": {
          const ei = externIndex.get(n.name);
          n.args.forEach(expr); line = n.line;
          emit(OP.CALL_EXT, ei, count);
          return;
        }
        case "func": {
          const fi = funcIndex.get(n.name), f = funcs[fi];
          if (count !== f.params.length) err(`The function "${n.name}" expects ${plural(f.params.length, "argument")}, but got ${count}`, n);
          n.args.forEach(bindValue); line = n.line;
          emit(OP.CALLF, 0, count, 0, fi);
          f.calls.push(code.length - 4);    // address and number of locals are filled in later
          return;
        }
        case "builtin": return builtinCall(n);
      }
      if (funcIndex.has(n.name)) { n.callKind = "func"; return callExpr(n); }
      err(`The function "${n.name}" does not exist`, n);
    }
    function builtinCall(n) {
      const a = n.args, count = a.length;
      const b = BUILTINS.indexOf(n.name);
      if (b >= 0) {
        const want = BUILTIN_ARITY[n.name];
        if (want >= 0 && count !== want) err(want === 0 ? `${n.name}() takes no arguments` : `${n.name} expects ${plural(want, "argument")}`, n);
        // print of a call with several results: all of them go to print
        let total = count;
        a.forEach((x) => { expr(x); if (x.ty && x.ty.startsWith("(")) total += tinfo(x.ty).items.length - 1; });
        line = n.line;
        emit(OP.CALL, b, total);
        return;
      }
      line = n.line;
      switch (n.name) {
        case "len": expr(a[0]); emit(OP.LEN); return;
        case "cap": expr(a[0]); emit(OP.CAP); return;
        case "append":
          expr(a[0]);
          if (a.spread) { expr(a[1]); line = n.line; emit(OP.APPEND_SPREAD, tid(n.appendT)); return; }
          a.slice(1).forEach(bindValue); line = n.line;
          emit(OP.APPEND, tid(n.appendT), count - 1);
          return;
        case "copy": expr(a[0]); expr(a[1]); emit(OP.COPY_SLICE); return;
        case "delete": expr(a[0]); expr(a[1]); emit(OP.DELETE); return;
        case "make": a.forEach(expr); line = n.line; emit(OP.MAKE, tid(n.typeArg), count); return;
        case "new": zero(n.typeArg); if (!isValueType(dflt(n.typeArg))) emit(OP.MKPTR); return;
        case "panic": expr(a[0]); emit(OP.PANIC); return;
        case "recover": emit(OP.RECOVER); return;
        case "close": expr(a[0]); emit(OP.CHAN_CLOSE); return;
      }
      // low-level operations of the standard library exist only in native code; here they are
      // checked and stand for nil
      if (n.privileged && n.name.startsWith("__")) { a.forEach((x) => { expr(x); emit(OP.POP); }); emit(OP.CONST, constant(null)); return; }
      err(`Unknown function ${n.name}`, n);
    }

    // Emits a condition as jumps, without producing true/false on the stack.
    // Returns the positions of the jumps that must point to the "false" (or "true") target.
    function jumpIfFalse(n) {
      if (n.kind === "Paren") return jumpIfFalse(n.expr);
      if (n.kind === "Not") return jumpIfTrue(n.arg);
      if (n.kind === "Logical" && n.op === "and") return [...jumpIfFalse(n.left), ...jumpIfFalse(n.right)];
      if (n.kind === "Logical" && n.op === "or") {
        const toBody = jumpIfTrue(n.left);
        const toFalse = jumpIfFalse(n.right);
        patchAll(toBody);
        return toFalse;
      }
      expr(n);
      return [emit(OP.JMP_IF_FALSE, 0)];
    }
    function jumpIfTrue(n) {
      if (n.kind === "Paren") return jumpIfTrue(n.expr);
      if (n.kind === "Not") return jumpIfFalse(n.arg);
      if (n.kind === "Logical" && n.op === "or") return [...jumpIfTrue(n.left), ...jumpIfTrue(n.right)];
      if (n.kind === "Logical" && n.op === "and") {
        const skip = jumpIfFalse(n.left);
        const toTrue = jumpIfTrue(n.right);
        patchAll(skip);
        return toTrue;
      }
      expr(n);
      return [emit(OP.JMP_IF_TRUE, 0)];
    }

    // ---- break and continue ----
    let loops = [];          // { label, breaks: [], continues: [], isLoop }
    function withLoop(n, isLoop, body) {
      const L = { label: n.label || null, breaks: [], continues: [], isLoop };
      loops.push(L);
      try { body(L); } finally { loops.pop(); }
      return L;
    }
    function jumpTarget(n, wantLoop) {
      for (let i = loops.length - 1; i >= 0; i--) {
        const L = loops[i];
        if (n.label ? L.label === n.label : (!wantLoop || L.isLoop)) {
          if (wantLoop && !L.isLoop) err(`continue ${n.label} must refer to a loop`, n);
          return L;
        }
      }
      err(n.label ? `There is no enclosing loop, switch or select with the label ${n.label}` : wantLoop ? "continue outside a loop" : "break outside a loop, switch or select", n);
    }
    // stores the values on the stack (the last one on top) into the targets, from last to first
    function storeTargets(targets, decl) {
      for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        if (typeof t === "string") { notConst(t, { line, col: null }, "be reassigned"); storeVar(t, decl); continue; }
        if (t.kind === "Var") { notConst(t.name, t, "be reassigned"); storeVar(t.name, decl); continue; }
        err("unexpected target", t);
      }
    }

    function stmt(n) {
      if (!n) return;
      line = n.line ?? line;
      switch (n.kind) {
        case "ExprStmt": {
          expr(n.expr);
          const pops = n.expr.discard === undefined ? 1 : Math.max(1, n.expr.discard);
          for (let i = 0; i < pops; i++) emit(OP.POP);
          return;
        }
        case "Block": case "Module": n.body.forEach(stmt); return;
        case "Func": case "Extern": case "Struct": case "Interface": case "Fallthrough": return;
        case "FieldAssign":
          expr(n.obj);
          for (const p of n.path || []) emit(OP.GET_FIELD, constant(p));
          if (isValueType(n.fty)) { emit(OP.GET_FIELD, constant(n.name)); bindValue(n.value); line = n.line; emit(OP.COPY_INTO); return; }
          bindValue(n.value); line = n.line;
          emit(OP.SET_FIELD, constant(n.name));
          return;
        case "Return": {
          const f = fn.f;
          if (f.node.rnames) {
            // named results: return stores into them, and RET_NAMED returns whatever is there after the defers
            if (n.values.length) { n.values.forEach(bindValue); storeTargets(f.node.rnames.map((nm) => nm), false); }
            line = n.line;
            emit(OP.RET_NAMED, f.params.length, f.node.rnames.length);
            return;
          }
          if (!n.values.length) { emit(OP.RET_NULL); return; }
          n.values.forEach(bindValue);
          line = n.line;
          const k = n.values.length === 1 && n.values[0].unpack ? n.values[0].unpack : n.values.length;
          if (k === 1) emit(OP.RET); else emit(OP.RETN, k);
          return;
        }
        case "Assign": {
          notConst(n.name, n, "be reassigned");
          if (!optimize && !n.decl && !known(n.name)) err(`The variable "${n.name}" does not exist. Use let ${n.name} = ... or ${n.name} := ... the first time`, n);
          if (!optimize && fn && n.decl === "const" && isLocal(n.name)) {
            const c = fn.consts.get(n.name);
            if (c && c !== n) err(`The constant "${n.name}" was already declared on line ${locLine(c.line)}`, n);
            fn.consts.set(n.name, n);
          }
          // struct or array that already exists: copy over it, so pointers to it remain valid
          if (!n.decl && isValueType(n.ty)) { loadVar(n.name); bindValue(n.value); line = n.line; emit(OP.COPY_INTO); return; }
          if (n.value === null) zero(n.type); else bindValue(n.value);
          line = n.line;
          storeVar(n.name, !!n.decl);
          return;
        }
        case "VarDecl": {
          if (n.values.length === n.names.length) n.values.forEach(bindValue);
          else expr(n.values[0]);
          line = n.line;
          storeTargets(n.names, true);
          return;
        }
        case "MultiAssign": return multiAssign(n);
        case "OpAssign": {
          const t = n.target;
          if (t.kind === "Var") {
            notConst(t.name, n, "be reassigned");
            loadVar(t.name); expr(n.value); line = n.line; arith(n.op, n.ik, n.fk); storeVar(t.name, false);
          } else if (t.kind === "Index") {
            expr(t.obj); expr(t.index); emit(OP.DUP2); emit(OP.INDEX, t.obj.ty && kindOf(t.obj.ty) === "map" ? tid(tinfo(t.obj.ty).val) : -1); expr(n.value); line = n.line; arith(n.op, n.ik, n.fk); emit(OP.SET_INDEX);
          } else if (t.kind === "Field") {
            expr(t.obj); for (const p of t.path || []) emit(OP.GET_FIELD, constant(p));
            emit(OP.DUP); emit(OP.GET_FIELD, constant(t.name)); expr(n.value); line = n.line; arith(n.op, n.ik, n.fk); emit(OP.SET_FIELD, constant(t.name));
          } else if (t.kind === "Deref") {
            expr(t.arg); emit(OP.DUP); emit(OP.DEREF); expr(n.value); line = n.line; arith(n.op, n.ik, n.fk); emit(OP.STORE_DEREF);
          }
          return;
        }
        case "If": {
          if (n.init) stmt(n.init);
          if (optimize) {
            const toElse = jumpIfFalse(n.cond);
            stmt(n.then);
            if (n.otherwise) {
              line = n.line;
              const toEnd = emit(OP.JMP, 0);
              patchAll(toElse);
              stmt(n.otherwise);
              patch(toEnd);
            } else patchAll(toElse);
            return;
          }
          expr(n.cond);
          const toElse = emit(OP.JMP_IF_FALSE, 0);
          stmt(n.then);
          if (n.otherwise) {
            line = n.line;
            const toEnd = emit(OP.JMP, 0);
            patch(toElse);
            stmt(n.otherwise);
            patch(toEnd);
          } else patch(toElse);
          return;
        }
        case "While": {
          const L = withLoop(n, true, (L) => {
            if (optimize) {
              // "rotated" loop: the test sits at the end, so each iteration costs one jump less
              const toTest = emit(OP.JMP, 0);
              const top = code.length;
              stmt(n.body);
              patch(toTest);
              L.contAt = code.length;
              line = n.line;
              patchAll(jumpIfTrue(n.cond), top);
              return;
            }
            const top = code.length;
            L.contAt = top;
            expr(n.cond);
            L.breaks.push(emit(OP.JMP_IF_FALSE, 0));
            stmt(n.body);
            line = n.line;
            emit(OP.JMP, top);
          });
          patchAll(L.breaks); patchAll(L.continues, L.contAt);
          return;
        }
        case "ForTo": {
          notConst(n.name, n, "be the for variable");
          expr(n.from); expr(n.to);
          line = n.line;
          const counter = hiddenFor(n.name);
          emit(OP.FOR_INIT, counter);
          const top = code.length;
          const boxed = celled(n.name) || isUpval(n.name);
          const raw = boxed ? hidden(n.name) : ref(n.name);
          const exit = emit(OP.FOR_TEST, counter, raw, 0);
          // variable captured by a closure: a new cell on each iteration, as in Go
          if (boxed) { emit(OP.LOAD, raw); storeVar(n.name, true); }
          const L = withLoop(n, true, () => stmt(n.body));
          L.contAt = code.length;
          line = n.line;
          emit(OP.FOR_STEP, counter);
          emit(OP.JMP, top);
          patch(exit);
          patchAll(L.breaks); patchAll(L.continues, L.contAt);
          return;
        }
        case "ForC": {
          if (n.init) stmt(n.init);
          const top = code.length;
          const exits = n.cond ? jumpIfFalse(n.cond) : [];
          const L = withLoop(n, true, () => stmt(n.body));
          L.contAt = code.length;
          // loop variables captured by closures: each iteration has its own (Go 1.22)
          for (const nm of loopVars(n.init)) if (celled(nm)) emit(OP.REBOX, isLocal(nm) ? ref(nm) : slot(nm));
          if (n.post) stmt(n.post);
          line = n.line;
          emit(OP.JMP, top);
          patchAll(exits); patchAll(L.breaks); patchAll(L.continues, L.contAt);
          return;
        }
        case "Range": {
          expr(n.subject);
          line = n.line;
          if (n.rk === "array" && !fresh(n.subject)) emit(OP.COPY);     // range over an array iterates over a copy
          emit(OP.ITER);
          const it = hidden("range");
          emit(OP.STORE, it);
          const top = code.length;
          emit(OP.LOAD, it);
          const exit = emit(OP.ITER_NEXT, 0);
          // on the stack: key (or index) and value
          const [k, v] = n.vars;
          const vty = v && (v.ty || "");
          if (v && v.name !== "_") { if (mayCopy(vty) && (vty === "" || isValueType(vty))) emit(OP.COPY); storeTargets([v], n.decl); } else emit(OP.POP);
          if (k && k.name !== "_") storeTargets([k], n.decl); else emit(OP.POP);
          const L = withLoop(n, true, () => stmt(n.body));
          L.contAt = top;
          line = n.line;
          emit(OP.JMP, top);
          patch(exit);
          patchAll(L.breaks); patchAll(L.continues, L.contAt);
          return;
        }
        case "Switch": {
          if (n.init) stmt(n.init);
          let tag = -1;
          if (n.tag) { expr(n.tag); tag = hidden("switch"); emit(OP.STORE, tag); }
          const toBody = n.cases.map(() => []);
          n.cases.forEach((c, i) => {
            if (!c.exprs) return;
            for (const e of c.exprs) {
              if (tag === -1) { toBody[i].push(...jumpIfTrue(e)); continue; }
              emit(OP.LOAD, tag); expr(e); line = c.line;
              emit(OP.EQ);
              toBody[i].push(emit(OP.JMP_IF_TRUE, 0));
            }
          });
          const def = n.cases.findIndex((c) => !c.exprs);
          const toDefault = emit(OP.JMP, 0);
          const L = withLoop(n, false, (L) => {
            n.cases.forEach((c, i) => {
              patchAll(toBody[i]);
              if (i === def) patch(toDefault);
              c.body.forEach(stmt);
              const falls = c.body.length && c.body[c.body.length - 1].kind === "Fallthrough";
              if (!falls) L.breaks.push(emit(OP.JMP, 0));
            });
          });
          if (def < 0) patch(toDefault);
          patchAll(L.breaks);
          return;
        }
        case "TypeSwitch": {
          if (n.init) stmt(n.init);
          expr(n.subject);
          const s = hidden("type");
          emit(OP.STORE, s);
          const toBody = n.cases.map(() => []);
          n.cases.forEach((c, i) => {
            for (const t of c.types || []) {
              emit(OP.LOAD, s);
              if (t === "nil") { emit(OP.CONST, constant(null)); emit(OP.EQ); }
              else emit(OP.TYPE_IS, tid(t));
              toBody[i].push(emit(OP.JMP_IF_TRUE, 0));
            }
          });
          const def = n.cases.findIndex((c) => !c.types);
          const toDefault = emit(OP.JMP, 0);
          const L = withLoop(n, false, (L) => {
            n.cases.forEach((c, i) => {
              patchAll(toBody[i]);
              if (i === def) patch(toDefault);
              if (n.bind && n.bind !== "_") {
                emit(OP.LOAD, s);
                if (c.types && c.types.length === 1 && c.types[0] !== "nil" && !types.ifaceTable.has(c.types[0]) && c.types[0] !== "any") emit(OP.ASSERT, tid(c.types[0]));
                storeVar(n.bind, true);
              }
              c.body.forEach(stmt);
              L.breaks.push(emit(OP.JMP, 0));
            });
          });
          if (def < 0) patch(toDefault);
          patchAll(L.breaks);
          return;
        }
        case "Select": {
          let mask = 0, ncase = 0;
          const real = n.cases.filter((c) => c.kind !== "default");
          real.forEach((c, i) => {
            expr(c.ch);
            if (c.kind === "send") { bindValue(c.value); mask |= 1 << i; }
            ncase++;
          });
          const hasDef = n.cases.some((c) => c.kind === "default");
          line = n.line;
          emit(OP.SELECT, ncase, mask, hasDef ? 1 : 0);
          // on the stack: received value, ok and the number of the chosen case (-1 = default)
          const base = hidden("select", 3);
          emit(OP.STORE, hiddenSlot(base, 0)); emit(OP.STORE, hiddenSlot(base, 1)); emit(OP.STORE, hiddenSlot(base, 2));
          const jumps = n.cases.map((c) => {
            emit(OP.LOAD, hiddenSlot(base, 0));
            emit(OP.CONST, constant(c.kind === "default" ? -1 : real.indexOf(c)));
            emit(OP.EQ);
            return emit(OP.JMP_IF_TRUE, 0);
          });
          const L = withLoop(n, false, (L) => {
            L.breaks.push(emit(OP.JMP, 0));
            n.cases.forEach((c, i) => {
              patch(jumps[i]);
              if (c.kind === "recv" && c.vars.length) {
                emit(OP.LOAD, hiddenSlot(base, 2));
                if (c.vars.length === 2) emit(OP.LOAD, hiddenSlot(base, 1));
                storeTargets(c.vars, c.decl);
              }
              c.body.forEach(stmt);
              L.breaks.push(emit(OP.JMP, 0));
            });
          });
          patchAll(L.breaks);
          return;
        }
        case "Break": jumpTarget(n, false).breaks.push(emit(OP.JMP, 0)); return;
        case "Continue": jumpTarget(n, true).continues.push(emit(OP.JMP, 0)); return;
        case "Send": expr(n.ch); bindValue(n.value); line = n.line; emit(OP.CHAN_SEND); return;
        case "Defer": case "Go": {
          const k = callee(n.call);
          line = n.line;
          emit(n.kind === "Defer" ? OP.DEFER : OP.GO, k);
          return;
        }
      }
      err(`Unknown statement: ${n.kind}`, n);
    }
    const loopVars = (init) => (!init ? [] : init.kind === "Assign" && init.decl ? [init.name] : init.kind === "VarDecl" ? init.names : []);
    // a, b = b, a: evaluates everything before storing, as in Go
    function multiAssign(n) {
      const prep = n.targets.map((t) => {
        if (t.kind === "Var") return { t };
        if (t.kind === "Index") { expr(t.obj); const o = hidden("target"); emit(OP.STORE, o); expr(t.index); const i = hidden("target"); emit(OP.STORE, i); return { t, o, i }; }
        if (t.kind === "Field") { expr(t.obj); for (const p of t.path || []) emit(OP.GET_FIELD, constant(p)); const o = hidden("target"); emit(OP.STORE, o); return { t, o }; }
        if (t.kind === "Deref") { expr(t.arg); const o = hidden("target"); emit(OP.STORE, o); return { t, o }; }
        err("Invalid target", t);
      });
      if (n.values.length === n.targets.length) n.values.forEach(bindValue); else expr(n.values[0]);
      const vals = hidden("value", n.targets.length);
      for (let i = n.targets.length - 1; i >= 0; i--) emit(OP.STORE, hiddenSlot(vals, i));
      prep.forEach((p, i) => {
        const v = hiddenSlot(vals, i), t = p.t;
        if (t.kind === "Var") {
          if (t.name === "_") return;
          notConst(t.name, t, "be reassigned");
          if (!optimize && !known(t.name)) err(`The variable "${t.name}" does not exist`, t);
          if (isValueType(t.ty)) { loadVar(t.name); emit(OP.LOAD, v); emit(OP.COPY_INTO); return; }
          emit(OP.LOAD, v); storeVar(t.name, false); return;
        }
        if (t.kind === "Index") {
          emit(OP.LOAD, p.o); emit(OP.LOAD, p.i);
          if (isValueType(t.ty) && kindOf(t.obj.ty || "") !== "map") { emit(OP.INDEX, -1); emit(OP.LOAD, v); emit(OP.COPY_INTO); return; }
          emit(OP.LOAD, v); emit(OP.SET_INDEX); return;
        }
        if (t.kind === "Field") {
          emit(OP.LOAD, p.o);
          if (isValueType(t.ty)) { emit(OP.GET_FIELD, constant(t.name)); emit(OP.LOAD, v); emit(OP.COPY_INTO); return; }
          emit(OP.LOAD, v); emit(OP.SET_FIELD, constant(t.name)); return;
        }
        if (t.kind === "Deref") { emit(OP.LOAD, p.o); emit(OP.LOAD, v); emit(OP.STORE_DEREF); return; }
      });
    }

    // code of a function: prologue (cells, named results), body and the implicit return at the end
    function compileFunc(f) {
      // the type checker marked what is captured by closures (it runs after functions are collected)
      f.celled = f.node.celled || new Set();
      if (!f.upvals.length && f.node.captures) f.upvals = f.node.captures;
      const parentFn = fn;
      fn = { f, locals: new Map(f.localNames.map((nm, i) => [nm, i])), consts: new Map(), localNames: f.localNames,
        celled: f.celled, upvals: new Map(f.upvals.map((nm, i) => [nm, i])) };
      const savedLoops = loops;
      loops = [];
      f.entry = code.length;
      line = f.node.line;
      f.params.forEach((p) => { if (f.celled.has(p)) { emit(OP.LOAD, ref(p)); emit(OP.NEW_CELL, ref(p)); } });
      (f.node.rnames || []).forEach((nm, i) => { zero(f.results[i]); storeVar(nm, true); });
      stmt(f.node.body);
      line = f.node.endLine ?? f.node.line;
      if (f.node.rnames) emit(OP.RET_NAMED, f.params.length, f.node.rnames.length);
      else emit(OP.RET_NULL);
      f.nlocals = f.localNames.length;
      loops = savedLoops;
      fn = parentFn;
    }

    ast.body.forEach(stmt);
    emit(OP.HALT);
    // each function's code comes after the main program (anonymous ones are queued as they are found)
    for (let i = 0; i < funcs.length; i++) compileFunc(funcs[i]);
    // only now are all entries and sizes known: fill in each call
    for (const f of funcs) for (const at of f.calls) { code[at] = f.entry; code[at + 2] = f.nlocals; }
    // struct table for the VM: name, fields and methods (including those promoted from embedded structs)
    const structTable = structs.map((S) => {
      const all = types.methodSet(S.name, true), vset = types.methodSet(S.name, false);
      return {
        name: bare(S.name), names: S.node.fields.map((f) => f.name), keys: S.node.fields.map((f) => constant(f.name)), tid: tid(S.name),
        ftids: S.node.fields.map((f) => tid(f.type)),
        methods: [...all].map(([m, mm]) => ({ key: constant(m), fidx: funcIndex.get(mm.info.node.name), ptr: mm.ptr, name: m, path: mm.path.map(constant), vset: vset.has(m) })),
      };
    });
    funcs.forEach((f) => { f.tid = tid(funcTypeText(f.node.ptypes ? f.params.map((_, i) => f.node.ptypes[i] || "any") : f.params.map(() => "any"), f.results)); });
    return {
      types, structs: structTable, rtypes,
      code: Int32Array.from(code), lines, consts, slotNames,
      functions: funcs.map((f) => ({ name: f.name, params: f.params, nlocals: f.nlocals, localNames: f.localNames, entry: f.entry, nres: f.nres, tid: f.tid,
        named: f.node.rnames ? f.node.rnames.length : 0, rz: f.results.map(tid) })),
      exports: dllExports(funcs, err),
      externs: externs.map(({ node, ...e }) => e),
    };
  }

