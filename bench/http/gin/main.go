package main

import (
	"fmt"
	"io"
	"os"

	"github.com/gin-gonic/gin"
)

type User struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Active bool   `json:"active"`
}

func main() {
	gin.SetMode(gin.ReleaseMode)
	gin.DefaultWriter = io.Discard
	users := []User{}
	for i := 0; i < 50; i++ {
		users = append(users, User{i, fmt.Sprintf("user %d", i), fmt.Sprintf("u%d@x.com", i), i%2 == 0})
	}
	r := gin.New()
	r.GET("/users/:id", func(c *gin.Context) { c.JSON(200, gin.H{"id": c.Param("id"), "name": "user"}) })
	r.GET("/users", func(c *gin.Context) { c.JSON(200, users) })
	r.POST("/users", func(c *gin.Context) {
		var u User
		if err := c.ShouldBindJSON(&u); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		c.JSON(201, u)
	})
	r.Run("127.0.0.1:" + os.Getenv("PORT"))
}
