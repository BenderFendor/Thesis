# Thesis News Platform

A full-stack news aggregation platform that blends curated RSS feeds with AI-assisted research, analysis, and fact-checking. The project consists of a FastAPI backend and a Next.js 14 frontend, with local Postgres and Chroma services for storage and retrieval.

## Architecture & Tech Stack
- **Backend**: FastAPI (Python 3.11+), `backend/app/main.py`
- **Frontend**: Next.js 14 (TypeScript, Tailwind CSS, shadcn/ui), `frontend/app`
- **Data**: RSS ingestion with PostgreSQL + ChromaDB for storage and search
- **State Management**: Zustand for client-side state
- **AI/LLM**: OpenRouter (Gemini 3 Flash) or direct Gemini 3 Flash via LangChain
- **Local Services**: `runlocal.sh` starts Postgres, Chroma, backend, and frontend without Docker
- **3D/Interactive Visuals**: Three.js globe (future milestones)

## Quick Start
### Local Services (Recommended)
```bash
./runlocal.sh services
./runlocal.sh all
```
Frontend: http://localhost:3000  
Backend docs: http://localhost:8000/docs

### Manual Backend Setup
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Manual Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### Arch or Manjaro Postgres Setup
```bash
sudo pacman -S postgresql
sudo -iu postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
```

### Required Environment Variables
Create `backend/.env` (copy from `.env.example`) and set at least one provider:
```env
OPEN_ROUTER_API_KEY=your_api_key_here
# Optional overrides
OPEN_ROUTER_MODEL=google/gemini-3-flash-preview

# Optional direct Gemini access
GEMINI_API_KEY=your_api_key_here
```
The backend uses these for analysis, research agents, and fact-checking. Restart the backend after updating keys.

### Quick AI Smoke Test
1. Start backend and frontend.
2. Visit the news feed.
3. Open any article and click **AI Analysis**.
4. Wait for the analysis response.
5. Verify summary, bias analysis, and fact-check sections appear.

## Feature Overview
- **AI Article Analysis** – Full-text extraction, source/reporter insights, bias detection, and fact-check suggestions in one OpenRouter/Gemini call.
- **Agentic Search** – LangChain-powered agent that decides when to execute web searches (DuckDuckGo) vs. internal knowledge.
- **News Research Agent** – Searches cached articles, compares sources, exposes chain-of-thought, and falls back to web search when needed.
- **Structured Research Responses** – SSE streaming that delivers markdown answers plus JSON article payloads for UI embeds.
- **Fact-Checking Pipeline** – Single-call OpenRouter/Gemini workflow that returns claims, evidence, and confidence fields.
- **Reader Annotations** – Select text, add notes, and export markdown for Obsidian.
- **Agentic Debug Logs** – JSONL log files with backend traces and frontend performance payloads.

---

## AI Article Analysis

### Capabilities
- Full article extraction via `newspaper3k`.
- Source credibility: ownership, funding model, political leaning, reputation.
- Reporter background: expertise, known biases, notable work.
- Bias diagnostics: tone, framing, selection, source diversity, overall score.
- Fact-check suggestions and AI-generated summary.

### Backend Flow (`backend/app/main.py`)
1. `extract_article_content` downloads and parses article content.
2. `analyze_with_gemini` submits structured prompt to Gemini.
3. `/api/article/analyze` orchestrates extraction + analysis and returns rich JSON.

### Frontend Integration
- `frontend/components/article-analysis.tsx` renders collapsible analysis sections.
- `frontend/components/article-detail-modal.tsx` triggers analysis from the modal and handles loading states.
- Bias results use color-coded badges; fact-check results link to evidence.
- AI analysis is opt-in to reduce background API calls.

### Setup Checklist
- Obtain an OpenRouter or Gemini API key and place in `backend/.env`.
- Install dependencies (`uv pip install -r requirements.txt`).
- Start backend and verify `/api/article/analyze` in Swagger docs.
- Trigger analysis from UI and confirm results populate.

