"""Regression tests for anti-bot fetch classification."""

from __future__ import annotations

import time

import httpx
import pytest

from app.services import cloudflare_fetcher
from app.services.cloudflare_fetcher import (
    FetchOutcome,
    classify_access_barrier,
    fetch_html_document,
)


def test_cloudflare_headers_on_normal_200_do_not_count_as_challenge() -> None:
    outcome = FetchOutcome(
        url="https://example.test/story",
        status_code=200,
        headers={"server": "cloudflare", "content-type": "text/html"},
        text="<html><head><title>Story</title></head><body>Normal article text.</body></html>",
    )

    assert classify_access_barrier(outcome) is None


def test_cloudflare_blocked_status_counts_as_challenge_with_header() -> None:
    outcome = FetchOutcome(
        url="https://example.test/story",
        status_code=403,
        headers={"cf-ray": "test", "content-type": "text/html"},
        text="<html><body>Forbidden</body></html>",
    )

    assert classify_access_barrier(outcome) == "cloudflare"


@pytest.mark.asyncio
async def test_generic_403_does_not_use_cloudscraper_by_default(monkeypatch) -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            headers={"server": "nginx", "content-type": "text/html"},
            text="<html><body>Forbidden</body></html>",
            request=request,
        )

    def fake_cloudscraper_fetch(url: str, timeout_seconds: float) -> FetchOutcome:
        nonlocal called
        called = True
        return FetchOutcome(url=url, status_code=200, headers={"content-type": "text/html"})

    monkeypatch.setattr(cloudflare_fetcher, "_cloudscraper_fetch_sync", fake_cloudscraper_fetch)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        outcome = await fetch_html_document(client, "https://example.test/forbidden")

    assert called is False
    assert outcome.status_code == 403
    assert classify_access_barrier(outcome) == "http_403"


@pytest.mark.asyncio
async def test_generic_block_cloudscraper_fallback_requires_env(monkeypatch) -> None:
    monkeypatch.setenv("THESIS_CLOUDSCRAPER_GENERIC_BLOCKS", "1")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            headers={"server": "nginx", "content-type": "text/html"},
            text="<html><body>Forbidden</body></html>",
            request=request,
        )

    def fake_cloudscraper_fetch(url: str, timeout_seconds: float) -> FetchOutcome:
        return FetchOutcome(
            url=url,
            status_code=200,
            headers={"content-type": "text/html"},
            text="<html><body>Recovered article page.</body></html>",
            access_path="cloudscraper",
        )

    monkeypatch.setattr(cloudflare_fetcher, "_cloudscraper_fetch_sync", fake_cloudscraper_fetch)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        outcome = await fetch_html_document(client, "https://example.test/forbidden")

    assert outcome.status_code == 200
    assert outcome.access_path == "cloudscraper"


@pytest.mark.asyncio
async def test_redirected_root_block_does_not_use_cloudscraper(monkeypatch) -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/authors/missing":
            return httpx.Response(302, headers={"location": "/"}, request=request)
        return httpx.Response(
            503,
            headers={"server": "cloudflare", "content-type": "text/html"},
            text="<html><body>Temporarily unavailable</body></html>",
            request=request,
        )

    def fake_cloudscraper_fetch(url: str, timeout_seconds: float) -> FetchOutcome:
        nonlocal called
        called = True
        return FetchOutcome(url=url, status_code=200, headers={"content-type": "text/html"})

    monkeypatch.setattr(cloudflare_fetcher, "_cloudscraper_fetch_sync", fake_cloudscraper_fetch)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        follow_redirects=True,
    ) as client:
        outcome = await fetch_html_document(client, "https://example.test/authors/missing")

    assert called is False
    assert outcome.url == "https://example.test/"
    assert outcome.status_code == 503


@pytest.mark.asyncio
async def test_cloudscraper_timeout_returns_direct_outcome(monkeypatch) -> None:
    monkeypatch.setenv("THESIS_CLOUDSCRAPER_HARD_TIMEOUT_SECONDS", "0.01")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            headers={"server": "cloudflare", "content-type": "text/html"},
            text="<html><body>Forbidden</body></html>",
            request=request,
        )

    def slow_cloudscraper_fetch(url: str, timeout_seconds: float) -> FetchOutcome:
        time.sleep(0.05)
        return FetchOutcome(url=url, status_code=200, headers={"content-type": "text/html"})

    monkeypatch.setattr(cloudflare_fetcher, "_cloudscraper_fetch_sync", slow_cloudscraper_fetch)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        outcome = await fetch_html_document(
            client,
            "https://example.test/story",
            timeout_seconds=0.01,
        )

    assert outcome.status_code == 403
    assert outcome.access_path == "direct"
    assert outcome.fallback_error == "cloudscraper_timeout"
