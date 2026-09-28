# B02 News Cache and Source Catalog
Task: Record B02 Rust source-catalog and news-cache parity changes on 2026-09-25.
Goal: Match Python duplicate-key semantics and the default FastAPI source-stats error in Rust.
Files changed under `backend/crates/thesis-api/src/`:
`news_cache.rs`, `source_catalog.rs`, `lib.rs`, and `news_cache_tests.rs`.
Verification: 5 route tests, 5 catalog tests, strict check, Clippy, and formatting passed.
FastAPI: `GET /news/sources/stats` returned `500`, `text/plain; charset=utf-8`,
with body `b'Internal Server Error'`.
Risk tier: Medium. Rust source-stats response validation and catalog parsing changed.

## Implementation

- `backend/crates/thesis-api/src/news_cache.rs` returns the FastAPI-compatible 500
  text response when a cached source row has non-string `last_checked` or `url`.
- `backend/crates/thesis-api/src/source_catalog.rs` uses a `MapAccess` visitor.
  Duplicate values replace the original value without changing key position.
- `backend/crates/thesis-api/src/source_catalog.rs` tests duplicate-key semantics
  and unique configured names.
- `backend/crates/thesis-api/src/lib.rs` includes `news_cache_tests` under `cfg(test)`.
- `backend/crates/thesis-api/src/news_cache_tests.rs` contains five focused
  production-router tests using an injected cache.

## Tests and checks

From `backend/`:

- `cargo test -p thesis-api news_cache_tests --lib` passed 5 tests.
- `cargo test -p thesis-api source_catalog::tests --lib` passed 5 tests.
- `RUSTFLAGS="-D warnings" cargo check -p thesis-api --all-targets` passed.
- `cargo clippy -p thesis-api --all-targets -- -D warnings` passed.
- `cargo fmt --manifest-path crates/thesis-api/Cargo.toml -- --check` passed.

Route test names: `cached_page_filters_sources_and_paginates`,
`cached_index_filters_and_sets_cache_headers`,
`source_and_category_routes_project_configured_articles`,
`source_stats_reject_invalid_rows_and_accept_valid_rows`, and
`default_empty_routes_return_empty_data_and_source_stats_error`.

Source-catalog regression tests:
`catalog_object_uses_last_duplicate_value_and_first_position` and
`configured_catalog_names_are_unique`.

## FastAPI runtime evidence

A credential-free `TestClient(app, raise_server_exceptions=False)` call against
the current `app.main:app` for `GET /news/sources/stats` returned:

- Status: `500`
- Content type: `text/plain; charset=utf-8`
- Body bytes: `b'Internal Server Error'`

Validating the current default handler payload against `SourceStatsList`
produced 264 errors. All 261 configured rows had `last_checked: null`, which
fails the required string field. Three `url` values were lists rather than
strings: `sources[11]` New York Times, `sources[46]` Bloomberg, and
`sources[60]` The Nation. The Rust route mirrors the observed response.
Python and OpenAPI were not changed.

## Assumptions and rollback

The route tests use the production Axum router with an injected cache and a lazy
database. They do not connect to PostgreSQL or RSS feeds. The FastAPI request
uses the default application without credentials or startup tasks.

Rollback: revert only the reviewed B02 hunks in the four listed Rust files.
Preserve all pre-existing and unrelated changes. Do not restore whole files or
reset the working tree. Keep Python and OpenAPI files unchanged.

Status: Complete; focused Rust verification and default FastAPI runtime evidence are recorded.
