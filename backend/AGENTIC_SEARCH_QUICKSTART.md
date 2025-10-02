# 🚀 Quick Start: Agentic Search Tool

Get your intelligent search agent running in 3 minutes!

## Step 1: Install Dependencies (1 minute)

```bash
cd backend
pip install -r requirements.txt
```

This installs:
- `langchain` - Agent framework
- `langchain-google-genai` - Gemini integration
- `langchain-core` - Core LangChain components
- Plus existing dependencies (requests, python-dotenv, etc.)

## Step 2: Set Your API Key (1 minute)

### Option A: Copy and Edit .env

```bash
cp .env.example .env
```

Then edit `.env` and add your Google API key:

```env
GOOGLE_API_KEY=AIzaSy...your-actual-key-here
```

### Option B: Set Environment Variable Directly

```bash
export GOOGLE_API_KEY="AIzaSy...your-actual-key-here"
```

**Get an API Key:** https://makersuite.google.com/app/apikey (Free!)

## Step 3: Run the Agent (30 seconds)

```bash
python agentic_search.py
```

## 🎉 That's It!

You should see output like this:

```
================================================================================
Agentic Search Tool - Powered by Gemini 2.0 Flash
================================================================================

Query: What is the current population of the United States?
--------------------------------------------------------------------------------

> Entering new AgentExecutor chain...

Invoking: `get_web_search_results` with `{'query': 'current population United States'}`


The current population of the United States is approximately 331.9 million people.

> Finished chain.

================================================================================
FINAL ANSWER:
================================================================================
The current population of the United States is approximately 331.9 million people.

================================================================================
Interactive Mode - Type 'quit' to exit
================================================================================

Your question: 
```

## 💡 Try These Sample Queries

In interactive mode, try asking:

```
What is the capital of France?
(Should answer without web search)

What's the current weather in New York?
(Will use web search)

Tell me about the latest AI developments
(Will use web search for current info)

What is 2+2?
(Should answer without web search)
```

## 🔍 What's Happening Behind the Scenes?

1. **Agent Receives Query** → Gemini LLM analyzes the question
2. **Decision Point** → Does it need real-time data?
   - **No** → Answers from internal knowledge
   - **Yes** → Calls `get_web_search_results` tool
3. **Tool Execution** → DuckDuckGo API fetches current info
4. **Synthesis** → Agent combines results into clear answer
5. **Response** → Final answer presented to user

## 📊 Understanding Verbose Output

When `verbose=True`, you see the agent's thought process:

```
> Entering new AgentExecutor chain...        ← Agent starts
Invoking: `get_web_search_results`          ← Decides to use tool
  with `{'query': '...'}`                    ← Parameters for tool

[tool output]                                ← Tool returns results

[agent reasoning]                            ← Agent processes results

> Finished chain.                            ← Agent completes
```

This is invaluable for:
- **Debugging**: See why the agent made certain decisions
- **Learning**: Understand agent reasoning patterns
- **Optimization**: Identify performance bottlenecks

## 🛠️ Quick Customizations

### Use a Different Model

Edit `agentic_search.py` line ~103:

```python
llm = ChatGoogleGenerativeAI(
    model="gemini-1.5-pro",  # More powerful but slower
    # or "gemini-1.5-flash"  # Good balance
    # or "gemini-2.0-flash"  # Fastest (default)
)
```

### Disable Verbose Output

Edit line ~138:

```python
agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=False,  # Change to False for quiet mode
)
```

### Change Temperature (Creativity)

Edit line ~104:

```python
llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    temperature=0.0,  # 0.0 = deterministic, 1.0 = creative
)
```

## 🐛 Common Issues & Fixes

### "GOOGLE_API_KEY not found"

```bash
# Check if .env exists
ls -la .env

# If not, create it
cp .env.example .env

# Edit and add your key
nano .env
```

### "No module named 'langchain'"

```bash
# Reinstall dependencies
pip install -r requirements.txt

# Or install individually
pip install langchain langchain-google-genai langchain-core
```

### "Import Error" for ChatGoogleGenerativeAI

```bash
# Make sure you have the correct package
pip install langchain-google-genai --upgrade
```

### Agent Not Using Search Tool

- The agent decides when to use tools based on the query
- Try queries that require current data (weather, populations, etc.)
- Check the tool's docstring - it guides the agent's decision

## 📖 Next Steps

- **Read Full Docs**: See `AGENTIC_SEARCH_README.md` for details
- **Add Custom Tools**: Extend with your own tools
- **Integrate**: Use in your existing applications
- **Experiment**: Try different prompts and models

## 🎓 Understanding the Code

**Key Components:**

1. **Tool Definition** (Lines ~19-81)
   ```python
   @tool
   def get_web_search_results(query: str) -> str:
   ```

2. **Agent Creation** (Lines ~84-147)
   ```python
   def create_agent_executor():
   ```

3. **Main Loop** (Lines ~150-215)
   ```python
   def main():
   ```

**Architecture:**
```
User Query
    ↓
Gemini LLM (Reasoning)
    ↓
Agent Decision (Use tool or not?)
    ↓
Tool Execution (if needed)
    ↓
Result Synthesis
    ↓
Final Answer
```

## 💬 Get Help

- Check `AGENTIC_SEARCH_README.md` for detailed documentation
- LangChain Docs: https://python.langchain.com/
- Gemini API Docs: https://ai.google.dev/docs

---

**Happy Building! 🎉**
