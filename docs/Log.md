Warning: truncated output (original token count: 62110)
Total output lines: 3039

# Log

Current (2026-09-29): Rust exposes 143/178 HTTP operations (106 parity-proven,
37 registered but unverified; 35 unregistered). Public cutovers: 0.
B04 `GET /debug/startup` and `GET /debug/database/articles` are registered
shadows. B16 proof download remains unregistered because the workspace lock
lacks a ZIP writer and Cargo resolution/runtime verification are gated.
FastAPI remains public; Rust parity/runtime proof is open. Rust discovery's
Unicode-number parity gap remains unresolved.

## 2026-09-29: T13 B14 wiki index-status nullable status

The live inventory has no eligible `rust_registered:false` B13/B14 read: B13
analytics depend on live Chroma data or unavailable write/persistence paths,
and the B14 false rows are provider-backed index writes. Under the requested
fallback, this slice fixes the already root-registered B14 read
`GET /api/wiki/index/status`, using the existing
`Database::wiki_index_entries` API. Its inventory flags remain
`rust_registered:true` and `migrated:false`.

The tracked SQLAlchemy model declares `id` as an `Integer` primary key and
`status` as `Column(String, default="pending")` without `nullable=False`, so
explicit SQL `NULL` is valid. FastAPI's response model requires `dict[str, int]`;
a null status key fails response validation with HTTP 500. Rust previously
coerced it to `""` via `unwrap_or_default()`; it now returns 500 instead.
Added a seeded HTTP differential for successful grouped counts and the null
status failure. It was not run under the no-Rust-runtime gate.

Scoped Rustfmt and Ruff format checks passed. No Cargo/Rust tests, build,
Clippy, self-test, server, curl, or Rust runtime was run. FastAPI remains public.
See `.agent/traces/rust-wiki-index-status-2026-09-29.md` for the scoped
worksheet and exact verification status.

## 2026-09-29: Register B04 database-articles debug route

Registered `GET /debug/database/articles` on the always-mounted root router.
It reads through the root `AppState`'s production `Database`, honors the
configured database-enabled flag, and no longer depends on the optional
`DebugRuntimeProvider` or debug sidecar.
This is the existing handler's sole mounted HTTP path; the optional debug
router's ChromaDB, cache-delta, and storage-drift routes remain unchanged.

Added source tests for default-root availability and validation ordering,
disabled-database behavior, the FastAPI-compatible `ENABLE_DATABASE` values,
query names/defaults and response schema, and Pydantic boolean parsing
including whitespace rejection without lowercasing allocation. Added a seeded
PostgreSQL HTTP differential test for filtering, ordering, pagination,
inclusive date bounds, defaults, and validation.
Scoped `rustfmt --edition 2021 --config skip_children=true --check` passed for
`backend/crates/thesis-api/src/lib.rs` and
`backend/crates/thesis-api/src/debug/articles.rs`.
`backend/.venv/bin/ruff format --check backend/tests/test_rust_evidence_http_differential.py`
passed after formatting only that test file.

The inventory remains `migrated:false`; tests and Rust runtime were not run
under the no-Cargo gate. FastAPI remains public.
See `.agent/traces/rust-debug-database-articles-2026-09-29.md`.

## 2026-09-29: Rust debug startup route and evidence-proof blocker

Registered `GET /debug/startup` in the always-mounted Rust router with the
shared `ProfilingState`; removed only that path from the optional debug router.
FastAPI includes `debug.router` unconditionally and has no debug-mode guard on
the startup handler. Provider-backed debug routes remain optional, while
`/debug/database/articles` is a separate root-mounted exception. The route stays
`migrated:false`.

Added source tests for startup-state projection and default route availability,
the `/debug/streams` route remaining absent without debug config, and the
FastAPI success-only OpenAPI response.

The final scoped `rustfmt --edition 2021 --config skip_children=true --check`
passed for the three owned Rust source files.

Cargo/Rust tests, build, and HTTP runtime were not run under the hard gate.
FastAPI remains public.

B16 proof download remains `rust_registered:false`: `backend/Cargo.lock` has no
`zip`, `async_zip`, or `zip_next` writer, and adding/resolving a real archive
dependency plus runtime verification is unavailable under the no-Cargo gate.
See `.agent/traces/rust-debug-startup-2026-09-29.md`.

## 2026-09-28 — Rust funding-bias analysis slice

Added `thesis-funding-bias`, a standalone Rust CLI that loads the checked-in
RSS catalog, resolves accepted evidence claims before legacy metadata and
catalog values through SQLx, computes the sorted contingency table and
Cramer's V with `thesis-search`, locks a v2 methodology preregistration, and
persists an idempotent calculation trace. It does not call Python. The v1
FastAPI compatibility and startup-scheduler path remains in place until its
caller and public endpoint pass the Rust cutover gates.

Focused tests passed (4 runner, 59 search, and 2 attribute-resolution tests);
the full `thesis-search` Kani suite passed 13/13 at unwind 4; Verus passed 9
obligations; focused strict Clippy and workspace formatting passed. Criterion
(100 samples) measured 3.3310 ms for 20,000-pair table construction and
758.34 ns for Cramer's V on a 16x9 table. No Python performance comparison is
claimed.

No live PostgreSQL or Python differential run was available in this
environment. `scripts/self-test` stops in `verify.sh` because the Node package
`code-multivitals` is not installed. FastAPI remains public and the scheduled
caller for the Rust runner is still outstanding.

## 2026-09-27: Rust Atlas export shadow route

