"""Offset pagination on the entity-research list endpoints must be deterministic.

SQLite happens to return rows in insertion order, so these assertions also
hold without an explicit ORDER BY there; on PostgreSQL the planner is free
to return any order, which made LIMIT/OFFSET pages unstable. The test pins
the contract: pages walk ids in ascending order with no overlap.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_reporter_pages_are_ordered_and_disjoint(client: AsyncClient) -> None:
    page1 = (await client.get("/research/entity/reporters?limit=1&offset=0")).json()
    page2 = (await client.get("/research/entity/reporters?limit=1&offset=1")).json()

    assert len(page1) == 1
    assert len(page2) == 1
    assert page1[0]["id"] < page2[0]["id"]


@pytest.mark.asyncio
async def test_organization_pages_are_ordered_and_disjoint(client: AsyncClient) -> None:
    page1 = (await client.get("/research/entity/organizations?limit=2&offset=0")).json()
    page2 = (await client.get("/research/entity/organizations?limit=2&offset=2")).json()

    assert len(page1) == 2
    assert page1[0]["id"] < page1[1]["id"]
    assert {row["id"] for row in page1}.isdisjoint({row["id"] for row in page2})
