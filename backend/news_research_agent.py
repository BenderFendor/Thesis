"""LangGraph-powered news research agent with RAG + web search tools."""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
from datetime import datetime, timezone
from typing import (
    Annotated,
    Any,
    Callable,
    Dict,
    Generator,
    Iterator,
    List,
    Optional,
    Protocol,
    Sequence,
    Set,
)

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
EXTERNAL_SEARCH_TOOLS = {"web_search", "news_search"}
EXTERNAL_SEARCH_TOOLS.update({"gdelt_context_search", "gdelt_doc_search"})


class RunnableMessageInvoker(Protocol):
    def invoke(self, payload: Sequence[BaseMessage]) -> BaseMessage: ...


class ToolBindableLLM(RunnableMessageInvoker, Protocol):
    def bind_tools(
        self,
        tools: Sequence[Any],
        **kwargs: Any,
    ) -> RunnableMessageInvoker: ...


class CompiledAgentGraph(Protocol):
    def stream(
        self,
        initial_state: "AgentState",
        stream_mode: str = "updates",
    ) -> Iterator[Dict[str, Any]]: ...


_news_articles_cache: List[Dict[str, Any]] = []
_referenced_articles_tracker: List[Dict[str, Any]] = []
_articles_by_id: Dict[str, Dict[str, Any]] = {}
_fetched_urls_cache: Dict[str, str] = {}
_research_source_providers: Set[str] = set()

DENIAL_PHRASES = (
    "provided context does not contain",
    "without additional details",
    "impossible to describe",
    "impossible to summarize",
    "only repeats the question",
    "cannot answer from the provided context",
    "not enough information in the provided context",
)


def _normalize_url(url: Optional[str]) -> Optional[str]:
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


def _tool_call_key(call: Dict[str, Any]) -> str:
    name = str(call.get("name", ""))
    normalized_args = _normalize_tool_call_args(name, call.get("args", {}))
    return f"{name}:{_serialize_tool_args(normalized_args)}"


def _iter_new_tool_calls(
    tool_calls: Sequence[Dict[str, Any]],
    seen: Set[str],
) -> List[Dict[str, Any]]:
    unique_calls: List[Dict[str, Any]] = []
    for call in tool_calls:
        key = _tool_call_key(call)
        if key in seen:
            continue
        seen.add(key)
        unique_calls.append(call)
    return unique_calls


def _register_article_lookup(article: Dict[str, Any]) -> None:
    article_id = article.get("id") or article.get("article_id")
    url_key = _normalize_url(article.get("url") or article.get("link"))

    if article_id is not None:
        _articles_by_id[str(article_id)] = article
    if url_key:
        _articles_by_id[url_key] = article


def _record_research_source_provider(provider: Optional[str]) -> None:
    normalized = str(provider or "").strip().lower()
    if normalized:
        _research_source_providers.add(normalized)


def set_news_articles(articles: Optional[List[Dict[str, Any]]]) -> None:
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


def _extract_query_terms(query: str) -> List[str]:
    tokens = re.findall(r"[\w-]+", query.lower())
    return [token for token in tokens if len(token) > 2]


def _run_async_blocking(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: Dict[str, Any] = {}
    error: Dict[str, BaseException] = {}

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
) -> List[Dict[str, Any]]:
    if not settings.enable_database or AsyncSessionLocal is None:
        return []

    async with AsyncSessionLocal() as session:
        return await search_articles_by_keyword(session, query=query, limit=top_k)


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
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
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


def _track_reference_by_url(url: str, fallback: Dict[str, Any] | None = None) -> None:
    normalized = _normalize_url(url)
    if normalized:
        article = _articles_by_id.get(normalized)
        if article:
            _track_reference(article)
            return
    if fallback:
        _track_reference(fallback)


