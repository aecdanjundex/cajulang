# HTTP server: Caju × Go

The same API in all three versions: `caju/main.caju` (framework github.com/cajulang/web; copy
the package's `web.caju` next to `main.caju`), `gin/` (Gin) and `nethttp/` (standard library only).
Routes: `GET /users/:id` (small map as JSON), `GET /users` (list of 50 structs), `POST /users`
(reads JSON into a struct and returns it). Load from `hey -n 20000 -c 50` (with and without
keep-alive), on the same machine (Ryzen 7 5700G, 16 threads, WSL2): `hey` itself shares the CPU
with the server, so numbers near 35k req/s are at the limit of the load generator.

Requests per second, 50 clients (2026-11-11):

| route | connection | Caju 0.2 | Caju 1 proc | Caju 4 proc | Caju 16 proc | Gin | Go net/http |
|---|---|--:|--:|--:|--:|--:|--:|
| GET /users/:id | keep-alive | 11,579 | 33,915 | **41,026** | 35,840 | 32,743 | 34,471 |
| GET /users/:id | new per req | 11,424 | 11,115 | **11,547** | 11,148 | 10,566 | 11,185 |
| GET /users (50) | keep-alive | 5,059 | 21,632 | 28,754 | **30,737** | 23,949 | 22,299 |
| GET /users (50) | new per req | 5,648 | 9,884 | **10,363** | 10,109 | 9,307 | 9,286 |
| POST /users | keep-alive | 9,069 | 30,671 | 29,003 | **36,592** | 31,265 | 29,382 |
| POST /users | new per req | 8,638 | 11,228 | 10,375 | **11,767** | 11,107 | 11,105 |
| peak memory | | 19 MB | 32 MB | 114 MB* | 347 MB* | 36 MB | 23 MB |
| executable | | 281 KB | | | | 31.6 MB | 9.8 MB |

\* sum of the processes' RSS (counts pages shared after the fork several times).

What changed since Caju 0.2: keep-alive, an epoll event loop, multiple processes with
SO_REUSEPORT (`http.listen_and_serve_workers`, `r.run_workers`) and std/json 2 to 20× faster
(bench/json/RESULTS.md).

## Fair measurement: server and load generator on separate CPUs (round 2, 2026-11-11)

`hey` saturated before the server did. `run.py` (in this folder) pins the server to CPUs with
`taskset`, runs the `load/` generator (Go, raw TCP, keep-alive) on the others and measures the
server's CPU per request (/proc). Build `caju/server` (with the package's web.caju next to it),
`gin/server` and `nethttp/server` first; `LGC=1,3,5,7,8-15 python3 run.py`. On this machine, CPUs
2k and 2k+1 are the same physical core: "4 physical cores" = CPUs 0,2,4,6. After the allocation
optimizations (OPTIMIZATION.md, round 26) and the web router changes; the system call hypotheses
are in SYSCALLS.md (none won: the loop already does 1 read + 1 write per request).

| scenario | route | Caju | Gin | Go net/http |
|---|---|--:|--:|--:|
| 1 CPU, 50 connections | GET /users/:id | **65,198** (13.0 µs) | 33,424 (28.2 µs) | 32,687 (29.2 µs) |
| | GET /users (50) | **32,177** (29.7 µs) | 18,824 (50.2 µs) | 21,054 (45.8 µs) |
| | POST /users | **65,470** (15.0 µs) | 29,354 (35.1 µs) | 31,434 (30.5 µs) |
| 4 cores, 1000 connections | GET /users/:id | **122,188** (27.3 µs) | 70,738 (48.6 µs) | 71,297 (48.1 µs) |
| | GET /users (50) | **61,202** (58.7 µs) | 43,028 (84.8 µs) | 38,256 (92.2 µs) |
| | POST /users | **118,174** (30.7 µs) | 60,591 (56.4 µs) | 66,844 (51.8 µs) |

req/s (server CPU per request). No errors in any test.

## Round 3: faster JSON and maps (2026-11-11)

Same measurement as round 2 (Go unchanged: the Go servers did not change). JSON:
bench/json/RESULTS.md (round 2, now ahead of encoding/json in all 7 cases); maps:
OPTIMIZATION.md, round 27.

| scenario | route | Caju round 2 | Caju round 3 | Gin | Go net/http |
|---|---|--:|--:|--:|--:|
| 1 CPU, 50 connections | GET /users/:id | 65,198 | **72,468** (12.5 µs) | 33,424 | 32,687 |
| | GET /users (50) | 32,177 | **41,463** (23.7 µs) | 18,824 | 21,054 |
| | POST /users | 65,470 | **65,638** (14.4 µs) | 29,354 | 31,434 |
| 4 cores, 1000 connections | GET /users/:id | 122,188 | **134,502** | 70,738 | 71,297 |
| | GET /users (50) | 61,202 | **64,907** | 43,028 | 38,256 |
| | POST /users | 118,174 | **122,580** | 60,591 | 66,844 |
