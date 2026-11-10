package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	size, _ := strconv.Atoi(os.Args[1])
	fs := float64(size)
	inside := 0
	for py := 0; py < size; py++ {
		ci := float64(py)*2.5/fs - 1.25
		for px := 0; px < size; px++ {
			cr := float64(px)*2.5/fs - 2.0
			zr, zi := 0.0, 0.0
			i := 0
			for i < 50 && zr*zr+zi*zi <= 4.0 {
				t := zr*zr - zi*zi + cr
				zi = 2.0*zr*zi + ci
				zr = t
				i++
			}
			if i == 50 {
				inside++
			}
		}
	}
	fmt.Println(inside)
}
