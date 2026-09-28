# Rust backend first slice

## Goal and done criteria

Implement one existing Python evidence-policy behavior through the Rust domain,
SQL, and HTTP layers while keeping the current API contract. The first slice
must have Rust tests, a meaningful property, a Kani proof, Python/Rust
differential checks, PostgreSQL-backed HTTP comparison, and a migration map.

## Status

The evidence evaluation operation is implemented in the workspace. Its Rust
listener is not public and does not proxy the other FastAPI routes. FastAPI
remains the application server. The shared Alembic schema remains authoritative.

Follow-up extractions moved HTML cleanup, article metadata/image extraction,
and the pure GDELT TSV/domain core into `thesis-ingest`. Existing Python-visible
PyO3 function names and normal result shape remain unchanged; malformed GDELT
dates now fall back to UTC epoch instead of slicing invalid UTF-8.

Personalized ranking and lexical topic logic now live in `thesis-search`;
PyO3 adapters remain for FastAPI callers. Axum also serves `/news/ranked` with
the checked-in OpenAPI contract and a same-request FastAPI differential. Topic
clusters now sort by feed position and article ID instead of hash iteration.
The Rust server remains shadow-only; it is not the public listener.

## Files changed

- Added the Cargo workspace and crates for evidence rules, SQLx access, Axum
  API, and server entrypoint.
- Added Python/Rust policy and HTTP differential tests.
- Added normalized OpenAPI comparison, verification manifest, migration report,
  repo-map and testing documentation, CI gates, and this trace.
- Moved release profile and lockfile ownership to the backend workspace root.
- Updated the Docker Rust builder to build the workspace PyO3 member.
- Moved `cleaner.rs` and `html_extract.rs` into `thesis-ingest`; the existing
  feed parser and PyO3 wrappers now use those shared functions.
- Moved pure GDELT TSV parsing and domain filtering into `thesis-ingest`; kept
  Python datetime/dict conversion in the existing PyO3 wrapper.
- Moved personalized ranking and topic clustering into `thesis-search`;
  retained PyO3 adapters and added an Axum route for ranking differential checks.
- Made topic cluster and member output order deterministic by feed position and
  article ID; added case/whitespace and keyword-bound property tests.
- Added exact evidence failure-bit/reason cases and ranking expectations for
  seeded scores, no-seed matches, tokenization, source identity, image markers,
  and score boundaries.
- Added `backend/scripts/test_rust_http_differential.sh` to create a disposable
  PostgreSQL cluster for evidence and ranking HTTP comparisons.

Existing edits to quality-hardening docs/scripts and the unrelated har/
directory were present before this task and were left untouched.

## Implementation and invariants

The route is POST /api/wiki/evidence/claims/evaluate. Axum calls
thesis-db::Database::load_claim_evidence, then the pure
thesis-evidence::evaluate_acceptance rule. The existing RSS PyO3 module calls
the same Rust policy for direct Python/Rust comparison.

The decision kernel requires reviewed and qualifying evidence, enough
independent roots, a complete control path where policy requires one, and
rejects catalog-only evidence when the predicate forbids it. SQLx derives roots
from the existing source_lineage table. Python compatibility includes its
Pydantic boolean coercion behavior.

Kani 0.68.0 / CBMC 6.11.0 verified five harnesses with --default-unwind 4.
There are no harness assumptions. The proof covers the scalar decision kernel
and root-count helper; it does not cover database access, HTTP, or full
String/Vec collection.

## Verification run

- Baseline Python evidence/OpenAPI/spine tests: 18 passed.
- Before extraction, the existing Rust RSS parser had 45 passing tests. The
  ingestion extraction left 42 there; moving topic tests left 38. At the
  first-slice checkpoint, the workspace had ten `thesis-ingest` and fifteen
  `thesis-search` tests.
- Rust workspace format and Clippy checks passed; the first-slice checkpoint
  passed all 78 workspace tests. Follow-on extraction work, including the
  country matcher, now brings the workspace to 84 tests; see
  `rust-country-mentions.md` for the latest country-boundary verification.
- Rust OpenAPI comparison passed for both the evidence operation and
  `POST /news/ranked`.
- Python/Rust policy differential: 34 policy rows and eight explicit cases
  passed after building the PyO3 extension.
- Evidence Kani: five harnesses passed at default unwind 4, no assumptions.
- Ingest Kani: one harness passed at default unwind 4 with no assumptions. It
  checks Goldstein threshold classification for arbitrary `f64` values.
