# Caju × Go × Rust × Python

2026-11-10 19:47 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.1.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 3 ms | 3 ms | 2 ms | 27 ms | 0.9× | 1.6× | 10.6× |
| fib | 30 | 13 ms | 6 ms | 3 ms | 127 ms | 2.4× | 4.1× | 9.7× |
| fib | 35 | 125 ms | 39 ms | 21 ms | 1.22 s | 3.2× | 6.0× | 9.8× |
| sieve | 100k | 6 ms | 2 ms | 1 ms | 36 ms | 2.5× | 3.9× | 6.5× |
| sieve | 1M | 42 ms | 4 ms | 4 ms | 218 ms | 10.7× | 11.4× | 5.2× |
| sieve | 10M | 438 ms | 24 ms | 24 ms | 2.10 s | 18.1× | 18.1× | 4.8× |
| nbody | 10k | 9 ms | 4 ms | 2 ms | 109 ms | 2.3× | 4.0× | 12.3× |
| nbody | 100k | 75 ms | 20 ms | 8 ms | 920 ms | 3.8× | 9.3× | 12.3× |
| nbody | 1M | 727 ms | 172 ms | 66 ms | 9.08 s | 4.2× | 11.0× | 12.5× |
| mandelbrot | 250 | 17 ms | 5 ms | 4 ms | 436 ms | 3.7× | 4.3× | 25.5× |
| mandelbrot | 500 | 65 ms | 12 ms | 11 ms | 1.58 s | 5.3× | 5.8× | 24.3× |
| mandelbrot | 1k | 243 ms | 38 ms | 38 ms | 6.18 s | 6.5× | 6.4× | 25.5× |
| matmul | 100 | 12 ms | 4 ms | 2 ms | 217 ms | 3.3× | 6.5× | 18.6× |
| matmul | 200 | 78 ms | 11 ms | 4 ms | 1.65 s | 7.0× | 17.5× | 21.0× |
| matmul | 300 | 253 ms | 32 ms | 11 ms | 5.72 s | 7.9× | 22.3× | 22.7× |
| sort | 100k | 28 ms | 8 ms | 8 ms | 244 ms | 3.5× | 3.8× | 8.6× |
| sort | 500k | 151 ms | 37 ms | 34 ms | 1.47 s | 4.1× | 4.5× | 9.7× |
| sort | 2M | 635 ms | 141 ms | 135 ms | 6.94 s | 4.5× | 4.7× | 10.9× |
| maps | 100k | 34 ms | 9 ms | 6 ms | 69 ms | 3.7× | 5.6× | 2.0× |
| maps | 1M | 558 ms | 163 ms | 99 ms | 593 ms | 3.4× | 5.6× | 1.1× |
| maps | 3M | 2.04 s | 599 ms | 359 ms | 1.91 s | 3.4× | 5.7× | 0.9× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 0.7 MB | 5.7 MB | 2.1 MB | 10.2 MB |
| sieve | 10M | 78.8 MB | 15.6 MB | 11.6 MB | 86.3 MB |
| nbody | 1M | 2.5 MB | 5.7 MB | 2.2 MB | 10.6 MB |
| mandelbrot | 1k | 2.4 MB | 5.7 MB | 2.2 MB | 10.2 MB |
| matmul | 300 | 5.8 MB | 7.7 MB | 4.0 MB | 14.9 MB |
| sort | 2M | 17.4 MB | 20.3 MB | 17.2 MB | 86.6 MB |
| maps | 3M | 146.0 MB | 50.5 MB | 53.2 MB | 215.8 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 136 KB, 248 ms | 2298 KB, 2078 ms | 4436 KB, 187 ms |
| sieve | 136 KB, 260 ms | 2297 KB, 271 ms | 4435 KB, 169 ms |
| nbody | 148 KB, 273 ms | 2303 KB, 259 ms | 4438 KB, 184 ms |
| mandelbrot | 140 KB, 258 ms | 2298 KB, 284 ms | 4435 KB, 177 ms |
| matmul | 140 KB, 263 ms | 2298 KB, 295 ms | 4437 KB, 194 ms |
| sort | 140 KB, 252 ms | 2299 KB, 259 ms | 4437 KB, 181 ms |
| maps | 140 KB, 250 ms | 2299 KB, 257 ms | 4458 KB, 290 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
