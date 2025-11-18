"""
News Research Agent - Intelligent article search and analysis

This agent is specifically designed for the news aggregation platform.
It searches through cached articles, analyzes news content, and provides
insights with visible chain-of-thought reasoning.
"""

import os
import json
import logging
import re
import requests
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from langchain.agents import create_tool_calling_agent
from langchain.agents.agent import AgentExecutor
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.callbacks import BaseCallbackHandler
from datetime import datetime, timedelta
from app.vector_store import get_vector_store

logger = logging.getLogger(__name__)

load_dotenv()


class ThinkingStep:
    """Represents a step in the agent's reasoning process"""

    def __init__(self, step_type: str, content: str, timestamp: Optional[str] = None):
        self.step_type = step_type  # 'thought', 'action', 'observation', 'answer'
        self.content = content
        self.timestamp = timestamp or datetime.now().isoformat()

    def to_dict(self) -> Dict[str, str]:
        return {
            "type": self.step_type,
            "content": self.content,
            "timestamp": self.timestamp,
        }


class StreamingThoughtHandler(BaseCallbackHandler):
    """Callback handler to capture agent's chain of thought"""

    def __init__(self):
        self.steps: List[ThinkingStep] = []
        self.current_tool = None

    def on_agent_action(self, action, **kwargs):
        """Called when agent decides to use a tool"""
        self.current_tool = action.tool
        # Simplified - just show the action
        self.steps.append(
            ThinkingStep(
                "action", f"Using tool: {action.tool}\nInput: {action.tool_input}"
            )
        )

    def on_tool_start(self, serialized, input_str, **kwargs):
        """Called when tool execution starts"""
        tool_name = serialized.get("name", "unknown")
        self.steps.append(ThinkingStep("tool_start", f"Executing {tool_name}..."))

    def on_tool_end(self, output, **kwargs):
        """Called when tool execution completes"""
        # Simplified - just show abbreviated results
        self.steps.append(
            ThinkingStep(
                "observation",
                f"Found results: {output[:150]}..."
                if len(str(output)) > 150
                else f"Results: {output}",
            )
        )

    def on_agent_finish(self, finish, **kwargs):
        """Called when agent completes"""
        # Simplified - just mark completion
        self.steps.append(ThinkingStep("answer", "Research complete"))


# This will be set by the endpoint to access the news cache
_news_articles_cache: List[Dict[str, Any]] = []
_referenced_articles_tracker: List[
    Dict[str, Any]
] = []  # Track articles that were accessed
_articles_by_id: Dict[str, Dict[str, Any]] = {}

_STOPWORDS = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "in",
    "on",
    "for",
    "from",
    "to",
    "with",
    "by",
    "about",
    "latest",
    "new",
    "news",
    "update",
    "updates",
    "recent",
    "current",
    "today",
    "this",
    "that",
    "those",
    "these",
    "summary",
    "summarize",
    "give",
    "show",
    "tell",
    "me",
    "are",
    "what",
    "whats",
    "which",
    "who",
    "where",
    "when",
    "why",
    "how",
}

_KEYWORD_SYNONYMS = {
    "political": {"politics", "government", "election", "governance"},
    "politics": {"political", "government", "policy"},
    "government": {"politics", "political", "policy"},
    "election": {"elections", "vote", "political"},
    "economy": {"economic", "financial", "market"},
    "health": {"healthcare", "medical", "medicine"},
    "technology": {"tech", "innovation", "ai", "artificial"},
    "climate": {"environment", "climatechange", "weather"},
    "conflict": {"war", "violence", "military", "crisis"},
    "energy": {"power", "oil", "gas", "renewable"},
}

SEARX_INSTANCES = [
    "https://search.rhscz.eu",
    "https://searx.rhscz.eu",
    "https://searx.stream",
    "https://search.hbubli.cc",
    "https://searx.oloke.xyz",
]


def _extract_query_terms(query: str) -> List[str]:
    tokens = re.findall(r"[\w-]+", query.lower())
    filtered = [token for token in tokens if token not in _STOPWORDS and len(token) > 2]

    if not filtered:
        return [query.lower().strip()] if query else []

    expanded: set[str] = set()
    for token in filtered:
        expanded.add(token)
        synonyms = _KEYWORD_SYNONYMS.get(token)
        if synonyms:
            expanded.update(synonyms)

    return list(expanded)


