# Caju × Go × Rust × Python

2026-11-11 06:14 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.1.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | 1 ms | 26 ms | 0.7× | 1.3× | 15.6× |
| fib | 30 | 5 ms | 5 ms | 3 ms | 125 ms | 1.0× | 1.7× | 24.4× |
| fib | 35 | 41 ms | 38 ms | 21 ms | 1.21 s | 1.1× | 2.0× | 29.2× |
| sieve | 100k | 1 ms | 2 ms | 1 ms | 37 ms | 0.7× | 1.0× | 26.4× |
| sieve | 1M | 3 ms | 4 ms | 3 ms | 215 ms | 0.8× | 1.0× | 67.8× |
| sieve | 10M | 20 ms | 20 ms | 19 ms | 2.06 s | 1.0× | 1.1× | 100.9× |
| nbody | 10k | 3 ms | 4 ms | 2 ms | 106 ms | 0.8× | 1.5× | 34.2× |
| nbody | 100k | 20 ms | 19 ms | 8 ms | 912 ms | 1.0× | 2.5× | 46.1× |
| nbody | 1M | 181 ms | 171 ms | 67 ms | 9.00 s | 1.1× | 2.7× | 49.8× |
| mandelbrot | 250 | 4 ms | 4 ms | 4 ms | 413 ms | 0.8× | 0.9× | 115.2× |
| mandelbrot | 500 | 11 ms | 11 ms | 10 ms | 1.61 s | 1.0× | 1.1× | 147.0× |
| mandelbrot | 1k | 40 ms | 38 ms | 37 ms | 6.17 s | 1.0× | 1.1× | 155.9× |
| matmul | 100 | 3 ms | 3 ms | 2 ms | 217 ms | 0.8× | 1.4× | 85.2× |
| matmul | 200 | 11 ms | 11 ms | 4 ms | 1.56 s | 1.0× | 2.6× | 137.6× |
| matmul | 300 | 34 ms | 31 ms | 11 ms | 5.70 s | 1.1× | 3.1× | 166.0× |
| sort | 100k | 9 ms | 8 ms | 7 ms | 241 ms | 1.0× | 1.2× | 28.0× |
| sort | 500k | 41 ms | 35 ms | 33 ms | 1.45 s | 1.2× | 1.2× | 35.6× |
| sort | 2M | 169 ms | 140 ms | 134 ms | 6.59 s | 1.2× | 1.3× | 39.1× |
| maps | 100k | 11 ms | 10 ms | 6 ms | 66 ms | 1.2× | 1.7× | 6.0× |
| maps | 1M | 145 ms | 146 ms | 95 ms | 566 ms | 1.0× | 1.5× | 3.9× |
| maps | 3M | 643 ms | 553 ms | 315 ms | 1.87 s | 1.2× | 2.0× | 2.9× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 0.7 MB | 5.7 MB | 2.1 MB | 10.1 MB |
| sieve | 10M | 14.0 MB | 15.9 MB | 11.5 MB | 86.4 MB |
| nbody | 1M | 2.7 MB | 5.6 MB | 2.0 MB | 10.5 MB |
| mandelbrot | 1k | 0.6 MB | 5.6 MB | 2.1 MB | 10.1 MB |
| matmul | 300 | 5.7 MB | 7.6 MB | 4.0 MB | 14.9 MB |
| sort | 2M | 17.0 MB | 21.2 MB | 17.3 MB | 86.7 MB |
| maps | 3M | 128.4 MB | 52.5 MB | 53.2 MB | 215.8 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 81 KB, 127 ms | 2298 KB, 173 ms | 4436 KB, 206 ms |
| sieve | 81 KB, 127 ms | 2297 KB, 164 ms | 4435 KB, 160 ms |
| nbody | 90 KB, 125 ms | 2303 KB, 165 ms | 4438 KB, 184 ms |
| mandelbrot | 81 KB, 124 ms | 2298 KB, 165 ms | 4435 KB, 161 ms |
| matmul | 85 KB, 124 ms | 2298 KB, 166 ms | 4437 KB, 194 ms |
| sort | 85 KB, 132 ms | 2299 KB, 166 ms | 4437 KB, 177 ms |
| maps | 81 KB, 122 ms | 2299 KB, 170 ms | 4458 KB, 285 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
