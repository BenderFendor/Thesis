"""The GDELT singleton's pooled httpx client must be closed on shutdown."""

from __future__ import annotations

import pytest

import app.main as main_module
from app.services.gdelt_query import get_gdelt_query_service


@pytest.mark.asyncio
async def test_on_shutdown_closes_gdelt_http_client(monkeypatch) -> None:
    """on_shutdown must release the process-lifetime GDELT HTTP pool."""
    service = get_gdelt_query_service()
    closed = False

    async def fake_close() -> None:
        nonlocal closed
        closed = True

    monkeypatch.setattr(service, "close", fake_close)
    try:
        await main_module.on_shutdown()
    finally:
        monkeypatch.undo()

    assert closed, "on_shutdown did not close the GDELT query service client"
