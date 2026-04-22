from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import AsyncIterator, Iterator
from datetime import datetime, timezone
from importlib import import_module
from typing import Any, Dict, List, Optional, Protocol, cast

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from starlette.concurrency import iterate_in_threadpool

from app.core.logging import get_logger
from app.models.research import NewsResearchRequest, NewsResearchResponse, ThinkingStep

logger = get_logger(__name__)

router = APIRouter(prefix="/api/news", tags=["news-research"])

ResearchArticle = Dict[str, Any]
ChatHistory = List[Dict[str, object]]
ResearchPayload = Dict[str, Any]
ResearchResultPayload = Dict[str, Any]


def _status_message_for_tool(tool_name: str, args: Dict[str, Any]) -> str:
    if tool_name == "web_search":
        query = str(args.get("query", "")).strip()
        return f"Web search: {query}" if query else "Web search"
    if tool_name == "news_search":
        keywords = str(args.get("keywords", "")).strip()
        return f"News search: {keywords}" if keywords else "News search"
    if tool_name == "gdelt_context_search":
        query = str(args.get("query", "")).strip()
        return f"GDELT context search: {query}" if query else "GDELT context search"
    if tool_name == "gdelt_doc_search":
        query = str(args.get("query", "")).strip()
        return f"GDELT doc search: {query}" if query else "GDELT doc search"
    if tool_name == "search_internal_news":
        return "Checking saved coverage"
    if tool_name == "fetch_article_content":
        url = str(args.get("url", "")).strip()
        return f"Reading article: {url}" if url else "Reading article"
    if tool_name == "rag_index_documents":
        return "Saving new sources"
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
        articles: List[ResearchArticle],
        verbose: bool = True,
        chat_history: Optional[ChatHistory] = None,
    ) -> ResearchResultPayload: ...


class _StreamResearchAgent(Protocol):
    def __call__(
        self,
        query: str,
        articles: List[ResearchArticle],
        chat_history: Optional[ChatHistory] = None,
        stop_event: Optional[threading.Event] = None,
    ) -> Iterator[str]: ...


async def load_articles_for_research(query: str) -> ResearchPayload:
    loader = cast(
        _LoadArticlesForResearch,
        getattr(
            import_module("app.services.news_research"),
            "load_articles_for_research",
        ),
    )
    return await loader(query)


def run_research_agent(
    query: str,
    articles: List[ResearchArticle],
    include_thinking: bool,
    chat_history: Optional[ChatHistory],
) -> ResearchResultPayload:
    runner = cast(
        _RunResearchAgent,
        getattr(import_module("app.services.news_research"), "run_research_agent"),
    )
    return runner(query, articles, include_thinking, chat_history)


def stream_research_agent(
    query: str,
    articles: List[ResearchArticle],
    chat_history: Optional[ChatHistory],
    stop_event: Optional[threading.Event],
) -> Iterator[str]:
    streamer = cast(
        _StreamResearchAgent,
        getattr(import_module("app.services.news_research"), "stream_research_agent"),
    )
    return streamer(query, articles, chat_history, stop_event)


