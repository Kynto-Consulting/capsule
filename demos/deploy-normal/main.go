package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprintf(w, `
			<!DOCTYPE html>
			<html>
			<head>
				<title>Capsule Normal Deployment Demo</title>
				<style>
					body {
						font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
						background: linear-gradient(135deg, #0f172a, #1e1b4b);
						color: #f8fafc;
						display: flex;
						flex-direction: column;
						align-items: center;
						justify-content: center;
						height: 100vh;
						margin: 0;
					}
					.container {
						background: rgba(255, 255, 255, 0.05);
						backdrop-filter: blur(10px);
						border: 1px solid rgba(255, 255, 255, 0.1);
						padding: 3rem;
						border-radius: 1rem;
						box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
						text-align: center;
					}
					h1 {
						font-size: 2.5rem;
						margin-bottom: 1rem;
						background: linear-gradient(to right, #38bdf8, #818cf8);
						-webkit-background-clip: text;
						-webkit-text-fill-color: transparent;
					}
					p {
						font-size: 1.1rem;
						color: #94a3b8;
					}
					.badge {
						background: #22c55e;
						color: white;
						padding: 0.25rem 0.75rem;
						border-radius: 9999px;
						font-size: 0.9rem;
						font-weight: 600;
					}
				</style>
			</head>
			<body>
				<div class="container">
					<h1>🚀 Capsule ECS Container Deployment</h1>
					<p>Congratulations! Your normal container deployment has succeeded on ECS.</p>
					<p><span class="badge">Running</span> Port: %s</p>
				</div>
			</body>
			</html>
		`, port)
	})

	fmt.Printf("Server listening on port %s...\n", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		fmt.Printf("Error starting server: %v\n", err)
	}
}
