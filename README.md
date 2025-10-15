# Thesis News Platform

A full-stack news aggregation platform that blends curated RSS feeds with AI-assisted research, analysis, and fact-checking. The project consists of a FastAPI backend and a Next.js 14 frontend, orchestrated through Docker Compose, and is optimized for rapid experimentation with Google Gemini-powered features.

## Architecture & Tech Stack
- **Backend**: FastAPI (Python 3.11+), `backend/app/main.py`
- **Frontend**: Next.js 14 (TypeScript, Tailwind CSS, shadcn/ui), `frontend/app`
- **Data**: RSS ingestion with optional PostgreSQL & ChromaDB roadmap
- **State Management**: Zustand for client-side state
- **AI/LLM**: Google Gemini 2.0 Flash via LangChain
- **Containerization**: `docker-compose.yml` launches backend and frontend together
- **3D/Interactive Visuals**: Three.js globe (future milestones)

## Quick Start
### All Services (Recommended)
```bash
docker compose up --build
```
Frontend: http://localhost:3000  
Backend docs: http://localhost:8001/docs

### Manual Backend Setup
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

### Manual Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### Required Environment Variables
Create `backend/.env` (copy from `.env.example`) and set:
```env
GEMINI_API_KEY=your_api_key_here
# Optional: re-enable live RSS polling (defaults to sample dataset in dev)
# ENABLE_LIVE_INGESTION=true
```
The backend uses this for Gemini-powered analysis, agentic search, and fact-checking. Restart the backend after updating keys.

> ℹ️ **Offline-friendly default**: When `ENABLE_LIVE_INGESTION` is not set, the backend skips external RSS calls and streams a curated sample news dataset instantly. Set the flag to `true` when you want full live ingestion.

### Quick AI Smoke Test
1. Start backend and frontend.
2. Visit the news feed.
3. Open any article and click **AI Analysis**.
4. Wait ~15 seconds for Gemini response.
5. Verify summary, bias analysis, and fact-check sections appear.

## Feature Overview
- **AI Article Analysis** – Full-text extraction, source/reporter insights, bias detection, and fact-check suggestions in one Gemini call.
- **Agentic Search** – LangChain-powered agent that decides when to execute web searches (DuckDuckGo) vs. internal knowledge.
- **News Research Agent** – Searches cached articles, compares sources, exposes chain-of-thought, and falls back to web search when needed.
- **Structured Research Responses** – SSE streaming that delivers markdown answers plus JSON article payloads for UI embeds.
- **Fact-Checking Pipeline** – Single-call Gemini workflow with Google Search grounding that verifies claims and returns confidence, evidence, and sources.

---

## AI Article Analysis
Adapted from `AI_ANALYSIS_SETUP.md` and `QUICK_START_AI.md`.

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

### Setup Checklist
- Obtain Gemini API key and place in `backend/.env`.
- Install dependencies (`pip install -r requirements.txt`).
- Start backend and verify `/api/article/analyze` in Swagger docs.
- Trigger analysis from UI and confirm results populate.

### Troubleshooting
- **Missing API key**: ensure `.env` exists and restart backend.
- **Extraction failures**: some domains block scraping—fall back to cached content or choose another article.
- **Slow responses**: normal (10–30 seconds). Monitor rate limits and consider caching.

---

## Agentic Search
Consolidated from `AGENTIC_SEARCH_INTEGRATION.md`, `backend/AGENTIC_SEARCH_README.md`, and `backend/AGENTIC_SEARCH_QUICKSTART.md`.

### Components
- `backend/agentic_search.py`: LangChain agent with DuckDuckGo tool and interactive CLI.
- FastAPI endpoint `POST /api/search/agentic` using `AgenticSearchRequest/Response` Pydantic models.
- Frontend integration via `performAgenticSearch` (`frontend/lib/api.ts`) and UI on `/search` and main navigation.

### Workflow
1. User submits query from `/search` page or navigation shortcut.
2. Backend agent decides whether to call `get_web_search_results` tool.
3. Gemini 2.0 Flash synthesizes internal knowledge with optional web search output.
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
- Modify system prompt or model (`gemini-1.5-pro`, temperature adjustments).
- Enable chat history via LangChain memory.

