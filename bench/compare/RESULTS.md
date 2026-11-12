# Caju × Go × Rust × Python

2026-11-11 11:44 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.3.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 1 ms | 2 ms | 2 ms | 27 ms | 0.5× | 0.8× | 22.2× |
| fib | 30 | 4 ms | 6 ms | 3 ms | 127 ms | 0.6× | 1.0× | 36.0× |
| fib | 35 | 25 ms | 38 ms | 21 ms | 1.21 s | 0.7× | 1.2× | 48.0× |
| sieve | 100k | 1 ms | 2 ms | 2 ms | 38 ms | 0.5× | 0.8× | 31.6× |
| sieve | 1M | 3 ms | 4 ms | 3 ms | 216 ms | 0.9× | 1.0× | 66.2× |
| sieve | 10M | 22 ms | 21 ms | 24 ms | 2.17 s | 1.0× | 0.9× | 99.3× |
| nbody | 10k | 2 ms | 4 ms | 2 ms | 108 ms | 0.5× | 0.9× | 58.8× |
| nbody | 100k | 8 ms | 19 ms | 8 ms | 921 ms | 0.4× | 0.9× | 118.1× |
| nbody | 1M | 66 ms | 173 ms | 66 ms | 9.10 s | 0.4× | 1.0× | 138.3× |
| mandelbrot | 250 | 4 ms | 5 ms | 4 ms | 435 ms | 0.8× | 1.1× | 99.8× |
| mandelbrot | 500 | 11 ms | 11 ms | 11 ms | 1.51 s | 1.0× | 1.0× | 134.7× |
| mandelbrot | 1k | 39 ms | 38 ms | 37 ms | 6.40 s | 1.0× | 1.0× | 164.8× |
| matmul | 100 | 2 ms | 3 ms | 2 ms | 216 ms | 0.5× | 0.9× | 140.0× |
| matmul | 200 | 4 ms | 11 ms | 4 ms | 1.57 s | 0.4× | 0.9× | 383.4× |
| matmul | 300 | 10 ms | 32 ms | 11 ms | 5.86 s | 0.3× | 0.9× | 574.4× |
| sort | 100k | 7 ms | 8 ms | 7 ms | 261 ms | 0.9× | 1.0× | 35.8× |
| sort | 500k | 34 ms | 36 ms | 33 ms | 1.59 s | 1.0× | 1.0× | 46.5× |
| sort | 2M | 142 ms | 142 ms | 135 ms | 7.24 s | 1.0× | 1.1× | 50.8× |
| maps | 100k | 9 ms | 10 ms | 7 ms | 71 ms | 0.9× | 1.3× | 7.8× |
| maps | 1M | 103 ms | 147 ms | 97 ms | 576 ms | 0.7× | 1.1× | 5.6× |
| maps | 3M | 513 ms | 612 ms | 358 ms | 1.94 s | 0.8× | 1.4× | 3.8× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 0.4 MB | 5.7 MB | 2.0 MB | 10.1 MB |
| sieve | 10M | 13.6 MB | 15.5 MB | 11.5 MB | 86.2 MB |
| nbody | 1M | 2.2 MB | 5.6 MB | 2.1 MB | 10.6 MB |
| mandelbrot | 1k | 2.2 MB | 5.6 MB | 2.1 MB | 10.2 MB |
| matmul | 300 | 5.3 MB | 7.7 MB | 4.0 MB | 14.8 MB |
| sort | 2M | 19.1 MB | 21.3 MB | 17.2 MB | 86.7 MB |
| maps | 3M | 44.0 MB | 50.5 MB | 53.1 MB | 215.7 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 85 KB, 103 ms | 2298 KB, 185 ms | 4436 KB, 187 ms |
| sieve | 85 KB, 100 ms | 2297 KB, 181 ms | 4435 KB, 188 ms |
| nbody | 98 KB, 100 ms | 2303 KB, 174 ms | 4438 KB, 192 ms |
| mandelbrot | 89 KB, 104 ms | 2298 KB, 194 ms | 4435 KB, 197 ms |
| matmul | 89 KB, 100 ms | 2298 KB, 179 ms | 4437 KB, 196 ms |
| sort | 89 KB, 105 ms | 2299 KB, 181 ms | 4437 KB, 198 ms |
| maps | 89 KB, 103 ms | 2299 KB, 174 ms | 4458 KB, 294 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
