# Rust source-host identity slice

## Goal and status

Move source host normalization and matching into `thesis-ingest`, retain
Python-visible behavior through the existing PyO3 bridge, and verify the Rust
kernel against the prior Python rules. This slice is implemented. The broader
backend migration remains in progress.

## Boundary and decisions

- `thesis-ingest::source_url_guard` now owns `normalize_host` and `hosts_match`.
- Python `source_url_guard.py` keeps `urllib.parse`, Google News query
  extraction, URL-list handling, feed-prefix handling, and guard response
  construction.
- Existing callers include RSS validation, reporter verification, entity
  backfill, source research, and source claims. Their imports and return values
  remain unchanged.
- Matching preserves parent/subdomain rules, label boundaries, and configured
  BBC and Asia Plus families. Normalization mirrors Python trimming, lowercase,
  and `www.` removal.
- The source-host PyO3 functions can be removed after all Python callers move to
  Rust service code. The rest of `source_url_guard.py` remains until its URL
  parsing and response behavior move.
- No performance improvement is claimed or measured. URL parsing still crosses
  the Rust bridge only for host normalization/matching.

## Bugs and counterexamples

- Unicode differential testing found that Rust `str::trim()` and Python
  `str.strip()` disagree for U+001C through U+001F. Rust now includes those
  characters in its trim predicate; U+001F is a permanent regression case.
- Mutation testing changed the nonempty-host guard from `||` to `&&`. An empty
  host then matched an absolute trailing-dot hostname. Regression cases now
  cover both argument orders, and the mutant is caught.
- The first mutation run copied ignored nested Cargo targets and exhausted
  scratch space. Applying the repository's ignore rules with `--gitignore true`
  allowed the run to complete. The final run caught all six selected mutants.

## Formal scope

- The production byte-suffix helper has a Kani harness over a symbolic
  four-byte host with a two-byte suffix. The ingest Kani run passed two
  harnesses at default unwind 4, with no assumptions. This is bounded and does
  not prove arbitrary-length host matching.
- `backend/crates/thesis-ingest/verus/source_url_guard.rs` proves that, for
  arbitrary byte sequences, appending a domain matches only when a nonempty
  prefix ends with a dot. Verus reported `2 verified, 0 errors`. The file is an
  abstract model; no refinement relation to the Rust implementation is
  established.
- The Python differential and Rust proptests exercise the production helper
  and bridge. The pre-migration Python implementation exists only as a
  test-local reference.
- CI runs Kani and Verus in scheduled/manual jobs. Verus is pinned to
  `0.2026.09.20.aef82ed` and Rust `1.98.1`; the release archive SHA-256 is
  checked before extraction.

## Files changed

- `backend/crates/thesis-ingest/src/source_url_guard.rs`
- `backend/crates/thesis-ingest/verus/source_url_guard.rs`
- `backend/rss_parser_rust/src/source_url_guard.rs` and `src/lib.rs`
- `backend/app/services/source_url_guard.py`
- `backend/app/services/rss_parser_rust_bindings.py`
- `backend/tests/test_source_url_guard.py`
- `.github/workflows/rust-backend.yml`
- `docs/agents/formal-audit/verification-manifest.json`
- `docs/architecture/rust-backend-migration.md`
- `docs/agent/repo-map.md`, `docs/agent/testing.md`,
  `docs/agent/known-errors.md`, `docs/agent/learnings.md`, and `docs/Log.md`

## Verification

- `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`: passed.
- `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings`: passed.
- `cargo test --manifest-path backend/Cargo.toml --workspace --quiet`: 90
  passed, 0 failed.
- Release PyO3 bridge build with `maturin develop --release --locked`: passed.
- `backend/.venv/bin/pytest -q backend/tests/test_source_url_guard.py`: 8
  passed; one existing SQLAlchemy deprecation warning.
- Focused Ruff import/shebang review over the migration Python files and
  `scripts/check_openapi_compat.py`: passed. The OpenAPI checker has mode 755.
- Kani passed 5 evidence harnesses, 2 ingest harnesses, and 3 search harnesses
  at unwind 4, with no assumptions in the reported summaries.
- Verus verified the source-host model. This does not formally verify the Rust
  function.
- Selected cargo-mutants source-host run: 6 caught, 0 missed, 0 unviable, 0
  timed out.
- `git diff --check`: passed.
- Required `./scripts/self-test` exited 1 after 180.128 seconds at
  `verification repo: failed`; it stopped before its later gates. The focused
  Rust, differential, and formal checks above ran separately.

## Next executable step

Continue phase 2 with a neighboring deterministic source-guard rule. Keep
`urllib.parse` behavior as the compatibility boundary until a corpus compares
malformed URLs, query decoding, ports, IPv6 literals, and feed-prefix cases.
Expand the Verus proof set to stable general properties in the evidence and
ownership kernels, and keep each proof-to-code claim explicit in the manifest.
