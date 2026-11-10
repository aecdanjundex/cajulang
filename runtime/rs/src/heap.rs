//! Valores e memória da Caju.
//!
//! Um valor (Val) é pequeno e copiável: número, booleano, nil ou o número de um objeto
//! no heap. Textos, structs, slices, maps, closures, canais etc. moram no heap, que tem
//! um coletor de lixo de marcar e varrer. A coleta só acontece entre duas instruções,
//! quando todos os valores vivos estão nas raízes (globais, pilhas, variáveis, quadros).

use std::cell::Cell as StdCell;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;

pub const NONE: u32 = u32::MAX;

#[derive(Clone, Copy, Debug)]
pub enum Val {
    /// variável que ainda não recebeu valor
    Unset,
    Nil,
    Num(f64),
    Bool(bool),
    Str(u32),
    Obj(u32),
}
impl Val {
    #[inline]
    pub fn is_nil(self) -> bool {
        matches!(self, Val::Nil | Val::Unset)
    }
}

/// chave de map com a igualdade do Map do JavaScript (SameValueZero)
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum MKey {
    Num(u64),
    Str(Box<str>),
    Bool(bool),
    Nil,
    Obj(u32),
}

pub struct MapObj {
    pub t: i32,
    pub idx: HashMap<MKey, usize>,
    pub ents: Vec<Option<(Val, Val)>>,
    pub dead: usize,
}
impl MapObj {
    pub fn new(t: i32) -> Self {
        MapObj { t, idx: HashMap::new(), ents: Vec::new(), dead: 0 }
    }
    pub fn len(&self) -> usize {
        self.idx.len()
    }
    pub fn get(&self, k: &MKey) -> Option<Val> {
        self.idx.get(k).map(|&i| self.ents[i].unwrap().1)
    }
    pub fn set(&mut self, k: MKey, kv: Val, v: Val) {
        if let Some(&i) = self.idx.get(&k) {
            self.ents[i].as_mut().unwrap().1 = v;
        } else {
            self.idx.insert(k, self.ents.len());
            self.ents.push(Some((kv, v)));
        }
    }
    pub fn delete(&mut self, k: &MKey) {
        if let Some(i) = self.idx.remove(k) {
            self.ents[i] = None;
            self.dead += 1;
            if self.dead > 32 && self.dead * 2 > self.ents.len() {
                self.compact();
            }
        }
    }
    fn compact(&mut self) {
        let old = std::mem::take(&mut self.ents);
        let mut pos: HashMap<usize, usize> = HashMap::new();
        for (i, e) in old.into_iter().enumerate() {
            if let Some(e) = e {
                pos.insert(i, self.ents.len());
                self.ents.push(Some(e));
            }
        }
        for v in self.idx.values_mut() {
            *v = pos[v];
        }
        self.dead = 0;
    }
}

pub struct RecvW {
    pub g: usize,
    pub sel: Option<Rc<StdCell<bool>>>,
    pub idx: i32,
    /// iterador de range esperando neste canal
    pub it: u32,
    pub ok: bool,
}
pub struct SendW {
    pub g: usize,
    pub v: Val,
    pub sel: Option<Rc<StdCell<bool>>>,
    pub idx: i32,
}
pub struct ChanObj {
    pub t: i32,
    pub cap: f64,
    pub buf: VecDeque<Val>,
    pub closed: bool,
    pub recvq: VecDeque<RecvW>,
    pub sendq: VecDeque<SendW>,
}

pub enum It {
    Nil,
    Int { n: f64, i: f64 },
    Str { s: u32, b: usize },
    Slice { o: u32, i: usize },
    Arr { o: u32, i: usize },
    Map { o: u32, keys: Vec<MKey>, i: usize },
    Chan { o: u32, pending: Option<(Val, bool)> },
}

/// lugar apontado por um ponteiro que não é struct nem array
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PtrK {
    Global(u32),
    Field(u32, u32),
    Elem(u32, usize),
    Cell(u32),
}

pub enum Obj {
    Free,
    Str(Box<str>),
    /// struct: tipo (índice na tabela de structs) e campos
    Struct { s: u32, f: Vec<Val> },
    /// caixa: valor numa interface que leva o tipo junto (int8, num inteiro, *Ponto...)
    Boxed { t: i32, v: Val },
    /// slice: janela sobre um vetor compartilhado
    Slice { t: i32, a: u32, off: usize, len: usize, cap: usize },
    /// array de tamanho fixo: é um valor (copiado), como uma struct
    Arr { t: i32, a: u32, deep: bool },
    /// vetor por trás de slices e arrays
    Back(Vec<Val>),
    Map(Box<MapObj>),
    /// função como valor: a função, as células capturadas e argumentos já presos
    Func { t: i32, fidx: u32, cells: Option<Vec<Val>>, bound: Option<Vec<Val>> },
    Ptr(PtrK),
    Chan(Box<ChanObj>),
    Err(Box<str>),
    Cell(Val),
    Iter(Box<It>),
}

