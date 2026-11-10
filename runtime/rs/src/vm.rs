//! A máquina virtual de pilha da Caju, com goroutines.
//!
//! É a mesma VM da página (runVM), instrução por instrução: cada goroutine tem a sua pilha
//! de operandos, as suas variáveis locais e os seus quadros de chamada; as globais são
//! compartilhadas. O escalonador troca de goroutine quando uma bloqueia (canal, sleep) ou a
//! cada GO_SLICE instruções. Tudo é determinístico, então a saída é igual à do navegador.

use crate::heap::*;
use crate::num::*;
use crate::prog::*;
use std::cell::Cell as StdCell;
use std::collections::VecDeque;
use std::rc::Rc;

pub const MAX_INSTR: f64 = 200_000_000.0;
pub const PAUSE_EVERY: f64 = 200_000.0;
const GO_SLICE: u32 = 2000;
const MAX_DEPTH: usize = 10_000;
// marcas no endereço de retorno de um quadro
pub const RET_DLL: i64 = -1;
const RET_DEFER: i64 = -2;
const RET_PANIC: i64 = -3;
const RET_GOEND: i64 = -9;

pub const OP_NAMES: [&str; 106] = [
    "HALT", "CONST", "LOAD", "STORE", "SET", "POP", "ADD", "SUB", "MUL", "DIV", "MOD", "POW", "NEG", "EQ", "NE", "LT", "GT", "LE", "GE", "NOT",
    "TO_BOOL", "JMP", "JMP_IF_FALSE", "JMP_IF_TRUE", "CALL", "FOR_INIT", "FOR_TEST", "FOR_STEP", "BINK", "LOAD_BINK", "LOAD2_BIN", "UPDATE_K",
    "UPDATE_S", "JMP_UNLESS", "JMP_WHEN", "JMP_UNLESS_K", "JMP_WHEN_K", "CALL_VOID", "FOR_NEXT", "CALLF", "RET", "RET_NULL", "CALL_EXT",
    "NEW_STRUCT", "GET_FIELD", "SET_FIELD", "CALL_METHOD", "COPY", "IOP", "CONV", "MAKE_CLOSURE", "CALL_VALUE", "LOAD_CELL", "STORE_CELL",
    "NEW_CELL", "LOAD_CELLREF", "LOAD_UP", "STORE_UP", "LOAD_UPREF", "REBOX", "RETN", "RET_NAMED", "DEFER", "GO", "PANIC", "RECOVER",
    "MAKE_SLICE", "MAKE_ARRAY", "MAKE_MAP", "MAKE", "ZERO", "INDEX", "INDEX_OK", "SET_INDEX", "SLICE", "LEN", "CAP", "APPEND", "APPEND_SPREAD",
    "COPY_SLICE", "DELETE", "ITER", "ITER_NEXT", "ADDR_GLOBAL", "ADDR_FIELD", "ADDR_INDEX", "MKPTR", "CELLPTR", "DEREF", "STORE_DEREF",
    "COPY_INTO", "BOX", "ASSERT", "ASSERT_OK", "TYPE_IS", "DUP", "DUP2", "CHAN_SEND", "CHAN_RECV", "CHAN_RECV_OK", "CHAN_CLOSE", "SELECT",
    "BIND_METHOD", "BIND_FN", "SCONV", "ERR_NEW",
];
const BIN_SYMBOLS: [&str; 12] = ["+", "-", "*", "/", "%", "**", "==", "!=", "<", ">", "<=", ">="];

pub const STAGE_EXEC: &str = "execução";

#[derive(Debug)]
pub struct VmErr {
    pub stage: &'static str,
    pub msg: String,
    pub loc: i32,
    pub fatal: bool,
}
pub type R<T> = Result<T, VmErr>;

#[derive(Clone)]
pub struct Frame {
    ret: i64,
    fp: usize,
    vtop: usize,
    fidx: i32,
    cl: u32,
    sp: usize,
    defers: Vec<(Val, Vec<Val>)>,
    discard: bool,
    deferred: bool,
    returning: bool,
    pending: Vec<Val>,
    named: Option<(usize, usize)>,
    top: bool,
}
impl Frame {
    fn top_frame() -> Frame {
        Frame { ret: RET_GOEND, fp: 0, vtop: 0, fidx: -1, cl: NONE, sp: 0, defers: Vec::new(), discard: false, deferred: false, returning: false, pending: Vec::new(), named: None, top: true }
    }
}
struct Panic {
    msg: String,
    loc: i32,
    value: Val,
    recovered: bool,
}
pub struct Gor {
    pub id: usize,
    pub pc: usize,
    pub sp: usize,
    pub stack: Vec<Val>,
    l: Vec<Val>,
    fp: usize,
    vtop: usize,
    fidx: i32,
    cl: u32,
    pub frames: Vec<Frame>,
    pub fr: Frame,
    panic: Option<Panic>,
    wake: f64,
    seq: u64,
    wake_err: Option<String>,
    ip: usize,
}
impl Gor {
    fn new(id: usize) -> Gor {
        Gor {
            id,
            pc: 0,
            sp: 0,
            stack: vec![Val::Nil; 256],
            l: Vec::new(),
            fp: 0,
            vtop: 0,
            fidx: -1,
            cl: NONE,
            frames: Vec::new(),
            fr: Frame::top_frame(),
            panic: None,
            wake: 0.0,
            seq: 0,
            wake_err: None,
            ip: 0,
        }
    }
    fn empty() -> Gor {
        Gor {
            id: usize::MAX,
            pc: 0,
            sp: 0,
            stack: Vec::new(),
            l: Vec::new(),
            fp: 0,
            vtop: 0,
            fidx: -1,
            cl: NONE,
            frames: Vec::new(),
            fr: Frame::top_frame(),
            panic: None,
            wake: 0.0,
            seq: 0,
            wake_err: None,
            ip: 0,
        }
    }
    #[inline]
    fn push(&mut self, v: Val) {
        if self.sp >= self.stack.len() {
            let n = self.stack.len().max(64) * 2;
            self.stack.resize(n, Val::Nil);
        }
        self.stack[self.sp] = v;
        self.sp += 1;
    }
}

/// resultado de doReturn/retFlow
enum Flow {
    Null,
    Vals(Vec<Val>),
    Dll,
    GoEnd,
}
pub enum End {
    Finished,
    Dll,
}


pub struct Vm {
    pub p: &'static Prog,
    pub h: Heap,
    pub g: Vec<Val>,
    pub cur: Gor,
    gs: Vec<Option<Gor>>,
    runq: VecDeque<usize>,
    sleepers: Vec<usize>,
    clock: f64,
    sleep_seq: u64,
    pub ip: usize,
    pub count: f64,
    slice: u32,
    pub host_ret: Val,
    pub skip_sleep: bool,
    empty: Val,
    /// chamadas a funções de DLL (FFI): ficam no módulo nativo
    pub ffi: fn(&mut Vm, usize, &[Val]) -> R<Val>,
    pub mem: fn(&mut Vm, usize, &[Val]) -> R<Val>,
}

#[inline]
fn truthy(v: Val) -> bool {
    !matches!(v, Val::Bool(false) | Val::Nil | Val::Unset) && !matches!(v, Val::Num(x) if x == 0.0)
}
fn plural(n: i64, w: &str) -> String {
    format!("{} {}{}", n, w, if n == 1 { "" } else { "s" })
}
fn norm_key(x: f64) -> u64 {
    if x == 0.0 {
        0
    } else if x.is_nan() {
        f64::NAN.to_bits()
    } else {
        x.to_bits()
    }
}
fn rune_text(v: Val) -> String {
    if let Val::Num(r) = v {
        if is_int(r) && (0.0..=1114111.0).contains(&r) {
            if let Some(c) = char::from_u32(r as u32) {
                return c.to_string();
            }
        }
    }
    "\u{FFFD}".to_string()
}

impl Vm {
    pub fn new(p: &'static Prog, h: Heap) -> Vm {
        let mut h = h;
        let empty = Val::Str(h.alloc(Obj::Str("".into())));
        let mut gs = Vec::new();
        gs.push(None);
        let mut cur = Gor::new(0);
        cur.stack = vec![Val::Nil; 1024];
        Vm {
            p,
            h,
            g: vec![Val::Unset; p.slot_names.len()],
            cur,
            gs,
            runq: VecDeque::new(),
            sleepers: Vec::new(),
            clock: 0.0,
            sleep_seq: 0,
            ip: 0,
            count: 0.0,
            slice: GO_SLICE,
            host_ret: Val::Nil,
            skip_sleep: false,
            empty,
            ffi: |vm, _, _| Err(vm.err("Chamadas a DLL não funcionam aqui".into())),
            mem: |vm, _, _| Err(vm.err("memória indisponível".into())),
        }
    }

    // ---------------------------------------------------------------- erros
    pub fn err(&self, msg: String) -> VmErr {
        VmErr { stage: STAGE_EXEC, msg, loc: self.p.lines.get(self.ip).copied().unwrap_or(1), fatal: false }
    }
    fn fatal(&self, msg: String) -> VmErr {
        let mut e = self.err(msg);
        e.fatal = true;
        e
    }

    // ---------------------------------------------------------------- valores
    #[inline]
    pub fn new_str(&mut self, s: String) -> Val {
        if s.is_empty() {
            return self.empty;
        }
        Val::Str(self.h.alloc(Obj::Str(s.into_boxed_str())))
    }
    #[inline]
    fn alloc(&mut self, o: Obj) -> Val {
        Val::Obj(self.h.alloc(o))
    }
    #[inline]
    pub fn unbox(&self, v: Val) -> Val {
        if let Val::Obj(i) = v {
            if let Obj::Boxed { v, .. } = self.h.get(i) {
                return *v;
            }
        }
        v
    }
    pub fn str_of(&self, v: Val) -> Option<&str> {
        if let Val::Str(i) = v {
            Some(self.h.s(i))
        } else {
            None
        }
    }
    fn ctext(&self, k: i32) -> &str {
        self.p.const_text.get(k as usize).and_then(|t| t.as_deref()).unwrap_or("?")
    }
    /// struct de um valor (não segue caixas)
    fn struct_id(&self, v: Val) -> Option<u32> {
        if let Val::Obj(i) = v {
            if let Obj::Struct { .. } = self.h.get(i) {
                return Some(i);
            }
        }
        None
    }
    fn is_struct_or_arr(&self, v: Val) -> bool {
        if let Val::Obj(i) = v {
            return matches!(self.h.get(i), Obj::Struct { .. } | Obj::Arr { .. });
        }
        false
    }
    fn is_obj(&self, v: Val) -> bool {
        matches!(v, Val::Obj(_))
    }

    pub fn type_name(&self, v: Val) -> String {
        match v {
            Val::Num(_) => "número".into(),
            Val::Str(_) => "texto".into(),
            Val::Bool(_) => "booleano".into(),
            Val::Nil | Val::Unset => "nil".into(),
            Val::Obj(i) => match self.h.get(i) {
                Obj::Struct { s, .. } => format!("struct {}", self.p.stypes[*s as usize].name),
                Obj::Boxed { v, .. } => {
                    if let Some(si) = self.struct_id(*v) {
                        if let Obj::Struct { s, .. } = self.h.get(si) {
                            return format!("ponteiro *{}", self.p.stypes[*s as usize].name);
                        }
                    }
                    self.type_name(*v)
                }
                Obj::Slice { .. } => "slice".into(),
                Obj::Arr { .. } => "array".into(),
                Obj::Map(_) => "map".into(),
                Obj::Func { .. } => "função".into(),
                Obj::Ptr(_) => "ponteiro".into(),
                Obj::Chan(_) => "canal".into(),
                Obj::Err(_) => "erro".into(),
                _ => "valor".into(),
            },
        }
    }

    fn ptr_get(&self, p: PtrK) -> Val {
        match p {
            PtrK::Global(s) => self.g[s as usize],
            PtrK::Field(o, k) => match self.h.get(o) {
                Obj::Struct { f, .. } => f.get(k as usize).copied().unwrap_or(Val::Nil),
                _ => Val::Nil,
            },
            PtrK::Elem(o, k) => match self.h.get(o) {
                Obj::Back(a) => a.get(k).copied().unwrap_or(Val::Nil),
                _ => Val::Nil,
            },
            PtrK::Cell(o) => match self.h.get(o) {
                Obj::Cell(v) => *v,
                _ => Val::Nil,
            },
        }
    }
    fn ptr_set(&mut self, p: PtrK, v: Val) {
        match p {
            PtrK::Global(s) => self.g[s as usize] = v,
            PtrK::Field(o, k) => {
                if let Obj::Struct { f, .. } = self.h.get_mut(o) {
                    f[k as usize] = v
                }
            }
            PtrK::Elem(o, k) => {
                if let Obj::Back(a) = self.h.get_mut(o) {
                    a[k] = v
                }
            }
            PtrK::Cell(o) => {
                if let Obj::Cell(c) = self.h.get_mut(o) {
                    *c = v
                }
            }
        }
    }

