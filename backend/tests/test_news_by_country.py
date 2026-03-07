"""Tests for globe and local-lens country endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestNewsByCountry:
    async def test_country_heatmap_uses_recent_coverage_mentions(
        self, client: AsyncClient
    ):
        resp = await client.get("/news/by-country?hours=720")
        assert resp.status_code == 200
        data = resp.json()

        assert data["counts"]["CN"] == 3
        assert data["source_counts"]["US"] == 2
        assert data["window_hours"] == 720

    async def test_generated_aliases_match_demonyms(self, client: AsyncClient):
        resp = await client.get("/news/country/US?view=internal&limit=10&hours=720")
        assert resp.status_code == 200
        data = resp.json()

        assert data["matching_strategy"] == "country_mentions"
        assert any(
            "US" in article["mentioned_countries"] for article in data["articles"]
        )

    async def test_internal_view_prefers_local_self_coverage(self, client: AsyncClient):
        resp = await client.get("/news/country/US?view=internal&limit=10&hours=720")
        assert resp.status_code == 200
        data = resp.json()

        assert data["country_code"] == "US"
        assert data["matching_strategy"] == "country_mentions"
        assert data["total"] == 2
        assert {article["id"] for article in data["articles"]} == {1, 2}
        assert all(article["source_country"] == "US" for article in data["articles"])

    async def test_external_view_filters_to_foreign_coverage(self, client: AsyncClient):
        resp = await client.get("/news/country/CN?view=external&limit=10&hours=720")
        assert resp.status_code == 200
        data = resp.json()

        assert data["country_code"] == "CN"
        assert data["matching_strategy"] == "country_mentions"
        assert data["total"] == 3
        assert {article["id"] for article in data["articles"]} == {2, 3, 4}
        assert all(article["source_country"] != "CN" for article in data["articles"])
        assert all(
            "CN" in article["mentioned_countries"] for article in data["articles"]
        )

    async def test_internal_view_falls_back_to_source_origin_when_no_self_mentions(
        self, client: AsyncClient
    ):
        resp = await client.get("/news/country/GB?view=internal&limit=10&hours=720")
        assert resp.status_code == 200
        data = resp.json()

        assert data["country_code"] == "GB"
        assert data["matching_strategy"] == "source_origin_fallback"
        assert data["total"] == 1
        assert [article["id"] for article in data["articles"]] == [3]
