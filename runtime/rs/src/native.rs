//! A parte do runtime que fala com o sistema: console, memória crua, funções de DLL
//! (FFI), o ponto de entrada do .exe e as transações da DLL.

use crate::heap::{Heap, Val};
use crate::num::*;
use crate::prog::*;
use crate::vm::*;
use std::ffi::{c_char, c_void, CStr};
use std::io::Write;

// tipos das funções externas, na mesma ordem da página
pub const F_VOID: u8 = 0;
pub const F_I32: u8 = 1;
pub const F_U32: u8 = 2;
pub const F_I64: u8 = 3;
pub const F_U64: u8 = 4;
pub const F_F32: u8 = 5;
pub const F_F64: u8 = 6;
pub const F_BOOL: u8 = 7;
pub const F_PTR: u8 = 8;
pub const F_STR: u8 = 9;
pub const F_WSTR: u8 = 10;
const BUILTIN_NAMES: [&str; 13] = ["print", "sleep", "alloc", "free", "peek8", "peek16", "peek32", "peek64", "poke8", "poke16", "poke32", "readstr", "readwstr"];

pub fn emit_line(s: &str) {
    let out = std::io::stdout();
    let mut o = out.lock();
    let _ = o.write_all(s.as_bytes());
    let _ = o.write_all(b"\n");
    let _ = o.flush();
}

#[cfg(windows)]
pub mod win {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        pub fn LoadLibraryA(name: *const u8) -> *mut c_void;
        pub fn GetProcAddress(h: *mut c_void, name: *const u8) -> *mut c_void;
        pub fn GetLastError() -> u32;
        pub fn GetModuleFileNameW(h: *mut c_void, buf: *mut u16, n: u32) -> u32;
        pub fn GetConsoleProcessList(ids: *mut u32, n: u32) -> u32;
        pub fn SetConsoleOutputCP(cp: u32) -> i32;
        #[allow(dead_code)]
        pub fn GetModuleHandleExW(flags: u32, name: *const u16, h: *mut *mut c_void) -> i32;
        #[allow(dead_code)]
        pub fn InitializeCriticalSection(cs: *mut c_void);
        #[allow(dead_code)]
        pub fn EnterCriticalSection(cs: *mut c_void);
        #[allow(dead_code)]
        pub fn LeaveCriticalSection(cs: *mut c_void);
    }
}

