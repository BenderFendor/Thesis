"""Lightweight Open Graph image extraction.

Fetches og:image from article URLs for articles missing images.
Designed to be fast, timeout-protected, and non-blocking.

Uses per-domain concurrency limits to maximize parallelism across
different sources while being polite to each individual domain.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import SCOOP_BROWSER_UA
from app.core.logging import get_logger
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.rss_parser_rust_bindings import extract_og_image_html

logger = get_logger("og_image")

httpx_logger = get_logger("httpx")
httpx_logger.setLevel("WARNING")

FETCH_TIMEOUT = 4.0
MAX_CONCURRENT_PER_DOMAIN = 5
MAX_TOTAL_CONCURRENT_FETCHES = int(os.getenv("OG_IMAGE_TOTAL_CONCURRENCY", "48"))
MAX_RESPONSE_SIZE = 100_000
OG_CACHE_MAX_AGE = 7 * 86400
OG_CACHE_DIR = Path(os.getenv("OG_IMAGE_CACHE_DIR", "/tmp/thesis_og_image_cache"))
OG_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _needs_image(article: NewsArticle) -> bool:
    if not article.image:
        return True
    img = article.image.lower()
    if img == "none":
        return False
    return "placeholder" in img or img.endswith(".svg")


def _get_domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return "unknown"


def _update_cache_images(updated_images: dict[int, str]) -> None:
    """Update in-memory cache with newly fetched image values."""
    if not updated_images:
        return

    with news_cache.lock:
        for article in news_cache.articles:
            if article.id in updated_images:
                article.image = updated_images[article.id]

        for source_articles in news_cache.articles_by_source.values():
            for article in source_articles:
                if article.id in updated_images:
                    article.image = updated_images[article.id]


def _og_cache_path(url: str) -> Path:
    url_hash = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return OG_CACHE_DIR / f"{url_hash}.json"


def _load_cached_og_metadata(url: str) -> dict[str, str] | None:
    cache_path = _og_cache_path(url)
    if not cache_path.exists():
        return None

    try:
        payload = json.loads(cache_path.read_text())
    except Exception as exc:
        logger.debug("Failed to read OG cache for %s: %s", url, exc)
        return None

    fetched_at = payload.get("fetched_at")
    try:
        fetched_ts = float(fetched_at) if fetched_at is not None else cache_path.stat().st_mtime
    except Exception:
        fetched_ts = cache_path.stat().st_mtime

    if (time.time() - fetched_ts) > OG_CACHE_MAX_AGE:
        return None

    return payload if isinstance(payload, dict) else None


def _store_cached_og_metadata(
    url: str,
    *,
    image_url: str,
    selected_source: str | None,
    error: str | None,
    error_details: str | None,
) -> None:
    cache_path = _og_cache_path(url)
    payload = {
        "url": url,
        "image_url": image_url,
        "selected_source": selected_source,
        "error": error,
        "error_details": error_details,
        "fetched_at": time.time(),
    }
    try:
        cache_path.write_text(json.dumps(payload, separators=(",", ":")))
    except Exception as exc:
        logger.debug("Failed to write OG cache for %s: %s", url, exc)


def _normalize_cached_image_value(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned or cleaned.lower() == "none":
        return None
    return cleaned if _is_valid_image_url(cleaned) else None


def _is_valid_image_url(url: str) -> bool:
    lowered = url.lower()
    return not (lowered.endswith(".svg") or "placeholder" in lowered)


def _extract_og_image_from_html(html: str) -> str | None:
    image_url, _ = _extract_og_image_candidate_from_html(html, "")
    return image_url


def _extract_og_image_candidate_from_html(
    html: str, article_url: str
) -> tuple[str | None, str | None]:
    payload = extract_og_image_html(html)
    for candidate in payload.get("candidates", []) or []:
        url = _normalize_candidate_url(candidate.get("url"), article_url)
        if not url:
            continue
        source = candidate.get("source") or "og:image"
        return url, source
    return None, None


def _normalize_candidate_url(candidate: object, article_url: str) -> str | None:
    if not isinstance(candidate, str):
        return None
    cleaned = candidate.strip()
    if not cleaned:
        return None
    if cleaned.startswith("//"):
        cleaned = f"https:{cleaned}"
    elif article_url and not cleaned.startswith(("http://", "https://")):
        cleaned = urljoin(article_url, cleaned)
    return cleaned if _is_valid_image_url(cleaned) else None


async def _download_og_html(client: httpx.AsyncClient, url: str) -> str | None:
    """Stream the HTML body for an OG image fetch; None on non-HTML response."""
    async with client.stream(
        "GET",
        url,
        timeout=FETCH_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": SCOOP_BROWSER_UA},
    ) as response:
        if response.status_code != 200:
            return None

        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type.lower():
            return None

        chunks = []
        total = 0
        async for chunk in response.aiter_bytes(chunk_size=8192):
            chunks.append(chunk)
            total += len(chunk)
            if total >= MAX_RESPONSE_SIZE:
                break

        html = b"".join(chunks).decode("utf-8", errors="ignore")
        head_end = html.lower().find("</head>")
        if head_end > 0:
            html = html[: head_end + 7]
        return html


def _cache_og_result(
    url: str,
    image_url: str | None,
    error: str | None,
    selected_source: str | None = None,
    error_details: str | None = None,
) -> None:
    """Store the cache entry describing the OG fetch outcome."""
    _store_cached_og_metadata(
        url,
        image_url=image_url or "none",
        selected_source=selected_source,
        error=error,
        error_details=error_details,
    )


async def fetch_og_image(url: str, client: httpx.AsyncClient) -> str | None:
    """Fetch Og Image."""
    if not url or not url.startswith(("http://", "https://")):
        return None

    cached = _load_cached_og_metadata(url)
    if cached is not None:
        cached_image = _normalize_cached_image_value(cached.get("image_url"))
        logger.debug("OG cache hit for %s", url)
        return cached_image

    try:
        html = await _download_og_html(client, url)
        if html is None:
            return None

        image_url, selected_source = _extract_og_image_candidate_from_html(html, url)
        if image_url:
            _cache_og_result(url, image_url, None, selected_source=selected_source)
            return image_url

        _cache_og_result(
            url,
            None,
            "OG_IMAGE_NOT_FOUND",
            error_details="No og:image or twitter:image found",
        )
        return image_url

    except httpx.TimeoutException:
        logger.debug("Timeout fetching OG image from %s", url)
        _cache_og_result(
            url,
            image_url=None,
            error="IMAGE_FETCH_TIMEOUT",
            error_details=f"Timeout fetching {url}",
        )
    except Exception as e:
        logger.debug("Error fetching OG image from %s: %s", url, type(e).__name__)
        _cache_og_result(
            url,
            image_url=None,
            error="IMAGE_FETCH_FAILED",
            error_details=type(e).__name__,
        )

    return None


async def enrich_articles_with_og_images(
    articles: list[NewsArticle],
    max_per_domain: int = MAX_CONCURRENT_PER_DOMAIN,
    max_total_concurrency: int = MAX_TOTAL_CONCURRENT_FETCHES,
) -> tuple[int, int]:
    """Enrich articles that need images by fetching og:image from their URLs.

    Uses per-domain semaphores to limit concurrent requests to each domain
    while allowing unlimited parallelism across different domains.

    Returns (total_needing, total_found) for logging.
    """
    needing_images = [(i, a) for i, a in enumerate(articles) if _needs_image(a)]

    if not needing_images:
        return 0, 0

    domain_semaphores: dict[str, asyncio.Semaphore] = defaultdict(
        lambda: asyncio.Semaphore(max_per_domain)
    )
    total_semaphore = asyncio.Semaphore(max(1, max_total_concurrency))
    found_count = 0

    async with httpx.AsyncClient() as client:

        async def fetch_one(idx: int, article: NewsArticle) -> None:
            """Fetch One."""
            nonlocal found_count
            domain = _get_domain(article.link)
            async with total_semaphore, domain_semaphores[domain]:
                image_url = await fetch_og_image(article.link, client)
                articles[idx].image = image_url or "none"
                if image_url:
                    found_count += 1

        await asyncio.gather(
            *[fetch_one(idx, article) for idx, article in needing_images],
            return_exceptions=True,
        )

    if found_count > 0:
        logger.info("OG image enrichment: found %d/%d images", found_count, len(needing_images))

    return len(needing_images), found_count


def _missing_image_condition() -> Any:
    """SQLAlchemy predicate for articles that still need an image."""
    from app.database import Article

    return or_(
        Article.image_url.is_(None),
        Article.image_url == "",
        Article.image_url.like("%placeholder%"),
        Article.image_url.like("%.svg"),
    )


async def _articles_needing_images(
    session: AsyncSession,
) -> list[tuple[Any, int]]:
    """Return (source, article count) pairs for sources with missing images, fewest first."""
    from app.database import Article
    from sqlalchemy import func

    source_counts_query = (
        select(Article.source, func.count(Article.id).label("cnt"))
        .where(_missing_image_condition())
        .where(Article.source.isnot(None))
        .where(Article.source != "")
        .group_by(Article.source)
        .order_by(func.count(Article.id).asc())
    )
    source_result = await session.execute(source_counts_query)
    return [(row.source, row.cnt) for row in source_result.fetchall()]


async def _fetch_batch_rows(
    session: AsyncSession,
    source: str,
    batch_size: int,
) -> Sequence[Any]:
    """Fetch up to batch_size still-needing-image articles for one source."""
    from app.database import Article

    query = (
        select(Article.id, Article.url)
        .where(Article.source == source)
        .where(_missing_image_condition())
        .limit(batch_size)
    )
    result = await session.execute(query)
    return result.fetchall()


async def _fetch_article_image(
    article_id: int,
    url: str,
    total_sem: asyncio.Semaphore,
    domain_sems: dict[str, asyncio.Semaphore],
    http_client: httpx.AsyncClient,
) -> tuple[int, str | None]:
    """Fetch the og:image for one article; None when missing or on any failure."""
    domain = _get_domain(url)
    try:
        async with total_sem, domain_sems[domain]:
            return article_id, await fetch_og_image(url, http_client)
    except Exception:
        return article_id, None


async def _backfill_batch_fetch(
    rows: Sequence[Any],
) -> tuple[dict[int, str], list[int], dict[int, str]]:
    """Fetch og:images for one batch; returns (found, failed, all-updated) maps."""
    domain_semaphores: dict[str, asyncio.Semaphore] = defaultdict(
        lambda: asyncio.Semaphore(MAX_CONCURRENT_PER_DOMAIN)
    )
    total_semaphore = asyncio.Semaphore(max(1, MAX_TOTAL_CONCURRENT_FETCHES))
    async with httpx.AsyncClient() as client:
        outcomes = await asyncio.gather(
            *[
                _fetch_article_image(row.id, row.url, total_semaphore, domain_semaphores, client)
                for row in rows
            ],
            return_exceptions=True,
        )
    found_images: dict[int, str] = {}
    failed_ids: list[int] = []
    for outcome in outcomes:
        if not isinstance(outcome, tuple):
            continue
        article_id, image_url = outcome
        if image_url:
            found_images[article_id] = image_url
        else:
            failed_ids.append(article_id)
    updated_images = dict(found_images)
    for article_id in failed_ids:
        updated_images[article_id] = "none"
    return found_images, failed_ids, updated_images


async def _apply_image_updates(
    session: AsyncSession,
    found_images: dict[int, str],
    failed_ids: list[int],
) -> None:
    """Persist fetched images and "none" markers for failed articles."""
    from app.database import Article

    for article_id, image_url in found_images.items():
        await session.execute(
            update(Article).where(Article.id == article_id).values(image_url=image_url)
        )
    for article_id in failed_ids:
        await session.execute(
            update(Article).where(Article.id == article_id).values(image_url="none")
        )
    await session.commit()


def _print_backfill_progress(
    source_idx: int,
    total_sources: int,
    source: str,
    page: int,
    source_processed: int,
    source_article_count: int,
    source_found: int,
    stats: dict[str, int],
    total_articles: int,
) -> None:
    print(
        f"\r[{source_idx}/{total_sources}] {source}: "
        f"page {page}, {source_processed}/{source_article_count} articles, "
        f"{source_found} images | "
        f"Total: {stats['total_processed']}/{total_articles} "
        f"({stats['total_found']} found, {stats['skipped']} skipped)",
        end="",
        flush=True,
    )


async def _backfill_source(
    session: AsyncSession,
    source: str,
    source_article_count: int,
    stats: dict[str, int],
    batch_size: int,
    max_batches: int | None,
    total_sources: int,
    total_articles: int,
    source_idx: int,
) -> tuple[int, int]:
    """Backfill one source fully; returns (processed, found) totals."""
    source_processed = 0
    source_found = 0
    page = 0
    while True:
        if max_batches is not None and stats["batches"] >= max_batches:
            break
        rows = await _fetch_batch_rows(session, source, batch_size)
        if not rows:
            break
        page += 1
        stats["batches"] += 1
        stats["total_processed"] += len(rows)
        source_processed += len(rows)

        found_images, failed_ids, updated_images = await _backfill_batch_fetch(rows)
        await _apply_image_updates(session, found_images, failed_ids)
        _update_cache_images(updated_images)

        # Safety: if we processed rows but none were updated, something is wrong -
        # break to avoid an infinite loop.
        if not found_images and not failed_ids:
            logger.warning(
                "Backfill: processed %d rows but none were updated for %s, breaking to avoid infinite loop",
                len(rows),
                source,
            )
            break

        stats["total_found"] += len(found_images)
        stats["total_updated"] += len(found_images)
        stats["skipped"] += len(failed_ids)
        source_found += len(found_images)

        _print_backfill_progress(
            source_idx,
            total_sources,
            source,
            page,
            source_processed,
            source_article_count,
            source_found,
            stats,
            total_articles,
        )
    if source_processed > 0:
        print()
    return source_processed, source_found


async def backfill_missing_images(
    session: AsyncSession,
    batch_size: int = 100,
    max_batches: int | None = None,
) -> dict[str, int]:
    """Backfill OG images for existing articles in the database that are missing images.

    Prioritizes sources with the fewest articles first to maximize coverage.
    Processes in batches to avoid memory issues with large datasets.
    Articles that fail to get an image are marked with "none" to avoid infinite loops.
    Returns stats dict with total_processed, total_found, total_updated.
    """
    stats = {
        "total_processed": 0,
        "total_found": 0,
        "total_updated": 0,
        "batches": 0,
        "skipped": 0,
    }

    sources_with_counts = await _articles_needing_images(session)
    if not sources_with_counts:
        logger.info("Backfill complete: no articles without images")
        return stats

    total_sources = len(sources_with_counts)
    total_articles = sum(cnt for _, cnt in sources_with_counts)

    logger.info(
        "Backfill starting: %d sources, %d articles missing images",
        total_sources,
        total_articles,
    )

    for source_idx, (source, source_article_count) in enumerate(sources_with_counts, 1):
        if max_batches is not None and stats["batches"] >= max_batches:
            break
        await _backfill_source(
            session,
            source,
            source_article_count,
            stats,
            batch_size,
            max_batches,
            total_sources,
            total_articles,
            source_idx,
        )

    print()
    logger.info(
        "Backfill finished: %d/%d processed, %d images found, %d skipped",
        stats["total_processed"],
        total_articles,
        stats["total_found"],
        stats["skipped"],
    )
    return stats
