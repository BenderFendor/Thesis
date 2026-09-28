# Rust backend migration handoff

Updated 2026-09-25. Inventory parity is 106/178 operations (59.6%); 72 remain, and public listener cutover is 0%.

## Goal

Progressively move the deployed Thesis backend from Python to Rust. Preserve
observable API, database, worker, evidence, CLI, and frontend behavior. Keep
FastAPI as the public server until the Rust replacement passes the documented
contract, database, runtime, and client gates. The desired final backend is
about 99% Rust; Python may remain temporarily for the embedding HTTP sidecar.

## Current state

- Workspace root: `backend/Cargo.toml`.
- Workspace crates: `rss_parser_rust`, `thesis-ingest`, `thesis-search`,
  `thesis-evidence`, `thesis-db`, `thesis-runtime`, `thesis-api`, and
  `thesis-server`.
- `thesis-runtime` is a `no_std` pure protocol reducer crate and a dependency
  of `thesis-api`. `thesis-agent` and `thesis-observe` remain absent.
- Source-count proxy (2026-09-23): 65,926 Python runtime lines in 186 files
  and 11,010 Rust lines in 50 files, or 14.3% Rust by counted lines. These
  counts include tests and PyO3 adapters and do not measure semantic completion.
- The current Rust OpenAPI shadow matches 106 of 178 operations (59.6%); 72
  remain. FastAPI still handles public traffic, and listener cutover is 0%.
- Python still owns the scheduler, worker orchestration, ChromaDB integration,
  most persistence and routes, WebSockets/SSE, and the research agent. The
  Sentence Transformers service remains a temporary HTTP sidecar.

## Current shadow slices (2026-09-25)

The inventory contains 106 migrated operations out of 178 (59.6%), with 72
remaining. The public listener cutover is 0%; FastAPI still serves public
traffic. Current shadow slices include five B02 cached-news routes,
`GET /debug/cache/articles` in B04, and `POST /api/queue/digest` in B06.

The B04 route reads only its in-process `CacheStreamState`. The production
server creates the default empty state and does not configure a cache refresh
provider or share Python `NewsCache` data. The tests seed router-local state and
use a lazy database handle. They do not prove production cache parity.

The B06 Rust provider makes one reqwest attempt. FastAPI's OpenRouter and
llama.cpp clients use the OpenAI SDK default of two retries; the OpenCode client
sets `max_retries=0`. Adapter tests use local fixture servers, and route tests
inject a provider. No live external LLM call was made.

## Historical relationship slice (2026-09-23)

`GET /api/wiki/evidence/relationships` now runs on the Rust shadow listener.
SQLx reads the existing Alembic-managed schema. It keeps distinct `as_of` and
`known_at` filters, relationship direction, CSV predicate and either-side
entity filters, deterministic response order, claim IDs, and distinct evidence
root counts. PostgreSQL array binds avoid one bind per returned relationship
or claim. The Python implementation remains the behavior reference and the
public route owner.

Implementation and evidence:

- `backend/crates/thesis-db/src/relationships.rs`
- `backend/crates/thesis-api/src/relationships.rs`
- `backend/tests/test_rust_evidence_http_differential.py`
- `docs/agents/traces/rust-evidence-relationships.md`
- `docs/agents/formal-audit/verification-manifest.json`

The existing Python list route filters the relationship row by `known_at`, but
does not constrain linked evidence or lineage creation time. Rust preserves
that behavior. The differential fixture keeps linked evidence older than
`known_at`. A broader historical-evidence rule needs a separate domain
decision.

Rust chooses a reachable terminal lineage root when a cycle has one. Python's
recursive traversal can choose a cycle member based on traversal order. This
case has an independent Rust regression and is deliberately excluded from the
Python parity assertion. A symbolic Kani harness for the heap-backed traversal
ran longer than 90 seconds and was removed. No Kani or Verus proof is claimed
for that traversal or the SQLx/HTTP route.

### Historical ownership-interest shadow read (2026-09-23)

