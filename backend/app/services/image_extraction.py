"""Enhanced image extraction with candidate-based approach and structured errors.

This module provides robust image extraction from RSS entries and article pages,
with detailed error tracking for debugging.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any
from urllib.parse import urljoin

import httpx

from app.core.config import SCOOP_BROWSER_UA
from app.core.logging import get_logger
from app.services.rss_parser_rust_bindings import extract_og_image_html

logger = get_logger("image_extraction")


class ImageErrorType(StrEnum):
    """Structured error types for image extraction failures."""

    NO_IMAGE_IN_FEED = "NO_IMAGE_IN_FEED"
    IMAGE_URL_INVALID = "IMAGE_URL_INVALID"
    IMAGE_FETCH_FAILED = "IMAGE_FETCH_FAILED"
    IMAGE_FETCH_TIMEOUT = "IMAGE_FETCH_TIMEOUT"
    IMAGE_UNSUPPORTED_TYPE = "IMAGE_UNSUPPORTED_TYPE"
    MIXED_CONTENT_BLOCKED = "MIXED_CONTENT_BLOCKED"
    FRONTEND_RENDER_FAILED = "FRONTEND_RENDER_FAILED"
    OG_IMAGE_NOT_FOUND = "OG_IMAGE_NOT_FOUND"
    ARTICLE_FETCH_FAILED = "ARTICLE_FETCH_FAILED"


@dataclass
class ImageCandidate:
    """A potential image URL with metadata about where it came from."""

    url: str
    source: str
    priority: int
    content_type: str | None = None


@dataclass
class ImageExtractionResult:
    """Result of image extraction with candidates and error info."""

    image_url: str | None = None
    image_candidates: list[ImageCandidate] = field(default_factory=list)
    image_error: ImageErrorType | None = None
    image_error_details: str | None = None
    selected_source: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return the result in the API-facing dictionary shape."""
        return {
            "image_url": self.image_url,
            "image_candidates": [
                {"url": candidate.url, "source": candidate.source, "priority": candidate.priority}
                for candidate in self.image_candidates
            ],
            "image_error": self.image_error.value if self.image_error else None,
            "image_error_details": self.image_error_details,
            "selected_source": self.selected_source,
        }


def is_valid_image_url(url: str | None) -> bool:
    """Return whether a URL is a usable remote image candidate."""
    if not isinstance(url, str):
        return False
    trimmed = url.strip()
    if not trimmed:
        return False
    lowered = trimmed.lower()
    blocked = lowered.startswith("data:") or "placeholder" in lowered or lowered.endswith(".svg")
    return not blocked


def _candidate(
    raw_url: object,
    base_url: str | None,
    *,
    source: str,
    priority: int,
    content_type: str | None = None,
) -> ImageCandidate | None:
    url = _resolve_url(raw_url, base_url)
    if not is_valid_image_url(url):
        return None
    assert url is not None
    return ImageCandidate(url=url, source=source, priority=priority, content_type=content_type)


def _media_content_candidates(entry: Any, base_url: str | None) -> list[ImageCandidate]:
    candidates: list[ImageCandidate] = []
    for media in getattr(entry, "media_content", None) or []:
        if not isinstance(media, dict):
            continue
        media_type = str(media.get("type") or "")
        if media_type and not media_type.startswith("image/"):
            continue
        item = _candidate(
            media.get("url"),
            base_url,
            source="media:content",
            priority=1,
            content_type=media_type or None,
        )
        if item is not None:
            candidates.append(item)
    return candidates


def _thumbnail_records(entry: Any) -> list[dict[str, Any]]:
    raw = getattr(entry, "media_thumbnail", None)
    if isinstance(raw, dict):
        return [raw]
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _thumbnail_candidates(entry: Any, base_url: str | None) -> list[ImageCandidate]:
    candidates: list[ImageCandidate] = []
    for thumbnail in _thumbnail_records(entry):
        item = _candidate(
            thumbnail.get("url") or thumbnail.get("href"),
            base_url,
            source="media:thumbnail",
            priority=2,
        )
        if item is not None:
            candidates.append(item)
    return candidates


