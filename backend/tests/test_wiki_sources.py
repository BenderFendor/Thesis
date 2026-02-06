"""Tests for wiki source endpoints: listing and individual profiles."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestListWikiSources:
    """GET /api/wiki/sources"""

    async def test_returns_all_deduplicated_sources(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?limit=500")
        assert resp.status_code == 200
        data = resp.json()
        # "Right Report - 1" and "Right Report - 2" share base name "Right Report"
        names = [s["name"] for s in data]
        assert "Test News" in names
        assert "State Gazette" in names
        assert "Independent Wire" in names
        assert "Right Report" in names
        # Deduplication: "Right Report" appears once, not twice
        assert names.count("Right Report") == 1

    async def test_filter_by_country(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?country=GB")
        assert resp.status_code == 200
        data = resp.json()
        assert all(s["country"] == "GB" for s in data)
        assert any(s["name"] == "State Gazette" for s in data)

    async def test_filter_by_bias(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?bias=left")
        assert resp.status_code == 200
        data = resp.json()
        assert all(s["bias_rating"] == "left" for s in data)

    async def test_filter_by_funding(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?funding=nonprofit")
        assert resp.status_code == 200
        data = resp.json()
        assert all(s["funding_type"] == "nonprofit" for s in data)

    async def test_search_by_name(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?search=Test")
        assert resp.status_code == 200
        data = resp.json()
        assert any(s["name"] == "Test News" for s in data)

    async def test_includes_filter_scores(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?limit=500")
        assert resp.status_code == 200
        data = resp.json()
        test_news = next(s for s in data if s["name"] == "Test News")
        assert test_news["filter_scores"] is not None
        assert "ownership" in test_news["filter_scores"]
        assert test_news["filter_scores"]["ownership"] == 1

    async def test_includes_index_status(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?limit=500")
        assert resp.status_code == 200
        data = resp.json()
        test_news = next(s for s in data if s["name"] == "Test News")
        assert test_news["index_status"] == "complete"
        assert test_news["last_indexed_at"] is not None

    async def test_unindexed_source_has_unindexed_status(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?limit=500")
        assert resp.status_code == 200
        data = resp.json()
        indep = next(s for s in data if s["name"] == "Independent Wire")
        assert indep["index_status"] == "unindexed"

    async def test_includes_metadata(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?limit=500")
        assert resp.status_code == 200
        data = resp.json()
        test_news = next(s for s in data if s["name"] == "Test News")
        assert test_news["parent_company"] == "Test News Corp"
        assert test_news["credibility_score"] == pytest.approx(0.85)

    async def test_pagination(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?limit=2&offset=0")
        assert resp.status_code == 200
        page1 = resp.json()
        assert len(page1) <= 2

    async def test_empty_search_returns_empty(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources?search=nonexistentsource")
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
class TestGetSourceWiki:
    """GET /api/wiki/sources/{source_name}"""

    async def test_returns_source_profile(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Test News"
        assert data["country"] == "US"
        assert data["funding_type"] == "commercial"
        assert data["bias_rating"] == "center"

    async def test_includes_filter_scores_array(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["filter_scores"], list)
        assert len(data["filter_scores"]) == 6
        names = {s["filter_name"] for s in data["filter_scores"]}
        assert names == {
            "ownership",
            "advertising",
            "sourcing",
            "flak",
            "ideology",
            "class_interest",
        }

    async def test_filter_score_has_prose(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News")
        data = resp.json()
        score = next(
            s for s in data["filter_scores"] if s["filter_name"] == "ownership"
        )
        assert score["score"] == 1
        assert score["confidence"] == "high"
        assert "ownership" in score["prose_explanation"]

    async def test_includes_reporters(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News")
        data = resp.json()
        assert isinstance(data["reporters"], list)
        assert len(data["reporters"]) >= 1
        reporter_names = [r["name"] for r in data["reporters"]]
        assert "Jane Doe" in reporter_names

    async def test_includes_article_count(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News")
        data = resp.json()
        assert data["article_count"] == 2

    async def test_includes_metadata_fields(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News")
        data = resp.json()
        assert data["parent_company"] == "Test News Corp"
        assert data["source_type"] == "newspaper"
        assert data["is_state_media"] is False
        assert data["credibility_score"] == pytest.approx(0.85)
        assert "US" in data["geographic_focus"]

    async def test_includes_index_status(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News")
        data = resp.json()
        assert data["index_status"] == "complete"
        assert data["last_indexed_at"] is not None

    async def test_unknown_source_returns_404(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Nonexistent%20Source")
        assert resp.status_code == 404

    async def test_source_without_metadata(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/State%20Gazette")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "State Gazette"
        assert data["parent_company"] is None
        assert data["credibility_score"] is None
        assert data["filter_scores"] == []


@pytest.mark.asyncio
class TestGetSourceFilters:
    """GET /api/wiki/sources/{source_name}/filters"""

    async def test_returns_filter_scores(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News/filters")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 6

    async def test_unknown_source_returns_404(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Nonexistent/filters")
        assert resp.status_code == 404
        assert "no filter scores found" in resp.json()["detail"].lower()


@pytest.mark.asyncio
class TestGetSourceReporters:
    """GET /api/wiki/sources/{source_name}/reporters"""

    async def test_returns_reporters_for_source(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Test%20News/reporters")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(r["name"] == "Jane Doe" for r in data)

    async def test_source_with_no_reporters(self, client: AsyncClient):
        resp = await client.get("/api/wiki/sources/Independent%20Wire/reporters")
        assert resp.status_code == 200
        assert resp.json() == []
