"""Tests for wiki reporter endpoints: listing and dossier."""

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Article, ArticleAuthor, Reporter


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

    async def test_reporter_graph_route(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/graph")
        assert resp.status_code == 200
        data = resp.json()
        node_ids = {node["id"] for node in data["nodes"]}
        assert {"reporter:1", "reporter:2"}.issubset(node_ids)
        assert isinstance(data["edges"], list)

    async def test_reporter_graph_respects_edge_limit(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        reporters = [
            Reporter(
                id=reporter_id,
                name=f"Graph Reporter {reporter_id}",
                normalized_name=f"graph reporter {reporter_id}",
                article_count=10 - reporter_id,
            )
            for reporter_id in range(10, 14)
        ]
        articles = [
            Article(
                id=article_id,
                title=f"Graph Article {article_id}",
                source="Shared Outlet",
                url=f"https://shared.example.com/{article_id}",
                author=f"Graph Reporter {article_id}",
                authors=[f"Graph Reporter {article_id}"],
                published_at=now,
                category="general",
            )
            for article_id in range(10, 14)
        ]
        db_session.add_all(reporters)
        db_session.add_all(articles)
        db_session.add_all(
            [
                ArticleAuthor(article_id=article_id, reporter_id=article_id)
                for article_id in range(10, 14)
            ]
        )
        await db_session.commit()

        resp = await client.get("/api/wiki/reporters/graph?limit=20&edge_limit=2")

        assert resp.status_code == 200
        assert len(resp.json()["edges"]) <= 2


@pytest.mark.asyncio
class TestGetReporterDossier:
    """GET /api/wiki/reporters/{reporter_id}"""

    async def test_returns_full_dossier(self, client: AsyncClient):
        resp = await client.get("/api/wiki/reporters/1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Jane Doe"
        assert data["canonical_name"] == "Jane Doe"
        assert data["match_status"] == "matched"
        assert data["bio"] == "Veteran journalist covering politics."
        assert data["political_leaning"] == "center-left"
        assert data["leaning_confidence"] == "high"
        assert data["article_count"] == 42
        assert data["wikidata_qid"] == "Q100"
        assert data["citations"][0]["label"] == "Wikipedia lead"
        assert data["activity_summary"]["article_count"] >= 1
        assert data["activity_summary"]["outlets"][0]["name"] == "Test News"

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
        assert "activity_summary" in data
        assert "author_pages" in data["activity_summary"]

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
