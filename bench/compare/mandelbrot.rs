fn main() {
    let size: usize = std::env::args().nth(1).unwrap().parse().unwrap();
    let fs = size as f64;
    let mut inside = 0;
    for py in 0..size {
        let ci = py as f64 * 2.5 / fs - 1.25;
        for px in 0..size {
            let cr = px as f64 * 2.5 / fs - 2.0;
            let (mut zr, mut zi) = (0.0f64, 0.0f64);
            let mut i = 0;
            while i < 50 && zr * zr + zi * zi <= 4.0 {
                let t = zr * zr - zi * zi + cr;
                zi = 2.0 * zr * zi + ci;
                zr = t;
                i += 1;
            }
            if i == 50 {
                inside += 1;
            }
        }
    }
    println!("{}", inside);
}
