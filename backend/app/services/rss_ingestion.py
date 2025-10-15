from __future__ import annotations

import asyncio
import concurrent.futures
import json
import random
import threading
import time
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, Iterable, List, Tuple
from urllib.parse import urljoin, urlparse

import feedparser  # type: ignore[import-unresolved]
import requests

from app.core.config import settings
from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.persistence import persist_articles_dual_write
from app.services.websocket_manager import manager

logger = get_logger("rss_ingestion")
stream_logger = get_logger("news_stream")


_SAMPLE_ARTICLES_SEED: List[Dict[str, Any]] = [
    {
        "title": "Global Markets Rally on Technological Breakthrough",
        "link": "https://example.com/markets-tech-breakthrough",
        "description": "Major indices surged worldwide after a breakthrough in quantum battery technology promised faster charging for electric vehicles.",
        "source": "Tech Horizons Daily",
        "category": "technology",
        "image": "https://images.example.com/tech-battery.jpg",
        "country": "US",
        "bias_rating": "center",
    },
    {
        "title": "Climate Accord Reached at Emergency Summit",
        "link": "https://example.com/climate-accord",
        "description": "Leaders from 40 nations agreed to accelerate carbon reduction commitments, introducing a global clean-energy financing framework.",
        "source": "World Policy Ledger",
        "category": "environment",
        "image": "https://images.example.com/climate-accord.jpg",
        "country": "UK",
        "bias_rating": "left",
    },
    {
        "title": "Rural Healthcare Initiative Expands Telemedicine",
        "link": "https://example.com/telemedicine-expansion",
        "description": "A public-private partnership will deploy telemedicine hubs across underserved rural regions, aiming to cut critical response times by 35%.",
        "source": "Health Access Now",
        "category": "health",
        "image": "https://images.example.com/telemedicine.jpg",
        "country": "CA",
        "bias_rating": "center",
    },
    {
        "title": "Breakthrough Agricultural Drones Boost Crop Yields",
        "link": "https://example.com/agri-drones",
        "description": "Autonomous drones equipped with adaptive AI analytics have increased rice crop yields by 18% in early trials.",
        "source": "AgriTech Insight",
        "category": "economy",
        "image": "https://images.example.com/agri-drones.jpg",
        "country": "IN",
        "bias_rating": "right",
    },
    {
        "title": "Education Reform Pilot Shows Promising Results",
        "link": "https://example.com/education-reform",
        "description": "Students in a competency-based learning program outperformed peers by two grade levels in literacy and STEM assessments.",
        "source": "Scholars' Chronicle",
        "category": "education",
        "image": "https://images.example.com/education-reform.jpg",
        "country": "AU",
        "bias_rating": "center",
    },
]


def get_sample_articles() -> Tuple[List[NewsArticle], List[Dict[str, Any]]]:
    sample_articles: List[NewsArticle] = []
    stats_by_source: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "article_count": 0,
        "category": "general",
        "country": "US",
        "bias_rating": None,
    })

    for seed in _SAMPLE_ARTICLES_SEED:
        article = NewsArticle(
            title=seed["title"],
            link=seed["link"],
            description=seed["description"],
            published=seed.get("published", datetime.now().isoformat()),
            source=seed["source"],
            category=seed.get("category", "general"),
            image=seed.get("image"),
        )
        sample_articles.append(article)

        stat = stats_by_source[article.source]
        stat["article_count"] += 1
        stat["category"] = article.category
        stat["country"] = seed.get("country", stat["country"])
        stat["bias_rating"] = seed.get("bias_rating", stat["bias_rating"])
        stat["name"] = article.source
        stat["url"] = seed.get("link")

    sample_stats: List[Dict[str, Any]] = []
    now_iso = datetime.now().isoformat()
    for source, stat in stats_by_source.items():
        sample_stats.append(
            {
                "name": source,
                "url": stat.get("url"),
                "category": stat.get("category", "general"),
                "country": stat.get("country", "US"),
                "funding_type": None,
                "bias_rating": stat.get("bias_rating"),
                "article_count": stat.get("article_count", 0),
                "status": "sample",
                "error_message": "Loaded from local sample dataset",
                "last_checked": now_iso,
            }
        )

    return sample_articles, sample_stats