- Search Kani: three harnesses passed at default unwind 4, no assumptions. Two
  prove ranking bucket encoding and score capping; the third proves rounded
  Jaccard stays within [0, 1] for valid symbolic `u8` overlap/union inputs with
  concrete zero and one witnesses.
- PostgreSQL HTTP differential: ten evidence requests and ten ranking requests
  matched status and JSON between FastAPI and Axum. The ranking cases include
  Pydantic integer coercion and 422 validation inputs. The local script created
  a disposable database, migrated through `20260720_0003`, and removed it.
- Focused Ruff check/format passed for the OpenAPI checker and the evidence,
  GDELT, ranking, and topic boundary tests. The topic and Chroma fallback
  suite passed eight tests after rebuilding the PyO3 extension.
- The focused Rust tests for the new assertions passed: seven
  `thesis-evidence` tests and fifteen `thesis-search` tests.
- cargo-mutants 27.1.0 caught all 118 selected mutants: 55 in
  `thesis-evidence` and 63 in ranking code under `thesis-search`. It excluded
  XOR-for-OR across disjoint evidence failure masks and two empty-profile-key
  `&&`-to-`||` variants. Topic clustering and Kani harnesses were outside this
  selection. The run used an isolated 388 KB temporary workspace and its own
  target directory.
- The rebuilt PyO3 extension passed the earlier 20-test GDELT/evidence and
  extraction/image suite, eight topic-boundary and Chroma fallback tests, and
  seven GDELT taxonomy/boundary tests after the respective core moves.
- The GDELT parser property generated missing-ID/missing-URL rows and limits
  from 0 through 24; accepted IDs remained ordered and output stayed within
  the requested limit.
- An eight-byte malformed SQLDATE containing a multibyte character now returns
  the UTC epoch through PyO3 instead of panicking on a UTF-8 byte boundary.
- The current `scripts/self-test` run exits in the repository quality gate.
  Its code-multivitals analyzer reports 141 findings; three unrelated backend
  tests and one frontend test also fail. The exact failures are recorded in
  `docs/agent/known-errors.md`.
- Existing proof-suite registry, runner execution, captured-corpus replay, and
  clean-room checks passed: 15 tests. CI runs these gates with the migration
  differential tests; the Python runner remains the truth reference until a
  Rust replay runner is implemented.

## Failed approaches

- A Kani harness that built owned evidence strings and vectors kept CBMC busy
  in allocator and string-library paths. It was interrupted and replaced by
  harnesses over the exact pure decision and deduplication helpers called by
  production.
- The first HTTP test run completed all request comparisons but then reused a
  closed httpx client for assertion-only requests. The assertions now run
  inside the client context; the full database differential passes.
- The first temporary PostgreSQL startup used the missing system socket
  directory. The isolated cluster now places its socket and lock file inside
  its own temporary directory. See papercuts.md.
- The first cargo-mutants attempt copied the checkout's runtime logs, Python
  environment, and Cargo targets until scratch storage filled. A later run
  shared `CARGO_TARGET_DIR`; its `Fresh` build logs showed that some mutants
  could reuse an unmutated artifact, so those results were discarded. The
  recorded mutation result uses an isolated scratch workspace without a shared
  target directory.

## Remaining risks and next executable step

- The public listener has not moved. Add explicit routing or proxy behavior
  only after all unmigrated HTTP, SSE, and WebSocket contracts are covered.
- Rust owns evidence evaluation, personalized ranking, and topic algorithms.
  FastAPI still owns topic orchestration and the remaining evidence-spine reads,
  mutation/materialization, ownership math, and Atlas.
- The PyO3 bridge is temporary while deployed Python code imports the RSS
  module. Remove it only after those callers move and the RSS corpus passes.
- The Python embedding worker remains a sidecar until a Rust-native model
  meets measured quality, latency, and memory requirements.
- The existing human-reviewed proof cases still need independent review status;
  the new differential suite does not replace that review gate.
- Next slice: move the full `/compare/articles` operation into `thesis-api`.
  Keep entity extraction, keyword comparison, similarity, sentence diff,
  validation, and error-response parity as separate review points. The
  comparison keyword core has moved, but the route remains FastAPI-owned; see
  `rust-comparison-keywords.md`. Keep the RSS corpus comparison as the cutover
  gate for later parser/fetcher work.
