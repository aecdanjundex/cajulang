import sys

n = int(sys.argv[1])
a = [0] * (n * n)
b = [0] * (n * n)
c = [0] * (n * n)
for i in range(n):
    for j in range(n):
        a[i * n + j] = (i * 3 + j) % 10
        b[i * n + j] = (i + j * 7) % 10
for i in range(n):
    for k in range(n):
        aik = a[i * n + k]
        for j in range(n):
            c[i * n + j] += aik * b[k * n + j]
total = 0
for i in range(n * n):
    total += c[i] * (i % 7 + 1)
print(total)
