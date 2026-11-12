#!/bin/sh
# `caju` for the programs that tests start with run_file/run_source (caju test --target wasm):
# `run` compiles the program to WebAssembly and runs it in Node; everything else goes to the
# compiler ($CAJU_WASM_COMPILER, the native caju that runs the tests).
here=$(dirname "$0")
if [ "$1" = run ]; then
  shift
  src=$1
  shift
  t=$(mktemp -d)
  if ! "$CAJU_WASM_COMPILER" build --target wasm -o "$t/main.wasm" "$src"; then
    rm -rf "$t"
    exit 1
  fi
  node "$here/run.mjs" "$t/main.wasm" "$@"
  r=$?
  rm -rf "$t"
  exit $r
fi
exec "$CAJU_WASM_COMPILER" "$@"
