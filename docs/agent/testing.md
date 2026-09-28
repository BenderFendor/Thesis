# Testing And Verification

This page lists repository verification commands and focused-test boundaries.
Rust exposes 143/178 HTTP operations; 106 are parity-proven, 37 registered
but unverified, and 35 remain unregistered. Public listener cutover is 0%;
route presence alone is not parity.

## Preferred Command

- `scripts/self-test`

`scripts/self-test` uses `./verify.sh` as the strongest path when present.

## Current Commands

- setup command
  - `./runlocal.sh setup`
  - Environment keys: copy `backend/.env.example` to `backend/.env` and set required keys.

- test command
  - Full path: `./verify.sh`
  - Backend focused: `bash -lc 'cd backend && .venv/bin/pytest tests -m "not slow"'`
  - Frontend focused: `npm --prefix frontend test`

- lint command
  - Frontend: `npm --prefix frontend run lint` (the root `.oxlintrc.json` scans
    `frontend` and `scripts` with strict Oxlint categories)
  - Backend: `uvx ruff check backend/ --fix`

- test policy
  - `anti-slop/no-module-mocking` is a repo-wide Oxlint error. Application and
    test code must not use `jest.mock`, `vi.mock`, `doMock`, or
    `unstable_mockModule`.
  - Tests exercise the real components and implementation modules with real,
    typed inputs. Use explicit fetch/service/browser-boundary injection when a
    test needs deterministic I/O; do not replace an implementation with a mock
    module or mock component.
  - A fixture is acceptable only as representative input data at the boundary
    being tested. It must not replace the production component, transform, or
    service whose behavior the test claims to verify.
  - Verify the rule itself with `npm --prefix frontend run test:oxlint-rules`.
    Its rule fixtures are excluded from the application scan because they
    intentionally contain invalid examples.
  - The root `no-duplicate-imports` rule allows separate top-level type-only
    imports so TypeScript types stay out of the runtime bundle while value
    schema imports remain explicit.
  - The normal frontend behavior suite is
    `npm --prefix frontend test -- --runInBand`.

- typecheck command
  - Frontend: `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`
  - Backend: `bash -lc 'cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict'`

- build command
  - Frontend: `npm --prefix frontend run build`

## Rust Backend Migration

The Cargo workspace root is `backend/Cargo.toml`; `backend/Cargo.lock` is the
only Rust lockfile. The root `verify.sh` runs formatting, Clippy, workspace
tests, and an OpenAPI comparison for every operation marked `migrated: true`
in `docs/agents/rust-openapi-operation-inventory.json`.

72 pending rows (37 registered, 35 unregistered), distinct from migration
parity.


Dev and test profiles omit debug information and disable incremental
compilation to limit local build-cache growth. The workspace uses
`backend/target`; the old `backend/rss_parser_rust/target` directory is not an
additional workspace output directory. `cargo clean --manifest-path
backend/Cargo.toml` removes only these regenerable workspace artifacts when
disk space is needed; later checks rebuild them.

