import json
import threading
from typing import Any, cast

import pytest
from fastapi import Request
from langchain_core.messages import AIMessage, ToolMessage

import news_research_agent as agent
from app.api.routes import research as research_route


def test_dedup_tool_node_blocks_duplicate_calls(monkeypatch) -> None:
    class FakeToolNode:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def invoke(self, state):
            messages = []
            for call in state["messages"][-1].tool_calls:
                messages.append(
                    ToolMessage(
                        content=f"ran {call['name']}",
                        tool_call_id=call["id"],
                        name=call["name"],
                    )
                )
            return {"messages": messages}

    monkeypatch.setattr(agent, "ToolNode", FakeToolNode)

    tool_calls = [
        {
            "id": "call-1",
            "name": "fetch_article_content",
            "args": {"url": "https://example.com/story/"},
        },
        {
            "id": "call-2",
            "name": "fetch_article_content",
            "args": {"url": "https://example.com/story/"},
        },
    ]
    state = cast(
        Any,
        {
            "messages": [AIMessage(content="", tool_calls=tool_calls)],
            "tool_history": set(),
            "tool_calls_used": 0,
        },
    )

    out = agent._dedup_tool_node(state)
    contents = [str(message.content) for message in out["messages"]]

    assert sum(content.startswith("ran ") for content in contents) == 1
    assert any(
        "Already called with the same arguments" in content for content in contents
    )
    assert out["tool_calls_used"] == 1
    assert len(out["tool_history"]) == 1


def test_dedup_tool_node_enforces_session_cap(monkeypatch) -> None:
    class FakeToolNode:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def invoke(self, _state):
            raise AssertionError(
                "Tool execution should be skipped when session cap is hit"
            )

    monkeypatch.setattr(agent, "ToolNode", FakeToolNode)

    state = cast(
        Any,
        {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "cap-call",
                            "name": "web_search",
                            "args": {"query": "test"},
                        },
                    ],
                )
            ],
            "tool_history": set(),
            "tool_calls_used": agent.MAX_TOOL_CALLS_PER_SESSION,
        },
    )

    out = agent._dedup_tool_node(state)
    assert len(out["messages"]) == 1
    assert "Tool call limit reached" in str(out["messages"][0].content)
    assert out["tool_calls_used"] == agent.MAX_TOOL_CALLS_PER_SESSION


def test_dedup_tool_node_blocks_external_search_before_internal_search(
    monkeypatch,
) -> None:
    class FakeToolNode:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def invoke(self, _state):
            raise AssertionError(
                "External search should be blocked before internal search"
            )

    monkeypatch.setattr(agent, "ToolNode", FakeToolNode)

    state = cast(
        Any,
        {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "external-first",
                            "name": "news_search",
                            "args": {"keywords": "iran latest"},
                        }
                    ],
                )
            ],
            "tool_history": set(),
            "tool_calls_used": 0,
        },
    )

    out = agent._dedup_tool_node(state)

    assert len(out["messages"]) == 1
    assert "Use search_internal_news first" in str(out["messages"][0].content)
    assert out["tool_calls_used"] == 0


@pytest.mark.parametrize("tool_name", ["gdelt_context_search", "gdelt_doc_search"])
def test_dedup_tool_node_blocks_gdelt_search_before_internal_search(
    monkeypatch, tool_name: str
) -> None:
    class FakeToolNode:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def invoke(self, _state):
            raise AssertionError(
                "GDELT search should be blocked before internal search"
            )

    monkeypatch.setattr(agent, "ToolNode", FakeToolNode)

    state = cast(
        Any,
        {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": f"{tool_name}-call",
                            "name": tool_name,
                            "args": {"query": "iran latest"},
                        }
                    ],
                )
            ],
            "tool_history": set(),
            "tool_calls_used": 0,
        },
    )

    out = agent._dedup_tool_node(state)

    assert len(out["messages"]) == 1
    assert "Use search_internal_news first" in str(out["messages"][0].content)
    assert out["tool_calls_used"] == 0


