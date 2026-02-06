"""Tests for liked articles endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestListLiked:
    """GET /api/liked"""

    async def test_empty_list(self, client: AsyncClient):
        resp = await client.get("/api/liked")
        assert resp.status_code == 200
        data = resp.json()
        assert data["liked"] == []
        assert data["total"] == 0

    async def test_list_after_creating(self, client: AsyncClient):
        await client.post("/api/liked", json={"article_id": 1})
        await client.post("/api/liked", json={"article_id": 2})

        resp = await client.get("/api/liked")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        article_ids = [item["article_id"] for item in data["liked"]]
        assert 1 in article_ids
        assert 2 in article_ids


@pytest.mark.asyncio
class TestGetLiked:
    """GET /api/liked/{article_id}"""

    async def test_get_existing(self, client: AsyncClient):
        await client.post("/api/liked", json={"article_id": 1})

        resp = await client.get("/api/liked/1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["article_id"] == 1
        assert data["title"] == "Article A"
        assert "liked_id" in data
        assert "created_at" in data

    async def test_get_nonexistent(self, client: AsyncClient):
        resp = await client.get("/api/liked/999")
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestCreateLiked:
    """POST /api/liked"""

    async def test_create_valid(self, client: AsyncClient):
        resp = await client.post("/api/liked", json={"article_id": 1})
        assert resp.status_code == 201
        data = resp.json()
        assert data["created"] is True
        assert data["article_id"] == 1
        assert "liked_id" in data
        assert "created_at" in data

    async def test_create_nonexistent_article(self, client: AsyncClient):
        resp = await client.post("/api/liked", json={"article_id": 999})
        assert resp.status_code == 404

    async def test_idempotent_create(self, client: AsyncClient):
        first = await client.post("/api/liked", json={"article_id": 2})
        assert first.status_code == 201
        assert first.json()["created"] is True

        second = await client.post("/api/liked", json={"article_id": 2})
        assert second.status_code == 201
        assert second.json()["created"] is False
        assert second.json()["article_id"] == 2


@pytest.mark.asyncio
class TestDeleteLiked:
    """DELETE /api/liked/{article_id}"""

    async def test_delete_existing(self, client: AsyncClient):
        await client.post("/api/liked", json={"article_id": 3})

        resp = await client.delete("/api/liked/3")
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted"] is True
        assert data["article_id"] == 3

        # Confirm it's gone
        resp = await client.get("/api/liked/3")
        assert resp.status_code == 404

    async def test_delete_nonexistent(self, client: AsyncClient):
        resp = await client.delete("/api/liked/999")
        assert resp.status_code == 404
