# Tests (`caju test` and `std/testing`)

Tests follow Go's style in how they are organized and BDD style in how they are written:

- a test file ends in `_test.caju` and sits **next to** the code it tests
  (`lib/strings.caju` → `lib/strings_test.caju`);
- helper programs for tests go in `testdata/` (`caju test` does not look for tests there);
- each test has a **text title** that states the expected behavior, and values are checked with
  `expect`. There are no `.out` files.

```caju
import "std/strings"
import { describe, it, expect } from "std/testing"

describe("strings.split", fn() {
  it("cuts the text at every separator", fn() {
    expect(strings.split("a,b,c", ",")).to_equal([]str{"a", "b", "c"})
  })

  it("keeps empty parts between two separators", fn() {
    expect(strings.split("a,,b", ",")).to_have_length(3)
  })
})
```

## Running

```sh
caju test                   # all *_test.caju files under the current directory
caju test lib compiler      # under these directories (or files)
caju test -v lib            # shows each test, not just the files
caju test --run "split"     # only the tests whose full title contains "split"
```

Output for a failing file:

```
FAIL lib/strings_test.caju
strings.split
  ✓ cuts the text at every separator
  ✗ keeps empty parts between two separators
      expected ["a" "b"] to have length 3
      length: 2

FAIL: strings.split › keeps empty parts between two separators
# 1 passed, 1 failed, 0 skipped
```

Each test file is compiled as a program and runs in its own directory (paths such as
`testdata/x.caju` are relative to the test file). `caju test` exits with code 1 if any test fails.

## Structure

| function | purpose |
|---|---|
| `describe(title, fn() {...})` | groups the tests for one subject; can contain nested `describe` blocks |
| `it(title, fn() {...})` | a test; stops at the first failing `expect`, or at a `panic`/runtime error |
| `skip(title, fn() {...})` | a test that is written but not run (shown as *skipped*) |
| `before_each(fn() {...})` | runs before each test in the block (and in nested blocks) |
| `after_each(fn() {...})` | runs after each test in the block, even if it fails |
| `fail(message)` | makes the current test fail |

## Assertions (`expect(value)....`)

| method | passes when |
|---|---|
| `to_equal(x)` | the values are equal; lists, maps and structs by content. Text and numbers differ (`"1"` ≠ `1`) |
| `to_be_true()`, `to_be_false()`, `to_be_nil()` | the value is `true`, `false`, `nil` |
| `to_contain(x)` | text contains the substring; list contains the element; map (text keys) contains the key |
| `to_have_length(n)` | text (in bytes), list or map has length `n` |
| `to_start_with(s)`, `to_end_with(s)` | text starts / ends with `s` |
| `to_be_greater_than(n)`, `to_be_less_than(n)`, `to_be_at_least(n)`, `to_be_at_most(n)` | number comparison (int or float) |
| `to_be_close_to(n, eps)` | number is at most `eps` away from `n` |
| `to_be_error(msg)` | is an `error` (not nil) with this message |
| `to_panic()`, `to_panic_with(msg)` | `expect(fn() {...})`: the function panics (or stops with a runtime error), with this message |

`expect(x).not_()` negates the assertion: `expect(lista).not_().to_contain("a")`.
(`not` is a reserved word; the `_` follows the same convention as `fn_`, `from_`.)

## Whole programs

To test what only shows up in a program's output (compile errors, runtime errors with file and
line, `os.exit`):

```caju
import { describe, it, expect, run_file, run_source } from "std/testing"

it("reports a division by zero with the line", fn() {
  r := run_file("testdata/div0.caju")         # compiles and runs with `caju run`
  expect(r.output).to_equal("Runtime error in div0.caju, line 2: Integer division by zero.")
  expect(r.code).to_equal(1)
})

it("rejects a name that was never declared", fn() {
  r := run_source("print(nome)\n")             # a program given as text
  expect(r.output).to_start_with("Compile error in main.caju, line 1:")
})
```

`r.output` combines standard output and standard error, without the final newline; `r.code` is the
exit code.
