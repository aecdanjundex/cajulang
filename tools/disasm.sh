#!/bin/bash
# Disassembles one function of the code the Caju compiler generates.
#   tools/disasm.sh file.caju function [caju-binary]
# function: a user function name (fib), or a raw symbol (u.top, r.f.rt_map_find, u.l.3).
set -e
src=$1; fn=$2; caju=${3:-build/caju}
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
CAJU_SYMS=$t/syms "$caju" build -o "$t/bin" "$src"
sym=$fn; case "$fn" in u.*|r.*) ;; *) sym="u.f.$fn" ;; esac
start=$(awk -v s="$sym" '$2 == s {print $1}' "$t/syms")
[ -z "$start" ] && { echo "no symbol $sym" >&2; exit 1; }
# the function ends where the next function-level symbol starts
end=$(awk '$2 ~ /^(u|r)\.(f|top|l|c|t)\.?/ || $2 == "rt.calldefer" {print $1}' "$t/syms" | sort | awk -v s="$start" 'BEGIN{x=strtonum(s)} strtonum($1) > x {print; exit}')
objdump -D -b binary -m i386:x86-64 -M intel --adjust-vma=0x400000 --start-address=$start --stop-address=$end "$t/bin" | tail -n +8 | sed -E 's/^ +([0-9a-f]+):\t([0-9a-f ]+)\t/\1:  /'
