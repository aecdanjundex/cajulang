package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	n, _ := strconv.Atoi(os.Args[1])
	buckets := n / 2
	m := map[int]int{}
	for i := 0; i < n; i++ {
		k := (i * 7919) % buckets
		m[k] = m[k] + i
	}
	sum := 0
	for i := 0; i < n; i++ {
		if v, ok := m[(i*31)%n]; ok {
			sum = (sum + v) % 1000000007
		}
	}
	fmt.Println(len(m), sum)
}
