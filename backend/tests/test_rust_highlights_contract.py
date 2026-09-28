"""Observable contracts for the Rust highlight migration boundary.

FastAPI remains the public reference in this slice.  The tests pin the exact
inventory rows, unauthenticated single-user behavior, persisted CRUD shape,
URL scoping, and the legacy duplicate-create oracle that the Rust persistence
layer intentionally strengthens.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from httpx import AsyncClient


_ROOT = Path(__file__).resolve().parents[2]
_INVENTORY_PATH = _ROOT / "docs" / "agents" / "rust-openapi-operation-inventory.json"
_HIGHLIGHT_OPERATIONS = {
    "get_all_highlights_api_queue_highlights_get": ("GET", "/api/queue/highlights"),
    "create_highlight_api_queue_highlights_post": ("POST", "/api/queue/highlights"),
    "get_article_highlights_api_queue_highlights_article__article_url__get": (
        "GET",
        "/api/queue/highlights/article/{article_url}",
    ),
    "update_highlight_api_queue_highlights__highlight_id__patch": (
        "PATCH",
        "/api/queue/highlights/{highlight_id}",
    ),
    "delete_highlight_api_queue_highlights__highlight_id__delete": (
        "DELETE",
        "/api/queue/highlights/{highlight_id}",
    ),
}


def _highlight_operations() -> dict[str, tuple[str, str]]:
    document = json.loads(_INVENTORY_PATH.read_text(encoding="utf-8"))
    return {
        operation["operation_id"]: (operation["method"], operation["path"])
        for operation in document["operations"]
        if operation["operation_id"] in _HIGHLIGHT_OPERATIONS
    }


def test_highlight_inventory_keeps_exact_operation_ids_methods_and_paths() -> None:
    assert _highlight_operations() == _HIGHLIGHT_OPERATIONS


@pytest.mark.asyncio
async def test_fastapi_highlight_crud_is_persisted_and_unauthenticated(
    client: AsyncClient,
) -> None:
    article_url = "https://example.test/story/one"
    first_response = await client.post(
        "/api/queue/highlights",
        json={
            "article_url": article_url,
            "highlighted_text": "First passage",
            "character_start": 0,
            "character_end": 14,
            "note": "Keep this context",
        },
    )
    second_response = await client.post(
        "/api/queue/highlights",
        json={
            "article_url": article_url,
            "highlighted_text": "Second passage",
            "color": "blue",
            "character_start": 15,
            "character_end": 30,
        },
    )

    assert first_response.status_code == second_response.status_code == 200
    first = first_response.json()
    second = second_response.json()
    assert first["id"] != second["id"]
    assert first["user_id"] == second["user_id"] == 1
    assert first["color"] == "yellow"
    assert first["note"] == "Keep this context"
    assert first["created_at"]
    assert first["updated_at"]

    all_response = await client.get("/api/queue/highlights")
    article_response = await client.get(
        "/api/queue/highlights/article/" + quote(article_url, safe="")
    )
    assert {item["id"] for item in all_response.json()} == {first["id"], second["id"]}
    assert {item["id"] for item in article_response.json()} == {first["id"], second["id"]}

    update_response = await client.patch(
        f"/api/queue/highlights/{first['id']}",
        json={"color": "red", "note": "Updated context"},
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["id"] == first["id"]
    assert updated["color"] == "red"
    assert updated["note"] == "Updated context"

    delete_response = await client.delete(f"/api/queue/highlights/{second['id']}")
    assert delete_response.status_code == 204
    assert delete_response.content == b""
    assert (await client.get("/api/queue/highlights")).json() == [updated]
    assert (await client.delete(f"/api/queue/highlights/{second['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_fastapi_highlight_reads_and_writes_are_user_scoped(
    client: AsyncClient,
    seeded_db: Any,
) -> None:
    from app.database import Highlight

    foreign = Highlight(
        user_id=2,
        article_url="https://example.test/foreign",
        highlighted_text="Hidden passage",
        character_start=0,
        character_end=14,
    )
    owned = Highlight(
        user_id=1,
        article_url="https://example.test/owned",
        highlighted_text="Visible passage",
        character_start=0,
        character_end=15,
    )
    seeded_db.add_all([foreign, owned])
    await seeded_db.commit()

    all_response = await client.get("/api/queue/highlights")
    assert all_response.status_code == 200
    assert [item["article_url"] for item in all_response.json()] == [owned.article_url]

    foreign_article = await client.get(
        "/api/queue/highlights/article/" + quote(foreign.article_url, safe="")
    )
    assert foreign_article.status_code == 200
    assert foreign_article.json() == []

    update = await client.patch(f"/api/queue/highlights/{foreign.id}", json={"note": "leak"})
    delete = await client.delete(f"/api/queue/highlights/{foreign.id}")
    assert update.status_code == delete.status_code == 404


@pytest.mark.asyncio
async def test_fastapi_duplicate_create_oracle_is_explicitly_preserved(
    client: AsyncClient,
) -> None:
    payload = {
        "article_url": "https://example.test/duplicate",
        "highlighted_text": "Repeated passage",
        "character_start": 4,
        "character_end": 20,
    }
    first = await client.post("/api/queue/highlights", json=payload)
    repeated = await client.post("/api/queue/highlights", json=payload)

    assert first.status_code == repeated.status_code == 200
    assert first.json()["id"] != repeated.json()["id"]
    # Rust intentionally returns the first persisted logical row for this key;
    # this assertion keeps the weaker FastAPI behavior visible during migration.


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"highlighted_text": "x", "character_start": 0, "character_end": 1}, "article_url"),
        (
            {
                "article_url": "https://example.test/story",
                "highlighted_text": 1,
                "character_start": 0,
                "character_end": 1,
            },
            "highlighted_text",
        ),
        (
            {
                "article_url": "https://example.test/story",
                "highlighted_text": "x",
                "character_start": 0.5,
                "character_end": 1,
            },
            "character_start",
        ),
    ],
)
async def test_fastapi_highlight_create_keeps_strict_validation(
    client: AsyncClient,
    payload: dict[str, object],
    field: str,
) -> None:
    response = await client.post("/api/queue/highlights", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", field]
