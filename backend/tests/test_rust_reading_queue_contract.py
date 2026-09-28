"""Offline contract coverage for the persisted B06 reading queue boundary."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = ROOT / "docs" / "agents" / "rust-openapi-operation-inventory.json"
OPENAPI_PATH = ROOT / "backend" / "openapi.json"
RUST_API_PATH = ROOT / "backend" / "crates" / "thesis-api" / "src" / "reading_queue.rs"
RUST_DB_PATH = ROOT / "backend" / "crates" / "thesis-db" / "src" / "reading_queue.rs"

OPERATIONS = {
    ("/api/queue/add", "post"): "add_to_queue_api_queue_add_post",
    ("/api/queue/{queue_id}", "delete"): "remove_from_queue_api_queue__queue_id__delete",
    ("/api/queue/{queue_id}", "patch"): "update_queue_item_api_queue__queue_id__patch",
    (
        "/api/queue/url/{article_url}",
        "delete",
    ): "remove_from_queue_by_url_api_queue_url__article_url__delete",
    ("/api/queue", "get"): "get_queue_api_queue_get",
    (
        "/api/queue/maintenance/move-expired",
        "post",
    ): "move_expired_items_api_queue_maintenance_move_expired_post",
    ("/api/queue/overview", "get"): "get_queue_overview_api_queue_overview_get",
    ("/api/queue/shelves", "get"): "get_shelves_api_queue_shelves_get",
    ("/api/queue/shelves", "post"): "create_shelf_api_queue_shelves_post",
    (
        "/api/queue/shelves/{shelf_id}",
        "patch",
    ): "update_shelf_api_queue_shelves__shelf_id__patch",
    (
        "/api/queue/maintenance/archive",
        "post",
    ): "archive_completed_items_api_queue_maintenance_archive_post",
    (
        "/api/queue/{queue_id}/content",
        "get",
    ): "get_queue_item_content_api_queue__queue_id__content_get",
    ("/api/queue/digest/daily", "get"): "get_daily_digest_api_queue_digest_daily_get",
    ("/api/queue/digest", "post"): "generate_ai_digest_api_queue_digest_post",
    ("/api/queue/highlights", "get"): "get_all_highlights_api_queue_highlights_get",
    ("/api/queue/highlights", "post"): "create_highlight_api_queue_highlights_post",
    (
        "/api/queue/highlights/article/{article_url}",
        "get",
    ): "get_article_highlights_api_queue_highlights_article__article_url__get",
    (
        "/api/queue/highlights/{highlight_id}",
        "patch",
    ): "update_highlight_api_queue_highlights__highlight_id__patch",
    (
        "/api/queue/highlights/{highlight_id}",
        "delete",
    ): "delete_highlight_api_queue_highlights__highlight_id__delete",
}


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_inventory_keeps_every_queue_operation_exactly() -> None:
    inventory = _json(INVENTORY_PATH)
    observed = {
        (row["path"], row["method"].lower()): row["operation_id"]
        for row in inventory["operations"]
        if row["batch"] == "B06"
    }
    assert len(observed) == 19
    assert observed == OPERATIONS


def test_queue_digest_is_migrated_as_an_external_provider_operation() -> None:
    inventory = _json(INVENTORY_PATH)
    operation = next(
        row
        for row in inventory["operations"]
        if row["operation_id"] == "generate_ai_digest_api_queue_digest_post"
    )

    assert operation["migrated"] is True
    assert operation["risk_flags"] == ["external_provider"]


def test_openapi_preserves_queue_methods_bodies_and_success_statuses() -> None:
    document = _json(OPENAPI_PATH)
    for (path, method), operation_id in OPERATIONS.items():
        operation = document["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert "security" not in operation
        if method == "delete":
            assert "204" in operation["responses"]
        else:
            assert "200" in operation["responses"]
        if method in {"post", "patch"} and path not in {
            "/api/queue/maintenance/move-expired",
            "/api/queue/maintenance/archive",
        }:
            assert "422" in operation["responses"]


def test_rust_db_uses_transactions_ownership_and_persisted_digest_queries() -> None:
    source = RUST_DB_PATH.read_text(encoding="utf-8")
    assert source.count("self.pool.begin()") >= 7
    assert "WHERE article_url = $1 AND user_id = $2 FOR UPDATE" in source
    assert "ON CONFLICT (article_url) DO UPDATE" in source
    assert "ON CONFLICT (user_id, name) DO UPDATE" in source
    assert "INTERVAL '7 days'" in source
    assert "INTERVAL '30 days'" in source
    assert "LIMIT 5" in source
    assert "estimated_read_time_minutes" in source


@pytest.mark.asyncio
async def test_fastapi_queue_contract_is_local_and_url_idempotent(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The Python oracle remains observable while Rust removes provider I/O.

    The extraction sidecar is replaced with a local result so this contract test
    never calls a live provider. Rust intentionally persists null extraction
    metrics on add; this test only asserts the shared wire fields and idempotency.
    """

    async def local_metrics(_article_url: str) -> tuple[str, int, int]:
        return "captured article text", 3, 1

    monkeypatch.setattr("app.services.reading_queue._extract_queue_metrics", local_metrics)
    shelf = await client.post(
        "/api/queue/shelves", json={"name": "Research", "description": "Keep"}
    )
    assert shelf.status_code == 200
    shelf_id = shelf.json()["id"]

    request = {
        "article_id": 1,
        "article_title": "Article A",
        "article_url": "https://testnews.example.com/a",
        "article_source": "Test News",
        "queue_type": "daily",
        "why_saved": "Compare the claims",
        "shelf_id": shelf_id,
    }
    added = await client.post("/api/queue/add", json=request)
    repeated = await client.post(
        "/api/queue/add",
        json={**request, "why_saved": "Updated reason"},
    )
    assert added.status_code == repeated.status_code == 200
    assert repeated.json()["id"] == added.json()["id"]
    assert repeated.json()["why_saved"] == "Updated reason"
    assert repeated.json()["shelf_id"] == shelf_id

    queue = await client.get("/api/queue")
    overview = await client.get("/api/queue/overview")
    content = await client.get(f"/api/queue/{added.json()['id']}/content")
    digest = await client.get("/api/queue/digest/daily")
    assert (
        queue.status_code
        == overview.status_code
        == content.status_code
        == digest.status_code
        == 200
    )
    assert queue.json()["total_count"] == 1
    assert overview.json()["unread_count"] == 1
    assert content.json()["article_url"] == request["article_url"]
    assert digest.json()["total_items"] == 1
    assert digest.json()["digest_items"][0]["id"] == added.json()["id"]


def test_rust_add_records_local_metadata_without_provider_extraction() -> None:
    source = RUST_DB_PATH.read_text(encoding="utf-8")
    assert "Article extraction is intentionally not part" in source
    assert "word_count, estimated_read_time_minutes, full_text" in source
    assert "'unread', NOW(), NULL, NULL, NULL" in source


def test_rust_queue_response_keeps_status_and_datetime_wire_fields() -> None:
    source = RUST_API_PATH.read_text(encoding="utf-8")
    assert "pub read_status: String" in source
    assert '#[schema(required = false, default = "unread")]' in source
    assert "pub added_at: DateTime<Utc>" in source
    assert "pub archived_at: Option<DateTime<Utc>>" in source
