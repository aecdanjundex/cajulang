#!/bin/sh
# dist/caju-wasm.tar.gz: the compiler compiled to WebAssembly, for browsers (the playground of the
# site) and any JavaScript runtime. Needs a native compiler (CAJU, default build/caju) and Node.
#   caju.wasm          the compiler (caju build --target wasm ... runs inside it)
#   caju-files.json    the standard library and the runtime, read from an in-memory file system
#   caju-host.mjs      the system calls of a Caju program in wasm
#   caju-browser.mjs   loadCaju(): compile(source) and run(wasm)
set -e
cd "$(dirname "$0")/../.."
caju=${CAJU:-build/caju}
# the compiler finds rt/ and lib/ here (a compiler in build/release/ would look in build/)
export CAJU_ROOT="$PWD"
out=dist/caju-wasm
rm -rf "$out" dist/caju-wasm.tar.gz
mkdir -p "$out"
"$caju" build --target wasm -o "$out/caju.wasm" compiler/main.caju
node tools/wasm/bundle-files.mjs . "$out/caju-files.json"
cp tools/wasm/caju-host.mjs tools/wasm/caju-browser.mjs LICENSE "$out/"
grep -o 'VERSION = "[^"]*"' compiler/pkg.caju | cut -d'"' -f2 > "$out/VERSION"
# the compiler in wasm compiles itself to the same bytes
node tools/wasm/run.mjs "$out/caju.wasm" build --target wasm -o "$out/check.wasm" compiler/main.caju
cmp "$out/caju.wasm" "$out/check.wasm"
rm "$out/check.wasm"
node tools/wasm/browser-test.mjs "$out"
tar -czf dist/caju-wasm.tar.gz -C dist caju-wasm
( cd dist && sha256sum caju-wasm.tar.gz > caju-wasm.tar.gz.sha256 )
ls -la dist/caju-wasm.tar.gz
