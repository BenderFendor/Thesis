from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from hypothesis import given, strategies as st


def test_extract_article_prefers_rust_html_before_soup(monkeypatch) -> None:
    from app.services import article_extraction

    html = """
    <html>
      <head><title>Fallback title</title></head>
      <body>
        <article><p>Rust extracted body text.</p></article>
      </body>
    </html>
    """

    monkeypatch.setattr(article_extraction, "RUST_HTML_AVAILABLE", True)
    monkeypatch.setattr(article_extraction, "_fetch_article_html", lambda url: html)
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

    def _fail_if_called(*args, **kwargs):
        raise AssertionError("soup fallback should not run when rust succeeds")

    monkeypatch.setattr(article_extraction, "_extract_with_soup", _fail_if_called)

    result = article_extraction.extract_article_content("https://example.com/story")

    assert result["success"] is True
    assert result["extractor"] == "rust_html"
    assert result["title"] == "Rust title"
    assert result["text"] == "Rust extracted body text."


def test_extract_article_returns_error_after_direct_fetch_failure_without_fallback(
    monkeypatch,
) -> None:
    from app.services import article_extraction

    monkeypatch.setattr(article_extraction, "RUST_HTML_AVAILABLE", False)

    def _raise_fetch(url: str) -> str:
        raise RuntimeError("network blocked")

    monkeypatch.setattr(article_extraction, "_fetch_article_html", _raise_fetch)

    result = article_extraction.extract_article_content("https://example.com/story")

    assert result["success"] is False
    assert result["error"] == "No article text extracted"


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

    class _UnusedClient:
        def stream(self, *args, **kwargs):
            raise AssertionError("network should not be used on cache hit")

    result = await og_image.fetch_og_image(url, _UnusedClient())

    assert result == "https://cdn.example.com/image.jpg"


@pytest.mark.asyncio
async def test_fetch_og_image_caches_none_marker(monkeypatch, tmp_path: Path) -> None:
    from app.services import og_image

    monkeypatch.setattr(og_image, "OG_CACHE_DIR", tmp_path)
    monkeypatch.setattr(og_image, "OG_CACHE_MAX_AGE", 3600)

    class _Response:
        status_code = 200
        headers = {"content-type": "text/html"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def aiter_bytes(self, chunk_size: int = 8192):
            yield b"<html><head><title>No image</title></head><body></body></html>"

    class _Client:
        def stream(self, *args, **kwargs):
            return _Response()

    url = "https://example.com/no-image"
    result = await og_image.fetch_og_image(url, _Client())

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
    assert response.headers["content-length"] == "5"
