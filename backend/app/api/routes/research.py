"""Research."""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib import import_module
from typing import Any, Protocol, cast

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import iterate_in_threadpool

from app.core.logging import get_logger
from app.models.research import NewsResearchRequest, NewsResearchResponse, ThinkingStep

logger = get_logger(__name__)

router = APIRouter(prefix="/api/news", tags=["news-research"])

ResearchArticle = dict[str, Any]
ChatHistory = list[dict[str, object]]
ResearchPayload = dict[str, Any]
ResearchResultPayload = dict[str, Any]

_QUERY_STATUS_MESSAGES: dict[str, tuple[str, str, str]] = {
    "web_search": ("query", "Web search", "Web search"),
    "news_search": ("keywords", "News search", "News search"),
    "gdelt_context_search": ("query", "GDELT context search", "GDELT context search"),
    "gdelt_doc_search": ("query", "GDELT doc search", "GDELT doc search"),
    "fetch_article_content": ("url", "Reading article", "Reading article"),
}
_STATIC_STATUS_MESSAGES = {
    "search_internal_news": "Checking saved coverage",
    "rag_index_documents": "Saving new sources",
}


def _status_message_for_tool(tool_name: str, args: dict[str, Any]) -> str:
    if tool_name in _STATIC_STATUS_MESSAGES:
        return _STATIC_STATUS_MESSAGES[tool_name]
    query_spec = _QUERY_STATUS_MESSAGES.get(tool_name)
    if query_spec is not None:
        argument_name, prefix, fallback = query_spec
        value = str(args.get(argument_name, "")).strip()
        return f"{prefix}: {value}" if value else fallback
    return f"Running {tool_name}"


class _LoadArticlesForResearch(Protocol):
    async def __call__(
        self,
        query: str,
        semantic_limit: int = 20,
        keyword_limit: int = 50,
        recent_limit: int = 40,
        max_total: int = 150,
    ) -> ResearchPayload: ...


class _RunResearchAgent(Protocol):
    def __call__(
        self,
        query: str,
        articles: list[ResearchArticle],
        verbose: bool = True,
        chat_history: ChatHistory | None = None,
    ) -> ResearchResultPayload: ...


class _StreamResearchAgent(Protocol):
    def __call__(
        self,
        query: str,
        articles: list[ResearchArticle],
        chat_history: ChatHistory | None = None,
        stop_event: threading.Event | None = None,
    ) -> Iterator[str]: ...


async def load_articles_for_research(query: str) -> ResearchPayload:
    """Load Articles For Research."""
    loader = cast(
        _LoadArticlesForResearch,
        import_module("app.services.news_research").load_articles_for_research,
    )
    return await loader(query)


def run_research_agent(
    query: str,
    articles: list[ResearchArticle],
    include_thinking: bool,
    chat_history: ChatHistory | None,
) -> ResearchResultPayload:
    """Run Research Agent."""
    runner = cast(
        _RunResearchAgent,
        import_module("app.services.news_research").run_research_agent,
    )
    return runner(query, articles, include_thinking, chat_history)


def stream_research_agent(
    query: str,
    articles: list[ResearchArticle],
    chat_history: ChatHistory | None,
    stop_event: threading.Event | None,
) -> Iterator[str]:
    """Stream Research Agent."""
    streamer = cast(
        _StreamResearchAgent,
        import_module("app.services.news_research").stream_research_agent,
    )
    return streamer(query, articles, chat_history, stop_event)


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _retrieval_status(
    articles_payload: ResearchPayload,
) -> tuple[list[ResearchArticle], dict[str, Any]]:
    articles = cast(list[ResearchArticle], articles_payload.get("articles", []))
    summary = cast(dict[str, Any], articles_payload.get("summary", {}))
    status = {
        "type": "status",
        "message": (
            f"Reviewing {summary.get('total', len(articles))} articles "
            f"(semantic: {summary.get('semantic_count', 0)}, "
            f"keyword: {summary.get('keyword_count', 0)}, "
            f"recent: {summary.get('recent_count', 0)})"
        ),
        "vector_enabled": summary.get("vector_enabled", False),
        "timestamp": datetime.now(UTC).isoformat(),
    }
    return articles, status


def _parse_chat_history(history: str | None) -> ChatHistory | None:
    if not history:
        return None
    try:
        return cast(ChatHistory, json.loads(history))
    except json.JSONDecodeError:
        return None


def _render_thinking_event(event: dict[str, Any], timestamp: str) -> tuple[list[str], str | None]:
    content = cast(str, event["content"])
    return [
        _sse(
            {
                "type": "thinking_step",
                "step": {"type": "thought", "content": content, "timestamp": timestamp},
                "timestamp": timestamp,
            }
        )
    ], content


