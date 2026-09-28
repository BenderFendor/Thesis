# Rust Atlas search route integration
Goal: Register the handed-off Atlas search handler in `wiki_atlas::router` and expose it through the parent module.
Files changed: `wiki_atlas.rs`, search inventory row/counters, Atlas migration docs, Log, test catalog, learnings, plan, Papercuts, and this worksheet.
Commands run: standalone rustfmt check passed; source inspection confirmed matching router and ApiDoc paths; no Cargo/test/build/runtime commands.
Tests added or avoided: No tests added by this slice; the six handed-off search tests and central OpenAPI test were not run.
Assumptions: FastAPI remains public and the search operation remains `migrated:false` until parity is demonstrated.
Risk tier: Normal shadow read registration; HTTP, database, populated-projection, and parity behavior remain unverified.
Rollback: Revert only the parent module/re-export/route, search inventory row/counters, linked docs, and this worksheet; retain Baseline-owned search and `lib.rs` source.
Status: Parent route and documentation are complete; no files were staged or committed.

## Goal
Register `GET /api/wiki/atlas/search` in the Atlas parent router and re-export `get_atlas_search` crate-wide. Keep the Rust handler as a shadow implementation, update the search operation's registration status and derived counts, and document source coverage without claiming runtime or parity proof.

## Files changed
- `backend/crates/thesis-api/src/wiki_atlas.rs`: declared the search module, re-exported `get_atlas_search`, and registered the search route.
- `docs/agents/rust-openapi-operation-inventory.json`: marked only the search operation Rust-registered and updated derived counters; `migrated` remains false.
- `docs/architecture/rust-backend-migration.md`, `docs/Log.md`, `docs/agent/test-catalog.md`, `docs/agent/learnings.md`, and `docs/agent/lean-codebase-plan.md`: updated B15 registration, counts, source test coverage, and verification limits.
- `.agent/traces/rust-atlas-search-route-integration.md`: this worksheet.
- `docs/agents/traces/rust-atlas-search-route-integration.md`: canonical copy of this worksheet.
- `papercuts.md`: records the rejected plan edit attempt caused by a hashline range not fully displayed.

Baseline-owned `backend/crates/thesis-api/src/wiki_atlas/search.rs` and `backend/crates/thesis-api/src/lib.rs` were not edited. AtlasIndexSlice owns final inventory and migration-architecture review; no further changes to those two files were made after that ownership handoff.

## Commands run
- `rustfmt --edition 2021 --check --config skip_children=true backend/crates/thesis-api/src/wiki_atlas.rs`: passed with no output; child modules were excluded.
- Source inspection confirmed the parent router path matches the ApiDoc path `/api/wiki/atlas/search`, operation ID `search_atlas_entities_api_wiki_atlas_search_get`, and the central OpenAPI test entry.
- The inventory edit output records 137 total Rust operations, 31 registered pending, and 41 unregistered pending; the search operation is registered and not migrated.
- No Cargo command, test, build, or runtime request was run.

## Tests added or avoided
No tests were added by this parent-route slice. The handed-off search source contains six unit tests covering match ranking, metadata search, casefold tie-breaking, per-entity-type limits, response field/default projection, and shared query/limit bounds. The central OpenAPI test asserts the operation ID and presence of a 200 response; the search handler annotation also declares 422. These test sources were not run. They do not exercise HTTP handler execution, database loading, populated projection behavior, or FastAPI parity.

## Assumptions and risk tier
FastAPI remains the public owner. The search route and operation are registered, but the inventory row remains `migrated:false`. Registration and in-memory unit tests do not prove HTTP, database, populated-projection, or FastAPI behavior. Risk tier is normal for a shadow read route.

## Rollback
Remove `mod search`, the parent `get_atlas_search` re-export, and the search router entry from `wiki_atlas.rs`. Restore only the search inventory row and its derived counters, revert linked documentation and this worksheet, and retain the Baseline-owned handler/tests and `lib.rs` ApiDoc entry unless their owner separately rolls those back. Do not revert unrelated working-tree changes.

## Status
The parent route, registration records, scoped documentation, and worksheet are complete. Rustfmt passed. No Cargo tests, build, HTTP request, or parity verification was performed. No files were staged or committed.
