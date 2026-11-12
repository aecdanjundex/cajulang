# HTTP server: system calls and multiple cores (H3, H4)

Measured on 2026-11-11 (Ryzen 7 5700G, WSL2). Server: `bench/http/caju/main.caju`, route
`GET /users/:id`. Load generator: `bench/http/load` (Go, raw TCP, keep-alive; uses much less CPU
than `hey`), always on cores separate from the server (`taskset`). Main metric: server CPU per
request (utime + stime from `/proc/<pid>/stat`, summing the child processes), median of 5 to 7
interleaved runs; throughput alone varies ±10% on this machine.

**Topology:** CPUs 0-1, 2-3, 4-5... are hyper-threading pairs on the same physical core.
"4 cores" as `0-3` are 2 physical cores; for 4 physical cores use `0,2,4,6`.

## Calls per request (instrumented build, not committed)

| case | read | write | epoll_wait | epoll_ctl | clock_gettime | events per wait |
|---|--:|--:|--:|--:|--:|--:|
| 1 process, 50 connections | 1 | 1 | 0.05 | 0 | 0.05 | 20 |
| 4 processes, 50 connections | 1 | 1 | 0.4–0.5 | 0 | 0.4–0.5 | 2–2.6 |
| 4 processes, 1000 connections | 1 | 1 | 0.01 | 0 | 0.01 | 77–164 |

The loop is already at the minimum: one read and one write per request, with no extra `read`
returning EAGAIN and no toggling of EPOLLOUT. The system time (~8.5 µs/req in one process) is the
TCP stack.

## Hypotheses tested (all rejected)

| # | idea | result (µs of CPU per request, median) |
|---|---|---|
| E1 | edge-triggered epoll (read until the buffer is not filled) | 16.1 × 16.2 (1 proc); 32.0 × 30.3 (4 proc): no gain |
| E2 | `read`/`write` instead of `recvfrom`/`sendto` (SIGPIPE ignored) | 17.3 × 16.7: no gain |
| E3 | 50 `epoll_wait(0)` calls before blocking | 4 proc/50 connections: +3% req/s, but +8.5% CPU/req; 1 proc: noise |
| E5 | one shared socket with EPOLLEXCLUSIVE instead of SO_REUSEPORT | 94.8k × 100.2k req/s (200 connections): worse |
| E6 | pin each process to a CPU (`sched_setaffinity`) | 34.9 × 32.6 and 29.8 × 28.3: worse |
| E7 | list indexed by fd instead of the client map | 17.8 × 17.1: noise |
| — | fewer `clock_gettime` calls | costs 402 ns; 0.05/req (1 proc) = 20 ns/req: not worth it |

## Scaling across cores (H4)

| server | cores | connections | req/s | CPU µs/req |
|---|---|--:|--:|--:|
| Caju 1 process | 0 | 50 / 1000 | 53,600 / 50,700 | 17.3 / 17.8 |
| Caju 4 processes | 0,2,4,6 | 200 / 1000 | 81,700–105,600 / 103,300–116,900 | 28–32 |
| Go net/http GOMAXPROCS=4 | 0,2,4,6 | 200 / 1000 | 52,700 / 72,200 | 47–49 |
| Caju 8 processes | 0-7 | 1000 | 126,400 | 42.7 |
| Go net/http GOMAXPROCS=8 | 0-7 | 1000 | 93,000 | 61.5 |

- With 50 connections, the test itself is the limit: each connection waits for the previous
  response, and the 4 processes sit idle (16k req/s each, vs. 53k for a single one). With 1000,
  they all run at ~90%.
- CPU per request rises from ~17 to ~30 µs with 4 processes even with the loop at the minimum (2
  calls per request, no context switches): it is the system time that doubles (9 → 20 µs). Go
  suffers the same (25 → 47 µs). It is the cost of the kernel/WSL2 with local TCP in parallel, not
  of the loop.
- SO_REUSEPORT splits connections unevenly (26k–75k req/s per process), but under high load they
  are all equally busy; the alternative (E5) was worse.

The remaining gain is in user code (allocation and garbage collection: ~50% of user time),
handled separately.
