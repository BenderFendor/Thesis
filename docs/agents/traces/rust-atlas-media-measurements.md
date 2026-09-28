# Task worksheet: Rust Atlas media-measurements shadow route
Date: 2026-09-26
Status: Rust shadow registered; FastAPI remains public; behavior proof is unverified
Inventory: 134/178 operations; 106 parity-proven, 28 registered/unverified, 44 unregistered; 0 cutovers
Scope: `GET /api/wiki/atlas/analysis/media-measurements`; six trace calculations and idempotent persistence
Verification: scoped rustfmt and source review passed; no Cargo tests, build, typecheck, or runtime request
Risk tier: Normal. Inventory risk flag: `database_write`.

## Goal

Implement the smallest missing non-discovery Rust HTTP operation using the
shared Atlas media-measurement DTO and persistence API. Preserve the FastAPI
contract and public ownership; keep the inventory operation `migrated:false`.

## Files changed

- `backend/crates/thesis-api/src/wiki_atlas.rs`: optional `source_name` query
  schema and Rust router registration; the implementation reuses the existing
  `query_source_name` parser.
- `backend/crates/thesis-api/src/wiki_atlas/media_measurements.rs`: new handler,
  OpenAPI operation annotation, response projection, Python-compatible trace
  hash helper, and six calculation helpers.
- `backend/crates/thesis-api/src/wiki_atlas/media_measurements_tests.rs`: seven
  focused test sources for values, input order, numeric-key hashes, and edge cases.
- `backend/crates/thesis-api/src/lib.rs`: `ApiDoc.paths` registration for the
  operation, added by `RustApiBaseline`.
- `docs/agents/rust-openapi-operation-inventory.json`: the media row has
  `rust_registered:true`, `migrated:false`, `risk:"normal"`, and
  `risk_flags:["database_write"]`. Derived counts match operation rows:
  134 total Rust operations, 28 registered pending, and 44 unregistered pending.
  The migrated-only `shadow_operation_ids` list and all other operation rows
  remain unchanged.
- `docs/architecture/rust-backend-migration.md`, `docs/Log.md`,
  `docs/agent/test-catalog.md`, `docs/agent/known-errors.md`,
  `docs/agent/learnings.md`, and `docs/agent/lean-codebase-plan.md`: registration,
  test coverage, current counts, verification limits, and Atlas gate evidence.
- `.agent/traces/rust-atlas-media-measurements.md`: this worksheet.
- `papercuts.md`: records the inventory-path lookup, unavailable CCCC analyzer,
  and `vibe_wait` session-ID friction.

No changes were made to `thesis-db/src/atlas.rs`, Cargo files, or other database
ownership work.

## Commands run

- Ran `rustfmt --edition 2021 backend/crates/thesis-api/src/wiki_atlas/media_measurements.rs backend/crates/thesis-api/src/wiki_atlas/media_measurements_tests.rs`; it returned no output.
- Ran `rustfmt --edition 2021 --check backend/crates/thesis-api/src/wiki_atlas.rs backend/crates/thesis-api/src/wiki_atlas/media_measurements.rs backend/crates/thesis-api/src/wiki_atlas/media_measurements_tests.rs`; it returned no output.
- `wc -l` reported `wiki_atlas.rs` 1549 lines, `media_measurements.rs` 664 lines, and `media_measurements_tests.rs` 378 lines.
- `node scripts/check-maintainability.mjs backend/crates/thesis-api/src/wiki_atlas/media_measurements.rs backend/crates/thesis-api/src/wiki_atlas/media_measurements_tests.rs --json` returned `total:0`; the adapter does not measure Rust MI.
- A Python row count confirmed 178 operations, 106 migrated, 134 Rust registered, 28 registered pending, and 44 unregistered pending. The media row is registered and not migrated. The Atlas graph row remains unregistered.
- Source reads confirmed route and `ApiDoc.paths` registration, shared `query_source_name` use, and SQL/Python row-order behavior.
- `papercut list` found no matching `vibe_wait` entry; `papercut log` recorded the session-ID issue.
- No Cargo command was run. The user prohibited Cargo, build, and test commands, and the shared Cargo lock gate remains closed.

## Tests added

- `measurements_preserve_six_trace_semantics_for_source_scoped_input`: six
  trace order and values, stable IDs, a static two-article source-scoped input,
  and first-seen owner ties with relationship IDs in input order. A separate
  full-corpus fixture supplies three articles to a calculation with an empty
  source name and checks echo/count behavior. This does not test SQL filtering.
- `byline_trace_hash_matches_python_numeric_key_ordering`: golden ID for
  integer article keys 2 and 10 in Python numeric order.
- `byline_hash_preserves_input_author_order_duplicates_and_numeric_keys`:
  unsorted input rows and duplicate names remain in the subgraph/hash. Coauthor
  pairs use sorted, deduplicated names. Golden ID: `calc_09e77ad519ec79a1bcf135ce0aa6c872`.
- `reporter_movement_preserves_input_author_row_order`: movement results follow
  the first reporter row in the supplied input.
- `empty_corpus_still_emits_all_measurements_with_zero_denominators`: all six
  zero-denominator traces, null cadence/HHI, and no owners.
- `source_name_query_contract_accepts_empty_and_200_characters_but_rejects_longer_values`:
  absent, empty, 200-character Unicode, and over-limit parser behavior.
- `syndication_coverage_counts_a_nonempty_tag_list_with_empty_values`: list
  truthiness for `tags:[""]` while marker matching uses the joined text.

