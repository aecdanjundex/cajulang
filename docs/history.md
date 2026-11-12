# Project history (what was done and why)

A summary of the conversations that built Caju, to give context to whoever continues the work.

## The language and the page

- Caju started as a toy language in Portuguese, in a single HTML page
  (`web/caju.html`): editor, syntax tree, tree interpreter, bytecode compiler, optimizer, stack
  VM, types tab, disassembler, reference and dozens of examples.
- It gained Go features: checked types (gradual typing: anything untyped is `any`), structs,
  methods, interfaces, slices, maps, pointers, closures, multiple results, `defer`,
  `panic`/`recover`, goroutines, channels, `select`, fixed-size integers (int8...uint64), multiple
  files with `import`/`export`, `extern` for calling Windows DLLs, and `dllexport`.
- "Gerar .exe / .dll": the page combines the program's bytecode (format v6, see `serializeProgram`)
  with a prebuilt native runtime embedded in base64 (x64, x86 and x64 DLL), writes the version
  information into the VERSIONINFO resource and can sign the .exe (Authenticode, with a
  certificate generated on the spot or one supplied by the user).
- The old "gas" system (a cost limit per instruction) was **removed** at the owner's request;
  the bytecode moved to version 6.

## Rust runtime

- The native runtime was written in C; it was **rewritten in Rust** (`runtime/rs/`) and passed all
  the parity tests (Linux, Wine x64 and x86, DLL and FFI).
- Build details: Rust compiles a static library; zig does the linking for Windows (with
  `-fno-compiler-rt` to avoid duplicating `___chkstk_ms`, and `-lunwind`); `-Z build-std` with the
  standard library source (cloned from the Rust repository, because rustup could not download the
  Windows rust-std); a wrapper around zig's `dlltool` in `rs/tools`; DLL with an export table
  in assembly (`.cajuexp` in `caju-asm-x64.S`).

## Native compiler

- The owner asked: "é possível criar o próprio runtime na linguagem Caju?" ("is it possible to
  write the runtime itself in Caju?"). Answer: yes, with a native compiler; the owner chose that path. The
  9-phase plan is in `docs/native-compiler-plan.md`, with the recommended decisions accepted.
- Phase 1: x86-64 assembler, ELF/PE, numbers (12-digit printing identical to JS), strings,
  functions, control flow, extern through Win64 thunks. Benchmark 17x faster.
- Phase 2: composite values with type descriptors in data; runtime errors with the same message
  and line as the VM.
- Phase 3: any/interfaces (boxes), type switches, closures (`[code, cells]`), methods by name,
  multiple results, `errors.New`, untyped parameters. The VM's numeric rules for `any` were copied
  (including "a box counts as true").
- Phase 4: conservative garbage collector with size classes; 3 million objects in 18 MB.
  A bug in the size-class table (classes did not reach 16384) was found with gdb +
  `native/sym.js`.
- Phase 5: defer/panic/recover with a record in the frame and a jump to the "recovered" code.
- While packaging the project for Claude Code, it turned out that the tests were passing the
  multi-file examples the wrong way (VM and native failed the same way); this was fixed (`filesOf`
  in `native/run.js`), and the native compiler started accepting modules (`Módulo` in the linked
  tree).

## Accepted differences between the VM and native

- Integers above 2^53 (the VM uses JS numbers).
- `5e-324`: JS prints the shortest subnormal; native prints 12 digits.
- `any` with the wrong type flowing into a concrete type: the VM carries on without checking;
  native raises an error.
- (Phase 6) the preemption order between goroutines will not be the same.

## Reorganization and compiler in Caju (phase 9)

- The repository was reorganized: the HTML page and the Rust runtime were removed; the JavaScript
  compiler was split into `bootstrap/*.js`; the runtime moved to `rt/`, the standard library to
  `lib/` and the tests to `tests/` (with the expected output next to each program). Code,
  comments and messages were switched to English.
- The compiler was ported to Caju (`compiler/*.caju`) as a faithful translation of the JS
  (`docs/compiler-port.md`). Result: for every program in `tests/` it produces binaries
  byte-for-byte identical to the bootstrap's (Linux and Windows), and self-compilation closes:
  stages 1, 2 and 3 are identical (about 2 s per stage, 1.2 MB binary).

## Package manager, expanded std and BDD tests

- `caju pkg` (docs/packages.md): packages are GitHub repositories with a `caju.toml` (TOML);
  versions come from `vX.Y.Z` tags; recursive dependencies with *minimal version selection*;
  `caju.lock` pins the version, commit and a SHA-256 hash of each package's files, checked on
  download, on build and by `caju pkg verify`. Downloads go through `git` (the language has no TLS).
- New std: `fs` and `path` (files and directories), `toml`, `crypto` (SHA-256/512, SHA-1, MD5,
  HMAC, PBKDF2, random bytes), `hash` (CRC-32, FNV), `hex`, `base64`, `testing`.
- Tests: the ~140 programs with `.out` files became BDD-style `_test.caju` files
  (`describe`/`it` with string titles, `expect`), next to the code (docs/testing.md). `caju
  test` finds and runs the tests; `tests/run.js` was removed.
