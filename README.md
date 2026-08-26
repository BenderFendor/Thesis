# Thesis News Platform

Thesis is a local-first news analysis platform. It combines curated RSS feeds, a FastAPI backend, a Next.js frontend, PostgreSQL, ChromaDB, and AI-assisted research tools for source analysis, article discovery, and verification workflows.

## Status

Active thesis project. The app runs locally with `runlocal.sh` or Docker Compose and is still changing quickly.

## Features

- Curated RSS ingestion with source ownership, funding, country, and bias metadata.
- News feed, saved queue, source pages, topic clusters, and country/lens views.
- A unified Intelligence Atlas for source profiles, ownership, reporter networks, and public-source evidence.
- Research agents for article search, source context, and verification workflows.
- Semantic search through ChromaDB with lexical fallback paths.
- An appearance settings page (`/settings`) for editing the design tokens live: colors, typography scale and weights, spacing and density, corner radius, shadows, and motion, with local persistence, reset, and JSON import/export.
- Operator/debug surfaces for cache status, source health, logs, wiki indexing, resource use, and agent-readable debug bundles.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, TanStack Query and Virtual, Radix UI, three.js globe |
| Backend | Python 3.11+, FastAPI, Pydantic 2, LangChain and LangGraph for agentic search |
| Ingestion | Rust RSS parser in `backend/rss_parser_rust` behind Python bindings |
| Storage | PostgreSQL with Alembic migrations, ChromaDB for semantic search |
| CLI | TypeScript `scripts/scoop`, generated from the backend OpenAPI contract |
| Tooling | npm, uv, Docker Compose, `runlocal.sh` |

## Requirements

- Python 3.11 or newer.
- Node.js and npm.
- Rust toolchain for `backend/rss_parser_rust`.
- PostgreSQL and ChromaDB, either local or through Docker Compose.
- Optional API keys in `backend/.env` for AI-backed research:
  - `OPEN_ROUTER_API_KEY`
  - `GEMINI_API_KEY`

## Install

Clone the repo, then run the one-time local setup:

```bash
git clone https://github.com/BenderFendor/Thesis
cd Thesis
./runlocal.sh setup
```

## Run

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

## Backend parity CLI

The TypeScript CLI reads `backend/openapi.json` at runtime, so every documented backend operation is available without separate command implementations:

```bash
./scripts/scoop api list
./scripts/scoop api describe health_check_health_get
./scripts/scoop api call health_check_health_get
./scripts/scoop api smoke health_check_health_get --expect-json /status=healthy
```

For media research, use the curated commands. They compose generated OpenAPI operations and accept arbitrary entity names:

```bash
./scripts/scoop investigate organization "Warner Bros. Discovery" --refresh
./scripts/scoop investigate ownership CNN --max-depth 10
./scripts/scoop investigate source CNN --website https://www.cnn.com
./scripts/scoop investigate reporter "Anderson Cooper" --organization CNN
./scripts/scoop evidence replay
```

`evidence replay` verifies the 20 pinned primary-source captures and reviewed expectations before it starts. It then creates a private temporary PostgreSQL cluster, runs the real migrations, disables network access, and exercises adapters, policy, materialization, measurements, dossier APIs, and assertions. It refuses to run until every case has an independent signoff and never connects to or clears the configured development database.

Use `--param name=value` for OpenAPI path, query, header, and cookie parameters. Use `--body '{"key":"value"}'` for JSON bodies and `--stream` for streamed HTTP responses. WebSocket routes omitted by OpenAPI are published through `x-scoop-websockets`:

```bash
./scripts/scoop ws list
./scripts/scoop ws listen websocket_endpoint_ws_ws
```

Regenerate the shared contract and frontend types after changing backend routes:

```bash
./scripts/scoop schema refresh
```

## Configuration

Create `backend/.env` from the example file:

```bash
cp backend/.env.example backend/.env
```

Common variables:

| Variable | Purpose |
| --- | --- |
| `OPEN_ROUTER_API_KEY` | Enables OpenRouter-backed research and analysis. |
| `LLM_BACKEND` | Selects the LLM provider: `openrouter` (default), `llamacpp`, or `opencode` (OpenCode Zen free models). |
| `OPENCODE_API_KEY` | Enables OpenCode Zen research when `LLM_BACKEND=opencode`; model via `OPENCODE_MODEL`. |
| `GEMINI_API_KEY` | Enables Gemini-backed research and analysis. |
| `DATABASE_URL` | Overrides the default PostgreSQL connection string. |
| `STARTUP_CACHE_ARTICLE_LIMIT` | Sets how many recent database articles each API worker loads at startup. Default: `10000`. |
| `CHROMA_HOST` / `CHROMA_PORT` | Points the backend at ChromaDB. |
| `EMBEDDING_SERVICE_URL` | Points the backend at the embedding worker. |
| `NEXT_PUBLIC_API_URL` | Overrides the browser API base URL when needed. |
| `THESIS_RUNTIME_DIR` | Stores local structured logs, resource samples, and traces. |
| `THESIS_OBSERVABILITY_ENABLED` | Enables lightweight resource sampling; defaults to enabled. |
| `THESIS_LOG_MAX_BYTES` / `THESIS_LOG_BACKUP_COUNT` | Bounds each runtime JSONL file; defaults to 25 MiB plus three backups. |
| `OTEL_ENABLED` | Enables local JSONL OpenTelemetry trace export. |

Restart the backend after changing `backend/.env`.

## Testing

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

Collect an agent-readable debug bundle after reproducing a problem:

```bash
./scripts/collect-debug-bundle --since 30m
```

See [Evidence-based debugging](docs/agent-debugging.md) for the file layout, correlation fields, privacy rules, endpoints, and optional deeper profilers.

## Architecture

Repo layout: `backend/` holds the FastAPI app, Alembic migrations, and the Rust RSS parser. `frontend/` is the Next.js app. `scripts/` holds the scoop CLI and repo tooling. `docs/` holds developer and agent-facing docs.

The frontend uses route files for page-level orchestration and reusable components for shared interactions. The workspace navigation is decomposed under `frontend/components/navigation` into configuration, state helpers, accessible navigation items, sections, and search behavior. View selections are synchronized with the URL so links from wiki and research routes open the intended home view.

See [Frontend architecture and interaction rules](docs/frontend-architecture.md) for component boundaries, accessibility requirements, and the frontend verification checklist.

## Known limits

- Local-first by design. One operator, no production deployment, no multi-user auth.
- AI-backed research features need at least one provider key; without one, those features are unavailable.
- ChromaDB local state can be incompatible across runtime upgrades; the fix in Troubleshooting resets it.
- The codebase changes quickly and internals move without notice.

## License

No license chosen yet. Deciding between MIT and Apache-2.0.

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
