# Lean codebase cleanup

## Goal and status

Preserve app features while deleting dead code, reducing complexity, and fixing observed
bugs. The detailed acceptance criteria and work queue are in
[the audit plan](../../agent/lean-codebase-plan.md).

The plan was saved before application edits. Implementation is active, not complete.
The user requested Luna for coding to reduce cost. One Luna worker owns code changes;
the root agent handles direction, review, verification, and this documentation.

## 2026-09-10 — Pulled remote and article modal checkpoint

Goal: continue the lean-codebase plan from the latest remote state while preserving the
user's dirty worktree and skipping scripts lint cleanup by explicit user scope.

Status: active. `git fetch origin` followed by `git pull --ff-only` fast-forwarded the branch
to remote commit `596ecc9`. The retained user WIP was restored without resetting untracked
files; the stash remains available because its overlapping tracked files could not be popped
cleanly. User-authorized checkpoint commits are now being made as bounded slices.

The article-detail modal was split into focused content, state, model, operations, and
highlight modules in commit `0cf1299`. Verification: the focused modal suite passed 1/1
suites and 6/6 tests, frontend TypeScript passed, `git diff --check` passed, and the changed
modules have zero Oxlint errors. Two warnings remain: the model factory's readonly parameter
rule and the intentional JSX prop spread at the typed view handoff.

Post-checkpoint direct Oxlint counts are 364 frontend warnings and 0 errors; the whole scan
is 1,757 findings (8 errors, 1,749 warnings), consisting of 364 frontend and 1,393 scripts
findings. Scripts lint cleanup is excluded by the user's instruction; no lint rule or config
was weakened. Against the plan's 7,949-finding baseline, 6,192 findings are cleared (77.89%)
and 1,757 remain (22.11%). This percentage measures only direct Oxlint findings; MI, CRAP,
duplication, source limits, full runtime, and browser verification are still open.

Files changed in this checkpoint: `frontend/components/article-detail-modal.tsx`,
`article-detail-modal-content.tsx`, `article-detail-modal-logic.ts`,
`article-detail-modal-model.ts`, `article-detail-modal-operations.ts`,
`article-detail-modal-highlight-operations.ts`, and
`article-detail-modal-highlight-hooks.ts`.

Next executable step: continue with the next largest frontend warning cluster, preserving
the same narrow edit, focused regression, TypeScript, direct lint, diff check, and checkpoint
commit loop. Do not claim repository completion until the remaining gates are run.

## 2026-09-11 — Frontend warning reduction checkpoint

Goal: continue the pulled checkout from `596ecc9`, preserve the retained WIP, skip only
the user-excluded scripts lint queue, and make each frontend cleanup slice reviewable and
reversible through a checkpoint commit.

Status: active and substantially incomplete. The latest code checkpoint is `1a26888`;
this trace update is committed in `f3b35a7`. The fresh
direct census reports 156 frontend warnings and 0 errors across 44 files with findings.
The combined frontend/scripts census reports 1,549 findings: 10 errors and 1,539
warnings. Scripts account for all 10 errors and 1,383 warnings and remain outside the
active cleanup scope by explicit user instruction. Against the plan baseline of 7,949,
6,400 findings are cleared (80.51%) and 1,549 remain (19.49%).

Files changed in this checkpoint series include:

- `frontend/app/search/research/components/research-side-panels.tsx`
- `frontend/__tests__/browse-index.test.tsx`
- `frontend/__tests__/live-browse-index.test.tsx`
- `frontend/__tests__/reading-queue-queries.test.tsx`
- `frontend/__tests__/globe-live-data.test.ts`
- `frontend/components/navigation/navigation-state.ts`
- `frontend/__tests__/global-navigation.test.tsx`
- `frontend/__tests__/blindspot-view.test.tsx`
- `frontend/jest.config.js`

Verification:

- Full frontend Jest: 56 suites and 199 tests passed.
- Frontend TypeScript: passed with no diagnostics.
- Frontend production build: passed and generated all 12 static pages/routes.
- Oxlint rule tests: 13 files and 204 tests passed.
- Dependency cycles: 0 frontend cycles; backend graph has no cycles.
- Duplication: passed at 1.04% with 118 clones.
- Strict maintainability: 6,051 functions; 150 MI failures below 50 and 875 warnings below 60.
- Source-line gate: still fails at 1,157 lines in `use-research-controller.ts` and 1,082
  lines in `frontend/lib/api/endpoints.ts`.
- Dead-code gate: still fails with two unused files, one unused dependency, one unused
  dev dependency, and reviewed unused exports/types.
- `scripts/self-test`: reached `node scripts/quality-hardening.mjs verify --scope repo`
  but produced no output for ten minutes while the type-aware worker remained CPU-active;
  it was stopped with exit 130. This is an incomplete full-gate result, not a pass.

The attempted `DeepReadonly` mapping across Three.js runtime parameters was reverted after
TypeScript rejected readonly texture mipmap arrays and the lint count did not improve. The
failure is recorded in `papercuts.md`; future globe work needs narrow capability/view types,
not a recursive mapped type over mutable Three.js classes.

Next executable step: continue from the 156-warning frontend census, starting with a
bounded research-controller or non-framework warning cluster. Preserve the existing
scripts configuration and rerun direct frontend lint, TypeScript, focused behavior tests,
and a checkpoint commit after each coherent slice.

## 2026-09-11 — Research controller extraction

Goal: reduce the largest remaining frontend controller cluster while preserving the
research page behavior and keeping scripts outside the active lint queue.