def test_dedup_tool_node_requires_internal_fetches_before_external_search(
    monkeypatch,
) -> None:
    class FakeToolNode:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def invoke(self, _state):
            raise AssertionError(
                "External search should be blocked until internal reads happen"
            )

    monkeypatch.setattr(agent, "ToolNode", FakeToolNode)
    agent.set_news_articles(
        [
            {
                "id": 1,
                "title": "Internal Iran update",
                "url": "https://internal.example/iran-1",
                "source": "Internal Feed",
                "summary": "Internal coverage",
                "retrieval_method": "keyword_postgres",
            }
        ]
    )

    state = cast(
        Any,
        {
            "messages": [
                ToolMessage(
                    content='[{"title":"Internal Iran update","source":"Internal Feed","url":"https://internal.example/iran-1","summary":"Internal coverage"}]',
                    tool_call_id="internal-search",
                    name="search_internal_news",
                ),
                ToolMessage(
                    content='[{"title":"Internal Iran update","source":"Internal Feed","url":"https://internal.example/iran-1","summary":"Internal coverage"}]',
                    tool_call_id="internal-search-duplicate-view",
                    name="search_internal_news",
                ),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "external-too-early",
                            "name": "web_search",
                            "args": {"query": "iran latest developments"},
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

    assert len(out["messages"]) == 1
    assert "Read the internal article URLs" in str(out["messages"][0].content)
    assert out["tool_calls_used"] == 1


def test_research_stream_emits_unique_tool_start_events(monkeypatch) -> None:
    duplicate_tool_calls = [
        {
            "id": "call-1",
            "name": "fetch_article_content",
            "args": {"url": "https://example.com/story/"},
        },
        {
            "id": "call-2",
            "name": "fetch_article_content",
            "args": {"url": "https://example.com/story/"},
        },
    ]
    final_answer = "Answer\n" + ("Validated context. " * 12)

    class FakeGraph:
        def stream(self, _initial_state, stream_mode="updates"):
            assert stream_mode == "updates"
            yield {
                "agent": {
                    "messages": [
                        AIMessage(content="thinking", tool_calls=duplicate_tool_calls)
                    ]
                }
            }
            yield {
                "tools": {
                    "messages": [
                        ToolMessage(
                            content="Title: Demo\nContent: Details",
                            tool_call_id="call-1",
                            name="fetch_article_content",
                        )
                    ]
                }
            }
            yield {
                "agent": {"messages": [AIMessage(content=final_answer, tool_calls=[])]}
            }

    monkeypatch.setattr(agent, "_get_graph", lambda: FakeGraph())

    events = list(agent.research_stream(query="demo", articles=[], chat_history=None))
    parsed_events = []
    for event in events:
        if not event.startswith("data: "):
            continue
        parsed_events.append(json.loads(event[6:].strip()))

    tool_starts = [item for item in parsed_events if item.get("type") == "tool_start"]
    assert len(tool_starts) == 1
    assert any(item.get("type") == "complete" for item in parsed_events)


def test_research_stream_honors_stop_event(monkeypatch) -> None:
    stop_event = threading.Event()

    class FakeGraph:
        def stream(self, _initial_state, stream_mode="updates"):
            assert stream_mode == "updates"
            yield {"agent": {"messages": [AIMessage(content="first", tool_calls=[])]}}
            yield {"agent": {"messages": [AIMessage(content="second", tool_calls=[])]}}

    monkeypatch.setattr(agent, "_get_graph", lambda: FakeGraph())

    stream = agent.research_stream(
        query="demo",
        articles=[],
        chat_history=None,
        stop_event=stop_event,
    )

    first_event = next(stream)
    stop_event.set()
    remaining_events = list(stream)

    assert json.loads(first_event[6:].strip())["type"] == "thinking"
    assert all('"type": "complete"' not in event for event in remaining_events)


def test_graph_finishes_after_iteration_cap(monkeypatch) -> None:
    class FakeToolNode:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def invoke(self, _state):
            return {"messages": []}

    class FakeRunner:
        def invoke(self, _payload):
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "tool-call",
                        "name": "search_internal_news",
                        "args": {"query": "demo"},
                    }
                ],
            )

    class FakeFinalRunner:
        def invoke(self, _payload):
            return AIMessage(content="Answer\nDone.", tool_calls=[])

    monkeypatch.setattr(agent, "ToolNode", FakeToolNode)
    monkeypatch.setattr(agent, "_model_instance", None)
    monkeypatch.setattr(agent, "_tool_router_instance", None)
    monkeypatch.setattr(agent, "_graph_instance", None)
    monkeypatch.setattr(agent, "_get_model", lambda: FakeRunner())
    monkeypatch.setattr(agent, "_get_tool_router", lambda: FakeRunner())
    monkeypatch.setattr(agent, "_get_llm", lambda: FakeFinalRunner())

    graph = agent._get_graph()
    initial_state = cast(
        Any,
        {
            "messages": agent._build_initial_messages("demo"),
            "iteration": 0,
            "mode": "research",
            "tool_history": set(),
            "tool_calls_used": 0,
        },
    )

    updates = []
    for idx, update in enumerate(graph.stream(initial_state, stream_mode="updates")):
        updates.append(update)
        if idx > 20:
            raise AssertionError("Graph failed to terminate after iteration cap")

    assert updates
    assert "agent" in updates[-1]
    final_message = updates[-1]["agent"]["messages"][-1]
    assert isinstance(final_message, AIMessage)
    assert not getattr(final_message, "tool_calls", None)