@router.get("/research/stream")
async def news_research_stream_endpoint(
    request: Request,
    query: str = Query(..., description="The research query"),
    include_thinking: bool = Query(True, description="Include thinking steps"),
    history: str | None = Query(
        None, description="JSON-encoded chat history for context"
    ),
) -> StreamingResponse:
    async def generate() -> AsyncIterator[str]:
        stop_event = threading.Event()
        try:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Starting research.', 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"

            articles_payload = await load_articles_for_research(query)
            articles_dict = cast(
                List[ResearchArticle],
                articles_payload.get("articles", []),
            )
            retrieval_summary = cast(
                Dict[str, Any],
                articles_payload.get("summary", {}),
            )
            total_articles = retrieval_summary.get("total", len(articles_dict))

            status_message = {
                "type": "status",
                "message": (
                    f"Reviewing {total_articles} articles "
                    f"(semantic: {retrieval_summary.get('semantic_count', 0)}, "
                    f"keyword: {retrieval_summary.get('keyword_count', 0)}, "
                    f"recent: {retrieval_summary.get('recent_count', 0)})"
                ),
                "vector_enabled": retrieval_summary.get("vector_enabled", False),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            yield f"data: {json.dumps(status_message)}\n\n"

            chat_history: Optional[List[Dict[str, object]]] = None
            if history:
                try:
                    chat_history = cast(Optional[ChatHistory], json.loads(history))
                except json.JSONDecodeError:
                    chat_history = None

            # Stream the research agent events
            final_result: ResearchResultPayload | None = None
            last_thought: str | None = None
            async for event_raw in iterate_in_threadpool(
                stream_research_agent(query, articles_dict, chat_history, stop_event)
            ):
                if await request.is_disconnected():
                    stop_event.set()
                    logger.info(
                        "Research stream client disconnected for query=%s", query
                    )
                    break
                try:
                    # event_raw is formatted as "data: {...}\n\n"
                    json_str = event_raw.replace("data: ", "").strip()
                    if not json_str:
                        continue

                    event = cast(Dict[str, Any], json.loads(json_str))
                    timestamp = datetime.now(timezone.utc).isoformat()

                    if event["type"] == "thinking":
                        last_thought = event.get("content")
                        yield f"data: {json.dumps({'type': 'thinking_step', 'step': {'type': 'thought', 'content': event['content'], 'timestamp': timestamp}, 'timestamp': timestamp})}\n\n"

                    elif event["type"] == "tool_start":
                        tool_name = event["tool"]
                        args = event["args"]

                        status_msg = _status_message_for_tool(tool_name, args)

                        yield f"data: {json.dumps({'type': 'status', 'message': status_msg, 'timestamp': timestamp})}\n\n"
                        yield f"data: {json.dumps({'type': 'tool_start', 'tool': tool_name, 'args': args, 'timestamp': timestamp})}\n\n"

                        if include_thinking:
                            content = f"Tool request: {tool_name} {json.dumps(args)}"
                            yield f"data: {json.dumps({'type': 'thinking_step', 'step': {'type': 'tool_start', 'content': content, 'timestamp': timestamp}, 'timestamp': timestamp})}\n\n"

                    elif event["type"] == "tool_result":
                        tool_name = event.get("tool")
                        yield f"data: {json.dumps({'type': 'status', 'message': 'Reviewing results.', 'timestamp': timestamp})}\n\n"
                        yield f"data: {json.dumps({'type': 'tool_result', 'tool': tool_name, 'content': event['content'], 'timestamp': timestamp})}\n\n"
                        if include_thinking:
                            yield f"data: {json.dumps({'type': 'thinking_step', 'step': {'type': 'observation', 'content': event['content'], 'timestamp': timestamp}, 'timestamp': timestamp})}\n\n"

                    elif event["type"] == "articles_json":
                        yield f"data: {json.dumps({'type': 'articles_json', 'data': event['data'], 'timestamp': timestamp})}\n\n"

                    elif event["type"] == "referenced_articles":
                        yield f"data: {json.dumps({'type': 'referenced_articles', 'articles': event['articles'], 'timestamp': timestamp})}\n\n"

                    elif event["type"] == "complete":
                        final_result = event.get("result")
                        yield f"data: {json.dumps({'type': 'complete', 'result': event['result'], 'timestamp': timestamp})}\n\n"

                except Exception as e:
                    logger.error(f"Error processing stream event: {e}")
                    continue

            if not final_result:
                if stop_event.is_set():
                    return
                fallback: ResearchResultPayload = {
                    "success": False,
                    "query": query,
                    "answer": last_thought or "Answer\nNo answer found.\n",
                    "structured_articles": "",
                    "articles_searched": len(articles_dict),
                    "referenced_articles": [],
                    "source_providers": [],
                }
                yield f"data: {json.dumps({'type': 'complete', 'result': fallback, 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"

        except asyncio.CancelledError:
            stop_event.set()
            logger.info("Research stream cancelled for query=%s", query)
            raise
        except Exception as exc:  # pragma: no cover - defensive logging
            message = str(exc)
            lower_msg = message.lower()
            if any(
                keyword in lower_msg
                for keyword in ["rate limit", "quota", "429", "too many requests"]
            ):
                message = "API Rate Limit: The AI service has reached its rate limit. Please wait a moment and try again."
            elif "timeout" in lower_msg:
                message = (
                    "Request Timeout: The research took too long. Try a simpler query."
                )

            yield f"data: {json.dumps({'type': 'error', 'message': message, 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"
        finally:
            stop_event.set()

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/research", response_model=NewsResearchResponse)
async def news_research_endpoint(request: NewsResearchRequest) -> NewsResearchResponse:
    articles_payload = await load_articles_for_research(request.query)
    articles_dict = cast(
        List[ResearchArticle],
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
        for step in cast(List[Dict[str, Any]], result.get("thinking_steps", []))
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
