# Kani and Verus coverage across current domain crates

## Goal and status

Use Kani on bounded production kernels across the current pure Rust domain
crates and use Verus for general mathematical properties that add coverage.
This verification slice is implemented. The backend migration remains active.

## Changes

- Added a symbolic Kani property for production evidence-root deduplication.
- Added an abstract Verus sequence model proving a duplicate qualifying root
  does not change root membership.
- Added a generated proptest for nested country-alias spans, a symbolic Kani
  transitivity harness, and a concrete witness for its assumptions.
- Added an abstract Verus proof of alias-span containment transitivity.
- Added a Kani harness for the production blindspot vector dot product in the
  existing PyO3 crate.
- Changed the Rust migration workflow so selected Kani and Verus checks run on
  pull requests and main pushes as well as scheduled/manual runs.
- Updated the verification manifest, architecture/testing docs, repo map,
  `AGENTS.md`, `docs/Log.md`, known-error notes, and learnings.

## Files changed

- `.github/workflows/rust-backend.yml`
- `AGENTS.md`
- `backend/crates/thesis-evidence/src/lib.rs`
- `backend/crates/thesis-evidence/verus/independent_roots.rs`
- `backend/crates/thesis-search/src/country_mentions.rs`
- `backend/crates/thesis-search/verus/alias_ranges.rs`
- `backend/rss_parser_rust/Cargo.toml`
- `backend/rss_parser_rust/src/blindspot.rs`
- `backend/app/services/source_url_guard.py` (Ruff formatting)
- `docs/Log.md`
- `docs/agent/known-errors.md`
- `docs/agent/learnings.md`
- `docs/agent/repo-map.md`
- `docs/agent/testing.md`
- `docs/agents/formal-audit/verification-manifest.json`
- `docs/architecture/rust-backend-migration.md`
- `docs/agents/traces/rust-formal-kernel-coverage.md`

## Verification

- `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`: passed.
- `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings`: passed.
- `cargo test --manifest-path backend/Cargo.toml --workspace --quiet`: 95 passed.
- `cargo kani --manifest-path backend/Cargo.toml -p thesis-evidence --default-unwind 4`: six harnesses passed, no assumptions.
- `cargo kani --manifest-path backend/Cargo.toml -p thesis-search --default-unwind 4`: eight harnesses passed, including three MinHash harnesses. The symbolic alias-span harness assumes ordered ranges and two nested containments; a second harness supplies a concrete reachable witness.
- `cargo kani --manifest-path backend/Cargo.toml -p rss_parser_rust --default-unwind 4 --output-format terse`: the crate's one harness passed, no assumptions; unwind 5 for a fixed three-element vector. Kani reported five unreachable checks and warned about unsupported caller-location and foreign-function constructs elsewhere in the crate.
- `cargo kani --manifest-path backend/Cargo.toml -p thesis-ingest --default-unwind 4`: two harnesses passed, no assumptions.
- Verus source-host model: 2 verified, 0 errors.
- Verus evidence-root model: 3 verified, 0 errors.
- Verus alias-span model: 2 verified, 0 errors.
- Verus MinHash ratio model: 5 verified, 0 errors.
- `backend/.venv/bin/pytest -q backend/tests/test_country_mentions.py backend/tests/test_source_url_guard.py`: 14 passed, one existing SQLAlchemy deprecation warning.
- Pinned Ruff check and format check over changed Python files: passed; 13 files formatted.
- All four Kani package runs passed: six evidence, two ingest, eight search, and one RSS harness (17 total).
- Workflow YAML parsed; CI runs four Kani packages and four Verus models on pull requests and main pushes.
- Verification manifest JSON parsed successfully.
- `git diff --check`: passed.

The Verus files specify domain models and have no formal refinement relation to
the executable Rust modules. Kani covers selected bounded kernels, not whole
crates. Regex/Aho-Corasick alias discovery, SQLx, Axum, and external I/O remain
outside these proofs.

## Repository self-test

The current `scripts/self-test` exited 1 after about 84 seconds at
`verification repo: failed`, before Cargo and OpenAPI checks. Measurement
`qh-measure:f17c217311a4c20265d88093` reports 141 Code Multivitals violations;
CCCC, Oxlint, and TypeScript CRAP pass with zero findings. The configured
quality scope excludes `backend/crates` and `backend/rss_parser_rust`, so the
Rust checks were run directly: format, strict Clippy, all 95 workspace tests,
and the RSS crate's Kani harness passed. Existing selected Kani and Verus
results are recorded above.

## Failed proof approach

The first evidence model represented roots with `Set::new`; Verus returned an
optional set because the predicate was not known to be finite. Replacing it
with existential sequence membership gave a direct finite-sequence
specification. The proof also uses `implies` in quantified assertions so the
antecedent is available inside the proof body.

An exploratory Kani harness for `thesis-db::lineage_root` compiled the SQLx
crate but did not finish symbolic checking after 90 seconds on a two-node
`HashMap`/`BTreeSet` graph. It was interrupted and removed; it is not a passing
proof. Keep this traversal under its cycle/multi-parent tests and PostgreSQL
differential until a fixed-size kernel can be connected to production without
duplicating the graph algorithm.

## Next executable step

Keep adding proofs at pure decision boundaries as Rust slices arrive. For each
proof, preserve the manifest entry, the exact assumptions and bounds, and a
test or correspondence check against the production function. Do not apply
Kani or Verus to SQLx, Axum, or heap-heavy algorithms where they cannot
meaningfully model the execution.

## Follow-up: CAMEO normalization and language diagnostics

- `thesis-ingest::gdelt_taxonomy::first_two_ascii_digits` now has a Kani harness
  over symbolic four-byte arrays, compared with a position-based reference. It
  passed at unwind 5 without assumptions; 0 of 330 checks failed and one
  standard-library formatting check was unreachable. Fixed witnesses cover no,
  one, and two ASCII digits.
- `thesis-ingest/verus/cameo_root_normalization.rs` passed five obligations over
  arbitrary finite byte sequences. It proves ordering, shape, no-digit,
  one-digit padding, and a reachable witness. It does not prove Rust refinement.
- `thesis-search::language_diagnostics::status_for_rate` and
  `status_for_score` now have a monotonicity Kani harness. The focused run passed
  34 checks at unwind 1 with no explicit assumptions. Regex matching and phrase
  selection remain outside formal verification.
- The full `thesis-search` Kani run passed 12/12 harnesses at default unwind 4.
  Kani reported unreachable checks in the alias-range and MinHash harnesses;
  those did not fail. The alias assumptions retain a separate reachable witness.
- The language-diagnostics production service now calls Rust through PyO3. The
  original Python implementation is retained as a differential oracle until
  independent captured cases replace it and the Rust HTTP route owns URL
  extraction as well as inline text.
- `RUSTUP_TOOLCHAIN=1.98.1 /tmp/thesis-verus-2026.09.20/verus-x86-linux/verus`
  checked all seven current models: 25 obligations verified, zero errors.
- Latest workspace checks: 121 Rust tests passed; formatting and strict Clippy
  passed. Focused Python service differential and endpoint tests passed 6/6.
- The required `scripts/self-test` exited 1 after about 118 seconds at
  `verification repo: failed`, before Rust and OpenAPI checks. Its wrapper gave
  no fresh issue census. Direct Rust, OpenAPI, and focused Python checks above
  passed; the repo-wide quality failure remains as documented in
  `docs/agent/known-errors.md`.
