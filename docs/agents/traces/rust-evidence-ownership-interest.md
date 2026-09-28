# Rust evidence ownership-interest trace
Goal: Record the seventh Rust shadow operation, `GET /api/wiki/evidence/interest`, without claiming public cutover or formal refinement.
Done criteria: Record the exact finite-decimal kernel, SQLx accepted_relationship loader, Axum route, compatibility and differential evidence, formal-tool availability, and remaining repository blockers.
Current status: Scope cut and final test extraction verified; behavior is unchanged and the current slice remains exact interest arithmetic/SCC/path logic.
Files changed: `backend/crates/thesis-evidence/src/ownership.rs`, `backend/crates/thesis-evidence/src/ownership_tests.rs`, `backend/crates/thesis-db/src/ownership_interest.rs`, `backend/crates/thesis-api/src/interest.rs`, and `backend/tests/test_rust_evidence_http_differential.py`; this trace and the handoff document them.
Commands/results: final post-cut focused Rust, fmt, Clippy, build, seven-operation OpenAPI compatibility, and rebuilt-server PostgreSQL differential passed; final self-test and quality diagnostic remain repository blockers.
Tests added: None in this documentation pass; final post-cut verification recorded 45 focused Rust tests (18 thesis-api + 9 thesis-db + 18 thesis-evidence), 149 workspace tests (rss_parser_rust 34, api 18, db 9, evidence 18, ingest 16, search 54), and one differential test with four deprecation warnings.

## Goal and done criteria

The goal was a bounded ownership-interest read on the Rust shadow listener. The
slice is complete when the pure arithmetic, database mapping, HTTP validation,
OpenAPI contract, and FastAPI/Axum request comparison are each recorded at their
actual boundary. Completion does not mean Rust owns public traffic or that the
repository-wide self-test is green.

## Status

The scope-cut shadow evidence is complete for shadow operation 7 of 7.
The uncalled control-path graph was removed from `ownership.rs`, leaving 958
total / 955 production lines; the extracted test file is 130 lines. Behavior
is unchanged and final post-cut verification passed. FastAPI remains public
and the Rust listener is shadow-only. The initial stale-binary 404 is retained
as historical context only and is superseded by the rebuilt-server differential
result.

## Implementation and behavior evidence

- `thesis-evidence` supplies exact finite-decimal ownership-interest arithmetic.
- `thesis-db::ownership_interest` loads non-retracted rows from
  `accepted_relationships` for `owns_equity_in` and `directly_owns`.
- Point `pct` is preferred over `pct_band`.
- Malformed or unquantified qualifiers are skipped; domain errors surface.
- `thesis-api::interest` supplies Axum query validation and OpenAPI
  declarations.
- The differential fixture covers ownership chains, security-class and
  economic/voting filters, cycles, overlaps, malformed qualifiers, and query
  validation.
- Current scope: `ownership.rs` is 958 total / 955 production lines; `ownership_tests.rs` contains the extracted 130 lines; behavior is unchanged and the current slice remains exact interest arithmetic/SCC/path logic.
- Test split: ownership-interest tests are extracted into `ownership_tests.rs`; no test behavior changed.
## Commands and evidence

- `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` — passed.
- `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings` — passed.
- Focused `thesis-evidence`/`thesis-db`/`thesis-api` tests — 45 passed (18 thesis-api + 9 thesis-db + 18 thesis-evidence).
- `cargo test --manifest-path backend/Cargo.toml --workspace` — 149 passed (rss_parser_rust 34, api 18, db 9, evidence 18, ingest 16, search 54).
- `cargo build -p thesis-server` — passed.
- OpenAPI compatibility checker — all seven Rust operation IDs passed.
- `bash backend/scripts/test_rust_http_differential.sh` — one pytest passed;
  four pre-existing deprecation warnings were emitted.
- Tests added: none in this documentation pass; the existing extracted focused Rust and PostgreSQL differential tests supplied the final post-cut verification evidence.

## Formal-methods lookup

The lookup for this slice found `tlc`, `lean`, `lake`, `verus`, and `cargo-kani`
unavailable. Java exists, but `TLA_TOOLS_JAR` is unset and no repository TLA+
jar is present. No new formal model run was performed. No Rust refinement proof
is claimed. Existing model and kernel evidence remains scoped to its own
artifacts and does not prove SQLx or HTTP behavior.

## Assumptions

- Alembic remains the schema authority during Python/Rust coexistence.
- The Python route remains the behavior reference and public route owner.
- The disposable PostgreSQL differential is the transport and SQL mapping
  evidence; focused kernel tests do not substitute for it.
- The four deprecation warnings from the differential are pre-existing and do
  not change the pass result.

## Risk tier

Medium. The operation is read-only and shadow-only, but ownership percentages,
qualifier handling, cycles, overlap flags, and query validation are domain
sensitive. Public cutover remains intentionally out of scope.

## Rollback

No source or schema rollback is required for this documentation slice. If the
shadow operation must be withdrawn, stop routing requests to the Rust shadow
listener and retain FastAPI as the sole public owner. Revert the associated
migration documentation and manifest entry together, preserving the historical
stale-binary note.

## Remaining blockers

The final `scripts/self-test` exited 1 after 132.26s. The quality diagnostic
exited 1 after 127.668s with `tracked_unchanged=true` and 19 checks (13 passed,
6 failed). Source line limits checked 1050 files: 17 near and 2 over;
`ownership.rs` at 958 lines is near but no longer over, and the differential
test is no longer over. Other blockers are dead code with 13 unused exported
types, backend mypy failure, Ruff format required for 10 files, a frontend
Next App Router invariant failure, and the backend canonical article key
contract plus existing failures. These findings remain separate from the
passing direct Rust, OpenAPI, build, and HTTP differential evidence.