def _render_tool_start_event(
    event: dict[str, Any], include_thinking: bool, timestamp: str
) -> list[str]:
    tool_name = cast(str, event["tool"])
    args = cast(dict[str, Any], event["args"])
    messages = [
        _sse(
            {
                "type": "status",
                "message": _status_message_for_tool(tool_name, args),
                "timestamp": timestamp,
            }
        ),
        _sse({"type": "tool_start", "tool": tool_name, "args": args, "timestamp": timestamp}),
    ]
    if include_thinking:
        messages.append(
            _sse(
                {
                    "type": "thinking_step",
                    "step": {
                        "type": "tool_start",
                        "content": f"Tool request: {tool_name} {json.dumps(args)}",
                        "timestamp": timestamp,
                    },
                    "timestamp": timestamp,
                }
            )
        )
    return messages


def _render_tool_result_event(
    event: dict[str, Any], include_thinking: bool, timestamp: str
) -> list[str]:
    tool_name = event.get("tool")
    content = event["content"]
    messages = [
        _sse(
            {
                "type": "status",
                "message": "Reviewing results.",
                "timestamp": timestamp,
            }
        ),
        _sse(
            {"type": "tool_result", "tool": tool_name, "content": content, "timestamp": timestamp}
        ),
    ]
    if include_thinking:
        messages.append(
            _sse(
                {
                    "type": "thinking_step",
                    "step": {"type": "observation", "content": content, "timestamp": timestamp},
                    "timestamp": timestamp,
                }
            )
        )
    return messages


@dataclass(slots=True)
class _ResearchStreamState:
    final_result: ResearchResultPayload | None = None
    last_thought: str | None = None


ResearchEventRenderResult = tuple[list[str], str | None, ResearchResultPayload | None]
ResearchEventRenderer = Callable[[dict[str, Any], bool, str], ResearchEventRenderResult]


_RESEARCH_EVENT_RENDERERS: dict[str, ResearchEventRenderer] = {
    "articles_json": lambda event, _include_thinking, timestamp: (
        [_sse({"type": "articles_json", "data": event["data"], "timestamp": timestamp})],
        None,
        None,
    ),
    "complete": lambda event, _include_thinking, timestamp: _render_complete_event(
        event, timestamp
    ),
    "referenced_articles": lambda event, _include_thinking, timestamp: (
        [
            _sse(
                {
                    "type": "referenced_articles",
                    "articles": event["articles"],
                    "timestamp": timestamp,
                }
            )
        ],
        None,
        None,
    ),
    "thinking": lambda event, _include_thinking, timestamp: _render_thinking_result(
        event, timestamp
    ),
    "tool_result": lambda event, include_thinking, timestamp: (
        _render_tool_result_event(event, include_thinking, timestamp),
        None,
        None,
    ),
    "tool_start": lambda event, include_thinking, timestamp: (
        _render_tool_start_event(event, include_thinking, timestamp),
        None,
        None,
    ),
}


def _render_empty_event(
    _event: dict[str, Any],
    _include_thinking: bool,
    _timestamp: str,
) -> ResearchEventRenderResult:
    return [], None, None


def _render_complete_event(event: dict[str, Any], timestamp: str) -> ResearchEventRenderResult:
    result = cast(ResearchResultPayload, event["result"])
    return [_sse({"type": "complete", "result": result, "timestamp": timestamp})], None, result


def _render_thinking_result(event: dict[str, Any], timestamp: str) -> ResearchEventRenderResult:
    messages, last_thought = _render_thinking_event(event, timestamp)
    return messages, last_thought, None


def _render_research_event(
    event: dict[str, Any], include_thinking: bool
) -> ResearchEventRenderResult:
    event_type = event["type"]
    timestamp = datetime.now(UTC).isoformat()
    return _RESEARCH_EVENT_RENDERERS.get(event_type, _render_empty_event)(
        event, include_thinking, timestamp
    )


def _process_research_stream_event(
    event_raw: str, include_thinking: bool
) -> tuple[list[str], str | None, ResearchResultPayload | None]:
    json_str = event_raw.removeprefix("data: ").strip()
    if not json_str:
        return [], None, None
    event = cast(dict[str, Any], json.loads(json_str))
    return _render_research_event(event, include_thinking)


async def _render_research_stream_messages(
    event_raw: str,
    include_thinking: bool,
    state: _ResearchStreamState,
) -> AsyncIterator[str]:
    try:
        messages, last_thought, final_result = _process_research_stream_event(
            event_raw, include_thinking
        )
        state.last_thought = last_thought or state.last_thought
        state.final_result = final_result or state.final_result
        for message in messages:
            yield message
    except (KeyError, TypeError, ValueError) as error:
        logger.error("Error processing stream event: %s", error)


