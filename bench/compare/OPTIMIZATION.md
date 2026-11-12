# Optimizing the native code generator

A log of the optimization rounds of the compiler (`compiler/native.caju`, `compiler/x64.caju`) and
the runtime (`rt/`). Each round: a hypothesis drawn from reading the generated machine code, the
change, the tests (`caju test`, 518 passing) and self-compilation (stage 2 == stage 3), and the
measurement with `bench/compare/run.py --langs=caju`.

**Where things are**

- `rounds/roundN.json`: the 21 measurements (7 challenges × 3 sizes) of each round.
- `rounds/table.py`: generates the full table below from the JSON files.
- `rounds/roundN-sieve.asm`: the machine code of the `work` function in `rounds/sieve_kernel.caju`
  (the sieve loop) in that round, to compare before and after (`tools/disasm.sh`).
- The code of each round is in the git history (one commit per round from round 4 on; rounds 1
  to 3 share one commit).

**Decision:** optimizations go only into the Caju compiler. The JavaScript compiler
(`bootstrap/`) keeps generating the old code and is used only to compile the first stage; the
byte-for-byte comparison between the two (`tools/compare-compilers.sh`) no longer applies.
Correctness is guaranteed by the test suite and by self-compilation.

## Summary (largest size of each challenge)

| round | change | fib 35 | sieve 10M | nbody 1M | mandelbrot 1k | matmul 300 | sort 2M | maps 3M |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| 0 | before: stack machine, every operand pushed and popped | 126 ms | 435 ms | 737 ms | 243 ms | 256 ms | 637 ms | 2.00 s |
| 1 | shorter encoding (disp8, imm8) | 125 ms | 424 ms | 735 ms | 243 ms | 253 ms | 626 ms | 2.02 s |
| 2 | simple right operand straight into RCX; conditions become cmp + jcc; &&, \|\|, ! become branches | 94 ms | 370 ms | 725 ms | 251 ms | 209 ms | 484 ms | 1.65 s |
| 3 | a[i] with a simple index and the load in a single mov; single assignment without temporaries; constants as immediates; int tests without normalizing to 0/1 | 92 ms | 317 ms | 576 ms | 237 ms | 212 ms | 390 ms | 1.60 s |
| 4 | num expressions evaluated in XMM registers; num comparisons become ucomisd + jcc | 91 ms | 320 ms | 532 ms | 127 ms | 214 ms | 397 ms | 1.60 s |
| 5 | call depth in register R15 instead of a global in memory | 65 ms | 304 ms | 516 ms | 128 ms | 213 ms | 394 ms | 1.53 s |
| 6 | most-used int, bool and num local variables in RBX, R12, R13, R14 | 66 ms | 218 ms | 449 ms | 125 ms | 210 ms | 287 ms | 1.28 s |
| 7 | top-level variables that no function uses become locals (and can go into registers) | 66 ms | 185 ms | 438 ms | 92 ms | 202 ms | 280 ms | 1.33 s |
| 8 | a[i] op= v directly; call-free compound side computed first (no push/pop) | 65 ms | 185 ms | 435 ms | 93 ms | 133 ms | 283 ms | 1.21 s |
| 9 | inlining of small `return E` functions; `__sqrt` becomes sqrtsd in a register | 66 ms | 187 ms | 427 ms | 94 ms | 136 ms | 287 ms | 1.26 s |
| 10 | maps: call-free integer-key path; `m[k]` read in a single call | 69 ms | 188 ms | 419 ms | 94 ms | 145 ms | 284 ms | 966 ms |
| 11 | lists in loops: length and data read once; `a[i]` unchecked in `for i := 0; i < len(a); i++` | 64 ms | 144 ms | 425 ms | 90 ms | 108 ms | 234 ms | 833 ms |
| 12 | `[]bool` and `[N]bool` with 1 byte per element | 64 ms | 70 ms | 396 ms | 90 ms | 107 ms | 229 ms | 852 ms |
| 13–16 | maps with tags; global lists in loops; operations directly on registers; `num` in XMM; RSI/RDI/R8–R11 | 62 ms | 29 ms | 175 ms | 37 ms | 35 ms | 184 ms | 605 ms |
| 17–18 | loops with the test at the end, cold code, short branches; division and remainder by a constant without `idiv` | 57 ms | 21 ms | 175 ms | 37 ms | 33 ms | 164 ms | 607 ms |
| 19 | guard before the prologue; `leave`; depth counting down | 41 ms | 21 ms | 175 ms | 37 ms | 33 ms | 164 ms | 607 ms |
| 20–25 | recursion with an accumulator; bounds hoisted out of constant loops; arguments in registers; versioned and vectorized loops; already-checked indexes; maps with `op=` in a single probe | 26 ms | 22 ms | 65 ms | 40 ms | 14 ms | 140 ms | 632 ms |

**Total gain (round 0 → 10), largest size:** fib 1.8×, sieve 2.3×, nbody 1.8×, mandelbrot 2.6×,
matmul 1.8×, sort 2.2×, maps 2.1×.

**Against the other languages** (same machine, `RESULTS.md`, largest size, after round 25;
maps 3M remeasured interleaved, because the RESULTS.md run caught a fluctuation in the machine):

