# Rust Atlas Graph Projection — Task Trace
name: `rust-atlas-graph-projection-2026-09-26`
goal: implement and organize the Rust Atlas graph projection and response behavior.
status: Graph-owned source changes complete; route wiring and integration remain with Main.
risk tier: Medium — graph projection semantics and Unicode identifier normalization are behavior-sensitive.
verification: scoped `rustfmt --edition 2021` passed; Cargo and tests were not run per instruction.
test gap: populated database-row fixtures are blocked because row DTOs live in private `thesis_db::atlas` and are not re-exported.

## Goal
Keep the graph projection and graph-response behavior in cohesive Rust modules, preserve the Python Atlas semantics, fix accepted ownership endpoint direction, avoid redundant clones, and retain production-path behavior coverage without crossing the database/API ownership boundary.

## Files changed
- `backend/crates/thesis-api/src/wiki_atlas/graph.rs` — graph response, filtering, ranking, stats, and handler implementation; delegates identifiers and projection.
- `backend/crates/thesis-api/src/wiki_atlas/graph/ids.rs` — normalization, 297-entry Unicode casefold exception table, stable IDs, SHA-1 helper, confidence tier.
- `backend/crates/thesis-api/src/wiki_atlas/graph_projection.rs` — projection coordinator and production-path test.
- `backend/crates/thesis-api/src/wiki_atlas/graph_projection/shared.rs` — shared graph entities, survivor mapping, and edge construction.
- `backend/crates/thesis-api/src/wiki_atlas/graph_projection/legacy.rs` — catalog, outlet, reporter, byline, and affiliation projections.
- `backend/crates/thesis-api/src/wiki_atlas/graph_projection/evidence.rs` — evidence, accepted/candidate relationship, and sibling projections.
- `papercuts.md` — logs the missing mandated worksheet path and initial rustfmt module-path friction.

## Commands run
- `papercut log` for the missing worksheet path and rustfmt module-resolution friction.
- `rustfmt --edition 2021` on the six graph-owned Rust files: passed after explicit nested module paths were added.
- No Cargo command, build, or tests were run, as directed.

## Tests added or retained
- `fresh_database_projects_the_configured_outlet_catalog` exercises `project()` with constructible empty `AtlasProjectionData` and checks the configured BBC outlet projection.
- `filters_neighborhood_rank_and_stats_use_the_production_path` exercises response filtering, ranking, accepted-only selection, truncation, and statistics.
- Identifier tests retain SHA-1/stable-ID golden vectors and Unicode casefold examples (including multi-code-point and Cherokee cases).
- These test sources were not executed.

## Assumptions and blockers
- Accepted relationship direction follows the Python source: canonical object is source; canonical subject is target. Main confirmed this direction.
- A populated `AtlasProjectionData` fixture cannot be assembled in `thesis-api`: its row record types are declared in private `thesis_db::atlas` and are not re-exported. The database crate, re-exports, and mocks remain untouched by request. Consequently, reporter/byline and nonempty evidence projection behavior lacks an executable production-path fixture in this slice.
- Parent route/module wiring, API docs, and shared documentation remain with Main; this slice did not edit `wiki_atlas.rs`, `lib.rs`, database files, or Cargo metadata.

## Rollback
Revert only the six graph-owned Rust files and this worksheet; remove the two task-specific entries from `papercuts.md` if the friction record is also being rolled back. Do not revert other working-tree changes.

## Status
Graph-owned implementation and formatting are complete. Integration and any broader validation are pending the owning parent slice. No Cargo or test output is claimed.