### Troubleshooting
- **Missing LangChain**: re-run `pip install -r requirements.txt`.
- **Empty search results**: DuckDuckGo may not cover niche queries; swap providers if needed.
- **Slow responses**: consider caching or lowering tool usage via prompt tweaks.

---

## News Research Agent
Derived from `NEWS_RESEARCH_AGENT.md`, `SEARCH_PAGE_REDESIGN.md`, and `SEARCH_STRUCTURED_RESPONSE.md`.

### Highlights
- Searches cached articles first, comparing source coverage before falling back to DuckDuckGo.
- Chain-of-thought visualization streams via SSE with action/tool/observation labels.
- Structured article payload (`json:articles`) powers inline grids beneath markdown responses.
- Redesigned `/search` page mirrors main site header, dark theme, and modern UI patterns.

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
Summarized from `FACT_CHECK_IMPLEMENTATION.md` and `SEARCH_STRUCTURED_RESPONSE.md`.

### Fact-Checking Pipeline
- Single Gemini call (`gemini-2.0-flash-exp`) performs summary, bias, reporter analysis, fact-check suggestions, and **fact verification** with Google Search grounding.
- Response augments `ArticleAnalysisResponse` with `fact_check_results` (claim, verification status, evidence, sources, confidence, notes) and `grounding_metadata`.
- Frontend highlights verification results with colored badges (✅ verified, ⚠️ partially verified, ❓ unverified, ❌ false) and evidence links.
- Performance gains: ~80% token reduction and ~70% latency improvement compared to multi-call approach.

### Structured Research Response
- Backend embeds referenced articles inside markdown using ```json:articles code blocks.
- SSE stream emits separate `articles_json` and `complete` events so UI can render markdown and article grids independently.
- UI gracefully handles missing structured data while preserving markdown-only responses.

### Debugging Tips
- Ensure Gemini credentials allow Google Search grounding.
- Inspect SSE event order when debugging UI rendering.
- Fallback to cached article info if structured block parsing fails.

---

## API Reference (Key Endpoints)
| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/article/analyze` | Extracts article content and returns Gemini-powered analysis, bias, and fact checks. |
| POST | `/api/search/agentic` | Executes LangChain agentic search with optional web lookup. |
| POST | `/api/news/research` | Runs news research agent, returning answer + thinking steps. |
| GET | `/api/news/research/stream` | Streams research progress, structured articles, and final answer. |
| GET | `/article/extract` | Fast article extraction endpoint without AI analysis (used by modal). |

Refer to backend `app/main.py` for complete schema definitions.

---

## Frontend Notes
- Components follow TypeScript strict mode and shadcn/ui patterns (`frontend/components`).
- Tailwind CSS is the default styling approach (`frontend/app/globals.css`).
- Global themes support AMOLED black backgrounds with emerald accents; buttons and panels include hover/active states per redesign.
- `ArticleDetailModal` supports compact/expanded modes, integrates AI analysis asynchronously, and adopts magazine-style layout in expanded mode.

---

## Developer Guidelines (from `.github/copilot-instructions.md`)
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

### Phase Roadmap (from `Project file.md`)
1. **Phase 1 – MVP (Complete)**: RSS feed ingestion, multi-source aggregation, responsive UI, Dockerization.
2. **Phase 2 – Enhanced Features**: SQL persistence, source transparency, ChromaDB clustering, user preferences/bookmarking, PWA groundwork.
3. **Phase 3 – Global Expansion**: International sources, translations, Three.js globe, multilingual support.
4. **Phase 4 – Advanced Intelligence**: Local LLM summarization, automated scraping, recommendation engine, expanded fact-check integrations.

For actionable tasks and follow-ups, see `Todo.md`. Historical context and release notes are documented in `Log.md`.

---

## Legacy Deployments
- Vercel deployment synced via v0.app: https://vercel.com/6framepoke-1402s-projects/v0-news-aggregator-app
- v0 builder workspace: https://v0.app/chat/projects/MScHj5LMtUx

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
# This is the auto generated Documentation
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
