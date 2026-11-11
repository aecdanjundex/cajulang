package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

type User struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Active bool   `json:"active"`
}

func send(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func main() {
	users := []User{}
	for i := 0; i < 50; i++ {
		users = append(users, User{i, fmt.Sprintf("user %d", i), fmt.Sprintf("u%d@x.com", i), i%2 == 0})
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
		send(w, 200, map[string]any{"id": r.PathValue("id"), "name": "user"})
	})
	mux.HandleFunc("GET /users", func(w http.ResponseWriter, r *http.Request) { send(w, 200, users) })
	mux.HandleFunc("POST /users", func(w http.ResponseWriter, r *http.Request) {
		var u User
		if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
			send(w, 400, map[string]any{"error": err.Error()})
			return
		}
		send(w, 201, u)
	})
	http.ListenAndServe("127.0.0.1:"+os.Getenv("PORT"), mux)
}
