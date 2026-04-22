from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx

import pytest

from hypothesis import given, strategies as st


def test_extract_article_uses_rust_html(monkeypatch) -> None:
    from app.services import article_extraction

    html = """
    <html>
      <head><title>Fallback title</title></head>
      <body>
        <article><p>Rust extracted body text.</p></article>
      </body>
    </html>
    """

    monkeypatch.setattr(
        article_extraction,
        "_fetch_article_response",
        lambda url: (html, 200),
    )
    monkeypatch.setattr(
        article_extraction,
        "_extract_with_rust",
        lambda html: {
            "text": "Rust extracted body text.",
            "title": "Rust title",
            "authors": ["Rust Author"],
            "publish_date": "2026-03-11",
            "top_image": "https://example.com/rust.jpg",
            "images": ["https://example.com/rust.jpg"],
            "keywords": [],
            "meta_description": "Rust description",
        },
    )

    result = article_extraction.extract_article_content("https://example.com/story")

    assert result["success"] is True
    assert result["extractor"] == "rust_html"
    assert result["title"] == "Rust title"
    assert result["text"] == "Rust extracted body text."


def test_extract_article_returns_error_after_direct_fetch_failure_without_fallback(
    monkeypatch,
) -> None:
    from app.services import article_extraction

    def _raise_fetch(url: str) -> tuple[str, int]:
        raise RuntimeError("network blocked")

    monkeypatch.setattr(article_extraction, "_fetch_article_response", _raise_fetch)

    result = article_extraction.extract_article_content("https://example.com/story")

    assert result["success"] is False
    assert result["error"] == "No article text extracted"


def test_extract_article_detects_access_challenge_page(monkeypatch) -> None:
    from app.services import article_extraction

    html = """
    <html>
      <head><title>reuters.com</title></head>
      <body>Please enable JS and disable any ad blocker</body>
    </html>
    """

    monkeypatch.setattr(
        article_extraction,
        "_fetch_article_response",
        lambda url: (html, 401),
    )
    monkeypatch.setattr(
        article_extraction,
        "_extract_with_rust",
        lambda html: {
            "text": "Please enable JS and disable any ad blocker",
            "title": "reuters.com",
            "authors": [],
            "publish_date": None,
            "top_image": None,
            "images": [],
            "keywords": [],
            "meta_description": None,
        },
    )

    result = article_extraction.extract_article_content(
        "https://www.reuters.com/world/"
    )

    assert result["success"] is False
    assert (
        result["error"] == "Publisher blocked automated access with a verification page"
    )


def test_extract_article_detects_paywall_from_response_content(monkeypatch) -> None:
    from app.services import article_extraction

    html = """
    <html>
      <head><title>Subscriber Exclusive</title></head>
      <body>
        <main>
          <p>Subscribe to continue reading this article.</p>
        </main>
      </body>
    </html>
    """

    monkeypatch.setattr(
        article_extraction,
        "_fetch_article_response",
        lambda url: (html, 403),
    )
    monkeypatch.setattr(
        article_extraction,
        "_extract_with_rust",
        lambda html: {
            "text": "Subscribe to continue reading this article.",
            "title": "Subscriber Exclusive",
            "authors": [],
            "publish_date": None,
            "top_image": None,
            "images": [],
            "keywords": [],
            "meta_description": None,
        },
    )

    result = article_extraction.extract_article_content(
        "https://example.com/paywalled-story"
    )

    assert result["success"] is False
    assert (
        result["error"] == "Publisher requires a subscription or sign-in for full text"
    )


@pytest.mark.asyncio
async def test_fetch_og_image_uses_persisted_cache_hit(
    monkeypatch, tmp_path: Path
) -> None:
    from app.services import og_image

    monkeypatch.setattr(og_image, "OG_CACHE_DIR", tmp_path)
    monkeypatch.setattr(og_image, "OG_CACHE_MAX_AGE", 3600)

    url = "https://example.com/story"
    og_image._store_cached_og_metadata(
        url,
        image_url="https://cdn.example.com/image.jpg",
        selected_source="og:image",
        error=None,
        error_details=None,
    )

    async with httpx.AsyncClient() as client:
        result = await og_image.fetch_og_image(url, client)

    assert result == "https://cdn.example.com/image.jpg"


