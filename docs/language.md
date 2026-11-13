# The Caju language

<!-- Generated from the spec page of the site (cajulang-site: scripts/export-reference.mjs). Edit it there. -->

How Caju works: syntax, types, statements, functions, errors and modules. The examples were compiled with version 0.5.0 and show the actual output.

## Overview

Caju is a compiled, statically typed programming language with type inference. The compiler generates x86-64 machine code: ELF executables for Linux and PE for Windows. It also generates WebAssembly modules, which run in Node and in the browser. The compiler and runtime are written in Caju itself.

The language comes with everything you need to work: a compiler, a test runner (`caju test`) and a package manager (`caju pkg`), all in a single `caju` command.

A program is one or more `.caju` files. Top-level statements run in order, from top to bottom: there is no need to declare a `main` function.

`hello.caju`:

```caju
fn greet(name: str) -> str {
  return "Hello, " + name + "!"
}

print(greet("world"))
```

```
$ caju run hello.caju
Hello, world!
```

## Lexical elements

**Comments.** Start with `#` or `//` and run to the end of the line.

**Statement terminators.** A line break or a `;` ends a statement. An expression does not continue onto the next line after an operator: split it into variables.

**Identifiers.** Letters (including accented Latin letters such as `é` and `ç`), digits and `_`, not starting with a digit.

**Keywords.** These cannot be used as names:

`let` `const` `if` `else` `while` `for` `to` `and` `or` `not` `true` `false` `import` `from` `export` `fn` `return` `extern` `dllexport` `struct` `interface` `nil` `switch` `case` `default` `break` `continue` `fallthrough` `defer` `go` `select` `chan` `map` `range`

**Literals.**

| Type | Examples | Notes |
|---|---|---|
| Integer | `42` `1_000` `0xFF` `0b1010` `0o17` | `_` separates digits |
| Floating point | `3.14` `1.5e3` | 64-bit |
| String | `"Hello\n"` | UTF-8; escapes `\n \t \r \0 \\ \" \'`, `\xHH`, `\uHHHH`, `\UHHHHHHHH` |
| Raw string | `` `c:\folder\n` `` | Between backticks, no escapes |
| Character | `'a'` | The character's code, as an integer |
| Boolean and nil | `true` `false` `nil` |  |

`literals.caju`:

```caju
a := 1_000; b := 0xFF; c := 0b1010; d := 0o17
print(a, b, c, d, 1.5e3)
print("tab\tquote\" \u00e9 \x41", `raw\n`, 'a')
```

```
$ caju run literals.caju
1000 255 10 15 1500
tab	quote" é A raw\n 97
```

## Types

Types are optional in declarations: without an annotation, the compiler infers them. With an annotation, a value of another type is a compile error.

| Type | Description |
|---|---|
| `int` | 64-bit signed integer |
| `int8` `int16` `int32` `int64` | Fixed-size signed integers |
| `uint` `uint8` `uint16` `uint32` `uint64` | Unsigned integers |
| `num` | 64-bit floating-point number. Accepts `int` values |
| `float32` | 32-bit floating point |
| `str` | UTF-8 text. `s[i]` is a `uint8`, `s[a:b]` the bytes from `a` to `b` (as they are, even if not UTF-8) and `len(s)` counts bytes |
| `bool` | `true` or `false` |
| `any` | Any value. Use a type assertion or type switch to recover the type |
| `error` | Interface with the method `Error() -> str` |

**Aliases.** `byte` = `uint8`, `rune` = `int32`, `string` = `str` and `float64` = `num`.

| Composite type | Form | Behavior |
|---|---|---|
| Array | `[3]int` | Fixed size; copied on assignment |
| Slice | `[]int` | A window over an array; grows with `append` |
| Map | `map[str]int` | Key and value; keys of basic types |
| Pointer | `*T` | `&x` gives the address, `*p` the value |
| Function | `fn(int) -> int` | Functions are values |
| Struct | `struct Point { x: int, y: int }` | A value with named fields |
| Interface | `interface Shape { area() -> num }` | A set of methods |

**Zero value.** A variable declared without a value starts with its type's zero value: `0`, `""`, `false`, `nil`, or a struct with all fields zeroed.

## Variables and constants

| Form | Effect |
|---|---|
| `x := 10` | Declares and infers the type from the value (here, `int`) |
| `let x: int = 10` | Declares with an explicit type |
| `let x: int` | Declares with the type's zero value |
| `let x = 0` | Without a type, `let` with a number infers `num`, so it can hold decimals later |
| `const N = 3` | Constant; requires a value |

> Variables are scoped to the whole function, not just the block. Don't declare the same name with different types in the same function.

`types.caju`:

```caju
x := 10
x = "ten"
```

```
$ caju run types.caju
Type error in types.caju, line 2: "x" (line 1) is int, but got str.
```

## Expressions and operators