    pub fn fmt(&self, v: Val, nested: bool, out: &mut String) {
        match v {
            Val::Num(x) => fmt_num(x, out),
            Val::Str(i) => {
                if nested {
                    out.push('"');
                    out.push_str(self.h.s(i));
                    out.push('"');
                } else {
                    out.push_str(self.h.s(i))
                }
            }
            Val::Bool(b) => out.push_str(if b { "true" } else { "false" }),
            Val::Nil | Val::Unset => out.push_str("nil"),
            Val::Obj(i) => match self.h.get(i) {
                Obj::Struct { s, f } => {
                    let st = &self.p.stypes[*s as usize];
                    out.push_str(&st.name);
                    out.push('{');
                    for (k, fv) in f.iter().enumerate() {
                        if k > 0 {
                            out.push_str(", ");
                        }
                        out.push_str(self.ctext(st.keys[k] as i32));
                        out.push_str(": ");
                        self.fmt(*fv, true, out);
                    }
                    out.push('}');
                }
                Obj::Boxed { v, .. } => {
                    if self.struct_id(*v).is_some() {
                        out.push('&');
                    }
                    self.fmt(*v, nested, out)
                }
                Obj::Slice { a, off, len, .. } => {
                    out.push('[');
                    if let Obj::Back(b) = self.h.get(*a) {
                        for k in 0..*len {
                            if k > 0 {
                                out.push(' ');
                            }
                            self.fmt(b.get(off + k).copied().unwrap_or(Val::Nil), true, out);
                        }
                    }
                    out.push(']');
                }
                Obj::Arr { a, .. } => {
                    out.push('[');
                    if let Obj::Back(b) = self.h.get(*a) {
                        for (k, x) in b.iter().enumerate() {
                            if k > 0 {
                                out.push(' ');
                            }
                            self.fmt(*x, true, out);
                        }
                    }
                    out.push(']');
                }
                Obj::Map(m) => {
                    let mut ents: Vec<(Val, Val)> = m.ents.iter().flatten().copied().collect();
                    ents.sort_by(|a, b| self.key_cmp(a.0, b.0));
                    out.push_str("map[");
                    for (k, (kv, vv)) in ents.iter().enumerate() {
                        if k > 0 {
                            out.push(' ');
                        }
                        self.fmt(*kv, true, out);
                        out.push(':');
                        self.fmt(*vv, true, out);
                    }
                    out.push(']');
                }
                Obj::Err(m) => out.push_str(m),
                Obj::Func { .. } => out.push_str("fn"),
                Obj::Ptr(p) => {
                    out.push('&');
                    self.fmt(self.ptr_get(*p), true, out)
                }
                Obj::Chan(_) => out.push_str("chan"),
                _ => out.push_str("[object Object]"),
            },
        }
    }
    fn key_cmp(&self, a: Val, b: Val) -> std::cmp::Ordering {
        use std::cmp::Ordering::*;
        match (a, b) {
            (Val::Str(x), Val::Str(y)) => self.h.s(x).cmp(self.h.s(y)),
            (Val::Num(x), Val::Num(y)) => x.partial_cmp(&y).unwrap_or(Equal),
            (Val::Bool(x), Val::Bool(y)) => x.cmp(&y),
            _ => Equal,
        }
    }
    pub fn fmt_string(&self, v: Val) -> String {
        let mut s = String::new();
        self.fmt(v, false, &mut s);
        s
    }

    /// structs e arrays são valores: atribuir, passar ou devolver copia
    pub fn copy_val(&mut self, v: Val) -> Val {
        let Val::Obj(i) = v else { return v };
        match self.h.get(i) {
            Obj::Struct { s, f } => {
                let (s, mut f) = (*s, f.clone());
                let deep = &self.p.stypes[s as usize].deep;
                for k in 0..f.len() {
                    if deep.get(k).copied().unwrap_or(false) {
                        f[k] = self.copy_val(f[k]);
                    }
                }
                self.alloc(Obj::Struct { s, f })
            }
            Obj::Arr { t, a, deep } => {
                let (t, a, deep) = (*t, *a, *deep);
                let mut b = match self.h.get(a) {
                    Obj::Back(b) => b.clone(),
                    _ => Vec::new(),
                };
                if deep {
                    for x in b.iter_mut() {
                        *x = self.copy_val(*x);
                    }
                }
                let a = self.h.alloc(Obj::Back(b));
                self.alloc(Obj::Arr { t, a, deep })
            }
            _ => v,
        }
    }
    /// grava src por cima de dst, mantendo o objeto (ponteiros para ele continuam valendo)
    fn copy_into(&mut self, dst: Val, src: Val) {
        let (Val::Obj(d), Val::Obj(s)) = (dst, src) else { return };
        match (self.h.get(d), self.h.get(s)) {
            (Obj::Struct { s: st, f: df }, Obj::Struct { f: sf, .. }) => {
                let deep = &self.p.stypes[*st as usize].deep;
                let n = df.len();
                let (df, sf) = (df.clone(), sf.clone());
                for k in 0..n {
                    if deep.get(k).copied().unwrap_or(false) && self.is_obj(df[k]) {
                        self.copy_into(df[k], sf.get(k).copied().unwrap_or(Val::Nil));
                    } else if let Obj::Struct { f, .. } = self.h.get_mut(d) {
                        f[k] = sf.get(k).copied().unwrap_or(Val::Nil);
                    }
                }
            }
            (Obj::Arr { a: da, deep, .. }, Obj::Arr { a: sa, .. }) => {
                let (da, sa, deep) = (*da, *sa, *deep);
                let sv = match self.h.get(sa) {
                    Obj::Back(b) => b.clone(),
                    _ => return,
                };
                let dv = match self.h.get(da) {
                    Obj::Back(b) => b.clone(),
                    _ => return,
                };
                for k in 0..dv.len() {
                    let x = sv.get(k).copied().unwrap_or(Val::Nil);
                    if deep && self.is_obj(dv[k]) {
                        self.copy_into(dv[k], x);
                    } else if let Obj::Back(b) = self.h.get_mut(da) {
                        b[k] = x;
                    }
                }
            }
            _ => {}
        }
    }
    /// === do JavaScript
    fn same(&self, a: Val, b: Val) -> bool {
        match (a, b) {
            (Val::Num(x), Val::Num(y)) => x == y,
            (Val::Bool(x), Val::Bool(y)) => x == y,
            (Val::Nil, Val::Nil) | (Val::Unset, Val::Unset) => true,
            (Val::Str(x), Val::Str(y)) => x == y || self.h.s(x) == self.h.s(y),
            (Val::Obj(x), Val::Obj(y)) => x == y,
            _ => false,
        }
    }
    pub fn val_eq(&self, a: Val, b: Val) -> bool {
        if self.same(a, b) {
            return true;
        }
        let a = if let Val::Unset = a { Val::Nil } else { a };
        let b = if let Val::Unset = b { Val::Nil } else { b };
        if a.is_nil() || b.is_nil() {
            return a.is_nil() && b.is_nil();
        }
        let (Val::Obj(x), Val::Obj(y)) = (a, b) else { return false };
        match (self.h.get(x), self.h.get(y)) {
            (Obj::Struct { s: s1, f: f1 }, Obj::Struct { s: s2, f: f2 }) => {
                if s1 != s2 {
                    return false;
                }
                let deep = &self.p.stypes[*s1 as usize].deep;
                for k in 0..f1.len() {
                    let (u, w) = (f1[k], f2.get(k).copied().unwrap_or(Val::Nil));
                    let eq = if deep.get(k).copied().unwrap_or(false) { self.val_eq(u, w) } else { self.same(u, w) || self.val_eq_flat(u, w) };
                    if !eq {
                        return false;
                    }
                }
                true
            }
            (Obj::Arr { t: t1, a: a1, .. }, Obj::Arr { t: t2, a: a2, .. }) => {
                if t1 != t2 {
                    return false;
                }
                match (self.h.get(*a1), self.h.get(*a2)) {
                    (Obj::Back(p), Obj::Back(q)) => p.iter().enumerate().all(|(k, &u)| self.val_eq(u, q.get(k).copied().unwrap_or(Val::Nil))),
                    _ => false,
                }
            }
            (Obj::Boxed { t: t1, v: v1 }, Obj::Boxed { t: t2, v: v2 }) => t1 == t2 && (self.same(*v1, *v2) || self.val_eq(*v1, *v2)),
            (Obj::Ptr(p), Obj::Ptr(q)) => p == q,
            _ => false,
        }
    }
    fn val_eq_flat(&self, a: Val, b: Val) -> bool {
        let boxy = |v: Val| matches!(v, Val::Obj(i) if matches!(self.h.get(i), Obj::Boxed { .. }));
        let ptr = |v: Val| matches!(v, Val::Obj(i) if matches!(self.h.get(i), Obj::Ptr(_)));
        if boxy(a) || boxy(b) || ptr(a) {
            self.val_eq(a, b)
        } else {
            self.same(a, b)
        }
    }

    fn value_kind(&self, t: i32) -> bool {
        t >= 0 && matches!(self.p.rtypes[t as usize].k, K_STRUCT | K_ARRAY)
    }
    /// valor zero de um tipo da tabela
    pub fn zero_of(&mut self, t: i32) -> Val {
        if t < 0 {
            return Val::Nil;
        }
        let r = &self.p.rtypes[t as usize];
        match r.k {
            K_NUM => Val::Num(0.0),
            K_STR => self.empty,
            K_BOOL => Val::Bool(false),
            K_STRUCT => {
                let s = r.sidx as u32;
                let ft = &self.p.stypes[s as usize].ftids;
                let f: Vec<Val> = ft.iter().map(|&x| self.zero_of(x)).collect();
                self.alloc(Obj::Struct { s, f })
            }
            K_ARRAY => {
                let (n, el) = (r.n as usize, r.elem);
                let b: Vec<Val> = (0..n).map(|_| self.zero_of(el)).collect();
                let deep = self.value_kind(el);
                let a = self.h.alloc(Obj::Back(b));
                self.alloc(Obj::Arr { t, a, deep })
            }
            _ => Val::Nil,
        }
    }
    /// tipo dinâmico de um valor guardado numa interface
    fn dyn_tid(&self, v: Val) -> i32 {
        match v {
            Val::Nil | Val::Unset => -1,
            Val::Num(x) => {
                if is_int(x) {
                    self.p.tid_int
                } else {
                    self.p.tid_num
                }
            }
            Val::Str(_) => self.p.tid_str,
            Val::Bool(_) => self.p.tid_bool,
            Val::Obj(i) => match self.h.get(i) {
                Obj::Struct { s, .. } => self.p.stypes[*s as usize].tid,
                Obj::Err(_) => -2,
                Obj::Boxed { t, .. } | Obj::Slice { t, .. } | Obj::Arr { t, .. } | Obj::Func { t, .. } => *t,
                Obj::Map(m) => m.t,
                Obj::Chan(c) => c.t,
                _ => -3,
            },
        }
    }
    fn dyn_name(&self, v: Val) -> String {
        match self.dyn_tid(v) {
            -1 => "nil".into(),
            -2 => "*errors.errorString".into(),
            t if t >= 0 => self.p.rtypes[t as usize].name.clone(),
            _ => "?".into(),
        }
    }
    /// métodos que um valor oferece (para interfaces)
    fn has_methods(&self, v: Val, keys: &[u32]) -> bool {
        let mut st: Option<u32> = None;
        let mut all = false;
        if let Val::Obj(i) = v {
            match self.h.get(i) {
                Obj::Err(_) => return keys.iter().all(|&k| k as i64 == self.p.error_key),
                Obj::Struct { s, .. } => st = Some(*s),
                Obj::Boxed { v, .. } => {
                    if let Some(si) = self.struct_id(*v) {
                        if let Obj::Struct { s, .. } = self.h.get(si) {
                            st = Some(*s);
                            all = true;
                        }
                    }
                }
                _ => {}
            }
        }
        let Some(s) = st else { return keys.is_empty() };
        let ms = &self.p.stypes[s as usize].methods;
        keys.iter().all(|&k| ms.iter().any(|m| m.key == k && (all || m.vset)))
    }
    fn type_is(&self, v: Val, t: i32) -> bool {
        let r = &self.p.rtypes[t as usize];
        match r.k {
            K_ANY => !v.is_nil(),
            K_IFACE => !v.is_nil() && self.has_methods(v, &r.methods),
            _ => self.dyn_tid(v) == t,
        }
    }
    fn map_key(&self, v: Val) -> MKey {
        match self.unbox(v) {
            Val::Num(x) => MKey::Num(norm_key(x)),
            Val::Str(i) => MKey::Str(self.h.s(i).into()),
            Val::Bool(b) => MKey::Bool(b),
            Val::Nil | Val::Unset => MKey::Nil,
            Val::Obj(i) => MKey::Obj(i),
        }
    }