def test_graph_finalizes_after_tool_router_returns_no_tools(monkeypatch) -> None:
    class FakeToolNode:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def invoke(self, _state):
            return {"messages": []}

    class FakeModelRunner:
        def invoke(self, _payload):
            return AIMessage(content="Short draft")

    class FakeToolRouterRunner:
        def invoke(self, _payload):
            return AIMessage(content="No more tools needed")

    class FakeFinalRunner:
        def invoke(self, _payload):
            return AIMessage(content="Answer\nResolved from gathered context.")

    monkeypatch.setattr(agent, "ToolNode", FakeToolNode)
    monkeypatch.setattr(agent, "_graph_instance", None)
    monkeypatch.setattr(agent, "_model_instance", None)
    monkeypatch.setattr(agent, "_tool_router_instance", None)

    def fake_get_model():
        return FakeModelRunner()

    def fake_get_tool_router():
        return FakeToolRouterRunner()

    def fake_get_llm():
        return FakeFinalRunner()

    monkeypatch.setattr(agent, "_get_model", fake_get_model)
    monkeypatch.setattr(agent, "_get_tool_router", fake_get_tool_router)
    monkeypatch.setattr(agent, "_get_llm", fake_get_llm)

    graph = agent._get_graph()
    initial_state = cast(
        Any,
        {
            "messages": agent._build_initial_messages("demo"),
            "iteration": 0,
            "mode": "research",
            "tool_history": set(),
            "tool_calls_used": 0,
        },
    )

    updates = list(graph.stream(initial_state, stream_mode="updates"))

    assert updates
    assert "agent" in updates[-1]
    final_message = updates[-1]["agent"]["messages"][-1]
    assert isinstance(final_message, AIMessage)
    assert str(final_message.content).startswith("Answer\n")