`GET /api/wiki/evidence/interest` was the seventh Rust shadow operation at
that checkpoint. The current inventory marks 106 operations migrated.
`thesis-evidence` supplies the exact finite-decimal kernel;
`thesis-db::ownership_interest` loads non-retracted `owns_equity_in` and
`directly_owns` rows from `accepted_relationships`, preferring `pct` over
`pct_band`; and `thesis-api::interest` provides query validation and OpenAPI
declarations. FastAPI remains the public route owner.
The verified scope cut removes the uncalled control-path graph from
`backend/crates/thesis-evidence/src/ownership.rs`, leaving 958 total / 955
production lines. The extracted `ownership_tests.rs` file is 130 lines. The
current slice remains exact interest arithmetic/SCC/path logic, behavior is
unchanged, and final post-cut verification passed.

Implementation and coverage:

- `backend/crates/thesis-evidence/src/ownership.rs`
- `backend/crates/thesis-evidence/src/ownership_tests.rs`
- `backend/crates/thesis-db/src/ownership_interest.rs`
- `backend/crates/thesis-api/src/interest.rs`
- `backend/tests/test_rust_evidence_http_differential.py`
- `docs/agents/formal-audit/verification-manifest.json`
The ownership-interest test split preserves behavior: `ownership.rs` is 958
total / 955 production lines, and `ownership_tests.rs` contains 130 lines.

The Python HTTP differential covers ownership chains, security-class and
economic/voting filters, cycles, overlaps, malformed qualifiers, and query
validation. The final rebuilt-server PostgreSQL differential passed one pytest
with four pre-existing deprecation warnings. The initial stale-binary Rust 404
occurred before the shadow server binary was rebuilt and is historical only;
the 2026-09-23 pass was the current ownership-interest verification result.

## Current verification evidence (2026-09-25)

The 2026-09-25 workspace run passed 247 tests: `rss_parser_rust` 34,
`thesis-api` 87, `thesis-db` 13, `thesis-evidence` 18, `thesis-ingest` 21,
`thesis-runtime` 14, `thesis-search` 54, and `thesis-server` 6.
The warning-denied API/server check passed. Strict Clippy passed for
`thesis-api` and `thesis-server` with `--all-targets` and `-D warnings`.
Python contract/inventory pytest passed 10 tests with 9 warnings, and the
inventory JSON parsed.

After the formatting-only change to
`backend/crates/thesis-server/src/queue_digest_provider.rs`, the focused
rustfmt and workspace-format checks passed. The provider suite passed six
tests; the locked server build and 106-operation OpenAPI comparison were rerun
and passed. The B04 `debug_cache` suite passed five tests.

The required root `scripts/self-test` exited 1 after 107.369 seconds without a
timeout. It stopped in the first `verify.sh` command,
`node scripts/quality-hardening.mjs verify --scope repo`, before Rust gates.
The direct JSON diagnostic exited 1 after 106.88 seconds with
`tracked_unchanged=true`: 19 checks, 13 passed and six failed. The failed
checks were source line limits, dead code, backend mypy, Ruff format, frontend
tests, and backend tests. Exact counts and test names are in
`docs/agent/known-errors.md`.

## Historical verification evidence (2026-09-23)

The seven-operation Rust shadow slice passed:

- `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`
- `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings`
- Focused `thesis-evidence`/`thesis-db`/`thesis-api` tests: 45 passed (18 thesis-api + 9 thesis-db + 18 thesis-evidence)
- `cargo test --manifest-path backend/Cargo.toml --workspace`: 149 passed (rss_parser_rust 34, api 18, db 9, evidence 18, ingest 16, search 54)
- `cargo build -p thesis-server`
- OpenAPI compatibility checker: all seven Rust operation IDs passed
- `bash backend/scripts/test_rust_http_differential.sh`: one pytest passed;
  four pre-existing deprecation warnings

Ownership-interest evidence includes exact finite-decimal arithmetic in
`thesis-evidence`, SQLx loading of non-retracted `owns_equity_in` and
`directly_owns` rows from `accepted_relationships` with `pct` preferred over
`pct_band`, and Axum validation/OpenAPI declarations. Malformed or
unquantified qualifiers are skipped; domain errors surface. FastAPI remains
the public route owner.

The final `scripts/self-test` exited 1 after 132.26s. The quality diagnostic
exited 1 after 127.668s with `tracked_unchanged=true` and 19 checks (13 passed,
6 failed). Source line limits checked 1050 files: 17 near and 2 over;
`ownership.rs` at 958 lines is near but no longer over, and the differential
test is no longer over. Other blockers are dead code with 13 unused exported
types, backend mypy failure, Ruff format required for 10 files, a frontend
Next App Router invariant failure, and the backend canonical article key
contract plus existing failures. These findings remain separate from the
passing direct Rust, OpenAPI, build, and HTTP differential evidence.