    // ---------------------------------------------------------------- operações
    fn binop(&mut self, b: usize, a: Val, c: Val) -> R<Val> {
        let (a, c) = (self.unbox(a), self.unbox(c));
        let op = BIN_SYMBOLS[b];
        match b {
            6 => return Ok(Val::Bool(self.val_eq(a, c))),
            7 => return Ok(Val::Bool(!self.val_eq(a, c))),
            8..=11 => {
                let ok = match (a, c) {
                    (Val::Num(_), Val::Num(_)) | (Val::Str(_), Val::Str(_)) => true,
                    _ => false,
                };
                if !ok {
                    return Err(self.err(format!("Não dá para comparar {} com {} usando \"{}\"", self.type_name(a), self.type_name(c), op)));
                }
                if let (Val::Str(x), Val::Str(y)) = (a, c) {
                    let o = self.h.s(x).cmp(self.h.s(y)) as i32;
                    return Ok(Val::Bool(match b {
                        8 => o < 0,
                        9 => o > 0,
                        10 => o <= 0,
                        _ => o >= 0,
                    }));
                }
                let (Val::Num(x), Val::Num(y)) = (a, c) else { unreachable!() };
                return Ok(Val::Bool(match b {
                    8 => x < y,
                    9 => x > y,
                    10 => x <= y,
                    _ => x >= y,
                }));
            }
            _ => {}
        }
        if b == 0 && (matches!(a, Val::Str(_)) || matches!(c, Val::Str(_))) {
            let mut s = String::new();
            self.fmt(a, false, &mut s);
            self.fmt(c, false, &mut s);
            return Ok(self.new_str(s));
        }
        let (Val::Num(x), Val::Num(y)) = (a, c) else {
            return Err(self.err(format!("O operador \"{}\" só funciona com números", op)));
        };
        Ok(Val::Num(match b {
            0 => x + y,
            1 => x - y,
            2 => x * y,
            3 => {
                if y == 0.0 {
                    return Err(self.err("Divisão por zero".into()));
                }
                x / y
            }
            4 => {
                if y == 0.0 {
                    return Err(self.err("Resto de divisão por zero".into()));
                }
                x % y
            }
            _ => js_pow(x, y),
        }))
    }
    /// operação binária das superinstruções; o caminho rápido é número com número
    #[inline]
    fn calc(&mut self, b: usize, x: Val, y: Val) -> R<Val> {
        if let (Val::Num(a), Val::Num(c)) = (x, y) {
            return Ok(match b {
                0 => Val::Num(a + c),
                1 => Val::Num(a - c),
                2 => Val::Num(a * c),
                3 => {
                    if c == 0.0 {
                        return Err(self.err("Divisão por zero".into()));
                    }
                    Val::Num(a / c)
                }
                4 => {
                    if c == 0.0 {
                        return Err(self.err("Resto de divisão por zero".into()));
                    }
                    Val::Num(a % c)
                }
                5 => Val::Num(js_pow(a, c)),
                6 => Val::Bool(a == c),
                7 => Val::Bool(a != c),
                8 => Val::Bool(a < c),
                9 => Val::Bool(a > c),
                10 => Val::Bool(a <= c),
                _ => Val::Bool(a >= c),
            });
        }
        let r = self.binop(b, x, y)?;
        Ok(r)
    }
    fn int_op(&mut self, op: i32, k: i32, a: Val, b: Val) -> R<Val> {
        let (a, b) = (self.unbox(a), self.unbox(b));
        let x = match a {
            Val::Num(x) => Some(x),
            _ => None,
        };
        let y = if op == 11 {
            Some(0.0)
        } else {
            match b {
                Val::Num(y) => Some(y),
                _ => None,
            }
        };
        match (x, y) {
            (Some(x), Some(y)) => int_op(op, k, x, y).map(Val::Num).map_err(|m| self.err(m.into())),
            _ => {
                let bad = if op == 11 || x.is_none() { a } else { b };
                Err(self.err(format!("A operação \"{}\" só funciona com inteiros, e recebeu {}", IOP_SYMBOLS[op as usize], self.type_name(bad))))
            }
        }
    }

    // ---------------------------------------------------------------- variáveis
    #[inline]
    fn lidx(&self, s: i32) -> usize {
        self.cur.fp + (-s - 1) as usize
    }
    #[inline]
    fn raw(&self, s: i32) -> Val {
        if s >= 0 {
            self.g[s as usize]
        } else {
            self.cur.l[self.lidx(s)]
        }
    }
    #[inline]
    fn setv(&mut self, s: i32, v: Val) {
        if s >= 0 {
            self.g[s as usize] = v
        } else {
            let i = self.lidx(s);
            self.cur.l[i] = v
        }
    }
    fn name_of(&self, s: i32) -> String {
        if s >= 0 {
            return self.p.slot_names[s as usize].clone();
        }
        if self.cur.fidx >= 0 {
            if let Some(n) = self.p.funcs[self.cur.fidx as usize].local_names.get((-s - 1) as usize) {
                return n.clone();
            }
        }
        "?".into()
    }
    #[inline]
    fn get(&self, s: i32) -> R<Val> {
        let v = self.raw(s);
        if let Val::Unset = v {
            return Err(self.err(format!("A variável \"{}\" foi usada antes de receber valor", self.name_of(s))));
        }
        Ok(v)
    }
    #[inline]
    fn push(&mut self, v: Val) {
        self.cur.push(v)
    }
    #[inline]
    fn pop(&mut self) -> Val {
        self.cur.sp -= 1;
        self.cur.stack[self.cur.sp]
    }
    #[inline]
    fn upop(&mut self) -> Val {
        let v = self.pop();
        self.unbox(v)
    }
    #[inline]
    fn top(&self) -> Val {
        self.cur.stack[self.cur.sp - 1]
    }
    #[inline]
    fn set_top(&mut self, v: Val) {
        let i = self.cur.sp - 1;
        self.cur.stack[i] = v;
    }
    fn take(&mut self, n: usize) -> Vec<Val> {
        self.cur.sp -= n;
        self.cur.stack[self.cur.sp..self.cur.sp + n].to_vec()
    }

    // ---------------------------------------------------------------- goroutines
    fn save(&mut self) {
        let g = std::mem::replace(&mut self.cur, Gor::empty());
        let id = g.id;
        self.gs[id] = Some(g);
    }
    fn load(&mut self, id: usize) {
        self.cur = self.gs[id].take().expect("goroutine");
        self.slice = GO_SLICE;
    }
    fn gor_mut(&mut self, id: usize) -> &mut Gor {
        if self.cur.id == id {
            &mut self.cur
        } else {
            self.gs[id].as_mut().expect("goroutine")
        }
    }
    fn wake_with(&mut self, w: usize, vals: &[Val]) {
        let g = self.gor_mut(w);
        for &v in vals {
            g.push(v);
        }
        self.runq.push_back(w);
    }
    fn sleep_ms(&self, ms: f64) {
        if self.skip_sleep || ms <= 0.0 {
            return;
        }
        use std::io::Write;
        let _ = std::io::stdout().flush();
        std::thread::sleep(std::time::Duration::from_secs_f64(ms / 1000.0));
    }
    /// escolhe a próxima goroutine: as prontas em ordem; se só houver dormindo, o relógio avança
    fn schedule(&mut self) -> R<()> {
        loop {
            if let Some(x) = self.runq.pop_front() {
                self.load(x);
                if let Some(m) = self.cur.wake_err.take() {
                    self.ip = self.cur.ip;
                    return Err(self.err(m));
                }
                return Ok(());
            }
            if !self.sleepers.is_empty() {
                let key = |vm: &Vm, id: usize| {
                    let g = vm.gs[id].as_ref().unwrap();
                    (g.wake, g.seq)
                };
                let mut best = 0;
                for i in 1..self.sleepers.len() {
                    let (a, b) = (key(self, self.sleepers[i]), key(self, self.sleepers[best]));
                    if a.0 < b.0 || (a.0 == b.0 && a.1 < b.1) {
                        best = i;
                    }
                }
                let w = key(self, self.sleepers[best]).0;
                if w > self.clock {
                    self.sleep_ms(w - self.clock);
                }
                self.clock = w;
                let mut ready: Vec<usize> = self.sleepers.iter().copied().filter(|&s| key(self, s).0 <= self.clock).collect();
                ready.sort_by(|&a, &b| {
                    let (x, y) = (key(self, a), key(self, b));
                    x.0.partial_cmp(&y.0).unwrap().then(x.1.cmp(&y.1))
                });
                self.sleepers.retain(|s| !ready.contains(s));
                self.runq.extend(ready);
                continue;
            }
            self.ip = if self.cur.id == 0 { self.cur.ip } else { self.gs[0].as_ref().map(|g| g.ip).unwrap_or(self.ip) };
            return Err(self.fatal("Todas as goroutines estão bloqueadas, esperando umas pelas outras (deadlock)".into()));
        }
    }
    /// a goroutine atual para: bloqueada num canal, dormindo ou terminada
    fn park(&mut self) -> usize {
        let id = self.cur.id;
        self.cur.ip = self.ip;
        self.save();
        id
    }

    // ---------------------------------------------------------------- canais
    fn chan_of(&self, c: Val, what: &str) -> R<Option<u32>> {
        let c = self.unbox(c);
        match c {
            Val::Nil | Val::Unset => Ok(None),
            Val::Obj(i) if matches!(self.h.get(i), Obj::Chan(_)) => Ok(Some(i)),
            _ => Err(self.err(format!("{} precisa de um canal, e não de {}", what, self.type_name(c)))),
        }
    }
    fn chan(&mut self, i: u32) -> &mut ChanObj {
        match self.h.get_mut(i) {
            Obj::Chan(c) => c,
            _ => unreachable!(),
        }
    }
    fn live_recv(q: &mut VecDeque<RecvW>) -> bool {
        while q.front().map_or(false, |r| r.sel.as_ref().map_or(false, |s| s.get())) {
            q.pop_front();
        }
        !q.is_empty()
    }
    fn live_send(q: &mut VecDeque<SendW>) -> bool {
        while q.front().map_or(false, |r| r.sel.as_ref().map_or(false, |s| s.get())) {
            q.pop_front();
        }
        !q.is_empty()
    }
    fn set_pending(&mut self, it: u32, v: Val, ok: bool) {
        if let Obj::Iter(b) = self.h.get_mut(it) {
            if let It::Chan { pending, .. } = &mut **b {
                *pending = Some((v, ok));
            }
        }
    }
    /// tenta enviar sem bloquear; devolve true se conseguiu
    fn try_send(&mut self, ch: u32, v: Val) -> R<bool> {
        let c = self.chan(ch);
        if c.closed {
            return Err(self.err("Envio num canal fechado".into()));
        }
        if Self::live_recv(&mut c.recvq) {
            let r = c.recvq.pop_front().unwrap();
            if let Some(s) = &r.sel {
                s.set(true);
                self.wake_with(r.g, &[v, Val::Bool(true), Val::Num(r.idx as f64)]);
            } else if r.it != NONE {
                self.set_pending(r.it, v, true);
                self.runq.push_back(r.g);
            } else if r.ok {
                self.wake_with(r.g, &[v, Val::Bool(true)]);
            } else {
                self.wake_with(r.g, &[v]);
            }
            return Ok(true);
        }
        if (c.buf.len() as f64) < c.cap {
            c.buf.push_back(v);
            return Ok(true);
        }
        Ok(false)
    }
    fn release_sender(&mut self, s: SendW) {
        if let Some(sel) = &s.sel {
            sel.set(true);
            self.wake_with(s.g, &[Val::Nil, Val::Bool(false), Val::Num(s.idx as f64)]);
        } else {
            self.runq.push_back(s.g);
        }
    }
    /// tenta receber sem bloquear
    fn try_recv(&mut self, ch: u32) -> Option<(Val, bool)> {
        let c = self.chan(ch);
        if let Some(v) = c.buf.pop_front() {
            if Self::live_send(&mut c.sendq) {
                let s = c.sendq.pop_front().unwrap();
                c.buf.push_back(s.v);
                self.release_sender(s);
            }
            return Some((v, true));
        }
        if Self::live_send(&mut c.sendq) {
            let s = c.sendq.pop_front().unwrap();
            let v = s.v;
            self.release_sender(s);
            return Some((v, true));
        }
        if c.closed {
            let t = c.t;
            let el = self.p.rtypes[t as usize].elem;
            return Some((self.zero_of(el), false));
        }
        None
    }