Status: complete for this bounded slice; repository cleanup remains active. The former
1,157-line controller was split into nine focused modules in `71e0a5e`. The follow-up
`0193f7b` removed three unused exports found by Knip. No lint thresholds, ignores, or
suppression comments changed.

Files changed: `frontend/app/search/research/hooks/use-research-controller.ts`,
`research-chat-state.ts`, `research-page-view-props.ts`, `use-research-chat-actions.ts`,
`use-research-chat-persistence.ts`, `use-research-derived-state.ts`,
`use-research-message-actions.ts`, `use-research-prompt.ts`, and
`use-research-transport.ts`.

Evidence: the focused hook directory has zero direct Oxlint diagnostics; full frontend
Jest passes 56 suites and 199 tests; frontend TypeScript passes; the production build
passes and generates all 12 routes; `git diff --check` passes; and the combined direct
Oxlint census is 1,535 findings, consisting of 142 frontend warnings plus 1,393 scripts
findings (10 errors and 1,383 warnings). Against the 7,949 baseline, 6,414 findings are
cleared (80.69%) and 1,535 remain (19.31%).

Remaining failures: one frontend file exceeds the line debt cap (`frontend/lib/api/endpoints.ts`,
1,082 lines); dead-code reports 2 unused files, 1 unused dependency, 1 unused dev dependency,
71 unused exports, 30 unused exported types, and 11 configuration hints; maintainability
reports 6,074 functions with 144 MI failures and 882 MI warnings. A repeat
`scripts/self-test` reached `node scripts/quality-hardening.mjs verify --scope repo`,
produced no output for about 4.5 minutes, and was stopped with exit 130 while its
type-aware worker remained CPU-active. Browser verification is unavailable.

Rollback: revert `0193f7b` and `71e0a5e` together. Next executable step: inspect the
interactive globe scene/material warnings, then rerun the same direct frontend gates and
make another focused checkpoint.

## 2026-09-11 — Globe view and scene checkpoint

Goal: save the bounded globe view and WebGL scene refactor while reducing its readonly
parameter debt without changing the rendering contract.

Status: complete for this bounded slice; repository cleanup remains active. Commit
`07cc7fa` records the globe view, workspace calculations, interactive globe lifecycle,
shader/material modules, and the globe workspace regression test. The scene setup now
uses narrow Three.js capability views for read-only helpers and explicit callbacks for
uniform mutations. No lint threshold, ignore, or suppression changed.

Evidence: the focused globe suites pass 2 suites and 5 tests; full frontend Jest passes
56 suites and 199 tests; frontend TypeScript and the production build pass; the build
generates 17 routes; the scene setup file has zero direct Oxlint diagnostics; the whole
globe cluster has 12 warnings and 0 errors at remaining mutable runtime boundaries;
dependency cycles pass with 0 frontend and 0 backend cycles; duplication is 1.04% with
118 clones; and `git diff --check` passes. The live frontend census is 121 warnings and
0 errors; the combined census is 1,514 findings, including 1,393 scripts findings
(10 errors and 1,383 warnings) intentionally outside active cleanup.

Remaining gates: `frontend/lib/api/endpoints.ts` remains over the line cap at 1,082/1,057;
maintainability reports 6,077 functions with 144 MI failures and 882 MI warnings; dead
code reports 2 unused files, 1 unused dependency, 1 unused dev dependency, 71 unused
exports, 30 unused exported types, and 11 configuration hints. The repository self-test
has the documented type-aware verifier run-window failure, and browser verification is
unavailable.

Rollback: revert `07cc7fa`. Next executable step: inspect the 14 warnings in
`frontend/components/highlight-toolbar.tsx`, then the UI sheet/select/table cluster.

## Baseline and safeguards

- Starting commit: bc93b24f7cd134c49a79927f768b682c28839dac.
- Preserve existing tracked and untracked changes. Initial patch and status are in
  /tmp/thesis-lean-audit-fjXLYj/initial.patch and initial-status.txt.
- No commits, pushes, policy relaxation, dependency additions, or user-data deletion occurred
  during the original audit capture; later checkpoint commits are user-authorized.
- Native verification reports are in /tmp/thesis-lean-audit-fjXLYj/.
- Re-read changed anchors before retrying patches; formatting changed after the original audit.
- Untouched frontend files have September 4, 23:01 formatting timestamps, later than the
  original audit and earlier than this Luna implementation. The resumed line-limit check
  therefore has more failures than the original inventory. Do not attribute that drift
  to Luna's cleanup. A later patch/status snapshot is saved as implementation-checkpoint.patch
  and implementation-checkpoint-status.txt in the audit directory.

## Changes and checks

- Added the detailed audit plan, including every measured low-MI function and per-file
  lint inventory, feature contracts, deletion candidates, and 17 implementation phases.
- CCCC subprocess regression uses real child processes. Exit 7 was accepted before the
  fix; exit status and signal checks now reject it. The adapter suite passed 3 tests.
- Added an MI CLI regression with a piped report exceeding 65,536 bytes. It failed on the
  original JSON-plus-human output and now passes after Luna's output/exit repair.
- Direct TypeScript baseline passed. Direct lint found 2,816 errors and 5,810 warnings.
- CCCC found 6 hard violations. MI found 235 functions below 50 and 487 more below 60.
- Fresh frontend coverage passed 51 suites and 176 tests. Coverage: 37.04% statements,
  20.60% branches, 26.78% functions, 38.19% lines.
