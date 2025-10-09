"""
News Research Agent - Intelligent article search and analysis

This agent is specifically designed for the news aggregation platform.
It searches through cached articles, analyzes news content, and provides
insights with visible chain-of-thought reasoning.
"""

import os
import json
import requests
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.callbacks import BaseCallbackHandler
from datetime import datetime

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
            "timestamp": self.timestamp
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
        self.steps.append(ThinkingStep(
            "action",
            f"Using tool: {action.tool}\nInput: {action.tool_input}"
        ))
    
    def on_tool_start(self, serialized, input_str, **kwargs):
        """Called when tool execution starts"""
        tool_name = serialized.get("name", "unknown")
        self.steps.append(ThinkingStep(
            "tool_start",
            f"Executing {tool_name}..."
        ))
    
    def on_tool_end(self, output, **kwargs):
        """Called when tool execution completes"""
        # Simplified - just show abbreviated results
        self.steps.append(ThinkingStep(
            "observation",
            f"Found results: {output[:150]}..." if len(str(output)) > 150 else f"Results: {output}"
        ))
    
    def on_agent_finish(self, finish, **kwargs):
        """Called when agent completes"""
        # Simplified - just mark completion
        self.steps.append(ThinkingStep(
            "answer",
            "Research complete"
        ))


# This will be set by the endpoint to access the news cache
_news_articles_cache: List[Dict[str, Any]] = []
_referenced_articles_tracker: List[Dict[str, Any]] = []  # Track articles that were accessed


def set_news_articles(articles: List[Dict[str, Any]]):
    """Set the news articles that the agent can search through"""
    global _news_articles_cache, _referenced_articles_tracker
    _news_articles_cache = articles
    _referenced_articles_tracker = []  # Reset tracker


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
    
    query_lower = query.lower()
    
    # Search through articles
    relevant_articles = []
    for article in _news_articles_cache:
        # Check if query matches title, description, source, or category
        matches = (
            query_lower in article.get('title', '').lower() or
            query_lower in article.get('description', '').lower() or
            query_lower in article.get('source', '').lower() or
            query_lower in article.get('category', '').lower()
        )
        
        if matches:
            relevant_articles.append(article)
    
    if not relevant_articles:
        return f"No articles found matching '{query}'. Try different keywords or broader terms."
    
    # Limit to top 10 most recent
    relevant_articles = sorted(
        relevant_articles,
        key=lambda x: x.get('published', ''),
        reverse=True
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
        result_lines.append(f"   Summary: {article.get('description', 'No description')[:150]}...")
        # Include article URL if available
        if article.get('link'):
            result_lines.append(f"   URL: {article.get('link')}")
        result_lines.append("")
    
    return "\n".join(result_lines)


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
        article for article in _news_articles_cache
        if topic_lower in article.get('title', '').lower() or
           topic_lower in article.get('description', '').lower()
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
        source = article.get('source', 'Unknown')
        if source not in source_coverage:
            source_coverage[source] = []
        source_coverage[source].append(article)
    
    # Format analysis
    result_lines = [f"Source Coverage Analysis for '{topic}':\n"]
    result_lines.append(f"Total articles found: {len(topic_articles)}")
    result_lines.append(f"Sources covering this topic: {len(source_coverage)}\n")
    
    for source, articles in sorted(source_coverage.items(), key=lambda x: len(x[1]), reverse=True):
        result_lines.append(f"**{source}**: {len(articles)} article(s)")
        # Show one example headline
        if articles:
            result_lines.append(f"  Example: \"{articles[0].get('title', 'No title')}\"")
        result_lines.append("")
    
    return "\n".join(result_lines)


@tool
def get_web_search_results(query: str) -> str:
    """
    Search the web for real-time information using DuckDuckGo.
    
    Use this tool ONLY when information is not available in the news articles database,
    or when you need external context, background information, or fact-checking.
    
    Args:
        query: The search query for external web search
        
    Returns:
        Concise summary of web search results
    """
    try:
        url = f"https://api.duckduckgo.com/?q={query}&format=json"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        results = []
        
        if data.get("Abstract"):
            results.append(f"Summary: {data['Abstract']}")
        
        if data.get("Answer"):
            results.append(f"Answer: {data['Answer']}")
        
        if data.get("RelatedTopics"):
            topics = []
            for topic in data["RelatedTopics"][:3]:
                if isinstance(topic, dict) and topic.get("Text"):
                    topics.append(topic["Text"])
            if topics:
                results.append(f"Related: {'; '.join(topics)}")
        
        if results:
            return "\n".join(results)
        else:
            return f"Web search performed for '{query}', but no detailed results found."
            
    except Exception as e:
        return f"Error performing web search: {str(e)}"


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
        max_retries=1  # Reduce retries
    )
    
    # Define tools - order matters (prioritize article search)
    tools = [
        search_news_articles,
        analyze_source_coverage,
        get_web_search_results,  # Use this as fallback
    ]
    
    # Create specialized prompt for news research
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a News Research Assistant for a multi-perspective news aggregation platform.

Your primary role is to help users understand and analyze news articles in our database.

**Guidelines:**
1. ALWAYS search the news articles database FIRST using search_news_articles
2. Use analyze_source_coverage to compare how different sources cover topics
3. Only use web_search when information isn't in our articles or for background context
4. Provide balanced, multi-perspective analysis
5. ALWAYS cite specific sources with their article URLs when referencing them
6. When mentioning an article or source claim, include the article URL in your response
7. Highlight bias, funding, and credibility when relevant
8. Be transparent about your reasoning process

