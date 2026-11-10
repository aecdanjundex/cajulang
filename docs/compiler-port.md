# Porting the compiler to Caju

The goal: the Caju compiler written in Caju (`compiler/*.caju`), compiled first by the bootstrap
compiler (`bootstrap/*.js`), produces **byte-identical executables** to the bootstrap for every
program. Then it compiles itself (stage 2), and that compiles itself again (stage 3); stage 2 and
stage 3 must be identical byte for byte. After that the JavaScript bootstrap is retired.

The port is a faithful translation: same algorithms, same order of operations, same messages,
same symbol names, same output layout. Fixes and improvements come after the port is verified.

## Modules

| Caju module | Ported from | Exports (main) |
|---|---|---|
| `compiler/ast.caju` | (shared) | `Node`, `new_node`, `NONE`, `LOC_BASE`, `loc_file`, `loc_line`, `CompileError`, `fail`, `format_error`, `SourceFile` |
| `compiler/dump.caju` | `bootstrap/dump.js` | `dump(node) -> str` (canonical text, same as the JS dump) |
| `compiler/lexer.caju` | `bootstrap/lexer.js` | `Token`, `lex(src, file_index) -> []*Token`, `KEYWORDS` |
| `compiler/parser.caju` | `bootstrap/parser.js` | `parse(toks) -> *ast.Node` |
| `compiler/linker.caju` | `bootstrap/linker.js` | `link(files: []*ast.SourceFile) -> *ast.Node` |
| `compiler/project.caju` | `bootstrap/project.js` | `load_project(entry, lib_dir) -> []*ast.SourceFile` |
| `compiler/types.caju` | `bootstrap/types.js` | `typecheck(prog, intrinsics) -> *Result`, and every top-level helper of types.js |
| `compiler/check.caju` | `bootstrap/compiler.js` (checks only) | `check(prog) -> *types.Result` (the JS `compile(ast)` minus bytecode) |
| `compiler/x64.caju` | `bootstrap/native.js` (class X64) | the assembler |
| `compiler/native.caju` | `bootstrap/native.js` | `compile_native(files, rt_sources, target) -> *bytes.Buffer` |
| `compiler/main.caju` | `bootstrap/caju.js` | the `caju` command |

Big modules may be split in more files (e.g. `native_expr.caju`) if it helps.

## Rules for the translation

- **Names.** A JavaScript top-level function or constant `fooBar` becomes `foo_bar` (exported when
  another module uses it). `KIND_CODE` stays `KIND_CODE`. Node properties follow `compiler/ast.caju`
  (read its header comment: split properties, keyword fields like `fn_`, plain objects that became
  nodes). Types and messages stay exactly as in JavaScript.
- **Errors.** `throw new CajuError(stage, msg, line, col)` becomes `ast.fail(stage, msg, line, col)`
  (it panics). Messages must be byte-identical to the JavaScript ones. A function that calls
  `ast.fail` and has a result still needs a `return` after it.
- **State.** The JavaScript stages are big functions with nested closures sharing local state.
  In Caju, put that state in a struct and make the closures methods (`fn (c: *Checker) expr(...)`);
  Caju does not allow `fn` declarations inside functions, and methods can call each other freely.
- **Collections.** `Map` -> `map[K]V` (Caju maps iterate in insertion order, like `Map`; delete then
  re-insert moves a key to the end, also like `Map`). `Set` -> `map[str]bool`. Arrays -> slices.
  `null`/`undefined` -> zero values (or `ast.NONE` for the optional integer annotations).
- **Numbers.** JavaScript numbers that are integers -> `int`. Float literals: `strconv.parse_float`
  gives the same double as `Number(text)`. Bits of a double: `math.bits`, `math.from_bits`.
  `BigInt` arithmetic in native.js -> plain `int` (64-bit, wrapping).
- **Strings.** Caju strings are UTF-8 bytes; `s[i]` is a byte, `s[a:b]` a substring.
  JavaScript strings are UTF-16: where the JS code counts characters (the lexer's `col`), count
  like JavaScript does: one per code point, two for code points above U+FFFF. Build strings with
  `strings.Builder`; binary output with `bytes.Buffer`.
- **Regular expressions** have no Caju equivalent; write the matching by hand.
- **Standard library**: `std/strings`, `std/strconv`, `std/math`, `std/bytes`, `std/os` (see `lib/`).
  Import with `import "std/strings"` and use `strings.split(...)`. Modules of the compiler import
  each other the same way: `import "ast"` -> `ast.Node`.
- **What the bootstrap can compile.** The port is compiled by the bootstrap native compiler, which
  does not support yet: goroutines/channels/select, `alloc`/`peek`/`poke`, map keys that are structs,
  arrays, any or interfaces, calling methods on `any` values whose methods have no result type.
  Variables are function-scoped, not block-scoped: do not declare the same name twice in one
  function with different types. `let x = 0` makes a `num`; use `x := 0` or `let x: int = 0`.
  Struct values are copied on assignment; use `*T` for shared, mutable objects (nodes, tables).
- **Speed.** The compiled compiler must compile itself in seconds: avoid quadratic loops over big
  inputs, prefer `map` lookups, avoid building huge strings by repeated `+`.

## Checking a stage

```sh
node bootstrap/caju.js build -o /tmp/dumpc compiler/dump_main.caju   # a small driver
node bootstrap/dump.js --stage=parse file.caju > a.txt                 # the reference
/tmp/dumpc --stage=parse file.caju > b.txt && cmp a.txt b.txt
```

Stages: `parse` (entry file only), `link` (whole program), `check` (after type checking, with the
annotations). The final check of the code generator: `cmp` of the executables produced by
`node bootstrap/caju.js build` and by the Caju compiler, for every program under `tests/`.
