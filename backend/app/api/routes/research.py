from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from starlette.concurrency import iterate_in_threadpool

from app.core.logging import get_logger
from app.models.research import NewsResearchRequest, NewsResearchResponse, ThinkingStep
from app.services.news_research import (
    load_articles_for_research,
    run_research_agent,
    stream_research_agent,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/news", tags=["news-research"])


@router.get("/research/stream")
async def news_research_stream_endpoint(
    query: str = Query(..., description="The research query"),
    include_thinking: bool = Query(True, description="Include thinking steps"),
    history: str | None = Query(
        None, description="JSON-encoded chat history for context"
    ),
):
    async def generate():
        try:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Starting research...', 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"

            articles_payload = await load_articles_for_research(query)
            articles_dict = articles_payload.get("articles", [])
            retrieval_summary = articles_payload.get("summary", {})
            total_articles = retrieval_summary.get("total", len(articles_dict))

            status_message = {
                "type": "status",
                "message": (
                    f"Searching {total_articles} articles "
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
                    chat_history = json.loads(history)
                except json.JSONDecodeError:
                    chat_history = None

            # Stream the research agent events
            final_result = None
            last_thought = None
            async for event_raw in iterate_in_threadpool(
                stream_research_agent(query, articles_dict, chat_history)
            ):
                try:
                    # event_raw is formatted as "data: {...}\n\n"
                    json_str = event_raw.replace("data: ", "").strip()
                    if not json_str:
                        continue

                    event = json.loads(json_str)
                    timestamp = datetime.now(timezone.utc).isoformat()

                    if event["type"] == "thinking":
                        last_thought = event.get("content")
                        yield f"data: {json.dumps({'type': 'thinking_step', 'step': {'type': 'thought', 'content': event['content'], 'timestamp': timestamp}, 'timestamp': timestamp})}\n\n"

                    elif event["type"] == "tool_start":
                        tool_name = event["tool"]
                        args = event["args"]

                        # Generate verbose status message
                        status_msg = f"Using tool: {tool_name}..."
                        if tool_name == "web_search":
                            q = args.get("query", "")
                            status_msg = f"Searching web for: {q}..."
                        elif tool_name == "news_search":
                            k = args.get("keywords", "")
                            status_msg = f"Searching news for: {k}..."
                        elif tool_name == "search_internal_news":
                            status_msg = "Searching internal knowledge base..."
                        elif tool_name == "fetch_article_content":
                            u = args.get("url", "url")
                            status_msg = f"Reading article: {u}..."
                        elif tool_name == "rag_index_documents":
                            status_msg = "Indexing new documents..."

                        yield f"data: {json.dumps({'type': 'status', 'message': status_msg, 'timestamp': timestamp})}\n\n"
                        yield f"data: {json.dumps({'type': 'tool_start', 'tool': tool_name, 'args': args, 'timestamp': timestamp})}\n\n"

                        if include_thinking:
                            content = f"Calling {tool_name} with {json.dumps(args)}"
                            yield f"data: {json.dumps({'type': 'thinking_step', 'step': {'type': 'tool_start', 'content': content, 'timestamp': timestamp}, 'timestamp': timestamp})}\n\n"

                    elif event["type"] == "tool_result":
                        yield f"data: {json.dumps({'type': 'status', 'message': 'Processing tool results...', 'timestamp': timestamp})}\n\n"
                        yield f"data: {json.dumps({'type': 'tool_result', 'content': event['content'], 'timestamp': timestamp})}\n\n"
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
                fallback = {
                    "success": False,
                    "query": query,
                    "answer": last_thought
                    or "Answer\nNo answer available.\n\nFollow-up questions\n- What details should I verify?",
                    "structured_articles": "",
                    "articles_searched": len(articles_dict),
                    "referenced_articles": [],
                }
                yield f"data: {json.dumps({'type': 'complete', 'result': fallback, 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"

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

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/research", response_model=NewsResearchResponse)
async def news_research_endpoint(request: NewsResearchRequest) -> NewsResearchResponse:
    articles_payload = await load_articles_for_research(request.query)
    articles_dict = articles_payload.get("articles", [])

    # Run blocking research agent in thread pool to avoid blocking event loop
    result = await asyncio.to_thread(
        run_research_agent,
        request.query,
        articles_dict,
        request.include_thinking,
        None,
    )

    thinking_steps = [ThinkingStep(**step) for step in result.get("thinking_steps", [])]

    return NewsResearchResponse(
        success=result.get("success", False),
        query=result.get("query", request.query),
        answer=result.get("answer", ""),
        thinking_steps=thinking_steps,
        articles_searched=result.get("articles_searched", 0),
        referenced_articles=result.get("referenced_articles", []),
        error=result.get("error"),
    )