| challenge | Caju before | Caju after | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust |
|---|--:|--:|--:|--:|--:|--:|--:|
| fib 35 | 126 ms | 26 ms | 40 ms | 21 ms | 1.22 s | 0.7× | 1.3× |
| sieve 10M | 435 ms | 22 ms | 20 ms | 21 ms | 2.12 s | 1.1× | 1.0× |
| nbody 1M | 737 ms | 65 ms | 173 ms | 66 ms | 9.78 s | 0.4× | 1.0× |
| mandelbrot 1k | 243 ms | 40 ms | 38 ms | 38 ms | 6.30 s | 1.1× | 1.1× |
| matmul 300 | 256 ms | 14 ms | 32 ms | 11 ms | 6.10 s | 0.4× | 1.2× |
| sort 2M | 637 ms | 140 ms | 140 ms | 135 ms | 7.34 s | 1.0× | 1.0× |
| maps 1M | — | 111 ms | 182 ms | 104 ms | 607 ms | 0.6× | 1.1× |
| maps 3M | 2.00 s | 632 ms | 607 ms | 334 ms | 1.91 s | 1.0× | 1.9× |

Against Python, Caju went from 3 to 25 times faster to 2 to 70 times faster (and on maps, from a
tie to 2× faster). Times have a few percent of noise between runs (matmul varied from 133 to
145 ms with no change to its code).

## All measurements

<!-- python3 bench/compare/rounds/table.py -->
| challenge | n | round 0 | round 1 | round 2 | round 3 | round 4 | round 5 | round 6 | round 7 | round 8 | round 9 | round 10 | round 11 | round 12 | round 16 | round 18 | total gain |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | — | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 1 ms | 1.71× |
| fib | 30 | 13 ms | 13 ms | — | 10 ms | 9 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 6 ms | 2.08× |
| fib | 35 | 126 ms | 125 ms | 94 ms | 92 ms | 91 ms | 65 ms | 66 ms | 66 ms | 65 ms | 66 ms | 69 ms | 64 ms | 64 ms | 62 ms | 57 ms | 2.21× |
| sieve | 100,000 | 6 ms | 5 ms | — | 4 ms | 4 ms | 4 ms | 3 ms | 3 ms | 3 ms | 3 ms | 3 ms | 2 ms | 2 ms | 1 ms | 1 ms | 4.65× |
| sieve | 1,000,000 | 40 ms | 41 ms | — | 28 ms | 29 ms | 27 ms | 18 ms | 16 ms | 16 ms | 16 ms | 17 ms | 11 ms | 7 ms | 4 ms | 3 ms | 13.77× |
| sieve | 10,000,000 | 435 ms | 424 ms | 370 ms | 317 ms | 320 ms | 304 ms | 218 ms | 185 ms | 185 ms | 187 ms | 188 ms | 144 ms | 70 ms | 29 ms | 21 ms | 20.83× |
| nbody | 10,000 | 9 ms | 9 ms | — | 7 ms | 7 ms | 7 ms | 6 ms | 6 ms | 6 ms | 6 ms | 6 ms | 5 ms | 5 ms | 3 ms | 3 ms | 3.09× |
| nbody | 100,000 | 75 ms | 76 ms | — | 59 ms | 55 ms | 53 ms | 46 ms | 45 ms | 44 ms | 43 ms | 44 ms | 44 ms | 41 ms | 19 ms | 18 ms | 4.08× |
| nbody | 1,000,000 | 737 ms | 735 ms | 725 ms | 576 ms | 532 ms | 516 ms | 449 ms | 438 ms | 435 ms | 427 ms | 419 ms | 425 ms | 396 ms | 175 ms | 175 ms | 4.21× |
| mandelbrot | 250 | 17 ms | 17 ms | — | 17 ms | 9 ms | 10 ms | 9 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 3 ms | 3 ms | 5.08× |
| mandelbrot | 500 | 62 ms | 62 ms | — | 61 ms | 33 ms | 33 ms | 33 ms | 24 ms | 25 ms | 25 ms | 25 ms | 24 ms | 23 ms | 10 ms | 10 ms | 6.05× |
| mandelbrot | 1,000 | 243 ms | 243 ms | 251 ms | 237 ms | 127 ms | 128 ms | 125 ms | 92 ms | 93 ms | 94 ms | 94 ms | 90 ms | 90 ms | 37 ms | 37 ms | 6.51× |
| matmul | 100 | 12 ms | 12 ms | — | 10 ms | 10 ms | 10 ms | 9 ms | 9 ms | 7 ms | 7 ms | 7 ms | 5 ms | 5 ms | 3 ms | 2 ms | 5.08× |
| matmul | 200 | 78 ms | 79 ms | — | 65 ms | 65 ms | 66 ms | 64 ms | 62 ms | 41 ms | 41 ms | 45 ms | 33 ms | 33 ms | 11 ms | 11 ms | 7.34× |
| matmul | 300 | 256 ms | 253 ms | 209 ms | 212 ms | 214 ms | 213 ms | 210 ms | 202 ms | 133 ms | 136 ms | 145 ms | 108 ms | 107 ms | 35 ms | 33 ms | 7.75× |
| sort | 100,000 | 28 ms | 28 ms | — | 18 ms | 18 ms | 18 ms | 14 ms | 13 ms | 14 ms | 14 ms | 13 ms | 11 ms | 11 ms | 9 ms | 8 ms | 3.48× |
| sort | 500,000 | 151 ms | 148 ms | — | 92 ms | 96 ms | 94 ms | 68 ms | 67 ms | 67 ms | 69 ms | 68 ms | 56 ms | 54 ms | 44 ms | 40 ms | 3.81× |
| sort | 2,000,000 | 637 ms | 626 ms | 484 ms | 390 ms | 397 ms | 394 ms | 287 ms | 280 ms | 283 ms | 287 ms | 284 ms | 234 ms | 229 ms | 184 ms | 164 ms | 3.88× |
| maps | 100,000 | 35 ms | 35 ms | — | 25 ms | 24 ms | 24 ms | 16 ms | 16 ms | 13 ms | 13 ms | 11 ms | 10 ms | 10 ms | 10 ms | 10 ms | 3.61× |
| maps | 1,000,000 | 561 ms | 538 ms | — | 438 ms | 405 ms | 374 ms | 300 ms | 332 ms | 317 ms | 334 ms | 253 ms | 176 ms | 191 ms | 115 ms | 115 ms | 4.89× |
| maps | 3,000,000 | 2.00 s | 2.02 s | 1.65 s | 1.60 s | 1.60 s | 1.53 s | 1.28 s | 1.33 s | 1.21 s | 1.26 s | 966 ms | 833 ms | 852 ms | 605 ms | 607 ms | 3.30× |