```bash
cargo fmt --manifest-path backend/Cargo.toml --all -- --check
cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml --workspace
cargo build --manifest-path backend/Cargo.toml -p thesis-server
cargo test --manifest-path backend/Cargo.toml -p thesis-funding-bias
cargo run --manifest-path backend/Cargo.toml -p thesis-funding-bias
cargo kani --manifest-path backend/Cargo.toml -p thesis-evidence --default-unwind 4
cargo kani --manifest-path backend/Cargo.toml -p thesis-ingest --default-unwind 4
cargo kani --manifest-path backend/Cargo.toml -p thesis-search --default-unwind 4
cargo kani --manifest-path backend/Cargo.toml -p thesis-search \
  --default-unwind 4 --harness comparison_keywords
cargo kani --manifest-path backend/Cargo.toml -p thesis-search \
  --default-unwind 4 --harness keyword_emphasis_tracks_frequency_order
cargo kani --manifest-path backend/Cargo.toml -p thesis-search \
  --default-unwind 1 --harness increasing_rate_never_reduces_diagnostic_severity
cargo kani --manifest-path backend/Cargo.toml -p thesis-search \
  --default-unwind 4 --harness symbolic_two_by_two_population_total_matches_the_cells_without_overflow
cargo kani --manifest-path backend/Cargo.toml \
  -p rss_parser_rust --default-unwind 4
cargo bench --manifest-path backend/Cargo.toml -p thesis-search --bench minhash
cargo bench --manifest-path backend/Cargo.toml -p thesis-search --bench funding_bias
cargo mutants --manifest-path backend/Cargo.toml \
  --package thesis-evidence --package thesis-search \
  --re '.*in (collect_evidence_facts|acceptance_reasons|decision_failures|review_failures|policy_failures|distinct_count|normalize_token|cap_score|stop_words_set|tokenize|article_keywords|source_key|has_real_image|priority_bucket|add_profile_weights|build_interest_profile|score_article|rank_articles)$' \
  --exclude-re 'replace \| with \^ in decision_failures|replace && with \|\| in score_article' \
  --jobs 2 --timeout 30
cargo mutants --manifest-path backend/Cargo.toml \
  --package thesis-search --file crates/thesis-search/src/country_mentions.rs \
  --re '.*in (new|extract|extract_article|build_article_text|add_alias|insert_alias|is_textual_alias|requires_exact_token_match|tokens|lowered_tokens|original_tokens|add_pattern_mentions|add_token_mentions|match_alias_at|is_inside_alias_range)$' \
  --jobs 2 --timeout 30
cargo mutants --manifest-path backend/Cargo.toml \
  --package thesis-search --file crates/thesis-search/src/article_comparison.rs \
  --re '.*in (compare_articles|calculate_text_similarity|generate_sentence_diff|best_sentence_match|sentence_word_overlap|extract_entities|entity_group|dedupe_entity_groups|compare_entity_group|compare_keywords|keyword_emphasis|round_decimal)$' \
  --exclude-re 'replace .. with && in compare_articles|replace .. with && in calculate_text_similarity|replace .. with && in sentence_word_overlap' \
  --timeout 30 --in-place
```

The scheduled/manual migration workflow pins cargo-mutants 27.1.0 and runs the
same focused function selection. The selector excludes XOR for OR across
disjoint failure bits and empty profile-key branches. Review `missed.txt`; a
passing Rust test suite does not establish that tests kill semantic mutations.
The country alias command runs as a separate scheduled mutation step; it has
no excluded mutations. Article comparison selects 25 mutations and all were
caught. It excludes five equivalent empty-input guards: two outer guards,
both text-similarity guards, and the empty-word-set overlap guard. Each has the
same result through following logic or is unreachable.

Rebuild the PyO3 bridge before the service-boundary differential test:

```bash
cd backend
.venv/bin/maturin develop --manifest-path rss_parser_rust/Cargo.toml --release --locked
.venv/bin/pytest -q tests/test_rust_evidence_differential.py
.venv/bin/pytest -q tests/test_extraction_image_flow.py tests/test_image_extraction.py
.venv/bin/pytest -q tests/test_rust_gdelt_boundary.py
.venv/bin/pytest -q tests/test_rust_gdelt_taxonomy.py tests/test_rust_gdelt_boundary.py
.venv/bin/pytest -q tests/test_rust_rank_boundary.py
.venv/bin/pytest -q tests/test_rust_topic_boundary.py tests/test_chroma_topics_fallback.py
.venv/bin/pytest -q tests/test_country_mentions.py
.venv/bin/pytest -q tests/test_source_url_guard.py
.venv/bin/pytest -q tests/test_rust_comparison_keywords.py
.venv/bin/pytest -q tests/test_rust_article_comparison.py
.venv/bin/pytest -q tests/test_rust_language_diagnostics.py
.venv/bin/pytest -q tests/test_language_diagnostics.py
```

