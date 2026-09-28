# Rust backend migration

This document records current Rust ownership, shadow contracts, and cutover gates.
As of 2026-09-29, Rust exposes 143/178 HTTP operations: 106 parity-proven and
37 registered but unverified; 35 remain unregistered. Public listener cutover
is 0%.

## Current state

The initial census found 177 Python application modules and about 64,194 Python
runtime lines. The full backend tree contained 369 tracked Python files. Those
counts exclude generated files and were measured before this migration slice.
The 2026-09-23 source-count proxy found 65,926 Python runtime lines in 186
files and 11,010 Rust lines in 50 files, or 14.3% Rust by counted lines.
These counts include PyO3 adapters and in-file Rust tests, so this is not a
semantic completion percentage.
OpenAPI coverage measures contract parity only. FastAPI remains the public
listener; public listener cutover is 0%.
The original Rust crate had 45 passing library tests and about 4,251 lines; it
implements RSS and Atom fetching and parsing, HTML extraction, GDELT parsing,
MinHash, ranking, topic clustering, country matching, and vector math. The
ingest extraction moved HTML cleanup, article metadata extraction, and the
pure GDELT TSV/domain core into `thesis-ingest`. Personalized ranking and
lexical topic clustering now live in `thesis-search`; `feed_rank.rs` and
`topics.rs` remain PyO3 adapters. Topic output is ordered by feed position and
article ID. GDELT CAMEO normalization, label lookup, Goldstein bucketing,
and dominant-root counts now live in `thesis-ingest`. Country alias matching
and article text composition now live in `thesis-search`; the PyO3 adapter
reloads aliases by atomically replacing its shared snapshot. Its sorted
Aho-Corasick index deduplicates patterns while retaining every matching country
code. MinHash signatures and duplicate grouping now live in
`thesis-search::minhash`; the compatibility test suite calls the Rust bindings
directly, and the unused Python-only facade was removed. Comparison keyword
extraction from `article_comparison.py` now lives in
`thesis-search::comparison_keywords`; the Python service calls it through the
temporary PyO3 bridge. The complete comparison domain now lives in
`thesis-search::article_comparison`, and `thesis-api` serves it on the shadow
Rust listener. FastAPI still owns the public comparison HTTP operation. Its
language-diagnostics route now calls the Rust search core through PyO3. The
original Python scorer remains only for differential tests.

The 2026-09-25 full workspace run passed 247 tests: `rss_parser_rust` 34,
`thesis-api` 87, `thesis-db` 13, `thesis-evidence` 18, `thesis-ingest` 21,
`thesis-runtime` 14, `thesis-search` 54, and `thesis-server` 6. The country
alias matcher has a six-test Python boundary suite and a 17-mutant selected
run. A one-off comparison of 5,855 alias strings against one legacy process
found 190 differences across 48 base aliases.

The pure host normalization and matching functions from
`backend/app/services/source_url_guard.py` now live in
`thesis-ingest::source_url_guard` and remain reachable from Python through the
PyO3 bridge. The Python service still owns `urllib.parse`, Google News query
decoding, and the guard response dictionary. Its callers include RSS source
validation, reporter verification, entity backfill, source research, and source
claims. Unicode differential cases preserve Python `str.strip()` behavior,
including U+001C through U+001F.

The checked-in `backend/openapi.json` contains 166 paths, 178 HTTP operations,
and 152 schemas. `/ws` carries custom `x-scoop-websockets` metadata. Four debug
observability routes are absent from the OpenAPI artifact. The frontend and
`scoop` CLI consume these contracts, plus SSE events and the WebSocket stream.

The current workspace dependency graph is:

```text
thesis-server -> thesis-api -> thesis-runtime
                             -> thesis-db -> thesis-evidence
                             -> thesis-search
                             -> thesis-evidence
rss_parser_rust -> thesis-ingest
                 -> thesis-evidence
                 -> thesis-search
```

`thesis-server` serves evidence evaluation, personalized ranking, and article
comparison on `127.0.0.1:8120` by default. `thesis-db`
owns SQLx and reads the existing evidence tables. `thesis-evidence` contains the
pure acceptance decision. `thesis-ingest` owns HTML cleanup, article metadata
extraction, pure GDELT parsing/filtering, and source-host identity; the existing PyO3 functions call
those functions, so Python-visible names and normal serialized results stay
unchanged. The GDELT wrapper validates `SQLDATE` and maps invalid dates to the
UTC epoch instead of slicing malformed UTF-8. `thesis-search` owns
personalized ranking, lexical topics, country alias matching, and full article
comparison. The country
PyO3 adapter loads aliases from `country_aliases.json` and swaps immutable
`Arc` snapshots under a read/write lock when reload is requested. The PyO3
module also exposes evidence, ranking, topic, and comparison-keyword
operations for existing Python callers. The Rust listener also serves evidence
policy, claim, and relationship reads through Axum and SQLx. The relationship
route reads the existing Alembic-managed schema and applies separate `as_of`
and `known_at` bounds. FastAPI still owns
the normal application port. The Rust server does not yet proxy unmigrated
routes, SSE, or WebSockets, so it is not ready to replace the public listener.

The listener now also includes `GET /api/wiki/evidence/interest` as a shadow
ownership-interest read. `thesis-evidence` uses an exact finite-decimal
interest kernel; `thesis-db` loads non-retracted `owns_equity_in` and
`directly_owns` rows from `accepted_relationships`, preferring `pct` over
`pct_band`; and `thesis-api` owns bounded query validation and OpenAPI
declarations. The Python route remains the public behavior reference.

## Current shadow slices and limits (2026-09-27)

The B02 shadow contains five cached-news routes: `GET /news/page/cached`,
`GET /news/index/cached`, `GET /news/source/{source_name}`,
`GET /news/category/{category_name}`, and `GET /news/sources/stats`. B04 adds
`GET /debug/cache/articles` and `GET /debug/startup`; B06 adds
`POST /api/queue/digest`. These are Rust shadow routes. FastAPI remains public.

Rust also registers 37 remaining inventory operations as shadow routes: eight
B04 debug routes (six debug-log routes, `/debug/startup`, and
`/debug/database/articles`), all five B07 research/search/inline routes, two
B12 verification reads, four B13 analytics reads, eight B14 wiki reads, nine
B15 Atlas routes for ingestion status, funding-bias, media measurements, graph,
entity connections, search, index, export, and stats, plus the B16 evidence
claim materialization route. None is marked `migrated`: 72 operations still
lack proven parity, split into 37 mounted-but-unverified and 35 unregistered.
Four FastAPI `include_in_schema=False` observability routes and the `/ws`
WebSocket remain outside the 178 HTTP-operation inventory.

B04 `GET /debug/startup` uses shared `ProfilingState` and is always mounted,
matching FastAPI's unconditional `debug.router` inclusion.
`GET /debug/database/articles` is also always mounted and reads through
`AppState.database`; it honors the supplied `DebugConfig.enable_database`, or
the FastAPI-compatible `ENABLE_DATABASE` process setting when no config exists.
The Rust server does not load `.env` itself. Both routes remain unverified.
All other Rust debug routes remain behind the optional `debug_config` sidecar.

