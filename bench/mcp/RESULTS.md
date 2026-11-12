# An AI assistant with the CLI and with `caju mcp`

2026-11-12. The same three tasks, done by Claude Code non-interactively (`claude -p`, model
Claude Sonnet 5.5) in two ways, each run in an empty directory with only the task's files:

- **cli**: the `caju` command in a shell (`Bash(caju:*)`), plus reading and writing files. No
  other shell command, no MCP server, and `caju mcp` itself is not allowed.
- **mcp**: the tools of `caju mcp` (`caju_check`, `caju_run`, `caju_test`, `caju_docs`,
  `caju_reference`), plus reading and writing files. No shell.

Same prompt, same model, same limits (40 turns, 15 minutes). The result of every run is checked
afterwards by running the program or the tests. `run.sh` runs everything, `summarize.mjs` makes
`summary.json`; the raw logs (`results/`) are not in the repository.

| Task | What it asks |
|---|---|
| words | Write a program from scratch: the 5 most frequent words of a text, sorted by count and then alphabetically |
| fix | A program written in Go style (`package`, `func`, `fmt.Printf`, `float64`...) must become valid Caju and print two given lines |
| tests | Write at least 4 tests for a stack module; popping an empty stack must give `0, false` (the module has a bug there) |

## Results (2 runs per task and mode)

| Task | Mode | Correct | Turns | Compiler calls | Compile errors seen | Input tokens | Time | Cost |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| words | cli | 2/2 | 16.0 | 10.0 | 0.0 | 283k | 23.7 s | $0.114 |
| words | mcp | 2/2 | 5.5 | 1.5 | 1.0 | 100k | 9.7 s | $0.071 |
| fix | cli | 1/2 | 53.0 | 31.0 | 17.5 | 944k | 88.1 s | $0.229 |
| fix | mcp | 2/2 | 10.0 | 1.5 | 1.0 | 128k | 12.0 s | $0.079 |
| tests | cli | 2/2 | 22.0 | 12.5 | 2.0 | 392k | 34.0 s | $0.160 |
| tests | mcp | 2/2 | 12.0 | 2.0 | 2.0 | 158k | 14.8 s | $0.087 |
| **all** | **cli** | **5/6** | **30.3** | **17.8** | **6.5** | **540k** | **48.6 s** | **$0.168** |
| **all** | **mcp** | **6/6** | **9.2** | **1.7** | **1.3** | **129k** | **12.2 s** | **$0.079** |

With `caju mcp`, the assistant needed 3.3× fewer turns, 10× fewer compiler calls, 4.2× fewer input
tokens, 4× less time and half the cost, and it finished every task.

## What the assistants did

- **With the MCP server**, every run started the same way: `caju_reference` (the language), then
  `caju_docs` for the names it needed (`strings.split`, `strings.to_upper`, the testing API),
  then one `Write` and one `caju_run` or `caju_test`. Most programs were right the first time.
- **With the CLI**, the assistant had to learn the language from the compiler's error messages:
  `caju --help`, then small probe programs (`print("hi")`, one construct at a time) through
  `caju check` and `caju run`, rewriting the file after each error. It also looked for
  documentation elsewhere: shell commands to list directories, `find /` for `.caju` files,
  `strings` on the compiler binary, and `caju mcp --help` (denied here). The failed run hit the
  40-turn limit while still probing the syntax: the file was never rewritten.
- The gap follows how much of the language a task needs: largest when converting Go to Caju
  (`fix`: 53 vs 10 turns), smallest when writing tests next to an existing Caju file, which
  shows the syntax (`tests`: 22 vs 12).

In a first round (not counted: a defect of the harness put every task into each prompt), `caju
mcp` was not blocked for the CLI runs. Several of them found it in `caju --help` and spoke
JSON-RPC to it from the shell (`printf '{"jsonrpc":"2.0",...}' | caju mcp`) to read the reference
and the library docs: without the server configured, the assistants went looking for what it
offers.

## Limits of this comparison

Two runs per task and mode, one model, three small tasks: the direction is clear, the exact
ratios are not. The CLI runs could not use other shell commands (as the MCP runs could not use a
shell at all); a CLI user's assistant could also read Caju documentation if it were in the
project. Costs and token counts are those reported by Claude Code.
