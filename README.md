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

### ChromaDB Troubleshooting

**Error: `no such column: collections.topic`**

This error occurs when the ChromaDB client and server versions mismatch, or when stale data exists from a previous version.

**Solution:**
1. Delete the ChromaDB data directory:
   ```bash
   rm -rf .chroma
   ```
2. Restart ChromaDB:
   ```bash
   ./runlocal.sh services
   ```

**Prevention:** Always delete `.chroma` when upgrading the `chromadb` package version in `requirements.txt`.

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

---

## Package Installation & Dependencies

### Frontend Dependencies (Next.js)

#### Core Framework & UI
```bash
npm install next@14.2.16 react@18 react-dom@18
npm install @types/react@18 @types/react-dom@18
npm install typescript@5 eslint@8.57.1 eslint-config-next@15.5.4
```

#### UI Components & Styling
```bash
# Radix UI primitives (shadcn/ui components)
npm install @radix-ui/react-accordion@1.2.2
npm install @radix-ui/react-alert-dialog@1.1.4
npm install @radix-ui/react-aspect-ratio@1.1.1
npm install @radix-ui/react-avatar@1.1.2
npm install @radix-ui/react-checkbox@1.1.3
npm install @radix-ui/react-collapsible@1.1.2
npm install @radix-ui/react-context-menu@2.2.4
npm install @radix-ui/react-dialog@1.1.4
npm install @radix-ui/react-dropdown-menu@2.1.4
npm install @radix-ui/react-hover-card@1.1.4
npm install @radix-ui/react-label@2.1.1
npm install @radix-ui/react-menubar@1.1.4
npm install @radix-ui/react-navigation-menu@1.2.3
npm install @radix-ui/react-popover@1.1.4
npm install @radix-ui/react-progress@1.1.1
npm install @radix-ui/react-radio-group@1.2.2
npm install @radix-ui/react-scroll-area@1.2.2
npm install @radix-ui/react-select@2.1.4
npm install @radix-ui/react-separator@1.1.1
npm install @radix-ui/react-slider@1.2.2
npm install @radix-ui/react-slot@1.1.1
npm install @radix-ui/react-switch@1.1.2
npm install @radix-ui/react-tabs@1.1.2
npm install @radix-ui/react-toast@1.2.4
npm install @radix-ui/react-toggle@1.1.1
npm install @radix-ui/react-toggle-group@1.1.1
npm install @radix-ui/react-tooltip@1.1.6

# Styling utilities
npm install tailwindcss@4.1.9 @tailwindcss/postcss@4.1.9
npm install autoprefixer@10.4.20 postcss@8.5
npm install tailwindcss-animate@1.0.7 tailwind-merge@2.5.5
npm install class-variance-authority@0.7.1 clsx@2.1.1

# Fonts
npm install geist@1.3.1
```

#### State Management & Data Fetching
```bash
# Query and state
npm install @tanstack/react-query@5.90.17
npm install @tanstack/react-virtual@3.13.12

# Forms
npm install @hookform/resolvers@3.10.0
npm install react-hook-form@7.60.0
npm install zod@3.25.67
```

#### 3D & Visualization
```bash
# Three.js ecosystem
npm install three@latest react-globe.gl@2.37.0

# Data visualization
npm install d3-scale@4.0.2 d3-scale-chromatic@3.1.0
npm install recharts@2.15.4
```

#### Content & UI Components
```bash
# Markdown and content
npm install react-markdown@10.1.0 remark-gfm@4.0.1 rehype-raw@7.0.0

# Interactive components
npm install framer-motion@12.23.24
npm install embla-carousel-react@8.5.1
npm install vaul@0.9.9
npm install cmdk@1.0.4
npm install input-otp@1.4.1
npm install react-day-picker@9.8.0
npm install sonner@1.7.4

# Virtualization
npm install react-window@1.8.11 react-virtualized-auto-sizer@1.0.26
npm install @types/react-window@1.8.8
npm install react-resizable-panels@2.1.7

# Utilities
npm install date-fns@4.1.0 lucide-react@0.454.0
npm install next-themes@0.4.6
npm install react18-json-view@0.2.9
```

#### Development & Testing
```bash
# Testing
npm install jest@30.2.0 jest-environment-jsdom@30.2.0
npm install @testing-library/jest-dom@6.9.1
npm install @testing-library/react@16.3.0
npm install @testing-library/user-event@14.6.1
npm install @types/jest@30.0.0
npm install ts-jest@29.4.5

# Development tools
npm install @next/bundle-analyzer@16.1.2
npm install tw-animate-css@1.3.3
```

### Backend Dependencies (Python)

#### Core Framework
```bash
pip install fastapi>=0.110.0 uvicorn>=0.27.0
pip install pydantic>=2.8.0 python-multipart>=0.0.6
pip install python-dotenv>=1.0.0
```