B04 `GET /debug/logs/events` reads Rust's process-local ring populated by
frontend report ingestion; it does not include the broader Python
`debug_logger` request, stream, cache, database, and RSS events. The event route
is registered but is not parity-proven.

The mounted `POST /debug/logs/frontend` appends normalized report events as
JSONL in the configured debug-log directory (`DEBUG_LOG_DIR` convention).
`DELETE /debug/logs/files` prunes direct JSONL files there according to the
validated `keep_recent` range (1–20, default 5); these filesystem side effects
remain shadow-only.

B07 registers `GET /api/news/research/models`, `GET
/api/news/research/stream`, `POST /api/news/research`, `GET
/api/search/semantic`, and `POST /api/inline/define`. The default research,
search, and inline provider adapters remain explicitly unavailable. Fixture
tests do not prove live provider behavior, retry parity, incremental streaming,
or cancellation.

B12 mounts only `GET /api/verification/status` and
`GET /api/verification/domains` (2 of 6 inventory operations). The verify,
JSON, stream, and cache handlers are not mounted in either the router or central
ApiDoc: real provider/cache/workspace adapters are absent, and the Rust stream
handler buffers output rather than providing incremental cancellation-aware
SSE. Its local module annotations do not count as mounted routes.

B13 registers exactly `get_article_gdelt_events_gdelt_article__article_id__get`,
`get_gdelt_stats_gdelt_stats_get`, `get_recent_gdelt_events_gdelt_recent_get`,
and `get_blindspot_viewer_blindspots_viewer_get`. All four remain unverified.
The six unregistered operations are `trigger_gdelt_sync_gdelt_sync_post`,
`get_source_blind_spots_blindspots_source__source_name__get`,
`get_topic_blind_spots_blindspots_topics_get`,
`get_coverage_report_blindspots_report_get`,
`update_coverage_stats_blindspots_update_stats_post`, and
`get_blind_spots_dashboard_blindspots_dashboard_get`. Sync requires export HTTP
fetch, Chroma matching, and database writes; the other blindspot operations
require unavailable live Chroma results or would expose misleading metrics.

B14 registers eight wiki reads, including the database-backed reporter dossier
and its latest 20 articles; B15 registers Atlas ingestion status, funding-bias
analysis, media measurements, graph, entity connections, search, index, export,
and stats. The dossier's activity, career-timeline, and employer enrichments
remain unavailable. Atlas graph, connection, search, index, export, and stats
handlers are registered but parity-unverified; entity detail remains
unregistered. The media-measurement handler calculates and persists six
versioned traces but is not parity-proven.

B16 registers the token-gated evidence claim materialization route; it reuses
the existing DB materializer and reloads the exact accepted relationship, but
runtime and FastAPI parity remain unverified.

Across B14-B16, 22 pending operations partition into 18 registered operations
and 4 unregistered operations: two index triggers, Atlas entity detail, and
evidence proof download. All remain `migrated:false`.

The B16 proof download remains unregistered: `backend/Cargo.lock` contains no
ZIP writer crate, and Cargo dependency resolution/runtime verification are
unavailable under the current gate.


The B04 route reads only its in-process `CacheStreamState`. The production
server uses the default state, which starts empty and has no cache refresh
provider wired to it. Rust does not share the Python `NewsCache`. Route tests
seed a router-local cache and use a lazy database handle; they prove response
behavior for that snapshot, not live cache-data parity, database access, or RSS
refresh behavior.

The B06 Rust provider sends one reqwest request without retry. FastAPI's
OpenRouter and llama.cpp clients leave retry handling at the OpenAI SDK default
of two retries; its OpenCode client sets `max_retries=0`. Rust provider tests
use local fixture servers, and route tests use an injected provider. No live
external LLM call was made.

At startup, `thesis-server` reads LLM settings directly from process environment;
it does not use Python's `load_dotenv()`. `LLM_BACKEND` defaults to `openrouter`.
OpenRouter requires a non-empty `OPEN_ROUTER_API_KEY`; its base URL is
`https://openrouter.ai/api/v1`, and `OPEN_ROUTER_MODEL` defaults to
`z-ai/glm-4.5-air:free`. OpenCode requires a non-empty `OPENCODE_API_KEY`;
`OPENCODE_BASE_URL` defaults to `https://opencode.ai/zen/v1`, and
`OPENCODE_MODEL` defaults to `mimo-v2.5-free`. The optional llama.cpp settings
default `LLAMACPP_BASE_URL` to `http://localhost:8080/v1` and
`LLAMACPP_API_KEY` to `no-key`. B06 uses `OPEN_ROUTER_MODEL` for the llama.cpp
request model, matching Python's queue digest; it does not use
`LLAMACPP_MODEL`.

## Existing boundaries and ownership

| Boundary | Current owner and observed behavior | Rust destination |
| --- | --- | --- |
| HTTP and lifecycle | `backend/app/main.py` creates the FastAPI app, initializes caches and the database, claims startup leadership, starts background tasks, and coordinates shutdown. `backend/app/api/routes/` contains route modules by domain. | `thesis-server` and `thesis-api` serve the shadow routes. The existing `thesis-runtime` crate contains pure no_std protocol reducers. The listener becomes public only after proxy parity covers every unmigrated HTTP, SSE, and WebSocket route. |
| Database | `backend/app/database.py` defines the SQLAlchemy base, engine, sessions, legacy tables, and compatibility DDL. It is imported throughout the app. Alembic owns evidence-spine history while older application tables also use bootstrap DDL. | `thesis-db` owns typed SQLx queries and transactions against the same schema. Alembic remains the only migration authority during coexistence. |
| Evidence and Atlas | `wiki_evidence.py` calls `evidence_policy.py`, `evidence_spine.py`, `claim_comparison.py`, `ownership_math.py`, and export code. The spine reads claims, observations, snapshots, documents, lineage, and accepted relationships. | `thesis-evidence` owns rules and pure transforms; `thesis-db` loads typed records; API handlers translate errors and responses. Atlas projections follow after the acceptance slice. |
| RSS and ingestion | `app/main.py` launches `scheduler.py`; `rss_ingestion.py`, `auto_ingest.py`, and `persistence.py` fetch, queue, and persist articles. `rss_parser_rust_bindings.py` calls the PyO3 crate. | `thesis-ingest` owns pure HTML cleanup, article metadata extraction, GDELT parsing/filtering, and GDELT taxonomy rules. Continue moving feed parser/fetcher logic by tested boundaries; keep PyO3 until Python runtime callers move. |
| Source URL guard | `source_url_guard.py` is used by RSS validation, reporter verification, entity backfill, source research, and source claims. It parses URLs and Google News site scopes before returning a status dictionary. | `thesis-ingest::source_url_guard` owns host normalization and identity matching. Python keeps URL/query parsing and response shaping. Remove the two PyO3 methods after every Python caller has moved to a Rust service. |
| Personalized ranking | `app/api/routes/news.py` calls `rss_parser_rust_bindings.rank_articles`; that wrapper converts Python dictionaries to typed `thesis-search` inputs and serializes the results. | `thesis-search` owns the pure scorer. Keep the PyO3 adapter while FastAPI calls it; remove the adapter after the route and other Python callers move to Rust API services. |
| Topic clustering | `chroma_topics.py` calls the RSS binding for title keywords, lexical clusters, and labels. Cluster labels and anchor order reach downstream topic snapshots. | `thesis-search::topics` owns keyword normalization, lexical grouping, similarity, and labels. The PyO3 module translates existing inputs and outputs; keep it until `chroma_topics.py` moves to Rust. |
| Country mentions | `country_mentions.py` exposes extraction, geo data, country labels, and PostgreSQL backfill. Ingestion and persistence call its extraction wrappers, which use PyO3. | `thesis-search::country_mentions` owns alias indexing and matching. Keep Python for geo labels and DB backfill; keep the PyO3 adapter until ingestion and backfill callers move. |
| Vector and embeddings | `chroma_sync.py` and `chroma_topics.py` coordinate Chroma. `persistence.py` owns process-local article and embedding queues. `app.embedding_service` serves Sentence Transformers over HTTP. | Rust owns queue state, retries, generation fencing, and Chroma HTTP calls. Keep the Python embedding HTTP sidecar until a Rust-native model matches output quality and meets measured latency and memory limits. |
| Research and tools | `news_research_agent.py`, research services, and verification services coordinate provider SDKs and tools. `research_streaming.py` emits SSE. | `thesis-agent` remains planned and is not a workspace member; provider retry and cancellation semantics still need parity before migration. |
| WebSockets and caches | `websocket_manager.py`, stream managers, schedulers, and cache modules hold process-local state. Multiple worker processes can therefore have separate queues and connection lists. | `thesis-runtime` currently provides pure no_std protocol reducers. It does not own the live Python queues, cache instances, or bounded worker channels. Loom coverage belongs after those synchronization primitives enter Rust. |
| Observability | Python OpenTelemetry instrumentation and local metrics cover FastAPI, HTTPX, SQLAlchemy, and startup. | `thesis-observe` remains planned and is not a workspace member. Preserve event and metric names when the exporter is implemented. |