def _register_article_lookup(article: Dict[str, Any]):
    """Store article references for quick lookup by ID, chroma ID, or URL."""
    if not article:
        return

    def _store(key: Optional[str]):
        if key:
            _articles_by_id[key] = article

    article_id = article.get("id") or article.get("article_id")
    chroma_id = article.get("chroma_id")
    url = article.get("url") or article.get("link")

    if article_id is not None:
        _store(str(article_id))
    if chroma_id:
        _store(str(chroma_id))
    if url and isinstance(url, str):
        _store(url.rstrip("/"))


def _ensure_article_registered(article: Dict[str, Any]):
    """Ensure article is present in lookup registry and return stored instance."""
    _register_article_lookup(article)
    article_id = article.get("id") or article.get("article_id")
    if article_id is not None:
        return _articles_by_id.get(str(article_id), article)
    chroma_id = article.get("chroma_id")
    if chroma_id:
        return _articles_by_id.get(str(chroma_id), article)
    url = article.get("url") or article.get("link")
    if url:
        return _articles_by_id.get(url.rstrip("/"), article)
    return article


def set_news_articles(articles: List[Dict[str, Any]]):
    """Set the news articles that the agent can search through"""
    global _news_articles_cache, _referenced_articles_tracker, _articles_by_id
    _news_articles_cache = articles
    _referenced_articles_tracker = []  # Reset tracker
    _articles_by_id = {}

    for article in _news_articles_cache:
        if article:
            _register_article_lookup(article)


def _parse_published_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        if isinstance(value, datetime):
            return value
        value_str = str(value).strip()
        if not value_str:
            return None
        if value_str.endswith("Z"):
            value_str = value_str[:-1] + "+00:00"
        return datetime.fromisoformat(value_str)
    except Exception:
        return None


@tool
def search_news_articles(query: str) -> str:
    """
    Search through the current news articles in the platform's database.

    Use this tool when you need to find specific articles, analyze news coverage,
    compare sources, or answer questions about current news events in the platform.

    This searches through article titles, descriptions, sources, and categories.

    Args:
        query: Search keywords related to the news topic (e.g., "climate change", "technology", "politics")

    Returns:
        A formatted list of relevant articles with titles, sources, and summaries
    """
    global _referenced_articles_tracker

    if not _news_articles_cache:
        return "No articles available in the database. The news cache may be empty."

    query_terms = _extract_query_terms(query)
    query_lower = query.lower()

    # Search through articles
    relevant_articles = []
    for article in _news_articles_cache:
        search_blob = " ".join(
            filter(
                None,
                [
                    article.get("title", ""),
                    article.get("description", ""),
                    article.get("summary", ""),
                    article.get("source", ""),
                    article.get("category", ""),
                ],
            )
        ).lower()

        matches_direct = query_lower in search_blob if query_lower.strip() else False

        token_matches = any(term in search_blob for term in query_terms)

        if matches_direct or token_matches:
            relevant_articles.append(article)

    if not relevant_articles:
        if query_terms and query_terms != [query_lower.strip()] and query_terms[0]:
            terms_display = ", ".join(sorted(set(query_terms)))
            return (
                f"No articles found matching '{query}'. "
                f"Tried related terms: {terms_display}. "
                "Try different keywords or check spelling."
            )
        return f"No articles found matching '{query}'. Try different keywords or broader terms."

    # Limit to top 10 most recent
    relevant_articles = sorted(
        relevant_articles, key=lambda x: x.get("published", ""), reverse=True
    )[:10]

    # Track these articles for later reference
    for article in relevant_articles:
        if article not in _referenced_articles_tracker:
            _referenced_articles_tracker.append(article)

    # Format results with article URLs
    result_lines = [f"Found {len(relevant_articles)} articles about '{query}':\n"]

    for i, article in enumerate(relevant_articles, 1):
        result_lines.append(f"{i}. **{article.get('title', 'No title')}**")
        result_lines.append(f"   Source: {article.get('source', 'Unknown')}")
        result_lines.append(f"   Category: {article.get('category', 'general')}")
        result_lines.append(f"   Published: {article.get('published', 'Unknown date')}")
        result_lines.append(
            f"   Summary: {article.get('description', 'No description')[:150]}..."
        )
        # Include article URL if available
        if article.get("link"):
            result_lines.append(f"   URL: {article.get('link')}")
        result_lines.append("")

    return "\n".join(result_lines)


