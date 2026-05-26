package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
}

type openAIChoice struct {
	Message chatMessage `json:"message"`
}

type chatResponse struct {
	Choices []openAIChoice `json:"choices"`
}

func main() {
	token := os.Getenv("CAPSULE_AI_TOKEN")
	baseURL := os.Getenv("CAPSULE_API_URL")

	fmt.Println("🤖 Capsule Bedrock AI Proxy Consumer Demo")
	fmt.Println("----------------------------------------")

	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}

	if token == "" {
		fmt.Println("⚠️  Warning: CAPSULE_AI_TOKEN is not configured.")
		fmt.Println("To retrieve a token, run the CLI Bedrock key generator command:")
		fmt.Println("  capsule ai keys create --name 'My Application Token'")
		fmt.Println()
		fmt.Println("Configure the environment variables to continue:")
		fmt.Println("  export CAPSULE_API_URL=https://api.yourdomain.com")
		fmt.Println("  export CAPSULE_AI_TOKEN=csk_live_YOUR_GENERATED_KEY")
		fmt.Println()
		os.Exit(1)
	}

	prompt := "Explain in three sentences why self-hosting containerized applications using Capsule PaaS on AWS is superior to generic shared hosting."
	if len(os.Args) > 1 {
		prompt = strings.Join(os.Args[1:], " ")
	}

	reqBody := chatRequest{
		Model: "claude-haiku-4.5",
		Messages: []chatMessage{
			{Role: "user", Content: prompt},
		},
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		fmt.Printf("Error encoding request: %v\n", err)
		os.Exit(1)
	}

	apiURL := baseURL + "/api/v1/ai/chat"
	fmt.Printf("Querying Claude 3.5 via Capsule AI Bedrock Proxy...\n")
	fmt.Printf("URL:   %s\n", apiURL)
	fmt.Printf("User:  %s\n\n", prompt)

	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Error creating HTTP request: %v\n", err)
		os.Exit(1)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error making HTTP request: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Error reading response: %v\n", err)
		os.Exit(1)
	}

	if resp.StatusCode != http.StatusOK {
		fmt.Printf("❌ API returned error status %d. Response: %s\n", resp.StatusCode, string(respBody))
		os.Exit(1)
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		fmt.Printf("Error parsing JSON response: %v\n", err)
		os.Exit(1)
	}

	if len(chatResp.Choices) > 0 {
		fmt.Printf("🤖 Claude response:\n\n%s\n", chatResp.Choices[0].Message.Content)
	} else {
		fmt.Println("🤖 Received empty response choices.")
	}
}
