"""Agentic Search Tool using LangChain with configurable LLM backends.

Supports llama.cpp, OpenRouter, or direct Gemini access for reasoning plus a
web search tool for current information.
"""

import json
import requests
from typing import Any

from dotenv import load_dotenv
from langchain_classic.agents import create_tool_calling_agent
from langchain_classic.agents.agent import AgentExecutor
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from app.core.config import get_llamacpp_model, settings
from app.services.prompting import build_text_system_prompt

# Load environment variables from .env file
load_dotenv()


def _related_topic_texts(data: dict[str, Any]) -> list[str]:
    """Collect readable text from DuckDuckGo related topics (top 3 only)."""
    topics: list[str] = []
    for topic in (data.get("RelatedTopics") or [])[:3]:  # Limit to top 3
        if isinstance(topic, dict) and topic.get("Text"):
            topics.append(topic["Text"])
    return topics


def _format_search_results(data: dict[str, Any]) -> list[str]:
    """Build the readable result lines from a DuckDuckGo Instant Answer payload."""
    results: list[str] = []

    # Abstract text (main answer)
    if data.get("Abstract"):
        results.append(f"Summary: {data['Abstract']}")

    # Answer (direct answer if available)
    if data.get("Answer"):
        results.append(f"Direct Answer: {data['Answer']}")

    # Related topics
    topics = _related_topic_texts(data)
    if topics:
        results.append(f"Related Information: {'; '.join(topics)}")

    # Definition (if it's a definition query)
    if data.get("Definition"):
        results.append(f"Definition: {data['Definition']}")

    return results


@tool
def get_web_search_results(query: str) -> str:
    """Search the web for real-time information using DuckDuckGo's Instant Answer API.

    This tool should be used when you need current, factual information that you don't
    have in your training data, such as:
    - Current statistics, populations, or real-time data
    - Recent events or news
    - Weather information
    - Stock prices or financial data
    - Any information that changes frequently

    Args:
        query: The search query string to look up on the web

    Returns:
        A concise summary of the search results
    """
    try:
        # Make request to DuckDuckGo Instant Answer API
        url = f"https://api.duckduckgo.com/?q={query}&format=json"
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        results = _format_search_results(response.json())

        # If we have results, return them
        if results:
            return "\n".join(results)
        else:
            # If no structured results, try to get any available text
            return f"Search performed for '{query}', but no detailed results were found. You may need to use your general knowledge or inform the user that current data is unavailable."

    except requests.exceptions.RequestException as e:
        return f"Error performing web search: {str(e)}"
    except json.JSONDecodeError:
        return "Error parsing search results"
    except Exception as e:
        return f"Unexpected error during search: {str(e)}"


def create_agent_executor():
    """Create and configure the agent executor with the configured LLM and search tool.

    Returns:
        AgentExecutor configured with the LLM, tools, and prompt
    """
    llm = _create_chat_llm()

    # Define the tools available to the agent
    tools = [get_web_search_results]

    # Create a prompt template for the agent
    # This prompt guides the agent on how to use tools and respond
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                build_text_system_prompt(
                    role="research assistant",
                    task=(
                        "Use web search when a question requires current, real-time, "
                        "or factual information. After receiving search results, "
                        "synthesize them into a clear, helpful answer. Always cite "
                        "when search results were used. If search results are "
                        "unclear or unavailable, say so and provide your best answer "
                        "based on general knowledge."
                    ),
                    output_rules="Be conversational and helpful.",
                ),
            ),
            MessagesPlaceholder(variable_name="chat_history", optional=True),
            ("user", "{input}"),
            MessagesPlaceholder(variable_name="agent_scratchpad"),
        ]
    )

    # Create the agent
    agent = create_tool_calling_agent(llm, tools, prompt)

    # Create and return the agent executor
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,  # Show the agent's thinking process
        handle_parsing_errors=True,  # Gracefully handle any parsing errors
        max_iterations=5,  # Limit iterations to prevent infinite loops
    )

    return agent_executor


