import sys

n = int(sys.argv[1])
buckets = n // 2
m = {}
for i in range(n):
    k = (i * 7919) % buckets
    m[k] = m.get(k, 0) + i
total = 0
for i in range(n):
    v = m.get((i * 31) % n)
    if v is not None:
        total = (total + v) % 1000000007
print(len(m), total)
