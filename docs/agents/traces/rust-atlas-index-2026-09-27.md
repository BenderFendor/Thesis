# Rust Atlas index implementation trace
Task slug: rust-atlas-index-2026-09-27
Goal: implement shadow `GET /api/wiki/atlas/index` and central OpenAPI registration.
Inventory: 138/178 operations; 106 parity-proven, 32 registered-unverified, 40 unregistered; index remains `migrated:false`.
Ownership: FastAPI remains public; Rust registration exists, but runtime and parity are unverified.
Verification: standalone rustfmt passed; Python stdlib cursor behavior was probed.
Tests: ten index unit tests and central OpenAPI assertions were added but not run; Cargo gate closed.
Risk tier: Normal shadow read; compiled, HTTP, database, and parity behavior remain unverified.

## Goal
Implement the Rust shadow index using the existing query parser and graph projection, preserve FastAPI ownership, register its router and OpenAPI operation, and document source-only coverage without claiming parity or runtime proof.

## Files changed
- `backend/crates/thesis-api/src/wiki_atlas/index.rs`: index handler, graph-backed search, sorting, kind/remaining facets, pagination, bounded cursor decoding, and ten focused unit tests.
- `backend/crates/thesis-api/src/wiki_atlas.rs`: module/re-export/router registration and index query-parameter bounds; removed the unreferenced `AtlasSearchQueryParameters` declaration after repository-wide source grep showed only that declaration. `search.rs` was not edited.
- `backend/crates/thesis-api/src/lib.rs`: central `ApiDoc` registration and assertions for the exact index operation ID, 200/422 responses, and continued export absence.
- `docs/agents/rust-openapi-operation-inventory.json`: index marked registered, not migrated; counts updated to 138/32/40.
- `docs/architecture/rust-backend-migration.md`, `docs/Log.md`, `docs/agent/test-catalog.md`, `docs/agent/learnings.md`, `docs/agent/known-errors.md`, and `docs/agent/lean-codebase-plan.md`: current counts, registration state, test coverage, and verification limits updated.
- `papercuts.md`: records tool/coordination friction encountered during this task.
- `.agent/traces/rust-atlas-index-2026-09-27.md` and `docs/agents/traces/rust-atlas-index-2026-09-27.md`: synchronized task worksheets.

## Commands run
- `rustfmt --edition 2021 --config skip_children=true backend/crates/thesis-api/src/wiki_atlas/index.rs backend/crates/thesis-api/src/wiki_atlas.rs backend/crates/thesis-api/src/lib.rs`: passed with no output after the final cursor-test edit.
- Python stdlib probe used the source expression `base64.urlsafe_b64decode(cursor.encode("ascii") + b"===").decode("ascii")` and its `(ValueError, UnicodeDecodeError)` fallback. Exact results: `M=Q` → 1; `MQ===ignored` → 0; `M!Q` → 1; raw `é` → 0; base64 `2aE` (UTF-8 Arabic digit payload) → 0; base64 `4oCDMeKAgw` (Unicode-space-wrapped digit payload) → 0.
- `issubclass(UnicodeEncodeError, ValueError)` returned `True`, confirming the raw non-ASCII fallback.
- Inventory JSON parse/check printed `138 32 40 True False` (registered total, registered pending, unregistered pending, index registered, index migrated).
- Source grep found no remaining `AtlasSearchQueryParameters` references.
- No Cargo command, test, build, Clippy, self-test, runtime request, or server smoke run was performed; those gates were explicitly closed for this slice.

## Tests added
Ten source tests in `backend/crates/thesis-api/src/wiki_atlas/index.rs::tests`:
- `name_sort_uses_casefolded_labels_and_stable_ties`
- `connection_sort_descends_then_casefolds_and_stably_keeps_ties`
- `article_sort_descends_then_casefolds_and_stably_keeps_ties`
- `recently_indexed_sort_descends_and_keeps_none_epoch_ties_stable`
- `lowest_confidence_orders_none_then_python_tiers_and_unknown_tiers`
- `kind_filter_casefolds_and_preserves_pre_filter_kind_facet`
- `graph_query_casefolds_substrings_across_index_search_fields`
- `pagination_totals_and_next_cursor_follow_filtered_boundaries`
- `malformed_negative_and_unicode_cursors_start_at_zero_while_ascii_base64_matches_python`
- `shared_index_query_enforces_defaults_and_bounds`

The existing central OpenAPI test now asserts the exact index operation ID, a 200 response, the annotated 422 response, and absence of `/api/wiki/atlas/export`. All test sources remain unrun. They do not prove handler HTTP behavior, database projection behavior, compilation, or FastAPI parity.

## Assumptions and risk
- FastAPI remains the public owner; the Rust route is shadow-only and its inventory row remains `migrated:false` until parity is demonstrated.
- Index `q` is passed unchanged into the production graph filter path. Page shaping receives only `kind`, `sort`, `cursor`, and `limit`; graph filter fields are moved from the parsed query rather than cloned.
- Kind facet counts are computed before kind filtering; other facets count the full post-kind result before pagination.
- FastAPI `_decode_cursor` catches `ValueError` and `UnicodeDecodeError`; `UnicodeEncodeError` is a `ValueError`. Both raw and decoded non-ASCII inputs therefore fall back to offset zero. Tests pin raw `é` and base64-encoded Arabic-digit/Unicode-whitespace payloads, as well as the probed `M=Q` and `MQ===ignored` cases. No padding-stop behavior was inferred.
- Risk tier is Normal for a shadow read route. Database-backed handler behavior, generated OpenAPI compilation, HTTP response details, and FastAPI parity are not verified.

## Rollback
Remove only the Atlas index module/re-export/router registration, index-specific `ApiDoc` registration/assertions, index inventory status/count changes, and the linked index documentation/tests/worksheets. Restore inventory counts to their pre-index values only if no later registered-operation slice has changed them. Do not alter `search.rs`, other Atlas routes, or unrelated working-tree changes; do not restore the unreferenced `AtlasSearchQueryParameters` declaration.

## Status
Source, inventory, architecture, test catalog, current summaries, and both worksheet copies are updated. Standalone rustfmt and the Python stdlib probes passed. Cargo tests/build/Clippy, self-test, runtime HTTP exercise, compilation, and FastAPI parity remain unverified. No files were staged or committed.