Registered `POST /api/wiki/atlas/export` in `wiki_atlas::router` and central
`ApiDoc`. The handler uses the existing graph projection and supports JSON,
entities CSV, relationships CSV, and evidence CSV. The inventory row is
`rust_registered:true` and remains `migrated:false`; FastAPI remains public.
Ten source tests and the central OpenAPI regression were added but not run.
Standalone rustfmt passed. The bounded localhost attempt used
`limit_nodes=1`, `limit_edges=1`, JSON, and `include_evidence=false`; curl exit 7
reported no listener on port 8000, so no response or wire parity was observed.
No Cargo command or Rust runtime request was run.

## 2026-09-29: Rust Atlas stats shadow route

Registered `GET /api/wiki/atlas/stats` in `wiki_atlas::router` and central
`ApiDoc`. The handler reuses the Atlas graph projection and response builder
with all four entity types, no node cap, and the 2,500-edge cap. Its five-minute
cache checks the completed `auto_ingest/atlas_pipeline` marker on each request,
so a successful network-bound run invalidates the cached response. The inventory
row is `rust_registered:true` and remains `migrated:false`; FastAPI remains public.

Three focused source tests and the central OpenAPI response-schema assertion were
added but not run. Standalone rustfmt passed. Cargo tests/build/Clippy/self-test,
HTTP runtime, and FastAPI parity remain unverified under the closed Rust gate.
Paired trace: `.agent/traces/rust-atlas-stats-2026-09-29.md`.

## 2026-09-29: Rust evidence claim materialization shadow route

Registered `POST /api/wiki/evidence/claims/{claim_id}/materialize` in the root
router and central `ApiDoc`. The handler reuses `Database::materialize_claim`,
checks the required reviewer and `SCOOP_MATERIALIZE_TOKEN`, and reloads the exact
relationship through the existing relationship query. A success audit log
records the claim ID, reviewer, and relationship ID; it never records the token.
The inventory row is `rust_registered:true` and remains `migrated:false`; FastAPI
remains the public owner.

Three focused source tests and the central OpenAPI contract assertions were
added but not run. Standalone rustfmt passed. Cargo tests/build/Clippy/self-test,
HTTP runtime, and FastAPI parity remain unverified under the closed Rust gate.
Transaction-boundary parity is an unresolved risk: FastAPI `get_db` commits only
after the handler returns and rolls back exceptions, but Rust commits before
relationship reload/response conversion. A later failure can return 500/422
after persisting the write. On conflict,
`backend/crates/thesis-db/src/atlas_materialization.rs:701-715` commits an
adjudication item before returning `EvidenceSpine`; Rust returns 422 with the
item persisted while FastAPI rolls it back. `thesis-db` edits are out of scope,
so this shadow remains `migrated:false` and FastAPI remains public.

Paired trace: `.agent/traces/rust-evidence-claim-materialize-2026-09-29.md`.

## 2026-09-27: Rust Atlas graph and entity-connections shadow routes

Registered `GET /api/wiki/atlas/graph` and
`GET /api/wiki/atlas/entities/{entity_id}/connections` in `wiki_atlas::router`
and central `ApiDoc`. Both inventory rows are `rust_registered:true` and remain
`migrated:false`; FastAPI remains public. The graph annotations declare 200 and
422 responses; the connection annotations declare 200, 404, and 500 responses.
Existing source tests cover graph projection and connection selection/order,
but not handler HTTP behavior, database errors, or FastAPI parity. No Cargo test,
build, or runtime request was run for this registration.

## 2026-09-27: Rust Atlas search shadow route

Registered `GET /api/wiki/atlas/search` in `wiki_atlas::router` and central
`ApiDoc`. The handler projects the seven contract fields and retains Pydantic
defaults for the remaining response fields. The inventory row is
`rust_registered:true` and remains `migrated:false`; FastAPI remains public.
Six focused search test sources cover ranking, metadata, per-type limits,
response defaults, and query/limit boundaries. They were not run and do not
verify HTTP handling, database loading, populated projection, or FastAPI parity.
No Cargo command, build, or runtime request was run for this registration.

## 2026-09-27: Rust Atlas index shadow route

Registered `GET /api/wiki/atlas/index` in `wiki_atlas::router` and central
`ApiDoc`. The inventory row is `rust_registered:true` and remains
`migrated:false`; FastAPI remains public. The handler reuses the Atlas graph
projection and shared query parser, preserves graph-backed search, builds kind
facets before kind filtering, and computes the other facets after kind filtering but before pagination.
The central OpenAPI regression asserts the index operation ID and 200/422
responses. It now also asserts Atlas export's operation ID, 200/422 responses,
and `AtlasExportRequest` request schema.

Ten focused source tests cover all sort orders and stable ties, kind/facet
boundaries, graph query matching, pagination/cursor boundaries, cursor parsing,
and query bounds. A Python stdlib probe of the current `_decode_cursor`
confirmed `M=Q` returns 1, `MQ===ignored` falls back to 0, and raw or decoded
non-ASCII cursors fall back to 0. The ten Rust tests and OpenAPI test were not
run. Rustfmt passed; no Cargo command, build, or HTTP request was run because
the shared Cargo lock gate is closed. Handler/database behavior and FastAPI
parity remain unverified; see `.agent/traces/rust-atlas-index-2026-09-27.md`.

## 2026-09-26: Rust Atlas media-measurements shadow route

Registered `GET /api/wiki/atlas/analysis/media-measurements` in the Atlas
router and central `ApiDoc`. The handler loads the shared Atlas media DTO,
computes six versioned traces, and uses idempotent conflict-ignore persistence.
The inventory row remains `migrated:false` with `database_write` under normal
risk; FastAPI remains public and parity is unverified.

