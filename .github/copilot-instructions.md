
# Copilot Instructions for Thesis Project

This is a full-stack news aggregation platform with AI-powered research, analysis, and fact-checking. Built for rapid experimentation with **FastAPI backend**, **Next.js 14 frontend**, and **Google Gemini AI integration** **ChromaDB** and PostgreSQL.

## Reply Style
- Don't use emojis
- Use concise, clear language
- Provide step-by-step instructions for tasks
- Reference specific files and line numbers when relevant

## Architecture & Data Flow

### Core Components
- **Backend**: `backend/app/main.py` (2200+ lines) - FastAPI with RSS parsing, Gemini AI, LangChain agents
- **Frontend**: `frontend/app/` - Next.js 14 (TypeScript, Tailwind CSS, shadcn/ui)
- **API Layer**: `frontend/lib/api.ts` - Centralized backend communication with Docker-aware URL switching
- **State**: In-memory cache (`NewsCache` class) stores articles/stats; no database yet (PostgreSQL+ChromaDB planned)

### Critical Data Flows
1. **RSS Ingestion**: `fetch_rss_feed()` → `NewsCache` → SSE streaming via `/news/stream` → `useNewsStream` hook
2. **AI Analysis**: Article URL → `newspaper3k` extraction → Gemini prompt → structured JSON response
3. **Agentic Search**: User query → LangChain agent → DuckDuckGo tool → streaming SSE with chain-of-thought
4. **News Research**: Query → cached article search → LangChain agent → Gemini synthesis → markdown + JSON articles

### Port & URL Logic (CRITICAL)
- **Backend**: Port 8000 (Docker & local dev)
- **Frontend**: Port 3000
- **API_BASE_URL**: `frontend/lib/api.ts` defaults to `http://localhost:8000` but reads `NEXT_PUBLIC_API_URL` env var
- Docker Compose sets `NEXT_PUBLIC_API_URL=http://localhost:8000` (both services use `thesis_network` bridge)

## Developer Workflows

### Start Everything (Recommended)
```bash
docker compose up --build
# Frontend: http://localhost:3000
# API docs: http://localhost:8000/docs
```

### Backend Only (for Gemini testing)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
**Required**: Create `backend/.env` with `GEMINI_API_KEY=your_key_here`

### Frontend Only
```bash
cd frontend
npm install
npm run dev  # Port 3000
```

### Key Commands
- **Rebuild containers**: `docker compose up --build`
- **View logs**: `docker compose logs -f backend` or `docker compose logs -f frontend`
- **Debug backend**: Check `http://localhost:8000/docs` (Swagger UI) for all endpoints
- **Debug streams**: `GET /debug/streams` shows active RSS stream stats
- **Cache status**: `GET /cache/status` shows article count, last fetch time, source stats

## Project Patterns & Conventions

### Backend Patterns
- **Global Singletons**: `stream_manager`, `news_cache`, `manager` (WebSocket) - initialized at module level
- **SSE Streaming**: Use `StreamingResponse` with `async def generate()` generators (see `/news/stream`, `/api/news/research/stream`)
- **Rate Limiting**: `stream_manager.should_throttle_source()` enforces 10s minimum between same-source fetches
- **Error Recovery**: RSS parsing uses exponential backoff with jitter; failed sources don't block others
- **Gemini Integration**: All AI features use `genai.Client(api_key=GEMINI_API_KEY)` with `gemini-2.0-flash-exp` model
- **Article Extraction**: `newspaper3k` for full-text parsing; falls back to RSS description if extraction fails

### Frontend Patterns
- **Component Structure**: Export as `export function ComponentName()` (not `export default` except for pages)
- **Streaming Hook**: `useNewsStream` manages SSE connection lifecycle, abort controllers, retry logic (max 3 retries)
- **API Functions**: All backend calls go through `frontend/lib/api.ts` - NEVER hardcode fetch URLs in components
- **Type Safety**: Define interfaces in `frontend/lib/api.ts` (e.g., `NewsArticle`, `StreamProgress`, `StreamEvent`)
- **Loading States**: Use `isStreaming`, `progress`, `status` from `useNewsStream` - show percentage/message to user
- **Error Handling**: Display errors from `errors` array; allow retry via `startStream()`