- Fresh CRAP: 2,409 measured methods, 193 unknown, 696 above 6, 680 above 8,
  154 above 30, maximum 272. Old single-file coverage is not a valid baseline.
- Watchdog-wrapped scripts/self-test failed after 358.53 seconds. Its wrapper did not
  forward --json. Individual native checks recovered the failure details recorded in
  the plan and baseline-checks.jsonl; passing focused checks do not imply full closure.

## Remaining failures and evidence limits

### Resumed API and queue checkpoint

The quota interruption ended after the user confirmed Luna availability. Root verified
the worker resumed and independently passed all 3 focused suites / 19 tests, including
the real digest view, HTTP error cases, prototype-like category keys, healthy analysis
state, extraction failures and cancellation signal, preloaded text bypass, and empty-text
fallback to full_text. The Request-global fixture failure below is fixed.

Luna reported full frontend Jest 54 suites / 195 tests passed and frontend TypeScript
passed. It deleted frontend/lib/types/core.ts after another reference check; this tracked
file is recoverable from Git. The digestError property now reaches QueueDigestView and is
covered by a rendered test. The vacuous validator rejected by root remains removed.

Root independently ran npm --prefix frontend run deadcode: it FAILS, despite the worker's
initial passing claim. core.ts is absent, but unused exports/types and the duplicate
fetchNewsIndex/fetchLiveBrowseIndex export remain. Evidence: queue-checkpoint-knip.json
in the audit directory. A verified deletion is not a passing repository dead-code gate.

The worker's scoped checkpoint has 1 error and 38 warnings. The error is the generic
success-response assertion; warnings remain in queue query/sidebar/digest code. Root
assigned a bounded queue simplification pass next, with the 19 regressions preserved and
no policy changes. API runtime-schema work remains open; do not disguise its trust boundary.

### Phase 0 checkpoint

Luna repaired MI JSON output and natural exit handling, CLI type narrowing, one-shot
report types, the stale API census test, and the import check's executable. Root reran
CLI typecheck and the four MI/adapter regressions successfully. Luna also passed all
13 CLI tests and the real import checker. The optional CCCC helper rewrite was
discarded after worsening lint; the original helper-table implementation is present
with the tested exit-code/signal repair. Do not count that abandoned rewrite as cleanup.

Independent broader baselines passed: backend tests, 741 passed and 3 slow deselected
(9 warnings); frontend production build including TypeScript and all route generation.
Reports: backend-tests.json, mypy-full.json, and frontend-build.json in the audit directory.

The first tooling chunk is behaviorally verified, not lint-clean: Luna reported 111
errors and 310 warnings across its seven-file lint sample. Phase 0 remains open for
measurement-policy enforcement and coverage provenance. The user has been asked about
the conflict between required native Node tests and the lint allow-list, which omits
node:test and node:assert/strict. No allow-list change has been authorized or made.

Luna's next chunk covers the central HTTP-error crash, queue-query correctness, reuse
of existing article extraction, and deletion of the unreferenced core type module.

Repo-wide lint, MI, CRAP, source line limits, backend mypy, and Ruff formatting still
require repairs. CLI typecheck/tests and import execution now pass. Chrome MCP cannot connect because
DevToolsActivePort is absent; no visual verification has been claimed.

### Luna quota interruption

Authoritative agent status is errored: the provider reports a usage limit and says to try
again at 12:27 PM. Root did not replace Luna or begin writing code. This is the first
quota-blocker audit, not grounds to mark the whole goal complete or permanently blocked.

Current code: API error decoding preserves valid string fields independently, falls back
for JSON null/malformed bodies, and preserves network/abort rejections. Root rejected a
vacuous z.custom validator; it was removed. The original one-argument fetch contract was
restored. Queue code uses prototype-safe grouping, distinguishes idle analysis from errors,
reuses article extraction, and throws digest failures. The new digestError hook property
is not yet consumed by the queue UI, so user-visible error handling remains unfinished.
The unused core.ts module has NOT been deleted.

Latest root checks after the worker stopped:

- Frontend TypeScript passes.
- API error regressions: 10/10 pass.
- Combined API/queue regressions: 15 pass, 1 fails. The queue fetch fixture references
  Request in jsdom where that global is absent. Its extraction assertion therefore receives
  ReferenceError instead of the intended HTTP 503 error. Fix the boundary fixture without
  replacing production code or adding a vacuous mock implementation.
- Full frontend suite was rerun; its report is luna-quota-frontend-tests.json in the audit
  directory. The same Request fixture failure remains.
- Scoped lint still fails in client.ts, reading-queue-queries.ts, and its new test:
  max-statements, uninitialized locals, conditional style, missing SAFETY justification,
  generic unsafe assertion, readonly test-boundary parameters, key ordering, and test style.
  The original stop-hook afterEach placement and exports-last warnings are fixed.

The generic success-response assertion is an existing trust boundary, not runtime schema
validation. Do not hide it behind z.custom with no predicate or another unchecked cast.
Any move to real endpoint schemas must preserve successful response contracts and callers.

## Next executable work and rollback

The user subsequently confirmed Luna can run again. Root resumed the same worker and
verified its live status is running. The quota interruption is no longer treated as an
active blocker. Ownership now includes the queue sidebar/digest view only as needed to
show digest errors in the actual UI, with a rendered regression.

The existing Luna worker is clearing queue warnings and structural debt. Root reviews the
next checkpoint, then assigns the remaining API-contract, dead-export, and mapper phases.
Do not change the code-writer model without user permission. Preserve the completed fixes
and all initial user work. Repo-wide closure has not been reached.

