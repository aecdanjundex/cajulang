#!/usr/bin/env node
// caju-files.json: the files the compiler reads (lib/*.caju without the tests, rt/*.caju), as
// { "lib/strings.caju": "...", ... }, for the in-memory file system of caju-browser.mjs.
//   node tools/wasm/bundle-files.mjs <caju root> <output.json>
import fs from "node:fs"
import path from "node:path"

const [root, out] = process.argv.slice(2)
const files = {}
for (const dir of ["lib", "rt"]) {
  for (const name of fs.readdirSync(path.join(root, dir)).sort()) {
    if (!name.endsWith(".caju") || name.endsWith("_test.caju")) continue
    files[`${dir}/${name}`] = fs.readFileSync(path.join(root, dir, name), "utf8")
  }
}
fs.writeFileSync(out, JSON.stringify(files))
console.log(`${out}: ${Object.keys(files).length} files`)