Round 1 was copied from the printed output; for round 2 only the largest sizes were recorded (its
code was not saved separately).

## Round 0: the starting point

The generator produces code straight from the tree, like a stack machine: every expression leaves
its result in RAX; an operation `a op b` computes `a`, pushes it, computes `b`, moves it to RCX,
pops and operates. A condition `i <= n` became:

```
mov rax,[rbp-0x18]   ; i
push rax
mov rax,[rbp+0x10]   ; n
mov rcx,rax
pop rax
cmp rax,rcx
setle al             ; 0/1
movzx eax,al
test rax,rax         ; convert to bool again
setne al
movzx eax,al
test rax,rax
je end
```

All variables live on the stack (`[rbp±x]`), always with a 32-bit displacement. See
`rounds/round0-sieve.asm` (134 instructions in the function).

## Round 1: shorter encoding

**Hypothesis:** smaller instructions (8-bit displacement in `[rbp-0x18]`, 8-bit immediate in
`add rsp, 24`) fit better in the instruction cache.
**Change:** `x64.rmx` and `alu_imm` pick the short form when it fits; the prologue's `sub rsp`
stays 32-bit because it is patched later (`sub_imm32`).
**Result:** code ~10% smaller, same time (within noise). The cost is not in the size of the
instructions but in their number.

## Round 2: simple operands and conditions as branches

**Hypothesis:** most right operands are a variable or a number; and every `if`/`while`/`for`
condition goes through two unnecessary "0/1" steps.
**Change:**
- `simple_to(n, reg)`: loads a number or a variable straight into any register;
  `operands(l, r)` uses it and only pushes when the right side is complex.
- `jump_if(cond, want, dest)`: integer comparison becomes `cmp` + `jcc` (the inverse condition is
  `cc ^ 1`); `!x` flips the sense; `a && b` and `a || b` become short-circuit branches.

`i <= n` is now `mov rax,[rbp-0x18]; mov rcx,[rbp+0x10]; cmp rax,rcx; jg end`.
**Result:** fib −25%, sieve −13%, matmul −17%, sort −23%, maps −18%. Floating point did not
change (operations on `num` still go through the stack).

## Round 3: indexes, assignments and constants

**Hypothesis:** in `a[i]` the list is pushed while the index is computed; `a[j] = true` stores the
address and the value in two hidden variables before writing; `count + 1` loads the 1 into a
register; `if !a[i]` normalizes the value to 0/1 before testing.
**Change:**
- `elem_check`: a simple index goes straight into RCX; the load is a single `mov rax,[rax+rcx*8]`.
- `single_assign`: `x = v` and `a[i] = v` without the temporaries of the general case (evaluation
  order is kept: index before value); a simple value goes straight to memory.
- `imm32`: `+ - & | ^` and comparisons with a constant of up to 32 bits use the immediate.
- In conditions, integers and booleans are tested directly with `test rax,rax`.

See `rounds/round3-sieve.asm` (84 instructions, down from 134).
**Result:** sieve −14%, nbody −21%, sort −19%, matmul unchanged, maps −3%.

## Round 4: floating point in XMM registers

**Hypothesis:** every operation on `num` took the path RAX → stack → RAX → XMM and back
(`push`, `pop`, two `movq`); mandelbrot and nbody are nothing but that. And `num` comparisons in
conditions still built a 0/1.
**Change:**
- `fexpr(n, d)` evaluates a `num` expression leaving the result in `xmm d`; the right operand goes
  to `xmm d+1` (`fpair`) and the operation is one instruction (`addsd xmm d, xmm d+1`).
- A function call clobbers all XMM registers, so a call can only appear in a subexpression
  evaluated when nothing is held in XMM (`d == 0`); the others must be `fpure` (no calls:
  numbers, variables, indexes, fields). If they are not, the left value goes to the stack only at
  that point. Expressions deeper than 14 registers also use the stack.
- `float_jump`: `a < b` in a condition becomes `ucomisd` + `jcc`, with NaN giving false in every
  comparison except `!=`, as before.
- `coerce` (int → num) and rounding to `float32` now use xmm15 as scratch: with xmm0 they
  clobbered the saved left operand (the bug showed up in 7 tests on the first attempt: `n > 0`
  with an untyped `n` was never true).
- New tests: `tests/lang/float_codegen_test.caju` (mixed integers, calls on the right side,
  expressions deeper than the registers, nested division by zero, NaN).

