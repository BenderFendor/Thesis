# Test Catalog

This catalog records behavior pinned by focused tests and their coverage limits
for Rust news-cache, debug events, research/search, wiki, analytics, Atlas, and
evidence APIs.
Rust exposes 143/178 HTTP operations: 106 parity-proven, 37 registered-
unverified, and 35 unregistered; public cutover remains 0%.
B04 startup and database-articles tests are source-added but unrun. The B16
proof download remains unregistered pending a locked ZIP writer and runtime
verification.

## B02 Rust news-cache and source-catalog tests

### Cached page filtering and pagination
- Test: `backend/crates/thesis-api/src/news_cache_tests.rs::cached_page_filters_sources_and_paginates`
- Run from `backend/`: `cargo test -p thesis-api news_cache_tests --lib`
- Covers: category, search, case-insensitive source filtering, source-list precedence
  and fallback, page cursors, unconfigured-source IDs, and negative-offset rejection.
- Avoids: database or RSS network access, and query validation cases beyond negative offsets.

### Cached index filtering and headers
- Test: `backend/crates/thesis-api/src/news_cache_tests.rs::cached_index_filters_and_sets_cache_headers`
- Run from `backend/`: `cargo test -p thesis-api news_cache_tests --lib`
- Covers: combined category, source, and search filtering plus `Cache-Control` and
  `Vary` headers.
- Avoids: other filter combinations and cache freshness over time.

### Source and category routes
- Test: `backend/crates/thesis-api/src/news_cache_tests.rs::source_and_category_routes_project_configured_articles`
- Run from `backend/`: `cargo test -p thesis-api news_cache_tests --lib`
- Covers: configured-source articles, unknown-source 404, and category totals
  and source names.
- Avoids: RSS fetches, database reads, and duplicate-key catalog decoding.

### Source-stats validation failure and success
- Test: `backend/crates/thesis-api/src/news_cache_tests.rs::source_stats_reject_invalid_rows_and_accept_valid_rows`
- Run from `backend/`: `cargo test -p thesis-api news_cache_tests --lib`
- Covers: the exact 500 text response for partial source stats and a 200 response
  with every configured source and string-valued `last_checked` and `url`.
- Avoids: each possible invalid field type and live FastAPI execution.

### Default empty routes
- Test: `backend/crates/thesis-api/src/news_cache_tests.rs::default_empty_routes_return_empty_data_and_source_stats_error`
- Run from `backend/`: `cargo test -p thesis-api news_cache_tests --lib`
- Covers: the empty cached page shape, an empty configured-source response, and the default source-stats 500 response.
- Avoids: populated-cache filtering and pagination.

### Duplicate catalog keys
- Test: `backend/crates/thesis-api/src/source_catalog.rs::tests::catalog_object_uses_last_duplicate_value_and_first_position`
- Run from `backend/`: `cargo test -p thesis-api source_catalog::tests --lib`
- Covers: last-value-wins behavior while preserving the duplicate key's first position.
- Avoids: RSS network access, HTTP route behavior, and parsing every production catalog field.

### Unique configured source names
- Test: `backend/crates/thesis-api/src/source_catalog.rs::tests::configured_catalog_names_are_unique`
- Run from `backend/`: `cargo test -p thesis-api source_catalog::tests --lib`
- Covers: exact source-name uniqueness in the decoded checked-in catalog.
- Avoids: duplicate-key precedence, URL validation, and network behavior.

## B04 Rust debug cache route
Route: `GET /debug/cache/articles`.

- Tests (5): `debug_cache_filters_exact_source_paginates_and_projects_nullable_fields`,
  `debug_cache_defaults_and_blank_source_return_cache_order`,
  `debug_cache_rejects_invalid_page_bounds`,
  `debug_cache_reports_malformed_articles_as_generic_server_errors`, and
  `openapi_registers_debug_cache_operation_and_exact_schemas` in
  `backend/crates/thesis-api/src/news_cache_tests.rs`.
- Run from `backend/`: `cargo test -p thesis-api debug_cache --lib`
- Covers: case-sensitive exact source matching; absent and blank source
  behavior; source echo; cache-order preservation; match totals before paging;
  the empty-page offset boundary; narrow nine-field article projection,
  category defaults and nullable fields; query conversion and bounds errors;
  generic 500 on any malformed cached article; and the exact OpenAPI query,
  response, and nullable schemas.
- Avoids: live production cache data, Python `NewsCache` sharing, database
  queries, RSS refresh, and network access. Tests inject `CacheStreamState` and
  use a lazy database handle. The production server's default cache is empty
  and has no configured cache refresh provider.

## B04 Rust debug startup route

- Route: `GET /debug/startup`; operation ID
  `get_startup_metrics_debug_startup_get`.
- Source tests:
  `backend/crates/thesis-api/src/lib.rs::tests::startup_metrics_are_available_without_debug_mode_and_leave_debug_streams_optional`
  verifies the default router projects the shared startup note/event fields and
  leaves `/debug/streams` absent without debug config; database article listing
  is a separate root-mounted exception.
  `backend/crates/thesis-api/src/lib.rs::tests::startup_route_does_not_conflict_with_optional_debug_router`
  verifies the startup route merges cleanly when debug config is supplied.
