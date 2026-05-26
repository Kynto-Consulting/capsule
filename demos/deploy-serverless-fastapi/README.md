# FastAPI + uv + Mangum Serverless Python Demo

This demo displays a modern, fast, and multi-file Python web application set up for serverless deployments on AWS Lambda via Capsule.

## Tech Stack Highlights

1. **FastAPI**: Modern, fast web framework for building APIs with Python.
2. **uv**: An extremely fast Python package installer and resolver written in Rust. Replaces `pip`, `pip-tools`, and `virtualenv`.
3. **Mangum**: The ASGI adapter that wraps FastAPI, allowing it to handle AWS Lambda API Gateway or Function URL events.

---

## Folder Structure

- `main.py`: Core FastAPI routing, middleware, and ASGI `Mangum` handler hook.
- `pyproject.toml`: PEP 621 metadata listing external dependencies.
- `Dockerfile`: Multi-stage Docker packaging that uses `astralsh/uv` to build dependencies in seconds, and copies them to the standard AWS Lambda runtime image.

---

## Local Development & Testing

First, make sure you have `uv` installed. If you don't, you can install it using Capsule's `uv` helper or run:
```bash
# On Windows
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# On macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 1. Run the App Locally
Use `uv` to dynamically create a virtualenv and run the server without manual management:
```bash
uv venv
uv pip install -r pyproject.toml
uv run uvicorn main:app --reload --port 8000
```
Visit `http://localhost:8000` or `http://localhost:8000/docs` to see the interactive Swagger UI.

### 2. Run Tests
To run tests using `uv`:
```bash
uv run pytest
```

---

## Deploying to Capsule (Serverless)

When you deploy this project to Capsule using the serverless strategy:
1. Capsule uploads your code to an AWS S3 bucket.
2. The Capsule engine compiles the Docker image using the provided `Dockerfile`.
3. The built container is stored in Amazon Elastic Container Registry (ECR).
4. Capsule creates/updates the AWS Lambda function running this image, and routes custom DNS subdomains (via Route53/ALB) straight to your Lambda.
