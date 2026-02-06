"""Tests for bookmarks API endpoints."""

import pytest
from httpx import AsyncClient

BASE = "/api/bookmarks"


@pytest.mark.asyncio
class TestListBookmarks:
    """GET /api/bookmarks"""

    async def test_empty_list(self, client: AsyncClient):
        resp = await client.get(BASE)
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"bookmarks": [], "total": 0}

    async def test_list_after_creating(self, client: AsyncClient):
        await client.post(BASE, json={"article_id": 1})
        await client.post(BASE, json={"article_id": 2})

        resp = await client.get(BASE)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        article_ids = {b["article_id"] for b in data["bookmarks"]}
        assert article_ids == {1, 2}


@pytest.mark.asyncio
class TestGetBookmark:
    """GET /api/bookmarks/{article_id}"""

    async def test_get_existing(self, client: AsyncClient):
        await client.post(BASE, json={"article_id": 1})

        resp = await client.get(f"{BASE}/1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["article_id"] == 1
        assert data["title"] == "Article A"
        assert "bookmark_id" in data

    async def test_get_nonexistent(self, client: AsyncClient):
        resp = await client.get(f"{BASE}/999")
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestCreateBookmark:
    """POST /api/bookmarks"""

    async def test_create_valid(self, client: AsyncClient):
        resp = await client.post(BASE, json={"article_id": 1})
        assert resp.status_code == 201
        data = resp.json()
        assert data["created"] is True
        assert data["article_id"] == 1
        assert "bookmark_id" in data

    async def test_create_nonexistent_article(self, client: AsyncClient):
        resp = await client.post(BASE, json={"article_id": 9999})
        assert resp.status_code == 404

    async def test_idempotent_create(self, client: AsyncClient):
        first = await client.post(BASE, json={"article_id": 2})
        assert first.status_code == 201
        assert first.json()["created"] is True

        second = await client.post(BASE, json={"article_id": 2})
        assert second.status_code == 201
        assert second.json()["created"] is False
        assert second.json()["bookmark_id"] == first.json()["bookmark_id"]


@pytest.mark.asyncio
class TestUpdateBookmark:
    """PUT /api/bookmarks/{article_id}"""

    async def test_update_existing(self, client: AsyncClient):
        await client.post(BASE, json={"article_id": 1})

        resp = await client.put(f"{BASE}/1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["updated"] is True
        assert data["article_id"] == 1

    async def test_update_nonexistent(self, client: AsyncClient):
        resp = await client.put(f"{BASE}/999")
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestDeleteBookmark:
    """DELETE /api/bookmarks/{article_id}"""

    async def test_delete_existing(self, client: AsyncClient):
        await client.post(BASE, json={"article_id": 3})

        resp = await client.delete(f"{BASE}/3")
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted"] is True
        assert data["article_id"] == 3

        verify = await client.get(f"{BASE}/3")
        assert verify.status_code == 404

    async def test_delete_nonexistent(self, client: AsyncClient):
        resp = await client.delete(f"{BASE}/999")
        assert resp.status_code == 404
