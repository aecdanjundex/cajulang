# caju mcp: the compiler for AI assistants

`caju mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server: an AI assistant
(Claude Code, Claude Desktop, Cursor, VS Code...) uses the compiler through tools with structured
results, instead of running `caju` in a shell and reading its output. It comes with the `caju`
command: nothing else to install. It is written in Caju (`compiler/mcp.caju`).

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

The code goes either as `files` (`{"main.caju": "...", "util.caju": "..."}`, with `entry` when the
entry is not `main.caju`) or as the `path` of an entry file on disk (a project with `caju.toml` and
its packages works the same). Files given inline are written to a temporary directory, which is
removed after the call.

The reference is also a resource: `caju://reference`.

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