### Troubleshooting
- **Missing API key**: ensure `.env` exists and restart backend.
- **Extraction failures**: some domains block scraping—fall back to cached content or choose another article.
- **Slow responses**: measure in your setup; monitor rate limits and consider caching.

---

## Agentic Search

### Components
- `backend/agentic_search.py`: LangChain agent with DuckDuckGo tool and interactive CLI.
- FastAPI endpoint `POST /api/search/agentic` using `AgenticSearchRequest/Response` Pydantic models.
- Frontend integration via `performAgenticSearch` (`frontend/lib/api.ts`) and UI on `/search` and main navigation.

### Workflow
1. User submits query from `/search` page or navigation shortcut.
2. Backend agent decides whether to call `get_web_search_results` tool.
3. Gemini 3 Flash synthesizes internal knowledge with optional web search output.
4. Response includes `success`, original query, and formatted answer.

### Running Standalone
```bash
cd backend
python agentic_search.py
```
The script first demos a population query, then enters interactive mode (`quit` to exit).

### Customization Hooks
- Swap search provider by editing `get_web_search_results`.
- Add tools with additional `@tool` functions.
- Modify system prompt or model (e.g. `gemini-3-flash-preview`, temperature adjustments).
- Enable chat history via LangChain memory.

### Troubleshooting
- **Missing LangChain**: re-run `uv pip install -r requirements.txt`.
- **Empty search results**: DuckDuckGo may not cover niche queries; swap providers if needed.
- **Slow responses**: consider caching or lowering tool usage via prompt tweaks.

---

## News Research Agent

### Summary
- Searches cached articles first, comparing source coverage before falling back to DuckDuckGo.
- Reasoning-step visualization streams via SSE with action/tool/observation labels.
- Structured article payload (`json:articles`) powers inline grids beneath markdown responses.
- `/search` workspace mirrors the main site theme and offers Brief, Flow, and Canvas views.

### Backend Implementation
- `backend/news_research_agent.py`: three tools (`search_news_articles`, `analyze_source_coverage`, `get_web_search_results`), streaming callback handler, standalone testing entry point.
- FastAPI endpoints:
  - `POST /api/news/research`: returns final answer plus full reasoning history.
  - `GET /api/news/research/stream`: SSE stream with `status`, `thinking_step`, `articles_json`, `referenced_articles`, and `complete` events.
- Integrates with `news_cache.get_articles()` for in-memory article access.

### Frontend Experience (`frontend/app/search/page.tsx`)
- Emerald-accented layout with shared header and responsive cards.
- Sample queries, advanced loading states, thinking step timeline with icons.
- Markdown rendering via `react-markdown` + `remark-gfm` for clean answers.
- Related Articles grid triggered when structured JSON payload arrives; clicking an article opens the shared `ArticleDetailModal`.

### Sample Queries
- “Compare how sources cover AI.”
- “Summarize the latest political developments.”
- “Which sources haven’t covered the new policy?”

### Future Enhancements (see `Todo.md` for detailed roadmap)
- Article link enrichment in markdown.
- Conversation memory for multi-turn sessions.
- Advanced filters (date, source credibility, categories).

---

## Fact-Checking & Structured Responses

### Fact-Checking Pipeline
- Single OpenRouter Gemini 3 Flash call performs summary, bias, reporter analysis, fact-check suggestions, and claim verification fields.
- Response augments `ArticleAnalysisResponse` with `fact_check_results` (claim, verification status, evidence, sources, confidence, notes).
- Frontend shows verification results with colored badges (verified, partially verified, unverified, false).
- If you need grounded verification, wire a web-search tool into the analysis flow and measure the cost/latency tradeoff in your setup.

