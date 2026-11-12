# Caju

A Go-inspired programming language that compiles straight to x86-64 machine code (Linux and
Windows) and to WebAssembly. The compiler and the runtime are written in Caju itself, and the
compiler compiles itself, to WebAssembly too: that is what runs in the
[playground](https://cajulang.vercel.app/en/playground), inside the browser.

```
fn greet(name: str) -> str {
  return "Hello, " + name + "!"
}

print(greet("world"))
```

## Installation

Linux x86-64 (on Windows, use WSL; the Linux `caju` can also build `.exe` files with `--target windows`):

```sh
curl -fsSL https://raw.githubusercontent.com/aecdanjundex/cajulang/main/install.sh | sh
```

The installer downloads the latest release, checks its SHA-256, installs it in `~/.caju` and creates
the `~/.local/bin/caju` command. Variables: `CAJU_VERSION=0.1.0` (a specific version), `CAJU_HOME`,
`CAJU_BIN_DIR`. To install by hand, download `caju-linux-x86_64.tar.gz` from
[Releases](https://github.com/aecdanjundex/cajulang/releases), extract it and put `caju-<version>/bin`
on your `PATH`. To uninstall: `rm -rf ~/.caju ~/.local/bin/caju`.

```sh
caju run programa.caju              # compiles in memory and runs
caju build -o programa programa.caju
caju test                           # runs the *_test.caju files in the directory
caju version
```

## WebAssembly

```sh
caju build --target wasm -o programa.wasm programa.caju
node tools/wasm/run.mjs programa.wasm       # in Node (the host handles the system calls)
```

Each release ships `caju-wasm.tar.gz`: the compiler compiled to WebAssembly (`caju.wasm`), the
standard library and the runtime (`caju-files.json`), and `caju-browser.mjs`, which compiles and
runs programs in a browser:

```js
import { loadCaju } from "./caju-browser.mjs"
const caju = await loadCaju({ wasm: await fetch("caju.wasm"), files: await (await fetch("caju-files.json")).json() })
const c = await caju.compile('print("Olá")')
if (c.ok) await caju.run(c.wasm, { stdout: (b) => console.log(new TextDecoder().decode(b)) })
```

Details in `docs/wasm.md`.

## Standard library

`import "std/x"`: `strings`, `strconv`, `math`, `bytes`, `os`, `fs`, `path`, `net`, `http`, `json`,
`toml`, `crypto`, `hash`, `hex`, `base64`, `testing`.

- `std/json`: `json.marshal(v)` / `json.unmarshal(text, &v)` for structs, lists, maps and `any`,
  in the style of Go's `encoding/json` (the key is the field name), and `json.parse` for a tree.
- `std/http`: an HTTP/1.1 server with keep-alive and an event loop (epoll); several processes on the
  same port with `http.listen_and_serve_workers(host, port, n)`.

For REST APIs there is a Gin-style framework, [`github.com/aecdanjundex/web`](https://github.com/aecdanjundex/web):

```sh
caju pkg add github.com/aecdanjundex/web
```

## Performance

Native executables of ~50–300 KB, with no dependencies. Comparisons with Go, Rust and Python are in
`bench/compare/RESULTS.md` (fib, sieve, nbody, mandelbrot, matmul, sort, maps), and the HTTP server
in `bench/http/RESULTS.md`. An example (JSON API, 1 CPU, req/s):

| route | Caju + web | Go + Gin | Go net/http |
|---|--:|--:|--:|
| GET /users/:id | **72,468** | 33,424 | 32,687 |
| GET /users (50 items) | **41,463** | 18,824 | 21,054 |
| POST /users | **65,638** | 29,354 | 31,434 |

## Building from source

You need Node 22+ only for the first stage (the original compiler, written in JavaScript):

```sh
node bootstrap/caju.js build -o build/caju compiler/main.caju   # builds the compiler
build/caju run examples/hello-server.caju                       # compiles and runs (server on port 3200)
build/caju build -o hello programa.caju                         # builds a Linux executable
build/caju build --target windows programa.caju                 # builds an .exe
build/caju test                                                 # all *_test.caju files
build/caju pkg add github.com/dono/pacote                       # adds a dependency
```

BDD-style tests, next to the code (`strings_test.caju` alongside `strings.caju`):

```
import { describe, it, expect } from "std/testing"

describe("strings.split", fn() {
  it("cuts the text at every separator", fn() {
    expect(strings.split("a,b", ",")).to_equal([]str{"a", "b"})
  })
})
```

## Documents

- `CLAUDE.md`: project map, how to work on it, current state and pitfalls.
- `docs/packages.md`: the package manager (caju.toml, caju.lock, hashes).
- `docs/testing.md`: testing with `caju test` and `std/testing`.
- `docs/compiler-port.md`: how the compiler was ported from JavaScript to Caju.
- `docs/native-architecture.md`: how the native compiler works internally.
- `docs/wasm.md`: the WebAssembly target and the in-browser compiler.
- `docs/native-compiler-plan.md`: the phase plan.
- `docs/history.md`: what has been done so far, and why.
- `docs/releasing.md`: how to publish a new version.

## License

MIT (see `LICENSE`).
