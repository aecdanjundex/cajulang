// load: a lean HTTP/1.1 keep-alive load generator (raw TCP, one goroutine per connection).
//   load -c 50 -d 5s -m GET -p /users/7 [-b body] [-port 19100] [-close]
package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	c := flag.Int("c", 50, "connections")
	d := flag.Duration("d", 5*time.Second, "duration")
	m := flag.String("m", "GET", "method")
	p := flag.String("p", "/", "path")
	b := flag.String("b", "", "body")
	port := flag.Int("port", 19100, "port")
	closeEach := flag.Bool("close", false, "new connection per request")
	flag.Parse()
	addr := "127.0.0.1:" + strconv.Itoa(*port)
	req := fmt.Sprintf("%s %s HTTP/1.1\r\nHost: x\r\n", *m, *p)
	if *b != "" {
		req += "Content-Type: application/json\r\nContent-Length: " + strconv.Itoa(len(*b)) + "\r\n"
	}
	if *closeEach {
		req += "Connection: close\r\n"
	}
	req += "\r\n" + *b
	raw := []byte(req)
	var total, errs atomic.Int64
	stop := time.Now().Add(*d)
	lat := make([][]time.Duration, *c)
	var wg sync.WaitGroup
	for i := 0; i < *c; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			var conn net.Conn
			var r *bufio.Reader
			for time.Now().Before(stop) {
				if conn == nil {
					var err error
					conn, err = net.Dial("tcp", addr)
					if err != nil { errs.Add(1); time.Sleep(time.Millisecond); continue }
					r = bufio.NewReaderSize(conn, 65536)
				}
				t0 := time.Now()
				if _, err := conn.Write(raw); err != nil { errs.Add(1); conn.Close(); conn = nil; continue }
				n := -1
				chunked := false
				status := ""
				for {
					line, err := r.ReadSlice('\n')
					if err != nil { n = -2; break }
					if status == "" { status = string(line[9:12]) }
					if len(line) <= 2 { break }
					if len(line) > 16 && bytes.EqualFold(line[:15], []byte("content-length:")) {
						n, _ = strconv.Atoi(string(bytes.TrimSpace(line[15:])))
					}
					if len(line) > 26 && bytes.EqualFold(line[:18], []byte("transfer-encoding:")) && bytes.Contains(bytes.ToLower(line), []byte("chunked")) {
						chunked = true
					}
				}
				if chunked && n != -2 {
					n = 0
					for {
						line, err := r.ReadSlice('\n')
						if err != nil { n = -2; break }
						sz, err := strconv.ParseInt(string(bytes.TrimSpace(line)), 16, 64)
						if err != nil { n = -2; break }
						if _, err := io.CopyN(io.Discard, r, sz+2); err != nil { n = -2; break }
						if sz == 0 { break }
					}
				}
				if n < 0 { errs.Add(1); conn.Close(); conn = nil; continue }
				if _, err := io.CopyN(io.Discard, r, int64(n)); err != nil { errs.Add(1); conn.Close(); conn = nil; continue }
				if status[0] != '2' { errs.Add(1) }
				lat[i] = append(lat[i], time.Since(t0))
				total.Add(1)
				if *closeEach { conn.Close(); conn = nil }
			}
			if conn != nil { conn.Close() }
		}(i)
	}
	wg.Wait()
	all := []time.Duration{}
	for _, l := range lat { all = append(all, l...) }
	sort.Slice(all, func(a, b int) bool { return all[a] < all[b] })
	pct := func(q float64) float64 { if len(all) == 0 { return 0 }; return float64(all[int(q*float64(len(all)-1))].Microseconds()) / 1000 }
	fmt.Printf("%.0f req/s  p50 %.3f ms  p99 %.3f ms  errors %d\n", float64(total.Load())/d.Seconds(), pct(0.5), pct(0.99), errs.Load())
	if errs.Load() > 0 { os.Exit(1) }
}
