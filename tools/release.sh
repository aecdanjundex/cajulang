#!/bin/bash
# Builds the release package of Caju for Linux x86-64:
#   dist/caju-linux-x86_64.tar.gz   caju-<version>/{bin/caju, lib/, rt/, examples/, README.md, LICENSE}
#   dist/caju-linux-x86_64.tar.gz.sha256
#
#   tools/release.sh              the compiler comes from the bootstrap chain (needs Node 22+):
#                                 JS -> stage 1 -> stage 2 -> stage 3, and stage 2 must equal stage 3
#   CAJU=build/caju tools/release.sh   package an existing compiler (skips the chain)
#   TAG=v0.1.0 tools/release.sh   also checks that the tag matches the compiler's version
set -euo pipefail
export CAJU_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$(dirname "$0")/.."
out=dist
work=build/release
rm -rf "$work" && mkdir -p "$work" "$out"

if [ -n "${CAJU:-}" ]; then
  cp "$CAJU" "$work/caju"
else
  echo "== stage 1 (JavaScript)"
  node bootstrap/caju.js build -o "$work/s1" compiler/main.caju
  echo "== stage 2"
  "$work/s1" build -o "$work/s2" compiler/main.caju
  echo "== stage 3"
  "$work/s2" build -o "$work/s3" compiler/main.caju
  cmp "$work/s2" "$work/s3" || { echo "stage 2 and stage 3 differ: the compiler does not reproduce itself" >&2; exit 1; }
  cp "$work/s3" "$work/caju"
fi

version=$("$work/caju" version | awk '{print $2}')
if [ -n "${TAG:-}" ] && [ "${TAG#v}" != "$version" ]; then
  echo "tag $TAG does not match the compiler version $version (compiler/pkg.caju, VERSION)" >&2
  exit 1
fi

name="caju-$version"
pkg="$work/$name"
mkdir -p "$pkg/bin"
cp "$work/caju" "$pkg/bin/caju"
chmod 755 "$pkg/bin/caju"
cp -r rt "$pkg/rt"
# the standard library without its tests
mkdir -p "$pkg/lib"
for f in lib/*.caju; do case "$f" in *_test.caju) ;; *) cp "$f" "$pkg/lib/" ;; esac; done
cp -r examples "$pkg/examples"
find "$pkg/examples" -name '*_test.caju' -delete
cp README.md "$pkg/"
[ -f LICENSE ] && cp LICENSE "$pkg/"

# quick check of the package itself, from a directory outside the repository
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
cp -r "$pkg" "$t/"
printf 'import "std/strings"\nprint(strings.to_upper("ok"))\n' > "$t/check.caju"
got=$(env -u CAJU_ROOT "$t/$name/bin/caju" run "$t/check.caju")
[ "$got" = "OK" ] || { echo "package check failed: got '$got'" >&2; exit 1; }

tar -C "$work" -czf "$out/caju-linux-x86_64.tar.gz" --owner=0 --group=0 "$name"
(cd "$out" && sha256sum caju-linux-x86_64.tar.gz > caju-linux-x86_64.tar.gz.sha256)
echo "== $out/caju-linux-x86_64.tar.gz (caju $version)"
cat "$out/caju-linux-x86_64.tar.gz.sha256"
