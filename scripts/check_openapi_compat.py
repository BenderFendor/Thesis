#!/usr/bin/env python3
"""Compare selected Rust operations with the checked-in FastAPI contract."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head", "trace"}
IGNORED_SCHEMA_KEYS = {"description", "title"}


def _schema_ref(spec: Mapping[str, Any], reference: str) -> Any:
    prefix = "#/components/schemas/"
    if not reference.startswith(prefix):
        raise ValueError(f"unsupported OpenAPI reference: {reference}")
    target: Any = spec.get("components", {}).get("schemas", {})
    for part in reference[len(prefix) :].split("/"):
        target = target[part.replace("~1", "/").replace("~0", "~")]
    return target


def _normalize(
    value: Any, spec: Mapping[str, Any], refs: frozenset[str] = frozenset()
) -> Any:
    if isinstance(value, list):
        return [_normalize(item, spec, refs) for item in value]
    if not isinstance(value, dict):
        return value
    return _normalize_object(value, spec, refs)


def _normalize_object(
    value: Mapping[str, Any], spec: Mapping[str, Any], refs: frozenset[str]
) -> Any:
    resolved_reference = _resolve_reference(value, spec, refs)
    if resolved_reference is not None:
        return resolved_reference
    result = {
        key: _normalize(item, spec, refs)
        for key, item in value.items()
        if _keep_schema_field(value, key, item)
    }
    choices = _union_choices(value, spec, refs)
    if choices is not None:
        result["choices"] = choices
    _sort_required_fields(result)
    return result


def _resolve_reference(
    value: Mapping[str, Any], spec: Mapping[str, Any], refs: frozenset[str]
) -> Any | None:
    reference = value.get("$ref")
    if reference is None:
        return None
    if reference in refs:
        return {"$ref": reference}
    return _normalize(_schema_ref(spec, reference), spec, refs | {reference})


def _sort_required_fields(schema: dict[str, Any]) -> None:
    if "required" in schema:
        schema["required"] = sorted(schema["required"])


def _is_nullable_type(value: Any) -> bool:
    return isinstance(value, list) and "null" in value


def _is_generator_format_hint(schema: Mapping[str, Any], value: Any) -> bool:
    return (
        schema.get("type") == "integer"
        and value in {"int32", "int64"}
        or schema.get("type") == "number"
        and value == "double"
    )


def _keep_schema_field(schema: Mapping[str, Any], key: str, value: Any) -> bool:
    return (
        key not in IGNORED_SCHEMA_KEYS
        and key not in {"oneOf", "anyOf"}
        and not (key == "type" and _is_nullable_type(value))
        and not (key == "format" and _is_nullable_type(schema.get("type")))
        and not (key == "format" and _is_generator_format_hint(schema, value))
    )


def _nullable_type_choices(schema: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    types = schema.get("type")
    if not _is_nullable_type(types):
        return None
    choices = []
    for item in types:
        choice: dict[str, Any] = {"type": item}
        if item != "null" and "format" in schema:
            choice["format"] = schema["format"]
        choices.append(choice)
    return choices


def _union_choices(
    schema: Mapping[str, Any], spec: Mapping[str, Any], refs: frozenset[str]
) -> list[Any] | None:
    choices = schema.get("oneOf", schema.get("anyOf")) or _nullable_type_choices(schema)
    if choices is None:
        return None
    normalized = [_normalize(choice, spec, refs) for choice in choices]
    if any(choice == {} for choice in normalized):
        return None
    return sorted(
        normalized,
        key=lambda choice: json.dumps(choice, sort_keys=True, separators=(",", ":")),
    )


def _find_operation(
    spec: Mapping[str, Any], operation_id: str
) -> tuple[str, str, Mapping[str, Any]]:
    matches = []
    for path, path_item in spec.get("paths", {}).items():
        for method, operation in path_item.items():
            if method in HTTP_METHODS and operation.get("operationId") == operation_id:
                matches.append((path, method, operation))
    if len(matches) != 1:
        raise ValueError(f"expected one {operation_id!r}, found {len(matches)}")

    return matches[0]


def _parameters(
    spec: Mapping[str, Any], operation: Mapping[str, Any]
) -> list[dict[str, Any]]:
    parameters = [
        {
            key: _normalize(parameter[key], spec)
            for key in (
                "name",
                "in",
                "required",
                "schema",
                "style",
                "explode",
                "allowReserved",
            )
            if key in parameter
        }
        for parameter in operation.get("parameters", [])
    ]
    parameters.sort(key=lambda item: (item.get("in", ""), item.get("name", "")))
    return parameters


def _request_body(
    spec: Mapping[str, Any], operation: Mapping[str, Any]
) -> dict[str, Any] | None:
    request_body = operation.get("requestBody")
    if request_body is None:
        return None
    return {
        "required": request_body.get("required", False),
        "content": {
            media_type: _normalize(content.get("schema", {}), spec)
            for media_type, content in sorted(request_body.get("content", {}).items())
        },
    }


def _responses(spec: Mapping[str, Any], operation: Mapping[str, Any]) -> dict[str, Any]:
    return {
        status: {
            "content": {
                media_type: _normalize(content.get("schema", {}), spec)
                for media_type, content in sorted(response.get("content", {}).items())
            }
        }
        for status, response in sorted(operation.get("responses", {}).items())
    }


def _operation(
    spec: Mapping[str, Any], operation_id: str
) -> tuple[str, str, dict[str, Any]]:
    path, method, operation = _find_operation(spec, operation_id)
    return (
        path,
        method,
        {
            "operationId": operation_id,
            "parameters": _parameters(spec, operation),
            "requestBody": _request_body(spec, operation),
            "responses": _responses(spec, operation),
        },
    )


def _selected(spec: Mapping[str, Any], operation_ids: Iterable[str]) -> dict[str, Any]:
    return {
        operation_id: _operation(spec, operation_id) for operation_id in operation_ids
    }


def _load_spec(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_inventory_operation_ids(path: Path) -> list[str]:
    inventory = _load_spec(path)
    if not isinstance(inventory, Mapping):
        raise ValueError(f"operation inventory {path} must be a JSON object")

    operations = inventory.get("operations")
    if not isinstance(operations, list):
        raise ValueError(f"operation inventory {path} must contain an operations array")

    operation_ids: list[str] = []
    seen: set[str] = set()
    for index, operation in enumerate(operations):
        if not isinstance(operation, Mapping):
            raise ValueError(
                f"operation inventory {path} entry operations[{index}] must be an object"
            )
        migrated = operation.get("migrated")
        if not isinstance(migrated, bool):
            raise ValueError(
                f"operation inventory {path} entry operations[{index}] "
                "must have a boolean migrated field"
            )
        if not migrated:
            continue

        operation_id = operation.get("operation_id")
        if not isinstance(operation_id, str) or not operation_id.strip():
            raise ValueError(
                f"operation inventory {path} has an empty or invalid migrated "
                f"operation_id at operations[{index}]"
            )
        if operation_id != operation_id.strip():
            raise ValueError(
                f"operation inventory {path} has a whitespace-padded migrated "
                f"operation_id at operations[{index}]"
            )
        if operation_id in seen:
            raise ValueError(
                f"operation inventory {path} contains duplicate migrated "
                f"operation_id {operation_id!r}"
            )
        seen.add(operation_id)
        operation_ids.append(operation_id)

    if not operation_ids:
        raise ValueError(f"operation inventory {path} contains no migrated operation IDs")
    return operation_ids


def _operation_ids(
    python_spec: Mapping[str, Any],
    rust_spec: Mapping[str, Any],
    requested: list[str] | None,
    inventory_path: Path | None = None,
) -> list[str]:
    if requested:
        return requested
    if inventory_path is not None:
        return _load_inventory_operation_ids(inventory_path)
    _check_websocket_metadata(python_spec, rust_spec)
    return sorted(
        {
            operation.get("operationId")
            for path_item in python_spec.get("paths", {}).values()
            for method, operation in path_item.items()
            if method in HTTP_METHODS and operation.get("operationId")
        }
    )


def _check_websocket_metadata(
    python_spec: Mapping[str, Any], rust_spec: Mapping[str, Any]
) -> None:
    expected = _normalize(python_spec.get("x-scoop-websockets"), python_spec)
    actual = _normalize(rust_spec.get("x-scoop-websockets"), rust_spec)
    if expected != actual:
        raise ValueError("x-scoop-websockets metadata differs")


def _compare_operations(
    python_spec: Mapping[str, Any],
    rust_spec: Mapping[str, Any],
    operation_ids: list[str],
) -> None:
    expected = _selected(python_spec, operation_ids)
    actual = _selected(rust_spec, operation_ids)
    for operation_id in operation_ids:
        if expected[operation_id] != actual[operation_id]:
            raise ValueError(
                f"contract mismatch for {operation_id}\n"
                f"Python: {json.dumps(expected[operation_id], sort_keys=True)}\n"
                f"Rust:   {json.dumps(actual[operation_id], sort_keys=True)}"
            )


def compare_files(args: argparse.Namespace) -> None:
    """Compare selected Rust operations with the Python OpenAPI contract."""
    python_spec = _load_spec(args.python_openapi)
    rust_spec = _load_spec(args.rust_openapi)
    operation_ids = _operation_ids(
        python_spec, rust_spec, args.operation_ids, args.operation_inventory
    )
    _compare_operations(python_spec, rust_spec, operation_ids)
    print(f"OpenAPI contract matches for {len(operation_ids)} operation(s)")


def main() -> int:
    """Run the OpenAPI contract comparison CLI."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("python_openapi", type=Path)
    parser.add_argument("rust_openapi", type=Path)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument(
        "--operation-id",
        action="append",
        dest="operation_ids",
        help="compare this operation; repeat to compare multiple operations",
    )
    selection.add_argument(
        "--operation-inventory",
        type=Path,
        help="compare every migrated operation ID from an inventory JSON file",
    )
    try:
        compare_files(parser.parse_args())
        return 0
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"OpenAPI compatibility failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
