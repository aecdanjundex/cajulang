#!/bin/sh
# Prints the section of CHANGELOG.md for a version (the notes of its GitHub release).
#   tools/changelog.sh 0.4.0        (a leading "v" is accepted)
# Fails when the changelog has no section for it, so a release cannot go out without notes.
set -e
v=${1#v}
file=${CHANGELOG:-$(dirname "$0")/../CHANGELOG.md}
out=$(awk -v v="$v" '
  /^## \[/ { if (on) exit; if (index($0, "## [" v "]") == 1) { on = 1; next } }
  /^\[[^]]*\]: / { if (on) exit }
  on { print }
' "$file" | sed -e '/./,$!d')
if [ -z "$out" ]; then
  echo "CHANGELOG.md has no section for $v" >&2
  exit 1
fi
printf '%s\n' "$out"
