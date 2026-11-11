# Caju × Go × Rust × Python

2026-11-11 11:04 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.3.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 1 ms | 2 ms | 1 ms | 26 ms | 0.5× | 0.8× | 24.1× |
| fib | 30 | 3 ms | 5 ms | 3 ms | 124 ms | 0.6× | 1.0× | 39.1× |
| fib | 35 | 25 ms | 39 ms | 21 ms | 1.21 s | 0.7× | 1.2× | 47.8× |
| sieve | 100k | 1 ms | 2 ms | 1 ms | 36 ms | 0.6× | 0.9× | 30.7× |
| sieve | 1M | 3 ms | 4 ms | 3 ms | 226 ms | 0.8× | 0.9× | 75.0× |
| sieve | 10M | 21 ms | 20 ms | 20 ms | 2.08 s | 1.0× | 1.0× | 100.5× |
| nbody | 10k | 2 ms | 4 ms | 2 ms | 106 ms | 0.5× | 1.0× | 55.0× |
| nbody | 100k | 7 ms | 19 ms | 8 ms | 913 ms | 0.4× | 1.0× | 122.7× |
| nbody | 1M | 65 ms | 171 ms | 66 ms | 9.06 s | 0.4× | 1.0× | 140.3× |
| mandelbrot | 250 | 4 ms | 4 ms | 4 ms | 408 ms | 0.8× | 1.0× | 116.2× |
| mandelbrot | 500 | 11 ms | 11 ms | 11 ms | 1.53 s | 1.0× | 1.0× | 138.6× |
| mandelbrot | 1k | 39 ms | 38 ms | 38 ms | 6.32 s | 1.0× | 1.0× | 161.3× |
| matmul | 100 | 1 ms | 3 ms | 2 ms | 215 ms | 0.5× | 0.8× | 154.2× |
| matmul | 200 | 4 ms | 11 ms | 5 ms | 1.58 s | 0.3× | 0.8× | 424.6× |
| matmul | 300 | 10 ms | 31 ms | 11 ms | 5.69 s | 0.3× | 0.9× | 593.5× |
| sort | 100k | 7 ms | 8 ms | 7 ms | 243 ms | 0.9× | 1.0× | 32.5× |
| sort | 500k | 34 ms | 36 ms | 33 ms | 1.48 s | 1.0× | 1.0× | 43.5× |
| sort | 2M | 141 ms | 141 ms | 135 ms | 7.15 s | 1.0× | 1.0× | 50.9× |
| maps | 100k | 10 ms | 11 ms | 8 ms | 74 ms | 0.9× | 1.2× | 7.7× |
| maps | 1M | 108 ms | 164 ms | 101 ms | 568 ms | 0.7× | 1.1× | 5.2× |
| maps | 3M | 609 ms | 588 ms | 341 ms | 1.88 s | 1.0× | 1.8× | 3.1× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 2.2 MB | 5.7 MB | 2.1 MB | 10.1 MB |
| sieve | 10M | 13.4 MB | 16.0 MB | 11.6 MB | 86.3 MB |
| nbody | 1M | 2.2 MB | 5.7 MB | 2.1 MB | 10.6 MB |
| mandelbrot | 1k | 2.2 MB | 5.7 MB | 2.1 MB | 10.1 MB |
| matmul | 300 | 5.5 MB | 7.7 MB | 4.0 MB | 14.8 MB |
| sort | 2M | 19.5 MB | 21.8 MB | 17.2 MB | 86.6 MB |
| maps | 3M | 44.0 MB | 50.5 MB | 53.2 MB | 215.7 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 85 KB, 96 ms | 2298 KB, 292 ms | 4436 KB, 214 ms |
| sieve | 85 KB, 95 ms | 2297 KB, 264 ms | 4435 KB, 199 ms |
| nbody | 98 KB, 98 ms | 2303 KB, 263 ms | 4438 KB, 222 ms |
| mandelbrot | 89 KB, 98 ms | 2298 KB, 271 ms | 4435 KB, 158 ms |
| matmul | 89 KB, 107 ms | 2298 KB, 291 ms | 4437 KB, 194 ms |
| sort | 89 KB, 99 ms | 2299 KB, 261 ms | 4437 KB, 191 ms |
| maps | 89 KB, 104 ms | 2298 KB, 335 ms | 4458 KB, 432 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
