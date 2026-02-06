"""Tests for wiki organization and ownership graph endpoints."""

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


@pytest.mark.asyncio
class TestOwnershipGraph:
    """GET /api/wiki/organizations/graph"""

    async def test_returns_graph_structure(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations/graph")
        assert resp.status_code == 200
        data = resp.json()
        assert "nodes" in data
        assert "edges" in data
        assert isinstance(data["nodes"], list)
        assert isinstance(data["edges"], list)

    async def test_graph_has_source_nodes(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations/graph")
        data = resp.json()
        source_nodes = [n for n in data["nodes"] if n["type"] == "source"]
        assert len(source_nodes) >= 1
        labels = [n["label"] for n in source_nodes]
        assert "Test News" in labels

    async def test_graph_has_org_nodes(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations/graph")
        data = resp.json()
        org_nodes = [n for n in data["nodes"] if n["type"] != "source"]
        assert len(org_nodes) >= 1

    async def test_graph_has_ownership_edges(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations/graph")
        data = resp.json()
        ownership_edges = [e for e in data["edges"] if e.get("type") == "ownership"]
        # State Gazette Holdings -> Parent Media Group
        assert len(ownership_edges) >= 1

    async def test_graph_node_ids_are_prefixed(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations/graph")
        data = resp.json()
        for node in data["nodes"]:
            assert node["id"].startswith("source:") or node["id"].startswith("org:")

    async def test_graph_edges_reference_valid_nodes(self, client: AsyncClient):
        resp = await client.get("/api/wiki/organizations/graph")
        data = resp.json()
        node_ids = {n["id"] for n in data["nodes"]}
        for edge in data["edges"]:
            assert edge["source"] in node_ids or edge["source"].startswith("org:")
            assert edge["target"] in node_ids