The initial stop-hook findings in `backend/app/core/logging.py` and
`backend/app/services/article_comparison.py` were fixed. The logging session
name now uses a UTC-aware timestamp converted to local time, preserving the
existing filename format. Entity deduplication now iterates with `.items()`.
Focused Ruff check/format passed for both files, and
`backend/tests/test_console_logging.py` plus
`backend/tests/test_rust_article_comparison.py` passed (4 tests).

## Historical relationship verification (2026-09-23)

The relationship implementation also passed its direct format, Clippy,
workspace, OpenAPI, and HTTP differential checks. Its earlier 130-test
checkpoint remains historical; the earlier full workspace total of 149 was
later superseded by a 247-test workspace run.

The three backend failures at that checkpoint were outside the relationship
and ownership-interest routes. The current repository findings are listed in
`docs/agent/known-errors.md`. Do not report the repository-wide self-test as
passing.

## Obsolete checkpoint (retained as history)

The first ownership-interest HTTP run seeded PostgreSQL but received Rust 404
before the shadow server binary was rebuilt. That stale-binary result was
superseded by the passing rebuilt-server differential above.


## Formal methods status

- The verification manifest records individual Kani and Verus scope,
  assumptions, bounds, and limitations for selected pure kernels in evidence,
  ingest, and search. Kani and Verus do not apply to SQLx or HTTP transport.
- Existing `docs/agents/formal-audit/Audit.lean` and TLA+ models cover selected
  audit, cache, ingestion, reporter, and research behavior. They are not Rust
  runtime specifications and do not prove Rust refinement.
- The formal-tool lookup for this slice found `tlc`, `lean`, `lake`, `verus`,
  and `cargo-kani` unavailable. Java exists, but `TLA_TOOLS_JAR` is unset and
  no repository TLA+ jar is present; no new formal model run was performed.
- The ownership model records proposed versus completed transactions,
  effective time, membership versus ownership, nonprofit operation, minority
  interests, evidence acceptance, conflicts, renames, and relation direction.
  Map rules to Rust functions without claiming refinement until a
  correspondence proof exists.
- Before reproducing scheduler or embedding behavior in Rust, keep modeling
  queue saturation, retries, stale generations, cancellation, shutdown,
  vector-write failures, leadership, and at-most-once tool/final results in
  TLA+. Use Loom after `thesis-runtime` gains synchronization primitives. The
  current crate contains pure no_std reducers, not live worker channels.

## Storage and workspace safety

- `backend/target`: 2.6 GiB after the latest Rust tests.
- `backend/logs`: 1.7 GiB; `runtime-data/logs`: 553 MiB; `log`: 6.2 MiB.
- Historical closed text logs are losslessly bundled at
  `backend/logs/.historical-log-files-20260923.tar.gz`. Keep it intact. Runtime
  JSONL remains plain because readers consume it directly.
- The worktree has extensive uncommitted migration and user-owned work,
  including `har/`. Do not reset, clean, or revert unrelated files. No commit
  was created for this work.

## Next session

1. Run `memo wake`, `scripts/agent-summary`, and read `AGENTS.md` plus the five
   repo-map/testing/workflow/known-error/learning docs required by `AGENTS.md`.
2. Read this handoff, `docs/architecture/rust-backend-migration.md`, and the
   verification manifest before editing.
3. Keep Alembic as the only schema authority during coexistence. Keep the
   Python embedding sidecar until a Rust model path passes quality, latency,
   and memory comparisons.
4. Review the exact current repository blockers in
   `docs/agent/known-errors.md` before selecting fixes. Do not weaken metrics,
   and do not change code outside the selected migration slice.
5. Treat ownership-interest transport evidence as complete for this shadow
   slice. Keep FastAPI public until every HTTP, SSE, WebSocket, database, and
   client contract is covered; select the next bounded domain slice only after
   the repository quality-gate blockers are tracked.
6. Update the migration map, testing guide, known errors, verification manifest,
   and a focused trace as evidence changes. Report exact proof scope and never
   describe the backend as formally verified as a whole.
