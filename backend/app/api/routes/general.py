from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List

from fastapi import APIRouter

from app.data.rss_sources import get_rss_sources

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
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}


@router.get("/categories")
async def get_categories() -> Dict[str, List[str]]:
    """Return configured source categories.

    The frontend calls this as a top-level endpoint.
    """

    categories = {
        info.get("category", "general") for info in get_rss_sources().values()
    }
    return {"categories": sorted(categories)}
