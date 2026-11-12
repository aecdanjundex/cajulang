# Caju: instructions for Claude Code

Caju is a Go-inspired programming language with a native compiler for x86-64 (ELF on Linux, PE on
Windows) and a runtime written in Caju itself. **The compiler is already written in Caju and
compiles itself**: stages 1, 2 and 3 come out byte-for-byte identical. The JavaScript compiler
(`bootstrap/`) remains only as a reference and to build the first stage.

The owner writes in Portuguese: answer in Brazilian Portuguese. The code, comments and messages
of the language are in English (a decision from the reorganization); keep it that way.

## Conventions

- Everything in the repository is in English: code, comments, messages of the language, file and
  directory names, and documentation (README, docs/, bench notes, CHANGELOG). Only the
  conversation with the owner is in Portuguese.
- Commits follow Conventional Commits (https://www.conventionalcommits.org), in English:
  `type(scope): summary` in the imperative, lower case, no final period, at most ~72 characters;
  a body that explains what and why when useful. Types: feat, fix, perf, refactor, docs, test,
  build, ci, chore. Scopes in use: compiler, wasm, rt, lib (or the module: json, http...), pkg,
  tools, bench, docs, release. A breaking change gets `!` and a `BREAKING CHANGE:` footer.
- Every user-visible change adds a line under `## [Unreleased]` in CHANGELOG.md (Keep a
  Changelog: Added, Changed, Fixed, Removed). Releasing moves those lines to a new version
  section; the release workflow publishes that section as the GitHub release notes
  (tools/changelog.sh), and fails if it is missing. See docs/releasing.md.

## Repository map

```
compiler/*.caju      the compiler, in Caju (see docs/compiler-port.md, module table)
  main.caju            the `caju` command (build, run, test, bench, pkg, version)
  pkg.caju             the package manager (docs/packages.md)
  build_main.caju      only `build` (small driver)
  dump_main.caju       prints a stage's tree (parse, link, check) to compare with the JS
  *_test.caju          tests for the native compiler, the runtime, pkg and the Windows target
  testdata/            helper programs for those tests
  wasm.caju, wasmenc.caju  the WebAssembly target (`--target wasm`, docs/wasm.md)
  mcp.caju             `caju check` and `caju mcp`, the Model Context Protocol server (docs/mcp.md)
  graph.caju           the in-memory code graph behind the MCP graph tools (caju_find, caju_symbol...)
rt/*.caju            runtime for programs: core, gc, values, dynamic, panic, linux, windows, wasm
lib/*.caju           standard library (import "std/x"): strings, strconv, math, bytes, os, fs, path,
                     net, http, toml, json, crypto, hash, hex, base64, testing; each with its _test.caju
bootstrap/*.js       the original JavaScript compiler (lexer, parser, types, linker, VM, native.js)
tests/lang/          language tests (*_test.caju + testdata/)
examples/            language examples; examples_test.caju runs each one and checks the output
bench/               programs/*.caju + run.js; history.jsonl tracks speed over time
tools/compare-compilers.sh   JS × Caju compiler: identical binaries for every program
tools/release.sh     builds dist/caju-linux-x86_64.tar.gz (docs/releasing.md); install.sh at the root installs
tools/changelog.sh   prints a version's CHANGELOG.md section (release notes for release.yml)
tools/wasm/          host for wasm programs (Node and browser) and package.sh (caju-wasm.tar.gz,
                     the wasm compiler the site's playground uses)
.github/workflows/   ci.yml (chain + suite on every push) and release.yml (tag v* → GitHub Release)
CHANGELOG.md         user-visible changes (Keep a Changelog); `## [Unreleased]` on top
docs/                packages.md, testing.md, compiler-port.md, native-architecture.md,
                     native-compiler-plan.md, history.md
build/, dist/        generated (do not commit)
```

## How to work

```sh
node bootstrap/caju.js build -o build/caju compiler/main.caju   # stage 1 (compiled by the JS)
build/caju build -o build/caju2 compiler/main.caju              # stage 2 (compiled by itself)
build/caju2 build -o build/caju3 compiler/main.caju && cmp build/caju2 build/caju3   # must be equal

build/caju test                   # every *_test.caju (≈30 s); -v shows each test
build/caju test lib/fs_test.caju --run "mkdir_all"
build/caju run program.caju       # compiles in memory and runs
build/caju test --target wasm tests/lang lib examples   # the suite with programs in wasm (Node)
CAJU=build/caju tools/wasm/package.sh                   # caju.wasm compiles itself identically + browser test
```

**Tests** (docs/testing.md): Go style in layout (`x_test.caju` next to `x.caju`, helpers in
`testdata/`) and BDD in writing: `describe("subject", fn() { it("behavior sentence", fn() {
expect(v).to_equal(w) }) })`. There are no `.out` files. Compile/run errors of a whole program:
`run_file("testdata/x.caju")` → `r.output`, `r.code`. Known bug not fixed yet: write the correct
test with `skip("... (known bug)", ...)`.

In wasm (`--target wasm tests/lang lib examples`) everything passes except `net` and `http` (no
sockets). Changed the native generator or `rt/`? Also run the wasm suite: `compiler/wasm.caju`
repeats the semantics of `native.caju` (without the optimizations) and uses the same runtime.

Expected result today: **857 pass, 0 fail, 9 skipped** (goroutines, alloc/peek/poke, Windows
programs from phases 6 and 7, and 3 known bugs in `tests/lang`: a variable read before being
assigned gives garbage; a dynamic method call on `any` neither converts an untyped argument nor
checks the argument count).

**The JS compiler is only stage 0.** Since the optimizations (bench/compare/OPTIMIZATION.md), the
Caju compiler generates better code than the JS one; the JS only compiles the first stage and
uses a frozen copy of the runtime (`bootstrap/rt/`). Correctness is guaranteed by the suite and by
self-compilation (stage 2 == stage 3). `tools/compare-compilers.sh` remains as history.
Changed the code generator or `rt/`? Run the suite, self-compilation and
`python3 bench/compare/run.py --langs=caju`; record the measurement in OPTIMIZATION.md.

Measuring: `tools/profile.sh` (time per function) and `tools/icount.sh` (exact instructions,
cycles, cache misses), see docs/tools.md. Viewing generated code: `tools/disasm.sh program.caju
function` (uses `CAJU_SYMS=file`, which writes each symbol's address). Crash:
`gdb -batch -ex run -ex 'info registers rip' binary` and look up the address in the `CAJU_SYMS`
file.

**Generated-code conventions the optimizations introduced** (respect them when touching the
generator):
- R15 counts the calls that still fit (starts at 10,000; `dec r15; js error` before each call);
  `__depth`/`__set_depth` in the runtime only save and compare.
- `early_guard`: `if p < K { return q }` at the start of the function runs before the prologue.
- RBX, R12, R13, R14 hold up to 4 never-pointer variables per function (`alloc_regs`); functions
  with `defer` save all 4 and restore them in `recover`.
- xmm0..`xtop` hold values during a `num` expression (`fexpr`); xmm15 is scratch (`coerce`,
  `float32`, division). Nothing may call a function while an expression XMM holds a value.
- Up to 7 `num` variables per function live in xmm14, xmm13... (`alloc_regs`, `Var.xr`; `xtop`
  goes down). Every call (`A.call`, `A.call_rax`) stores them in their slot before and reloads
  after; runtime errors that do not return use `A.call_noret`. Functions with `defer` don't use
  them.
- RSI, RDI, R8..R11 (`EXTRA_REGS`) hold more integer variables (`alloc_regs`, if the uses outweigh
  the calls) and, in loops without calls (or only inside `if`/`switch` branches), the length and
  data of SCache lists (`scache_slot`). Every call stores them in their slot before and reloads
  after (`A.spill`/`A.fill`, together with the XMMs), so a data pointer in them is on the stack
  during the call. `__syscall` too.
- Top-level variables that no function uses (not even `&x`) are locals of `u.top` (a variable of
  the function itself with the same name doesn't count: `func_locals`).
- `Fn.kn`: after checking `a[i]` (a and i locals not in a cell), the following `a[i]` don't check
  until a or i is assigned. `stmt()` keeps the facts (see "indexes known in range"); code that may
  not run (branches, right side of and/or, `switch`) learns nothing (`kn_off`).
- Loops with a cheap condition (`loop_entry`) repeat the condition before the body (no entry
  `jmp`).
- Calls to small `return E` functions become the expression (`try_inline`).
- `return L op f(args)` / `return f(args) op L` / `return f(args)` (f the function itself, op + *
  & | ^ on int) become a loop with an accumulator (`acc_plan`): each iteration spends one unit of
  R15 and the `return`s give back the entry R15 (`acc_depth`); the other `return q` give
  `acc op q`.
- Direct calls to program functions without `defer` (`reg_call`) pass the never-pointer arguments
  (int, bool, num; up to 6, `arg_plan`) in RSI, RDI, R8..R11 (`ARG_REGS`) and enter at
  `u.r.name`; the others (pointers, strings, structs, receiver) go on the stack as before.
  `u.f.name` (indirect calls: function values, interfaces, defer) loads the registers and falls
  into `u.r.name` (or pushes the stack ones again and calls). The caller does `A.spill` before
  loading the arguments; arguments containing calls are evaluated first (stack or hidden slot).
- Error paths go to cold code (`A.cold_begin`/`cold_end`, `f.fail_if`): the code goes after the
  function's `ret` (`flush_cold`) and the hot path runs straight. Cold code does not return on its
  own: it ends in a non-returning error or an explicit `jmp`.
- `while`/`for`/`range` loops have the condition after the body (one branch per iteration).
  `x64.finish` (when writing the executable) shortens branches to rel8 and removes branches to the
  next instruction: positions saved with `A.pos()` are only valid until then, and nothing may emit
  branches as raw bytes.

## What's missing

- Goroutines, channels, `select`, sleep with a scheduler, deadlock (phase 6).
- Windows: `alloc`/`peek`/`poke`/`readstr`, `dllexport` and native DLL (phase 7).
- The 3 known bugs above.
- std/testing's `to_have_length`/`to_contain` only know lists and maps of basic types (the
  language has no `len` on `any`); for others, `expect(len(x)).to_equal(n)`.
- Maps with struct/array/any keys, calling an `any` as a function, bitwise operations on `any`.

## Pitfalls that have already cost time

- `not` is a reserved word (hence `expect(x).not_()`); `s[i]` is `uint8` (use `int(s[i])`);
  there is no `~` operator (use `x ^ -1`); `"\xff"` is the character U+00FF in UTF-8, not the
  byte 0xFF.
- A variable named like an imported namespace is an error (`path` vs `import "std/path"`): import
  it under another name (`import filepath "std/path"`).
- An expression cannot continue on the next line after an operator (`a +` at the end of the line
  is a syntax error). Split it into variables.
- `let x = 0` without a type becomes **num**; use `x := 0` or `let x: int = 0`. Integer literals
  above 2^53 become float: build them with `<<`.
- Variables are function-scoped (not block-scoped): don't declare the same name with different
  types.
- A function that calls `ast.fail`/`rt_fail` and has a result still needs a `return` after it.
- Functions `__load8`, `__store64`, `__syscall` etc. only exist in the runtime (`rt/`), with
  `typecheck(..., intrinsics)`.
  The standard library (`std/`) can use them too (`privileged` calls). For `std/json` there are
  reflection intrinsics: `__anyp(any) -> int` (the [descriptor, value] box of an any) and
  `__pany(int) -> any` (the reverse), plus `__alloc`, `__zero(desc)`, `__make_slice(ed, n, c)`,
  `__map_new(kk)`, `__map_set(m, k, v)`, which call the runtime routines. The descriptor layout is
  in `rt/values.caju`; changed the layout? Update `lib/json.caju` too.
- `std/http` is an event loop (epoll, `net.Poller`) with keep-alive and pipelining; handlers run
  one at a time. `listen_and_serve_workers` forks n processes with `SO_REUSEPORT` (no shared
  memory; children die with the parent via `PR_SET_PDEATHSIG`). Each connection's buffers are raw
  memory (`Client.inb`/`outb`, `int` fields): they only stay alive because the collector is
  conservative and the `Client` holds them. `lib/http_test.caju` starts
  `testdata/http_server.caju` for real.
- No live pointer may sit only in a register during a call (the collector only looks at the
  stack and the globals).
- Array/slice objects are allocated with 8 extra bytes; strings and byte buffers with
  `rt_alloc_ns` (no pointers).
- Changed the data format (element size, list header...)? The previous compiler can't compile the
  new one (it generates the old format and links the new runtime: stage 2 crashes). Start the
  chain from the JS (`node bootstrap/caju.js build -o build/s1 ...`), which uses the frozen
  runtime.
- Lists and arrays of `bool` use 1 byte per element (`byte_elems`, `rt_esize`); everything else, 8.
- Allocator (`rt/gc.caju`): no free lists. Each "key" (class × 2 + no-pointers) has its own pages
  and a run [next, end, size] in `rt_krun`; `rt_alloc`/`rt_alloc_ns` only bump the run pointer,
  `rt_alloc_slow`/`rt_next_run` reserve the next run of free positions ("in use" bits + zeroing).
  Collection starts with `rt_drop_runs` (gives back the rest of the runs) and the sweep only does
  "in use &= marked". The "no pointers" bit belongs to the page (`rt_pg_flag` & 2). A new map is
  a 168-byte block (header, 4 entries, index of 8).
- Maps (`rt/values.caju`): entries in insertion order + an index of 32-bit slots (tag | position
  + 1), at most 3/4 full (a smaller index fits better in cache: worth more than short probes).
  Integer key: `rt_map_fi`/`rt_map_get`/`rt_map_slot`; string: `rt_map_fs` (`rt_str_hash`, 8
  bytes per step). String `==`/`!=` call `rt_streq`.
- Touched the collector? Run the suite with a collection every 64 KB (replace `8 << 20` with
  `1 << 16` in `rt/gc.caju`, two places) and undo it afterwards.

## Decisions already made (don't reopen unless the owner asks)

- Integers are true 64-bit in native code (the old JS VM differed above 2^53).
- Targets: Linux x86-64 (ELF) and Windows x64 (PE).
- The HTML page and the Rust runtime were removed from the repository.
- The generator emits code straight from the annotated tree (no IR, no register allocation).
  Correctness first, speed later.
