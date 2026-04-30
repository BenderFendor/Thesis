# Thesis News Platform

Thesis is a local-first news analysis platform. It combines curated RSS feeds, a FastAPI backend, a Next.js frontend, PostgreSQL, ChromaDB, and AI-assisted research tools for source analysis, article discovery, and verification workflows.

## Status

Active thesis project. The app runs locally with `runlocal.sh` or Docker Compose and is still changing quickly.

## Features

- Curated RSS ingestion with source ownership, funding, country, and bias metadata.
- News feed, saved queue, source pages, topic clusters, and country/lens views.
- Source and reporter wiki pages, including ownership and reporter graph views backed by deterministic indexing and public-source evidence.
- Research agents for article search, source context, and verification workflows.
- Semantic search through ChromaDB with lexical fallback paths.
- Operator/debug surfaces for cache status, source health, logs, and wiki indexing.

## Requirements

- Python 3.11 or newer.
- Node.js and npm.
- Rust toolchain for `backend/rss_parser_rust`.
- PostgreSQL and ChromaDB, either local or through Docker Compose.
- Optional API keys in `backend/.env` for AI-backed research:
  - `OPEN_ROUTER_API_KEY`
  - `GEMINI_API_KEY`

## Quick Start

From the repo root, run the local setup once:

```bash
./runlocal.sh setup
```

Start the backend, frontend, PostgreSQL, and ChromaDB locally:

```bash
./runlocal.sh all
```

Or start the Docker stack:

```bash
docker-compose up -d
```

Open:

- Frontend: <http://localhost:3000>
- Backend API docs: <http://localhost:8000/docs>

## Configuration

Create `backend/.env` from the example file:

```bash
cp backend/.env.example backend/.env
```

Common variables:

| Variable | Purpose |
| --- | --- |
| `OPEN_ROUTER_API_KEY` | Enables OpenRouter-backed research and analysis. |
| `GEMINI_API_KEY` | Enables Gemini-backed research and analysis. |
| `DATABASE_URL` | Overrides the default PostgreSQL connection string. |
| `CHROMA_HOST` / `CHROMA_PORT` | Points the backend at ChromaDB. |
| `EMBEDDING_SERVICE_URL` | Points the backend at the embedding worker. |
| `NEXT_PUBLIC_API_URL` | Overrides the browser API base URL when needed. |

Restart the backend after changing `backend/.env`.

## Development

Run the repo verifier:

```bash
scripts/self-test
```

Run the strongest existing verification path directly:

```bash
./verify.sh
```

Run focused frontend checks:

```bash
npm --prefix frontend run lint
npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit
npm --prefix frontend run build
```

Run dependency cycle checks:

```bash
npm run deps:cycles
```

## Documentation

- GitHub Wiki: end-user guides, workflows, troubleshooting, architecture overview, and release notes.
- `docs/`: developer, maintainer, and agent-facing docs.
- [Documentation maintenance](docs/documentation-maintenance.md): README, docs, and wiki sync workflow.
- [Documentation style guide](docs/documentation-style-guide.md): writing rules for README, docs, and wiki updates.
- [Agent workflows](docs/agent/workflows.md): Codex workflows for development tasks.
- [Known errors](docs/agent/known-errors.md): reusable failure signatures and fixes.
- [Log](docs/Log.md): project change history.

## Troubleshooting

If ChromaDB local state is incompatible with the current runtime and the data is disposable:

```bash
rm -rf .chroma
docker-compose restart chromadb
```

If backend tools are missing:

```bash
./runlocal.sh setup
```
