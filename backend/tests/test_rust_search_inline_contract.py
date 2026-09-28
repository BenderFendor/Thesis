"""Offline contracts for the Rust search and inline-definition boundaries."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.api.routes import inline as inline_routes
from app.api.routes import search as search_routes

ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = ROOT / "backend" / "openapi.json"
SEARCH_RUST_PATH = ROOT / "backend" / "crates" / "thesis-api" / "src" / "search.rs"
INLINE_RUST_PATH = ROOT / "backend" / "crates" / "thesis-api" / "src" / "inline.rs"

OPERATIONS = {
    ("/api/search/semantic", "get"): "semantic_search_api_search_semantic_get",
    ("/api/inline/define", "post"): "define_inline_api_inline_define_post",
}


def _openapi() -> dict[str, Any]:
    return json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))


def test_rust_search_and_inline_declare_exact_operation_ids_once() -> None:
    sources = (SEARCH_RUST_PATH.read_text(encoding="utf-8"), INLINE_RUST_PATH.read_text(encoding="utf-8"))
    for operation_id in OPERATIONS.values():
        declaration = f'operation_id = "{operation_id}"'
        assert sum(source.count(declaration) for source in sources) == 1


def test_public_openapi_search_and_inline_contracts_are_unchanged() -> None:
    document = _openapi()

    search = document["paths"]["/api/search/semantic"]["get"]
    assert search["operationId"] == OPERATIONS[("/api/search/semantic", "get")]
    assert set(search["responses"]) == {"200", "422"}
    parameters = {parameter["name"]: parameter for parameter in search["parameters"]}
    assert parameters["query"]["required"] is True
    assert parameters["query"]["schema"]["minLength"] == 3
    assert parameters["limit"]["schema"]["default"] == 10
    assert parameters["limit"]["schema"]["maximum"] == 50
    assert parameters["category"]["schema"]["anyOf"][-1] == {"type": "null"}

    inline = document["paths"]["/api/inline/define"]["post"]
    assert inline["operationId"] == OPERATIONS[("/api/inline/define", "post")]
    assert set(inline["responses"]) == {"200", "422"}
    assert (
        inline["requestBody"]["content"]["application/json"]["schema"]["$ref"]
        == "#/components/schemas/InlineDefineRequest"
    )
    assert (
        inline["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        == "#/components/schemas/InlineDefineResponse"
    )


@pytest.mark.asyncio
async def test_fastapi_search_validation_is_provider_free(client: Any) -> None:
    missing = await client.get("/api/search/semantic")
    assert missing.status_code == 422
    assert missing.json()["detail"][0]["loc"] == ["query", "query"]
    assert missing.json()["detail"][0]["type"] == "missing"

    too_short = await client.get("/api/search/semantic", params={"query": "ab"})
    assert too_short.status_code == 422
    assert too_short.json()["detail"][0]["loc"] == ["query", "query"]
    assert too_short.json()["detail"][0]["type"] == "string_too_short"


@pytest.mark.asyncio
async def test_fastapi_search_unavailable_vector_store_keeps_503_contract(
    client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(search_routes, "get_vector_store", lambda: None)
    response = await client.get("/api/search/semantic", params={"query": "climate"})
    assert response.status_code == 503
    assert response.json() == {"detail": "Vector store is not available"}


@pytest.mark.asyncio
async def test_fastapi_inline_validation_and_empty_term_statuses_are_provider_free(
    client: Any,
) -> None:
    missing = await client.post("/api/inline/define", json={})
    assert missing.status_code == 422
    assert missing.json()["detail"][0]["loc"] == ["body", "term"]
    assert missing.json()["detail"][0]["type"] == "missing"

    empty = await client.post("/api/inline/define", json={"term": "  "})
    assert empty.status_code == 400
    assert empty.json() == {"detail": "Term must not be empty"}


@pytest.mark.asyncio
async def test_fastapi_inline_provider_failures_are_200_explicit_failures(
    client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unavailable(term: str, context: str | None = None) -> dict[str, str]:
        assert term == "Janet Yellen"
        assert context == "US economics"
        return {"error": "OpenRouter API key not configured"}

    monkeypatch.setattr(inline_routes, "define_term_with_gemini", unavailable)
    response = await client.post(
        "/api/inline/define",
        json={"term": " Janet Yellen ", "context": "US economics"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "success": False,
        "term": " Janet Yellen ",
        "definition": None,
        "error": "OpenRouter API key not configured",
    }


@pytest.mark.asyncio
async def test_fastapi_inline_provider_success_keeps_nullable_error_field(
    client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def success(term: str, context: str | None = None) -> dict[str, str]:
        return {"definition": f"Definition for {term} in {context}."}

    monkeypatch.setattr(inline_routes, "define_term_with_gemini", success)
    response = await client.post(
        "/api/inline/define",
        json={"term": " Janet Yellen ", "context": "US economics"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "term": " Janet Yellen ",
        "definition": "Definition for Janet Yellen in US economics.",
        "error": None,
    }
