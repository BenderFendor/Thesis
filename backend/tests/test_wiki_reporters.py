"""Tests for wiki reporter endpoints: listing and dossier."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestListWikiReporters:
    """GET /api/wiki/reporters"""

    async def test_returns_all_reporters(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2
        names = [r["name"] for r in data]
        assert "Jane Doe" in names
        assert "John Smith" in names

    async def test_search_by_name(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters?search=Jane")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Jane Doe"

    async def test_search_no_match(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters?search=Nonexistent")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_filter_by_leaning(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters?leaning=center-left")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert all(r["political_leaning"] == "center-left" for r in data)

    async def test_pagination(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters?limit=1&offset=0")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1

    async def test_reporter_card_fields(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters")
        assert resp.status_code == 200
        data = resp.json()
        jane = next(r for r in data if r["name"] == "Jane Doe")
        assert jane["id"] == 1
        assert jane["normalized_name"] == "jane doe"
        assert "politics" in (jane["topics"] or [])
        assert jane["political_leaning"] == "center-left"
        assert jane["leaning_confidence"] == "high"
        assert jane["article_count"] == 42
        assert jane["wikipedia_url"] is not None


@pytest.mark.asyncio
class TestGetReporterDossier:
    """GET /api/wiki/reporters/{reporter_id}"""

    async def test_returns_full_dossier(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Jane Doe"
        assert data["bio"] == "Veteran journalist covering politics."
        assert data["political_leaning"] == "center-left"
        assert data["leaning_confidence"] == "high"
        assert data["article_count"] == 42

    async def test_includes_career_history(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/1")
        data = resp.json()
        assert data["career_history"] is not None
        assert len(data["career_history"]) >= 1
        assert data["career_history"][0]["organization"] == "Test News"

    async def test_includes_education(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/1")
        data = resp.json()
        assert data["education"] is not None
        assert len(data["education"]) >= 1

    async def test_includes_recent_articles(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/1")
        data = resp.json()
        assert isinstance(data["recent_articles"], list)
        assert len(data["recent_articles"]) >= 1
        article = data["recent_articles"][0]
        assert "title" in article
        assert "source" in article
        assert "url" in article

    async def test_not_found(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/999")
        assert resp.status_code == 404

    async def test_reporter_with_minimal_data(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/2")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "John Smith"
        assert data["career_history"] is None
        assert data["education"] is None
        assert data["wikipedia_url"] is None


@pytest.mark.asyncio
class TestGetReporterArticles:
    """GET /api/wiki/reporters/{reporter_id}/articles"""

    async def test_returns_articles(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/1/articles")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 2
        # Should be ordered by published_at desc
        titles = [a["title"] for a in data]
        assert "Article A" in titles
        assert "Article B" in titles

    async def test_reporter_with_no_articles(self, client: AsyncClient):
        """Reporter 2 has articles via junction but let's verify the join works."""
        resp = await client.get("/api/wiki/reporters/2/articles")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["source"] == "State Gazette"

    async def test_pagination(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/1/articles?limit=1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
