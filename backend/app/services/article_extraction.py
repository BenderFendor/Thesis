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
from bs4 import BeautifulSoup
from newspaper import Article, Config

from app.core.logging import get_logger
from app.services.debug_logger import debug_logger, EventType

logger = get_logger("article_extraction")
DEFAULT_REQUEST_TIMEOUT = 12
ARTICLE_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

rss_parser_rust: Any | None = None

try:  # Optional Rust HTML extraction
    import rss_parser_rust as _rss_parser_rust

    rss_parser_rust = _rss_parser_rust
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
        html = ""
        try:
            html = _fetch_article_html(url)
        except Exception as fetch_exc:
            logger.debug("Direct HTML fetch failed for %s: %s", url, fetch_exc)

        if html:
            rebelmouse_payload = _extract_rebelmouse_article(url, html)
            if rebelmouse_payload:
                return _log_success(
                    url, "rebelmouse", {**rebelmouse_payload, "html": html}
                )

            if RUST_HTML_AVAILABLE:
                rust_payload = _extract_with_rust(html)
                if _has_extracted_text(rust_payload):
                    return _log_success(
                        url,
                        "rust_html",
                        {"success": True, **rust_payload, "html": html},
                    )

            soup_payload = _extract_with_soup(url, html)
            if _has_extracted_text(soup_payload):
                return _log_success(
                    url,
                    "soup_html",
                    {"success": True, **soup_payload, "html": html},
                )

            newspaper_payload = _extract_with_newspaper(
                url, html=html, allow_download=False
            )
            if _has_extracted_text(newspaper_payload):
                return _log_success(
                    url,
                    "newspaper_html",
                    {"success": True, **newspaper_payload, "html": html},
                )

        newspaper_download_payload = _extract_with_newspaper(
            url, html=None, allow_download=True
        )
        if _has_extracted_text(newspaper_download_payload):
            return _log_success(
                url,
                "newspaper_download",
                {"success": True, **newspaper_download_payload},
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


def _fetch_article_html(url: str) -> str:
    response = requests.get(
        url,
        headers={"User-Agent": ARTICLE_USER_AGENT},
        timeout=DEFAULT_REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").lower()
    if content_type and "html" not in content_type and "xml" not in content_type:
        raise ValueError(f"Unsupported article content type: {content_type}")
    return response.text or ""


def _log_success(url: str, extractor: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    logger.info("Article extracted with %s for %s", extractor, url)
    payload["extractor"] = extractor
    return payload


def _has_extracted_text(payload: Dict[str, Any]) -> bool:
    text = payload.get("text")
    return isinstance(text, str) and bool(text.strip())


def _newspaper_config() -> Config:
    config = Config()
    config.browser_user_agent = ARTICLE_USER_AGENT
    config.request_timeout = DEFAULT_REQUEST_TIMEOUT
    return config


def _extract_with_newspaper(
    url: str,
    *,
    html: str | None,
    allow_download: bool,
) -> Dict[str, Any]:
    article = Article(url, config=_newspaper_config())
    if html:
        _assign_article_html(article, html)
        article.parse()
        if _has_article_text(article.text):
            return _article_to_payload(article, html)

    if not allow_download:
        return {}

    article.download()
    downloaded_html = article.html or html or ""
    if downloaded_html:
        rebelmouse_payload = _extract_rebelmouse_article(url, downloaded_html)
        if rebelmouse_payload:
            return rebelmouse_payload
        _assign_article_html(article, downloaded_html)
        article.parse()
    if _has_article_text(article.text):
        return _article_to_payload(article, downloaded_html)
    return {}


def _has_article_text(text: Optional[str]) -> bool:
    return isinstance(text, str) and bool(text.strip())


def _assign_article_html(article: Article, html: str) -> None:
    setter = getattr(article, "set_html", None)
    if callable(setter):
        setter(html)
        return
    article.html = html


def _article_to_payload(article: Article, html: str) -> Dict[str, Any]:
    return {
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
    if rss_parser_rust is None:
        return {}
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


def _extract_with_soup(url: str, html: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    text = _extract_text_from_soup(soup)
    return {
        "text": text,
        "title": _first_meta_content(
            soup,
            [
                "meta[property='og:title']",
                "meta[name='twitter:title']",
                "title",
            ],
        ),
        "authors": _collect_meta_contents(
            soup,
            [
                "meta[name='author']",
                "meta[property='article:author']",
                "meta[name='parsely-author']",
            ],
        ),
        "publish_date": _first_meta_content(
            soup,
            [
                "meta[property='article:published_time']",
                "meta[name='pubdate']",
                "meta[name='date']",
                "meta[itemprop='datePublished']",
            ],
        ),
        "top_image": _normalize_url(
            _first_meta_content(
                soup,
                [
                    "meta[property='og:image']",
                    "meta[name='twitter:image']",
                    "link[rel='image_src']",
                ],
                attribute="content",
            )
            or _first_meta_content(
                soup,
                ["link[rel='image_src']"],
                attribute="href",
            ),
            url,
        ),
        "images": _extract_image_urls(soup, url),
        "keywords": [],
        "meta_description": _first_meta_content(
            soup,
            [
                "meta[name='description']",
                "meta[property='og:description']",
                "meta[name='twitter:description']",
            ],
        ),
    }


def _extract_text_from_soup(soup: BeautifulSoup) -> str:
    for selector in ("article p", "main p", "body p"):
        chunks = [
            " ".join(element.stripped_strings)
            for element in soup.select(selector)
            if " ".join(element.stripped_strings)
        ]
        if chunks:
            return "\n\n".join(chunks).strip()
    return ""


def _first_meta_content(
    soup: BeautifulSoup,
    selectors: list[str],
    *,
    attribute: str = "content",
) -> Optional[str]:
    for selector in selectors:
        element = soup.select_one(selector)
        if element is None:
            continue
        if selector == "title":
            value = element.get_text(" ", strip=True)
        else:
            value = element.get(attribute)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _collect_meta_contents(soup: BeautifulSoup, selectors: list[str]) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for selector in selectors:
        for element in soup.select(selector):
            value = element.get("content")
            if not isinstance(value, str):
                continue
            cleaned = value.strip()
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            values.append(cleaned)
    return values


def _extract_image_urls(soup: BeautifulSoup, base_url: str) -> list[str]:
    images: list[str] = []
    seen: set[str] = set()
    for element in soup.select("img"):
        for attribute in ("src", "data-src", "data-original", "data-lazy-src"):
            value = element.get(attribute)
            normalized = _normalize_url(value, base_url)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            images.append(normalized)
            break
    return images


def _normalize_url(value: object, base_url: str) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if cleaned.startswith("//"):
        return f"https:{cleaned}"
    if cleaned.startswith(("http://", "https://")):
        return cleaned
    return urljoin(base_url, cleaned)


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
