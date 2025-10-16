from __future__ import annotations

import asyncio
import threading
import time
from typing import Optional

import httpx  # type: ignore[import-unresolved]
import requests  # type: ignore[import-unresolved]
from bs4 import BeautifulSoup  # type: ignore[import-unresolved]

from app.core.logging import get_logger
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.websocket_manager import manager

logger = get_logger("image_scraper")


async def _get_og_image_from_url(url: str) -> Optional[str]:
    if not url:
        return None
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        async with httpx.AsyncClient() as client:
            response = await client.get(
                url, headers=headers, timeout=10, follow_redirects=True
            )
            response.raise_for_status()

        soup = BeautifulSoup(response.content, "html.parser")
        og_image = soup.find("meta", property="og:image")

        if og_image and og_image.get("content"):
            image_url = og_image["content"]
            logger.info("Scraped og:image: %s from %s", image_url, url)
            return image_url
    except requests.exceptions.RequestException as exc:
        logger.warning("Could not fetch URL %s for image scraping: %s", url, exc)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Error scraping image from %s: %s", url, exc)

    return None


async def _send_image_update(article_url: str, image_url: str) -> None:
    await manager.broadcast(
        {"type": "image_update", "article_url": article_url, "image_url": image_url}
    )


async def _scrape_and_update_image(article_url: str) -> None:
    logger.info("🖼️ Starting background image scrape for: %s", article_url)
    image_url = await _get_og_image_from_url(article_url)
    if image_url:
        logger.info("✅ Found image for %s: %s", article_url, image_url)
        await _send_image_update(article_url, image_url)
    else:
        logger.info("🤷 No image found for %s", article_url)


async def scrape_missing_images(batch_size: int = 5) -> None:
    articles = news_cache.get_articles()
    articles_without_images = [article for article in articles if _needs_image(article)]

    if not articles_without_images:
        return

    logger.info(
        "🖼️ Found %s articles without images, starting scrape...",
        len(articles_without_images),
    )

    for article in articles_without_images[:batch_size]:
        try:
            await _scrape_and_update_image(article.link)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Error scraping image for %s: %s", article.link, exc)
        await asyncio.sleep(1)


def _needs_image(article: NewsArticle) -> bool:
    return not article.image or article.image.endswith("placeholder.svg")


def start_image_scraping_scheduler(interval_seconds: int = 60) -> None:
    def image_scraper() -> None:
        while True:
            try:
                asyncio.run(scrape_missing_images())
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.error("Error in image scraper: %s", exc)
            finally:
                time.sleep(interval_seconds)

    thread = threading.Thread(target=image_scraper, daemon=True)
    thread.start()
    logger.info(
        "🚀 Image scraping scheduler started (%s-second intervals)", interval_seconds
    )
