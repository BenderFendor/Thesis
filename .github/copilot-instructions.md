
# Copilot Instructions for Thesis Project
## Architecture snapshot
- FastAPI backend + Next.js 14 frontend; Docker Compose binds backend on http://localhost:8000 and frontend on http://localhost:3000.
- Backend entrypoint `backend/app/main.py` registers routers, SSE endpoints, and Gemini integrations; cross-cutting services live in `app/services/*`.
- RSS ingestion runs from `app/services/rss_ingestion.py` (`refresh_news_cache`, lines ~150-330) using thread pool throttling, writes to `news_cache`, and dual-writes to Postgres via `persist_articles_dual_write`.
- Sources resolve from `app/data/rss_sources.py` (JSON-backed) and feed metadata into SSE progress events managed by `app/services/stream_manager.py`.
- AI research pulls from cached/Postgres articles and optional Chroma vector search; see `app/services/news_research.py` and `backend/news_research_agent.py`.

## AI and streaming flows
- Article analysis workflow: `/api/article/analyze` in `main.py` extracts with `newspaper3k`, prompts Gemini 2.0 Flash, and returns `ArticleAnalysisResponse` (models in `app/models/article_analysis.py`).
- News research stream: `/api/news/research/stream` emits SSE events (`progress`, `thinking`, `articles`); generator lives near line ~1200 in `main.py` and delegates to `news_research_agent.research_news`.
- Agentic web search: `backend/agentic_search.py` exposes CLI + API; FastAPI route `/api/search/agentic` shares LangChain tooling with the research agent.
- WebSocket + SSE coordination uses global singletons in `app/services/stream_manager.py` and `app/services/websocket_manager.py`; avoid reinitializing them in new modules.
- Debug feeds with `GET /debug/source/{name}` and stream status via `GET /debug/streams` before changing ingestion logic.

## Frontend patterns
- All backend calls flow through `frontend/lib/api.ts`; update types there before touching components to keep Docker URL switching intact.
- SSE consumption lives in `frontend/hooks/useNewsStream.ts` (retry backoff, AbortController); UI components read `progress`, `status`, and `errors` props from this hook.
- Primary screens: `app/page.tsx` (grid feed), `app/search/page.tsx` (research agent), `components/article-detail-modal.tsx` (analysis modal).
- Follow shadcn/ui + Tailwind conventions; export named React components (`export function...`), keep shared logic in the same file when tightly coupled.
- Prefer TypeScript interfaces from `api.ts` and helpers in `frontend/lib/utils.ts` to avoid `any`; styling variables live in `frontend/app/globals.css`.

## Developer workflows
- Ensure `backend/.env` defines `GEMINI_API_KEY`; Postgres and Chroma containers come up via Compose but backend tolerates their absence in dev.
- Start the full stack from repo root:
```bash
docker compose up --build
```
- Run backend locally:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
- Run frontend locally:
```bash
cd frontend
npm install
npm run dev
```
- Backend tests: `pytest`; add targeted async tests alongside services you touch before modifying large streaming handlers.

## Conventions and guardrails
- Documentation updates must go to `README.md`, `Todo.md`, or `Log.md`; do not create new markdown files.
- Prefer `get_logger` from `app/core/logging.py`; logging configuration already routes stream + agent events appropriately.
- Extend RSS metadata via `app/data/rss_sources.json` + helper functions; keep categories/country/bias fields in sync with frontend filters.
- When persisting data, reuse `AsyncSessionLocal` and helpers in `app/database.py` to avoid duplicate engine creation.
- Follow env var contract in `docker-compose.yml` (`NEXT_PUBLIC_API_URL`, `DATABASE_URL`, `CHROMA_HOST`); mirror defaults in `frontend/lib/api.ts` where the base URLs are derived.