// ---------------------------------------------------------------------- texto em C
fn utf8_to_utf16z(s: &str) -> Vec<u16> {
    let mut w: Vec<u16> = s.encode_utf16().collect();
    w.push(0);
    w
}
unsafe fn utf16z_to_string(p: *const u16) -> String {
    let mut n = 0;
    while *p.add(n) != 0 {
        n += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
}
unsafe fn cstr_to_string(p: *const c_char) -> String {
    String::from_utf8_lossy(CStr::from_ptr(p).to_bytes()).into_owned()
}
fn to_u32(d: f64) -> u32 {
    if !d.is_finite() {
        return 0;
    }
    let mut d = d.trunc() % TWO32;
    if d < 0.0 {
        d += TWO32;
    }
    d as u32
}
fn to_u64(d: f64) -> u64 {
    if !d.is_finite() || d <= 0.0 {
        return if d < 0.0 && d.is_finite() { d.trunc() as i64 as u64 } else { 0 };
    }
    if d >= 1.8446744073709552e19 {
        u64::MAX
    } else {
        d as u64
    }
}
fn to_i64(d: f64) -> i64 {
    if !d.is_finite() {
        0
    } else if d >= 9.2e18 {
        i64::MAX
    } else if d <= -9.2e18 {
        i64::MIN
    } else {
        d.trunc() as i64
    }
}
fn num_arg(v: Val) -> f64 {
    match v {
        Val::Bool(b) => b as i32 as f64,
        Val::Num(x) => x,
        _ => 0.0,
    }
}
fn truthy(v: Val) -> bool {
    !matches!(v, Val::Bool(false) | Val::Nil | Val::Unset) && !matches!(v, Val::Num(x) if x == 0.0)
}

// ---------------------------------------------------------------------- memória
fn ptr_arg(vm: &Vm, v: Val, who: &str) -> R<*mut u8> {
    let Val::Num(p) = v else { return Err(vm.err(format!("{} espera um ponteiro", who))) };
    if p == 0.0 {
        return Err(vm.err(format!("Ponteiro nulo em {}", who)));
    }
    Ok(p as u64 as usize as *mut u8)
}
pub fn mem_builtin(vm: &mut Vm, f: usize, args: &[Val]) -> R<Val> {
    let who = BUILTIN_NAMES.get(f).copied().unwrap_or("?");
    let a0 = args.first().copied().unwrap_or(Val::Nil);
    unsafe {
        match f {
            2 => {
                let Val::Num(n) = a0 else { return Err(vm.err("alloc espera um número de bytes".into())) };
                if !(1.0..=268435456.0).contains(&n) {
                    return Err(vm.err("alloc aceita de 1 byte a 256 MB".into()));
                }
                let p = libc_calloc(n.floor() as usize);
                if p.is_null() {
                    return Err(vm.err(format!("Não há memória para alloc({:.0})", n)));
                }
                Ok(Val::Num(p as usize as f64))
            }
            3 => {
                match a0 {
                    Val::Nil => {}
                    Val::Num(x) if x == 0.0 => {}
                    Val::Num(x) => libc_free(x as u64 as usize as *mut c_void),
                    _ => return Err(vm.err("free espera um ponteiro".into())),
                }
                Ok(Val::Nil)
            }
            4 => Ok(Val::Num(*ptr_arg(vm, a0, who)? as f64)),
            5 => Ok(Val::Num((ptr_arg(vm, a0, who)? as *const u16).read_unaligned() as f64)),
            6 => Ok(Val::Num((ptr_arg(vm, a0, who)? as *const u32).read_unaligned() as f64)),
            7 => {
                let p = ptr_arg(vm, a0, who)? as *const u32;
                let (lo, hi) = (p.read_unaligned(), p.add(1).read_unaligned());
                Ok(Val::Num(lo as f64 + hi as f64 * TWO32))
            }
            8..=10 => {
                let p = ptr_arg(vm, a0, who)?;
                let mut v = args.get(1).copied().unwrap_or(Val::Nil);
                if let Val::Bool(b) = v {
                    v = Val::Num(b as i32 as f64);
                }
                let Val::Num(x) = v else { return Err(vm.err(format!("{} espera um número para gravar", who))) };
                let u = to_u32(x);
                match f {
                    8 => *p = u as u8,
                    9 => (p as *mut u16).write_unaligned(u as u16),
                    _ => (p as *mut u32).write_unaligned(u),
                }
                Ok(Val::Nil)
            }
            11 => {
                let s = cstr_to_string(ptr_arg(vm, a0, who)? as *const c_char);
                Ok(vm.new_str(s))
            }
            12 => {
                let s = utf16z_to_string(ptr_arg(vm, a0, who)? as *const u16);
                Ok(vm.new_str(s))
            }
            _ => Ok(Val::Nil),
        }
    }
}
extern "C" {
    #[link_name = "calloc"]
    fn c_calloc(n: usize, s: usize) -> *mut c_void;
    #[link_name = "free"]
    fn c_free(p: *mut c_void);
}
unsafe fn libc_calloc(n: usize) -> *mut c_void {
    c_calloc(n, 1)
}
unsafe fn libc_free(p: *mut c_void) {
    c_free(p)
}

// ---------------------------------------------------------------------- funções de DLL
#[cfg(feature = "ffitest")]
extern "C" {
    fn caju_ffi_test_lookup(name: *const c_char) -> *mut c_void;
}

fn resolve_ext(vm: &Vm, e: &Ext) -> R<usize> {
    if e.fp.get() != 0 {
        return Ok(e.fp.get());
    }
    #[cfg(windows)]
    unsafe {
        let dll = std::ffi::CString::new(e.dll.clone()).unwrap_or_default();
        let h = win::LoadLibraryA(dll.as_ptr() as *const u8);
        if h.is_null() {
            return Err(vm.err(format!("Não consegui carregar a DLL {} (erro {} do Windows)", e.dll, win::GetLastError())));
        }
        let sym = std::ffi::CString::new(e.sym.clone()).unwrap_or_default();
        let f = win::GetProcAddress(h, sym.as_ptr() as *const u8);
        if f.is_null() {
            return Err(vm.err(format!("A função {} não existe em {}", e.sym, e.dll)));
        }
        e.fp.set(f as usize);
        return Ok(f as usize);
    }
    #[cfg(all(not(windows), feature = "ffitest"))]
    unsafe {
        let sym = std::ffi::CString::new(e.sym.clone()).unwrap_or_default();
        let f = caju_ffi_test_lookup(sym.as_ptr());
        if f.is_null() {
            return Err(vm.err(format!("A função {} não existe em {}", e.sym, e.dll)));
        }
        e.fp.set(f as usize);
        return Ok(f as usize);
    }
    #[allow(unreachable_code)]
    Err(vm.err(format!("Chamadas a DLL só funcionam no Windows ({} em {})", e.sym, e.dll)))
}

/// Guarda os textos convertidos para C enquanto a chamada acontece
struct Temps {
    c: Vec<Vec<u8>>,
    w: Vec<Vec<u16>>,
}
impl Temps {
    fn cstr(&mut self, vm: &Vm, v: Val) -> usize {
        let mut b = vm.str_of(v).unwrap_or("").as_bytes().to_vec();
        b.push(0);
        let p = b.as_ptr() as usize;
        self.c.push(b);
        p
    }
    fn wstr(&mut self, vm: &Vm, v: Val) -> usize {
        let w = utf8_to_utf16z(vm.str_of(v).unwrap_or(""));
        let p = w.as_ptr() as usize;
        self.w.push(w);
        p
    }
}

#[cfg(target_arch = "x86_64")]
extern "win64" {
    /// caju-asm-x64.S: carrega os 4 primeiros argumentos em RCX, RDX, R8, R9 e XMM0–XMM3
    fn caju_ffi_x64(f: *const c_void, args: *const u64, n: u64, out: *mut u64);
}

#[cfg(target_arch = "x86")]
macro_rules! call_words {
    ($abi:literal, $R:ty, $f:expr, $w:expr) => {{
        let f: usize = $f;
        let w: &[u32] = $w;
        use std::mem::transmute as t;
        type W = u32;
        match w.len() {
            0 => t::<usize, extern $abi fn() -> $R>(f)(),
            1 => t::<usize, extern $abi fn(W) -> $R>(f)(w[0]),
            2 => t::<usize, extern $abi fn(W, W) -> $R>(f)(w[0], w[1]),
            3 => t::<usize, extern $abi fn(W, W, W) -> $R>(f)(w[0], w[1], w[2]),
            4 => t::<usize, extern $abi fn(W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3]),
            5 => t::<usize, extern $abi fn(W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4]),
            6 => t::<usize, extern $abi fn(W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5]),
            7 => t::<usize, extern $abi fn(W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6]),
            8 => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7]),
            9 => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8]),
            10 => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9]),
            11 => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10]),
            12 => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11]),
            13 => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11], w[12]),
            14 => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11], w[12], w[13]),
            15 => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11], w[12], w[13], w[14]),
            _ => t::<usize, extern $abi fn(W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W) -> $R>(f)(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11], w[12], w[13], w[14], w[15]),
        }
    }};
}

