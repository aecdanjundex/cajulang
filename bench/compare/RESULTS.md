# Caju × Go × Rust × Python

2026-11-11 11:10 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.3.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 1 ms | 3 ms | 1 ms | 28 ms | 0.5× | 0.9× | 22.4× |
| fib | 30 | 3 ms | 5 ms | 3 ms | 125 ms | 0.6× | 1.1× | 36.5× |
| fib | 35 | 25 ms | 38 ms | 21 ms | 1.22 s | 0.7× | 1.2× | 48.1× |
| sieve | 100k | 1 ms | 2 ms | 1 ms | 37 ms | 0.6× | 1.0× | 25.7× |
| sieve | 1M | 4 ms | 4 ms | 4 ms | 215 ms | 1.0× | 1.1× | 57.3× |
| sieve | 10M | 21 ms | 20 ms | 20 ms | 2.10 s | 1.1× | 1.0× | 100.0× |
| nbody | 10k | 2 ms | 4 ms | 2 ms | 107 ms | 0.4× | 0.9× | 66.1× |
| nbody | 100k | 7 ms | 19 ms | 8 ms | 915 ms | 0.4× | 0.9× | 124.1× |
| nbody | 1M | 64 ms | 176 ms | 66 ms | 9.02 s | 0.4× | 1.0× | 139.9× |
| mandelbrot | 250 | 4 ms | 4 ms | 4 ms | 391 ms | 0.8× | 0.9× | 107.7× |
| mandelbrot | 500 | 11 ms | 11 ms | 11 ms | 1.65 s | 1.0× | 1.0× | 152.5× |
| mandelbrot | 1k | 39 ms | 38 ms | 38 ms | 6.24 s | 1.0× | 1.0× | 158.5× |
| matmul | 100 | 2 ms | 4 ms | 2 ms | 231 ms | 0.4× | 1.0× | 135.2× |
| matmul | 200 | 4 ms | 12 ms | 5 ms | 1.78 s | 0.4× | 0.8× | 396.9× |
| matmul | 300 | 11 ms | 32 ms | 12 ms | 6.28 s | 0.3× | 0.9× | 581.4× |
| sort | 100k | 8 ms | 9 ms | 8 ms | 270 ms | 1.0× | 1.1× | 32.9× |
| sort | 500k | 34 ms | 36 ms | 33 ms | 1.51 s | 0.9× | 1.0× | 44.3× |
| sort | 2M | 141 ms | 141 ms | 134 ms | 7.01 s | 1.0× | 1.1× | 49.9× |
| maps | 100k | 9 ms | 10 ms | 7 ms | 71 ms | 0.9× | 1.3× | 8.0× |
| maps | 1M | 108 ms | 158 ms | 102 ms | 567 ms | 0.7× | 1.1× | 5.3× |
| maps | 3M | 538 ms | 592 ms | 337 ms | 1.87 s | 0.9× | 1.6× | 3.5× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 2.2 MB | 5.7 MB | 2.1 MB | 10.1 MB |
| sieve | 10M | 13.3 MB | 15.5 MB | 11.5 MB | 86.3 MB |
| nbody | 1M | 2.2 MB | 5.7 MB | 2.1 MB | 10.6 MB |
| mandelbrot | 1k | 2.2 MB | 5.6 MB | 2.1 MB | 10.1 MB |
| matmul | 300 | 4.2 MB | 7.7 MB | 4.0 MB | 14.9 MB |
| sort | 2M | 17.7 MB | 21.9 MB | 17.1 MB | 86.6 MB |
| maps | 3M | 44.0 MB | 50.4 MB | 53.1 MB | 215.7 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 85 KB, 107 ms | 2298 KB, 188 ms | 4436 KB, 184 ms |
| sieve | 85 KB, 99 ms | 2297 KB, 181 ms | 4435 KB, 183 ms |
| nbody | 98 KB, 98 ms | 2303 KB, 166 ms | 4438 KB, 189 ms |
| mandelbrot | 89 KB, 101 ms | 2298 KB, 173 ms | 4435 KB, 171 ms |
| matmul | 89 KB, 105 ms | 2298 KB, 191 ms | 4437 KB, 201 ms |
| sort | 89 KB, 118 ms | 2299 KB, 188 ms | 4437 KB, 216 ms |
| maps | 89 KB, 99 ms | 2299 KB, 185 ms | 4458 KB, 305 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
