  // =====================================================================
  // 2b. Linker: joins the project's files into a single program
  // =====================================================================
  // Each file is parsed separately. The linker follows the imports starting from
  // main.caju, checks what each file exports, renames each module's names so they
  // don't collide (x in util.caju becomes x@util.caju) and puts the modules in
  // the right order: an imported module runs before the module that imports it.
  function link(files) {
    const entry = files[0].name;
    const index = new Map(files.map((f, i) => [f.name, i]));
    const mods = new Map(), order = [], visiting = [];
    const linkErr = (msg, at) => new CajuError("link", msg, at.line, at.col);

    function declaredIn(ast) {
      const names = new Set();
      (function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) return n.forEach(walk);
        if ((n.kind === "Assign" && n.decl) || n.kind === "ForTo" || n.kind === "Extern" || n.kind === "Struct" || n.kind === "Interface") names.add(n.name);
        if (n.kind === "Func" && !n.recv) names.add(n.name);
        if (n.kind === "Func") n.params.forEach((p) => names.add(p));
        if (n.kind === "VarDecl") n.names.forEach((p) => names.add(p));
        for (const k of ["body", "then", "otherwise", "init", "cases"]) walk(n[k]);
      })(ast);
      return names;
    }
    function load(name, from) {
      if (mods.has(name)) return;
      if (visiting.includes(name))
        throw linkErr(`Circular import: ${[...visiting.slice(visiting.indexOf(name)), name].join(" → ")}`, from);
      const idx = index.get(name);
      const ast = parse(lex(files[idx].src, idx));
      visiting.push(name);
      for (const st of ast.body) {
        if (st.kind !== "Import") continue;
        if (st.path === name) throw linkErr("A file cannot import itself", st);
        if (!index.has(st.path)) throw linkErr(`File "${st.path}" does not exist in the project`, st);
        if (st.path === entry) throw linkErr(`${entry} is the project's entry point and cannot be imported`, st);
        load(st.path, st);
      }
      visiting.pop();
      const exports = new Map(), callables = new Set();
      for (const st of ast.body) {
        if (st.exported) exports.set(st.name, st);
        if (st.kind === "Func" || st.kind === "Extern") callables.add(st.name);
      }
      mods.set(name, { name, ast, exports, callables, declared: declaredIn(ast) });
      order.push(name);
    }
    load(entry, null);

    // A single file with no imports: nothing to link
    if (order.length === 1) return mods.get(entry).ast;

    const mangle = (mod, n) => (mod === entry ? n : `${n}@${mod}`);
    const body = [];
    for (const modName of order) {
      const m = mods.get(modName);
      const imported = new Map();
      for (const st of m.ast.body) {
        if (st.kind !== "Import" || !st.names) continue;
        const dep = mods.get(st.path);
        for (const it of st.names) {
          if (!dep.exports.has(it.name))
            throw linkErr(dep.declared.has(it.name)
              ? `"${it.name}" exists in ${st.path} but is not exported. Write export before its declaration`
              : `${st.path} has nothing named "${it.name}"`, it);
          const prev = imported.get(it.name);
          if (prev && prev.from !== st.path) throw linkErr(`"${it.name}" was already imported from ${prev.from}`, it);
          if (m.declared.has(it.name)) throw linkErr(`"${it.name}" is imported from ${st.path} and also declared in this file. Choose a different name for one of them`, it);
          imported.set(it.name, { target: mangle(st.path, it.name), from: st.path });
        }
      }
      // namespaces: import "std/strings" lets this module write strings.name
      const namespaces = new Map();
      for (const st of m.ast.body) {
        if (st.kind !== "Import" || !st.ns) continue;
        if (m.declared.has(st.ns)) throw linkErr(`"${st.ns}" names the module ${st.path} and is also declared in this file. Import it with another name: import other "${st.path}"`, st);
        const prev = namespaces.get(st.ns);
        if (prev && prev !== st.path) throw linkErr(`The namespace "${st.ns}" is already used by ${prev}. Import it with another name: import other "${st.path}"`, st);
        namespaces.set(st.ns, st.path);
      }
      let here = null;           // node being renamed, for error positions
      const qualified = (q) => {
        const i = q.indexOf("."), ns = q.slice(0, i), nm = q.slice(i + 1);
        const path = namespaces.get(ns);
        if (!path) return null;
        const dep = mods.get(path);
        if (!dep.exports.has(nm))
          throw linkErr(dep.declared.has(nm) ? `"${nm}" exists in ${path}, but it is not exported. Write export before its declaration` : `${path} has nothing called "${nm}"`, here);
        return mangle(path, nm);
      };
      const rename = (n) => (n === "_" || (n === "errors" && !m.declared.has(n) && !imported.has(n)) ? n : (n.includes(".") && qualified(n)) || (imported.has(n) ? imported.get(n).target : mangle(modName, n)));
      // types: the module's own or imported structs and interfaces get their linked name, also inside []T, map[K]V, *T...
      const rt = (ty) => (ty == null ? ty : ty.replace(/[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]*(\.[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]*)?/g, (w) => (isTypeWord(w) || w === "map" || w === "chan" || w === "fn" ? w : rename(w))));
      const tx = (n) => {
        if (Array.isArray(n)) { const r = n.map(tx); if (n.spread) r.spread = true; return r; }
        if (!n || typeof n !== "object") return n;
        const o = { ...n };
        if (n.line != null) here = n;
        // the standard library may use the low-level operations (__load8, __syscall, ...)
        if (n.kind === "Call" && modName.startsWith("std/")) o.privileged = true;
        if ((n.kind === "Assign" || n.kind === "ForTo") && n.name && n.name.includes(".")) throw linkErr(`"${n.name}" belongs to another module and cannot be changed here`, n);
        if ((n.kind === "Assign" || n.kind === "ForTo") && imported.has(n.name))
          throw linkErr(`"${n.name}" was imported from ${imported.get(n.name).from} and cannot be changed here`, n);
        if (["Var", "Assign", "ForTo", "Func", "Extern"].includes(n.kind)) o.name = rename(n.name);
        if (n.kind === "Func") { o.params = n.params.map(rename); if (n.rnames) o.rnames = n.rnames.map(rename); }
        if (["Assign", "CompositeLit", "Conversion", "TypeAssert"].includes(n.kind)) o.type = rt(n.type);
        if (n.kind === "Call" && n.typeArg) o.typeArg = rt(n.typeArg);
        if (n.kind === "VarDecl") o.names = n.names.map(rename);
        if (n.kind === "TypeSwitch" && n.bind) o.bind = rename(n.bind);
        if (n.types) o.types = n.types.map((t) => (t === "nil" ? t : rt(t)));
        if (n.kind === "Func") {
          if (n.ptypes) o.ptypes = n.ptypes.map(rt);
          o.rtype = rt(n.rtype);
          if (n.recv) { o.recv = { ...n.recv, type: rt(n.recv.type) }; o.name = `${o.recv.type}.${n.method}`; }
        }
        if (n.kind === "Struct") o.fields = n.fields.map((f) => ({ ...f, type: rt(f.type) }));
        if (n.kind === "Interface") { o.methods = n.methods.map((m) => ({ ...m, ptypes: m.ptypes.map(rt), rtype: rt(m.rtype) })); o.embeds = (n.embeds || []).map((e) => ({ ...e, name: rt(e.name) })); }
        if (n.kind === "Struct" || n.kind === "Interface") o.name = rename(n.name);
        if (n.kind === "StructLit") { o.type = rt(n.type); o.fields = n.fields.map((f) => ({ ...f, value: tx(f.value) })); }
        // calls: the module's own or imported functions and externs get their linked name; built-ins stay as they are
        if (n.kind === "Call" && (imported.has(n.name) || m.callables.has(n.name) || m.declared.has(n.name) || n.name.includes("."))) o.name = rename(n.name);
        for (const k of ["expr", "value", "left", "right", "arg", "cond", "then", "otherwise", "from", "to", "body", "args", "obj",
          "init", "post", "tag", "cases", "exprs", "subject", "vars", "targets", "values", "target", "ch", "call", "index", "lo", "hi", "elems", "key", "fn"])
          if (n[k] != null) o[k] = tx(n[k]);
        return o;
      };
      body.push({ kind: "Module", name: modName, body: m.ast.body.filter((st) => st.kind !== "Import").map(tx) });
    }
    return { kind: "Program", body };
  }