Rollback must target only this task's edits using the captured initial patch and actual
diff review. Do not reset the dirty branch or delete untracked user work.

## Interrupted sidebar checkpoint and second Luna resume

The provider stopped both Luna agents with a usage-limit error. The user subsequently
confirmed Luna was available again; the same sole code writer is now running. The
read-only backend audit returned no findings. Root did not switch coding models.

Independent checks on the interrupted worktree:

- The three API/queue regression suites pass: 19 tests.
- Frontend TypeScript fails in reading-queue-sidebar.tsx: a state setter is supplied
  where a zero-argument close callback is required, and the controller lacks handleMarkRead.
- Scoped Oxlint fails on sidebar callback dependencies, readonly parameters, dictionary
  return typing, statement/function/file size, and the existing generic API assertion.
  The earlier digest paragraph-key, ternary, and JSX-depth diagnostics were not emitted.
- Run Oxlint through npm exec from frontend so its companion executable resolves;
  direct invocation from the repository root failed tool resolution.

Next writer task: repair the interrupted sidebar wiring, reduce the added action-hook
layers, and add an actual sidebar interaction regression. Passing query tests alone did
not prove controller correctness. Repo-wide cleanup remains incomplete; no gates changed.

### Verified recovery checkpoint

Root independently verified frontend TypeScript passes, four focused API/queue suites
pass all 20 tests, and pinned Ruff 0.15.22 passes news.py. The agentic-search test now
uses a real Response.json in the Node Jest environment rather than a partial Response
assertion. Its changed partial-object expectation still requires review against the full
response contract; passing tests do not settle that review.

Scoped sidebar lint still reports three readonly-parameter errors and six warnings
(statements, function/file size, and key order). Luna owns their repair and the missing
sidebar interaction regression. The AST-grep cluster finding flags an await inside an
async map callback; this does not serialize the requests. A scoped rule correction was
proposed to the user, not authorized or applied. No completion claim is supported.

### Additional hook repairs

Pinned Ruff passes both news.py and search.py import fixes. The appearance and agentic
test suites passed 15 tests, but appearance bootstrap eval and describe-size lint remain.
The agentic test now compares the full literal result directly; serialization and derived
expected-value machinery were rejected and removed. Its Response fixture stubs json at
the fetch boundary to keep the fixture values in the test realm.

Review caught an intermediate funding-bias formatting edit turning limitation strings
into tuples. The writer removed the inner commas and added a persisted specification
check requiring six string entries. Root independently ran its nine tests: all pass with
eight deprecation warnings. Pinned Ruff passes the service and test, and frontend tsc
passes at this checkpoint. Sidebar lint remains unfinished. The next bounded writer
task is appearance bootstrap test execution without eval, preserving real style effects.

Appearance checkpoint: the tests now append and remove an actual script element in
jsdom. Assertions still verify CSS tokens and motion state for valid settings, and
unchanged state for corrupt/wrong-version settings. Root independently verified the
appearance and agentic suites: 15 tests pass, and scoped Oxlint exits zero with the
existing rules and zero-warning limit. No production appearance code changed.
Two Python test-hook findings (explicit timezone and unused unpacked values) are the
writer's next bounded task. The broader sidebar and concurrency-rule work remains open.

Python test checkpoint: root independently verified 11 article-contract/funding tests
pass with eight deprecation warnings; explicit DTZ001/RUF059 checks pass. The date fixture
now uses UTC, and the degenerate table test checks its row/column structure. Sidebar
lint currently has three readonly errors and five warnings; the writer is adding the
missing interaction regression before further simplification. Later hook findings in
test_live_cache_index.py and article-detail-modal.test.tsx are queued behind that task.

Root independently ran render-loop-regression.test.tsx: five tests pass, including the
new actual sidebar flow (open, select, navigate, mark read, Escape). Opening the queue
emits a missing dialog-description warning. The writer was asked to supply meaningful
accessible description text, not silence the warning. This test evidence covers wiring,
not browser layout or completion of sidebar lint/maintainability cleanup.

Root then ran the complete frontend Jest suite: 54 suites and 196 tests passed in
9.577 seconds (`npm test -- --runInBand --silent`). This is a test checkpoint, not a
lint/build/browser acceptance result. The writer is still simplifying the sidebar.

## Two-worker orchestration

The user requested two subagents for broader execution. Luna 1 remains the sole owner of
the frontend queue and test lane. Luna 2 has a separate backend lane limited to config,
trace export, Wikipedia reporting, Atlas graph/export, wiki-evidence, and their direct
tests. Neither worker may edit the other's files, quality policy, or the cluster AST-grep
rule. Root integrates only after each worker reports exact checks and reviews the diff.

Both lanes reached an independently verified checkpoint. Frontend TypeScript passes and
the focused queue/interaction suites pass 14 tests across three suites. The full frontend
suite passes 54 suites and 196 tests. Scoped lint still reports sidebar maintainability
warnings and findings in the expanded render-loop regression test; these are Luna 1's
next frontend slice. Backend Ruff and diff checks pass for the six owned source files;
an explicit-package-base mypy run exposes dependency errors in other files, so the
backend worker's targeted type claim remains scoped. Its targeted tests pass 25 cases by
report. Root will rerun exact checks after the next edits.

Luna 2 then fixed the live-cache test import order and made `_article_date_range` unpack
the SQLAlchemy Row before returning it, matching its declared tuple contract. Root
independently verified pinned Ruff, diff cleanliness for those files, and four live-cache
tests (with eight dependency deprecation warnings). The backend worker reports full
strict mypy at 23 errors in 13 files, down from 24 in 14; remaining diagnostics are
outside this slice. Existing broader database edits remain user/worktree context and
were not attributed to this fix.

