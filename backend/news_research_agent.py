"""LangGraph-powered news research agent with RAG + web search tools."""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
from datetime import datetime, UTC
from typing import (
    Annotated,
    Any,
    Protocol,
)
from collections.abc import Callable, Generator, Iterator, Sequence

from typing import cast
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
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
from app.database import AsyncSessionLocal, search_articles_by_keyword
from app.services.article_extraction import extract_article_content
from app.services.gdelt_query import (
    DEFAULT_TIMESPAN as GDELT_DEFAULT_TIMESPAN,
    get_gdelt_query_service,
)
from app.services.persistence import get_main_event_loop
from app.services.prompting import (
    ANSWER_SECTION_RULE,
    FACT_GROUNDING_RULES,
    PROVIDED_CONTEXT_ONLY_RULES,
    TEXT_OUTPUT_RULES,
    build_text_system_prompt,
    compose_prompt_blocks,
)
from app.vector_store import get_vector_store

ddgs_module: Any
try:  # pragma: no cover - optional dependency in some test environments
    import ddgs as _ddgs_module

    ddgs_module = _ddgs_module
except ImportError:  # pragma: no cover - optional dependency missing
    ddgs_module = None

DDGS: Any = getattr(ddgs_module, "DDGS", None)

logger = get_logger("news_research_agent")

if settings.gemini_api_key:
    os.environ.setdefault("GOOGLE_API_KEY", settings.gemini_api_key)
if settings.open_router_api_key:
    os.environ.setdefault("OPEN_ROUTER_API_KEY", settings.open_router_api_key)


def _system_prompt() -> str:
    return build_text_system_prompt(
        role="news research agent",
        task=(
            "Work for a multi-perspective news platform. Always begin with "
            "search_internal_news to ground yourself in cached coverage from the "
            "database and RSS-backed archive. If internal search finds relevant "
            "articles, inspect those internal URLs with fetch_article_content before "
            "using GDELT or news search tools. For current events, prefer "
            "gdelt_context_search first, then gdelt_doc_search, and fall back to "
            "news_search only when GDELT is sparse or unavailable. Prefer context "
            "snippets before fetching full article text when the snippet is enough "
            "to answer. Use external search only when internal coverage is missing, "
            "stale, or clearly insufficient for the user's question. When you find "
            "useful articles that are missing from the archive, call "
            "rag_index_documents to update the store. Avoid tool commentary and "
            "focus on answering the user. Note differing viewpoints and mention "
            "bias or funding details when relevant."
        ),
        grounding_rules=FACT_GROUNDING_RULES,
        output_rules=compose_prompt_blocks(ANSWER_SECTION_RULE, TEXT_OUTPUT_RULES),
    )


def _finalizer_system_prompt() -> str:
    return build_text_system_prompt(
        role="news analyst",
        task="Produce the final response from the research context.",
        grounding_rules=compose_prompt_blocks(
            PROVIDED_CONTEXT_ONLY_RULES,
            "Include URLs in citations when possible.",
        ),
        output_rules=compose_prompt_blocks(ANSWER_SECTION_RULE, TEXT_OUTPUT_RULES),
    )


MAX_ITERATIONS = 5
MAX_TOOL_CALLS_PER_SESSION = 15
MIN_FINAL_ANSWER_CHARS = 120
MIN_FINAL_ANSWER_SECTIONS = ("answer",)
SEARCH_TOOLS_WITH_QUERY = {
    "web_search",
    "news_search",
    "gdelt_context_search",
    "gdelt_doc_search",
}
EXTERNAL_SEARCH_TOOLS = {"web_search", "news_search"}
EXTERNAL_SEARCH_TOOLS.update({"gdelt_context_search", "gdelt_doc_search"})
AUTO_FALLBACK_TOOL_ORDER = {
    "gdelt_context_search": ("gdelt_doc_search", "news_search"),
    "gdelt_doc_search": ("news_search",),
}
QUERY_SIMILARITY_THRESHOLD = 0.7
_TRACKED_SEARCH_TOOLS = frozenset(
    {
        "web_search",
        "news_search",
        "search_internal_news",
        "gdelt_context_search",
        "gdelt_doc_search",
    }
)
_SEARCH_PROVIDER_HINTS = {
    "search_internal_news": "internal",
    "gdelt_context_search": "gdelt",
    "gdelt_doc_search": "gdelt",
    "news_search": "duckduckgo",
    "web_search": "duckduckgo",
}

_stop_events = threading.local()


def _is_stopped() -> bool:
    event = getattr(_stop_events, "event", None)
    return event is not None and event.is_set()


class RunnableMessageInvoker(Protocol):
    """Runnable Message Invoker."""

    def invoke(self, payload: Sequence[BaseMessage]) -> BaseMessage: ...


class ToolBindableLLM(RunnableMessageInvoker, Protocol):
    """Tool Bindable LLM."""

    def bind_tools(
        self,
        tools: Sequence[Any],
        **kwargs: Any,
    ) -> RunnableMessageInvoker: ...


class CompiledAgentGraph(Protocol):
    """Compiled Agent Graph."""

    def stream(
        self,
        initial_state: AgentState,
        stream_mode: str = "updates",
    ) -> Iterator[dict[str, Any]]: ...


_news_articles_cache: list[dict[str, Any]] = []
_referenced_articles_tracker: list[dict[str, Any]] = []
_articles_by_id: dict[str, dict[str, Any]] = {}
_fetched_urls_cache: dict[str, str] = {}
_research_source_providers: set[str] = set()

DENIAL_PHRASES = (
    "provided context does not contain",
    "without additional details",
    "impossible to describe",
    "impossible to summarize",
    "only repeats the question",
    "cannot answer from the provided context",
    "not enough information in the provided context",
)


def _normalize_url(url: str | None) -> str | None:
    if not url or not isinstance(url, str):
        return None
    return url.rstrip("/")


def _normalize_tool_call_args(name: str, args: Any) -> Any:
    if name != "fetch_article_content" or not isinstance(args, dict):
        return args
    normalized_args = dict(args)
    normalized_url = _normalize_url(normalized_args.get("url"))
    if normalized_url:
        normalized_args["url"] = normalized_url
    return normalized_args


def _serialize_tool_args(args: Any) -> str:
    try:
        return json.dumps(args, sort_keys=True, ensure_ascii=True, default=str)
    except TypeError:
        return repr(args)


def _tool_call_key(call: dict[str, Any]) -> str:
    name = str(call.get("name", ""))
    normalized_args = _normalize_tool_call_args(name, call.get("args", {}))
    return f"{name}:{_serialize_tool_args(normalized_args)}"


def _extract_search_query(call: dict[str, Any]) -> str | None:
    name = str(call.get("name", ""))
    if name not in SEARCH_TOOLS_WITH_QUERY:
        return None
    args = call.get("args", {})
    if not isinstance(args, dict):
        return None
    query = str(args.get("query") or args.get("keywords") or "").strip().lower()
    return query if query else None


def _search_queries_similar(new_query_raw: str, history: set[str]) -> bool:
    new_terms = set(_extract_query_terms(new_query_raw))
    if not new_terms:
        return False
    for prev_query in history:
        prev_terms = set(_extract_query_terms(prev_query))
        if not prev_terms:
            continue
        overlap = len(new_terms & prev_terms)
        smaller = min(len(new_terms), len(prev_terms))
        if smaller > 0 and overlap / smaller > QUERY_SIMILARITY_THRESHOLD:
            return True
    return False


