#!/usr/bin/env node
// Checks a caju-wasm package the way a browser uses it (caju-browser.mjs): compiles programs with
// the compiler in WebAssembly and runs them.
//   node tools/wasm/browser-test.mjs <package dir>
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const dir = path.resolve(process.argv[2] || "dist/caju-wasm")
const { loadCaju } = await import(pathToFileURL(path.join(dir, "caju-browser.mjs")).href)
const caju = await loadCaju({
  wasm: fs.readFileSync(path.join(dir, "caju.wasm")),
  files: JSON.parse(fs.readFileSync(path.join(dir, "caju-files.json"), "utf8")),
})
const dec = new TextDecoder()
const cases = [
  ['print("Hello, world!")', 0, "Hello, world!\n"],
  ['import "std/strings"\nimport "std/json"\nstruct P { name: str, n: int }\ns, _ := json.marshal(P{"caju", 3})\nprint(strings.to_upper("ok"), s)', 0, 'OK {"name":"caju","n":3}\n'],
  ['fn f(n: int) -> int {\n  if n < 2 { return n }\n  return f(n - 1) + f(n - 2)\n}\nprint(f(25))', 0, "75025\n"],
  ['x := []int{1, 2}\nprint(x[5])', 1, "Runtime error in main.caju, line 2: Index 5 out of range (length 2).\n"],
]
let bad = 0
for (const [src, wantCode, want] of cases) {
  const c = await caju.compile(src)
  if (!c.ok) {
    console.log("FAIL compile:\n" + c.errors)
    bad++
    continue
  }
  let out = ""
  const code = await caju.run(c.wasm, { stdout: (b) => { out += dec.decode(b) }, stderr: (b) => { out += dec.decode(b) } })
  const ok = code === wantCode && out === want
  if (!ok) bad++
  console.log(`${ok ? "ok  " : "FAIL"} compile ${c.ms.toFixed(0)} ms, exit ${code}: ${JSON.stringify(out)}`)
}
const c = await caju.compile("print(1 +)")
if (c.ok || !c.errors.includes("line 1")) {
  console.log("FAIL: a syntax error should not compile: " + c.errors)
  bad++
} else console.log("ok   syntax error: " + c.errors)
process.exit(bad ? 1 : 0)