    // ---------------------------------------------------------------- quadros, defer e panic
    fn enter_func(&mut self, fi: usize, n: usize, cl: u32, ret: i64, discard: bool, deferred: bool) -> R<()> {
        let f = &self.p.funcs[fi];
        if self.cur.frames.len() >= MAX_DEPTH {
            return Err(self.err("Recursão demais: mais de 10.000 chamadas de função abertas ao mesmo tempo".into()));
        }
        let g = &mut self.cur;
        let base = g.vtop;
        let nl = f.nlocals as usize;
        if g.l.len() < base + nl + 1 {
            let want = (base + nl + 1).max(g.l.len() * 2).max(256);
            g.l.resize(want, Val::Unset);
        }
        g.sp -= n;
        for k in 0..nl {
            g.l[base + k] = if k < n { g.stack[g.sp + k] } else { Val::Unset };
        }
        let nf = Frame { ret, fp: g.fp, vtop: g.vtop, fidx: g.fidx, cl: g.cl, sp: g.sp, defers: Vec::new(), discard, deferred, returning: false, pending: Vec::new(), named: None, top: false };
        let old = std::mem::replace(&mut g.fr, nf);
        g.frames.push(old);
        g.fp = base;
        g.vtop = base + nl;
        g.fidx = fi as i32;
        g.cl = cl;
        g.pc = f.entry as usize;
        Ok(())
    }
    /// põe na pilha os argumentos presos de uma função-valor e os da chamada
    fn push_call(&mut self, f: u32, args: &[Val]) -> usize {
        let bound = match self.h.get(f) {
            Obj::Func { bound: Some(b), .. } => b.clone(),
            _ => Vec::new(),
        };
        for &b in &bound {
            self.push(b);
        }
        for &a in args {
            self.push(a);
        }
        bound.len() + args.len()
    }
    fn func_parts(&self, f: u32) -> (usize, u32, usize) {
        match self.h.get(f) {
            Obj::Func { fidx, cells, bound, .. } => (*fidx as usize, if cells.is_some() { f } else { NONE }, bound.as_ref().map_or(0, |b| b.len())),
            _ => (0, NONE, 0),
        }
    }
    fn call_deferred(&mut self, d: (Val, Vec<Val>), ret: i64) -> R<()> {
        let Val::Obj(f) = d.0 else { return Ok(()) };
        let n = self.push_call(f, &d.1);
        let (fi, cl, _) = self.func_parts(f);
        self.enter_func(fi, n, cl, ret, true, ret == RET_PANIC)
    }
    /// volta para quem chamou, com os valores devolvidos
    fn do_return(&mut self, vals: Vec<Val>) -> R<Flow> {
        if self.cur.fr.top {
            return Ok(Flow::Vals(vals));
        }
        let g = &mut self.cur;
        let back = g.frames.pop().unwrap();
        let r = std::mem::replace(&mut g.fr, back);
        g.fp = r.fp;
        g.vtop = r.vtop;
        g.fidx = r.fidx;
        g.cl = r.cl;
        g.sp = r.sp;
        if r.ret >= 0 {
            g.pc = r.ret as usize;
        }
        if r.ret == RET_DLL {
            self.host_ret = vals.first().copied().unwrap_or(Val::Nil);
            return Ok(Flow::Dll);
        }
        if r.ret == RET_GOEND {
            return Ok(Flow::GoEnd);
        }
        if !r.discard {
            for v in vals {
                self.push(v);
            }
        }
        if r.ret == RET_DEFER {
            return self.ret_flow();
        }
        if r.ret == RET_PANIC {
            if self.cur.panic.as_ref().map_or(false, |p| p.recovered) {
                self.cur.panic = None;
                let fidx = self.cur.fidx;
                let mut pending = vec![Val::Nil];
                let mut named = None;
                if fidx >= 0 {
                    let f = &self.p.funcs[fidx as usize];
                    if !f.rz.is_empty() {
                        pending = f.rz.clone().into_iter().map(|t| self.zero_of(t)).collect();
                    }
                    if f.named > 0 {
                        named = Some((f.nparams as usize, f.named as usize));
                    }
                }
                let fr = &mut self.cur.fr;
                fr.returning = true;
                fr.pending = pending;
                if named.is_some() {
                    fr.named = named;
                }
                return self.ret_flow();
            }
            return self.unwind();
        }
        Ok(Flow::Null)
    }
    /// quadro em modo "devolvendo": roda os defers que faltam (do último para o primeiro) e então volta
    fn ret_flow(&mut self) -> R<Flow> {
        if let Some(d) = self.cur.fr.defers.pop() {
            self.call_deferred(d, RET_DEFER)?;
            return Ok(Flow::Null);
        }
        let vals = if let Some((base, n)) = self.cur.fr.named {
            (0..n)
                .map(|i| {
                    let v = self.cur.l[self.cur.fp + base + i];
                    match v {
                        Val::Obj(c) => match self.h.get(c) {
                            Obj::Cell(x) => *x,
                            _ => v,
                        },
                        _ => v,
                    }
                })
                .collect()
        } else {
            std::mem::take(&mut self.cur.fr.pending)
        };
        self.do_return(vals)
    }
    /// panic: sobe pelos quadros rodando os defers; um recover() num defer faz a função voltar normalmente
    fn unwind(&mut self) -> R<Flow> {
        loop {
            if let Some(d) = self.cur.fr.defers.pop() {
                self.call_deferred(d, RET_PANIC)?;
                return Ok(Flow::Null);
            }
            if self.cur.fr.top || self.cur.fr.ret == RET_DLL {
                let p = self.cur.panic.as_ref().unwrap();
                return Err(VmErr { stage: STAGE_EXEC, msg: p.msg.clone(), loc: p.loc, fatal: true });
            }
            let g = &mut self.cur;
            let back = g.frames.pop().unwrap();
            let r = std::mem::replace(&mut g.fr, back);
            g.fp = r.fp;
            g.vtop = r.vtop;
            g.fidx = r.fidx;
            g.cl = r.cl;
            g.sp = r.sp;
            if r.ret >= 0 {
                g.pc = r.ret as usize;
            }
            if r.ret == RET_DEFER || r.ret == RET_PANIC {
                // o panic aconteceu dentro de um defer: o quadro de baixo continua desfazendo
                g.fr.returning = false;
            }
        }
    }
    fn start_panic(&mut self, e: VmErr, value: Val) -> R<Flow> {
        if e.fatal {
            return Err(e);
        }
        self.cur.panic = Some(Panic { msg: e.msg, loc: e.loc, value, recovered: false });
        self.unwind()
    }
    /// fim do programa, fim de goroutine ou volta de chamada da DLL
    fn after_return(&mut self, r: Flow) -> R<Option<End>> {
        match r {
            Flow::Null => Ok(None),
            Flow::Dll => Ok(Some(End::Dll)),
            Flow::GoEnd => {
                self.schedule()?;
                Ok(None)
            }
            Flow::Vals(_) => {
                if self.cur.id != 0 {
                    self.schedule()?;
                    Ok(None)
                } else {
                    Ok(Some(End::Finished))
                }
            }
        }
    }

    // ---------------------------------------------------------------- coleções
    fn field_at(&self, o: Val, k: i32) -> R<(u32, usize)> {
        if o.is_nil() {
            return Err(self.err(format!("Acesso ao campo \"{}\" por um ponteiro nil", self.ctext(k))));
        }
        let o = self.unbox(o);
        let Some(i) = self.struct_id(o) else {
            return Err(self.err(format!("Só structs têm campos, e este valor é {}", self.type_name(o))));
        };
        let Obj::Struct { s, .. } = self.h.get(i) else { unreachable!() };
        let st = &self.p.stypes[*s as usize];
        match st.keys.iter().position(|&x| x as i32 == k) {
            Some(f) => Ok((i, f)),
            None => Err(self.err(format!("struct {} não tem o campo \"{}\"", st.name, self.ctext(k)))),
        }
    }
    fn field(&self, o: u32, f: usize) -> Val {
        match self.h.get(o) {
            Obj::Struct { f: fs, .. } => fs[f],
            _ => Val::Nil,
        }
    }
    fn check_index(&self, i: Val, n: usize, what: &str) -> R<usize> {
        let i = self.unbox(i);
        let Val::Num(x) = i else {
            return Err(self.err(format!("O índice precisa ser um inteiro, e não {}", self.type_name(i))));
        };
        if !is_int(x) {
            return Err(self.err(format!("O índice precisa ser um inteiro, e não {}", self.type_name(i))));
        }
        if x < 0.0 || x >= n as f64 {
            return Err(self.err(format!("Índice {} fora {} de tamanho {}", num_str(x), what, n)));
        }
        Ok(x as usize)
    }
    fn back(&self, a: u32) -> &Vec<Val> {
        match self.h.get(a) {
            Obj::Back(b) => b,
            _ => unreachable!(),
        }
    }
    fn back_mut(&mut self, a: u32) -> &mut Vec<Val> {
        match self.h.get_mut(a) {
            Obj::Back(b) => b,
            _ => unreachable!(),
        }
    }
    fn len_of(&self, v: Val) -> R<f64> {
        let v = self.unbox(v);
        Ok(match v {
            Val::Nil | Val::Unset => 0.0,
            Val::Str(i) => self.h.s(i).len() as f64,
            Val::Obj(i) => match self.h.get(i) {
                Obj::Slice { len, .. } => *len as f64,
                Obj::Arr { a, .. } => self.back(*a).len() as f64,
                Obj::Map(m) => m.len() as f64,
                Obj::Chan(c) => c.buf.len() as f64,
                _ => return Err(self.err(format!("len não funciona com {}", self.type_name(v)))),
            },
            _ => return Err(self.err(format!("len não funciona com {}", self.type_name(v)))),
        })
    }
    fn grow_cap(old: usize, need: usize) -> usize {
        if need > 2 * old {
            return need;
        }
        if old < 256 {
            return (2 * old).max(need);
        }
        let mut c = old;
        while c < need {
            c += (c + 768) / 4;
        }
        c
    }
    fn append_to(&mut self, s: Val, t: i32, vals: &[Val]) -> R<Val> {
        let (st, a, off, len, cap) = match s {
            Val::Nil | Val::Unset => (t, NONE, 0, 0, 0),
            Val::Obj(i) => match self.h.get(i) {
                Obj::Slice { t, a, off, len, cap } => (*t, *a, *off, *len, *cap),
                _ => return Err(self.err(format!("append precisa de um slice, e não de {}", self.type_name(s)))),
            },
            _ => return Err(self.err(format!("append precisa de um slice, e não de {}", self.type_name(s)))),
        };
        let n = len + vals.len();
        if n <= cap {
            let b = self.back_mut(a);
            for (k, &v) in vals.iter().enumerate() {
                b[off + len + k] = v;
            }
            return Ok(self.alloc(Obj::Slice { t: st, a, off, len: n, cap }));
        }
        let nc = Self::grow_cap(cap, n);
        let mut b: Vec<Val> = Vec::with_capacity(nc);
        if a != NONE {
            b.extend_from_slice(&self.back(a)[off..off + len]);
        }
        b.extend_from_slice(vals);
        let el = if st >= 0 && (st as usize) < self.p.rtypes.len() { self.p.rtypes[st as usize].elem } else { -1 };
        let z = self.zero_of(el);
        let fresh = matches!(z, Val::Obj(_));
        for _ in n..nc {
            let v = if fresh { self.zero_of(el) } else { z };
            b.push(v);
        }
        let a = self.h.alloc(Obj::Back(b));
        Ok(self.alloc(Obj::Slice { t: st, a, off: 0, len: n, cap: nc }))
    }
    fn slice_vals(&self, v: Val) -> R<Vec<Val>> {
        let v = self.unbox(v);
        match v {
            Val::Nil | Val::Unset => Ok(Vec::new()),
            Val::Str(i) => Ok(self.h.s(i).bytes().map(|b| Val::Num(b as f64)).collect()),
            Val::Obj(i) => match self.h.get(i) {
                Obj::Slice { a, off, len, .. } => Ok(self.back(*a)[*off..off + len].to_vec()),
                _ => Err(self.err(format!("Esperava um slice, e não {}", self.type_name(v)))),
            },
            _ => Err(self.err(format!("Esperava um slice, e não {}", self.type_name(v)))),
        }
    }
    fn method_of(&self, recv: Val, k: i32) -> R<(u32, &'static Meth)> {
        let p: &'static Prog = self.p;
        let o = self.unbox(recv);
        let Some(i) = self.struct_id(o) else {
            return Err(self.err(format!("Só structs têm métodos, e este valor é {}", self.type_name(o))));
        };
        let Obj::Struct { s, .. } = self.h.get(i) else { unreachable!() };
        let st = &p.stypes[*s as usize];
        match st.methods.iter().find(|m| m.key as i32 == k) {
            Some(m) => Ok((i, m)),
            None => Err(self.err(format!("struct {} não tem o método \"{}\"", st.name, self.ctext(k)))),
        }
    }
    /// segue o caminho de structs embutidas até o receptor do método promovido
    fn walk_path(&self, mut recv: Val, path: &[u32]) -> R<Val> {
        for &k in path {
            let (o, f) = self.field_at(recv, k as i32)?;
            recv = self.field(o, f);
        }
        Ok(recv)
    }