## Python package blockers

This inventory comes from `backend/requirements.txt` and imports in the current
backend tree. It separates deployed behavior from developer tooling and records
when a Python dependency can be removed.

| Package(s) | Current Python-owned behavior | Replacement or removal condition |
| --- | --- | --- |
| `fastapi`, `uvicorn`, `pydantic`, `python-multipart` | App lifecycle, routes, validation/serialization, upload parsing in `app/main.py`, `app/api/`, and models. | Axum/Tower, Serde, and compatible multipart handling own every route and match the OpenAPI, SSE, WebSocket, frontend, and CLI contracts. |
| `sqlalchemy`, `asyncpg`, `psycopg2-binary`, `alembic` | Async application queries, PostgreSQL driver, synchronous migration/replay paths, and current schema history. | SQLx owns all runtime queries against the shared schema. Keep Alembic and psycopg2 until a reviewed one-way migration-history handoff; do not create a second schema authority. |
| `httpx`, `requests`, `cloudscraper`, `python-dotenv` | Provider and source HTTP, embedding-sidecar HTTP, configuration loading, and the optional Cloudflare fallback in `cloudflare_fetcher.py`. | Reqwest and typed Rust configuration replace ordinary clients. Preserve the Cloudflare fallback behavior at an explicit boundary until captured fetch cases pass. The embedding HTTP sidecar remains temporarily. |
| `google-genai`, `openai`, `langchain`, `langchain-google-genai`, `langchain-openai`, `langchain-core`, `langchain-classic`, `langgraph`, `tenacity` | Model/provider SDKs, implicit research-agent graph/tool execution, and retry behavior. | `thesis-agent` is not implemented. Future provider adapters must preserve retry and cancellation semantics; the current B06 Rust digest adapter makes one attempt, while the FastAPI OpenRouter/llama clients use the SDK default of two retries and OpenCode explicitly disables retries. |
| `chromadb`, `numpy`, `sentence-transformers`, `rank_bm25` | Chroma client and synchronization, vector operations, embedding generation, and BM25 ranking. | Rust owns the Chroma HTTP adapter, vector transforms, and ranking. Keep the Sentence Transformers HTTP sidecar until captured embeddings, retrieval quality, latency, and memory benchmarks pass. |
| `psutil`, `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-instrumentation-fastapi`, `opentelemetry-instrumentation-httpx`, `opentelemetry-instrumentation-sqlalchemy`, `opentelemetry-exporter-otlp-proto-http` | Resource monitoring and current Python tracing/export instrumentation. | `thesis-observe` is not implemented. Preserve operational metric and event names when Rust tracing/export is added. |
| `ddgs`, `textual`, `curl_cffi` | `ddgs` powers web-search calls in research and verification. `textual` is the standalone `tools/research_tui.py`; `curl_cffi` is used by reporter/Wayback maintenance scripts. | Replace `ddgs` with the research agent. Keep the TUI and administrative scripts outside the deployed backend target unless they become release-critical runtime paths. |
| `maturin`, `hypothesis`, `docker`, `testcontainers[postgresql]`, `types-requests`, `types-psutil` | PyO3 wheel builds, property tests, disposable-service tests, and static typing only. | Keep test tooling as needed. Remove `maturin` after Python no longer imports the PyO3 extension; type stubs do not block runtime removal. |

`Pillow` and `uc-micro-py` are listed in requirements but have no direct
application import in the current backend scan. Treat them as dependency-audit
items, not migration blockers, until a runtime caller is identified.

## Workspace target and dependency direction

The target workspace is split by ownership, with an acyclic dependency graph:

```text
thesis-server
  -> thesis-api -> thesis-runtime
                 -> thesis-db -> thesis-domain
                 -> thesis-evidence -> thesis-domain
                 -> thesis-search -> thesis-domain
                 -> thesis-agent -> thesis-domain
                 -> thesis-ingest -> thesis-domain
  -> thesis-observe

rss_parser_rust -> thesis-ingest / thesis-search / thesis-evidence (temporary PyO3 bridge)
```

Only add a shared `thesis-domain` crate when a second domain crate needs the
same types. Current workspace members are `rss_parser_rust`, `thesis-ingest`,
`thesis-search`, `thesis-evidence`, `thesis-db`, `thesis-runtime`, `thesis-api`,
and `thesis-server`. `thesis-runtime` is a `no_std` crate of pure protocol
reducers and a dependency of `thesis-api`. `thesis-agent` and `thesis-observe`
remain absent. `thesis-ingest` contains HTML cleanup, HTML metadata extraction,
and GDELT parsing/filtering. `thesis-search` contains personalized ranking,
lexical topics, and country mention logic. Remaining feed parser modules stay
in `rss_parser_rust` until they can move with their behavior tests.

### Local build cache and logs

Keep all workspace outputs under `backend/target`. Dev and test profiles omit
debug information and disable incremental compilation to limit local build
cache growth. Reclaim generated output with `cargo clean --manifest-path
backend/Cargo.toml` only when no build is running; a Rust Analyzer process can
keep mapped build artifacts allocated until it exits.

