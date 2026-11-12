# Command line programs (`std/cli`)

`std/cli` declares the commands, flags and arguments of a program and does the rest: parsing,
validation, defaults, environment variables, the help text, `--version` and clear errors. The
`caju` command itself is built with it (`compiler/main.caju`, `compiler/pkg.caju`).

```
import "std/cli"
import "std/os"

app := cli.app("greet", "Greets people").version("1.0.0")
app.flag_bool("loud", "l", "shout")
app.flag_str("greeting", "g", "text", "Hello", "the word to greet with").env("GREET_WORD")
app.args("names", "who to greet").min(1)
app.action(fn(m: *cli.Match) {
  for _, n := range m.args("names") {
    s := m.str("greeting") + ", " + n
    if m.bool("loud") { s += "!" }
    print(s)
  }
})
app.run(os.args()[1:])
```

```
$ greet -l Ana Bia
Hello, Ana!
Hello, Bia!
$ greet --help
greet: Greets people

Usage:
  greet [options] <names...>

Arguments:
  names  who to greet

Options:
  -l, --loud             shout
  -g, --greeting <text>  the word to greet with (default: Hello; env: GREET_WORD)
  -h, --help             show this help
      --version          show the version
$ greet --greting Oi Ana
greet: unknown flag --greting (did you mean --greeting?)
Run "greet --help" for usage.
```

## Commands

| Call | What it declares |
|---|---|
| `cli.app(name, summary)` | the program (the root command) |
| `c.sub(name, summary)` | a subcommand; subcommands nest (`caju pkg cache clean`) |
| `c.alias(name)` | another name for the command |
| `c.describe(text)` | more text for the help, after the summary |
| `c.example(cmdline, what)` | an example in the help |
| `c.version(v)` | the version `--version` prints (root command) |
| `c.action(fn(m: *cli.Match) {...})` | what runs when the command is chosen |
| `c.hidden()` | works, but is left out of the help |

`help <command>` (on a command with subcommands), `-h` and `--help` print the help of the command;
a command with subcommands and no action prints its help when called alone.

## Flags

| Call | Value | Read with |
|---|---|---|
| `c.flag_bool(name, short, help)` | none (`--name`, `--name=false`) | `m.bool(name)` |
| `c.flag_str(name, short, value_name, default, help)` | text | `m.str(name)` |
| `c.flag_int(name, short, value_name, default, help)` | integer (checked) | `m.int(name)` |
| `c.flag_list(name, short, value_name, help)` | text, many times | `m.list(name)` |

`short` is one letter or `""`. Modifiers, chained on the flag: `.choices([]str{...})` (only these
values), `.required()`, `.env("VAR")` (used when the flag is not given), `.default_text("...")` (how
the help describes the default), `.hidden()`. `m.has(name)` says whether the flag was given.

Accepted forms: `--name value`, `--name=value`, `-n value`, `-nvalue`, bool letters together
(`-abc`, the last one may take a value: `-vj 4`). `--` ends the flags. A flag declared on a command
also works on its subcommands, before or after their names.

## Arguments

| Call | What it takes | Read with |
|---|---|---|
| `c.arg(name, help)` | one required value | `m.arg(name)` |
| `c.arg_opt(name, help)` | one optional value (`""` when missing) | `m.arg(name)` |
| `c.args(name, help)` | the remaining values; `.min(n)` requires n | `m.args(name)` |

`.raw()` on a variadic argument passes everything after the arguments before it as it is, flags
included: `caju run file.caju -x --y` gives `-x --y` to the program.

## Running

- `c.run(argv)`: parses, prints help/version/errors and runs the action; exits with 2 on a usage
  error.
- `c.execute(argv) -> int`: the same, but returns the exit code.
- `c.parse(argv) -> (*Match, error)`: only parses (for tests, or to dispatch on your own);
  `m.path()` is the chosen command (`"caju pkg add"`), `m.help` / `m.show_version` say whether
  `-h`/`--version` were given.
- `c.help()`, `c.usage()`: the texts, for documentation.

Declaration mistakes (the same flag twice, a required argument after an optional one, reading a
flag that does not exist) are panics: they are bugs in the program, not user errors.