pub struct Heap {
    pub objs: Vec<Obj>,
    pub marks: Vec<bool>,
    free: Vec<u32>,
    pub since: usize,
    pub threshold: usize,
}

impl Heap {
    pub fn new() -> Self {
        Heap { objs: Vec::with_capacity(1 << 16), marks: Vec::with_capacity(1 << 16), free: Vec::new(), since: 0, threshold: 400_000 }
    }
    #[inline]
    pub fn alloc(&mut self, o: Obj) -> u32 {
        self.since += 1;
        if let Some(i) = self.free.pop() {
            self.objs[i as usize] = o;
            i
        } else {
            self.objs.push(o);
            self.marks.push(false);
            (self.objs.len() - 1) as u32
        }
    }
    #[inline]
    pub fn due(&self) -> bool {
        self.since >= self.threshold
    }
    #[inline]
    pub fn get(&self, i: u32) -> &Obj {
        &self.objs[i as usize]
    }
    #[inline]
    pub fn get_mut(&mut self, i: u32) -> &mut Obj {
        &mut self.objs[i as usize]
    }
    #[inline]
    pub fn s(&self, i: u32) -> &str {
        match &self.objs[i as usize] {
            Obj::Str(s) => s,
            _ => "",
        }
    }

    /// marca a partir de uma lista de valores; o resto da marcação usa uma pilha explícita
    pub fn mark_vals(&mut self, vals: &[Val], work: &mut Vec<u32>) {
        for &v in vals {
            self.mark_val(v, work);
        }
    }
    #[inline]
    pub fn mark_val(&mut self, v: Val, work: &mut Vec<u32>) {
        match v {
            Val::Str(i) | Val::Obj(i) => self.mark_id(i, work),
            _ => {}
        }
    }
    #[inline]
    pub fn mark_id(&mut self, i: u32, work: &mut Vec<u32>) {
        if i != NONE && !self.marks[i as usize] {
            self.marks[i as usize] = true;
            work.push(i);
        }
    }
    pub fn trace(&mut self, work: &mut Vec<u32>) {
        let mut kids: Vec<Val> = Vec::new();
        while let Some(i) = work.pop() {
            kids.clear();
            let mut ids: [u32; 3] = [NONE; 3];
            match &self.objs[i as usize] {
                Obj::Struct { f, .. } => kids.extend_from_slice(f),
                Obj::Boxed { v, .. } => kids.push(*v),
                Obj::Slice { a, .. } | Obj::Arr { a, .. } => ids[0] = *a,
                Obj::Back(a) => kids.extend_from_slice(a),
                Obj::Map(m) => {
                    for (k, v) in m.ents.iter().flatten() {
                        kids.push(*k);
                        kids.push(*v);
                    }
                }
                Obj::Func { cells, bound, .. } => {
                    if let Some(c) = cells {
                        kids.extend_from_slice(c);
                    }
                    if let Some(b) = bound {
                        kids.extend_from_slice(b);
                    }
                }
                Obj::Ptr(p) => match *p {
                    PtrK::Field(o, _) => ids[0] = o,
                    PtrK::Elem(o, _) => ids[0] = o,
                    PtrK::Cell(o) => ids[0] = o,
                    PtrK::Global(_) => {}
                },
                Obj::Chan(c) => {
                    kids.extend(c.buf.iter().copied());
                    for r in &c.recvq {
                        ids[1] = r.it;
                        if r.it != NONE {
                            kids.push(Val::Obj(r.it));
                        }
                    }
                    for s in &c.sendq {
                        kids.push(s.v);
                    }
                }
                Obj::Cell(v) => kids.push(*v),
                Obj::Iter(it) => match &**it {
                    It::Str { s, .. } => ids[0] = *s,
                    It::Slice { o, .. } | It::Arr { o, .. } | It::Map { o, .. } => ids[0] = *o,
                    It::Chan { o, pending } => {
                        ids[0] = *o;
                        if let Some((v, _)) = pending {
                            kids.push(*v);
                        }
                    }
                    _ => {}
                },
                Obj::Free | Obj::Str(_) | Obj::Err(_) => {}
            }
            for &id in &ids {
                self.mark_id(id, work);
            }
            let ks = std::mem::take(&mut kids);
            for &v in &ks {
                self.mark_val(v, work);
            }
            kids = ks;
        }
    }
    pub fn sweep(&mut self) {
        let mut live = 0;
        for i in 0..self.objs.len() {
            if self.marks[i] {
                self.marks[i] = false;
                live += 1;
            } else if !matches!(self.objs[i], Obj::Free) {
                self.objs[i] = Obj::Free;
                self.free.push(i as u32);
            }
        }
        self.since = 0;
        self.threshold = (live * 2).max(400_000);
    }
}
