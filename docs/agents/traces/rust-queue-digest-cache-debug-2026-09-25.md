# Rust queue digest and cache debug handoff
Date: 2026-09-25
Status: API/provider slice verified separately; root self-test failed before Rust gates
Scope: B04 cache debug, B06 queue digest, migration documentation
Migration: 106 of 178 operations shadowed; 72 remain; public cutovers: 0
B04: Five route/OpenAPI tests; seeded state only; production cache parity is unproven
B06: Nine route tests, six local-fixture adapter tests; no live LLM call

## Goal

Implement the B04 cache-debug and B06 queue-digest shadow slices, then record
their route, provider, parity, and verification evidence.

## Current result

The API inventory has 106 of 178 operations implemented in Rust (59.6%), with
72 remaining. Public cutovers remain at zero, and FastAPI remains public. The
current shadow slices are B02's five cached-news routes, B04
`GET /debug/cache/articles`, and B06 `POST /api/queue/digest`.

The 2026-09-25 workspace run passed 247 tests: 34 `rss_parser_rust`, 87
`thesis-api`, 13 `thesis-db`, 18 `thesis-evidence`, 21 `thesis-ingest`, 14
`thesis-runtime`, 54 `thesis-search`, and 6 `thesis-server`. The workspace now
includes `thesis-runtime`, a `no_std` crate of pure protocol reducers used by
`thesis-api`. `thesis-agent` and `thesis-observe` are absent.

## B04 cache debug boundary

`backend/crates/thesis-api/src/news_cache_tests.rs` has five tests:

- `debug_cache_filters_exact_source_paginates_and_projects_nullable_fields`
- `debug_cache_defaults_and_blank_source_return_cache_order`
- `debug_cache_rejects_invalid_page_bounds`
- `debug_cache_reports_malformed_articles_as_generic_server_errors`
- `openapi_registers_debug_cache_operation_and_exact_schemas`

These cover case-sensitive source matching, absent and blank filters, cache
order, pre-pagination totals, empty offset pages, the nine-field projection,
nullable values, the `general` category default, invalid page bounds, generic
errors for malformed records, and exact OpenAPI schemas. The router uses
seeded process-local cache state and a lazy database handle. The production
server starts with the default empty `CacheStreamState`, does not configure a
cache refresh provider, and does not share Python's `NewsCache`. These tests do
not establish live cache contents, database access, RSS refresh behavior, or
Python cache parity.

## B06 queue digest boundary

The queue-digest route has nine Rust tests. They cover query validation,
malformed JSON, missing or failing providers, injected ordered prompts,
normalized response fences and article projection, object insertion order, and
schema behavior. The tests inject a provider and use a lazy database handle.

The provider adapter has six tests backed by a local fixture server. They cover
configuration, OpenRouter request shape, OpenCode session/request IDs and
attribution headers, llama.cpp request shape, generic upstream failure without
retry, and malformed completion responses. They make no live LLM request.
The Python contract suite covers 19 queue operations; it is not 19 live
end-to-end Rust HTTP requests.

The Rust adapter makes one reqwest request without retry. FastAPI OpenRouter
and llama.cpp clients leave retries at the OpenAI SDK default of two; the
OpenCode client sets `max_retries=0`. Provider availability, completion
quality, and retry parity are not established by the local-fixture tests.

## Verification

The workspace test run preceded the provider formatting. The first workspace
format check found that only
`backend/crates/thesis-server/src/queue_digest_provider.rs` needed formatting.
That file was formatted, after which focused rustfmt and workspace-format checks
passed. The provider test, locked server build, and OpenAPI comparison were
rerun and passed.

