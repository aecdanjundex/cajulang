// Runs a Caju program compiled with `caju build --target wasm`: gives the module the Linux system
// calls that the runtime and the standard library make (see compiler/wasm.caju and rt/wasm.caju),
// over a file system object (Node's real one in run.mjs, an in-memory one in the playground).
//
//   const code = await runCaju(bytes, { args, env, fsys, stdout, stderr })
//
// fsys: { cwd(), stat(path, follow) -> {mode, size, mtimeMs}, open(path, flags, mode) -> handle,
//   read(h, u8, pos) -> n, write(h, u8, pos) -> n, size(h), close(h), readdir(path) -> [{name, dir}],
//   mkdir(path, mode), rmdir(path), unlink(path), rename(a, b), chmod(path, mode),
//   symlink(target, path), readlink(path) }. Errors are thrown as { errno } (positive).

export class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`)
    this.code = code
  }
}

const ENOENT = 2, EBADF = 9, ENOMEM = 12, EINVAL = 22, ENOSYS = 38, ENOTDIR = 20

export async function runCaju(bytes, opts) {
  const mod = await WebAssembly.compile(bytes)
  return runModule(mod, opts)
}

export async function runModule(mod, { args = ["main"], env = [], fsys, stdout, stderr, stdin = null, now = () => performance.now(), spawn = null }) {
  let memory = null
  let view = null
  let u8 = null
  const refresh = () => {
    if (view === null || view.buffer !== memory.buffer) {
      view = new DataView(memory.buffer)
      u8 = new Uint8Array(memory.buffer)
    }
  }
  const fds = new Map()          // fd -> { h, pos, path, dir: [entries] | null, dpos }
  let nextFd = 3
  let poolNext = 0, poolEnd = 0, arenaBase = 0
  const dec = new TextDecoder()
  const enc = new TextEncoder()

  const cstr = (p) => {
    refresh()
    let e = p
    while (u8[e] !== 0) e++
    return dec.decode(u8.subarray(p, e))
  }
  const cstrs = (p) => {
    refresh()
    const out = []
    for (;;) {
      const q = Number(view.getBigInt64(p, true))
      if (q === 0) return out
      out.push(cstr(q))
      p += 8
    }
  }
  const abs = (p) => {
    if (p.startsWith("/")) return p
    const c = fsys.cwd()
    return c.endsWith("/") ? c + p : c + "/" + p
  }
  const ensure = (end) => {
    const have = memory.buffer.byteLength
    // in large steps: every grow replaces the buffer (and the views on it)
    if (end > have) memory.grow(Math.min(65536 - have / 65536, Math.max(Math.ceil((end - have) / 65536), 256, have / 65536 / 4 | 0)))
    refresh()
  }
  const errno = (e) => {
    if (e && typeof e.errno === "number") return -Math.abs(e.errno)
    return -EINVAL
  }
  const writeStat = (st, buf) => {
    refresh()
    u8.fill(0, buf, buf + 144)
    view.setUint32(buf + 24, st.mode, true)
    view.setBigInt64(buf + 48, BigInt(st.size), true)
    const ms = st.mtimeMs || 0
    const sec = Math.floor(ms / 1000)
    view.setBigInt64(buf + 88, BigInt(sec), true)
    view.setBigInt64(buf + 96, BigInt(Math.floor((ms - sec * 1000) * 1e6)), true)
  }
  const sleepMs = (ms) => {
    if (ms <= 0) return
    if (typeof SharedArrayBuffer !== "undefined" && typeof Atomics !== "undefined") {
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
        return
      } catch {}
    }
    const end = Date.now() + ms
    while (Date.now() < end) {}
  }

  function syscall(nB, a1B, a2B, a3B, a4B, a5B, a6B) {
    const n = Number(nB)
    const a1 = Number(a1B), a2 = Number(a2B), a3 = Number(a3B)
    try {
      switch (n) {
        case 0: {                                       // read(fd, buf, n)
          refresh()
          if (a1 === 0) {
            if (!stdin) return 0n
            const got = stdin(a3)
            if (!got || got.length === 0) return 0n
            u8.set(got.subarray(0, a3), a2)
            return BigInt(Math.min(got.length, a3))
          }
          const f = fds.get(a1)
          if (!f || f.dir) return BigInt(-EBADF)
          if (f.mem) {
            const k = Math.min(a3, f.mem.length - f.pos)
            u8.set(f.mem.subarray(f.pos, f.pos + k), a2)
            f.pos += k
            return BigInt(k)
          }
          const r = fsys.read(f.h, u8.subarray(a2, a2 + a3), f.pos)
          f.pos += r
          return BigInt(r)
        }
        case 1: {                                       // write(fd, buf, n)
          refresh()
          const data = u8.slice(a2, a2 + a3)
          if (a1 === 1) { stdout(data); return BigInt(a3) }
          if (a1 === 2) { stderr(data); return BigInt(a3) }
          const f = fds.get(a1)
          if (!f || f.dir) return BigInt(-EBADF)
          const pos = f.append ? fsys.size(f.h) : f.pos
          const w = fsys.write(f.h, data, pos)
          f.pos = pos + w
          return BigInt(w)
        }
        case 2: {                                       // open(path, flags, mode)
          const path = abs(cstr(a1))
          if (a2 & 65536) {                             // O_DIRECTORY
            const entries = fsys.readdir(path)
            const fd = nextFd++
            fds.set(fd, { dir: entries, dpos: 0, path })
            return BigInt(fd)
          }
          const h = fsys.open(path, a2, a3)
          const fd = nextFd++
          fds.set(fd, { h, pos: 0, path, append: (a2 & 1024) !== 0 })
          return BigInt(fd)
        }
        case 3: {                                       // close
          const f = fds.get(a1)
          if (!f) return BigInt(-EBADF)
          if (!f.dir && !f.mem) fsys.close(f.h)
          fds.delete(a1)
          return 0n
        }
        case 4: case 6: {                               // stat, lstat
          writeStat(fsys.stat(abs(cstr(a1)), n === 4), a2)
          return 0n
        }
        case 5: {                                       // fstat
          const f = fds.get(a1)
          if (!f) return BigInt(-EBADF)
          writeStat(fsys.stat(f.path, true), a2)
          return 0n
        }
        case 8: {                                       // lseek(fd, off, whence)
          const f = fds.get(a1)
          if (!f || f.dir) return BigInt(-EBADF)
          if (a3 === 0) f.pos = a2
          else if (a3 === 1) f.pos += a2
          else f.pos = fsys.size(f.h) + a2
          return BigInt(f.pos)
        }
        case 9: {                                       // mmap: the arena (MAP_NORESERVE) or the pool
          if (a4B & 0x4000n) return BigInt(arenaBase)
          const size = Math.ceil(a2 / 65536) * 65536
          if (poolNext + size > poolEnd) return BigInt(-ENOMEM)
          const p = poolNext
          poolNext += size
          ensure(poolNext)
          u8.fill(0, p, p + size)
          return BigInt(p)
        }
        case 10: {                                      // mprotect: commit arena pages
          if (a1 + a2 > 4294967296) return BigInt(-ENOMEM)
          ensure(a1 + a2)
          return 0n
        }
        case 28: return 0n                              // madvise
        case 35: {                                      // nanosleep
          refresh()
          const ms = Number(view.getBigInt64(a1, true)) * 1000 + Number(view.getBigInt64(a1 + 8, true)) / 1e6
          sleepMs(ms)
          return 0n
        }
        case 21: {                                      // access
          fsys.stat(abs(cstr(a1)), true)
          return 0n
        }
        case 39: return 1n                              // getpid
        case 60: case 231: throw new Exit(a1)           // exit, exit_group
        case 79: {                                      // getcwd
          const b = enc.encode(fsys.cwd() + "\0")
          if (b.length > a2) return BigInt(-34)
          refresh()
          u8.set(b, a1)
          return BigInt(b.length)
        }
        case 82: fsys.rename(abs(cstr(a1)), abs(cstr(a2))); return 0n
        case 83: fsys.mkdir(abs(cstr(a1)), a2); return 0n
        case 84: fsys.rmdir(abs(cstr(a1))); return 0n
        case 87: fsys.unlink(abs(cstr(a1))); return 0n
        case 88: fsys.symlink(cstr(a1), abs(cstr(a2))); return 0n
        case 89: {                                      // readlink
          const p = cstr(a1)
          const t = enc.encode(p === "/proc/self/exe" ? "/caju/bin/caju" : fsys.readlink(abs(p)))
          const k = Math.min(t.length, a3)
          refresh()
          u8.set(t.subarray(0, k), a2)
          return BigInt(k)
        }
        case 90: fsys.chmod(abs(cstr(a1)), a2); return 0n
        case 217: {                                     // getdents64(fd, buf, n)
          const f = fds.get(a1)
          if (!f || !f.dir) return BigInt(-ENOTDIR)
          refresh()
          let off = 0
          while (f.dpos < f.dir.length) {
            const e = f.dir[f.dpos]
            const name = enc.encode(e.name)
            const reclen = Math.ceil((19 + name.length + 1) / 8) * 8
            if (off + reclen > a3) break
            const p = a2 + off
            u8.fill(0, p, p + reclen)
            view.setBigUint64(p, BigInt(f.dpos + 1), true)
            view.setBigInt64(p + 8, BigInt(f.dpos + 1), true)
            view.setUint16(p + 16, reclen, true)
            u8[p + 18] = e.dir ? 4 : 8
            u8.set(name, p + 19)
            off += reclen
            f.dpos++
          }
          return BigInt(off)
        }
        case 228: {                                     // clock_gettime(clock, ts)
          const ms = a1 === 0 ? Date.now() : now()
          const sec = Math.floor(ms / 1000)
          refresh()
          view.setBigInt64(a2, BigInt(sec), true)
          view.setBigInt64(a2 + 8, BigInt(Math.floor((ms - sec * 1000) * 1e6)), true)
          return 0n
        }
        case 1000: {                                    // run a program: (path, argv, envp, merge, out)
          if (!spawn) return BigInt(-ENOSYS)
          const r = spawn(cstr(a1), cstrs(a2), cstrs(a3), Number(a4B) !== 0)
          const fd = nextFd++
          fds.set(fd, { mem: r.output, pos: 0, path: "" })
          const out = Number(a5B)
          refresh()
          view.setBigInt64(out, BigInt(fd), true)
          view.setBigInt64(out + 8, BigInt(r.status), true)
          return 0n
        }
        case 318: {                                     // getrandom
          refresh()
          const b = new Uint8Array(a2)
          crypto.getRandomValues(b)
          u8.set(b, a1)
          return BigInt(a2)
        }
        default:
          return BigInt(-ENOSYS)
      }
    } catch (e) {
      if (e instanceof Exit) throw e
      return BigInt(errno(e))
    }
  }

  const imports = { caju: { syscall, fmod: (a, b) => a % b } }
  const inst = await WebAssembly.instantiate(mod, imports)
  memory = inst.exports.memory
  refresh()
  poolNext = inst.exports.pool_lo.value
  arenaBase = inst.exports.arena_base.value
  poolEnd = arenaBase
  // the arguments and the environment, as Linux puts them on the stack: argc, argv..., 0, envp..., 0
  const argv = inst.exports.argv.value
  const strs = []
  let at = argv + 8 * (args.length + env.length + 3)
  const ptrs = []
  for (const s of [...args, ...env]) {
    const b = enc.encode(s + "\0")
    ptrs.push(at)
    strs.push([at, b])
    at += b.length
  }
  if (at > 65536) throw new Error("caju: arguments and environment too long")
  view.setBigInt64(argv, BigInt(args.length), true)
  let w = argv + 8
  for (let i = 0; i < args.length; i++, w += 8) view.setBigInt64(w, BigInt(ptrs[i]), true)
  view.setBigInt64(w, 0n, true)
  w += 8
  for (let i = 0; i < env.length; i++, w += 8) view.setBigInt64(w, BigInt(ptrs[args.length + i]), true)
  view.setBigInt64(w, 0n, true)
  for (const [p, b] of strs) u8.set(b, p)
  try {
    inst.exports._start()
  } catch (e) {
    if (e instanceof Exit) return e.code
    // the engine's stack ran out before the 10,000 calls of the depth limit (a browser's stack
    // is smaller than the 16 MB of the program's own stack)
    if (e instanceof RangeError) {
      stderr(enc.encode("Runtime error: too much recursion for this browser's stack.\n"))
      return 1
    }
    throw e
  }
  return 0
}