    // ---------------------------------------------------------------- execução
    pub fn tx_begin(&mut self) {
        self.count = 0.0;
    }
    /// prepara a chamada de uma função vinda de fora (DLL): quando ela voltar, run termina
    pub fn push_host_call(&mut self, fi: usize, args: &[Val]) -> R<()> {
        for &a in args {
            self.push(a);
        }
        self.enter_func(fi, args.len(), NONE, RET_DLL, false, false)
    }
    pub fn snapshot_main(&self) -> (usize, usize, Frame, usize, usize, i32, u32, usize) {
        let g = &self.cur;
        (g.sp, g.frames.len(), g.fr.clone(), g.fp, g.vtop, g.fidx, g.cl, g.pc)
    }
    pub fn restore_main(&mut self, s: (usize, usize, Frame, usize, usize, i32, u32, usize)) {
        if self.cur.id != 0 {
            if self.cur.id != usize::MAX {
                self.save();
            }
            if let Some(g) = self.gs[0].take() {
                self.cur = g;
            }
        }
        let g = &mut self.cur;
        g.sp = s.0;
        g.frames.truncate(s.1);
        g.fr = s.2;
        g.fp = s.3;
        g.vtop = s.4;
        g.fidx = s.5;
        g.cl = s.6;
        g.pc = s.7;
        g.panic = None;
    }

    pub fn gc(&mut self) {
        let mut work: Vec<u32> = Vec::new();
        let h = &mut self.h;
        h.mark_vals(&self.p.consts, &mut work);
        h.mark_vals(&self.g, &mut work);
        h.mark_val(self.host_ret, &mut work);
        h.mark_val(self.empty, &mut work);
        let mark_g = |h: &mut Heap, g: &Gor, work: &mut Vec<u32>| {
            h.mark_vals(&g.stack[..g.sp.min(g.stack.len())], work);
            h.mark_vals(&g.l[..g.vtop.min(g.l.len())], work);
            for f in g.frames.iter().chain(std::iter::once(&g.fr)) {
                h.mark_id(f.cl, work);
                for (fv, args) in &f.defers {
                    h.mark_val(*fv, work);
                    h.mark_vals(args, work);
                }
                h.mark_vals(&f.pending, work);
            }
            h.mark_id(g.cl, work);
            if let Some(p) = &g.panic {
                h.mark_val(p.value, work);
            }
        };
        mark_g(h, &self.cur, &mut work);
        for g in self.gs.iter().flatten() {
            mark_g(h, g, &mut work);
        }
        h.trace(&mut work);
        h.sweep();
    }

    /// Roda até o fim do programa, ou até a chamada vinda de fora (DLL) voltar
    pub fn run(&mut self) -> R<End> {
        loop {
            let pause = self.count + PAUSE_EVERY;
            match self.chunk(pause) {
                Ok(Some(e)) => return Ok(e),
                Ok(None) => {}
                Err(e) => {
                    if e.fatal {
                        return Err(e);
                    }
                    // erro ao rodar = panic: sobe pelos quadros rodando os defers, como no Go
                    let v = self.alloc(Obj::Err(e.msg.clone().into_boxed_str()));
                    let r = self.start_panic(e, v)?;
                    if let Some(end) = self.after_return(r)? {
                        return Ok(end);
                    }
                    continue;
                }
            }
            if self.count > MAX_INSTR {
                return Err(self.fatal("O programa passou de 200 milhões de instruções sem terminar. Parece um laço infinito".into()));
            }
        }
    }