- OpenAPI test: `backend/crates/thesis-api/src/lib.rs::tests::debug_startup_openapi_matches_fastapi_success_contract`.
  It verifies the operation ID, `StartupMetricsResponse` schema, and sole 200
  response.
- Run from `backend/`:
  `cargo test -p thesis-api startup_metrics_are_available_without_debug_mode_and_leave_debug_streams_optional --lib`,
  `cargo test -p thesis-api startup_route_does_not_conflict_with_optional_debug_router --lib`,
  and `cargo test -p thesis-api debug_startup_openapi_matches_fastapi_success_contract --lib`.
- Avoids: database queries, external providers, other debug handler behavior,
  runtime behavior, and FastAPI parity. Tests use a lazy database and in-memory
  `ProfilingState`; they were not run under the no-Cargo gate.

## B04 Rust database articles route

- Route: `GET /debug/database/articles`; the default root router uses the
  shared `AppState` database. The inventory row remains `migrated:false`.
- Rust source tests:
  `backend/crates/thesis-api/src/lib.rs::tests::database_debug_enable_database_setting_matches_fastapi_environment_values`,
  `backend/crates/thesis-api/src/lib.rs::tests::database_debug_articles_are_root_mounted_and_validate_before_database_access`,
  `backend/crates/thesis-api/src/lib.rs::tests::database_debug_articles_returns_unavailable_when_database_is_disabled`,
  `backend/crates/thesis-api/src/lib.rs::tests::database_debug_articles_openapi_matches_fastapi_operation_contract`,
  and `backend/crates/thesis-api/src/debug/articles.rs::tests::boolean_query_accepts_pydantic_literals_and_rejects_unknown_values` /
  `boolean_query_rejects_surrounding_whitespace_like_fastapi`.
- Rust commands from `backend/`:
  `cargo test -p thesis-api database_debug_articles --lib`,
  `cargo test -p thesis-api database_debug_enable_database_setting_matches_fastapi_environment_values --lib`,
  and `cargo test -p thesis-api boolean_query --lib`.
- HTTP differential test:
  `backend/tests/test_rust_evidence_http_differential.py::test_debug_database_articles_matches_fastapi_against_migrated_postgres`.
  Run from the repository root with a disposable Alembic-migrated database and
  a prebuilt `backend/target/debug/thesis-server`:
  `THESIS_TEST_DATABASE_URL=postgresql://... .venv/bin/pytest -q backend/tests/test_rust_evidence_http_differential.py -k debug_database_articles_matches_fastapi_against_migrated_postgres`.
- Covers: source and missing-embedding filters, ascending/descending order,
  pagination totals, inclusive date bounds, defaults, invalid sort values,
  Pydantic boolean literals/whitespace rejection, and exact Rust/FastAPI JSON.
- Avoids: external providers and live network calls. Tests were added but not
  run under the no-Cargo gate; the route remains a shadow and parity is unverified.

## B06 queue digest route, provider adapters, and inventory

### Queue digest route: `POST /api/queue/digest`

- Tests: 9 route tests in
  `backend/crates/thesis-api/src/queue_digest_tests.rs`.
- Run from `backend/`: `cargo test -p thesis-api queue_digest_tests --lib`
- Covers: request and malformed-JSON validation; generic responses for a
  missing or failed provider; ordered prompt construction; normalized
  structured response fences and article projection; JSON object insertion
  order; and OpenAPI request/response schemas.
- Avoids: database access and external model calls. Route tests use a lazy
  database handle and an injected test provider; they do not test the real HTTP
  adapter's retry behavior.

### Provider adapter

- Tests: 6 in `backend/crates/thesis-server/src/queue_digest_provider.rs`.
- Run from the repository root:
  `cargo test --manifest-path backend/Cargo.toml --locked -p thesis-server queue_digest_provider`
- Covers: provider configuration, OpenRouter and llama.cpp request bodies,
  OpenCode attribution headers and request IDs, generic upstream failure with
  no retry, and malformed completion handling.
- Avoids: live external LLM calls. HTTP requests go to a local fixture server;
  the suite does not establish completion quality or remote provider
  availability.

### Queue operation inventory contract

- Test: `backend/tests/test_rust_reading_queue_contract.py`.
- Run from the repository root:
  `.venv/bin/pytest -q backend/tests/test_rust_reading_queue_contract.py`
- Covers: exact paths, methods, and operation IDs for all 19 queue operations;
  queue-digest migration risk; OpenAPI methods, bodies, and success statuses;
  local FastAPI queue behavior; and selected SQL transaction and metadata
  boundaries.
- Avoids: sending all 19 operations through a live Rust server, using a live
  database, and calling external providers.

## OpenAPI compatibility inventory

