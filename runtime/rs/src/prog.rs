//! Leitura do bytecode (versão 6) colado no fim do executável ou da DLL.

use crate::heap::{Heap, Obj, Val};

pub struct Func {
    pub name: String,
    pub entry: u32,
    pub nparams: u32,
    pub nlocals: u32,
    pub local_names: Vec<String>,
    pub nres: u32,
    pub tid: i32,
    pub named: u32,
    pub rz: Vec<i32>,
}
pub struct Meth {
    pub key: u32,
    pub fidx: u32,
    pub ptr: bool,
    pub vset: bool,
    pub path: Vec<u32>,
}
pub struct SType {
    pub name: String,
    pub keys: Vec<u32>,
    pub ftids: Vec<i32>,
    pub tid: i32,
    pub methods: Vec<Meth>,
    /// campos que são valores (struct ou array): copiados junto
    pub deep: Vec<bool>,
}
// tipos da tabela de tipos
pub const K_NUM: u8 = 1;
pub const K_STR: u8 = 2;
pub const K_BOOL: u8 = 3;
pub const K_ANY: u8 = 4;
pub const K_STRUCT: u8 = 6;
pub const K_IFACE: u8 = 7;
pub const K_SLICE: u8 = 8;
pub const K_ARRAY: u8 = 9;
pub const K_CHAN: u8 = 10;
pub const K_MAP: u8 = 12;
pub struct RType {
    pub k: u8,
    pub name: String,
    pub nk: i32,
    pub elem: i32,
    pub key: i32,
    pub val: i32,
    pub n: u32,
    pub sidx: i32,
    pub methods: Vec<u32>,
}
pub struct Ext {
    pub dll: String,
    pub sym: String,
    pub conv: u8,
    pub ret: u8,
    pub ptype: Vec<u8>,
    pub pname: Vec<String>,
    pub fp: std::cell::Cell<usize>,
}
pub struct Exp {
    pub name: String,
    pub fidx: u32,
    pub ret: u8,
    pub ptype: Vec<u8>,
    #[allow(dead_code)]
    pub pname: Vec<String>,
}

pub struct Prog {
    pub loc_base: u32,
    pub files: Vec<String>,
    pub consts: Vec<Val>,
    pub const_text: Vec<Option<String>>,
    pub slot_names: Vec<String>,
    pub funcs: Vec<Func>,
    pub exts: Vec<Ext>,
    pub exps: Vec<Exp>,
    pub stypes: Vec<SType>,
    pub rtypes: Vec<RType>,
    pub code: Vec<i32>,
    pub lines: Vec<i32>,
    pub error_key: i64,
    pub tid_int: i32,
    pub tid_num: i32,
    pub tid_str: i32,
    pub tid_bool: i32,
}

pub fn die(msg: &str) -> ! {
    eprintln!("caju: {}", msg);
    std::process::exit(3);
}

struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}
impl<'a> Reader<'a> {
    fn need(&self, n: usize) {
        if self.b.len() - self.p < n {
            die("bytecode corrompido ou incompleto");
        }
    }
    fn u8(&mut self) -> u8 {
        self.need(1);
        self.p += 1;
        self.b[self.p - 1]
    }
    fn u32(&mut self) -> u32 {
        self.need(4);
        let v = u32::from_le_bytes(self.b[self.p..self.p + 4].try_into().unwrap());
        self.p += 4;
        v
    }
    fn i32(&mut self) -> i32 {
        self.u32() as i32
    }
    fn f64(&mut self) -> f64 {
        self.need(8);
        let v = f64::from_le_bytes(self.b[self.p..self.p + 8].try_into().unwrap());
        self.p += 8;
        v
    }
    fn text(&mut self) -> String {
        let n = self.u32() as usize;
        self.need(n);
        let s = String::from_utf8_lossy(&self.b[self.p..self.p + n]).into_owned();
        self.p += n;
        s
    }
    fn count(&mut self) -> usize {
        let n = self.u32() as usize;
        if n > self.b.len() {
            die("bytecode corrompido ou incompleto");
        }
        n
    }
}