/// Ponteiro da VM durante uma chamada de DLL: a função chamada pode chamar de volta a nossa DLL
pub static mut VM_PTR: *mut Vm = std::ptr::null_mut();

pub fn call_ext(vm: &mut Vm, ei: usize, args: &[Val]) -> R<Val> {
    let e: &'static Ext = &vm.p.exts[ei];
    // mesma validação da página, com as mesmas mensagens
    for (i, &v) in args.iter().enumerate().take(e.ptype.len()) {
        let t = e.ptype[i];
        if t == F_STR || t == F_WSTR {
            if !matches!(v, Val::Str(_) | Val::Num(_) | Val::Nil) {
                return Err(vm.err(format!("O parâmetro \"{}\" de {} espera um texto ou um ponteiro", e.pname[i], e.sym)));
            }
        } else if t != F_BOOL && matches!(v, Val::Str(_)) {
            return Err(vm.err(format!("O parâmetro \"{}\" de {} espera um número", e.pname[i], e.sym)));
        }
    }
    let f = resolve_ext(vm, e)?;
    let mut tmp = Temps { c: Vec::new(), w: Vec::new() };
    let _ = std::io::stdout().flush(); // a função pode escrever no console ou abrir janelas
    unsafe {
        VM_PTR = vm as *mut Vm;
    }
    #[cfg(target_arch = "x86_64")]
    {
        let mut a = [0u64; 20];
        for (i, &v) in args.iter().enumerate().take(e.ptype.len()) {
            a[i] = match e.ptype[i] {
                F_I32 | F_U32 => to_u32(num_arg(v)) as u64,
                F_PTR => to_u64(num_arg(v)),
                F_BOOL => truthy(v) as u64,
                F_I64 | F_U64 => to_i64(num_arg(v)) as u64,
                F_F64 => num_arg(v).to_bits(),
                F_F32 => (num_arg(v) as f32).to_bits() as u64,
                F_STR => {
                    if matches!(v, Val::Str(_)) {
                        tmp.cstr(vm, v) as u64
                    } else {
                        to_u64(num_arg(v))
                    }
                }
                _ => {
                    if matches!(v, Val::Str(_)) {
                        tmp.wstr(vm, v) as u64
                    } else {
                        to_u64(num_arg(v))
                    }
                }
            };
        }
        let mut out = [0u64; 2];
        unsafe { caju_ffi_x64(f as *const c_void, a.as_ptr(), e.ptype.len() as u64, out.as_mut_ptr()) };
        drop(tmp);
        let r = match e.ret {
            F_VOID => Val::Nil,
            F_I32 => Val::Num(out[0] as u32 as i32 as f64),
            F_U32 => Val::Num(out[0] as u32 as f64),
            F_BOOL => Val::Bool(out[0] as u32 != 0),
            F_I64 => Val::Num(out[0] as i64 as f64),
            F_U64 | F_PTR => Val::Num(out[0] as f64),
            F_F64 => Val::Num(f64::from_bits(out[1])),
            F_F32 => Val::Num(f32::from_bits(out[1] as u32) as f64),
            F_STR => {
                if out[0] == 0 {
                    Val::Nil
                } else {
                    let s = unsafe { cstr_to_string(out[0] as usize as *const c_char) };
                    vm.new_str(s)
                }
            }
            _ => {
                if out[0] == 0 {
                    Val::Nil
                } else {
                    let s = unsafe { utf16z_to_string(out[0] as usize as *const u16) };
                    vm.new_str(s)
                }
            }
        };
        return Ok(r);
    }
    #[cfg(target_arch = "x86")]
    {
        // Em x86 todos os argumentos vão na pilha em palavras de 32 bits, tanto em stdcall
        // quanto em cdecl. O tipo de retorno escolhe o registrador lido: EAX, EDX:EAX ou ST0.
        let mut w: Vec<u32> = Vec::new();
        for (i, &v) in args.iter().enumerate().take(e.ptype.len()) {
            match e.ptype[i] {
                F_I32 | F_U32 | F_PTR => w.push(to_u32(num_arg(v))),
                F_BOOL => w.push(truthy(v) as u32),
                F_I64 | F_U64 => {
                    let u = to_i64(num_arg(v)) as u64;
                    w.push(u as u32);
                    w.push((u >> 32) as u32);
                }
                F_F64 => {
                    let u = num_arg(v).to_bits();
                    w.push(u as u32);
                    w.push((u >> 32) as u32);
                }
                F_F32 => w.push((num_arg(v) as f32).to_bits()),
                F_STR => w.push(if matches!(v, Val::Str(_)) { tmp.cstr(vm, v) as u32 } else { to_u32(num_arg(v)) }),
                _ => w.push(if matches!(v, Val::Str(_)) { tmp.wstr(vm, v) as u32 } else { to_u32(num_arg(v)) }),
            }
        }
        let cd = e.conv == 1;
        let r = unsafe {
            match e.ret {
                F_I64 | F_U64 => {
                    let u: u64 = if cd { call_words!("cdecl", u64, f, &w) } else { call_words!("stdcall", u64, f, &w) };
                    Val::Num(if e.ret == F_I64 { u as i64 as f64 } else { u as f64 })
                }
                F_F64 => Val::Num(if cd { call_words!("cdecl", f64, f, &w) } else { call_words!("stdcall", f64, f, &w) }),
                F_F32 => Val::Num((if cd { call_words!("cdecl", f32, f, &w) } else { call_words!("stdcall", f32, f, &w) }) as f64),
                ret => {
                    let u: u32 = if cd { call_words!("cdecl", u32, f, &w) } else { call_words!("stdcall", u32, f, &w) };
                    match ret {
                        F_VOID => Val::Nil,
                        F_I32 => Val::Num(u as i32 as f64),
                        F_BOOL => Val::Bool(u != 0),
                        F_STR => {
                            if u == 0 {
                                Val::Nil
                            } else {
                                let s = cstr_to_string(u as usize as *const c_char);
                                vm.new_str(s)
                            }
                        }
                        F_WSTR => {
                            if u == 0 {
                                Val::Nil
                            } else {
                                let s = utf16z_to_string(u as usize as *const u16);
                                vm.new_str(s)
                            }
                        }
                        _ => Val::Num(u as f64),
                    }
                }
            }
        };
        drop(tmp);
        return Ok(r);
    }
    #[allow(unreachable_code)]
    {
        let _ = (f, &mut tmp);
        Err(vm.err(format!("Chamadas a DLL não funcionam nesta arquitetura ({} em {})", e.sym, e.dll)))
    }
}