    fn chunk(&mut self, pause: f64) -> R<Option<End>> {
        let p: &'static Prog = self.p;
        let code = &p.code[..];
        while self.count < pause {
            self.count += 1.0;
            let pc = self.cur.pc;
            self.ip = pc;
            self.slice -= 1;
            if self.slice == 0 {
                self.slice = GO_SLICE;
                if !self.runq.is_empty() {
                    let id = self.cur.id;
                    self.cur.ip = self.ip;
                    self.save();
                    self.runq.push_back(id);
                    let nx = self.runq.pop_front().unwrap();
                    self.load(nx);
                    continue;
                }
            }
            if self.h.due() {
                self.gc();
            }
            if self.cur.sp + 16 >= self.cur.stack.len() {
                let n = self.cur.stack.len() * 2;
                self.cur.stack.resize(n, Val::Nil);
            }
            let c = |k: usize| code[pc + k];
            let op = code[pc];
            match op {
                0 => {
                    // HALT
                    self.cur.fr.returning = true;
                    self.cur.fr.pending = Vec::new();
                    match self.ret_flow()? {
                        Flow::Null => {}
                        _ => return Ok(Some(End::Finished)),
                    }
                }
                1 => {
                    self.push(p.consts[c(1) as usize]);
                    self.cur.pc += 2;
                }
                2 => {
                    let v = self.get(c(1))?;
                    self.push(v);
                    self.cur.pc += 2;
                }
                3 => {
                    let v = self.pop();
                    self.setv(c(1), v);
                    self.cur.pc += 2;
                }
                4 => {
                    let s = c(1);
                    if let Val::Unset = self.raw(s) {
                        return Err(self.err(format!("A variável \"{}\" ainda não existe. Use let na primeira vez", self.name_of(s))));
                    }
                    let v = self.pop();
                    self.setv(s, v);
                    self.cur.pc += 2;
                }
                5 => {
                    self.cur.sp -= 1;
                    self.cur.pc += 1;
                }
                6 => {
                    let b = self.pop();
                    let a = self.top();
                    let r = if let (Val::Num(x), Val::Num(y)) = (a, b) {
                        Val::Num(x + y)
                    } else {
                        let r = self.binop(0, a, b)?;
                        r
                    };
                    self.set_top(r);
                    self.cur.pc += 1;
                }
                7..=11 => {
                    let b = self.pop();
                    let a = self.top();
                    let r = self.calc((op - 6) as usize, a, b)?;
                    self.set_top(r);
                    self.cur.pc += 1;
                }
                12 => {
                    let v = self.unbox(self.top());
                    let Val::Num(x) = v else { return Err(self.err("Só dá para negar números".into())) };
                    self.set_top(Val::Num(-x));
                    self.cur.pc += 1;
                }
                13 | 14 => {
                    let b = self.pop();
                    let e = self.val_eq(self.top(), b);
                    self.set_top(Val::Bool(if op == 13 { e } else { !e }));
                    self.cur.pc += 1;
                }
                15..=18 => {
                    let b = self.pop();
                    let a = self.top();
                    let r = self.calc((op - 7) as usize, a, b)?;
                    self.set_top(r);
                    self.cur.pc += 1;
                }
                19 => {
                    let v = !truthy(self.top());
                    self.set_top(Val::Bool(v));
                    self.cur.pc += 1;
                }
                20 => {
                    let v = truthy(self.top());
                    self.set_top(Val::Bool(v));
                    self.cur.pc += 1;
                }
                21 => self.cur.pc = c(1) as usize,
                22 => {
                    let v = self.pop();
                    self.cur.pc = if truthy(v) { pc + 2 } else { c(1) as usize };
                }
                23 => {
                    let v = self.pop();
                    self.cur.pc = if truthy(v) { c(1) as usize } else { pc + 2 };
                }
                24 | 37 => {
                    let (f, n) = (c(1), c(2) as usize);
                    let args = self.take(n);
                    self.cur.pc += 3;
                    match f {
                        0 => {
                            let mut text = String::new();
                            for (k, a) in args.iter().enumerate() {
                                if k > 0 {
                                    text.push(' ');
                                }
                                self.fmt(*a, false, &mut text);
                            }
                            self.print(text);
                            if op == 24 {
                                self.push(Val::Nil);
                            }
                        }
                        1 => {
                            // sleep: a goroutine dorme e as outras continuam
                            let s = self.unbox(args[0]);
                            let Val::Num(s) = s else { return Err(self.err("sleep espera um número de segundos, como sleep(1)".into())) };
                            if !(0.0..=30.0).contains(&s) {
                                return Err(self.err("sleep aceita de 0 a 30 segundos".into()));
                            }
                            if op == 24 {
                                self.push(Val::Nil);
                            }
                            self.cur.wake = self.clock + s * 1000.0;
                            self.cur.seq = self.sleep_seq;
                            self.sleep_seq += 1;
                            let id = self.park();
                            self.sleepers.push(id);
                            self.schedule()?;
                        }
                        _ => {
                            let args: Vec<Val> = args.iter().map(|&a| self.unbox(a)).collect();
                            let r = (self.mem)(self, f as usize, &args)?;
                            if op == 24 {
                                self.push(r);
                            }
                        }
                    }
                }
                25 => {
                    let b = c(1);
                    let to = self.upop();
                    let from = self.upop();
                    let (Val::Num(f), Val::Num(t)) = (from, to) else { return Err(self.err("O for precisa de números no início e no fim".into())) };
                    self.setv(b, Val::Num(f));
                    self.setv(if b < 0 { b - 1 } else { b + 1 }, Val::Num(t));
                    self.setv(if b < 0 { b - 2 } else { b + 2 }, Val::Num(if f <= t { 1.0 } else { -1.0 }));
                    self.cur.pc += 2;
                }
                26 => {
                    let b = c(1);
                    let n = |v: Val| if let Val::Num(x) = v { x } else { f64::NAN };
                    let (cv, e, st) = (n(self.raw(b)), n(self.raw(if b < 0 { b - 1 } else { b + 1 })), n(self.raw(if b < 0 { b - 2 } else { b + 2 })));
                    if if st > 0.0 { cv <= e } else { cv >= e } {
                        self.setv(c(2), Val::Num(cv));
                        self.cur.pc += 4;
                    } else {
                        self.cur.pc = c(3) as usize;
                    }
                }
                27 => {
                    let b = c(1);
                    let n = |v: Val| if let Val::Num(x) = v { x } else { f64::NAN };
                    let v = n(self.raw(b)) + n(self.raw(if b < 0 { b - 2 } else { b + 2 }));
                    self.setv(b, Val::Num(v));
                    self.cur.pc += 2;
                }
                28 => {
                    let r = self.calc(c(1) as usize, self.top(), p.consts[c(2) as usize])?;
                    self.set_top(r);
                    self.cur.pc += 3;
                }
                29 => {
                    let a = self.get(c(1))?;
                    let r = self.calc(c(2) as usize, a, p.consts[c(3) as usize])?;
                    self.push(r);
                    self.cur.pc += 4;
                }
                30 => {
                    let a = self.get(c(1))?;
                    let b = self.get(c(2))?;
                    let r = self.calc(c(3) as usize, a, b)?;
                    self.push(r);
                    self.cur.pc += 4;
                }
                31 => {
                    let s = c(1);
                    let a = self.get(s)?;
                    let r = self.calc(c(2) as usize, a, p.consts[c(3) as usize])?;
                    self.setv(s, r);
                    self.cur.pc += 4;
                }
                32 => {
                    let s = c(1);
                    let a = self.get(s)?;
                    let b = self.get(c(3))?;
                    let r = self.calc(c(2) as usize, a, b)?;
                    self.setv(s, r);
                    self.cur.pc += 4;
                }
                33 | 34 => {
                    let y = self.pop();
                    let x = self.pop();
                    let t = truthy(self.calc(c(1) as usize, x, y)?);
                    self.cur.pc = if t == (op == 33) { pc + 3 } else { c(2) as usize };
                }
                35 | 36 => {
                    let x = self.pop();
                    let t = truthy(self.calc(c(1) as usize, x, p.consts[c(2) as usize])?);
                    self.cur.pc = if t == (op == 35) { pc + 4 } else { c(3) as usize };
                }
                38 => {
                    let b = c(1);
                    let b2 = if b < 0 { b - 2 } else { b + 2 };
                    let n = |v: Val| if let Val::Num(x) = v { x } else { f64::NAN };
                    let st = n(self.raw(b2));
                    let cv = n(self.raw(b)) + st;
                    self.setv(b, Val::Num(cv));
                    let e = n(self.raw(if b < 0 { b - 1 } else { b + 1 }));
                    if if st > 0.0 { cv <= e } else { cv >= e } {
                        self.setv(c(2), Val::Num(cv));
                        self.cur.pc = c(3) as usize;
                    } else {
                        self.cur.pc += 4;
                    }
                }
                39 => self.enter_func(c(4) as usize, c(2) as usize, NONE, (pc + 5) as i64, false, false)?,
                40 | 41 | 60 => {
                    if !self.cur.fr.returning {
                        let pending = match op {
                            40 => vec![self.pop()],
                            41 => vec![Val::Nil],
                            _ => self.take(c(1) as usize),
                        };
                        self.cur.fr.returning = true;
                        self.cur.fr.pending = pending;
                    }
                    let r = self.ret_flow()?;
                    if let Some(e) = self.after_return(r)? {
                        return Ok(Some(e));
                    }
                }
                61 => {
                    if !self.cur.fr.returning {
                        self.cur.fr.returning = true;
                        self.cur.fr.named = Some((c(1) as usize, c(2) as usize));
                    }
                    let r = self.ret_flow()?;
                    if let Some(e) = self.after_return(r)? {
                        return Ok(Some(e));
                    }
                }
                42 => {
                    let (e, n) = (c(1) as usize, c(2) as usize);
                    let args: Vec<Val> = self.take(n).into_iter().map(|a| self.unbox(a)).collect();
                    self.cur.pc += 3;
                    let r = (self.ffi)(self, e, &args)?;
                    self.push(r);
                }
                43 => {
                    let s = c(1) as u32;
                    let n = p.stypes[s as usize].keys.len();
                    let f = self.take(n);
                    let v = self.alloc(Obj::Struct { s, f });
                    self.push(v);
                    self.cur.pc += 2;
                }
                44 => {
                    let (o, f) = self.field_at(self.top(), c(1))?;
                    let v = self.field(o, f);
                    self.set_top(v);
                    self.cur.pc += 2;
                }
                45 => {
                    let v = self.pop();
                    let o = self.pop();
                    let (o, f) = self.field_at(o, c(1))?;
                    if let Obj::Struct { f: fs, .. } = self.h.get_mut(o) {
                        fs[f] = v;
                    }
                    self.cur.pc += 2;
                }
                46 => {
                    let (k, n) = (c(1), c(2) as usize);
                    let at = self.cur.sp - n - 1;
                    let recv = self.cur.stack[at];
                    if recv.is_nil() {
                        return Err(self.err(format!("Chamada do método \"{}\" num valor nil", self.ctext(k))));
                    }
                    if let Val::Obj(i) = recv {
                        if let Obj::Err(m) = self.h.get(i) {
                            if k as i64 == p.error_key && n == 0 {
                                let m = m.to_string();
                                let s = self.new_str(m);
                                self.set_top(s);
                                self.cur.pc += 3;
                                continue;
                            }
                        }
                    }
                    let (o, m) = self.method_of(recv, k)?;
                    let f = &p.funcs[m.fidx as usize];
                    if f.nparams as usize != n + 1 {
                        return Err(self.err(format!("O método {} espera {}, mas recebeu {}", self.ctext(k), plural(f.nparams as i64 - 1, "argumento"), n)));
                    }
                    let mut r = self.walk_path(Val::Obj(o), &m.path)?;
                    if !m.ptr {
                        r = self.copy_val(r); // receptor por valor: o método recebe uma cópia
                    }
                    self.cur.stack[at] = r;
                    self.enter_func(m.fidx as usize, n + 1, NONE, (pc + 3) as i64, false, false)?;
                }
                47 => {
                    let v = self.copy_val(self.top());
                    self.set_top(v);
                    self.cur.pc += 1;
                }
                48 => {
                    let a = c(1);
                    let (o, k) = (a >> 4, a & 15);
                    let r = if o == 11 {
                        self.int_op(11, k, self.top(), Val::Num(0.0))?
                    } else {
                        let y = self.pop();
                        self.int_op(o, k, self.top(), y)?
                    };
                    self.set_top(r);
                    self.cur.pc += 2;
                }
                49 => {
                    let v = self.unbox(self.top());
                    let Val::Num(x) = v else {
                        return Err(self.err(format!("Só números podem ser convertidos em número, e este valor é {}", self.type_name(v))));
                    };
                    self.set_top(Val::Num(conv_num(x, c(1))));
                    self.cur.pc += 2;
                }
                50 => {
                    let (fi, n) = (c(1) as usize, c(2) as usize);
                    let cells = if n > 0 { Some(self.take(n)) } else { None };
                    let v = self.alloc(Obj::Func { t: p.funcs[fi].tid, fidx: fi as u32, cells, bound: None });
                    self.push(v);
                    self.cur.pc += 3;
                }
                51 => {
                    let (n, want) = (c(1) as usize, c(2) as u32);
                    let fv = self.unbox(self.cur.stack[self.cur.sp - n - 1]);
                    if fv.is_nil() {
                        return Err(self.err("Chamada de uma função nil".into()));
                    }
                    let f = match fv {
                        Val::Obj(i) if matches!(self.h.get(i), Obj::Func { .. }) => i,
                        _ => return Err(self.err(format!("Só funções podem ser chamadas, e este valor é {}", self.type_name(fv)))),
                    };
                    let (fi, cl, nb) = self.func_parts(f);
                    let fd = &p.funcs[fi];
                    let total = nb + n;
                    if fd.nparams as usize != total {
                        return Err(self.err(format!("A função espera {}, mas recebeu {}", plural(fd.nparams as i64 - nb as i64, "argumento"), n)));
                    }
                    if fd.nres != want && want > 1 {
                        return Err(self.err(format!("A função devolve {} valores, mas {} eram esperados", fd.nres, want)));
                    }
                    let args = self.take(n);
                    self.cur.sp -= 1;
                    self.push_call(f, &args);
                    self.enter_func(fi, total, cl, (pc + 3) as i64, false, false)?;
                }
                52 => {
                    let v = self.get(c(1))?;
                    let v = self.cell_val(v);
                    self.push(v);
                    self.cur.pc += 2;
                }
                53 => {
                    let s = c(1);
                    let cv = self.raw(s);
                    if let Val::Unset = cv {
                        return Err(self.err(format!("A variável \"{}\" ainda não existe. Use let na primeira vez", self.name_of(s))));
                    }
                    let v = self.pop();
                    if !self.set_cell(cv, v) {
                        let nc = self.alloc(Obj::Cell(v));
                        self.setv(s, nc);
                    }
                    self.cur.pc += 2;
                }
                54 => {
                    let v = self.pop();
                    let nc = self.alloc(Obj::Cell(v));
                    self.setv(c(1), nc);
                    self.cur.pc += 2;
                }
                55 => {
                    let s = c(1);
                    let mut cv = self.raw(s);
                    if !self.is_cell(cv) {
                        let init = if let Val::Unset = cv { Val::Nil } else { cv };
                        cv = self.alloc(Obj::Cell(init));
                        self.setv(s, cv);
                    }
                    self.push(cv);
                    self.cur.pc += 2;
                }
                56 => {
                    let cell = self.up(c(1) as usize);
                    let v = self.cell_val(cell);
                    self.push(v);
                    self.cur.pc += 2;
                }
                57 => {
                    let cell = self.up(c(1) as usize);
                    let v = self.pop();
                    self.set_cell(cell, v);
                    self.cur.pc += 2;
                }
                58 => {
                    let cell = self.up(c(1) as usize);
                    self.push(cell);
                    self.cur.pc += 2;
                }
                59 => {
                    let s = c(1);
                    let cv = self.raw(s);
                    if self.is_cell(cv) {
                        let v = self.cell_val(cv);
                        let nc = self.alloc(Obj::Cell(v));
                        self.setv(s, nc);
                    }
                    self.cur.pc += 2;
                }
                62 | 63 => {
                    let n = c(1) as usize;
                    let fv = self.unbox(self.cur.stack[self.cur.sp - n - 1]);
                    let args = self.take(n);
                    self.cur.sp -= 1;
                    let f = match fv {
                        Val::Obj(i) if matches!(self.h.get(i), Obj::Func { .. }) => i,
                        _ => return Err(self.err("defer e go precisam de uma função".into())),
                    };
                    if op == 62 {
                        self.cur.fr.defers.push((fv, args));
                        self.cur.pc += 2;
                        continue;
                    }
                    // nova goroutine: começa na função, com os argumentos já avaliados
                    let id = self.gs.len();
                    self.gs.push(None);
                    let mut ng = Gor::new(id);
                    let (fi, cl, _) = self.func_parts(f);
                    let mut all = match self.h.get(f) {
                        Obj::Func { bound: Some(b), .. } => b.clone(),
                        _ => Vec::new(),
                    };
                    all.extend(args);
                    let nl = p.funcs[fi].nlocals as usize;
                    ng.l = (0..nl.max(1) * 2 + 16).map(|k| if k < nl && k < all.len() { all[k] } else { Val::Unset }).collect();
                    ng.vtop = nl;
                    ng.fidx = fi as i32;
                    ng.cl = cl;
                    ng.pc = p.funcs[fi].entry as usize;
                    self.gs[id] = Some(ng);
                    self.runq.push_back(id);
                    self.cur.pc += 2;
                }
                64 => {
                    let v = self.pop();
                    self.cur.pc += 1;
                    let e = self.err(format!("panic: {}", self.fmt_string(v)));
                    self.start_panic(e, v)?;
                }
                65 => {
                    let rec = self.cur.fr.deferred && self.cur.panic.as_ref().map_or(false, |p| !p.recovered);
                    if rec {
                        let pn = self.cur.panic.as_mut().unwrap();
                        pn.recovered = true;
                        let v = pn.value;
                        self.push(v);
                    } else {
                        self.push(Val::Nil);
                    }
                    self.cur.pc += 1;
                }
                66 => {
                    let (t, n) = (c(1), c(2) as usize);
                    let b = self.take(n);
                    let a = self.h.alloc(Obj::Back(b));
                    let v = self.alloc(Obj::Slice { t, a, off: 0, len: n, cap: n });
                    self.push(v);
                    self.cur.pc += 3;
                }
                67 => {
                    let (t, n) = (c(1), c(2) as usize);
                    let b = self.take(n);
                    let a = self.h.alloc(Obj::Back(b));
                    let deep = self.value_kind(p.rtypes[t as usize].elem);
                    let v = self.alloc(Obj::Arr { t, a, deep });
                    self.push(v);
                    self.cur.pc += 3;
                }
                68 => {
                    let (t, n) = (c(1), c(2) as usize);
                    let kv = self.take(2 * n);
                    let mut m = MapObj::new(t);
                    for i in 0..n {
                        let k = self.unbox(kv[2 * i]);
                        m.set(self.map_key(k), k, kv[2 * i + 1]);
                    }
                    let v = self.alloc(Obj::Map(Box::new(m)));
                    self.push(v);
                    self.cur.pc += 3;
                }
                69 => {
                    let (t, n) = (c(1), c(2) as usize);
                    let r = &p.rtypes[t as usize];
                    let args: Vec<Val> = self.take(n).into_iter().map(|a| self.unbox(a)).collect();
                    let mut nums = Vec::new();
                    for &a in &args {
                        match a {
                            Val::Num(x) if is_int(x) && x >= 0.0 => nums.push(x),
                            _ => return Err(self.err(format!("Tamanho inválido no make: {}", self.fmt_string(a)))),
                        }
                    }
                    let v = if r.k == K_SLICE {
                        let len = nums[0];
                        let cap = if n > 1 { nums[1] } else { len };
                        if cap < len {
                            return Err(self.err(format!("make: a capacidade ({}) é menor que o tamanho ({})", num_str(cap), num_str(len))));
                        }
                        if cap > 100_000_000.0 {
                            return Err(self.err("make: tamanho grande demais".into()));
                        }
                        let el = r.elem;
                        let b: Vec<Val> = (0..cap as usize).map(|_| self.zero_of(el)).collect();
                        let a = self.h.alloc(Obj::Back(b));
                        self.alloc(Obj::Slice { t, a, off: 0, len: len as usize, cap: cap as usize })
                    } else if r.k == K_MAP {
                        self.alloc(Obj::Map(Box::new(MapObj::new(t))))
                    } else {
                        let cap = if n > 0 { nums[0] } else { 0.0 };
                        self.alloc(Obj::Chan(Box::new(ChanObj { t, cap, buf: VecDeque::new(), closed: false, recvq: VecDeque::new(), sendq: VecDeque::new() })))
                    };
                    self.push(v);
                    self.cur.pc += 3;
                }
                70 => {
                    let v = self.zero_of(c(1));
                    self.push(v);
                    self.cur.pc += 2;
                }
                71 | 72 => {
                    let i = self.pop();
                    let o = self.unbox(self.top());
                    let z = c(1);
                    let is_map = matches!(o, Val::Obj(x) if matches!(self.h.get(x), Obj::Map(_)));
                    if is_map || (o.is_nil() && (z >= 0 || op == 72)) {
                        let k = self.map_key(i);
                        let (got, vt) = match o {
                            Val::Obj(x) => match self.h.get(x) {
                                Obj::Map(m) => (m.get(&k), p.rtypes[m.t as usize].val),
                                _ => unreachable!(),
                            },
                            _ => (None, z),
                        };
                        let has = got.is_some();
                        let v = match got {
                            Some(v) => v,
                            None => self.zero_of(vt),
                        };
                        self.set_top(v);
                        if op == 72 {
                            self.push(Val::Bool(has));
                        }
                    } else {
                        let v = match o {
                            Val::Str(s) => {
                                let b = self.h.s(s).as_bytes();
                                let k = self.check_index(i, b.len(), "do texto")?;
                                Val::Num(self.h.s(s).as_bytes()[k] as f64)
                            }
                            Val::Nil | Val::Unset => {
                                let iv = self.unbox(i);
                                return Err(self.err(format!("Índice {} num slice nil", self.fmt_string(iv))));
                            }
                            Val::Obj(x) => match *self.h.get(x) {
                                Obj::Slice { a, off, len, .. } => {
                                    let k = self.check_index(i, len, "do slice")?;
                                    self.back(a)[off + k]
                                }
                                Obj::Arr { a, .. } => {
                                    let k = self.check_index(i, self.back(a).len(), "do array")?;
                                    self.back(a)[k]
                                }
                                _ => return Err(self.err(format!("Só dá para usar [ ] com slices, arrays, maps e textos, e este valor é {}", self.type_name(o)))),
                            },
                            _ => return Err(self.err(format!("Só dá para usar [ ] com slices, arrays, maps e textos, e este valor é {}", self.type_name(o)))),
                        };
                        self.set_top(v);
                    }
                    self.cur.pc += 2;
                }
                73 => {
                    let v = self.pop();
                    let i = self.pop();
                    let o = self.upop();
                    match o {
                        Val::Nil | Val::Unset => return Err(self.err("Atribuição num map ou slice nil".into())),
                        Val::Obj(x) => match self.h.get(x) {
                            Obj::Map(_) => {
                                let ku = self.unbox(i);
                                let k = self.map_key(ku);
                                if let Obj::Map(m) = self.h.get_mut(x) {
                                    m.set(k, ku, v);
                                }
                            }
                            &Obj::Slice { a, off, len, .. } => {
                                let k = self.check_index(i, len, "do slice")?;
                                self.back_mut(a)[off + k] = v;
                            }
                            &Obj::Arr { a, .. } => {
                                let k = self.check_index(i, self.back(a).len(), "do array")?;
                                self.back_mut(a)[k] = v;
                            }
                            _ => return Err(self.err(format!("Só dá para atribuir com [ ] em slices, arrays e maps, e este valor é {}", self.type_name(o)))),
                        },
                        _ => return Err(self.err(format!("Só dá para atribuir com [ ] em slices, arrays e maps, e este valor é {}", self.type_name(o)))),
                    }
                    self.cur.pc += 1;
                }
                74 => self.op_slice(c(1), c(2))?,
                75 => {
                    let n = self.len_of(self.top())?;
                    self.set_top(Val::Num(n));
                    self.cur.pc += 1;
                }
                76 => {
                    let o = self.unbox(self.top());
                    let n = match o {
                        Val::Nil => 0.0,
                        Val::Obj(x) => match self.h.get(x) {
                            Obj::Slice { cap, .. } => *cap as f64,
                            Obj::Arr { a, .. } => self.back(*a).len() as f64,
                            Obj::Chan(ch) => ch.cap,
                            _ => return Err(self.err(format!("cap não funciona com {}", self.type_name(o)))),
                        },
                        _ => return Err(self.err(format!("cap não funciona com {}", self.type_name(o)))),
                    };
                    self.set_top(Val::Num(n));
                    self.cur.pc += 1;
                }
                77 => {
                    let (t, n) = (c(1), c(2) as usize);
                    let vals = self.take(n);
                    let s = self.unbox(self.top());
                    let r = self.append_to(s, t, &vals)?;
                    self.set_top(r);
                    self.cur.pc += 3;
                }
                78 => {
                    let v = self.pop();
                    let more = self.slice_vals(v)?;
                    let s = self.unbox(self.top());
                    let r = self.append_to(s, c(1), &more)?;
                    self.set_top(r);
                    self.cur.pc += 2;
                }
                79 => {
                    let v = self.pop();
                    let src = self.slice_vals(v)?;
                    let d = self.unbox(self.top());
                    if let Val::Nil = d {
                        self.set_top(Val::Num(0.0));
                        self.cur.pc += 1;
                        continue;
                    }
                    let (a, off, len) = match d {
                        Val::Obj(x) => match *self.h.get(x) {
                            Obj::Slice { a, off, len, .. } => (a, off, len),
                            _ => return Err(self.err(format!("copy precisa de um slice de destino, e não de {}", self.type_name(d)))),
                        },
                        _ => return Err(self.err(format!("copy precisa de um slice de destino, e não de {}", self.type_name(d)))),
                    };
                    let n = len.min(src.len());
                    for k in 0..n {
                        let cv = self.copy_val(src[k]);
                        self.back_mut(a)[off + k] = cv;
                    }
                    self.set_top(Val::Num(n as f64));
                    self.cur.pc += 1;
                }
                80 => {
                    let k = self.pop();
                    let m = self.unbox(self.top());
                    match m {
                        Val::Obj(x) if matches!(self.h.get(x), Obj::Map(_)) => {
                            let key = self.map_key(k);
                            if let Obj::Map(mm) = self.h.get_mut(x) {
                                mm.delete(&key);
                            }
                        }
                        Val::Nil => {}
                        _ => return Err(self.err(format!("delete precisa de um map, e não de {}", self.type_name(m)))),
                    }
                    self.set_top(Val::Nil);
                    self.cur.pc += 1;
                }
                81 => {
                    let o = self.unbox(self.top());
                    let it = match o {
                        Val::Nil | Val::Unset => It::Nil,
                        Val::Num(n) => It::Int { n, i: 0.0 },
                        Val::Str(s) => It::Str { s, b: 0 },
                        Val::Obj(x) => match self.h.get(x) {
                            Obj::Slice { .. } => It::Slice { o: x, i: 0 },
                            Obj::Arr { .. } => It::Arr { o: x, i: 0 },
                            Obj::Map(m) => It::Map { o: x, keys: m.ents.iter().flatten().map(|(k, _)| self.map_key(*k)).collect(), i: 0 },
                            Obj::Chan(_) => It::Chan { o: x, pending: None },
                            _ => return Err(self.err(format!("range não percorre {}", self.type_name(o)))),
                        },
                        _ => return Err(self.err(format!("range não percorre {}", self.type_name(o)))),
                    };
                    let v = self.alloc(Obj::Iter(Box::new(it)));
                    self.set_top(v);
                    self.cur.pc += 1;
                }
                82 => self.op_iter_next(c(1) as usize)?,
                83 => {
                    let v = self.alloc(Obj::Ptr(PtrK::Global(c(1) as u32)));
                    self.push(v);
                    self.cur.pc += 2;
                }
                84 => {
                    let (o, f) = self.field_at(self.top(), c(1))?;
                    let v = self.alloc(Obj::Ptr(PtrK::Field(o, f as u32)));
                    self.set_top(v);
                    self.cur.pc += 2;
                }
                85 => {
                    let i = self.pop();
                    let o = self.unbox(self.top());
                    let pk = match o {
                        Val::Obj(x) => match *self.h.get(x) {
                            Obj::Slice { a, off, len, .. } => PtrK::Elem(a, off + self.check_index(i, len, "do slice")?),
                            Obj::Arr { a, .. } => PtrK::Elem(a, self.check_index(i, self.back(a).len(), "do array")?),
                            _ => return Err(self.err(format!("Não dá para pegar o endereço de um elemento de {}", self.type_name(o)))),
                        },
                        _ => return Err(self.err(format!("Não dá para pegar o endereço de um elemento de {}", self.type_name(o)))),
                    };
                    let v = self.alloc(Obj::Ptr(pk));
                    self.set_top(v);
                    self.cur.pc += 1;
                }
                86 => {
                    let cell = self.h.alloc(Obj::Cell(self.top()));
                    let v = self.alloc(Obj::Ptr(PtrK::Cell(cell)));
                    self.set_top(v);
                    self.cur.pc += 1;
                }
                87 => {
                    let t = self.top();
                    if let Val::Obj(cell) = t {
                        let v = self.alloc(Obj::Ptr(PtrK::Cell(cell)));
                        self.set_top(v);
                    }
                    self.cur.pc += 1;
                }
                88 => {
                    let pv = self.unbox(self.top());
                    if pv.is_nil() {
                        return Err(self.err("Ponteiro nil: não aponta para nada".into()));
                    }
                    if let Val::Obj(x) = pv {
                        if let Obj::Ptr(pk) = *self.h.get(x) {
                            let v = self.ptr_get(pk);
                            self.set_top(v);
                            self.cur.pc += 1;
                            continue;
                        }
                    }
                    if !self.is_struct_or_arr(pv) {
                        return Err(self.err(format!("Só ponteiros podem ser seguidos com *, e este valor é {}", self.type_name(pv))));
                    }
                    self.cur.pc += 1;
                }
                89 => {
                    let v = self.pop();
                    let pv = self.upop();
                    if pv.is_nil() {
                        return Err(self.err("Ponteiro nil: não aponta para nada".into()));
                    }
                    match pv {
                        Val::Obj(x) if matches!(self.h.get(x), Obj::Ptr(_)) => {
                            let Obj::Ptr(pk) = *self.h.get(x) else { unreachable!() };
                            self.ptr_set(pk, v);
                        }
                        _ => self.copy_into(pv, v),
                    }
                    self.cur.pc += 1;
                }
                90 => {
                    let src = self.pop();
                    let dst = self.pop();
                    if dst.is_nil() {
                        return Err(self.err("Ponteiro nil: não aponta para nada".into()));
                    }
                    self.copy_into(dst, src);
                    self.cur.pc += 1;
                }
                91 => {
                    let t = c(1);
                    let v = self.top();
                    let r = &p.rtypes[t as usize];
                    let is_box = matches!(v, Val::Obj(x) if matches!(self.h.get(x), Obj::Boxed { .. }));
                    let num_key = r.k == K_NUM && r.nk == 11;
                    let int_val = matches!(v, Val::Num(x) if is_int(x));
                    if !(matches!(v, Val::Nil) || is_box || (num_key && !int_val)) {
                        let b = self.alloc(Obj::Boxed { t, v });
                        self.set_top(b);
                    }
                    self.cur.pc += 2;
                }
                92 | 93 => {
                    let t = c(1);
                    let v = self.top();
                    let ok = self.type_is(v, t);
                    let r = &p.rtypes[t as usize];
                    let keep = r.k == K_IFACE || r.k == K_ANY;
                    if op == 92 {
                        if !ok {
                            return Err(self.err(format!("x.({}): o valor guardado é {}, não {}", r.name, self.dyn_name(v), r.name)));
                        }
                        let nv = if keep { v } else { self.unbox(v) };
                        self.set_top(nv);
                    } else {
                        let nv = if ok {
                            if keep {
                                v
                            } else {
                                self.unbox(v)
                            }
                        } else {
                            self.zero_of(t)
                        };
                        self.set_top(nv);
                        self.push(Val::Bool(ok));
                    }
                    self.cur.pc += 2;
                }
                94 => {
                    let ok = self.type_is(self.top(), c(1));
                    self.set_top(Val::Bool(ok));
                    self.cur.pc += 2;
                }
                95 => {
                    let v = self.top();
                    self.push(v);
                    self.cur.pc += 1;
                }
                96 => {
                    let (a, b) = (self.cur.stack[self.cur.sp - 2], self.cur.stack[self.cur.sp - 1]);
                    self.push(a);
                    self.push(b);
                    self.cur.pc += 1;
                }
                97 => {
                    let v = self.pop();
                    let chv = self.pop();
                    let ch = self.chan_of(chv, "O envio")?;
                    self.cur.pc += 1;
                    let Some(ch) = ch else {
                        // canal nil: bloqueia para sempre
                        self.park();
                        self.schedule()?;
                        continue;
                    };
                    if self.try_send(ch, v)? {
                        continue;
                    }
                    let id = self.park();
                    self.chan(ch).sendq.push_back(SendW { g: id, v, sel: None, idx: 0 });
                    self.schedule()?;
                }
                98 | 99 => {
                    let ok_form = op == 99;
                    let chv = self.pop();
                    let ch = self.chan_of(chv, "O recebimento")?;
                    self.cur.pc += 1;
                    let Some(ch) = ch else {
                        self.park();
                        self.schedule()?;
                        continue;
                    };
                    if let Some((v, ok)) = self.try_recv(ch) {
                        self.push(v);
                        if ok_form {
                            self.push(Val::Bool(ok));
                        }
                        continue;
                    }
                    let id = self.park();
                    self.chan(ch).recvq.push_back(RecvW { g: id, sel: None, idx: 0, it: NONE, ok: ok_form });
                    self.schedule()?;
                }
                100 => {
                    let ch = self.chan_of(self.top(), "close")?;
                    let Some(ch) = ch else { return Err(self.err("close de um canal nil".into())) };
                    if self.chan(ch).closed {
                        return Err(self.err("close de um canal já fechado".into()));
                    }
                    self.chan(ch).closed = true;
                    let el = p.rtypes[self.chan(ch).t as usize].elem;
                    let z = self.zero_of(el);
                    while let Some(r) = self.chan(ch).recvq.pop_front() {
                        if let Some(s) = &r.sel {
                            if s.get() {
                                continue;
                            }
                            s.set(true);
                            self.wake_with(r.g, &[z, Val::Bool(false), Val::Num(r.idx as f64)]);
                        } else if r.it != NONE {
                            self.set_pending(r.it, z, false);
                            self.runq.push_back(r.g);
                        } else if r.ok {
                            self.wake_with(r.g, &[z, Val::Bool(false)]);
                        } else {
                            self.wake_with(r.g, &[z]);
                        }
                    }
                    while let Some(s) = self.chan(ch).sendq.pop_front() {
                        if let Some(sel) = &s.sel {
                            if sel.get() {
                                continue;
                            }
                            sel.set(true);
                        }
                        self.gor_mut(s.g).wake_err = Some("Envio num canal fechado".into());
                        self.runq.push_back(s.g);
                    }
                    self.set_top(Val::Nil);
                    self.cur.pc += 1;
                }
                101 => self.op_select(c(1) as usize, c(2), c(3) != 0)?,
                102 => {
                    let k = c(1);
                    let recv = self.top();
                    if recv.is_nil() {
                        return Err(self.err(format!("Método \"{}\" de um valor nil", self.ctext(k))));
                    }
                    let (o, m) = self.method_of(recv, k)?;
                    let mut r = self.walk_path(Val::Obj(o), &m.path)?;
                    if !m.ptr {
                        r = self.copy_val(r);
                    }
                    let v = self.alloc(Obj::Func { t: p.funcs[m.fidx as usize].tid, fidx: m.fidx, cells: None, bound: Some(vec![r]) });
                    self.set_top(v);
                    self.cur.pc += 2;
                }
                103 => {
                    let fi = c(1) as usize;
                    let v = self.alloc(Obj::Func { t: p.funcs[fi].tid, fidx: fi as u32, cells: None, bound: Some(vec![self.top()]) });
                    self.set_top(v);
                    self.cur.pc += 2;
                }
                104 => self.op_sconv(c(1), c(2))?,
                105 => {
                    let m = self.fmt_string(self.top());
                    let v = self.alloc(Obj::Err(m.into_boxed_str()));
                    self.set_top(v);
                    self.cur.pc += 1;
                }
                _ => return Err(self.err(format!("Instrução desconhecida {}", op))),
            }
        }
        Ok(None)
    }