- Test: `backend/tests/test_openapi_compat_inventory.py`
- Command from the repository root: `.venv/bin/pytest -q backend/tests/test_openapi_compat_inventory.py`
- Covers: runs `scripts/check_openapi_compat.py` with temporary Python and Rust
  OpenAPI specs and inventory data. Confirms that it compares the migrated ID,
  ignores a pending ID with a mismatched schema, and rejects an empty migrated
  ID or an inventory with no migrated IDs.
- Avoids: starting `thesis-server`, generating production OpenAPI, running
  Cargo, using a database or network service, and exercising `verify.sh` shell
  wiring.

## B13 Rust analytics SQL tests

### GDELT read and aggregation semantics
- Test: `backend/crates/thesis-db/src/analytics.rs::gdelt_queries_limit_top_groups_before_dropping_unmatched`
- Run from `backend/`: `cargo test -p thesis-db analytics::tests::gdelt_queries_limit_top_groups_before_dropping_unmatched`
  with `DATABASE_URL` set to a disposable PostgreSQL cluster.
- Covers: article-event count and limit, total/matched and URL/embedding counts,
  recent-event order and unmatched filtering, plus a NULL article group with
  count three consuming one of the top ten slots and preserving matched rank order.
- Avoids: live GDELT HTTP, Chroma embeddings, production schema migrations, and
  synchronization writes; the test creates isolated fixture tables.

### Persisted snapshot and source metadata projection
- Test: `backend/crates/thesis-db/src/analytics.rs::snapshot_article_loader_uses_persisted_snapshot_and_source_metadata`
- Run from `backend/`: `cargo test -p thesis-db analytics::tests::snapshot_article_loader_uses_persisted_snapshot_and_source_metadata`
  with `DATABASE_URL` set to a disposable PostgreSQL cluster.
- Covers: latest topic snapshot loading and article projection with source
  country, bias, factual rating, and author fields.
- Avoids: live GDELT HTTP, Chroma embeddings, production schema migrations, and
  synchronization writes; the test creates isolated fixture tables.

## B13 Rust analytics API tests

### GDELT query parsing
- Tests: `backend/crates/thesis-api/src/gdelt.rs::tests::integer_query_defaults_and_bounds_match_gdelt_contract`
  and `boolean_query_accepts_fastapi_boolean_forms_and_rejects_others`.
- Run from `backend/`: `cargo test -p thesis-api gdelt::tests`.
- Covers: integer defaults/min/max and out-of-range validation, plus accepted
  FastAPI boolean spellings and invalid boolean errors.
- Avoids: database access, GDELT HTTP, and Chroma matching.

### Analytics read-route validation
- Test: `backend/crates/thesis-api/src/lib.rs::tests::analytics_read_routes_preserve_validation_contracts`
- Run from `backend/`: `cargo test -p thesis-api analytics_read_routes_preserve_validation_contracts --lib`
- Covers: `hours=0` produces the GDELT query-bound 422 shape and an unknown
  blindspot lens produces the literal-validation 422 shape.
- Avoids: valid database reads, GDELT HTTP, and Chroma matching.

### Blindspot viewer snapshot projection
- Tests: `backend/crates/thesis-api/src/blindspots.rs::tests::persisted_bias_snapshot_builds_lane_and_card_from_distinct_sources`
  and `category_and_source_filters_reduce_snapshot_eligibility`.
- Run from `backend/`: `cargo test -p thesis-api blindspots::tests`.
- Covers: snapshot articles plus persisted article metadata produce lane/card
  data, and category/source filters reduce eligibility.
- Avoids: live database, Chroma, and provider calls; tests use in-memory fixtures.

## Rust shadow route registration and deliberate gaps

### Central OpenAPI registration
- Test: `backend/crates/thesis-api/src/lib.rs::tests::rust_openapi_contains_the_existing_operation_id_and_statuses`
- Run from `backend/`: `cargo test -p thesis-api rust_openapi_contains_the_existing_operation_id_and_statuses --lib`
- Covers exact operation IDs and 200 responses for mounted analytics, debug,
  research, verification, wiki, and Atlas routes, including Atlas index, export,
  stats, and evidence materialization. It asserts 422 for Atlas index/export
  and evidence materialization, verifies the export request-body schema and
  stats response schema, and checks evidence materialization's
  `AcceptedRelationshipRecord` response, required reviewer, optional token,
  and `complete_control_path=false` default. Verification provider/cache routes,
  GDELT sync, Chroma-dependent blindspot routes, wiki index triggers, and
  evidence proof download remain absent from Rust OpenAPI. Atlas graph,
  connections, search, index, export, stats, and evidence materialization are
  registered but unverified.
- Avoids: runtime database/provider behavior, Chroma, live FastAPI, and public
  listener cutover.

## B04 Rust debug-event tests

- Command from repository root: `cargo test --manifest-path backend/Cargo.toml -p thesis-api debug::tests --lib`.
- `debug_event_route_validates_limits_and_event_types`: checks 422 for
  `limit=0` and 400 for an unknown event type; avoids Python debug logger parity.
