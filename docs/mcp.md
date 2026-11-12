# caju mcp: the compiler for AI assistants

`caju mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server: an AI assistant
(Claude Code, Claude Desktop, Cursor, VS Code...) uses the compiler through tools with structured
results, instead of running `caju` in a shell and reading its output. It comes with the `caju`
command: nothing else to install. It is written in Caju (`compiler/mcp.caju`).

More, with a measured comparison of an assistant using the CLI and the server:
https://cajulang.vercel.app/en/mcp (and `bench/mcp/RESULTS.md`).

## Set it up

Claude Code:

```sh
claude mcp add caju -- caju mcp
```

Any client that takes a JSON configuration of stdio servers (Claude Desktop, Cursor, VS Code):

```json
{
  "mcpServers": {
    "caju": { "command": "caju", "args": ["mcp"] }
  }
}
```

Use the full path of `caju` (`~/.local/bin/caju` with the installer) if the client does not see
your `PATH`.

## Tools

| Tool | What it does |
|---|---|
| `caju_check` | Type-checks without generating code; returns `{ok, diagnostics: [{file, line, col, stage, message}]}` |
| `caju_run` | Compiles and runs with a time limit (`timeout_seconds`, default 10, at most 120) and arguments; returns the diagnostics, or `{exit_code, timed_out, output}` |
| `caju_test` | Runs `*_test.caju` files (or a directory), optionally only the tests whose name has `filter`; returns `{ok, passed, failed, skipped, output}` |
| `caju_docs` | Searches the exported functions, methods, structs and constants of the standard library, with their doc comments |
| `caju_reference` | The language reference (`docs/language.md`), whole or the sections about a `topic` |
| `caju_pkg` | Adds, removes, installs, updates and verifies the packages of a project, and lists the shared package cache |

`caju_pkg` manages the packages of a project (`action`: `add`, `remove`, `install`, `update`,
`tree`, `verify`, `cache`), with the same rules as `caju pkg` (`docs/packages.md`): downloads go to
the cache shared by every project and a cached copy is reused only if its files still have the hash
recorded when it was downloaded. The answer says, for each package, whether it was downloaded or
reused.

The code goes either as `files` (`{"main.caju": "...", "util.caju": "..."}`, with `entry` when the
entry is not `main.caju`) or as the `path` of an entry file on disk (a project with `caju.toml` and
its packages works the same). Files given inline are written to a temporary directory, which is
removed after the call.

The reference is also a resource: `caju://reference`.

## The code graph

Reading whole files to find one function costs an assistant thousands of tokens. The graph tools
answer the question instead: where a symbol is, what it looks like, who calls it, what implements
an interface, how one function reaches another. Each answer is a few lines, one per symbol:

```
func shapes/shapes.total  |  fn total(list: []Shape) -> num  |  shapes/shapes.caju:13-17
```

| Tool | What it does |
|---|---|
| `caju_find` | Searches symbols by name (exact, then prefix, then part of the name or doc); `kind` narrows to func, method, struct, interface, type, field, var or file |
| `caju_symbol` | One symbol: signature, doc comment, location, fields, methods, callers, callees, implementations and uses; `code: true` adds its source lines |
| `caju_related` | The symbols related to one: `callers`, `callees`, `implements`, `implementations`, `uses`, `used_by`, `fields`, `methods`, `members` (of a file), with `depth` up to 5 |
| `caju_outline` | Everything a file declares, with fields and methods, without the bodies |
| `caju_call_path` | The shortest chain of calls from one function to another, through interface methods too |
| `caju_graph_stats` | The size of the graph, the build time and the files left out (they don't compile) |

Every graph tool takes `root`, the project directory (by default the server's working
directory). Names can be complete (`compiler/wasm.compile_wasm`, `std/strings.split`) or just
their end (`compile_wasm`, `Circle.area`); an ambiguous name answers with the candidates.

The graph is built from the compiler's own linked and checked tree, so the edges are the real
ones: a call to a method of a struct points to that method, a call through an interface points to
the interface method, and from it to every struct method that may run. It lives in the memory of
the server process:

- The first query on a root builds it: about 8 s for the compiler itself (140 files, 3,800
  symbols, 13,800 edges).
- After that, a query takes about 2 ms (median; 6 ms at p95).
- Before each query the server compares the size and modification time of every file. Only the
  directories whose files (or whose imports) changed are linked again: an edit to one example
  takes about 0.6 s; an edit to the standard library relinks what imports it.
- A file that does not compile is left out (`caju_graph_stats` lists it) and the rest still works.

## Why

Caju is new: an assistant has not seen it while it learned, and it looks enough like Go to be
written as Go. With the server, the assistant reads the real reference, finds the real names of
the library, and gets exact positions for each error after every edit.

`caju_run` and `caju_test` run the program on your machine, as `caju run` would: the time limit
stops a program that does not end, but it is not a sandbox. For an isolated run, the compiler in
WebAssembly (`docs/wasm.md`) runs programs in a browser or in Node without access to your files.

## Also on the command line

```sh
caju check main.caju            # the errors, as the compiler prints them; exit 1 if any
caju check --json main.caju     # {"ok": false, "diagnostics": [...]}
```