### React Conventions
- Use TypeScript with explicit interfaces (avoid `any`)
- Prefer `const` for components: `export function MyComponent() {}`
- Use shadcn/ui components (`Button`, `Card`, `Dialog`, `Tabs`, etc.) - located in `frontend/components/ui/`
- Tailwind for styling - custom CSS variables in `globals.css` (e.g., `--news-bg-primary`, `--news-card-bg`)
- Custom hooks for complex state (see `useNewsStream.ts` for SSE management pattern)
- Combine related components in same file for cohesion (e.g., modal + display component)

### Styling Conventions
- **Typography**: Main headers use serif font (Garamond-style), body text uses `GeistSans` variable font
- **Colors**: Dark theme with `--news-bg-primary` (black), `--news-bg-secondary` (20% lighter black for cards)
- **Hover States**: Always add hover effects to buttons/cards (currently missing on some buttons per `Todo.md`)
- **Responsive**: Mobile-first with Tailwind breakpoints (`sm:`, `md:`, `lg:`)

## Critical Integration Points

### RSS Sources (`backend/app/main.py` lines 195-350)
- `RSS_SOURCES` dict: keys are source names, values have `url`, `category`, `country`, `funding_type`, `bias_rating`
- **Associated Press** has array of 14 category-specific feeds - special handling in `fetch_rss_feed()`
- BBC, CNN, Reuters, NPR, Fox News each have single feeds
- Add new sources here; they auto-appear in UI

### Gemini AI Features
1. **Article Analysis** (`/api/article/analyze`):
   - Extracts article with `newspaper3k`
   - Sends structured prompt for source credibility, reporter background, bias analysis
   - Returns `ArticleAnalysisResponse` with nested objects (see Pydantic models ~line 1950)
   - Frontend: `article-detail-modal.tsx` triggers, `article-analysis.tsx` renders

2. **News Research Agent** (`/api/news/research/stream`):
   - Uses `backend/news_research_agent.py` (LangChain + custom tools)
   - Searches cached articles via `@tool def search_news_articles()`
   - Streams thinking steps + final answer via SSE
   - Returns markdown text + JSON array of cited articles
   - Frontend: Parse SSE events with `type` field ('thinking', 'thinking_end', 'answer', 'articles', 'complete')

3. **Agentic Search** (`backend/agentic_search.py`):
   - Standalone CLI tool and FastAPI integration
   - LangChain agent with DuckDuckGo search tool
   - Use when query needs external web search vs. cached articles

### Streaming Architecture (CRITICAL)
- **Backend**: All streams use `text/event-stream` with `data: {json}\n\n` format
- **Frontend**: `streamNews()` in `api.ts` parses SSE, handles reconnection, manages AbortController
- **Hook Pattern**: `useNewsStream` wraps streaming logic; components call `startStream()` and read state
- **Progress Tracking**: Each stream emits `progress` events with `{completed, total, percentage}`
- **Source Completion**: Individual sources emit before stream ends - allows incremental UI updates
- **Error Recovery**: Failed sources logged but don't abort stream; retry logic in frontend

### Image Parsing (Known Issues per `Todo.md`)
- **Working**: BBC, Reuters, NPR, Fox News, AP
- **Broken**: New York Times, CNN - images found in RSS but not parseable by frontend
- **Root Cause**: Mixed HTTP/HTTPS protocols, redirects, or invalid image URLs in RSS feed
- **Debug**: Use `/debug/source/{source_name}` endpoint to inspect raw RSS parsing

## Environment Variables

### Backend (`backend/.env`)
```env
GEMINI_API_KEY=your_api_key_here  # REQUIRED for AI features
```

### Frontend (Docker Compose sets these)
```env
NEXT_PUBLIC_API_URL=http://localhost:8000  # Backend URL
NEXT_PUBLIC_DOCKER_API_URL=http://localhost:8000  # Fallback for Docker
```

