  // =====================================================================
  // 4. Stack virtual machine, with goroutines
  // =====================================================================
  // Each goroutine has its own operand stack, local variables and call frames;
  // globals are shared. The scheduler switches goroutines when one blocks (channel, sleep)
  // or every GO_SLICE instructions. Everything is deterministic: the native runtime (in Rust) does exactly the same.
  const MAX_INSTR = 200_000_000;
  const UNSET = Symbol("unset");
  const {
    HALT, CONST, LOAD, STORE, SET, POP, ADD, SUB, MUL, DIV, MOD, POW, NEG, EQ, NE, LT, GT, LE, GE,
    NOT, TO_BOOL, JMP, JMP_IF_FALSE, JMP_IF_TRUE, CALL, FOR_INIT, FOR_TEST, FOR_STEP,
  } = OP;
  const GO_SLICE = 2000;
  // markers in a frame's return address
  const RET_DLL = -1, RET_DEFER = -2, RET_PANIC = -3, RET_GOEND = -9;

  async function runVM(prog, io) {
    const { code, lines, consts, slotNames } = prog;
    const functions = prog.functions || [], externs = prog.externs || [], rtypes = prog.rtypes || [];
    const G = new Array(slotNames.length).fill(UNSET);
    const mem = makeHeap();
    let ip = 0, count = 0;
    const fail = (msg) => { throw new CajuError("runtime", msg, lines[ip], null); };
    const fatal = (msg) => { const e = new CajuError("runtime", msg, lines[ip], null); e.fatal = true; throw e; };

    // struct types: names, fields, methods and which fields are values (copied along)
    const stypes = (prog.structs || []).map((S) => ({ ...S }));
    const valueKind = (t) => t >= 0 && (rtypes[t].k === "struct" || rtypes[t].k === "array");
    stypes.forEach((S, i) => { S.deep = S.ftids ? S.ftids.map(valueKind) : null; });
    const TID = (name) => rtypes.findIndex((r) => r.key === name);
    const TID_INT = TID("int"), TID_NUM = TID("num"), TID_STR = TID("str"), TID_BOOL = TID("bool");
    const errorKey = consts.indexOf("Error");

    // zero value of a type from the table
    function zeroOf(t) {
      if (t < 0) return null;
      const r = rtypes[t];
      switch (r.k) {
        case "num": return 0;
        case "str": return "";
        case "bool": return false;
        case "struct": { const S = stypes[r.sidx]; return new CajuStruct(S, S.ftids.map(zeroOf)); }
        case "array": { const a = new CajuArr(t, Array.from({ length: r.n }, () => zeroOf(r.elem))); a.deep = valueKind(r.elem); return a; }
        default: return null;
      }
    }
    // dynamic type of a value stored in an interface
    function dynTid(v) {
      if (v === null || v === undefined) return -1;
      switch (typeof v) {
        case "number": return Number.isInteger(v) ? TID_INT : TID_NUM;
        case "string": return TID_STR;
        case "boolean": return TID_BOOL;
      }
      if (v instanceof CajuStruct) return v.t.tid;
      if (v instanceof CajuErr) return -2;
      return v.t;
    }
    const dynName = (v) => { const t = dynTid(v); return t === -1 ? "nil" : t === -2 ? "*errors.errorString" : rtypes[t].name; };
    // methods a value offers (for interfaces): struct by value, pointer to struct (box) or error
    function hasMethods(v, keys) {
      if (v instanceof CajuErr) return keys.every((k) => k === errorKey);
      let S = null, all = false;
      if (v instanceof CajuStruct) S = v.t;
      else if (v instanceof CajuBox && v.v instanceof CajuStruct) { S = v.v.t; all = true; }
      if (!S) return keys.length === 0;
      return keys.every((k) => S.methods.some((m) => m.key === k && (all || m.vset)));
    }
    function typeIs(v, t) {
      const r = rtypes[t];
      if (r.k === "any") return v !== null && v !== undefined;
      if (r.k === "iface") return v !== null && v !== undefined && hasMethods(v, r.methods);
      return dynTid(v) === t;
    }
    const unbox = (v) => (v instanceof CajuBox ? v.v : v);

    const printArgs = (args) => {
      io.print(args.map((a) => fmt(a)).join(" "));
    };
    // generic binary operation of the superinstructions; the fast path is number with number
    const calc = (b, x, y) => {
      if (typeof x === "number" && typeof y === "number") {
        switch (b) {
          case 0: return x + y;
          case 1: return x - y;
          case 2: return x * y;
          case 3: if (y === 0) fail("Division by zero"); return x / y;
          case 4: if (y === 0) fail("Remainder of division by zero"); return x % y;
          case 5: return x ** y;
          case 6: return x === y;
          case 7: return x !== y;
          case 8: return x < y;
          case 9: return x > y;
          case 10: return x <= y;
          default: return x >= y;
        }
      }
      return binop(BIN_SYMBOLS[b], x, y, fail);
    };
    const ordered = (a, b, op) => {
      if (typeof a === "number" && typeof b === "number") return;
      if (typeof a !== typeof b || typeof a === "boolean" || a === null || b === null || typeof a === "object")
        fail(`Cannot compare ${typeName(a)} with ${typeName(b)} using "${op}"`);
    };
    const fieldAt = (o, k) => {
      if (o === null || o === undefined) fail(`Access to field "${consts[k]}" through a nil pointer`);
      if (o instanceof CajuBox) o = o.v;
      if (!(o instanceof CajuStruct)) fail(`Only structs have fields, and this value is ${typeName(o)}`);
      const i = o.t.keys.indexOf(k);
      if (i < 0) fail(`struct ${o.t.name} has no field "${consts[k]}"`);
      return i;
    };
    const objOf = (o) => (o instanceof CajuBox ? o.v : o);
    const checkIndex = (i, n, what) => {
      if (i instanceof CajuBox) i = i.v;
      if (typeof i !== "number" || !Number.isInteger(i)) fail(`The index must be an integer, not ${typeName(i)}`);
      if (i < 0 || i >= n) fail(`Index ${fmtNum(i)} out of range (length ${n})`);
      return i;
    };
    const lenOf = (v) => {
      v = unbox(v);
      if (v === null || v === undefined) return 0;
      if (typeof v === "string") return bytesOf(v).length;
      if (v instanceof CajuSlice) return v.len;
      if (v instanceof CajuArr) return v.a.length;
      if (v instanceof CajuMap) return v.m.size;
      if (v instanceof CajuChan) return v.buf.length;
      fail(`len does not work with ${typeName(v)}`);
    };
    const mapKey = (k) => (k instanceof CajuBox ? k.v : k);
    const growCap = (old, need) => {
      let c = old;
      if (need > 2 * old) return need;
      if (old < 256) return Math.max(2 * old, need);
      while (c < need) c += Math.floor((c + 768) / 4);
      return c;
    };
    function appendTo(s, t, vals) {
      if (s === null || s === undefined) s = new CajuSlice(t, [], 0, 0, 0);
      if (!(s instanceof CajuSlice)) fail(`append needs a slice, not ${typeName(s)}`);
      const n = s.len + vals.length;
      if (n <= s.cap) {
        for (let i = 0; i < vals.length; i++) s.a[s.off + s.len + i] = vals[i];
        return new CajuSlice(s.t, s.a, s.off, n, s.cap);
      }
      const cap = growCap(s.cap, n);
      const a = new Array(cap);
      for (let i = 0; i < s.len; i++) a[i] = s.a[s.off + i];
      for (let i = 0; i < vals.length; i++) a[s.len + i] = vals[i];
      const z = rtypes[s.t] ? zeroOf(rtypes[s.t].elem) : null;
      for (let i = n; i < cap; i++) a[i] = z && typeof z === "object" ? zeroOf(rtypes[s.t].elem) : z;
      return new CajuSlice(s.t, a, 0, n, cap);
    }
    const sliceVals = (v) => {
      v = unbox(v);
      if (v === null || v === undefined) return [];
      if (typeof v === "string") return Array.from(bytesOf(v));
      if (v instanceof CajuSlice) return v.a.slice(v.off, v.off + v.len);
      fail(`Expected a slice, not ${typeName(v)}`);
    };

    // ---- goroutines ----
    let gid = 0;
    const newG = () => ({ id: gid++, pc: 0, sp: 0, stack: [], L: [], fp: 0, vtop: 0, fidx: -1, cl: null, frames: [], fr: null, panic: null, wake: 0, wakeErr: null, ip: 0 });
    const mainG = newG();
    mainG.fr = { ret: RET_GOEND, fp: 0, vtop: 0, fidx: -1, cl: null, sp: 0, defers: null, top: true };
    const runq = [], sleepers = [];
    let clock = 0, sleepSeq = 0;
    // state of the current goroutine, in local variables so the loop is fast
    let g = mainG, pc = 0, sp = 0, stack = g.stack, L = g.L, fp = 0, vtop = 0, fidx = -1, cl = null, fr = g.fr, frames = g.frames;
    let slice = GO_SLICE;
    const save = () => { g.pc = pc; g.sp = sp; g.fp = fp; g.vtop = vtop; g.fidx = fidx; g.cl = cl; g.fr = fr; g.ip = ip; };
    const load = (x) => { g = x; pc = x.pc; sp = x.sp; stack = x.stack; L = x.L; fp = x.fp; vtop = x.vtop; fidx = x.fidx; cl = x.cl; fr = x.fr; frames = x.frames; slice = GO_SLICE; };
    const get = (s) => {
      const v = s >= 0 ? G[s] : L[fp - s - 1];
      if (v === UNSET) fail(`The variable "${nameOf(s)}" was used before being assigned a value`);
      return v;
    };
    const nameOf = (s) => (s >= 0 ? slotNames[s] : functions[fidx]?.localNames[-s - 1] ?? "?");
    const setv = (s, v) => { if (s >= 0) G[s] = v; else L[fp - s - 1] = v; };
    const rawGet = (s) => (s >= 0 ? G[s] : L[fp - s - 1]);
    // wakes a blocked goroutine, with values to push on its stack
    const wakeWith = (w, ...vals) => { for (const v of vals) w.stack[w.sp++] = v; runq.push(w); };
    // picks the next goroutine: ready ones in order; if only sleeping ones remain, the clock advances
    async function schedule() {
      for (;;) {
        if (runq.length) {
          load(runq.shift());
          if (g.wakeErr) { const m = g.wakeErr; g.wakeErr = null; ip = g.ip; fail(m); }
          return;
        }
        if (sleepers.length) {
          let best = 0;
          for (let i = 1; i < sleepers.length; i++) if (sleepers[i].wake < sleepers[best].wake || (sleepers[i].wake === sleepers[best].wake && sleepers[i].seq < sleepers[best].seq)) best = i;
          const w = sleepers[best].wake;
          if (w > clock && !io.skipSleep) {
            io.sleeping(lines[sleepers[best].ip], (w - clock) / 1000, sleepers[best].ip);
            await waitMs(io, w - clock);
            io.awake();
          }
          clock = w;
          const ready = sleepers.filter((s) => s.wake <= clock).sort((a, b) => a.wake - b.wake || a.seq - b.seq);
          for (const s of ready) { sleepers.splice(sleepers.indexOf(s), 1); runq.push(s); }
          continue;
        }
        ip = mainG.ip;
        fatal("All goroutines are blocked, waiting for each other (deadlock)");
      }
    }
    // the current goroutine stops: blocked on a channel, sleeping or finished
    const park = () => { save(); };

    // ---- channels ----
    const live = (q) => { while (q.length && q[0].sel && q[0].sel.done) q.shift(); return q.length > 0; };
    const chanOf = (c, what) => { c = unbox(c); if (c !== null && c !== undefined && !(c instanceof CajuChan)) fail(`${what} needs a channel, not ${typeName(c)}`); return c ?? null; };
    // tries to send without blocking; returns true on success
    function trySend(ch, v) {
      if (ch.closed) fail("Send on a closed channel");
      if (live(ch.recvq)) {
        const r = ch.recvq.shift();
        if (r.sel) { r.sel.done = true; wakeWith(r.g, v, true, r.idx); }
        else if (r.it) { r.it.pending = [v, true]; runq.push(r.g); }
        else if (r.ok) wakeWith(r.g, v, true); else wakeWith(r.g, v);
        return true;
      }
      if (ch.buf.length < ch.cap) { ch.buf.push(v); return true; }
      return false;
    }
    // tries to receive without blocking; returns [value, ok] or null
    function tryRecv(ch) {
      if (ch.buf.length) {
        const v = ch.buf.shift();
        if (live(ch.sendq)) { const s = ch.sendq.shift(); ch.buf.push(s.v); if (s.sel) { s.sel.done = true; wakeWith(s.g, null, false, s.idx); } else runq.push(s.g); }
        return [v, true];
      }
      if (live(ch.sendq)) {
        const s = ch.sendq.shift();
        if (s.sel) { s.sel.done = true; wakeWith(s.g, null, false, s.idx); } else runq.push(s.g);
        return [s.v, true];
      }
      if (ch.closed) return [zeroOf(rtypes[ch.t].elem), false];
      return null;
    }

    // ---- call frames, defer and panic ----
    function enterFunc(fi, n, cells, ret, opts) {
      const f = functions[fi];
      if (frames.length >= MAX_DEPTH) fail(`Too much recursion: more than ${MAX_DEPTH.toLocaleString("en-US")} nested function calls`);
      const base = vtop, nl = f.nlocals;
      sp -= n;
      for (let k = 0; k < nl; k++) L[base + k] = k < n ? stack[sp + k] : UNSET;
      frames.push(fr);
      fr = { ret, fp, vtop, fidx, cl, sp, defers: null, discard: !!(opts && opts.discard), deferred: !!(opts && opts.deferred) };
      fp = base; vtop = base + nl; fidx = fi; cl = cells;
      pc = f.entry;
    }
    // pushes the bound arguments of a CajuFunc value followed by the call's arguments
    function pushCall(f, args) {
      for (const b of f.bound || []) stack[sp++] = b;
      for (const a of args) stack[sp++] = a;
      return (f.bound ? f.bound.length : 0) + args.length;
    }
    function callDeferred(d, ret) {
      const n = pushCall(d.f, d.args);
      enterFunc(d.f.fidx, n, d.f.cells, ret, { discard: true, deferred: ret === RET_PANIC });
    }
    // returns to the caller, with the returned values
    function doReturn(vals) {
      const r = fr;
      if (r.top) {
        // end of the main program or of a goroutine
        return vals;
      }
      fp = r.fp; vtop = r.vtop; fidx = r.fidx; cl = r.cl; pc = r.ret; sp = r.sp;
      fr = frames.pop();
      if (r.ret === RET_DLL) { io.call.result = vals[0]; return "dll"; }
      if (r.ret === RET_GOEND) return "goend";
      if (!r.discard) for (const v of vals) stack[sp++] = v;
      if (pc === RET_DEFER) return retFlow();
      if (pc === RET_PANIC) {
        if (g.panic && g.panic.recovered) {
          g.panic = null;
          const f = functions[fidx];
          fr.returning = true;
          fr.pending = f && f.rz && f.rz.length ? f.rz.map((t) => zeroOf(t)) : [null];
          if (f && f.named) fr.namedRet = { base: f.params.length, n: f.named };
          return retFlow();
        }
        return unwind();
      }
      return null;
    }
    // frame in "returning" mode: runs the remaining defers (last to first) and then returns
    function retFlow() {
      if (fr.defers && fr.defers.length) { callDeferred(fr.defers.pop(), RET_DEFER); return null; }
      let vals = fr.pending;
      if (fr.namedRet) { vals = []; for (let i = 0; i < fr.namedRet.n; i++) { const v = L[fp + fr.namedRet.base + i]; vals.push(v instanceof Cell ? v.v : v); } }
      return doReturn(vals);
    }
    // panic: climbs up the frames running the defers; a recover() in a defer makes the function return normally
    function unwind() {
      for (;;) {
        if (fr.defers && fr.defers.length) { callDeferred(fr.defers.pop(), RET_PANIC); return null; }
        if (fr.top || fr.ret === RET_DLL) {
          const e = g.panic.err;
          e.fatal = true;
          throw e;
        }
        const r = fr;
        fp = r.fp; vtop = r.vtop; fidx = r.fidx; cl = r.cl; sp = r.sp; pc = r.ret;
        fr = frames.pop();
        if (r.ret === RET_DEFER || r.ret === RET_PANIC) {
          // the panic happened inside a defer: the frame below keeps unwinding
          fr.returning = false;
          continue;
        }
      }
    }
    function startPanic(err, value) {
      if (err.fatal || err instanceof Stopped) throw err;
      g.panic = { err, value, recovered: false };
      return unwind();
    }
    // result of doReturn/retFlow: end of program, end of goroutine, return from a DLL call
    async function afterReturn(r) {
      if (r === null) return false;
      if (r === "dll") return true;
      if (r === "goend" || (Array.isArray(r) && g !== mainG)) { await schedule(); return false; }
      return true;     // end of the main program
    }

    let finished = false;
    for (;;) {
      const pause = count + 200_000;   // every so often, yield control back to the browser
      try {
      while (count < pause) {
        count++;
        ip = pc;
        if (--slice === 0) {
          slice = GO_SLICE;
          if (runq.length) { save(); runq.push(g); load(runq.shift()); continue; }
        }
        switch (code[pc]) {
          case 0 /* HALT */: {
            if (io.call && !io.call.started) {
              // as the DLL does: after initialization, call the exported function
              const f = functions[io.call.fidx];
              io.call.started = true;
              if (!f || f.entry < 0) fail("The exported function is not in the bytecode");
              for (const v of io.call.args) stack[sp++] = v;
              enterFunc(io.call.fidx, io.call.args.length, null, RET_DLL);
              break;
            }
            fr.returning = true; fr.pending = [];
            const r = retFlow();
            if (r !== null) { finished = true; return count; }
            break;
          }
          case 1 /* CONST */: stack[sp++] = consts[code[pc + 1]]; pc += 2; break;
          case 2 /* LOAD */: { const s = code[pc + 1]; const v = s >= 0 ? G[s] : L[fp - s - 1]; if (v === UNSET) fail(`The variable "${nameOf(s)}" was used before being assigned a value`); stack[sp++] = v; pc += 2; break; }
          case 3 /* STORE */: { const s = code[pc + 1]; if (s >= 0) G[s] = stack[--sp]; else L[fp - s - 1] = stack[--sp]; pc += 2; break; }
          case 4 /* SET */: {
            const s = code[pc + 1];
            if (rawGet(s) === UNSET) fail(`The variable "${nameOf(s)}" does not exist yet. Use let the first time`);
            setv(s, stack[--sp]); pc += 2; break;
          }
          case 5 /* POP */: sp--; pc++; break;
          case 6 /* ADD */: {
            const b = stack[--sp], a = stack[sp - 1];
            if (typeof a === "number" && typeof b === "number") stack[sp - 1] = a + b;
            else stack[sp - 1] = binop("+", a, b, fail);
            pc++; break;
          }
          case 7 /* SUB */: case 8 /* MUL */: case 9 /* DIV */: case 10 /* MOD */: case 11 /* POW */: {
            const b = stack[--sp], a = stack[sp - 1];
            stack[sp - 1] = calc(code[pc] - 6, a, b); pc++; break;
          }
          case 12 /* NEG */: {
            let v = stack[sp - 1];
            if (v instanceof CajuBox) v = v.v;
            if (typeof v !== "number") fail("Only numbers can be negated");
            stack[sp - 1] = -v; pc++; break;
          }
          case 13 /* EQ */: { const b = stack[--sp]; stack[sp - 1] = valEq(stack[sp - 1], b); pc++; break; }
          case 14 /* NE */: { const b = stack[--sp]; stack[sp - 1] = !valEq(stack[sp - 1], b); pc++; break; }
          case 15 /* LT */: case 16 /* GT */: case 17 /* LE */: case 18 /* GE */: {
            const b = stack[--sp], a = stack[sp - 1];
            stack[sp - 1] = calc(code[pc] - 7, a, b); pc++; break;
          }
          case 19 /* NOT */: stack[sp - 1] = !truthy(stack[sp - 1]); pc++; break;
          case 20 /* TO_BOOL */: stack[sp - 1] = truthy(stack[sp - 1]); pc++; break;
          case 21 /* JMP */: pc = code[pc + 1]; break;
          case 22 /* JMP_IF_FALSE */: { const v = stack[--sp]; pc = (v === true || truthy(v)) ? pc + 2 : code[pc + 1]; break; }
          case 23 /* JMP_IF_TRUE */: { const v = stack[--sp]; pc = (v === true || truthy(v)) ? code[pc + 1] : pc + 2; break; }
          case 24 /* CALL */: case 37 /* CALL_VOID */: {
            const op = code[pc], fn = code[pc + 1], n = code[pc + 2];
            sp -= n;
            const args = stack.slice(sp, sp + n);
            pc += 3;
            if (fn === 0) { printArgs(args); if (op === 24) stack[sp++] = null; break; }
            if (fn === 1) {
              // sleep: this goroutine sleeps and the others continue
              const s = unbox(args[0]);
              if (typeof s !== "number") fail("sleep expects a number of seconds, like sleep(1)");
              if (s < 0 || s > 30) fail("sleep accepts 0 to 30 seconds");
              if (op === 24) stack[sp++] = null;
              park();
              g.wake = clock + s * 1000; g.seq = sleepSeq++;
              sleepers.push(g);
              await schedule();
              break;
            }
            const r = memBuiltin(BUILTINS[fn], args.map(unbox), mem, fail);
            if (op === 24) stack[sp++] = r;
            break;
          }
          case 25 /* FOR_INIT */: {
            const b = code[pc + 1];
            const to = unbox(stack[--sp]), from = unbox(stack[--sp]);
            if (typeof from !== "number" || typeof to !== "number") fail("The for loop needs numbers at the start and at the end");
            setv(b, from); setv(b < 0 ? b - 1 : b + 1, to); setv(b < 0 ? b - 2 : b + 2, from <= to ? 1 : -1);
            pc += 2; break;
          }
          case 26 /* FOR_TEST */: {
            const b = code[pc + 1];
            const c = rawGet(b), e = rawGet(b < 0 ? b - 1 : b + 1), st = rawGet(b < 0 ? b - 2 : b + 2);
            if (st > 0 ? c <= e : c >= e) { setv(code[pc + 2], c); pc += 4; }
            else pc = code[pc + 3];
            break;
          }
          case 27 /* FOR_STEP */: { const b = code[pc + 1]; setv(b, rawGet(b) + rawGet(b < 0 ? b - 2 : b + 2)); pc += 2; break; }
          // ---- superinstructions ----
          case 28 /* BINK */: stack[sp - 1] = calc(code[pc + 1], stack[sp - 1], consts[code[pc + 2]]); pc += 3; break;
          case 29 /* LOAD_BINK */: stack[sp++] = calc(code[pc + 2], get(code[pc + 1]), consts[code[pc + 3]]); pc += 4; break;
          case 30 /* LOAD2_BIN */: stack[sp++] = calc(code[pc + 3], get(code[pc + 1]), get(code[pc + 2])); pc += 4; break;
          case 31 /* UPDATE_K */: { const s = code[pc + 1]; setv(s, calc(code[pc + 2], get(s), consts[code[pc + 3]])); pc += 4; break; }
          case 32 /* UPDATE_S */: { const s = code[pc + 1]; setv(s, calc(code[pc + 2], get(s), get(code[pc + 3]))); pc += 4; break; }
          case 33 /* JMP_UNLESS */: { const y = stack[--sp], x = stack[--sp]; pc = truthy(calc(code[pc + 1], x, y)) ? pc + 3 : code[pc + 2]; break; }
          case 34 /* JMP_WHEN */: { const y = stack[--sp], x = stack[--sp]; pc = truthy(calc(code[pc + 1], x, y)) ? code[pc + 2] : pc + 3; break; }
          case 35 /* JMP_UNLESS_K */: { const x = stack[--sp]; pc = truthy(calc(code[pc + 1], x, consts[code[pc + 2]])) ? pc + 4 : code[pc + 3]; break; }
          case 36 /* JMP_WHEN_K */: { const x = stack[--sp]; pc = truthy(calc(code[pc + 1], x, consts[code[pc + 2]])) ? code[pc + 3] : pc + 4; break; }
          case 38 /* FOR_NEXT */: {
            const b = code[pc + 1], b2 = b < 0 ? b - 2 : b + 2;
            const c = rawGet(b) + rawGet(b2);
            setv(b, c);
            const e = rawGet(b < 0 ? b - 1 : b + 1);
            if (rawGet(b2) > 0 ? c <= e : c >= e) { setv(code[pc + 2], c); pc = code[pc + 3]; }
            else pc += 4;
            break;
          }
          // ---- functions ----
          case 39 /* CALLF */: {
            const ret = pc + 5;
            enterFunc(code[pc + 4], code[pc + 2], null, ret);
            break;
          }
          case 40 /* RET */: case 41 /* RET_NULL */: case 60 /* RETN */: {
            const op = code[pc];
            if (!fr.returning) {
              fr.returning = true;
              if (op === 40) fr.pending = [stack[--sp]];
              else if (op === 41) fr.pending = [null];
              else { const n = code[pc + 1]; sp -= n; fr.pending = stack.slice(sp, sp + n); }
            }
            const r = retFlow();
            if (r !== null && await afterReturn(r)) { finished = true; return count; }
            break;
          }
          case 61 /* RET_NAMED */: {
            if (!fr.returning) { fr.returning = true; fr.namedRet = { base: code[pc + 1], n: code[pc + 2] }; }
            const r = retFlow();
            if (r !== null && await afterReturn(r)) { finished = true; return count; }
            break;
          }
          case 42 /* CALL_EXT */: {
            const ext = externs[code[pc + 1]], n = code[pc + 2];
            sp -= n;
            const args = stack.slice(sp, sp + n).map(unbox);
            pc += 3;
            stack[sp++] = await ffiBrowser(ext, args, io, mem, fail);
            break;
          }
          // ---- structs ----
          case 43 /* NEW_STRUCT */: {
            const T = stypes[code[pc + 1]], n = T.keys.length;
            sp -= n;
            stack[sp] = new CajuStruct(T, stack.slice(sp, sp + n));
            sp++; pc += 2; break;
          }
          case 44 /* GET_FIELD */: { const o = objOf(stack[sp - 1]), i = fieldAt(o, code[pc + 1]); stack[sp - 1] = o.f[i]; pc += 2; break; }
          case 45 /* SET_FIELD */: { const v = stack[--sp], o = objOf(stack[--sp]), i = fieldAt(o, code[pc + 1]); o.f[i] = v; pc += 2; break; }
          case 46 /* CALL_METHOD */: {
            const k = code[pc + 1], n = code[pc + 2];
            let recv = stack[sp - n - 1];
            if (recv === null || recv === undefined) fail(`Call of method "${consts[k]}" on a nil value`);
            if (recv instanceof CajuErr && k === errorKey && n === 0) { stack[sp - 1] = recv.msg; pc += 3; break; }
            recv = objOf(recv);
            if (!(recv instanceof CajuStruct)) fail(`Only structs have methods, and this value is ${typeName(recv)}`);
            const m = recv.t.methods.find((mm) => mm.key === k);
            if (!m) fail(`struct ${recv.t.name} has no method "${consts[k]}"`);
            const f = functions[m.fidx];
            if (f.params.length !== n + 1) fail(`The method ${consts[k]} expects ${plural(f.params.length - 1, "argument")}, but got ${n}`);
            for (const p of m.path) recv = recv.f[fieldAt(recv, p)];
            stack[sp - n - 1] = m.ptr ? recv : copyVal(recv);   // value receiver: the method gets a copy
            enterFunc(m.fidx, n + 1, null, pc + 3);
            break;
          }
          case 47 /* COPY */: stack[sp - 1] = copyVal(stack[sp - 1]); pc++; break;
          // ---- integers ----
          case 48 /* IOP */: {
            const a = code[pc + 1], op = a >> 4, k = a & 15;
            if (op === 11) stack[sp - 1] = intOp(11, k, stack[sp - 1], 0, fail);
            else { const y = stack[--sp]; stack[sp - 1] = intOp(op, k, stack[sp - 1], y, fail); }
            pc += 2; break;
          }
          case 49 /* CONV */: stack[sp - 1] = convNum(stack[sp - 1], code[pc + 1], fail); pc += 2; break;
          // ---- closures and cells ----
          case 50 /* MAKE_CLOSURE */: {
            const fi = code[pc + 1], n = code[pc + 2];
            sp -= n;
            const cells = n ? stack.slice(sp, sp + n) : null;
            stack[sp++] = new CajuFunc(functions[fi].tid, fi, cells, null);
            pc += 3; break;
          }
          case 51 /* CALL_VALUE */: {
            const n = code[pc + 1], want = code[pc + 2];
            const f = unbox(stack[sp - n - 1]);
            if (f === null || f === undefined) fail("Call of a nil function");
            if (!(f instanceof CajuFunc)) fail(`Only functions can be called, and this value is ${typeName(f)}`);
            const fd = functions[f.fidx];
            const total = (f.bound ? f.bound.length : 0) + n;
            if (fd.params.length !== total) fail(`The function expects ${plural(fd.params.length - (f.bound ? f.bound.length : 0), "argument")}, but got ${n}`);
            if (fd.nres !== want && want > 1) fail(`The function returns ${fd.nres} values, but ${want} were expected`);
            // removes the function from the stack and puts the bound arguments before the call's arguments
            const args = stack.slice(sp - n, sp);
            sp -= n + 1;
            pushCall(f, args);
            enterFunc(f.fidx, total, f.cells, pc + 3);
            break;
          }
          case 52 /* LOAD_CELL */: { const c = get(code[pc + 1]); stack[sp++] = c instanceof Cell ? c.v : c; pc += 2; break; }
          case 53 /* STORE_CELL */: {
            const s = code[pc + 1], c = rawGet(s);
            if (c === UNSET) fail(`The variable "${nameOf(s)}" does not exist yet. Use let the first time`);
            if (c instanceof Cell) c.v = stack[--sp]; else setv(s, new Cell(stack[--sp]));
            pc += 2; break;
          }
          case 54 /* NEW_CELL */: setv(code[pc + 1], new Cell(stack[--sp])); pc += 2; break;
          case 55 /* LOAD_CELLREF */: {
            const s = code[pc + 1];
            let c = rawGet(s);
            if (!(c instanceof Cell)) { c = new Cell(c === UNSET ? null : c); setv(s, c); }
            stack[sp++] = c; pc += 2; break;
          }
          case 56 /* LOAD_UP */: stack[sp++] = cl[code[pc + 1]].v; pc += 2; break;
          case 57 /* STORE_UP */: cl[code[pc + 1]].v = stack[--sp]; pc += 2; break;
          case 58 /* LOAD_UPREF */: stack[sp++] = cl[code[pc + 1]]; pc += 2; break;
          case 59 /* REBOX */: { const s = code[pc + 1], c = rawGet(s); if (c instanceof Cell) setv(s, new Cell(c.v)); pc += 2; break; }
          // ---- defer, go, panic ----
          case 62 /* DEFER */: case 63 /* GO */: {
            const n = code[pc + 1];
            const f = unbox(stack[sp - n - 1]);
            const args = stack.slice(sp - n, sp);
            sp -= n + 1;
            if (!(f instanceof CajuFunc)) fail("defer and go need a function");
            if (code[pc] === 62) { (fr.defers || (fr.defers = [])).push({ f, args }); pc += 2; break; }
            // new goroutine: starts in the function, with the arguments already evaluated
            const ng = newG();
            const fd = functions[f.fidx];
            const all = [...(f.bound || []), ...args];
            for (let k = 0; k < fd.nlocals; k++) ng.L[k] = k < all.length ? all[k] : UNSET;
            ng.fr = { ret: RET_GOEND, fp: 0, vtop: 0, fidx: -1, cl: null, sp: 0, defers: null, top: true };
            ng.fp = 0; ng.vtop = fd.nlocals; ng.fidx = f.fidx; ng.cl = f.cells; ng.pc = fd.entry;
            runq.push(ng);
            pc += 2; break;
          }
          case 64 /* PANIC */: {
            const v = stack[--sp];
            pc++;
            const e = new CajuError("runtime", `panic: ${fmt(v)}`, lines[ip], null);
            if (startPanic(e, v) === null) break;
            break;
          }
          case 65 /* RECOVER */: {
            if (g.panic && !g.panic.recovered && fr.deferred) { g.panic.recovered = true; stack[sp++] = g.panic.value; }
            else stack[sp++] = null;
            pc++; break;
          }
          // ---- slices, arrays and maps ----
          case 66 /* MAKE_SLICE */: {
            const t = code[pc + 1], n = code[pc + 2];
            sp -= n;
            stack[sp] = new CajuSlice(t, stack.slice(sp, sp + n), 0, n, n);
            sp++; pc += 3; break;
          }
          case 67 /* MAKE_ARRAY */: {
            const t = code[pc + 1], n = code[pc + 2];
            sp -= n;
            const a = new CajuArr(t, stack.slice(sp, sp + n));
            a.deep = valueKind(rtypes[t].elem);
            stack[sp++] = a;
            pc += 3; break;
          }
          case 68 /* MAKE_MAP */: {
            const t = code[pc + 1], n = code[pc + 2];
            sp -= 2 * n;
            const m = new CajuMap(t);
            for (let i = 0; i < n; i++) m.m.set(mapKey(stack[sp + 2 * i]), stack[sp + 2 * i + 1]);
            stack[sp++] = m;
            pc += 3; break;
          }
          case 69 /* MAKE */: {
            const t = code[pc + 1], n = code[pc + 2], r = rtypes[t];
            sp -= n;
            const args = stack.slice(sp, sp + n).map(unbox);
            for (const a of args) if (typeof a !== "number" || !Number.isInteger(a) || a < 0) fail(`Invalid size in make: ${fmt(a)}`);
            if (r.k === "slice") {
              const len = args[0], cap = n > 1 ? args[1] : len;
              if (cap < len) fail(`make: capacity (${cap}) is less than length (${len})`);
              if (cap > 100_000_000) fail("make: size too large");
              const a = new Array(cap);
              for (let i = 0; i < cap; i++) a[i] = zeroOf(r.elem);
              stack[sp++] = new CajuSlice(t, a, 0, len, cap);
            } else if (r.k === "map") stack[sp++] = new CajuMap(t);
            else stack[sp++] = new CajuChan(t, n ? args[0] : 0);
            pc += 3; break;
          }
          case 70 /* ZERO */: stack[sp++] = zeroOf(code[pc + 1]); pc += 2; break;
          case 71 /* INDEX */: case 72 /* INDEX_OK */: {
            const i = stack[--sp], o = unbox(stack[sp - 1]), z = code[pc + 1];
            if (o instanceof CajuMap || ((o === null || o === undefined) && (z >= 0 || code[pc] === 72))) {
              const k = mapKey(i);
              const has = !!o && o.m.has(k);
              const v = has ? o.m.get(k) : zeroOf(o ? rtypes[o.t].val : z);
              stack[sp - 1] = v;
              if (code[pc] === 72) stack[sp++] = has;
            } else if (o instanceof CajuSlice) stack[sp - 1] = o.a[o.off + checkIndex(i, o.len, "slice")];
            else if (o instanceof CajuArr) stack[sp - 1] = o.a[checkIndex(i, o.a.length, "array")];
            else if (typeof o === "string") { const b = bytesOf(o); stack[sp - 1] = b[checkIndex(i, b.length, "string")]; }
            else if (o === null || o === undefined) fail(`Index ${fmt(unbox(i))} in a nil slice`);
            else fail(`[ ] can only be used with slices, arrays, maps and strings, and this value is ${typeName(o)}`);
            pc += 2; break;
          }
          case 73 /* SET_INDEX */: {
            const v = stack[--sp], i = stack[--sp], o = unbox(stack[--sp]);
            if (o instanceof CajuMap) o.m.set(mapKey(i), v);
            else if (o instanceof CajuSlice) o.a[o.off + checkIndex(i, o.len, "slice")] = v;
            else if (o instanceof CajuArr) o.a[checkIndex(i, o.a.length, "array")] = v;
            else if (o === null || o === undefined) fail("Assignment to a nil map or slice");
            else fail(`Assignment with [ ] only works on slices, arrays and maps, and this value is ${typeName(o)}`);
            pc++; break;
          }
          case 74 /* SLICE */: {
            const fl = code[pc + 1], st = code[pc + 2];
            const hi = fl & 2 ? unbox(stack[--sp]) : null, lo = fl & 1 ? unbox(stack[--sp]) : 0;
            const o = unbox(stack[sp - 1]);
            const n = typeof o === "string" ? bytesOf(o).length : o instanceof CajuSlice ? o.cap : o instanceof CajuArr ? o.a.length : o === null ? 0 : -1;
            if (n < 0) fail(`Only slices, arrays and strings can be sliced, and this value is ${typeName(o)}`);
            const len = typeof o === "string" ? n : o instanceof CajuSlice ? o.len : n;
            const h = hi === null ? len : hi;
            for (const x of [lo, h]) if (typeof x !== "number" || !Number.isInteger(x)) fail("Slice bounds must be integers");
            if (lo < 0 || h < lo || h > n) fail(`Slice [${lo}:${h}] out of bounds (length ${len}${o instanceof CajuSlice ? `, capacity ${o.cap}` : ""})`);
            if (typeof o === "string") { stack[sp - 1] = textDecoder.decode(bytesOf(o).subarray(lo, h)); }
            else if (o === null) stack[sp - 1] = null;
            else if (o instanceof CajuSlice) stack[sp - 1] = new CajuSlice(o.t, o.a, o.off + lo, h - lo, o.cap - lo);
            else stack[sp - 1] = new CajuSlice(st, o.a, lo, h - lo, n - lo);
            pc += 3; break;
          }
          case 75 /* LEN */: stack[sp - 1] = lenOf(stack[sp - 1]); pc++; break;
          case 76 /* CAP */: {
            const o = unbox(stack[sp - 1]);
            stack[sp - 1] = o === null ? 0 : o instanceof CajuSlice ? o.cap : o instanceof CajuArr ? o.a.length : o instanceof CajuChan ? o.cap : fail(`cap does not work with ${typeName(o)}`);
            pc++; break;
          }
          case 77 /* APPEND */: {
            const t = code[pc + 1], n = code[pc + 2];
            sp -= n;
            const vals = stack.slice(sp, sp + n);
            stack[sp - 1] = appendTo(unbox(stack[sp - 1]), t, vals);
            pc += 3; break;
          }
          case 78 /* APPEND_SPREAD */: {
            const more = sliceVals(stack[--sp]);
            stack[sp - 1] = appendTo(unbox(stack[sp - 1]), code[pc + 1], more);
            pc += 2; break;
          }
          case 79 /* COPY_SLICE */: {
            const src = sliceVals(stack[--sp]), d = unbox(stack[sp - 1]);
            if (d === null) { stack[sp - 1] = 0; pc++; break; }
            if (!(d instanceof CajuSlice)) fail(`copy needs a destination slice, not ${typeName(d)}`);
            const n = Math.min(d.len, src.length);
            for (let i = 0; i < n; i++) d.a[d.off + i] = copyVal(src[i]);
            stack[sp - 1] = n;
            pc++; break;
          }
          case 80 /* DELETE */: {
            const k = stack[--sp], m = unbox(stack[sp - 1]);
            if (m instanceof CajuMap) m.m.delete(mapKey(k));
            else if (m !== null) fail(`delete needs a map, not ${typeName(m)}`);
            stack[sp - 1] = null;
            pc++; break;
          }
          case 81 /* ITER */: {
            const o = unbox(stack[sp - 1]);
            let it;
            if (o === null || o === undefined) it = { k: "nil" };
            else if (typeof o === "number") it = { k: "int", n: o, i: 0 };
            else if (typeof o === "string") it = { k: "str", s: o, i: 0, b: 0 };
            else if (o instanceof CajuSlice) it = { k: "slice", o, i: 0 };
            else if (o instanceof CajuArr) it = { k: "arr", o, i: 0 };
            else if (o instanceof CajuMap) it = { k: "map", o, keys: [...o.m.keys()], i: 0 };
            else if (o instanceof CajuChan) it = { k: "chan", o };
            else fail(`range cannot iterate over ${typeName(o)}`);
            stack[sp - 1] = it;
            pc++; break;
          }
          case 82 /* ITER_NEXT */: {
            const it = stack[--sp];
            const done = () => { pc = code[pc + 1]; };
            switch (it.k) {
              case "nil": done(); break;
              case "int": if (it.i < it.n) { stack[sp++] = it.i++; stack[sp++] = null; pc += 2; } else done(); break;
              case "slice": if (it.i < it.o.len) { stack[sp++] = it.i; stack[sp++] = it.o.a[it.o.off + it.i++]; pc += 2; } else done(); break;
              case "arr": if (it.i < it.o.a.length) { stack[sp++] = it.i; stack[sp++] = it.o.a[it.i++]; pc += 2; } else done(); break;
              case "str": {
                if (it.i >= it.s.length) { done(); break; }
                const cp = it.s.codePointAt(it.i);
                stack[sp++] = it.b; stack[sp++] = cp;
                it.i += cp > 0xffff ? 2 : 1;
                it.b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
                pc += 2; break;
              }
              case "map": {
                while (it.i < it.keys.length && !it.o.m.has(it.keys[it.i])) it.i++;
                if (it.i >= it.keys.length) { done(); break; }
                const k = it.keys[it.i++];
                stack[sp++] = k; stack[sp++] = it.o.m.get(k);
                pc += 2; break;
              }
              case "chan": {
                let r = it.pending || tryRecv(it.o);
                it.pending = null;
                if (r) { if (r[1]) { stack[sp++] = r[0]; stack[sp++] = null; pc += 2; } else done(); break; }
                // blocks; whoever sends wakes this goroutine back up at this same ITER_NEXT
                stack[sp++] = it;
                park();
                it.o.recvq.push({ g, it });
                g.pc = pc;
                await schedule();
                break;
              }
            }
            break;
          }
          // ---- pointers ----
          case 83 /* ADDR_GLOBAL */: stack[sp++] = new CajuPtr(G, code[pc + 1]); pc += 2; break;
          case 84 /* ADDR_FIELD */: { const o = objOf(stack[sp - 1]); stack[sp - 1] = new CajuPtr(o.f, fieldAt(o, code[pc + 1])); pc += 2; break; }
          case 85 /* ADDR_INDEX */: {
            const i = stack[--sp], o = unbox(stack[sp - 1]);
            if (o instanceof CajuSlice) stack[sp - 1] = new CajuPtr(o.a, o.off + checkIndex(i, o.len, "slice"));
            else if (o instanceof CajuArr) stack[sp - 1] = new CajuPtr(o.a, checkIndex(i, o.a.length, "array"));
            else fail(`Cannot take the address of an element of ${typeName(o)}`);
            pc++; break;
          }
          case 86 /* MKPTR */: stack[sp - 1] = new CajuPtr(new Cell(stack[sp - 1]), "v"); pc++; break;
          case 87 /* CELLPTR */: stack[sp - 1] = new CajuPtr(stack[sp - 1], "v"); pc++; break;
          case 88 /* DEREF */: {
            const p = unbox(stack[sp - 1]);
            if (p === null || p === undefined) fail("Nil pointer: it does not point to anything");
            if (p instanceof CajuPtr) stack[sp - 1] = p.o[p.k];
            else if (!(p instanceof CajuStruct || p instanceof CajuArr)) fail(`Only pointers can be dereferenced with *, and this value is ${typeName(p)}`);
            pc++; break;
          }
          case 89 /* STORE_DEREF */: {
            const v = stack[--sp], p = unbox(stack[--sp]);
            if (p === null || p === undefined) fail("Nil pointer: it does not point to anything");
            if (p instanceof CajuPtr) p.o[p.k] = v;
            else copyInto(p, v);
            pc++; break;
          }
          case 90 /* COPY_INTO */: { const src = stack[--sp], dst = stack[--sp]; if (dst === null || dst === undefined) fail("Nil pointer: it does not point to anything"); copyInto(dst, src); pc++; break; }
          // ---- interfaces ----
          case 91 /* BOX */: {
            const t = code[pc + 1], v = stack[sp - 1];
            // a num with a fractional part already shows it is a num; only integers need the box
            if (!(v === null || v instanceof CajuBox || (rtypes[t].key === "num" && !Number.isInteger(v)))) stack[sp - 1] = new CajuBox(t, v);
            pc += 2; break;
          }
          case 92 /* ASSERT */: case 93 /* ASSERT_OK */: {
            const t = code[pc + 1], v = stack[sp - 1];
            const ok = typeIs(v, t);
            const r = rtypes[t];
            if (code[pc] === 92) {
              if (!ok) fail(`x.(${r.name}): the stored value is ${dynName(v)}, not ${r.name}`);
              stack[sp - 1] = r.k === "iface" || r.k === "any" ? v : unbox(v);
            } else {
              stack[sp - 1] = ok ? (r.k === "iface" || r.k === "any" ? v : unbox(v)) : zeroOf(t);
              stack[sp++] = ok;
            }
            pc += 2; break;
          }
          case 94 /* TYPE_IS */: stack[sp - 1] = typeIs(stack[sp - 1], code[pc + 1]); pc += 2; break;
          case 95 /* DUP */: stack[sp] = stack[sp - 1]; sp++; pc++; break;
          case 96 /* DUP2 */: stack[sp] = stack[sp - 2]; stack[sp + 1] = stack[sp - 1]; sp += 2; pc++; break;
          // ---- channels ----
          case 97 /* CHAN_SEND */: {
            const v = stack[--sp], ch = chanOf(stack[--sp], "Send");
            pc++;
            if (ch === null) { park(); await schedule(); break; }       // nil channel: blocks forever
            if (trySend(ch, v)) break;
            park();
            ch.sendq.push({ g, v });
            await schedule();
            break;
          }
          case 98 /* CHAN_RECV */: case 99 /* CHAN_RECV_OK */: {
            const okForm = code[pc] === 99;
            const ch = chanOf(stack[--sp], "Receive");
            pc++;
            if (ch === null) { park(); await schedule(); break; }
            const r = tryRecv(ch);
            if (r) { stack[sp++] = r[0]; if (okForm) stack[sp++] = r[1]; break; }
            park();
            ch.recvq.push({ g, ok: okForm });
            await schedule();
            break;
          }
          case 100 /* CHAN_CLOSE */: {
            const ch = chanOf(stack[sp - 1], "close");
            if (ch === null) fail("close of a nil channel");
            if (ch.closed) fail("close of a closed channel");
            ch.closed = true;
            const z = zeroOf(rtypes[ch.t].elem);
            while (ch.recvq.length) {
              const r = ch.recvq.shift();
              if (r.sel) { if (r.sel.done) continue; r.sel.done = true; wakeWith(r.g, z, false, r.idx); }
              else if (r.it) { r.it.pending = [z, false]; runq.push(r.g); }
              else if (r.ok) wakeWith(r.g, z, false); else wakeWith(r.g, z);
            }
            while (ch.sendq.length) { const s = ch.sendq.shift(); if (s.sel && s.sel.done) continue; if (s.sel) s.sel.done = true; s.g.wakeErr = "Send on a closed channel"; runq.push(s.g); }
            stack[sp - 1] = null;
            pc++; break;
          }
          case 101 /* SELECT */: {
            const n = code[pc + 1], mask = code[pc + 2], hasDef = code[pc + 3];
            // on the stack: for each case, the channel (and the value, if it is a send)
            const cs = [];
            let width = 0;
            for (let i = 0; i < n; i++) width += mask & (1 << i) ? 2 : 1;
            sp -= width;
            let at = sp;
            for (let i = 0; i < n; i++) {
              const send = !!(mask & (1 << i));
              const ch = chanOf(stack[at++], "select");
              cs.push({ send, ch, v: send ? stack[at++] : null });
            }
            pc += 4;
            let done = false;
            for (let i = 0; i < n && !done; i++) {
              const c = cs[i];
              if (c.ch === null) continue;
              if (c.send) {
                if (c.ch.closed) fail("Send on a closed channel");
                if (trySend(c.ch, c.v)) { stack[sp++] = null; stack[sp++] = false; stack[sp++] = i; done = true; }
              } else {
                const r = tryRecv(c.ch);
                if (r) { stack[sp++] = r[0]; stack[sp++] = r[1]; stack[sp++] = i; done = true; }
              }
            }
            if (done) break;
            if (hasDef) { stack[sp++] = null; stack[sp++] = false; stack[sp++] = -1; break; }
            park();
            const sel = { done: false };
            cs.forEach((c, i) => {
              if (c.ch === null) return;
              if (c.send) c.ch.sendq.push({ g, v: c.v, sel, idx: i });
              else c.ch.recvq.push({ g, sel, idx: i });
            });
            await schedule();
            break;
          }
          case 102 /* BIND_METHOD */: {
            const k = code[pc + 1];
            let recv = stack[sp - 1];
            if (recv === null || recv === undefined) fail(`Method "${consts[k]}" of a nil value`);
            recv = objOf(recv);
            if (!(recv instanceof CajuStruct)) fail(`Only structs have methods, and this value is ${typeName(recv)}`);
            const m = recv.t.methods.find((mm) => mm.key === k);
            if (!m) fail(`struct ${recv.t.name} has no method "${consts[k]}"`);
            for (const p of m.path) recv = recv.f[fieldAt(recv, p)];
            stack[sp - 1] = new CajuFunc(functions[m.fidx].tid, m.fidx, null, [m.ptr ? recv : copyVal(recv)]);
            pc += 2; break;
          }
          case 103 /* BIND_FN */: { const fi = code[pc + 1]; stack[sp - 1] = new CajuFunc(functions[fi].tid, fi, null, [stack[sp - 1]]); pc += 2; break; }
          case 104 /* SCONV */: {
            const mode = code[pc + 1], t = code[pc + 2];
            const v = unbox(stack[sp - 1]);
            let r;
            if (mode === 0) r = runeText(v);
            else if (mode === 1) r = textDecoder.decode(Uint8Array.from(sliceVals(v)));
            else if (mode === 2) r = sliceVals(v).map(runeText).join("");
            else if (mode === 3) { const b = Array.from(bytesOf(v)); r = new CajuSlice(t, b, 0, b.length, b.length); }
            else { const cps = Array.from(v, (c) => c.codePointAt(0)); r = new CajuSlice(t, cps, 0, cps.length, cps.length); }
            stack[sp - 1] = r;
            pc += 3; break;
          }
          case 105 /* ERR_NEW */: stack[sp - 1] = new CajuErr(fmt(stack[sp - 1])); pc++; break;
          default: fail(`Unknown instruction ${code[pc]}`);
        }
      }
      } catch (e) {
        if (!(e instanceof CajuError) || e.fatal) throw e;
        // runtime error = panic: climbs up the frames running the defers, as in Go
        const r = startPanic(e, new CajuErr(e.message));
        if (r !== null && await afterReturn(r)) { finished = true; return count; }
        continue;
      }
      if (count > MAX_INSTR) fatal("The program went past 200 million instructions without finishing. It looks like an infinite loop");
      await new Promise((r) => setTimeout(r, 0));
      if (io.token.stopped) throw new Stopped();
    }
  }

