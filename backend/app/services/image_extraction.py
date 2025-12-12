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
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.core.logging import get_logger

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
    source: str  # e.g., "media:content", "enclosure", "og:image", "content_html"
    priority: int  # Lower = higher priority (1 is best)
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
        """Convert to dictionary for storage/API response."""
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

    Args:
        entry: feedparser entry object
        article_url: URL of the article (for og:image fallback)
        base_url: Base URL for resolving relative paths

    Returns:
        ImageExtractionResult with selected image and all candidates
    """
    result = ImageExtractionResult()
    candidates: List[ImageCandidate] = []

    # Priority 1: media:content with image type
    if hasattr(entry, "media_content") and entry.media_content:
        for media in entry.media_content:
            if isinstance(media, dict):
                media_type = media.get("type", "")
                url = media.get("url")
                if url and (media_type.startswith("image/") or not media_type):
                    candidates.append(ImageCandidate(
                        url=url,
                        source="media:content",
                        priority=1,
                        content_type=media_type or None,
                    ))

    # Priority 2: media:thumbnail
    if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
        thumb = entry.media_thumbnail
        if isinstance(thumb, list) and thumb:
            for t in thumb:
                if isinstance(t, dict):
                    url = t.get("url") or t.get("href")
                    if url:
                        candidates.append(ImageCandidate(
                            url=_resolve_url(url),
                            source="media:thumbnail",
                            priority=2,
                        ))
        elif isinstance(thumb, dict):
            url = thumb.get("url") or thumb.get("href")
            if url:
                candidates.append(ImageCandidate(
                    url=_resolve_url(url),
                    source="media:thumbnail",
                    priority=2,
                ))

    # Priority 3: enclosure with image type
    if hasattr(entry, "enclosures") and entry.enclosures:
        for enclosure in entry.enclosures:
            if isinstance(enclosure, dict):
                enc_type = enclosure.get("type", "")
                url = enclosure.get("href") or enclosure.get("url")
                if url and enc_type.startswith("image/"):
                    candidates.append(ImageCandidate(
                        url=url,
                        source="enclosure",
                        priority=3,
                        content_type=enc_type,
                    ))

    # Priority 4: Parse content:encoded / content / description HTML
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
            resolved_url = _resolve_url(img_url, base_url)
            if resolved_url:
                candidates.append(ImageCandidate(
                    url=resolved_url,
                    source=f"{source_name}_html",
                    priority=4,
                ))

    # Priority 5: Links with image file extensions
    if hasattr(entry, "links") and entry.links:
        for link in entry.links:
            if isinstance(link, dict):
                href = link.get("href", "")
                link_type = link.get("type", "")
                
                if link_type.startswith("image/"):
                    candidates.append(ImageCandidate(
                        url=href,
                        source="link",
                        priority=5,
                        content_type=link_type,
                    ))
                elif re.search(r"\.(jpg|jpeg|png|gif|webp)(\?|$)", href, re.IGNORECASE):
                    candidates.append(ImageCandidate(
                        url=href,
                        source="link_extension",
                        priority=5,
                    ))

    # Deduplicate candidates by URL
    seen_urls = set()
    unique_candidates = []
    for c in candidates:
        if c.url and c.url not in seen_urls:
            seen_urls.add(c.url)
            unique_candidates.append(c)

    # Sort by priority
    unique_candidates.sort(key=lambda x: x.priority)
    result.image_candidates = unique_candidates

    # Select best candidate
    if unique_candidates:
        best = unique_candidates[0]
        result.image_url = best.url
        result.selected_source = best.source
    else:
        result.image_error = ImageErrorType.NO_IMAGE_IN_FEED
        result.image_error_details = "No image candidates found in RSS entry"

    return result


def _extract_images_from_html(html: str) -> List[str]:
    """Extract image URLs from HTML content."""
    if not html:
        return []

    urls = []
    
    # Regex approach for speed
    img_pattern = r'<img[^>]+src=["\']([^"\']+)["\']'
    matches = re.findall(img_pattern, html, re.IGNORECASE)
    urls.extend(matches)

    # Also check for srcset
    srcset_pattern = r'<img[^>]+srcset=["\']([^"\']+)["\']'
    srcset_matches = re.findall(srcset_pattern, html, re.IGNORECASE)
    for srcset in srcset_matches:
        # Get first URL from srcset
        first_src = srcset.split(",")[0].strip().split()[0]
        if first_src:
            urls.append(first_src)

    return urls


def _resolve_url(url: Any, base_url: Optional[str] = None) -> Optional[str]:
    """Resolve potentially nested or relative URL."""
    if url is None:
        return None

    # Handle nested dicts
    if isinstance(url, dict):
        url = url.get("url") or url.get("href")
    
    # Handle lists
    if isinstance(url, list) and url:
        url = url[0]
        if isinstance(url, dict):
            url = url.get("url") or url.get("href")

    if not isinstance(url, str):
        return None

    url = url.strip()
    if not url:
        return None

    # Already absolute
    if url.startswith(("http://", "https://")):
        return url

    # Relative URL - need base
    if base_url:
        return urljoin(base_url, url)

    # Protocol-relative
    if url.startswith("//"):
        return f"https:{url}"

    return None


async def fetch_og_image(article_url: str, timeout: float = 10.0) -> ImageExtractionResult:
    """
    Fetch article page and extract og:image meta tag.

    This is an expensive operation - use for fallback only.

    Args:
        article_url: URL of the article page
        timeout: Request timeout in seconds

    Returns:
        ImageExtractionResult with og:image or error
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
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ThesisNewsBot/1.0)"
            },
        ) as client:
            response = await client.get(article_url)
            response.raise_for_status()

            soup = BeautifulSoup(response.content, "html.parser")

            # Try og:image first
            og_image = soup.find("meta", property="og:image")
            if og_image and og_image.get("content"):
                url = og_image["content"]
                result.image_candidates.append(ImageCandidate(
                    url=url,
                    source="og:image",
                    priority=1,
                ))

            # Try twitter:image
            twitter_image = soup.find("meta", attrs={"name": "twitter:image"})
            if twitter_image and twitter_image.get("content"):
                url = twitter_image["content"]
                result.image_candidates.append(ImageCandidate(
                    url=url,
                    source="twitter:image",
                    priority=2,
                ))

            # Try link rel="image_src"
            image_src = soup.find("link", rel="image_src")
            if image_src and image_src.get("href"):
                url = image_src["href"]
                result.image_candidates.append(ImageCandidate(
                    url=url,
                    source="link:image_src",
                    priority=3,
                ))

            if result.image_candidates:
                best = result.image_candidates[0]
                result.image_url = best.url
                result.selected_source = best.source
            else:
                result.image_error = ImageErrorType.OG_IMAGE_NOT_FOUND
                result.image_error_details = "No og:image or twitter:image found"

    except httpx.TimeoutException:
        result.image_error = ImageErrorType.IMAGE_FETCH_TIMEOUT
        result.image_error_details = f"Timeout fetching {article_url}"
        logger.warning("Timeout fetching og:image from %s", article_url[:50])

    except httpx.HTTPStatusError as e:
        result.image_error = ImageErrorType.ARTICLE_FETCH_FAILED
        result.image_error_details = f"HTTP {e.response.status_code} for {article_url}"
        logger.warning("HTTP error %s fetching og:image from %s", e.response.status_code, article_url[:50])

    except Exception as e:
        result.image_error = ImageErrorType.ARTICLE_FETCH_FAILED
        result.image_error_details = str(e)
        logger.error("Error fetching og:image from %s: %s", article_url[:50], e)

    return result