The mandelbrot kernel (`rounds/float_kernel.caju`) went from 110 to 69 instructions
(`rounds/round3-float.asm` → `rounds/round4-float.asm`).
**Result:** mandelbrot −46% (237 → 127 ms), nbody −8% (the rest is the call to `math.sqrt` for
each pair of bodies, which is still an ordinary function call).

## Round 5: call depth in a register

**Hypothesis:** the language limits recursion to 10,000 nested calls (the error message cites the
number, so the limit stays). Each call did `mov rax,[rt_depth]; cmp rax,10000; jl;
inc [rt_depth]; call; dec [rt_depth]`: two read-modify-writes to the same memory address per
call, a serial dependency from one call to the next.
**Change:**
- The depth lives in R15, which the generator never used and which the Linux and Windows calling
  conventions preserve (external code does not clobber it): `cmp r15,10000; jl ok; ...; inc r15;
  call; dec r15`. The program zeroes R15 on entry.
- The `defer` record saves R15, and returning from a `recover` restores it.
- The runtime (`rt/panic.caju`) reads and changes the depth through two new intrinsic functions,
  `__depth()` and `__set_depth(x)`.
- Since the JavaScript compiler does not know these functions, it now uses a frozen copy of the
  runtime (`bootstrap/rt/`); it only compiles the first stage.

`rounds/round4-fib.asm` → `rounds/round5-fib.asm`.
**Result:** fib −29% (91 → 65 ms); maps −4%, sieve −5% (they all call functions).

## Round 6: variables in registers

**Hypothesis:** after the previous rounds, the sieve loop is almost all `mov rax,[rbp-x]` and
`mov [rbp-x],rax`: the loop variables (`i`, `j`, `n`) go to and from memory on every use.
**Change:** simple per-function register allocation:
- Counts the uses of each local variable (weight 8 per loop level) and picks up to 4 with at
  least 4 uses, which go into RBX, R12, R13 and R14 (registers preserved by called functions,
  including external ones).
- Only variables that never hold a pointer (integers, bool, num): the garbage collector looks for
  pointers only on the stack, and a pointer living only in a register would be lost.
- Excluded: variables in cells (address taken with `&`), variables captured by anonymous
  functions, and all variables of functions with `defer`.
- The prologue saves the used registers in the frame and the exit restores them; chosen
  parameters are loaded into their register on entry.
- A recovered `panic` skips the frames that saved these registers; so a function with `defer`
  saves all 4 on entry and restores them at the recovery point.

`rounds/round4-sieve.asm` (84 instructions) → `rounds/round6-sieve.asm`.
**Result:** sieve −28%, sort −27%, maps −16% (the maps runtime is also compiled by this
generator), nbody −13%. matmul and mandelbrot did not change: the benchmark programs run their
loops at the top level of the file, where variables are globals (round 7).

## Round 7: top-level variables as locals

**Hypothesis:** in Caju it is common to write the program directly at the top level of the file
(the benchmark programs are like that). There every variable was a global: memory, and outside
the register allocation of round 6.
**Change:** a top-level variable only needs to be global if some function (named or anonymous)
uses it, or if its address is taken (`&x`). The others become locals of the top-level code
(`u.top`), which goes through the same register allocation. The top level of every file in the
program runs in the same `u.top`, so a module that uses another module's variable at the top level
still sees the same one.
- The first version forgot to look inside struct literals (`&Node{ik: NONE}`): a constant used
  only there became a local and the function could not find it. The compiler reported the error
  (`variable "NONE" not found`) in a test; the scan now visits all of a node's child lists.
- New tests: `tests/lang/top_level_test.caju` (use only in a struct literal, `&x`, anonymous
  function, named function that changes the variable, loop at the top level, garbage collector).

**Result:** mandelbrot −26% (125 → 92 ms), sieve −15%. matmul barely changed: its hot loop is
`c[i*n+j] += aik * b[k*n+j]`, and an indexed `+=` still goes through the general path (round 8).

## Round 8: `a[i] op= v` and operands without the stack

**Hypothesis:** the matmul loop, `c[i*n+j] += aik * b[k*n+j]`, went through the general path of
`op=` with a compound target (address and current value in hidden variables, a `·tmp` node).
**First change:** `index_op_assign`, a shortcut for `a[i] op= v` (list or array of integers, or
of `num` when `v` does not call functions): computes the address once, reads the current value
before evaluating `v` (the same order as the general path), operates with the same `int_op` (with
the division and shift checks) and writes. New tests in `tests/lang/index_assign_test.caju`.
**Result: nothing** (matmul 202 ms).

**Second hypothesis (from reading the generated code):** the cost was in the `push`/`pop`: in
`b[k*n+j]` the list was pushed while the compound index was computed, and in `aik * b[...]` `aik`
was pushed while the right side was computed.
**Second change:** when one side is simple (variable or number) and the other does not call
functions, the compound side is computed first and the simple one is then loaded straight into
the other register. This is safe because in Caju assignment is a statement, not an expression: a
call-free expression changes no variable, so the order does not affect the result.
**Result:** matmul −34% (202 → 133 ms), maps −9%.

## Round 9: inlining small functions

