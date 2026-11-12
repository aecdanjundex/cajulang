# Caju native compiler: how it is built (phases 1 to 5)

Technical reference for whoever continues the work. The code lives in `bootstrap/native.js` (the
compiler, in JavaScript) and in
`rt/*.caju` (the runtime, written in Caju and compiled together with each program).

## Overview

```
compileNative(files, { target: "linux" | "windows" })  →  Uint8Array (ELF or PE)
```

1. The user's program goes through `link(files)` and `compile(ast)` (the bytecode compiler), so
   all type/compile errors are the same as in the VM, and the tree comes out **annotated** by the
   checker (`n.ty`, `n.ik`, `callKind`, `convMode`, `celled`, `captures`, ...).
2. The runtime: `NATIVE_RT.comum + gc + valores + dinamico + panico + (linux | windows)` becomes a
   single file, then `link` + `typecheck(ast, { intrinsics: true })`.
3. Two "units": `r` (runtime) and `u` (user). Symbols: functions `r.f.nome` / `u.f.nome`,
   globals `r.g.nome` / `u.g.nome`, top-level code `r.top` / `u.top`, closures `u.l.N`,
   fixed closures of named functions `u.c.nome`, bound-method "thunks" `u.t.Tipo.metodo`,
   descriptors `desc.N`, method tables `mt.N`, strings `str.N`.
4. Generates code **directly from the tree** (no IR), with its own x86-64 assembler (`class X64`),
   and writes ELF (base 0x400000, code at offset 0x1000) or PE32+ (ImageBase 0x140000000, no
   relocations, 2 sections, 64 MB stack, static import of the DLLs used by `extern`).

Entry point (`start`): on Linux, saves RSP in `g.argp`; aligns the stack; `call r.top` (runtime
globals); stores `rt_stack_top`, `rt_data_lo/hi` (for the collector); `rt_init`; stores the
descriptors the runtime uses (`rt_d_int`, `rt_d_num`, `rt_d_bool`, `rt_d_str`, `rt_d_any`,
`rt_d_err`); `call u.top`; `rt_exit(0)`.

## Calling convention and frames

- Every value fits in 64 bits, and each expression leaves its result in **RAX**. Floats travel as
  bits in RAX and move to XMM0/XMM1 only for the arithmetic.
- Arguments are pushed left to right; the caller pops them. Parameter i (of n) is at
  `[rbp + 16 + 8*(n-1-i)]`. Locals are at `[rbp - 8k]`. The frame size is patched at the end
  (`frameAt`).
- **Multiple results:** the 1st in RAX, the others in `g.ret + 8*i` (globals); the caller copies
  them into hidden slots right after the call (`unpackCall`).
- **Closure** = pointer to `[code, cell1, cell2, ...]`. Calling a function value: push the
  closure object **before** the arguments, call `[obj]`, pop n+1. The closure reads its cells from
  `[rbp + 16 + 8*nparams]`. Named functions ignore this extra argument, so they work as a
  "fixed" closure (`u.c.nome` in data = `[u.f.nome]`).
- Call depth is tracked in `r.g.rt_depth` (inc/dec around each user call); past 10,000 →
  "Recursão demais: mais de 10.000 chamadas de função abertas ao mesmo tempo".
- `extern` on Windows: one thunk per function converts to the Win64 convention (RCX, RDX, R8, R9,
  XMM0-3, 32 bytes of shadow space, aligned stack) and calls `[iat.dll.símbolo]`.
- Hidden slots (`hidden()`): a slot in the frame, or a data symbol in top-level code.
- Celled variables (captured by a closure or with their address taken with `&`): the slot holds
  the cell pointer; `loadV`/`storeV` dereference it. A `for i := ...` loop with a captured variable
  gets a new cell on each iteration (like Go 1.22 and the VM: `REBOX`).

## Value representation (one 8-byte word each)

| Type | In the word |
|---|---|
| int, int8..int64, uint..., bool | the integer (smaller ones wrap around: `wrapKind`) |
| num, float32 | the double's bits (float32 rounded with cvtsd2ss/cvtss2sd) |
| str | pointer to `[length:8][UTF-8 bytes][0]` (immutable; literals in data) |
| []T | 0 (nil) or pointer to the header `[data, length, capacity]` |
| [N]T and struct | pointer to an object with N words (array) / one word per field |
| *Struct, *[N]T | the object itself (same pointer as the value) |
| *T (others) | address of a word (cell, global, field, element) |
| map[K]V | 0 or pointer to the runtime table (insertion order + open-addressed index) |
| fn(...) | 0 or pointer to the closure |
| any, interface, error | 0 (nil) or pointer to the box `[descriptor, value]` |

