fn main() {
    let n: usize = std::env::args().nth(1).unwrap().parse().unwrap();
    let mut a = vec![0i64; n * n];
    let mut b = vec![0i64; n * n];
    let mut c = vec![0i64; n * n];
    for i in 0..n {
        for j in 0..n {
            a[i * n + j] = ((i * 3 + j) % 10) as i64;
            b[i * n + j] = ((i + j * 7) % 10) as i64;
        }
    }
    for i in 0..n {
        for k in 0..n {
            let aik = a[i * n + k];
            for j in 0..n {
                c[i * n + j] += aik * b[k * n + j];
            }
        }
    }
    let mut sum: i64 = 0;
    for i in 0..n * n {
        sum += c[i] * ((i % 7 + 1) as i64);
    }
    println!("{}", sum);
}