def _iter_source_urls(url_field: Any) -> Iterable[str]:
    if isinstance(url_field, str):
        yield url_field
    elif isinstance(url_field, (list, tuple)):
        for url in url_field:
            if isinstance(url, str):
                yield url


def parse_rss_feed(url: str, source_name: str, source_info: Dict[str, Any]) -> List[NewsArticle]:
    try:
        feed = feedparser.parse(url, agent="NewsAggregator/1.0")
        articles: List[NewsArticle] = []

        if getattr(feed, "bozo", False):
            logger.warning("Feed parsing warning for %s: %s", source_name, getattr(feed, "bozo_exception", "Unknown error"))

        if hasattr(feed, "status") and feed.status >= 400:
            logger.error("HTTP error %s for %s: %s", feed.status, source_name, url)
            return []

        if not getattr(feed, "entries", None):
            logger.warning("No entries found for %s: %s", source_name, url)
            return []

        channel_image_url = None
        if hasattr(feed, "feed") and getattr(feed.feed, "image", None):
            image = feed.feed.image
            if isinstance(image, dict):
                channel_image_url = image.get("url") or image.get("href")

        for entry in feed.entries:
            image_url = _extract_image_from_entry(entry)
            if not image_url and channel_image_url:
                image_url = channel_image_url

            title = entry.get("title", "No title")
            description = entry.get("description", "No description")

            title = _clean_text(title)
            description = _clean_text(description)

            if image_url and not image_url.startswith(("http://", "https://")):
                try:
                    parsed_url = urlparse(url)
                    base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"
                    image_url = urljoin(base_url, image_url)
                except Exception:
                    image_url = None

            article_link = entry.get("link", "") or getattr(feed.feed, "link", url)
            article = NewsArticle(
                title=title,
                link=article_link,
                description=description,
                published=entry.get("published", str(datetime.now())),
                source=source_name,
                category=source_info.get("category", "general"),
                image=image_url,
            )
            articles.append(article)

        logger.info("Successfully parsed %s articles from %s", len(articles), source_name)
        return articles
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Error parsing %s: %s", source_name, exc)
        return []


def _clean_text(value: str) -> str:
    import html
    import re

    decoded = html.unescape(value)
    decoded = re.sub(r"<[^>]+>", " ", decoded)
    decoded = re.sub(r"\s+", " ", decoded)
    return decoded.strip()


def _extract_image_from_entry(entry: Any) -> str | None:
    import re

    image_url = None

    if hasattr(entry, "content") and entry.content:
        content_text = entry.content[0].value if isinstance(entry.content, list) else str(entry.content)
        match = re.search(r"<img[^>]+src=\"([^\"]+)\"", content_text)
        if match:
            image_url = match.group(1)

    if not image_url and getattr(entry, "media_thumbnail", None):
        thumb = entry.media_thumbnail
        try:
            if isinstance(thumb, list) and thumb:
                first = thumb[0]
                if isinstance(first, dict):
                    url_field = first.get("url") or first.get("href")
                    image_url = _flatten_thumbnail(url_field)
            elif isinstance(thumb, dict):
                url_field = thumb.get("url") or thumb.get("href")
                image_url = _flatten_thumbnail(url_field)
        except Exception:
            pass

    if not image_url and getattr(entry, "media_content", None):
        for media in entry.media_content:
            if media.get("type", "").startswith("image/"):
                image_url = media.get("url")
                break

    if not image_url and getattr(entry, "enclosures", None):
        for enclosure in entry.enclosures:
            if enclosure.get("type", "").startswith("image/"):
                image_url = enclosure.get("href")
                break

    if not image_url and getattr(entry, "links", None):
        for link in entry.links:
            if link.get("type", "").startswith("image/"):
                image_url = link.get("href")
                break

    if not image_url and entry.get("description"):
        match = re.search(r"<img[^>]+src=\"([^\"]+)\"", entry.description)
        if match:
            image_url = match.group(1)

    if not image_url and getattr(entry, "content_encoded", None):
        match = re.search(r"<img[^>]+src=\"([^\"]+)\"", entry.content_encoded)
        if match:
            image_url = match.group(1)

    if not image_url and getattr(entry, "links", None):
        for link in entry.links:
            href = link.get("href", "")
            if re.search(r"\.(jpg|jpeg|png|gif)$", href, re.IGNORECASE):
                image_url = href
                break

    return image_url


