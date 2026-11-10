fn main() {
    let n: usize = std::env::args().nth(1).unwrap().parse().unwrap();
    let mut composite = vec![false; n + 1];
    let mut count = 0;
    let mut i = 2;
    while i <= n {
        if !composite[i] {
            count += 1;
            let mut j = i * i;
            while j <= n {
                composite[j] = true;
                j += i;
            }
        }
        i += 1;
    }
    println!("{}", count);
}