def test_research_news_refinalizes_when_draft_denies_available_context(
    monkeypatch,
) -> None:
    draft_answer = (
        "Answer\n\nThe provided context does not contain information about what is "
        "currently happening in Iran. Without additional details, it is impossible "
        "to describe current events."
    )

    class FakeGraph:
        def stream(self, _initial_state, stream_mode="updates"):
            assert stream_mode == "updates"
            yield {
                "tools": {
                    "messages": [
                        ToolMessage(
                            content=(
                                '[{"title":"Iran latest","source":"AP",'
                                '"url":"https://example.com/ap-iran",'
                                '"body":"Missile strikes and air raids continue.",'
                                '"date":"2026-03-07T00:00:00+00:00"}]'
                            ),
                            tool_call_id="news-1",
                            name="news_search",
                        )
                    ]
                }
            }
            yield {
                "agent": {"messages": [AIMessage(content=draft_answer, tool_calls=[])]}
            }

    monkeypatch.setattr(agent, "_get_graph", lambda: FakeGraph())
    monkeypatch.setattr(
        agent,
        "_finalize_answer",
        lambda query, referenced_articles, tool_snippets: (
            "Answer\nAP reports that missile strikes and air raids continue in Iran. "
            "https://example.com/ap-iran"
        ),
    )

    result = agent.research_news(
        query="What is currently happening in iran", articles=[]
    )

    assert result["answer"].startswith("Answer\nAP reports")
    assert result["referenced_articles"]
    assert result["referenced_articles"][0]["url"] == "https://example.com/ap-iran"
    assert result["source_providers"] == ["duckduckgo"]


def test_research_news_records_gdelt_source_providers(monkeypatch) -> None:
    final_answer = (
        "Answer\nThe GDELT context shows continuing strikes and evacuations in the "
        "region. It provides enough detail to summarize the situation without a "
        "full article fetch."
    )

    class FakeGraph:
        def stream(self, _initial_state, stream_mode="updates"):
            assert stream_mode == "updates"
            yield {
                "tools": {
                    "messages": [
                        ToolMessage(
                            content=json.dumps(
                                [
                                    {
                                        "title": "Iran update",
                                        "source": "GDELT source",
                                        "url": "https://example.com/gdelt-iran",
                                        "summary": "Snippet from GDELT",
                                        "context_snippet": "GDELT context snippet",
                                        "sentence": "A sentence from GDELT",
                                        "published": "2026-03-07T00:00:00+00:00",
                                        "provider": "gdelt",
                                        "result_type": "context",
                                    }
                                ]
                            ),
                            tool_call_id="gdelt-1",
                            name="gdelt_context_search",
                        )
                    ]
                }
            }
            yield {
                "agent": {"messages": [AIMessage(content=final_answer, tool_calls=[])]}
            }

    monkeypatch.setattr(agent, "_get_graph", lambda: FakeGraph())

    result = agent.research_news(query="What is happening in iran", articles=[])

    assert result["source_providers"] == ["gdelt"]
    assert result["referenced_articles"][0]["provider"] == "gdelt"
    assert (
        result["referenced_articles"][0]["context_snippet"] == "GDELT context snippet"
    )


@pytest.mark.asyncio
async def test_stream_route_fallback_answer_contract(monkeypatch) -> None:
    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    async def fake_load_articles(_query: str):
        return {
            "articles": [],
            "summary": {
                "total": 0,
                "semantic_count": 0,
                "keyword_count": 0,
                "recent_count": 0,
                "vector_enabled": False,
            },
        }

    def fake_stream_agent(*_args, **_kwargs):
        if False:
            yield ""

    monkeypatch.setattr(
        research_route, "load_articles_for_research", fake_load_articles
    )
    monkeypatch.setattr(research_route, "stream_research_agent", fake_stream_agent)

    response = await research_route.news_research_stream_endpoint(
        request=cast(Request[Any], FakeRequest()),
        query="test fallback",
        include_thinking=True,
        history=None,
    )

    complete_payload = None
    async for chunk in response.body_iterator:
        text = chunk.decode() if isinstance(chunk, (bytes, bytearray)) else str(chunk)
        for line in text.splitlines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            if event.get("type") == "complete":
                complete_payload = event["result"]

    assert complete_payload is not None
    assert complete_payload["answer"] == "Answer\nNo answer found.\n"
    assert "Follow-up questions" not in complete_payload["answer"]
    assert complete_payload["source_providers"] == []


