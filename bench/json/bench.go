// The Go counterpart of bench.caju (encoding/json). go run bench.go
package main

import (
	"encoding/json"
	"fmt"
	"time"
)

type User struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Active bool   `json:"active"`
}

type Doc struct {
	Title   string         `json:"title"`
	Version int            `json:"version"`
	Score   float64        `json:"score"`
	Tags    []string       `json:"tags"`
	Owner   User           `json:"owner"`
	Users   []User         `json:"users"`
	Meta    map[string]int `json:"meta"`
}

var sink int

func report(name string, n int, t0 time.Time) {
	fmt.Println(name, time.Since(t0).Nanoseconds()/int64(n))
}

func main() {
	users := []User{}
	for i := 0; i < 50; i++ {
		users = append(users, User{i, fmt.Sprintf("user %d", i), fmt.Sprintf("u%d@x.com", i), i%2 == 0})
	}
	usersJSON, _ := json.Marshal(users)
	oneJSON := []byte(`{"id":5,"name":"Ana","email":"ana@x.com","active":true}`)
	doc := Doc{"report \"q3\"", 7, 98.5, []string{"a", "b", "c"}, users[1], users[0:20], map[string]int{"x": 1, "y": 2, "z": 3}}
	docJSON, _ := json.Marshal(doc)

	n := 20000
	t0 := time.Now()
	for i := 0; i < n; i++ {
		s, _ := json.Marshal(users)
		sink += len(s)
	}
	report("marshal_users50", n, t0)
	n = 500000
	t0 = time.Now()
	for i := 0; i < n; i++ {
		s, _ := json.Marshal(map[string]any{"id": "7", "name": "user"})
		sink += len(s)
	}
	report("marshal_map_small", n, t0)
	n = 500000
	t0 = time.Now()
	for i := 0; i < n; i++ {
		var u User
		json.Unmarshal(oneJSON, &u)
		sink += u.ID
	}
	report("unmarshal_user", n, t0)
	n = 20000
	t0 = time.Now()
	for i := 0; i < n; i++ {
		var us []User
		json.Unmarshal(usersJSON, &us)
		sink += len(us)
	}
	report("unmarshal_users50", n, t0)
	n = 20000
	t0 = time.Now()
	for i := 0; i < n; i++ {
		var v any
		json.Unmarshal(docJSON, &v)
		sink += len(v.(map[string]any))
	}
	report("parse_doc", n, t0)
	n = 20000
	t0 = time.Now()
	for i := 0; i < n; i++ {
		var d Doc
		json.Unmarshal(docJSON, &d)
		sink += d.Version
	}
	report("unmarshal_doc", n, t0)
	n = 20000
	t0 = time.Now()
	for i := 0; i < n; i++ {
		s, _ := json.Marshal(doc)
		sink += len(s)
	}
	report("marshal_doc", n, t0)
}
