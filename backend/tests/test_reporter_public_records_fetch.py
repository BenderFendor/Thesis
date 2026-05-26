"""Regression tests for reporter article-page fetch fallbacks."""

from __future__ import annotations

import httpx
import pytest

from app.services import cloudflare_fetcher
from app.services.cloudflare_fetcher import FetchOutcome
from app.services.reporter_public_records import _fetch_article_author_signals


@pytest.mark.asyncio
async def test_fetch_article_author_signals_uses_cloudscraper_fallback(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            headers={"content-type": "text/html", "server": "cloudflare"},
            text="<html><title>Just a moment...</title><body>/cdn-cgi/challenge</body></html>",
            request=request,
        )

    def fake_cloudscraper_fetch(url: str, timeout_seconds: float) -> FetchOutcome:
        return FetchOutcome(
            url=url,
            status_code=200,
            headers={"content-type": "text/html"},
            text="<html><body><a rel='author' href='/authors/jane-doe'>Jane Doe</a></body></html>",
            access_path="cloudscraper",
        )

    monkeypatch.setattr(cloudflare_fetcher, "_cloudscraper_fetch_sync", fake_cloudscraper_fetch)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        signals = await _fetch_article_author_signals(
            client,
            "Jane Doe",
            "https://example.test/story",
        )

    assert signals["access_path"] == "cloudscraper"
    assert signals["author_pages"] == ["https://example.test/authors/jane-doe"]


@pytest.mark.asyncio
async def test_fetch_article_author_signals_ignores_unlabeled_author_path_links() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="""
            <html>
              <body>
                <a href="/staff/robert-knight/"><img alt=""></a>
                <a href="/staff/jane-doe/" aria-label="Jane Doe"></a>
              </body>
            </html>
            """,
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        signals = await _fetch_article_author_signals(
            client,
            "Jane Doe",
            "https://example.test/story",
        )

    assert signals["author_pages"] == ["https://example.test/staff/jane-doe/"]