Luna 2 next fixed two strict-mypy defects: recovery updates now pass only persisted
article IDs to the marking query, and queue overview counting accepts the Sequence
returned by SQLAlchemy. Root independently verified pinned Ruff, diff cleanliness, and
the recovery suite (2 tests pass with one dependency warning). The worker reports strict
mypy at 19 errors in 11 files, down from 21 in 13; no queue regression test existed for
the filtered-ID edge, so no fabricated test was added. Remaining backend errors are
outside the owned slices and still require later traced work.

Luna 2 cleared the OpenAI client `to_thread` overload in funding_researcher by binding
the existing call with stdlib `functools.partial`; model selection, kwargs, and error
handling remain unchanged. Root independently verified pinned Ruff, diff cleanliness,
and all 96 funding-researcher tests (one dependency warning). Strict mypy is reported
at 16 errors in nine files, down from 17 in ten; no funding_researcher diagnostic remains.

Luna 2 then corrected the Chroma distance-batch contract by accepting covariant nested
Sequences instead of forcing a mutable list variance mismatch. Root independently
verified pinned Ruff, diff cleanliness, and six relevant fallback/personalization tests
(all pass with eight dependency warnings). The worker reports strict mypy at 17 errors
in 10 files, down from 19 in 11; no `chroma_topics.py` diagnostic remains.

Luna 1 then removed the bespoke queue article type, the large controller type adapter,
the single-use Sheet wrapper, and a redundant history declaration. Root independently
verified TypeScript, diff cleanliness, four queue/render suites (26 tests), and combined
strict scoped Oxlint: zero errors and zero warnings. Sidebar counted lines fell from 540
to 497. Maintainability still reports 49 functions with three failures (worst MI 42.2)
and eight warnings, so lint closure is not MI closure. The next frontend work is limited
to the article-detail test warnings; no production queue behavior is being changed until
that review is complete.

Luna 2 then fixed semantic-search response typing by validating the existing canonical
dictionary through `CanonicalArticle.model_validate` before constructing
`SemanticSearchResult`. Root independently verified pinned Ruff, diff cleanliness, and
10 article/search tests (all pass with eight dependency warnings). The worker reports
strict mypy at 15 errors in eight files, down from 16 in nine; no search.py diagnostic
remains. Broader search-route contract edits in the dirty worktree predate this narrow
type-boundary fix and are not attributed to it.

Luna 2 then narrowed the funding-bias population claims without a cast: the claims map
is typed as `dict[str, EvidenceClaim]`, the lookup is guarded for absence, and the
validated claim ID is returned directly. Root independently verified pinned Ruff,
`test_funding_bias_analysis.py` (9 tests), and diff cleanliness. The worker reports
strict mypy at 14 errors in seven files, with no remaining funding-bias diagnostic.

Luna 2 then fixed the proof-suite exception import by importing `ProofBundleError` from
its defining `evidence_export_formats` module instead of relying on an implicit package
re-export. The worker verified pinned Ruff, 11 proof-suite tests, and diff cleanliness;
strict mypy is now 13 errors in six files, with no proof-suite diagnostic remaining.

Luna 2 then added a typed `CanonicalArticle.model_validate` boundary for persisted and
cached news responses. The existing dictionary helpers and JSON contracts remain intact;
only the response-model construction now matches its declared article type. Root
independently verified pinned Ruff, the article/byline/search/live-cache set (18 tests),
and a focused strict mypy run for `news.py`; all passed. The worker reports strict mypy
at eight errors in five files, with no remaining news-route diagnostic.

Luna 2 then normalized typed vector-search results with `dict(result)` at the existing
`list[dict[str, Any]]` response boundary. This preserves all result keys while matching
the declared contract without a cast. Root independently verified pinned Ruff, the
focused verification-output property tests (2 pass), and file-scoped strict mypy; all
passed. The worker reports strict mypy at seven errors in four files.

Luna 2 then made the replay-corpus predicate and lifecycle checks explicit booleans,
preventing `Any` from escaping their declared `bool` contract. Root independently
verified pinned Ruff, the four replay-corpus tests, and file-scoped strict mypy; all
passed. The worker reports strict mypy at five errors in three files.

Luna 2 then made the evidence-ingest adapter registry accept the existing covariant
`Mapping` contract instead of requiring an invariant `dict`. Dispatch and adapter
selection are unchanged. Root independently verified pinned Ruff, the focused ingest
tests (7 pass), file-scoped strict mypy, and diff cleanliness. The worker reports strict
mypy at four errors in two files.

Luna 2 then replaced the startup task helper's `object` plus type-ignore with the
stdlib `Coroutine[Any, Any, object]` contract accepted by `asyncio.create_task`.
Root independently verified pinned Ruff, the startup/leader tests (3 pass), file-scoped
strict mypy, and diff cleanliness. The worker reports strict mypy at three errors in
one file, all remaining in `news_research_agent.py`.

Luna 1 then completed the article-detail modal test slice: unnecessary async callbacks
were removed, value-returning mocks are wrapped at void boundaries, the long behavior
test is split into focused describes, and each test ends with a meaningful assertion.
Root independently verified the six-test suite, frontend TypeScript, strict scoped
Oxlint (zero errors and warnings), and diff cleanliness. Two low-MI anonymous test
callbacks remain, but the file has no lint findings. A separate review covers the
cluster-detail Promise.all structure, where the source already has broader debt.

