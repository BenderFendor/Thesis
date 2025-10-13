from __future__ import annotations

from datetime import datetime
from typing import Dict

from fastapi import APIRouter

router = APIRouter(tags=["general"])


@router.get("/", response_model=Dict[str, str])
async def read_root() -> Dict[str, str]:
    return {
        "message": "Global News Aggregation API is running!",
        "version": "1.0.0",
        "docs": "/docs",
    }


@router.get("/health")
async def health_check() -> Dict[str, str]:
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}
