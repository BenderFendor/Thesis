"""Offline contracts for the Rust B10 jobs and image transport boundary."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = ROOT / "docs/agents/rust-openapi-operation-inventory.json"
OPENAPI_PATH = ROOT / "backend/openapi.json"

B10_OPERATIONS = {
    ("/jobs/refresh", "post"): "start_refresh_job_jobs_refresh_post",
    ("/jobs/{job_id}/stream", "get"): "stream_job_progress_jobs__job_id__stream_get",
    ("/jobs/{job_id}/status", "get"): "get_job_status_jobs__job_id__status_get",
    ("/image/proxy", "get"): "proxy_image_image_proxy_get",
    ("/image/cache/stats", "get"): "get_cache_stats_image_cache_stats_get",
    ("/image/cache/clear", "delete"): "clear_cache_image_cache_clear_delete",
    ("/image/og", "get"): "get_og_image_image_og_get",
}


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _response_schema(
    document: dict[str, Any], path: str, method: str
) -> dict[str, Any]:
    response = document["paths"][path][method]["responses"]["200"]
    schema = (
        response.get("content", {})
        .get("application/json", {})
        .get("schema", {})
    )
    reference = schema.get("$ref")
    if reference is not None:
        schema_name = reference.rsplit("/", 1)[-1]
        return document["components"]["schemas"][schema_name]
    return schema


def test_inventory_keeps_exact_b10_operations() -> None:
    document = _json(INVENTORY_PATH)
    observed = {
        (row["path"], row["method"].lower()): row["operation_id"]
        for row in document["operations"]
        if row["batch"] == "B10"
        and row["route_module"]
        in {"backend/app/api/routes/jobs.py", "backend/app/api/routes/image_proxy.py"}
    }
    assert observed == B10_OPERATIONS


def test_public_b10_openapi_contract_is_unchanged() -> None:
    document = _json(OPENAPI_PATH)
    expected_responses = {
        ("/jobs/refresh", "post"): {"200"},
        ("/jobs/{job_id}/stream", "get"): {"200", "422"},
        ("/jobs/{job_id}/status", "get"): {"200", "422"},
        ("/image/proxy", "get"): {"200", "422"},
        ("/image/cache/stats", "get"): {"200"},
        ("/image/cache/clear", "delete"): {"200"},
        ("/image/og", "get"): {"200", "422"},
    }
    for (path, method), operation_id in B10_OPERATIONS.items():
        operation = document["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert "security" not in operation
        assert set(operation["responses"]) == expected_responses[(path, method)]


def test_public_b10_parameters_and_consumer_schemas() -> None:
    document = _json(OPENAPI_PATH)
    paths = document["paths"]
    for path in ("/jobs/{job_id}/stream", "/jobs/{job_id}/status"):
        parameter = paths[path]["get"]["parameters"][0]
        assert parameter == {
            "name": "job_id",
            "in": "path",
            "required": True,
            "schema": {"type": "string", "title": "Job Id"},
        }

    for path in ("/image/proxy", "/image/og"):
        parameter = paths[path]["get"]["parameters"][0]
        assert parameter["name"] == "url"
        assert parameter["in"] == "query"
        assert parameter["required"] is True
        assert parameter["schema"] == {
            "type": "string",
            "description": (
                "URL of the image to proxy"
                if path == "/image/proxy"
                else "URL of the article to fetch OpenGraph image from"
            ),
            "title": "Url",
        }

    job_start = _response_schema(document, "/jobs/refresh", "post")
    assert set(job_start["required"]) == {"job_id", "status", "stream_url"}
    assert {
        name: job_start["properties"][name]["type"]
        for name in ("job_id", "status", "stream_url")
    } == {"job_id": "string", "status": "string", "stream_url": "string"}

    job_status = _response_schema(document, "/jobs/{job_id}/status", "get")
    assert set(job_status["required"]) == {"job_id", "status", "started_at", "progress"}
    progress = job_status["properties"]["progress"]
    assert progress["type"] == "object"
    assert progress["additionalProperties"] is True
    error_types = {
        variant["type"]
        for variant in job_status["properties"]["error"]["anyOf"]
    }
    assert error_types == {"string", "null"}

    assert _response_schema(document, "/jobs/{job_id}/stream", "get") == {}
    assert _response_schema(document, "/image/proxy", "get") == {}

    og_schema = _response_schema(document, "/image/og", "get")
    assert og_schema["type"] == "object"
    assert og_schema["additionalProperties"] == {"type": "string"}
    for path, method in (
        ("/image/cache/stats", "get"),
        ("/image/cache/clear", "delete"),
    ):
        cache_schema = _response_schema(document, path, method)
        assert cache_schema["type"] == "object"
        assert cache_schema["additionalProperties"] is True

