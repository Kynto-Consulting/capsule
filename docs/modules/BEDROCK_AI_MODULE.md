# Product Requirements & Technical Design: AWS Bedrock AI Module

## 1. Executive Summary

This document specifies the design, requirements, and implementation blueprint for the **AWS Bedrock AI Gateway Module** for **Capsule**. This module transforms Capsule from a traditional infrastructure PaaS into a modern **AI-as-a-Service (AIaaS)** platform.

By embedding this module, Capsule enables developers to route, secure, cache, rate-limit, and audit foundation model calls via AWS Bedrock using custom, Capsule-managed API keys. The Capsule proxy provides a **100% OpenAI-compatible endpoint**, allowing developers to switch their existing OpenAI-based applications to AWS Bedrock in minutes by changing only two lines of code (the Base URL and the API Key).

---

## 2. System Architecture

Below is the request-response lifecycle for the Capsule AI Gateway proxy:

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client Application
    participant Proxy as Capsule AI Gateway (Go)
    participant Redis as Session / Cache / Rate Limiter
    participant DB as PostgreSQL Meta DB
    participant Bedrock as AWS Bedrock Service

    Client->>Proxy: POST /v1/chat/completions (with cap_sk_...)
    activate Proxy
    
    Proxy->>Redis: Check Rate Limit (Sliding Window)
    activate Redis
    Redis-->>Proxy: Rate Limit OK / Exceeded
    deactivate Redis
    
    Proxy->>DB: Validate API Key Scopes, Permissions & Monthly Budget
    activate DB
    DB-->>Proxy: Key Valid (Scopes: claude-3-5-sonnet, Budget OK)
    deactivate DB
    
    Proxy->>Redis: Check Semantic Cache (Prompt Hash)
    activate Redis
    Redis-->>Proxy: Cache Miss / Hit
    deactivate Redis
    
    alt Cache Hit
        Proxy-->>Client: Return Cached JSON Response (Immediate)
    else Cache Miss
        Proxy->>Proxy: Translate OpenAI JSON -> AWS Bedrock JSON
        Proxy->>Bedrock: InvokeModelWithResponseStream / InvokeModel
        activate Bedrock
        Bedrock-->>Proxy: Return Stream/Response (Claude Format)
        deactivate Bedrock
        
        Proxy->>Proxy: Translate Bedrock JSON -> OpenAI JSON
        Proxy->>Redis: Save to Cache (Semantic Match Hash)
        Proxy->>DB: Log Usage & Cost (Async Goroutine)
        Proxy-->>Client: Stream/Return OpenAI JSON Response
    end
    
    deactivate Proxy
