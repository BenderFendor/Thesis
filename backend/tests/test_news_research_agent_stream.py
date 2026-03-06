import json
import threading

import pytest
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
    state = {
        "messages": [AIMessage(content="", tool_calls=tool_calls)],
        "tool_history": set(),
        "tool_calls_used": 0,
    }

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

    state = {
        "messages": [
            AIMessage(
                content="",
                tool_calls=[
                    {"id": "cap-call", "name": "web_search", "args": {"query": "test"}},
                ],
            )
        ],
        "tool_history": set(),
        "tool_calls_used": agent.MAX_TOOL_CALLS_PER_SESSION,
    }

    out = agent._dedup_tool_node(state)
    assert len(out["messages"]) == 1
    assert "Tool call limit reached" in str(out["messages"][0].content)
    assert out["tool_calls_used"] == agent.MAX_TOOL_CALLS_PER_SESSION


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
        request=FakeRequest(),
        query="test fallback",
        include_thinking=True,
        history=None,
    )

    complete_payload = None
    async for chunk in response.body_iterator:
        text = chunk.decode() if isinstance(chunk, bytes) else chunk
        for line in text.splitlines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            if event.get("type") == "complete":
                complete_payload = event["result"]

    assert complete_payload is not None
    assert complete_payload["answer"] == "Answer\nNo answer available.\n"
    assert "Follow-up questions" not in complete_payload["answer"]


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
        request=FakeRequest(),
        query="disconnect",
        include_thinking=True,
        history=None,
    )

    parsed_events = []
    async for chunk in response.body_iterator:
        text = chunk.decode() if isinstance(chunk, bytes) else chunk
        for line in text.splitlines():
            if line.startswith("data: "):
                parsed_events.append(json.loads(line[6:]))

    assert any(event.get("type") == "status" for event in parsed_events)
    assert any(event.get("type") == "thinking_step" for event in parsed_events)
    assert not any(event.get("type") == "complete" for event in parsed_events)
