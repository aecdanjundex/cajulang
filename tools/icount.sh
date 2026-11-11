#!/bin/bash
# Instructions a Caju program executes (exact and repeatable, unlike time): callgrind.
# Use it to compare two compilers on the same program without timing noise.
#   tools/icount.sh file.caju [args...]
#   CAJU=path/to/caju tools/icount.sh ...     another compiler (default build/caju)
# Also prints cycles, instructions, cache and branch misses from perf stat when perf works.
# Needs valgrind (~/.local/bin/valgrind: see docs/tools.md). Programs run ~50x slower under it.
set -e
src=$1; shift
caju=${CAJU:-build/caju}
vg=$(command -v valgrind || echo ~/.local/bin/valgrind)
perf=$(command -v perf || echo ~/.local/bin/perf)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
"$caju" build -o "$t/bin" "$src"
n=$("$vg" --tool=callgrind --callgrind-out-file=/dev/null "$t/bin" "$@" 2>&1 >/dev/null | awk '/refs:/ {gsub(",", "", $NF); print $NF}')
echo "instructions (callgrind): $n"
if [ -x "$perf" ]; then
  "$perf" stat -r 5 -e cycles:u,instructions:u,cache-misses:u,branch-misses:u "$t/bin" "$@" 2>&1 >/dev/null | grep -E "cycles|instructions|misses|elapsed" || true
fi
