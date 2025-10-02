# Agentic Search Integration Guide

This document describes the complete integration of the **Agentic Search Tool** (powered by LangChain + Google Gemini 2.0 Flash) into the news aggregation website.

## 🎯 Overview

The agentic search feature allows users to ask natural language questions and receive intelligent answers. The AI agent automatically decides when to use web search versus its internal knowledge, providing accurate and up-to-date information.

## 📦 Components

### Backend Components

#### 1. **Standalone Script** (`backend/agentic_search.py`)
- Complete agentic search implementation
- Custom DuckDuckGo search tool with `@tool` decorator
- LangChain agent orchestration
- Can be run independently for testing

#### 2. **API Endpoint** (`backend/app/main.py`)
- **Route:** `POST /api/search/agentic`
- **Request Body:**
  ```json
  {
    "query": "Your question here"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "query": "Your question here",
    "answer": "AI-generated answer with web search if needed",
    "error": null
  }
  ```

#### 3. **Pydantic Models**
```python
class AgenticSearchRequest(BaseModel):
    query: str

class AgenticSearchResponse(BaseModel):
    success: bool
    query: str
    answer: str
    error: Optional[str] = None
```

### Frontend Components

#### 1. **API Client Function** (`frontend/lib/api.ts`)
```typescript
export async function performAgenticSearch(query: string): Promise<AgenticSearchResponse>
```

#### 2. **Search Page** (`frontend/app/search/page.tsx`)
- Full-featured search interface
- Sample queries for users to try
- Loading states with animations
- Error handling
- Responsive design
- Info section explaining how it works

#### 3. **Navigation Integration** (`frontend/app/page.tsx`)
- "AI Search" button in main navigation
- Sparkles icon for visual appeal
- Accessible from all pages

#### 4. **UI Components**
- Uses shadcn/ui components:
  - `Button`, `Input`, `Card`, `Alert`
  - Lucide icons (`Search`, `Sparkles`, `Loader2`)

## 🚀 Usage

### For End Users

1. **Access the Search Page:**
   - Click "AI Search" button in the top navigation
   - Or navigate to `/search` directly

2. **Ask a Question:**
   - Type your question in the search box
   - Click "Search" or press Enter
   - Sample queries are provided for inspiration

3. **View Results:**
   - The AI agent processes your query
   - If needed, it searches the web for current information
   - You receive a comprehensive answer
   - Ask another question or return to news feed

### For Developers

#### Testing the Backend Endpoint

```bash
# Using curl
curl -X POST http://localhost:8000/api/search/agentic \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the current population of the United States?"}'

# Using httpie
http POST localhost:8000/api/search/agentic query="What is quantum computing?"

# Using Python
import requests
response = requests.post(
    "http://localhost:8000/api/search/agentic",
    json={"query": "What are the latest AI developments?"}
)
print(response.json())
```

#### Testing the Standalone Script

```bash
cd backend
python agentic_search.py
```

This runs the agent in interactive mode where you can ask questions directly.

## 🔧 Configuration

### Environment Variables

Required in `.env` file:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

The backend automatically uses `GEMINI_API_KEY` for both:
- Direct Gemini API calls (existing functionality)
- LangChain Google Generative AI integration (agentic search)

### Dependencies

Added to `backend/requirements.txt`:

```
langchain>=0.1.0
langchain-google-genai>=1.0.0
langchain-core>=0.1.0
```

Install with:
```bash
cd backend
pip install -r requirements.txt
```

## 🎨 UI/UX Features

### Search Page Design

1. **Hero Section:**
   - Eye-catching title with Sparkles icon
   - Clear description of capabilities
   - Professional gradient styling

2. **Search Interface:**
   - Large, prominent search input
   - Search icon for visual clarity
   - Disabled state during processing
   - Loading spinner with status text

3. **Sample Queries:**
   - 5 pre-written example questions
   - Click to populate search box
   - Helps users understand capabilities

4. **Results Display:**
   - Clean card-based layout
   - Shows original query
   - AI response badge for credibility
   - Formatted answer text
   - Error handling with alerts

5. **Information Section:**
   - Explains how the agent works
   - 3-step process breakdown
   - Technology attribution
   - Purple accent color for branding

### Responsive Design

- Mobile-first approach
- Adapts to all screen sizes
- Touch-friendly buttons
- Readable typography

## 🔄 Agent Workflow

1. **User submits query** → Frontend sends POST request to `/api/search/agentic`

2. **Backend receives request** → Validates query and initializes agent

3. **Agent analyzes query** → Gemini LLM determines if web search is needed

4. **Decision point:**
   - **Internal knowledge sufficient** → Agent responds directly
   - **Web search needed** → Agent calls `get_web_search_results` tool

5. **Tool execution** (if needed) → DuckDuckGo API fetches current information

