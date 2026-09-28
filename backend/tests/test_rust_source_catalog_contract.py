"""Offline contracts for the Rust RSS source catalog boundary."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from app.api.routes import sources

ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = ROOT / "backend" / "openapi.json"
RUST_SOURCE_PATH = ROOT / "backend" / "crates" / "thesis-api" / "src" / "source_catalog.rs"

OPERATIONS = {
    ("/sources", "get"): "get_sources_sources_get",
    ("/sources/add-rss", "post"): "add_rss_source_sources_add_rss_post",
    ("/sources/rss/validate", "post"): "validate_rss_source_sources_rss_validate_post",
    ("/sources/rss/promote", "post"): "promote_rss_source_sources_rss_promote_post",
    ("/sources/{domain}/credibility", "get"): "get_source_credibility_sources__domain__credibility_get",
}


def _openapi() -> dict[str, Any]:
    return json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))


def test_rust_source_catalog_declares_exact_operation_ids_once() -> None:
    source = RUST_SOURCE_PATH.read_text(encoding="utf-8")
    for operation_id in OPERATIONS.values():
        assert source.count(f'operation_id = "{operation_id}"') == 1


def test_public_source_catalog_openapi_contract_is_unchanged() -> None:
    document = _openapi()
    for route, operation_id in OPERATIONS.items():
        path, method = route
        operation = document["paths"][path][method]
        assert operation["operationId"] == operation_id
        expected_responses = {"200"} if path == "/sources" else {"200", "422"}
        assert set(operation["responses"]) == expected_responses
    add_schema = document["paths"]["/sources/add-rss"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    validate_schema = document["paths"]["/sources/rss/validate"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    promote_schema = document["paths"]["/sources/rss/promote"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    assert add_schema == {"$ref": "#/components/schemas/AddRssRequest"}
    assert validate_schema == {"$ref": "#/components/schemas/AddRssRequest"}
    assert promote_schema == {"$ref": "#/components/schemas/PromoteRssRequest"}


def test_checked_in_source_catalog_projection_is_provider_free() -> None:
    entries = asyncio.run(sources.get_sources())
    assert entries
    required = {
        "id",
        "slug",
        "name",
        "url",
        "rssUrl",
        "category",
        "country",
        "source_type",
        "is_paywalled",
        "funding_type",
        "bias_rating",
        "ownership_label",
    }
    assert required <= set(entries[0])
    assert entries[0]["id"] == entries[0]["slug"]


def test_rss_url_validation_keeps_fastapi_status_and_detail_contract() -> None:
    with pytest.raises(sources.HTTPException) as error:
        sources._normalize_source_url("ftp://example.com/feed")
    assert error.value.status_code == 400
    assert error.value.detail == "URL must start with http:// or https://"