def _iter_new_tool_calls(
    tool_calls: Sequence[dict[str, Any]],
    seen: set[str],
) -> list[dict[str, Any]]:
    unique_calls: list[dict[str, Any]] = []
    for call in tool_calls:
        key = _tool_call_key(call)
        if key in seen:
            continue
        seen.add(key)
        unique_calls.append(call)
    return unique_calls


def _register_article_lookup(article: dict[str, Any]) -> None:
    article_id = article.get("id") or article.get("article_id")
    url_key = _normalize_url(article.get("url") or article.get("link"))

    if article_id is not None:
        _articles_by_id[str(article_id)] = article
    if url_key:
        _articles_by_id[url_key] = article


def _record_research_source_provider(provider: str | None) -> None:
    normalized = str(provider or "").strip().lower()
    if normalized:
        _research_source_providers.add(normalized)


def set_news_articles(articles: list[dict[str, Any]] | None) -> None:
    """Set News Articles."""
    global _news_articles_cache
    global _referenced_articles_tracker
    global _articles_by_id
    global _fetched_urls_cache
    global _research_source_providers
    _news_articles_cache = articles or []
    _referenced_articles_tracker = []
    _articles_by_id = {}
    _fetched_urls_cache = {}
    _research_source_providers = set()
    for article in _news_articles_cache:
        _register_article_lookup(article)


def _extract_query_terms(query: str) -> list[str]:
    tokens = re.findall(r"[\w-]+", query.lower())
    return [token for token in tokens if len(token) > 2]