Luna 1 then completed that cluster structure review. The per-article content loader is
now a named async function passed into `Promise.all`, so extraction stays concurrent and
the structural rule no longer sees an await nested in the aggregate expression. The
helper's parameter is explicitly readonly. Root independently verified the three
cluster-related suites (9 tests), frontend TypeScript, the file's baseline 102-error /
190-warning Oxlint count, and a direct AST-grep scan with no findings.

Luna 2 finished the backend typing lane by making article identity URLs nullable where
the normalizer can return no URL, narrowing the async database bridge to a list of
dictionaries, and validating non-string RAG payloads before returning them. Root
independently verified pinned Ruff, 24 news-research tool/stream/recovery tests,
file-scoped and full strict mypy (0 errors across 185 sources), and diff cleanliness.
The backend type gate is now green; broader lint and maintainability work remains.

Luna 2 then formatted the six files identified by the baseline Ruff format report,
without touching any other paths. Root independently verified pinned Ruff lint, the
full backend/app and backend/tests format check (315 files already formatted), strict
mypy (0 errors across 185 sources), and diff cleanliness. Backend static style and type
gates are green; complexity, MI, CRAP, and frontend lint remain open.

Root ran the full backend suite after the typing and formatting slices: 821 tests passed
and 3 were skipped. Two database-enabled pagination tests failed at the real PostgreSQL
connection (`localhost:5432` refused); the endpoint assertions allow a 500 when the
database is disabled, but the connection exception occurs before a response. No local
PostgreSQL service is available in this environment, so the exact external blocker is
logged in `papercuts.md` and those tests remain unverified until the test database runs.

Luna 2 repaired that boundary rather than skipping the tests: `/news/page` now converts
SQLAlchemy and raw connection `OSError` failures to a generic HTTP 500 while leaving
successful pagination and cache headers unchanged. Root independently verified Ruff,
formatting, strict mypy, and all nine pagination tests, including the unavailable-DB
cases. The full suite is queued once more to confirm no unrelated regressions.

## 2026-09-06 — Backend suite and contract refresh

- The rerun of the full backend suite passed 823 tests with 3 skips and 18 dependency
  warnings. The pagination connection-failure boundary now behaves as a documented 500,
  so the two previously failing unavailable-PostgreSQL cases are covered.
- `./scripts/scoop schema refresh` regenerated `backend/openapi.json` and
  `frontend/lib/generated/openapi.ts`; `npm run cli:schema:check` now reports the
  checked-in OpenAPI contract is current.
- CLI typecheck/tests and the Rust parser suite (45 unit tests) passed. The production
  Next build and the full frontend suite (54 suites, 196 tests) also passed.

## 2026-09-06 — Endpoint transport and frontend structure slices

- Root repaired the cache-refresh SSE consumer so a JSON event split across network chunks
  is buffered until a complete line arrives. `cache-refresh.test.ts` covers the split-line
  regression; the focused test passes. Semantic-search responses now cross an explicit
  validation boundary, cluster article mapping preserves category and tags, and endpoint
  exports are grouped at the file tail. The endpoint file still has one scoped max-lines
  warning; no lint rule or threshold was changed.
- The cluster-detail lane retained concurrent article loading while moving the awaited
  loader out of the aggregate expression. It also validates the two-article comparison
  shape, resets failed-request deduplication, and reuses source identity helpers. The
  structural AST finding is gone; focused cluster suites and TypeScript pass. Broad file
  debt remains (97 errors and 185 warnings under direct Oxlint).
- The grid lane deleted dead undefined render branches, removed a title-suffix assertion,
  fixed memo dependencies, replaced mutating sorts with `toSorted`, and passed explicit
  queue promises. CCCC and TypeScript pass; focused grid suites pass. The file still has
  84 errors and 159 warnings.
- The article-analysis lane restored the inline claim sidebar after an incomplete split,
  kept clipboard rejection handling, removed redundant state wrappers, narrowed readonly
  props, consolidated callbacks, and removed index keys. It has zero scoped Oxlint errors
  and 65 warnings; TypeScript and six focused tests pass. Four small components remain
  below MI 50.
- The source-intelligence lane converted local JSX declarations to the project convention,
  removed unused parser fields, and stopped using an array index in normalized error keys.
  The file fell from 992 to 939 lines and from 66 to 39 errors; TypeScript, CCCC, and two
  focused suites pass. Remaining errors are JSX performance, readonly parameters, and one
  key; no suppression was added.
- The app/page lane removed one diagnostic while preserving the route surface. Its CCCC
  report has no hard violations, TypeScript and five focused suites (23 tests) pass; the
  broad page still carries 72 errors and 143 warnings.

## 2026-09-06 — Current gate snapshot

- Full frontend Jest passes 55 suites and 197 tests; frontend TypeScript, the production
  Next build, Oxlint rule tests (204 tests), CLI schema parity, CLI typecheck/tests, Rust
  parser tests (45), dependency-cycle checks, pinned backend Ruff, and strict backend mypy
  pass. Full backend evidence remains 823 passed and 3 skipped.
- Direct Oxlint currently reports 2,560 errors and 5,389 warnings across 215 files
  (7,949 diagnostics). CCCC reports no hard violations, but maintainability measurement
  still finds 261 MI failures and 529 warnings across 4,151 functions.
- The duplication gate is still red because JavaScript is 3.41% duplicated lines (371 of
  10,868) against the existing 3% ceiling. The source-line gate also remains red for
  several oversized frontend files and four backend files. Neither gate was weakened.
