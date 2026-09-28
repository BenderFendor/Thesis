# Rust Atlas parent-route integration
Goal: Register graph and entity-connections handlers at their existing Atlas paths and central OpenAPI.
Files changed: `wiki_atlas.rs`, the two inventory rows/counters, migration docs, test catalog, Log, learnings, plan, Papercuts, and four canonical trace copies.
Commands run: standalone rustfmt check passed; inventory row recount returned 136 total, 30 registered pending, and 42 unregistered pending; Papercut friction logged.
Tests added or avoided: No tests added or run; no Cargo, build, or runtime request was run.
Assumptions: FastAPI remains public and both operations stay `migrated:false` until parity is demonstrated.
Risk tier: Normal shadow registration; handler HTTP and database behavior remain unverified.
Rollback: Revert only parent route/re-export, two inventory rows/counters, linked docs and worksheets; retain graph source and peer-owned `lib.rs`.
Status: Complete; parent files remain unstaged and uncommitted.

## Goal
Register the already implemented Atlas graph and entity-connections handlers in `wiki_atlas::router`, expose crate-visible re-exports for central `ApiDoc.paths`, and update only the two corresponding operation rows and derived inventory counters. Keep FastAPI as the public owner and parity unproven.

## Files changed
- `backend/crates/thesis-api/src/wiki_atlas.rs`: added `mod graph`, crate-visible `get_connections` and `get_graph` re-exports, and both GET routes.
- `docs/agents/rust-openapi-operation-inventory.json`: marked the graph and connections rows Rust-registered without migrating either; updated derived totals.
- `docs/architecture/rust-backend-migration.md`, `docs/Log.md`, `docs/agent/test-catalog.md`, `docs/agent/learnings.md`, and `docs/agent/lean-codebase-plan.md`: updated route registration, response metadata, counts, test coverage, and verification limits.
- `papercuts.md`: logged the first inventory recount command's missing-field assumption.
- `.agent/traces/rust-atlas-parent-integration.md`: this task worksheet.
- `docs/agents/traces/rust-atlas-parent-integration.md`: exact canonical copy of this worksheet.
- `docs/agents/traces/rust-atlas-graph-projection-2026-09-26.md`, `docs/agents/traces/rust-atlas-entity-connections-2026-09-27.md`, and `docs/agents/traces/rust-atlas-media-measurements.md`: copies of the existing source worksheets; source worksheets remain unchanged.

No edits were made to graph or connection implementation files or peer-owned `backend/crates/thesis-api/src/lib.rs`.

## Commands run
- `rustfmt --edition 2021 --check --config skip_children=true backend/crates/thesis-api/src/wiki_atlas.rs`: passed with no output; child modules were excluded.
- A Python inventory count initially failed because it assumed every row had `rust_registered`; the follow-up count used the inventory's optional-field semantics and returned 136 Rust operations, 30 registered pending, and 42 unregistered pending. Graph and connections are registered and both remain unmigrated.
- `papercut log` recorded the inventory recount assumption.
- Source comparison confirmed `wiki_atlas::router` and `lib.rs` use the same graph and connections paths. The OpenAPI test source asserts both operation IDs and 200-response presence.
- No Cargo command, test, build, or HTTP runtime request was run.

## Tests added or avoided
No tests were added. Existing graph, connections, and OpenAPI tests remain source-only and were not run. The OpenAPI test checks the operation IDs and presence of a 200 response; the handler annotations additionally declare graph 422 and connection 404/500 responses, which that test does not assert. The module tests cover projection/filtering and connection selection/order, not handler HTTP behavior, database errors, or FastAPI parity.

## Assumptions and risk tier
FastAPI remains public. The two inventory operations are Rust-registered but `migrated:false`; route and OpenAPI registration do not prove parity or runtime behavior. Risk tier is normal for shadow registration; request/database behavior remains unverified.

## Rollback
Remove the graph module declaration, re-exports, and two routes from `wiki_atlas.rs`; restore the two operation rows and their derived counters; revert only the linked documentation and task worksheet copies. Do not revert graph/connection handler source or peer-owned `lib.rs` changes.

## Status
Parent wiring, inventory rows/counters, documentation, and trace copies are complete. Rustfmt and inventory count checks passed. No files were staged or committed; `wiki_atlas.rs` and peer-owned `lib.rs` remain untracked or unstaged in the shared worktree.
