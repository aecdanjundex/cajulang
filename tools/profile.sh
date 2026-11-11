#!/bin/bash
# Where a Caju program spends its time: samples with perf and maps them to the functions of the
# generated code (CAJU_SYMS), since the binaries have no symbol table.
#   tools/profile.sh file.caju [args...]            time per function
#   HOT=fn tools/profile.sh file.caju [args...]     also the hottest addresses inside fn
#                                                   (look them up with tools/disasm.sh)
#   CAJU=path/to/caju tools/profile.sh ...          another compiler (default build/caju)
# Needs perf (~/.local/bin/perf: see docs/tools.md).
set -e
src=$1; shift
caju=${CAJU:-build/caju}
perf=$(command -v perf || echo ~/.local/bin/perf)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
CAJU_SYMS=$t/syms "$caju" build -o "$t/bin" "$src"
"$perf" record -q -o "$t/perf.data" "$t/bin" "$@" > /dev/null 2> "$t/err" || true
"$perf" script -i "$t/perf.data" -F ip 2> /dev/null > "$t/ips"
python3 - "$t/syms" "$t/ips" "${HOT:-}" <<'EOF'
import bisect, collections, sys
syms = []
for line in open(sys.argv[1]):
    a, name = line.split(None, 1)
    name = name.strip()
    # function-level symbols only (u.f.x, u.top, u.l.N, r.f.x...), not local labels
    if name.startswith(".") or name.startswith("s.") or name.startswith("d."):
        continue
    syms.append((int(a, 16), name))
syms.sort()
addrs = [a for a, _ in syms]
hot = sys.argv[3]
per = collections.Counter(); inside = collections.Counter(); total = 0
for line in open(sys.argv[2]):
    line = line.strip()
    if not line:
        continue
    ip = int(line, 16); total += 1
    i = bisect.bisect_right(addrs, ip) - 1
    name = syms[i][1] if i >= 0 and ip < 0x1000000 else "(kernel/other)"
    per[name] += 1
    if hot and (name == hot or name == "u.f." + hot):
        inside[ip] += 1
print(f"{total} samples")
for name, c in per.most_common(15):
    print(f"{100 * c / total:6.1f}%  {name}")
if hot:
    print(f"\nhottest addresses in {hot}:")
    for ip, c in inside.most_common(15):
        print(f"{100 * c / total:6.1f}%  {ip:x}")
EOF