- `frontend_report_is_normalized_retained_and_logged`: checks report
  normalization, JSONL persistence, and its generated custom event returned by
  `/debug/logs/events`; avoids Python `debug_logger` events and other Rust ring sources.
- `file_reader_filters_and_pages_jsonl_events_and_rejects_traversal`: checks
  file event-type filtering, offset/limit paging, 404 and 400 status/body details,
  and path traversal rejection; avoids asserting log-directory defaults match Python.
- The event ring covers frontend-ingestion-generated events only, not Python
  request/stream/cache/database/RSS `debug_logger` events.

## B07 Rust news-research tests

- Command from repository root: `cargo test --manifest-path backend/Cargo.toml --message-format short -p thesis-api --lib news_research`.
- `model_catalog_tracks_only_models_available_for_the_active_provider`:
  provider filtering, OpenCode deduplication/order/default; avoids provider SDK calls.
- `models_route_returns_the_configured_catalog_shape`: GET catalog JSON shape;
  avoids validating live credentials or provider availability.
- `research_request_is_strict_for_known_fields_and_defaults_thinking`: request
  field types/defaults and ignored unknown fields; avoids agent execution.
- `stream_query_accepts_history_and_pydantic_boolean_forms`: history, boolean,
  and malformed-history parsing; avoids live streaming.
- `stream_query_parse_error_has_fastapi_query_location`: missing query 422
  location/type; avoids provider execution.
- `post_research_runs_retrieval_and_projects_fixture_evidence`: fixture
  retrieval/synthesis and response projection; avoids real DB, Chroma, and LLM.
- `unavailable_post_fails_instead_of_returning_a_canned_answer`: missing
  provider returns 500 rather than a fabricated answer; avoids provider calls.
- `stream_route_preserves_sse_frames_and_returns_in_band_provider_errors`:
  fixture SSE status/completion and unavailable-provider error frames; avoids
  real network, actual agent streaming, and cancellation/disconnect semantics.
- `stream_error_events_preserve_provider_error_classification`: rate-limit,
  timeout, and 503 classification/retryability; avoids network/provider calls.

### Default shadow-router provider behavior
- Test: `backend/crates/thesis-api/src/lib.rs::tests::research_routes_preserve_unavailable_provider_contracts`
- Run from `backend/`: `cargo test -p thesis-api research_routes_preserve_unavailable_provider_contracts --lib`.
- Covers: unavailable search returns 503, inline returns an explicit failure,
  model catalog returns 200, research POST returns 500, and research stream
  returns an SSE response.
- Avoids: external LLM/search providers, live Chroma, and cancellation parity.

## B12 Rust verification tests

- Command from `backend/`: `cargo test --message-format short -p thesis-api verification::tests --lib`.
- `status_and_domain_routes_reflect_supplied_runtime_settings`: mounted status
  and domain response fields; avoids process-global environment mutation.
- `allowlist_requires_an_exact_host_or_dot_delimited_subdomain`: host casing,
  subdomain boundaries, `//` URLs, attacker suffixes, and missing scheme; avoids DNS.
- `domain_configuration_keeps_order_duplicates_and_python_whitespace`: trims
  Python control whitespace while retaining ordering/duplicates; avoids env mutation.
- `verification_handlers_validate_before_disabled_status_and_preserve_defaults`:
  wrong query type, confidence bound/context, disabled 503, defaults, extras;
  avoids pinning every Pydantic error wording.
- `verify_handler_returns_provider_result_and_rejects_disallowed_sources`:
  deterministic provider success and off-allowlist rejection; avoids live search.
- `json_handler_builds_summary_claim_and_source_projection`: response projection;
  avoids pinning incidental implementation wording.
- `missing_providers_fail_explicitly_without_success_shaped_results`: direct
  helpers fail closed without providers/cache; does not imply mounted routes.
- `cache_route_deletes_expired_rows_and_schedules_workspace_cleanup`: in-memory
  expiry and cleanup scheduling; avoids database/workspace integration.
- `cache_cleanup_error_matches_python_zero_count_and_still_schedules_workspaces`:
  cache error count and workspace scheduling; avoids a real database.
- `stream_frames_started_claim_progress_and_complete_in_order`: fixture SSE
  frame sequence/headers/progress; does not prove incremental streaming,
  cancellation, or production provider behavior.
- `runtime_router_mounts_only_environment_backed_read_operations`: local router
  returns 404 for verify, JSON, stream, and cache operations.
- `module_annotations_retain_all_six_requested_contracts`: checks all six
  module annotations/schema refs; it does not count handler annotations as mounted
  or add the four provider/cache routes to central ApiDoc.

### Root router mounts only the two environment-backed reads
- Test: `backend/crates/thesis-api/src/lib.rs::tests::verification_status_and_domains_use_environment_config`
- Run from `backend/`: `cargo test -p thesis-api verification_status_and_domains_use_environment_config --lib`.
- Covers: central router status/domain responses and consistency between the
  configured domain list and its reported count.
- Avoids: provider/cache/workspace operations and global environment mutation.

## B14/B15 Rust wiki and Atlas tests