The active `app.log` stays plain text. `RotatingFileHandler` writes closed
numbered backups as lossless `.gz` files using the existing three-backup
limit. Closed historical text logs larger than 1 MiB may also be gzip
compressed in place. Keep runtime JSONL logs plain because the observability
and debug endpoints read those files directly.

## Migration phases and Python modules

Move each boundary only after its callers, tests, and data contract are known.

| Phase | Python modules assigned | Rust destination and cutover condition |
| --- | --- | --- |
| 0. Workspace and contracts | `backend/openapi.json`; proof-suite and captured-corpus runners; contract tests; no runtime modules deleted. | Workspace, normalized OpenAPI comparison, differential harness, verification manifest, and CI. Keep the Python service authoritative until each route is switched. |
| 1. Ingestion seed | `backend/app/services/rss_parser_rust_bindings.py`, `rss_ingestion.py`, `auto_ingest.py`; remaining Rust files `backend/rss_parser_rust/src/{algorithms,blindspot,country_mentions,feed_rank,fetcher,gdelt,gdelt_taxonomy,parser,topics,types}.rs`. | HTML cleanup, metadata extraction, GDELT parsing/filtering/taxonomy, personalized ranking, lexical topics, and country alias matching now live in domain crates. `country_mentions.rs`, `feed_rank.rs`, `gdelt.rs`, `gdelt_taxonomy.rs`, and `topics.rs` retain PyO3 adapters. Continue extracting feed parser/fetcher logic with RSS corpus comparisons; remove PyO3 only after Python runtime callers move and the corpus passes. |
| 2. Deterministic transforms | `article_comparison.py`, `minhash_dedup.py` (removed), `country_mentions.py`, `source_url_guard.py`, `source_field_extractor.py`, `gdelt_taxonomy.py`, `gdelt_query.py`, `language_diagnostics.py`, `reporter_name_cleanup.py`, `reporter_name_splitter.py`, `reporter_confidence_scorer.py`, `source_analysis_scorer.py`, `source_profile_extractor.py`, `source_profile_synthesizer.py`. | GDELT taxonomy, country aliases, source-host identity, MinHash, comparison keywords, article comparison, and language diagnostics now live in domain crates. The FastAPI language-diagnostics service calls Rust through PyO3; the old Python scorer remains only as a differential oracle. Keep the bridge until the FastAPI route and URL extraction path move to Rust, and remove the Python oracle after independent captured cases replace it. `thesis-api` exposes `/compare/articles` on the shadow listener; FastAPI remains the public route. The Python comparison service remains the differential reference, but similarity, sentence diff, and keyword extraction call shared Rust kernels through PyO3. Keep those bindings until the public route and all other Python callers move. `minhash_dedup.py` had no production callers; its Python tests now exercise the existing Rust bindings. The Python country service remains for geo labels and DB backfill. `source_url_guard.py` still parses URLs and builds response dictionaries; remove its host PyO3 calls after its remaining consumers move. Continue remaining transforms with properties and independent reference cases before cutover. |
| 3. Evidence and ownership | `evidence_policy.py` (decision logic now has a Rust implementation), `evidence_spine.py`, `claim_comparison.py`, `ownership_math.py`, `material_interest.py`, `contradiction_extractor.py`, `evidence_export.py`, `evidence_export_formats.py`, `atlas_entity.py`, `atlas_entity_resolution.py`, `atlas_evidence_projection.py`, `atlas_graph.py`, `atlas_graph_helpers.py`, `atlas_graph_projection.py`, `atlas_export.py`, `source_claims.py`, `source_ledger.py`, `source_credibility.py`, `source_policy_transparency.py`, `ad_supply_transparency.py`, `mbfc_integration.py`, `littlesis_integration.py`, `media_measurements.py`, `funding_bias_analysis.py`. | `thesis-evidence` and `thesis-db`. Replay the proof suite and evidence captures; do not authorize evidence materialization until the independent reviewer signoff is present. The current corpus review statuses are pending. |
| 4. Persistence and typed queries | `backend/app/database.py`, `persistence.py`, `reading_queue.py`, `reporter_claim_store.py`, `reporter_profile_store.py`, `reporter_directory.py`, and SQLAlchemy models in `backend/app/models/{news,reading_queue,evidence,atlas,research,verification,article_analysis,inline,api_contracts}.py`. | `thesis-db` with SQLx, same PostgreSQL schema, and Alembic migrations. Move one query domain at a time; preserve order, uniqueness, timestamps, JSON behavior, indexes, and transaction boundaries. |
| 5. Search, cache, and article transforms | `bm25_search.py`, `hybrid_search.py`, `cache.py`, `cluster_cache.py`, `chroma_sync.py`, `chroma_topics.py`, `blind_spots.py`, `blindspot_viewer.py`, `article_analysis.py`, `story_lineage.py`, `queue_digest.py`, `gdelt_aggregates.py`. | `thesis-search` plus vector-store adapters in `thesis-runtime`. Benchmark ranking, deduplication, query mapping, serialization, and hot paths before replacing measured implementations. |
| 6. Workers and ingestion runtime | `scheduler.py`, `async_utils.py`, `rss_ingestion.py`, `auto_ingest.py`, `evidence_ingest.py`, `primary_source_adapters.py`, `source_document_collector.py`, `gdelt_integration.py`, `entity_backfill.py`, `reporter_indexer.py`, `wiki_indexer.py`, `persistence.py`, `startup_metrics.py`. | `thesis-runtime` and `thesis-ingest`. Model leader election, queue saturation, retries, shutdown, stale results, and restart recovery before implementation cutover. |
| 7. HTTP, SSE, and WebSocket domains | Route modules: `article_analysis.py`, `blindspots.py`, `bookmarks.py`, `cache.py`, `comparison.py`, `debug.py`, `entity_research.py`, `gdelt.py`, `general.py`, `image_proxy.py`, `inline.py`, `jobs.py`, `liked.py`, `news.py`, `news_by_country.py`, `observability.py`, `profiling.py`, `reading_queue.py`, `research.py`, `search.py`, `similarity.py`, `sources.py`, `stream.py`, `trending.py`, `updates.py`, `verification.py`, `wiki.py`, `wiki_atlas.py`, `wiki_evidence.py`; route helpers `saved_article_helpers.py`; services `highlights.py`, `image_extraction.py`, `inline_definition.py`, `cloudflare_fetcher.py`, `og_image.py`, `websocket_manager.py`, `stream_manager.py`. | `thesis-api` and `thesis-runtime`, one operation group at a time. Compare methods, operation IDs, parameters, required fields, status codes, schemas, WebSocket metadata, SSE event names, and `scoop` behavior. |
| 8. Research agent and reporter enrichment | `backend/news_research_agent.py`; `news_research.py`, `research_models.py`, `research_streaming.py`, `prompting.py`, `verification_agent.py`, `verification_output.py`, `verification_sandbox.py`, `entity_resolver.py`, `entity_wiki_service.py`, `funding_researcher.py`, `source_query_generator.py`, `source_research.py`, `source_search_planner.py`, `reporter_agency_flag.py`, `reporter_author_page_scraper.py`, `reporter_awards.py`, `reporter_career_timeline.py`, `reporter_cms_crawl.py`, `reporter_conferences.py`, `reporter_openalex.py`, `reporter_outlet_repair.py`, `reporter_profiler.py`, `reporter_public_records.py`, `reporter_social_search.py`, `reporter_split_backfill.py`, `reporter_wayback.py`, `reporter_web_search.py`, `reporter_wikipedia.py`. | `thesis-agent` with explicit plan, dispatch, completion, integration, verification, response, failure, and cancellation events. Keep stable tool IDs and idempotent result commits. |
| 9. Lifecycle and final Python removal | `backend/app/main.py`, remaining compatibility imports, and `resource_monitor.py`, `metrics.py`, `debug_logger.py`. | `thesis-server`, `thesis-runtime`, and `thesis-observe`. Remove FastAPI only after full API, worker-cycle, restart, rollback, and soak criteria below pass. |

