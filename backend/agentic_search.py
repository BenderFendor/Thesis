"""
Agentic Search Tool using LangChain and Google Gemini API

This script demonstrates how to create an intelligent agent that can:
1. Use the Gemini LLM for reasoning
2. Decide when to use a custom web search tool
3. Answer queries using real-time web information

Required installations:
pip install langchain langchain-google-genai python-dotenv requests

Make sure to set GOOGLE_API_KEY in your .env file.
"""

import os
import json
import requests
from dotenv import load_dotenv
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

# Load environment variables from .env file
load_dotenv()


@tool
def get_web_search_results(query: str) -> str:
    """
    Search the web for real-time information using DuckDuckGo's Instant Answer API.
    
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
        
        data = response.json()
        
        # Extract relevant information from the response
        results = []
        
        # Abstract text (main answer)
        if data.get("Abstract"):
            results.append(f"Summary: {data['Abstract']}")
        
        # Answer (direct answer if available)
        if data.get("Answer"):
            results.append(f"Direct Answer: {data['Answer']}")
        
        # Related topics
        if data.get("RelatedTopics"):
            topics = []
            for topic in data["RelatedTopics"][:3]:  # Limit to top 3
                if isinstance(topic, dict) and topic.get("Text"):
                    topics.append(topic["Text"])
            if topics:
                results.append(f"Related Information: {'; '.join(topics)}")
        
        # Definition (if it's a definition query)
        if data.get("Definition"):
            results.append(f"Definition: {data['Definition']}")
        
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
    """
    Create and configure the agent executor with Gemini LLM and search tool.
    
    Returns:
        AgentExecutor configured with the LLM, tools, and prompt
    """
    # Initialize the Gemini LLM
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.7,
        google_api_key=os.getenv("GEMINI_API_KEY")
    )
    
    # Define the tools available to the agent
    tools = [get_web_search_results]
    
    # Create a prompt template for the agent
    # This prompt guides the agent on how to use tools and respond
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a helpful AI assistant with access to web search capabilities.
        
When a user asks a question:
1. Determine if you can answer it with your existing knowledge
2. If the question requires current, real-time, or factual information that may have changed, use the web search tool
3. After receiving search results, synthesize them into a clear, helpful answer
4. Always cite when you've used web search results

Be conversational and helpful. If search results are unclear or unavailable, say so and provide your best answer based on general knowledge."""),
        MessagesPlaceholder(variable_name="chat_history", optional=True),
        ("user", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    
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


def main():
    """
    Main execution function demonstrating the agentic search tool.
    """
    # Check if API key is set
    if not os.getenv("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY not found in environment variables.")
        print("Please set it in your .env file or environment.")
        return
    
    print("="*80)
    print("Agentic Search Tool - Powered by Gemini 2.0 Flash")
    print("="*80)
    print()
    
    # Create the agent executor
    agent_executor = create_agent_executor()
    
    # Example query that requires web search
    sample_queries = [
        "What is the current population of the United States?",
        "What is the capital of France?",  # This can be answered without search
        "Tell me about the latest developments in quantum computing",
    ]
    
    # Run the first query as demonstration
    query = sample_queries[0]
    print(f"Query: {query}")
    print("-"*80)
    
    try:
        # Invoke the agent with the query
        response = agent_executor.invoke({"input": query})
        
        print("\n" + "="*80)
        print("FINAL ANSWER:")
        print("="*80)
        print(response["output"])
        print()
        
    except Exception as e:
        print(f"Error during agent execution: {str(e)}")
    
    # Interactive mode (optional)
    print("\n" + "="*80)
    print("Interactive Mode - Type 'quit' to exit")
    print("="*80)
    
    while True:
        user_input = input("\nYour question: ").strip()
        
        if user_input.lower() in ['quit', 'exit', 'q']:
            print("Goodbye!")
            break
        
        if not user_input:
            continue
        
        print("-"*80)
        try:
            response = agent_executor.invoke({"input": user_input})
            print("\n" + "="*80)
            print("ANSWER:")
            print("="*80)
            print(response["output"])
        except Exception as e:
            print(f"Error: {str(e)}")


if __name__ == "__main__":
    main()