**Hypothesis:** in nbody, `math.sqrt(d2)` is an ordinary function call per pair of bodies
(`math.sqrt` is `return __sqrt(x)`), with the cost of a call and with the value leaving the XMM
registers.
**Change:** `try_inline` replaces a call to a function whose body is just `return E` (calling no
program functions, up to 40 nodes) with a copy of `E` in which the parameters are replaced by the
arguments. To keep the meaning: the arguments must not call functions, each argument's type must
match the parameter's, a parameter used more than once (or not at all) only accepts a simple
argument, and inlining is refused if a local variable of the caller has the name of a global used
in the body. `fexpr` understands inlined calls that return `num`, and `__sqrt` becomes `sqrtsd`
directly in the register.
- The first version inlined `fn helper() -> any { return recover() }`: `recover` only works in
  the deferred function itself, and inlining changed that (a `panic` test caught it). Intrinsic
  functions that depend on the call they are in (`recover`, `__depth`, `__sp`...) are excluded.
- New tests: `tests/lang/inline_test.caju`.

**Result:** nbody −2%: `sqrt` was not the main cost. What remains in nbody: each `x[i]` on a
global list reads the pointer from memory and checks nil and bounds; there are 8 `num` variables
for 4 registers; and there are still 156 `push` instructions in the `advance` function.

## Round 10: maps

**Hypothesis:** reading `m[k]` took two runtime calls (`rt_map_find` and `rt_map_val`), and each
probe of the lookup called `rt_hash` and `rt_keq`, even with an integer key.
**Change:**
- `rt_map_find` (runtime, `rt/values.caju`) has a path for integer keys with the hash and the
  comparison written in the loop itself, without calls; `rt_hash` tests for an integer key first.
- `rt_map_get` returns the value (or 0) and whether the key was found; the generated code makes a
  single call and only calls `rt_zero` when the type's zero value is not 0 (strings, structs).
- New tests: `tests/lang/map_values_test.caju` (zero values of each type, `v, ok`, negative and
  large keys, `0.0` and `-0.0`, 50 thousand keys, structs as values).

**Result:** maps −23% (1.26 s → 966 ms).

## Round 11: lists inside loops

**Hypothesis:** in `for i := 0; i < len(a); i++ { ... a[i] ... }`, each iteration called
`rt_slen` for `len(a)`, and each `a[i]` read the list header, checked nil, read the length,
compared and read the data pointer. But a list header never changes: `append` and `a[x:y]` create
a new header (`rt_hdr`). If the loop does not assign the variable, the length and data do not
change.
**Change:**
- `scan_loop` lists the variables that a loop (condition, step and body) indexes and the ones it
  assigns. Before a `while`, `for` or `range`, `enter_scache` stores the length and data pointer
  of each local list that the loop indexes and does not assign (excluded: lists in cells,
  captured, global or in a register) in two hidden variables on the stack (the collector sees the
  pointer there). Inside the loop, `len(a)` reads the hidden variable and `a[i]` does only
  `cmp rcx,[length]; jae slow; mov rax,[data]`; the slow path is the old one and gives the same
  error.
- `counted_loop`: in `for i := K; i < len(a); i++` with `K >= 0` and neither `i` nor `a` assigned
  in the condition or the body, `a[i]` is always in bounds and is not checked. `i` must be a local
  `int`, not in a cell and not captured (a `*p = 7` with `p := &i`, or an anonymous function that
  changes `i`, would change the index without the scan seeing it).
- `len`/`cap` of a list become two instructions (without calling `rt_slen`), and `range` reads the
  data once.
- The agent that wrote the first version measured the gain, but `counted_loop` was never
  triggered: the `0` in `i := 0` and the `1` in `i++` come without a type annotation (`imm32`
  took them for `num`), and the scan included the `i++` itself, so `i` always looked assigned.
  Fixed with `int_lit` and by scanning only the condition and the body; the generated code
  (`tools/disasm.sh`) was checked.
- New tests: `tests/lang/loop_lists_test.caju` (list assigned in the loop, `append` without
  assigning, nil list, index that is not the loop variable, `&i`, anonymous function that changes
  `i` or the list). The suite also passed with a collection every 64 KB.

The loop that sums a list (`for i := 0; i < len(a); i++ { s += a[i] }`) went from 26 instructions
plus one call to `rt_slen` per iteration to 17 instructions.
**Result** (baseline remeasured in the same session, best of 3 passes of 5 runs): matmul −21%
(136 → 108 ms), sieve −17% (173 → 144 ms), sort −13% (269 → 234 ms). nbody got 7% slower, but
the code of `advance` is identical instruction for instruction: only the function's address
changed (nbody uses global lists, which this round does not touch). It is a code alignment effect.

## Round 12: bool lists with 1 byte per element

**Hypothesis:** every list element took 8 bytes; the 10-million sieve scanned 80 MB (Go, 10 MB).
The cost is memory and cache, not instructions.
**Change:** lists and arrays of `bool` store 1 byte per element.
- Generator: `byte_elems(t)` says whether the list is of bool; a read is `movzx eax, byte [rax+rcx]`,
  the address is `lea rax, [rax+rcx]`; literals and `append` write bytes; `a[x:y]` passes the
  element size to the runtime (`rt_sub_slice`/`rt_sub_array` gained an argument).
- A `*bool` can point into a bool list (1 byte) or to a variable or field (8 bytes, whose upper
  bytes are always 0 in a bool): so every bool read or written through an address uses 1 byte
  (`load_at`/`store_at`).
- Runtime (`rt/values.caju`): `rt_esize`, `rt_eload`, `rt_estore`, `rt_ecopy`, `rt_edata`; the
  data block of a bool list comes from `rt_alloc_ns` (no pointers, already zeroed: all `false`).
  `make`, `append`, `copy`, comparison, array copies, zero values and printing know the size.