6. **Synthesis** → Agent combines search results with its knowledge

7. **Response** → Backend returns formatted answer to frontend

8. **Display** → User sees the final answer

## 📊 Example Queries

### Queries That Use Web Search

- "What is the current population of the United States?"
- "What's the weather in New York today?"
- "Latest developments in quantum computing"
- "Who won the most recent Nobel Prize?"
- "Current stock price of Apple"

### Queries That Use Internal Knowledge

- "What is the capital of France?"
- "Explain how photosynthesis works"
- "What is 2+2?"
- "Define artificial intelligence"
- "Who wrote Romeo and Juliet?"

## 🛠️ Customization

### Adding More Tools

To extend the agent with additional capabilities:

```python
# In agentic_search.py

@tool
def my_custom_tool(param: str) -> str:
    """
    Description that the agent uses to understand when to call this tool.
    
    Args:
        param: Description of the parameter
        
    Returns:
        Description of what is returned
    """
    # Your implementation
    return result

# Add to tools list
tools = [get_web_search_results, my_custom_tool]
```

### Modifying the Search API

Replace DuckDuckGo with another search service:

```python
@tool
def get_web_search_results(query: str) -> str:
    """Your custom docstring"""
    # Call your preferred search API
    # Examples: Google Custom Search, Bing, SerpAPI, etc.
    return results
```

### Adjusting AI Behavior

Modify the system prompt in `create_agent_executor()`:

```python
prompt = ChatPromptTemplate.from_messages([
    ("system", """Your custom instructions here.
    
    Customize:
    - Tone (professional, casual, technical)
    - Response length preferences
    - Citation requirements
    - Error handling approach
    """),
    # ... rest of template
])
```

### Changing the LLM Model

```python
llm = ChatGoogleGenerativeAI(
    model="gemini-1.5-pro",  # More capable but slower
    # or "gemini-1.5-flash"  # Good balance
    # or "gemini-2.0-flash"  # Fastest (current default)
    temperature=0.7,  # Adjust creativity (0.0-1.0)
)
```

## 🐛 Troubleshooting

### Common Issues

**1. "GEMINI_API_KEY not found"**
- Ensure `.env` file exists in `backend/` directory
- Check that `GEMINI_API_KEY` is set
- Verify the API key is valid

**2. "Module not found: langchain"**
```bash
cd backend
pip install -r requirements.txt
```

**3. Search returns empty results**
- DuckDuckGo may not have results for all queries
- Agent will fall back to internal knowledge
- Consider using alternative search APIs for better coverage

**4. Slow responses**
- Web search adds latency (5-10 seconds typical)
- Consider caching frequent queries
- Use faster Gemini model (2.0-flash)

**5. API endpoint returns 500 error**
- Check backend logs for detailed error
- Verify all dependencies are installed
- Ensure API key is valid and has quota

## 📈 Performance Considerations

### Response Times

- **Internal knowledge only:** 1-3 seconds
- **With web search:** 5-15 seconds (depends on search API)
- **Total (including network):** Add 0.5-2 seconds for frontend/backend communication

### Rate Limiting

- **Google Gemini API:** Free tier has rate limits
- **DuckDuckGo API:** No explicit rate limits, but avoid abuse
- Consider implementing request throttling for production

### Caching Strategy

For frequently asked questions, consider:

```python
# Simple in-memory cache (example)
from functools import lru_cache

@lru_cache(maxsize=100)
def cached_search(query: str) -> str:
    # Agent execution
    pass
```

## 🔐 Security Considerations

1. **API Key Protection:**
   - Never commit `.env` to version control
   - Use environment variables in production
   - Rotate keys regularly

2. **Input Validation:**
   - Backend validates query is not empty
   - Consider rate limiting per user
   - Sanitize input to prevent injection

3. **Error Messages:**
   - Don't expose internal errors to users
   - Log detailed errors server-side
   - Return user-friendly messages

## 📚 Additional Resources

- [LangChain Documentation](https://python.langchain.com/)
- [Google Gemini API Docs](https://ai.google.dev/docs)
- [DuckDuckGo Instant Answer API](https://duckduckgo.com/api)
- [Standalone Implementation Guide](./backend/AGENTIC_SEARCH_README.md)
- [Quick Start Guide](./backend/AGENTIC_SEARCH_QUICKSTART.md)

## 🎉 What's Next?

Potential enhancements:

1. **Conversation History:** Maintain context across multiple queries
2. **Source Citations:** Display links to search results used
3. **Response Streaming:** Stream the answer as it's generated
4. **More Tools:** Add tools for weather, stocks, calculations, etc.
5. **User Preferences:** Remember user's preferred answer style
6. **Analytics:** Track popular queries and agent decisions

---

**Integration Complete!** The agentic search is now fully functional in your news aggregation platform. Users can access it via the "AI Search" button in the navigation. 🚀