def _run_async_blocking(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        target_loop = get_main_event_loop()
        if target_loop is not None and target_loop.is_running():
            return asyncio.run_coroutine_threadsafe(coro, target_loop).result()
        return asyncio.run(coro)

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def _runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except BaseException as exc:  # pragma: no cover - defensive bridge
            error["value"] = exc

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    thread.join()

    if "value" in error:
        raise error["value"]
    return result.get("value")


async def _search_internal_news_from_db(
    query: str,
    top_k: int,
) -> list[dict[str, Any]]:
    if not settings.enable_database or AsyncSessionLocal is None:
        return []

    async with AsyncSessionLocal() as session:
        return await search_articles_by_keyword(session, query=query, limit=top_k)


def _first_nonempty(*values: Any, default: Any = "") -> Any:
    return next((value for value in values if value), default)


def _article_identity(article: dict[str, Any]) -> tuple[str | None, str]:
    article_id = _first_nonempty(article.get("id"), article.get("article_id"), default=None)
    url = _normalize_url(_first_nonempty(article.get("url"), article.get("link")))
    return (str(article_id) if article_id is not None else None, url)


def _same_article_reference(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_id, left_url = _article_identity(left)
    right_id, right_url = _article_identity(right)
    return (left_id is not None and left_id == right_id) or bool(left_url and left_url == right_url)


def _search_result_key(item: Any) -> str | None:
    if not isinstance(item, dict):
        return None
    url = _normalize_url(str(_first_nonempty(item.get("url"), item.get("link"))))
    title = str(_first_nonempty(item.get("title"), item.get("headline"))).strip().lower()
    provider = str(item.get("provider") or "").strip().lower()
    return url or (f"{provider}:{title}" if provider or title else None)


def _gdelt_fallback_args(args: dict[str, Any]) -> dict[str, Any] | None:
    query = _normalize_query(str(_first_nonempty(args.get("query"), args.get("keywords"))))
    if not query:
        return None
    result: dict[str, Any] = {
        "query": query,
        "max_results": _coerce_positive_int(args.get("max_results"), 10),
    }
    timespan = str(args.get("timespan") or "").strip()
    if timespan:
        result["timespan"] = timespan
    return result


def _news_fallback_args(args: dict[str, Any]) -> dict[str, Any] | None:
    keywords = _normalize_query(str(_first_nonempty(args.get("keywords"), args.get("query"))))
    if not keywords:
        return None
    return {
        "keywords": keywords,
        "max_results": _coerce_positive_int(args.get("max_results"), 10),
        "region": str(args.get("region") or "wt-wt").strip() or "wt-wt",
    }


_FALLBACK_ARG_BUILDERS = {
    "gdelt_doc_search": _gdelt_fallback_args,
    "news_search": _news_fallback_args,
}


def _next_fallback_call(
    call: dict[str, Any],
    current_tool_name: str,
    tool_history: set[str],
    tool_calls_used: int,
) -> tuple[dict[str, Any] | None, int]:
    for attempt, fallback_name in enumerate(
        AUTO_FALLBACK_TOOL_ORDER.get(current_tool_name, ()), start=1
    ):
        candidate = _build_fallback_tool_call(call, fallback_name, attempt=attempt)
        if candidate is None:
            continue
        key = _tool_call_key(candidate)
        if key in tool_history:
            continue
        if tool_calls_used >= MAX_TOOL_CALLS_PER_SESSION:
            return None, tool_calls_used
        tool_history.add(key)
        return candidate, tool_calls_used + 1
    return None, tool_calls_used


def _internal_db_matches(query: str, top_k: int) -> list[dict[str, Any]]:
    try:
        return _run_async_blocking(_search_internal_news_from_db(query, top_k))
    except Exception as exc:
        logger.warning("Internal DB search failed: %s", exc)
        return []


def _internal_cache_matches(query_terms: list[str], top_k: int) -> list[dict[str, Any]]:
    scored = [
        (sum(term in _article_search_text(article) for term in query_terms), article)
        for article in _news_articles_cache
    ]
    ranked = sorted(
        (entry for entry in scored if entry[0]), key=lambda entry: entry[0], reverse=True
    )
    return [article for _score, article in ranked[:top_k]]


def _article_search_text(article: dict[str, Any]) -> str:
    return " ".join(
        str(article.get(field) or "") for field in ("title", "summary", "description", "content")
    ).lower()


def _internal_result_payload(article: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": article.get("title"),
        "source": article.get("source"),
        "url": _first_nonempty(article.get("url"), article.get("link")),
        "published": article.get("published"),
        "summary": _first_nonempty(article.get("summary"), article.get("description")),
        "provider": "internal",
        "result_type": "internal",
    }


def _article_fetch_output(url: str, result: dict[str, Any]) -> str:
    if "error" in result:
        return f"Error fetching {url}: {result['error']}"
    text = str(result.get("text", ""))
    preview = text[:8000]
    fallback = _build_external_reference(
        url=url,
        title=str(result.get("title") or "Untitled"),
        source=str(
            _first_nonempty(
                result.get("source"), result.get("publisher"), default="External source"
            )
        ),
        summary=preview[:1200],
        published=str(result.get("publish_date") or ""),
        image=str(result.get("top_image") or "") or None,
    )
    _track_reference_by_url(url, fallback)
    return f"Title: {result.get('title', 'Untitled')}\nContent: {preview}"


def _normalize_rag_documents(documents: Any) -> list[dict[str, Any]] | None:
    if not isinstance(documents, str):
        return documents
    try:
        parsed = json.loads(documents)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


def _index_rag_document(store: Any, document: dict[str, Any], index: int) -> int:
    content = _first_nonempty(document.get("content"), document.get("text"))
    if not content:
        return 0
    metadata = document.get("metadata", {})
    title = _first_nonempty(
        metadata.get("title"), document.get("title"), default="External Article"
    )
    unique_key = _first_nonempty(
        metadata.get("url"), default=f"rag_{int(datetime.now(UTC).timestamp())}_{index}"
    )
    success = store.add_article(
        article_id=str(unique_key),
        title=title,
        summary=content[:500],
        content=content,
        metadata=metadata,
    )
    return int(bool(success))


def _external_search_block_reason(
    tool_name: str,
    *,
    internal_search_done: bool,
    internal_search_succeeded: bool,
    internal_fetch_calls_done: int,
    required_internal_fetches: int,
) -> str | None:
    if tool_name not in EXTERNAL_SEARCH_TOOLS:
        return None
    if not internal_search_done:
        return "Use search_internal_news first. Check the internal archive before using external search."
    if internal_search_succeeded and internal_fetch_calls_done < required_internal_fetches:
        return "Internal search found relevant archive coverage. Read the internal article URLs with fetch_article_content before using external search."
    return None


def _tool_block_reason(
    call: dict[str, Any],
    *,
    key: str,
    tool_history: set[str],
    search_query_keys: set[str],
    tool_calls_used: int,
    internal_search_done: bool,
    internal_search_succeeded: bool,
    internal_fetch_calls_done: int,
    required_internal_fetches: int,
) -> str | None:
    tool_name = str(call.get("name", "unknown_tool"))
    if key in tool_history:
        logger.debug("dedup_tool_node: duplicate call key=%s", key)
        return "Already called with the same arguments; use prior results already in context."
    query = _extract_search_query(call) if tool_name in SEARCH_TOOLS_WITH_QUERY else None
    if query and _search_queries_similar(query, search_query_keys):
        logger.info("dedup_tool_node: similar query blocked tool=%s query=%s", tool_name, query)
        return f"A very similar search query was already run. Reuse prior search results in context instead of repeating {query}."
    if tool_calls_used >= MAX_TOOL_CALLS_PER_SESSION:
        logger.warning(
            "dedup_tool_node: session cap hit (%d), blocking call to %s",
            MAX_TOOL_CALLS_PER_SESSION,
            tool_name,
        )
        return f"Tool call limit reached ({MAX_TOOL_CALLS_PER_SESSION} unique calls per session). Synthesize a final answer from the context already gathered."
    return _external_search_block_reason(
        tool_name,
        internal_search_done=internal_search_done,
        internal_search_succeeded=internal_search_succeeded,
        internal_fetch_calls_done=internal_fetch_calls_done,
        required_internal_fetches=required_internal_fetches,
    )


def _tool_dedup_context(state: AgentState) -> dict[str, Any]:
    last_msg = state["messages"][-1]
    tool_history = set(state.get("tool_history", set()))
    internal_succeeded, current_hits = _collect_internal_search_state(state.get("messages", []))
    return {
        "tool_calls": getattr(last_msg, "tool_calls", None) or [],
        "tool_history": tool_history,
        "tool_calls_used": int(state.get("tool_calls_used", 0)),
        "internal_search_done": any(
            key.startswith("search_internal_news:") for key in tool_history
        ),
        "internal_search_succeeded": internal_succeeded,
        "internal_fetch_calls_done": _count_internal_fetches_done(tool_history),
        "search_query_keys": {
            key.removeprefix("search_query:")
            for key in tool_history
            if key.startswith("search_query:")
        },
        "required_internal_fetches": _required_internal_fetches_for_state(
            internal_search_succeeded=internal_succeeded, current_message_internal_hits=current_hits
        ),
    }


def _accept_tool_call(call: dict[str, Any], context: dict[str, Any]) -> ToolMessage | None:
    key = _tool_call_key(call)
    block = _dedup_block_message(
        call,
        key=key,
        tool_history=context["tool_history"],
        search_query_keys=context["search_query_keys"],
        tool_calls_used=context["tool_calls_used"],
        internal_search_done=context["internal_search_done"],
        internal_search_succeeded=context["internal_search_succeeded"],
        internal_fetch_calls_done=context["internal_fetch_calls_done"],
        required_internal_fetches=context["required_internal_fetches"],
    )
    if block is not None:
        return block
    context["tool_history"].add(key)
    context["tool_calls_used"] += 1
    if _is_internal_fetch_call(call):
        context["internal_fetch_calls_done"] += 1
    query = _extract_search_query(call)
    if query:
        context["tool_history"].add(f"search_query:{query}")
        context["search_query_keys"].add(query)
    return None


def _execute_unique_tool_calls(
    state: AgentState, calls: list[dict[str, Any]], tool_history: set[str], tool_calls_used: int
) -> tuple[list[ToolMessage], int]:
    results: list[ToolMessage] = []
    for call in calls:
        if _is_stopped():
            break
        messages, tool_calls_used = _execute_tool_call_with_fallbacks(
            state, call, tool_history, tool_calls_used
        )
        results.extend(messages)
    return results, tool_calls_used


def _base_model_result(state: AgentState) -> tuple[set[str], int]:
    return set(state.get("tool_history", set())), int(state.get("tool_calls_used", 0))


def _cancelled_model_result(state: AgentState) -> dict[str, Any]:
    history, used = _base_model_result(state)
    return {
        "messages": [AIMessage(content="Research cancelled.")],
        "iteration": state.get("iteration", 0),
        "mode": "final",
        "tool_history": history,
        "tool_calls_used": used,
    }


def _final_model_messages(state: AgentState) -> list[Any]:
    messages = list(state["messages"])
    last_user = next(
        (
            str(message.content)
            for message in reversed(messages)
            if isinstance(message, HumanMessage)
        ),
        "",
    )
    snippets = [
        _extract_text_from_message(message).strip()
        if isinstance(message, AIMessage)
        else str(message.content)
        for message in messages
        if isinstance(message, (AIMessage, HumanMessage))
    ]
    context_blob = "\n\n".join(snippet for snippet in snippets[-6:] if snippet)
    return [
        SystemMessage(content=_finalizer_system_prompt()),
        HumanMessage(
            content=(
                "Return the final response with a section titled 'Answer'. Use the context provided.\n\n"
                f"Question: {last_user}\n\nContext:\n{context_blob}"
            )
        ),
    ]


def _call_final_model(state: AgentState) -> dict[str, Any]:
    history, used = _base_model_result(state)
    response = _invoke_with_llamacpp_recovery(
        lambda payload: _get_llm().invoke(payload),
        _final_model_messages(state),
        "final mode invoke",
    )
    return {
        "messages": [response],
        "iteration": state.get("iteration", 0),
        "mode": "final",
        "tool_history": history,
        "tool_calls_used": used,
    }


def _call_tool_router(state: AgentState) -> dict[str, Any]:
    history, used = _base_model_result(state)
    messages = _replace_system_message(state["messages"], _tool_router_system_prompt())
    response = _invoke_with_llamacpp_recovery(
        lambda payload: _get_tool_router().invoke(payload), messages, "tool router invoke"
    )
    has_calls = isinstance(response, AIMessage) and bool(getattr(response, "tool_calls", None))
    return {
        "messages": [response],
        "iteration": state.get("iteration", 0) + 1,
        "mode": "research" if has_calls else "final_pending",
        "tool_history": history,
        "tool_calls_used": used,
    }


def _call_research_model(state: AgentState) -> dict[str, Any]:
    history, used = _base_model_result(state)
    response = _invoke_with_llamacpp_recovery(
        lambda payload: _get_model().invoke(payload), state["messages"], "research invoke"
    )
    iteration = state.get("iteration", 0) + 1
    mode = _next_research_mode(response, iteration)
    return {
        "messages": [response],
        "iteration": iteration,
        "mode": mode,
        "tool_history": history,
        "tool_calls_used": used,
    }


def _next_research_mode(response: Any, iteration: int) -> str:
    if iteration >= MAX_ITERATIONS:
        return "final_pending"
    if not isinstance(response, AIMessage):
        return "research"
    content = _extract_text_from_message(response)
    return (
        "tool_router"
        if _needs_final_answer(content) and not getattr(response, "tool_calls", None)
        else "research"
    )


def _context_snippet_line(article: dict[str, Any]) -> str:
    title = _first_nonempty(article.get("title"), default="Untitled")
    source = _first_nonempty(article.get("source"), default="Unknown")
    url = _first_nonempty(article.get("url"), article.get("link"))
    summary = _first_nonempty(
        article.get("context_snippet"),
        article.get("sentence"),
        article.get("summary"),
        article.get("description"),
    )
    published = article.get("published") or ""
    provider = article.get("provider") or ""
    provider_suffix = f" [{provider}]" if provider else ""
    return f"- {title} ({source}){provider_suffix} {published}\n  {url}\n  {summary}"


def _run_research_graph(
    query: str, chat_history: list[dict[str, str]] | None
) -> tuple[str, list[dict[str, Any]], list[str]]:
    initial_state: AgentState = {
        "messages": _build_initial_messages(query, chat_history),
        "iteration": 0,
        "mode": "research",
        "tool_history": set(),
        "tool_calls_used": 0,
    }
    thinking_steps: list[dict[str, Any]] = []
    tool_snippets: list[str] = []
    logged_tool_calls: set[str] = set()
    final_answer = ""
    for update in _get_graph().stream(initial_state, stream_mode="updates"):
        content, steps = _research_update(update, logged_tool_calls, tool_snippets)
        if content is not None:
            final_answer = content
        thinking_steps.extend(steps)
    return final_answer, thinking_steps, tool_snippets


def _research_update(
    update: dict[str, Any], logged: set[str], tool_snippets: list[str]
) -> tuple[str | None, list[dict[str, Any]]]:
    if "agent" in update:
        content, steps = _agent_update_steps(update, logged)
        return content, steps
    if "tools" in update:
        return None, _tool_update_events(update, tool_snippets)
    return None, []


def _resolve_referenced_articles(final_answer: str) -> list[dict[str, Any]]:
    referenced = list(_referenced_articles_tracker)
    return referenced or (_match_articles_in_text(final_answer) if final_answer else [])


def _ensure_supported_final_answer(
    query: str, answer: str, referenced: list[dict[str, Any]], tool_snippets: list[str]
) -> str:
    should_finalize = _needs_final_answer(answer) or bool(
        referenced and _answer_denies_available_context(answer)
    )
    if not should_finalize:
        return answer
    synthesized = _finalize_answer(query, referenced, tool_snippets)
    return synthesized or answer


def _structured_articles_block(
    query: str, referenced: list[dict[str, Any]], providers: list[str]
) -> str:
    if not referenced:
        return ""
    payload = {
        "articles": referenced,
        "total": len(referenced),
        "query": query,
        "source_providers": providers,
    }
    return f"\n```json:articles\n{json.dumps(payload, indent=2)}\n```\n"


def _track_reference(article: dict[str, Any]) -> None:
    if not article:
        return
    if any(_same_article_reference(article, existing) for existing in _referenced_articles_tracker):
        return
    _referenced_articles_tracker.append(article)


def _track_reference_by_url(url: str, fallback: dict[str, Any] | None = None) -> None:
    normalized = _normalize_url(url)
    if normalized:
        article = _articles_by_id.get(normalized)
        if article:
            _track_reference(article)
            return
    if fallback:
        _track_reference(fallback)


def _build_external_reference(
    *,
    url: str,
    title: str,
    source: str = "External source",
    summary: str = "",
    published: str = "",
    image: str | None = None,
    provider: str | None = None,
    context_snippet: str | None = None,
    sentence: str | None = None,
    result_type: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": _normalize_url(url) or url,
        "url": url,
        "link": url,
        "title": title or "Untitled",
        "source": source or "External source",
        "summary": summary,
        "description": summary,
        "published": published,
        "image": image,
        "provider": provider,
        "context_snippet": context_snippet,
        "sentence": sentence,
        "result_type": result_type,
        "category": "external",
    }
    return {key: value for key, value in payload.items() if value not in (None, "")}


def _first_value(item: dict[str, Any], keys: Sequence[str], default: str = "") -> str:
    for key in keys:
        value = item.get(key)
        if value:
            return str(value)
    return default


def _track_search_result_reference(item: dict[str, Any], provider_hint: str | None) -> None:
    url = _first_value(item, ("url", "link")).strip()
    if not url:
        return
    title = _first_value(item, ("title", "headline"), "Untitled")
    source = _first_value(item, ("source", "provider"), "External source")
    summary = _first_value(item, ("summary", "body", "snippet"))
    published = _first_value(item, ("published", "date", "published_at"))
    image = item.get("image")
    provider = str(item.get("provider") or provider_hint or "").strip().lower() or None
    context_snippet = _first_value(item, ("context_snippet",)).strip() or None
    sentence = _first_value(item, ("sentence",)).strip() or None
    result_type = _first_value(item, ("result_type",)).strip() or None
    _record_research_source_provider(provider)
    fallback = _build_external_reference(
        url=url,
        title=title,
        source=source,
        summary=summary,
        published=published,
        image=image if isinstance(image, str) else None,
        provider=provider,
        context_snippet=context_snippet,
        sentence=sentence,
        result_type=result_type,
    )
    _track_reference_by_url(url, fallback)


def _track_search_result_references(tool_name: str, content: str) -> None:
    if tool_name not in _TRACKED_SEARCH_TOOLS:
        return
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return
    if not isinstance(payload, list):
        return
    provider_hint = _SEARCH_PROVIDER_HINTS.get(tool_name)
    for item in payload[:5]:
        if isinstance(item, dict):
            _track_search_result_reference(item, provider_hint)


def _is_internal_article(article: dict[str, Any]) -> bool:
    retrieval_method = str(article.get("retrieval_method") or "")
    if retrieval_method in {
        "keyword_postgres",
        "recent_postgres",
        "semantic_vector_store",
    }:
        return True

    article_id = article.get("id") or article.get("article_id")
    if article_id is not None and str(article_id) in _articles_by_id:
        return True

    normalized = _normalize_url(article.get("url") or article.get("link"))
    return bool(normalized and normalized in _articles_by_id)


def _count_internal_references() -> int:
    return sum(1 for article in _referenced_articles_tracker if _is_internal_article(article))


def _normalize_query(query: str) -> str:
    return query.strip()


def _normalize_ddg_result(
    item: dict[str, Any],
    *,
    provider: str,
    result_type: str,
) -> dict[str, Any] | None:
    url = _first_value(item, ("url", "link")).strip()
    if not url:
        return None
    summary = _first_value(item, ("summary", "body", "snippet", "description")).strip()
    context_snippet = _first_value(item, ("context_snippet",)).strip() or None
    sentence = _first_value(item, ("sentence",)).strip() or None
    result: dict[str, Any] = {
        "id": _normalize_url(url) or url,
        "url": url,
        "link": url,
        "title": _first_value(item, ("title", "headline"), "Untitled").strip(),
        "source": _first_value(item, ("source", "publisher"), "External source").strip(),
        "summary": summary,
        "description": summary,
        "published": _first_value(item, ("published", "date", "published_at")).strip(),
        "image": item.get("image") if isinstance(item.get("image"), str) else None,
        "provider": provider,
        "result_type": result_type,
        "category": "external",
        "context_snippet": context_snippet or summary or None,
        "sentence": sentence,
    }
    return {key: value for key, value in result.items() if value not in (None, "")}


def _dedupe_search_results(
    *result_groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in (item for group in result_groups for item in group):
        key = _search_result_key(item)
        if key is None or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _search_gdelt_context(
    query: str,
    *,
    max_results: int = 10,
    timespan: str = GDELT_DEFAULT_TIMESPAN,
) -> list[dict[str, Any]]:
    service = get_gdelt_query_service()
    results = _run_async_blocking(
        service.search_context(
            query,
            max_records=max_results,
            timespan=timespan,
        )
    )
    return list(results or [])


def _search_gdelt_doc(
    query: str,
    *,
    max_results: int = 10,
    timespan: str = GDELT_DEFAULT_TIMESPAN,
) -> list[dict[str, Any]]:
    service = get_gdelt_query_service()
    results = _run_async_blocking(
        service.search_doc(
            query,
            max_records=max_results,
            timespan=timespan,
        )
    )
    return list(results or [])


def _search_gdelt_current_news(
    query: str,
    *,
    max_results: int = 10,
    timespan: str = GDELT_DEFAULT_TIMESPAN,
) -> list[dict[str, Any]]:
    context_results = _search_gdelt_context(
        query,
        max_results=max_results,
        timespan=timespan,
    )
    doc_results: list[dict[str, Any]] = []
    if len(context_results) < max_results:
        doc_results = _search_gdelt_doc(
            query,
            max_results=max_results,
            timespan=timespan,
        )
    return _dedupe_search_results(context_results, doc_results)[:max_results]


def _internal_search_found_results(content: str) -> bool:
    text = content.strip()
    if not text:
        return False
    known_empty_responses = {
        "No cached articles available for internal search.",
        "Query too vague for internal search.",
        "No relevant articles found in cache.",
        "No relevant articles found in internal archive.",
    }
    if text in known_empty_responses:
        return False
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return bool(text)
    return isinstance(payload, list) and len(payload) > 0


def _is_internal_fetch_call(call: dict[str, Any]) -> bool:
    if str(call.get("name", "")) != "fetch_article_content":
        return False
    args = call.get("args", {})
    if not isinstance(args, dict):
        return False
    normalized = _normalize_url(args.get("url"))
    if not normalized:
        return False
    article = _articles_by_id.get(normalized)
    return bool(article and _is_internal_article(article))


def _required_internal_fetches_for_state(
    *, internal_search_succeeded: bool, current_message_internal_hits: int
) -> int:
    if not internal_search_succeeded:
        return 0
    internal_reference_count = max(_count_internal_references(), current_message_internal_hits)
    if internal_reference_count <= 0:
        return 0
    return min(2, internal_reference_count)


def _should_auto_fallback_tool_result(tool_name: str, content: Any) -> bool:
    text = _content_to_text(content).strip()
    if tool_name == "gdelt_context_search":
        return (
            not text
            or text == "No results found."
            or text.startswith("GDELT context search failed:")
        )
    if tool_name == "gdelt_doc_search":
        return (
            not text or text == "No results found." or text.startswith("GDELT doc search failed:")
        )
    return False


def _coerce_positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _build_fallback_tool_call(
    call: dict[str, Any],
    fallback_tool_name: str,
    *,
    attempt: int,
) -> dict[str, Any] | None:
    args = call.get("args", {})
    if not isinstance(args, dict):
        return None
    builder = _FALLBACK_ARG_BUILDERS.get(fallback_tool_name)
    if builder is None:
        return None
    fallback_args = builder(args)
    if fallback_args is None:
        return None
    base_id = str(call.get("id", "tool-fallback"))
    return {
        "id": f"{base_id}__fallback__{attempt}__{fallback_tool_name}",
        "name": fallback_tool_name,
        "args": fallback_args,
    }


def _invoke_tool_calls(
    state: AgentState,
    tool_calls: Sequence[dict[str, Any]],
) -> list[ToolMessage]:
    if not tool_calls:
        return []
    trimmed = AIMessage(content="", tool_calls=list(tool_calls))
    trimmed_state = {**state, "messages": [*state["messages"][:-1], trimmed]}
    tool_results = ToolNode(list(_tools_by_name.values())).invoke(trimmed_state)
    return list(tool_results.get("messages", []))


def _execute_tool_call_with_fallbacks(
    state: AgentState,
    call: dict[str, Any],
    tool_history: set[str],
    tool_calls_used: int,
) -> tuple[list[ToolMessage], int]:
    current_call = call
    while True:
        tool_messages = _invoke_tool_calls(state, [current_call])
        if not tool_messages:
            return [], tool_calls_used
        current_name = str(current_call.get("name", "unknown_tool"))
        if not _should_auto_fallback_tool_result(current_name, tool_messages[0].content):
            return tool_messages, tool_calls_used
        fallback_call, tool_calls_used = _next_fallback_call(
            current_call, current_name, tool_history, tool_calls_used
        )
        if fallback_call is None:
            return tool_messages, tool_calls_used
        logger.info("Auto-fallback research tool %s -> %s", current_name, fallback_call["name"])
        current_call = fallback_call


@tool
def search_internal_news(query: str, top_k: int = 5) -> str:
    """Search internal news with database-first fallback to cached articles."""
    query = _normalize_query(query)
    query_terms = _extract_query_terms(query)
    if not query_terms:
        return "Query too vague for internal search."
    db_matches = _internal_db_matches(query, top_k)
    matches = db_matches or _internal_cache_matches(query_terms, top_k)
    if not matches:
        return "No relevant articles found in internal archive."
    _record_research_source_provider("internal")
    for match in matches:
        _register_article_lookup(match)
        _track_reference(match)
    return json.dumps([_internal_result_payload(article) for article in matches], indent=2)


@tool
def gdelt_context_search(
    query: str,
    max_results: int = 10,
    timespan: str = GDELT_DEFAULT_TIMESPAN,
) -> str:
    """Search GDELT Context 2.0 for current-event snippets."""
    query = _normalize_query(query)
    if not query:
        return "Query too vague for GDELT search."
    try:
        results = _search_gdelt_context(
            query,
            max_results=max_results,
            timespan=timespan,
        )
        if not results:
            return "No results found."
        _record_research_source_provider("gdelt")
        return json.dumps(results[:max_results], indent=2)
    except Exception as exc:
        logger.warning("GDELT context search failed: %s", exc)
        return f"GDELT context search failed: {exc}"


@tool
def gdelt_doc_search(
    query: str,
    max_results: int = 10,
    timespan: str = GDELT_DEFAULT_TIMESPAN,
) -> str:
    """Search GDELT DOC 2.0 for current-event articles."""
    query = _normalize_query(query)
    if not query:
        return "Query too vague for GDELT search."
    try:
        results = _search_gdelt_doc(
            query,
            max_results=max_results,
            timespan=timespan,
        )
        if not results:
            return "No results found."
        _record_research_source_provider("gdelt")
        return json.dumps(results[:max_results], indent=2)
    except Exception as exc:
        logger.warning("GDELT doc search failed: %s", exc)
        return f"GDELT doc search failed: {exc}"


@tool
def web_search(query: str, num_results: int = 10) -> str:
    """Perform general web search for recent context."""
    if DDGS is None:
        logger.warning("Web search skipped: ddgs dependency is unavailable")
        return "No results found."
    try:
        ddgs_client = cast(Any, DDGS)()
        text_search_fn = ddgs_client.text
        results: list[dict[str, Any]] = []
        for item in text_search_fn(query, max_results=num_results):
            normalized = _normalize_ddg_result(
                cast(dict[str, Any], item),
                provider="duckduckgo",
                result_type="web",
            )
            if normalized is not None:
                results.append(normalized)
        if results:
            _record_research_source_provider("duckduckgo")
        return json.dumps(results[:num_results], indent=2) if results else "No results found."
    except Exception as exc:  # pragma: no cover - network errors
        logger.warning("Web search failed: %s", exc)
        return f"Web search failed: {exc}"


@tool
def news_search(keywords: str, max_results: int = 10, region: str = "wt-wt") -> str:
    """Search GDELT first and fall back to DuckDuckGo news for current stories."""
    keywords = _normalize_query(keywords)
    if not keywords:
        return "Query too vague for news search."
    try:
        gdelt_results = _search_gdelt_current_news(
            keywords,
            max_results=max_results,
        )
        if gdelt_results:
            _record_research_source_provider("gdelt")
            return json.dumps(gdelt_results[:max_results], indent=2)
    except Exception as exc:
        logger.warning("GDELT news search failed: %s", exc)

    try:
        if DDGS is None:
            logger.warning("News search skipped: ddgs dependency is unavailable")
            return "No results found."
        ddgs_client = cast(Any, DDGS)()
        news_search_fn = ddgs_client.news
        results: list[dict[str, Any]] = []
        for item in news_search_fn(keywords, max_results=max_results, region=region):
            normalized = _normalize_ddg_result(
                cast(dict[str, Any], item),
                provider="duckduckgo",
                result_type="news",
            )
            if normalized is not None:
                results.append(normalized)
        if results:
            _record_research_source_provider("duckduckgo")
        return json.dumps(results[:max_results], indent=2) if results else "No results found."
    except Exception as exc:  # pragma: no cover - network errors
        logger.warning("News search failed: %s", exc)
        return f"News search failed: {exc}"


@tool
def fetch_article_content(url: str) -> str:
    """Fetch and clean article content from the provided URL."""
    normalized = _normalize_url(url)
    cached = _fetched_urls_cache.get(normalized) if normalized else None
    if cached is not None:
        logger.debug("fetch_article_content cache hit: %s", normalized)
        return cached
    result = extract_article_content(url)
    out = _article_fetch_output(url, result)
    if normalized:
        _fetched_urls_cache[normalized] = out
    logger.debug("fetch_article_content fetched: %s", normalized)
    return out


@tool
def rag_index_documents(documents: list[dict[str, Any]]) -> str:
    """Persist fresh documents into the vector store for future internal search."""
    normalized = _normalize_rag_documents(documents)
    if normalized is None:
        return "Invalid documents payload."
    store = get_vector_store()
    if not store:
        return "Vector store is disabled or unavailable."
    added = sum(
        _index_rag_document(store, document, index) for index, document in enumerate(normalized)
    )
    return f"Successfully indexed {added} documents." if added else "No documents were indexed."


tools = [
    search_internal_news,
    gdelt_context_search,
    gdelt_doc_search,
    web_search,
    news_search,
    fetch_article_content,
    rag_index_documents,
]


def _tool_router_system_prompt() -> str:
    return build_text_system_prompt(
        role="research tool planner",
        task=(
            "Decide which tools to use for the query. Always use "
            "search_internal_news first. If it returns relevant internal articles, "
            "read those internal URLs with fetch_article_content before any external "
            "search. For current events, prefer gdelt_context_search, then "
            "gdelt_doc_search, and use news_search only when GDELT does not answer "
            "the question. Prefer context snippets before full article fetches when "
            "possible. Use web_search or news_search only after internal coverage "
            "has been checked and found insufficient."
        ),
        grounding_rules=FACT_GROUNDING_RULES,
        output_rules=ANSWER_SECTION_RULE,
    )


_llm_instance: ToolBindableLLM | None = None
_model_instance: RunnableMessageInvoker | None = None
_tool_router_instance: RunnableMessageInvoker | None = None
_graph_instance: CompiledAgentGraph | None = None


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
    if any(
        term in message
        for term in (
            "jinja",
            "chat template",
            "template error",
            "system message must be",
            "conversation roles must alternate",
        )
    ):
        return True
    return "invalid_request_error" in message and "model" in message and "not found" in message


def _coalesce_assistant_runs(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
    collapsed: list[BaseMessage] = []
    for message in messages:
        if collapsed and isinstance(message, AIMessage) and isinstance(collapsed[-1], AIMessage):
            collapsed[-1] = message
        else:
            collapsed.append(message)
    return collapsed


def _trim_trailing_assistant_runs(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
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
) -> list[BaseMessage]:
    if settings.llm_backend != "llamacpp":
        return list(messages)
    trimmed = _trim_trailing_assistant_runs(_coalesce_assistant_runs(messages))
    system_messages: list[SystemMessage] = []
    non_system: list[BaseMessage] = []
    for message in trimmed:
        if isinstance(message, SystemMessage):
            system_messages.append(message)
        else:
            non_system.append(message)
    return [*system_messages, *non_system]


def _replace_system_message(
    messages: Sequence[BaseMessage],
    system_content: str,
) -> list[BaseMessage]:
    return [
        SystemMessage(content=system_content),
        *[message for message in messages if not isinstance(message, SystemMessage)],
    ]


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


def _get_llm() -> ToolBindableLLM:
    global _llm_instance
    if _llm_instance is None:
        if settings.llm_backend == "llamacpp":
            _llm_instance = cast(
                ToolBindableLLM,
                ChatOpenAI(
                    model=get_llamacpp_model(),
                    temperature=0.2,
                    api_key=SecretStr(settings.llamacpp_api_key),
                    base_url=settings.llamacpp_base_url,
                ),
            )
        elif settings.llm_backend == "opencode" and settings.opencode_api_key:
            _llm_instance = cast(
                ToolBindableLLM,
                ChatOpenAI(
                    model=settings.opencode_model,
                    temperature=0.2,
                    api_key=SecretStr(settings.opencode_api_key),
                    base_url=settings.opencode_base_url,
                ),
            )
        elif settings.open_router_api_key:
            _llm_instance = cast(
                ToolBindableLLM,
                ChatOpenAI(
                    model=settings.open_router_model,
                    temperature=0.2,
                    api_key=SecretStr(settings.open_router_api_key),
                    base_url="https://openrouter.ai/api/v1",
                ),
            )
        else:
            _llm_instance = cast(
                ToolBindableLLM,
                ChatGoogleGenerativeAI(
                    model=settings.gemini_model,
                    temperature=0.2,
                    max_retries=2,
                ),
            )
    return _llm_instance


def _get_model() -> RunnableMessageInvoker:
    global _model_instance
    if _model_instance is None:
        llm = _get_llm()
        if settings.llm_backend == "llamacpp":
            try:
                _model_instance = llm.bind_tools(tools, parallel_tool_calls=False)
            except TypeError:
                logger.warning(
                    "parallel_tool_calls is unsupported by this backend; using default tool binding"
                )
                _model_instance = llm.bind_tools(tools)
        else:
            _model_instance = llm.bind_tools(tools)
    return _model_instance


def _get_tool_router() -> RunnableMessageInvoker:
    global _tool_router_instance
    if _tool_router_instance is None:
        llm = _get_llm()
        if settings.llm_backend == "llamacpp":
            try:
                _tool_router_instance = llm.bind_tools(
                    tools,
                    tool_choice="required",
                    parallel_tool_calls=False,
                )
            except TypeError:
                logger.warning(
                    "parallel_tool_calls is unsupported by this backend; using default required tool binding"
                )
                _tool_router_instance = llm.bind_tools(tools, tool_choice="required")
        else:
            _tool_router_instance = llm.bind_tools(tools, tool_choice="required")
    return _tool_router_instance


_tools_by_name = {t.name: t for t in tools}


def _internal_search_hit_count(content: str) -> int:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, list):
        return len(payload)
    return 0


def _collect_internal_search_state(messages: Sequence[BaseMessage]) -> tuple[bool, int]:
    internal_search_succeeded = False
    current_message_internal_hits = 0
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        tool_name = str(getattr(message, "name", "") or "")
        content = _content_to_text(message.content)
        if tool_name == "search_internal_news" and _internal_search_found_results(content):
            internal_search_succeeded = True
            current_message_internal_hits = max(
                current_message_internal_hits,
                _internal_search_hit_count(content),
            )
    return internal_search_succeeded, current_message_internal_hits


def _count_internal_fetches_done(tool_history: set[str]) -> int:
    fetch_calls_done = 0
    for key in tool_history:
        if key.startswith("fetch_article_content:"):
            try:
                _tool_name, serialized_args = key.split(":", 1)
                args = json.loads(serialized_args)
            except (ValueError, json.JSONDecodeError):
                continue
            call = {"name": "fetch_article_content", "args": args}
            if _is_internal_fetch_call(call):
                fetch_calls_done += 1
    return fetch_calls_done


def _dedup_block_message(
    call: dict[str, Any],
    *,
    key: str,
    tool_history: set[str],
    search_query_keys: set[str],
    tool_calls_used: int,
    internal_search_done: bool,
    internal_search_succeeded: bool,
    internal_fetch_calls_done: int,
    required_internal_fetches: int,
) -> ToolMessage | None:
    tool_call_id = str(call.get("id", "missing-tool-call-id"))
    tool_name = str(call.get("name", "unknown_tool"))
    content = _tool_block_reason(
        call,
        key=key,
        tool_history=tool_history,
        search_query_keys=search_query_keys,
        tool_calls_used=tool_calls_used,
        internal_search_done=internal_search_done,
        internal_search_succeeded=internal_search_succeeded,
        internal_fetch_calls_done=internal_fetch_calls_done,
        required_internal_fetches=required_internal_fetches,
    )
    if content is None:
        return None
    return ToolMessage(content=content, tool_call_id=tool_call_id, name=tool_name)


def _dedup_tool_node(state: AgentState) -> dict[str, Any]:
    """Deduplicate and policy-check tool calls before execution."""
    context = _tool_dedup_context(state)
    blocked: list[ToolMessage] = []
    unique_calls: list[dict[str, Any]] = []
    for call in context["tool_calls"]:
        block = _accept_tool_call(call, context)
        if block is None:
            unique_calls.append(call)
        else:
            blocked.append(block)
    executed, tool_calls_used = _execute_unique_tool_calls(
        state, unique_calls, context["tool_history"], context["tool_calls_used"]
    )
    return {
        "messages": executed + blocked,
        "tool_history": context["tool_history"],
        "tool_calls_used": tool_calls_used,
    }


def _get_graph() -> CompiledAgentGraph:
    global _graph_instance
    if _graph_instance is None:
        builder = StateGraph(AgentState)
        builder.add_node("agent", call_model)
        builder.add_node("tools", _dedup_tool_node)
        builder.add_edge(START, "agent")
        builder.add_edge("tools", "agent")
        builder.add_conditional_edges(
            "agent",
            should_continue,
            {"tools": "tools", "agent": "agent", END: END},
        )
        _graph_instance = cast(CompiledAgentGraph, builder.compile())
    return _graph_instance


class AgentState(TypedDict):
    """Agent State."""

    messages: Annotated[Sequence[BaseMessage], add_messages]
    iteration: int
    mode: str
    tool_history: set[str]
    tool_calls_used: int


def call_model(state: AgentState) -> dict[str, Any]:
    """Invoke the model appropriate for the current agent mode."""
    if _is_stopped():
        return _cancelled_model_result(state)
    mode = state.get("mode", "research")
    if mode in {"final", "final_pending"}:
        return _call_final_model(state)
    if mode == "tool_router":
        return _call_tool_router(state)
    return _call_research_model(state)


def _extract_text_from_message(message: BaseMessage) -> str:
    if isinstance(message, AIMessage):
        return _content_to_text(message.content)
    if isinstance(message, HumanMessage):
        return str(message.content)
    return _content_to_text(getattr(message, "content", ""))


def should_continue(state: AgentState) -> str:
    """Should Continue."""
    if state.get("mode") == "tool_router":
        return "agent"
    if state.get("mode") == "final":
        return END
    if state.get("mode") == "final_pending":
        return "agent"
    last_message = state["messages"][-1]
    if isinstance(last_message, AIMessage) and getattr(last_message, "tool_calls", None):
        return "tools"
    return END


def _build_initial_messages(
    query: str, chat_history: list[dict[str, str]] | None = None
) -> list[BaseMessage]:
    system_message = SystemMessage(content=_system_prompt())
    history_messages: list[BaseMessage] = []
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


def _match_articles_in_text(answer_text: str) -> list[dict[str, Any]]:
    pattern = r"https?://[^\s)]+"
    matches = re.findall(pattern, answer_text)
    resolved: list[dict[str, Any]] = []
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


def _answer_denies_available_context(answer_text: str) -> bool:
    lower_content = answer_text.strip().lower()
    if not lower_content:
        return False
    return any(phrase in lower_content for phrase in DENIAL_PHRASES)


def _build_context_snippet(referenced_articles: list[dict[str, Any]]) -> str:
    return "\n".join(_context_snippet_line(article) for article in referenced_articles[:8])


def _build_tool_evidence_snippet(tool_snippets: list[str]) -> str:
    if not tool_snippets:
        return ""
    evidence_lines: list[str] = []
    for index, snippet in enumerate(tool_snippets[:6], start=1):
        compact = snippet.strip()
        if not compact:
            continue
        evidence_lines.append(f"Evidence {index}:\n{compact[:1800]}")
    return "\n\n".join(evidence_lines)


def _finalize_answer(
    query: str,
    referenced_articles: list[dict[str, Any]],
    tool_snippets: list[str],
) -> str:
    context = _build_context_snippet(referenced_articles)
    tool_context = _build_tool_evidence_snippet(tool_snippets)
    prompt_parts = [
        f"Question: {query}",
        (
            "Write a direct answer from the evidence below. If the evidence is mixed or "
            "incomplete, say what is confirmed and what remains unclear. Do not claim the "
            "context is missing if article excerpts or tool evidence are present. Cite the most "
            "relevant URLs inline."
        ),
        "Article references:",
        context or "No article context available.",
    ]
    if tool_context:
        prompt_parts.extend(["Extracted evidence:", tool_context])
    prompt_parts.append("Return the final response.")
    finalizer_messages: list[BaseMessage] = [
        SystemMessage(content=_finalizer_system_prompt()),
        HumanMessage(content="\n\n".join(prompt_parts)),
    ]
    try:
        # Bypass _invoke_with_llamacpp_recovery to avoid any message reordering.
        # The finalizer is always a clean [SystemMessage, HumanMessage] pair so
        # no coalescing or trimming is needed, and the system message must stay first.
        response = _get_llm().invoke(finalizer_messages)
        return _content_to_text(response.content).strip()
    except Exception as exc:
        logger.warning("Finalizer failed: %s", exc)
        return ""


def _sanitize_final_answer(answer_text: str) -> str:
    content = answer_text.strip()
    if _has_required_sections(content):
        return content
    if not content:
        content = "No answer found."
    return "Answer\n" + content + "\n"


def _agent_update_steps(
    update: dict[str, Any],
    logged_tool_calls: set[str],
) -> tuple[str, list[dict[str, Any]]]:
    agent_message = update["agent"]["messages"][-1]
    content = _content_to_text(agent_message.content)
    steps: list[dict[str, Any]] = [
        {
            "type": "thought",
            "content": content,
            "timestamp": datetime.now(UTC).isoformat(),
        }
    ]
    for tool_call in _iter_new_tool_calls(
        getattr(agent_message, "tool_calls", []) or [],
        logged_tool_calls,
    ):
        steps.append(
            {
                "type": "action",
                "content": f"Tool request: {tool_call['name']} {tool_call.get('args', {})}",
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
    return content, steps


def _tool_update_events(
    update: dict[str, Any],
    tool_snippets: list[str],
) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for tool_message in update["tools"]["messages"]:
        snippet = _content_to_text(tool_message.content)[:2000]
        tool_name = str(getattr(tool_message, "name", "") or "")
        steps.append(
            {
                "type": "observation",
                "content": snippet,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        if snippet:
            tool_snippets.append(snippet)
        if tool_name:
            _track_search_result_references(tool_name, snippet)
    return steps


def research_news(
    query: str,
    articles: list[dict[str, Any]] | None = None,
    verbose: bool = True,
    chat_history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Research news and return the synthesized answer plus evidence metadata."""
    _stop_events.event = None
    set_news_articles(articles)
    final_answer, thinking_steps, tool_snippets = _run_research_graph(query, chat_history)
    referenced_articles = _resolve_referenced_articles(final_answer)
    final_answer = _ensure_supported_final_answer(
        query, final_answer, referenced_articles, tool_snippets
    )
    final_answer = _sanitize_final_answer(final_answer)
    source_providers = sorted(_research_source_providers)
    structured_block = _structured_articles_block(query, referenced_articles, source_providers)
    result: dict[str, Any] = {
        "success": bool(final_answer),
        "query": query,
        "answer": final_answer,
        "structured_articles": structured_block,
        "thinking_steps": thinking_steps if verbose else [],
        "articles_searched": len(_news_articles_cache),
        "referenced_articles": referenced_articles,
        "source_providers": source_providers,
    }
    if structured_block and structured_block not in final_answer:
        result["answer"] += structured_block
    return result


def research_stream(
    query: str,
    articles: list[dict[str, Any]] | None = None,
    chat_history: list[dict[str, str]] | None = None,
    stop_event: threading.Event | None = None,
) -> Generator[str, None, None]:
    """Research Stream."""
    _stop_events.event = stop_event
    try:
        yield from _research_stream_impl(query, articles, chat_history, stop_event)
    finally:
        _stop_events.event = None


def _stream_event(payload: dict[str, Any]) -> str:
    return "data: " + json.dumps(payload) + "\n\n"


def _is_stopped_by(stop_event: threading.Event | None) -> bool:
    return stop_event is not None and stop_event.is_set()


def _stream_agent_update(
    update: dict[str, Any],
    accum: dict[str, Any],
    stop_event: threading.Event | None,
) -> Generator[str, None, None]:
    agent_message = update["agent"]["messages"][-1]
    content_text = _content_to_text(agent_message.content)
    if content_text:
        if _is_stopped_by(stop_event):
            return
        accum["final_answer"] = content_text
        yield _stream_event({"type": "thinking", "content": content_text})
    for tool_call in _iter_new_tool_calls(
        getattr(agent_message, "tool_calls", []) or [],
        accum["logged_tool_calls"],
    ):
        if _is_stopped_by(stop_event):
            return
        yield _stream_event(
            {
                "type": "tool_start",
                "tool": tool_call.get("name"),
                "args": tool_call.get("args", {}),
            }
        )


def _stream_tools_update(
    update: dict[str, Any],
    accum: dict[str, Any],
    stop_event: threading.Event | None,
) -> Generator[str, None, None]:
    for tool_message in update["tools"]["messages"]:
        if _is_stopped_by(stop_event):
            return
        snippet = _content_to_text(tool_message.content)[:2000]
        tool_name = str(getattr(tool_message, "name", "") or "")
        if snippet:
            accum["tool_snippets"].append(snippet)
        if tool_name:
            _track_search_result_references(tool_name, snippet)
        yield _stream_event({"type": "tool_result", "tool": tool_name, "content": snippet})


def _stream_graph_updates(
    initial_state: AgentState,
    stop_event: threading.Event | None,
    accum: dict[str, Any],
) -> Generator[str, None, None]:
    for update in _get_graph().stream(initial_state, stream_mode="updates"):
        if _is_stopped_by(stop_event):
            return
        if "agent" in update:
            yield from _stream_agent_update(update, accum, stop_event)
        if "tools" in update:
            yield from _stream_tools_update(update, accum, stop_event)
        if _is_stopped_by(stop_event):
            return


def _stream_final_events(
    query: str,
    final_answer: str,
    referenced_articles: list[dict[str, Any]],
    source_providers: list[str],
) -> Generator[str, None, None]:
    yield _stream_event({"type": "referenced_articles", "articles": referenced_articles})
    structured_block = ""
    if referenced_articles:
        payload = {
            "articles": referenced_articles,
            "total": len(referenced_articles),
            "query": query,
            "source_providers": source_providers,
        }
        json_payload = json.dumps(payload)
        yield _stream_event({"type": "articles_json", "data": json_payload})
        structured_block = f"\n```json:articles\n{json.dumps(payload, indent=2)}\n```\n"
    result = {
        "success": bool(final_answer.strip()),
        "query": query,
        "answer": final_answer,
        "structured_articles": structured_block,
        "articles_searched": len(_news_articles_cache),
        "referenced_articles": referenced_articles,
        "source_providers": source_providers,
    }
    yield _stream_event({"type": "complete", "result": result})
    yield _stream_event({"type": "done"})


def _research_stream_impl(
    query: str,
    articles: list[dict[str, Any]] | None = None,
    chat_history: list[dict[str, str]] | None = None,
    stop_event: threading.Event | None = None,
) -> Generator[str, None, None]:
    set_news_articles(articles)
    initial_state: AgentState = {
        "messages": _build_initial_messages(query, chat_history),
        "iteration": 0,
        "mode": "research",
        "tool_history": set(),
        "tool_calls_used": 0,
    }

    accum: dict[str, Any] = {
        "final_answer": "",
        "tool_snippets": [],
        "logged_tool_calls": set(),
    }
    yield from _stream_graph_updates(initial_state, stop_event, accum)

    final_answer = accum["final_answer"]
    referenced_articles = list(_referenced_articles_tracker)
    if not referenced_articles and final_answer:
        referenced_articles = _match_articles_in_text(final_answer)

    if _is_stopped_by(stop_event):
        return

    if _needs_final_answer(final_answer) or (
        referenced_articles and _answer_denies_available_context(final_answer)
    ):
        synthesized = _finalize_answer(query, referenced_articles, accum["tool_snippets"])
        if synthesized:
            final_answer = synthesized

    final_answer = _sanitize_final_answer(final_answer)
    source_providers = sorted(_research_source_providers)

    if _is_stopped_by(stop_event):
        return

    yield from _stream_final_events(query, final_answer, referenced_articles, source_providers)


__all__ = [
    "research_news",
    "research_stream",
    "set_news_articles",
]
