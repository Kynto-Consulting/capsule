# Capsule Demo — Bedrock AI Proxy Integration

This demo shows how to consume the AWS Bedrock OpenAI-compatible proxy using a Capsule generated key.

When you generate an API key via Capsule, it produces a standard key formatted as `csk_live_...`. This key can be used directly with any OpenAI SDK or simple HTTP client to proxy directly to Claude 3.5 Sonnet / Claude 3.5 Haiku running inside AWS Bedrock, completely hiding credentials from client applications.

## How to Test

1. Generate a Bedrock API token via Capsule CLI:
   ```bash
   capsule ai keys create --name "Demo Token"
   ```
   Save the printed `Token` (`csk_live_...`).

2. Configure and run the demo script:
   ```bash
   export CAPSULE_API_URL="http://localhost:8080" # Capsule URL
   export CAPSULE_AI_TOKEN="csk_live_YOUR_GENERATED_KEY"
   
   go run chat.go "What are the benefits of AWS Bedrock?"
   ```

3. The script will send a request directly to the Capsule endpoint, which securely proxies the prompt to Amazon Bedrock and prints Claude's output!
