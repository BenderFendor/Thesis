"""Offline contracts for the Rust B09 profiling observability boundary."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = ROOT / "docs" / "agents" / "rust-openapi-operation-inventory.json"
OPENAPI_PATH = ROOT / "backend" / "openapi.json"
RUST_PROFILING_PATH = ROOT / "backend" / "crates" / "thesis-api" / "src" / "profiling.rs"

OPERATIONS = {
    ("/profiling/metrics", "get"): "metrics_profiling_metrics_get",
    ("/profiling/summary", "get"): "profiling_summary_profiling_summary_get",
    ("/profiling/bottlenecks", "get"): "bottlenecks_profiling_bottlenecks_get",
    ("/profiling/queries", "get"): "query_stats_profiling_queries_get",
    ("/profiling/startup", "get"): "startup_stats_profiling_startup_get",
    ("/profiling/slow-endpoints", "get"): "slow_endpoints_profiling_slow_endpoints_get",
    ("/profiling/reset", "post"): "reset_profiling_profiling_reset_post",
    ("/profiling/health", "get"): "profiling_health_profiling_health_get",
}


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_inventory_keeps_exact_b09_profiling_operations() -> None:
    document = _json(INVENTORY_PATH)
    rows = {
        (row["path"], row["method"].lower()): row["operation_id"]
        for row in document["operations"]
        if row["batch"] == "B09"
        and row["route_module"] == "backend/app/api/routes/profiling.py"
    }
    assert rows == OPERATIONS


def test_rust_profiling_declares_each_operation_id_once() -> None:
    source = RUST_PROFILING_PATH.read_text(encoding="utf-8")
    for operation_id in OPERATIONS.values():
        assert source.count(f'operation_id = "{operation_id}"') == 1


def test_public_openapi_profiling_contract_is_unchanged() -> None:
    document = _json(OPENAPI_PATH)
    for (path, method), operation_id in OPERATIONS.items():
        operation = document["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert "security" not in operation
        expected_responses = {"200", "422"} if path.endswith("slow-endpoints") else {"200"}
        assert set(operation["responses"]) == expected_responses

    parameter = document["paths"]["/profiling/slow-endpoints"]["get"]["parameters"][0]
    assert parameter["name"] == "limit"
    assert parameter["in"] == "query"
    assert parameter["required"] is False
    assert parameter["schema"] == {"type": "integer", "default": 5, "title": "Limit"}


def test_rust_boundary_requires_observer_and_rejects_unverifiable_metrics() -> None:
    source = RUST_PROFILING_PATH.read_text(encoding="utf-8")
    assert "trait ProfilingObserver" in source
    assert "State<ProfilingState>" in source
    assert "Profiling observer is not available" in source
    assert "StatusCode::SERVICE_UNAVAILABLE" in source
    assert "ProfilingError::Unavailable" in source
    assert "ProfilingError::Failed(detail)" in source
    assert "validate_observation" in source
    assert "escape_prometheus_label" in source
    assert "does not synthesize live metrics" in source
    assert "tokio::spawn" not in source
    assert "reqwest" not in source


def test_rust_projection_keeps_the_eight_public_handler_names() -> None:
    source = RUST_PROFILING_PATH.read_text(encoding="utf-8")
    for handler in (
        "metrics",
        "profiling_summary",
        "bottlenecks",
        "query_stats",
        "startup_stats",
        "slow_endpoints",
        "reset_profiling",
        "profiling_health",
    ):
        assert f"pub(crate) async fn {handler}" in source