@pytest.mark.asyncio
async def test_stream_route_includes_tool_name_on_tool_results(monkeypatch) -> None:
    class FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    async def fake_load_articles(_query: str):
        return {
            "articles": [],
            "summary": {
                "total": 0,
                "semantic_count": 0,
                "keyword_count": 0,
                "recent_count": 0,
                "vector_enabled": False,
            },
        }

    def fake_stream_agent(*_args, **_kwargs):
        yield (
            "data: "
            + json.dumps(
                {
                    "type": "tool_start",
                    "tool": "gdelt_context_search",
                    "args": {"query": "bird flu"},
                }
            )
            + "\n\n"
        )
        yield (
            "data: "
            + json.dumps(
                {
                    "type": "tool_result",
                    "tool": "news_search",
                    "content": "Fallback provider result",
                }
            )
            + "\n\n"
        )
        yield (
            "data: "
            + json.dumps(
                {
                    "type": "complete",
                    "result": {
                        "success": True,
                        "query": "bird flu",
                        "answer": "Answer\nFallback landed.",
                        "structured_articles": "",
                        "articles_searched": 0,
                        "referenced_articles": [],
                        "source_providers": ["duckduckgo"],
                    },
                }
            )
            + "\n\n"
        )

    monkeypatch.setattr(
        research_route, "load_articles_for_research", fake_load_articles
    )
    monkeypatch.setattr(research_route, "stream_research_agent", fake_stream_agent)

    response = await research_route.news_research_stream_endpoint(
        request=cast(Request[Any], FakeRequest()),
        query="bird flu",
        include_thinking=True,
        history=None,
    )

    parsed_events = []
    async for chunk in response.body_iterator:
        text = chunk.decode() if isinstance(chunk, (bytes, bytearray)) else str(chunk)
        for line in text.splitlines():
            if line.startswith("data: "):
                parsed_events.append(json.loads(line[6:]))

    tool_results = [
        event for event in parsed_events if event.get("type") == "tool_result"
    ]
    assert len(tool_results) == 1
    assert tool_results[0]["tool"] == "news_search"
    assert tool_results[0]["content"] == "Fallback provider result"
    assert "timestamp" in tool_results[0]


@pytest.mark.asyncio
async def test_stream_route_stops_when_client_disconnects(monkeypatch) -> None:
    class FakeRequest:
        def __init__(self) -> None:
            self.calls = 0

        async def is_disconnected(self) -> bool:
            self.calls += 1
            return self.calls > 1

    async def fake_load_articles(_query: str):
        return {
            "articles": [],
            "summary": {
                "total": 0,
                "semantic_count": 0,
                "keyword_count": 0,
                "recent_count": 0,
                "vector_enabled": False,
            },
        }

    def fake_stream_agent(_query, _articles, _history, stop_event):
        for idx in range(3):
            if stop_event.is_set():
                return
            yield (
                "data: "
                + json.dumps({"type": "thinking", "content": f"step-{idx}"})
                + "\n\n"
            )

    monkeypatch.setattr(
        research_route, "load_articles_for_research", fake_load_articles
    )
    monkeypatch.setattr(research_route, "stream_research_agent", fake_stream_agent)

    response = await research_route.news_research_stream_endpoint(
        request=cast(Request[Any], FakeRequest()),
        query="disconnect",
        include_thinking=True,
        history=None,
    )

    parsed_events = []
    async for chunk in response.body_iterator:
        text = chunk.decode() if isinstance(chunk, (bytes, bytearray)) else str(chunk)
        for line in text.splitlines():
            if line.startswith("data: "):
                parsed_events.append(json.loads(line[6:]))

    assert any(event.get("type") == "status" for event in parsed_events)
    assert any(event.get("type") == "thinking_step" for event in parsed_events)
    assert not any(event.get("type") == "complete" for event in parsed_events)
