"""
Image proxy endpoint to solve mixed content blocking.

Fetches external images and serves them from the local origin,
solving HTTP/HTTPS mixed content issues and adding proper caching.
"""
from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.core.logging import get_logger

router = APIRouter(prefix="/image", tags=["images"])
logger = get_logger("image_proxy")

# Cache configuration
CACHE_DIR = Path(os.getenv("IMAGE_CACHE_DIR", "/tmp/thesis_image_cache"))
CACHE_DIR.mkdir(exist_ok=True)
CACHE_MAX_AGE = 86400  # 24 hours
CACHE_STALE_WHILE_REVALIDATE = 3600  # 1 hour

# Image fetch configuration
FETCH_TIMEOUT = 10.0
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/avif",
}

# User agent for fetching (some sites block default agents)
USER_AGENT = "Mozilla/5.0 (compatible; ThesisNewsBot/1.0; +https://github.com/BenderFendor/Thesis)"


def _get_cache_path(url: str) -> tuple[Path, Path]:
    """Get cache file paths for URL."""
    url_hash = hashlib.md5(url.encode()).hexdigest()
    content_path = CACHE_DIR / url_hash
    meta_path = CACHE_DIR / f"{url_hash}.meta"
    return content_path, meta_path


def _is_cache_valid(meta_path: Path) -> bool:
    """Check if cached file is still valid."""
    if not meta_path.exists():
        return False
    try:
        mtime = meta_path.stat().st_mtime
        age = time.time() - mtime
        return age < CACHE_MAX_AGE
    except Exception:
        return False


@router.get("/proxy")
async def proxy_image(
    url: str = Query(..., description="URL of the image to proxy"),
) -> Response:
    """
    Proxy external images to avoid mixed content blocking.

    Features:
    - Fetches HTTP images and serves over current protocol
    - Validates content-type is image/*
    - Caches to disk with hash-based filenames
    - Sets proper caching headers (24h cache, 1h stale-while-revalidate)
    - Returns appropriate error codes for failures
    """
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    # Validate URL format
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL scheme")

    content_path, meta_path = _get_cache_path(url)

    # Check cache
    if content_path.exists() and _is_cache_valid(meta_path):
        try:
            content = content_path.read_bytes()
            content_type = meta_path.read_text().strip()
            logger.debug("Cache HIT for %s", url[:50])
            return Response(
                content=content,
                media_type=content_type,
                headers={
                    "Cache-Control": f"public, max-age={CACHE_MAX_AGE}, stale-while-revalidate={CACHE_STALE_WHILE_REVALIDATE}",
                    "X-Cache": "HIT",
                    "X-Cache-Age": str(int(time.time() - meta_path.stat().st_mtime)),
                },
            )
        except Exception as e:
            logger.warning("Cache read error for %s: %s", url[:50], e)
            # Fall through to fetch

    # Fetch from origin
    logger.info("Fetching image: %s", url[:80])

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(FETCH_TIMEOUT),
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()

            content_type = response.headers.get("content-type", "").split(";")[0].strip()

            # Validate content type
            if content_type not in ALLOWED_CONTENT_TYPES:
                logger.warning("Unsupported content type %s for %s", content_type, url[:50])
                raise HTTPException(
                    status_code=400,
                    detail=f"IMAGE_UNSUPPORTED_TYPE: {content_type}",
                )

            # Check size
            content = response.content
            if len(content) > MAX_IMAGE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"IMAGE_TOO_LARGE: {len(content)} bytes exceeds {MAX_IMAGE_SIZE}",
                )

            # Cache to disk
            try:
                content_path.write_bytes(content)
                meta_path.write_text(content_type)
            except Exception as e:
                logger.warning("Cache write error: %s", e)
                # Continue without caching

            return Response(
                content=content,
                media_type=content_type,
                headers={
                    "Cache-Control": f"public, max-age={CACHE_MAX_AGE}, stale-while-revalidate={CACHE_STALE_WHILE_REVALIDATE}",
                    "X-Cache": "MISS",
                },
            )

    except httpx.TimeoutException:
        logger.error("Timeout fetching image: %s", url[:50])
        raise HTTPException(status_code=504, detail="IMAGE_FETCH_TIMEOUT")

    except httpx.HTTPStatusError as e:
        logger.error("HTTP error %s fetching image: %s", e.response.status_code, url[:50])
        raise HTTPException(
            status_code=502,
            detail=f"IMAGE_FETCH_FAILED: HTTP {e.response.status_code}",
        )

    except Exception as e:
        logger.error("Error fetching image %s: %s", url[:50], e)
        raise HTTPException(status_code=502, detail=f"IMAGE_FETCH_FAILED: {str(e)}")


@router.get("/cache/stats")
async def get_cache_stats() -> dict:
    """Get image cache statistics."""
    try:
        files = list(CACHE_DIR.glob("*"))
        content_files = [f for f in files if not f.suffix == ".meta"]
        total_size = sum(f.stat().st_size for f in content_files if f.exists())

        return {
            "cache_dir": str(CACHE_DIR),
            "total_files": len(content_files),
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "max_age_seconds": CACHE_MAX_AGE,
        }
    except Exception as e:
        return {"error": str(e)}


@router.delete("/cache/clear")
async def clear_cache() -> dict:
    """Clear all cached images."""
    try:
        files = list(CACHE_DIR.glob("*"))
        count = 0
        for f in files:
            try:
                f.unlink()
                count += 1
            except Exception:
                pass
        return {"cleared": count, "message": f"Cleared {count} cached files"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
