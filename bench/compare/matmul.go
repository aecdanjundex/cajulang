package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	n, _ := strconv.Atoi(os.Args[1])
	a := make([]int, n*n)
	b := make([]int, n*n)
	c := make([]int, n*n)
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			a[i*n+j] = (i*3 + j) % 10
			b[i*n+j] = (i + j*7) % 10
		}
	}
	for i := 0; i < n; i++ {
		for k := 0; k < n; k++ {
			aik := a[i*n+k]
			for j := 0; j < n; j++ {
				c[i*n+j] += aik * b[k*n+j]
			}
		}
	}
	sum := 0
	for i := 0; i < n*n; i++ {
		sum += c[i] * (i%7 + 1)
	}
	fmt.Println(sum)
}
