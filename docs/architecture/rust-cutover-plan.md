# Rust cutover plan

This plan moves the whole backend from FastAPI to Rust. A Python sidecar is
allowed only where no workable Rust library exists. Current state, route
inventory, and parity rules live in
[`rust-backend-migration.md`](rust-backend-migration.md); this file orders the
remaining work.

## Rules for every batch

Each batch is done only when all of these hold:

- The Rust code builds, and `cargo clippy --workspace --all-targets -- -D warnings` passes.
- A differential test compares Rust and FastAPI output for the batch's routes or
  functions before any Python is deleted. Operations reach `migrated: true` in
  `docs/agents/rust-openapi-operation-inventory.json` only after that test passes.
- Bounded pure kernels get Kani harnesses; unbounded arithmetic or ordering
  properties get Verus proofs where they add coverage. Record each result in
  `docs/agents/formal-audit/verification-manifest.json`, including "not run".
- Replaced Python modules, PyO3 adapters, and their tests are deleted in the
  same batch once no caller remains (`rg` evidence in the batch trace).
- Any speed claim has a before/after measurement (Criterion or wall clock).

Kani 0.68.0 is installed at `~/.cargo/bin/cargo-kani`; that directory must be on
`PATH`. Verus is not installed locally; CI downloads it in
`.github/workflows/rust-backend.yml`.

## Dependency decisions

| Python package | Rust replacement | Notes |
| --- | --- | --- |
| `fastapi`, `uvicorn`, `pydantic`, `python-multipart` | `axum`, `tower-http`, `serde`, `utoipa` | Already in the workspace. Multipart through `axum::extract::Multipart`. |
| `sqlalchemy`, `asyncpg`, `psycopg2-binary` | `sqlx` | `thesis-db` already owns typed queries. |
| `alembic` | `sqlx` migrations after an explicit handoff (batch 6) | Never run two schema authorities at once. |
| `httpx`, `requests`, `python-dotenv` | `reqwest`, `dotenvy` or plain environment | `thesis-server` already reads process environment. |
| `cloudscraper`, `curl_cffi` | `wreq` (TLS and HTTP/2 fingerprint emulation) | Validate against captured Cloudflare cases before removal. |
| `openai`, `google-genai`, `langchain*`, `langgraph`, `tenacity` | `reqwest` provider clients plus a `thesis-agent` tool loop; `rig` is optional | Keep the Python retry counts (SDK default two retries). |
| `chromadb` | `chromadb` crate (official HTTP client) | Same HTTP API as the Python client. |
| `numpy`, `rank_bm25` | Rust code in `thesis-search` | Pure numeric kernels. |
| `sentence-transformers` | `fastembed` or `ort`; Python sidecar until parity | Replace only after retrieval quality, latency, and memory match on a captured corpus. |
| `psutil` | `sysinfo` | |
| `opentelemetry-*` | `opentelemetry`, `opentelemetry-otlp`, `tracing-opentelemetry` | Keep metric and event names. |
| `ddgs` | Python sidecar | No maintained Rust DuckDuckGo client. Interface: `POST /search {query, max_results}` returning `[{title, url, snippet}]` on localhost. |
| `textual` | None | `tools/research_tui.py` is outside the deployed backend. |
| `Pillow`, `uc-micro-py` | Delete | No import in `backend/app` or `backend/tests`. |
| `maturin`, `hypothesis`, `testcontainers` | Remove with the last Python test | Build and test tooling only. |

## Batches

| # | Scope | Main crates | Deletes when done | Proof or measurement focus |
| --- | --- | --- | --- | --- |
| 0 | Restore the Rust build: `thesis-api` compiles, all route modules mounted, workspace tests and Clippy pass | `thesis-api`, `thesis-db` | Duplicate Rust handlers and dead wrappers | Build and test pass counts |
| 1 | Finish the 37 registered-but-unverified and 35 unregistered operations, including Atlas entity detail and the B16 proof download | `thesis-api`, `thesis-db` | Nothing until each route passes its differential | HTTP differential per operation |
| 2 | Rust becomes the public listener and forwards unmigrated routes to FastAPI on an internal port | `thesis-server` | None | Proxy overhead p50 and p99 against direct FastAPI |
| 3 | SSE and `/ws` owned by Rust with one shared connection and queue state | `thesis-api`, `thesis-runtime` | `websocket_manager.py`, `stream_manager.py` | Kani on `thesis-runtime` reducers, Loom on broadcast queues |
| 4 | Scheduler, RSS ingestion, persistence, leader election | `thesis-runtime`, `thesis-ingest` | `scheduler.py`, `rss_ingestion.py`, `auto_ingest.py`, `persistence.py` | Articles per second, restart and soak tests |
| 5 | Chroma sync, topic clustering, vector store | `thesis-search` | `chroma_sync.py`, `chroma_topics.py`, `vector_store.py` | Retrieval parity on a captured corpus |
| 6 | Alembic to SQLx migration-authority handoff | `thesis-db` | Alembic runtime path, `psycopg2-binary` | Schema diff of Alembic head against the SQLx result |
| 7 | Research agent, verification, reporter and source enrichment (`thesis-agent`) | new `thesis-agent` | About 25 research modules, provider SDKs, `langchain*` | Tool-call idempotency and cancellation properties |
| 8 | Observability exporter | `thesis-observe` | `opentelemetry-*`, `psutil`, `core/tracing.py` | Exporter overhead per request |
| 9 | Cloudflare-gated fetches | `thesis-ingest` | `cloudscraper`, `cloudflare_fetcher.py` | Success rate on captured gated domains |
| 10 | Remaining analytics: BM25, hybrid search, blind spots, GDELT aggregates, story lineage, MBFC and LittleSis imports | `thesis-search`, `thesis-db` | Listed Python modules, `rank_bm25` | Criterion baselines; Kani on BM25 score monotonicity |
| 11 | Remove PyO3 bridges | `rss_parser_rust` | `rss_parser_rust_bindings.py`, PyO3 wrappers, `maturin` | CI time before and after |
| 12 | Remove FastAPI | `thesis-server` | `backend/app/` except the `ddgs` and embedding sidecars | 24-hour soak, two worker cycles, rollback rehearsal |

## Batch 0 findings

Found while restoring the `thesis-api` build on 2026-09-28 (branch
`rust/restore-api-build`):

- Commit `1ca45cc` added about 52,000 lines to `thesis-api` that did not
  compile: 236 errors, so `thesis-server` could not build on `main`.
- `discovery::router` (trending and similarity) was never merged into the
  router, so those routes were unreachable even though they appear in `ApiDoc`.
- `websocket.rs` was never declared as a module, so the Rust `/ws` hub had never
  compiled.
- Two language-diagnostics handlers existed. The mounted one in `core.rs` did
  not extract article text for URL-only requests; the complete one in
  `article_analysis.rs` is now mounted and the duplicate is deleted.
- Several `IntoParams` structs exist only to describe query parameters in
  OpenAPI while handlers parse the raw query string, so their fields are never
  read.

## Dead-code candidates

| Candidate | Evidence | Batch |
| --- | --- | --- |
| `Pillow`, `uc-micro-py` in `backend/requirements.txt` | No import under `backend/app` or `backend/tests` | Any |
| `curl_cffi`, `textual` in `backend/requirements.txt` | Used only by `backend/scripts/verify_and_promote_reporters.py` and `backend/tools/research_tui.py` | Move to tool-only requirements |
| Python language-diagnostics scorer | Kept only as a differential oracle | 10, after captured cases replace it |
| PyO3 wrappers in `rss_parser_rust` | Removal condition in `rust-backend-migration.md` | 11 |