pub fn load(buf: &[u8], heap: &mut Heap) -> Prog {
    let mut r = Reader { b: buf, p: 0 };
    r.need(4);
    if &buf[0..4] != b"CAJU" {
        die("bytecode com assinatura inválida");
    }
    r.p = 4;
    if r.u32() != 6 {
        die("versão de bytecode não suportada por este runtime");
    }
    let loc_base = r.u32();
    let nf = r.count();
    let files = (0..nf).map(|_| r.text()).collect();
    let nc = r.count();
    let mut consts = Vec::with_capacity(nc);
    let mut const_text = Vec::with_capacity(nc);
    for _ in 0..nc {
        match r.u8() {
            1 => {
                consts.push(Val::Num(r.f64()));
                const_text.push(None)
            }
            2 => {
                let s = r.text();
                consts.push(Val::Str(heap.alloc(Obj::Str(s.clone().into_boxed_str()))));
                const_text.push(Some(s))
            }
            3 => {
                consts.push(Val::Bool(r.u8() != 0));
                const_text.push(None)
            }
            4 => {
                consts.push(Val::Nil);
                const_text.push(None)
            }
            _ => die("constante de tipo desconhecido no bytecode"),
        }
    }
    let ns = r.count();
    let slot_names = (0..ns).map(|_| r.text()).collect();
    let nfn = r.count();
    let mut funcs = Vec::with_capacity(nfn);
    for _ in 0..nfn {
        let name = r.text();
        let entry = r.u32();
        let nparams = r.u32();
        let nl = r.count();
        let local_names = (0..nl).map(|_| r.text()).collect();
        let nres = r.u32();
        let tid = r.i32();
        let named = r.u32();
        let nrz = r.count();
        let rz = (0..nrz).map(|_| r.i32()).collect();
        funcs.push(Func { name, entry, nparams, nlocals: nl as u32, local_names, nres, tid, named, rz });
    }
    let ne = r.count();
    let mut exts = Vec::with_capacity(ne);
    for _ in 0..ne {
        let dll = r.text();
        let sym = r.text();
        let conv = r.u8();
        let ret = r.u8();
        let np = r.u8() as usize;
        let mut ptype = Vec::new();
        let mut pname = Vec::new();
        for _ in 0..np {
            ptype.push(r.u8());
            pname.push(r.text());
        }
        exts.push(Ext { dll, sym, conv, ret, ptype, pname, fp: std::cell::Cell::new(0) });
    }
    let nx = r.count();
    let mut exps = Vec::with_capacity(nx);
    for _ in 0..nx {
        let name = r.text();
        let fidx = r.u32();
        let ret = r.u8();
        let np = r.u8() as usize;
        let mut ptype = Vec::new();
        let mut pname = Vec::new();
        for _ in 0..np {
            ptype.push(r.u8());
            pname.push(r.text());
        }
        if fidx as usize >= funcs.len() {
            die("exportação aponta para uma função que não existe");
        }
        exps.push(Exp { name, fidx, ret, ptype, pname });
    }
    let nst = r.count();
    let mut stypes = Vec::with_capacity(nst);
    for _ in 0..nst {
        let name = r.text();
        let nfl = r.count();
        let keys: Vec<u32> = (0..nfl).map(|_| r.u32()).collect();
        for &k in &keys {
            if k as usize >= nc || const_text[k as usize].is_none() {
                die("struct com campo inválido");
            }
        }
        let ftids: Vec<i32> = (0..nfl).map(|_| r.i32()).collect();
        let tid = r.i32();
        let nm = r.count();
        let mut methods = Vec::with_capacity(nm);
        for _ in 0..nm {
            let key = r.u32();
            let fidx = r.u32();
            let ptr = r.u8() != 0;
            let vset = r.u8() != 0;
            let np = r.count();
            let path = (0..np).map(|_| r.u32()).collect();
            if fidx as usize >= funcs.len() || key as usize >= nc {
                die("método aponta para uma função que não existe");
            }
            methods.push(Meth { key, fidx, ptr, vset, path });
        }
        stypes.push(SType { name, keys, ftids, tid, methods, deep: Vec::new() });
    }
    let nrt = r.count();
    let mut rtypes = Vec::with_capacity(nrt);
    for _ in 0..nrt {
        let k = r.u8();
        let name = r.text();
        let nk = r.i32();
        let elem = r.i32();
        let key = r.i32();
        let val = r.i32();
        let n = r.u32();
        let sidx = r.i32();
        let nm = r.count();
        let methods = (0..nm).map(|_| r.u32()).collect();
        rtypes.push(RType { k, name, nk, elem, key, val, n, sidx, methods });
    }
    let value_kind = |t: i32| t >= 0 && (t as usize) < rtypes.len() && matches!(rtypes[t as usize].k, K_STRUCT | K_ARRAY);
    for s in stypes.iter_mut() {
        s.deep = s.ftids.iter().map(|&t| value_kind(t)).collect();
    }
    let n = r.count();
    let code: Vec<i32> = (0..n).map(|_| r.i32()).collect();
    let lines: Vec<i32> = (0..n).map(|_| r.i32()).collect();
    let error_key = const_text.iter().position(|t| t.as_deref() == Some("Error")).map(|i| i as i64).unwrap_or(-1);
    let find = |f: &dyn Fn(&RType) -> bool| rtypes.iter().position(|r| f(r)).map(|i| i as i32).unwrap_or(-1);
    let tid_int = find(&|r| r.k == K_NUM && r.nk == 0);
    let tid_num = find(&|r| r.k == K_NUM && r.nk == 11);
    let tid_str = find(&|r| r.k == K_STR);
    let tid_bool = find(&|r| r.k == K_BOOL);
    Prog {
        loc_base,
        files,
        consts,
        const_text,
        slot_names,
        funcs,
        exts,
        exps,
        stypes,
        rtypes,
        code,
        lines,
        error_key,
        tid_int,
        tid_num,
        tid_str,
        tid_bool,
    }
}