- Command from `backend/`: `cargo test -p thesis-api wiki --lib --message-format short`.
- `pagination_validation_matches_fastapi_bounds_and_types`: list bounds and
  integer parsing; avoids routing/database behavior.
- `query_validation_errors_have_fastapi_query_location`: 422 query error
  locations; avoids transport behavior.
- `source_listing_uses_canonical_names_for_deduplication_and_db_joins`: alias
  collapse and canonical metadata/score/index joins; avoids a database/network.
- `source_aliases_resolve_to_canonical_database_name`: alias-to-canonical
  mapping; avoids handler/database behavior.
- `reporter_dossier_projects_persisted_profile_and_recent_articles`: dossier
  field and article response projection; avoids database merge resolution and
  remote enrichment.
- `funding_statistic_uses_persisted_trace_projection`: persisted Atlas
  calculation mapping; avoids database access/stat recomputation.
- `ingestion_freshness_prioritizes_running_then_incomplete_then_age`: freshness
  precedence and age; avoids database access.
- These tests do not exercise reporter merge resolution against a database
  fixture or prove Atlas/source provider parity.

### B14 wiki index-status nullable-row HTTP differential

- Test: `backend/tests/test_rust_evidence_http_differential.py::test_wiki_index_status_matches_fastapi_for_aggregates_and_nullable_status`.
- Run from the repository root with a disposable PostgreSQL database containing
  `wiki_index_status` and a prebuilt `backend/target/debug/thesis-server`:
  `THESIS_TEST_DATABASE_URL=postgresql://... backend/.venv/bin/pytest -q backend/tests/test_rust_evidence_http_differential.py -k wiki_index_status_matches_fastapi_for_aggregates_and_nullable_status`.
- The differential requires the current wiki index schema and a prebuilt Rust
  server; neither it nor any Rust runtime was run under the no-Rust-runtime gate.
- Covers actual grouped counts for seeded source/reporter rows, then adds a
  nullable status and asserts both FastAPI response validation and Rust return
  HTTP 500.
- The tracked SQLAlchemy model confirms an `Integer` primary key and nullable
  `String` status; the seeded `NULL` exercises that schema contract.
- The null row uses `entity_type="source"`; the tracked model documents source,
  reporter, and organization and has no entity-type check constraint.
- The route was already root-registered; inventory stays
  `rust_registered:true`, `migrated:false`. Avoids `thesis-db` changes and the
  blocked wiki-indexing accessor.

### Atlas media-measurements shadow route

- Route: `GET /api/wiki/atlas/analysis/media-measurements`.
- Run from `backend/`: `cargo test -p thesis-api wiki --lib --message-format short`.
- `measurements_preserve_six_trace_semantics_for_source_scoped_input`: six
  trace order and values, stable IDs, a statically source-scoped input, and
  first-seen owner ties plus relationship-ID row order. Its explicit
  full-corpus fixture checks empty-source echo and counts the rows already
  supplied to the calculation; it does not test SQL's no-filter behavior.
- `byline_trace_hash_matches_python_numeric_key_ordering`: golden trace ID for
  integer article keys 2 and 10 in Python numeric order.
- `byline_hash_preserves_input_author_order_duplicates_and_numeric_keys`:
  unsorted input rows and duplicate reporter names remain in the byline
  subgraph/hash; coauthor edges use sorted, deduplicated names.
- `reporter_movement_preserves_input_author_row_order`: reporter movement
  output follows the first-seen author-row order.
- `empty_corpus_still_emits_all_measurements_with_zero_denominators`: six
  traces, zero denominators, null cadence/HHI, and no owners.
- `source_name_query_contract_accepts_empty_and_200_characters_but_rejects_longer_values`:
  parser behavior for absent, empty, 200 Unicode characters, and 201 characters;
  this does not exercise database loading or filtering.
- `syndication_coverage_counts_a_nonempty_tag_list_with_empty_values`:
  a nonempty `tags` list remains covered even when joining produces an empty
  marker-search string.
- Avoids: SQL loader/filter/order behavior, trace persistence/idempotency, HTTP
  response behavior, runtime, and FastAPI parity. These seven Rust tests are
  source-added but were not run because the shared Cargo lock gate is closed;
  FastAPI remains the public owner and the inventory row remains `migrated:false`.

### Atlas graph and entity-connections shadow routes

- Routes: `GET /api/wiki/atlas/graph` and
  `GET /api/wiki/atlas/entities/{entity_id}/connections`.
- OpenAPI test: `backend/crates/thesis-api/src/lib.rs::tests::rust_openapi_contains_the_existing_operation_id_and_statuses`.
  Run from `backend/` with
  `cargo test -p thesis-api rust_openapi_contains_the_existing_operation_id_and_statuses --lib`.
  It asserts both operation IDs and a documented 200 response. The handler
  annotations also declare graph 422 and connection 404/500 responses; the
  OpenAPI test does not assert those non-200 entries.
- `backend/crates/thesis-api/src/wiki_atlas/graph.rs::tests::sha1_ids_match_the_python_digest_contract`
  checks stable IDs.
