# Caju × Go × Rust × Python

2026-11-10 23:08 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.1.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | 1 ms | 25 ms | 0.9× | 1.3× | 14.7× |
| fib | 30 | 6 ms | 5 ms | 3 ms | 120 ms | 1.3× | 2.1× | 19.2× |
| fib | 35 | 57 ms | 36 ms | 20 ms | 1.17 s | 1.6× | 2.9× | 20.5× |
| sieve | 100k | 1 ms | 2 ms | 1 ms | 35 ms | 0.7× | 1.0× | 24.5× |
| sieve | 1M | 3 ms | 3 ms | 3 ms | 210 ms | 1.0× | 1.0× | 63.5× |
| sieve | 10M | 20 ms | 19 ms | 19 ms | 1.99 s | 1.1× | 1.1× | 98.1× |
| nbody | 10k | 3 ms | 4 ms | 2 ms | 103 ms | 0.8× | 1.5× | 35.0× |
| nbody | 100k | 18 ms | 19 ms | 7 ms | 880 ms | 1.0× | 2.5× | 47.8× |
| nbody | 1M | 174 ms | 166 ms | 64 ms | 8.69 s | 1.1× | 2.7× | 49.8× |
| mandelbrot | 250 | 4 ms | 4 ms | 3 ms | 380 ms | 0.8× | 1.0× | 104.4× |
| mandelbrot | 500 | 10 ms | 11 ms | 10 ms | 1.50 s | 1.0× | 1.0× | 146.4× |
| mandelbrot | 1k | 37 ms | 35 ms | 35 ms | 6.54 s | 1.1× | 1.1× | 174.5× |
| matmul | 100 | 3 ms | 3 ms | 2 ms | 211 ms | 0.9× | 1.5× | 84.1× |
| matmul | 200 | 11 ms | 11 ms | 4 ms | 1.52 s | 1.0× | 2.5× | 137.2× |
| matmul | 300 | 33 ms | 31 ms | 11 ms | 5.67 s | 1.1× | 3.1× | 171.1× |
| sort | 100k | 8 ms | 8 ms | 7 ms | 228 ms | 1.0× | 1.2× | 27.6× |
| sort | 500k | 39 ms | 35 ms | 32 ms | 1.38 s | 1.1× | 1.2× | 34.9× |
| sort | 2M | 165 ms | 135 ms | 129 ms | 6.37 s | 1.2× | 1.3× | 38.5× |
| maps | 100k | 9 ms | 9 ms | 6 ms | 65 ms | 1.1× | 1.5× | 6.8× |
| maps | 1M | 119 ms | 127 ms | 83 ms | 527 ms | 0.9× | 1.4× | 4.4× |
| maps | 3M | 605 ms | 503 ms | 299 ms | 1.79 s | 1.2× | 2.0× | 3.0× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 2.4 MB | 5.6 MB | 2.1 MB | 10.2 MB |
| sieve | 10M | 14.0 MB | 15.5 MB | 11.3 MB | 86.3 MB |
| nbody | 1M | 2.2 MB | 5.6 MB | 2.1 MB | 10.5 MB |
| mandelbrot | 1k | 0.6 MB | 5.6 MB | 2.1 MB | 10.2 MB |
| matmul | 300 | 4.6 MB | 7.6 MB | 4.0 MB | 14.9 MB |
| sort | 2M | 17.4 MB | 21.9 MB | 17.2 MB | 86.7 MB |
| maps | 3M | 130.0 MB | 50.5 MB | 53.2 MB | 215.7 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 85 KB, 118 ms | 2298 KB, 193 ms | 4436 KB, 217 ms |
| sieve | 85 KB, 119 ms | 2297 KB, 158 ms | 4435 KB, 161 ms |
| nbody | 94 KB, 127 ms | 2303 KB, 166 ms | 4438 KB, 188 ms |
| mandelbrot | 85 KB, 115 ms | 2298 KB, 163 ms | 4435 KB, 159 ms |
| matmul | 85 KB, 116 ms | 2298 KB, 151 ms | 4437 KB, 180 ms |
| sort | 85 KB, 118 ms | 2299 KB, 169 ms | 4437 KB, 179 ms |
| maps | 85 KB, 112 ms | 2299 KB, 159 ms | 4458 KB, 275 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
