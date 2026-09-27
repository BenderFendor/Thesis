# Rust Atlas Entity Connections — Task Trace
name: `rust-atlas-entity-connections-2026-09-27`
goal: port `GET /api/wiki/atlas/entities/{entity_id}/connections` into the Rust Atlas graph slice.
status: Connection handler and response projection are complete; parent router wiring is intentionally untouched.
risk tier: Medium — inclusion depends on graph direction, accepted ownership, lifecycle, and ordering semantics.
verification: standalone `rustfmt --edition 2021 --config skip_children=true` passed for the connection source and graph export, including ownership and crate-root visibility follow-ups.
test gap: Test sources were added but not run; populated DB row fixtures remain blocked by private `thesis_db::atlas` DTOs.

## Goal
Preserve the Python entity-connections contract using the Rust graph projection and API response DTOs, without editing parent routing, DB/Cargo, shared docs, or discovery files.

## Files changed
- `backend/crates/thesis-api/src/wiki_atlas/connections.rs` — alias normalization, fixed graph filters, handler, behavior tests, and moved-edge connection collection.
- `backend/crates/thesis-api/src/wiki_atlas/graph.rs` — nested module declaration/re-export and `build_response` visibility for reuse.

## Commands run
- `papercut log` recorded the absent requested `backend/app/api/routes/atlas_entity.py` path (the checked-in contract is in `backend/app/services/atlas_entity.py`) and a recovered source rewrite issue.
- `rustfmt --edition 2021 --config skip_children=true` on `connections.rs` and `graph.rs`: passed.
- No Cargo, build, test, or parent-wiring command was run.

## Tests added
- `includes_direct_and_current_owner_pending_edges_only` exercises direct-edge inclusion/deduplication and excludes pending edges not touching an accepted current owner, invalid owner direction/predicate, historical owners, candidates, unrelated edges, and missing neighbor nodes.
- `sorts_by_confidence_then_evidence_then_casefolded_label` exercises the required descending confidence/evidence ordering and casefolded label tie-break.
- `source_alias_resolves_to_the_outlet_id` covers the legacy `source:` alias.
- Fixtures use Rust Atlas API response DTOs and the production graph response builder; no DB mocks are used. Tests were not run.

## Contract notes and blocker
- The handler applies entity types outlet/organization/person/reporter, selected normalized ID, neighbors 2, node limit 350, edge limit 1500, and evidence previews enabled.
- A missing projected node returns HTTP 404 with `{"detail":"Atlas entity not found"}`. This deliberately preserves configured catalog-only outlet nodes rather than requiring a DB evidence-entity/detail row; an unknown ID absent from the selected graph remains 404.
- Populated projection fixtures still cannot be built in `thesis-api`: row DTOs live in private `thesis_db::atlas` and are not re-exported. No DB DTO re-exports or mocks were changed. This does not block the API-DTO response-level connection tests.
- The parent router/module integration remains owned separately; the graph module now re-exports `get_connections` as `pub(crate)` so the parent can expose it to central `ApiDoc.paths`.

## Rollback
Revert only `connections.rs`, the graph-owned module/visibility changes in `graph.rs`, and this worksheet. Do not revert other working-tree changes.

## Status
Scoped Rust implementation and formatting complete. Parent route wiring is not part of this task. No runtime or test result is claimed.

## Follow-up — Response edge ownership

- `collect_connections` now consumes the graph response and moves eligible edge DTOs into connection results; only the related node DTO is cloned.
- Direct and pending edge ID deduplication, missing-node handling, accepted-current-owner selection, and sort ordering are preserved.
- Behavior test call sites now pass the graph response by value. Tests remain unrun by instruction.

## Follow-up — Remove non-direct edge buffer

- Owner IDs are derived before consuming graph edges from accepted/current ownership edges whose selected target and source node exist.
- The consuming pass classifies direct and owner-pending edges, moves eligible edge DTOs into results, and buffers only eligible pending result records—not every non-direct graph edge.
- Direct and pending ID deduplication and direct-before-pending stable tie order remain intact; related node DTOs are still cloned.
- Standalone rustfmt passed for `connections.rs`. Tests remain unrun by instruction.

## Follow-up — crate-root OpenAPI visibility

- Widened the graph module's `get_connections` re-export to `pub(crate)` for the parent `wiki_atlas` re-export consumed by central `ApiDoc.paths`.
- The parent router, parent re-exports, and untracked `lib.rs` remain owned separately and were not edited in this follow-up.
- Standalone rustfmt passed for `graph.rs`. No Cargo or tests were run.
