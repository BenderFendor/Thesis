"""Extend OpenAPI with deterministic non-HTTP backend capabilities."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from starlette.routing import WebSocketRoute


def add_protocol_extensions(app: FastAPI) -> None:
    """Expose WebSocket routes beside HTTP operations for generated clients."""
    schema = app.openapi()
    websocket_operations: list[dict[str, Any]] = []
    for route in app.routes:
        if not isinstance(route, WebSocketRoute):
            continue
        operation_id = f"{route.name}_{route.path.strip('/').replace('/', '_') or 'root'}_ws"
        websocket_operations.append(
            {
                "operationId": operation_id,
                "path": route.path,
                "summary": (route.endpoint.__doc__ or route.name).strip().splitlines()[0],
            }
        )
    schema["x-scoop-websockets"] = sorted(
        websocket_operations, key=lambda item: item["operationId"]
    )