- Chrome MCP could not connect because DevToolsActivePort is unavailable, so browser
  verification is still unperformed. The cleanup goal remains active.

## 2026-09-06 — Article/source mapping cleanup

- `frontend/lib/api/article.ts` now uses one non-empty text fallback helper, hoists the
  immutable source-country/bias/credibility maps, validates country names through small
  helpers, and keeps nullable article/source fields explicit. This removes repeated map
  construction and the file's lint errors without changing the wire-to-view contract.
- Root verified the API mapping, country mapping, browse-index suites (10 tests), frontend
  TypeScript, strict scoped Oxlint (0 errors/0 warnings), and diff cleanliness. The file
  has no maintainability failures; two mapping helpers remain below the final MI 60 target.

## 2026-09-06 — Queue, contradiction, and research state slices

- Luna 1 reduced `reading-queue-sidebar.tsx` from 521 to 485 counted lines by reusing the
  existing controller bundles and extracting digest/list projections. Queue/query/digest/
  render-loop tests (26) and TypeScript pass; scoped Oxlint and CCCC are clean. Final MI
  60 remains open for several small helpers, so this is not global maintainability closure.
- Luna 2 split contradiction claims, evidence, facts, loading, unavailable, and diversity
  states into meaningful render boundaries. `ContradictionPanel` now measures CC 5 and
  cognitive 4 with no CCCC violation and zero scoped Oxlint findings; the cluster comparison
  regression passes.
- Luna 1 split the research reducer into typed action-family reducers and removed redundant
  chat-preview copying. The reducer now measures CC 8/cognitive 3 with zero CCCC violations,
  zero scoped Oxlint findings, and three focused tests passing. Its explicit contracts add
  lines while removing the 25-branch complexity; five helpers remain in the intermediate MI
  band and require later consolidation if the final MI 60 gate is enforced.

## 2026-09-06 — Dashboard and trend slices

- Luna 1 removed obsolete selector/query-loader/filter/handler pass-through layers from
  `frontend/app/debug/debug-dashboard.tsx` and replaced recursive generated prop boundaries
  with narrow readonly contracts. The file remains large (3,520 lines) and reports 42
  errors and 336 warnings under direct Oxlint, but the missing selector reference is fixed;
  TypeScript and the full frontend suite (54 suites, 196 tests) pass.
- Luna 2 converted `TrendingFeed` to the local component convention, reused the canonical
  article mapper, removed its duplicate image helper, and preserved nullable cluster data
  with nullish fallbacks. Its scoped Oxlint count is 38 errors and 87 warnings (down from
  39/89); the cluster-display regression passes and no wire contract changed.
- Root reran the focused interaction set (7 suites, 23 tests), the full frontend suite,
  TypeScript, and `git diff --check`; all passed. Browser verification remains unavailable
  because Chrome MCP cannot connect in this environment.

## 2026-09-11 — Select and table wrapper checkpoint

Status: active. The select and table wrapper slices now have zero direct Oxlint
diagnostics after replacing prop spreads with explicit current caller contracts.
The existing dirty file refactors were preserved in place rather than committed
with unrelated changes. The case-insensitive comparison property generator fix is
committed as `f31f258`.

Evidence:

- Whole direct Oxlint: 1,475 findings, 10 errors, 1,465 warnings; frontend 82
  warnings and scripts 1,393 findings.
- Frontend Jest: 56 suites and 199 tests passed.
- Frontend TypeScript: passed.
- Baseline progress: 6,474 of 7,949 findings cleared, 81.44% cleared, 18.56%
  remaining.

Open gates: strict maintainability, source-line cap, dead-code, CRAP, repository
self-test, and browser verification. Scripts lint cleanup remains intentionally
skipped.

## 2026-09-11 — Globe boundaries and blindspot fixture checkpoint

Status: active. Globe scene, lifecycle, material, and uniform helpers now use
small capability views at mutable Three.js boundaries. The blindspot test keeps
the same behavior while moving typed fixture construction and setup into bounded
helpers. Commits `21aa2e4`, `8f56321`, `fc6038e`, `51b5e43`, and `e8713a5` cover
the isolated changes; `c21c8e7` covers stream continuation cleanup.

Evidence:

- Whole direct Oxlint: 1,446 findings, 10 errors, 1,436 warnings; frontend 53
  warnings and scripts 1,393 findings.
- Frontend Jest: 56 suites and 199 tests passed.
- Frontend TypeScript: passed.
- Baseline progress: 6,503 of 7,949 findings cleared, 81.81% cleared, 18.19%
  remaining.

Open gates: strict maintainability, source-line cap, dead-code, CRAP, repository
self-test, and browser verification. Scripts lint cleanup remains intentionally
skipped.

## 2026-09-11 — Modal, navigation, and wrapper checkpoint

Status: active. Modal content/body, tooltip, and scroll-area prop boundaries now pass
explicit current caller props. Global navigation, browse index, and live browse index
tests are table-driven with the original behaviors and assertions. Globe scene context
and provider children use narrower contracts. The isolated commits are `3f8e486`,
`bea7be3`, `18e6285`, `ec11894`, `7079129`, `317ecb2`, `1aa6608`, and `410b70c`.

Evidence:

- Whole direct Oxlint: 1,435 findings, 10 errors, 1,425 warnings; frontend 42 warnings
  and scripts 1,393 findings. Scripts remain outside the active lint scope by explicit
  user instruction.
