from __future__ import annotations

import json
from typing import Any, cast

from langchain_core.messages import AIMessage, ToolMessage

import news_research_agent as agent


EXPECTED_TOOL_NAMES = {
    "search_internal_news",
    "gdelt_context_search",
    "gdelt_doc_search",
    "web_search",
    "news_search",
    "fetch_article_content",
    "rag_index_documents",
}


def test_research_toolset_smoke(monkeypatch) -> None:
    async def fake_search_internal_news_from_db(_query: str, _top_k: int):
        return []

    def fake_search_gdelt_context(
        _query: str, *, max_results: int = 10, timespan: str = "24h"
    ):
        assert max_results >= 1
        assert timespan
        return [
            {
                "url": "https://example.com/gdelt-context",
                "title": "GDELT context update",
                "source": "GDELT source",
                "summary": "Context result",
                "published": "2026-04-21T00:00:00Z",
                "provider": "gdelt",
                "result_type": "context",
            }
        ]

    def fake_search_gdelt_doc(
        _query: str, *, max_results: int = 10, timespan: str = "24h"
    ):
        assert max_results >= 1
        assert timespan
        return [
            {
                "url": "https://example.com/gdelt-doc",
                "title": "GDELT doc update",
                "source": "GDELT source",
                "summary": "Doc result",
                "published": "2026-04-21T00:00:00Z",
                "provider": "gdelt",
                "result_type": "doc",
            }
        ]

    def fake_search_gdelt_current_news(
        _query: str, *, max_results: int = 10, timespan: str = "24h"
    ):
        assert max_results >= 1
        assert timespan
        return [
            {
                "url": "https://example.com/current-news",
                "title": "Current news",
                "source": "GDELT source",
                "summary": "Current-event result",
                "published": "2026-04-21T00:00:00Z",
                "provider": "gdelt",
                "result_type": "context",
            }
        ]

    class FakeDDGS:
        def text(self, _query: str, max_results: int):
            assert max_results >= 1
            return [
                {
                    "url": "https://example.com/web-result",
                    "title": "Web result",
                    "body": "Web search summary",
                    "source": "Web Source",
                }
            ]

    class FakeVectorStore:
        def add_article(self, **_kwargs: Any) -> bool:
            return True

    monkeypatch.setattr(
        agent,
        "_search_internal_news_from_db",
        fake_search_internal_news_from_db,
    )
    monkeypatch.setattr(agent, "_search_gdelt_context", fake_search_gdelt_context)
    monkeypatch.setattr(agent, "_search_gdelt_doc", fake_search_gdelt_doc)
    monkeypatch.setattr(
        agent,
        "_search_gdelt_current_news",
        fake_search_gdelt_current_news,
    )
    monkeypatch.setattr(agent, "DDGS", lambda: FakeDDGS())
    monkeypatch.setattr(
        agent,
        "extract_article_content",
        lambda url: {
            "title": "Fetched article",
            "text": f"Extracted content for {url}",
            "source": "Fetched Source",
            "publish_date": "2026-04-21T00:00:00Z",
        },
    )
    monkeypatch.setattr(agent, "get_vector_store", lambda: FakeVectorStore())

    agent.set_news_articles(
        [
            {
                "id": 1,
                "title": "Internal archive result",
                "source": "Internal Feed",
                "url": "https://internal.example.com/story",
                "summary": "Iran archive summary",
            }
        ]
    )

    outputs = {
        tool.name: str(
            tool.invoke(
                {
                    "search_internal_news": {
                        "query": "Iran archive",
                        "top_k": 1,
                    },
                    "gdelt_context_search": {
                        "query": "Iran latest",
                        "max_results": 1,
                        "timespan": "24h",
                    },
                    "gdelt_doc_search": {
                        "query": "Iran latest",
                        "max_results": 1,
                        "timespan": "24h",
                    },
                    "web_search": {
                        "query": "Iran latest developments",
                        "num_results": 1,
                    },
                    "news_search": {
                        "keywords": "Iran latest",
                        "max_results": 1,
                        "region": "wt-wt",
                    },
                    "fetch_article_content": {
                        "url": "https://example.com/fetched-story",
                    },
                    "rag_index_documents": {
                        "documents": [
                            {
                                "content": "A fresh article body",
                                "metadata": {
                                    "url": "https://example.com/fresh-doc",
                                    "title": "Fresh document",
                                },
                            }
                        ]
                    },
                }[tool.name]
            )
        )
        for tool in agent.tools
    }

    assert set(outputs) == EXPECTED_TOOL_NAMES
    assert json.loads(outputs["search_internal_news"])[0]["provider"] == "internal"
    assert json.loads(outputs["gdelt_context_search"])[0]["provider"] == "gdelt"
    assert json.loads(outputs["gdelt_doc_search"])[0]["provider"] == "gdelt"
    assert json.loads(outputs["web_search"])[0]["provider"] == "duckduckgo"
    assert json.loads(outputs["news_search"])[0]["provider"] == "gdelt"
    assert outputs["fetch_article_content"].startswith("Title: Fetched article")
    assert outputs["rag_index_documents"] == "Successfully indexed 1 documents."


def test_dedup_tool_node_auto_falls_back_from_gdelt_errors(monkeypatch) -> None:
    call_order: list[str] = []

    class FakeToolNode:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def invoke(self, state):
            call = state["messages"][-1].tool_calls[0]
            call_order.append(str(call["name"]))
            name = str(call["name"])
            if name == "gdelt_context_search":
                content = "GDELT context search failed: rate limited"
            elif name == "gdelt_doc_search":
                content = "No results found."
            elif name == "news_search":
                content = json.dumps(
                    [
                        {
                            "url": "https://example.com/fallback-story",
                            "title": "Fallback story",
                            "source": "AP",
                            "summary": "Fallback result",
                            "provider": "duckduckgo",
                            "result_type": "news",
                        }
                    ]
                )
            else:  # pragma: no cover - guard against unexpected fallback order
                raise AssertionError(f"Unexpected tool call: {name}")
            return {
                "messages": [
                    ToolMessage(
                        content=content,
                        tool_call_id=str(call["id"]),
                        name=name,
                    )
                ]
            }

    monkeypatch.setattr(agent, "ToolNode", FakeToolNode)

    state = cast(
        Any,
        {
            "messages": [
                ToolMessage(
                    content="No relevant articles found in internal archive.",
                    tool_call_id="internal-search",
                    name="search_internal_news",
                ),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "gdelt-context-1",
                            "name": "gdelt_context_search",
                            "args": {"query": "Iran latest", "max_results": 3},
                        }
                    ],
                ),
            ],
            "tool_history": {
                'search_internal_news:{"query": "iran latest", "top_k": 5}'
            },
            "tool_calls_used": 1,
        },
    )

    out = agent._dedup_tool_node(state)

    assert call_order == ["gdelt_context_search", "gdelt_doc_search", "news_search"]
    assert len(out["messages"]) == 1
    assert out["messages"][0].name == "news_search"
    assert json.loads(str(out["messages"][0].content))[0]["provider"] == "duckduckgo"
    assert out["tool_calls_used"] == 4
    assert any(key.startswith("gdelt_context_search:") for key in out["tool_history"])
    assert any(key.startswith("gdelt_doc_search:") for key in out["tool_history"])
    assert any(key.startswith("news_search:") for key in out["tool_history"])
