# Rust country mention matching

## Goal and status

Move country alias indexing and matching into `thesis-search` while preserving
the existing Python import and PyO3 result shape. The matching core is now Rust.
The Python service still owns country labels, geo data, and PostgreSQL backfill.
No route or OpenAPI contract changed.

## Data flow and rules

`country_mentions.py` calls the established PyO3 functions. The adapter loads
`country_aliases.json`, stores an immutable `Arc<CountryAliases>` snapshot, and
replaces it under a write lock when reload is requested. Extraction clones the
current snapshot under a read lock, then scans without holding the lock.

`thesis-search::country_mentions::CountryAliases` owns matching and article text
composition. It returns sorted unique codes, retains every code for a shared
alias in exact and substring matches, preserves case rules for short acronyms,
and gives the longest token alias precedence over nested aliases. Aho-Corasick
patterns are deduplicated and sorted before index construction. A recognized
token alias records its byte span so a contained substring match cannot add a
false country. Title, summary, and content are joined in their existing order.

An accented uppercase regression exposed that ASCII case-insensitive substring
matching could add Guinea (`GN`) inside the full name República de Guinea
Ecuatorial (`GQ`). The span rule now returns only `GQ` for uppercase and title
case forms. A separate shared-substring case verifies that `American` still
returns both `MP` and `US` when embedded in a larger token.

## Verification

- `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` passed.
- `CARGO_TARGET_DIR=/tmp/thesis-workspace-target cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings` passed.
- `CARGO_TARGET_DIR=/tmp/thesis-workspace-target cargo test --manifest-path backend/Cargo.toml --workspace` passed all 84 tests.
- `cargo kani --manifest-path backend/Cargo.toml -p thesis-search --default-unwind 4` passed all three existing search harnesses. They use no `kani::assume`; these proofs cover ranking and Jaccard helpers, not country matching.
- Rebuilt the PyO3 extension with `maturin develop`; `tests/test_country_mentions.py` passed all six tests.
- Ruff 0.15.22 passed on `backend/tests/test_country_mentions.py`.
- The Rust matcher module grew from 397 to 412 lines for the indexed-pattern and span rules plus regressions. The repository quality hook reported CC 6 before and after, and cognitive complexity 10 before / 9 after. The current hook does not report MI or CRAP for this Rust file; the Python test file has Ruff 0 errors and warnings.
- The selected `cargo-mutants` run caught all 17 country matcher mutants with no exclusions. Its first run found that the interval-containment predicate lacked a partial-overlap assertion. Added that case and reran the full selection successfully.
- A one-off comparison generated 5,855 unique strings from checked-in aliases, each alias, its lowercase and uppercase forms, and a `Context ... context` form. Against one saved legacy run, 190 results differed across 48 base aliases. Differences include all-candidate results for shared names and removal of nested alias matches such as South Sudan inside South Sudanese, India inside British Indian Ocean Territory, and GN inside República de Guinea Ecuatorial.

The legacy matcher was nondeterministic for shared patterns: eight fresh runs of
the `American` input returned only `US` five times and only `MP` three times.
The 5,855-input comparison is therefore a reviewed behavior comparison, not a
strict parity pass. The old and new snapshots were kept under `/tmp` and are not
part of the repository.

The required `scripts/self-test` run exited 1 after 128.339 seconds in the
repository quality gate, before Rust and OpenAPI checks. Measurement
`qh-measure:35a61304d4c4e6b72c47a538` reports 141 code-multivitals violations,
CCCC 0, Oxlint 0 errors and warnings, and TypeScript CRAP 0. Direct Rust and
OpenAPI checks passed separately. The individual unrelated backend/frontend
test failures remain recorded in `docs/agent/known-errors.md`.

## Verification limits and next step

Kani was not applied to the heap-based regex/Aho-Corasick matcher. This slice has
no Loom or parser fuzz campaign. It moves an existing Rust matcher into its domain
crate and fixes correctness defects; no performance claim or benchmark is recorded.
The PyO3 bridge remains until ingestion and
persistence callers move to Rust. Keep the Python geo and backfill behavior at
its current boundary until corresponding SQLx operations and callers migrate.

The next country-specific step is to trace callers of the geo and backfill
functions, move their typed query/domain boundaries, and remove the PyO3 bridge
only when no production Python caller imports it.