- `backend/crates/thesis-api/src/wiki_atlas/graph.rs::tests::casefold_matches_python_full_unicode_semantics`
  checks Unicode case folding.
- `backend/crates/thesis-api/src/wiki_atlas/graph.rs::tests::filters_neighborhood_rank_and_stats_use_the_production_path`
  checks graph filters, node/edge bounds, stats, truncation, and expansion token.
- `backend/crates/thesis-api/src/wiki_atlas/connections.rs::tests::includes_direct_and_current_owner_pending_edges_only`
  checks selected connection eligibility and deduplication.
- `backend/crates/thesis-api/src/wiki_atlas/connections.rs::tests::sorts_by_confidence_then_evidence_then_casefolded_label`
  checks connection ordering.
- `backend/crates/thesis-api/src/wiki_atlas/connections.rs::tests::source_alias_resolves_to_the_outlet_id`
  checks source-to-outlet ID mapping.
- These six source tests were added but not run. They do not exercise HTTP
  handler execution, database-backed responses or errors, populated projection
  parity, or FastAPI parity. Both inventory rows remain `migrated:false`.

### Atlas search shadow route

- Route: `GET /api/wiki/atlas/search`.
- OpenAPI test: `backend/crates/thesis-api/src/lib.rs::tests::rust_openapi_contains_the_existing_operation_id_and_statuses`.
  It asserts the search operation ID and presence of a 200 response. The handler
  annotation also declares 422; the test does not assert that response.
- `backend/crates/thesis-api/src/wiki_atlas/search.rs::tests::label_match_precedence_then_connection_count_controls_order`
  checks exact/prefix/substring/metadata match precedence and connection-count
  ordering within a match rank.
- `backend/crates/thesis-api/src/wiki_atlas/search.rs::tests::metadata_substring_matches_subtitle_country_and_funding_fields`
  checks searches in subtitle, country, and funding metadata.
- `backend/crates/thesis-api/src/wiki_atlas/search.rs::tests::equal_rank_and_connection_count_use_python_casefolded_label_order`
  checks the casefolded label tie-break.
- `backend/crates/thesis-api/src/wiki_atlas/search.rs::tests::limit_applies_independently_to_each_entity_type_group`
  checks per-entity-type result limits.
- `backend/crates/thesis-api/src/wiki_atlas/search.rs::tests::response_echoes_query_projects_contract_fields_and_keeps_pydantic_defaults`
  checks query echo, the seven projected response fields, and Pydantic-default
  values for the remaining DTO fields.
- `backend/crates/thesis-api/src/wiki_atlas/search.rs::tests::shared_query_search_enforces_unicode_query_and_limit_bounds`
  checks required/nonempty query behavior, the 200/201 Unicode-character
  boundary, default limit, and accepted/rejected limit bounds.
- These six source tests were added but not run. They use in-memory nodes and
  query values; they do not exercise the HTTP handler, database loading,
  populated projection behavior, or FastAPI parity. The inventory row remains
  `migrated:false`.

### Atlas index shadow route

- Route: `GET /api/wiki/atlas/index`; operation ID
  `get_atlas_index_api_wiki_atlas_index_get`.
- OpenAPI test: `backend/crates/thesis-api/src/lib.rs::tests::rust_openapi_contains_the_existing_operation_id_and_statuses`.
  It asserts the index operation ID and 200/422 responses; export is detailed
  separately below.
- Source tests in `backend/crates/thesis-api/src/wiki_atlas/index.rs::tests`:
  `name_sort_uses_casefolded_labels_and_stable_ties`,
  `connection_sort_descends_then_casefolds_and_stably_keeps_ties`,
  `article_sort_descends_then_casefolds_and_stably_keeps_ties`,
  `recently_indexed_sort_descends_and_keeps_none_epoch_ties_stable`, and
  `lowest_confidence_orders_none_then_python_tiers_and_unknown_tiers` cover all
  sort keys and their stable/casefolded ties.
- `kind_filter_casefolds_and_preserves_pre_filter_kind_facet` checks kind
  matching, pre-filter kind counts, post-kind remaining facet counts, and
  pagination-independent counts. `graph_query_casefolds_substrings_across_index_search_fields`
  exercises production graph query filtering across label, subtitle, country,
  funding, and bias. `pagination_totals_and_next_cursor_follow_filtered_boundaries`
  covers totals and page-boundary cursors.
- `malformed_negative_and_unicode_cursors_start_at_zero_while_ascii_base64_matches_python`
  checks malformed/negative cursors, raw and decoded non-ASCII fallback, and
  the stdlib-probed behaviors: `M!Q` and `M=Q` decode to 1, while
  `MQ===ignored` falls back to 0.
  `shared_index_query_enforces_defaults_and_bounds` covers defaults and
  query/cursor/limit/sort validation.
- These ten source tests are in-memory and were not run while the shared Cargo
  lock gate is closed. They do not establish handler/database behavior or
  FastAPI parity; the inventory remains `migrated:false`.

### Atlas export shadow route

