"""LangGraph-powered news research agent with RAG + web search tools."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, Generator, List, Optional, Sequence

from ddgs import DDGS
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from pydantic import SecretStr
from typing_extensions import TypedDict

from app.core.config import settings
from app.core.logging import get_logger
from app.services.article_extraction import extract_article_content
from app.vector_store import get_vector_store

logger = get_logger("news_research_agent")

if settings.gemini_api_key:
    os.environ.setdefault("GOOGLE_API_KEY", settings.gemini_api_key)
if settings.open_router_api_key:
    os.environ.setdefault("OPEN_ROUTER_API_KEY", settings.open_router_api_key)

SYSTEM_PROMPT = (
    "You are an expert news research agent working for a multi-perspective platform.\n"
    "Always begin with search_internal_news to ground yourself in cached coverage,\n"
    "then use web_search or news_search for fresh context. When you find useful\n"
    "articles that are missing from the archive, call rag_index_documents to update\n"
    "the store. Cite sources with URLs, highlight differing viewpoints, and mention\n"
    "bias or funding details when relevant. Current date: {date}."
)
MAX_ITERATIONS = 3

_news_articles_cache: List[Dict[str, Any]] = []
_referenced_articles_tracker: List[Dict[str, Any]] = []
_articles_by_id: Dict[str, Dict[str, Any]] = {}


def _normalize_url(url: Optional[str]) -> Optional[str]:
    if not url or not isinstance(url, str):
        return None
    return url.rstrip("/")


def _register_article_lookup(article: Dict[str, Any]) -> None:
    article_id = article.get("id") or article.get("article_id")
    url_key = _normalize_url(article.get("url") or article.get("link"))

    if article_id is not None:
        _articles_by_id[str(article_id)] = article
    if url_key:
        _articles_by_id[url_key] = article


def set_news_articles(articles: Optional[List[Dict[str, Any]]]) -> None:
    global _news_articles_cache, _referenced_articles_tracker, _articles_by_id
    _news_articles_cache = articles or []
    _referenced_articles_tracker = []
    _articles_by_id = {}
    for article in _news_articles_cache:
        _register_article_lookup(article)


def _extract_query_terms(query: str) -> List[str]:
    tokens = re.findall(r"[\w-]+", query.lower())
    return [token for token in tokens if len(token) > 2]


def _track_reference(article: Dict[str, Any]) -> None:
    if not article:
        return
    article_id = article.get("id") or article.get("article_id")
    url_key = _normalize_url(article.get("url") or article.get("link"))
    already_seen = False
    if article_id is not None:
        already_seen = any(
            str(article_id)
            == str(existing.get("id") or existing.get("article_id"))
            for existing in _referenced_articles_tracker
        )
    if not already_seen and url_key:
        already_seen = any(
            _normalize_url(existing.get("url") or existing.get("link")) == url_key
            for existing in _referenced_articles_tracker
        )
    if not already_seen:
        _referenced_articles_tracker.append(article)


@tool
def search_internal_news(query: str, top_k: int = 5) -> str:
    """Semantic-ish search over cached news articles."""
    if not _news_articles_cache:
        return "No cached articles available for internal search."

    query_terms = _extract_query_terms(query)
    if not query_terms:
        return "Query too vague for internal search."

    scored: List[tuple[int, Dict[str, Any]]] = []
    for article in _news_articles_cache:
        haystack = " ".join(
            [
                article.get("title", ""),
                article.get("summary", ""),
                article.get("description", ""),
                article.get("content", ""),
            ]
        ).lower()
        score = sum(term in haystack for term in query_terms)
        if score:
            scored.append((score, article))

    if not scored:
        return "No relevant articles found in cache."

    scored.sort(key=lambda item: item[0], reverse=True)
    matches = [item[1] for item in scored[:top_k]]
    for match in matches:
        _track_reference(match)

    payload = [
        {
            "title": article.get("title"),
            "source": article.get("source"),
            "url": article.get("url") or article.get("link"),
            "published": article.get("published"),
            "summary": article.get("summary") or article.get("description"),
        }
        for article in matches
    ]
    return json.dumps(payload, indent=2)


@tool
def web_search(query: str, num_results: int = 10) -> str:
    """Perform general web search for recent context."""
    try:
        ddgs = DDGS()
        results = list(ddgs.text(query, max_results=num_results))
        return json.dumps(results[:num_results], indent=2) if results else "No results found."
    except Exception as exc:  # pragma: no cover - network errors
        logger.warning("Web search failed: %s", exc)
        return f"Web search failed: {exc}"


@tool
def news_search(keywords: str, max_results: int = 10, region: str = "wt-wt") -> str:
    """Use DuckDuckGo news vertical for near-real-time stories."""
    try:
        ddgs = DDGS()
        results = list(ddgs.news(keywords, max_results=max_results, region=region))
        return json.dumps(results[:max_results], indent=2) if results else "No results found."
    except Exception as exc:  # pragma: no cover - network errors
        logger.warning("News search failed: %s", exc)
        return f"News search failed: {exc}"


@tool
def fetch_article_content(url: str) -> str:
    """Fetch and clean article content from the provided URL."""
    result = extract_article_content(url)
    if "error" in result:
        return f"Error fetching {url}: {result['error']}"
    text = result.get("text", "")
    preview = text[:8000]
    return f"Title: {result.get('title', 'Untitled')}\nContent: {preview}"


@tool
def rag_index_documents(documents: List[Dict[str, Any]]) -> str:
    """Persist fresh documents into the vector store for future internal search."""
    if isinstance(documents, str):
        try:
            documents = json.loads(documents)
        except json.JSONDecodeError:
            return "Invalid documents payload."

    store = get_vector_store()
    if not store:
        return "Vector store is disabled or unavailable."

    added = 0
    for document in documents:
        content = document.get("content") or document.get("text")
        if not content:
            continue
        metadata = document.get("metadata", {})
        title = metadata.get("title") or document.get("title") or "External Article"
        summary = content[:500]
        unique_key = metadata.get("url") or f"rag_{int(datetime.now(timezone.utc).timestamp())}_{added}"
        success = store.add_article(
            article_id=str(unique_key),
            title=title,
            summary=summary,
            content=content,
            metadata=metadata,
        )
        if success:
            added += 1
    return f"Successfully indexed {added} documents." if added else "No documents were indexed."


tools = [
    search_internal_news,
    web_search,
    news_search,
    fetch_article_content,
    rag_index_documents,
]

if settings.open_router_api_key:
    llm = ChatOpenAI(
        model=settings.open_router_model,
        temperature=0.2,
        api_key=SecretStr(settings.open_router_api_key),
        base_url="https://openrouter.ai/api/v1",
    )
else:
    llm = ChatGoogleGenerativeAI(
        model=os.getenv("NEWS_RESEARCH_GEMINI_MODEL", "gemini-3-flash-preview"),
        temperature=0.2,
        max_retries=2,
    )

model = llm.bind_tools(tools)


class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    iteration: int


def call_model(state: AgentState) -> Dict[str, Any]:
    response = model.invoke(state["messages"])
    return {"messages": [response], "iteration": state.get("iteration", 0) + 1}


def should_continue(state: AgentState) -> str:
    iteration = state.get("iteration", 0)
    if iteration >= MAX_ITERATIONS:
        return END
    last_message = state["messages"][-1]
    if isinstance(last_message, AIMessage) and getattr(last_message, "tool_calls", None):
        return "tools"
    return END


graph_builder = StateGraph(AgentState)
graph_builder.add_node("agent", call_model)
graph_builder.add_node("tools", ToolNode(tools))
graph_builder.add_edge(START, "agent")
graph_builder.add_edge("tools", "agent")
graph_builder.add_conditional_edges(
    "agent",
    should_continue,
    {"tools": "tools", END: END},
)

graph = graph_builder.compile()


def _build_initial_messages(
    query: str, chat_history: Optional[List[Dict[str, str]]] = None
) -> List[BaseMessage]:
    system_message = SystemMessage(
        content=SYSTEM_PROMPT.format(date=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    )
    history_messages: List[BaseMessage] = []
    if chat_history:
        for entry in chat_history[-6:]:
            role = entry.get("type")
            content = entry.get("content", "")
            if role == "user":
                history_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                history_messages.append(AIMessage(content=content))
    return [system_message, *history_messages, HumanMessage(content=query)]


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for chunk in content:
            value = chunk.get("text") if isinstance(chunk, dict) else None
            if value:
                parts.append(value)
        return "".join(parts)
    return str(content)


def _match_articles_in_text(answer_text: str) -> List[Dict[str, Any]]:
    pattern = r"https?://[^\s)]+"
    matches = re.findall(pattern, answer_text)
    resolved: List[Dict[str, Any]] = []
    for match in matches:
        normalized = _normalize_url(match)
        if not normalized:
            continue
        article = _articles_by_id.get(normalized)
        if article:
            _track_reference(article)
            resolved.append(article)
    return resolved


def research_news(
    query: str,
    articles: Optional[List[Dict[str, Any]]] = None,
    verbose: bool = True,
    chat_history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    set_news_articles(articles)
    initial_state: AgentState = {
        "messages": _build_initial_messages(query, chat_history),
        "iteration": 0,
    }

    thinking_steps: List[Dict[str, Any]] = []
    final_answer = ""

    for update in graph.stream(initial_state, stream_mode="updates"):
        if "agent" in update:
            agent_message = update["agent"]["messages"][-1]
            final_answer = _content_to_text(agent_message.content)
            thinking_steps.append(
                {
                    "type": "thought",
                    "content": final_answer,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
            for tool_call in getattr(agent_message, "tool_calls", []) or []:
                thinking_steps.append(
                    {
                        "type": "action",
                        "content": f"Calling {tool_call['name']} with {tool_call.get('args', {})}",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )
        if "tools" in update:
            for tool_message in update["tools"]["messages"]:
                thinking_steps.append(
                    {
                        "type": "observation",
                        "content": _content_to_text(tool_message.content)[:2000],
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )

    referenced_articles = list(_referenced_articles_tracker)
    if not referenced_articles and final_answer:
        referenced_articles = _match_articles_in_text(final_answer)

    structured_block = ""
    if referenced_articles:
        payload = {
            "articles": referenced_articles,
            "total": len(referenced_articles),
            "query": query,
        }
        json_payload = json.dumps(payload)
        structured_block = (
            f"\n```json:articles\n{json.dumps(payload, indent=2)}\n```\n"
        )

    result = {
        "success": bool(final_answer),
        "query": query,
        "answer": final_answer,
        "structured_articles": structured_block,
        "thinking_steps": thinking_steps if verbose else [],
        "articles_searched": len(_news_articles_cache),
        "referenced_articles": referenced_articles,
    }
    if structured_block and structured_block not in final_answer:
        result["answer"] += structured_block

    return result


def research_stream(
    query: str,
    articles: Optional[List[Dict[str, Any]]] = None,
    chat_history: Optional[List[Dict[str, str]]] = None,
) -> Generator[str, None, None]:
    set_news_articles(articles)
    initial_state: AgentState = {
        "messages": _build_initial_messages(query, chat_history),
        "iteration": 0,
    }

    final_answer = ""

    for update in graph.stream(initial_state, stream_mode="updates"):
        if "agent" in update:
            agent_message = update["agent"]["messages"][-1]
            content_text = _content_to_text(agent_message.content)
            if content_text:
                final_answer = content_text
                yield "data: " + json.dumps(
                    {"type": "thinking", "content": content_text}
                ) + "\n\n"

            for tool_call in getattr(agent_message, "tool_calls", []) or []:
                yield "data: " + json.dumps(
                    {
                        "type": "tool_start",
                        "tool": tool_call.get("name"),
                        "args": tool_call.get("args", {}),
                    }
                ) + "\n\n"
        if "tools" in update:
            for tool_message in update["tools"]["messages"]:
                yield "data: " + json.dumps(
                    {
                        "type": "tool_result",
                        "content": _content_to_text(tool_message.content)[:2000],
                    }
                ) + "\n\n"

    referenced_articles = list(_referenced_articles_tracker)
    if not referenced_articles and final_answer:
        referenced_articles = _match_articles_in_text(final_answer)

    yield "data: " + json.dumps(
        {"type": "referenced_articles", "articles": referenced_articles}
    ) + "\n\n"

    structured_block = ""
    if referenced_articles:
        payload = {
            "articles": referenced_articles,
            "total": len(referenced_articles),
            "query": query,
        }
        json_payload = json.dumps(payload)
        yield "data: " + json.dumps(
            {"type": "articles_json", "data": json_payload}
        ) + "\n\n"
        structured_block = (
            f"\n```json:articles\n{json.dumps(payload, indent=2)}\n```\n"
        )

    result = {
        "success": True,
        "query": query,
        "answer": final_answer,
        "structured_articles": structured_block,
        "articles_searched": len(_news_articles_cache),
        "referenced_articles": referenced_articles,
    }
    # if structured_block and structured_block not in final_answer:
    #     result["answer"] += structured_block

    yield "data: " + json.dumps({"type": "complete", "result": result}) + "\n\n"
    yield 'data: {"type": "done"}\n\n'


__all__ = [
    "research_news",
    "research_stream",
    "set_news_articles",
]