| Phase | Check | Command | Result |
| --- | --- | --- | --- |
| Before provider formatting | API tests | `cargo test --manifest-path backend/Cargo.toml --locked -p thesis-api` | 87 passed. |
| Before provider formatting | Server tests | `cargo test --manifest-path backend/Cargo.toml --locked -p thesis-server` | 6 passed. |
| Before provider formatting | Workspace tests | `cargo test --manifest-path backend/Cargo.toml --locked --workspace` | 247 passed: 34 `rss_parser_rust`, 87 `thesis-api`, 13 `thesis-db`, 18 `thesis-evidence`, 21 `thesis-ingest`, 14 `thesis-runtime`, 54 `thesis-search`, and 6 `thesis-server`. |
| 2026-09-25 | Warning-denied check | `env RUSTFLAGS=-Dwarnings cargo check --manifest-path backend/Cargo.toml --locked -p thesis-api -p thesis-server` | Passed. |
| 2026-09-25 | Strict Clippy | `cargo clippy --manifest-path backend/Cargo.toml --locked -p thesis-api -p thesis-server --all-targets -- -D warnings` | Passed. |
| 2026-09-25 | Focused API rustfmt | `rustfmt --edition 2021 --check backend/crates/thesis-api/src/news_cache.rs backend/crates/thesis-api/src/news_cache_tests.rs backend/crates/thesis-api/src/queue_digest.rs backend/crates/thesis-api/src/queue_digest_tests.rs`; `rustfmt --edition 2021 --check --config skip_children=true backend/crates/thesis-api/src/lib.rs` | Passed for all five files. |
| 2026-09-25 | B04 route tests | `cargo test --manifest-path backend/Cargo.toml --locked -p thesis-api debug_cache --lib` | 5 passed. |
| 2026-09-25 | Python contract/inventory pytest | `.venv/bin/pytest -q backend/tests/test_rust_reading_queue_contract.py backend/tests/test_openapi_compat_inventory.py` | 10 passed, 9 warnings. |
| 2026-09-25 | Operation inventory JSON | `python3 -m json.tool docs/agents/rust-openapi-operation-inventory.json >/dev/null` | Parsed successfully. |
| Before provider formatting | First workspace format | `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` | Failed only because `backend/crates/thesis-server/src/queue_digest_provider.rs` needed formatting. |
| After provider formatting | Focused provider rustfmt | `rustfmt --edition 2021 --check backend/crates/thesis-server/src/queue_digest_provider.rs` | Passed. |
| After provider formatting | Workspace format | `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` | Passed. |
| After provider formatting | Provider test | `cargo test --manifest-path backend/Cargo.toml --locked -p thesis-server queue_digest_provider` | 6 passed. |
| After provider formatting | Locked build | `cargo build --manifest-path backend/Cargo.toml --locked -p thesis-server` | Passed. |
| After provider formatting | OpenAPI generation and compatibility | `backend/target/debug/thesis-server --openapi > /tmp/thesis-rust-openapi-2026-09-25.json`; `python3 scripts/check_openapi_compat.py backend/openapi.json /tmp/thesis-rust-openapi-2026-09-25.json --operation-inventory docs/agents/rust-openapi-operation-inventory.json` | Matched all 106 migrated operations. |
| After B06 environment note | Initial Ruff command path | `.venv/bin/ruff check backend/tests/test_rust_reading_queue_contract.py`; `.venv/bin/ruff format --check backend/tests/test_rust_reading_queue_contract.py` | Could not start because repository-root `.venv/bin/ruff` is absent; the executable is `backend/.venv/bin/ruff`. |
| After B06 environment note | Initial Ruff check | `backend/.venv/bin/ruff check backend/tests/test_rust_reading_queue_contract.py` | Passed. |
| After B06 environment note | First Ruff format check | `backend/.venv/bin/ruff format --check backend/tests/test_rust_reading_queue_contract.py` | Reported that the test file would be reformatted. |
| After B06 environment note | Focused Ruff formatting | `backend/.venv/bin/ruff format backend/tests/test_rust_reading_queue_contract.py` | Reformatted one file. |
| After B06 environment note | Final Ruff format check | `backend/.venv/bin/ruff format --check backend/tests/test_rust_reading_queue_contract.py` | One file already formatted. |
| After test formatting | Final Ruff check | `backend/.venv/bin/ruff check backend/tests/test_rust_reading_queue_contract.py` | Passed. |
| After test formatting | Queue contract pytest | `.venv/bin/pytest -q backend/tests/test_rust_reading_queue_contract.py` | 7 passed, 9 warnings in 1.85s. |

## Root self-test

The root self-test ran under the 1,800-second watchdog and exited 1 after
107.369 seconds without a timeout. It invoked `bash ./verify.sh`; verification
stopped at the first repo quality-hardening command before Rust format, Clippy,
workspace tests, or OpenAPI gates. A diagnostic rerun of
`node scripts/quality-hardening.mjs verify --scope repo --json` exited 1 after
106.88 seconds, with `tracked_unchanged=true`, 19 checks, 13 passed, and six
failed. The failures were source line limits (1,098 files checked, 20 near, 10
over), dead code (18 unused response-schema exports, 13 unused exported types,
11 Knip hints), backend mypy (25 errors in 18 files), Ruff format (20 files),
one frontend test (206/207 passed), and backend tests (6 failed, 847 passed,
1 skipped, 4 deselected, 10 warnings). Measurement also reported two CCCC
violations and 141 code-multivitals violations. Oxlint had zero errors and
warnings, and TypeScript CRAP passed. Exact over-limit files and failing test
names are recorded in `docs/agent/known-errors.md`.

