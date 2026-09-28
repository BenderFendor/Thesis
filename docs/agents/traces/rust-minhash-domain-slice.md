# Rust MinHash domain slice

## Goal and status

Move the existing Rust MinHash implementation out of the PyO3 crate into
`thesis-search`, preserve the Python extension contract, add useful property
and formal checks, and remove Python-only code with no production callers.

Slice complete. The broader Python-to-Rust backend migration remains in
progress.

## Changes

- Added `thesis-search::minhash` for shingles, signatures, similarity, pair
  detection, exact grouping, and connected duplicate components.
- Kept `minhash_duplicate_pairs` and `deduplicate_article_groups` as PyO3
  adapters with the existing argument and result shapes.
- Changed exact-text identity from MD5 keys to full text and changed pair-group
  merging to connected components. The first input ID is the stable component
  representative.
- Guarded `n == 0` shingling, which previously panicked.
- Removed `backend/app/services/minhash_dedup.py` after repository search found
  no production imports; its only caller was a test. Tests now use the Rust
  binding directly.
- Added proptest properties, Kani harnesses, a Verus ratio model, and Criterion
  benchmarks for signature generation, pair detection, and grouping.

## Verification

Passed:

- `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`
- `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings`
- `cargo test --manifest-path backend/Cargo.toml --workspace`: 95 tests
- `cargo kani --manifest-path backend/Cargo.toml -p thesis-evidence --default-unwind 4 --output-format terse`: 6 harnesses
- `cargo kani --manifest-path backend/Cargo.toml -p thesis-ingest --default-unwind 4 --output-format terse`: 2 harnesses
- `cargo kani --manifest-path backend/Cargo.toml -p thesis-search --default-unwind 4 --output-format terse`: 8 harnesses
- Four pinned Verus models: source host, evidence roots, alias spans, and MinHash count ratio
- `cd backend && .venv/bin/maturin develop --manifest-path rss_parser_rust/Cargo.toml --release --locked`
- `cd backend && .venv/bin/pytest -q tests/test_rust_algorithm_ports.py`: 6 passed
- `uvx ruff@0.15.22 check` and `format --check` on the changed Python binding and tests
- Criterion with 10 samples and a 2-second window on Rust 1.98.0-nightly, Ryzen 5 3600, Linux 6.18.45

The Criterion intervals were 489.60–506.17 µs for one 128-hash signature,
30.369–31.490 ms for pair detection over 64 articles, and 30.545–31.386 ms for
grouping. The two 64-article runs each reported two high outliers. This is an
initial Rust baseline only, not a comparison with Python.

## Failed approaches and corrections

- The first four-element symbolic Kani harness at default unwind 4 failed the
  loop-exit assertion. An explicit unwind override of 5 now covers the four
  iterations and exit check. The full search package then passed all eight
  harnesses. The three MinHash harnesses have no assumptions.
- The initial Verus ratio postconditions did not prove because the SMT solver
  needed nonlinear real arithmetic. The proof now states the nonnegative and
  positive-denominator facts for the nonlinear assertions. The model verifies
  for arbitrary natural-number counts and includes an exact-match witness.
- The former Python facade returned the requested threshold as the similarity
  score. The direct Rust binding returns the estimated score (0.7265625 for the
  near-duplicate fixture), so the boundary test checks the contract bounds and
  threshold instead of the facade's incorrect value.

## Limits and next steps

- There was no independent Python MinHash algorithm to use as a differential
  oracle; the Python facade already called Rust. The boundary tests use
  expected group semantics and score constraints.
- Kani checks four-element symbolic signatures, unequal fixed lengths, and an
  exact witness. It does not cover arbitrary lengths, text hashing, or group
  construction.
- Verus proves the mathematical count-ratio property, not refinement to Rust
  floating-point division. The connected-component implementation has regular
  unit and binding tests but no Kani or Verus proof.
- The benchmark has no pre-migration or Python comparison. It does not support
  a performance improvement claim.
- PyO3 remains until all Python consumers move to the Rust server or domain
  crates. RSS parser/fetcher migration and remaining algorithm adapters are
  outside this slice.

## Next executable check

Run `scripts/self-test`, review its first failing stage, and update this trace
with the exact result. Then consider a small mutation pass for MinHash grouping
and continue with another deterministic transform from the migration map.
