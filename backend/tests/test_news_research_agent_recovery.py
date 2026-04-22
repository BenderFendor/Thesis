import asyncio
from types import SimpleNamespace
import json
from typing import Any, cast

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

import news_research_agent as agent


def test_trim_trailing_assistant_runs_removes_duplicate_tail() -> None:
    messages = [
        SystemMessage(content="system"),
        HumanMessage(content="question"),
        AIMessage(content="draft-1"),
        AIMessage(content="draft-2"),
    ]

    sanitized = agent._trim_trailing_assistant_runs(messages)

    assert isinstance(sanitized[-1], AIMessage)
    assert sanitized[-1].content == "draft-2"
    assert isinstance(sanitized[-2], HumanMessage)


def test_is_recoverable_llamacpp_error_detects_known_400s(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        agent,
        "settings",
        SimpleNamespace(llm_backend="llamacpp"),
    )

    tail_error = RuntimeError(
        "Error code: 400 - {'error': {'code': 400, 'message': "
        "'Cannot have 2 or more assistant messages at the end of the list.', "
        "'type': 'invalid_request_error'}}"
    )
    model_error = RuntimeError(
        "Error code: 400 - {'error': {'code': 400, 'message': "
        "'model qwen.gguf not found', 'type': 'invalid_request_error'}}"
    )

    assert agent._is_recoverable_llamacpp_error(tail_error)
    assert agent._is_recoverable_llamacpp_error(model_error)


def test_build_initial_messages_collapses_assistant_history_for_llamacpp(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        agent,
        "settings",
        SimpleNamespace(llm_backend="llamacpp"),
    )
    chat_history = [
        {"type": "user", "content": "first question"},
        {"type": "assistant", "content": "first answer"},
        {"type": "assistant", "content": "duplicate assistant"},
    ]

    messages = agent._build_initial_messages("follow up", chat_history)

    assert isinstance(messages[0], SystemMessage)
    assert isinstance(messages[-1], HumanMessage)
    assert messages[-1].content == "follow up"
    assert sum(isinstance(message, AIMessage) for message in messages) == 1


def test_track_search_result_references_registers_external_results() -> None:
    agent.set_news_articles([])

    payload = json.dumps(
        [
            {
                "title": "Iran war latest",
                "source": "AP",
                "url": "https://example.com/ap-iran",
                "body": "Airstrikes and retaliatory missile launches continue.",
                "date": "2026-03-07T00:00:00+00:00",
            }
        ]
    )

    agent._track_search_result_references("news_search", payload)

    assert len(agent._referenced_articles_tracker) == 1
    article = agent._referenced_articles_tracker[0]
    assert article["url"] == "https://example.com/ap-iran"
    assert article["source"] == "AP"
    assert "Airstrikes" in article["summary"]


def test_answer_denial_detection_matches_bad_fallback_copy() -> None:
    bad_answer = (
        "Answer\n\nThe provided context does not contain information about what is "
        "currently happening in Iran. Without additional details, it is impossible "
        "to describe current events."
    )

    assert agent._answer_denies_available_context(bad_answer)


def test_tool_router_replaces_prior_system_message(monkeypatch) -> None:
    captured_messages: list[Any] = []

    class FakeToolRouter:
        def invoke(self, payload):
            captured_messages.extend(payload)
            system_indexes = [
                index
                for index, message in enumerate(payload)
                if isinstance(message, SystemMessage)
            ]
            assert system_indexes == [0]
            assert payload[0].content == agent._tool_router_system_prompt()
            return AIMessage(content="Answer\nTool router completed.", tool_calls=[])

    monkeypatch.setattr(agent, "_get_tool_router", lambda: FakeToolRouter())

    state = cast(
        Any,
        {
            "messages": agent._build_initial_messages(
                "follow up",
                [
                    {"type": "user", "content": "first question"},
                    {"type": "assistant", "content": "first answer"},
                ],
            ),
            "iteration": 1,
            "mode": "tool_router",
            "tool_history": set(),
            "tool_calls_used": 0,
        },
    )

    result = agent.call_model(state)

    assert len(captured_messages) == 4
    assert isinstance(result["messages"][0], AIMessage)


def test_run_async_blocking_uses_main_event_loop_from_worker_thread(
    monkeypatch,
) -> None:
    target_loop = SimpleNamespace(is_running=lambda: True)
    captured_loop: list[Any] = []

    def fake_run_coroutine_threadsafe(coro, loop):
        captured_loop.append(loop)

        class FakeFuture:
            def result(self) -> str:
                return asyncio.run(coro)

        return FakeFuture()

    monkeypatch.setattr(agent, "get_main_event_loop", lambda: target_loop)
    monkeypatch.setattr(
        agent.asyncio,
        "run_coroutine_threadsafe",
        fake_run_coroutine_threadsafe,
    )

    async def sample() -> str:
        return "ok"

    assert agent._run_async_blocking(sample()) == "ok"
    assert captured_loop == [target_loop]
