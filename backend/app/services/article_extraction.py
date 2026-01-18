"""
Article extraction service for full-text content retrieval and processing.

Provides functionality to extract, cache, and serve full article content
for the reading queue and reader mode.
"""

from typing import Dict, Any, Optional
import asyncio
import re
from html import unescape
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from newspaper import Article, Config  # type: ignore[import-unresolved]

from app.core.logging import get_logger
from app.services.debug_logger import debug_logger, EventType

logger = get_logger("article_extraction")
DEFAULT_REQUEST_TIMEOUT = 12

try:  # Optional Rust HTML extraction
    import rss_parser_rust  # type: ignore

    RUST_HTML_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    RUST_HTML_AVAILABLE = False


async def extract_article_full_text(url: str) -> Dict[str, Any]:
    """
    Extract full article content from a URL using newspaper3k.

    Returns a dictionary with:
        - success: bool indicating if extraction was successful
        - text: full article text (if successful)
        - title: article title
        - authors: list of authors
        - publish_date: publication date
        - top_image: main image URL
        - error: error message (if unsuccessful)
    """
    try:
        # Run extraction in thread pool to avoid blocking
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, _extract_sync, url)
        return result
    except Exception as exc:  # pragma: no cover
        logger.error("Error extracting article from %s: %s", url, exc)
        return {"success": False, "error": str(exc), "text": None}


def _extract_sync(url: str) -> Dict[str, Any]:
    """
    Synchronous extraction helper (runs in executor).

    This is a blocking operation that uses newspaper3k to download and
    parse the article.
    """
    if _is_paywalled_source(url):
        return {
            "success": False,
            "error": "Paywalled source blocked",
            "text": None,
        }
    try:
        config = Config()
        config.browser_user_agent = (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        config.request_timeout = DEFAULT_REQUEST_TIMEOUT
        article = Article(url, config=config)
        article.download()
        html = article.html or ""
        rebelmouse_payload = _extract_rebelmouse_article(url, html)
        if rebelmouse_payload:
            logger.info("RebelMouse extraction used for %s", url)
            return rebelmouse_payload
        if RUST_HTML_AVAILABLE and html:
            rust_payload = _extract_with_rust(html)
            if rust_payload.get("text"):
                rust_payload["html"] = html
                return {"success": True, **rust_payload}

        article.parse()

        return {
            "success": True,
            "text": article.text,
            "title": article.title,
            "authors": article.authors,
            "publish_date": str(article.publish_date) if article.publish_date else None,
            "top_image": article.top_image,
            "images": list(article.images),
            "keywords": getattr(article, "keywords", []),
            "meta_description": getattr(article, "meta_description", None),
            "html": html,
        }
    except Exception as e:
        logger.error("Sync extraction failed for %s: %s", url, e)
        debug_logger.log_event(
            EventType.REQUEST_ERROR,
            component="article_extraction",
            operation="extract",
            message="Article extraction failed",
            details={"url": url},
            error=e,
        )
        return {
            "success": False,
            "error": str(e),
            "text": None,
        }


def extract_article_content(url: str) -> Dict[str, Any]:
    """Blocking helper for contexts that cannot await coroutines."""
    if _is_paywalled_source(url):
        return {
            "success": False,
            "error": "Paywalled source blocked",
            "text": None,
        }
    return _extract_sync(url)


def _is_paywalled_source(url: str) -> bool:
    if not url:
        return False
    lowered = url.lower()
    blocked_domains = [
        "nytimes.com",
        "wsj.com",
        "reuters.com",
        "ft.com",
        "bloomberg.com",
        "economist.com",
    ]
    return any(domain in lowered for domain in blocked_domains)


def _extract_with_rust(html: str) -> Dict[str, Any]:
    """Extract article content via Rust HTML parser."""
    try:
        payload = rss_parser_rust.extract_article_html(html)
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.debug("Rust HTML extraction failed: %s", exc)
        return {}

    return {
        "text": payload.get("text"),
        "title": payload.get("title"),
        "authors": payload.get("authors") or [],
        "publish_date": payload.get("publish_date"),
        "top_image": payload.get("top_image"),
        "images": payload.get("images") or [],
        "keywords": [],
        "meta_description": payload.get("meta_description"),
    }


def _extract_rebelmouse_article(url: str, html: str) -> Optional[Dict[str, Any]]:
    if not html:
        return None
    match = re.search(r'"fullBootstrapUrl"\s*:\s*"([^"]+)"', html)
    if not match:
        logger.debug("RebelMouse bootstrap URL not found for %s", url)
        return None

    try:
        bootstrap_path = match.group(1).encode("utf-8").decode("unicode_escape")
        bootstrap_url = urljoin(url, bootstrap_path)
        response = requests.get(
            bootstrap_url,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=DEFAULT_REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            logger.debug(
                "RebelMouse bootstrap request failed for %s (status %s)",
                url,
                response.status_code,
            )
            return None
        data = response.json()
    except Exception as exc:
        logger.debug("RebelMouse bootstrap parse failed for %s: %s", url, exc)
        return None

    post = data.get("post", {})
    body_html = post.get("body")
    if not isinstance(body_html, str) or not body_html.strip():
        logger.debug("RebelMouse body missing for %s", url)
        return None

    soup = BeautifulSoup(body_html, "html.parser")
    text = soup.get_text("\n")
    text = unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    text = text.strip()

    if not text:
        logger.debug("RebelMouse body extracted empty for %s", url)
        return None

    author = post.get("author_name")
    publish_date = (
        post.get("last_published_date")
        or post.get("created_date")
        or post.get("formated_created_ts")
    )

    return {
        "success": True,
        "text": text,
        "title": post.get("headline") or post.get("title"),
        "authors": [author] if author else [],
        "publish_date": publish_date,
        "top_image": post.get("image") or post.get("image_external"),
    }


def calculate_word_count(text: Optional[str]) -> Optional[int]:
    """Calculate word count from text."""
    if not text:
        return None
    return len(text.split())


def calculate_read_time_minutes(text: Optional[str], wpm: int = 230) -> Optional[int]:
    """
    Calculate estimated read time in minutes.

    Args:
        text: Article text
        wpm: Words per minute (default 230, typical adult reading speed)

    Returns:
        Estimated read time in minutes (rounded up)
    """
    if not text:
        return None
    word_count = calculate_word_count(text)
    if not word_count:
        return None
    import math

    return math.ceil(word_count / wpm)