| Group | Operators |
|---|---|
| Arithmetic | `+` `-` `*` `/` `%` `**` (power) |
| Bitwise | `&` `\|` `^` `&^` `<<` `>>` |
| Comparison | `==` `!=` `<` `<=` `>` `>=` |
| Logical | `&&` or `and`, `\|\|` or `or`, `!` or `not` |
| Assignment | `=` `:=` `+=` `-=` `*=` `/=` `%=` `&=` `\|=` `^=` `<<=` `>>=` `&^=` |
| Increment | `x++` `x--` |
| Pointers | `&x` (address) and `*p` (pointed-to value) |

`+` also concatenates strings. There is no `~`: to flip the bits, use `x ^ -1`.

**Conversions** are written as calls: `int(x)`, `num(x)`, `str(x)`, `uint8(x)`, `float32(x)`, `byte(x)`, `rune(x)` and so on.

`ops.caju`:

```caju
print(2 ** 10, 7 % 3, 6 &^ 3, 1 << 4, -8 >> 1)
print(true and not false, !true && false)
print(str(3.5), int(3.9), num(2))
```

```
$ caju run ops.caju
1024 1 4 16 -4
true false
3.5 3 2
```

## Control flow

**if** accepts a statement before the condition, separated by `;`. There are no parentheses around the condition.

**Loops.** There are four forms of `for`, plus `while`:

| Form | Example |
|---|---|
| Classic | `for i := 0; i < n; i++ { }` |
| Condition only | `for i < n { }` or `while i < n { }` |
| Range of numbers | `for i = 1 to 10 { }` (both bounds included) |
| range | `for i, v := range list { }` and `for k, v := range m { }` |

`break` and `continue` accept a label to exit or continue an outer loop.

**switch** compares against each `case`, which can list several values. Cases don't fall through to the next one unless they end with `fallthrough`.

`flow.caju`:

```caju
for j = 1 to 2 { print("j", j) }

outer: for p := 0; p < 3; p++ {
  for q := 0; q < 3; q++ {
    if q == 1 { continue outer }
    if p == 2 { break outer }
    print(p, q)
  }
}

i := 3
switch i {
case 1, 2: print("small")
case 3:
  print("three")
  fallthrough
default: print("default")
}
```

```
$ caju run flow.caju
j 1
j 2
0 0
1 0
three
default
```

## Functions

Functions are declared with `fn` at the top level of the file. Every parameter has a type. The result type comes after `->` and, if omitted, is inferred from the `return`.

A function can return multiple values, `-> (int, error)`, and results can be named: a bare `return` returns their current values.

Inside another function, create functions as values with `fn(...) { }`. They capture outer variables (closures).

`functions.caju`:

```caju
fn split(n: int) -> (q: int, r: int) {
  q = n / 10
  r = n % 10
  return
}
print(split(47))

add := fn(a: int, b: int) -> int { return a + b }
print(add(2, 3))
```

```
$ caju run functions.caju
4 7
5
```

> Declared functions don't accept a variable number of arguments. `...` spreads a list into a call, as in `append(a, b...)`.

## Structs, methods and interfaces

**Structs** group typed fields. A literal can give values in order, `Point{1, 2}`, or by name, `Point{y: 2}`. Fields left out get their zero value.

**Methods** are functions with a receiver: `fn (p: Point) dist()` receives a copy, and `fn (p: *Point) move()` receives the original and can modify it.

**Embedding** one struct in another gives the outer struct the inner one's fields and methods.

**Interfaces** are satisfied implicitly: a type satisfies an interface if it has its methods. An interface can embed another. `x.(T)` recovers the stored type and, with `v, ok := x.(T)`, does not panic.

`interfaces.caju`:

```caju
interface Named { name() -> str }
interface Greeter { Named; greet() -> str }

struct P { n: str }
fn (p: P) name() -> str { return p.n }
fn (p: P) greet() -> str { return "hi " + p.n }

gs := []Greeter{P{"ana"}}
print(gs[0].greet(), gs[0].name())
```

```
$ caju run interfaces.caju
hi ana ana
```

## Errors, defer and panic

Errors are values of type `error`. Create one with `errors.New("message")` or with any type that has an `Error() -> str` method. Functions that can fail return the error as their last result.

`defer` schedules a call for when the function returns; deferred calls run from last to first. `panic` stops execution and unwinds the calls; `recover`, inside a `defer`, stops the panic. Runtime errors, such as an index out of range, also panic.

`errors.caju`:

```caju
struct NotFound { name: str }
fn (e: *NotFound) Error() -> str { return e.name + " not found" }

fn find(name: str) -> error {
  if name != "caju" { return &NotFound{name} }
  return nil
}

err := find("mango")
if err != nil { print(err.Error()) }
```

```
$ caju run errors.caju
mango not found
```

## Built-in functions

| Function | Use |
|---|---|
| `print(a, b, ...)` | Prints the values separated by spaces, followed by a newline |
| `len(x)` and `cap(x)` | Length and capacity of strings, arrays, slices and maps |
| `append(s, v...)` | Appends values to a slice and returns the slice |
| `copy(dst, src)` | Copies elements and returns how many were copied |
| `delete(m, k)` | Removes a key from a map |
| `make(T, n, c)` | Creates slices and maps |
| `new(T)` | Allocates a zero value and returns a pointer |
| `panic(v)` and `recover()` | Stops execution, and recovers inside a defer |
| `errors.New(msg)` | Creates an error with the message |

