"""LangGraph-powered news research agent with RAG + web search tools."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Annotated, Any, Callable, Dict, Generator, List, Optional, Sequence

from ddgs import DDGS
from typing import cast
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from pydantic import SecretStr
from typing_extensions import TypedDict

from app.core.config import get_llamacpp_model, settings
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
    "the store. Avoid meta commentary about tools; focus on answering the user.\n"
    "Respond with sections titled 'Answer' and 'Follow-up questions'.\n"
    "Cite sources with URLs, highlight differing viewpoints, and mention\n"
    "bias or funding details when relevant. Current date: {date}."
)
FINALIZER_SYSTEM_PROMPT = (
    "You are a careful news analyst. Produce the final response with sections titled "
    "'Answer' and 'Follow-up questions'. Use the provided context only. "
    "Include URLs in citations when possible. Keep the answer concise but complete."
)
MAX_ITERATIONS = 5
MIN_FINAL_ANSWER_CHARS = 120
MIN_FINAL_ANSWER_SECTIONS = ("answer", "follow-up questions")

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
            str(article_id) == str(existing.get("id") or existing.get("article_id"))
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
        ddgs = cast(Any, DDGS())
        text_search_fn = getattr(ddgs, "text")
        results = list(text_search_fn(query, max_results=num_results))
        return (
            json.dumps(results[:num_results], indent=2)
            if results
            else "No results found."
        )
    except Exception as exc:  # pragma: no cover - network errors
        logger.warning("Web search failed: %s", exc)
        return f"Web search failed: {exc}"


@tool
def news_search(keywords: str, max_results: int = 10, region: str = "wt-wt") -> str:
    """Use DuckDuckGo news vertical for near-real-time stories."""
    try:
        ddgs = cast(Any, DDGS())
        news_search_fn = getattr(ddgs, "news")
        results = list(news_search_fn(keywords, max_results=max_results, region=region))
        return (
            json.dumps(results[:max_results], indent=2)
            if results
            else "No results found."
        )
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
        unique_key = (
            metadata.get("url")
            or f"rag_{int(datetime.now(timezone.utc).timestamp())}_{added}"
        )
        success = store.add_article(
            article_id=str(unique_key),
            title=title,
            summary=summary,
            content=content,
            metadata=metadata,
        )
        if success:
            added += 1
    return (
        f"Successfully indexed {added} documents."
        if added
        else "No documents were indexed."
    )


tools = [
    search_internal_news,
    web_search,
    news_search,
    fetch_article_content,
    rag_index_documents,
]


TOOL_ROUTER_SYSTEM_PROMPT = (
    "Decide which tools to use for the query. "
    "Always use search_internal_news first, then web_search or news_search. "
    "If you need full text, call fetch_article_content on selected URLs. "
    "After tool use, answer with sections titled 'Answer' and 'Follow-up questions'."
)

_llm_instance = None
_model_instance = None
_tool_router_instance = None
_graph_instance = None


def _reset_llm_instances() -> None:
    global _llm_instance, _model_instance, _tool_router_instance
    _llm_instance = None
    _model_instance = None
    _tool_router_instance = None


def _is_recoverable_llamacpp_error(exc: Exception) -> bool:
    if settings.llm_backend != "llamacpp":
        return False
    message = str(exc).lower()
    if "cannot have 2 or more assistant messages at the end of the list" in message:
        return True
    return (
        "invalid_request_error" in message
        and "model" in message
        and "not found" in message
    )


def _coalesce_assistant_runs(messages: Sequence[BaseMessage]) -> List[BaseMessage]:
    collapsed: List[BaseMessage] = []
    for message in messages:
        if (
            collapsed
            and isinstance(message, AIMessage)
            and isinstance(collapsed[-1], AIMessage)
        ):
            collapsed[-1] = message
        else:
            collapsed.append(message)
    return collapsed


def _trim_trailing_assistant_runs(messages: Sequence[BaseMessage]) -> List[BaseMessage]:
    sanitized = list(messages)
    while (
        len(sanitized) >= 2
        and isinstance(sanitized[-1], AIMessage)
        and isinstance(sanitized[-2], AIMessage)
    ):
        del sanitized[-2]
    return sanitized


def _sanitize_messages_for_llamacpp(
    messages: Sequence[BaseMessage],
) -> List[BaseMessage]:
    if settings.llm_backend != "llamacpp":
        return list(messages)
    return _trim_trailing_assistant_runs(_coalesce_assistant_runs(messages))


def _refresh_llamacpp_model() -> None:
    try:
        from app.core.config import check_llamacpp_server

        check_llamacpp_server(logger)
    except Exception as refresh_exc:
        logger.warning("llama.cpp model refresh failed: %s", refresh_exc)


def _invoke_with_llamacpp_recovery(
    invoke_fn: Callable[[Sequence[BaseMessage]], Any],
    messages: Sequence[BaseMessage],
    stage: str,
) -> Any:
    prepared = _sanitize_messages_for_llamacpp(messages)
    try:
        return invoke_fn(prepared)
    except Exception as exc:
        if not _is_recoverable_llamacpp_error(exc):
            raise
        logger.warning(
            "Recoverable llama.cpp request error during %s; retrying once: %s",
            stage,
            exc,
        )
        error_text = str(exc).lower()
        if "model" in error_text and "not found" in error_text:
            _refresh_llamacpp_model()
        _reset_llm_instances()
        retry_messages = _sanitize_messages_for_llamacpp(prepared)
        return invoke_fn(retry_messages)


def _get_llm():
    global _llm_instance
    if _llm_instance is None:
        if settings.llm_backend == "llamacpp":
            _llm_instance = ChatOpenAI(
                model=get_llamacpp_model(),
                temperature=0.2,
                api_key=SecretStr(settings.llamacpp_api_key),
                base_url=settings.llamacpp_base_url,
            )
        elif settings.open_router_api_key:
            _llm_instance = ChatOpenAI(
                model=settings.open_router_model,
                temperature=0.2,
                api_key=SecretStr(settings.open_router_api_key),
                base_url="https://openrouter.ai/api/v1",
            )
        else:
            _llm_instance = ChatGoogleGenerativeAI(
                model=os.getenv("NEWS_RESEARCH_GEMINI_MODEL", "gemini-3-flash-preview"),
                temperature=0.2,
                max_retries=2,
            )
    return _llm_instance


def _get_model():
    global _model_instance
    if _model_instance is None:
        _model_instance = _get_llm().bind_tools(tools)
    return _model_instance


def _get_tool_router():
    global _tool_router_instance
    if _tool_router_instance is None:
        _tool_router_instance = _get_llm().bind_tools(tools, tool_choice="required")
    return _tool_router_instance


def _get_graph():
    global _graph_instance
    if _graph_instance is None:
        builder = StateGraph(AgentState)
        builder.add_node("agent", call_model)
        builder.add_node("tools", ToolNode(tools))
        builder.add_edge(START, "agent")
        builder.add_edge("tools", "agent")
        builder.add_conditional_edges(
            "agent",
            should_continue,
            {"tools": "tools", "agent": "agent", END: END},
        )
        _graph_instance = builder.compile()
    return _graph_instance


class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    iteration: int
    mode: str


def call_model(state: AgentState) -> Dict[str, Any]:
    mode = state.get("mode", "research")
    if mode == "final":
        messages = list(state["messages"])
        last_user = ""
        for message in reversed(messages):
            if isinstance(message, HumanMessage):
                last_user = str(message.content)
                break

        snippets = []
        for message in messages:
            if isinstance(message, AIMessage):
                content = _extract_text_from_message(message).strip()
                if content:
                    snippets.append(content)
            elif isinstance(message, HumanMessage):
                snippets.append(str(message.content))
        context_blob = "\n\n".join(snippets[-6:])

        messages = [
            SystemMessage(content=FINALIZER_SYSTEM_PROMPT),
            HumanMessage(
                content=(
                    "Return the final response with sections titled 'Answer' and "
                    "'Follow-up questions'. Use the context provided.\n\n"
                    f"Question: {last_user}\n\nContext:\n{context_blob}"
                )
            ),
        ]
        response = _invoke_with_llamacpp_recovery(
            lambda payload: _get_llm().invoke(payload),
            messages,
            "final mode invoke",
        )
        return {
            "messages": [response],
            "iteration": state.get("iteration", 0),
            "mode": mode,
        }

    if mode == "tool_router":
        messages = [
            SystemMessage(content=TOOL_ROUTER_SYSTEM_PROMPT),
            *state["messages"],
        ]
        response = _invoke_with_llamacpp_recovery(
            lambda payload: _get_tool_router().invoke(payload),
            messages,
            "tool router invoke",
        )
        return {
            "messages": [response],
            "iteration": state.get("iteration", 0) + 1,
            "mode": "research",
        }

    response = _invoke_with_llamacpp_recovery(
        lambda payload: _get_model().invoke(payload),
        state["messages"],
        "research invoke",
    )
    iteration = state.get("iteration", 0) + 1
    next_mode = "research"
    if isinstance(response, AIMessage):
        content = _extract_text_from_message(response)
        if _needs_final_answer(content) and not getattr(response, "tool_calls", None):
            next_mode = "tool_router"
    return {
        "messages": [response],
        "iteration": iteration,
        "mode": next_mode,
    }


def _extract_text_from_message(message: BaseMessage) -> str:
    if isinstance(message, AIMessage):
        return _content_to_text(message.content)
    if isinstance(message, HumanMessage):
        return str(message.content)
    return _content_to_text(getattr(message, "content", ""))


def should_continue(state: AgentState) -> str:
    iteration = state.get("iteration", 0)
    if state.get("mode") == "tool_router":
        return "agent"
    if state.get("mode") == "final":
        return END
    if iteration >= MAX_ITERATIONS:
        state["mode"] = "final"
        return "agent"
    last_message = state["messages"][-1]
    if isinstance(last_message, AIMessage) and getattr(
        last_message, "tool_calls", None
    ):
        return "tools"
    if isinstance(last_message, AIMessage):
        content = _extract_text_from_message(last_message)
        if _needs_final_answer(content):
            state["mode"] = "final"
            return "agent"
    return END


def _build_initial_messages(
    query: str, chat_history: Optional[List[Dict[str, str]]] = None
) -> List[BaseMessage]:
    system_message = SystemMessage(
        content=SYSTEM_PROMPT.format(
            date=datetime.now(timezone.utc).strftime("%Y-%m-%d")
        )
    )
    history_messages: List[BaseMessage] = []
    if chat_history:
        for entry in chat_history:
            role = entry.get("type")
            content = entry.get("content", "")
            if role == "user":
                history_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                history_messages.append(AIMessage(content=content))
    combined = (
        [system_message, *_coalesce_assistant_runs(history_messages)]
        if settings.llm_backend == "llamacpp"
        else [system_message, *history_messages]
    )
    combined.append(HumanMessage(content=query))
    return _sanitize_messages_for_llamacpp(combined)


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


def _has_required_sections(answer_text: str) -> bool:
    lower_content = answer_text.lower()
    return all(section in lower_content for section in MIN_FINAL_ANSWER_SECTIONS)


def _needs_final_answer(answer_text: str) -> bool:
    content = answer_text.strip()
    if not content:
        return True
    if len(content) < MIN_FINAL_ANSWER_CHARS:
        return True
    return not _has_required_sections(content)


def _build_context_snippet(referenced_articles: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for article in referenced_articles[:8]:
        title = article.get("title") or "Untitled"
        source = article.get("source") or "Unknown"
        url = article.get("url") or article.get("link") or ""
        summary = article.get("summary") or article.get("description") or ""
        published = article.get("published") or ""
        lines.append(f"- {title} ({source}) {published}\n  {url}\n  {summary}")
    return "\n".join(lines)


def _finalize_answer(
    query: str,
    referenced_articles: List[Dict[str, Any]],
    tool_snippets: List[str],
) -> str:
    context = _build_context_snippet(referenced_articles)
    tool_context = "\n".join(tool_snippets[:6]) if tool_snippets else ""
    prompt_parts = [
        f"Question: {query}",
        "Context:",
        context or "No article context available.",
    ]
    if tool_context:
        prompt_parts.extend(["Tool notes:", tool_context])
    prompt_parts.append("Return the final response.")
    finalizer_messages = [
        SystemMessage(content=FINALIZER_SYSTEM_PROMPT),
        HumanMessage(content="\n\n".join(prompt_parts)),
    ]
    try:
        response = _invoke_with_llamacpp_recovery(
            lambda payload: _get_llm().invoke(payload),
            finalizer_messages,
            "finalizer invoke",
        )
        return _content_to_text(response.content).strip()
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.warning("Finalizer failed: %s", exc)
        return ""


def _sanitize_final_answer(answer_text: str) -> str:
    content = answer_text.strip()
    if _has_required_sections(content):
        return content
    if not content:
        content = "No answer available."
    return (
        "Answer\n"
        + content
        + "\n\nFollow-up questions\n- What details should I verify?\n"
    )


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
        "mode": "research",
    }

    thinking_steps: List[Dict[str, Any]] = []
    final_answer = ""
    tool_snippets: List[str] = []

    for update in _get_graph().stream(initial_state, stream_mode="updates"):
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
                snippet = _content_to_text(tool_message.content)[:2000]
                thinking_steps.append(
                    {
                        "type": "observation",
                        "content": snippet,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )
                if snippet:
                    tool_snippets.append(snippet)

    referenced_articles = list(_referenced_articles_tracker)
    if not referenced_articles and final_answer:
        referenced_articles = _match_articles_in_text(final_answer)

    if _needs_final_answer(final_answer):
        synthesized = _finalize_answer(query, referenced_articles, tool_snippets)
        if synthesized:
            final_answer = synthesized

    final_answer = _sanitize_final_answer(final_answer)

    structured_block = ""
    if referenced_articles:
        payload = {
            "articles": referenced_articles,
            "total": len(referenced_articles),
            "query": query,
        }
        structured_block = f"\n```json:articles\n{json.dumps(payload, indent=2)}\n```\n"

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
        "mode": "research",
    }

    final_answer = ""
    tool_snippets: List[str] = []

    for update in _get_graph().stream(initial_state, stream_mode="updates"):
        if "agent" in update:
            agent_message = update["agent"]["messages"][-1]
            content_text = _content_to_text(agent_message.content)
            if content_text:
                final_answer = content_text
                yield (
                    "data: "
                    + json.dumps({"type": "thinking", "content": content_text})
                    + "\n\n"
                )

            for tool_call in getattr(agent_message, "tool_calls", []) or []:
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "tool_start",
                            "tool": tool_call.get("name"),
                            "args": tool_call.get("args", {}),
                        }
                    )
                    + "\n\n"
                )
        if "tools" in update:
            for tool_message in update["tools"]["messages"]:
                snippet = _content_to_text(tool_message.content)[:2000]
                if snippet:
                    tool_snippets.append(snippet)
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "tool_result",
                            "content": snippet,
                        }
                    )
                    + "\n\n"
                )

    referenced_articles = list(_referenced_articles_tracker)
    if not referenced_articles and final_answer:
        referenced_articles = _match_articles_in_text(final_answer)

    if _needs_final_answer(final_answer):
        synthesized = _finalize_answer(query, referenced_articles, tool_snippets)
        if synthesized:
            final_answer = synthesized

    final_answer = _sanitize_final_answer(final_answer)

    yield (
        "data: "
        + json.dumps({"type": "referenced_articles", "articles": referenced_articles})
        + "\n\n"
    )

    structured_block = ""
    if referenced_articles:
        payload = {
            "articles": referenced_articles,
            "total": len(referenced_articles),
            "query": query,
        }
        json_payload = json.dumps(payload)
        yield (
            "data: "
            + json.dumps({"type": "articles_json", "data": json_payload})
            + "\n\n"
        )
        structured_block = f"\n```json:articles\n{json.dumps(payload, indent=2)}\n```\n"

    result = {
        "success": bool(final_answer.strip()),
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