def _track_search_result_references(tool_name: str, content: str) -> None:
    if tool_name not in {
        "web_search",
        "news_search",
        "search_internal_news",
        "gdelt_context_search",
        "gdelt_doc_search",
    }:
        return
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return
    if not isinstance(payload, list):
        return

    provider_hint = {
        "search_internal_news": "internal",
        "gdelt_context_search": "gdelt",
        "gdelt_doc_search": "gdelt",
        "news_search": "duckduckgo",
        "web_search": "duckduckgo",
    }.get(tool_name)

    for item in payload[:5]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or item.get("link") or "").strip()
        if not url:
            continue
        title = str(item.get("title") or item.get("headline") or "Untitled")
        source = str(item.get("source") or item.get("provider") or "External source")
        summary = str(
            item.get("summary") or item.get("body") or item.get("snippet") or ""
        )
        published = str(
            item.get("published") or item.get("date") or item.get("published_at") or ""
        )
        image = item.get("image")
        provider = (
            str(item.get("provider") or provider_hint or "").strip().lower() or None
        )
        context_snippet = str(item.get("context_snippet") or "").strip() or None
        sentence = str(item.get("sentence") or "").strip() or None
        result_type = str(item.get("result_type") or "").strip() or None
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


def _is_internal_article(article: Dict[str, Any]) -> bool:
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
    if normalized and normalized in _articles_by_id:
        return True
    return False


def _count_internal_references() -> int:
    return sum(
        1 for article in _referenced_articles_tracker if _is_internal_article(article)
    )


def _normalize_query(query: str) -> str:
    return query.strip()


def _normalize_ddg_result(
    item: Dict[str, Any],
    *,
    provider: str,
    result_type: str,
) -> Dict[str, Any] | None:
    url = str(item.get("url") or item.get("link") or "").strip()
    if not url:
        return None
    summary = str(
        item.get("summary")
        or item.get("body")
        or item.get("snippet")
        or item.get("description")
        or ""
    ).strip()
    context_snippet = str(item.get("context_snippet") or "").strip() or None
    sentence = str(item.get("sentence") or "").strip() or None
    result: Dict[str, Any] = {
        "id": _normalize_url(url) or url,
        "url": url,
        "link": url,
        "title": str(item.get("title") or item.get("headline") or "Untitled").strip(),
        "source": str(
            item.get("source") or item.get("publisher") or "External source"
        ).strip(),
        "summary": summary,
        "description": summary,
        "published": str(
            item.get("published") or item.get("date") or item.get("published_at") or ""
        ).strip(),
        "image": item.get("image") if isinstance(item.get("image"), str) else None,
        "provider": provider,
        "result_type": result_type,
        "category": "external",
        "context_snippet": context_snippet or summary or None,
        "sentence": sentence,
    }
    return {key: value for key, value in result.items() if value not in (None, "")}


def _dedupe_search_results(
    *result_groups: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for group in result_groups:
        for item in group:
            if not isinstance(item, dict):
                continue
            url = _normalize_url(str(item.get("url") or item.get("link") or ""))
            title = str(item.get("title") or item.get("headline") or "").strip().lower()
            provider = str(item.get("provider") or "").strip().lower()
            key = url or f"{provider}:{title}"
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(item)
    return deduped


def _search_gdelt_context(
    query: str,
    *,
    max_results: int = 10,
    timespan: str = GDELT_DEFAULT_TIMESPAN,
) -> List[Dict[str, Any]]:
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
) -> List[Dict[str, Any]]:
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
) -> List[Dict[str, Any]]:
    context_results = _search_gdelt_context(
        query,
        max_results=max_results,
        timespan=timespan,
    )
    doc_results: List[Dict[str, Any]] = []
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


def _is_internal_fetch_call(call: Dict[str, Any]) -> bool:
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


def _required_internal_fetches_before_external() -> int:
    internal_reference_count = _count_internal_references()
    if internal_reference_count <= 0:
        return 0
    return min(2, internal_reference_count)


def _required_internal_fetches_for_state(
    *, internal_search_succeeded: bool, current_message_internal_hits: int
) -> int:
    if not internal_search_succeeded:
        return 0
    internal_reference_count = max(
        _count_internal_references(), current_message_internal_hits
    )
    if internal_reference_count <= 0:
        return 0
    return min(2, internal_reference_count)


