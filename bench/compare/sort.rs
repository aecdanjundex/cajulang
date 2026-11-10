fn quicksort(a: &mut [i64], mut lo: i64, mut hi: i64) {
    while lo < hi {
        let p = a[((lo + hi) / 2) as usize];
        let (mut i, mut j) = (lo, hi);
        while i <= j {
            while a[i as usize] < p {
                i += 1;
            }
            while a[j as usize] > p {
                j -= 1;
            }
            if i <= j {
                a.swap(i as usize, j as usize);
                i += 1;
                j -= 1;
            }
        }
        if j - lo < hi - i {
            quicksort(a, lo, j);
            lo = i;
        } else {
            quicksort(a, i, hi);
            hi = j;
        }
    }
}

fn main() {
    let n: usize = std::env::args().nth(1).unwrap().parse().unwrap();
    let mut a = vec![0i64; n];
    let mut seed: i64 = 42;
    for i in 0..n {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        a[i] = seed;
    }
    quicksort(&mut a, 0, n as i64 - 1);
    let mut sum: i64 = 0;
    for i in 0..n {
        if i > 0 && a[i - 1] > a[i] {
            println!("not sorted");
        }
        sum = (sum + (a[i] % 1000) * ((i % 1000) as i64)) % 1000000007;
    }
    println!("{}", sum);
}