Seven focused regression tests cover six-trace values and stable IDs, static
source-scoped and full-corpus calculation inputs, empty-source echo,
empty-corpus denominators, numeric-key and raw-author-order hash behavior,
movement order, query-parser limits, and Python tag-list truthiness. They do
not exercise SQL loading/filtering, persistence, HTTP behavior, or parity.
Rustfmt passes; Cargo tests, typecheck, build, and runtime requests remain
unverified because the shared Cargo lock gate is closed. See
`.agent/traces/rust-atlas-media-measurements.md` for scoped metrics and limits.

## 2026-09-26: Rust discovery parity handoff

Source-only review of `backend/crates/thesis-server/src/providers/discovery.rs`
records canonical lexical clustering for trending, breaking, all-cluster
snapshots, and fallback detail; Chroma heartbeat gating for trending, breaking,
and stats; the narrower FastAPI fallback article projection; and lineage article
edges from the earliest article (n−1 edges). The stats fallback preserves
`breaking_window_hours: 3`. The lineage route test serializes fixture rows after
lexical detail fallback. See `docs/agent/test-catalog.md` for the five test names
and the module command.

Cargo tests remain unexecuted because the lock gate is closed. RustDiscovery
reported a scoped formatter check and a Python regex probe; neither was rerun for
this source-only review. The probe returned
`{'中10文': [], '10文': [], '中10': [], '١٢': ['١٢'], 'س١٢': []}`. Source
inspection predicts the ASCII-byte Rust helper emits `10` for the three CJK-
adjacent inputs and no match for Arabic-Indic digits; this remains an unresolved
parity risk, not a Rust runtime result.


## 2026-09-25: Register Rust research, verification, analytics and wiki shadows

Mounted the B07 research routes; B12 mounts only status/domain reads (2/6).
B13 adds the three GDELT reads and Blindspot viewer (4/10); GDELT sync and
five remaining Blindspot operations stay unregistered. B14-B16 register 10/22
wiki, Atlas, and evidence reads. All remain `migrated:false`. Rust route presence
is tracked separately from parity; FastAPI remains public.

The B13 database regression proves the pre-limit top-10 ordering retains an
unmatched NULL group; one null group consuming a slot leaves nine matched groups,
while the count-2 article remains ranked first. The reporter dossier exposes
stored profile plus latest 20 articles; optional activity, career, and employer
enrichments remain unavailable. Debug-log path error handling now uses a small
error enum while preserving existing response bodies.

The API crate passed 140 tests. SQLx analytics tests passed 2/2 on a disposable
PostgreSQL cluster. Strict Clippy passed for `thesis-api` and `thesis-db`, all
targets, with `-D warnings`. FastAPI remains the public listener.

## 2026-09-25: Add B04 cache-debug and B06 queue-digest shadows

The current migration inventory contains 106 of 178 operations (59.6%), with
72 remaining and zero public cutovers. Current shadow slices are B02's five
cached-news routes, B04 `GET /debug/cache/articles`, and B06
`POST /api/queue/digest`. FastAPI remains public.

B04 adds five route tests for exact source filtering, cache-order pagination,
nullable article projection, invalid page bounds, malformed cached records,
and the exact OpenAPI contract. The route reads process-local cache state.
Production starts with the default empty state, without a refresh provider or
shared Python `NewsCache`; the seeded route tests do not establish live cache
parity or database/RSS behavior.

B06 adds nine route tests, six provider-adapter tests with a local fixture
server, and a Python contract suite covering 19 queue operations. The route
tests inject a provider. Rust sends one provider request without retries;
FastAPI OpenRouter and llama.cpp retain the SDK default of two retries, while
OpenCode sets retries to zero. No live external LLM call was made. These tests
do not establish provider availability, completion quality, or retry parity.

The scoped Rust verification on 2026-09-25 passed formatting, all six focused
provider tests, a locked `thesis-server` build, and the OpenAPI comparison for
106 operations.

The 2026-09-25 full workspace run passed 247 tests: 34 `rss_parser_rust`, 87
`thesis-api`, 13 `thesis-db`, 18 `thesis-evidence`, 21 `thesis-ingest`, 14
`thesis-runtime`, 54 `thesis-search`, and 6 `thesis-server`. The 2026-09-25
root self-test exited 1 at the repository quality-hardening stage before Rust
format, Clippy, workspace tests, or OpenAPI gates. Its exact blockers are
recorded in `docs/agent/known-errors.md`.

## 2026-09-23 — Add Rust ownership-interest shadow slice

Added the `GET /api/wiki/evidence/interest` Rust shadow slice. The
`thesis-evidence` kernel uses exact finite-decimal arithmetic; the SQLx loader
reads non-retracted `owns_equity_in` and `directly_owns` rows from
`accepted_relationships`, preferring `pct` over `pct_band`. Malformed or
unquantified qualifiers are skipped and domain errors surface. Axum owns query
validation and OpenAPI declarations. FastAPI remains public and Rust remains
shadow-only.

Focused Rust tests passed 45 cases (18 `thesis-api`, 9 `thesis-db`, and 18
`thesis-evidence`), and the workspace passed 149 tests (34 `rss_parser_rust`,
18 `api`, 9 `db`, 18 `evidence`, 16 `ingest`, and 54 `search`). Formatting
and strict Clippy passed, `cargo build -p thesis-server` passed, and the
OpenAPI checker passed all seven Rust operation IDs. The rebuilt-server HTTP
differential passed one pytest with four pre-existing deprecation warnings. The
initial stale-binary 404 is retained only as history. No new formal model run
or Rust refinement proof is claimed.

