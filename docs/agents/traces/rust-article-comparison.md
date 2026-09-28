# Rust article comparison route

## Goal and status

Move `POST /compare/articles` into the Rust shadow server while preserving the
checked-in OpenAPI contract and observable response semantics. The Rust route
and domain implementation are in place. FastAPI remains the public listener.

## Implementation

- `thesis-search::article_comparison::compare_articles` now extracts and
  compares entities and keywords, computes title/content similarity and
  sentence diffs, rounds scores, and assembles the response.
- `thesis-api::comparison::post_compare_articles` serves the request from the
  Rust listener. It keeps FastAPI's two required content strings, default-empty
  titles, ignored extra keys, and 422 validation response schema.
- `rss_parser_rust` keeps thin PyO3 adapters over shared Rust similarity and
  sentence-diff functions. The existing Python service calls Rust keyword,
  similarity, and sentence-diff kernels; its entity extraction and response
  assembly remain Python code for compatibility and differential comparison.
- Rust orders entity outputs by first occurrence and applies stable keyword
  tie ordering. The Python reference's set-derived order is canonicalized in
  differential checks.
- `strsim` is no longer a direct dependency of `rss_parser_rust`; the
  comparison kernel uses it through `thesis-search`.

## Contracts and verification

- `backend/openapi.json` operation ID: `compare_two_articles_compare_articles_post`.
- Normalized OpenAPI comparison passed for evidence, ranking, and comparison.
- The full workspace passed 106 tests; strict Clippy passed for all members.
- `cargo test -p thesis-api`: 8 tests passed.
- `cargo test -p thesis-search -p rss_parser_rust`: 39 and 34 tests passed.
- Strict Clippy passed for `thesis-search` and `rss_parser_rust`.
- Kani passed `keyword_emphasis_tracks_frequency_order` at unwind 4 with no
  assumptions. It checks only the scalar frequency-to-emphasis rule.
- Proptest covers symmetric bounded text similarity and response summary
  counts against returned vectors. Fixed regressions cover whitespace and
  punctuation-only similarity, entity filters, exact sentence diffs, overlap
  boundaries, score thresholds, tie selection, and keyword deltas. These do not
  prove the complete entity or sentence algorithms.
- Verus passed three proof obligations in
  `comparison_entity_partition.rs`. It proves that three output sets are
  pairwise disjoint and reconstruct both arbitrary finite sets of normalized
  identity IDs, with no size bounds or assumptions. This model does not prove
  Rust string normalization, output ordering, or refinement.
- Mutation testing generated 30 comparison mutants. The 25 non-equivalent
  selected mutants were all caught; five empty-input guard changes were
  excluded after tracing the following control flow and arithmetic: two
  `compare_articles` guards, both `calculate_text_similarity` empty guards,
  and the `sentence_word_overlap` empty-set guard. The final run had no missed,
  timed-out, or unviable mutants.
- Rebuilt PyO3 service differential passed three fixed fixtures.
- The disposable PostgreSQL HTTP differential passed ten evidence requests,
  ten ranking requests, three valid comparison requests, four comparison
  model-validation requests, and two malformed-JSON checks. The comparison
  route itself does not query PostgreSQL; the test database is needed for the
  evidence routes and Rust server startup.
- The existing proof-suite registry, execution, corpus, and clean-room tests
  passed: 15 tests. Ruff passed for all 18 changed Python files.
- `scripts/self-test` exited 1 after 149.127 seconds in the repository quality
  gate. Its first failing command also exited 1 after 131.855 seconds with only
  `verification repo: failed`; details are recorded in
  `docs/agent/known-errors.md`. The Rust and API gates above ran separately.

The first malformed-JSON comparison exposed parser-specific differences:
Serde and Pydantic return different syntax text, offsets, and partial input
values. The test compares the common 422 status and `json_invalid` category for
these two cases. It still compares full JSON for missing and wrong-typed model
fields. These checks do not claim exact malformed-JSON diagnostic parity.

The Python service differential is not an independent oracle for the shared
Rust keyword, similarity, or sentence-diff kernels. It compares the remaining
Python entity and response assembly behavior against the complete Rust domain
on three fixed fixtures.

## Remaining work

- FastAPI still owns the public route. Keep the Python route and PyO3 bridge
  until production traffic switches and no Python caller needs these kernels.
- The new Verus model is an abstract domain model, not a proof of the Rust
  implementation. Kani covers only keyword-emphasis ordering; property tests
  and mutation checks cover selected comparison behavior.
- The malformed-JSON response diagnostics differ between parsers as described
  above.

## 2026-09-23 module split and lint follow-up

Split the 1,005-line facade into `article_comparison.rs` (311 lines),
`article_comparison/entities.rs` (312), `text.rs` (175), `tests.rs` (223), and
`kani.rs` (11). Public `article_comparison::*` re-exports remain available.
Moved the sentence-matching helpers into the test module where they are used
and documented the public text functions.

The stop-hook run had also reported unsorted imports in
`language_diagnostics.py`; Ruff fixed that import block. Follow-up checks passed:
Rust formatting, 54 `thesis-search` tests, strict Clippy for all targets, Ruff
check and format for the Python module, and `git diff --check`. The Kani harness
was rerun after the move with unwind 4: 0 of 28 checks failed and one harness
passed. Kani 0.68 emitted its standard unstable-feature warning for
`register_tool`; the proof verdict was successful.
