# Rust API 178-operation registration and parity boundary
Date: 2026-09-25
Status: Partial — 45 operations remain unregistered and 27 new registrations are unverified; Rust stays shadow-only
Inventory: 133/178 Rust HTTP routes; 106 parity-proven; 27 registered/unverified; 45 unregistered; 0 cutovers
Slices: B04 6/29 pending; B07 5/5; B12 2/6; B13 4/10; B14-B16 10/22 (=27 new routes); all remain `migrated:false`
Verification: API 140/140; SQLx analytics 2/2; API/DB all-target strict Clippy clean
Risk tier: Medium — shadow routes, SQL reads, bounded DEBUG_LOG_DIR deletion, and frontend-report JSONL writes

## Goal

Register and inventory the requested Rust shadow routes, preserve every unverified
operation as `migrated:false`, capture the SQL ordering/null regression, fix
strict Clippy findings without suppressions, and document the exact parity limits.

## Current result

The built `thesis-server --openapi` runtime emitted 133 operation IDs. Comparing
that output with the 178-row FastAPI inventory found 27 pending operations
registered in Rust, 45 pending operations without a Rust route, and no migrated
operation missing from Rust OpenAPI. Public listener cutover remains zero.

- B12 mounts only verification status and allowed-domain reads (2/6). Four
  provider/cache operations remain unmounted because their real provider,
  cancellation, cache, and workspace-cleanup adapters are unavailable.
- B13 mounts three GDELT reads and the Blindspot viewer (4/10). Sync and the
  five remaining Blindspot operations stay unregistered. The database regression
  confirms an unmatched NULL article group consumes a top-ten slot before
  unmatched groups are dropped; nine matched groups remain, with the count-2
  article ranked first.
- B14-B16 mount 10 of 22 pending wiki/Atlas/evidence operations. The reporter
  dossier serves persisted profile data and the latest 20 articles; activity,
  career-timeline, and employer enrichments remain unavailable.
- B07 research keeps its provider and streaming parity limits: Rust buffers SSE
  rather than delivering incremental, cancellation-aware events.
- B04 `/debug/logs/events` contains frontend-report-ingestion events only, not
  Python `debug_logger` events. It remains unmigrated.
- The inventory's `rust_registered` field now records runtime route presence on
  all 72 pending rows: 27 registered and 45 unregistered. These flags remain
  separate from `migrated`.

## Files changed

- `backend/crates/thesis-db/Cargo.toml`
- `backend/crates/thesis-db/src/analytics.rs`
- `backend/crates/thesis-db/src/lib.rs`
- `backend/crates/thesis-db/src/wiki.rs`
- `backend/crates/thesis-api/src/blindspots.rs`
- `backend/crates/thesis-api/src/debug.rs`
- `backend/crates/thesis-api/src/gdelt.rs`
- `backend/crates/thesis-api/src/inline.rs`
- `backend/crates/thesis-api/src/lib.rs`
- `backend/crates/thesis-api/src/news_research.rs`
- `backend/crates/thesis-api/src/search.rs`
- `backend/crates/thesis-api/src/verification.rs`
- `backend/crates/thesis-api/src/wiki.rs`
- `backend/crates/thesis-api/src/wiki_atlas.rs`
- `docs/agents/rust-openapi-operation-inventory.json`
- `docs/agent/test-catalog.md`
- `docs/agent/testing.md`
- `docs/agent/learnings.md`
- `docs/architecture/rust-backend-migration.md`
- `docs/Log.md`
- `papercuts.md` (tool-generated friction records)
- `.agent/traces/rust-api-178-operations-2026-09-25.md`
- `docs/agents/traces/rust-api-178-operations-2026-09-25.md`

The working tree also contains extensive independent user WIP; it was left
untouched. `README.md` and `docs/agent/known-errors.md` were checked; no update
was needed.

## Tests added or updated

- The central OpenAPI test asserts the registered operation IDs and `200`
  response declarations, and explicitly rejects 22 unsupported B12/B13/B14-B16
  paths. It also checks verification's deliberate 2-of-6 registration boundary.
- The GDELT SQLx regression exercises pre-limit top-ten ordering with a NULL
  article group and verifies the matched ranking/count boundary.
- Debug-log traversal coverage asserts the existing 400 response and exact
  JSON detail. Wiki dossier and verification tests cover their registered read
  contracts and explicit unavailable-provider behavior.
- `docs/agent/test-catalog.md` records each focused test's coverage and avoids.

## Commands run and evidence

