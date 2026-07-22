"""Tests for wiki organization endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestListOrganizations:
    """GET /api/wiki/organizations"""

    async def test_returns_organizations(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 3
        names = [o["name"] for o in data]
        assert "Test News Corp" in names
        assert "Parent Media Group" in names
        assert "State Gazette Holdings" in names

    async def test_organization_fields(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations")
        data = resp.json()
        tnc = next(o for o in data if o["name"] == "Test News Corp")
        assert tnc["org_type"] == "publisher"
        assert tnc["funding_type"] == "commercial"
        assert tnc["media_bias_rating"] == "center"
        assert tnc["factual_reporting"] == "high"

    async def test_pagination(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations?limit=1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
