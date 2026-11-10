import sys

def quicksort(a, lo, hi):
    while lo < hi:
        p = a[(lo + hi) // 2]
        i, j = lo, hi
        while i <= j:
            while a[i] < p:
                i += 1
            while a[j] > p:
                j -= 1
            if i <= j:
                a[i], a[j] = a[j], a[i]
                i += 1
                j -= 1
        if j - lo < hi - i:
            quicksort(a, lo, j)
            lo = i
        else:
            quicksort(a, i, hi)
            hi = j

n = int(sys.argv[1])
a = [0] * n
seed = 42
for i in range(n):
    seed = (seed * 1103515245 + 12345) % 2147483648
    a[i] = seed
quicksort(a, 0, n - 1)
total = 0
for i in range(n):
    if i > 0 and a[i - 1] > a[i]:
        print("not sorted")
    total = (total + (a[i] % 1000) * (i % 1000)) % 1000000007
print(total)