Copying works as in the VM (`bindValue`): structs/arrays are copied on assignment/pass/return when
the expression is not "new" (`fresh`: variables, fields, indexes, derefs and x.(T) are not new);
assigning over an existing struct uses `rt_copy_into` (pointers to it stay valid).

### Type descriptor (8 words, in data, one per canonical type)

`[0] kind, [8] n (fields/elements), [16] element (or map value), [24] key, [32] name (string),
[40] field table ([name, descriptor, is-value?] × n), [48] integer code (KIND_CODE),
[56] method table (struct, *struct, error) or list of method names (interface)`.
Kinds: 1 int, 2 uint, 3 num, 4 bool, 5 str, 6 slice, 7 array, 8 struct, 9 pointer, 10 map,
11 any, 12 interface, 13 errors.New error, 14 function, 15 other.
Words holding addresses are "data relocations" (`dataRelocs`), resolved when the file is written.

Method table: `[n]` followed by n 48-byte entries `[name, code, path, copy-descriptor,
by-value?, result-descriptor]`. `path` = `[n, field index...]` through the embedded fields down to
the receiver. Interface call: `rt_method` finds the entry by comparing the name **pointer** (equal
strings are the same literal), `rt_method_recv` follows the path and copies if by value, and the
code calls `[entry+8]`. In an `any`, the result is boxed with the result descriptor.

### any and the VM rules