@tool
def search_internal_news(query: str, top_k: int = 5) -> str:
    """Search internal news with database-first fallback to cached articles."""
    query = _normalize_query(query)
    query_terms = _extract_query_terms(query)
    if not query_terms:
        return "Query too vague for internal search."

    try:
        db_matches = _run_async_blocking(_search_internal_news_from_db(query, top_k))
    except Exception as exc:
        logger.warning("Internal DB search failed: %s", exc)
        db_matches = []

    if db_matches:
        _record_research_source_provider("internal")
        for match in db_matches:
            _register_article_lookup(match)
            _track_reference(match)

        payload = [
            {
                "title": article.get("title"),
                "source": article.get("source"),
                "url": article.get("url") or article.get("link"),
                "published": article.get("published"),
                "summary": article.get("summary") or article.get("description"),
                "provider": "internal",
                "result_type": "internal",
            }
            for article in db_matches[:top_k]
        ]
        return json.dumps(payload, indent=2)

    if not _news_articles_cache:
        return "No relevant articles found in internal archive."

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
        return "No relevant articles found in internal archive."

    scored.sort(key=lambda item: item[0], reverse=True)
    matches = [item[1] for item in scored[:top_k]]
    _record_research_source_provider("internal")
    for match in matches:
        _track_reference(match)

    payload = [
        {
            "title": article.get("title"),
            "source": article.get("source"),
            "url": article.get("url") or article.get("link"),
            "published": article.get("published"),
            "summary": article.get("summary") or article.get("description"),
            "provider": "internal",
            "result_type": "internal",
        }
        for article in matches
    ]
    return json.dumps(payload, indent=2)


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
        text_search_fn = getattr(ddgs_client, "text")
        results: List[Dict[str, Any]] = []
        for item in text_search_fn(query, max_results=num_results):
            normalized = _normalize_ddg_result(
                cast(Dict[str, Any], item),
                provider="duckduckgo",
                result_type="web",
            )
            if normalized is not None:
                results.append(normalized)
        if results:
            _record_research_source_provider("duckduckgo")
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
        news_search_fn = getattr(ddgs_client, "news")
        results: List[Dict[str, Any]] = []
        for item in news_search_fn(keywords, max_results=max_results, region=region):
            normalized = _normalize_ddg_result(
                cast(Dict[str, Any], item),
                provider="duckduckgo",
                result_type="news",
            )
            if normalized is not None:
                results.append(normalized)
        if results:
            _record_research_source_provider("duckduckgo")
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
    normalized = _normalize_url(url)
    if normalized and normalized in _fetched_urls_cache:
        logger.debug("fetch_article_content cache hit: %s", normalized)
        return _fetched_urls_cache[normalized]
    result = extract_article_content(url)
    if "error" in result:
        out = f"Error fetching {url}: {result['error']}"
        if normalized:
            _fetched_urls_cache[normalized] = out
        return out
    text = result.get("text", "")
    preview = text[:8000]
    fallback = _build_external_reference(
        url=url,
        title=str(result.get("title") or "Untitled"),
        source=str(
            result.get("source") or result.get("publisher") or "External source"
        ),
        summary=preview[:1200],
        published=str(result.get("publish_date") or ""),
        image=str(result.get("top_image") or "") or None,
    )
    _track_reference_by_url(url, fallback)
    out = f"Title: {result.get('title', 'Untitled')}\nContent: {preview}"
    if normalized:
        _fetched_urls_cache[normalized] = out
    logger.debug("fetch_article_content fetched: %s", normalized)
    return out


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
                    model=os.getenv(
                        "NEWS_RESEARCH_GEMINI_MODEL",
                        "gemini-3-flash-preview",
                    ),
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


