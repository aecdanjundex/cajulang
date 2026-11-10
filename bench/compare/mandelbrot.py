import sys

size = int(sys.argv[1])
fs = float(size)
inside = 0
for py in range(size):
    ci = py * 2.5 / fs - 1.25
    for px in range(size):
        cr = px * 2.5 / fs - 2.0
        zr = zi = 0.0
        i = 0
        while i < 50 and zr * zr + zi * zi <= 4.0:
            t = zr * zr - zi * zi + cr
            zi = 2.0 * zr * zi + ci
            zr = t
            i += 1
        if i == 50:
            inside += 1
print(inside)