## 2026-09-23: Rust evidence policy and claim-read routes

Added shadow Rust routes for evidence policies and claim details. SQLx reads
typed claim and observation records from the existing Alembic schema. The
OpenAPI comparison and disposable PostgreSQL HTTP differential pass; the
claim-read contract preserves nullable JSON, enum values, the runtime 404, and
the Python route's unspecified observation order. FastAPI remains public.
Details and scope limits are recorded in
`docs/agents/traces/rust-evidence-http-read.md`.

## 2026-09-23: Move MinHash into thesis-search

Moved MinHash signatures, similarity, and duplicate grouping from the PyO3
crate into `thesis-search`; kept the Python extension function shapes as thin
adapters. Exact-text identity now uses the text itself, so a digest collision
cannot merge unrelated articles. Near-duplicate links now merge connected
groups. Removed `minhash_dedup.py` after confirming it had no production
callers; Python boundary tests call the Rust functions directly. The former
facade also returned the requested threshold as the pair score; the Rust
binding returns the estimated similarity. Kani checks
the production similarity estimator, Verus proves the unbounded mathematical
count-ratio bound, and proptest checks signature normalization, symmetry, and
range. Criterion recorded initial Rust timings for signatures and 64-article
pair/group operations; this is not a Python speed comparison. Verification
details and model limits are in the migration trace and formal manifest.

## 2026-09-23: Move country alias matching into thesis-search

Moved country alias indexing and matching into `thesis-search`; the existing
PyO3 function names remain available to Python callers. Reload now swaps an
immutable alias snapshot. Longest token aliases suppress nested matches, including
uppercase accented country names. Aho-Corasick patterns are deduplicated and retain
all candidate codes for shared substring matches.
The rebuilt bridge passed six country service tests. The full Rust workspace passed
84 tests with strict Clippy. The legacy snapshot comparison covered 5,855 strings
and found 190 differences across 48 base aliases; these include ambiguous-candidate
expansions and nested-alias corrections, so the comparison is recorded as reviewed
behavior changes rather than strict parity. A selected mutation run caught all 17
country matcher mutations after an interval-containment case was added.

## 2026-09-23: Strengthen evidence and ranking checks

Added exact assertions for evidence failure reasons and boundary masks, plus
ranking cases for token normalization, source identity, image markers, seeded
scores, empty matches, and score caps. The focused Rust suite passes 78 tests.
An isolated cargo-mutants run caught all 118 selected evidence and ranking
mutants. The repo-wide self-test remains red with the unrelated failures listed
in `docs/agent/known-errors.md`.

## 2026-09-23: Move GDELT taxonomy helpers into thesis-ingest

Moved CAMEO root normalization/labels, Goldstein bucketing, and dominant-root
counting into `thesis-ingest`. Existing Python helper signatures and dictionary
results remain through the PyO3 boundary; the existing article context caller
now uses the Rust implementation. Tie counts preserve first-seen order and
negative limits return an empty list. The core has normalization/count
properties and a no-assumption Kani proof for Goldstein thresholds. The rebuilt
bridge passed seven GDELT taxonomy/boundary tests; the workspace now passes 69
tests. CAMEO normalization accepts ASCII digits, the canonical code alphabet.

## 2026-09-23: Move lexical topic logic into thesis-search

Moved keyword extraction, lexical clustering, Jaccard similarity, and label
selection from the legacy PyO3 crate into `thesis-search`. The established
Python binding names remain adapters. Cluster and member lists now follow the
input feed positions deterministically. Proptest covers case/whitespace
normalization, uniqueness, and the ten-keyword cap; Kani verifies the rounded
Jaccard helper for valid counts. The rebuilt bridge passed eight topic and
Chroma fallback tests. The Rust workspace now passes 64 tests; FastAPI remains
the caller and public API server.

## 2026-09-23: Rust personalized ranking shadow route

Moved the typed ranking core into `thesis-search` and added the Axum
`POST /news/ranked` operation with OpenAPI and same-request FastAPI comparison.
The PyO3 adapter remains for FastAPI, which is still the public server. The
workspace now has 61 passing tests, two selected search Kani harnesses, and a
disposable PostgreSQL HTTP differential covering ten ranking and ten evidence
requests. The repository self-test still stops in the existing quality gate.

## 2026-09-23: Repository root cleanup

Removed the tracked `.github/skills/` and `.serena/` directories, the
`debug-bundles/` marker, empty temp files, and a placeholder patch. Kept the
Papercut files locally and removed them from Git tracking. Moved quality policy
files under `scripts/quality-hardening/` and the root Chroma log under `log/`.
The local `runtime-data/` directory is ignored as well. Removed the stale root
`.env.example` and moved `.jscpd.json` into the quality-hardening config folder.

## 2026-09-22: Fixes from the Lean and TLA+ audit

Reporter verification now requires fetched profile-name evidence. Quality-task
release checks ownership before changing task state, the worktree verifier
detects dirty-file content changes, and superseded research requests close
their own stream placeholders. Added regression checks and updated the Lean and
TLA+ models and `scripts/formal-audit` for repeatable local verification.

## 2026-09-22: Lean and TLA+ audit baseline

Recorded the initial formal audit and counterexample models in
`docs/agents/traces/lean-tla-codebase-audit.md` and
`docs/agents/formal-audit/`. The trace distinguishes confirmed findings,
conditional risks, and properties that passed bounded checks. It also records
that Lean and TLA+ can analyze algorithm costs and concurrency models, while
profilers and repeatable benchmarks are needed to measure application speed.

## 2026-09-12: Sequential research tool steering