- `[]uint8` stays at 8 bytes (left for later: it appears in more places in the library).
- **Bootstrap:** since the data format changed, the previous compiler cannot compile this one (it
  generates 8-byte reads, and the new runtime allocates 1). The chain has to start from JS:
  `node bootstrap/caju.js build -o build/s1 ...`, then s1 → s2 → s3.
- New tests: `tests/lang/bool_lists_test.caju` (make, literals, indexes, pointers to elements,
  append, overlapping copy, slices that share memory, arrays in structs, comparison, printing).
  The suite also passed with a collection every 64 KB.

**Result:** sieve −52% (146 → 70 ms) and memory from 79 to 11 MB at the largest size; the rest
did not change (nbody went back to 396 ms: confirming that round 11's 7% was alignment).

## Rounds 13 to 16: seven angles in parallel

With `perf` and `valgrind` installed (docs/tools.md), exact instruction counts showed that Caju
executed 1.7 to 3.2 times more instructions than Go: the problem was the generated code, not
memory (except for maps, at 0.77 instructions per cycle). Seven agents tested one hypothesis
each, in a worktree, with the suite and self-compilation as proof; each one was integrated and
validated again (chain from JS, normal suite and with a collection every 64 KB, output identical
to Go's).

| change | commit | main effect (instructions) |
|---|---|---|
| maps: hash tag in the index, 16-byte entries | 4c410db | maps −20% (cycles −28%, cache misses −38%) |
| 13: global lists in call-free loops; direct `movsd`; `jb` on the fast path | dc7734d | nbody −31%, matmul −14% |
| 14: operations directly on variables in registers/slots (`inc rbx`, `cmp rbx,r12`, `add [rax+rbx*8],imm`) | 6cbb73d | sieve −42%, matmul −36%, mandelbrot −34% |
| 15: `num` variables in xmm8–14 (saved around calls) | c91bf28 | mandelbrot −28%, nbody −6% |
| 16: RSI, RDI, R8–R11 for variables; list data/length in registers in loops | 01668a2 | sieve −11%, matmul −8% (matmul cycles −60%) |

**Time** (round 12 vs. round 16, same session, interleaved, best of 3 passes of 5 runs, largest
size): sieve 67 → 29 ms (−57%), nbody 390 → 175 ms (−55%), mandelbrot 89 → 37 ms (−58%),
matmul 106 → 35 ms (−67%), sort 225 → 184 ms (−18%), maps 809 → 605 ms (−25%),
fib 63 → 62 ms.

## Rounds 17 and 18: control flow and division by a constant

- **17 (angle 7, cfad91b):** `while`/`for`/`range` loops with the condition after the body (one
  branch per iteration); error paths (bounds, nil, division, shift, depth) in cold code, after the
  `ret`; `x64.finish` shortens branches to rel8 and removes branches to the next instruction;
  `return` in the middle of a function emits the epilogue there. Tests:
  `tests/lang/loop_layout_test.caju`.
- **18 (angle 1, 9c18cb7):** `x / d` and `x % d` with a constant `d` without `idiv` or checks
  (shifts for powers of 2, multiplication by the magic number for the others). Tests:
  `tests/lang/const_div_test.caju` (10 integer types, checked against the general path).

Measured separately on top of round 16 (time, 3 interleaved passes): 17 gave sieve −31%,
sort −11%, fib −7%; 18 gave sort −5% and matmul −15% on its own, but combined matmul ends up at
−4% (matmul's initialization does only 90 thousand divisions, ~1 ms: the −15% was an alignment
effect). Together, on top of round 16: sieve 29 → 21 ms (−28%), sort 184 → 164 ms (−11%), fib
62 → 57 ms (−8%); the rest unchanged. Round 18 is worth more outside these challenges: −21% cycles
in a loop with a constant `%`.

## Round 19: the cost of calls (fib)

**Hypothesis:** after the previous rounds fib was the only challenge still 1.6× behind Go. From
the machine code (`tools/disasm.sh`), Caju executed 12 instructions in a leaf call (`n < 2`) and
29 in the others; Go, 10 and 20 (`go tool objdump`). Three leftovers:
1. The leaf built the whole frame (push rbp, sub rsp, save and load rbx) just to compare `n` and
   return.
2. `mov rsp, rbp; pop rbp` on every return.
3. The call depth cost `cmp r15,10000; jge; inc r15` before each call.

**Change:**
- `early_guard`: a function whose first statement is `if p < K { return q }` (p an `int`
  parameter; K a constant or another parameter; q a parameter or constant; any comparison) runs
  the test before the prologue, reading the arguments above the return address (`[rsp+8+...]`),
  and returns without building the frame. Nothing runs before this statement in the function, so
  skipping the prologue changes nothing; excluded are functions with `defer`, anonymous functions,
  parameters in cells and named results. The fib leaf: `mov rax,[rsp+8]; cmp rax,2; jge body;
  ret` (4 instructions).
- `leave` instead of `mov rsp, rbp; pop rbp`.
- R15 counts the calls that still fit: it starts at 10,000 and each call does
  `dec r15; js fail` (and `inc r15` on return). The 10,001st nested call fails, as before; the
  runtime only saves, restores and compares the value (`__depth`/`__set_depth`), so nothing else
  changes.
- New tests: `tests/lang/calls_test.caju` (guard variations, methods, exactly 10,000 calls pass
  and 10,001 fail, the full depth back after a recovered panic); they also pass on the previous
  compiler.

**Result:** fib 32 instructions from 144.7 M to 109.5 M (−24%; Go does 103 M); the other
challenges dropped 0 to 1%. Time (5 interleaved passes): fib 35 from 58 to 41 ms (−30%); Go does
36.7 ms. What remains is passing arguments on the stack (Go uses registers) and saving/restoring
RBX in non-leaf calls.

## Round 20 (angle C): recursion as a loop with an accumulator

**Hypothesis:** Rust turns `fib(n - 1) + fib(n - 2)` into a loop (`acc += fib(n - 1); n -= 2`):
half the calls. With 64-bit wrapping integers, + * & | ^ are exactly associative and commutative,
so this works for any function of that shape.

**Change (`acc_plan`, `acc_loop`, `acc_return` in native.caju):** in a function (not a method, no
`defer`, no named results, no variables in cells, `int` result) whose direct `return`s in the body
or in if/else blocks are `L op f(args)`, `f(args) op L` (L a literal or local variable) or
`f(args)`, those `return`s do `acc = acc op L`, pass the arguments to the parameters and jump back
to the start; the other `return q`s give `acc op q`. Evaluation order is kept (L, the arguments,
then the "call"). Each iteration does the `dec r15; js` of the call it replaces (on the same node,
same message); when L is itself a call and the arguments call nothing, L's call unit is kept
(without `inc r15`/`dec r15`), because the replaced call is at the same depth. On exit R15 goes
back to its value on entry (saved in the frame). With `early_guard`, the guard is tested again at
the end of each iteration (the loop jumps straight to the second statement). The fib loop:
`lea rax,[rbx-1]; push rax; dec r15; js; call fib; add rsp,8; add [acc],rax; sub rbx,2; cmp rbx,2; jge`.

**Result:** fib 32 from 109.5 M to 75.7 M instructions (−31%; Go 102.8 M, Rust 69.4 M); cycles
42 M → 33 M (noisy). The other challenges do not change. Tests: `tests/lang/self_calls_test.caju`
(results, 64-bit wraparound, order of effects, structs by value, exactly 10,000 calls in six
forms, depth of calls in the arguments, infinite recursion, division by zero on the same line,
recovered panic); they also pass on the previous compiler.

## Rounds 20 to 25: chasing Rust

With Go caught up, the target became Rust, which executed 1.5× to 3× fewer instructions on fib,
nbody, matmul, sort and maps (`perf stat` on the three binaries; Rust's `objdump` and `go tool
objdump` showed why). Six agents, one per hypothesis, each in a worktree; integrated one by one
(chain from JS, normal suite and with a collection every 64 KB, output identical to Go's). No
benchmark program was changed.

| round | change | commit | effect (instructions) |
|---|---|---|---|
| 20 | recursion as a loop with an accumulator: `return f(a) + f(b)` becomes a loop on one of the calls (like LLVM), with the depth counted per iteration and given back on return | 3db2a83 | fib −31% |
| 21 | `for v := E; v < C` loops with a constant C: lists checked once before the loop; an unchecked copy, with the original loop when the check fails; `num` operands straight from memory | 719f14e | nbody −56% |
| 22 | non-pointer arguments in registers (RSI, RDI, R8–R11) in direct calls; two entry points per function (`u.r.` and `u.f.`); `early_guard` on the registers | 3fcce14 | fib −12% |
| 23 | versioned counted loops (bounds checked beforehand, unchecked copy unrolled ×4) and vectorized with SSE2 when the result is identical (aliasing checked) | ca7cec0 | matmul −80% |
| 24 | index facts (an already-checked `a[i]` is not checked again until `a` or `i` changes); `make` without zeroing twice; fresh pages without zeroing (`rt_fresh`); condition repeated before the body | 6529562 | sort −29%, sieve −5% |
| 25 | maps: `m[k] op= v` in a single probe (`rt_map_slot`); 32-bit index; old vectors freed right away and free memory returned to the system | b2f68a7 | maps −36%; maps 3M memory 132 → 50 MB |

Negative results recorded by the agents: SwissTable-style group probing with SSE2 (fewer
mispredicted branches, but more instructions and more cycles); vector multiplication of 64-bit
integers with `pmuludq` (Rust itself spends more instructions per element than the unrolled
scalar code).

**Where Rust still wins:** fib (1.3×: the accumulator loop has 10 instructions vs. 7, because of
the depth limit and the `push` on return), matmul (1.2×), mandelbrot (1.1×) and large maps
(1.9×: Rust's table is more compact and its hash cheaper).

## Round 26: allocation and collection (HTTP server)

Profile of the HTTP server (`bench/http`, `GET /users/:id`, one core): ~55% of user time in
allocation and collection, 33% inside `rt_alloc_x` alone, almost all of it on one instruction:
the load of the next node of the free list (`__load64(p)`), which was a cache miss (cold free
objects). Measured with exact instructions per request (callgrind) and user CPU per request.

| hypothesis | result |
|---|---|
| H2a allocate by scanning the "in use" bitmap instead of a free list (no division, no `rt_bit_set`/`rt_bit_clr`, a per-page "no pointers" bit: key = class×2 + no pointers) | accepted: 33.3k → 29.5k instr./req. |
| H2b runs: reserves a sequence of free slots at once (bits and zeroing together); each allocation just bumps a pointer; collection gives back the rest of the runs before marking; sweep = `in use &= marked` | accepted: → 24.6k |
| H2c full fast path in `rt_alloc`/`rt_alloc_ns` ([next, end, size] per key), the rest in `rt_alloc_slow` | accepted: → 22.5k |
| H2d smaller collection threshold (2 MB, 1 MB) to fit in the cache | inconclusive (noise from another process); not changed |
| H2e allocation expanded inline by the generator for constant sizes | not done: ~35 instr. per struct, ~1% per request |
| H1a map in a single block (72 + 128 + 64 bytes) | rejected: fewer allocations, same instructions and more bytes (320 class) |
| H1a′ map in a 168-byte block (header + 4 entries + 8-slot index) | accepted: 17.8k → 17.2k; 272 → 176 bytes per empty map |
| H1b struct literals: an omitted field whose zero is 0 does not call `rt_zero` (strings: the literal `""`) | accepted: 18.3k → 17.8k |
| H1c `std/http`: status line and Content-Length without concatenation (`put_int`), common method/version/header names without allocating (`mem_known`), `has_token` without `split` | accepted: 18.9k → 18.3k |
| H1d web framework: router without `split` (compares the path bytes with the fixed children), `params`/`keys` created only when used, handler chain stored per route | accepted: 22.5k → 18.9k |

Server totals, on one core (req/s, user CPU per request):

| route | before | after |
|---|---|---|
| GET /users/:id | 56.9k, 8.0 µs | 67.5k (+19%), 4.4 µs |
| GET /users (50) | 30.3k, 21.3 µs | 32.7k (+8%), 19.1 µs |
| POST /users | 50.4k, 10.7 µs | 64.2k (+27%), 6.1 µs |

The compiler compiling itself: 12.17 → 9.85 billion instructions (−19%), 7.1 → 5.1 billion
cycles (−28%). CPU benchmarks (fib...maps): ±0.1% instructions. Memory: maps 3M unchanged;
sort 2M 16.9 → 19.9 MB (pages separated by "no pointers").

## Round 27: maps (smaller index, string keys) and std/http routes

Starting point, maps 3M (`perf stat`): Caju and Rust executed the **same** ~1.0 billion
instructions, with similar cache misses (13.7 M vs. 12.1 M) and the same 2 MB pages (both use
THP: ~230 MB in AnonHugePages), but Caju spent 1.9× the cycles and had 4× the mispredicted
branches. The time in `rt_map_slot`/`rt_map_get` was almost all on the instruction after the
index load.

| hypothesis | result |
|---|---|
| mispredicted branches depending on the cache miss (linear probing: the loop ends at an unpredictable point) | partly refuted: a 1/4-full index cuts mispredictions from 3.3 M to 1.25 M, but cycles **rise** 10% (32 MB index) |
| 2 MB pages (`madvise(MADV_HUGEPAGE)` on the arena) | rejected: the kernel (THP `always`) already used huge pages in both languages |
| **M3a index up to 3/4 full** (was 1/2): 8 MB instead of 16 MB for maps 3M | **accepted**: cycles −19%, maps 3M 568 → 482 ms interleaved (−15%; Go 558, Rust 320); memory 53.9 → 44.0 MB; 1M does not change (the index has the same size) |
| M3b 1-byte control per slot in groups of 8 with SWAR (like hashbrown) + separate 32-bit positions | rejected: mispredictions 5.76 M → 1.70 M, but cycles +30% and instructions +22%: a present key now takes 3 dependent accesses (control → position → entry) instead of 2. Same result as the SSE2 attempt in rounds 20–25, now with the cause measured |
| M4a integer path of `rt_map_get`/`rt_map_slot` in call-free functions (variables in registers) | rejected: +9.5% instructions, same cycles (memory latency dominates) |
| **M1 string hash 8 bytes at a time** (`rt_str_hash`: the last step reads the 8 bytes ending at the last byte, without going past the end) and the final mix inlined | **accepted** |
| **M2 `rt_streq` 8 bytes at a time** (same address → equal; lengths; the last word overlaps what was already compared or the equal lengths) and `rt_strcmp` skipping equal words; string `==`/`!=` call `rt_streq` (generator: `cmp_expr`) | **accepted**: a program with a string map and string `==` −45% instructions (1.15 B → 639 M) |
| **M1′ `rt_map_fs`**: dedicated probing for string keys, without calls to `rt_hash`/`rt_map_tag`/`rt_keq`; the same address is equal without reading bytes | **accepted** (together with M5 below) |
| **M5 `std/http`**: `find_route` only looks in the map if there are exact routes; prefixes in a list from longest to shortest; `Request.header` only lowercases if the name has uppercase letters | **accepted**: server (web, 1 CPU) GET /users/:id 17.5k → 15.9k instructions per request (−9%), cycles −5%; POST /users 27.3k → 25.5k (−7%), cycles −3%; req/s within noise (half the cost is the kernel) |

Where Rust still wins on maps 3M (1.5×): hashbrown's 1-byte control per slot stays in the cache
(2 MB) and resolves a missing key without going to RAM, with 2 dependent accesses for a present
key; Caju needs the entry's position in the index (`range`'s insertion order is part of the
language), and a third access costs more than the mispredictions it saves.

## What is left for later

In order of expected gain:
1. ~~`[]bool` with 1 byte per element~~ (round 12). `[]uint8` is still pending.
2. **More registers for `num`** (there are no callee-saved XMM registers on Linux: they would need
   to be saved around calls) and loading `num` from memory straight into XMM (`movsd xmm, [rbp-x]`).
3. ~~Remove repeated loop checks~~ (round 11, for local lists). Still pending: global lists
   (nbody), and keeping the data pointer in a register.
4. **Short branches** (`jcc rel8`) and cold code (error calls) off the hot path.
5. **An intermediate representation** with real register allocation: the biggest leap, but it
   means rewriting the generator.
