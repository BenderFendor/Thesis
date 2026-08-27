"""Tests for LittleSis bulk-data download and the JSON:API array parser.

Covers the auto-download path added to close the startup gap where
`ingest_littlesis_ownership` silently no-ops because
`backend/data/littlesis/entities.json.gz` was never fetched, plus the
streaming parser's compatibility with LittleSis's current bulk-dump shape
(a single top-level JSON array of `{"type", "id", "attributes"}` records,
not the historical newline-delimited flat-object format).
"""

from __future__ import annotations

import gzip
import json
import logging
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.services.littlesis_integration import (
    LITTLESIS_ENTITIES_FILE,
    LITTLESIS_RELATIONSHIPS_FILE,
    download_littlesis_bulk,
    load_littlesis_entities,
    load_littlesis_relationships,
)


@pytest.fixture(autouse=True)
def _isolated_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data_dir = tmp_path / "littlesis"
    monkeypatch.setattr("app.services.littlesis_integration.LITTLESIS_DATA_DIR", str(data_dir))
    return data_dir


@pytest.mark.asyncio
async def test_download_skips_only_the_file_already_present(
    _isolated_data_dir: Path,
) -> None:
    _isolated_data_dir.mkdir(parents=True, exist_ok=True)
    entities_path = _isolated_data_dir / LITTLESIS_ENTITIES_FILE
    entities_path.write_bytes(b"already-cached")
    requested_urls: list[str] = []

    class _RecordingTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            requested_urls.append(str(request.url))
            return httpx.Response(200, content=b"downloaded-relationships")

    async with httpx.AsyncClient(transport=_RecordingTransport()) as client:
        results = await download_littlesis_bulk(client=client)

    # The cached entities file must never trigger a request; only the
    # missing relationships file should have been fetched.
    assert len(requested_urls) == 1
    assert LITTLESIS_RELATIONSHIPS_FILE in requested_urls[0]
    assert results[LITTLESIS_ENTITIES_FILE] == str(entities_path)
    assert entities_path.read_bytes() == b"already-cached"


@pytest.mark.asyncio
async def test_download_both_files_already_present_makes_no_requests(
    _isolated_data_dir: Path,
) -> None:
    _isolated_data_dir.mkdir(parents=True, exist_ok=True)
    (_isolated_data_dir / LITTLESIS_ENTITIES_FILE).write_bytes(b"cached-entities")
    (_isolated_data_dir / LITTLESIS_RELATIONSHIPS_FILE).write_bytes(b"cached-relationships")

    class _FailIfCalledTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            raise AssertionError(f"should not fetch cached file: {request.url}")

    async with httpx.AsyncClient(transport=_FailIfCalledTransport()) as client:
        results = await download_littlesis_bulk(client=client)

    assert set(results) == {LITTLESIS_ENTITIES_FILE, LITTLESIS_RELATIONSHIPS_FILE}


@pytest.mark.asyncio
async def test_download_offline_logs_one_warning_and_returns_gracefully(
    _isolated_data_dir: Path, caplog: pytest.LogCaptureFixture
) -> None:
    class _OfflineTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

    async with httpx.AsyncClient(transport=_OfflineTransport()) as client:
        with caplog.at_level(logging.WARNING, logger="littlesis"):
            results = await download_littlesis_bulk(client=client)

    assert results == {}
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(warnings) == 1
    assert errors == []
    assert "offline" in warnings[0].getMessage().lower()


def test_load_littlesis_entities_missing_file_logs_no_error(
    _isolated_data_dir: Path, caplog: pytest.LogCaptureFixture
) -> None:
    missing_path = str(_isolated_data_dir / "does-not-exist.json.gz")
    with caplog.at_level(logging.DEBUG, logger="littlesis"):
        entities = load_littlesis_entities(missing_path)

    assert entities == []
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert errors == []


def _write_jsonapi_array(path: Path, records: list[dict[str, Any]]) -> None:
    payload = [{"type": "entities", "id": r["id"], "attributes": r} for r in records]
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(json.dumps(payload, separators=(",", ":")))


def test_load_littlesis_entities_parses_current_jsonapi_array_format(
    tmp_path: Path,
) -> None:
    """Regression test for the live bulk-dump shape: a single minified JSON
    array of `{"type", "id", "attributes": {...}}` records, not one JSON
    object per line."""
    path = tmp_path / "entities.json.gz"
    _write_jsonapi_array(
        path,
        [
            {
                "id": 1,
                "name": "Acme Media Holdings",
                "blurb": "media holding company",
                "primary_ext": "Org",
            },
            {
                "id": 2,
                "name": "Acme Widgets",
                "blurb": "widget manufacturer",
                "primary_ext": "Org",
            },
        ],
    )

    entities = load_littlesis_entities(str(path))

    assert len(entities) == 1
    assert entities[0]["id"] == 1
    assert entities[0]["name"] == "Acme Media Holdings"


def test_load_littlesis_relationships_parses_current_jsonapi_array_format(
    tmp_path: Path,
) -> None:
    path = tmp_path / "relationships.json.gz"
    payload = [
        {
            "type": "relationships",
            "id": 5001,
            "attributes": {
                "id": 5001,
                "category_id": 10,
                "entity1_id": 1,
                "entity2_id": 2,
                "description1": "Owns",
                "description2": "Is Owned By",
            },
        }
    ]
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(json.dumps(payload, separators=(",", ":")))

    relationships = load_littlesis_relationships(str(path))

    assert len(relationships) == 1
    assert relationships[0]["entity1_id"] == 1
    assert relationships[0]["entity2_id"] == 2
    assert relationships[0]["category_id"] == 10
