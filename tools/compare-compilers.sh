#!/bin/bash
# Compiles every .caju program of the repository (tests, examples, testdata, the compiler itself)
# with the bootstrap compiler (JavaScript) and with a caju binary, and checks that both produce
# the same executable byte for byte (or the same error message).
#
#   tools/compare-compilers.sh [caju-binary] [--target windows]     (default: build/caju, linux)
cd "$(dirname "$0")/.."
SELF=build/caju
TARGET=linux
while [ $# -gt 0 ]; do
  if [ "$1" == "--target" ]; then TARGET=$2; shift; else SELF=$1; fi
  shift
done
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
same=0; err=0; diff=0
for e in $(find compiler examples lib tests -name '*.caju' | sort); do
  # in a directory with main.caju, only main.caju is a program
  d=$(dirname "$e")
  if [ -f "$d/main.caju" ] && [ "$(basename "$e")" != main.caju ]; then continue; fi
  ra=$(node bootstrap/caju.js build --target $TARGET -o "$T/a" "$e" 2>&1); sa=$?
  rb=$($SELF build --target $TARGET -o "$T/b" "$e" 2>&1); sb=$?
  if [ $sa -ne 0 ] || [ $sb -ne 0 ]; then
    if [ "$ra" == "$rb" ] && [ $sa == $sb ]; then err=$((err+1)); else
      echo "DIFFERENT ERROR $e"; echo "  boot: $ra" | head -3; echo "  self: $rb" | head -3; diff=$((diff+1)); fi
  elif cmp -s "$T/a" "$T/b"; then same=$((same+1)); else echo "DIFFERENT BINARY $e"; diff=$((diff+1)); fi
  rm -f "$T/a" "$T/b"
done
echo "identical: $same, same error: $err, different: $diff"
[ $diff -eq 0 ]
