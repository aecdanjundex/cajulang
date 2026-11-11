# Ferramentas de medição

Sem `sudo`, instaladas a partir dos pacotes do Ubuntu extraídos em `~/.local/tools` (com atalhos
em `~/.local/bin`):

```sh
cd ~/.local/tools/debs
apt-get download valgrind linux-tools-6.8.0-71 libtraceevent1
dpkg-deb -x valgrind_*.deb ../valgrind
dpkg-deb -x linux-tools-6.8.0-71_*.deb ../perf && dpkg-deb -x libtraceevent1_*.deb ../perf
# ~/.local/bin/valgrind: VALGRIND_LIB=.../valgrind/usr/libexec/valgrind exec .../valgrind/usr/bin/valgrind "$@"
# ~/.local/bin/perf:     LD_LIBRARY_PATH=<dir of libtraceevent.so.1> exec .../perf "$@"
```

O perf do kernel 6.8 funciona no WSL2 (5.15), inclusive com contadores de hardware.

- `tools/profile.sh prog.caju args` — onde o tempo vai, por função (perf record + `CAJU_SYMS`,
  porque os binários não têm tabela de símbolos). `HOT=fn` mostra os endereços mais quentes
  dentro de `fn`; veja-os com `tools/disasm.sh`.
- `tools/icount.sh prog.caju args` — instruções executadas (callgrind; exatas) e ciclos,
  instruções, falhas de cache e de desvio (perf stat, 5 execuções).
- Para comparar duas versões do compilador sem ruído: `perf stat -e instructions:u` dá o mesmo
  número em toda execução (o tempo varia 5 a 10% nesta máquina). Ciclos medem o que importa,
  mas com ruído; use os dois.

Linha de base (master d6f9781), instruções Caju ÷ Go: fib 1,7×, sieve 2,4×, nbody 2,3×,
mandelbrot 2,6×, matmul 3,2×, sort 2,5×, maps 1,6×. Nos mapas, o IPC é 0,77 (falhas de cache).