## Testing & Debugging

### Backend Tests
- `pytest` (basic tests exist but coverage incomplete)
- Manual: Use Swagger UI at `http://localhost:8000/docs`

### Frontend Tests
- Planned: Jest + React Testing Library (not yet implemented)

### Debug Endpoints
- `GET /debug/source/{source_name}` - Raw RSS feed parsing details
- `GET /debug/streams` - Active stream statistics
- `GET /cache/status` - Article cache info
- `GET /sources/stats` - Success/fail counts per source

### Logging
- Backend uses `logging` module; configure level in `main.py` line ~35
- Stream-specific logger: `stream_logger` (DEBUG level)
- Frontend: `console.log` extensively used (should add toggle per `Todo.md`)

## Key Files Reference

### Backend
- `backend/app/main.py` - Monolithic FastAPI app (2200+ lines) with all endpoints, RSS parsing, caching
- `backend/news_research_agent.py` - LangChain agent for article search + web fallback
- `backend/agentic_search.py` - DuckDuckGo-powered search agent (CLI + API)
- `backend/requirements.txt` - Dependencies (FastAPI, LangChain, Gemini, newspaper3k, etc.)

### Frontend
- `frontend/lib/api.ts` - All backend API functions (950+ lines) - START HERE for API integration
- `frontend/hooks/useNewsStream.ts` - SSE streaming hook with retry/abort logic
- `frontend/components/article-detail-modal.tsx` - Article modal with AI analysis trigger
- `frontend/components/grid-view.tsx` - Main article grid with streaming integration
- `frontend/app/page.tsx` - Homepage with news feed
- `frontend/app/search/page.tsx` - Agentic search interface

## Documentation Organization Rule (CRITICAL)

**NEVER create new markdown files. after you are done** All documentation must go into ONE of these existing files:
- **`README.md`** - User-facing docs, setup instructions, feature overview
- **`Todo.md`** - Actionable tasks, bugs, feature requests  
- **`Log.md`** - Development notes, technical guides, integration docs, decisions, change log
- **`Project file.md`** - Vision, tech decisions, phase planning
- **`.github/copilot-instructions.md`** - This file (AI agent guidance)

## Markdown File Usage
- Have it be concise and well-organized
- Use clear section headers
- Don't use emojis or informal language
- When adding user-facing docs (setup, usage, features): **APPEND to README.md
- When adding tasks, bugs, feature requests: **APPEND to Todo.md** with priority
- When adding development notes, technical decisions, or change logs: **APPEND to Log.md** with date

When creating technical guides, integration docs, or reference material: **APPEND to Log.md** with clear section headers.
Do NOT create files like `DATABASE_INTEGRATION_GUIDE.md`, `MIGRATION_GUIDE.md`, etc.)

## Common Tasks

### Adding a New RSS Source
1. Add to `RSS_SOURCES` dict in `backend/app/main.py` (~line 195)
2. Include: `url`, `category`, `country`, `funding_type`, `bias_rating`
3. Test with `GET /debug/source/{new_source_name}`
4. Source auto-appears in frontend dropdown

### Creating a New API Endpoint
1. Define Pydantic models in `backend/app/main.py`
2. Add `@app.get()` or `@app.post()` decorator
3. Update `frontend/lib/api.ts` with typed function
4. Call from components via imported API function
5. Check Swagger docs to verify

### Adding Gemini AI Feature
1. Create structured prompt (see `analyze_with_gemini()` example)
2. Use `gemini_client.models.generate_content()`
3. Parse response JSON
4. Define Pydantic response model
5. Add frontend component to display results

### Debugging Streaming Issues
1. Check browser Network tab for `text/event-stream` connection
2. Verify SSE format: `data: {json}\n\n`
3. Test `useNewsStream` hook with `console.log` in callbacks
4. Check backend logs for stream lifecycle messages
5. Use `GET /debug/streams` to see active streams