- Frontend Jest: 56 suites and 199 tests passed.
- Frontend TypeScript and focused changed-scope checks passed.
- Baseline progress: 6,514 of 7,949 findings cleared, 81.95% cleared, 18.05%
  remaining.

Open gates: strict maintainability, source-line cap, dead-code, CRAP, repository
self-test, and browser verification. The documented self-test timeout remains an open
gate; no new attempt was made during this checkpoint.

## 2026-09-11 — Modal boundary extraction checkpoint

Goal and done criteria: continue the lean-codebase plan, reduce active frontend findings with
behavior-preserving slices, verify changed runtime paths, preserve unrelated dirty work, and
record exact whole-project counts.

Status: active. The article modal hero source links and visual renderer now live in a focused
module, and the modal overlay group now has its own boundary. Pagination test cases were split
into named runners and committed as `8380fc6`. The modal files remain in the worktree alongside
pre-existing dirty refactors so those changes can be staged separately.

Evidence:

- Whole measurement `8fce51b1b6cb9f754b401d5e.json`: 1,424 Oxlint findings, 10 errors and 1,414
  warnings; frontend 31 warnings and scripts 1,393 findings.
- Baseline progress: 6,525 of 7,949 findings cleared, 82.09% cleared and 17.91% remaining.
- Focused type-aware Oxlint and frontend TypeScript pass for the modal extraction.
- `npm test -- --runInBand __tests__/article-detail-modal.test.tsx`: 1 suite and 6 tests passed.
- The last full frontend run remains 56 suites and 199 tests passed.

Assumptions and risks: scripts remain outside active lint cleanup by explicit user scope. The
current checkout contains substantial user-owned dirty refactors; only isolated clean files have
been committed. The direct CRAP adapter reports no violations but coverage is incomplete, so the
repository CRAP gate is not claimed closed.

Remaining failures or blockers: strict maintainability, source-line cap, dead-code, CRAP
completion, repository self-test, and browser verification remain open. The repository verifier
has previously exceeded the practical run window while its type-aware worker stayed CPU-active.

Rollback or next executable step: inspect the 31 frontend findings from the saved measurement,
starting with clean or clearly bounded modules; use focused staging for dirty files, then rerun
the full frontend suite and a fresh repository measurement before the next checkpoint.

## 2026-09-11 — Frontend warning queue cleared

Goal and done criteria: clear the remaining active frontend Oxlint findings with behavior-preserving
module splits, verify API and UI callers, preserve unrelated dirty work, and record exact counts.

Status: the 18 remaining frontend warnings are cleared. Commit `8b6f8b2` splits the API endpoint
and type barrels and the organization wiki view. The direct frontend census is 0 errors and 0
warnings. The combined `frontend scripts` census remains 1,393 findings: 10 errors and 1,383
warnings; scripts remain excluded by explicit user scope.

Files changed: `frontend/lib/api/endpoints.ts` and its five focused modules; `frontend/lib/api/types.ts`
and its four focused modules; and the organization view, types, parts, and sidebar modules.

Commands and tests: type-aware Oxlint over the changed modules; frontend `tsc --noEmit`; eight
affected Jest suites with 27 tests; whole `frontend scripts` Oxlint census; and staged
`git diff --cached --check` all passed, except the expected whole-scope Oxlint exit caused by the
remaining script findings.

Assumptions and risks: scripts lint cleanup remains intentionally skipped. The worktree still
contains unrelated user-owned WIP, which was left unstaged. The project-wide maintainability,
source-line, dead-code, CRAP, repository self-test, and browser gates remain open.

Rollback or next executable step: revert `8b6f8b2` to restore the pre-split module layout, or
continue with the non-lint quality gates while keeping `scripts/` outside the active queue.

## 2026-09-11 — Frontend reachability cleanup checkpoint

Goal and done criteria: remove proven unused frontend files, dependencies, and public exports in
small batches; preserve user WIP; verify lint, types, tests, and exact project counts.

Status: active. Commit `7465956` removes `frontend/lib/json-value.ts`,
`frontend/lib/type-guards.ts`, `@tanstack/react-virtual`, and unused exports from 39 other clean
tracked modules. The modal data WIP and untracked debug, response-schema, settings, and stream
modules were restored and left unstaged.

Evidence:

- Direct frontend Oxlint: 0 diagnostics, 0 errors, 0 warnings.
- Whole direct Oxlint: 1,393 diagnostics, 10 errors and 1,383 warnings; every finding is under
  `scripts/`.
- Baseline progress: 6,556 of 7,949 findings cleared, 82.48% cleared, 17.52% remaining.
- Error progress: 2,550 of 2,560 cleared, 99.61% cleared, 10 remaining.
- Warning progress: 4,006 of 5,389 cleared, 74.34% cleared, 1,383 remaining.
- Package-local Knip: 0 unused files, 0 unused dependencies, one intentional CRAP dependency
  finding, 31 exported values, and 12 exported types.
- Frontend TypeScript: passed.
- Full frontend Jest: 56 suites and 199 tests passed.

Assumptions and risks: scripts lint remains outside the active user scope. Knip findings in
preserved WIP and the modal data reexport were not changed. The repository still has open
maintainability, source-line, CRAP, self-test, and browser gates.

Remaining failures or blockers: the 10 script errors and 1,383 script warnings are intentionally
skipped; the repository self-test previously hung in its type-aware worker; browser verification
is unavailable; strict maintainability and CRAP completion remain unverified.

Rollback or next executable step: revert `7465956` to restore the removed utilities, dependency,
and exports, or continue with the remaining non-lint quality measurements while preserving dirty
WIP boundaries.
