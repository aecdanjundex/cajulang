#!/usr/bin/env node
// Prints the instructions of functions of a Caju wasm module, by name (from its "name" section).
//   node tools/wasm/disasm.mjs program.wasm u.f.add [more names...]
//   node tools/wasm/disasm.mjs program.wasm --list          (every function name)
import fs from "node:fs"

const [file, ...want] = process.argv.slice(2)
if (!file || want.length === 0) {
  console.error("usage: node tools/wasm/disasm.mjs program.wasm (function name... | --list)")
  process.exit(2)
}
const b = fs.readFileSync(file)
let p = 8
const u = () => {
  let r = 0, s = 0, c
  do { c = b[p++]; r += (c & 127) * 2 ** s; s += 7 } while (c & 128)
  return r
}
const sl = () => {
  let r = 0n, s = 0n, c
  do { c = b[p++]; r |= BigInt(c & 127) << s; s += 7n } while (c & 128)
  if (c & 64) r -= 1n << s
  return r
}
const str = () => { const n = u(); const s = b.subarray(p, p + n).toString(); p += n; return s }

let nimports = 0
const bodies = []
const names = new Map()
while (p < b.length) {
  const id = b[p++]
  const size = u()
  const end = p + size
  if (id === 2) {
    const n = u()
    for (let i = 0; i < n; i++) { str(); str(); const k = b[p++]; u(); if (k === 0) nimports++ }
  } else if (id === 10) {
    const n = u()
    for (let i = 0; i < n; i++) { const sz = u(); bodies.push([p, p + sz]); p += sz }
  } else if (id === 0 && str() === "name") {
    while (p < end) {
      const sub = b[p++], ssz = u(), send = p + ssz
      if (sub === 1) { const n = u(); for (let i = 0; i < n; i++) { const idx = u(); names.set(idx, str()) } }
      p = send
    }
  }
  p = end
}
if (want[0] === "--list") {
  for (const [i, n] of names) console.log(i, n)
  process.exit(0)
}

const plain = { 0x00: "unreachable", 0x01: "nop", 0x05: "else", 0x07: "catch", 0x0B: "end", 0x0F: "return", 0x1A: "drop", 0x1B: "select",
  0x45: "i32.eqz", 0x46: "i32.eq", 0x47: "i32.ne", 0x48: "i32.lt_s", 0x49: "i32.lt_u", 0x4A: "i32.gt_s", 0x4B: "i32.gt_u", 0x4C: "i32.le_s", 0x4D: "i32.le_u", 0x4E: "i32.ge_s", 0x4F: "i32.ge_u",
  0x50: "i64.eqz", 0x51: "i64.eq", 0x52: "i64.ne", 0x53: "i64.lt_s", 0x54: "i64.lt_u", 0x55: "i64.gt_s", 0x56: "i64.gt_u", 0x57: "i64.le_s", 0x58: "i64.le_u", 0x59: "i64.ge_s", 0x5A: "i64.ge_u",
  0x61: "f64.eq", 0x62: "f64.ne", 0x63: "f64.lt", 0x64: "f64.gt", 0x65: "f64.le", 0x66: "f64.ge",
  0x6A: "i32.add", 0x6B: "i32.sub", 0x6C: "i32.mul", 0x71: "i32.and", 0x72: "i32.or",
  0x7C: "i64.add", 0x7D: "i64.sub", 0x7E: "i64.mul", 0x7F: "i64.div_s", 0x80: "i64.div_u", 0x81: "i64.rem_s", 0x82: "i64.rem_u", 0x83: "i64.and", 0x84: "i64.or", 0x85: "i64.xor", 0x86: "i64.shl", 0x87: "i64.shr_s", 0x88: "i64.shr_u",
  0x9F: "f64.sqrt", 0xA0: "f64.add", 0xA1: "f64.sub", 0xA2: "f64.mul", 0xA3: "f64.div",
  0xA7: "i32.wrap_i64", 0xAD: "i64.extend_i32_u", 0xB0: "i64.trunc_f64_s", 0xB6: "f32.demote_f64", 0xB9: "f64.convert_i64_s", 0xBA: "f64.convert_i64_u", 0xBB: "f64.promote_f32", 0xBD: "i64.reinterpret_f64", 0xBF: "f64.reinterpret_i64",
  0xC2: "i64.extend8_s", 0xC3: "i64.extend16_s", 0xC4: "i64.extend32_s" }
const mem = { 0x28: "i32.load", 0x29: "i64.load", 0x2D: "i32.load8_u", 0x31: "i64.load8_u", 0x35: "i64.load32_u", 0x36: "i32.store", 0x37: "i64.store", 0x3C: "i64.store8", 0x3E: "i64.store32" }
const blocks = { 0x02: "block", 0x03: "loop", 0x04: "if", 0x06: "try" }
const idx = { 0x0C: "br", 0x0D: "br_if", 0x10: "call", 0x20: "local.get", 0x21: "local.set", 0x22: "local.tee", 0x23: "global.get", 0x24: "global.set", 0x08: "throw", 0x09: "rethrow" }
const globals = ["$sp", "$depth", "$aux"]

for (const name of want) {
  const fi = [...names].find(([, n]) => n === name)?.[0]
  if (fi === undefined || fi < nimports) { console.log(`; no function ${name}`); continue }
  const [start, end] = bodies[fi - nimports]
  p = start
  const groups = u()
  const locals = []
  for (let i = 0; i < groups; i++) { const n = u(); const t = b[p++]; for (let k = 0; k < n; k++) locals.push({ 0x7F: "i32", 0x7E: "i64", 0x7C: "f64" }[t]) }
  console.log(`(func ${name}  ;; locals: ${locals.join(" ")}`)
  let depth = 1
  while (p < end) {
    const op = b[p++]
    let text
    if (op in plain) text = plain[op]
    else if (op in mem) { const a = u(); const off = u(); text = `${mem[op]}${off ? " offset=" + off : ""}` }
    else if (op in blocks) { const t = b[p++]; text = blocks[op] + (t === 0x7E ? " (result i64)" : "") }
    else if (op in idx) {
      const i = u()
      if (op === 0x10) text = `call ${names.get(i) ?? i}`
      else if (op === 0x23 || op === 0x24) text = `${idx[op]} ${globals[i] ?? i}`
      else text = `${idx[op]} ${i}`
    } else if (op === 0x11) { const t = u(); u(); text = `call_indirect (type ${t})` }
    else if (op === 0x41 || op === 0x42) text = `${op === 0x41 ? "i32" : "i64"}.const ${sl()}`
    else if (op === 0x44) { text = `f64.const ${b.readDoubleLE(p)}`; p += 8 }
    else text = `;; opcode 0x${op.toString(16)}`
    if (op === 0x0B || op === 0x05 || op === 0x07) depth--
    if (p < end || op !== 0x0B) console.log("  ".repeat(Math.max(depth, 1)) + text)
    if (op in blocks || op === 0x05 || op === 0x07) depth++
  }
  console.log(")")
}