**Citation Format:**
When referencing articles, use this format:
"According to [Source Name], [claim/information] ([article URL])"
Example: "According to BBC News, scientists warn of climate impacts (https://example.com/article)"

**Example workflow:**
- User asks about "climate change" → search_news_articles("climate change")
- User asks about source bias → analyze_source_coverage(topic)
- User asks for background info → get_web_search_results(query)

Remember: You have access to a curated collection of news from diverse global sources.
Your goal is to help users navigate this information intelligently."""),
        MessagesPlaceholder(variable_name="chat_history", optional=True),
        ("user", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    
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
        callbacks=[thought_handler] if verbose else []
    )
    
    return agent_executor, thought_handler


def research_news(query: str, articles: List[Dict[str, Any]] = None, verbose: bool = True) -> Dict[str, Any]:
    """
    Research news articles using the AI agent.
    
    Args:
        query: User's research question
        articles: List of news articles to search through
        verbose: Show chain of thought
        
    Returns:
        Dictionary with answer, thinking steps, metadata, referenced articles, and structured article JSON
    """
    # Set articles in global cache
    if articles:
        set_news_articles(articles)
    
    # Create agent
    agent_executor, thought_handler = create_news_research_agent(verbose=verbose)
    
    # Execute research with timeout handling
    try:
        import signal
        
        def timeout_handler(signum, frame):
            raise TimeoutError("Agent execution timed out after 45 seconds")
        
        # Set timeout for agent execution (45 seconds)
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(45)
        
        try:
            response = agent_executor.invoke({"input": query})
            answer_text = response["output"]
        finally:
            signal.alarm(0)  # Cancel the alarm
        
        # Use the tracked articles that were accessed during research
        global _referenced_articles_tracker
        referenced_articles = _referenced_articles_tracker.copy()
        
        print(f"🔍 Agent used search tool and accessed {len(referenced_articles)} articles during research")
        
        # If no articles were tracked (shouldn't happen if search was used), fall back to URL extraction
        if not referenced_articles:
            print("⚠️ No articles tracked, falling back to URL extraction")
            import re
            url_pattern = r'https?://[^\s\)]+'
            found_urls = re.findall(url_pattern, answer_text)
            
            print(f"🔍 Found {len(found_urls)} URLs in the answer")
            print(f"📚 Total articles in cache: {len(_news_articles_cache)}")
            
            # Find articles that match the URLs mentioned in the response
            for article in _news_articles_cache:
                article_link = article.get('link', '')
                # Clean up the URL for comparison (remove trailing slashes, etc.)
                article_link_clean = article_link.rstrip('/')
                
                for found_url in found_urls:
                    found_url_clean = found_url.rstrip('/')
                    if article_link_clean == found_url_clean or article_link == found_url:
                        referenced_articles.append(article)
                        print(f"✅ Matched article: {article.get('title', 'No title')[:50]}")
                        break
        
        print(f"📰 Referenced articles to return: {len(referenced_articles)}")
        
        # Create structured JSON for frontend embedding
        # This will be marked with a special delimiter so frontend can parse it
        articles_json = {
            "articles": referenced_articles,
            "total": len(referenced_articles),
            "query": query
        }
        
        # Format the structured data with markers for frontend parsing
        structured_articles_block = f"\n```json:articles\n{json.dumps(articles_json, indent=2)}\n```\n"
        
        return {
            "success": True,
            "query": query,
            "answer": answer_text,
            "structured_articles": structured_articles_block,  # New field for JSON block
            "thinking_steps": [step.to_dict() for step in thought_handler.steps] if verbose else [],
            "articles_searched": len(_news_articles_cache),
            "referenced_articles": referenced_articles  # Include full article data
        }
    except TimeoutError as e:
        return {
            "success": False,
            "query": query,
            "answer": "",
            "structured_articles": "",
            "error": "The research took too long and timed out. Please try a simpler query.",
            "thinking_steps": [step.to_dict() for step in thought_handler.steps] if verbose else [],
            "referenced_articles": [],
            "articles_searched": len(_news_articles_cache)
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
            "thinking_steps": [step.to_dict() for step in thought_handler.steps] if verbose else [],
            "referenced_articles": [],
            "articles_searched": len(_news_articles_cache)
        }


# Interactive mode for testing
def main():
    """Interactive testing mode"""
    if not os.getenv("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY not found in environment.")
        return
    
    print("="*80)
    print("News Research Agent - Interactive Mode")
    print("="*80)
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
            "published": "2025-01-15T10:00:00Z"
        },
        {
            "title": "Tech Giants Announce AI Partnership",
            "source": "Reuters",
            "category": "technology",
            "description": "Major technology companies form alliance to develop responsible AI...",
            "published": "2025-01-15T09:00:00Z"
        },
    ]
    
    set_news_articles(sample_articles)
    print(f"Loaded {len(sample_articles)} sample articles for testing.\n")
    
    while True:
        query = input("Your question (or 'quit' to exit): ").strip()
        
        if query.lower() in ['quit', 'exit', 'q']:
            print("Goodbye!")
            break
        
        if not query:
            continue
        
        print("\n" + "="*80)
        result = research_news(query, sample_articles, verbose=True)
        
        if result["success"]:
            print("\n" + "="*80)
            print("ANSWER:")
            print("="*80)
            print(result["answer"])
            print()
        else:
            print(f"\nError: {result.get('error')}\n")


if __name__ == "__main__":
    main()
