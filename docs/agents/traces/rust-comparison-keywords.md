# Rust comparison keywords

## Goal and status

Move `article_comparison.py::extract_keywords` into `thesis-search` while
preserving token boundaries, stop words, frequency order, first-seen ties, and
Python `top_n` behavior. The Python service now calls the Rust function through
the existing PyO3 bridge. The FastAPI route and its OpenAPI contract remain
Python-owned, so this does not complete the HTTP route migration.

## Files changed

- `backend/crates/thesis-search/src/comparison_keywords.rs`: Rust extractor,
  three proptest properties, unit cases, and two Kani comparator harnesses.
- `backend/crates/thesis-search/verus/comparison_keyword_priority.rs`:
  independent natural-number priority model.
- `backend/crates/thesis-search/Cargo.toml`: pinned Unicode general-category
  data used to match Python word boundaries.
- `backend/rss_parser_rust/src/algorithms.rs` and `src/lib.rs`: PyO3 wrapper
  that passes the running Python Unicode version into the domain function.
- `backend/app/services/rss_parser_rust_bindings.py` and
  `backend/app/services/article_comparison.py`: Python boundary and service
  call site.
- `backend/tests/test_rust_comparison_keywords.py`: expected cases, generated
  Python reference differential, and FastAPI response-shape check.
- `.github/workflows/rust-backend.yml`, `docs/agent/testing.md`,
  `docs/agent/repo-map.md`, `docs/architecture/rust-backend-migration.md`,
  `docs/agents/formal-audit/verification-manifest.json`, and `docs/Log.md`:
  CI and verification records.

## Behavior and decisions

The Python service used `re.findall(r"\b[a-z]{3,}\b", text.lower())` followed
by `Counter.most_common(top_n)`. The Rust implementation uses an explicit
scanner because Rust regex word boundaries differ from Python for some Unicode
characters. It uses Unicode general categories and the PyO3 adapter reads
`unicodedata.unidata_version` to handle CJK Extension I in Python versions
that include Unicode 15.1. Nonpositive limits return an empty list; large
Python integers are clamped to the input byte length before crossing PyO3.

Before switching the service to Rust, a local differential checked 31,642
inputs against the original Python function under Python 3.13. It covered
reviewed strings, limits from negative through one million, 1,500 generated
Unicode inputs, Unicode category boundaries, and every CJK Extension I code
point. The comparison found and corrected differences for U+0130, U+0345, and
U+1C89. The committed Hypothesis differential uses a controlled vocabulary of
non-stopwords; explicit expected cases cover selected stop words and Unicode
boundaries. It is not a full replacement for the pre-cutover corpus run.

## Verification run

- `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`: passed.
- `cargo test --manifest-path backend/Cargo.toml --workspace`: 101 tests
  passed.
- `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets
  -- -D warnings`: passed.
- PyO3 rebuild with `maturin develop --manifest-path
  rss_parser_rust/Cargo.toml --locked`: passed.
- `pytest -q tests/test_rust_comparison_keywords.py`: four tests passed,
  including the generated Python reference differential.
- Ruff check and format for the service, binding, and boundary test: passed.
- Focused Kani run: two comparator harnesses passed with unwind 4 and no
  assumptions. The earlier full `thesis-search` run passed all ten harnesses.
- Pinned Verus 0.2026.09.20.aef82ed with Rust 1.98.1: five proof checks
  passed. The model proves priority direction, tie order, irreflexivity, and
  transitivity over natural numbers. It does not establish Rust refinement.

The Rust test suite and Python boundary check do not measure speed. This slice
has no performance baseline. The database is not involved. The FastAPI route
test checks the existing response shape and Rust-backed keyword values; no
OpenAPI route was added or changed.

## Next step

Move the full `/compare/articles` service and route into `thesis-api` only
after its entity heuristics, keyword comparison ordering, text similarity,
sentence diff, validation errors, and 500 response behavior have independent
fixtures and same-request differential coverage. Keep this PyO3 binding until
the Rust route owns the operation and no Python caller remains.
