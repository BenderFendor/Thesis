"""Regression tests for inventory-driven OpenAPI compatibility selection."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts" / "check_openapi_compat.py"


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def _operation(operation_id: str, schema_type: str) -> dict[str, Any]:
    return {
        "operationId": operation_id,
        "responses": {
            "200": {
                "description": "OK",
                "content": {"application/json": {"schema": {"type": schema_type}}},
            }
        },
    }


def _run_checker(
    python_spec: Path, rust_spec: Path, inventory: Path
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(CHECKER),
            str(python_spec),
            str(rust_spec),
            "--operation-inventory",
            str(inventory),
        ],
        check=False,
        capture_output=True,
        text=True,
    )


def test_checker_compares_only_migrated_inventory_ids(tmp_path: Path) -> None:
    python_spec = {
        "openapi": "3.1.0",
        "info": {"title": "Python", "version": "1"},
        "paths": {
            "/migrated": {"get": _operation("get_migrated", "integer")},
            "/pending": {"get": _operation("get_pending", "integer")},
        },
    }
    rust_spec = {
        "openapi": "3.1.0",
        "info": {"title": "Rust", "version": "1"},
        "paths": {
            "/migrated": {"get": _operation("get_migrated", "integer")},
            "/pending": {"get": _operation("get_pending", "string")},
        },
    }
    inventory = {
        "operations": [
            {"operation_id": "get_migrated", "migrated": True},
            {"operation_id": "get_pending", "migrated": False},
        ]
    }
    python_path = tmp_path / "python-openapi.json"
    rust_path = tmp_path / "rust-openapi.json"
    inventory_path = tmp_path / "inventory.json"
    _write_json(python_path, python_spec)
    _write_json(rust_path, rust_spec)
    _write_json(inventory_path, inventory)

    result = _run_checker(python_path, rust_path, inventory_path)

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "OpenAPI contract matches for 1 operation(s)"


@pytest.mark.parametrize(
    ("operations", "expected_error"),
    [
        ([{"migrated": True, "operation_id": ""}], "empty or invalid migrated operation_id"),
        ([], "contains no migrated operation IDs"),
    ],
)
def test_checker_rejects_empty_migrated_inventory_ids(
    tmp_path: Path, operations: list[dict[str, Any]], expected_error: str
) -> None:
    spec_path = tmp_path / "openapi.json"
    inventory_path = tmp_path / "inventory.json"
    _write_json(
        spec_path,
        {
            "openapi": "3.1.0",
            "info": {"title": "OpenAPI", "version": "1"},
            "paths": {},
        },
    )
    _write_json(inventory_path, {"operations": operations})

    result = _run_checker(spec_path, spec_path, inventory_path)

    assert result.returncode == 1
    assert expected_error in result.stderr
