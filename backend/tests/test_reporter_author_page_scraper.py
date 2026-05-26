"""Regression tests for author profile page parsing."""

from __future__ import annotations

import httpx
import pytest

from app.services import cloudflare_fetcher
from app.services.cloudflare_fetcher import FetchOutcome
from app.services.reporter_author_page_scraper import scrape_author_profile


@pytest.mark.asyncio
async def test_scrape_author_profile_uses_h1_name_when_jsonld_absent() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><head><title>Jane Doe - Example News</title></head>"
            "<body><h1>Jane Doe</h1><p class='bio'>Jane covers courts and politics.</p></body></html>",
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        profile = await scrape_author_profile(client, "https://example.test/authors/jane-doe")

    assert profile["full_name"] == "Jane Doe"
    assert profile["bio"] == "Jane covers courts and politics."


@pytest.mark.asyncio
async def test_scrape_author_profile_extracts_indian_express_title_name() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><head>"
            "<title>Read All The Stories Written by Shubhajit Roy.</title>"
            "<meta property='og:title' content='Read All The Stories Written by Shubhajit Roy.'>"
            "</head><body></body></html>",
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        profile = await scrape_author_profile(
            client, "https://indianexpress.com/profile/author/shubhajit-roy/"
        )

    assert profile["full_name"] == "Shubhajit Roy"


@pytest.mark.asyncio
async def test_scrape_author_profile_skips_generic_heading_before_title_name() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><head>"
            "<title>Read All The Stories Written by Anish Mondal.</title>"
            "</head><body><h1>Author</h1></body></html>",
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        profile = await scrape_author_profile(
            client, "https://indianexpress.com/profile/author/anish-mondal/"
        )

    assert profile["full_name"] == "Anish Mondal"


@pytest.mark.asyncio
async def test_scrape_author_profile_extracts_times_of_india_title_name() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><head>"
            "<title>Naseer Ganai: Read Latest News from Naseer Ganai</title>"
            "</head><body></body></html>",
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        profile = await scrape_author_profile(
            client,
            "https://timesofindia.indiatimes.com/toireporter/author-naseer-ganai-479268504.cms",
        )

    assert profile["full_name"] == "Naseer Ganai"


@pytest.mark.asyncio
async def test_scrape_author_profile_prefers_author_title_over_article_og_title() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><head>"
            "<title>Nishi Felton, Author at The Namibian</title>"
            "<meta property='og:title' content='Marula fruit a symbol of national unity'>"
            "</head><body></body></html>",
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        profile = await scrape_author_profile(
            client,
            "https://www.namibian.com.na/author/nishi-felton/",
        )

    assert profile["full_name"] == "Nishi Felton"


@pytest.mark.asyncio
async def test_scrape_author_profile_uses_cloudscraper_after_cloudflare_403(monkeypatch) -> None:
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
            text="<html><head><title>Jane Doe - Example News</title></head>"
            "<body><h1>Jane Doe</h1></body></html>",
            access_path="cloudscraper",
        )

    monkeypatch.setattr(cloudflare_fetcher, "_cloudscraper_fetch_sync", fake_cloudscraper_fetch)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        profile = await scrape_author_profile(client, "https://example.test/authors/jane-doe")

    assert profile["full_name"] == "Jane Doe"
    assert profile["access_path"] == "cloudscraper"


@pytest.mark.asyncio
async def test_scrape_author_profile_preserves_401_without_cloudscraper(monkeypatch) -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            headers={"content-type": "text/html"},
            text="<html><body>Unauthorized</body></html>",
            request=request,
        )

    def fake_cloudscraper_fetch(url: str, timeout_seconds: float) -> FetchOutcome:
        nonlocal called
        called = True
        return FetchOutcome(url=url, status_code=200, headers={"content-type": "text/html"})

    monkeypatch.setattr(cloudflare_fetcher, "_cloudscraper_fetch_sync", fake_cloudscraper_fetch)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        profile = await scrape_author_profile(client, "https://example.test/authors/jane-doe")

    assert called is False
    assert profile["error"] == "HTTP 401"
    assert profile["access_barrier"] == "http_401"