def _enclosure_candidates(entry: Any, base_url: str | None) -> list[ImageCandidate]:
    candidates: list[ImageCandidate] = []
    for enclosure in getattr(entry, "enclosures", None) or []:
        if not isinstance(enclosure, dict):
            continue
        content_type = str(enclosure.get("type") or "")
        if not content_type.startswith("image/"):
            continue
        item = _candidate(
            enclosure.get("href") or enclosure.get("url"),
            base_url,
            source="enclosure",
            priority=3,
            content_type=content_type,
        )
        if item is not None:
            candidates.append(item)
    return candidates


def _entry_html_sources(entry: Any) -> list[tuple[str, str]]:
    sources: list[tuple[str, str]] = []
    content = getattr(entry, "content", None)
    if content:
        if isinstance(content, list) and content and isinstance(content[0], dict):
            content_text = str(content[0].get("value") or "")
        else:
            content_text = str(content)
        sources.append(("content", content_text))

    encoded = getattr(entry, "content_encoded", None)
    if encoded:
        sources.append(("content_encoded", str(encoded)))

    description = getattr(entry, "description", None)
    if description:
        sources.append(("description", str(description)))
    return sources


def _html_candidates(entry: Any, base_url: str | None) -> list[ImageCandidate]:
    candidates: list[ImageCandidate] = []
    for source_name, html in _entry_html_sources(entry):
        for raw_url in _extract_images_from_html(html):
            item = _candidate(raw_url, base_url, source=f"{source_name}_html", priority=4)
            if item is not None:
                candidates.append(item)
    return candidates


def _link_candidate(link: dict[str, Any], base_url: str | None) -> ImageCandidate | None:
    href = str(link.get("href") or "")
    content_type = str(link.get("type") or "")
    if content_type.startswith("image/"):
        return _candidate(
            href,
            base_url,
            source="link",
            priority=5,
            content_type=content_type,
        )
    if re.search(r"\.(jpg|jpeg|png|gif|webp)(\?|$)", href, re.IGNORECASE):
        return _candidate(href, base_url, source="link_extension", priority=5)
    return None


def _link_candidates(entry: Any, base_url: str | None) -> list[ImageCandidate]:
    candidates: list[ImageCandidate] = []
    for link in getattr(entry, "links", None) or []:
        if not isinstance(link, dict):
            continue
        item = _link_candidate(link, base_url)
        if item is not None:
            candidates.append(item)
    return candidates


def _dedupe_candidates(candidates: list[ImageCandidate]) -> list[ImageCandidate]:
    by_url: dict[str, ImageCandidate] = {}
    for candidate in candidates:
        by_url.setdefault(candidate.url, candidate)
    return sorted(by_url.values(), key=lambda item: item.priority)


def _result_from_candidates(candidates: list[ImageCandidate]) -> ImageExtractionResult:
    unique = _dedupe_candidates(candidates)
    if not unique:
        return ImageExtractionResult(
            image_error=ImageErrorType.NO_IMAGE_IN_FEED,
            image_error_details="No image candidates found in RSS entry",
        )
    best = unique[0]
    return ImageExtractionResult(
        image_url=best.url,
        image_candidates=unique,
        selected_source=best.source,
    )


def extract_image_from_entry(
    entry: Any,
    article_url: str | None = None,
    base_url: str | None = None,
) -> ImageExtractionResult:
    """Extract and rank image candidates from the independent RSS image surfaces."""
    html_base_url = article_url if _is_http_url(article_url) else base_url
    extractors = (
        _media_content_candidates,
        _thumbnail_candidates,
        _enclosure_candidates,
        _html_candidates,
        _link_candidates,
    )
    candidates = [
        candidate
        for extractor in extractors
        for candidate in extractor(entry, html_base_url)
    ]
    return _result_from_candidates(candidates)


def _first_srcset_url(value: str) -> str | None:
    first_item = value.split(",", 1)[0].strip()
    if not first_item:
        return None
    first_url = first_item.split()[0]
    return first_url or None