async def _stream_research_events(
    request: Request,
    query: str,
    articles: list[ResearchArticle],
    chat_history: ChatHistory | None,
    include_thinking: bool,
    stop_event: threading.Event,
    state: _ResearchStreamState,
) -> AsyncIterator[str]:
    agent_events = stream_research_agent(query, articles, chat_history, stop_event)
    async for event_raw in iterate_in_threadpool(agent_events):
        if await request.is_disconnected():
            stop_event.set()
            logger.info("Research stream client disconnected for query=%s", query)
            break
        async for message in _render_research_stream_messages(event_raw, include_thinking, state):
            yield message


def _fallback_research_result(
    query: str, articles: list[ResearchArticle], last_thought: str | None
) -> ResearchResultPayload:
    return {
        "success": False,
        "query": query,
        "answer": last_thought or "Answer\nNo answer found.\n",
        "structured_articles": "",
        "articles_searched": len(articles),
        "referenced_articles": [],
        "source_providers": [],
    }


def _friendly_research_error(message: str) -> str:
    lower_message = message.lower()
    if any(
        keyword in lower_message for keyword in ["rate limit", "quota", "429", "too many requests"]
    ):
        return "API Rate Limit: The AI service has reached its rate limit. Please wait a moment and try again."
    if "timeout" in lower_message:
        return "Request Timeout: The research took too long. Try a simpler query."
    return message


async def _yield_fallback_research_completion(
    query: str,
    articles: list[ResearchArticle],
    state: _ResearchStreamState,
    stop_event: threading.Event,
) -> AsyncIterator[str]:
    if state.final_result is not None or stop_event.is_set():
        return
    yield _sse(
        {
            "type": "complete",
            "result": _fallback_research_result(query, articles, state.last_thought),
            "timestamp": datetime.now(UTC).isoformat(),
        }
    )


@router.get("/research/stream")
async def news_research_stream_endpoint(
    request: Request,
    query: str = Query(..., description="The research query"),
    include_thinking: bool = Query(True, description="Include thinking steps"),
    history: str | None = Query(None, description="JSON-encoded chat history for context"),
) -> StreamingResponse:
    """News Research Stream Endpoint."""

    async def generate() -> AsyncIterator[str]:
        """Generate."""
        stop_event = threading.Event()
        try:
            yield _sse(
                {
                    "type": "status",
                    "message": "Starting research.",
                    "timestamp": datetime.now(UTC).isoformat(),
                }
            )
            articles_payload = await load_articles_for_research(query)
            articles, status_message = _retrieval_status(articles_payload)
            yield _sse(status_message)
            chat_history = _parse_chat_history(history)
            state = _ResearchStreamState()
            async for message in _stream_research_events(
                request,
                query,
                articles,
                chat_history,
                include_thinking,
                stop_event,
                state,
            ):
                yield message
            async for message in _yield_fallback_research_completion(
                query, articles, state, stop_event
            ):
                yield message

        except asyncio.CancelledError:
            stop_event.set()
            logger.info("Research stream cancelled for query=%s", query)
            raise
        except (ConnectionError, OSError, RuntimeError, TypeError, ValueError) as exc:
            yield _sse(
                {
                    "type": "error",
                    "message": _friendly_research_error(str(exc)),
                    "timestamp": datetime.now(UTC).isoformat(),
                }
            )
        finally:
            stop_event.set()

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/research", response_model=NewsResearchResponse)
async def news_research_endpoint(request: NewsResearchRequest) -> NewsResearchResponse:
    """News Research Endpoint."""
    articles_payload = await load_articles_for_research(request.query)
    articles_dict = cast(
        list[ResearchArticle],
        articles_payload.get("articles", []),
    )

    # Run blocking research agent in thread pool to avoid blocking event loop
    result = await asyncio.to_thread(
        run_research_agent,
        request.query,
        articles_dict,
        request.include_thinking,
        None,
    )

    thinking_steps = [
        ThinkingStep(**step)
        for step in cast(list[dict[str, Any]], result.get("thinking_steps", []))
    ]

    return NewsResearchResponse(
        success=result.get("success", False),
        query=result.get("query", request.query),
        answer=result.get("answer", ""),
        thinking_steps=thinking_steps,
        articles_searched=result.get("articles_searched", 0),
        referenced_articles=result.get("referenced_articles", []),
        source_providers=result.get("source_providers", []),
        error=result.get("error"),
    )
