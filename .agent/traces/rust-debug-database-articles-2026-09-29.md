# Rust B04 Database Articles Trace
Task: `rust-debug-database-articles-2026-09-29`
Status: registered, `migrated:false`, unverified; FastAPI remains public.
Goal: expose the read-only database article route on the default Rust root state.
Selection: normal-risk B04 operation backed by the existing production `Database` adapter; no provider, fake fallback, or dependency was added.
Verification: scoped `rustfmt` and Ruff format checks passed; source and HTTP tests were added but not run under the no-Cargo gate.
Risk: normal, read-only database access with the existing disabled-database and query-error responses.

## Files changed
- `backend/crates/thesis-api/src/lib.rs`
- `backend/crates/thesis-api/src/debug/articles.rs`
- `backend/tests/test_rust_evidence_http_differential.py`
- `docs/agents/rust-openapi-operation-inventory.json`
- `docs/Log.md`
- `docs/agent/test-catalog.md`
- `docs/agent/testing.md`
- `docs/agent/known-errors.md`
- `docs/agent/learnings.md`
- `docs/agent/lean-codebase-plan.md`
- `.agent/traces/rust-debug-startup-2026-09-29.md` (updated test name and current route-availability note)
- `docs/agents/traces/rust-debug-startup-2026-09-29.md` (canonical mirror updated)
- `.agent/traces/rust-debug-database-articles-2026-09-29.md`
- `docs/agents/traces/rust-debug-database-articles-2026-09-29.md`
- `papercuts.md` (tool friction records)

`docs/architecture/rust-backend-migration.md` was checked and left unchanged because its live summary already contained the correct 143/178 counts, eight B04 routes, and database-articles root-state note.

## Implementation
The root router now mounts `GET /debug/database/articles` for the existing handler with `State<AppState>` and reads through the shared `Database`; this root route is the handler's sole mounted HTTP path. The optional debug router remains unchanged, retaining `/debug/chromadb/articles`, `/debug/cache/delta`, and `/debug/storage/drift`. Query validation still precedes the database-enabled check. A supplied `DebugConfig` controls the flag; otherwise Rust mirrors FastAPI's `ENABLE_DATABASE` false-value set (`0`, `false`, `False`, and empty) from process environment. The Rust server does not load `.env` itself.

The response DTO and Utoipa operation describe the FastAPI response fields, seven query parameter names, defaults, and 200/422 OpenAPI responses. Boolean query parsing accepts the established literals case-insensitively without trimming or allocating a lowercase copy, so surrounding whitespace remains invalid.

## Tests added, not run
- `database_debug_enable_database_setting_matches_fastapi_environment_values`
- `database_debug_articles_are_root_mounted_and_validate_before_database_access`
- `database_debug_articles_returns_unavailable_when_database_is_disabled`
- `database_debug_articles_openapi_matches_fastapi_operation_contract`
- `boolean_query_accepts_pydantic_literals_and_rejects_unknown_values`
- `boolean_query_rejects_surrounding_whitespace_like_fastapi`
- `test_debug_database_articles_matches_fastapi_against_migrated_postgres` seeds three article rows and compares Rust/FastAPI filtering, missing embeddings, ordering, pagination, inclusive date bounds, defaults, and query errors.

The HTTP differential test requires a disposable Alembic-migrated database and a prebuilt `backend/target/debug/thesis-server`. Neither it nor any Rust test/build/Clippy/self-test/server/runtime check was run under the task's hard gate.

## Commands run
- `rustfmt --edition 2021 --config skip_children=true --check backend/crates/thesis-api/src/lib.rs backend/crates/thesis-api/src/debug/articles.rs` — final run passed with no output. The first check identified formatting-only differences in `lib.rs`; those lines were corrected manually and the scoped check was rerun.
- `backend/.venv/bin/ruff format --check backend/tests/test_rust_evidence_http_differential.py` — first check reported that the file needed formatting. `backend/.venv/bin/ruff format backend/tests/test_rust_evidence_http_differential.py` formatted only this file; the repeated scoped check passed. The formatter also normalized three existing wrapped assertion expressions.
- New `papercut log` records document the architecture no-op, reported `vibe_wait` session-label mistake, and multi-file read-selector misuse. The unavailable peer handle and hidden-line edit matched existing papercut records, so they were not duplicated.

## Assumptions
- The production root `AppState` is the complete database boundary for this route; `DebugRuntimeProvider` is not required.
- `DebugConfig.enable_database` takes precedence when supplied. Without it, the root route reads the process environment and uses FastAPI's exact false-value truth table; Rust does not independently load `.env`.
- Existing SQLx `Database::debug_articles` owns filtering, stable order, pagination, and aggregate dates; the new HTTP test is the consumer-level regression but remains unexecuted.

## Rollback
Restore only this task's route/state/parser/test changes, the target inventory row and derived counts, current summaries/catalog/log/learning entries, the two startup-trace wording changes, and these paired worksheets. Preserve all pre-existing and concurrent WIP; do not reset, clean, or overwrite unrelated files.

## Status
Route and OpenAPI registration are present; inventory status remains `migrated:false`. FastAPI remains public. Formatting is verified; Rust tests, the seeded HTTP differential, runtime behavior, and parity remain unverified.