The research tool node now selects one call per phase. It prioritizes internal
search, then required internal article reads, then external search. Additional
calls emitted in the same model turn are returned as deferred tool messages and
are not executed. The technology comparison smoke run completed in 11.74
seconds with a cited answer and six tool results; the serialized-call regression
test passes.

## 2026-09-12: Research harness evidence probe

Added `backend/scripts…50110 tokens truncated…07cc7fa`. The view, workspace calculations, interactive
globe lifecycle, and WebGL scene/material responsibilities now have focused modules.
Narrow Three.js capability views removed the generic recursive readonly failure mode;
uniform writes stay behind explicit callbacks. The focused globe suites pass 2 suites
and 5 tests, the full frontend suite passes 56 suites and 199 tests, TypeScript and the
production build pass, and the build generates 17 routes.

The current direct census is 121 frontend warnings and 0 errors, plus 1,393 scripts
findings (10 errors and 1,383 warnings) that remain outside the active lint scope. The
combined count is 1,514 findings, or 80.95% cleared and 19.05% remaining against the
7,949 baseline. Dependency cycles remain clear at 0 frontend and 0 backend cycles;
duplication remains 1.04% with 118 clones. The line gate, MI, dead-code, repository
self-test, and browser gates remain open as recorded in the plan.

## 2026-09-11 — Select and table wrapper checkpoint

Removed eight direct Oxlint findings from each of the select and table UI wrappers
by passing only their current explicit props. The existing dirty refactors in those
files remain uncommitted to preserve the user's worktree. Fixed and committed the
case-insensitive comparison property generator as `f31f258`.

Fresh whole-project Oxlint: 1,475 findings, 10 errors, and 1,465 warnings. Frontend
has 82 warnings and 0 errors; scripts have 1,393 findings and remain outside the
active cleanup scope. Frontend Jest passes 56 suites and 199 tests, and TypeScript
passes. Progress is 6,474/7,949 findings cleared (81.44%).

## 2026-09-11 — Globe and blindspot cleanup checkpoint

Narrowed Three.js globe scene, lifecycle, material, and uniform boundaries to
capability views while preserving uniform wrapper identity. Simplified the
blindspot test's typed fixtures and setup without changing its two tested flows.
The full frontend suite passes 56 suites and 199 tests; frontend TypeScript and
the focused globe checks pass.

Fresh direct Oxlint reports 1,446 findings: 10 errors and 1,436 warnings. Frontend
has 53 warnings and 0 errors; scripts have 1,393 findings and remain outside the
active lint scope by explicit user instruction. Progress is 6,503/7,949 findings
cleared (81.81%). Strict maintainability, source-line, dead-code, CRAP,
repository self-test, and browser gates remain open.

## 2026-09-11 — Modal, navigation, and wrapper cleanup checkpoint

Removed current prop spreads from modal, tooltip, and scroll-area boundaries; table-driven
the navigation and news-index tests; and narrowed the globe scene and provider contracts.
The full frontend suite passes 56 suites and 199 tests, and TypeScript passes. Whole direct
Oxlint is 1,435 findings: 10 errors and 1,425 warnings. Frontend has 42 warnings and 0
errors; scripts have 1,393 findings and remain outside the active cleanup scope by explicit
user instruction. Progress is 6,514/7,949 findings cleared (81.95%). Maintainability,
source-line, dead-code, CRAP, repository self-test, and browser gates remain open.

## 2026-09-11 — Modal boundary extraction checkpoint

Split the article modal hero links/visuals and overlay group into focused modules, then verified
the modal path with 6 passing tests, frontend TypeScript, and focused type-aware Oxlint. The
fresh census is 1,424 findings: 10 errors and 1,414 warnings; frontend has 31 warnings and
scripts have 1,393 findings under the explicit scripts exclusion. Progress is 6,525/7,949
findings cleared (82.09%).

## 2026-09-11 — Frontend warning queue cleared

Split the API endpoint/type barrels and organization wiki view into focused modules. Commit
`8b6f8b2` records the checkpoint. Direct frontend Oxlint is now 0 errors and 0 warnings.

The combined `frontend scripts` census is 1,393 findings: 10 errors and 1,383 warnings. Scripts
remain outside the active lint scope by explicit user instruction. Against the 7,949-finding
baseline, 6,556 are cleared (82.48%) and 1,393 remain (17.52%). Frontend TypeScript passes, and
eight affected regression suites pass with 27 tests.

## 2026-09-11 — Frontend reachability cleanup checkpoint

Removed two unused frontend utility files, `@tanstack/react-virtual`, and verified unused
exports in clean tracked modules. Commit `7465956` records the 42-file cleanup. Existing modal
data and untracked debug, response-schema, settings, and stream WIP stayed unstaged.

Fresh direct frontend Oxlint is 0 errors and 0 warnings. Whole direct Oxlint is 1,393 findings:
10 errors and 1,383 warnings, all in `scripts/` under the explicit scripts exclusion. Progress is
6,556 of 7,949 findings cleared (82.48%). Full frontend Jest passes 56 suites and 199 tests;
frontend TypeScript passes. Knip reports no unused files or dependencies, with the intentional
cross-package CRAP devDependency finding and preserved WIP exports/types still open.

## 2026-09-11 — One-file maintainability batches

Commits `f4bbfa2` and `9ffa0b8` split globe surface/runtime composition, and `e1a4f8e` split
inline-definition listener setup into focused boundaries. Both changed files pass direct Oxlint with 0 errors and 0 warnings;
frontend TypeScript passes; and the full frontend Jest suite passes 56 suites and 199 tests. Their
scoped quality measurements report no CRAP violations. Globe runtime, environment, data, surface,
and parent functions measure MI 51.5, 55.1, 59.2, 54.7, and 52.8; inline-definition
hook/listener functions measure MI 50.3/56.5.

