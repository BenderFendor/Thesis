"""Observable contracts for the persisted Rust B02 news subset.

The Rust implementation intentionally reads only persisted PostgreSQL rows. It
never calls RSS providers or the in-memory cache. Consequently `/news/sources`
contains sources represented by persisted articles, with URL values derived from
the persisted metadata domain when one exists, and `/news/categories` returns a
sorted category list rather than the Python catalog's unordered set. Rust also
uses deterministic publication-time/id cursors and rejects unknown sort orders;
client-supplied FastAPI relevance scores are not trusted for persisted paging.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[2]
RUST_BINARY = ROOT / "backend" / "target" / "debug" / "thesis-server"
NEWS_OPERATIONS = {
    "/news/page": "get_news_paginated_news_page_get",
    "/news/page/cached": "get_cached_news_paginated_news_page_cached_get",
    "/news/index": "get_browse_index_news_index_get",
    "/news/index/cached": "get_cached_browse_index_news_index_cached_get",
    "/news/recent": "get_recent_news_news_recent_get",
    "/news/source/{source_name}": "get_news_by_source_news_source__source_name__get",
    "/news/category/{category_name}": "get_news_by_category_news_category__category_name__get",
    "/news/sources": "get_sources_news_sources_get",
    "/news/sources/stats": "get_source_stats_news_sources_stats_get",
    "/news/categories": "get_categories_news_categories_get",
}


def _rust_openapi() -> dict[str, Any]:
    if not RUST_BINARY.exists():
        pytest.skip("Rust thesis-server binary is not built")
    result = subprocess.run(
        [str(RUST_BINARY), "--openapi"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return json.loads(result.stdout)


def test_rust_news_openapi_exposes_exact_b02_operation_ids() -> None:
    document = _rust_openapi()
    paths = document["paths"]
    for path, operation_id in NEWS_OPERATIONS.items():
        operation = paths[path]["get"]
        assert operation["operationId"] == operation_id
        assert "200" in operation["responses"]
    for path in (
        "/news/page",
        "/news/page/cached",
        "/news/index",
        "/news/index/cached",
        "/news/recent",
        "/news/source/{source_name}",
        "/news/category/{category_name}",
    ):
        assert "422" in paths[path]["get"]["responses"]


def test_rust_news_openapi_keeps_persisted_response_shapes_explicit() -> None:
    document = _rust_openapi()
    schemas = document["components"]["schemas"]
    article = schemas["NewsArticle"]
    assert set(article["required"]) == {"title", "link", "description", "published", "source"}
    persisted_article = schemas["PersistedNewsArticle"]
    required = set(persisted_article["required"])
    assert {"id", "title", "link", "description", "published", "source", "url"} <= required
    for schema_name in ("PaginatedResponse", "RecentPageResponse", "BrowseIndexResponse"):
        schema = schemas[schema_name]
        article_items = schema["properties"]["articles"]["items"]
        assert article_items["type"] == "object"
        assert article_items["additionalProperties"] is True
    assert schemas["PaginatedResponse"]["required"] == ["articles", "total", "limit"]
    assert schemas["RecentPageResponse"]["required"] == ["articles", "limit"]
    assert schemas["BrowseIndexResponse"]["required"] == ["articles", "total"]
    assert schemas["SourceInfo"]["required"] == ["name", "url", "category"]
    assert schemas["NewsResponse"]["required"] == ["articles", "total", "sources"]
    assert schemas["SourceStatsList"]["required"] == ["sources", "total_sources"]
    assert set(schemas["SourceStats"]["required"]) == {
        "article_count",
        "category",
        "country",
        "last_checked",
        "name",
        "status",
        "url",
    }
    categories_schema = (
        document["paths"]["/news/categories"]["get"]["responses"]["200"]["content"][
            "application/json"
        ]["schema"]
    )
    assert categories_schema["type"] == "object"
    assert categories_schema["additionalProperties"] == {
        "type": "array",
        "items": {"type": "string"},
    }


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_socket:
        server_socket.bind(("127.0.0.1", 0))
        return int(server_socket.getsockname()[1])


def _async_database_url(database_url: str) -> str:
    return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)


async def _wait_for_rust(base_url: str, process: subprocess.Popen[bytes]) -> None:
    async with httpx.AsyncClient() as client:
        for _ in range(50):
            if process.poll() is not None:
                raise AssertionError("Rust news service exited before becoming ready")
            try:
                response = await client.get(f"{base_url}/openapi.json", timeout=0.2)
                if response.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(0.1)
    raise AssertionError("Rust news service did not become ready")


@pytest.mark.asyncio
async def test_rust_news_routes_use_disposable_persisted_fixture() -> None:
    database_url = os.getenv("THESIS_TEST_DATABASE_URL")
    if not database_url or not RUST_BINARY.exists():
        pytest.skip("requires a disposable PostgreSQL URL and built Rust server")

    marker = uuid.uuid4().hex[:12]
    source = f"Fixture Wire {marker}"
    category = f"fixture-{marker}"
    url_prefix = f"https://fixture.invalid/{marker}/"
    engine = create_async_engine(_async_database_url(database_url))
    rust_port = _free_port()
    process = subprocess.Popen(
        [str(RUST_BINARY)],
        cwd=ROOT,
        env={
            **os.environ,
            "THESIS_DATABASE_URL": database_url,
            "THESIS_RUST_BIND": f"127.0.0.1:{rust_port}",
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO articles "
                    "(title, source, summary, content, published_at, category, url) "
                    "VALUES (:title, :source, :summary, :content, :published_at, :category, :url)"
                ),
                [
                    {
                        "title": "Fixture newer",
                        "source": source,
                        "summary": "Persisted summary",
                        "content": "Persisted content",
                        "published_at": "2026-01-02T00:00:00+00:00",
                        "category": category,
                        "url": f"{url_prefix}newer",
                    },
                    {
                        "title": "Fixture older",
                        "source": source,
                        "summary": "Older summary",
                        "content": "Older content",
                        "published_at": "2026-01-01T00:00:00+00:00",
                        "category": category,
                        "url": f"{url_prefix}older",
                    },
                ],
            )
            await connection.execute(
                text(
                    "INSERT INTO source_metadata "
                    "(source_name, domain, country, factual_rating, credibility_score) "
                    "VALUES (:source, :domain, :country, :factual_rating, :credibility_score) "
                    "ON CONFLICT (source_name) DO UPDATE SET domain = EXCLUDED.domain"
                ),
                {
                    "source": source,
                    "domain": "fixture.invalid",
                    "country": "ZZ",
                    "factual_rating": "high",
                    "credibility_score": 0.91,
                },
            )

        base_url = f"http://127.0.0.1:{rust_port}"
        await _wait_for_rust(base_url, process)
        async with httpx.AsyncClient(base_url=base_url) as client:
            page = await client.get("/news/page", params={"limit": 1, "category": category})
            assert page.status_code == 200
            assert page.headers["cache-control"] == "public, max-age=30, stale-while-revalidate=60"
            assert page.headers["vary"] == "Accept-Encoding"
            page_payload = page.json()
            assert page_payload["total"] == 2
            assert page_payload["has_more"] is True
            assert page_payload["articles"][0]["link"].startswith(url_prefix)
            assert page_payload["articles"][0]["description"]
            assert page_payload["next_cursor"]
            invalid_sort = await client.get(
                "/news/page",
                params={"category": category, "sort_order": "not-a-sort"},
            )
            assert invalid_sort.status_code == 422
            assert invalid_sort.json()["detail"][0]["loc"] == ["query", "sort_order"]

            follow_up = await client.get(
                "/news/recent",
                params={"limit": 1, "category": category, "cursor": page_payload["next_cursor"]},
            )
            assert follow_up.status_code == 200
            assert follow_up.json()["articles"][0]["title"] == "Fixture older"

            index = await client.get("/news/index", params={"category": category})
            assert index.status_code == 200
            assert index.headers["cache-control"] == "public, max-age=30, stale-while-revalidate=60"
            assert index.headers["vary"] == "Accept-Encoding"
            assert index.json()["total"] == 2

            sources = await client.get("/news/sources")
            assert sources.status_code == 200
            fixture_source = next(item for item in sources.json() if item["name"] == source)
            assert fixture_source["url"] == "https://fixture.invalid"
            assert fixture_source["country"] == "ZZ"
            assert fixture_source["credibility_score"] == 0.91

            categories = await client.get("/news/categories")
            assert categories.status_code == 200
            assert category in categories.json()["categories"]
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        async with engine.begin() as connection:
            await connection.execute(text("DELETE FROM source_metadata WHERE source_name = :source"), {"source": source})
            await connection.execute(text("DELETE FROM articles WHERE url LIKE :prefix"), {"prefix": f"{url_prefix}%"})
        await engine.dispose()