The VM stores JS numbers: a "raw" integer is `int`, a number with a fractional part is `num`, and
int8/uint/integral-num/*struct go in a box. The native compiler reproduces this through the box
descriptor:
- arithmetic on `any` (`rt_dyn_op`): done in double; an integral result (fitting in int64) becomes
  `int`, otherwise `num`; `+` with a string concatenates the `fmt` of both; errors use the VM's
  messages;
- truthiness (`rt_truthy`): only `int` (descriptor `rt_d_int`), `bool` and `str` are evaluated;
  any other box (num, int8, uint...) counts as true, like the VM's box;
- `==` (`rt_dyn_eq`): same descriptor and same value; `*struct` compares field by field (like the VM);
- prebuilt boxes for integers from -128 to 1023 and for true/false (`rt_box_int`, `rt_box_bool`);
- `any` flowing into a concrete type (gradual typing) goes through `rt_unbox`; the VM does not
  check, the native compiler raises an error if the type does not match (the only intentional
  difference);
- `x.(T)` (`rt_assert`) and the type switch (`rt_type_is`) use the descriptor; the error message
  is the VM's (`x.(T): o valor guardado é U, não T`).

## Runtime in Caju (`rt/`)

| File | Contents |
|---|---|
| comum.caju | init, strings (concat, comparison), number formatting (12 digits, like JS), bignums, pow/log/exp, buffered output, `rt_fatal`, sleep |
| gc.caju | allocator (16 GB reserved arena, 64 KB pages, 40 classes from 16 to 16384 bytes, larger objects in whole pages) and the collector |
| valores.caju | zero/copy/equality by descriptor, slices, append, sub-slices, UTF-8, string↔bytes↔runes conversions, maps, `rt_fmt` (printing of composite values) |
| dinamico.caju | boxes, arithmetic on any, `x.(T)`, methods by name, `rt_unbox` |
| panico.caju | defer, panic, recover, `rt_fail` (runtime error = panic) |
| linux.caju / windows.caju | write, memory (`rt_os_mem`, `rt_os_reserve`, `rt_os_commit`), sleep, exit |

### Collector (phase 4)

Mark and sweep, non-moving, **conservative** everywhere: any word on the stack (from `__sp()` to
`rt_stack_top`), in the globals (`g.data_lo`..`g.data_hi`, which includes `g.ret` and the
top-level hidden slots) or inside an object that points **into** a live object keeps it alive.
Small page: 2 KB header with mark bits (+0), in-use bits (+512) and no-pointers bits (+1024);
objects start at +2048. Large page: `rt_pg_kind` 2/3, mark in `rt_pg_flag`. A collection runs when
the amount allocated since the last one exceeds what survived it (minimum 8 MB).
Invariants: see "Cuidados" in CLAUDE.md (nothing live only in a register; +8 bytes on arrays;
strings via `rt_alloc_ns`). The stress test is running the suite with the minimum set to 64 KB.

### defer, panic, recover (phase 5)

A function with `defer` has a 6-word record in its frame:
`[0] previous, [8] defer list, [16] RBP, [24] "recovered" address, [32] rt_depth, [40] free`,
linked into `rt_dtop`. Each `defer` creates the node `[next, closure, n, arguments...]` (function
and arguments are evaluated immediately; a builtin call becomes a wrapper function; an interface
method is resolved immediately). `rt.calldefer` (generated assembly) calls the node.
- Normal return: the result is saved, `rt_run_defers` runs the list, and named results are
  reloaded (the defer may change them).
- `panic(v)` / runtime error (`rt_fail`): `rt_panic` runs the defers of the records from newest to
  oldest, with `rt_depth` = that function's depth. `recover()` only works if
  `rt_depth == rt_pdepth` (called directly by the deferred function, as in the VM). Recovered:
  `__jump(rbp, recovered)`; the "recovered" code restores RSP, relinks `rt_dtop`, restores the
  depth, zeroes the unnamed results and falls through to the normal return (which runs the
  remaining defers). Nobody recovered: `rt_fatal` with the message of the last panic.
- The value of a runtime error = an error box with the message; `panic(v)` prints `panic: <fmt(v)>`.

## Phase 6: goroutines and channels (next)

Read in the page (`web/caju.html`, search for `async function runVM`): `newG`, `schedule`, `runq`,
`sleepers`, `GO_SLICE = 2000`, and the cases `CHAN_SEND`, `CHAN_RECV`, `CHAN_CLOSE`, `SELECT`, `GO`.
The VM is **deterministic**: FIFO ready queue, switches every 2000 bytecode instructions, virtual
clock for `sleep` (with `skipSleep` it does not actually wait; the order still follows the
clock), deadlock = nothing ready and nothing sleeping → "Todas as goroutines estão bloqueadas,
esperando umas pelas outras (deadlock)" at the line where main stopped. Channels have a buffer, a
send queue and a receive queue; `select` with `default`; sending on a closed channel is an error in
the waiting goroutine ("Envio num canal fechado").

Suggested design (from the plan): each goroutine with its own stack (reserve 1 MB, like the
collector's arena), stack switching by a piece of generated assembly (save RSP/RBP, load the next
one's), switch points at loop back-edges and calls (a counter; the plan accepts that the switch
points will not be the same as the VM's, so programs that depend on preemption, such as
`runtime/tests/go/o_preempt.caju`, are left out of the comparison). For the collector: scan the
stacks of **all** goroutines (from each one's saved RSP to its top). For panic: `rt_dtop` and the
depth become per-goroutine; an unrecovered panic in a goroutine ends the program.
`sleep` goes through the scheduler (virtual clock when `CAJU_SKIP_SLEEP=1`, which the tests use).
Target tests: the "Go: goroutines e canais" example, `runtime/tests/go/f_go`, `i_deadlock`,
`j_fechado`, `k_workers`.

## Phases 7 to 9

- **7 Windows:** `alloc/free/peek*/poke*/readstr/readwstr` (the VM simulates memory; the native
  compiler uses real memory, but the error messages for null/invalid pointers should stay the same
  where possible), full `extern` (cdecl, wstr, ptr), `dllexport` and generating a native DLL
  (export directory: the page already has this code for the Rust runtime). Tests:
  `build/ffi-test.js` (adapt it for native), the "Windows: ..." and "DLL: calculadora" examples under Wine.
- **8 In the page:** a "Nativo (x64)" option in the "Gerar .exe / .dll" dialog (search for
  `buildExe` and the UI), version resources/signing (the page already signs the Rust runtime's
  .exe files), and the speed comparison. Goal: all 135 cases of `build/parity.js` passing natively.
- **9 Compiler in Caju:** rewrite the lexer, parser, checker, code generator and assembler in Caju;
  stage 2 and stage 3 identical byte for byte.

## Reference numbers (Linux, end of phase 5)

| Program | Rust runtime | Native |
|---|---|---|
| Benchmark | ~140 ms | ~8 ms (18x) |
| untyped fib(26) | ~70 ms | ~18 ms (4x) |
| 1 million appends + map | ~580 ms | ~210 ms (2.7x) |
| tests/gc3m.caju (3 million objects) | — | 18 MB peak memory |