@tool
def semantic_search_articles(query: str) -> str:
    """Use the ChromaDB vector store for semantic article search."""
    global _referenced_articles_tracker

    vector_store = get_vector_store()
    if not vector_store:
        return "Semantic search is unavailable because the vector store is offline."

    if not query:
        return "Please provide a topic or question to run a semantic search."

    try:
        results = vector_store.search_similar(query, limit=8)
    except Exception as error:
        return f"Semantic search failed: {error}"

    if not results:
        return f"No semantic matches found for '{query}'. Try a different phrasing."

    lines = [f"Semantic matches for '{query}':\n"]

    for idx, result in enumerate(results, 1):
        article_id = result.get("article_id")
        chroma_id = result.get("chroma_id")
        metadata = result.get("metadata", {})

        lookup_keys = [
            str(article_id) if article_id is not None else None,
            str(chroma_id) if chroma_id else None,
            metadata.get("url"),
        ]

        article = None
        for key in lookup_keys:
            if not key:
                continue
            lookup_key = key.rstrip("/") if isinstance(key, str) else key
            if isinstance(lookup_key, str) and lookup_key in _articles_by_id:
                article = _articles_by_id[lookup_key]
                break

        if not article:
            article = {
                "id": article_id,
                "title": metadata.get("title")
                or metadata.get("url")
                or "Semantic match",
                "source": metadata.get("source", "Unknown"),
                "category": metadata.get("category", "general"),
                "description": metadata.get("summary"),
                "summary": metadata.get("summary"),
                "link": metadata.get("url"),
                "url": metadata.get("url"),
                "published": metadata.get("published"),
                "retrieval_method": "semantic_vector_store",
            }

        article.setdefault("retrieval_method", "semantic_vector_store")
        article["semantic_score"] = result.get("similarity_score")
        article["semantic_distance"] = result.get("distance")
        article["chroma_id"] = chroma_id or article.get("chroma_id")
        article["preview"] = result.get("preview")

        registered_article = _ensure_article_registered(article)
        if registered_article not in _referenced_articles_tracker:
            _referenced_articles_tracker.append(registered_article)

        title = registered_article.get("title", "Untitled article")
        source = registered_article.get("source", "Unknown")
        category = registered_article.get("category", "general")
        published = registered_article.get("published") or registered_article.get(
            "published_at"
        )
        url = registered_article.get("link") or registered_article.get("url")
        summary = registered_article.get("description") or registered_article.get(
            "summary"
        )

        score = result.get("similarity_score")
        score_text = (
            f"score: {score:.3f}" if isinstance(score, (int, float)) else "score: n/a"
        )

        lines.append(f"{idx}. **{title}** ({score_text})")
        lines.append(f"   Source: {source} | Category: {category}")
        if published:
            lines.append(f"   Published: {published}")
        if summary:
            lines.append(f"   Summary: {summary[:160]}...")
        if url:
            lines.append(f"   URL: {url}")
        lines.append("")

    return "\n".join(lines)


@tool
def analyze_source_coverage(topic: str) -> str:
    """
    Analyze how different news sources are covering a specific topic.

    Use this to compare bias, identify which sources are covering a topic,
    and understand diverse perspectives on news events.

    Args:
        topic: The news topic to analyze (e.g., "election", "climate")

    Returns:
        Analysis of which sources covered the topic and their perspectives
    """
    global _referenced_articles_tracker

    if not _news_articles_cache:
        return "No articles available for analysis."

    topic_lower = topic.lower()

    # Find articles about the topic
    topic_articles = [
        article
        for article in _news_articles_cache
        if topic_lower in article.get("title", "").lower()
        or topic_lower in article.get("description", "").lower()
    ]

    if not topic_articles:
        return f"No coverage found for topic '{topic}'."

    # Track these articles for later reference
    for article in topic_articles[:10]:  # Limit to top 10 to avoid overwhelming
        if article not in _referenced_articles_tracker:
            _referenced_articles_tracker.append(article)

    # Group by source
    source_coverage = {}
    for article in topic_articles:
        source = article.get("source", "Unknown")
        if source not in source_coverage:
            source_coverage[source] = []
        source_coverage[source].append(article)

    # Format analysis
    result_lines = [f"Source Coverage Analysis for '{topic}':\n"]
    result_lines.append(f"Total articles found: {len(topic_articles)}")
    result_lines.append(f"Sources covering this topic: {len(source_coverage)}\n")

    for source, articles in sorted(
        source_coverage.items(), key=lambda x: len(x[1]), reverse=True
    ):
        result_lines.append(f"**{source}**: {len(articles)} article(s)")
        # Show one example headline
        if articles:
            result_lines.append(f'  Example: "{articles[0].get("title", "No title")}"')
        result_lines.append("")

    return "\n".join(result_lines)


