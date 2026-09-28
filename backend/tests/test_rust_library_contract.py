"""Observable contract coverage for the B05 Rust library migration boundary."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = ROOT / "backend" / "openapi.json"
RUST_LIBRARY_PATH = ROOT / "backend" / "crates" / "thesis-api" / "src" / "library.rs"

OPERATIONS = {
    ("/api/bookmarks", "get"): "list_bookmarks_api_bookmarks_get",
    ("/api/bookmarks", "post"): "create_bookmark_api_bookmarks_post",
    ("/api/bookmarks/{article_id}", "get"): "get_bookmark_api_bookmarks__article_id__get",
    ("/api/bookmarks/{article_id}", "put"): "update_bookmark_api_bookmarks__article_id__put",
    ("/api/bookmarks/{article_id}", "delete"): "delete_bookmark_api_bookmarks__article_id__delete",
    ("/api/liked", "get"): "list_liked_articles_api_liked_get",
    ("/api/liked", "post"): "create_liked_article_api_liked_post",
    ("/api/liked/{article_id}", "get"): "get_liked_article_api_liked__article_id__get",
    ("/api/liked/{article_id}", "delete"): "delete_liked_article_api_liked__article_id__delete",
}


def _openapi() -> dict[str, Any]:
    return json.loads(OPENAPI_PATH.read_text())


def test_rust_library_declares_every_inventory_operation_id_exactly_once() -> None:
    source = RUST_LIBRARY_PATH.read_text()
    for operation_id in OPERATIONS.values():
        declaration = f'operation_id = "{operation_id}"'
        assert source.count(declaration) == 1


def test_library_openapi_contract_keeps_methods_bodies_and_statuses() -> None:
    document = _openapi()
    for (path, method), operation_id in OPERATIONS.items():
        operation = document["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert "200" in operation["responses"]
        if method in {"post", "get"} and path in {"/api/bookmarks", "/api/liked"}:
            if method == "post":
                assert "201" in operation["responses"]
                request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
                assert request_schema["$ref"] == "#/components/schemas/BookmarkCreateRequest"
            else:
                assert "201" not in operation["responses"]
        if "{article_id}" in path or method == "post":
            assert "422" in operation["responses"]


@pytest.mark.asyncio
async def test_fastapi_library_contract_is_global_and_idempotent_without_auth(
    client: AsyncClient,
) -> None:
    bookmark = await client.post("/api/bookmarks", json={"article_id": 1})
    repeated_bookmark = await client.post("/api/bookmarks", json={"article_id": 1})
    liked = await client.post("/api/liked", json={"article_id": 1})
    repeated_liked = await client.post("/api/liked", json={"article_id": 1})

    assert bookmark.status_code == repeated_bookmark.status_code == 201
    assert liked.status_code == repeated_liked.status_code == 201
    bookmark_payload = bookmark.json()
    repeated_bookmark_payload = repeated_bookmark.json()
    liked_payload = liked.json()
    repeated_liked_payload = repeated_liked.json()
    assert bookmark_payload["created"] is True
    assert repeated_bookmark_payload["created"] is False
    assert repeated_bookmark_payload["bookmark_id"] == bookmark_payload["bookmark_id"]
    assert liked_payload["created"] is True
    assert repeated_liked_payload["created"] is False
    assert repeated_liked_payload["liked_id"] == liked_payload["liked_id"]

    bookmarks = await client.get("/api/bookmarks")
    liked_articles = await client.get("/api/liked")
    assert bookmarks.status_code == liked_articles.status_code == 200
    assert bookmarks.json()["total"] == liked_articles.json()["total"] == 1
    assert bookmarks.json()["bookmarks"][0]["article_id"] == 1
    assert liked_articles.json()["liked"][0]["article_id"] == 1
    assert bookmarks.json()["bookmarks"][0]["title"] == "Article A"
    assert liked_articles.json()["liked"][0]["title"] == "Article A"

    updated = await client.put("/api/bookmarks/1")
    deleted_bookmark = await client.delete("/api/bookmarks/1")
    deleted_liked = await client.delete("/api/liked/1")
    assert updated.status_code == 200
    assert updated.json()["updated"] is True
    assert deleted_bookmark.json() == {"deleted": True, "article_id": 1}
    assert deleted_liked.json() == {"deleted": True, "article_id": 1}
    assert (await client.delete("/api/bookmarks/1")).status_code == 404
    assert (await client.delete("/api/liked/1")).status_code == 404