def _extract_images_from_html(html: str) -> list[str]:
    if not html:
        return []

    attribute_patterns = (
        r'<img[^>]+src=["\']([^"\']+)["\']',
        r'<img[^>]+data-src=["\']([^"\']+)["\']',
        r'<img[^>]+data-original=["\']([^"\']+)["\']',
        r'<img[^>]+data-lazy-src=["\']([^"\']+)["\']',
        r'<img[^>]+data-srcset=["\']([^"\']+)["\']',
    )
    urls = [
        match
        for pattern in attribute_patterns
        for match in re.findall(pattern, html, re.IGNORECASE)
    ]
    srcsets = re.findall(r'<img[^>]+srcset=["\']([^"\']+)["\']', html, re.IGNORECASE)
    urls.extend(url for srcset in srcsets if (url := _first_srcset_url(srcset)))
    return [normalized for value in urls if (normalized := _first_srcset_url(value))]


def _unwrap_url_value(value: object) -> object:
    current = value
    if isinstance(current, dict):
        return current.get("url") or current.get("href")
    if isinstance(current, list) and current:
        first = current[0]
        if isinstance(first, dict):
            return first.get("url") or first.get("href")
        return first
    return current


def _is_http_url(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith(("http://", "https://"))


def _resolve_url(url: object, base_url: str | None = None) -> str | None:
    value = _unwrap_url_value(url)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if _is_http_url(normalized):
        return normalized
    if normalized.startswith("//"):
        return f"https:{normalized}"
    return urljoin(base_url, normalized) if base_url else None


def _og_candidates(payload: dict[str, Any], article_url: str) -> list[ImageCandidate]:
    candidates: list[ImageCandidate] = []
    for raw in payload.get("candidates", []) or []:
        if not isinstance(raw, dict):
            continue
        raw_priority = raw.get("priority")
        priority = int(raw_priority) if raw_priority is not None else 1
        item = _candidate(
            raw.get("url"),
            article_url,
            source=str(raw.get("source") or "og:image"),
            priority=priority,
        )
        if item is not None:
            candidates.append(item)
    return _dedupe_candidates(candidates)


def _og_result(candidates: list[ImageCandidate]) -> ImageExtractionResult:
    if not candidates:
        return ImageExtractionResult(
            image_error=ImageErrorType.OG_IMAGE_NOT_FOUND,
            image_error_details="No og:image or twitter:image found by Rust parser",
        )
    best = candidates[0]
    return ImageExtractionResult(
        image_url=best.url,
        image_candidates=candidates,
        selected_source=best.source,
    )


def _fetch_error(error_type: ImageErrorType, details: str) -> ImageExtractionResult:
    return ImageExtractionResult(image_error=error_type, image_error_details=details)


async def fetch_og_image(article_url: str, timeout: float = 10.0) -> ImageExtractionResult:
    """Fetch an article page and extract its OpenGraph/Twitter image candidates."""
    if not _is_http_url(article_url):
        return _fetch_error(ImageErrorType.IMAGE_URL_INVALID, f"Invalid article URL: {article_url}")

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            follow_redirects=True,
            headers={"User-Agent": SCOOP_BROWSER_UA},
        ) as client:
            response = await client.get(article_url)
            response.raise_for_status()
            return _og_result(_og_candidates(extract_og_image_html(response.text), article_url))
    except httpx.TimeoutException:
        logger.warning("Timeout fetching og:image from %s", article_url[:50])
        return _fetch_error(ImageErrorType.IMAGE_FETCH_TIMEOUT, f"Timeout fetching {article_url}")
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "HTTP error %s fetching og:image from %s",
            exc.response.status_code,
            article_url[:50],
        )
        return _fetch_error(
            ImageErrorType.ARTICLE_FETCH_FAILED,
            f"HTTP {exc.response.status_code} for {article_url}",
        )
    except Exception as exc:
        logger.error("Error fetching og:image from %s: %s", article_url[:50], exc)
        return _fetch_error(ImageErrorType.ARTICLE_FETCH_FAILED, str(exc))
