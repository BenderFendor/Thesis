"""
Lightweight Open Graph image extraction.

Fetches og:image from article URLs for articles missing images.
Designed to be fast, timeout-protected, and non-blocking.

Uses per-domain concurrency limits to maximize parallelism across
different sources while being polite to each individual domain.
"""

from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from sqlalchemy import select, or_, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.news import NewsArticle
from app.services.cache import news_cache

logger = get_logger("og_image")

httpx_logger = get_logger("httpx")
httpx_logger.setLevel("WARNING")

USER_AGENT = "Mozilla/5.0 (compatible; ScoopBot/1.0; +https://scoop.news)"
FETCH_TIMEOUT = 4.0
MAX_CONCURRENT_PER_DOMAIN = 5
MAX_RESPONSE_SIZE = 100_000

OG_IMAGE_PATTERN = re.compile(
    r'<meta[^>]+(?:property|name)=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
OG_IMAGE_PATTERN_ALT = re.compile(
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:image["\']',
    re.IGNORECASE,
)
TWITTER_IMAGE_PATTERN = re.compile(
    r'<meta[^>]+(?:property|name)=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)


def _needs_image(article: NewsArticle) -> bool:
    if not article.image or article.image == "none":
        return True
    img = article.image.lower()
    return "placeholder" in img or img.endswith(".svg")


def _get_domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return "unknown"


def _update_cache_images(found_images: Dict[int, str]) -> None:
    """Update in-memory cache with newly fetched images."""
    if not found_images:
        return

    with news_cache.lock:
        for article in news_cache.articles:
            if article.id in found_images:
                article.image = found_images[article.id]

        for source_articles in news_cache.articles_by_source.values():
            for article in source_articles:
                if article.id in found_images:
                    article.image = found_images[article.id]


def _extract_og_image_from_html(html: str) -> Optional[str]:
    match = OG_IMAGE_PATTERN.search(html)
    if match:
        return match.group(1)

    match = OG_IMAGE_PATTERN_ALT.search(html)
    if match:
        return match.group(1)

    match = TWITTER_IMAGE_PATTERN.search(html)
    if match:
        return match.group(1)

    return None


async def fetch_og_image(url: str, client: httpx.AsyncClient) -> Optional[str]:
    if not url or not url.startswith(("http://", "https://")):
        return None

    try:
        async with client.stream(
            "GET",
            url,
            timeout=FETCH_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
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

            image_url = _extract_og_image_from_html(html)
            if image_url:
                img_lower = image_url.lower()
                if img_lower.endswith(".svg") or "placeholder" in img_lower:
                    return None
            return image_url

    except httpx.TimeoutException:
        logger.debug("Timeout fetching OG image from %s", url)
    except Exception as e:
        logger.debug("Error fetching OG image from %s: %s", url, type(e).__name__)

    return None


async def enrich_articles_with_og_images(
    articles: List[NewsArticle],
    max_per_domain: int = MAX_CONCURRENT_PER_DOMAIN,
) -> Tuple[int, int]:
    """
    Enrich articles that need images by fetching og:image from their URLs.

    Uses per-domain semaphores to limit concurrent requests to each domain
    while allowing unlimited parallelism across different domains.

    Returns (total_needing, total_found) for logging.
    """
    needing_images = [(i, a) for i, a in enumerate(articles) if _needs_image(a)]

    if not needing_images:
        return 0, 0

    domain_semaphores: Dict[str, asyncio.Semaphore] = defaultdict(
        lambda: asyncio.Semaphore(max_per_domain)
    )
    found_count = 0

    async with httpx.AsyncClient() as client:

        async def fetch_one(idx: int, article: NewsArticle) -> None:
            nonlocal found_count
            domain = _get_domain(article.link)
            async with domain_semaphores[domain]:
                image_url = await fetch_og_image(article.link, client)
                if image_url:
                    articles[idx].image = image_url
                    found_count += 1

        await asyncio.gather(
            *[fetch_one(idx, article) for idx, article in needing_images],
            return_exceptions=True,
        )

    if found_count > 0:
        logger.info(
            "OG image enrichment: found %d/%d images", found_count, len(needing_images)
        )

    return len(needing_images), found_count


async def backfill_missing_images(
    session: AsyncSession,
    batch_size: int = 100,
    max_batches: Optional[int] = None,
) -> Dict[str, int]:
    """
    Backfill OG images for existing articles in the database that are missing images.

    Prioritizes sources with the fewest articles first to maximize coverage.
    Processes in batches to avoid memory issues with large datasets.
    Articles that fail to get an image are marked with "none" to avoid infinite loops.
    Returns stats dict with total_processed, total_found, total_updated.
    """
    from app.database import Article
    from sqlalchemy import func

    stats = {
        "total_processed": 0,
        "total_found": 0,
        "total_updated": 0,
        "batches": 0,
        "skipped": 0,
    }

    # Condition: needs image (NULL, empty, placeholder, svg) but not already-tried ("none")
    needs_image_condition = or_(
        Article.image_url.is_(None),
        Article.image_url == "",
        Article.image_url.like("%placeholder%"),
        Article.image_url.like("%.svg"),
    )

    source_counts_query = (
        select(Article.source, func.count(Article.id).label("cnt"))
        .where(needs_image_condition)
        .where(Article.source.isnot(None))
        .where(Article.source != "")
        .group_by(Article.source)
        .order_by(func.count(Article.id).asc())
    )
    source_result = await session.execute(source_counts_query)
    sources_with_counts = [(row.source, row.cnt) for row in source_result.fetchall()]

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

        source_processed = 0
        source_found = 0
        page = 0

        while True:
            if max_batches is not None and stats["batches"] >= max_batches:
                break

            query = (
                select(Article.id, Article.url)
                .where(Article.source == source)
                .where(needs_image_condition)
                .limit(batch_size)
            )

            result = await session.execute(query)
            rows = result.fetchall()

            if not rows:
                break

            page += 1
            stats["batches"] += 1
            stats["total_processed"] += len(rows)
            source_processed += len(rows)

            domain_semaphores: Dict[str, asyncio.Semaphore] = defaultdict(
                lambda: asyncio.Semaphore(MAX_CONCURRENT_PER_DOMAIN)
            )
            found_images: Dict[int, str] = {}
            failed_ids: List[int] = []

            async with httpx.AsyncClient() as client:

                async def fetch_one(article_id: int, url: str) -> None:
                    domain = _get_domain(url)
                    try:
                        async with domain_semaphores[domain]:
                            image_url = await fetch_og_image(url, client)
                            if image_url:
                                found_images[article_id] = image_url
                            else:
                                failed_ids.append(article_id)
                    except Exception:
                        failed_ids.append(article_id)

                await asyncio.gather(
                    *[fetch_one(row.id, row.url) for row in rows],
                    return_exceptions=True,
                )

            for article_id, image_url in found_images.items():
                await session.execute(
                    update(Article)
                    .where(Article.id == article_id)
                    .values(image_url=image_url)
                )

            for article_id in failed_ids:
                await session.execute(
                    update(Article)
                    .where(Article.id == article_id)
                    .values(image_url="none")
                )

            await session.commit()

            # Update in-memory cache so frontend sees new images immediately
            _update_cache_images(found_images)

            # Safety: if we processed rows but none were updated, something is wrong - break to avoid infinite loop
            batch_updated = len(found_images) + len(failed_ids)
            if batch_updated == 0 and len(rows) > 0:
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

            print(
                f"\r[{source_idx}/{total_sources}] {source}: "
                f"page {page}, {source_processed}/{source_article_count} articles, "
                f"{source_found} images | "
                f"Total: {stats['total_processed']}/{total_articles} "
                f"({stats['total_found']} found, {stats['skipped']} skipped)",
                end="",
                flush=True,
            )

        if source_processed > 0:
            print()

    print()
    logger.info(
        "Backfill finished: %d/%d processed, %d images found, %d skipped",
        stats["total_processed"],
        total_articles,
        stats["total_found"],
        stats["skipped"],
    )

    return stats