## Temporary Python boundaries and deletion criteria

| Python surface | Why it remains | Removal condition |
| --- | --- | --- |
| `app.embedding_service` / Sentence Transformers | Existing local model quality and resource use should remain stable while ingestion and persistence move. | Rust-native embedding output passes the same captured article corpus, retrieval-quality comparison, and throughput/memory benchmarks on supported hardware. |
| PyO3 in `rss_parser_rust` | Existing Python services import the established Rust RSS and algorithm APIs. | All production consumers call domain crates or the Rust server; no Python import or package installation requires the extension. The Rust implementation and tests remain. |
| `analyze_language_diagnostics_python` | Kept only as an independent differential oracle; the production FastAPI service calls Rust. | Remove after reviewed/captured cases replace the Python oracle and the Rust route owns both inline text and URL extraction. |
| FastAPI application | It is the behavioral reference and continues serving unmigrated paths during coexistence. | Rust owns and passes the full OpenAPI/runtime compatibility suite, including SSE and WebSockets, with all callers switched. |
| Alembic | It is the existing schema-history authority. | Rust owns every production schema change and a reviewed one-way migration/archive plan exists. Never run two schema authorities concurrently. |
| Python proof replay code | It contains human-reviewed domain cases and capture handling, not application runtime. | A Rust replay tool executes every approved case and mutation class while preserving the independent review metadata and raw corpus. Keep the signed case data. |
| One-off admin and research scripts | They do not block a Rust-native deployed runtime. | Delete only when their task is obsolete or an owned Rust CLI replaces them; they are excluded from the 99% runtime target. |

The embedding worker is the only planned Python service sidecar. PyO3 and
Alembic are temporary migration/build tools. No other Python compatibility
server is planned.

## Contracts, data, and parity

`backend/openapi.json` remains the API source of compatibility truth. The
normalized checker is `scripts/check_openapi_compat.py`. It preserves paths,
methods, operation IDs, parameter and body requiredness, media types, status
codes, and response schemas. It normalizes descriptions/titles, equivalent
nullable `oneOf`/`anyOf`/type-array spelling, unrestricted nullable JSON, and
integer/double format hints. With explicit operation IDs
it checks only Rust-owned operations; full mode also checks
`x-scoop-websockets` and becomes the gate once the Rust document exposes the
full API. Additive runtime behavior such as the existing claim-not-found 404 is
tested separately because FastAPI does not list it in this OpenAPI operation.

The evidence slice compares the Python and Rust policy rows plus eight explicit
decision cases through `rss_parser_rust`. A same-request HTTP differential test
compares the policy route, three present claim records, one missing claim, ten
evidence-evaluation requests, and ten ranking requests between FastAPI and Axum
over one disposable PostgreSQL database. It covers a two-root claim,
catalog-only evidence, control-path incomplete/complete cases, missing claims,
ranking order and result fields, Pydantic integer coercion, and validation
errors. The local test script creates the disposable database and applies
Alembic revision `20260720_0003`; the test inserts and removes uniquely named
evidence rows. Claim and observation reads use one SQLx transaction and
connection; claim-read comparison sorts linked observation arrays because
Python specifies no query order. The Rust path never falls back to the
developer's configured database.

The 2026-09-23 checkpoint shadowed seven operations; that count is historical.
The current inventory marks 106 of 178 operations migrated, with public
listener cutover at 0%. The comparison cases add three valid requests and four
validation failures. The Python comparison service now shares Rust similarity,
sentence-diff, and keyword kernels through PyO3, so its differential checks
entity extraction, response assembly, and selected cases rather than
independently validating those shared kernels.

The ownership-interest slice is covered by Python HTTP differential cases for
chains, security-class, voting/economic filters, cycles, overlaps, malformed
qualifiers, and validation. Its exact finite-decimal kernel lives in
`thesis-evidence`; SQLx selects non-retracted rows, prefers `pct` over
`pct_band`, skips malformed or unquantified qualifiers, and surfaces domain
errors. Axum owns query validation and OpenAPI declarations. The rebuilt-server
HTTP differential passed one pytest with four pre-existing deprecation
warnings.

The 2026-09-23 OpenAPI check covered seven Rust operation IDs, and its full
workspace run contained 149 tests. Both are historical counts. The
inventory-driven comparison on 2026-09-25 matched 106 migrated operations.
The 2026-09-25 full workspace run passed 247 tests, with the crate split listed
above. FastAPI remains public and Rust remains shadow-only. The initial
stale-binary 404 is historical. Preserve the current Chroma schema and pin
while replacing the vector-store boundary.

The Python proof suite registers six domain mutation classes but does not
execute them; its registry test supplies a truthy result map. The Rust
`cargo-mutants` workflow below checks generated Rust mutations, but does not
execute those Python domain classes. Port the human cases and a real domain
mutation executor before treating that suite's mutation status as evidence.
The 20 reviewed cases and 22 capture-backed cases are not accepted as
authoritative until their independent review status is complete.

## Verification map

