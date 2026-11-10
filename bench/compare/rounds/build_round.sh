#!/bin/bash
# Builds the compiler of a git commit (stage 2, compiled by itself) into the given path.
#   bench/compare/rounds/build_round.sh <commit> <dir>/bin/caju     (lib/ and rt/ go to <dir>)
set -e
root=$(cd "$(dirname "$0")/../../.." && pwd)
out=$(realpath -m "$2")
w=$(mktemp -d)
git -C "$root" worktree add -q --detach "$w" "$1"
mkdir -p "$w/build"
(cd "$w" && node bootstrap/caju.js build -o build/s1 compiler/main.caju && build/s1 build -o build/s2 compiler/main.caju)
# the binary finds lib/ and rt/ in the directory above its own: copy the worktree's
mkdir -p "$(dirname "$out")"; base=$(dirname "$(dirname "$out")")
cp -r "$w/lib" "$w/rt" "$base/"
cp "$w/build/s2" "$out"
git -C "$root" worktree remove --force "$w"