@pytest.mark.asyncio
async def test_fetch_og_image_caches_none_marker(monkeypatch, tmp_path: Path) -> None:
    from app.services import og_image

    monkeypatch.setattr(og_image, "OG_CACHE_DIR", tmp_path)
    monkeypatch.setattr(og_image, "OG_CACHE_MAX_AGE", 3600)

    async def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><head><title>No image</title></head><body></body></html>",
            request=request,
        )

    url = "https://example.com/no-image"
    transport = httpx.MockTransport(_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        result = await og_image.fetch_og_image(url, client)

    assert result is None

    cache_path = og_image._og_cache_path(url)
    payload = json.loads(cache_path.read_text())
    assert payload["image_url"] == "none"
    assert payload["error"] == "OG_IMAGE_NOT_FOUND"


@pytest.mark.asyncio
async def test_enrich_articles_marks_none_without_retrying(monkeypatch) -> None:
    from app.models.news import NewsArticle
    from app.services import og_image

    async def _missing_image(url: str, client) -> str | None:
        return None

    monkeypatch.setattr(og_image, "fetch_og_image", _missing_image)

    articles = [
        NewsArticle(
            title="A",
            link="https://example.com/a",
            description="desc",
            published="2026-03-11T00:00:00Z",
            source="Example",
            image=None,
        ),
        NewsArticle(
            title="B",
            link="https://example.com/b",
            description="desc",
            published="2026-03-11T00:00:00Z",
            source="Example",
            image="none",
        ),
    ]

    needing, found = await og_image.enrich_articles_with_og_images(articles)

    assert needing == 1
    assert found == 0
    assert articles[0].image == "none"
    assert articles[1].image == "none"


@pytest.mark.asyncio
async def test_enrich_articles_respects_total_concurrency_cap(monkeypatch) -> None:
    from app.models.news import NewsArticle
    from app.services import og_image

    active = 0
    peak = 0
    lock = asyncio.Lock()

    async def _fetch_with_tracking(url: str, client) -> str | None:
        nonlocal active, peak
        async with lock:
            active += 1
            peak = max(peak, active)
        await asyncio.sleep(0.01)
        async with lock:
            active -= 1
        return f"https://images.example.com/{url.rsplit('/', 1)[-1]}.jpg"

    monkeypatch.setattr(og_image, "fetch_og_image", _fetch_with_tracking)

    articles = [
        NewsArticle(
            title=f"Article {index}",
            link=f"https://domain{index}.example.com/story-{index}",
            description="desc",
            published="2026-03-11T00:00:00Z",
            source="Example",
            image=None,
        )
        for index in range(8)
    ]

    needing, found = await og_image.enrich_articles_with_og_images(
        articles,
        max_total_concurrency=3,
    )

    assert needing == 8
    assert found == 8
    assert peak <= 3


@given(
    st.text(min_size=1).filter(lambda s: "placeholder" not in s.lower()),
    st.booleans(),
)
def test_normalize_cached_image_value_handles_marker_and_urls(
    raw_value: str, use_https: bool
) -> None:
    from app.services import og_image

    assert og_image._normalize_cached_image_value(" none ") is None
    assert (
        og_image._normalize_cached_image_value("https://example.com/icon.svg") is None
    )

    url = f"{'https' if use_https else 'http'}://example.com/{raw_value.strip() or 'image'}.jpg"
    assert og_image._normalize_cached_image_value(url) == url


@pytest.mark.asyncio
async def test_image_proxy_cache_hit_returns_length_header(
    client, monkeypatch, tmp_path: Path
):
    from app.api.routes import image_proxy

    monkeypatch.setattr(image_proxy, "CACHE_DIR", tmp_path)
    url = "https://example.com/image.jpg"
    content_path, meta_path = image_proxy._get_cache_path(url)
    content_path.write_bytes(b"12345")
    meta_path.write_text("image/jpeg")

    response = await client.get("/image/proxy", params={"url": url})

    assert response.status_code == 200
    assert response.headers["x-cache"] == "HIT"
    assert response.content == b"12345"