#### HTTP & Data Processing
```bash
pip install httpx>=0.25.2 requests>=2.31.0
pip install beautifulsoup4>=4.12.0 lxml[html_clean]>=5.0.0
pip install feedparser>=6.0.10 newspaper4k>=0.9.0
pip install pillow>=10.0.0
```

#### AI/LLM Integration
```bash
# Direct API access
pip install google-genai>=0.1.0 openai>=1.0.0

# LangChain ecosystem for agentic features
pip install langchain>=0.2.0 langchain-google-genai>=1.0.0
pip install langchain-openai>=0.1.0 langchain-core>=0.2.0
pip install langchain-classic>=1.0.0 langgraph>=1.0.2
pip install ddgs>=9.9.1 tenacity>=8.2.0
```

#### Database & Storage
```bash
# PostgreSQL
pip install asyncpg>=0.29.0 sqlalchemy>=2.0.35
pip install psycopg2-binary>=2.9.9

# Vector database
pip install chromadb>=0.4.24 sentence-transformers>=2.7.0
```

#### Algorithms & Performance
```bash
# Search and clustering algorithms
pip install rank_bm25>=0.2.2 hdbscan>=0.8.33
pip install datasketch>=1.6.4

# System monitoring
pip install psutil>=5.9.0
```

#### Build Tools
```bash
# For Rust RSS parser (optional)
pip install maturin>=1.10.0
```

### System Dependencies

#### Manjaro/Arch Linux
```bash
# Core dependencies
sudo pacman -S postgresql python python-pip nodejs npm

# Build essentials
sudo pacman -S base-devel git docker docker-compose

# Optional: for local development
sudo pacman -S chromium # For debugging/testing
```

#### Database Setup
```bash
# PostgreSQL
sudo pacman -S postgresql
sudo -iu postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql

# Create database user and database
sudo -iu postgres createuser --interactive
sudo -iu postgres createdb thesis_news
```

### Development Environment Setup

#### Python Environment
```bash
# Using uv (recommended for performance)
cd backend
python -m venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt

# Alternative: traditional pip
pip install -r requirements.txt
```

#### Node.js Environment
```bash
cd frontend
npm install
# or for specific package groups
npm install next react react-dom typescript
npm install @radix-ui/react-accordion @radix-ui/react-dialog  # etc.
```

### Optional Performance Dependencies

#### For RSS Parsing Optimization
```bash
# Rust-based RSS parser (faster than Python alternatives)
pip install feedparser-rust  # If available
# Or build from source for maximum performance
```

#### For Advanced Clustering
```bash
# Additional clustering algorithms
pip install scikit-learn  # For K-means, DBSCAN
pip install umap-learn    # For dimensionality reduction
pip install hdbscan       # Already in requirements, but can be upgraded
```

#### For Enhanced Text Processing
```bash
# Advanced NLP features
pip install spacy          # For named entity recognition
pip install nltk            # For text processing
python -m spacy download en_core_web_sm
```

### Version Compatibility Matrix

| Component | Minimum Version | Recommended Version | Notes |
|------------|----------------|-------------------|---------|
| Node.js | 18.0.0 | 20.x LTS | Use LTS for stability |
| Python | 3.11 | 3.11+ | 3.12+ supported |
| PostgreSQL | 13 | 15+ | For better performance |
| npm | 8.0.0 | 10.x | Latest for security |
| Docker | 20.0.0 | 24.x | For compose features |

### Environment Variables Required

#### Backend (.env)
```env
# Required: AI Provider
OPEN_ROUTER_API_KEY=your_openrouter_key
GEMINI_API_KEY=your_gemini_key

# Database
DATABASE_URL=postgresql://user:password@localhost/thesis_news
CHROMA_PERSIST_DIRECTORY=./chroma_db

# Optional: Performance
RSS_PARALLEL_WORKERS=4
CHROMA_BATCH_SIZE=100
```

#### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_ENABLE_READER_MODE=true
NEXT_PUBLIC_ENABLE_AGENTIC_LOGGING=false
```

### Quick Installation Commands

#### Full System Setup (Manjaro/Arch)
```bash
# System packages
sudo pacman -S postgresql python python-pip nodejs npm base-devel git docker

# Database setup
sudo -iu postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
sudo -iu postgres createuser $USER
sudo -iu postgres createdb thesis_news

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt

# Frontend
cd frontend
npm install

# Start services
./runlocal.sh services
```

#### Docker Alternative (Recommended)
```bash
# Single command setup
docker-compose up -d

# View logs
docker-compose logs -f
```

### Package Maintenance

#### Frontend Updates
```bash
# Check for outdated packages
npm outdated

# Update specific packages
npm update next react react-dom
npm update @radix-ui/react-*

# Security audit
npm audit fix
```

#### Backend Updates
```bash
# Update requirements
pip install --upgrade -r requirements.txt

# Check for security vulnerabilities
pip audit
```

This comprehensive package list ensures all features work correctly, from basic RSS aggregation to advanced AI analysis and 3D visualization.
