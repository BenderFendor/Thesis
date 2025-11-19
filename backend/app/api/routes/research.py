from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.models.research import NewsResearchRequest, NewsResearchResponse, ThinkingStep
from app.services.news_research import load_articles_for_research, run_research_agent

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

            # Run blocking research agent in thread pool to avoid blocking event loop
            result = await asyncio.to_thread(
                run_research_agent,
                query,
                articles_dict,
                include_thinking,
                chat_history,
            )

            for step in result.get("thinking_steps", []):
                yield f"data: {json.dumps({'type': 'thinking_step', 'step': step, 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"

            if result.get("structured_articles"):
                yield f"data: {json.dumps({'type': 'articles_json', 'data': result['structured_articles'], 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"

            if result.get("referenced_articles"):
                yield f"data: {json.dumps({'type': 'referenced_articles', 'articles': result['referenced_articles'], 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"

            yield f"data: {json.dumps({'type': 'complete', 'result': result, 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"
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