    fn print(&mut self, text: String) {
        crate::native::emit_line(&text);
    }
    fn is_cell(&self, v: Val) -> bool {
        matches!(v, Val::Obj(i) if matches!(self.h.get(i), Obj::Cell(_)))
    }
    fn cell_val(&self, v: Val) -> Val {
        if let Val::Obj(i) = v {
            if let Obj::Cell(x) = self.h.get(i) {
                return *x;
            }
        }
        v
    }
    fn set_cell(&mut self, c: Val, v: Val) -> bool {
        if let Val::Obj(i) = c {
            if let Obj::Cell(x) = self.h.get_mut(i) {
                *x = v;
                return true;
            }
        }
        false
    }
    fn up(&self, k: usize) -> Val {
        match self.h.get(self.cur.cl) {
            Obj::Func { cells: Some(c), .. } => c[k],
            _ => Val::Nil,
        }
    }

    fn op_slice(&mut self, fl: i32, st: i32) -> R<()> {
        let hi = if fl & 2 != 0 { Some(self.upop()) } else { None };
        let lo = if fl & 1 != 0 { self.upop() } else { Val::Num(0.0) };
        let o = self.unbox(self.top());
        let (n, len, cap_txt) = match o {
            Val::Str(s) => {
                let n = self.h.s(s).len();
                (n, n, String::new())
            }
            Val::Nil => (0, 0, String::new()),
            Val::Obj(x) => match self.h.get(x) {
                Obj::Slice { len, cap, .. } => (*cap, *len, format!(", capacidade {}", cap)),
                Obj::Arr { a, .. } => {
                    let n = self.back(*a).len();
                    (n, n, String::new())
                }
                _ => return Err(self.err(format!("Só dá para fatiar slices, arrays e textos, e este valor é {}", self.type_name(o)))),
            },
            _ => return Err(self.err(format!("Só dá para fatiar slices, arrays e textos, e este valor é {}", self.type_name(o)))),
        };
        let h = match hi {
            None | Some(Val::Nil) => Val::Num(len as f64),
            Some(v) => v,
        };
        let (lo, h) = match (lo, h) {
            (Val::Num(a), Val::Num(b)) if is_int(a) && is_int(b) => (a, b),
            _ => return Err(self.err("Os limites da fatia precisam ser inteiros".into())),
        };
        if lo < 0.0 || h < lo || h > n as f64 {
            return Err(self.err(format!("Fatia [{}:{}] fora dos limites (tamanho {}{})", num_str(lo), num_str(h), len, cap_txt)));
        }
        let (lo, h) = (lo as usize, h as usize);
        let r = match o {
            Val::Str(s) => {
                let t = String::from_utf8_lossy(&self.h.s(s).as_bytes()[lo..h]).into_owned();
                let v = self.new_str(t);
                v
            }
            Val::Nil => Val::Nil,
            Val::Obj(x) => match *self.h.get(x) {
                Obj::Slice { t, a, off, cap, .. } => self.alloc(Obj::Slice { t, a, off: off + lo, len: h - lo, cap: cap - lo }),
                Obj::Arr { a, .. } => self.alloc(Obj::Slice { t: st, a, off: lo, len: h - lo, cap: n - lo }),
                _ => unreachable!(),
            },
            _ => unreachable!(),
        };
        self.set_top(r);
        self.cur.pc += 3;
        Ok(())
    }

