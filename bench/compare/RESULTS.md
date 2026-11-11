# Caju × Go × Rust × Python

2026-11-10 21:54 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.1.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | 1 ms | 26 ms | 0.8× | 1.4× | 14.7× |
| fib | 30 | 7 ms | 5 ms | 3 ms | 120 ms | 1.4× | 2.4× | 17.4× |
| fib | 35 | 64 ms | 38 ms | 20 ms | 1.17 s | 1.7× | 3.2× | 18.4× |
| sieve | 100k | 2 ms | 2 ms | 1 ms | 35 ms | 0.9× | 1.3× | 20.0× |
| sieve | 1M | 8 ms | 3 ms | 3 ms | 210 ms | 2.2× | 2.4× | 27.4× |
| sieve | 10M | 68 ms | 19 ms | 19 ms | 2.00 s | 3.5× | 3.6× | 29.4× |
| nbody | 10k | 5 ms | 4 ms | 2 ms | 103 ms | 1.4× | 2.8× | 19.9× |
| nbody | 100k | 40 ms | 18 ms | 7 ms | 875 ms | 2.2× | 5.5× | 21.7× |
| nbody | 1M | 396 ms | 167 ms | 64 ms | 8.77 s | 2.4× | 6.2× | 22.1× |
| mandelbrot | 250 | 7 ms | 4 ms | 3 ms | 414 ms | 1.7× | 2.0× | 60.3× |
| mandelbrot | 500 | 23 ms | 11 ms | 10 ms | 1.52 s | 2.2× | 2.3× | 64.7× |
| mandelbrot | 1k | 90 ms | 36 ms | 36 ms | 6.27 s | 2.5× | 2.5× | 69.8× |
| matmul | 100 | 5 ms | 3 ms | 2 ms | 206 ms | 1.8× | 3.1× | 38.0× |
| matmul | 200 | 33 ms | 11 ms | 4 ms | 1.57 s | 3.1× | 7.7× | 47.6× |
| matmul | 300 | 107 ms | 31 ms | 11 ms | 5.79 s | 3.5× | 10.1× | 54.3× |
| sort | 100k | 11 ms | 8 ms | 7 ms | 232 ms | 1.4× | 1.6× | 20.9× |
| sort | 500k | 54 ms | 35 ms | 33 ms | 1.36 s | 1.6× | 1.6× | 25.1× |
| sort | 2M | 229 ms | 136 ms | 130 ms | 6.42 s | 1.7× | 1.8× | 28.0× |
| maps | 100k | 10 ms | 9 ms | 6 ms | 65 ms | 1.1× | 1.6× | 6.5× |
| maps | 1M | 193 ms | 146 ms | 90 ms | 540 ms | 1.3× | 2.1× | 2.8× |
| maps | 3M | 848 ms | 530 ms | 310 ms | 1.77 s | 1.6× | 2.7× | 2.1× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 2.6 MB | 5.6 MB | 2.1 MB | 10.2 MB |
| sieve | 10M | 12.1 MB | 15.5 MB | 11.4 MB | 86.3 MB |
| nbody | 1M | 2.4 MB | 5.6 MB | 2.1 MB | 10.6 MB |
| mandelbrot | 1k | 2.6 MB | 5.6 MB | 2.1 MB | 10.2 MB |
| matmul | 300 | 6.0 MB | 7.6 MB | 3.9 MB | 14.7 MB |
| sort | 2M | 18.0 MB | 21.9 MB | 17.3 MB | 86.7 MB |
| maps | 3M | 145.4 MB | 50.5 MB | 53.2 MB | 215.8 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 99 KB, 129 ms | 2298 KB, 483 ms | 4436 KB, 519 ms |
| sieve | 99 KB, 124 ms | 2297 KB, 159 ms | 4435 KB, 178 ms |
| nbody | 108 KB, 120 ms | 2303 KB, 162 ms | 4438 KB, 197 ms |
| mandelbrot | 100 KB, 119 ms | 2298 KB, 168 ms | 4435 KB, 152 ms |
| matmul | 99 KB, 125 ms | 2298 KB, 168 ms | 4437 KB, 198 ms |
| sort | 103 KB, 124 ms | 2299 KB, 163 ms | 4437 KB, 172 ms |
| maps | 99 KB, 117 ms | 2299 KB, 164 ms | 4458 KB, 293 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