All seven tests are source-added and unrun. They do not exercise SQL loading or
filtering, trace persistence, HTTP behavior, or FastAPI parity. The shared Cargo
lock gate remains closed.

## Assumptions

- `load_media_measurement_data` filters articles for a nonempty `source_name`
  and orders them by `published_at`. It orders author rows by
  `(article_id, reporters.name)`. The ownership query has no `ORDER BY` and
  remains corpus-wide.
- The Rust calculation receives these arrays as loaded. It keeps raw author-row
  order for the byline subgraph and reporter movement. A separate reusable view
  sorts and deduplicates names for coauthor pairs.
- FastAPI keeps raw author rows in `article_authors`, uses `sorted(set(names))`
  for coauthor pairs, and emits reporter movements by first-seen reporter.
  Ownership trace IDs follow fetched row order. `Counter.most_common()` keeps
  first-seen owner order for count ties, and HHI uses that insertion order.
- The shared query parser accepts an empty string and enforces a 200-character
  limit. The empty-source calculation fixture supplies all three rows directly;
  it does not test the SQL loader's no-filter behavior.
- `persist_calculation_traces` uses conflict-ignore persistence. Runtime
  idempotency has not been exercised.
- Python integer-key `article_authors` mappings sort numerically before JSON
  string conversion. Rust canonicalizes the same key order for hashing.
- FastAPI remains public until HTTP and database parity are exercised. Route
  and ApiDoc registration do not prove runtime behavior.

## Before/after evidence

- Before this slice, `wiki_atlas::router` and central `ApiDoc.paths` omitted
  media measurements, and the inventory row was not Rust-registered. Both now
  register the route; the row remains `migrated:false`. Source inspection
  confirmed both declarations; no HTTP request was made.
- The former `calculate_measurement_writes` was 307 lines in an 880-line module.
  Its six calculation helpers now span 46, 42, 54, 43, 62, and 63 lines. The
  coordinator is 22 lines. The module and test source total 1042 lines
  (664 + 378), so the change does not reduce total LOC.
- Byline values keep input author order and duplicate names. A reusable
  `Vec<&str>` sorts and deduplicates a separate view for pair counting.
  `trace_id` serializes the name, result, subgraph, and empty input-ID list into
  one canonical `String` without cloning either JSON value.
- Reporter movement keeps first-seen author order. Ownership relationship IDs
  and HHI use fetched row order. Owner summaries sort by relationship count,
  with stable sorting to keep first-seen owners first when counts tie.
- The Python numeric-key golden ID is
  `calc_caec68386d72934d90b0733625034a5d`; the unsorted raw-author-order golden
  ID is `calc_09e77ad519ec79a1bcf135ce0aa6c872`.
- Operation rows confirm 134/178 total operations, 106 migrated, 28 registered
  pending, and 44 unregistered. The media row is registered but not migrated.
  The Atlas graph row remains unregistered and was not changed.

## Quality evidence and limits

- CCCC limits are cyclomatic complexity 10 and cognitive complexity 15. The
  pinned binary is neither installed nor cached, and it was not fetched. No
  CCCC measurements or threshold result are claimed.
- The maintainability command returned `total:0` for these Rust paths, so it
  produced no Rust MI score. The adapter selects JavaScript and TypeScript.
- CRAP coverage and Oxlint select TypeScript or JavaScript. They do not measure
  these Rust modules.
- `media_measurements.rs` has 664 lines and its test file has 378, below the
  file checker's 750-line warning threshold. `wiki_atlas.rs` has 1549 lines and
  no entry in `scripts/file-lines-debt.json`; the repository-wide file-line
  checker was not run.
- No Cargo command was run, as requested. Rust tests, typecheck, build, Clippy,
  HTTP behavior, persistence idempotency, and FastAPI parity remain unverified.

## Papercut friction

- A search guessed `docs/architecture/rust-backend-migration.json` for the
  operation inventory and returned “Path not found.” `papercut list` found no
  duplicate. The cause was confusing the migration Markdown path with the JSON
  inventory location. The path lookup and fix were logged.
- CCCC metrics could not be collected because pinned v1.6.0 was not installed
  or cached. The missing-tool constraint and fix were logged without fetching
  the binary.
- `vibe_wait` returned “Unknown vibe session” for job `RustApiInventory-t7`
  when called with session ID `RustApiInventory`. `papercut list` found no
  matching entry, so the session-ID friction was logged.
- A hashline patch for a one-line Rust function opener was rejected because its
  boundary was ambiguous. Re-read and replaced the opener with its first body
  line. The existing Papercut list contains this failure class, so no duplicate
  entry was added.

## Risk tier

Normal. The GET calls the existing conflict-ignore persistence API and keeps
the inventory risk flag `database_write`. Runtime idempotency is unverified.
This slice adds no schema or database-loader changes.

## Rollback

Remove the media route registration and query parameter schema from
`wiki_atlas.rs`, the `ApiDoc.paths` entry from `lib.rs`, and the handler and
test files. Revert the media operation row and adjust its three derived counter
fields in the inventory. Revert only linked media documentation. Leave the
shared DB API and unrelated working-tree changes intact; no migration is
required.

## Status

Source implementation, route registration, inventory row and counters,
documentation, and seven focused test sources are present. Rustfmt passed.
The Rust tests, build, typecheck, Clippy, HTTP behavior, and FastAPI parity were
not verified because the user prohibited Cargo commands and the shared lock
gate remains closed. FastAPI stays public and the operation remains
`migrated:false`.