- Route: `POST /api/wiki/atlas/export`; operation ID
  `export_atlas_api_wiki_atlas_export_post`.
- OpenAPI test: `backend/crates/thesis-api/src/lib.rs::tests::rust_openapi_contains_the_existing_operation_id_and_statuses`.
  It asserts the operation ID, 200/422 responses, and the
  `AtlasExportRequest` request-body schema.
- Source tests in `backend/crates/thesis-api/src/wiki_atlas/export.rs::tests`:
  `csv_nodes_match_python_quoting_unicode_and_datetime_format` covers header
  order, Unicode, RFC quoting, CRLF, empty options, and microsecond dates.
  `csv_relationships_keep_integral_floats_booleans_and_empty_options` covers
  integral `1.0` confidence and ownership values, `True`/`False`, dates, and
  empty optional cells. `csv_evidence_quotes_text_and_preserves_duplicate_edge_rows`
  covers quoted Unicode/newline excerpts and duplicate rows in edge order.
- `json_export_keeps_field_and_evidence_order_and_last_duplicate_value` covers
  payload field order, unescaped Unicode, ISO date strings, first-seen evidence
  position with last duplicate value, and default empty layout positions.
  `json_export_keeps_supplied_layout_positions` covers supplied layout values.
  `export_overrides_match_python_truthiness_without_query_length_caps` pins
  empty selected-entity fallback, include-evidence override, and the absence of
  query-only `q`/`selected` length caps on the export body.
- `export_validation_rejects_invalid_dates_without_query_length_constraints`
  covers date error locations. `export_body_syntax_and_validation_errors_use_422`
  covers malformed JSON, non-object input, invalid format, and invalid filter
  values returning 422. `each_format_returns_the_python_attachment_filename_and_media_type`
  covers all four download filenames and media types. `float_csv_text_matches_python_integral_and_exponent_forms`
  covers Python-style integral, zero, and exponent float spellings.
- These ten Rust tests were added but not run. They do not exercise HTTP handler
  execution, database loading, runtime, or FastAPI byte parity. The bounded
  localhost:8000 baseline attempt had no listener and returned no response;
  FastAPI remains public and the inventory row remains `migrated:false`.

### Atlas stats shadow route

- Route: `GET /api/wiki/atlas/stats`; operation ID
  `get_atlas_stats_api_wiki_atlas_stats_get`.
- OpenAPI test: `backend/crates/thesis-api/src/lib.rs::tests::rust_openapi_contains_the_existing_operation_id_and_statuses`.
  It asserts the operation ID, 200 response, and `AtlasStatsResponse` schema.
- Source tests in `backend/crates/thesis-api/src/wiki_atlas/stats.rs::tests`:
  `stats_response_summarizes_graph_edges_coverage_and_index_statuses` checks
  entity and visible-relation counts, index-status counts/latest timestamp and
  active state, plus overall and per-type research coverage.
  `auto_ingest_cache_marker_tracks_only_completed_network_runs` checks the
  completed `auto_ingest/atlas_pipeline` cache marker. `stats_cache_expires_at_ttl_and_after_network_success_changes`
  checks the 300-second expiry boundary and marker-change invalidation.
- These three source tests were added but not run while the shared Cargo gate
  is closed. They use in-memory graph/status values and do not exercise the
  database projection, HTTP handler, actual auto-ingest invalidation, runtime,
  or FastAPI parity. FastAPI remains public and the inventory row remains
  `migrated:false`.

## B16 Rust evidence claim materialization tests

- Route: `POST /api/wiki/evidence/claims/{claim_id}/materialize`.
- Source tests in `backend/crates/thesis-api/src/claims.rs::tests`:
  `complete_control_path_matches_fastapi_boolean_values_and_default` covers
  the default and accepted boolean spellings (including mixed case), rejects
  leading/trailing whitespace, and preserves FastAPI-shaped invalid-query
  error details.
  `materialize_token_auth_matches_fastapi_statuses_and_details` covers disabled
  configuration, missing/wrong token, exact status/details, and a valid token.
  `reviewer_header_and_blank_value_match_fastapi_validation` covers the required
  reviewer header and blank-reviewer 422 response.
- OpenAPI test:
  `backend/crates/thesis-api/src/lib.rs::tests::rust_openapi_contains_the_existing_operation_id_and_statuses`.
  It asserts the operation ID, 200/422 responses, relationship schema, required
  reviewer, optional token, and `complete_control_path=false` query default.
- Run from `backend/`: `cargo test -p thesis-api claims::tests --lib` and
  `cargo test -p thesis-api rust_openapi_contains_the_existing_operation_id_and_statuses --lib`.
- These source tests were added but not run because the shared Cargo lock gate is
  closed. They avoid database materialization/reload, mounted HTTP behavior,
  process-environment mutation, and FastAPI parity. FastAPI remains public and
  the inventory row remains `migrated:false`.

