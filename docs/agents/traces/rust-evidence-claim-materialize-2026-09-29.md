# Rust Evidence Claim Materialization Route
Goal: register a FastAPI-compatible Rust shadow for evidence claim materialization.
Status: implemented and formatted; `migrated:false`, runtime and parity unverified.
Risk tier: High — token-gated database write.
Tests: three focused source tests and central OpenAPI assertions added, not run.
Commands: scoped standalone rustfmt only; no Cargo or HTTP runtime commands.
Rollback: remove the route and OpenAPI registration, restore inventory counts, and remove the route-specific notes.

## Goal
Implement `POST /api/wiki/evidence/claims/{claim_id}/materialize` in the Rust API using the existing thesis-db materializer and relationship query. Preserve token/reviewer validation, query defaults and errors, domain-vs-database status mapping, exact relationship reload, and the generated operation ID. Keep FastAPI public and the inventory row `migrated:false`.

## Files changed
- `backend/crates/thesis-api/src/claims.rs`
- `backend/crates/thesis-api/src/lib.rs`
- `docs/agents/rust-openapi-operation-inventory.json`
- `docs/Log.md`
- `docs/agent/test-catalog.md`
- `docs/agent/testing.md`
- `docs/agent/known-errors.md`
- `docs/agent/learnings.md`
- `docs/agent/lean-codebase-plan.md`
- `docs/architecture/rust-backend-migration.md`
- `.agent/traces/rust-evidence-claim-materialize-2026-09-29.md`
- `docs/agents/traces/rust-evidence-claim-materialize-2026-09-29.md`
- `papercuts.md` (rustfmt module-recursion and hashline-range repair friction)

## Commands run
- `rustfmt --edition 2021 --config skip_children=true backend/crates/thesis-api/src/claims.rs backend/crates/thesis-api/src/lib.rs` — formatted only the edited Rust files.
- `rustfmt --edition 2021 --config skip_children=true --check backend/crates/thesis-api/src/claims.rs backend/crates/thesis-api/src/lib.rs` — passed.
- Local no-network/no-`.env` Pydantic `TypeAdapter(bool)` probes via
  `backend/.venv/bin/python -I`: `"true"`, `"TRUE"`, `"False"`, `"on"`, and
  `"OFF"` were accepted; `" true"`, `"true "`, and `" true "` were rejected
  with `bool_parsing`.
- Initial `rustfmt --edition 2021 --check ...` traversed child modules and returned formatting diffs; recorded in `papercuts.md`. The retry used `skip_children=true`; no unrelated module files were formatted.
- Cargo tests/build/Clippy/self-test, database commands, server startup, and HTTP requests were not run under the shared Rust gate.

## Tests added
- `claims::tests::complete_control_path_matches_fastapi_boolean_values_and_default`
- `claims::tests::materialize_token_auth_matches_fastapi_statuses_and_details`
- `claims::tests::reviewer_header_and_blank_value_match_fastapi_validation`
- Extended `lib::tests::rust_openapi_contains_the_existing_operation_id_and_statuses` for the exact operation ID, response schema/statuses, parameters, and default.
- None of these tests were run because the shared Cargo lock gate was closed.

## Assumptions
- `Database::materialize_claim` owns its existing transaction and supplies the domain/database error boundary, but it commits before Rust's relationship reload and response conversion.
- `Database::list_relationships` with current `as_of`/`known_at` and the materialized subject ID is the existing canonical way to reload the exact returned relationship.
- `SCOOP_MATERIALIZE_TOKEN` is read from the process environment per request; no `.env` file is read. The success log contains claim ID, reviewer, and relationship ID, never the token.
- The query parser compares Pydantic boolean spellings case-insensitively without trimming or allocating a normalized copy; the local probe confirmed whitespace is rejected.

## Risk tier
High. This endpoint mutates accepted research facts. It is token-gated and remains a shadow route; no public listener cutover or thesis-db/schema changes were made.
Transaction-boundary risk: FastAPI `get_db` commits only after handler returns
and rolls back exceptions. Rust `Database::materialize_claim` commits before
relationship reload/response conversion, so later failure can return 500/422
with the write persisted; FastAPI would roll back.
It also commits an adjudication item before returning `EvidenceSpine` on conflict
(`backend/crates/thesis-db/src/atlas_materialization.rs:701-715`). Rust maps
that conflict to 422 after commit; FastAPI raises and `get_db` rolls back. Scope
forbids thesis-db edits, so both mismatches remain unresolved and the route
stays `migrated:false`.

## Rollback
Remove `claims::materialize_claim` and its focused source tests, remove its router and `ApiDoc` entries, restore the inventory counts to 34 registered/38 unregistered and mark the operation unregistered, and remove the route-specific catalog/status notes and paired traces. No database migration or thesis-db edit is involved.

## Status
Source implementation and scoped rustfmt are complete. Inventory: 141/178 operations are Rust-registered; 106 are parity-proven, 35 registered-unverified, 37 unregistered; public cutovers 0. The route's row remains `migrated:false`. Compiled behavior, database persistence/reload, mounted HTTP behavior, and FastAPI parity remain unverified; FastAPI remains public.
