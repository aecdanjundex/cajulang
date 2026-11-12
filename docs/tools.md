# Measurement tools

Installed without `sudo`, from Ubuntu packages extracted into `~/.local/tools` (with shortcuts in
`~/.local/bin`):

```sh
cd ~/.local/tools/debs
apt-get download valgrind linux-tools-6.8.0-71 libtraceevent1
dpkg-deb -x valgrind_*.deb ../valgrind
dpkg-deb -x linux-tools-6.8.0-71_*.deb ../perf && dpkg-deb -x libtraceevent1_*.deb ../perf
# ~/.local/bin/valgrind: VALGRIND_LIB=.../valgrind/usr/libexec/valgrind exec .../valgrind/usr/bin/valgrind "$@"
# ~/.local/bin/perf:     LD_LIBRARY_PATH=<dir of libtraceevent.so.1> exec .../perf "$@"
```

The perf from kernel 6.8 works on WSL2 (5.15), including hardware counters.

- `tools/profile.sh prog.caju args` — where the time goes, per function (perf record + `CAJU_SYMS`,
  because the binaries have no symbol table). `HOT=fn` shows the hottest addresses inside `fn`;
  view them with `tools/disasm.sh`.
- `tools/icount.sh prog.caju args` — instructions executed (callgrind; exact) and cycles,
  instructions, cache misses and branch misses (perf stat, 5 runs).
- To compare two compiler versions without noise: `perf stat -e instructions:u` gives the same
  number on every run (time varies by 5 to 10% on this machine). Cycles measure what matters, but
  are noisy; use both.

Baseline (master d6f9781), Caju ÷ Go instructions: fib 1.7×, sieve 2.4×, nbody 2.3×,
mandelbrot 2.6×, matmul 3.2×, sort 2.5×, maps 1.6×. In maps, the IPC is 0.77 (cache misses).
