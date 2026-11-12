# Caju native compiler: plan

Copy of the planning document (Claude Doc "Compilador nativo da Caju: plano"), with progress up to
phase 5. Where the implementation decided differently from the original plan,
`docs/native-architecture.md` is authoritative (marked here as "decided in phase N").

## Goal and scope

The native compiler turns a Caju project directly into x86-64 machine code, with no VM in
between. The runtime (allocator, garbage collector, goroutines, maps, print, panic) is written in
Caju itself, with a minimal assembly core. The bytecode VM keeps running in the page, and the Rust
runtime keeps serving the x86 .exe and acting as the reference in the tests.

In scope:
- x64 programs and DLLs for Windows (PE), and x86-64 ELF executables for Linux, used only in tests;
- the whole language the VM runs: types, structs, interfaces, slices, maps, closures, defer/panic,
  pointers, goroutines, channels, extern and dllexport;
- a runtime in Caju, with assembly only for the program entry point, stack switching between
  goroutines and calling Windows functions through pointers.

Out of scope for now: 32-bit x86 (stays on the VM); the tree interpreter; heavy optimizations
(inlining, global register allocation), which come after everything is correct.

Performance goal: the Benchmark example at least 10 times faster than on the Rust runtime
(currently: ~18 to 22 times).

## Architecture

The existing front end (lexer, parser, linker and type checker) feeds a new path that ends in an
.exe, alongside the bytecode path. The Caju runtime goes through the same front end and is
compiled together with each program. In phases 1 to 8 the new parts are written in JavaScript
inside the page; in phase 9 they move to Caju.

## Value representation

Original plan: the same layout as Go (fields inline, 24-byte slices, 16-byte interfaces).
**Decided in phases 1 to 3:** every value takes one 8-byte word; a string is a pointer to
`[length][bytes][0]`; structs and arrays are heap objects (one word per field) and `*T` points to
the object itself; a slice is a pointer to `[data, length, capacity]`; any/interface is 0 or a
pointer to a box `[descriptor, value]`. Captured variables and variables with `&x` live in a cell.

## Code generation

Plan: three-address intermediate representation, register allocation (linear scan), an internal
convention with results on the stack, 1 MB goroutine stacks with a check in the prologue, switch
points at loop back-edges and calls, checks (index, nil, division) that jump to the runtime, our
own assembler, PE with version resources and signing, ELF for tests.
**Decided in phase 1:** no IR for now (code straight from the annotated tree), result in RAX,
extra results in `g.ret`; the IR comes together with the register allocator.

## Runtime in Caju

Plan: files os, mem, gc, sched, chan, map, str, fmt, iface, panic, asm. **What it became:** comum,
gc, valores, dinamico, panico, linux, windows (sched/chan come in phase 6). Runtime files may use
low-level operations (`__load64`, `__store64`, `__syscall`...), which are forbidden outside it.

## Language changes

1. Exact 64-bit integers in native code (the VM is exact only up to 2^53; accepted difference).
2. Low-level operations only in the runtime files (done as `__nome` functions, not `unsafe`).
3. Compiler annotations (`//caju:nogc` etc.): not needed yet.

Gradual typing stays: an untyped parameter becomes `any` and works, just slower.

## Phases and deliverables

1. **Foundation.** Assembler, PE/ELF, numbers, booleans, functions, if/while/for/switch, print.
   Done when the "Primeiros passos" group produces the same output. — **done**
2. **Memory.** Strings, slices, arrays, structs, pointers, maps; runtime errors with the line.
   Done when the Go examples for slices, maps and pointers produce the same output. — **done**
3. **Dynamic types and functions as values.** any, interfaces, x.(T), type switches,
   closures, multiple results, error, methods and embedding. — **done**
4. **Garbage collector.** Mark and sweep, size classes. Done when the 3-million-object test runs
   with limited memory (18 MB). — **done**
5. **defer, panic and recover.** Done when the errors, defer and panic example produces the same
   output. — **done**
6. **Goroutines and channels.** Scheduler, channels, select, sleep, deadlock. Done when the
   goroutines example and the channel tests produce the same output (programs with data races are
   left out).
7. **Windows.** extern with the x64 convention, alloc/peek/poke, dllexport and the DLL. Done when
   the FFI test and the calculator example run under Wine.
8. **In the page.** "Nativo (x64)" option in Gerar .exe / .dll, speed comparison, updated
   reference. Done when the 135 parity cases pass natively.
9. **Compiler in Caju.** Done when the compiler, compiled by itself, again produces a byte-for-byte
   identical file.

## Tests

Every example and every program in `runtime/tests/go` runs on the VM and natively, and the outputs
must be identical. Linux first (fast); Wine at the end of each phase. Programs with data races are
left out of the comparison. Stress: collector with millions of objects (and the suite with a
collection every 64 KB), deep recursion, thousands of goroutines, maps with many deletions.
Phase 9: compiler stages 2 and 3 identical byte for byte.

## Decisions (made with the project owner)

| Decision | Choice |
|---|---|
| Integers above 2^53 | accept the difference between VM and native, and document it |
| Native targets | Windows x64 only (+ ELF for tests); x86 stays on the VM |
| Compiler in Caju (phase 9) | a goal, once phase 8 is stable |
| Rust runtime | keep it: it serves x86 and is the test reference |

## Risks

- Conservative collector: a number that looks like a pointer keeps an object alive (wastes memory, never wrong).
- panic/recover: the most delicate part (done in phase 5, with tests of panic inside defer).
- Number formatting: exactly 12 digits like the VM (done in phase 1, with integer arithmetic).
- Untyped code gains little (every operation goes through the runtime; ~4x faster than Rust).
- Programs that depend on the exact preemption order between goroutines will differ from the VM.
