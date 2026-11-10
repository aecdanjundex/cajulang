  // =====================================================================
  // 2. Parser (recursive descent)
  // =====================================================================
  // program    := statement*
  // statement  := let/const | assignment | if | while | for | switch | select | return | break | continue
  //               | defer call | go call | channel <- value | expression
  // assignment := targets ("=" | ":=" | "+=" ...) exprs | target "++" | target "--"      target := name | a.b | a[i] | *p
  // for        := "for" block | "for" cond block | "for" init ";" cond ";" post block | "for" k, v := range x block
  //               | "for" NAME "=" expr "to" expr block
  // switch     := "switch" (init ";")? expr? "{" ("case" exprs ":" statements | "default" ":" statements)* "}"
  //               "switch" (v ":=")? x ".(type)" "{" "case" types ":" ... "}"
  // select     := "select" "{" ("case" (v (, ok)? ":=")? "<-" channel ":" ... | "case" channel "<-" value ":" ... | "default" ":" ...)* "}"
  // expr       := e (("||" | "or") e)*     e := not (("&&" | "and") not)*     not := ("!" | "not") not | comparison
  // comparison := sum (("=="|"!="|"<"|">"|"<="|">=") sum)?
  // sum        := term (("+"|"-"|"|"|"^") term)*     term := unary (("*"|"/"|"%"|"<<"|">>"|"&"|"&^") unary)*
  // unary      := ("-"|"^"|"&"|"*"|"<-") unary | power      power := postfix ("**" unary)?
  // postfix    := primary ("." NAME | "." "(" TYPE ")" | "[" i "]" | "[" i? ":" j? "]" | "(" args ")")*
  // primary    := NUMBER | RUNE | STRING | true | false | nil | NAME | NAME "{" fields "}" | TYPE "{" elements "}"
  //               | TYPE "(" expr ")" | fn "(" params ")" ("->" results)? block | "(" expr ")"
  // types      := int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 byte rune num float64 float32
  //               str string bool any error | "[]" T | "[" N "]" T | map "[" K "]" V | "*" T | chan T
  //               | fn "(" T, ... ")" ("->" R)? | a declared struct or interface
  // struct     := "struct" NAME "{" (NAME ":" TYPE | TYPE)* "}"     (type only: embedded field, as in Go)
  // interface  := "interface" NAME "{" (NAME "(" params ")" ("->" results)? | NAME)* "}"
  // function   := "fn" ("(" NAME ":" "*"? NAME ")")? NAME "(" params ")" ("->" results)? block
  // results    := TYPE | "(" TYPE ("," TYPE)* ")" | "(" NAME ":" TYPE ("," ...)* ")"
  // also allowed at the top of a file:
  // import     := "import" STRING | "import" "{" NAME ("," NAME)* "}" "from" STRING
  // export     := "export" (declaration | function | struct | interface | extern)
  // dllexport  := "dllexport" "fn" NAME "(" (NAME ":" TYPE ("," ...)*)? ")" ("->" TYPE)? block
  // extern     := "extern" STRING ("stdcall" | "cdecl")? "fn" NAME "(" (NAME ":" TYPE ("," ...)*)? ")" ("->" TYPE)?
  function parse(toks) {
    let p = 0;
    const peek = (o = 0) => toks[Math.min(p + o, toks.length - 1)];
    const isOp = (v, o = 0) => peek(o).type === "OP" && peek(o).value === v;
    const isKw = (v, o = 0) => peek(o).type === "KEYWORD" && peek(o).value === v;
    const isSemi = () => peek().type === "NEWLINE" && peek().value === ";";
    const skipNL = () => { while (peek().type === "NEWLINE") p++; };
    const fail = (msg) => {
      const t = peek();
      const got = t.type === "EOF" ? "end of program" : t.type === "NEWLINE" ? (t.value === ";" ? '";"' : "end of line") : `"${t.value}"`;
      throw new CajuError("syntax", `${msg}, but found ${got}`, t.line, t.col);
    };
    const expect = (v, what) => { if (!isOp(v)) fail(`Expected ${what || `"${v}"`}`); return toks[p++]; };
    const expectKw = (v, what) => { if (!isKw(v)) fail(`Expected ${what}`); return toks[p++]; };
    const name = (what) => { if (peek().type !== "NAME") fail(`Expected ${what}`); return toks[p++].value; };
    const failAt = (msg, tk) => { throw new CajuError("syntax", msg, tk.line, tk.col); };
    const at = (t) => ({ line: t.line, col: t.col });

    // ---- types ----
    // A type becomes a canonical string ("[]int", "map[str]int", "fn(int) -> (int, error)"),
    // which the type checker compares and takes apart.
    function langType(allowVoid = false) {
      const tk = peek();
      if (isOp("[")) {
        p++;
        if (isOp("]")) { p++; return "[]" + langType(); }
        if (peek().type !== "NUMBER" || !/^\d+$/.test(peek().value)) fail("Expected the array size (an integer) or \"]\"");
        const n = toks[p++].value;
        expect("]", '"]" after the array size');
        return `[${n}]` + langType();
      }
      if (isKw("map")) {
        p++;
        expect("[", '"[" after map, as in map[str]int');
        const k = langType();
        expect("]", '"]" after the key type');
        return `map[${k}]${langType()}`;
      }
      if (isOp("*")) { p++; return "*" + langType(); }
      if (isKw("chan")) { p++; return "chan " + langType(); }
      if (isKw("fn")) {
        p++;
        expect("(", '"(" after fn, as in fn(int) -> int');
        const ps = [];
        while (!isOp(")")) {
          if (peek().type === "NAME" && isOp(":", 1)) p += 2;      // optional name: fn(a: int)
          ps.push(langType());
          if (isOp(",")) p++; else if (!isOp(")")) fail('Expected "," or ")" in the type list');
        }
        p++;
        const res = isOp("->") ? (p++, resultTypes().types) : [];
        return funcTypeText(ps, res);
      }
      if (tk.type === "NAME" && tk.value === "void") {
        if (allowVoid) { p++; return "void"; }
        failAt("void can only be used as a return type, after ->", tk);
      }
      if (tk.type === "NAME" && FFI_ONLY.has(tk.value))
        failAt(`${tk.value} is a C type, only valid in extern and dllexport. Use ${/^f/.test(tk.value) ? "num" : /^u/.test(tk.value) ? "uint" + tk.value.slice(1) : tk.value === "ptr" ? "int" : tk.value === "wstr" ? "str" : "int" + tk.value.slice(1)} here`, tk);
      if (tk.type === "NAME") { const q = qualified(); if (q) { p++; return q; } p++; return TYPE_ALIASES[tk.value] || tk.value; }
      fail(`Expected a type, such as int, num, str, bool, []int, map[str]int or a struct name${allowVoid ? ", or void" : ""}`);
    }
    // after "->": one type, or several in parentheses, with optional names (named results)
    function resultTypes() {
      if (!isOp("(")) return { types: [langType(true)].filter((t) => t !== "void"), names: null };
      p++;
      const types = [], names = [];
      while (!isOp(")")) {
        if (peek().type === "NAME" && isOp(":", 1)) { names.push(toks[p].value); p += 2; }
        types.push(langType());
        if (isOp(",")) p++; else if (!isOp(")")) fail('Expected "," or ")" in the result list');
      }
      p++;
      if (names.length && names.length !== types.length) fail("Either all results are named or none are");
      return { types, names: names.length ? names : null };
    }
    // a dllexport accepts the C types plus int (becomes i64) and num (becomes f64)
    const dllType = () => {
      const tk = peek();
      if (tk.type === "NAME" && (tk.value === "int" || tk.value === "num")) { p++; return tk.value === "int" ? "i64" : "f64"; }
      if (tk.type === "NAME" && tk.value === "any") failAt("An exported function needs concrete types; any has no C equivalent", tk);
      return ffiType();
    };
    const ffiType = () => {
      const tk = peek();
      if (tk.type !== "NAME" || !FFI_TYPES.includes(tk.value)) fail(`Expected a type (${FFI_TYPES.join(", ")})`);
      p++;
      return tk.value;
    };

    // namespaces bound by imports in this file: ns.name refers to an exported name of that module
    const namespaces = new Set();
    const qualified = () => {
      const t = peek();
      if (t.type === "NAME" && namespaces.has(t.value) && isOp(".", 1) && peek(2).type === "NAME") { p += 2; return `${t.value}.${toks[p].value}`; }
      return null;
    };
    let fnDepth = 0;              // how many functions deep we are (return, defer)
    let loopDepth = 0, switchDepth = 0;
    // In if, while, for and switch, "name {" opens the block, not a struct literal; inside parentheses it works again (as in Go)
    let noLit = 0;
    const withLits = (f) => { const saved = noLit; noLit = 0; try { return f(); } finally { noLit = saved; } };
    const condExpr = () => { noLit++; try { return expr(); } finally { noLit--; } };
    // after NAME: "{" followed by "}" or "field:" is a struct literal
    const litAhead = () => !noLit && isOp("{");
    // Point{x: 1} uses names; Point{1, 2} gives the fields in order
    const namedFieldsAhead = () => {
      let q = 1;
      while (peek(q).type === "NEWLINE") q++;
      return isOp("}", q) || (peek(q).type === "NAME" && isOp(":", q + 1));
    };
    // parameter list: (a: int, b: str); with typed, the type is required
    const paramList = (typed, what) => {
      const params = [], ptypes = [];
      expect("(", `"(" after the ${what} name`);
      skipNL();
      while (!isOp(")")) {
        const pt = peek();
        const pn = name("a parameter name");
        if (params.includes(pn)) failAt(`Parameter "${pn}" appears twice`, pt);
        params.push(pn);
        if (typed) { expect(":", `":" and the type after ${pn}`); ptypes.push(langType()); }
        else ptypes.push(isOp(":") ? (p++, langType()) : null);
        skipNL();
        if (isOp(",")) { p++; skipNL(); } else if (!isOp(")")) fail('Expected "," or ")" in the parameter list');
      }
      p++;
      return { params, ptypes };
    };
    // separator between items of a declaration block: end of line or comma
    const itemEnd = (what) => {
      if (isOp(",")) { p++; skipNL(); return; }
      if (peek().type === "NEWLINE") skipNL();
      else if (!isOp("}")) fail(`Expected end of line or "}" after ${what}`);
    };

    function statements(endsAt, top = false) {
      const body = [];
      skipNL();
      while (!endsAt()) {
        if (peek().type === "EOF") fail('Expected "}" to close the block');
        body.push(statement(top));
        if (peek().type === "NEWLINE") skipNL();
        else if (!endsAt()) fail("Expected end of statement");
      }
      return body;
    }
    function program() { return { kind: "Program", body: statements(() => peek().type === "EOF", true) }; }
    function block() {
      expect("{", '"{" to open the block');
      const body = statements(() => isOp("}"));
      p++;
      return { kind: "Block", body };
    }
    // function body (declared or literal): return and defer are allowed inside; enclosing loops are not
    function funcBody() {
      const saved = [loopDepth, switchDepth];
      fnDepth++; loopDepth = 0; switchDepth = 0;
      try { return withLits(block); } finally { fnDepth--; [loopDepth, switchDepth] = saved; }
    }
    // "fn" already consumed: (params) -> results { body }
    function funcRest(t, fname, recv) {
      const { params, ptypes } = paramList(false, "function");
      if (recv) { params.unshift(recv.name); ptypes.unshift(recv.ptr ? "*" + recv.type : recv.type); }
      if (recv && params.indexOf(recv.name, 1) > 0) failAt(`Parameter "${recv.name}" has the same name as the receiver`, t);
      let rtype = null, results = null, rnames = null;
      if (isOp("->")) {
        p++;
        const r = resultTypes();
        results = r.types; rnames = r.names;
        rtype = results.length === 0 ? "void" : results.length === 1 ? results[0] : `(${results.join(", ")})`;
        if (rnames) rnames.forEach((nm) => { if (params.includes(nm)) failAt(`Result "${nm}" has the same name as a parameter`, t); });
      }
      const body = funcBody();
      return { kind: "Func", name: fname, params, ptypes, rtype, rnames, body, ...at(t), endLine: toks[p - 1].line };
    }

    function statement(top = false) {
      const t = peek();
      if (isKw("import")) {
        if (!top) fail("import can only appear at the top level of a file, outside blocks");
        p++;
        let names = null;
        if (isOp("{")) {
          p++; names = [];
          while (!isOp("}")) {
            const nt = peek();
            names.push({ name: name("the name of something to import"), line: nt.line, col: nt.col });
            if (isOp(",")) p++; else if (!isOp("}")) fail('Expected "," or "}" in the import list');
          }
          p++;
          if (!names.length) fail("The import list is empty");
          expectKw("from", '"from" after the list of names');
        }
        // import "std/strings" binds the namespace strings; import s "std/strings" binds s
        let alias = null;
        if (!names && peek().type === "NAME" && peek(1).type === "STRING") alias = toks[p++].value;
        if (peek().type !== "STRING") fail('Expected the file name in quotes, like "util.caju"');
        let path = toks[p++].value;
        if (!path.endsWith(".caju")) path += ".caju";
        let ns = null;
        if (!names) {
          ns = alias || path.slice(path.lastIndexOf("/") + 1, -5);
          if (!/^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]*$/.test(ns)) failAt(`"${ns}" is not a valid namespace name; write a name before the path: import name "${path}"`, t);
          namespaces.add(ns);
        }
        return { kind: "Import", path, names, ns, ...at(t) };
      }
      if (isKw("export")) {
        if (!top) fail("export can only appear at the top level of a file, outside blocks");
        p++;
        if (!["let", "const", "fn", "extern", "dllexport", "struct", "interface"].some((k) => isKw(k)))
          fail("export must be followed by let, const, fn, struct, interface, extern or dllexport");
        const decl = statement(true);
        decl.exported = true;
        return decl;
      }
      if (isKw("struct")) {
        if (!top) failAt("struct can only appear at the top level of a file, outside blocks and functions", t);
        p++;
        const nt = peek();
        const sname = name("the struct name after struct");
        if (isTypeWord(sname) || FFI_TYPES.includes(sname)) failAt(`"${sname}" is already a built-in type; choose another name`, nt);
        expect("{", '"{" and the field list');
        skipNL();
        const fields = [];
        while (!isOp("}")) {
          const ft = peek();
          // embedded field: just a struct name (or *Struct), as in Go
          if ((peek().type === "NAME" && !isOp(":", 1)) || isOp("*")) {
            const ptr = isOp("*") ? (p++, true) : false;
            const tn = name("the embedded struct name");
            if (fields.some((f) => f.name === tn)) failAt(`Field "${tn}" appears twice`, ft);
            fields.push({ name: tn, type: ptr ? "*" + tn : tn, embedded: true, ...at(ft) });
          } else {
            const fname = name("a field name, like x: num");
            if (fields.some((f) => f.name === fname)) failAt(`Field "${fname}" appears twice`, ft);
            expect(":", `":" and the type after ${fname}: every struct field needs a type`);
            fields.push({ name: fname, type: langType(), ...at(ft) });
          }
          itemEnd("the field");
        }
        p++;
        return { kind: "Struct", name: sname, fields, ...at(t) };
      }
      if (isKw("interface")) {
        if (!top) failAt("interface can only appear at the top level of a file, outside blocks and functions", t);
        p++;
        const nt = peek();
        const iname = name("the interface name after interface");
        if (isTypeWord(iname) || FFI_TYPES.includes(iname)) failAt(`"${iname}" is already a built-in type; choose another name`, nt);
        expect("{", '"{" and the method list');
        skipNL();
        const methods = [], embeds = [];
        while (!isOp("}")) {
          const mt = peek();
          const mname = name("a method name, like area() -> num");
          if (!isOp("(")) { embeds.push({ name: TYPE_ALIASES[mname] || mname, ...at(mt) }); itemEnd("the embedded interface"); continue; }
          if (methods.some((m) => m.name === mname)) failAt(`Method "${mname}" appears twice`, mt);
          const { params, ptypes } = paramList(true, "method");
          const r = isOp("->") ? (p++, resultTypes().types) : [];
          const rtype = r.length === 0 ? "void" : r.length === 1 ? r[0] : `(${r.join(", ")})`;
          methods.push({ name: mname, params, ptypes, rtype, ...at(mt) });
          itemEnd("the method");
        }
        p++;
        return { kind: "Interface", name: iname, methods, embeds, ...at(t) };
      }
      if (isKw("fn") && (!isOp("(", 1) || isMethodHeader())) {
        if (!top) failAt("fn can only appear at the top level of a file, outside blocks and other functions. To create a function here, use fn(...) { } as a value", t);
        p++;
        // method, as in Go: fn (p: Point) name(...)   or, to modify the original, fn (p: *Point) name(...)
        let recv = null;
        if (isOp("(")) {
          p++;
          const rn = name("the receiver name, like fn (p: Point) name()");
          expect(":", `":" and the struct after ${rn}`);
          const ptr = isOp("*") ? (p++, true) : false;
          const rt = peek();
          const rtype = name("the method's struct name");
          expect(")", '")" after the receiver');
          recv = { name: rn, type: rtype, ptr, ...at(rt) };
        }
        const fname = name(recv ? "the method name" : "the function name after fn");
        const f = funcRest(t, recv ? `${recv.type}.${fname}` : fname, recv);
        if (recv) { f.method = fname; f.recv = recv; }
        return f;
      }
      if (isKw("return")) {
        if (!fnDepth) failAt("return can only be used inside a function", t);
        p++;
        const values = peek().type === "NEWLINE" || peek().type === "EOF" || isOp("}") || isKw("case") || isKw("default") ? [] : exprList();
        return { kind: "Return", value: values.length === 1 ? values[0] : null, values, ...at(t) };
      }
      if (isKw("dllexport")) {
        // function the DLL offers to other languages: signature with C types
        if (!top) failAt("dllexport can only appear at the top level of a file", t);
        p++;
        expectKw("fn", '"fn" after dllexport');
        const nt = peek();
        const fname = name("the exported function name");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fname)) failAt("An exported function name may only contain unaccented letters, digits and _, so other languages can call it", nt);
        expect("(", '"(" after the function name');
        const params = [];
        while (!isOp(")")) {
          const pt = peek();
          const pn = name("a parameter name");
          if (params.some((q) => q.name === pn)) failAt(`Parameter "${pn}" appears twice`, pt);
          expect(":", `":" and the type after ${pn}: every parameter of an exported function needs a type`);
          const tt = peek();
          const type = dllType();
          if (type === "void") failAt("void can only be used as a return type", tt);
          params.push({ name: pn, type });
          if (isOp(",")) p++; else if (!isOp(")")) fail('Expected "," or ")" in the parameter list');
        }
        p++;
        let ret = "void";
        if (isOp("->")) { p++; ret = dllType(); }
        const body = funcBody();
        return { kind: "Func", name: fname, params: params.map((q) => q.name), ptypes: params.map((q) => FFI_LANG[q.type]), rtype: FFI_LANG[ret],
          body, ...at(t), endLine: toks[p - 1].line, dll: { name: fname, ret, types: params.map((q) => q.type) } };
      }
      if (isKw("extern")) {
        if (!top) failAt("extern can only appear at the top level of a file", t);
        p++;
        if (peek().type !== "STRING") fail('Expected the DLL name in quotes, like "user32.dll"');
        const dll = toks[p++].value;
        let conv = "stdcall";
        if (peek().type === "NAME" && (peek().value === "stdcall" || peek().value === "cdecl")) conv = toks[p++].value;
        expectKw("fn", '"fn" after the DLL name (and the calling convention, if any)');
        const sym = name("the DLL function name");
        expect("(", '"(" after the function name');
        const params = [];
        while (!isOp(")")) {
          const pt = peek();
          const pn = name("a parameter name");
          if (params.some((q) => q.name === pn)) failAt(`Parameter "${pn}" appears twice`, pt);
          expect(":", `":" and the type after ${pn}`);
          const tt = peek();
          const type = ffiType();
          if (type === "void") failAt("void can only be used as a return type", tt);
          params.push({ name: pn, type });
          if (isOp(",")) p++; else if (!isOp(")")) fail('Expected "," or ")" in the parameter list');
        }
        p++;
        let ret = "void";
        if (isOp("->")) { p++; ret = ffiType(); }
        return { kind: "Extern", name: sym, symbol: sym, dll, conv, params, ret, ...at(t) };
      }
      if (isKw("let") || isKw("const")) {
        const kw = toks[p++].value;
        const n = name(`a name after ${kw}`);
        const type = isOp(":") ? (p++, langType()) : null;
        if (kw === "const" && !isOp("=")) fail(`A constant needs a value: const ${n} = ...`);
        if (!isOp("=") && type) return { kind: "Assign", name: n, decl: kw, type, value: null, ...at(t) };   // let x: int  (zero value)
        expect("=", type ? `"=" and the initial value: ${kw} ${n}: ${type} = ...` : '"=" after the name');
        return { kind: "Assign", name: n, decl: kw, type, value: expr(), ...at(t) };
      }
      if (isKw("if")) return ifStmt();
      if (isKw("while")) {
        p++;
        const cond = condExpr();
        return { kind: "While", cond, body: loopBody(), ...at(t) };
      }
      if (isKw("for")) return forStmt(null);
      if (isKw("switch")) return switchStmt(null);
      if (isKw("select")) return selectStmt(null);
      // loop label: outer: for ... { ... break outer }
      let lq = 2;
      while (t.type === "NAME" && isOp(":", 1) && peek(lq).type === "NEWLINE") lq++;
      if (t.type === "NAME" && isOp(":", 1) && (isKw("for", lq) || isKw("while", lq) || isKw("switch", lq) || isKw("select", lq))) {
        p += lq;
        const s = isKw("for") ? forStmt(t.value) : isKw("while") ? (() => { p++; const cond = condExpr(); return { kind: "While", cond, body: loopBody(), ...at(t) }; })()
          : isKw("switch") ? switchStmt(t.value) : selectStmt(t.value);
        s.label = t.value;
        return s;
      }
      if (isKw("break") || isKw("continue")) {
        const kw = toks[p++].value;
        const label = peek().type === "NAME" ? toks[p++].value : null;
        if (kw === "continue" && !loopDepth) failAt("continue can only be used inside a loop", t);
        if (kw === "break" && !loopDepth && !switchDepth) failAt("break can only be used inside a loop, switch or select", t);
        return { kind: kw === "break" ? "Break" : "Continue", label, ...at(t) };
      }
      if (isKw("fallthrough")) { p++; return { kind: "Fallthrough", ...at(t) }; }
      if (isKw("defer") || isKw("go")) {
        const kw = toks[p++].value;
        const call = expr();
        if (!["Call", "MethodCall", "CallValue"].includes(call.kind)) failAt(`${kw} must be followed by a function call, like ${kw} f(x)`, t);
        return { kind: kw === "defer" ? "Defer" : "Go", call, ...at(t) };
      }
      if (isKw("else")) fail('Found "else" without a preceding "if"');
      return simpleStmt();
    }
    // loop body: break and continue are allowed inside
    function loopBody() { loopDepth++; try { return block(); } finally { loopDepth--; } }
    // assignment, short declaration, x++, channel send or expression
    function simpleStmt(allowRange = false) {
      const t = peek();
      const lhs = exprList();
      const op = peek();
      if (op.type === "OP" && (op.value === ":=" || op.value === "=")) {
        p++;
        if (allowRange && isKw("range")) {
          p++;
          const subject = expr();
          lhs.forEach((e) => { if (op.value === ":=" && e.kind !== "Var") failAt('":=" must be preceded by variable names', e); });
          if (lhs.length > 2) failAt("range yields at most two values: index (or key) and value", t);
          return { kind: "Range", vars: lhs, decl: op.value === ":=", subject, ...at(t) };
        }
        const rhs = exprList();
        if (op.value === ":=") {
          lhs.forEach((e) => { if (e.kind !== "Var") failAt('":=" must be preceded by variable names, like x := 1 or a, b := f()', e.line ? e : t); });
          if (lhs.length === 1 && rhs.length === 1) return { kind: "Assign", name: lhs[0].name, decl: ":=", type: null, value: rhs[0], ...at(t) };
          return { kind: "VarDecl", names: lhs.map((e) => e.name), values: rhs, ...at(t) };
        }
        lhs.forEach(checkTarget);
        if (lhs.length === 1 && rhs.length === 1) {
          if (lhs[0].kind === "Var") return { kind: "Assign", name: lhs[0].name, decl: null, value: rhs[0], ...at(t) };
          if (lhs[0].kind === "Field") return { kind: "FieldAssign", obj: lhs[0].obj, name: lhs[0].name, value: rhs[0], line: lhs[0].line, col: lhs[0].col };
        }
        return { kind: "MultiAssign", targets: lhs, values: rhs, ...at(t) };
      }
      if (op.type === "OP" && /^(\+|-|\*|\/|%|&|\||\^|<<|>>|&\^)=$/.test(op.value)) {
        p++;
        if (lhs.length !== 1) failAt(`"${op.value}" changes a single variable`, op);
        checkTarget(lhs[0]);
        return { kind: "OpAssign", target: lhs[0], op: op.value.slice(0, -1), value: expr(), ...at(t) };
      }
      if (op.type === "OP" && (op.value === "++" || op.value === "--")) {
        p++;
        if (lhs.length !== 1) failAt(`"${op.value}" changes a single variable`, op);
        checkTarget(lhs[0]);
        return { kind: "OpAssign", target: lhs[0], op: op.value[0], value: { kind: "Number", value: 1, int: true, ...at(op) }, ...at(t) };
      }
      if (op.type === "OP" && op.value === "<-") {
        p++;
        if (lhs.length !== 1) failAt("You can only send on one channel at a time", op);
        return { kind: "Send", ch: lhs[0], value: expr(), ...at(t) };
      }
      if (lhs.length !== 1) fail('A list of values must be followed by "=" or ":="');
      return { kind: "ExprStmt", expr: lhs[0], ...at(t) };
    }
    function checkTarget(e) {
      if (!["Var", "Field", "Index", "Deref"].includes(e.kind) && !(e.kind === "Var" && e.name === "_"))
        throw new CajuError("syntax", "You can only assign to a variable, a field (p.x), an element (a[i]) or a pointer (*p)", e.line ?? peek().line, e.col ?? null);
    }
    function exprList() {
      const list = [expr()];
      while (isOp(",")) { p++; list.push(expr()); }
      return list;
    }
    function ifStmt() {
      const t = toks[p++];
      let init = null, cond;
      noLit++;
      try {
        const first = simpleStmt();
        if (isSemi()) { p++; init = first; cond = expr(); }
        else if (first.kind === "ExprStmt") cond = first.expr;
        else failAt('An assignment in an if must be followed by ";" and the condition: if x := f(); x > 0 { }', t);
      } finally { noLit--; }
      const then = block();
      let otherwise = null;
      const save = p;
      skipNL();
      if (isKw("else")) {
        p++;
        otherwise = isKw("if") ? ifStmt() : block();
      } else p = save;
      return { kind: "If", init, cond, then, otherwise, ...at(t) };
    }
    function forStmt(label) {
      const t = toks[p++];
      // for {  } : infinite loop
      if (isOp("{")) return { kind: "ForC", init: null, cond: null, post: null, body: loopBody(), ...at(t) };
      // for range x { }
      if (isKw("range")) { p++; const subject = condExpr(); return { kind: "Range", vars: [], decl: false, subject, body: loopBody(), ...at(t) }; }
      // for i = a to b { }  (Caju's classic for)
      if (peek().type === "NAME" && isOp("=", 1)) {
        const save = p;
        p += 2;
        const from = condExpr();
        if (isKw("to")) {
          p++;
          const to = condExpr();
          return { kind: "ForTo", name: toks[save].value, from, to, body: loopBody(), ...at(t) };
        }
        p = save;
      }
      let h;
      noLit++;
      try { h = forHeader(t); } finally { noLit--; }
      if (h.kind === "Range") { h.body = loopBody(); return h; }
      return { kind: "ForC", init: h.init, cond: h.cond, post: h.post, body: loopBody(), ...at(t) };
    }
    function forHeader(t) {
      let init = null, cond = null, post = null;
      if (!isSemi()) {
        const first = simpleStmt(true);
        if (first.kind === "Range") return first;
        if (!isSemi()) {
          if (first.kind !== "ExprStmt") failAt("In a for with an assignment, use for init; condition; post { }", t);
          return { init: null, cond: first.expr, post: null };
        }
        init = first;
      }
      p++;
      if (!isSemi()) cond = expr();
      if (!isSemi()) fail('Expected ";" after the for condition');
      p++;
      if (!isOp("{")) post = simpleStmt();
      return { init, cond, post };
    }
    // switch and select cases: "case ...:" and "default:", with the statements up to the next case
    function caseBody() {
      return statements(() => isKw("case") || isKw("default") || isOp("}"));
    }
    function switchStmt(label) {
      const t = toks[p++];
      let init = null, tag = null, typeSwitch = null;
      noLit++;
      try {
        if (!isOp("{")) {
          const first = isSemi() ? null : simpleStmt();
          if (isSemi()) { p++; init = first; if (!isOp("{")) tag = simpleStmt(); }
          else tag = first;
        }
      } finally { noLit--; }
      // switch v := x.(type)  or  switch x.(type)
      if (tag) {
        if (tag.kind === "Assign" && tag.decl === ":=" && tag.value.kind === "TypeOf") typeSwitch = { bind: tag.name, subject: tag.value.obj };
        else if (tag.kind === "ExprStmt" && tag.expr.kind === "TypeOf") typeSwitch = { bind: null, subject: tag.expr.obj };
        else if (tag.kind !== "ExprStmt") failAt("switch expects an expression", t);
        else tag = tag.expr;
      }
      expect("{", '"{" to open the switch');
      skipNL();
      const cases = [];
      let hasDefault = false;
      switchDepth++;
      try {
        while (!isOp("}")) {
          const ct = peek();
          if (isKw("default")) {
            p++;
            if (hasDefault) failAt("The switch already has a default", ct);
            hasDefault = true;
            expect(":", '":" after default');
            cases.push({ exprs: null, types: null, body: caseBody(), ...at(ct) });
            continue;
          }
          expectKw("case", '"case" or "default" inside the switch');
          let exprs = null, types = null;
          if (typeSwitch) {
            types = [];
            do { types.push(isKw("nil") ? (p++, "nil") : langType()); } while (isOp(",") && ++p);
          } else {
            exprs = [];
            noLit++;
            try { do { exprs.push(expr()); } while (isOp(",") && ++p); } finally { noLit--; }
          }
          expect(":", '":" after the case values');
          const body = caseBody();
          const last = body[body.length - 1];
          if (last && last.kind === "Fallthrough") { if (typeSwitch) failAt("fallthrough is not allowed in a type switch", last); }
          body.forEach((s, i) => { if (s.kind === "Fallthrough" && i !== body.length - 1) failAt("fallthrough must be the last statement of the case", s); });
          cases.push({ exprs, types, body, ...at(ct) });
        }
      } finally { switchDepth--; }
      p++;
      if (cases.length && cases[cases.length - 1].body.some((s) => s.kind === "Fallthrough")) failAt("The last case cannot have fallthrough", t);
      if (typeSwitch) return { kind: "TypeSwitch", init, bind: typeSwitch.bind, subject: typeSwitch.subject, cases, ...at(t) };
      return { kind: "Switch", init, tag, cases, ...at(t) };
    }
    function selectStmt(label) {
      const t = toks[p++];
      expect("{", '"{" to open the select');
      skipNL();
      const cases = [];
      switchDepth++;
      try {
        while (!isOp("}")) {
          const ct = peek();
          if (isKw("default")) {
            p++; expect(":", '":" after default');
            if (cases.some((c) => c.kind === "default")) failAt("The select already has a default", ct);
            cases.push({ kind: "default", body: caseBody(), ...at(ct) });
            continue;
          }
          expectKw("case", '"case" or "default" inside the select');
          const st = simpleStmt();
          let c;
          if (st.kind === "Send") c = { kind: "send", ch: st.ch, value: st.value };
          else if (st.kind === "ExprStmt" && st.expr.kind === "Recv") c = { kind: "recv", ch: st.expr.arg, vars: [], decl: false };
          else if ((st.kind === "Assign" || st.kind === "VarDecl" || st.kind === "MultiAssign") && recvOf(st)) {
            const names = st.kind === "Assign" ? [{ kind: "Var", name: st.name, ...at(st) }] : st.kind === "VarDecl" ? st.names.map((nm) => ({ kind: "Var", name: nm, ...at(st) })) : st.targets;
            c = { kind: "recv", ch: recvOf(st).arg, vars: names, decl: st.kind === "VarDecl" || st.decl === ":=" };
          } else failAt("Each select case either receives (<-channel) or sends (channel <- value)", ct);
          expect(":", '":" after the case');
          cases.push({ ...c, body: caseBody(), ...at(ct) });
        }
      } finally { switchDepth--; }
      p++;
      return { kind: "Select", cases, ...at(t) };
    }
    const recvOf = (st) => {
      const v = st.kind === "Assign" ? st.value : st.values && st.values.length === 1 ? st.values[0] : null;
      return v && v.kind === "Recv" ? v : null;
    };
    // fn (p: T) name(...) is a method; fn (a: int) { } would be a literal at the top level (not accepted as a declaration)
    function isMethodHeader() {
      let q = 1, depth = 0;
      for (; q < 12; q++) { if (isOp("(", q)) depth++; if (isOp(")", q)) { depth--; if (!depth) break; } }
      return peek(q + 1).type === "NAME" && isOp("(", q + 2);
    }

    // ---- expressions ----
    function binLoop(next, ops, kind = "Binary") {
      let left = next();
      while ((peek().type === "OP" || peek().type === "KEYWORD") && ops.includes(peek().value)) {
        const t = toks[p++];
        const op = t.value === "&&" ? "and" : t.value === "||" ? "or" : t.value;
        left = { kind, op, left, right: next(), ...at(t) };
      }
      return left;
    }
    const expr = () => binLoop(andExpr, ["or", "||"], "Logical");
    const andExpr = () => binLoop(notExpr, ["and", "&&"], "Logical");
    function notExpr() {
      if (isKw("not") || isOp("!")) { const t = toks[p++]; return { kind: "Not", arg: notExpr(), ...at(t) }; }
      return comparison();
    }
    function comparison() {
      const left = sum();
      if (peek().type === "OP" && ["==", "!=", "<", ">", "<=", ">="].includes(peek().value)) {
        const t = toks[p++];
        return { kind: "Binary", op: t.value, left, right: sum(), ...at(t) };
      }
      return left;
    }
    const sum = () => binLoop(term, ["+", "-", "|", "^"]);
    const term = () => binLoop(unary, ["*", "/", "%", "<<", ">>", "&", "&^"]);
    function unary() {
      const t = peek();
      if (isOp("-")) { p++; return { kind: "Neg", arg: unary(), ...at(t) }; }
      if (isOp("+")) { p++; return unary(); }
      if (isOp("^")) { p++; return { kind: "BitNot", arg: unary(), ...at(t) }; }
      if (isOp("&")) { p++; return { kind: "AddrOf", arg: unary(), ...at(t) }; }
      if (isOp("*")) { p++; return { kind: "Deref", arg: unary(), ...at(t) }; }
      if (isOp("<-")) { p++; return { kind: "Recv", arg: unary(), ...at(t) }; }
      return power();
    }
    function power() {
      const base = primary();
      if (isOp("**")) { const t = toks[p++]; return { kind: "Binary", op: "**", left: base, right: unary(), ...at(t) }; }
      return base;
    }
    function primary() { return postfix(atom()); }
    // p.field, p.method(...), x.(T), a[i], a[i:j] and f(x), chained
    function postfix(base) {
      for (;;) {
        if (isOp(".")) {
          p++;
          const nt = peek();
          if (isOp("(")) {
            p++;
            if (peek().type === "NAME" && peek().value === "type" && isOp(")", 1)) { p += 2; base = { kind: "TypeOf", obj: base, ...at(nt) }; continue; }
            const ty = langType();
            expect(")", '")" after the type');
            base = { kind: "TypeAssert", obj: base, type: ty, ...at(nt) };
            continue;
          }
          const nm = name('a field or method name after "."');
          if (isOp("(")) base = { kind: "MethodCall", obj: base, name: nm, args: callArgs(), ...at(nt) };
          else base = { kind: "Field", obj: base, name: nm, ...at(nt) };
          continue;
        }
        if (isOp("[")) {
          const bt = toks[p++];
          const r = withLits(() => {
            let lo = null, hi = null;
            if (!isOp(":")) lo = expr();
            if (isOp(":")) {
              p++;
              if (!isOp("]")) hi = expr();
              expect("]", '"]" to close the slice');
              return { kind: "SliceExpr", obj: base, lo, hi, ...at(bt) };
            }
            expect("]", '"]" to close the index');
            return { kind: "Index", obj: base, index: lo, ...at(bt) };
          });
          base = r;
          continue;
        }
        if (isOp("(") && base.kind !== "Var" && peek().line === toks[p - 1].line) {
          const ct = peek();
          base = { kind: "CallValue", fn: base, args: callArgs(), ...at(ct) };
          continue;
        }
        return base;
      }
    }
    function callArgs() {
      return withLits(() => {
        p++; const args = [];
        skipNL();
        if (!isOp(")")) {
          args.push(expr());
          skipNL();
          while (isOp(",")) { p++; skipNL(); if (isOp(")")) break; args.push(expr()); skipNL(); }
        }
        if (isOp("...")) { p++; args.spread = true; skipNL(); }
        expect(")", '")" to close the call');
        return args;
      });
    }
    function structLit(t) {
      return withLits(() => {
        p++;   // {
        skipNL();
        const fields = [];
        while (!isOp("}")) {
          const ft = peek();
          const fname = name("a field name");
          if (fields.some((f) => f.name === fname)) failAt(`Field "${fname}" appears twice`, ft);
          expect(":", `":" after ${fname}`);
          fields.push({ name: fname, value: elemValue(), ...at(ft) });
          skipNL();
          if (isOp(",")) { p++; skipNL(); } else if (!isOp("}")) fail('Expected "," or "}" in the field list');
        }
        p++;
        return { kind: "StructLit", type: t.value, fields, ...at(t) };
      });
    }
    // value inside a composite literal: may be a {...} without the type, which comes from context
    function elemValue() { return isOp("{") ? braceLit(null, peek()) : expr(); }
    // {a, b, c}  or  {key: value, ...}  or  {field: value} when the type is a struct
    function braceLit(type, t) {
      return withLits(() => {
        expect("{", '"{"');
        skipNL();
        const elems = [];
        while (!isOp("}")) {
          const et = peek();
          let key = null, value = elemValue();
          if (isOp(":")) { p++; key = value; value = elemValue(); }
          elems.push({ key, value, ...at(et) });
          skipNL();
          if (isOp(",")) { p++; skipNL(); } else if (!isOp("}")) fail('Expected "," or "}" in the element list');
        }
        p++;
        return { kind: "CompositeLit", type, elems, ...at(t) };
      });
    }
    function atom() {
      const t = peek();
      if (t.type === "NUMBER") {
        p++;
        const isInt = !/[.eE]/.test(t.value) || /^0[xX]/.test(t.value);
        return { kind: "Number", value: Number(t.value), int: isInt, ...(isInt ? { raw: t.value } : {}), ...at(t) };
      }
      if (t.type === "RUNE") { p++; return { kind: "Number", value: t.value, int: true, rune: true, ...at(t) }; }
      if (t.type === "STRING") { p++; return { kind: "String", value: t.value, ...at(t) }; }
      if (isKw("true") || isKw("false")) { p++; return { kind: "Bool", value: t.value === "true", ...at(t) }; }
      if (isKw("nil")) { p++; return { kind: "Nil", ...at(t) }; }
      // fn(...) -> T { ... }: anonymous function (closure)
      if (isKw("fn") && isOp("(", 1)) {
        p++;
        const f = funcRest(t, `fn@${locLine(t.line)}:${t.col}`, null);
        return { kind: "FuncLit", fn: f, ...at(t) };
      }
      // []int{...}, [3]int{...}, map[str]int{...}, []byte(s)
      if (isOp("[") || isKw("map") || (isKw("chan") && false)) {
        const ty = langType();
        if (isOp("{")) return braceLit(ty, t);
        if (isOp("(")) { const args = callArgs(); return { kind: "Conversion", type: ty, args, ...at(t) }; }
        fail(`Expected "{" or "(" after the type ${ty}`);
      }
      if (t.type === "NAME") {
        const q = qualified();
        if (q) {
          p++;
          if (isOp("(")) return { kind: "Call", name: q, args: callArgs(), ...at(t) };
          if (litAhead()) return namedFieldsAhead() ? structLit({ ...t, value: q }) : braceLit(q, t);
          return { kind: "Var", name: q, ...at(t) };
        }
        p++;
        // make(T, ...) and new(T): the first argument is a type
        if ((t.value === "make" || t.value === "new") && isOp("(")) {
          return withLits(() => {
            p++;
            const typeArg = langType();
            const args = [];
            while (isOp(",")) { p++; args.push(expr()); }
            expect(")", '")" to close the call');
            return { kind: "Call", name: t.value, typeArg, args, ...at(t) };
          });
        }
        if (isOp("(")) return { kind: "Call", name: t.value, args: callArgs(), ...at(t) };
        if (litAhead()) return namedFieldsAhead() ? structLit(t) : braceLit(t.value, t);
        if (noLit && isOp("{")) {
          let q = 1;
          while (peek(q).type === "NEWLINE") q++;
          if (peek(q).type === "NAME" && isOp(":", q + 1))
            failAt(`In an if, while, for or switch condition, "${t.value} {" opens the block. To create a struct there, use parentheses: (${t.value}{...})`, peek());
        }
        return { kind: "Var", name: t.value, ...at(t) };
      }
      if (isOp("(")) { p++; const e = withLits(expr); expect(")", '")" to close the parenthesis'); return { kind: "Paren", expr: e, ...at(t) }; }
      fail("Expected a number, string, name or \"(\"");
    }
    return program();
  }

