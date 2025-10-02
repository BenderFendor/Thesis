# Agentic Search Tool - LangChain + Gemini 2.0 Flash

This is a complete implementation of an intelligent agentic search tool that uses Google's Gemini 2.0 Flash model with LangChain to create an AI agent capable of making intelligent decisions about when to search the web for information.

## 🌟 Features

- **Intelligent Tool Calling**: The agent automatically determines when it needs to search the web vs. using its internal knowledge
- **Real-time Web Search**: Integrates with DuckDuckGo's Instant Answer API for current information
- **Gemini 2.0 Flash**: Uses Google's latest fast and efficient model
- **LangChain Orchestration**: Leverages LangChain's agent framework for robust tool integration
- **Interactive Mode**: Includes both single-query and interactive chat modes
- **Verbose Logging**: Shows the agent's reasoning process and tool calls

## 📋 Requirements

The script requires the following Python packages (already added to `requirements.txt`):

```
langchain>=0.1.0
langchain-google-genai>=1.0.0
langchain-core>=0.1.0
python-dotenv>=1.0.0
requests>=2.31.0
```

## 🚀 Installation

### 1. Install Dependencies

From the `backend` directory, run:

```bash
pip install -r requirements.txt
```

### 2. Set Up Environment Variables

Create a `.env` file in the `backend` directory (copy from `.env.example`):

```bash
cp .env.example .env
```

Then edit `.env` and add your Google API key:

```env
GOOGLE_API_KEY=your_actual_api_key_here
```

**Getting a Google API Key:**
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key and paste it into your `.env` file

## 💻 Usage

### Basic Usage

Run the script:

```bash
cd backend
python agentic_search.py
```

### What Happens

1. **Demonstration Mode**: The script first runs with a sample query: "What is the current population of the United States?"

2. **Interactive Mode**: After the demo, you can ask your own questions. Type your question and press Enter.

3. **Exit**: Type `quit`, `exit`, or `q` to end the session.

### Example Session

```
================================================================================
Agentic Search Tool - Powered by Gemini 2.0 Flash
================================================================================

Query: What is the current population of the United States?
--------------------------------------------------------------------------------

> Entering new AgentExecutor chain...

Invoking: `get_web_search_results` with `{'query': 'current population United States'}`

Summary: The United States population is approximately 331.9 million...

The current population of the United States is approximately 331.9 million people.

> Finished chain.

================================================================================
FINAL ANSWER:
================================================================================
The current population of the United States is approximately 331.9 million people.

================================================================================
Interactive Mode - Type 'quit' to exit
================================================================================

Your question: What is the capital of France?
--------------------------------------------------------------------------------
...
```

## 🔧 How It Works

### 1. Custom Search Tool

The `@tool` decorator creates a LangChain tool from the `get_web_search_results` function:

```python
@tool
def get_web_search_results(query: str) -> str:
    """
    Search the web for real-time information...
    """
    # Calls DuckDuckGo API
    # Parses and returns results
```

**Key Points:**
- The docstring is crucial - the agent reads it to understand when to use the tool
- Uses DuckDuckGo's free API (no API key required)
- Returns structured, concise summaries

### 2. Agent Creation

```python
# Initialize Gemini LLM
llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    temperature=0.7
)

# Create agent with tool calling
agent = create_tool_calling_agent(llm, tools, prompt)
```

### 3. Agent Decision Making

The agent follows this logic:
1. Receives user query
2. Analyzes if it needs current/real-time data
3. If yes → calls `get_web_search_results`
4. Synthesizes search results into a clear answer
5. Returns final response

## 📝 Customization

### Modify the Search Tool

To use a different search API, edit the `get_web_search_results` function:

```python
@tool
def get_web_search_results(query: str) -> str:
    """Your custom docstring"""
    # Your custom API call here
    return results
```

### Add More Tools

Add additional tools to the tools list:

```python
@tool
def my_custom_tool(param: str) -> str:
    """Description for the agent"""
    # Your logic
    return result

tools = [get_web_search_results, my_custom_tool]
```

### Adjust Model Parameters

Modify the LLM initialization:

```python
llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    temperature=0.7,  # 0.0 = deterministic, 1.0 = creative
    max_tokens=2048,  # Maximum response length
)
```

### Change System Prompt

Edit the system message in the prompt template:

```python
prompt = ChatPromptTemplate.from_messages([
    ("system", "Your custom instructions here..."),
    # ... rest of template
])
```

## 🎯 Use Cases

This agentic search tool is ideal for:

- **Real-time Data Queries**: Stock prices, weather, populations
- **Current Events**: Latest news or developments
- **Fact-Checking**: Verifying information against web sources
- **Research Assistant**: Combining LLM knowledge with web search
- **Customer Support**: Answering questions with up-to-date information

## ⚙️ Advanced Configuration

### Enable Chat History

To maintain conversation context:

```python
from langchain.memory import ConversationBufferMemory

memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True
)

response = agent_executor.invoke({
    "input": query,
    "chat_history": memory.load_memory_variables({})["chat_history"]
})
```

### Add Error Handling

The agent executor includes built-in error handling:

```python
agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True,
    handle_parsing_errors=True,  # Gracefully handle errors
    max_iterations=5,  # Prevent infinite loops
)
```

## 🐛 Troubleshooting

### "GOOGLE_API_KEY not found"
- Ensure `.env` file exists in the `backend` directory
- Check that `GOOGLE_API_KEY` is set in `.env`
- Verify `python-dotenv` is installed

### "No module named 'langchain'"
```bash
pip install -r requirements.txt
```

### Search Returns Empty Results
- DuckDuckGo API may not have results for all queries
- The agent will fall back to its internal knowledge
- Consider using alternative search APIs for better coverage

### Rate Limiting
- Both DuckDuckGo and Google APIs have rate limits
- Add delays between requests if needed
- Consider implementing caching for repeated queries

## 📚 Additional Resources

- [LangChain Documentation](https://python.langchain.com/)
- [Google Gemini API Docs](https://ai.google.dev/docs)
- [LangChain Agents Guide](https://python.langchain.com/docs/modules/agents/)
- [Tool Creation Tutorial](https://python.langchain.com/docs/how_to/custom_tools/)

## 🔐 Security Notes

- **Never commit your `.env` file** to version control
- The `.gitignore` should include `.env`
- Rotate API keys regularly
- Monitor API usage to prevent unexpected charges

## 📄 License

This implementation is part of the thesis project and follows the project's license.

---

**Questions or Issues?** Check the main project README or documentation.
