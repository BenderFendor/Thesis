# Rust Atlas Entity Search Task Trace
name: `rust-atlas-search-2026-09-27`
goal: implement `GET /api/wiki/atlas/search` from the Python Atlas search contract.
status: Search handler, DTO-level tests, and parent route/OpenAPI source registration are present; search remains a Rust shadow.
risk tier: Medium, due to search precedence and graph projection semantics.
verification: standalone rustfmt passed; Cargo, tests, runtime behavior, and Python parity remain unverified.
test gap: Six deterministic source tests were added but not run because the shared Cargo lock gate is closed.

## Goal
Port the required query validation, full Atlas projection, ranked matching, per-entity-type grouping, and response projection without adding a query/parser abstraction or changing shared graph code.

## Files changed
- `backend/crates/thesis-api/src/wiki_atlas/search.rs` — `get_atlas_search`, fixed graph filters, ranking, response mapping, and DTO-level tests.
- `backend/crates/thesis-api/src/lib.rs` — central ApiDoc path list and OpenAPI operation-ID test entry. This parent file is untracked and was not staged or committed.
- `.agent/traces/rust-atlas-search-2026-09-27.md` — task trace.

## Commands run
- `rustfmt --edition 2021 --config skip_children=true backend/crates/thesis-api/src/wiki_atlas/search.rs backend/crates/thesis-api/src/lib.rs` — passed.
- No Cargo command, self-test, build, runtime request, or parity check was run because the shared Cargo lock gate is closed.

## Tests added
- `label_match_precedence_then_connection_count_controls_order` covers exact, prefix, substring, metadata precedence and descending connection count within a rank.
- `metadata_substring_matches_subtitle_country_and_funding_fields` covers all three metadata fields.
- `equal_rank_and_connection_count_use_python_casefolded_label_order` covers Unicode casefold tie-breaking.
- `limit_applies_independently_to_each_entity_type_group` covers per-type caps and selection within a group.
- `response_echoes_query_projects_contract_fields_and_keeps_pydantic_defaults` covers original query echo, the seven FastAPI-mapped fields, and Pydantic defaults for the additional Rust DTO fields.
- `shared_query_search_enforces_unicode_query_and_limit_bounds` calls the shared helper for missing/empty q, 200/201 Unicode characters, default limit 8, accepted limits 1/20, and rejected limits 0/21.
- Test sources were not executed.

## Assumptions and blockers
- Reused `wiki::query_values`, `wiki_atlas::query_search`, and `wiki::parse_integer_parameter`; the existing required-string helper counts Unicode characters and enforces q length 1 through 200, while the shared integer helper enforces limit default 8 and bounds 1 through 20. The query-boundary test directly exercises `query_search`.
- FastAPI constructs only id, entity type, label, subtitle, country code, confidence tier, and profile path. The other Rust DTO fields use the Pydantic defaults: null, null, `not researched`, `unknown`, and null.
- Reused the graph slice's `normalize_entity_label`, Python-compatible `casefold`, `project`, and `build_response`. Search filters include outlet, organization, person, and reporter, use no node cap, cap edges at 2500, and disable evidence previews.
- The handler is crate-visible as `get_atlas_search` for parent re-export. Parent integration now registers the route; the inventory row is `rust_registered: true` and remains `migrated: false`.
- No database fixture or handler runtime verification was possible under the lock gate.

## Rollback
Remove `search.rs` and its central `lib.rs` ApiDoc path/test entries together. Coordinate any rollback of parent `wiki_atlas.rs` module, re-export, and route registration plus the corresponding inventory registration state and counters with those owners. Keep the inventory operation `migrated: false` unless parity is separately demonstrated. Do not stage or commit the untracked parent `lib.rs` as part of this slice.

## Status
Search source, parent module/re-export/route, and OpenAPI path/test entries are present. The inventory row remains `migrated: false`. Six test sources are unrun; Cargo, runtime behavior, and Python parity remain unverified.

## Follow-up: Parent source registration

- `wiki_atlas.rs` declares the search module, re-exports `get_atlas_search`, and registers `GET /api/wiki/atlas/search`. Central `lib.rs` contains the matching ApiDoc path and operation-ID test entry.
- The inventory totals are 137 Rust OpenAPI operations, 31 registered pending, and 41 unregistered. The search row is `rust_registered: true` and `migrated: false`.
- This is source registration only. Cargo, tests, HTTP/database behavior, and Python parity remain unverified under the shared Cargo lock gate.
