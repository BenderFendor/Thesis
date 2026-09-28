# Task worksheet: Rust API 178-operation registration
Date: 2026-09-25
Status: Partial — 45 operations remain unregistered and 27 new registrations are unverified; Rust stays shadow-only
Inventory: 133/178 Rust HTTP routes; 106 parity-proven; 27 registered/unverified; 45 unregistered; 0 cutovers
Slices: B04 6/29 pending; B07 5/5; B12 2/6; B13 4/10; B14-B16 10/22 (=27 new routes); all remain `migrated:false`
Verification: workspace tests and rustfmt passed; strict Clippy and 106-operation OpenAPI compatibility passed; live `/api/verification/status` returned 200. Root self-test remains failed before Rust gates at repo quality-hardening.
Risk tier: Medium — shadow routes, SQL reads, bounded DEBUG_LOG_DIR deletion, and frontend-report JSONL writes

## Goal

Register and document the requested Rust shadow operations, preserve unmigrated
status until parity is proven, fix strict Clippy diagnostics, and verify the
runtime OpenAPI inventory.

## Files changed

Full task-owned file list: `docs/agents/traces/rust-api-178-operations-2026-09-25.md`,
section “Files changed”. This worksheet and the linked detailed record are new;
all unrelated working-tree changes were preserved.

## Commands run

- `cargo test -p thesis-api --lib --message-format short` — 140 passed.
- `cargo test -p thesis-api debug::tests --lib --message-format short` — 8 passed.
- `DATABASE_URL=postgres://bender@127.0.0.1:55438/postgres cargo test -p thesis-db analytics::tests --lib --message-format short` — 2 passed after restoring the stopped disposable test cluster; it was stopped afterward.
- `cargo clippy -p thesis-api --all-targets -- -D warnings` — passed with no warnings after fixing two test-only lints.
- `cargo clippy -p thesis-db --all-targets -- -D warnings` — passed with no warnings.
- `cargo build -p thesis-server` — passed without warnings.
- `backend/target/debug/thesis-server --openapi` parsed against the inventory — 133 operation IDs; 27 pending registered, 45 pending unregistered, 0 migrated absent.
- The first SQLx attempt hit `PoolTimedOut` because no PostgreSQL service was listening; the disposable local cluster was restored using `pg_ctl`, rerun passed, and the service was stopped.
- `scripts/self-test` via watchdog, one invocation — exited 1 after 130.875s at `node scripts/quality-hardening.mjs verify --scope repo`, before Rust gates.
- `DATABASE_URL=postgres://bender@127.0.0.1:55438/postgres cargo test --manifest-path backend/Cargo.toml --workspace` — passed, including workspace/doc tests.
- `cargo fmt --manifest-path backend/Cargo.toml --all` followed by `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` — passed.
- `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings` — passed with no warnings.
- `cargo run --manifest-path backend/Cargo.toml --locked -p thesis-server -- --openapi` plus `python3 scripts/check_openapi_compat.py backend/openapi.json /tmp/thesis-rust-openapi-rustapibaseline-20260925.json --operation-inventory docs/agents/rust-openapi-operation-inventory.json` — 106 migrated operations match.
- Live smoke: `thesis-server` bound to `127.0.0.1:8120` against the disposable PostgreSQL cluster; `curl --include --silent --show-error --max-time 10 http://127.0.0.1:8120/api/verification/status` returned HTTP 200 with `{"enabled":true,"max_duration_seconds":15,"max_claims":10,"max_sources_per_claim":5,"cache_ttl_hours":24,"recheck_threshold":0.4,"allowed_domains_count":23}`. Both services were stopped; FastAPI listener unchanged.

## Tests added or updated

- OpenAPI registration test covers mounted operation IDs and rejects 22 unsupported B12/B13/B14-B16 paths.
- SQLx regression covers pre-limit top-ten ordering with an unmatched NULL group.
- Debug traversal test asserts the 400 JSON detail; wiki dossier and verification tests cover their read contracts.

## Assumptions

FastAPI remains the public listener. Route presence is not parity proof;
all newly registered operations remain `migrated:false`. Provider/cache gaps,
SSE buffering, debug-event source limits, and dossier-enrichment gaps remain
explicit. `rust_registered` records runtime route presence on all 72 pending rows
(27 registered, 45 unregistered), distinct from migration parity.

## Risk tier

Medium: shadow route/API and SQL reads plus bounded direct-log deletion under
configured `DEBUG_LOG_DIR` (keep_recent 1–20, default 5) and frontend-report
JSONL appends; no public cutover.

## Rollback

Revert only the files listed in the linked detailed trace as one task-scoped
unit. Preserve unrelated WIP and do not remove FastAPI routes or alter migration
flags.

## Status

Partial — scoped checks pass, but the 178-operation migration remains incomplete:
27 pending routes are unverified, and 45 remain unregistered. Final root
verification results are recorded in the detailed trace.
