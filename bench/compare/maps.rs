use std::collections::HashMap;

fn main() {
    let n: i64 = std::env::args().nth(1).unwrap().parse().unwrap();
    let buckets = n / 2;
    let mut m: HashMap<i64, i64> = HashMap::new();
    for i in 0..n {
        let k = (i * 7919) % buckets;
        *m.entry(k).or_insert(0) += i;
    }
    let mut sum: i64 = 0;
    for i in 0..n {
        if let Some(v) = m.get(&((i * 31) % n)) {
            sum = (sum + v) % 1000000007;
        }
    }
    println!("{} {}", m.len(), sum);
}
