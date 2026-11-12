# std/json: speed (ns per operation, lower is better)

Microbenchmark `bench/json/bench.caju` and its Go equivalent, `bench/json/bench.go`
(`encoding/json`, Go 1.27). Ryzen 7 5700G, WSL2; best of 5 runs.

```sh
CAJU_ROOT=$PWD build/caju build -o /tmp/jb bench/json/bench.caju && /tmp/jb
cd bench/json && go run bench.go
```

| case | Caju before | Caju after | Go | gain | Caju ÷ Go |
|---|--:|--:|--:|--:|--:|
| marshal of []User with 50 items | 95,108 | **12,544** | 11,179 | 7.6× | 1.12 |
| marshal of a small map[str]any | 2,400 | **1,194** | 936 | 2.0× | 1.28 |
| unmarshal of one User | 4,353 | **1,058** | 498 | 4.1× | 2.12 |
| unmarshal of []User with 50 items | 737,255 | **36,395** | 23,219 | 20.3× | 1.57 |
| parse of a medium document (Go: into `any`) | 178,033 | **65,218** | 35,808 | 2.7× | 1.82 |
| unmarshal of the medium document into a struct | 217,372 | **20,822** | 12,092 | 10.4× | 1.72 |
| marshal of the medium document | 55,045 | **8,082** | 5,950 | 6.8× | 1.36 |

User = {id int, name str, email str, active bool}. The medium document has a string with escapes,
an integer, a floating-point number, a list of strings, a User, 20 Users and a map[str]int.

## What changed (lib/json.caju)

**marshal**
- A plan per struct type (`Plan`, cached per descriptor): names already quoted (`"name":` and
  `,"name":`), descriptors and embedded fields computed once (before: `embedded()` compared type
  names for every field of every item).
- Its own buffer (`Enc.mem`) that copies 8 bytes at a time and is reused across calls
  (`spare_mem`; a marshal inside an `Error` method uses another one). `strings.Builder` copied
  byte by byte and grew 256 → 4 KB on every call.
- Integers written straight into the buffer; strings without escapes copied in one go; `str`,
  `int` and `bool` handled in the field loop, without going through `word`.
- `e.err != ""` turned into a string comparison call for every field: now `len(e.err) != 0`.
- `&first` allocated a cell per struct: it is now a return value.
- Floating-point numbers: a fast path (`short_fixed`, the fewest digits that read back the same,
  checked with `parse_float`) before the exact `toml.format_float`, which uses big numbers.
  Identical to the old one on 131,815 random values.
- Maps: keys and values in two lists sorted together (before: an auxiliary map).

**unmarshal**
- Before: built the whole `json.Value` tree (one object per value, one map per object, one copy
  with UTF-8 validation per string) and then walked it.
- Now, two passes over the text, with no tree:
  1. `vtyped` validates the syntax (the same grammar and limits as `parse`) and checks that each
     value fits its place according to the target type: type, integer range, keys with escapes,
     repeated fields, structs with an embedded field... It records the number of items in each
     list and, for each struct key, the chosen field and where the value starts.
  2. `Fast` decodes straight into memory following the descriptors, without rereading the keys.
  If the first pass rejects the input, the old tree-based decoder runs, which gives the same
  error messages as before. Since the rejection comes before any write, text with a syntax error
  still leaves the target value untouched.
- `parse`: `p.word("true")` did `p.s[p.i:]` (copying and revalidating the whole rest of the text
  on every true/false/null); ASCII strings and numbers skip the UTF-8 revalidation.

## How it was verified
- `lib/json_test.caju`: 9 new tests (each field type, nil, 1-byte bool lists, int8..uint32
  ranges, repeated and case-insensitive keys, escapes in keys, syntax error without a partial
  write, marshal inside `Error`); all 37 tests also pass with the old library.
- Differential test (outside the repository): 100 thousand generated JSON documents (right and
  wrong types, repeated and uppercase keys, escapes, UTF-8, whitespace, truncated documents)
  decoded by the new path and by the tree decoder, into zeroed and pre-filled values and into
  []T, map[str]*T and any: no differences, also with garbage collection every 64 KB. The output
  of marshal and marshal_indent for 6 thousand values (884 thousand lines) is identical to the
  previous version's.
- Full suite: 794 pass, 0 fail, 9 skipped.

## What still separates it from Go
The rest is mostly the generated code (each field access goes through memory with a nil check,
small calls are not inlined): see `tools/disasm.sh`. The tree-based `parse` pays one allocation
per value and one map per object, inherent to the `json.Value` format.

## Round 2: leaf functions and reused tables (2026-11-11)

The starting point already includes allocation round 26 (OPTIMIZATION.md), which lowered
everything a little. Best of 5 runs, ns per operation:

| case | Caju before | Caju after | Go | Caju ÷ Go |
|---|--:|--:|--:|--:|
| marshal of []User with 50 items | 11,672 | **7,859** | 10,701 | 0.73 |
| marshal of a small map[str]any | 549 | **549** | 896 | 0.61 |
| unmarshal of one User | 648 | **473** | 490 | 0.97 |
| unmarshal of []User with 50 items | 27,301 | **18,653** | 22,320 | 0.84 |
| parse of a medium document | 31,579 | **31,613** | 34,197 | 0.92 |
| unmarshal of the medium document | 14,278 | **10,498** | 11,685 | 0.90 |
| marshal of the medium document | 6,348 | **4,801** | 5,757 | 0.83 |

In the HTTP server (bench/http, 1 CPU, `split.sh`), `GET /users` (50 items): user CPU per
request 20.1 → 15.2 µs, 34.1k → 37.2k–38.9k req/s; `POST /users`: 7.2 → 5.4 µs.

Hypotheses:

| | idea | result |
|---|---|---|
| J1 | "flat" structs (only str, int and bool, no embedded fields) in compact marshal: space for the whole object reserved once, written by call-free leaf functions (`wcopy`, `wquote` with 8 bytes at a time/SWAR, `wint`), hence with the variables in registers (`Enc.flat`); a list of flat structs calls `flat` directly | accepted: 11,672 → 7,859 |
| J2a | checking (VScan) of str/int/bool field values by leaf functions (`plain_end` SWAR, `int_end`, `bool_end`) instead of `typed()` | accepted: 27.3k → 24.2k |
| J2b | the same on the writing side (Fast: `int_at`, bool directly) | rejected (tie); only `plain_end` in `str_word` stays |
| J2c | a flat struct object validated entirely in a leaf function (`vflat`): exact keys by the hint and then by the list, each field once, simple values; writes the [field, position] pairs straight into the `keys` block; anything else (null, unknown key or key with different case, escape, number that is not a simple integer) falls back to the general path | accepted: 24.2k → 21.7k |
| J2d | VScan's `keys` and `arrs` tables reused across calls (`spare_keys`, `spare_arrs`) | accepted: 21.7k → 18.7k; one User: 540 → 473 |
| J3 | generator changes (inline small functions, fewer nil checks) | not done: the leaf functions in the library already beat Go without touching the compiler |
| J4 | parse tree with fewer allocations | not done: parse is already below Go (31.6k vs. 34.2k) |

Verification: the 42 tests in lib/json_test.caju (5 new ones for the flat paths) also pass with
the old library; a 26-thousand-line differential test (random flat structs with escapes and
UTF-8, 20 thousand random JSON objects with whitespace, out-of-order keys, unknown keys, keys with
different case, null, invalid numbers and errors) produces output identical to the old library's,
also with a collection every 64 KB.