@tool
def get_web_search_results(query: str) -> str:
    """
    Search the web for real-time information using SearxNG instances.

    Use this tool ONLY when information is not available in the news articles database,
    or when you need external context, background information, or fact-checking.

    Args:
        query: The search query for external web search

    Returns:
        Concise summary of web search results
    """
    if not query:
        return "Please provide a search topic."

    headers = {"User-Agent": "ThesisNewsBot/1.0 (+https://example.com)"}

    params = {
        "q": query,
        "format": "json",
        "language": "en",
        "safesearch": 1,
    }

    for base_url in SEARX_INSTANCES:
        try:  # pragma: no cover - network call
            response = requests.get(
                f"{base_url.rstrip('/')}/search",
                params=params,
                timeout=12,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

            results = data.get("results", [])
            if not results:
                continue

            lines = [f"SearxNG ({base_url}) results for '{query}':", ""]
            for idx, result in enumerate(results[:6], 1):
                title = result.get("title") or "Untitled"
                url = result.get("url")
                snippet = result.get("content") or result.get("snippet")

                lines.append(f"{idx}. {title}")
                if url:
                    lines.append(f"   URL: {url}")
                if snippet:
                    lines.append(f"   Snippet: {snippet[:200]}...")
                lines.append("")

            return "\n".join(lines)
        except Exception as searx_error:  # pragma: no cover
            logger.warning("Searx instance %s failed: %s", base_url, searx_error)
            continue

    return (
        "Web search is currently unavailable. All configured providers failed. "
        "Please try again later or adjust the query."
    )


@tool
def get_recent_news_overview(query: str = "", hours: int = 24, limit: int = 8) -> str:
    """Summarize the most recent articles in the cache, optionally filtered by topic."""

    if not _news_articles_cache:
        return "No articles available to summarize."

    try:
        timeframe = timedelta(hours=max(1, min(hours, 168)))
    except Exception:
        timeframe = timedelta(hours=24)

    cutoff = datetime.utcnow() - timeframe
    topic_terms = _extract_query_terms(query) if query else []

    matched: List[Dict[str, Any]] = []
    for article in _news_articles_cache:
        published_raw = (
            article.get("published")
            or article.get("published_at")
            or article.get("date")
        )
        published_dt = _parse_published_timestamp(published_raw)
        if published_dt and published_dt < cutoff:
            continue

        blob = " ".join(
            filter(
                None,
                [
                    article.get("title", ""),
                    article.get("description", ""),
                    article.get("summary", ""),
                    article.get("category", ""),
                    article.get("source", ""),
                ],
            )
        ).lower()

        if topic_terms:
            if not any(term in blob for term in topic_terms):
                continue

        matched.append(article)

    if not matched:
        return (
            f"No recent articles in the last {int(timeframe.total_seconds() // 3600)} hours"
            + (f" matching '{query}'." if query else ".")
        )

    matched.sort(key=lambda item: item.get("published", ""), reverse=True)

    limited = matched[: max(1, min(limit, 20))]
    lines = [
        f"Recent coverage{' for ' + query if query else ''} (last {int(timeframe.total_seconds() // 3600)}h):",
        f"Found {len(matched)} article(s); showing top {len(limited)}",
        "",
    ]

    for idx, article in enumerate(limited, 1):
        title = article.get("title", "Untitled")
        source = article.get("source", "Unknown")
        category = article.get("category", "general")
        published = article.get("published") or article.get("published_at")
        url = article.get("link") or article.get("url")
        summary = article.get("description") or article.get("summary")

        lines.append(f"{idx}. {title}")
        lines.append(f"   Source: {source} | Category: {category}")
        if published:
            lines.append(f"   Published: {published}")
        if summary:
            lines.append(f"   Summary: {summary[:160]}...")
        if url:
            lines.append(f"   URL: {url}")
        lines.append("")

    global _referenced_articles_tracker
    for article in limited:
        if article not in _referenced_articles_tracker:
            _referenced_articles_tracker.append(article)

    return "\n".join(lines)


def create_news_research_agent(verbose: bool = True):
    """
    Create the news research agent with all tools.

    Args:
        verbose: If True, shows detailed chain of thought

    Returns:
        Tuple of (agent_executor, callback_handler)
    """
    # Initialize Gemini LLM with timeout
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.7,
        google_api_key=os.getenv("GEMINI_API_KEY"),
        timeout=30,  # 30 second timeout for API calls
        max_retries=1,  # Reduce retries
    )

    # Define tools - order matters (prioritize article search)
    tools = [
        search_news_articles,
        semantic_search_articles,
        analyze_source_coverage,
        get_recent_news_overview,
        get_web_search_results,  # Use this as fallback
    ]

    # Create specialized prompt for news research
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """You are a News Research Assistant for a multi-perspective news aggregation platform.

Your primary role is to help users understand and analyze news articles in our database.

**Guidelines:**
1. ALWAYS search the news articles database FIRST using search_news_articles
2. Use semantic_search_articles when keyword search misses context or you need conceptual parallels
3. Use get_recent_news_overview to summarize fresh coverage in the last 24 hours (adjust window as needed)
4. Use analyze_source_coverage to compare how different sources cover topics
5. Only use web_search when information isn't in our articles or for background context
6. Provide balanced, multi-perspective analysis
7. ALWAYS cite specific sources with their article URLs when referencing them
8. When mentioning an article or source claim, include the article URL in your response
9. Highlight bias, funding, and credibility when relevant
10. Be transparent about your reasoning process
11. When a user shares a broad topic (e.g., "latest political developments"), run search_news_articles with the user wording, optionally pair it with get_recent_news_overview, and summarize what the database contains instead of asking for clarification unless the request is incoherent.

**Citation Format:**
When referencing articles, use this format:
"According to [Source Name], [claim/information] ([article URL])"
Example: "According to BBC News, scientists warn of climate impacts (https://example.com/article)"

**Example workflow:**
- User asks about "climate change" → search_news_articles("climate change")
- User asks about source bias → analyze_source_coverage(topic)
- User asks for background info → get_web_search_results(query)

Remember: You have access to a curated collection of news from diverse global sources.
Your goal is to help users navigate this information intelligently.""",
            ),
            MessagesPlaceholder(variable_name="chat_history", optional=True),
            ("user", "{input}"),
            MessagesPlaceholder(variable_name="agent_scratchpad"),
        ]
    )

    # Create agent
    agent = create_tool_calling_agent(llm, tools, prompt)

    # Create callback handler to capture thinking
    thought_handler = StreamingThoughtHandler()

    # Create agent executor with optimized settings
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=verbose,
        handle_parsing_errors=True,
        max_iterations=5,  # Reduced for faster responses
        max_execution_time=30,  # 30 second max execution time
        callbacks=[thought_handler] if verbose else [],
    )

    return agent_executor, thought_handler


