# Thesis News Platform

A full-stack news aggregation platform that blends curated RSS feeds with AI-assisted research, analysis, and fact-checking. The project consists of a FastAPI backend and a Next.js frontend, with PostgreSQL and ChromaDB for storage and semantic search.

## Architecture

- **Backend**: FastAPI (Python 3.11+), `backend/app/main.py`
- **Frontend**: Next.js 15 (TypeScript, Tailwind CSS, shadcn/ui)
- **Database**: PostgreSQL 17 + ChromaDB for vector storage
- **State**: Zustand for client state, React Query for server state
- **AI**: OpenRouter or direct Gemini via LangChain

## Quick Start

```bash
docker-compose up -d
```

Frontend: http://localhost:3000  
Backend docs: http://localhost:8000/docs

## Environment Variables

Create `backend/.env` from `.env.example`:

```env
OPEN_ROUTER_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
```

Restart the backend after updating keys.

## Features

### AI Article Analysis
Full-text extraction via newspaper3k, source credibility scoring, bias detection, reporter profiling, and fact-check suggestions.

### Topic Clustering
ChromaDB embeddings with HDBSCAN clustering surface trending topics. The `/trending/clusters` endpoint returns semantically grouped articles with velocity scoring.

### Research Agents
- **News Research**: searches cached articles first, then falls back to web search with chain-of-thought visualization
- **Entity Research**: reporter profiles and organization research via Wikipedia integration
- **Verification**: fact-check claims with streaming evidence

### Search
- Semantic search via ChromaDB embeddings
- BM25 lexical fallback
- Hybrid search combining both

### Data Sources
- 94-country RSS catalog with ownership, funding type, and bias ratings
- GDELT global event integration
- Wikipedia-sourced source and reporter dossiers

## Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/news` | Paginated news feed |
| GET | `/trending/clusters` | Topic clusters with articles |
| GET | `/news/country/{code}` | Local lens for a country |
| POST | `/api/search/semantic` | Vector similarity search |
| POST | `/api/research` | AI research agent |
| POST | `/api/verification/verify` | Fact-check claims |
| GET | `/wiki/source/{id}` | Source credibility profile |
| GET | `/ws` | Real-time updates |

## Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI entry point
│   ├── api/routes/          # REST endpoints
│   ├── services/            # Business logic
│   └── data/rss_sources.json  # 1972 curated feeds
frontend/
├── app/                    # Next.js 15 pages
├── components/             # UI components
└── lib/                    # API client
docker-compose.yml
```

## Troubleshooting

### ChromaDB version mismatch
```bash
rm -rf .chroma
docker-compose restart
```

### Missing API key
Ensure `.env` exists in `backend/` and restart the backend.

## Development

Run the full verification suite:
```bash
./verify.sh
```

Frontend type check:
```bash
npx tsc --noEmit
```

Backend linting:
```bash
uvx ruff check backend/
```

## See Also

- `docs/Todo.md` for roadmap and task tracking
- `docs/Log.md` for change history
