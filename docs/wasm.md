# Caju on WebAssembly

`caju build --target wasm -o programa.wasm programa.caju` produces a WebAssembly module with the
same program and the same runtime as the native target. The compiler itself compiles to wasm
(`caju.wasm`) and, inside a browser or Node, compiles programs to wasm: that is what the site's
playground uses.

## Files

| File | What it is |
|---|---|
| `compiler/wasm.caju` | the generator: from the annotated tree to wasm (same semantics as `native.caju`) |
| `compiler/wasmenc.caju` | the binary format encoder (types, functions, table, memory, data, tags) |
| `rt/wasm.caju` | the system part of the runtime (like `rt/linux.caju`), through host system calls |
| `tools/wasm/caju-host.mjs` | the host: emulates Linux system calls on top of a files object |
| `tools/wasm/run.mjs` | runs a `.wasm` in Node with the real files (`node tools/wasm/run.mjs p.wasm args`) |
| `tools/wasm/caju-browser.mjs` | `loadCaju()`: `compile(source)` and `run(wasm)`, with in-memory files (`MemFS`) |
| `tools/wasm/package.sh` | assembles `dist/caju-wasm.tar.gz` (ships in the release; the site downloads it at build time) |
| `tools/wasm/caju-wasm.sh` | the `caju run` for test subprograms under `caju test --target wasm` |

## The model (the same as native, so the runtime does not change)

- Every value is an i64; floats travel as bits. Pointers are addresses in linear memory.
- Arguments, variables and every temporary that must survive a call live on a stack **in memory**
  (global `$sp`), never only on the wasm stack: the collector scans this stack from `$sp` to
  `rt_stack_top`, just as it scans the machine stack on native. The native generator's `push`/`pop`
  become writes and reads on this stack.
- Every function is `() -> i64`. To call: push (the closure and) the arguments, `call`, pop. Parameter
  i of n is at `$fp + 8*(n-1-i)`; variables at `$fb + offset` (the frame size is patched at the end
  of the function). Closures and method tables store the **table index** as the "code address"
  (`call_indirect`).
- Results 2, 3... go in `g.ret`; the second value of `v, ok := m[k]` and `x.(T)` in the global `$aux`.
- `defer`/`recover`: the 6-word record is the same; `[16]` holds `$fp`. `__jump` becomes
  `throw $jump($fp)`; a function with `defer` runs its body inside a `try` and, when it catches a
  `$jump` with its own `$fp`, takes the "recovered" path and runs the remaining `defer`s (legacy wasm
  exceptions: `try`/`catch`/`rethrow`, which Node 22 and current browsers accept).
- Depth: the global `$depth` plays the role of R15.

Memory: `[1024, 64 KB)` arguments and environment (the host writes them before `_start`), data from
64 KB on, a 16 MB stack, a 48 MB reserve for the runtime's `mmap` and the collector's arena (2 GB of
address space; the host grows the memory when the collector asks for pages).

## Call depth

Each Caju call is also a frame on the JavaScript engine's stack. In Node, `run.mjs` runs the program
in a thread with a 256 MB stack, and the limit of 10,000 nested calls applies just as on native. In a
browser the stack is fixed: a Chrome worker fits about 6,300 calls; beyond that, the program ends
with "too much recursion for this browser's stack" (the host converts the `RangeError`). That is why
functions use few wasm locals (4 fixed ones).

## The host

`caju.syscall(n, a1..a6)` takes Linux numbers: read, write, open, close, stat, fstat, lstat,
lseek, mmap (reserve/arena), mprotect (grow memory), nanosleep, access, getcwd, rename,
mkdir, rmdir, unlink, symlink, readlink, chmod, getdents64, clock_gettime, getrandom, exit. The
rest return ENOSYS (sockets, fork). `1000` belongs to the host: it runs a program and returns its
output (`os.run` tries this call before fork; Linux answers ENOSYS). `caju.fmod` is JavaScript's `%`
(the exact float remainder).

## Checking

```sh
build/caju build --target wasm -o /tmp/p.wasm programa.caju && node tools/wasm/run.mjs /tmp/p.wasm
build/caju test --target wasm tests/lang lib examples    # same suite, programs in wasm
CAJU=build/caju tools/wasm/package.sh                    # the wasm compiler compiles itself
                                                         # byte for byte, plus the browser test
```

Today: the language, library and example tests pass on wasm, except `net` and `http` (no sockets).
Goroutines and `alloc`/`peek`/`poke` are missing, as on native.