The ingest Kani run checks three production kernels: CAMEO root normalization,
Goldstein thresholds, and source-host label boundaries. The CAMEO harness
checks symbolic four-byte inputs against a position-based reference and fixed
zero-, one-, and two-digit witnesses. It uses unwind 5 with no assumptions;
Kani reports one unreachable check in `core::fmt::Arguments::from_str`, outside
the normalization harness. The RSS/PyO3 crate Kani harness checks that the
production dot product of a three-element vector with itself is nonnegative
for symbolic `i8` components converted to finite `f64` values; it has no
assumptions and uses unwind 5 for its fixed loop. The search Kani run checks
eleven existing harnesses: two ranking kernels,
the rounded-Jaccard bound, two nested alias-span properties, and three MinHash
properties. The comparison-keyword extraction adds two harnesses for the
production frequency/first-seen comparator and its transitivity over symbolic
`usize` values. They use unwind 4 and no assumptions. The MinHash estimator
checks arbitrary four-element signatures with unwind override 5, unequal
lengths, and a perfect-match witness. The alias
proof has explicit ordered-range and containment assumptions plus a concrete
witness. These checks do not verify the complete clustering, group-merging, or
alias-discovery algorithms. A proptest property generates nested alias ranges
and checks transitivity through the production helper. Article comparison adds
a Kani harness for production keyword-emphasis ordering over symbolic `u16`
frequencies, with no assumptions at unwind 4. Its proptests check symmetric,
bounded text similarity and summary/list count consistency; they do not prove
entity extraction or the complete sentence-matching algorithm. The PyO3
service differential compares three fixed requests after canonicalizing the
Python set-order fields.

Language diagnostics adds a Kani harness showing that increasing an ordered
`f64` rate cannot lower either rate or overall severity; it has no assumptions
and passed 34 checks at unwind 1. The two Hypothesis differentials check Unicode
and generated-pattern text against the retained Python reference. This does not
verify the regex engine, phrase policy, or full text analyzer with Kani. Verus
adds no useful unbounded invariant to these bounded severity thresholds.
The complete `thesis-search` Kani run passed all 13 harnesses at default
unwind 4; the diagnostics harness also passed separately at unwind 1.

`thesis-ingest` Kani checks CAMEO normalization over a bounded arbitrary byte
array, Goldstein bucketing over arbitrary `f64`, and the source-host suffix
boundary over symbolic byte arrays. The CAMEO harness overrides unwind to 5
and has no assumptions. Its fixed witnesses cover no digits, one digit, and two
digits. Verus verifies the corresponding normalization contract over arbitrary
finite byte sequences, with no assumptions. This model does not prove Rust
refinement. Kani verifies six evidence harnesses at unwind 4, including the
production root-deduplication helper and a symbolic duplicate-root property.
Verus runs eight models: source-host label boundaries, CAMEO root normalization,
evidence-root set membership, transitive country-alias span containment, the
unbounded mathematical MinHash count-ratio bound, comparison-keyword priority,
article-comparison entity partitioning, and the non-degenerate Cramer's V
denominator guard. The entity model represents
normalized names as arbitrary finite sets of natural-number IDs and proves
that the shared and source-only groups are pairwise disjoint and reconstruct
each input set. It does not prove Rust string normalization, output order, or
refinement. The keyword model proves the natural-number priority relation, not
the Rust comparator's refinement or tokenization. The models specify domain
rules independently and do not establish Rust refinement. Run the new model locally
with the pinned verifier and toolchain. These commands assume the pinned Verus
binary is on `PATH`; CI installs the checksummed release and toolchain.

```sh
RUSTUP_TOOLCHAIN=1.98.1 verus backend/crates/thesis-search/verus/comparison_entity_partition.rs
RUSTUP_TOOLCHAIN=1.98.1 verus backend/crates/thesis-search/verus/funding_bias_guard.rs
```

CI pins Verus 0.2026.09.20.aef82ed and runs all selected Kani and Verus checks
for pull requests and main pushes, as well as scheduled/manual runs.

Run the CAMEO model from the repository root with the pinned toolchain:

```sh
RUSTUP_TOOLCHAIN=1.98.1 verus backend/crates/thesis-ingest/verus/cameo_root_normalization.rs
```

The initial MinHash Criterion baseline uses 10 samples and a 2-second
measurement window. It records signature generation, pair detection, and
grouping for 64 articles. The migration report includes the host and measured
intervals; it is not a comparison with Python.

The funding-bias Criterion suite measures a 20,000-pair table build and a
16x9 Cramer's V calculation over 100 samples. The latest run measured 3.3310 ms
for table construction and 758.34 ns for the statistic (median estimates).
These measurements do not compare Rust with Python.

The same-HTTP-request comparison checks evidence policies, claim reads,
relationship reads, evidence evaluation, personalized ranking, and
`POST /compare/articles` against FastAPI. It sorts linked observation arrays
because the Python query does not specify their order. Relationship cases use
fixed and distinct `as_of` and `known_at` values to check both time axes,
inclusive validity, exclusive retraction, status preservation, filters,
direction, claim ordering, root counts, and validation error locations and
categories. The comparison
cases cover three valid requests and four validation errors. To create a
disposable PostgreSQL cluster and run it locally, use:

```bash
backend/scripts/test_rust_http_differential.sh
```

The test inserts and removes uniquely named evidence fixture records. It never
uses the developer's configured database. The fast GitHub workflow provides a
PostgreSQL service and applies the existing Alembic migrations before running
the same test. It uses `uv` to create the focused Python environment and install
its dependencies.

### Historical 2026-09-23 seven-operation ownership-interest checkpoint

`GET /api/wiki/evidence/interest` is covered by the Python HTTP differential
fixture with chain, security-class, economic/voting, cycle, overlap, malformed
qualifier, and query-validation cases. The pure `thesis-evidence` kernel uses
exact finite-decimal arithmetic. The SQLx loader reads non-retracted
`owns_equity_in` and `directly_owns` rows from `accepted_relationships`,
preferring `pct` over `pct_band`; malformed or unquantified qualifiers are
skipped and domain errors surface. Axum owns query validation and the OpenAPI
declaration. FastAPI remains public and Rust is shadow-only.

At the 2026-09-23 checkpoint, focused `thesis-evidence`/`thesis-db`/`thesis-api`
tests passed 45 cases (18 api + 9 db + 18 evidence), and the full workspace
passed 149 tests (`rss_parser_rust` 34, api 18, db 9, evidence 18, ingest 16,
search 54). Both totals are historical and have been superseded by the later
247-test workspace pass. `cargo build -p thesis-server`, direct formatting,
strict Clippy, and the rebuilt-server HTTP differential passed. The
differential passed one pytest with four pre-existing deprecation warnings.
The initial stale-binary 404 is historical only.

The ownership-interest OpenAPI compatibility command is:

```bash
python3 scripts/check_openapi_compat.py backend/openapi.json <rust-openapi.json> \
  --operation-id get_ownership_interest_api_wiki_evidence_interest_get
```

### Inventory-driven OpenAPI compatibility

`verify.sh` generates Rust OpenAPI from `thesis-server`, then compares the
Python and Rust specs for every operation marked `migrated: true` in
`docs/agents/rust-openapi-operation-inventory.json`. Use repeated
`--operation-id` flags for a focused comparison.

From the repo root, run the checker with the inventory directly:

```bash
python3 scripts/check_openapi_compat.py backend/openapi.json <rust-openapi.json> \
  --operation-inventory docs/agents/rust-openapi-operation-inventory.json
```

The focused regression test runs the checker CLI against temporary JSON
specs and inventory data. It checks that pending rows do not affect the result,
and rejects an empty migrated ID or an inventory with no migrated IDs.

From the repo root, run the test with:

```bash
.venv/bin/pytest -q backend/tests/test_openapi_compat_inventory.py
```

### 2026-09-25 B04/B06 and inventory verification

The B04 `debug_cache` suite passed five tests. The B06 provider adapter suite
passed six tests. The 2026-09-25 workspace run passed 247 tests:
`rss_parser_rust` 34, `thesis-api` 87, `thesis-db` 13, `thesis-evidence` 18,
`thesis-ingest` 21, `thesis-runtime` 14, `thesis-search` 54, and
`thesis-server` 6. The warning-denied API/server check passed. Strict Clippy
passed for `thesis-api` and `thesis-server` with `--all-targets` and
`-D warnings`. Python contract/inventory pytest passed 10 tests with 9 warnings,
and the inventory JSON parsed.

After the formatting-only change to
`backend/crates/thesis-server/src/queue_digest_provider.rs`, focused rustfmt
and `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` passed.
The provider suite was rerun and passed six tests. The locked server build and
106-operation OpenAPI comparison were rerun and passed. FastAPI remains public
and Rust remains shadow-only.

### 2026-09-25 earlier root self-test observation

The watchdog-wrapped root `scripts/self-test` exited 1 after 107.369 seconds
without a timeout. It invoked `bash ./verify.sh` and stopped at the first
command, `node scripts/quality-hardening.mjs verify --scope repo`, which
reported `verification repo: failed`. Rust format, Clippy, workspace tests,
and OpenAPI gates in `verify.sh` were not reached.

A direct `--json` diagnostic rerun exited 1 after 106.88 seconds with
`tracked_unchanged=true`. Its 19 checks had 13 passes and six failures:

