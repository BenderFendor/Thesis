"""Contract coverage for the generated Scoop CLI surface."""

from __future__ import annotations

from fastapi.routing import APIRoute, APIWebSocketRoute

from app.main import app


HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}


def test_openapi_covers_every_backend_http_and_websocket_route() -> None:
    schema = app.openapi()
    documented_http = {
        (path, method.upper())
        for path, path_item in schema["paths"].items()
        for method in path_item
        if method in HTTP_METHODS
    }
    backend_http = {
        (route.path_format, method)
        for route in app.routes
        if isinstance(route, APIRoute) and route.include_in_schema
        for method in route.methods
    }
    assert backend_http == documented_http

    documented_websockets = {
        (item["path"], item["operationId"]) for item in schema["x-scoop-websockets"]
    }
    backend_websockets = {
        (
            route.path,
            f"{route.name}_{route.path.strip('/').replace('/', '_') or 'root'}_ws",
        )
        for route in app.routes
        if isinstance(route, APIWebSocketRoute)
    }
    assert backend_websockets == documented_websockets


def test_cli_contract_has_unique_operation_ids_and_supported_request_bodies() -> None:
    schema = app.openapi()
    operations = [
        operation
        for path_item in schema["paths"].values()
        for method, operation in path_item.items()
        if method in HTTP_METHODS
    ]
    operation_ids = [operation["operationId"] for operation in operations]

    assert len(operation_ids) == len(set(operation_ids))
    assert all(operation_ids)
    assert {
        content_type
        for operation in operations
        for content_type in operation.get("requestBody", {}).get("content", {})
    } <= {"application/json"}