The whole direct census remains 1,393 findings: 10 errors and 1,383 warnings, all in `scripts/`,
which remain outside active lint cleanup by explicit user instruction. Against the 7,949-finding
baseline, 6,556 are cleared (82.48%) and 1,393 remain (17.52%).

## 2026-09-11 — Scripts quality gate checkpoint

Pulled the latest remote script hardening changes. Fast-forward was unavailable because the local
branch had independent commits, so the remote work was merged as `c11a531`. Strict script typing,
JSON output behavior, adapter guards, and script regression tests were then fixed in `5160795`.

The configured split-policy Oxlint scan now reports 0 errors and 0 warnings across 41 script files;
the whole `node scripts/run-oxlint.mjs --json` scan reports 0 diagnostics, 0 errors, and 0 warnings.
`npm run cli:typecheck` passes, `npm run cli:test` passes 14 tests, and the quality controller tests
and policy validation pass with 22 tests and a valid policy.

For historical comparison only, the old root Oxlint policy reports 963 script findings: 11 errors
and 952 warnings. That is 87.88% cleared from the 7,949 baseline, but it is not a completion gate
because the latest remote changes introduced the dedicated scripts policy and removed obsolete script
files. The scripts typecheck and configured lint gates are closed; repository maintainability,
source-line, CRAP completion, self-test, and browser verification remain open.

## 2026-09-11 — Verifier speed checkpoint

The repository verifier was spending its time in code-multivitals' whole-project clone pass and
then repeating CCCC, maintainability, CRAP, and Oxlint as separate checks. Maintainability-only
paths now call `analyseFile`, the measurement result owns those analyzer gates once, and the
remaining repository checks run through a bounded four-worker pool. `verify.sh` also works from
any caller directory and exposes `THESIS_VERIFY_CONCURRENCY`.

The speed change includes a regression test for bounded check concurrency. The fresh self-test
completed in 118.8 seconds without timing out. It still fails on 2 CCCC violations, 136 low
maintainability-index violations, dead code, backend mypy, Ruff format, and backend tests; the
frontend, CLI, Rust, Oxlint, cycles, duplication, and source-line checks passed.

## 2026-09-11 — PR 35 merge baseline and backlog policy

PR 35 is the merge baseline for the script-quality and verifier-speed work. The configured
scripts policy is green with 0 Oxlint errors and warnings across 42 files; CLI typecheck, 14 CLI
tests, 23 controller tests, and policy validation pass. The repository self-test completes in
118.8 seconds without timing out, while the full gate still reports 2 CCCC violations, 136 MI
violations, dead-code findings, 25 mypy errors across 19 files, one Ruff format failure, and five
backend test failures.

The active quality backlog and the rule that future features repair open debt in the same touched
system are recorded in `docs/agent/lean-codebase-plan.md` and `AGENTS.md`.

## 2026-09-11 — Research assistant and API contract repair

The research backend now sends OpenCode Zen's session, request, client, and user-agent headers.
Each research run gets its own session identifier, direct OpenCode requests stop after one
30-second attempt, and provider failures become an SSE error event so the frontend clears its
running state. The configured local model is `mimo-v2.5-free`; the account currently reaches the
provider but is rate limited by OpenCode's free tier.

The liked and bookmark response models now match the flat records returned by their routes, and
the OpenAPI schemas were updated with the same fields. Remote embedding requests split inputs
into bounded groups of 32 to avoid the 200-article read timeout. The news header keeps resource
controls grouped in a wrapping flex row on narrow screens.

Focused backend tests pass, including the `/api/liked` response check, embedding batch regression,
OpenCode header coverage, and research stream provider-error coverage. The live API returned 200
for `/api/liked` with seven entries. Chrome DevTools attachment remains unavailable because the
configured MCP connector cannot find a usable `DevToolsActivePort` file.

## 2026-09-12 — Research model availability and live activity stream

Probed all seven OpenCode models whose IDs contain `-free` with the configured Zen credential.
`ling-3.0-flash-fin-free`, `nemotron-3-ultra-free`, and `nemotron-3.5-lightning-free` returned
200. DeepSeek returned 400, both Muse contributor models returned 500, and `mimo-v2.5-free`
returned the provider's `FreeUsageLimitError` 429. The local research catalog now defaults to
Ling and lists the three verified models for the active OpenCode backend.

Research clients no longer reuse OpenCode sessions across requests. The selected model and stop
event are preserved across the thread-pool iterator, LangGraph emits `updates` and `messages`,
and provider reasoning metadata is exposed as typed `model_delta` SSE events. A live local
request completed in 31.7 seconds with status, model-delta, tool, article, and complete events.
The research loop is bounded to three passes and ten tool calls so one request stays inside the
API worker timeout. The shared home navigation now wraps the research workspace, with research
history and activity remaining page-specific panels.

The research activity disclosure now assigns each step a stable identity plus
occurrence count. Repeated streamed observations no longer produce duplicate
React keys; a regression test renders two identical steps and verifies both
remain visible.

## 2026-09-12 — Globe canvas visibility repair

The globe route rendered a blank map because the Three.js resize observer watched
an unattached ref. The globe therefore received `0×0` dimensions. `GlobeCanvas`
now owns the existing host ref, and compact globe/scroll layouts have a definite
viewport height. The live browser now renders the textured globe; the canvas
measured `727×1758` in the verification viewport. Added a regression test for
the forwarded host ref.

## 2026-09-12 — Workspace shortcut hierarchy

