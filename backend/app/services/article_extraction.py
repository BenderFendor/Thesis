"""
Article extraction service for full-text content retrieval and processing.

Provides functionality to extract, cache, and serve full article content
for the reading queue and reader mode.
"""

from typing import Any, Dict, Optional
import asyncio
import re
from html import unescape
from urllib.parse import urljoin

import requests

from app.core.logging import get_logger
from app.services.debug_logger import EventType, debug_logger
from app.services.rss_parser_rust_bindings import extract_article_html

logger = get_logger("article_extraction")
DEFAULT_REQUEST_TIMEOUT = 12
ARTICLE_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
ACCESS_CHALLENGE_PATTERNS = (
    "please enable js and disable any ad blocker",
    "security verification",
    "verify you are human",
    "attention required",
    "captcha",
    "cf-challenge",
    "bot verification",
)
PAYWALL_PATTERNS = (
    "subscribe to continue",
    "subscription required",
    "sign in to continue reading",
    "subscribe for full access",
    "log in to continue reading",
    "unlock this article",
    "this content is for subscribers",
)
ACCESS_BLOCK_STATUS_CODES = {401, 402, 403, 429}


async def extract_article_full_text(url: str) -> Dict[str, Any]:
    """
    Extract full article content from a URL.

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
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, _extract_sync, url)
        return result
    except Exception as exc:  # pragma: no cover
        logger.error("Error extracting article from %s: %s", url, exc)
        return {"success": False, "error": str(exc), "text": None}


def _extract_sync(url: str) -> Dict[str, Any]:
    """
    Synchronous extraction helper (runs in executor).

    This is a blocking operation that fetches article HTML and applies
    site-specific and Rust-based extraction.
    """
    try:
        html = ""
        status_code: Optional[int] = None
        try:
            html, status_code = _fetch_article_response(url)
        except Exception as fetch_exc:
            logger.debug("Direct HTML fetch failed for %s: %s", url, fetch_exc)

        if html:
            rebelmouse_payload = _extract_rebelmouse_article(url, html)
            if rebelmouse_payload:
                return _log_success(
                    url, "rebelmouse", {**rebelmouse_payload, "html": html}
                )

            rust_payload = _extract_with_rust(html)
            access_barrier = _detect_access_barrier(
                html=html,
                status_code=status_code,
                extracted_payload=rust_payload,
            )
            if access_barrier:
                logger.info(
                    "Article extraction blocked by %s for %s (status %s)",
                    access_barrier["kind"],
                    url,
                    status_code,
                )
                return {
                    "success": False,
                    "error": access_barrier["error"],
                    "text": None,
                }
            if _has_extracted_text(rust_payload):
                return _log_success(
                    url,
                    "rust_html",
                    {"success": True, **rust_payload, "html": html},
                )

        logger.warning("Article extraction produced no text for %s", url)
        return {
            "success": False,
            "error": "No article text extracted",
            "text": None,
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


def _fetch_article_response(url: str) -> tuple[str, int]:
    response = requests.get(
        url,
        headers={"User-Agent": ARTICLE_USER_AGENT},
        timeout=DEFAULT_REQUEST_TIMEOUT,
    )
    content_type = response.headers.get("content-type", "").lower()
    if content_type and "html" not in content_type and "xml" not in content_type:
        raise ValueError(f"Unsupported article content type: {content_type}")
    return response.text or "", response.status_code


def _fetch_article_html(url: str) -> str:
    html, status_code = _fetch_article_response(url)
    if status_code >= 400:
        raise requests.HTTPError(f"HTTP {status_code} for {url}")
    return html


def _log_success(url: str, extractor: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    logger.info("Article extracted with %s for %s", extractor, url)
    payload["extractor"] = extractor
    return payload


def _has_extracted_text(payload: Dict[str, Any]) -> bool:
    text = payload.get("text")
    return isinstance(text, str) and bool(text.strip())


def extract_article_content(url: str) -> Dict[str, Any]:
    """Blocking helper for contexts that cannot await coroutines."""
    return _extract_sync(url)


def _normalize_text(text: Optional[str]) -> str:
    if not isinstance(text, str):
        return ""
    return re.sub(r"\s+", " ", text).strip().lower()


def _contains_pattern(text: str, patterns: tuple[str, ...]) -> bool:
    return any(pattern in text for pattern in patterns)


def _detect_access_barrier(
    *,
    html: str,
    status_code: Optional[int],
    extracted_payload: Dict[str, Any],
) -> Optional[Dict[str, str]]:
    normalized_html = _normalize_text(html)
    normalized_title = _normalize_text(extracted_payload.get("title"))
    normalized_description = _normalize_text(extracted_payload.get("meta_description"))
    normalized_text = _normalize_text(extracted_payload.get("text"))
    combined = " ".join(
        value
        for value in (normalized_title, normalized_description, normalized_text)
        if value
    )

    page_looks_short = len(normalized_text.split()) < 120
    blocked_status = status_code in ACCESS_BLOCK_STATUS_CODES

    if _contains_pattern(normalized_html, ACCESS_CHALLENGE_PATTERNS) and (
        blocked_status or page_looks_short
    ):
        return {
            "kind": "access_challenge",
            "error": "Publisher blocked automated access with a verification page",
        }

    if _contains_pattern(combined or normalized_html, PAYWALL_PATTERNS) and (
        status_code in {401, 402, 403} or page_looks_short
    ):
        return {
            "kind": "paywall",
            "error": "Publisher requires a subscription or sign-in for full text",
        }

    return None


def _extract_with_rust(html: str) -> Dict[str, Any]:
    """Extract article content via Rust HTML parser."""
    payload = extract_article_html(html)
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

    payload = extract_article_html(body_html)
    text_value = payload.get("text")
    text = text_value if isinstance(text_value, str) else ""
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
        "title": post.get("headline") or post.get("title") or payload.get("title"),
        "authors": [author] if author else (payload.get("authors") or []),
        "publish_date": publish_date or payload.get("publish_date"),
        "top_image": post.get("image")
        or post.get("image_external")
        or payload.get("top_image"),
        "images": payload.get("images") or [],
        "meta_description": payload.get("meta_description"),
        "keywords": [],
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