// ---------------------------------------------------------------------- carregar
pub fn where_text(p: &Prog, loc: i32) -> String {
    let lb = if p.loc_base != 0 { p.loc_base } else { 100_000 };
    let (fi, ln) = (loc as u32 / lb, loc as u32 % lb);
    format!("{}, linha {}", p.files.get(fi as usize).map(|s| s.as_str()).unwrap_or("?"), ln)
}

pub fn read_self() -> Option<Vec<u8>> {
    #[cfg(windows)]
    {
        let mut buf = vec![0u16; 32768];
        let n = unsafe { win::GetModuleFileNameW(std::ptr::null_mut(), buf.as_mut_ptr(), buf.len() as u32) } as usize;
        if n == 0 || n >= buf.len() {
            die("não consegui descobrir o caminho do próprio executável");
        }
        use std::os::windows::ffi::OsStringExt;
        let path = std::ffi::OsString::from_wide(&buf[..n]);
        return std::fs::read(path).ok();
    }
    #[cfg(not(windows))]
    {
        // nos testes em Linux, CAJU_SELF aponta para um .exe de Windows, para conferir a leitura do bytecode
        let path = std::env::var("CAJU_SELF").unwrap_or_else(|_| "/proc/self/exe".into());
        std::fs::read(path).ok()
    }
}

