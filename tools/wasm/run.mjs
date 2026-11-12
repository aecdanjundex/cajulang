#!/usr/bin/env node
// Runs a Caju program compiled to WebAssembly with Node, over the real file system.
//   node tools/wasm/run.mjs program.wasm [arguments...]
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { Worker, isMainThread } from "node:worker_threads"
import { runCaju } from "./caju-host.mjs"

// The program runs in a worker thread with a large stack: every Caju call is also a frame of the
// engine's own stack (about 1 MB on the main thread), and 10,000 nested calls must fit.
if (isMainThread) {
  const w = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2), resourceLimits: { stackSizeMb: 256 } })
  w.on("exit", (code) => process.exit(code))
  w.on("error", (e) => {
    console.error(e)
    process.exit(70)
  })
} else {

const codes = { ENOENT: 2, EEXIST: 17, ENOTDIR: 20, EISDIR: 21, EACCES: 13, ENOTEMPTY: 39, EINVAL: 22, EBADF: 9, EPERM: 1 }
const wrap = (fn) => (...a) => {
  try {
    return fn(...a)
  } catch (e) {
    if (e && e.code && codes[e.code]) throw { errno: codes[e.code] }
    throw e
  }
}

const fsys = {
  cwd: () => process.cwd(),
  stat: wrap((p, follow) => {
    const s = follow ? fs.statSync(p) : fs.lstatSync(p)
    return { mode: s.mode, size: s.size, mtimeMs: s.mtimeMs }
  }),
  open: wrap((p, flags, mode) => {
    let f = "r"
    const acc = flags & 3
    if (acc === 1) f = (flags & 1024) ? "a" : "w"
    else if (acc === 2) f = "r+"
    if (acc !== 0 && !(flags & 64)) f = (flags & 1024) ? "a" : "r+"
    if (acc !== 0 && (flags & 64) && !(flags & 512) && !(flags & 1024)) {
      // O_CREAT without O_TRUNC: create if missing, keep the contents
      if (!fs.existsSync(p)) fs.writeFileSync(p, "", { mode })
      f = "r+"
    }
    return fs.openSync(p, f, mode || 0o644)
  }),
  read: wrap((h, buf, pos) => fs.readSync(h, buf, 0, buf.length, pos)),
  write: wrap((h, data, pos) => fs.writeSync(h, data, 0, data.length, pos)),
  size: wrap((h) => fs.fstatSync(h).size),
  close: wrap((h) => fs.closeSync(h)),
  readdir: wrap((p) => [{ name: ".", dir: true }, { name: "..", dir: true },
    ...fs.readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }))]),
  mkdir: wrap((p, mode) => fs.mkdirSync(p, { mode })),
  rmdir: wrap((p) => fs.rmdirSync(p)),
  unlink: wrap((p) => fs.unlinkSync(p)),
  rename: wrap((a, b) => fs.renameSync(a, b)),
  chmod: wrap((p, m) => fs.chmodSync(p, m)),
  symlink: wrap((t, p) => fs.symlinkSync(t, p)),
  readlink: wrap((p) => fs.readlinkSync(p)),
}

const [file, ...rest] = process.argv.slice(2)
if (!file) {
  console.error("usage: node tools/wasm/run.mjs program.wasm [arguments...]")
  process.exit(2)
}
const env = Object.entries(process.env).map(([k, v]) => `${k}=${v}`)
const out = (fd) => (b) => { fs.writeSync(fd, b) }
const stdin = (n) => {
  const b = Buffer.alloc(n)
  try { return b.subarray(0, fs.readSync(0, b, 0, n, null)) } catch { return null }
}
// os.run: the program runs for real; its output (and error, when merged) comes back whole
const spawn = (p, argv, envp, merge) => {
  const cmd = merge ? ["sh", ["-c", 'exec "$0" "$@" 2>&1', p, ...argv.slice(1)]] : [p, argv.slice(1)]
  const envo = {}
  for (const kv of envp) {
    const i = kv.indexOf("=")
    if (i > 0) envo[kv.slice(0, i)] = kv.slice(i + 1)
  }
  const r = spawnSync(cmd[0], cmd[1], { env: envo, stdio: ["inherit", "pipe", merge ? "pipe" : "inherit"], maxBuffer: 1 << 30 })
  if (r.error) return { output: new Uint8Array(0), status: 127 << 8 }
  const status = r.signal ? 9 : ((r.status ?? 0) & 255) << 8
  return { output: new Uint8Array(r.stdout), status }
}
const code = await runCaju(fs.readFileSync(file), {
  args: [path.basename(file, ".wasm"), ...rest], env, fsys, stdout: out(1), stderr: out(2), stdin, spawn,
})
process.exit(code)
}
