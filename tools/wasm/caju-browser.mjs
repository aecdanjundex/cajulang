// Caju in a browser (or any JavaScript runtime with WebAssembly): the compiler itself, compiled to
// WebAssembly (caju.wasm), compiles a program to WebAssembly, and the program runs right there.
// The compiler reads the standard library and the runtime from an in-memory file system
// (caju-files.json); nothing is fetched while compiling.
//
//   import { loadCaju } from "./caju-browser.mjs"
//   const caju = await loadCaju({ wasm: await fetch("caju.wasm"), files: await (await fetch("caju-files.json")).json() })
//   const c = await caju.compile(source)                // { ok, wasm, errors, ms }
//   if (c.ok) await caju.run(c.wasm, { stdout, stderr })   // the exit code
//
// Run this in a Web Worker: a program that never ends blocks the thread that runs it.
import { runModule } from "./caju-host.mjs"

const enc = new TextEncoder()
const dec = new TextDecoder()

// A file system in memory: base files (shared, read-only) plus what the programs write.
export class MemFS {
  constructor(base, cwd = "/work") {
    this.files = new Map(base)               // path -> Uint8Array
    this.dirs = new Set(["/"])
    this.modes = new Map()
    this.links = new Map()
    this.mtimes = new Map()
    this.cwdPath = cwd
    for (const p of this.files.keys()) this.addParents(p)
    this.dirs.add(cwd)
    this.addParents(cwd)
  }
  addParents(p) {
    let i = p.lastIndexOf("/")
    while (i > 0) {
      p = p.slice(0, i)
      this.dirs.add(p)
      i = p.lastIndexOf("/")
    }
  }
  norm(p) {
    const out = []
    for (const part of p.split("/")) {
      if (part === "" || part === ".") continue
      if (part === "..") out.pop()
      else out.push(part)
    }
    return "/" + out.join("/")
  }
  resolve(p, follow = true) {
    p = this.norm(p)
    for (let i = 0; follow && i < 16 && this.links.has(p); i++) {
      const t = this.links.get(p)
      p = this.norm(t.startsWith("/") ? t : p.slice(0, p.lastIndexOf("/")) + "/" + t)
    }
    return p
  }
  fail(errno) { throw { errno } }
  cwd() { return this.cwdPath }
  stat(p, follow) {
    p = this.norm(p)
    if (!follow && this.links.has(p)) return { mode: 0o120777, size: this.links.get(p).length, mtimeMs: 0 }
    p = this.resolve(p)
    if (this.dirs.has(p)) return { mode: 0o040755, size: 4096, mtimeMs: 0 }
    const f = this.files.get(p)
    if (!f) this.fail(2)
    return { mode: 0o100000 | (this.modes.get(p) ?? 0o644), size: f.length, mtimeMs: this.mtimes.get(p) ?? 0 }
  }
  open(p, flags, mode) {
    p = this.resolve(p)
    if (this.dirs.has(p)) {
      if ((flags & 3) !== 0) this.fail(21)
      return { path: p, dir: true }
    }
    if (!this.files.has(p)) {
      if (!(flags & 64)) this.fail(2)
      const dir = p.slice(0, p.lastIndexOf("/")) || "/"
      if (!this.dirs.has(dir)) this.fail(2)
      this.files.set(p, new Uint8Array(0))
      this.modes.set(p, mode & 0o7777)
    } else if (flags & 512) {
      this.files.set(p, new Uint8Array(0))
    }
    this.mtimes.set(p, Date.now())
    return { path: p }
  }
  read(h, buf, pos) {
    const f = this.files.get(h.path)
    if (!f) this.fail(9)
    const n = Math.max(0, Math.min(buf.length, f.length - pos))
    buf.set(f.subarray(pos, pos + n))
    return n
  }
  write(h, data, pos) {
    let f = this.files.get(h.path)
    if (!f) this.fail(9)
    if (pos + data.length > f.length) {
      const g = new Uint8Array(Math.max(pos + data.length, f.length * 2))
      g.set(f)
      f = g.subarray(0, pos + data.length)
      this.files.set(h.path, f)
    }
    f.set(data, pos)
    this.mtimes.set(h.path, Date.now())
    return data.length
  }
  size(h) { return (this.files.get(h.path) || new Uint8Array(0)).length }
  close() {}
  readdir(p) {
    p = this.resolve(p)
    if (!this.dirs.has(p)) this.fail(this.files.has(p) ? 20 : 2)
    const pre = p === "/" ? "/" : p + "/"
    const names = new Map()
    for (const d of this.dirs) if (d.startsWith(pre) && d.length > pre.length && !d.slice(pre.length).includes("/")) names.set(d.slice(pre.length), true)
    for (const f of [...this.files.keys(), ...this.links.keys()]) if (f.startsWith(pre) && !f.slice(pre.length).includes("/")) names.set(f.slice(pre.length), false)
    return [{ name: ".", dir: true }, { name: "..", dir: true }, ...[...names].map(([name, dir]) => ({ name, dir }))]
  }
  mkdir(p) {
    p = this.norm(p)
    if (this.dirs.has(p) || this.files.has(p)) this.fail(17)
    if (!this.dirs.has(p.slice(0, p.lastIndexOf("/")) || "/")) this.fail(2)
    this.dirs.add(p)
  }
  rmdir(p) {
    p = this.norm(p)
    if (!this.dirs.has(p)) this.fail(2)
    if (this.readdir(p).length > 2) this.fail(39)
    this.dirs.delete(p)
  }
  unlink(p) {
    p = this.norm(p)
    if (this.links.delete(p)) return
    if (!this.files.delete(p)) this.fail(this.dirs.has(p) ? 21 : 2)
  }
  rename(a, b) {
    a = this.norm(a)
    b = this.norm(b)
    if (this.files.has(a)) {
      this.files.set(b, this.files.get(a))
      this.files.delete(a)
    } else if (this.dirs.has(a)) {
      for (const k of [...this.files.keys()]) if (k.startsWith(a + "/")) { this.files.set(b + k.slice(a.length), this.files.get(k)); this.files.delete(k) }
      for (const d of [...this.dirs]) if (d === a || d.startsWith(a + "/")) { this.dirs.delete(d); this.dirs.add(b + d.slice(a.length)) }
    } else this.fail(2)
  }
  chmod(p, m) { this.modes.set(this.resolve(p), m & 0o7777) }
  symlink(t, p) { this.links.set(this.norm(p), t) }
  readlink(p) {
    p = this.norm(p)
    if (!this.links.has(p)) this.fail(22)
    return this.links.get(p)
  }
}

