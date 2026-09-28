"""Behavior and OpenAPI contracts for the B03 cache stream endpoints.

FastAPI remains the public listener while Rust serves these routes as a shadow
implementation with explicit provider-unavailable defaults.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.api.routes import cache as cache_routes

ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = ROOT / "docs" / "agents" / "rust-openapi-operation-inventory.json"
OPENAPI_PATH = ROOT / "backend" / "openapi.json"

B03_OPERATIONS = {
    ("/cache/refresh", "post"): "manual_cache_refresh_cache_refresh_post",
    ("/cache/refresh/stream", "post"): "stream_cache_refresh_cache_refresh_stream_post",
    ("/cache/status", "get"): "get_cache_status_cache_status_get",
    ("/news/stream", "get"): "stream_news_news_stream_get",
    ("/updates/stream", "get"): "updates_stream_updates_stream_get",
    ("/updates/status", "get"): "get_updates_status_updates_status_get",
}

CACHE_STATUS_FIELDS = {
    "cache_age_seconds",
    "category_breakdown",
    "last_updated",
    "sources_with_errors",
    "sources_with_warnings",
    "sources_working",
    "total_articles",
    "total_sources",
    "update_in_progress",
}


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_inventory_keeps_exact_b03_operation_ids_methods_and_paths() -> None:
    document = _json(INVENTORY_PATH)
    operations = document["operations"]
    batch03 = [entry for entry in operations if entry["batch"] == "B03"]
    observed = {
        (entry["path"], entry["method"].lower()): entry["operation_id"]
        for entry in batch03
    }
    assert len(batch03) == 6
    assert observed == B03_OPERATIONS
    assert all(entry["migrated"] for entry in batch03)

    batch10 = [entry for entry in operations if entry["batch"] == "B10"]
    assert len(batch10) == 7
    assert all(entry["migrated"] for entry in batch10)

    counts = document["counts"]
    migrated_operations = [entry for entry in operations if entry["migrated"]]
    migrated_ids = {entry["operation_id"] for entry in migrated_operations}
    shadow_ids = document["shadow_operation_ids"]
    shadow_id_set = set(shadow_ids)
    assert counts["openapi_http_operations"] == len(operations) == 178
    assert counts["migrated_operations"] == len(migrated_operations) == len(shadow_ids)
    assert counts["remaining_operations"] == len(operations) - len(migrated_operations)
    assert len(migrated_ids) == len(migrated_operations)
    assert len(shadow_id_set) == len(shadow_ids)
    assert shadow_id_set == migrated_ids
    batch11 = [entry for entry in operations if entry["batch"] == "B11"]
    assert len(batch11) == 13
    assert all(entry["migrated"] for entry in batch11)

    batch_counts = {
        batch: sum(entry["batch"] == batch for entry in operations)
        for batch in document["counts"]["by_batch_all"]
    }
    assert document["counts"]["by_batch_all"] == batch_counts
    risk_flags = {
        flag
        for entry in operations
        if not entry["migrated"]
        for flag in entry["risk_flags"]
    }
    remaining_risk_flags = {
        flag: sum(
            flag in entry["risk_flags"]
            for entry in operations
            if not entry["migrated"]
        )
        for flag in risk_flags
    }
    assert set(document["counts"]["by_risk_flag_remaining"]) == risk_flags
    assert remaining_risk_flags == document["counts"]["by_risk_flag_remaining"]


def test_public_openapi_b03_contract_is_unchanged() -> None:
    document = _json(OPENAPI_PATH)
    paths = document["paths"]
    for (path, method), operation_id in B03_OPERATIONS.items():
        operation = paths[path][method]
        assert operation["operationId"] == operation_id
        assert "200" in operation["responses"]

    assert set(paths["/cache/refresh"]["post"]["responses"]) == {"200"}
    assert set(paths["/cache/refresh/stream"]["post"]["responses"]) == {"200"}
    assert set(paths["/cache/status"]["get"]["responses"]) == {"200"}
    assert set(paths["/news/stream"]["get"]["responses"]) == {"200", "422"}
    assert set(paths["/updates/stream"]["get"]["responses"]) == {"200"}
    assert set(paths["/updates/status"]["get"]["responses"]) == {"200"}

    news_parameters = {
        parameter["name"]: parameter for parameter in paths["/news/stream"]["get"]["parameters"]
    }
    assert news_parameters["use_cache"]["required"] is False
    assert news_parameters["use_cache"]["schema"]["default"] is True
    assert news_parameters["category"]["required"] is False
    assert news_parameters["category"]["schema"]["anyOf"][-1] == {"type": "null"}

    cache_refresh_schema = paths["/cache/refresh"]["post"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    assert cache_refresh_schema["type"] == "object"
    assert cache_refresh_schema["additionalProperties"] == {"type": "string"}

    assert (
        paths["/cache/status"]["get"]["responses"]["200"]["content"]["application/json"]["schema"][
            "$ref"
        ]
        == "#/components/schemas/CacheStatus"
    )


@pytest.mark.asyncio
async def test_fastapi_cache_status_keeps_complete_response_shape(client: Any) -> None:
    response = await client.get("/cache/status")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == CACHE_STATUS_FIELDS
    assert isinstance(payload["category_breakdown"], dict)
    assert isinstance(payload["update_in_progress"], bool)


@pytest.mark.asyncio
async def test_fastapi_manual_refresh_in_progress_status_is_explicit(
    client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cache_routes.news_cache, "update_in_progress", True)
    response = await client.post("/cache/refresh")
    assert response.status_code == 200
    assert response.json() == {
        "message": "Cache refresh already in progress",
        "status": "in_progress",
    }


@pytest.mark.asyncio
async def test_fastapi_refresh_stream_in_progress_is_an_error_sse_event(
    client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cache_routes.news_cache, "update_in_progress", True)
    response = await client.post("/cache/refresh/stream")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert json.loads(response.text.removeprefix("data: ").split("\n", 1)[0]) == {
        "status": "error",
        "message": "Cache refresh already in progress",
    }


@pytest.mark.asyncio
async def test_fastapi_updates_status_is_local_and_provider_free(client: Any) -> None:
    response = await client.get("/updates/status")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"active_subscribers", "total_events_sent"}
    assert payload["active_subscribers"] >= 0
    assert payload["total_events_sent"] >= 0