```

---

## 3. Database Schema

The metadata and usage tracking for Bedrock AI are stored inside the core Capsule PostgreSQL database. Below is the Entity-Relationship Diagram:

```mermaid
erDiagram
    PROJECTS ||--o{ AI_API_KEYS : "owns"
    USERS ||--o{ AI_API_KEYS : "manages"
    AI_API_KEYS ||--o{ AI_USAGE_LOGS : "generates"
    AI_API_KEYS ||--o{ AI_GUARDRAILS : "applies"
    AI_KNOWLEDGE_BASES ||--o{ AI_KB_DOCUMENTS : "contains"
    AI_API_KEYS ||--o{ AI_KNOWLEDGE_BASES : "associated"

    AI_API_KEYS {
        uuid id PK
        string key_hash
        string name
        string prefix
        string key_type
        uuid user_id FK
        uuid project_id FK
        string_array models_allowed
        integer rate_limit_rpm
        decimal budget_monthly_usd
        decimal budget_used_usd
        integer token_limit_daily
        integer tokens_used_today
        string_array ip_whitelist
        timestamp expires_at
        timestamp last_used_at
        string status
        timestamp created_at
    }

    AI_USAGE_LOGS {
        uuid id PK
        uuid key_id FK
        string model
        integer input_tokens
        integer output_tokens
        decimal cost_usd
        integer latency_ms
        integer status_code
        boolean cached
        timestamp created_at
    }

    AI_GUARDRAILS {
        uuid id PK
        string name
        uuid org_id FK
        jsonb rules_config
        boolean enabled
        timestamp created_at
    }

    AI_KNOWLEDGE_BASES {
        uuid id PK
        string name
        uuid org_id FK
        string status
        integer document_count
        string embedding_model
        jsonb vector_db_config
        timestamp created_at
    }

    AI_KB_DOCUMENTS {
        uuid id PK
        uuid kb_id FK
        string filename
        integer file_size
        integer chunk_count
        string status
        timestamp created_at
    }
```

---

## 4. REST API Specification

All OpenAI-compatible endpoints are hosted under the AI Gateway subdomain: `https://ai.your-capsule-domain.com/v1`.

### 4.1 Chat Completions
`POST /v1/chat/completions`

**Request Headers:**
- `Authorization: Bearer cap_sk_live_1a2b3c4d5e6f7g8h9i0j`
- `Content-Type: application/json`

**Request Body Example:**
```json
{
  "model": "anthropic.claude-3-5-sonnet",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful programming assistant."
    },
    {
      "role": "user",
      "content": "Write a quicksort in Go."
    }
  ],
  "temperature": 0.2,
  "max_tokens": 1024,
  "stream": false
}
```

**Response Body Example:**
```json
{
  "id": "chatcmpl-1234567890",
  "object": "chat.completion",
  "created": 1716724000,
  "model": "anthropic.claude-3-5-sonnet",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Here is quicksort in Go:\n\n```go\npackage main...\n```"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 24,
    "completion_tokens": 182,
    "total_tokens": 206
  }
}
```

---

## 5. CLI Command Tree: `capsule ai`

The command-line interface provides complete management over models, keys, caching, and guardrails:

```bash
# List available AI foundation models enabled in Bedrock
capsule ai models list

# Enable Claude 3.5 Sonnet
capsule ai models enable anthropic.claude-3-5-sonnet

# Create an OpenAI-compatible API Key
capsule ai keys create \
  --name "production-backend" \
  --models "anthropic.claude-3-5-sonnet,meta.llama3-70b" \
  --rate-limit 60 \
  --budget 100.00 \
  --expires 30d

# Revoke an active API Key
capsule ai keys revoke cap_sk_live_1a2b3c4d...

# Flush the semantic prompt cache stored in Redis
capsule ai cache flush

# Query a Knowledge Base directly from terminal
capsule ai kb query --kb-id kb-123 "How do I deploy databases?"
```

---

## 6. AWS IAM Sub-Profile Security Policy

To operate AWS Bedrock, the Capsule backend uses a restricted sub-profile (IAM Role/User). Below is the precise IAM JSON policy conforming to the **principle of least privilege**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInference",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-v3:*",
        "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-3-5-sonnet:*",
        "arn:aws:bedrock:*:*:foundation-model/meta.llama3-*"
      ]
    },
    {
      "Sid": "BedrockMetadata",
      "Effect": "Allow",
      "Action": [
        "bedrock:ListFoundationModels",
        "bedrock:GetFoundationModel"
      ],
      "Resource": "*"
    },
    {
      "Sid": "BedrockKnowledgeBases",
      "Effect": "Allow",
      "Action": [
        "bedrock:Retrieve",
        "bedrock:RetrieveAndGenerate"
      ],
      "Resource": "arn:aws:bedrock:*:*:knowledge-base/*"
    }
  ]
}
```

---

## 7. Developer Integration Examples

### Python (OpenAI SDK Drop-in Replacement)
```python
import openai

# Route Claude calls through Capsule AI Gateway
client = openai.OpenAI(
    base_url="https://ai.your-capsule-domain.com/v1",
    api_key="cap_sk_live_xxxxxxxxxxxxxxxxxxxx"
)

response = client.chat.completions.create(
    model="anthropic.claude-3-5-sonnet",
    messages=[{"role": "user", "content": "Explain AWS Bedrock in 1 sentence."}]
)

print(response.choices[0].message.content)
```

### Node.js (OpenAI SDK)
```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://ai.your-capsule-domain.com/v1',
  apiKey: 'cap_sk_live_xxxxxxxxxxxxxxxxxxxx'
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'anthropic.claude-3-5-sonnet',
    messages: [{ role: 'user', content: 'Design a system architecture diagram for a gateway.' }],
  });
  console.log(completion.choices[0].message.content);
}
main();
```
