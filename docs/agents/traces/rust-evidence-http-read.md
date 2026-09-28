# Rust evidence HTTP read slice

## Goal and done criteria

Expose the existing evidence policy and claim-read behavior through Axum and
SQLx while preserving the checked-in OpenAPI contract and FastAPI responses.
Use the current Alembic schema and prove the claim query against disposable
PostgreSQL data.

## Status

The policy GET and claim-detail GET are available on the shadow Rust listener.
The Rust service matches the Python routes on the same disposable PostgreSQL
database. FastAPI remains the public listener. No schema migration was added.

## Changes

- Added `thesis-db::Database::load_claim_record` and typed claim/observation
  read models in `backend/crates/thesis-db/src/claim_record.rs`. Both reads use
  one SQLx transaction and one pooled connection, matching the Python session.
- Added `GET /api/wiki/evidence/claims/{claim_id}` with the existing response
  fields, enum values, nullable fields, and exact missing-claim 404 body.
- Added `GET /api/wiki/evidence/policies` backed by `thesis-evidence::policies`.
- Kept the 404 as runtime behavior because FastAPI's checked-in OpenAPI
  operation omits that status.
- Extended the OpenAPI compatibility normalizer for JSON Schema 3.1 nullable
  type arrays, nullable `anyOf`/`oneOf`, open JSON values, and numeric format
  hints. Requiredness, enums, statuses, and property types remain compared.
- Added HTTP differential cases for all policies, three present claim records,
  one missing claim, and the existing evidence/ranking/comparison requests.
  Only the observation list is sorted before comparison because Python's query
  has no ordering clause.
- Added verification-manifest entries, CI and `verify.sh` operation IDs, and
  current-state documentation.

## Verification

- `cargo test --manifest-path backend/Cargo.toml -p thesis-db`: 3 passed.
- `cargo test --manifest-path backend/Cargo.toml -p thesis-api`: 11 passed,
  including all claim-status and observation-entailment literals.
- Strict Clippy for `thesis-db`, `thesis-api`, and `thesis-server`: passed.
- Normalized OpenAPI comparison for policy and claim reads: passed.
- `backend/scripts/test_rust_http_differential.sh`: 1 PostgreSQL-backed HTTP
  differential test passed after applying Alembic through `20260720_0003`.
  The test emitted existing SQLAlchemy/Pydantic deprecation warnings.
- Ruff `I001`, Ruff formatting, and `git diff --check`: passed.
- After verification, `cargo clean --manifest-path backend/Cargo.toml` removed
  the 3.4 GiB generated workspace target; subsequent Cargo checks will rebuild
  those artifacts.

## Verification limits

The database query and HTTP handler cross SQLx, PostgreSQL, and sockets, so
Kani and Verus are not applied to those I/O boundaries. The pure status mapping
has finite Rust unit cases; no deduction or bounded proof is claimed for it.
The SQL query is verified against fixtures in the current Alembic schema; this
does not prove write behavior, transaction rollback, or every production JSON
value. Observation order remains unspecified by the API.

## Next step

Continue with `GET /api/wiki/evidence/relationships`. Preserve the separate
`as_of` and `known_at` filters, inclusive `valid_to` boundary, exclusive
`retracted_at` boundary, current lineage-root rules, and deterministic result
ordering. Seed explicit timestamps and multiple-parent/cyclic lineage cases in
the disposable PostgreSQL differential before exposing it on the Rust listener.
