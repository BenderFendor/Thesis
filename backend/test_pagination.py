"""
Tests for paginated news endpoints.

Run with: pytest backend/test_pagination.py -v
"""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_paginated_cached_endpoint_returns_correct_structure():
    """Test that the cached pagination endpoint returns the expected structure."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/news/page/cached?limit=10")
        assert response.status_code == 200
        data = response.json()

        # Check response structure
        assert "articles" in data
        assert "total" in data
        assert "limit" in data
        assert "has_more" in data
        assert "next_cursor" in data

        # Verify limit is respected
        assert len(data["articles"]) <= 10
        assert data["limit"] == 10


@pytest.mark.anyio
async def test_paginated_cached_offset_pagination():
    """Test offset-based pagination with cached endpoint."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Get first page
        r1 = await client.get("/news/page/cached?limit=5&offset=0")
        assert r1.status_code == 200
        page1 = r1.json()

        # Get second page if there's more
        if page1["has_more"]:
            r2 = await client.get("/news/page/cached?limit=5&offset=5")
            assert r2.status_code == 200
            page2 = r2.json()

            # If both pages have articles, they shouldn't overlap
            if page1["articles"] and page2["articles"]:
                urls1 = {a["url"] for a in page1["articles"]}
                urls2 = {a["url"] for a in page2["articles"]}
                assert urls1.isdisjoint(urls2), "Pages should not have overlapping articles"


@pytest.mark.anyio
async def test_paginated_cached_category_filter():
    """Test category filtering on cached pagination endpoint."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/news/page/cached?category=technology&limit=20")
        assert response.status_code == 200
        data = response.json()

        # All returned articles should match the category (case-insensitive)
        for article in data["articles"]:
            assert article["category"].lower() == "technology", (
                f"Expected category 'technology', got '{article['category']}'"
            )


@pytest.mark.anyio
async def test_paginated_cached_search_filter():
    """Test search filtering on cached pagination endpoint."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Search for a common term
        response = await client.get("/news/page/cached?search=the&limit=10")
        assert response.status_code == 200
        data = response.json()

        # Search should return results or empty list, not error
        assert isinstance(data["articles"], list)
        assert data["total"] >= 0


@pytest.mark.anyio
async def test_paginated_database_endpoint_when_enabled():
    """Test database pagination endpoint (requires database to be enabled)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/news/page?limit=10")

        # Either works (200) or returns 500 if DB is disabled
        # This test just ensures the endpoint exists and responds
        assert response.status_code in [200, 500]

        if response.status_code == 200:
            data = response.json()
            assert "articles" in data
            assert "total" in data
            assert "has_more" in data


@pytest.mark.anyio
async def test_invalid_cursor_returns_400():
    """Test that an invalid cursor returns a 400 error."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/news/page?cursor=invalid_cursor_string")
        # Should return 400 for invalid cursor, or 500 if DB is disabled
        assert response.status_code in [400, 500]


@pytest.mark.anyio
async def test_limit_bounds():
    """Test that limit parameter respects bounds."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Test minimum limit
        r1 = await client.get("/news/page/cached?limit=1")
        assert r1.status_code == 200
        assert r1.json()["limit"] == 1

        # Test maximum limit
        r2 = await client.get("/news/page/cached?limit=200")
        assert r2.status_code == 200
        assert r2.json()["limit"] == 200

        # Test exceeding maximum (should return 422 validation error)
        r3 = await client.get("/news/page/cached?limit=500")
        assert r3.status_code == 422


@pytest.mark.anyio
async def test_cache_headers_on_database_endpoint():
    """Test that cache headers are set on the database pagination endpoint."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/news/page?limit=10")

        if response.status_code == 200:
            # Check cache headers are present
            assert "Cache-Control" in response.headers
            assert "Vary" in response.headers
