# Caju × Go × Rust × Python

2026-11-11 06:56 — AMD Ryzen 7 5700G with Radeon Graphics

Versions: caju 0.1.0, go version go1.27.3 linux/amd64, rustc 1.99.1 (58cf8f9c3 2026-10-13), Python 3.12.3.
Same algorithm and the same order of operations in every language (see the sources next to this
file); every program prints a checksum and all four agree. Time: best of up to 3 runs, wall
clock, including process start. Rust: `rustc -C opt-level=3`; Go: `go build`; Caju: `caju build`.

## Time

| challenge | n | Caju | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust | Python ÷ Caju |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | 1 ms | 26 ms | 0.6× | 1.1× | 17.5× |
| fib | 30 | 3 ms | 5 ms | 3 ms | 126 ms | 0.7× | 1.1× | 37.2× |
| fib | 35 | 26 ms | 40 ms | 21 ms | 1.22 s | 0.7× | 1.3× | 47.0× |
| sieve | 100k | 1 ms | 2 ms | 1 ms | 36 ms | 0.6× | 1.0× | 25.4× |
| sieve | 1M | 3 ms | 3 ms | 3 ms | 219 ms | 0.8× | 0.8× | 80.0× |
| sieve | 10M | 22 ms | 20 ms | 21 ms | 2.12 s | 1.1× | 1.0× | 97.3× |
| nbody | 10k | 2 ms | 4 ms | 2 ms | 107 ms | 0.5× | 1.0× | 56.5× |
| nbody | 100k | 7 ms | 19 ms | 8 ms | 918 ms | 0.4× | 1.0× | 122.5× |
| nbody | 1M | 65 ms | 173 ms | 66 ms | 9.78 s | 0.4× | 1.0× | 149.5× |
| mandelbrot | 250 | 4 ms | 5 ms | 4 ms | 411 ms | 0.8× | 0.9× | 107.6× |
| mandelbrot | 500 | 11 ms | 11 ms | 11 ms | 1.65 s | 1.0× | 1.0× | 147.0× |
| mandelbrot | 1k | 40 ms | 38 ms | 38 ms | 6.30 s | 1.1× | 1.1× | 155.9× |
| matmul | 100 | 2 ms | 3 ms | 2 ms | 215 ms | 0.6× | 1.0× | 128.0× |
| matmul | 200 | 5 ms | 11 ms | 4 ms | 1.59 s | 0.5× | 1.1× | 315.4× |
| matmul | 300 | 14 ms | 32 ms | 11 ms | 6.10 s | 0.4× | 1.2× | 436.7× |
| sort | 100k | 8 ms | 8 ms | 7 ms | 250 ms | 0.9× | 1.0× | 32.6× |
| sort | 500k | 35 ms | 35 ms | 34 ms | 1.50 s | 1.0× | 1.0× | 42.6× |
| sort | 2M | 140 ms | 140 ms | 135 ms | 7.34 s | 1.0× | 1.0× | 52.4× |
| maps | 100k | 9 ms | 11 ms | 8 ms | 75 ms | 0.8× | 1.1× | 8.5× |
| maps | 1M | 111 ms | 182 ms | 104 ms | 607 ms | 0.6× | 1.1× | 5.5× |
| maps | 3M | 699 ms | 648 ms | 389 ms | 1.91 s | 1.1× | 1.8× | 2.7× |

## Peak memory (largest size)

| challenge | n | Caju | Go | Rust | Python |
|---|--:|--:|--:|--:|--:|
| fib | 35 | 2.7 MB | 5.7 MB | 2.1 MB | 10.1 MB |
| sieve | 10M | 12.1 MB | 15.9 MB | 11.5 MB | 86.3 MB |
| nbody | 1M | 2.7 MB | 5.7 MB | 2.1 MB | 10.6 MB |
| mandelbrot | 1k | 2.6 MB | 5.6 MB | 2.1 MB | 10.1 MB |
| matmul | 300 | 4.4 MB | 7.6 MB | 4.0 MB | 14.7 MB |
| sort | 2M | 19.8 MB | 21.9 MB | 17.2 MB | 86.7 MB |
| maps | 3M | 53.9 MB | 52.5 MB | 53.2 MB | 215.7 MB |

## Executable size and compile time

| challenge | Caju | Go | Rust |
|---|--:|--:|--:|
| fib | 85 KB, 132 ms | 2298 KB, 221 ms | 4436 KB, 268 ms |
| sieve | 85 KB, 140 ms | 2297 KB, 167 ms | 4435 KB, 181 ms |
| nbody | 94 KB, 141 ms | 2303 KB, 165 ms | 4438 KB, 203 ms |
| mandelbrot | 85 KB, 143 ms | 2298 KB, 186 ms | 4435 KB, 175 ms |
| matmul | 85 KB, 133 ms | 2298 KB, 170 ms | 4437 KB, 186 ms |
| sort | 85 KB, 138 ms | 2299 KB, 184 ms | 4437 KB, 190 ms |
| maps | 85 KB, 144 ms | 2299 KB, 195 ms | 4458 KB, 340 ms |

## The challenges

- **fib**: recursive calls (fib(n), exponential); sizes 25, 30, 35.
- **sieve**: sieve of Eratosthenes up to n; sizes 100k, 1M, 10M.
- **nbody**: 5-body simulation, n steps (floating point); sizes 10k, 100k, 1M.
- **mandelbrot**: Mandelbrot set on an n×n grid (floating point); sizes 250, 500, 1k.
- **matmul**: n×n integer matrix product (nested loops); sizes 100, 200, 300.
- **sort**: quicksort of n pseudo-random integers; sizes 100k, 500k, 2M.
- **maps**: n inserts and n lookups in a hash map (int keys); sizes 100k, 1M, 3M.