pub fn make_vm(payload: &[u8]) -> Vm {
    let mut heap = Heap::new();
    let prog: &'static Prog = Box::leak(Box::new(load(payload, &mut heap)));
    let mut vm = Vm::new(prog, heap);
    vm.ffi = call_ext;
    vm.mem = mem_builtin;
    vm.skip_sleep = std::env::var_os("CAJU_SKIP_SLEEP").is_some();
    vm
}

// ---------------------------------------------------------------------- programa (.exe)
#[cfg(not(feature = "dll"))]
fn pause_if_own_console() {
    #[cfg(windows)]
    unsafe {
        let mut ids = [0u32; 4];
        // aberto com dois cliques: a janela do console é só deste processo e fecharia na hora
        if win::GetConsoleProcessList(ids.as_mut_ptr(), 4) == 1 {
            print!("\nPressione Enter para fechar...");
            let _ = std::io::stdout().flush();
            let mut s = String::new();
            let _ = std::io::stdin().read_line(&mut s);
        }
    }
}

#[cfg(not(feature = "dll"))]
pub fn exe_main() -> i32 {
    #[cfg(windows)]
    unsafe {
        win::SetConsoleOutputCP(65001);
    }
    let Some(selfb) = read_self() else { die("não consegui abrir o próprio executável para ler o bytecode") };
    let Some(payload) = find_payload(&selfb) else {
        println!("Este é o runtime da linguagem Caju, sem nenhum programa embutido.");
        println!("Gere um .exe pela página da Caju para ter um programa pronto para rodar.");
        pause_if_own_console();
        return 3;
    };
    let mut vm = make_vm(payload);
    drop(selfb);
    let p = vm.p;
    vm.tx_begin();
    let res = vm.run();
    let _ = std::io::stdout().flush();
    let status = if res.is_ok() { 0 } else { 1 };
    if let Err(e) = &res {
        println!("Erro de {} em {}: {}.", e.stage, where_text(p, e.loc), e.msg);
    }
    let _ = std::io::stdout().flush();
    pause_if_own_console();
    status
}