def _flatten_thumbnail(url_field: Any) -> str | None:
    if isinstance(url_field, str):
        return url_field
    if isinstance(url_field, dict):
        return url_field.get("url") or url_field.get("href")
    if isinstance(url_field, list) and url_field:
        first_inner = url_field[0]
        if isinstance(first_inner, dict):
            return first_inner.get("url") or first_inner.get("href")
        if isinstance(first_inner, str):
            return first_inner
    return None


def get_rss_as_json(url: str, source_name: str) -> Tuple[Dict[str, Any], Any]:
    max_retries = 3
    base_delay = 5
    for attempt in range(max_retries):
        try:
            headers = {
                "User-Agent": "NewsAggregator/1.0 (RSS to JSON converter)",
                "Accept": "application/rss+xml, application/xml, text/xml, */*",
            }
            response = requests.get(url, headers=headers, timeout=60)
            response.raise_for_status()

            content = response.text.strip().lstrip("\ufeff\xff\xfe")
            feed = feedparser.parse(content)

            feed_json = {
                "feed_info": {
                    "title": getattr(feed.feed, "title", ""),
                    "description": getattr(feed.feed, "description", ""),
                    "link": getattr(feed.feed, "link", ""),
                    "updated": getattr(feed.feed, "updated", ""),
                    "language": getattr(feed.feed, "language", ""),
                },
                "status": getattr(feed, "status", None),
                "bozo": getattr(feed, "bozo", False),
                "bozo_exception": str(getattr(feed, "bozo_exception", "")),
                "total_entries": len(feed.entries),
                "entries": [],
            }

            for entry in feed.entries[:3]:
                feed_json["entries"].append(
                    {
                        "title": getattr(entry, "title", ""),
                        "link": getattr(entry, "link", ""),
                        "description": getattr(entry, "description", "")[:200],
                        "published": getattr(entry, "published", ""),
                        "author": getattr(entry, "author", ""),
                    }
                )

            return feed_json, feed
        except (requests.exceptions.RequestException, OSError) as exc:
            logger.warning("Attempt %s/%s failed for %s: %s", attempt + 1, max_retries, source_name, exc)
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                logger.info("Retrying %s in %.2fs...", source_name, delay)
                time.sleep(delay)
            else:
                logger.error("All retries failed for %s: %s", source_name, exc)
                feed = feedparser.parse(url, agent="NewsAggregator/1.0")
                return {"error": str(exc), "fallback": True}, feed