    fn op_iter_next(&mut self, target: usize) -> R<()> {
        let itv = self.pop();
        let Val::Obj(itid) = itv else { return Err(self.err("range sem iterador".into())) };
        let pc = self.cur.pc;
        enum Step {
            Done,
            Push(Val, Val),
            Recv(u32),
        }
        // o iterador sai do heap enquanto anda, para ler o objeto percorrido sem conflito
        let mut itb = match std::mem::replace(self.h.get_mut(itid), Obj::Free) {
            Obj::Iter(b) => b,
            o => {
                *self.h.get_mut(itid) = o;
                return Err(self.err("range sem iterador".into()));
            }
        };
        let step = {
            let hr: &Heap = &self.h;
            let it: &mut It = &mut itb;
            match it {
                It::Nil => Step::Done,
                It::Int { n, i } => {
                    if *i < *n {
                        let v = *i;
                        *i += 1.0;
                        Step::Push(Val::Num(v), Val::Nil)
                    } else {
                        Step::Done
                    }
                }
                It::Slice { o, i } => match hr.get(*o) {
                    Obj::Slice { a, off, len, .. } => {
                        if *i < *len {
                            let v = match hr.get(*a) {
                                Obj::Back(b) => b[off + *i],
                                _ => Val::Nil,
                            };
                            let k = *i;
                            *i += 1;
                            Step::Push(Val::Num(k as f64), v)
                        } else {
                            Step::Done
                        }
                    }
                    _ => Step::Done,
                },
                It::Arr { o, i } => match hr.get(*o) {
                    Obj::Arr { a, .. } => match hr.get(*a) {
                        Obj::Back(b) if *i < b.len() => {
                            let k = *i;
                            *i += 1;
                            Step::Push(Val::Num(k as f64), b[k])
                        }
                        _ => Step::Done,
                    },
                    _ => Step::Done,
                },
                It::Str { s, b } => {
                    let text = hr.s(*s);
                    if *b >= text.len() {
                        Step::Done
                    } else {
                        let ch = text[*b..].chars().next().unwrap();
                        let at = *b;
                        *b += ch.len_utf8();
                        Step::Push(Val::Num(at as f64), Val::Num(ch as u32 as f64))
                    }
                }
                It::Map { o, keys, i } => match hr.get(*o) {
                    Obj::Map(m) => {
                        while *i < keys.len() && !m.idx.contains_key(&keys[*i]) {
                            *i += 1;
                        }
                        if *i >= keys.len() {
                            Step::Done
                        } else {
                            let e = m.ents[m.idx[&keys[*i]]].unwrap();
                            *i += 1;
                            Step::Push(e.0, e.1)
                        }
                    }
                    _ => Step::Done,
                },
                It::Chan { o, pending } => match pending.take() {
                    Some((v, true)) => Step::Push(v, Val::Nil),
                    Some((_, false)) => Step::Done,
                    None => Step::Recv(*o),
                },
            }
        };
        *self.h.get_mut(itid) = Obj::Iter(itb);
        match step {
            Step::Done => self.cur.pc = target,
            Step::Push(a, b) => {
                self.push(a);
                self.push(b);
                self.cur.pc = pc + 2;
            }
            Step::Recv(ch) => match self.try_recv(ch) {
                Some((v, true)) => {
                    self.push(v);
                    self.push(Val::Nil);
                    self.cur.pc = pc + 2;
                }
                Some((_, false)) => self.cur.pc = target,
                None => {
                    // bloqueia; quem enviar acorda esta goroutine de volta neste mesmo ITER_NEXT
                    self.push(itv);
                    let id = self.park();
                    self.chan(ch).recvq.push_back(RecvW { g: id, sel: None, idx: 0, it: itid, ok: false });
                    self.schedule()?;
                }
            },
        }
        Ok(())
    }

    fn op_select(&mut self, n: usize, mask: i32, has_def: bool) -> R<()> {
        // na pilha: para cada case, o canal (e o valor, se for envio)
        let mut width = 0;
        for i in 0..n {
            width += if mask & (1 << i) != 0 { 2 } else { 1 };
        }
        let vals = self.take(width);
        let mut cs: Vec<(bool, Option<u32>, Val)> = Vec::new();
        let mut at = 0;
        for i in 0..n {
            let send = mask & (1 << i) != 0;
            let ch = self.chan_of(vals[at], "O select")?;
            at += 1;
            let v = if send {
                at += 1;
                vals[at - 1]
            } else {
                Val::Nil
            };
            cs.push((send, ch, v));
        }
        self.cur.pc += 4;
        for (i, &(send, ch, v)) in cs.iter().enumerate() {
            let Some(ch) = ch else { continue };
            if send {
                if self.chan(ch).closed {
                    return Err(self.err("Envio num canal fechado".into()));
                }
                if self.try_send(ch, v)? {
                    self.push(Val::Nil);
                    self.push(Val::Bool(false));
                    self.push(Val::Num(i as f64));
                    return Ok(());
                }
            } else if let Some((rv, ok)) = self.try_recv(ch) {
                self.push(rv);
                self.push(Val::Bool(ok));
                self.push(Val::Num(i as f64));
                return Ok(());
            }
        }
        if has_def {
            self.push(Val::Nil);
            self.push(Val::Bool(false));
            self.push(Val::Num(-1.0));
            return Ok(());
        }
        let id = self.park();
        let sel = Rc::new(StdCell::new(false));
        for (i, &(send, ch, v)) in cs.iter().enumerate() {
            let Some(ch) = ch else { continue };
            if send {
                self.chan(ch).sendq.push_back(SendW { g: id, v, sel: Some(sel.clone()), idx: i as i32 });
            } else {
                self.chan(ch).recvq.push_back(RecvW { g: id, sel: Some(sel.clone()), idx: i as i32, it: NONE, ok: true });
            }
        }
        self.schedule()
    }

    fn op_sconv(&mut self, mode: i32, t: i32) -> R<()> {
        let v = self.unbox(self.top());
        let r = match mode {
            0 => {
                let s = rune_text(v);
                self.new_str(s)
            }
            1 => {
                let bytes: Vec<u8> = self.slice_vals(v)?.into_iter().map(|b| if let Val::Num(x) = b { to_i32(x) as u8 } else { 0 }).collect();
                let s = String::from_utf8_lossy(&bytes).into_owned();
                self.new_str(s)
            }
            2 => {
                let s: String = self.slice_vals(v)?.into_iter().map(rune_text).collect();
                self.new_str(s)
            }
            _ => {
                let text = match v {
                    Val::Str(i) => self.h.s(i).to_string(),
                    _ => self.fmt_string(v),
                };
                let b: Vec<Val> = if mode == 3 { text.bytes().map(|x| Val::Num(x as f64)).collect() } else { text.chars().map(|c| Val::Num(c as u32 as f64)).collect() };
                let n = b.len();
                let a = self.h.alloc(Obj::Back(b));
                self.alloc(Obj::Slice { t, a, off: 0, len: n, cap: n })
            }
        };
        self.set_top(r);
        self.cur.pc += 3;
        Ok(())
    }
}