def _create_chat_llm():
    if settings.llm_backend == "llamacpp":
        return ChatOpenAI(
            model=get_llamacpp_model(),
            temperature=0.7,
            api_key=settings.llamacpp_api_key,
            base_url=settings.llamacpp_base_url,
        )
    if settings.llm_backend == "opencode" and settings.opencode_api_key:
        return ChatOpenAI(
            model=settings.opencode_model,
            temperature=0.7,
            api_key=SecretStr(settings.opencode_api_key),
            base_url=settings.opencode_base_url,
        )
    if settings.open_router_api_key:
        return ChatOpenAI(
            model=settings.open_router_model,
            temperature=0.7,
            api_key=settings.open_router_api_key,
            base_url="https://openrouter.ai/api/v1",
        )
    if settings.gemini_api_key:
        return ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            temperature=0.7,
            google_api_key=settings.gemini_api_key,
        )
    raise RuntimeError(
        "No LLM backend configured. Set OPEN_ROUTER_API_KEY, GEMINI_API_KEY, "
        "OPENCODE_API_KEY, or enable LLM_BACKEND=llamacpp."
    )


def _backend_banner() -> str:
    if settings.llm_backend == "llamacpp":
        return f"llama.cpp ({get_llamacpp_model()})"
    if settings.llm_backend == "opencode" and settings.opencode_api_key:
        return f"OpenCode Zen ({settings.opencode_model})"
    if settings.open_router_api_key:
        return f"OpenRouter ({settings.open_router_model})"
    if settings.gemini_api_key:
        return "Gemini"
    return "unconfigured backend"


def _backend_configured() -> bool:
    """Return True when any LLM backend is configured for the tool."""
    has_opencode = settings.llm_backend == "opencode" and bool(settings.opencode_api_key)
    return (
        settings.llm_backend == "llamacpp"
        or has_opencode
        or bool(settings.open_router_api_key)
        or bool(settings.gemini_api_key)
    )


def _run_demo_query(agent_executor: AgentExecutor) -> None:
    """Run the first sample query as a demonstration."""
    sample_queries = [
        "What is the current population of the United States?",
        "What is the capital of France?",  # This can be answered without search
        "Tell me about the latest developments in quantum computing",
    ]

    # Run the first query as demonstration
    query = sample_queries[0]
    print(f"Query: {query}")
    print("-" * 80)

    try:
        # Invoke the agent with the query
        response = agent_executor.invoke({"input": query})

        print("\n" + "=" * 80)
        print("FINAL ANSWER:")
        print("=" * 80)
        print(response["output"])
        print()

    except Exception as e:
        print(f"Error during agent execution: {str(e)}")


def _run_interactive_loop(agent_executor: AgentExecutor) -> None:
    """Run the interactive question/answer loop until the user quits."""
    print("\n" + "=" * 80)
    print("Interactive Mode - Type 'quit' to exit")
    print("=" * 80)

    while True:
        user_input = input("\nYour question: ").strip()

        if user_input.lower() in ["quit", "exit", "q"]:
            print("Goodbye!")
            break

        if not user_input:
            continue

        print("-" * 80)
        try:
            response = agent_executor.invoke({"input": user_input})
            print("\n" + "=" * 80)
            print("ANSWER:")
            print("=" * 80)
            print(response["output"])
        except Exception as e:
            print(f"Error: {str(e)}")


def main():
    """Main execution function demonstrating the agentic search tool."""
    # Check if API key is set
    if not _backend_configured():
        print(
            "ERROR: No LLM backend configured. Set OPEN_ROUTER_API_KEY, "
            "GEMINI_API_KEY, OPENCODE_API_KEY, or enable LLM_BACKEND=llamacpp."
        )
        return

    print("=" * 80)
    print(f"Agentic Search Tool - Powered by {_backend_banner()}")
    print("=" * 80)
    print()

    # Create the agent executor
    agent_executor = create_agent_executor()
    _run_demo_query(agent_executor)

    # Interactive mode (optional)
    _run_interactive_loop(agent_executor)


if __name__ == "__main__":
    main()