- Source line limits: 1,098 files checked, 20 near the limit, 10 over.
- Dead code: 18 unused response-schema exports, 13 unused exported types, and
  11 Knip configuration hints.
- Backend mypy: 25 errors in 18 files.
- Ruff format: 20 files need formatting; 376 are formatted.
- Frontend tests: 1 failure, 206/207 tests passed. The failing test is
  `__tests__/search-inline-edit.test.tsx::newsResearchPage inline editing`.
- Backend tests: 6 failures, 847 passed, 1 skipped, 4 deselected, and 10
  warnings. The failing test names are in `docs/agent/known-errors.md`.

The measurement reports two CCCC violations and 141 code-multivitals
violations. Oxlint reports zero errors and warnings; TypeScript CRAP passes.
No code was changed in response to this self-test.

### 2026-09-25 Rust gate and live shadow smoke follow-up

The single watchdog-wrapped `scripts/self-test` invocation for this integration
run exited 1 after 130.875 seconds in `node scripts/quality-hardening.mjs verify
--scope repo` (`verification repo: failed`), before Rust gates. A direct rerun
of that repository-quality command also exited 1 after 130.412 seconds with
the same output.

The remaining Rust checks were run separately: `cargo test --manifest-path
backend/Cargo.toml --workspace` passed; `cargo fmt --manifest-path
backend/Cargo.toml --all -- --check` passed after applying the workspace
formatter; strict workspace Clippy with `-D warnings` passed; and the generated
Rust OpenAPI contract matched all 106 migrated operations.

The disposable cluster at `/tmp/thesis-analytics-test.y0w6Eu/data` was started
on port 55438, and `thesis-server` was started on the existing loopback shadow
listener `127.0.0.1:8120`. `curl --include --silent --show-error --max-time 10
http://127.0.0.1:8120/api/verification/status` returned `HTTP/1.1 200 OK` with
`{"enabled":true,"max_duration_seconds":15,"max_claims":10,"max_sources_per_claim":5,"cache_ttl_hours":24,"recheck_threshold":0.4,"allowed_domains_count":23}`.
The Rust server and disposable database were stopped after the smoke; FastAPI's
public listener was unchanged.

### Historical 2026-09-23 self-test checkpoint

The final `scripts/self-test` exited 1 after 132.26 seconds at
`quality-hardening`, before the Rust gates. The quality diagnostic exited 1
after 127.668 seconds with `tracked_unchanged=true` and 19 checks (13 passed,
6 failed). Source-line limits checked 1050 files: 17 near and 2 over;
`ownership.rs` and the differential test are no longer over. Other blockers
were dead code with 13 unused exported types, backend mypy failure, Ruff
formatting required for 10 files, a frontend Next App Router invariant
failure, and backend canonical article-key plus existing failures. The Rust
gates were not reached.

- CLI parity commands
  - Typecheck: `npm run cli:typecheck`
  - Transport tests: `npm run cli:test`
  - Backend schema drift: `npm run cli:schema:check`
  - Real endpoint smoke: `./scripts/scoop api smoke <operation_id> --base-url http://127.0.0.1:8000`
  - WebSocket connect smoke: `./scripts/scoop ws listen <operation_id> --count 0`
  - Media investigation smoke: `./scripts/scoop investigate ownership CNN --max-depth 10`

- e2e command
  - TODO: no stable repo-local e2e command documented yet.

## Known Missing Checks

- No canonical root-level command for focused frontend unit-only pass besides npm scripts under `frontend/`.
- No canonical root-level command for focused backend lint-only/typecheck-only pass besides explicit shell commands.
- No codified Playwright e2e command.

## Known Environment Requirements

- Python environment under `backend/.venv` with requirements installed.
- `uv` and `uvx` available for Python tooling workflows.
- Node/npm installed for frontend checks.
- Rust toolchain available for the `backend/Cargo.toml` workspace checks.
- Optional but common local services: PostgreSQL and ChromaDB (via `runlocal.sh` flow).

## Failure Handling

- If `scripts/self-test` or `./verify.sh` fails, diagnose root cause before editing.
- Re-run the failed command after each fix.
- Re-run full `scripts/self-test` before final handoff.
- Record reusable failures in `docs/agent/known-errors.md`.
- For merge repairs, also run `rg -n '<<<<<<<|=======|>>>>>>>'` on touched files and `git diff --check`.
