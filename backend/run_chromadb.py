#!/usr/bin/env python3
import os

os.environ["CHROMA_DB_IMPL"] = "duckdb+parquet"
os.environ["CHROMA_PERSIST_DIRECTORY"] = "/tmp/chromadb"

import uvicorn
from chromadb.server.fastapi import FastAPI

if __name__ == "__main__":
    uvicorn.run(FastAPI, host="localhost", port=8001, log_level="info")
