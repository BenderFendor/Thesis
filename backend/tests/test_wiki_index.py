"""Tests for wiki indexing status and trigger endpoints."""

import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient


@pytest.mark.asyncio
class TestWikiIndexStatus:
    """GET /api/wiki/index/status"""

    async def test_returns_status_summary(self, client: AsyncClient):
        resp = await client.get("/api/wiki/index/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_entries" in data
        assert "by_status" in data
        assert "by_type" in data

    async def test_counts_are_correct(self, client: AsyncClient):
        resp = await client.get("/api/wiki/index/status")
        data = resp.json()
        assert (
            data["total_entries"] == 2
        )  # Test News (complete) + State Gazette (pending)
        assert data["by_status"]["complete"] == 1
        assert data["by_status"]["pending"] == 1
        assert data["by_type"]["source"] == 2


@pytest.mark.asyncio
class TestTriggerSourceIndex:
    """POST /api/wiki/index/{source_name}"""

    async def test_trigger_calls_index_source(self, client: AsyncClient):
        with patch(
            "app.services.wiki_indexer.index_source",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_index:
            resp = await client.post("/api/wiki/index/Test%20News")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "complete"
            assert data["source"] == "Test News"
            mock_index.assert_called_once()

    async def test_trigger_returns_500_on_failure(self, client: AsyncClient):
        with patch(
            "app.services.wiki_indexer.index_source",
            new_callable=AsyncMock,
            return_value=False,
        ):
            resp = await client.post("/api/wiki/index/Test%20News")
            assert resp.status_code == 500

    async def test_trigger_unknown_source_still_attempts(self, client: AsyncClient):
        """Unknown sources get a fallback config and still attempt indexing."""
        with patch(
            "app.services.wiki_indexer.index_source",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_index:
            resp = await client.post("/api/wiki/index/Unknown%20Source")
            assert resp.status_code == 200
            mock_index.assert_called_once()
            # Verify it was called with a fallback config
            call_args = mock_index.call_args
            assert call_args[0][0] == "Unknown Source"
