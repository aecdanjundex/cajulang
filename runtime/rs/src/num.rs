//! Números da Caju, exatamente como a VM do navegador (JavaScript) os trata.
//!
//! Todo número mora num f64. Os inteiros são exatos até 2^53; as contas de 64 bits dão a
//! volta como no Go, e acima de 2^53 o resultado é arredondado. Onde a página usa BigInt,
//! aqui usamos aritmética modular em u64/i128, que dá o mesmo resultado.

pub const TWO32: f64 = 4294967296.0;
pub const TWO64: f64 = 18446744073709551616.0;
const MAX_SAFE: f64 = 9007199254740991.0;

/// Number.isSafeInteger
#[inline]
pub fn is_safe(x: f64) -> bool {
    x.is_finite() && x.trunc() == x && x.abs() <= MAX_SAFE
}
/// Number.isInteger
#[inline]
pub fn is_int(x: f64) -> bool {
    x.is_finite() && x.trunc() == x
}
/// ToInt32 do JavaScript (x | 0)
#[inline]
pub fn to_i32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    let t = x.trunc() % TWO32;
    (t as i64) as u32 as i32
}
/// Os 64 bits de baixo de um inteiro qualquer (BigInt.asUintN(64, x))
#[inline]
pub fn low64(x: f64) -> u64 {
    if !x.is_finite() {
        return 0;
    }
    let m = x.trunc() % TWO64;
    (m as i128) as u64
}
/// x como i128 exato; valores enormes caem para os 64 bits de baixo
#[inline]
fn wide(x: f64) -> i128 {
    if x.abs() < 1.0e38 {
        x.trunc() as i128
    } else {
        low64(x) as i64 as i128
    }
}
#[inline]
pub fn big64(x: f64, unsigned: bool) -> f64 {
    let u = low64(x);
    if unsigned {
        u as f64
    } else {
        u as i64 as f64
    }
}

/// Faz o valor caber no tipo inteiro k (códigos: int 0, int8 1, int16 2, int32 3, int64 4,
/// uint 5, uint8 6, uint16 7, uint32 8, uint64 9, float32 10, num 11)
#[inline]
pub fn wrap_kind(x: f64, k: i32) -> f64 {
    match k {
        1 => to_i32(x) as i8 as f64,
        2 => to_i32(x) as i16 as f64,
        3 => to_i32(x) as f64,
        6 => (to_i32(x) & 0xff) as f64,
        7 => (to_i32(x) & 0xffff) as f64,
        8 => to_i32(x) as u32 as f64,
        5 | 9 => {
            if is_safe(x) && x >= 0.0 {
                x
            } else {
                big64(x, true)
            }
        }
        10 => x as f32 as f64,
        11 => x,
        _ => {
            if is_safe(x) {
                x
            } else {
                big64(x, false)
            }
        }
    }
}
#[inline]
pub fn is_narrow(k: i32) -> bool {
    (1..=3).contains(&k) || (6..=8).contains(&k)
}
#[inline]
pub fn unsigned(k: i32) -> bool {
    (5..=9).contains(&k)
}
fn fin(r: u64, k: i32) -> f64 {
    if unsigned(k) {
        r as f64
    } else {
        r as i64 as f64
    }
}
/// conta de 64 bits exata (o bigOp da página)
pub fn big_op(op: i32, a: f64, b: f64, k: i32) -> f64 {
    if op == 3 {
        let (x, y) = (wide(a), wide(b));
        if y == 0 {
            return 0.0;
        }
        return fin(x.wrapping_div(y) as u64, k);
    }
    let (x, y) = (low64(a), low64(b));
    let r = match op {
        0 => x.wrapping_add(y),
        1 => x.wrapping_sub(y),
        2 => x.wrapping_mul(y),
        7 => x & y,
        8 => x | y,
        9 => x ^ y,
        _ => x & !y,
    };
    fin(r, k)
}

pub const IOP_SYMBOLS: [&str; 12] = ["+", "-", "*", "/", "%", "<<", ">>", "&", "|", "^", "&^", "^"];