// ---------------------------------------------------------------------- biblioteca (.dll)
#[cfg(feature = "dll")]
pub mod dll {
    use super::*;
    use std::cell::UnsafeCell;

    struct Global<T>(UnsafeCell<T>);
    unsafe impl<T> Sync for Global<T> {}
    impl<T> Global<T> {
        #[allow(clippy::mut_from_ref)]
        fn get(&self) -> &mut T {
            unsafe { &mut *self.0.get() }
        }
    }
    struct State {
        /// 0 = não carregada, 1 = pronta, 2 = falhou
        status: i32,
        vm: Option<Box<Vm>>,
        call_depth: i32,
        last_error: Vec<u8>,
        has_error: bool,
        init_error: String,
        rbuf: Vec<Vec<u8>>,
        wbuf: Vec<Vec<u16>>,
    }
    static ST: Global<State> = Global(UnsafeCell::new(State { status: 0, vm: None, call_depth: 0, last_error: Vec::new(), has_error: false, init_error: String::new(), rbuf: Vec::new(), wbuf: Vec::new() }));

    #[cfg(windows)]
    mod lock {
        use super::super::win;
        use std::sync::Once;
        #[repr(C, align(16))]
        struct Cs([u8; 64]);
        static mut CS: Cs = Cs([0; 64]);
        static INIT: Once = Once::new();
        pub fn enter() {
            unsafe {
                INIT.call_once(|| win::InitializeCriticalSection(std::ptr::addr_of_mut!(CS) as *mut _));
                win::EnterCriticalSection(std::ptr::addr_of_mut!(CS) as *mut _);
            }
        }
        pub fn leave() {
            unsafe { win::LeaveCriticalSection(std::ptr::addr_of_mut!(CS) as *mut _) }
        }
    }
    #[cfg(not(windows))]
    mod lock {
        pub fn enter() {}
        pub fn leave() {}
    }

