
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

## MCP TOOLS
Use Model Context Protocol (MCP) tools to assist with development. These tools are discoverable by the AI and automatically invoked based on context.

### exa-code
**Purpose**: Real-time code search and documentation retrieval for APIs, libraries, and SDKs.

**Key Capabilities**:
- Search for code examples, patterns, and best practices across the web
- Retrieve fresh, up-to-date documentation for libraries and frameworks
- Find usage examples and implementation patterns for unfamiliar APIs
- Answer programming questions with concrete code snippets

**When to Use**:
- Learning an unfamiliar library or API
- Finding code patterns or implementation examples
- Validating architectural decisions with real-world examples
- Understanding framework-specific conventions

**Example Queries**:
- "React hooks custom hook patterns"
- "FastAPI async middleware implementation"
- "Next.js server components with streaming data"

### context7
**Purpose**: Fetch comprehensive, up-to-date documentation for any library or package.

**Key Capabilities**:
- Retrieve official documentation for libraries and SDKs
- Get documentation focused on specific topics or features
- Access version-specific documentation when available
- Integrate seamlessly with code search for complete learning

**When to Use**:
- Need official API documentation for a library
- Want focused information on specific features
- Require version-specific documentation details
- Combining knowledge from both code examples and official docs

**Example Queries**:
- "Next.js routing patterns" (fetches official Next.js routing docs)
- "MongoDB connection pooling" (fetches MongoDB driver documentation)
- "Supabase authentication hooks" (fetches Supabase docs on auth)

### git
**Purpose**: Version control operations for managing repository changes.

**Available Commands**:
```bash
git status                              # Check repository status
git add <file>                          # Stage changes for commit
git commit -m "Your commit message"     # Commit staged changes
git push                                # Push commits to remote
git pull                                # Fetch and merge remote changes
git branch <branch-name>                # Create or switch branches
git log --oneline -n 10                 # View recent commit history
```

**Workflow Tips**:
- Always check `git status` before committing to verify staged changes
- Use descriptive commit messages following project conventions
- Pull before pushing to avoid conflicts
- Create feature branches for significant changes



