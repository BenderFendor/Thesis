"""Tests for general API endpoints (root, health, categories)."""

import pytest
from httpx import AsyncClient


class TestRoot:
    @pytest.mark.asyncio
    async def test_returns_welcome(self, client: AsyncClient):
        resp = await client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data
        assert data["version"] == "1.0.0"
        assert data["docs"] == "/docs"


class TestHealth:
    @pytest.mark.asyncio
    async def test_returns_healthy(self, client: AsyncClient):
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data


class TestCategories:
    @pytest.mark.asyncio
    async def test_returns_sorted_categories(self, client: AsyncClient):
        resp = await client.get("/categories")
        assert resp.status_code == 200
        data = resp.json()
        categories = data["categories"]
        assert isinstance(categories, list)
        assert len(categories) > 0
        assert categories == sorted(categories)