## Modules and packages

Each file is a module. Only names declared with `export` can be used by other files.

| Import | Effect |
|---|---|
| `import "std/strings"` | Standard library, used as `strings.split(...)` |
| `import filepath "std/path"` | Imports under another name |
| `import { split, join } from "std/strings"` | Brings names in for direct use |
| `import "./mods/geo"` | Another file in the project, relative to the current one |
| `import "github.com/owner/package"` | Third-party package, installed with `caju pkg add` |

`mods/geo.caju`:

```caju
# mods/geo.caju
export struct Point { x: int, y: int }
export fn origin() -> Point { return Point{} }
fn hidden() -> int { return 1 }
```

`main.caju`:

```caju
import "./mods/geo"

print(geo.origin())
print(geo.hidden())
```

```
$ caju run main.caju
Link error in main.caju, line 4: "hidden" exists in ./mods/geo.caju,
but it is not exported. Write export before its declaration.
```

## Package manager

Caju comes with a package manager, `caju pkg`. There is no central server: a package is a GitHub repository with a `caju.toml` file at its root. The package name is the repository path, and that is the name programs import.

`caju.toml`:

```caju
[package]
name = "github.com/acme/strutil"
version = "1.1.0"
description = "Text helpers"
license = "MIT"

[dependencies]
"github.com/acme/other" = "1.0.0"
```

**Versions.** A published version is a git tag in the `vX.Y.Z` format, matching the `version` in `caju.toml`. If the two don't match, the package manager rejects the package.

**Version selection.** Each dependency states the *minimum* version it needs. When two packages ask for different versions of the same package, the highest of the minimums wins. So the result only changes when a `caju.toml` asks for a higher version, never because someone published a new one. Versions with different MAJOR numbers, such as 1.x and 2.x, are not compatible.

**Version locking.** `caju.lock` records, for every package used directly or indirectly, the version, the commit and a SHA-256 hash of its files. Commit it, so everyone compiles exactly the same files.

**Verification.** Before compiling, `caju build` and `caju run` check that `caju.lock` is up to date with `caju.toml` and that each package's files match the locked hash. Any mismatch stops the build:

`app.caju`:

```caju
import "github.com/acme/strutil"

print(strutil.shout("caju"))
```

```
$ caju run app.caju   # depois de alterar um arquivo do pacote
Package error: checksum mismatch for github.com/acme/strutil@1.1.0
  caju.lock: sha256:aa012c96e037f3527d565bae3fbcb84c459070d694f2276e8149582ced94ee9a
  files:     sha256:67e6d47f83afb261e6971681c489a422c30f146d8fac2adf0732a7dba5f62756
```

| Command | What it does |
|---|---|
| `caju pkg init [name]` | Creates the project's `caju.toml` |
| `caju pkg add name[@version]` | Adds a dependency (default: the latest published version) |
| `caju pkg remove name` | Removes a dependency |
| `caju pkg update [name]` | Updates dependencies to the latest published version |
| `caju pkg install` | Downloads what's missing and verifies everything against `caju.lock` |
| `caju pkg verify` | Checks cached packages against the hashes in the lock file |
| `caju pkg tree` | Shows the dependency tree |
| `caju pkg cache list\|verify\|clean` | The packages downloaded on this machine, shared by every project and checked against their hash on every reuse |
| `caju pkg hash [dir]` | Computes the hash of a package directory |

**Where they live.** Packages are downloaded with `git` (the version tag) into the cache at `~/.caju/pkg`. `add`, `remove` and `update` edit only the `[dependencies]` section of `caju.toml`, leaving the rest of the file untouched.

> Within a package, files import each other by full path, as in `import "github.com/acme/strutil/extra"`, and a package should only import what is in its own `[dependencies]`.

## System calls on Windows

`extern` declares a function from a Windows DLL, using the `stdcall` (default) or `cdecl` calling convention. Parameters use interface types: `i32`, `u32`, `i64`, `u64`, `f32`, `f64`, `ptr`, `bool`, `str` and `wstr`, and the result can be `void`. These calls are only available in programs compiled with `--target windows`.

`message.caju`:

```caju
extern "user32.dll" fn MessageBoxA(hwnd: ptr, text: str, title: str, flags: u32) -> i32

MessageBoxA(0, "Hello from Caju", "caju", 0)
```

## Building and tools

| Command | What it does |
|---|---|
| `caju run file.caju` | Compiles in memory and runs |
| `caju build -o app file.caju` | Builds a Linux executable (ELF) |
| `caju build --target windows file.caju` | Builds a Windows `.exe` (PE) |
| `caju build --target wasm -o app.wasm file.caju` | Builds a WebAssembly module (runs in Node or in the browser) |
| `caju test` | Runs the `_test.caju` files |
| `caju pkg ...` | Package manager (see the previous section) |
| `caju version` | Shows the version |

## In progress

- Goroutines, channels and `select` in the native compiler. The keywords `go`, `chan` and `select` are already reserved.
- On Windows: `alloc`, `peek`, `poke`, `readstr`, `dllexport` and native DLLs.
- Maps with struct, array or `any` keys.
