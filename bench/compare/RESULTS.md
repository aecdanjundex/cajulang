# Caju × Go × Rust × Python

2026-11-10 22:59 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.1.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | 1 ms | 25 ms | 0.8× | 1.3× | 14.5× |
| fib | 30 | 7 ms | 5 ms | 3 ms | 120 ms | 1.3× | 2.3× | 17.7× |
| fib | 35 | 62 ms | 38 ms | 20 ms | 1.18 s | 1.6× | 3.1× | 19.0× |
| sieve | 100k | 2 ms | 2 ms | 1 ms | 33 ms | 0.9× | 1.3× | 19.2× |
| sieve | 1M | 4 ms | 3 ms | 3 ms | 212 ms | 1.2× | 1.2× | 55.0× |
| sieve | 10M | 29 ms | 22 ms | 18 ms | 2.00 s | 1.3× | 1.6× | 68.8× |
| nbody | 10k | 3 ms | 4 ms | 2 ms | 103 ms | 0.8× | 1.6× | 34.0× |
| nbody | 100k | 19 ms | 18 ms | 7 ms | 881 ms | 1.0× | 2.5× | 47.2× |
| nbody | 1M | 175 ms | 165 ms | 64 ms | 8.69 s | 1.1× | 2.8× | 49.7× |
| mandelbrot | 250 | 3 ms | 4 ms | 3 ms | 383 ms | 0.8× | 1.0× | 112.5× |
| mandelbrot | 500 | 10 ms | 11 ms | 10 ms | 1.45 s | 1.0× | 1.0× | 140.2× |
| mandelbrot | 1k | 38 ms | 36 ms | 36 ms | 5.79 s | 1.1× | 1.1× | 152.2× |
| matmul | 100 | 3 ms | 4 ms | 2 ms | 205 ms | 0.7× | 1.7× | 75.8× |
| matmul | 200 | 11 ms | 11 ms | 4 ms | 1.52 s | 1.1× | 2.6× | 133.6× |
| matmul | 300 | 34 ms | 30 ms | 11 ms | 5.44 s | 1.1× | 3.2× | 158.2× |
| sort | 100k | 9 ms | 8 ms | 7 ms | 224 ms | 1.1× | 1.3× | 24.0× |
| sort | 500k | 44 ms | 34 ms | 32 ms | 1.36 s | 1.3× | 1.4× | 30.7× |
| sort | 2M | 186 ms | 134 ms | 129 ms | 6.42 s | 1.4× | 1.4× | 34.6× |
| maps | 100k | 10 ms | 9 ms | 6 ms | 65 ms | 1.1× | 1.6× | 6.5× |
| maps | 1M | 124 ms | 141 ms | 84 ms | 537 ms | 0.9× | 1.5× | 4.3× |
| maps | 3M | 610 ms | 525 ms | 296 ms | 1.77 s | 1.2× | 2.1× | 2.9× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 2.4 MB | 5.6 MB | 2.1 MB | 10.1 MB |
| sieve | 10M | 13.9 MB | 15.5 MB | 11.4 MB | 86.3 MB |
| nbody | 1M | 2.5 MB | 5.6 MB | 2.1 MB | 10.6 MB |
| mandelbrot | 1k | 2.6 MB | 5.6 MB | 2.1 MB | 10.1 MB |
| matmul | 300 | 4.1 MB | 7.6 MB | 3.9 MB | 15.0 MB |
| sort | 2M | 19.7 MB | 20.8 MB | 17.2 MB | 86.6 MB |
| maps | 3M | 129.6 MB | 50.5 MB | 53.2 MB | 215.7 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 85 KB, 106 ms | 2298 KB, 244 ms | 4436 KB, 306 ms |
| sieve | 85 KB, 112 ms | 2297 KB, 162 ms | 4435 KB, 182 ms |
| nbody | 94 KB, 118 ms | 2303 KB, 158 ms | 4438 KB, 194 ms |
| mandelbrot | 89 KB, 117 ms | 2298 KB, 154 ms | 4435 KB, 167 ms |
| matmul | 89 KB, 115 ms | 2298 KB, 163 ms | 4437 KB, 185 ms |
| sort | 89 KB, 115 ms | 2299 KB, 179 ms | 4437 KB, 218 ms |
| maps | 85 KB, 112 ms | 2299 KB, 162 ms | 4458 KB, 284 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
