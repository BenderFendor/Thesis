# Rust Atlas stats implementation trace
Task slug: rust-atlas-stats-2026-09-29
Goal: add shadow `GET /api/wiki/atlas/stats` using the existing Atlas graph projection.
Inventory: 140/178 operations; 106 parity-proven, 34 registered-unverified, 38 unregistered; stats is `migrated:false`.
Ownership: FastAPI remains public; Rust registration is shadow-only and parity is unverified.
Verification: standalone rustfmt passed; Cargo tests, build, and runtime exercise were not run.
Risk tier: Normal, read-only graph projection with a process-local response cache.

## Goal
Implement the Atlas stats shadow route without changing `thesis-db`, dependencies, entity indexing, or FastAPI ownership. Reuse `graph::project` and `graph::build_response` with all four entity types, no node limit, no evidence preview, and the 2,500 visible-edge limit. Match FastAPI's entity/relation/index-status/research coverage fields and five-minute cache behavior.

## Files changed
- `backend/crates/thesis-api/src/wiki_atlas/stats.rs`: stats response projection, process-local cache, network-ingest marker check, OpenAPI annotation, and three source tests.
- `backend/crates/thesis-api/src/wiki_atlas.rs`: stats module/re-export and GET route wiring.
- `backend/crates/thesis-api/src/wiki_atlas/graph.rs`: only two task-coupled visibility changes, `entity_type_name` and `relation_type_name` to `pub(super)` so stats can reuse the existing mappings; no other graph behavior changed.
- `backend/crates/thesis-api/src/lib.rs`: central ApiDoc registration and operation-ID/200/response-schema assertions.
- `docs/agents/rust-openapi-operation-inventory.json`: stats marked Rust-registered, still not migrated; counts updated to 140/34/38.
- `docs/architecture/rust-backend-migration.md`, `docs/Log.md`, `docs/agent/{known-errors,lean-codebase-plan,learnings,test-catalog,testing}.md`: current status, route, test coverage, and verification limits.
- `.agent/traces/rust-atlas-stats-2026-09-29.md` and `docs/agents/traces/rust-atlas-stats-2026-09-29.md`: paired worksheets.
- `papercuts.md`: coordination and edit-range friction logged.

## Cache and projection behavior
The route checks the existing `wiki_index_status` row with entity type `auto_ingest`, entity name `atlas_pipeline`, status `complete`, and `last_indexed_at`. The existing `Database::wiki_index_entries` read supplies the cache key without a `thesis-db` change. A changed successful-network-run timestamp causes recomputation on the next request; an unchanged key is cached for 300 seconds. A Tokio mutex serializes misses.

Stats derive from the same graph response used by the graph route. `stats` and entity totals use the complete graph projection; relation counts use the visible edge list after the 2,500-edge cap; research coverage uses all untruncated nodes. Index status counts, latest timestamp, and indexing-active state use all projected index rows.

## Tests added
- `stats_response_summarizes_graph_edges_coverage_and_index_statuses`
- `auto_ingest_cache_marker_tracks_only_completed_network_runs`
- `stats_cache_expires_at_ttl_and_after_network_success_changes`
- The existing central OpenAPI regression now asserts the stats operation ID, 200 response, and `AtlasStatsResponse` schema.

These tests were added but not run. The stats tests use in-memory graph/status values; they do not exercise database projection, HTTP routing, real auto-ingest invalidation, or FastAPI parity.

## Commands run
- `rustfmt --edition 2021 backend/crates/thesis-api/src/wiki_atlas/stats.rs backend/crates/thesis-api/src/wiki_atlas/graph.rs backend/crates/thesis-api/src/wiki_atlas.rs backend/crates/thesis-api/src/lib.rs`: passed with no output.
- `papercut log`: coordination and edit-range friction were recorded in `papercuts.md`.
- No Cargo command, test, build, Clippy, self-test, server start, curl, FastAPI request, or Rust runtime exercise was run. The shared Cargo gate remains closed.

## Assumptions and limits
- `auto_ingest/atlas_pipeline` is the existing FastAPI success marker; FastAPI writes it only after a successful network-bound run, then invalidates its stats cache.
- Marker checks invalidate the Rust process-local cache on the next request; no cross-process Rust cache or manual hook is added.
- The cache and route remain shadow-only. `migrated:false` stays in the inventory, and FastAPI remains the public owner.
- Formatting proves Rust syntax is parseable, not that the source compiles. Handler/DB behavior, cache behavior at runtime, and FastAPI response parity remain unverified.

## Risk tier
Normal. The route is read-only and reuses the production graph projection. Risk is limited to unverified mapping, DB, HTTP, and cache behavior.

## Rollback
Remove the stats module/re-export/router entry, central ApiDoc registration/assertions, inventory registration/count changes, and stats-specific documentation/traces. Restore both graph helper visibilities to private if no other consumer depends on them.

## Status
Implementation, registration, inventory, tests, and documentation are complete. Rust stats is registered but `migrated:false`; tests, build, runtime, and parity remain unverified. No files were staged or committed.
