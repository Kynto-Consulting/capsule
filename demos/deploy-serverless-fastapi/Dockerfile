# ──────────────────────────────────────────────────────────────
# Stage 1: Fast dependency installation using astral-sh/uv
# ──────────────────────────────────────────────────────────────
FROM astralsh/uv:0.1.29-python3.11-alpine AS builder

WORKDIR /app

# Copy dependency configuration
COPY pyproject.toml /app/

# Install dependencies into a specific directory utilizing uv pip
RUN uv pip install --system --no-cache -r pyproject.toml --target /app/dependencies

# ──────────────────────────────────────────────────────────────
# Stage 2: AWS Lambda Execution Runtime
# ──────────────────────────────────────────────────────────────
FROM public.ecr.aws/lambda/python:3.11

# Set standard working directory for AWS Lambda
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy pre-built dependencies from builder stage
COPY --from=builder /app/dependencies ${LAMBDA_TASK_ROOT}/

# Copy application source files
COPY main.py ${LAMBDA_TASK_ROOT}/

# Configure Lambda entry handler target
CMD ["main.handler"]