Saved and Research shortcuts on the globe header now share a compact workspace
surface with consistent hit areas, focus treatment, and hover/press feedback.
The globe header is anchored to the content column so the fixed navigation cannot
cover the Saved shortcut at narrow widths. Both links remain available at
`/saved` and `/search`.

## 2026-09-12 — Globe country selector and coverage lenses

The compact global view now exposes a Country focus selector alongside the globe
briefing. It reuses the globe's existing selection handler, so choosing a country
updates the focus heading, coverage metrics, and country articles without needing
to click a map region. The Local Lens and World Lens controls and their content are
now visible in the compact panel instead of waiting for the sheet to expand.

Live browser verification selected US (918 articles), loaded its local lens, and
switched to the outside-source world lens. Frontend lint, TypeScript, and diff
checks passed.

## 2026-09-12 — Restore direct globe country selection

Compared the globe with `main` and the split-module refactor `07cc7fa`.
The newer GeoJSON schema discarded feature and geometry types, so the renderer
skipped country polygons. The schema now preserves both types for polygon rendering
and click centroids. Removed the temporary country dropdown. Direct map clicks
again open country coverage; a live click selected Bolivia and World Lens loaded
an Argentine outlet's article.

Removed duplicate view tabs, Saved, Research, alerts, and theme controls from the
news header. The sidebar owns navigation; the header retains category, sort, and
the distinct source-filter action. Country articles now stack vertically and the
compact selected-country panel provides room for the news list.

## 2026-09-12 — Earth surface graphics

Added a packed terrain-normal/water-reflectivity map from the Three.js r169 example
textures, with upstream attribution beside the assets. Earth shading now includes
terrain relief, ocean highlights, subtle water motion, and a limb-focused atmosphere.
Clouds reuse the Earth's texture sample and blend below the country polygons;
the decorative atmosphere does not participate in picking. No new dependencies.

The four active texture assets total 912,921 bytes, down from 1,073,707 bytes for
the previous five assets. Texture resolution and device-quality limits are unchanged.
These clouds are illustrative, not current weather. Performance and verification
details are recorded in `docs/agents/traces/globe-earth-graphics.md`.

## 2026-09-23: CCCC backlog checkpoint

Reduced the two remaining CCCC functions below the configured limits. The full complexity
scan now reports zero violations across 12,927 functions. Added coverage for malformed
optional Oxlint labels. The adapter tests, CLI typecheck, changed-file lint, and changed-scope
quality measurement pass. The repository-wide self-test and source-line gate remain open;
`backend/news_research_agent.py` exceeds its debt cap by 117 lines. See
`docs/agents/traces/lean-codebase-cleanup.md` for the current measurement and verification.

## 2026-09-23 — Rust backend workspace and evidence evaluation slice

Added the Cargo workspace beside FastAPI, absorbed the tested evidence decision
policy, and exposed `POST /api/wiki/evidence/claims/evaluate` through Axum and
SQLx. FastAPI remains the public server. The existing Alembic history remains
the schema authority; the existing PyO3 module is used only as the current
Python/Rust differential bridge. The embedding worker remains a Python HTTP
sidecar.

The Rust OpenAPI operation matches the checked-in contract. Unit/property tests,
34 policy-row and eight explicit decision-case comparisons, Kani's five
allocation-free evidence harnesses, and ten same-request HTTP comparisons over
a disposable Alembic-migrated PostgreSQL database passed. The migration map,
verification scope, and exact commands are in
`docs/architecture/rust-backend-migration.md`,
`docs/agents/formal-audit/verification-manifest.json`, and
`docs/agents/traces/rust-backend-first-slice.md`.

The repository-wide self-test remains red at its existing quality gate; its
exact blockers and the focused Rust/evidence results are recorded in
`docs/agent/known-errors.md` and the migration trace. CI installs its focused
Python dependencies through `uv`.

## 2026-09-23 — Extract RSS HTML logic into thesis-ingest

Moved the existing pure HTML cleaner and article metadata/image extractor into
the workspace's `thesis-ingest` crate. The PyO3 function surface is unchanged,
and the RSS parser calls the extracted cleaner. Workspace tests, Clippy,
formatting, the PyO3 build, 14 Python extraction/image tests, and two evidence
differential tests passed. RSS corpus parity is still required before callers
switch or the PyO3 bridge is removed.

## 2026-09-23 — Extract GDELT parsing and guard date conversion

Moved the pure GDELT TSV parser and domain filter into `thesis-ingest`; the
PyO3 functions still own Python datetime/dict conversion. A generated property
checks skipped empty IDs/URLs, input order, and result limits. The wrapper now
validates `SQLDATE`; malformed UTF-8 no longer panics and maps to the UTC epoch.
Cargo tests, Clippy, the release extension build, and 19 focused Python tests
passed. No independent Python GDELT parser or Kani proof exists yet.
The full `scripts/self-test` still exits at the repository quality gate
before `verify.sh` reaches Rust; the workspace gates were run directly.

## 2026-09-23 — Move source-host matching into thesis-ingest

Moved host normalization and source identity matching from
`source_url_guard.py` into `thesis-ingest`. Python still parses URLs, extracts
Google News site scope, and shapes the guard response. Hypothesis comparisons
preserve the previous Python behavior over Unicode inputs and found the
U+001F whitespace difference. A selected mutation run found an empty-host and
trailing-dot edge case; a regression now kills that mutant and all five other
selected mutations.

The workspace and source-guard tests, strict Clippy, PyO3 build, two ingest
Kani harnesses, and the source-host Verus model passed. Verus proves an abstract
byte-sequence rule; it is not a refinement proof of the Rust implementation.
The source-host tests and formal scope are listed in the migration report and
verification manifest.

