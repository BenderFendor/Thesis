"""Tests for the /categories endpoint.

Run with: pytest backend/test_categories.py -v
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_categories_endpoint_returns_expected_shape():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/categories")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, dict)
        assert "categories" in data
        assert isinstance(data["categories"], list)