def _process_source(source_name: str, source_info: Dict[str, Any]) -> Tuple[List[NewsArticle], Dict[str, Any]]:
    articles: List[NewsArticle] = []
    feed_status = "success"
    error_message: str | None = None

    for url in _iter_source_urls(source_info.get("url")):
        feed_json, feed = get_rss_as_json(url, source_name)

        if source_name in {"Novara Media", "CNN Politics"}:
            logger.info("📄 RSS JSON for %s: %s", source_name, json.dumps(feed_json, indent=2))

        if hasattr(feed, "status") and feed.status >= 400:
            feed_status = "error"
            error_message = f"HTTP {feed.status} error"
            logger.error("❌ HTTP %s for %s: %s", feed.status, source_name, url)
            continue
        if getattr(feed, "bozo", False):
            feed_status = "warning"
            bozo_error = str(getattr(feed, "bozo_exception", "Unknown error"))
            error_message = f"Parse warning: {bozo_error}"
            parsed_articles = parse_rss_feed_entries(feed.entries, source_name, source_info)
            articles.extend(parsed_articles)
            logger.warning("⚠️ XML parsing issue for %s: %s (got %s articles)", source_name, bozo_error, len(parsed_articles))
        elif not getattr(feed, "entries", None):
            feed_status = "warning"
            error_message = "No articles found in feed"
            logger.warning("⚠️ No entries found for %s: %s", source_name, url)
            continue
        else:
            parsed_articles = parse_rss_feed_entries(feed.entries, source_name, source_info)
            articles.extend(parsed_articles)
            logger.info("✅ Parsed %s articles from %s (%s)", len(parsed_articles), source_name, url)

    if articles:
        persist_articles_dual_write(articles, {**source_info, "name": source_name, "source": source_name})

    source_stat = {
        "name": source_name,
        "url": source_info.get("url"),
        "category": source_info.get("category", "general"),
        "country": source_info.get("country", "US"),
        "funding_type": source_info.get("funding_type"),
        "bias_rating": source_info.get("bias_rating"),
        "article_count": len(articles),
        "status": feed_status,
        "error_message": error_message,
        "last_checked": datetime.now().isoformat(),
    }
    return articles, source_stat


def _process_source_with_debug(source_name: str, source_info: Dict[str, Any], stream_id: str) -> Tuple[List[NewsArticle], Dict[str, Any]]:
    stream_logger.debug("🔍 Stream %s processing source: %s", stream_id, source_name)
    start_time = time.time()
    articles, source_stat = _process_source(source_name, source_info)
    processing_time = time.time() - start_time

    stream_logger.info(
        "⚡ Stream %s processed %s in %.2fs: %s articles, status: %s",
        stream_id,
        source_name,
        processing_time,
        len(articles),
        source_stat.get("status"),
    )

    source_stat.update(
        {
            "stream_id": stream_id,
            "processing_time_seconds": round(processing_time, 2),
        }
    )
    return articles, source_stat