## 2026-09-23 — Extend Kani and Verus coverage across domain kernels

Added a symbolic Kani property for production evidence-root deduplication and
an abstract Verus proof that repeating an existing qualifying root preserves
root membership. Added a generated proptest plus Kani and Verus properties for
nested country-alias span containment. Kani now checks six evidence harnesses,
five search harnesses, and two ingest harnesses; all selected checks run on
pull requests and main pushes.
The three Verus models remain abstract specifications without Rust refinement
proofs. Database, API, and server effects remain under integration and
differential checks.

## 2026-09-23 — Extend Kani into the RSS PyO3 crate

Added a bounded Kani harness for the production blindspot `dot_product` helper.
It proves nonnegativity for every three-element vector with symbolic `i8`
components converted to finite `f64` values, with no assumptions and unwind 5.
The harness passes locally and now runs in the Rust migration CI job. It does
not prove arbitrary vector lengths, non-finite inputs, or the full scoring
pipeline.

## 2026-09-23 — Move comparison keyword extraction into Rust

`article_comparison.py::extract_keywords` now calls the
`thesis-search::comparison_keywords` domain function through the existing PyO3
bridge. The implementation preserves Python word boundaries, stop words,
frequency ordering, first-seen ties, and limit behavior. Python reference
properties, Unicode boundary cases, two Kani comparator harnesses, and a Verus
priority model were added. `/compare/articles` remains FastAPI-owned, and no
performance claim was measured. See
`docs/agents/traces/rust-comparison-keywords.md`.

## 2026-09-23 — Measure workspace storage and verify gzip logs

Compressed 320,618 closed, nonempty `.log` files, saving 98,501,743 logical
bytes. Individual compressed files still used 1.62G of disk blocks, so bundled
320,755 historical `.log.gz` files into
`backend/logs/.historical-log-files-20260923.tar.gz`. Tar compared every member
with its source before removal; the archive gzip check passed. `backend/logs`
now uses 1.82G allocated. Runtime JSONL remains available to its readers. Dev
and test Cargo profiles omit debug information. Cleaning the previous 14G
target freed 15.0GiB of generated output; after the 116-test workspace run,
Clippy, Kani, and comparison mutation checks, it measured 2.01GB. After the
121-test workspace run and OpenAPI build, it measured 2.9G. See
`docs/agents/traces/workspace-storage.md` for exact byte counts.

## 2026-09-23 — Add Rust article comparison shadow route

Moved the full article comparison function into `thesis-search` and added
`POST /compare/articles` to the Axum shadow server. The operation matches the
checked-in OpenAPI contract; the disposable HTTP differential passed three
valid requests and four model-validation requests against FastAPI. FastAPI
remains public. Proptest checks bounded symmetric similarity and summary/list
counts; Kani checks the scalar keyword-emphasis rule; Verus proves an abstract
entity partition model for arbitrary finite sets. Mutation tests caught all 25
selected non-equivalent mutants after excluding five equivalent empty guards.
Python parser diagnostics for malformed JSON differ from Serde, so those cases
check status and error category rather than exact error text. See
`docs/agents/traces/rust-article-comparison.md`.

## 2026-09-23 — Move language diagnostics into thesis-search

Moved deterministic article-language scoring into `thesis-search` and routed the
existing FastAPI service through the Rust PyO3 binding. Request and response
shapes are unchanged. The Python scorer remains only as an independent
differential reference. Hypothesis comparisons caught and fixed combining-mark
word-boundary behavior and Python's extra Unicode case-folding matches for
`İ`, `ı`, `ſ`, and `K`.

The focused Rust suite passed 54 tests; the Python differential and endpoint
suite passed six tests. Strict Clippy, Rust formatting, Ruff, strict mypy, and
the PyO3 rebuild passed. Kani proved severity monotonicity for every ordered
`f64` pair in one harness (34 checks, unwind 1, no explicit assumptions).
Verus was not applied because the remaining text/regex rules have no useful
unbounded mathematical invariant. The endpoint remains FastAPI-owned; the
migration map records the PyO3 and Python-reference removal conditions.

## 2026-09-23 — Split article comparison modules

Reduced `article_comparison.rs` from 1,005 lines to a 311-line facade and moved
entity logic, text logic, tests, and the Kani harness into separate modules.
Public Rust paths remain available. Fixed the resulting unused-import and
missing-documentation Clippy errors, plus the Ruff import-order finding in
`language_diagnostics.py`. Formatting, 54 `thesis-search` tests, strict Clippy,
Ruff, and `git diff --check` passed. The moved Kani harness passed at unwind 4
(0/28 checks failed); Kani 0.68 emitted its standard `register_tool`
unstable-feature warning.

## 2026-09-23 — Add Rust evidence relationship reads

Added `GET /api/wiki/evidence/relationships` to the Axum shadow listener and
implemented its read query with SQLx over the existing Alembic schema. The
route preserves separate `as_of` and `known_at` filtering, direction, CSV
predicate and entity filters, relationship ordering, linked claim IDs, evidence
root counts, and FastAPI validation categories. Typed PostgreSQL array binds
avoid one query parameter per relationship and claim. The disposable PostgreSQL
differential passed against FastAPI. OpenAPI compatibility passed for all six
Rust shadow operations; the workspace passed 130 tests and strict Clippy.
FastAPI remains the public listener. No Kani or Verus proof is claimed for
database or HTTP behavior; lineage cycle handling is covered by Rust and
PostgreSQL regression tests. See
`docs/agents/traces/rust-evidence-relationships.md`.

