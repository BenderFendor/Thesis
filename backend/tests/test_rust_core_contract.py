"""Contract coverage for the deterministic B01 Rust core boundary.

The route-level checks use the real FastAPI handlers for the public reference.
The Rust/Python differential checks call the production thesis-search kernel and
its retained Python oracle directly, so they do not require a database or a
network service.

The Rust shadow route deliberately keeps URL-only extraction outside this
deterministic boundary. FastAPI remains the public URL-extraction path until
the integrator wires a Rust HTTP extraction service; core.rs returns the same
200/error response shape for that branch instead of issuing an unbounded
provider call. This divergence is covered by the Rust route unit test and is
not mixed into the parity cases below.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.article_analysis import router as article_analysis_router
from app.api.routes.general import router as general_router
from app.services.language_diagnostics import (
    analyze_language_diagnostics_python,
)
from rss_parser_rust import analyze_language_diagnostics_json

ROOT = Path(__file__).resolve().parents[2]
RUST_SERVER = ROOT / "backend/target/debug/thesis-server"
LANGUAGE_ENDPOINT = "/api/article/language-diagnostics"


def _core_reference_app() -> FastAPI:
    """Build only the real deterministic FastAPI routers under test."""
    application = FastAPI()
    application.include_router(general_router)
    application.include_router(article_analysis_router)
    return application


def _rust_payload(text: str, title: str | None = None) -> dict[str, Any]:
    return json.loads(analyze_language_diagnostics_json(text, title))


def test_general_routes_preserve_public_shapes_and_category_order() -> None:
    client = TestClient(_core_reference_app())

    root = client.get("/")
    assert root.status_code == 200
    assert root.json() == {
        "message": "Global News Aggregation API is running!",
        "version": "1.0.0",
        "docs": "/docs",
    }

    health = client.get("/health")
    assert health.status_code == 200
    health_payload = health.json()
    assert health_payload["status"] == "healthy"
    assert re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00",
        health_payload["timestamp"],
    )

    categories = client.get("/categories")
    assert categories.status_code == 200
    category_values = categories.json()["categories"]
    assert category_values
    assert all(isinstance(category, str) for category in category_values)
    assert category_values == sorted(set(category_values))


def test_language_kernel_parity_covers_valid_empty_and_unicode_boundaries() -> None:
    fixtures = (
        (
            "The neighborhood was struck before dawn. "
            "Five residents were killed during what officials called a surgical strike. "
            "Officials described unrest near the square.",
            None,
        ),
        ("", None),
        ("   \u001c\u00a0\n\t", "Title is ignored by the deterministic kernel"),
        ("İ ı ſ K café cafe\u0301 123 _word word-word word's", None),
        ("The subject was " + "é" * 300 + " killed.", None),
    )

    for text, title in fixtures:
        expected = analyze_language_diagnostics_python(text, title)
        assert _rust_payload(text, title) == expected

    empty = _rust_payload("")
    assert empty["sentence_count"] == 0
    assert empty["word_count"] == 0
    assert empty["overall"] == {
        "score": 0.0,
        "status": "low",
        "summary": "Language diagnostics found limited passive or sanitized framing in the available text.",
    }


def test_language_endpoint_uses_real_handler_and_preserves_response_shape() -> None:
    text = "People were detained overnight. Officials described unrest near the square."
    expected = analyze_language_diagnostics_python(text)
    client = TestClient(_core_reference_app())

    response = client.post(
        LANGUAGE_ENDPOINT,
        json={
            "url": "https://example.com/story",
            "title": "Example story",
            "text": text,
            "source_name": "Example News",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["article_url"] == "https://example.com/story"
    assert payload["title"] == "Example story"
    assert payload["error"] is None
    for key, value in expected.items():
        assert payload[key] == value
    assert set(payload) == {
        "success",
        "article_url",
        "title",
        "sentence_count",
        "word_count",
        "passive_voice",
        "actor_omission",
        "euphemisms",
        "sanitized_language",
        "overall",
        "error",
    }


def test_language_endpoint_validation_matches_strict_request_contract() -> None:
    client = TestClient(_core_reference_app())
    cases = (
        ({}, "missing", ["body", "url"]),
        ({"url": 12}, "string_type", ["body", "url"]),
        ({"url": "https://example.com", "text": False}, "string_type", ["body", "text"]),
        ({"url": "https://example.com", "title": 5}, "string_type", ["body", "title"]),
        ({"url": "https://example.com", "source_name": []}, "string_type", ["body", "source_name"]),
    )

    for body, error_type, location in cases:
        response = client.post(LANGUAGE_ENDPOINT, json=body)
        assert response.status_code == 422
        detail = response.json()["detail"][0]
        assert detail["type"] == error_type
        assert detail["loc"] == location

    malformed = client.post(
        LANGUAGE_ENDPOINT,
        content=b"not-json",
        headers={"content-type": "application/json"},
    )
    assert malformed.status_code == 422
    assert malformed.json()["detail"][0]["loc"] == ["body"]
    assert malformed.json()["detail"][0]["type"] == "json_invalid"


def test_rust_openapi_declares_the_four_core_operations_when_built() -> None:
    if not RUST_SERVER.is_file():
        pytest.skip("build backend/crates/thesis-server before checking Rust OpenAPI")

    completed = subprocess.run(
        [str(RUST_SERVER), "--openapi"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    rust_openapi = json.loads(completed.stdout)
    expected_operation_ids = {
        "read_root__get": "/",
        "health_check_health_get": "/health",
        "get_categories_categories_get": "/categories",
        "analyze_article_language_api_article_language_diagnostics_post": LANGUAGE_ENDPOINT,
    }
    found: dict[str, str] = {}
    for path, path_item in rust_openapi["paths"].items():
        for operation in path_item.values():
            if not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if operation_id in expected_operation_ids:
                found[operation_id] = path
    assert found == expected_operation_ids
