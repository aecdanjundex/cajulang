#!/usr/bin/env node
// Prints a syntax tree of the bootstrap compiler in the canonical text form that the Caju
// compiler prints too (compiler/dump.caju), to check the port stage by stage.
//
//   node bootstrap/dump.js [--stage=parse|link|check] file.caju
//     parse  the entry file only, as the parser returns it
//     link   the linked program (all imported files)
//     check  the linked program after the type checker and the checks (with annotations)
//
// The JavaScript node is first converted to the field layout of compiler/ast.caju (see the
// comment at the top of that file); fields are printed in the order they are declared there.
const fs = require("fs"), path = require("path");
const { E, loadProject } = require("./project.js");

const AST = fs.readFileSync(path.join(__dirname, "..", "compiler", "ast.caju"), "utf8");
const body = AST.slice(AST.indexOf("export struct Node {"), AST.indexOf("\n}", AST.indexOf("export struct Node {")));
const FIELDS = [...body.matchAll(/^  ([a-z_]+): ([^\s#]+)/gm)].map((m) => ({ name: m[1], type: m[2] }));
const NONE_INTS = new Set(["ik", "fk", "nk", "nres", "discard", "unpack"]);
const snake = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const KEYWORD_FIELDS = { fn: "fn_", from: "from_", to: "to_" };

// JavaScript node (or plain object) -> object with Caju field names
function convert(n, ctx, parent) {
  const o = {};
  let kind = n.kind;
  if (ctx === "cases" && !["recv", "send", "default"].includes(kind)) kind = "Case";
  else if (ctx === "fields") kind = parent && parent.kind === "Struct" ? "FieldDef" : "FieldInit";
  else if (ctx === "sfields") kind = "SField";
  else if (ctx === "elems") kind = "Elem";
  else if (ctx === "methods") kind = "MethodSig";
  else if (ctx === "embeds") kind = "Embed";
  else if (ctx === "recv" && parent && parent.kind === "Func") kind = "Receiver";
  else if (ctx === "import_names") kind = "ImportName";
  o.kind = kind;
  for (const [k, v] of Object.entries(n)) {
    if (k === "kind" || v === undefined || v === null) continue;
    let name = KEYWORD_FIELDS[k] || snake(k), val = v;
    if (k === "value") name = typeof v === "number" ? "num_value" : typeof v === "string" ? "str_value" : typeof v === "boolean" ? "bool_value" : "value";
    else if (k === "body") name = Array.isArray(v) ? "stmts" : "body";
    else if (k === "decl" && typeof v === "boolean") name = "define";
    else if (k === "path" && Array.isArray(v)) name = "field_path";
    else if (k === "target" && typeof v === "string") name = "target_name";
    else if (k === "names" && n.kind === "Import") name = "import_names";
    else if (k === "params" && n.kind === "Extern") { o.params = v.map((p) => p.name); o.ptypes = v.map((p) => p.type); continue; }
    else if (k === "dll" && typeof v === "object") { o.dll_name = v.name; o.dll_ret = v.ret; o.dll_types = v.types; continue; }
    else if (k === "endLine") name = "end_line";
    if (k === "args" && v.spread) o.args_spread = true;
    if (val instanceof Set) val = [...val];
    o[name] = val;
  }
  if (kind === "Case") o.is_default = !n.exprs && !n.types;
  if (o.ptypes) o.ptypes = o.ptypes.map((t) => t ?? "");
  return o;
}

function fmtScalar(f, v) {
  if (f.type === "num") { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v); return "0x" + b.getBigUint64(0).toString(16); }
  if (f.type === "str") return JSON.stringify(v);
  return String(v);
}

function dump(n, ctx, parent, indent, out) {
  const o = convert(n, ctx, parent);
  const pad = "  ".repeat(indent);
  out.push(`${pad}${o.kind}`);
  for (const f of FIELDS) {
    if (f.name === "kind") continue;
    let v = o[f.name];
    if (v === undefined || v === null || v === false || v === "") continue;
    if (NONE_INTS.has(f.name) && v === -1) continue;
    if (f.type === "*Node") { out.push(`${pad}  ${f.name}:`); dump(v, f.name, n, indent + 2, out); continue; }
    if (f.type === "[]*Node") {
      if (!v.length) continue;
      out.push(`${pad}  ${f.name}: [${v.length}]`);
      for (const x of v) dump(x, f.name, n, indent + 2, out);
      continue;
    }
    if (f.type === "[]str") { if (!v.length) continue; out.push(`${pad}  ${f.name}: [${v.map((s) => JSON.stringify(s ?? "")).join(" ")}]`); continue; }
    if (f.type === "map[str]bool") { const ks = Array.isArray(v) ? v : Object.keys(v); if (!ks.length) continue; out.push(`${pad}  ${f.name}: {${ks.map((s) => JSON.stringify(s)).join(" ")}}`); continue; }
    if (f.type === "int" && v === 0) continue;
    if (f.type === "num" && v === 0 && !Object.is(v, -0)) continue;
    out.push(`${pad}  ${f.name}=${fmtScalar(f, v)}`);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const stage = (args.find((a) => a.startsWith("--stage=")) || "--stage=parse").slice(8);
  const file = args.find((a) => !a.startsWith("--"));
  const files = loadProject(file);
  let ast;
  if (stage === "parse") ast = E.parse(E.lex(files[0].src, 0));
  else { ast = E.link(files); if (stage === "check") E.compile(ast); }
  const out = [];
  dump(ast, "root", null, 0, out);
  process.stdout.write(out.join("\n") + "\n");
}
module.exports = { dump, convert, FIELDS };