| Invariant or behavior | Rust target | Verification that fits | Current status |
| --- | --- | --- | --- |
| Ownership evidence acceptance follows the versioned predicate table. | `thesis-evidence::evaluate_with_policy` and `decision_failures` | Python differential cases, proptest, Kani on the production scalar kernel. | Unit/property and Python differential tests pass. Six Kani harnesses pass at default unwind 4 with no assumptions. Kani does not cover String/Vec collection or I/O. |
| Catalog-only evidence cannot accept an ownership claim. | `thesis-evidence::decision_failures` | Kani witness, policy tests, and HTTP differential. | Kani harness, Rust test, PyO3 differential, and PostgreSQL HTTP differential pass. |
| Duplicate lineage documents do not increase independent roots. | `thesis-db::lineage_root` and `thesis-evidence::distinct_count` | Rust graph tests, proptest, Kani on the deduplication helper, and DB differential. | Kani proves only `distinct_count`. `lineage_root` multi-parent/cycle tests and PostgreSQL HTTP differential pass; a symbolic map harness did not finish after 90 seconds and was removed. |
| Ranking scores stay capped and results remain sorted by bucket then score. | `thesis-search::ranking::rank_articles` and `cap_score` | Proptest bounds/order properties, Kani for arbitrary floating-point caps and `priority_bucket`, and the PyO3 boundary test. | Workspace property and wrapper tests pass. Two Kani harnesses prove score capping and bucket encoding with no assumptions; Kani does not prove full collection-based ranking. |
| Country mentions remain sorted and unique; shared aliases retain all candidate codes; a longer alias suppresses nested matches, including accented names. | `thesis-search::country_mentions::CountryAliases::extract` | Proptest monotonicity, explicit Rust/PyO3 expectations, direct/article path parity, substring-only shared alias cases, reload tests, legacy snapshot review, and cargo-mutants. | At the country matcher checkpoint, the workspace had 84 tests; six Python boundary tests passed; all 17 selected country-alias mutants were caught. The one-off legacy comparison found 190 differences over 48 base aliases, documented as ambiguous-candidate expansions and nested-alias corrections. Kani and Verus cover only pure range containment, not the regex/Aho-Corasick heap-based matcher. |
| A nested country-alias span remains suppressed through any enclosing span. | `thesis-search::country_mentions::is_inside_alias_range` | Proptest over generated nested endpoints, Kani over symbolic range endpoints with a concrete reachability witness, and Verus over natural-number spans. | The property, two Kani harnesses, and Verus proof pass. Kani assumes ordered ranges and two containment relationships; the concrete witness confirms those assumptions are reachable. Verus proves transitivity for arbitrary span bounds. These checks cover only range containment, not alias discovery or Rust refinement. |
| Host normalization and source identity preserve Python whitespace, suffix-boundary, and configured-family behavior. | `thesis-ingest::source_url_guard::{normalize_host,hosts_match}` | Hypothesis differential against the pre-migration Python rules, Rust proptest, Kani on the production byte-suffix helper, Verus sequence model, and selected cargo-mutants. | Eight Python source-guard tests pass. Unicode differential cases, including U+001F, and empty-host/trailing-dot regressions pass. Two ingest Kani harnesses pass at unwind 4 with no assumptions; six selected mutants are caught. One Verus theorem proves the arbitrary-sequence label-boundary rule; it is not a Rust refinement proof. |
| Topic keywords are case/whitespace normalized, unique, and bounded. | `thesis-search::topics::extract_keywords` | Proptest metamorphic and output-bound properties plus PyO3 boundary fixtures. | Both properties and the keyword boundary tests pass; this does not prove the complete clustering algorithm. |
| Comparison keywords follow Python token boundaries, frequency order, and first-seen ties. | `thesis-search::comparison_keywords::extract_keywords` | Proptest, Python reference differential, Unicode boundary fixtures, Kani comparator harnesses, and Verus priority model. | Workspace tests and Python boundary differential pass. Two Kani harnesses verify the production comparator over symbolic `usize` values with no assumptions. Verus proves the natural-number priority relation, not Rust refinement or Unicode tokenization. FastAPI still owns the comparison HTTP route. |
| Topic similarities remain in the unit interval for valid set counts. | `thesis-search::topics::rounded_jaccard` | Kani over symbolic `u8` overlap/union counts and a concrete zero/one witness. | Passed at unwind 4 with no assumptions. The harness proves the scalar helper only. |
| Topic clusters follow feed order regardless of input vector order. | `thesis-search::topics::cluster_articles_lexical` | Regression case over a reversed input vector and PyO3 boundary fixture. | Rust and Python-boundary cases pass; generated graph/permutation exploration is not yet implemented. |
| CAMEO root normalization retains the first two ASCII digits and pads a single digit with zero. | `thesis-ingest::gdelt_taxonomy::{first_two_ascii_digits,normalize_cameo_root_code}` | Proptest, PyO3 fixtures, Kani over symbolic four-byte inputs, and a Verus sequence model. | Kani passed at unwind 5 with no assumptions; fixed witnesses cover zero, one, and two digits. It reported one unreachable standard-library formatting check. Verus passed five checks over arbitrary finite byte sequences. The Verus model does not prove Rust refinement. Non-ASCII Unicode numerals remain rejected. |
| Goldstein buckets match the +/-4.0 thresholds, including NaN behavior. | `thesis-ingest::gdelt_taxonomy::goldstein_bucket` | Kani on arbitrary `f64` values, boundary unit tests, and the aggregate caller test. | One Kani harness passed at unwind 4 with no assumptions; NaN maps to `mixed`, matching Python comparison behavior. |
| A bounded vector's self-dot product is nonnegative. | `rss_parser_rust::blindspot::dot_product` | Kani over three symbolic `i8` components converted to finite `f64` values. | One production harness passes with no assumptions and unwind 5. It does not cover arbitrary vector lengths or non-finite input values. |
| Dominant CAMEO roots preserve count order and first-seen ties. | `thesis-ingest::gdelt_taxonomy::dominant_cameo_roots` | Proptest limit/order checks and explicit tie-order PyO3 fixture. | Rust and Python boundary tests pass, including negative limits and first-seen tie order. |
| MinHash estimates remain symmetric and within `[0, 1]`; unequal signature lengths score zero. | `thesis-search::minhash::estimate_jaccard_similarity` | Proptest over signature vectors, Kani over production fixed-size signatures, and Verus over the unbounded count-ratio model. | Kani checks arbitrary four-element signatures with unwind override 5, unequal lengths at default unwind 4, and a perfect-match witness. Proptest and Verus pass. The Verus model is not a refinement proof of the floating-point Rust implementation. |
| Exact and near-duplicate links form disjoint article groups. | `thesis-search::minhash::deduplicate_article_groups` | Rust regression case, Python-to-PyO3 boundary test, and exact-text fixtures. | Three linked articles yield one group. Exact grouping uses full text rather than a lossy digest. The heap-backed disjoint-set implementation is not Kani- or Verus-proved. |
| Evidence evaluation stays contract-compatible. | `thesis-api::evaluate_claim` | Normalized OpenAPI comparison and same-request HTTP differential. | OpenAPI comparison passes. Ten success, missing-claim, and validation requests match FastAPI over the same migrated PostgreSQL database. |
| Evidence policies and claim reads stay contract-compatible. | `thesis-api::get_evidence_policies`, `thesis-api::claims::get_claim`, and `thesis-db::load_claim_record` | Normalized OpenAPI comparison, typed-mapping unit test, and same-request differential over disposable PostgreSQL. | Both OpenAPI operations match. Policy JSON, three present claim responses, and the runtime missing-claim 404 match FastAPI; observation order is canonicalized because Python does not specify it. The route is shadow-only. |
| Relationship listing preserves time-axis filtering, direction, filters, ordering, and evidence-root counts. | `thesis-api::relationships::get_relationships` and `thesis-db::relationships::list_relationships` | Normalized OpenAPI comparison, route tests, and same-request differential over disposable PostgreSQL. | OpenAPI and HTTP responses match for separate `as_of`/`known_at` bounds, inclusive validity, exclusive retraction, status preservation, predicate/entity filters, direction, claim ordering, root counts, and validation error categories. FastAPI remains public. No Kani or Verus proof is claimed for SQLx, HTTP parsing, or heap-backed lineage traversal. |
| Ownership-interest calculation preserves exact finite-decimal ranges, path filters, and cycle/overlap flags. | `thesis-evidence::ownership`, `thesis-db::ownership_interest`, and `thesis-api::interest` | Focused Rust tests, Python HTTP differential, Axum validation/OpenAPI comparison. | At the 2026-09-23 checkpoint, focused `thesis-evidence`/`thesis-db`/`thesis-api` tests passed 45 cases and the workspace passed 149 tests; both counts are historical, superseded by the later 247-test workspace run. Direct format, Clippy, and `cargo build -p thesis-server` checks passed at that checkpoint. The rebuilt-server HTTP differential passed one pytest with four pre-existing deprecation warnings. OpenAPI compatibility passed all seven Rust operation IDs at that checkpoint. Malformed or unquantified qualifiers are skipped and domain errors surface. FastAPI remains public; no formal model run or Rust refinement proof is claimed. |
| Personalized ranking stays contract-compatible. | `thesis-api::ranking::post_ranked_articles` | Normalized OpenAPI comparison, same-request HTTP differential, and route test. | OpenAPI comparison passes. Ten valid and invalid requests match FastAPI. The route remains shadow-only. |
| Article comparison preserves its API contract and deterministic response invariants. | `thesis-api::comparison::post_compare_articles` and `thesis-search::article_comparison::compare_articles` | Normalized OpenAPI comparison, Axum route tests, Python service differential, proptest, Kani keyword-emphasis kernel, and same-request HTTP differential. | OpenAPI matches. Three service fixtures and three valid plus four invalid HTTP requests match after canonicalizing Python's set-ordered lists. Kani checks only the scalar keyword-emphasis rule; properties check bounded symmetric similarity and summary/list count consistency. FastAPI remains public. |
| Language-diagnostic severity cannot decrease as the rate or score increases. | `thesis-search::language_diagnostics::{status_for_rate,status_for_score}` | Kani monotonicity harness and Hypothesis Python differential for text output. | One Kani harness passed 34 checks at unwind 1 with no assumptions. Unicode and generated-pattern text match the retained Python reference; regex and phrase policy are not formally proved. |
| A stale embedding generation cannot commit. | `docs/agents/formal-audit/EmbeddingGeneration.tla` with `.cfg`; future `thesis-runtime::embedding` state transition | Finite TLA+ state exploration and Loom synchronization tests. | The artifact is a bounded, model-only specification; no TLC, Loom, or Rust refinement pass is claimed. |
| Proposed ownership transactions preserve current ownership until effective time. | `docs/agents/formal-audit/Ownership.lean`; future ownership reducer and database transaction | Independent Lean state-machine model, then Rust correspondence tests. | The artifact is a finite/list model only; no Lean pass or Rust refinement claim is recorded. |