    /// Devolve a mensagem do último erro, ou NULL se a última chamada deu certo. Texto UTF-8.
    #[no_mangle]
    pub extern "win64" fn caju_last_error() -> *const c_char {
        let st = ST.get();
        if st.has_error {
            st.last_error.as_ptr() as *const c_char
        } else {
            std::ptr::null()
        }
    }
    fn set_error_text(text: &str) {
        let st = ST.get();
        st.last_error = text.as_bytes().to_vec();
        st.last_error.push(0);
        st.has_error = true;
        eprintln!("caju: {}", text);
    }

    /// Uma transação: a inicialização (fi = None) ou a chamada de uma função exportada.
    /// Se a chamada falhar, a pilha e os quadros voltam ao que eram antes dela.
    fn transact(vm: &mut Vm, fi: Option<usize>, args: &[Val], x: Option<&Exp>) -> Option<u64> {
        let st = ST.get();
        let outer = st.call_depth == 0;
        let saved = vm.snapshot_main();
        let s_count = vm.count;
        st.call_depth += 1;
        let res: R<u64> = (|| {
            if outer {
                vm.tx_begin();
            }
            let Some(fi) = fi else {
                vm.run()?;
                return Ok(0);
            };
            vm.push_host_call(fi, args)?;
            vm.run()?;
            let Some(x) = x else { return Ok(0) };
            // valor devolvido pela função → tipo de C declarado
            let v = vm.unbox(vm.host_ret);
            Ok(match x.ret {
                F_VOID => 0,
                F_BOOL => truthy(v) as u64,
                F_STR | F_WSTR => match v {
                    Val::Str(_) => {
                        let s = vm.str_of(v).unwrap().to_string();
                        if x.ret == F_STR {
                            let mut b = s.into_bytes();
                            b.push(0);
                            let p = b.as_ptr() as u64;
                            ST.get().rbuf.push(b);
                            p
                        } else {
                            let w = utf8_to_utf16z(&s);
                            let p = w.as_ptr() as u64;
                            ST.get().wbuf.push(w);
                            p
                        }
                    }
                    Val::Num(d) => to_u64(d),
                    Val::Nil | Val::Unset => 0,
                    _ => return Err(vm.err(format!("A função exportada {} deve devolver um texto, mas devolveu um {}", x.name, vm.type_name(v)))),
                },
                ret => {
                    if let Val::Str(_) = v {
                        return Err(vm.err(format!("A função exportada {} deve devolver um número, mas devolveu um texto", x.name)));
                    }
                    let d = num_arg(v);
                    match ret {
                        F_I32 | F_U32 => to_u32(d) as u64,
                        F_I64 | F_U64 => to_i64(d) as u64,
                        F_PTR => to_u64(d),
                        F_F64 => d.to_bits(),
                        _ => (d as f32).to_bits() as u64,
                    }
                }
            })
        })();
        let st = ST.get();
        st.call_depth -= 1;
        // os textos devolvidos valem até a próxima chamada: guarda só os mais recentes
        if st.rbuf.len() > 16 {
            st.rbuf.drain(..st.rbuf.len() - 16);
        }
        if st.wbuf.len() > 16 {
            st.wbuf.drain(..st.wbuf.len() - 16);
        }
        match res {
            Ok(r) => Some(r),
            Err(e) => {
                set_error_text(&format!("Erro de {} em {}: {}.", e.stage, where_text(vm.p, e.loc), e.msg));
                // desfaz a pilha e os quadros da chamada que falhou
                vm.restore_main(saved);
                if !outer {
                    vm.count = s_count;
                }
                None
            }
        }
    }

