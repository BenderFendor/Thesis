# Rust evidence relationship reads

## Goal and done criteria

Implement the existing evidence relationship list as a read-only Axum shadow
route. Preserve the checked-in OpenAPI contract and compare the same requests
against FastAPI over a disposable database.

## Status

Implemented. Rust serves
`GET /api/wiki/evidence/relationships` on the shadow listener. FastAPI remains
the public owner. SQLx reads the existing Alembic-managed schema.

## Changed files

- `backend/crates/thesis-db/src/relationships.rs`
- `backend/crates/thesis-api/src/relationships.rs`
- `backend/tests/test_rust_evidence_http_differential.py`
- `verify.sh` and `.github/workflows/rust-backend.yml`
- `AGENTS.md`, `docs/agent/repo-map.md`, `docs/agent/testing.md`,
  `docs/architecture/rust-backend-migration.md`,
  `docs/agents/formal-audit/verification-manifest.json`, and `docs/Log.md`

## Behavior and decisions

- `as_of` applies to `valid_from` and `valid_to`; `known_at` applies to
  `recorded_at` and `retracted_at`. Both bounds are exercised independently.
- Predicate CSV values are trimmed and empty entries dropped. Entity matching
  checks either side without changing relationship direction.
- Results sort by predicate, subject, object, then relationship ID. Claim IDs
  sort lexically. Root counts union distinct lineage roots across linked claims.
- The route preserves relationship `status` and does not filter by
  `lifecycle_state`.
- The existing Python list service does not constrain linked evidence or
  lineage rows by `known_at`. Rust currently preserves that behavior. The HTTP
  fixture keeps linked evidence older than `known_at`; broader historical
  evidence visibility needs a separate domain decision.
- Python cycle traversal can select a cycle member based on visitation order.
  Rust resolves terminal parents deterministically and chooses the reachable
  terminal root when a cycle has one. A dedicated Rust regression covers that
  behavior. It is not included as a Python parity case.
- Kani and Verus do not cover this database/HTTP slice. Kani's symbolic
  heap-graph harness did not finish within 90 seconds and was removed; no proof
  is claimed for lineage traversal. The endpoint has Rust unit and PostgreSQL
  differential tests.

## Verification run

- `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` passed.
- `cargo test --manifest-path backend/Cargo.toml --workspace` passed 130 tests.
- Strict workspace Clippy passed with `-D warnings`.
- `backend/scripts/test_rust_http_differential.sh` passed the FastAPI/Axum
  comparison against a disposable PostgreSQL database.
- Normalized OpenAPI comparison passed for all six Rust shadow operations.
- Focused Ruff import and format checks passed for changed Python files.
- `scripts/self-test` stopped at the repo quality gate with 141
  code-multivitals violations. A direct backend run completed with 779 passed,
  3 failed, and 4 deselected. The failures are existing article contract
  serializer assertions and the reporter coverage citation count; they do not
  exercise this relationship route.

## Risks and next step

The SQL membership filters use typed PostgreSQL arrays, avoiding one bind per
relationship or claim ID. No large-result integration case or production
volume benchmark was run.

Next: add relationship read load measurements and continue with the next
independently bounded query slice. Keep FastAPI public until full HTTP, SSE,
WebSocket, database, and client compatibility gates pass.