Apply both Kani and Verus to pure Rust decision kernels as they enter the
workspace. Kani checks bounded executions of production helpers; Verus proves
general properties where an unbounded proof adds coverage. Record when a tool
does not fit a kernel rather than treating test-only coverage as a proof.

The repository already has Lean and finite TLA+ models under
`docs/agents/formal-audit/` for selected audit, ingestion, cache, reporter, and
research behaviors. They are not Rust runtime specifications and do not
establish implementation refinement. `Ownership.lean` and
`EmbeddingGeneration.tla/.cfg` are bounded, model-only artifacts for the
ownership and embedding targets. For the ownership-interest slice, `tlc`,
`lean`, `lake`, `verus`, and `cargo-kani` were unavailable; Java existed but
`TLA_TOOLS_JAR` was unset and no repository TLA+ jar was present. No new formal
model run is claimed.

The source-host Verus file proves that appending a domain matches only when a
nonempty prefix ends with a label separator. It is an abstract byte-sequence
model; the production Rust helper has a separate Kani harness and differential
tests. No Rust refinement claim is made.

The evidence Verus model proves that appending a qualifying observation from
an already represented root leaves root membership unchanged for every root.
Kani checks the corresponding production `distinct_count` helper over symbolic
`u8` roots without assumptions. The country-span Verus model proves
containment transitivity over arbitrary natural-number bounds; Kani checks the
production range helper and includes a concrete witness for its symbolic
assumptions. The MinHash Verus model proves the mathematical count-ratio bound
for arbitrary natural-number signature lengths under valid-count preconditions;
Kani checks the Rust estimator on four-element symbolic signatures. These
models specify domain properties independently; they do not prove Rust
refinement.

Kani candidates across later slices include parser boundaries, ID and URL
normalization, pagination bounds, numeric ownership calculations, evidence
state transitions, score ordering, and state-machine reducers. For every harness,
record the exact unwind bound and assumptions; include a concrete positive or
negative witness so assumptions cannot make the proof vacuous.

Further Verus candidates are the finite evidence decision kernel, ownership
aggregation, identity resolution, and temporal ordering rules after the
executable boundary is stable. Lean should specify the domain independently of
code. Initial theorem
statements should include: a proposed transaction leaves current owner state
unchanged; a completed transaction changes state only at effective time;
membership is not ownership; nonprofit operation is distinct from ownership;
minority interest does not imply ultimate control; catalog-only evidence cannot
accept a forbidden predicate; `as_of` and `known_at` remain separate; conflict
does not become acceptance; rename is not acquisition; and relation direction
is preserved. Map each theorem to the Rust reducer; do not claim implementation
verification until an explicit refinement relation is proved.

TLA+ models should cover RSS refresh and persistence, embedding generation and
vector synchronization, startup leadership, bounded queues, retry/recovery,
shutdown/cancellation, agent tool retries, and at-most-once final delivery. Key
safety properties are no stale generation commit, no vector-success marker
before vector write, no duplicate accepted persistence, no commit after
cancellation or shutdown invalidation, one committed result per logical tool
call, no duplicate final output, and no terminal-to-running transition. Begin
with two workers, two jobs, and two retries. Turn each counterexample trace into
a deterministic Rust test. Loom targets the queue and generation-fence
synchronization; it does not replace the protocol model.

## Proptest, mutation, and performance

The first `proptest` property adds several observations from one source and
checks that independent-root count and acceptance do not change. Kani 0.68.0
with CBMC 6.11.0 passed six evidence harnesses at default unwind 4. Their
harnesses have no assumptions. They exercise the production allocation-free
failure-mask decision kernel and three-element root-deduplication helper; they
do not verify SQLx, HTTP transport, or String/Vec evidence collection. The
initial full-evaluator harness spent minutes in modeled allocation code and
was replaced by this narrower proof boundary.

`thesis-search` generates article lists with optional likes, bookmarks,
favorite sources, and images. Its property checks result-count preservation,
finite scores and configured caps, bucket bounds, the six-keyword limit, and
bucket/score ordering. Ten Kani harnesses pass at unwind 4: two ranking
kernels and one Jaccard bound have no assumptions; two range-containment
harnesses check symbolic transitivity and a concrete reachable witness; three
MinHash harnesses check fixed-signature bounds, unequal lengths, and a perfect
match. These proofs do not verify the collection-based scorer, alias discovery,
or SQL/API layers.

The RSS/PyO3 crate has a bounded Kani harness on the production blindspot
`dot_product` helper. It establishes nonnegativity for every three-component
vector drawn from `i8` values and converted to finite `f64`. It does not cover
arbitrary vector lengths, NaN/infinite values, or the full scoring pipeline.

