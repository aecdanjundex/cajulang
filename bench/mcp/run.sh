#!/bin/bash
# The same tasks done by an AI assistant (Claude Code, non-interactive) in two ways:
#   cli  only the `caju` command in a shell (plus reading and writing files)
#   mcp  only the tools of `caju mcp` (no shell)
# Each run starts in an empty directory with the task's files; the result is checked afterwards.
# (stdin is /dev/null: claude -p reads its standard input into the prompt, and the loop's input is
# the task list)
#   bench/mcp/run.sh [reps] [model]          results in bench/mcp/results/, summary: node summarize.mjs
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
reps=${1:-2}
model=${2:-claude-sonnet-5-5}
caju=${CAJU:-$root/build/caju}
out=$here/results
mkdir -p "$out"
bin=$(mktemp -d)
ln -s "$caju" "$bin/caju"
# the MCP configurations live outside the PATH (a CLI run found mcp.json there and read it)
cfg=$(mktemp -d)
cat > "$cfg/mcp.json" <<JSON
{"mcpServers":{"caju":{"command":"$caju","args":["mcp"],"env":{"CAJU_ROOT":"$root"}}}}
JSON
echo '{"mcpServers":{}}' > "$cfg/none.json"

one() {
  task=$1 mode=$2 rep=$3 prompt=$4
  dir=$(mktemp -d)
  [ -d "$here/fixtures/$task" ] && cp "$here/fixtures/$task/"* "$dir/" 2>/dev/null
  log=$out/$task-$mode-$rep.jsonl
  if [ "$mode" = cli ]; then
    # (caju mcp is not allowed here: in a first round, CLI runs started it from the shell and
    # spoke JSON-RPC to it to read the reference; see RESULTS.md)
    tools=(--allowedTools "Bash(caju:*)" "Bash($bin/caju:*)" Read Write Edit Glob Grep --disallowedTools "Bash(caju mcp:*)" "Bash($bin/caju mcp:*)" --mcp-config "$cfg/none.json")
  else
    tools=(--allowedTools "mcp__caju" Read Write Edit Glob Grep --disallowedTools Bash --mcp-config "$cfg/mcp.json")
  fi
  (cd "$dir" && PATH="$bin:$PATH" CAJU_ROOT="$root" timeout 900 claude -p "$prompt" --model "$model" --output-format stream-json --verbose \
     --strict-mcp-config --setting-sources project --no-session-persistence --max-turns 40 "${tools[@]}" < /dev/null > "$log" 2> "$log.err")
  # check the result
  ok=false
  case $task in
    words) [ "$(cd "$dir" && CAJU_ROOT=$root "$caju" run main.caju 2>&1)" = "$(printf 'the 5\nfox 3\ndog 2\njumps 2\nquick 2')" ] && ok=true ;;
    fix) [ "$(cd "$dir" && CAJU_ROOT=$root "$caju" run main.caju 2>&1)" = "$(printf 'CASHEW, MANGO\ntotal: 16.00')" ] && ok=true ;;
    tests)
      r=$(cd "$dir" && CAJU_ROOT=$root "$caju" test stack_test.caju 2>&1)
      n=$(printf '%s' "$r" | grep -o '^[0-9]* passed, 0 failed' | cut -d' ' -f1)
      e=$(printf 'import "stack"\ns := stack.new_stack()\nv, ok := s.pop()\nprint(v, ok)\n' > "$dir/chk.caju" && cd "$dir" && CAJU_ROOT=$root "$caju" run chk.caju 2>&1)
      [ -n "$n" ] && [ "$n" -ge 4 ] && [ "$e" = "0 false" ] && ok=true ;;
  esac
  echo "{\"task\":\"$task\",\"mode\":\"$mode\",\"rep\":$rep,\"ok\":$ok}" > "$out/$task-$mode-$rep.check"
  cp -r "$dir" "$out/$task-$mode-$rep.files"
  rm -rf "$dir"
  echo "$task $mode $rep ok=$ok"
}

while IFS=$'\t' read -r task prompt; do
  for rep in $(seq 1 "$reps"); do
    for mode in cli mcp; do one "$task" "$mode" "$rep" "$prompt" & done
  done
done < "$here/tasks.txt"
wait
rm -rf "$bin" "$cfg"