def _dedup_tool_node(state: "AgentState") -> Dict[str, Any]:
    """Intercept the last AIMessage and deduplicate tool calls before execution.

    Keeps the first occurrence of each (tool_name, args) pair across the
    entire session. Duplicate calls get a synthetic ToolMessage instead of
    being executed, which stops the LLM's batch-duplicate doom loop.

    Also enforces MAX_TOOL_CALLS_PER_SESSION: once that many unique calls
    have been made, all further calls are short-circuited regardless of args.
    """
    last_msg = state["messages"][-1]
    tool_calls = getattr(last_msg, "tool_calls", None) or []
    tool_history = set(state.get("tool_history", set()))
    tool_calls_used = int(state.get("tool_calls_used", 0))
    internal_search_done = any(
        key.startswith("search_internal_news:") for key in tool_history
    )
    internal_search_succeeded = False
    internal_fetch_calls_done = 0
    current_message_internal_hits = 0

    for message in state.get("messages", []):
        if not isinstance(message, ToolMessage):
            continue
        tool_name = str(getattr(message, "name", "") or "")
        content = _content_to_text(message.content)
        if tool_name == "search_internal_news" and _internal_search_found_results(
            content
        ):
            internal_search_succeeded = True
            try:
                payload = json.loads(content)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, list):
                current_message_internal_hits = max(
                    current_message_internal_hits, len(payload)
                )

    for key in tool_history:
        if key.startswith("fetch_article_content:"):
            try:
                _tool_name, serialized_args = key.split(":", 1)
                args = json.loads(serialized_args)
            except (ValueError, json.JSONDecodeError):
                continue
            call = {"name": "fetch_article_content", "args": args}
            if _is_internal_fetch_call(call):
                internal_fetch_calls_done += 1

    results: List[ToolMessage] = []
    unique_calls = []

    for call in tool_calls:
        key = _tool_call_key(call)
        tool_call_id = str(call.get("id", "missing-tool-call-id"))
        tool_name = str(call.get("name", "unknown_tool"))

        if key in tool_history:
            results.append(
                ToolMessage(
                    content=(
                        "Already called with the same arguments; "
                        "use prior results already in context."
                    ),
                    tool_call_id=tool_call_id,
                    name=tool_name,
                )
            )
            logger.debug("dedup_tool_node: duplicate call key=%s", key)
            continue

        if tool_calls_used >= MAX_TOOL_CALLS_PER_SESSION:
            results.append(
                ToolMessage(
                    content=(
                        f"Tool call limit reached ({MAX_TOOL_CALLS_PER_SESSION} unique calls per session). "
                        "Synthesize a final answer from the context already gathered."
                    ),
                    tool_call_id=tool_call_id,
                    name=tool_name,
                )
            )
            logger.warning(
                "dedup_tool_node: session cap hit (%d), blocking call to %s",
                MAX_TOOL_CALLS_PER_SESSION,
                tool_name,
            )
            continue

        if tool_name in EXTERNAL_SEARCH_TOOLS and not internal_search_done:
            results.append(
                ToolMessage(
                    content=(
                        "Use search_internal_news first. Check the internal archive before "
                        "using external search."
                    ),
                    tool_call_id=tool_call_id,
                    name=tool_name,
                )
            )
            continue

        required_internal_fetches = _required_internal_fetches_for_state(
            internal_search_succeeded=internal_search_succeeded,
            current_message_internal_hits=current_message_internal_hits,
        )
        if (
            tool_name in EXTERNAL_SEARCH_TOOLS
            and internal_search_succeeded
            and internal_fetch_calls_done < required_internal_fetches
        ):
            results.append(
                ToolMessage(
                    content=(
                        "Internal search found relevant archive coverage. Read the internal "
                        "article URLs with fetch_article_content before using external search."
                    ),
                    tool_call_id=tool_call_id,
                    name=tool_name,
                )
            )
            continue

        tool_history.add(key)
        tool_calls_used += 1
        unique_calls.append(call)
        if _is_internal_fetch_call(call):
            internal_fetch_calls_done += 1

    if unique_calls:
        # Build a trimmed AIMessage with only the unique calls so ToolNode
        # processes exactly those and nothing else.
        trimmed = AIMessage(content=last_msg.content, tool_calls=unique_calls)
        trimmed_state = {**state, "messages": [*state["messages"][:-1], trimmed]}
        tool_results = ToolNode(list(_tools_by_name.values())).invoke(trimmed_state)
        results = list(tool_results.get("messages", [])) + results

    return {
        "messages": results,
        "tool_history": tool_history,
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
    messages: Annotated[Sequence[BaseMessage], add_messages]
    iteration: int
    mode: str
    tool_history: Set[str]
    tool_calls_used: int


def call_model(state: AgentState) -> Dict[str, Any]:
    mode = state.get("mode", "research")
    tool_history = set(state.get("tool_history", set()))
    tool_calls_used = int(state.get("tool_calls_used", 0))
    if mode in {"final", "final_pending"}:
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
            SystemMessage(content=_finalizer_system_prompt()),
            HumanMessage(
                content=(
                    "Return the final response with a section titled 'Answer'. "
                    "Use the context provided.\n\n"
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
            "mode": "final",
            "tool_history": tool_history,
            "tool_calls_used": tool_calls_used,
        }

    if mode == "tool_router":
        messages = [
            SystemMessage(content=_tool_router_system_prompt()),
            *state["messages"],
        ]
        response = _invoke_with_llamacpp_recovery(
            lambda payload: _get_tool_router().invoke(payload),
            messages,
            "tool router invoke",
        )
        next_mode = "research"
        if isinstance(response, AIMessage) and not getattr(
            response, "tool_calls", None
        ):
            next_mode = "final_pending"
        return {
            "messages": [response],
            "iteration": state.get("iteration", 0) + 1,
            "mode": next_mode,
            "tool_history": tool_history,
            "tool_calls_used": tool_calls_used,
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
        if iteration >= MAX_ITERATIONS:
            next_mode = "final_pending"
        elif _needs_final_answer(content) and not getattr(response, "tool_calls", None):
            next_mode = "tool_router"
    return {
        "messages": [response],
        "iteration": iteration,
        "mode": next_mode,
        "tool_history": tool_history,
        "tool_calls_used": tool_calls_used,
    }


def _extract_text_from_message(message: BaseMessage) -> str:
    if isinstance(message, AIMessage):
        return _content_to_text(message.content)
    if isinstance(message, HumanMessage):
        return str(message.content)
    return _content_to_text(getattr(message, "content", ""))


def should_continue(state: AgentState) -> str:
    if state.get("mode") == "tool_router":
        return "agent"
    if state.get("mode") == "final":
        return END
    if state.get("mode") == "final_pending":
        return "agent"
    last_message = state["messages"][-1]
    if isinstance(last_message, AIMessage) and getattr(
        last_message, "tool_calls", None
    ):
        return "tools"
    return END


def _build_initial_messages(
    query: str, chat_history: Optional[List[Dict[str, str]]] = None
) -> List[BaseMessage]:
    system_message = SystemMessage(content=_system_prompt())
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


def _answer_denies_available_context(answer_text: str) -> bool:
    lower_content = answer_text.strip().lower()
    if not lower_content:
        return False
    return any(phrase in lower_content for phrase in DENIAL_PHRASES)


def _build_context_snippet(referenced_articles: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for article in referenced_articles[:8]:
        title = article.get("title") or "Untitled"
        source = article.get("source") or "Unknown"
        url = article.get("url") or article.get("link") or ""
        summary = (
            article.get("context_snippet")
            or article.get("sentence")
            or article.get("summary")
            or article.get("description")
            or ""
        )
        published = article.get("published") or ""
        provider = article.get("provider") or ""
        provider_suffix = f" [{provider}]" if provider else ""
        lines.append(
            f"- {title} ({source}){provider_suffix} {published}\n  {url}\n  {summary}"
        )
    return "\n".join(lines)


def _build_tool_evidence_snippet(tool_snippets: List[str]) -> str:
    if not tool_snippets:
        return ""
    evidence_lines: List[str] = []
    for index, snippet in enumerate(tool_snippets[:6], start=1):
        compact = snippet.strip()
        if not compact:
            continue
        evidence_lines.append(f"Evidence {index}:\n{compact[:1800]}")
    return "\n\n".join(evidence_lines)


def _finalize_answer(
    query: str,
    referenced_articles: List[Dict[str, Any]],
    tool_snippets: List[str],
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
    finalizer_messages: List[BaseMessage] = [
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
        "tool_history": set(),
        "tool_calls_used": 0,
    }

    thinking_steps: List[Dict[str, Any]] = []
    final_answer = ""
    tool_snippets: List[str] = []
    logged_tool_calls: Set[str] = set()

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
            for tool_call in _iter_new_tool_calls(
                getattr(agent_message, "tool_calls", []) or [],
                logged_tool_calls,
            ):
                thinking_steps.append(
                    {
                        "type": "action",
                        "content": f"Tool request: {tool_call['name']} {tool_call.get('args', {})}",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )
        if "tools" in update:
            for tool_message in update["tools"]["messages"]:
                snippet = _content_to_text(tool_message.content)[:2000]
                tool_name = str(getattr(tool_message, "name", "") or "")
                thinking_steps.append(
                    {
                        "type": "observation",
                        "content": snippet,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )
                if snippet:
                    tool_snippets.append(snippet)
                if tool_name:
                    _track_search_result_references(tool_name, snippet)

    referenced_articles = list(_referenced_articles_tracker)
    if not referenced_articles and final_answer:
        referenced_articles = _match_articles_in_text(final_answer)

    if _needs_final_answer(final_answer) or (
        referenced_articles and _answer_denies_available_context(final_answer)
    ):
        synthesized = _finalize_answer(query, referenced_articles, tool_snippets)
        if synthesized:
            final_answer = synthesized

    final_answer = _sanitize_final_answer(final_answer)

    source_providers = sorted(_research_source_providers)

    structured_block = ""
    if referenced_articles:
        payload = {
            "articles": referenced_articles,
            "total": len(referenced_articles),
            "query": query,
            "source_providers": source_providers,
        }
        structured_block = f"\n```json:articles\n{json.dumps(payload, indent=2)}\n```\n"

    result: Dict[str, Any] = {
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
    articles: Optional[List[Dict[str, Any]]] = None,
    chat_history: Optional[List[Dict[str, str]]] = None,
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

    final_answer = ""
    tool_snippets: List[str] = []
    logged_tool_calls: Set[str] = set()

    for update in _get_graph().stream(initial_state, stream_mode="updates"):
        if stop_event is not None and stop_event.is_set():
            return
        if "agent" in update:
            agent_message = update["agent"]["messages"][-1]
            content_text = _content_to_text(agent_message.content)
            if content_text:
                if stop_event is not None and stop_event.is_set():
                    return
                final_answer = content_text
                yield (
                    "data: "
                    + json.dumps({"type": "thinking", "content": content_text})
                    + "\n\n"
                )

            for tool_call in _iter_new_tool_calls(
                getattr(agent_message, "tool_calls", []) or [],
                logged_tool_calls,
            ):
                if stop_event is not None and stop_event.is_set():
                    return
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
                if stop_event is not None and stop_event.is_set():
                    return
                snippet = _content_to_text(tool_message.content)[:2000]
                tool_name = str(getattr(tool_message, "name", "") or "")
                if snippet:
                    tool_snippets.append(snippet)
                if tool_name:
                    _track_search_result_references(tool_name, snippet)
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

    if stop_event is not None and stop_event.is_set():
        return

    if _needs_final_answer(final_answer) or (
        referenced_articles and _answer_denies_available_context(final_answer)
    ):
        synthesized = _finalize_answer(query, referenced_articles, tool_snippets)
        if synthesized:
            final_answer = synthesized

    final_answer = _sanitize_final_answer(final_answer)

    source_providers = sorted(_research_source_providers)

    if stop_event is not None and stop_event.is_set():
        return

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
            "source_providers": source_providers,
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
        "source_providers": source_providers,
    }
    yield "data: " + json.dumps({"type": "complete", "result": result}) + "\n\n"
    yield 'data: {"type": "done"}\n\n'


__all__ = [
    "research_news",
    "research_stream",
    "set_news_articles",
]