    /// Na primeira chamada: lê o bytecode do próprio arquivo da DLL e roda o código de topo
    fn ensure_loaded() {
        let st = ST.get();
        if st.status != 0 {
            return;
        }
        st.status = 2;
        let selfb = self_path_bytes();
        let Some(selfb) = selfb else {
            st.init_error = "A DLL não conseguiu ler o próprio arquivo para carregar o programa.".into();
            return;
        };
        let Some(payload) = find_payload(&selfb) else {
            st.init_error = "Esta DLL é o runtime da Caju sem nenhum programa embutido.".into();
            return;
        };
        let mut vm = Box::new(make_vm(payload));
        if transact(&mut vm, None, &[], None).is_none() {
            let st = ST.get();
            st.init_error = format!("A inicialização da DLL falhou. {}", String::from_utf8_lossy(&st.last_error[..st.last_error.len().saturating_sub(1)]));
            return;
        }
        let st = ST.get();
        st.vm = Some(vm);
        st.status = 1;
    }
    fn self_path_bytes() -> Option<Vec<u8>> {
        #[cfg(windows)]
        unsafe {
            let mut h: *mut c_void = std::ptr::null_mut();
            // GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT
            if win::GetModuleHandleExW(4 | 2, caju_last_error as *const u16, &mut h) == 0 {
                return None;
            }
            let mut buf = vec![0u16; 32768];
            let n = win::GetModuleFileNameW(h, buf.as_mut_ptr(), buf.len() as u32) as usize;
            if n == 0 || n >= buf.len() {
                return None;
            }
            use std::os::windows::ffi::OsStringExt;
            return std::fs::read(std::ffi::OsString::from_wide(&buf[..n])).ok();
        }
        #[cfg(not(windows))]
        {
            std::env::var("CAJU_SELF").ok().and_then(|p| std::fs::read(p).ok())
        }
    }
    unsafe fn from_c(vm: &mut Vm, t: u8, raw: u64) -> Val {
        match t {
            F_I32 => Val::Num(raw as u32 as i32 as f64),
            F_U32 => Val::Num(raw as u32 as f64),
            F_I64 => Val::Num(raw as i64 as f64),
            F_U64 | F_PTR => Val::Num(raw as f64),
            F_BOOL => Val::Bool(raw as u32 != 0),
            F_F64 => Val::Num(f64::from_bits(raw)),
            F_F32 => Val::Num(f32::from_bits(raw as u32) as f64),
            F_STR => {
                if raw == 0 {
                    Val::Nil
                } else {
                    let s = cstr_to_string(raw as usize as *const c_char);
                    vm.new_str(s)
                }
            }
            F_WSTR => {
                if raw == 0 {
                    Val::Nil
                } else {
                    let s = utf16z_to_string(raw as usize as *const u16);
                    vm.new_str(s)
                }
            }
            _ => Val::Nil,
        }
    }

    /// Chamado pelos thunks (caju-asm-x64.S). gp aponta para os 4 registradores inteiros
    /// seguidos dos argumentos na pilha; xmm, para XMM0–XMM3.
    #[no_mangle]
    pub unsafe extern "win64" fn caju_dispatch(slot: u32, gp: *const u64, xmm: *const f64, ret: *mut u64) {
        *ret = 0;
        lock::enter();
        let st = ST.get();
        if st.call_depth == 0 {
            st.has_error = false;
        }
        ensure_loaded();
        let st = ST.get();
        if st.status != 1 {
            let t = st.init_error.clone();
            set_error_text(&t);
            lock::leave();
            return;
        }
        // durante uma chamada de DLL feita pelo programa, a VM está em uso: usa o mesmo ponteiro
        let vm: &mut Vm = if st.call_depth > 0 && !VM_PTR.is_null() { &mut *VM_PTR } else { st.vm.as_mut().unwrap() };
        let p = vm.p;
        let Some(x) = p.exps.get(slot as usize) else {
            set_error_text(&format!("Esta DLL não tem a exportação número {}.", slot));
            lock::leave();
            return;
        };
        let mut args = Vec::new();
        for (i, &t) in x.ptype.iter().enumerate().take(16) {
            let raw = if i < 4 && (t == F_F64 || t == F_F32) { (*xmm.add(i)).to_bits() } else { *gp.add(i) };
            args.push(from_c(vm, t, raw));
        }
        if let Some(r) = transact(vm, Some(x.fidx as usize), &args, Some(x)) {
            *ret = r;
        }
        lock::leave();
    }
}
