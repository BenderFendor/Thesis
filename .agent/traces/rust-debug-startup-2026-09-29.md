# Rust Debug Startup Route
Goal: register an always-mounted Rust shadow for FastAPI’s startup-metrics route.
Status: source-registered and formatted; `migrated:false`; compiled behavior and parity unverified.
Risk tier: Normal — read-only process-local startup metrics; no database write or public cutover.
Tests: three focused source tests added; none run under the no-Cargo gate.
Commands: scoped Rustfmt with `skip_children=true --check` passed; no Cargo/runtime commands.
Rollback: restore the prior optional-router placement and private observer helper; remove route tests and restore inventory/docs counts.

## Goal
Register only `GET /debug/startup` on the root Rust router, matching FastAPI’s unconditional `debug.router` inclusion and success-only static OpenAPI contract. Reuse the existing `ProfilingState` and startup response projection; keep other Rust debug routes behind the optional debug sidecar. Keep the operation `migrated:false` and FastAPI public. The separate B16 proof download remains unregistered because the lockfile has no ZIP writer and Cargo resolution/runtime verification are prohibited by the current gate.

## Files changed
- `backend/crates/thesis-api/src/lib.rs`
- `backend/crates/thesis-api/src/debug/overview.rs`
- `backend/crates/thesis-api/src/profiling.rs`
- `docs/agents/rust-openapi-operation-inventory.json`
- `docs/Log.md`
- `docs/architecture/rust-backend-migration.md`
- `docs/agent/test-catalog.md`
- `docs/agent/testing.md`
- `docs/agent/known-errors.md`
- `docs/agent/learnings.md`
- `.agent/traces/rust-debug-startup-2026-09-29.md`
- `docs/agents/traces/rust-debug-startup-2026-09-29.md`
- `papercuts.md`

## Commands run
- Initial `rustfmt --edition 2021 backend/crates/thesis-api/src/lib.rs backend/crates/thesis-api/src/debug/overview.rs backend/crates/thesis-api/src/profiling.rs` and a follow-up `rustfmt --edition 2021 --check` on those files omitted `--config skip_children=true`. The source-tree status and modification-time audit found no Rustfmt writes outside the three owned files; pre-existing API-module changes were preserved. This friction is logged in `papercuts.md`.
- Final scoped formatter check: `rustfmt --edition 2021 --config skip_children=true --check backend/crates/thesis-api/src/lib.rs backend/crates/thesis-api/src/debug/overview.rs backend/crates/thesis-api/src/profiling.rs` — passed with no output.
- No Cargo, Rust test/build/Clippy/self-test, server, curl, or Rust runtime commands were run under the hard gate.

## Tests added
- `lib::tests::startup_metrics_are_available_without_debug_mode_and_leave_debug_streams_optional`
- `lib::tests::startup_route_does_not_conflict_with_optional_debug_router`
- `lib::tests::debug_startup_openapi_matches_fastapi_success_contract`

These source tests exercise default-router availability and startup field projection, `/debug/streams` remaining unavailable without debug config, merge behavior with debug configuration, and the operation ID/response schema/sole 200 OpenAPI response. The database article route is a separate always-mounted exception. None were executed because Cargo is gated.

## Assumptions
- The user-confirmed FastAPI router inclusion is unconditional (`backend/app/api/routes/__init__.py:59`, mounted by `backend/app/main.py:98`), and `get_startup_metrics` has no debug-mode guard (`backend/app/api/routes/debug.py:296-299`).
- FastAPI’s static `/debug/startup` OpenAPI response is only 200 with `StartupMetricsResponse` (`backend/openapi.json:1393-1413`). The Rust annotation therefore lists only that response; this does not assert compiled runtime behavior.
- The existing `ProfilingState` observer and startup projection are the canonical Rust data source. Making `profiling::observe` `pub(crate)` lets the debug projection reuse its existing validation/error boundary without reaching into private state.
- No ZIP writer exists in `backend/Cargo.lock`; no package, lockfile, partial proof handler, or custom archive implementation was added. The proof row remains `rust_registered:false`, `migrated:false`.

## Risk tier
Normal. The route reads process-local profiling/startup state and reuses existing validation. It does not access the database or mutate persistent state. Router presence and source tests do not establish compilation, runtime behavior, or FastAPI parity; FastAPI remains the public listener.

## Rollback
Remove the always-mounted `/debug/startup` registration and its focused tests, restore `/debug/startup` to the optional overview router, return `profiling::observe` to private visibility, and revert the startup inventory flag/count plus route-specific catalog, status, architecture, known-error, and learning notes. Keep the proof operation unregistered; no Cargo manifest or lockfile change is involved.

## Status
The startup route is registered in source and central `ApiDoc`; inventory counts are 142/178 exposed, comprising 106 parity-proven, 36 registered-unverified, and 36 unregistered, with zero public cutovers. `/debug/startup` remains `migrated:false`. Its three tests are source-added but unrun. Cargo compilation/tests, runtime behavior, and FastAPI parity remain unverified; FastAPI remains public. The proof ZIP route remains both unregistered and unmigrated under the hard no-Cargo gate.