The B06 Python contract test, `backend/tests/test_rust_reading_queue_contract.py`,
received a local formatting repair after a focused Ruff format check reported
it needed formatting. Focused Ruff check and format checks passed afterward,
and `.venv/bin/pytest -q backend/tests/test_rust_reading_queue_contract.py`
passed 7 tests with 9 warnings. This local repair may address one file included
in the original repository-wide Ruff format result, but neither that result nor
the other failure classes was remeasured. The broad gate was not rerun, so no
repository-wide failure class is claimed cleared; the 20-file Ruff count
remains only the original diagnostic snapshot.

## Quality-hardening backlog applicability

I reviewed `docs/agent/lean-codebase-plan.md`. No quality-hardening backlog
item applied to migration B04/B06: this slice adds Rust shadow handlers and a
B06 Python inventory test only. It does not modify the FastAPI implementation,
Python typing or model formatting, frontend behavior, or the named failing
backend cases. FastAPI remains unchanged and public, so this work did not
trigger the frontend browser gate.

## Overall files changed

The B04/B06 implementation slice touched the paths below. Shared files retain
other migration work; this list is not permission to remove whole files.

### B04 cache debug

- `backend/crates/thesis-api/src/news_cache.rs`
- `backend/crates/thesis-api/src/news_cache_tests.rs` (shared with B02 cache tests)

### B06 queue digest

- `backend/crates/thesis-api/src/queue_digest.rs`
- `backend/crates/thesis-api/src/queue_digest_tests.rs`
- `backend/crates/thesis-server/src/queue_digest_provider.rs`

### Shared registration, contract, and inventory

- `backend/crates/thesis-api/src/lib.rs`
- `backend/crates/thesis-server/src/main.rs`
- `backend/crates/thesis-server/Cargo.toml`
- `backend/tests/test_rust_reading_queue_contract.py`
- `docs/agents/rust-openapi-operation-inventory.json`

### Documentation

- `docs/architecture/rust-backend-migration.md`
- `docs/agents/traces/rust-backend-migration-handoff.md`
- `docs/agent/test-catalog.md`
- `docs/agent/testing.md`
- `docs/agent/known-errors.md`
- `docs/agent/learnings.md`
- `docs/Log.md`
- `docs/agents/traces/rust-queue-digest-cache-debug-2026-09-25.md`

### Local process record

- `/home/bender/classwork/Thesis/papercuts.md`

The B06 environment documentation correction changed no application source. This
verification follow-up reformatted only the contract test file and changed no
application behavior.

## Process friction

Three papercut entries logged during this task are recorded in `/home/bender/classwork/Thesis/papercuts.md`:

- `Todo task start rejected a guessed task title`: the task-title attempt was
  rejected; a matching existing entry was not found before logging.
- `Hashline patch rejected stale documentation anchor`: a patch referenced an
  anchor that was not present in the displayed snapshot. The affected file was
  reread and the patch was then applied with a current anchor.
- `Requested .venv/bin/ruff path is absent at the repository root`: both initial
  commands could not start because Ruff is installed at
  `backend/.venv/bin/ruff`; rerunning the focused lint and format checks with
  that executable succeeded.

`papercut mine` was not run.

## Assumptions and limits

- The inventory counts operations, not public Rust cutovers. FastAPI remains
  the public implementation.
- B04 and B06 test counts describe isolated route/provider contracts, not
  production service parity.
- The repository self-test blocker list is the diagnostic report from this
  date; it was not repaired or rerun after the diagnosis.

## Risk and rollback

Risk tier: MEDIUM. The API/provider slice adds shadow routes and a provider
adapter. Rust remains shadow-only and FastAPI remains public.

Rollback only B04/B06-owned changes:

- Remove the B04 debug-cache handler and response schemas from
  `news_cache.rs`, the B04-only tests from `news_cache_tests.rs`, the B04 route
  registration in `lib.rs`, and the B04 operation row from the inventory.
  Preserve B02 cache code and tests in shared files.
- Remove the B06 queue-digest handler and route tests, provider adapter and
  provider tests, B06 route registration in `lib.rs`, provider setup in
  `main.rs`, and B06 dependency changes in `Cargo.toml`. Revert only the
  queue-digest additions in the Python queue contract test and inventory.
- Restore the documentation paths listed above if reverting this slice. Keep
  the user-requested entries in `papercuts.md`.
- Edit only owned hunks in shared files. Do not delete shared files, the Rust
  workspace, or other in-progress work.
