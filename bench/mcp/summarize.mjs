#!/usr/bin/env node
// Summary of bench/mcp/results: per task and mode, the success rate and the means of turns,
// tool calls, compiler calls, compile errors seen, tokens, time and cost.
import fs from "node:fs"
import path from "node:path"

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "results")
const runs = []
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".check"))) {
  const check = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
  const lines = fs.readFileSync(path.join(dir, f.replace(".check", ".jsonl")), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const res = lines.find((m) => m.type === "result") || {}
  let tools = 0, compiler = 0, errors = 0, docs = 0
  const byName = {}
  for (const m of lines) {
    for (const c of m.message?.content ?? []) {
      if (c.type === "tool_use") {
        tools++
        const name = c.name === "Bash" ? "Bash:" + String(c.input?.command ?? "").split(/\s+/).slice(0, 2).join(" ") : c.name
        byName[name] = (byName[name] || 0) + 1
        if (c.name === "Bash" || c.name.startsWith("mcp__caju__caju_check") || c.name.startsWith("mcp__caju__caju_run") || c.name.startsWith("mcp__caju__caju_test")) compiler++
        if (c.name.startsWith("mcp__caju__caju_docs") || c.name.startsWith("mcp__caju__caju_reference") || /caju (help|--help|-h)|caju$/.test(String(c.input?.command ?? ""))) docs++
      }
      if (c.type === "tool_result") {
        const t = typeof c.content === "string" ? c.content : JSON.stringify(c.content)
        if (/(Syntax|Type|Compile|Link|Lexical) error|"ok":false|"compiled":false|"stage":"/.test(t)) errors++
      }
    }
  }
  const u = res.usage ?? {}
  runs.push({ ...check, turns: res.num_turns ?? 0, tools, compiler, docs, errors, byName,
    tokens_in: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), tokens_out: u.output_tokens ?? 0,
    seconds: (res.duration_ms ?? 0) / 1000, cost: res.total_cost_usd ?? 0 })
}
const keys = ["turns", "tools", "compiler", "docs", "errors", "tokens_in", "tokens_out", "seconds", "cost"]
const mean = (xs, k) => xs.reduce((s, r) => s + r[k], 0) / Math.max(xs.length, 1)
const rows = []
for (const task of [...new Set(runs.map((r) => r.task))].sort()) {
  for (const mode of ["cli", "mcp"]) {
    const xs = runs.filter((r) => r.task === task && r.mode === mode)
    if (!xs.length) continue
    const row = { task, mode, runs: xs.length, ok: xs.filter((r) => r.ok).length }
    for (const k of keys) row[k] = mean(xs, k)
    rows.push(row)
  }
}
for (const mode of ["cli", "mcp"]) {
  const xs = runs.filter((r) => r.mode === mode)
  const row = { task: "all", mode, runs: xs.length, ok: xs.filter((r) => r.ok).length }
  for (const k of keys) row[k] = mean(xs, k)
  rows.push(row)
}
console.log(JSON.stringify({ rows, runs: runs.map(({ byName, ...r }) => ({ ...r, byName })) }, null, 1))