The topic core preserves the Python-facing PyO3 function names while moving
keyword extraction, lexical clustering, and labels into `thesis-search`.
Properties verify case/outer-whitespace invariance, keyword uniqueness, and the
ten-keyword cap. A third search Kani harness checks rounded Jaccard bounds for
valid overlap/union pairs using symbolic `u8` inputs and no assumptions, plus
fixed zero and one witnesses. A permutation regression test fixes cluster and
member output order to the supplied feed positions. These checks do not prove
all clustering behavior or replace captured-corpus comparison.

The article comparison domain from `article_comparison.py` now lives in
`thesis-search::article_comparison`; its keyword extractor remains a reusable
`thesis-search::comparison_keywords` module. The comparison facade delegates
entity logic to `article_comparison/entities.rs` and text logic to
`article_comparison/text.rs`; tests and the Kani harness use path modules.
The domain preserves Python's ASCII token pattern, stop words, frequency
order, first-seen ties, and `top_n` behavior. The Rust scanner uses Unicode
general categories and the PyO3 adapter reads the running
Python Unicode database version for CJK Extension I boundaries. A generated
Python reference differential covers a controlled non-stopword vocabulary;
separate fixtures cover stop words and Unicode boundaries. Two Kani harnesses
check the production comparator over symbolic `usize` values with no
assumptions. The article-comparison module adds one Kani harness for the
production keyword-emphasis enum over symbolic `u16` frequencies, plus
properties for similarity symmetry/range and summary/list count agreement.
Verus checks an independent natural-number priority model. Neither proof covers
the token scanner, full article comparison, or Rust refinement. Axum now serves
`/compare/articles` on the shadow listener; keep the Python route and PyO3
bindings until the public listener and all Python callers move to Rust.


The GDELT taxonomy helpers now live in `thesis-ingest`. Proptest checks root
normalization idempotence and dominant-root output bounds/order. Kani checks
the production byte helper over symbolic four-byte inputs against a
position-based reference, with fixed no-digit, one-digit, and two-digit
witnesses. It uses unwind 5 and no assumptions; the run reports one unreachable
standard-library formatting check outside the normalized byte decision. Verus
proves the corresponding first-two-digit and zero-padding rule over arbitrary
finite byte sequences with no assumptions. It is an abstract model, not a Rust
refinement proof. A separate Kani harness checks Goldstein threshold
classification for arbitrary `f64` values, including NaN through the
production enum decision. Python tests cover labels, exact threshold
neighbors, first-seen ties, negative limits, and the existing
`build_article_gdelt_context` caller. CAMEO codes are ASCII identifiers;
malformed Unicode numeric characters are intentionally rejected.

Later properties should cover normalization idempotence, parse/serialize
round trips, pagination, score monotonicity, and transformations against
simple reference implementations. Fuzz RSS/Atom, URL, text, external JSON,
imports, and evidence snapshot parsers using the repository's captured inputs.

Keep the existing benchmark suite. Add Criterion baselines for RSS parsing,
deduplication, ranking, query mapping, serialization, evidence evaluation, and
hot API paths. The first Rust MinHash baseline is recorded on one local host:
Rust 1.98.0-nightly, Ryzen 5 3600, Linux 6.18.45. With 10 samples and a
2-second measurement window, a 128-hash signature measured 489.60–506.17 µs;
pair detection and grouping over 64 articles measured 30.369–31.490 ms and
30.545–31.386 ms. The 64-article runs each had two high outliers. This is not a
Python comparison or a speedup claim; other Rust baselines remain unmeasured.
Repeat with `cargo bench --manifest-path backend/Cargo.toml -p thesis-search
--bench minhash`. The migration workflow runs
`cargo-mutants` for evidence acceptance, ranking score, and country alias
functions on schedule or manual dispatch. Topic clustering needs its own
focused mutation pass. Verification-only Kani harnesses are not mutated. It filters three
equivalent substitutions: XOR for OR across disjoint failure bits, and `&&` to
`||` where profile construction makes empty category/source keys unreachable.
The ownership-interest kernel has focused tests but no formal proof is claimed.

## CI tiers

The fast gates live in `.github/workflows/rust-backend.yml`: Cargo format,
Clippy, and workspace tests; PyO3 service-boundary comparisons; evidence
regressions; a disposable PostgreSQL service migrated with Alembic; same-request
HTTP comparisons; and normalized OpenAPI compatibility. The root `verify.sh`
also runs Cargo format, Clippy, workspace tests, and the inventory-driven
OpenAPI comparison for all 106 operations marked `migrated: true` as of
2026-09-25. The 2026-09-23 ownership-interest checkpoint passed OpenAPI
compatibility for seven Rust operation IDs. No new formal model run is claimed
for ownership interest: `tlc`, `lean`, `lake`, `verus`, and `cargo-kani` were
unavailable; Java existed but `TLA_TOOLS_JAR` was unset and no repository
TLA+ jar was present.
Kani at default unwind 4 and seven pinned Verus
models run on pull requests, main pushes, scheduled runs, and manual dispatch. The MinHash
fixed-array harnesses override unwind to 5. The Verus models cover source-host
boundaries, CAMEO root normalization, evidence-root semantics, nested alias
spans, the mathematical MinHash ratio, comparison-keyword priority, and entity
partitioning; they do not establish Rust refinement. Lean, TLC, Loom, fuzz campaigns, and the
remaining Criterion/end-to-end benchmarks remain planned.
The scheduled mutation job installs cargo-mutants 27.1.0 and tests selected
evidence, ranking, country alias, and article-comparison functions; it does
not run the Python proof suite's registered domain mutation classes.

## Slice cutover and deletion rules

The 178-operation HTTP inventory alone is not sufficient to run or cut over the
whole backend in Rust: it excludes `/ws` and schema-hidden `/resources`,
`/performance`, `/runtime`, and `/health`, and does not establish SSE/WebSocket
semantics, app lifecycle/workers, cache/provider state, Alembic ownership,
shutdown, deployment, rollback, or soak behavior. See [Existing boundaries and
ownership](#existing-boundaries-and-ownership), [Migration phases and Python
modules](#migration-phases-and-python-modules), [Temporary Python boundaries
and deletion criteria](#temporary-python-boundaries-and-deletion-criteria),
[Verification map](#verification-map), and [CI tiers](#ci-tiers).
FastAPI stays public until all documented gates pass, including a deployed-build
soak of at least 24 hours and two relevant worker cycles; increase the soak when
a worker runs less often.

Keep each migrated route in shadow or explicit Rust-owned mode until all of
these hold: normalized OpenAPI parity; same-request Python/Rust semantic parity
against PostgreSQL; the existing route, CLI, and frontend tests pass; evidence
truth data passes independently reviewed cases; relevant worker cycles pass;
restart and rollback are rehearsed; the deployed build has soaked for at least
24 hours and two relevant worker cycles. Increase the soak when a worker runs
less often. Remove the replaced Python module only after imports and runtime
traces show no callers and the rollback build is retained.

The evidence read endpoints and B16 claim materialization route are shadow-only,
not public Rust ownership. Do not switch public claim materialization to Rust
until the corpus review, OpenAPI, same-request behavior, and runtime gates pass.