export async function loadCaju({ wasm, files, root = "/caju" }) {
  let mod
  if (wasm instanceof WebAssembly.Module) mod = wasm
  else if (typeof Response !== "undefined" && wasm instanceof Response) mod = await WebAssembly.compileStreaming(wasm)
  else mod = await WebAssembly.compile(wasm)
  const base = new Map()
  for (const [p, text] of Object.entries(files)) base.set(root + "/" + p, enc.encode(text))
  const env = ["CAJU_ROOT=" + root, "HOME=/work", "PATH=/caju/bin"]

  return {
    // compiles the program (main.caju, and any other files given as { "name.caju": text }) to wasm
    async compile(source, { name = "main.caju", others = {} } = {}) {
      const fs = new MemFS(base)
      fs.files.set("/work/" + name, enc.encode(source))
      for (const [p, text] of Object.entries(others)) {
        fs.files.set("/work/" + p, enc.encode(text))
        fs.addParents("/work/" + p)
      }
      let err = ""
      const t0 = performance.now()
      const code = await runModule(mod, {
        args: ["caju", "build", "--target", "wasm", "-o", "/work/main.wasm", "/work/" + name], env, fsys: fs,
        stdout: (b) => { err += dec.decode(b) }, stderr: (b) => { err += dec.decode(b) },
      })
      const ms = performance.now() - t0
      if (code !== 0) return { ok: false, wasm: null, errors: err.trimEnd(), ms }
      return { ok: true, wasm: fs.files.get("/work/main.wasm").slice(), errors: "", ms }
    },
    // runs a compiled program; stdout and stderr receive Uint8Arrays; returns the exit code
    async run(bytes, { stdout, stderr, args = [], files = {} } = {}) {
      const fs = new MemFS(new Map())
      for (const [p, text] of Object.entries(files)) {
        fs.files.set("/work/" + p, typeof text === "string" ? enc.encode(text) : text)
        fs.addParents("/work/" + p)
      }
      const m = await WebAssembly.compile(bytes)
      return runModule(m, { args: ["main", ...args], env: ["HOME=/work", "CAJU_SKIP_SLEEP=0"], fsys: fs, stdout, stderr })
    },
  }
}