### Structured Research Response
- Backend embeds referenced articles inside markdown using ```json:articles code blocks.
- SSE stream emits separate `articles_json` and `complete` events so UI can render markdown and article grids independently.
- UI gracefully handles missing structured data while preserving markdown-only responses.

### Debugging Tips
- Ensure OpenRouter or Gemini credentials are set before testing AI flows.
- Inspect SSE event order when debugging UI rendering.
- Fallback to cached article info if structured block parsing fails.

---

## Agentic Debug Logs
Backend writes structured JSONL logs to `/tmp/scoop_debug_logs`. Frontend performance reports are posted to `/debug/logs/frontend` and stored in the same session log.

To force frontend uploads outside development, set `NEXT_PUBLIC_ENABLE_AGENTIC_LOGGING=true`.

### Debug Entry Points
- `GET /debug/logs/report` for a full agentic debug report
- `GET /debug/logs/files` to list JSONL log files
- `GET /debug/logs/file/{filename}` to read events
- `GET /debug/logs/frontend` to review recent frontend payloads

---

## API Reference (Key Endpoints)
| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/article/analyze` | Extracts article content and returns OpenRouter/Gemini-powered analysis, bias, and fact checks. |
| POST | `/api/search/agentic` | Executes LangChain agentic search with optional web lookup. |
| POST | `/api/news/research` | Runs news research agent, returning answer + thinking steps. |
| GET | `/api/news/research/stream` | Streams research progress, structured articles, and final answer. |
| GET | `/article/extract` | Fast article extraction endpoint without AI analysis (used by modal). |

Refer to backend `app/main.py` for complete schema definitions.

---

## Frontend Notes
- Components follow TypeScript strict mode and shadcn/ui patterns (`frontend/components`).
- Tailwind CSS is the default styling approach (`frontend/app/globals.css`).
- `ArticleDetailModal` supports compact/expanded modes, integrates AI analysis asynchronously, and adopts magazine-style layout in expanded mode.

---

## Developer Guidelines
- Leverage `frontend/lib/api.ts` for backend communication; base URL logic adapts to Docker vs. localhost.
- Validate inputs with Zod, encapsulate state/effects within custom hooks, and favor server components/actions when possible.
- Combine related hooks/components for cohesion; avoid deep prop drilling.
- Use Suspense/streaming for async data and Zustand for client state where needed.
- Tailwind + shadcn/ui is the styling convention; global styles live in `frontend/app/globals.css`.
- Documentation belongs in `README.md`, `Todo.md`, or `Log.md` only (per project rule).
- Testing: backend via `pytest`; frontend via `npm test` (Jest/RTL planned).

---

## Project Structure & Roadmap
### Repository Layout
```
Thesis/
├── backend/
│   ├── app/main.py
│   ├── agentic_search.py
│   ├── news_research_agent.py
│   └── requirements.txt
├── frontend/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   └── lib/
├── docker-compose.yml
├── Log.md
├── Todo.md
└── README.md
```

### Phase Roadmap
1. **Phase 1 – MVP (Complete)**: RSS feed ingestion, multi-source aggregation, responsive UI, Dockerization.
2. **Phase 2 – Enhanced Features**: SQL persistence, source transparency, ChromaDB clustering, user preferences/bookmarking, PWA groundwork.
3. **Phase 3 – Global Expansion**: International sources, translations, Three.js globe, multilingual support.
4. **Phase 4 – Advanced Intelligence**: Local LLM summarization, automated scraping, recommendation engine, expanded fact-check integrations.

For actionable tasks and follow-ups, see `Todo.md`. Historical context and release notes are documented in `Log.md`.

---

---

## Additional Resources
- LangChain docs: https://python.langchain.com/
- Google Gemini API: https://ai.google.dev/docs
- DuckDuckGo Instant Answer API: https://duckduckgo.com/api
- Newspaper3k docs: https://newspaper.readthedocs.io/

---

**Built for media literacy, transparency, and AI-assisted news exploration.**

# For this project
I'm using docker so just use docker compose up to run the front and backend