### Reporter merge cycle guard
- Test: `backend/crates/thesis-db/src/wiki.rs::tests::reporter_merge_resolution_stops_at_a_cycle`
- Run from `backend/`: `cargo test -p thesis-db reporter_merge_resolution_stops_at_a_cycle --lib --message-format short`.
- Covers: merge traversal terminates when reporter IDs form a cycle.
- Avoids: database/query integration; the reporter dossier projection test does
  not exercise merge resolution against a database fixture.

## Rust thesis-db story-lineage persistence tests

- Run from `backend/`: `cargo test -p thesis-db discovery::tests --lib --message-format short`, with `DATABASE_URL` set to a disposable PostgreSQL cluster.
- Fixture: all four tests use `#[sqlx::test(migrations = false)]` with a PostgreSQL `PgPool` and create the minimal lineage tables directly; they do not run production migrations.
- `backend/crates/thesis-db/src/discovery.rs::tests::lineage_upserts_are_idempotent_and_claim_corrections_win`: repeated persistence updates story, edge, and claim data while preserving row IDs and graph counts; verifies correction data is returned.
- `backend/crates/thesis-db/src/discovery.rs::tests::existing_article_claim_keeps_its_original_story_cluster`: a claim already associated with one story remains attached there when the same article claim is persisted under a second story.
- `backend/crates/thesis-db/src/discovery.rs::tests::lineage_filters_existing_articles_and_falls_back_when_none_exist`: filters supplied IDs to existing article rows, retains the supplied lineage when none exist, and treats empty input as a no-op.
- `backend/crates/thesis-db/src/discovery.rs::tests::lineage_failure_rolls_back_all_graph_rows`: a forced graph-write failure leaves story, article-edge, claim, and claim-edge tables empty.
- Avoids: production migration execution and a live application stack; the SQLx tests require a disposable PostgreSQL fixture.

## Rust thesis-server provider tests

### Chat completion stream tests

- Command from the repository root: `cargo test --manifest-path backend/Cargo.toml --message-format short -p thesis-server --lib providers::chat::stream_tests::tests`.
- `providers::chat::stream_tests::tests::stream_decodes_multiline_sse_and_reassembles_tool_call_fragments`: local TCP SSE fixture covers multiline events, content/reasoning, tool-call fragment assembly, and the outgoing model/stream request fields.
- `providers::chat::stream_tests::tests::stream_eof_emits_finished_event_without_done_sentinel`: verifies the final event when the response ends without `[DONE]`.
- `providers::chat::stream_tests::tests::malformed_sse_is_reported_and_logged_as_a_failed_call`: verifies malformed-frame errors and failure log entries.
- `providers::chat::stream_tests::tests::dropping_live_stream_cancels_request_and_logs_cancellation`: verifies disconnect cancellation and `Cancelled` log entries.
- Avoids: live LLM providers and remote network services; the fixture binds only to loopback.

### News-research vector-store availability

- Command from the repository root: `cargo test --manifest-path backend/Cargo.toml --message-format short -p thesis-server --lib providers::news_research::retrieval::tests`.
- `providers::news_research::retrieval::tests::vector_store_environment_flag_matches_fastapi_false_values`: covers FastAPI's exact disabled values and confirms other spellings remain enabled; avoids process-global environment mutation.
- `providers::news_research::retrieval::tests::vector_store_availability_requires_a_successful_chroma_heartbeat`: a local HTTP fixture checks `GET /api/v2/heartbeat`, accepts HTTP 200, and rejects HTTP 503. It does not require a live Chroma service, database, or embedding sidecar.

### Discovery provider parity and lineage tests

- Command from the repository root: `cargo test --manifest-path backend/Cargo.toml --message-format short -p thesis-server --lib providers::discovery::tests`.
- `providers::discovery::tests::lexical_titles_flow_through_trending_snapshot_and_detail_without_neighbor_queries`: exercises trending, breaking, all-cluster snapshots, and lexical fallback detail. It verifies the fallback projection leaves `summary`/`author` and `source_id` null and `authors` empty, without Chroma neighbor-query responses.
- `providers::discovery::tests::lineage_article_edges_link_only_from_the_earliest_article`: three chronological articles produce exactly two edges, both from the earliest article.
- `providers::discovery::tests::lineage_number_percent_backtracking_matches_python_regex_boundary`: covers percent-suffix backtracking at the number-pattern word boundary with deterministic ASCII examples.
- `providers::discovery::tests::lineage_route_serializes_persisted_rows_after_lexical_detail_fallback`: exercises `GET /trending/clusters/20/lineage` and verifies fixture story, article-edge titles, and evidence after lexical detail fallback.
- `providers::discovery::tests::stats_heartbeat_failure_serializes_the_fastapi_zero_payload_without_database_access`: verifies the FastAPI-compatible payload after heartbeat failure; counters and `similarity_threshold` are zero while `breaking_window_hours` remains 3.
- Avoids: live Chroma and PostgreSQL services; the tests use local HTTP fixtures, fake cluster data, and lazy database connections.
- Execution status: Cargo tests were not run because the lock gate is closed. Formatter and Python probe results are worker-reported, not independently rerun in this documentation pass.

