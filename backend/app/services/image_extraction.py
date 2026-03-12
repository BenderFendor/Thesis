"""
Enhanced image extraction with candidate-based approach and structured errors.

This module provides robust image extraction from RSS entries and article pages,
with detailed error tracking for debugging.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import httpx

from app.core.logging import get_logger
from app.services.rss_parser_rust_bindings import extract_og_image_html

logger = get_logger("image_extraction")


class ImageErrorType(str, Enum):
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
    content_type: Optional[str] = None


@dataclass
class ImageExtractionResult:
    """Result of image extraction with candidates and error info."""

    image_url: Optional[str] = None
    image_candidates: List[ImageCandidate] = field(default_factory=list)
    image_error: Optional[ImageErrorType] = None
    image_error_details: Optional[str] = None
    selected_source: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "image_url": self.image_url,
            "image_candidates": [
                {"url": c.url, "source": c.source, "priority": c.priority}
                for c in self.image_candidates
            ],
            "image_error": self.image_error.value if self.image_error else None,
            "image_error_details": self.image_error_details,
            "selected_source": self.selected_source,
        }


def is_valid_image_url(url: Optional[str]) -> bool:
    if not url or not isinstance(url, str):
        return False
    trimmed = url.strip()
    if not trimmed:
        return False
    lowered = trimmed.lower()
    if lowered.startswith("data:"):
        return False
    if "placeholder" in lowered:
        return False
    if lowered.endswith(".svg"):
        return False
    return True


def extract_image_from_entry(
    entry: Any,
    article_url: Optional[str] = None,
    base_url: Optional[str] = None,
) -> ImageExtractionResult:
    """
    Extract image from RSS entry with candidate ranking.

    Priority order:
    1. media:content with image type
    2. media:thumbnail
    3. enclosure with image type
    4. Images from content:encoded / description HTML
    5. Links with image file extensions
    """
    result = ImageExtractionResult()
    candidates: List[ImageCandidate] = []
    html_base_url = (
        article_url
        if article_url and article_url.startswith(("http://", "https://"))
        else base_url
    )

    if hasattr(entry, "media_content") and entry.media_content:
        for media in entry.media_content:
            if isinstance(media, dict):
                media_type = media.get("type", "")
                url = _resolve_url(media.get("url"), html_base_url)
                if (
                    url
                    and (media_type.startswith("image/") or not media_type)
                    and is_valid_image_url(url)
                ):
                    candidates.append(
                        ImageCandidate(
                            url=url,
                            source="media:content",
                            priority=1,
                            content_type=media_type or None,
                        )
                    )

    if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
        thumb = entry.media_thumbnail
        if isinstance(thumb, list) and thumb:
            for item in thumb:
                if isinstance(item, dict):
                    url = _resolve_url(
                        item.get("url") or item.get("href"), html_base_url
                    )
                    if url and is_valid_image_url(url):
                        candidates.append(
                            ImageCandidate(
                                url=url,
                                source="media:thumbnail",
                                priority=2,
                            )
                        )
        elif isinstance(thumb, dict):
            url = _resolve_url(thumb.get("url") or thumb.get("href"), html_base_url)
            if url and is_valid_image_url(url):
                candidates.append(
                    ImageCandidate(
                        url=url,
                        source="media:thumbnail",
                        priority=2,
                    )
                )

    if hasattr(entry, "enclosures") and entry.enclosures:
        for enclosure in entry.enclosures:
            if isinstance(enclosure, dict):
                enc_type = enclosure.get("type", "")
                url = _resolve_url(
                    enclosure.get("href") or enclosure.get("url"),
                    html_base_url,
                )
                if url and enc_type.startswith("image/") and is_valid_image_url(url):
                    candidates.append(
                        ImageCandidate(
                            url=url,
                            source="enclosure",
                            priority=3,
                            content_type=enc_type,
                        )
                    )

    html_sources = []
    if hasattr(entry, "content") and entry.content:
        content_text = (
            entry.content[0].get("value", "")
            if isinstance(entry.content, list) and entry.content
            else str(entry.content)
        )
        html_sources.append(("content", content_text))
    if hasattr(entry, "content_encoded") and entry.content_encoded:
        html_sources.append(("content_encoded", entry.content_encoded))
    if hasattr(entry, "description") and entry.description:
        html_sources.append(("description", entry.description))

    for source_name, html_content in html_sources:
        img_urls = _extract_images_from_html(html_content)
        for img_url in img_urls:
            resolved_url = _resolve_url(img_url, html_base_url)
            if resolved_url and is_valid_image_url(resolved_url):
                candidates.append(
                    ImageCandidate(
                        url=resolved_url,
                        source=f"{source_name}_html",
                        priority=4,
                    )
                )

    if hasattr(entry, "links") and entry.links:
        for link in entry.links:
            if isinstance(link, dict):
                href = link.get("href", "")
                link_type = link.get("type", "")
                if link_type.startswith("image/"):
                    resolved = _resolve_url(href, html_base_url)
                    if resolved and is_valid_image_url(resolved):
                        candidates.append(
                            ImageCandidate(
                                url=resolved,
                                source="link",
                                priority=5,
                                content_type=link_type,
                            )
                        )
                elif re.search(r"\.(jpg|jpeg|png|gif|webp)(\?|$)", href, re.IGNORECASE):
                    resolved = _resolve_url(href, html_base_url)
                    if resolved and is_valid_image_url(resolved):
                        candidates.append(
                            ImageCandidate(
                                url=resolved,
                                source="link_extension",
                                priority=5,
                            )
                        )

    seen_urls = set()
    unique_candidates = []
    for candidate in candidates:
        if candidate.url and candidate.url not in seen_urls:
            seen_urls.add(candidate.url)
            unique_candidates.append(candidate)

    unique_candidates.sort(key=lambda item: item.priority)
    result.image_candidates = unique_candidates

    if unique_candidates:
        best = unique_candidates[0]
        result.image_url = best.url
        result.selected_source = best.source
    else:
        result.image_error = ImageErrorType.NO_IMAGE_IN_FEED
        result.image_error_details = "No image candidates found in RSS entry"

    return result


def _extract_images_from_html(html: str) -> List[str]:
    if not html:
        return []

    urls = []
    img_pattern = r'<img[^>]+src=["\']([^"\']+)["\']'
    urls.extend(re.findall(img_pattern, html, re.IGNORECASE))

    lazy_patterns = [
        r'<img[^>]+data-src=["\']([^"\']+)["\']',
        r'<img[^>]+data-original=["\']([^"\']+)["\']',
        r'<img[^>]+data-lazy-src=["\']([^"\']+)["\']',
        r'<img[^>]+data-srcset=["\']([^"\']+)["\']',
    ]
    for pattern in lazy_patterns:
        urls.extend(re.findall(pattern, html, re.IGNORECASE))

    srcset_pattern = r'<img[^>]+srcset=["\']([^"\']+)["\']'
    srcset_matches = re.findall(srcset_pattern, html, re.IGNORECASE)
    for srcset in srcset_matches:
        first_src = srcset.split(",")[0].strip().split()[0]
        if first_src:
            urls.append(first_src)

    normalized: List[str] = []
    for candidate in urls:
        if "," in candidate:
            first = candidate.split(",")[0].strip().split()[0]
            if first:
                normalized.append(first)
                continue
        normalized.append(candidate)
    return normalized


def _resolve_url(url: object, base_url: Optional[str] = None) -> Optional[str]:
    url_value: object = url
    if url_value is None:
        return None
    if isinstance(url_value, dict):
        url_value = url_value.get("url") or url_value.get("href")
    if isinstance(url_value, list) and url_value:
        url_value = url_value[0]
        if isinstance(url_value, dict):
            url_value = url_value.get("url") or url_value.get("href")
    if not isinstance(url_value, str):
        return None

    normalized_url = url_value.strip()
    if not normalized_url:
        return None
    if normalized_url.startswith(("http://", "https://")):
        return normalized_url
    if base_url:
        return urljoin(base_url, normalized_url)
    if normalized_url.startswith("//"):
        return f"https:{normalized_url}"
    return None


async def fetch_og_image(
    article_url: str, timeout: float = 10.0
) -> ImageExtractionResult:
    """
    Fetch article page and extract og:image meta tag.

    This is an expensive operation and now relies on the Rust HTML parser.
    """
    result = ImageExtractionResult()

    if not article_url or not article_url.startswith(("http://", "https://")):
        result.image_error = ImageErrorType.IMAGE_URL_INVALID
        result.image_error_details = f"Invalid article URL: {article_url}"
        return result

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; ThesisNewsBot/1.0)"},
        ) as client:
            response = await client.get(article_url)
            response.raise_for_status()

            payload = extract_og_image_html(response.text)
            for candidate in payload.get("candidates", []) or []:
                normalized_url = _resolve_url(candidate.get("url"), article_url)
                if not normalized_url or not is_valid_image_url(normalized_url):
                    continue
                priority_value = candidate.get("priority")
                result.image_candidates.append(
                    ImageCandidate(
                        url=normalized_url,
                        source=candidate.get("source") or "og:image",
                        priority=int(priority_value)
                        if priority_value is not None
                        else 1,
                    )
                )

            result.image_candidates.sort(key=lambda item: item.priority)

            if result.image_candidates:
                best = result.image_candidates[0]
                result.image_url = best.url
                result.selected_source = best.source
            else:
                result.image_error = ImageErrorType.OG_IMAGE_NOT_FOUND
                result.image_error_details = (
                    "No og:image or twitter:image found by Rust parser"
                )

    except httpx.TimeoutException:
        result.image_error = ImageErrorType.IMAGE_FETCH_TIMEOUT
        result.image_error_details = f"Timeout fetching {article_url}"
        logger.warning("Timeout fetching og:image from %s", article_url[:50])
    except httpx.HTTPStatusError as exc:
        result.image_error = ImageErrorType.ARTICLE_FETCH_FAILED
        result.image_error_details = (
            f"HTTP {exc.response.status_code} for {article_url}"
        )
        logger.warning(
            "HTTP error %s fetching og:image from %s",
            exc.response.status_code,
            article_url[:50],
        )
    except Exception as exc:
        result.image_error = ImageErrorType.ARTICLE_FETCH_FAILED
        result.image_error_details = str(exc)
        logger.error("Error fetching og:image from %s: %s", article_url[:50], exc)

    return result