| Check | Command or scenario | Result |
| --- | --- | --- |
| API tests | `cargo test -p thesis-api --lib --message-format short` | Passed: 140 tests, 0 failed, no warnings. |
| Debug regression | `cargo test -p thesis-api debug::tests --lib --message-format short` | Passed: 8 tests, 0 failed. |
| SQLx analytics | `DATABASE_URL=postgres://bender@127.0.0.1:55438/postgres cargo test -p thesis-db analytics::tests --lib --message-format short` | Passed: 2 tests, 0 failed, on the disposable local PostgreSQL cluster. |
| Strict API Clippy | `cargo clippy -p thesis-api --all-targets -- -D warnings` | Passed with no warnings. |
| Strict DB Clippy | `cargo clippy -p thesis-db --all-targets -- -D warnings` | Passed with no warnings. |
| API executable | `cargo build -p thesis-server` | Passed without warnings. |
| Runtime OpenAPI | `backend/target/debug/thesis-server --openapi`, parsed against the operation inventory | 133 Rust OpenAPI operations; 27 pending registered, 45 pending unregistered, 0 migrated operations absent. |
| Workspace tests | `DATABASE_URL=postgres://bender@127.0.0.1:55438/postgres cargo test --manifest-path backend/Cargo.toml --workspace` | Passed, exit 0; workspace tests and doc tests completed. |
| Workspace formatting | `cargo fmt --manifest-path backend/Cargo.toml --all` then `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` | Passed. |
| Strict workspace Clippy | `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings` | Passed with no warnings. |
| OpenAPI compatibility | `cargo run --manifest-path backend/Cargo.toml --locked -p thesis-server -- --openapi`; `python3 scripts/check_openapi_compat.py backend/openapi.json /tmp/thesis-rust-openapi-rustapibaseline-20260925.json --operation-inventory docs/agents/rust-openapi-operation-inventory.json` | Passed: contract matches for 106 migrated operations; Rust OpenAPI exposes 133 operations. |
| Live shadow handler | Disposable PostgreSQL on 55438; `thesis-server` bound to `127.0.0.1:8120`; `curl --include --silent --show-error --max-time 10 http://127.0.0.1:8120/api/verification/status` | HTTP 200; body `{"enabled":true,"max_duration_seconds":15,"max_claims":10,"max_sources_per_claim":5,"cache_ttl_hours":24,"recheck_threshold":0.4,"allowed_domains_count":23}`. Server and database stopped; FastAPI listener unchanged. |
| Root self-test | One watchdog-wrapped `scripts/self-test` invocation | Exit 1 after 130.875s at the pre-Rust repo quality-hardening gate; see below. |

The SQLx test service was initially stopped, so the first attempt returned
`PoolTimedOut`; `pg_isready` confirmed no listener. The reusable disposable
cluster at `/tmp/thesis-analytics-test.y0w6Eu/data` was started on port 55438
with its socket directory inside the temp cluster, the regression passed 2/2,
and the cluster was stopped afterward. No Docker or package installation was
used.

The first all-target API Clippy run identified two test-only lints:
`bool_assert_comparison` in `news_research.rs` and `get_first` in `wiki.rs`.
They were fixed as `assert!(...)` and `.first()`; final all-target API Clippy
passed. The broader feature-owner Clippy follow-up also replaced the large
`Response` error with a small debug-path error enum, grouped blindspot helper
inputs, elided a needless lifetime, and derived verification's `Default`.

The inventory's `rust_registered` boolean is present for all 72 pending rows;
27 are registered and 45 are not. Those route-presence counts are separate from
the 106 migration/parity flags. The single watchdog-wrapped `scripts/self-test`
run exited 1 after 130.875 seconds before Rust gates, at
`node scripts/quality-hardening.mjs verify --scope repo` (`verification repo:
failed`). A direct rerun of that repository-quality command also exited 1 after
130.412 seconds with the same output. The aggregate root gate remains failed at
that pre-Rust stage; the Rust gates and live shadow smoke above passed separately.

A separate unused cluster directory was initialized at
`/tmp/thesis_api_baseline_20260925_01` but never started or used for tests. It
remains stopped and outside the repository.

## Assumptions

- Rust remains a shadow listener. Route existence, OpenAPI declaration, and
  local tests do not establish FastAPI behavioral parity.
- No newly registered row may be marked migrated without the corresponding
  consumer-visible, differential parity evidence.
- SSE buffering/cancellation differences, unavailable provider/cache paths,
  debug-event source boundaries, and reporter-dossier enrichment gaps remain
  explicit parity limitations.
- The disposable database is test-only; no configured developer database or
  live external provider was used.

## Risk tier

Medium. The change expands shadow routes and SQL reads, and adds bounded local
file-system side effects: `DELETE /debug/logs/files` removes only direct log
files under configured `DEBUG_LOG_DIR` according to validated `keep_recent`
(1–20, default 5), while frontend-report ingestion appends JSONL there. No
public cutover occurs.

## Rollback

Revert only the task-owned route registrations, database query/re-export and
SQLx feature changes, inventory rows, focused tests, and corresponding docs as
a unit. Preserve unrelated WIP. Do not remove FastAPI paths or change any
`migrated` flags as part of rollback.

## Status

Partial — focused feature gates pass, but the 178-operation backend migration
remains incomplete: 27 pending routes are unverified and 45 remain unregistered.
Documentation updated: Log, migration architecture, testing guide, test catalog,
learnings, operation inventory, and both task traces. `known-errors.md` checked;
no update was needed.