/// Onde termina a parte "nossa" do arquivo: antes da assinatura Authenticode, se houver.
fn payload_end(b: &[u8]) -> usize {
    let len = b.len();
    let le32 = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as usize;
    if len < 0x40 || b[0] != b'M' || b[1] != b'Z' {
        return len;
    }
    let pe = le32(0x3C);
    if pe + 24 > len || &b[pe..pe + 4] != b"PE\0\0" {
        return len;
    }
    let opt = pe + 24;
    if opt + 2 > len {
        return len;
    }
    let magic = b[opt] as u32 | (b[opt + 1] as u32) << 8;
    let dirs = opt + if magic == 0x20b { 112 } else { 96 };
    if dirs + 5 * 8 > len {
        return len;
    }
    let (off, size) = (le32(dirs + 32), le32(dirs + 36));
    if off != 0 && size != 0 && off <= len {
        return off;
    }
    len
}
/// Acha o bytecode no fim do arquivo: [bytecode] [tamanho u32] ["CAJUEXE1"] [zeros]
pub fn find_payload(selfb: &[u8]) -> Option<&[u8]> {
    let mut end = payload_end(selfb);
    let mut pad = 0;
    while pad <= 8 && !(end >= pad + 12 && &selfb[end - pad - 8..end - pad] == b"CAJUEXE1") {
        pad += 1;
    }
    if pad > 8 {
        return None;
    }
    end -= pad;
    let plen = u32::from_le_bytes(selfb[end - 12..end - 8].try_into().unwrap()) as usize;
    if plen > end - 12 {
        die("tamanho do bytecode inválido");
    }
    Some(&selfb[end - 12 - plen..end - 12])
}
