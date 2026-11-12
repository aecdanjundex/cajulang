# Changelog

All notable changes to Caju. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). Each release on GitHub takes its
notes from the section of its version here (`tools/changelog.sh`).

## [Unreleased]

### Changed
- The documentation is in English (README, docs/, bench notes, CLAUDE.md); docs with Portuguese
  names were renamed: native-architecture.md, native-compiler-plan.md, history.md.
- Release notes come from this changelog (`tools/changelog.sh`).

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

[Unreleased]: https://github.com/aecdanjundex/cajulang/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/aecdanjundex/cajulang/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/aecdanjundex/cajulang/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/aecdanjundex/cajulang/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aecdanjundex/cajulang/releases/tag/v0.1.0