def research_news(
    query: str,
    articles: List[Dict[str, Any]] = None,
    verbose: bool = True,
    chat_history: List[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Research news articles using the AI agent.

    Args:
        query: User's research question
        articles: List of news articles to search through
        verbose: Show chain of thought
        chat_history: Previous conversation messages for context

    Returns:
        Dictionary with answer, thinking steps, metadata, referenced articles, and structured article JSON
    """
    # Set articles in global cache
    if articles:
        set_news_articles(articles)

    # Create agent
    agent_executor, thought_handler = create_news_research_agent(verbose=verbose)

    # Format chat history for langchain
    from langchain_core.messages import HumanMessage, AIMessage

    formatted_history = []
    if chat_history:
        for msg in chat_history[
            -6:
        ]:  # Only use last 6 messages (3 exchanges) for context
            if msg.get("type") == "user":
                formatted_history.append(HumanMessage(content=msg.get("content", "")))
            elif msg.get("type") == "assistant":
                formatted_history.append(AIMessage(content=msg.get("content", "")))

    # Execute research with timeout handling
    try:
        import signal

        def timeout_handler(signum, frame):
            raise TimeoutError("Agent execution timed out after 45 seconds")

        # Set timeout for agent execution (45 seconds)
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(45)

        try:
            response = agent_executor.invoke(
                {"input": query, "chat_history": formatted_history}
            )
            answer_text = response["output"]
        finally:
            signal.alarm(0)  # Cancel the alarm

        # Use the tracked articles that were accessed during research
        global _referenced_articles_tracker
        referenced_articles = _referenced_articles_tracker.copy()

        print(
            f"🔍 Agent used search tool and accessed {len(referenced_articles)} articles during research"
        )

        # If no articles were tracked (shouldn't happen if search was used), fall back to URL extraction
        if not referenced_articles:
            print("⚠️ No articles tracked, falling back to URL extraction")
            import re

            url_pattern = r"https?://[^\s\)]+"
            found_urls = re.findall(url_pattern, answer_text)

            print(f"🔍 Found {len(found_urls)} URLs in the answer")
            print(f"📚 Total articles in cache: {len(_news_articles_cache)}")

            # Find articles that match the URLs mentioned in the response
            for article in _news_articles_cache:
                article_link = article.get("link", "")
                # Clean up the URL for comparison (remove trailing slashes, etc.)
                article_link_clean = article_link.rstrip("/")

                for found_url in found_urls:
                    found_url_clean = found_url.rstrip("/")
                    if (
                        article_link_clean == found_url_clean
                        or article_link == found_url
                    ):
                        referenced_articles.append(article)
                        print(
                            f"✅ Matched article: {article.get('title', 'No title')[:50]}"
                        )
                        break

        print(f"📰 Referenced articles to return: {len(referenced_articles)}")

        # Create structured JSON for frontend embedding
        # This will be marked with a special delimiter so frontend can parse it
        articles_json = {
            "articles": referenced_articles,
            "total": len(referenced_articles),
            "query": query,
        }

        # Format the structured data with markers for frontend parsing
        structured_articles_block = (
            f"\n```json:articles\n{json.dumps(articles_json, indent=2)}\n```\n"
        )

        return {
            "success": True,
            "query": query,
            "answer": answer_text,
            "structured_articles": structured_articles_block,  # New field for JSON block
            "thinking_steps": [step.to_dict() for step in thought_handler.steps]
            if verbose
            else [],
            "articles_searched": len(_news_articles_cache),
            "referenced_articles": referenced_articles,  # Include full article data
        }
    except TimeoutError:
        return {
            "success": False,
            "query": query,
            "answer": "",
            "structured_articles": "",
            "error": "The research took too long and timed out. Please try a simpler query.",
            "thinking_steps": [step.to_dict() for step in thought_handler.steps]
            if verbose
            else [],
            "referenced_articles": [],
            "articles_searched": len(_news_articles_cache),
        }
    except Exception as e:
        import traceback

        error_details = f"{str(e)}\n{traceback.format_exc()}"
        print(f"❌ Error in research_news: {error_details}")
        return {
            "success": False,
            "query": query,
            "answer": "",
            "structured_articles": "",
            "error": str(e),
            "thinking_steps": [step.to_dict() for step in thought_handler.steps]
            if verbose
            else [],
            "referenced_articles": [],
            "articles_searched": len(_news_articles_cache),
        }


# Interactive mode for testing
def main():
    """Interactive testing mode"""
    if not os.getenv("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY not found in environment.")
        return

    print("=" * 80)
    print("News Research Agent - Interactive Mode")
    print("=" * 80)
    print()
    print("NOTE: In interactive mode, no articles are loaded.")
    print("This agent is designed to work with the news platform's article database.")
    print()

    # Sample articles for testing
    sample_articles = [
        {
            "title": "New Climate Change Report Shows Urgent Action Needed",
            "source": "BBC",
            "category": "general",
            "description": "Scientists warn that immediate action is required to address climate change...",
            "published": "2025-01-15T10:00:00Z",
        },
        {
            "title": "Tech Giants Announce AI Partnership",
            "source": "Reuters",
            "category": "technology",
            "description": "Major technology companies form alliance to develop responsible AI...",
            "published": "2025-01-15T09:00:00Z",
        },
    ]

    set_news_articles(sample_articles)
    print(f"Loaded {len(sample_articles)} sample articles for testing.\n")

    while True:
        query = input("Your question (or 'quit' to exit): ").strip()

        if query.lower() in ["quit", "exit", "q"]:
            print("Goodbye!")
            break

        if not query:
            continue

        print("\n" + "=" * 80)
        result = research_news(query, sample_articles, verbose=True)

        if result["success"]:
            print("\n" + "=" * 80)
            print("ANSWER:")
            print("=" * 80)
            print(result["answer"])
            print()
        else:
            print(f"\nError: {result.get('error')}\n")


if __name__ == "__main__":
    main()
