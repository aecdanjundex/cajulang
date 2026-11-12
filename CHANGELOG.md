# Changelog

All notable changes to Caju. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). Each release on GitHub takes its
notes from the section of its version here (`tools/changelog.sh`).

## [Unreleased]

## [0.5.0] - 2026-11-12

### Added
- `std/cli`: command line programs. Commands and nested subcommands, bool/str/int/list flags
  (short and long forms, choices, required, environment variables, defaults), required, optional
  and variadic arguments, generated help (`-h`, `--help`, `help <command>`), `--version`, and
  errors with suggestions for misspelled names (`docs/cli.md`).
- `caju mcp`: a Model Context Protocol server for AI assistants, with the tools `caju_check`,
  `caju_run`, `caju_test`, `caju_docs` and `caju_reference` (`docs/mcp.md`).
- `caju check [--json] file.caju`: type-checks without generating code; with `--json`, the
  diagnostics with file, line, column and stage.
- A code graph in `caju mcp`, kept in memory and updated incrementally: `caju_find`,
  `caju_symbol`, `caju_related`, `caju_outline`, `caju_call_path` and `caju_graph_stats` answer
  where a symbol is, its signature, callers, callees, implementations and call chains in a few
  lines, so an assistant doesn't read whole files (`docs/mcp.md`).
- `caju pkg cache list|verify|clean|dir`: the package cache shared by every project on the
  machine. Each download records its commit and SHA-256 hash; a cached copy is reused by any
  project only if its files still have that hash, and a changed copy is downloaded again.
- `caju_pkg` in `caju mcp`: add, remove, install, update and verify packages, and list the cache.
- `os.read_line()`: one line of the standard input at a time.
- `docs/language.md`: the language reference, also in the release package with `docs/mcp.md`.
- WebAssembly modules carry a `name` section (function names in stack traces and profiles);
  `tools/wasm/disasm.mjs` prints the instructions of a function by name.
- `dump_main --stage=lex` prints the tokens of a file.

### Changed
- The `caju` command line is declared with `std/cli`: every command has `--help`, misspelled
  commands and flags get a suggestion, `--target` values are checked, and `caju bench --runs`
  also takes `--runs N`. Usage errors exit with 2.
- `caju pkg cache` alone lists the cache (as `caju pkg cache list`).
- The release chain starts with the JavaScript compiler building `compiler/build_main.caju`,
  which builds the whole compiler (the JS compiler lacks std/json's reflection intrinsics).
- `caju pkg install`/`add`/`update` replace a changed cached package with a new download instead
  of failing; `caju pkg update` prints the version changes after the downloads.
- The documentation is in English (README, docs/, bench notes, CLAUDE.md); docs with Portuguese
  names were renamed: native-architecture.md, native-compiler-plan.md, history.md.
- Release notes come from this changelog (`tools/changelog.sh`).
- WebAssembly: no default epilogue after a function's final `return` (smaller code).

## [0.4.0] - 2026-11-12

### Added
- WebAssembly target: `caju build --target wasm` compiles a program and the runtime to a wasm
  module (`compiler/wasm.caju`, `compiler/wasmenc.caju`, `rt/wasm.caju`). Values, the stack in
  memory and the calling convention follow the native ones, so the runtime and the garbage
  collector work unchanged; `recover` uses wasm exceptions.
- The compiler compiles itself to `caju.wasm`, and `caju.wasm` compiles itself to the same bytes.
- `caju-wasm.tar.gz` in every release: the compiler in WebAssembly, the standard library and the
  runtime (`caju-files.json`), `caju-host.mjs` (the Linux system calls of a program in wasm) and
  `caju-browser.mjs` (`loadCaju()`: compile and run in a browser over an in-memory file system).
  The playground of https://cajulang.vercel.app uses it.
- `tools/wasm/run.mjs` runs a wasm program in Node over the real file system.
- `caju test --target wasm`: the test suite with the programs compiled to wasm.

### Changed
- `os.run` first asks the host to run the program (a WebAssembly host has no `fork`); on Linux
  the call answers ENOSYS and the usual `fork`/`execve` path runs.
- The size of the collector's arena comes from the system part of the runtime
  (`rt_os_arena_size`: 16 GB on Linux and Windows, 2 GB in wasm).
- Faster maps with text keys (index up to 3/4 full, 8-byte text hashing and equality), `std/json`
  (flat structs by leaf functions, one-pass checks, reused tables) and `std/http` routing (no
  hashing). The benchmarks were measured again (`bench/compare/RESULTS.md`).
- The repository moved to github.com/aecdanjundex/cajulang.

### Fixed
- `lib/http_test.caju` waits for the test server by time (20 s) instead of by a number of tries.

## [0.3.0] - 2026-11-11

### Added
- `std/http`: an event loop with epoll, keep-alive, pipelining and `listen_and_serve_workers`
  (several processes with `SO_REUSEPORT`).
- HTTP benchmark against Gin and Go's net/http (`bench/http`).

### Changed
- Faster `std/json`: an encoding plan per struct, its own buffer and direct decoding.
- Allocator without free lists: runs of free slots per size class (and per "no pointers").
- Fewer allocations per request: maps in one block, literals without `rt_zero`, HTTP responses
  without concatenation.

## [0.2.0] - 2026-11-11

### Added
- `std/json`: `marshal`, `marshal_indent`, `unmarshal`, `parse`, `valid` and `quote`, in the style
  of Go's encoding/json.

## [0.1.0] - 2026-11-11

### Added
- First release: the language, the native compiler for x86-64 (ELF on Linux, PE on Windows)
  written in Caju and compiling itself (stage 2 = stage 3), the runtime and garbage collector in
  Caju, the standard library (strings, strconv, math, bytes, os, fs, path, net, http, toml,
  crypto, hash, hex, base64, testing), `caju test` with BDD-style tests and the package manager
  `caju pkg` (GitHub repositories, minimal version selection, `caju.lock` with SHA-256 hashes).
- An optimizing code generator: registers for locals and arguments, XMM registers for floats,
  versioned and vectorized loops, division by constants, inlining, accumulator loops for
  self-recursion.
- Benchmark against Go, Rust and Python (`bench/compare`).
- Release package, installer (`install.sh`) and GitHub workflows. MIT license.

[Unreleased]: https://github.com/aecdanjundex/cajulang/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/aecdanjundex/cajulang/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/aecdanjundex/cajulang/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/aecdanjundex/cajulang/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/aecdanjundex/cajulang/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aecdanjundex/cajulang/releases/tag/v0.1.0