/// Operação de inteiros sobre valores já conferidos como números.
/// op: 0 + 1 - 2 * 3 / 4 % 5 << 6 >> 7 & 8 | 9 ^ 10 &^ 11 ^x (unário).
/// Devolve Err com a mensagem de erro, se houver.
pub fn int_op(op: i32, k: i32, a0: f64, b0: f64) -> Result<f64, &'static str> {
    let (mut a, mut b) = (a0, b0);
    if !is_int(a) || (op != 11 && !is_int(b)) {
        a = a.trunc();
        b = b.trunc();
    }
    Ok(match op {
        0 | 1 => {
            let r = if op == 0 { a + b } else { a - b };
            if is_safe(r) {
                wrap_kind(r, k)
            } else {
                wrap_kind(big_op(op, a, b, k), k)
            }
        }
        2 => {
            if is_narrow(k) {
                return Ok(wrap_kind(to_i32(a).wrapping_mul(to_i32(b)) as f64, k));
            }
            let r = a * b;
            if is_safe(r) {
                wrap_kind(r, k)
            } else {
                big_op(2, a, b, k)
            }
        }
        3 => {
            if b == 0.0 {
                return Err("Divisão inteira por zero");
            }
            let q = if a.abs() < 4503599627370496.0 && b.abs() < 4503599627370496.0 { (a / b).trunc() } else { big_op(3, a, b, k) };
            wrap_kind(if q == 0.0 { 0.0 } else { q }, k)
        }
        4 => {
            if b == 0.0 {
                return Err("Resto de divisão inteira por zero");
            }
            let r = a % b;
            wrap_kind(if r == 0.0 { 0.0 } else { r }, k)
        }
        5 => {
            if b < 0.0 {
                return Err("Deslocamento negativo");
            }
            if b >= 64.0 {
                return Ok(0.0);
            }
            let sh = b as u32;
            if is_narrow(k) {
                return Ok(if b >= 32.0 { 0.0 } else { wrap_kind(to_i32(a).wrapping_shl(sh) as f64, k) });
            }
            let r = a * 2f64.powi(sh as i32);
            if is_safe(r) {
                wrap_kind(r, k)
            } else {
                fin(low64(a).wrapping_shl(sh), k)
            }
        }
        6 => {
            if b < 0.0 {
                return Err("Deslocamento negativo");
            }
            if b >= 64.0 {
                return Ok(if a < 0.0 { -1.0 } else { 0.0 });
            }
            let r = (a / 2f64.powi(b as i32)).floor();
            if is_safe(a) {
                wrap_kind(r, k)
            } else {
                r
            }
        }
        7..=10 => {
            let in32 = |x: f64| x >= -2147483648.0 && x < 2147483648.0;
            if is_narrow(k) || (in32(a) && in32(b)) {
                let (x, y) = (to_i32(a), to_i32(b));
                let r = match op {
                    7 => x & y,
                    8 => x | y,
                    9 => x ^ y,
                    _ => x & !y,
                };
                wrap_kind(r as f64, k)
            } else {
                big_op(op, a, b, k)
            }
        }
        _ => wrap_kind(-a - 1.0, k),
    })
}

/// conversão numérica: int8(x), uint(x), float32(x)...
pub fn conv_num(v: f64, k: i32) -> f64 {
    if k == 11 {
        return v;
    }
    if k == 10 {
        return v as f32 as f64;
    }
    if !v.is_finite() {
        return 0.0;
    }
    let t = v.trunc();
    wrap_kind(if t == 0.0 { 0.0 } else { t }, k)
}

/// x ** y do JavaScript
pub fn js_pow(a: f64, b: f64) -> f64 {
    if b.is_nan() {
        return f64::NAN;
    }
    if a.abs() == 1.0 && b.is_infinite() {
        return f64::NAN;
    }
    a.powf(b)
}

/// Escreve um número como a página: inteiros (abaixo de 1e21) com todos os algarismos,
/// o resto como String(Number(x.toPrecision(12)))
pub fn fmt_num(x: f64, out: &mut String) {
    use std::fmt::Write;
    if x.is_nan() {
        out.push_str("NaN");
        return;
    }
    if x.is_infinite() {
        out.push_str(if x > 0.0 { "Infinity" } else { "-Infinity" });
        return;
    }
    if x == 0.0 {
        out.push('0');
        return;
    }
    if x.trunc() == x && x.abs() < 1e21 {
        let _ = write!(out, "{}", x as i128);
        return;
    }
    let tmp = format!("{:.11e}", x); // 12 algarismos significativos
    let (mant, exp) = tmp.split_once('e').unwrap();
    let neg = mant.starts_with('-');
    let mut digits: Vec<u8> = mant.bytes().filter(|c| c.is_ascii_digit()).collect();
    let e: i32 = exp.parse().unwrap();
    while digits.len() > 1 && *digits.last().unwrap() == b'0' {
        digits.pop();
    }
    let k = digits.len() as i32;
    let n = e + 1; // posição da vírgula, regra do JS
    if neg {
        out.push('-');
    }
    let d = |i: i32| digits[i as usize] as char;
    if k <= n && n <= 21 {
        for i in 0..k {
            out.push(d(i));
        }
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        for i in 0..n {
            out.push(d(i));
        }
        out.push('.');
        for i in n..k {
            out.push(d(i));
        }
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        for i in 0..k {
            out.push(d(i));
        }
    } else {
        out.push(d(0));
        if k > 1 {
            out.push('.');
            for i in 1..k {
                out.push(d(i));
            }
        }
        out.push('e');
        out.push(if n - 1 >= 0 { '+' } else { '-' });
        let _ = write!(out, "{}", (n - 1).abs());
    }
}
pub fn num_str(x: f64) -> String {
    let mut s = String::new();
    fmt_num(x, &mut s);
    s
}
