package main

import (
	"fmt"
	"os"
	"strconv"
)

func quicksort(a []int, lo, hi int) {
	for lo < hi {
		p := a[(lo+hi)/2]
		i, j := lo, hi
		for i <= j {
			for a[i] < p {
				i++
			}
			for a[j] > p {
				j--
			}
			if i <= j {
				a[i], a[j] = a[j], a[i]
				i++
				j--
			}
		}
		if j-lo < hi-i {
			quicksort(a, lo, j)
			lo = i
		} else {
			quicksort(a, i, hi)
			hi = j
		}
	}
}

func main() {
	n, _ := strconv.Atoi(os.Args[1])
	a := make([]int, n)
	seed := 42
	for i := 0; i < n; i++ {
		seed = (seed*1103515245 + 12345) % 2147483648
		a[i] = seed
	}
	quicksort(a, 0, n-1)
	sum := 0
	for i := 0; i < n; i++ {
		if i > 0 && a[i-1] > a[i] {
			fmt.Println("not sorted")
		}
		sum = (sum + (a[i]%1000)*(i%1000)) % 1000000007
	}
	fmt.Println(sum)
}
