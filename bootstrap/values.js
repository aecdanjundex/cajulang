  // =====================================================================
  // Pieces shared by both execution modes
  // =====================================================================
  // =====================================================================
  // Runtime values of the language
  // =====================================================================
  // number (int or num, depending on the static type), string, boolean, null (nil) and the objects below.
  // Struct: the type (name, fields, methods) and the field values. A pointer to a struct is the object itself.
  class CajuStruct { constructor(t, f) { this.t = t; this.f = f; } }
  // Box: a value stored in an interface that must carry its type along (int8, integral num, *Point...)
  class CajuBox { constructor(t, v) { this.t = t; this.v = v; } }
  // Slice: a window over a shared backing array (a), as in Go
  class CajuSlice { constructor(t, a, off, len, cap) { this.t = t; this.a = a; this.off = off; this.len = len; this.cap = cap; } }
  // Fixed-size array: it is a value (copied), like a struct
  class CajuArr { constructor(t, a) { this.t = t; this.a = a; } }
  class CajuMap { constructor(t) { this.t = t; this.m = new Map(); } }
  // Function value: which function, the captured cells (closure) and already bound arguments (method value)
  class CajuFunc { constructor(t, fidx, cells, bound) { this.t = t; this.fidx = fidx; this.cells = cells; this.bound = bound; } }
  // Pointer to something that is neither a struct nor an array: o[k] is the pointed-to place
  class CajuPtr { constructor(o, k) { this.o = o; this.k = k; } }
  class CajuChan { constructor(t, cap) { this.t = t; this.cap = cap; this.buf = []; this.closed = false; this.recvq = []; this.sendq = []; } }
  class CajuErr { constructor(msg) { this.msg = msg; } }
  class Cell { constructor(v) { this.v = v; } }

  // ---- numbers ----
  // Integers live in floating-point numbers: exact up to 2^53; 64-bit arithmetic
  // wraps around (as in Go) and, above 2^53, the result is rounded.
  const TWO32 = 4294967296;
  const big64 = (x, unsigned) => Number(unsigned ? BigInt.asUintN(64, BigInt(x)) : BigInt.asIntN(64, BigInt(x)));
  function wrapKind(x, k) {
    switch (k) {
      case 1: return (x << 24) >> 24;
      case 2: return (x << 16) >> 16;
      case 3: return x | 0;
      case 6: return x & 0xff;
      case 7: return x & 0xffff;
      case 8: return x >>> 0;
      case 5: case 9: return Number.isSafeInteger(x) && x >= 0 ? x : big64(x, true);
      case 10: return Math.fround(x);
      case 11: return x;
      default: return Number.isSafeInteger(x) ? x : big64(x, false);
    }
  }
  const isNarrow = (k) => (k >= 1 && k <= 3) || (k >= 6 && k <= 8);
  const UNSIGNED = (k) => k >= 5 && k <= 9;
  const bigOp = (op, a, b, k) => {
    const A = BigInt(a), B = BigInt(b);
    const r = op === 0 ? A + B : op === 1 ? A - B : op === 2 ? A * B : op === 3 ? A / B : op === 7 ? A & B : op === 8 ? A | B : op === 9 ? A ^ B : A & ~B;
    return Number(UNSIGNED(k) ? BigInt.asUintN(64, r) : BigInt.asIntN(64, r));
  };
  // integer operation: op 0 + 1 - 2 * 3 / 4 % 5 << 6 >> 7 & 8 | 9 ^ 10 &^ 11 ^x (unary)
  function intOp(op, k, a, b, fail) {
    if (a instanceof CajuBox) a = a.v;
    if (b instanceof CajuBox) b = b.v;
    if (typeof a !== "number" || (op !== 11 && typeof b !== "number")) fail(`The "${IOP_SYMBOLS[op]}" operation only works with integers, and got ${typeName(op === 11 || typeof a !== "number" ? a : b)}`);
    if (!Number.isInteger(a) || (op !== 11 && !Number.isInteger(b))) { a = Math.trunc(a); b = Math.trunc(b); }
    switch (op) {
      case 0: case 1: {
        const r = op === 0 ? a + b : a - b;
        return Number.isSafeInteger(r) ? wrapKind(r, k) : wrapKind(bigOp(op, a, b, k), k);
      }
      case 2: {
        if (isNarrow(k)) return wrapKind(Math.imul(a, b), k);
        const r = a * b;
        return Number.isSafeInteger(r) ? wrapKind(r, k) : bigOp(2, a, b, k);
      }
      case 3: {
        if (b === 0) fail("Integer division by zero");
        const q = Math.abs(a) < 4503599627370496 && Math.abs(b) < 4503599627370496 ? Math.trunc(a / b) : bigOp(3, a, b, k);
        return wrapKind(q === 0 ? 0 : q, k);
      }
      case 4: {
        if (b === 0) fail("Remainder of integer division by zero");
        const r = a % b;
        return wrapKind(r === 0 ? 0 : r, k);
      }
      case 5: {
        if (b < 0) fail("Negative shift");
        if (b >= 64) return 0;
        const r = a * 2 ** b;
        if (isNarrow(k)) return b >= 32 ? 0 : wrapKind(a << b, k);
        return Number.isSafeInteger(r) ? wrapKind(r, k) : Number(UNSIGNED(k) ? BigInt.asUintN(64, BigInt(a) << BigInt(b)) : BigInt.asIntN(64, BigInt(a) << BigInt(b)));
      }
      case 6: {
        if (b < 0) fail("Negative shift");
        if (b >= 64) return a < 0 ? -1 : 0;
        if (Number.isSafeInteger(a)) return wrapKind(Math.floor(a / 2 ** b), k);
        return Number(BigInt(a) >> BigInt(b));
      }
      case 7: case 8: case 9: case 10: {
        if (isNarrow(k) || (a >= -2147483648 && a < 2147483648 && b >= -2147483648 && b < 2147483648)) {
          const r = op === 7 ? a & b : op === 8 ? a | b : op === 9 ? a ^ b : a & ~b;
          return wrapKind(r, k);
        }
        return bigOp(op, a, b, k);
      }
      case 11: return wrapKind(-a - 1, k);
    }
  }
  const IOP_SYMBOLS = ["+", "-", "*", "/", "%", "<<", ">>", "&", "|", "^", "&^", "^"];
  // numeric conversion: int8(x), uint(x), float32(x)...
  function convNum(v, k, fail) {
    if (v instanceof CajuBox) v = v.v;
    if (typeof v !== "number") fail(`Only numbers can be converted to a number, and this value is ${typeName(v)}`);
    if (k === 11) return v;
    if (k === 10) return Math.fround(v);
    if (!Number.isFinite(v)) return 0;
    const t = Math.trunc(v);
    return wrapKind(t === 0 ? 0 : t, k);
  }

  // ---- strings ----
  const textEncoder = new TextEncoder(), textDecoder = new TextDecoder();
  let bytesCacheS = null, bytesCacheB = null;
  const bytesOf = (s) => { if (s !== bytesCacheS) { bytesCacheS = s; bytesCacheB = textEncoder.encode(s); } return bytesCacheB; };
  const runeText = (r) => (Number.isInteger(r) && r >= 0 && r <= 0x10ffff && !(r >= 0xd800 && r <= 0xdfff) ? String.fromCodePoint(r) : "\uFFFD");
  // string ordering by UTF-8 bytes (same as the native runtime, in Rust)
  const cmpText = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a.codePointAt(i), y = b.codePointAt(i);
      if (x !== y) return x < y ? -1 : 1;
      if (x > 0xffff) i++;
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  };

  // ---- formatting (print, str, +) ----
  function fmtNum(v) {
    if (Number.isInteger(v) && Math.abs(v) < 1e21) return v === 0 ? "0" : Number.isSafeInteger(v) ? String(v) : BigInt(v).toString();
    return Number.isFinite(v) ? String(Number(v.toPrecision(12))) : String(v);
  }
  function fmt(v, nested = false) {
    if (typeof v === "number") return fmtNum(v);
    if (typeof v === "string") return nested ? `"${v}"` : v;
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v === null || v === undefined) return "nil";
    if (v instanceof CajuStruct) return `${v.t.name}{${v.t.names.map((n, i) => `${n}: ${fmt(v.f[i], true)}`).join(", ")}}`;
    if (v instanceof CajuBox) return v.v instanceof CajuStruct ? "&" + fmt(v.v, nested) : fmt(v.v, nested);
    if (v instanceof CajuSlice) { const out = []; for (let i = 0; i < v.len; i++) out.push(fmt(v.a[v.off + i], true)); return `[${out.join(" ")}]`; }
    if (v instanceof CajuArr) return `[${v.a.map((x) => fmt(x, true)).join(" ")}]`;
    if (v instanceof CajuMap) {
      const keys = [...v.m.keys()].sort((a, b) => (typeof a === "string" ? cmpText(a, b) : a < b ? -1 : a > b ? 1 : 0));
      return `map[${keys.map((k) => `${fmt(k, true)}:${fmt(v.m.get(k), true)}`).join(" ")}]`;
    }
    if (v instanceof CajuErr) return v.msg;
    if (v instanceof CajuFunc) return "fn";
    if (v instanceof CajuPtr) return "&" + fmt(v.o[v.k], true);
    if (v instanceof CajuChan) return "chan";
    return String(v);
  }
  const truthy = (v) => v !== false && v !== 0 && v !== "" && v !== null && v !== undefined;
  function typeName(v) {
    if (typeof v === "number") return "number";
    if (typeof v === "string") return "string";
    if (typeof v === "boolean") return "boolean";
    if (v === null || v === undefined) return "nil";
    if (v instanceof CajuStruct) return `struct ${v.t.name}`;
    if (v instanceof CajuBox) return v.v instanceof CajuStruct ? `pointer *${v.v.t.name}` : typeName(v.v);
    if (v instanceof CajuSlice) return "slice";
    if (v instanceof CajuArr) return "array";
    if (v instanceof CajuMap) return "map";
    if (v instanceof CajuFunc) return "function";
    if (v instanceof CajuPtr) return "pointer";
    if (v instanceof CajuChan) return "channel";
    if (v instanceof CajuErr) return "error";
    return "value";
  }
  // structs and arrays are values: assigning, passing or returning copies them (only value fields, not pointers)
  function copyVal(v) {
    if (v instanceof CajuStruct) {
      const deep = v.t.deep, f = v.f.slice();
      if (deep) for (let i = 0; i < f.length; i++) if (deep[i]) f[i] = copyVal(f[i]);
      return new CajuStruct(v.t, f);
    }
    if (v instanceof CajuArr) return new CajuArr(v.t, v.deep ? v.a.map(copyVal) : v.a.slice());
    return v;
  }
  // writes src over dst, keeping the object (pointers to it remain valid)
  function copyInto(dst, src) {
    if (dst instanceof CajuStruct && src instanceof CajuStruct) {
      const deep = dst.t.deep;
      for (let i = 0; i < dst.f.length; i++) {
        if (deep && deep[i] && dst.f[i] && typeof dst.f[i] === "object") copyInto(dst.f[i], src.f[i]);
        else dst.f[i] = src.f[i];
      }
      return;
    }
    if (dst instanceof CajuArr && src instanceof CajuArr) {
      for (let i = 0; i < dst.a.length; i++) {
        if (dst.deep && dst.a[i] && typeof dst.a[i] === "object") copyInto(dst.a[i], src.a[i]);
        else dst.a[i] = src.a[i];
      }
    }
  }
  function valEq(a, b) {
    if (a === b) return true;
    if (a === undefined) a = null;
    if (b === undefined) b = null;
    if (a === null || b === null) return a === b;
    if (a instanceof CajuStruct && b instanceof CajuStruct) {
      if (a.t !== b.t) return false;
      const deep = a.t.deep;
      for (let i = 0; i < a.f.length; i++) if (deep && deep[i] ? !valEq(a.f[i], b.f[i]) : !(a.f[i] === b.f[i] || valEqFlat(a.f[i], b.f[i]))) return false;
      return true;
    }
    if (a instanceof CajuArr && b instanceof CajuArr) return a.t === b.t && a.a.every((x, i) => valEq(x, b.a[i]));
    if (a instanceof CajuBox && b instanceof CajuBox) return a.t === b.t && (a.v === b.v || valEq(a.v, b.v));
    if (a instanceof CajuPtr && b instanceof CajuPtr) return a.o === b.o && a.k === b.k;
    return false;
  }
  // field that is neither a struct nor an array: numbers, strings, boxes and pointers
  const valEqFlat = (a, b) => (a instanceof CajuBox || b instanceof CajuBox || a instanceof CajuPtr ? valEq(a, b) : a instanceof CajuStruct && b instanceof CajuStruct && !a.t.ptrFieldCompare ? a === b : a === b);
  // an expression that already produces a new value need not be copied; a variable or a field must be
  const freshExpr = (n) => (n.kind === "Paren" ? freshExpr(n.expr) : !["Var", "Field", "Index", "Deref", "TypeAssert"].includes(n.kind));

  // Built-in functions. The position in the list is the number used by the CALL instruction.
  const BUILTINS = ["print", "sleep", "alloc", "free", "peek8", "peek16", "peek32", "peek64",
    "poke8", "poke16", "poke32", "readstr", "readwstr"];
  const BUILTIN_ARITY = { print: -1, sleep: 1, alloc: 1, free: 1, peek8: 1, peek16: 1, peek32: 1, peek64: 1,
    poke8: 2, poke16: 2, poke32: 2, readstr: 1, readwstr: 1 };
  const MAX_DEPTH = 10_000;      // nested function calls open at the same time

  // Validates and runs sleep; shared by the tree interpreter and the VM
  async function nap(io, s, line, col, pc) {
    if (typeof s !== "number") throw new CajuError("runtime", "sleep expects a number of seconds, like sleep(1)", line, col);
    if (s < 0 || s > 30) throw new CajuError("runtime", "sleep accepts 0 to 30 seconds", line, col);
    if (io.skipSleep) return;
    io.sleeping(line, s, pc);
    await waitMs(io, s * 1000);
    io.awake();
  }
  // wait that can be interrupted by the Stop button
  async function waitMs(io, ms) {
    await new Promise((resolve) => {
      const id = setTimeout(resolve, ms);
      io.token.wake = () => { clearTimeout(id); resolve(); };
    });
    io.token.wake = null;
    if (io.token.stopped) throw new Stopped();
  }

  // Binary operators, used by both modes
  function binop(op, a, b, fail) {
    if (a instanceof CajuBox) a = a.v;
    if (b instanceof CajuBox) b = b.v;
    switch (op) {
      case "==": return valEq(a, b);
      case "!=": return !valEq(a, b);
      case "<": case ">": case "<=": case ">=":
        if (typeof a !== typeof b || typeof a === "boolean" || a === null || b === null || typeof a === "object")
          fail(`Cannot compare ${typeName(a)} with ${typeName(b)} using "${op}"`);
        if (typeof a === "string") { const c = cmpText(a, b); return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0; }
        return op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
    }
    if (op === "+" && (typeof a === "string" || typeof b === "string")) return fmt(a) + fmt(b);
    if (typeof a !== "number" || typeof b !== "number") fail(`The "${op}" operator only works with numbers`);
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": if (b === 0) fail("Division by zero"); return a / b;
      case "%": if (b === 0) fail("Remainder of division by zero"); return a % b;
      case "**": return a ** b;
    }
  }
  const toU32 = (d) => (Number.isFinite(d) ? (((Math.trunc(d) % 4294967296) + 4294967296) % 4294967296) : 0);

  // ---------------------------------------------------------------------
  // Memory: alloc, free, peek, poke, readstr, readwstr
  // ---------------------------------------------------------------------
  // In the .exe the memory is real. In the browser it is simulated by byte blocks
  // with made-up addresses; an address outside the blocks becomes an error instead
  // of crashing the program as it would on Windows.
  function makeHeap() {
    const blocks = [];
    let next = 0x10000000;
    const find = (addr, len, who, fail) => {
      if (addr === 0) fail(`Null pointer in ${who}`);
      for (const b of blocks) if (addr >= b.addr && addr + len <= b.addr + b.size) return b;
      fail(`Invalid address in ${who}: ${addr} does not belong to any alloc block`);
    };
    return {
      alloc(n) {
        const b = { addr: next, size: n, bytes: new Uint8Array(n) };
        b.dv = new DataView(b.bytes.buffer);
        blocks.push(b);
        next += ((n + 15) & ~15) + 16;
        return b.addr;
      },
      free(addr, fail) {
        const i = blocks.findIndex((b) => b.addr === addr);
        if (i < 0) fail("free got a pointer that did not come from alloc");
        blocks.splice(i, 1);
      },
      peek(addr, size, fail, who) {
        const b = find(addr, size, who, fail), o = addr - b.addr;
        if (size === 1) return b.dv.getUint8(o);
        if (size === 2) return b.dv.getUint16(o, true);
        if (size === 4) return b.dv.getUint32(o, true);
        return b.dv.getUint32(o, true) + b.dv.getUint32(o + 4, true) * 4294967296;
      },
      poke(addr, size, v, fail, who) {
        const b = find(addr, size, who, fail), o = addr - b.addr, u = toU32(v);
        if (size === 1) b.dv.setUint8(o, u & 0xFF);
        else if (size === 2) b.dv.setUint16(o, u & 0xFFFF, true);
        else b.dv.setUint32(o, u, true);
      },
      readstr(addr, fail, who) {
        const b = find(addr, 1, who, fail);
        let end = addr - b.addr;
        while (end < b.size && b.bytes[end] !== 0) end++;
        return new TextDecoder().decode(b.bytes.subarray(addr - b.addr, end));
      },
      readwstr(addr, fail, who) {
        const b = find(addr, 2, who, fail);
        let o = addr - b.addr, s = "";
        while (o + 1 < b.size) { const c = b.dv.getUint16(o, true); if (!c) break; s += String.fromCharCode(c); o += 2; }
        return s;
      },
      writewstr(addr, text, fail, who) {
        const b = find(addr, text.length * 2 + 2, who, fail), o = addr - b.addr;
        for (let i = 0; i < text.length; i++) b.dv.setUint16(o + i * 2, text.charCodeAt(i), true);
        b.dv.setUint16(o + text.length * 2, 0, true);
      },
    };
  }
  function memBuiltin(name, args, mem, fail) {
    const p = args[0];
    const ptr = () => {
      if (typeof p !== "number") fail(`${name} expects a pointer`);
      if (p === 0) fail(`Null pointer in ${name}`);
    };
    switch (name) {
      case "alloc":
        if (typeof p !== "number") fail("alloc expects a number of bytes");
        if (!(p >= 1 && p <= 268435456)) fail("alloc accepts 1 byte to 256 MB");
        return mem.alloc(Math.floor(p));
      case "free":
        if (p === 0 || p === null) return null;
        if (typeof p !== "number") fail("free expects a pointer");
        mem.free(p, fail);
        return null;
      case "peek8": case "peek16": case "peek32": case "peek64":
        ptr();
        return mem.peek(p, +name.slice(4) / 8, fail, name);
      case "poke8": case "poke16": case "poke32": {
        ptr();
        let v = args[1];
        if (typeof v === "boolean") v = v ? 1 : 0;
        if (typeof v !== "number") fail(`${name} expects a number to write`);
        mem.poke(p, +name.slice(4) / 8, v, fail, name);
        return null;
      }
      case "readstr": ptr(); return mem.readstr(p, fail, name);
      case "readwstr": ptr(); return mem.readwstr(p, fail, name);
    }
  }

  // ---------------------------------------------------------------------
  // External functions (Windows DLLs)
  // ---------------------------------------------------------------------
  // Types accepted in an extern declaration, with each one's number in the bytecode.
  const FFI_TYPES = ["void", "i32", "u32", "i64", "u64", "f32", "f64", "bool", "ptr", "str", "wstr"];
  const FFI_WORDS = { i32: 1, u32: 1, i64: 2, u64: 2, f32: 1, f64: 2, bool: 1, ptr: 1, str: 1, wstr: 1 };
  const MAX_FFI_WORDS = 16;
  const isTextType = (t) => t === "str" || t === "wstr";
  // same validation in the browser and in the .exe, with the same messages
  function ffiCheckArgs(ext, args, fail) {
    ext.params.forEach((prm, i) => {
      const v = args[i];
      if (isTextType(prm.type)) {
        if (!(typeof v === "string" || typeof v === "number" || v === null)) fail(`Parameter "${prm.name}" of ${ext.symbol} expects a string or a pointer`);
      } else if (prm.type !== "bool" && typeof v === "string") fail(`Parameter "${prm.name}" of ${ext.symbol} expects a number`);
    });
  }
  const numArg = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? v : 0);
  function coerceRet(type, r) {
    switch (type) {
      case "void": return null;
      case "bool": return truthy(r);
      case "str": case "wstr": return typeof r === "string" ? r : null;
      case "i32": return numArg(r) | 0;
      case "u32": case "ptr": return toU32(numArg(r));
      case "f32": return Math.fround(numArg(r));
      default: return numArg(r);
    }
  }
  const textArg = (v, mem, wide, fail, who) => (typeof v === "string" ? v : typeof v === "number" && v !== 0 ? (wide ? mem.readwstr(v, fail, who) : mem.readstr(v, fail, who)) : "");
  // Windows functions the page knows how to imitate. The others only run in the .exe.
  const FFI_SIM = {
    "user32.dll!MessageBoxW": (a, io, mem, fail) => (io.messageBox ? io.messageBox(textArg(a[2], mem, true, fail, "MessageBoxW"), textArg(a[1], mem, true, fail, "MessageBoxW"), toU32(numArg(a[3]))) : 1),
    "user32.dll!MessageBoxA": (a, io, mem, fail) => (io.messageBox ? io.messageBox(textArg(a[2], mem, false, fail, "MessageBoxA"), textArg(a[1], mem, false, fail, "MessageBoxA"), toU32(numArg(a[3]))) : 1),
    "kernel32.dll!Beep": async (a, io) => { if (io.beep && !io.skipSleep) await io.beep(toU32(numArg(a[0])), toU32(numArg(a[1]))); return 1; },
    "kernel32.dll!Sleep": async (a, io) => { if (!io.skipSleep) await waitMs(io, toU32(numArg(a[0]))); return 0; },
    "kernel32.dll!GetTickCount": () => toU32(Math.floor(performance.now())),
    "kernel32.dll!GetTickCount64": () => Math.floor(performance.now()),
    "kernel32.dll!GetCurrentProcessId": () => 4242,
    "kernel32.dll!GetLocalTime": (a, io, mem, fail) => {
      const d = new Date();
      [d.getFullYear(), d.getMonth() + 1, d.getDay(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]
        .forEach((v, i) => mem.poke(numArg(a[0]) + 2 * i, 2, v, fail, "GetLocalTime"));
      return 0;
    },
    "kernel32.dll!GetComputerNameW": (a, io, mem, fail) => {
      const name = "BROWSER", buf = numArg(a[0]), sizePtr = numArg(a[1]);
      const room = mem.peek(sizePtr, 4, fail, "GetComputerNameW");
      if (room < name.length + 1) { mem.poke(sizePtr, 4, name.length + 1, fail, "GetComputerNameW"); return 0; }
      mem.writewstr(buf, name, fail, "GetComputerNameW");
      mem.poke(sizePtr, 4, name.length, fail, "GetComputerNameW");
      return 1;
    },
    "user32.dll!GetSystemMetrics": (a) => {
      const i = numArg(a[0]), s = typeof screen !== "undefined" ? screen : null;
      return i === 0 ? (s ? s.width : 1920) : i === 1 ? (s ? s.height : 1080) : 0;
    },
  };
  const dllKey = (dll) => { const d = dll.toLowerCase(); return d.endsWith(".dll") ? d : d + ".dll"; };
  async function ffiBrowser(ext, args, io, mem, fail) {
    ffiCheckArgs(ext, args, fail);
    const sim = FFI_SIM[`${dllKey(ext.dll)}!${ext.symbol}`];
    let r = 0;
    if (sim) {
      r = await sim(args, io, mem, fail);
      if (io.token && io.token.stopped) throw new Stopped();   // Stop pressed during a message box or a beep
    }
    else if (io.note) {
      io.noted = io.noted || new Set();
      if (!io.noted.has(ext.symbol)) {
        io.noted.add(ext.symbol);
        const zero = ext.ret === "void" ? "" : ` and returns ${ext.ret === "bool" ? "false" : isTextType(ext.ret) ? "nothing" : "0"}`;
        io.note(`${ext.dll} → ${ext.symbol} has no simulation in the browser: here the call is ignored${zero}. In the .exe it is real.`);
      }
    }
    return coerceRet(ext.ret, r);
  }

  // Local names of a function: parameters and everything the body declares with let, const or for
  // walks the top level of the program, including inside modules
  function forTop(body, visit) { for (const st of body) { if (st.kind === "Module") forTop(st.body, visit); else visit(st); } }

