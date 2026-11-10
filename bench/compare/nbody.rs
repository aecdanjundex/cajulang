const PI: f64 = 3.141592653589793;
const SOLAR_MASS: f64 = 4.0 * PI * PI;
const DAYS: f64 = 365.24;

struct Bodies {
    x: [f64; 5], y: [f64; 5], z: [f64; 5],
    vx: [f64; 5], vy: [f64; 5], vz: [f64; 5],
    m: [f64; 5],
}

fn offset_momentum(b: &mut Bodies) {
    let (mut px, mut py, mut pz) = (0.0, 0.0, 0.0);
    for i in 0..5 {
        px += b.vx[i] * b.m[i];
        py += b.vy[i] * b.m[i];
        pz += b.vz[i] * b.m[i];
    }
    b.vx[0] = -px / SOLAR_MASS;
    b.vy[0] = -py / SOLAR_MASS;
    b.vz[0] = -pz / SOLAR_MASS;
}

fn advance(b: &mut Bodies, dt: f64) {
    for i in 0..5 {
        for j in (i + 1)..5 {
            let dx = b.x[i] - b.x[j];
            let dy = b.y[i] - b.y[j];
            let dz = b.z[i] - b.z[j];
            let d2 = dx * dx + dy * dy + dz * dz;
            let mag = dt / (d2 * d2.sqrt());
            b.vx[i] -= dx * b.m[j] * mag;
            b.vy[i] -= dy * b.m[j] * mag;
            b.vz[i] -= dz * b.m[j] * mag;
            b.vx[j] += dx * b.m[i] * mag;
            b.vy[j] += dy * b.m[i] * mag;
            b.vz[j] += dz * b.m[i] * mag;
        }
    }
    for i in 0..5 {
        b.x[i] += dt * b.vx[i];
        b.y[i] += dt * b.vy[i];
        b.z[i] += dt * b.vz[i];
    }
}

fn energy(b: &Bodies) -> f64 {
    let mut e = 0.0;
    for i in 0..5 {
        e += 0.5 * b.m[i] * (b.vx[i] * b.vx[i] + b.vy[i] * b.vy[i] + b.vz[i] * b.vz[i]);
        for j in (i + 1)..5 {
            let dx = b.x[i] - b.x[j];
            let dy = b.y[i] - b.y[j];
            let dz = b.z[i] - b.z[j];
            e -= b.m[i] * b.m[j] / (dx * dx + dy * dy + dz * dz).sqrt();
        }
    }
    e
}

fn main() {
    let steps: usize = std::env::args().nth(1).unwrap().parse().unwrap();
    let mut b = Bodies {
        x: [0.0, 4.84143144246472090e+00, 8.34336671824457987e+00, 1.28943695621391310e+01, 1.53796971148509165e+01],
        y: [0.0, -1.16032004402742839e+00, 4.12479856412430479e+00, -1.51111514016986312e+01, -2.59193146099879641e+01],
        z: [0.0, -1.03622044471123109e-01, -4.03523417114321381e-01, -2.23307578892655734e-01, 1.79258772950371181e-01],
        vx: [0.0, 1.66007664274403694e-03 * DAYS, -2.76742510726862411e-03 * DAYS, 2.96460137564761618e-03 * DAYS, 2.68067772490389322e-03 * DAYS],
        vy: [0.0, 7.69901118419740425e-03 * DAYS, 4.99852801234917238e-03 * DAYS, 2.37847173959480950e-03 * DAYS, 1.62824170038242295e-03 * DAYS],
        vz: [0.0, -6.90460016972063023e-05 * DAYS, 2.30417297573763929e-05 * DAYS, -2.96589568540237556e-05 * DAYS, -9.51592254519715870e-05 * DAYS],
        m: [SOLAR_MASS, 9.54791938424326609e-04 * SOLAR_MASS, 2.85885980666130812e-04 * SOLAR_MASS, 4.36624404335156298e-05 * SOLAR_MASS, 5.15138902046611451e-05 * SOLAR_MASS],
    };
    offset_momentum(&mut b);
    for _ in 0..steps {
        advance(&mut b, 0.01);
    }
    println!("{}", (energy(&b) * 1000000000.0) as i64);
}
