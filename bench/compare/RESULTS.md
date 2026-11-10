# Caju × Go × Rust × Python

2026-11-10 20:26 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.1.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | 2 ms | 27 ms | 0.8× | 1.2× | 14.4× |
| fib | 30 | 8 ms | 6 ms | 3 ms | 127 ms | 1.4× | 2.4× | 16.7× |
| fib | 35 | 67 ms | 39 ms | 21 ms | 1.29 s | 1.7× | 3.1× | 19.4× |
| sieve | 100k | 3 ms | 2 ms | 2 ms | 41 ms | 1.5× | 1.7× | 13.4× |
| sieve | 1M | 17 ms | 4 ms | 4 ms | 221 ms | 4.3× | 4.7× | 12.7× |
| sieve | 10M | 207 ms | 33 ms | 44 ms | 2.11 s | 6.3× | 4.7× | 10.2× |
| nbody | 10k | 6 ms | 4 ms | 2 ms | 109 ms | 1.3× | 2.6× | 18.8× |
| nbody | 100k | 44 ms | 20 ms | 8 ms | 925 ms | 2.2× | 5.4× | 21.2× |
| nbody | 1M | 418 ms | 173 ms | 68 ms | 9.13 s | 2.4× | 6.2× | 21.8× |
| mandelbrot | 250 | 7 ms | 5 ms | 4 ms | 434 ms | 1.5× | 1.9× | 58.3× |
| mandelbrot | 500 | 25 ms | 12 ms | 11 ms | 1.61 s | 2.1× | 2.3× | 65.3× |
| mandelbrot | 1k | 94 ms | 38 ms | 39 ms | 6.63 s | 2.4× | 2.4× | 70.4× |
| matmul | 100 | 7 ms | 4 ms | 2 ms | 221 ms | 2.0× | 3.1× | 31.7× |
| matmul | 200 | 45 ms | 11 ms | 5 ms | 1.67 s | 4.1× | 9.4× | 37.0× |
| matmul | 300 | 145 ms | 32 ms | 12 ms | 5.91 s | 4.5× | 12.0× | 40.7× |
| sort | 100k | 14 ms | 8 ms | 8 ms | 259 ms | 1.6× | 1.8× | 18.7× |
| sort | 500k | 67 ms | 37 ms | 33 ms | 1.62 s | 1.8× | 2.0× | 24.0× |
| sort | 2M | 287 ms | 140 ms | 136 ms | 7.65 s | 2.0× | 2.1× | 26.7× |
| maps | 100k | 12 ms | 10 ms | 7 ms | 77 ms | 1.2× | 1.7× | 6.5× |
| maps | 1M | 275 ms | 175 ms | 103 ms | 582 ms | 1.6× | 2.7× | 2.1× |
| maps | 3M | 935 ms | 612 ms | 354 ms | 2.04 s | 1.5× | 2.6× | 2.2× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 2.6 MB | 5.7 MB | 2.2 MB | 10.3 MB |
| sieve | 10M | 78.4 MB | 15.1 MB | 11.6 MB | 86.3 MB |
| nbody | 1M | 2.2 MB | 5.7 MB | 2.2 MB | 10.6 MB |
| mandelbrot | 1k | 2.5 MB | 5.7 MB | 2.2 MB | 10.2 MB |
| matmul | 300 | 5.7 MB | 7.7 MB | 4.0 MB | 14.9 MB |
| sort | 2M | 19.6 MB | 21.3 MB | 17.3 MB | 86.7 MB |
| maps | 3M | 145.5 MB | 48.6 MB | 53.2 MB | 215.7 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 99 KB, 139 ms | 2298 KB, 186 ms | 4436 KB, 197 ms |
| sieve | 99 KB, 134 ms | 2297 KB, 173 ms | 4435 KB, 193 ms |
| nbody | 104 KB, 140 ms | 2303 KB, 176 ms | 4438 KB, 194 ms |
| mandelbrot | 100 KB, 127 ms | 2298 KB, 177 ms | 4435 KB, 175 ms |
| matmul | 99 KB, 148 ms | 2298 KB, 194 ms | 4437 KB, 203 ms |
| sort | 99 KB, 140 ms | 2299 KB, 175 ms | 4437 KB, 196 ms |
| maps | 99 KB, 123 ms | 2299 KB, 168 ms | 4458 KB, 303 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