def refresh_news_cache() -> None:
    if news_cache.update_in_progress:
        logger.info("Cache update already in progress, skipping...")
        return

    news_cache.update_in_progress = True
    all_articles: List[NewsArticle] = []
    source_stats: List[Dict[str, Any]] = []
    source_last_processed: Dict[str, float] = {}

    rss_sources = get_rss_sources()

    def partial_update_callback(new_articles: List[NewsArticle], new_source_stat: Dict[str, Any]) -> None:
        logger.info("[Partial] Loaded %s articles from %s", len(new_articles), new_source_stat["name"])

    throttle_interval = 20

    def throttled_process_source(name: str, info: Dict[str, Any]) -> Tuple[List[NewsArticle], Dict[str, Any]]:
        now = time.time()
        elapsed = now - source_last_processed.get(name, 0)
        if elapsed < throttle_interval:
            sleep_time = throttle_interval - elapsed
            logger.info("Throttling %s: Sleeping %.1fs", name, sleep_time)
            time.sleep(sleep_time)
        source_last_processed[name] = time.time()
        return _process_source(name, info)

    if settings.enable_live_ingestion:
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(throttled_process_source, name, info): name for name, info in rss_sources.items()}
            for future in concurrent.futures.as_completed(futures):
                source_name = futures[future]
                try:
                    articles, source_stat = future.result()
                    all_articles.extend(articles)
                    source_stats.append(source_stat)
                    partial_update_callback(articles, source_stat)
                except Exception as exc:  # pragma: no cover
                    logger.error("💥 Exception for %s: %s", source_name, exc)
                    info = rss_sources[source_name]
                    source_stats.append(
                        {
                            "name": source_name,
                            "url": info.get("url"),
                            "category": info.get("category", "general"),
                            "country": info.get("country", "US"),
                            "funding_type": info.get("funding_type"),
                            "bias_rating": info.get("bias_rating"),
                            "article_count": 0,
                            "status": "error",
                            "error_message": str(exc),
                            "last_checked": datetime.now().isoformat(),
                        }
                    )
    else:
        logger.info("🌐 Live RSS ingestion disabled (ENABLE_LIVE_INGESTION is false). Using sample dataset only.")

    if not all_articles:
        logger.warning("⚠️ Live RSS ingestion returned 0 articles; loading local sample dataset instead")
        sample_articles, sample_stats = get_sample_articles()
        if sample_articles:
            all_articles = sample_articles
            source_stats = sample_stats
            logger.info("🧪 Loaded %s sample articles from fallback dataset", len(sample_articles))
        else:
            logger.error("❌ Sample dataset unavailable; cache will remain empty")

    try:
        all_articles.sort(key=lambda article: article.published, reverse=True)
    except Exception:
        pass

    news_cache.update_cache(all_articles, source_stats)
    logger.info("✅ Cache refresh completed: %s total articles", len(all_articles))

    async def notify_clients() -> None:
        await manager.broadcast(
            {
                "type": "cache_updated",
                "message": "News cache has been updated",
                "timestamp": datetime.now().isoformat(),
                "stats": {
                    "total_articles": len(all_articles),
                    "sources_processed": len(source_stats),
                },
            }
        )

    try:
        asyncio.run(notify_clients())
    except RuntimeError:
        loop = asyncio.get_event_loop()
        loop.create_task(notify_clients())

    if not all_articles:
        logger.warning("⚠️ Cache refresh resulted in 0 articles even after fallback! Check RSS sources and sample dataset.")
        working_sources = [s for s in source_stats if s.get("status") == "success"]
        error_sources = [s for s in source_stats if s.get("status") == "error"]
        logger.info("📊 Source status: %s working, %s with errors", len(working_sources), len(error_sources))
    else:
        category_counts: Dict[str, int] = {}
        for article in all_articles:
            category_counts[article.category] = category_counts.get(article.category, 0) + 1
        logger.info("📊 Articles by category: %s", category_counts)

    news_cache.update_in_progress = False


def parse_rss_feed_entries(entries: Iterable[Any], source_name: str, source_info: Dict[str, Any]) -> List[NewsArticle]:
    articles: List[NewsArticle] = []
    for entry in entries:
        image_url = _extract_image_from_entry(entry)

        title = _clean_text(entry.get("title", "No title"))
        description = _clean_text(entry.get("description", "No description"))

        if image_url and not image_url.startswith(("http://", "https://")):
            try:
                parsed_url = urlparse(source_info.get("url", ""))
                base_url = f"{parsed_url.scheme}://{parsed_url.netloc}" if parsed_url.scheme and parsed_url.netloc else ""
                image_url = urljoin(base_url, image_url) if base_url else None
            except Exception:
                image_url = None

        article = NewsArticle(
            title=title,
            link=entry.get("link", ""),
            description=description,
            published=entry.get("published", str(datetime.now())),
            source=source_name,
            category=source_info.get("category", "general"),
            image=image_url,
        )
        articles.append(article)

    return articles


def start_cache_refresh_scheduler(interval_seconds: int = 30) -> None:
    def cache_scheduler() -> None:
        while True:
            try:
                refresh_news_cache()
                time.sleep(interval_seconds)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.error("Error in cache scheduler: %s", exc)
                time.sleep(interval_seconds)

    thread = threading.Thread(target=cache_scheduler, daemon=True)
    thread.start()
    logger.info("🚀 Cache refresh scheduler started (%s-second intervals)", interval_seconds)
