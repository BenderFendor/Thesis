"""Regression tests for /api/news/research/stream SSE event parsing."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

import app.api.routes.research as research_module
from app.main import app


@pytest.mark.asyncio
async def test_stream_preserves_literal_data_prefix_inside_payload(monkeypatch) -> None:
    """A payload containing 'data: ' inside its JSON values must survive intact.

    The parser used str.replace('data: ', ''), which stripped every occurrence
    and silently mutated (or broke) event payloads, not just the SSE prefix.
    """
    content_with_data_prefix = "cited spec data: application/json for details"

    async def fake_load_articles(query: str) -> dict[str, Any]:
        return {"articles": [], "summary": {}}

    def fake_stream(
        query: str,
        articles: list[dict[str, Any]],
        chat_history: list[dict[str, object]] | None = None,
        stop_event: Any = None,
    ) -> Iterator[str]:
        yield (
            "data: "
            + json.dumps(
                {
                    "type": "tool_result",
                    "tool": "web_search",
                    "content": content_with_data_prefix,
                }
            )
            + "\n\n"
        )
        yield ("data: " + json.dumps({"type": "complete", "result": {"answer": "done"}}) + "\n\n")

    monkeypatch.setattr(research_module, "load_articles_for_research", fake_load_articles)
    monkeypatch.setattr(research_module, "stream_research_agent", fake_stream)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/news/research/stream",
            params={"query": "test query", "include_thinking": "false"},
        )
        assert response.status_code == 200

        events: list[dict[str, Any]] = [
            json.loads(chunk.removeprefix("data: "))
            for chunk in response.text.split("\n\n")
            if chunk.startswith("data: ")
        ]

    tool_results = [event for event in events if event["type"] == "tool_result"]
    assert tool_results, "tool_result event was dropped by the parser"
    assert tool_results[0]["content"] == content_with_data_prefix

    complete = [event for event in events if event["type"] == "complete"]
    assert complete, "complete event missing"
