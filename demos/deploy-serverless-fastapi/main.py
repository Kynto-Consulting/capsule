import os
import time
from typing import Dict, Any
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel

app = FastAPI(
    title="Capsule FastAPI Serverless Demo",
    description="A multi-file serverless web application using FastAPI, uv, and Mangum.",
    version="1.0.0"
)

# Enable CORS for frontend dashboard interactions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class EchoModel(BaseModel):
    message: str
    metadata: Dict[str, Any] = {}

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Capsule Python Serverless Engine",
        "framework": "FastAPI",
        "package_manager": "uv",
        "deployment_mode": "AWS Lambda (Serverless)",
        "timestamp": time.time(),
        "environment": os.getenv("CAPSULE_ENV", "development"),
        "documentation": "/docs"
    }

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "cpu_usage_mock": "0.4%",
        "memory_usage_mock": "24MB / 128MB",
        "database_connected": True
    }

@app.get("/items/{item_id}")
def read_item(item_id: int, q: str = None):
    if item_id < 0:
        raise HTTPException(status_code=400, detail="Item ID must be positive")
    return {
        "item_id": item_id,
        "query": q,
        "details": f"This is item #{item_id} served serverless-ly from Lambda!"
    }

@app.post("/echo")
def echo_payload(payload: EchoModel, user_agent: str = Header(None)):
    return {
        "received_message": payload.message,
        "received_metadata": payload.metadata,
        "user_agent": user_agent,
        "server_time": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
    }

# Wrap the FastAPI app with Mangum to enable AWS Lambda compatibility
handler = Mangum(app, lifespan="off")
