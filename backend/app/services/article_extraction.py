"""
Article extraction service for full-text content retrieval and processing.

Provides functionality to extract, cache, and serve full article content
for the reading queue and reader mode.
"""

from typing import Dict, Any, Optional
import asyncio
from newspaper import Article, Config  # type: ignore[import-unresolved]

from app.core.logging import get_logger
from app.services.debug_logger import debug_logger, EventType

logger = get_logger("article_extraction")


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
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _extract_sync, url)
        return result
    except Exception as e:  # pragma: no cover
        logger.error("Error extracting article from %s: %s", url, e)
        return {"success": False, "error": str(e), "text": None}


def _extract_sync(url: str) -> Dict[str, Any]:
    """
    Synchronous extraction helper (runs in executor).

    This is a blocking operation that uses newspaper3k to download and
    parse the article.
    """
    try:
        config = Config()
        config.browser_user_agent = (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        config.request_timeout = 12
        article = Article(url, config=config)
        article.download()
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
            "html": article.html,
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
    return _extract_sync(url)


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
