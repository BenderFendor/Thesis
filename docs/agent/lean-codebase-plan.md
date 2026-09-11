# Lean codebase audit and implementation plan

Audit date: 2026-09-04, America/New_York. Measurements were collected after midnight UTC on September 5.
Starting commit: bc93b24f7cd134c49a79927f768b682c28839dac.
Branch: quality/crap-mi-oxlint-hardening, 56 commits ahead of its configured upstream.

Status: audit and plan recorded; implementation is active across bounded frontend and
backend slices. At the user's request, two Luna subagents work in separate ownership lanes;
the root agent steers, reviews, verifies, and maintains this record. The latest lanes cover
cluster-detail, grid, article-analysis, source-intelligence, and globe surfaces; root also
repaired API endpoint validation/SSE buffering and the app/page shell. Workers preserve
unrelated user changes and report evidence before handoff. The goal remains active, not
complete; global lint, maintainability, CRAP, duplication, source limits, runtime, and
browser closure still require substantial work.
Historical recovery checkpoint: TypeScript and 20 focused regressions passed while the
sidebar still had three scoped lint errors and six warnings. That checkpoint led to the
controller-wiring repair below; it is retained as history, not as current status.
Current checkpoint: the queue/sidebar lane has zero scoped Oxlint errors or warnings and
485 counted lines after deleting redundant type adapters and a single-use wrapper. Its
maintainability failures are cleared (worst MI 50.4), but final MI 60 remains open for
the touched helpers. The debug-dashboard lane removed obsolete selector/query-loader and
pass-through layers, narrowed prop contracts, and now reports 42 errors and 336 warnings
in its 3,520-line file; TypeScript and the full 55-suite/197-test frontend run pass. The
trending-feed lane removed a dead image helper and normalized nullable data handling; it
reports 38 errors and 87 warnings with its focused regression passing. The endpoint lane
validates semantic-search payloads, preserves category/tag fields, buffers split SSE
events, and has one scoped max-lines warning. The backend lane has reduced strict mypy to
zero errors through traced fixes; pinned Ruff lint and format gates are green for
backend/app and backend/tests. The full backend suite is green at 823 passed and 3 skipped.
The 2026-09-06 recorded direct Oxlint baseline was 2,560 errors and 5,389 warnings across 215 files (7,949 total);
CCCC has no hard violations, while MI reports 261 failures and 529 warnings across 4,151
functions. Complexity, final MI/CRAP, duplication, source limits, broader runtime, and
browser gates remain open.
The article-detail modal regression lane now has zero scoped Oxlint errors, six tests pass,
and frontend TypeScript passes; two boundary warnings remain. The cluster-detail Promise.all warning is
resolved by extracting the per-article loader while retaining concurrent requests. The
cluster file remains at its baseline 102 Oxlint errors/190 warnings and low MI; no global
lint claim is being made.
The full backend suite initially reached 821 passed and 3 skipped, with two pagination
tests exposing an unhandled unavailable-database exception. The route now translates
SQLAlchemy and connection `OSError` failures into a generic HTTP 500; the rerun reached
823 passed and 3 skipped.
The canonical OpenAPI artifact and generated TypeScript were refreshed, and CLI schema
parity now passes. Article mapping now hoists immutable source lookups and has no scoped
Oxlint findings; contradiction rendering is split into state/claim/fact sections with
zero scoped Oxlint findings and no CCCC violation. These are bounded slices, not global
lint or final maintainability closure.
## 2026-09-10 — Pulled remote and frontend cleanup checkpoint

The branch fast-forwarded to remote commit `596ecc9` before restoring the user's retained
worktree changes. The article-detail modal orchestration was split into focused data,
operations, state, model, and highlight modules in commit `0cf1299`. The focused modal
regression passes 6/6 tests, frontend TypeScript passes, and the changed files have no
Oxlint errors. Two warnings remain at the deliberate view prop boundary: one readonly
parameter warning in the model factory and one JSX spread warning at the typed view handoff.

The live direct scan after that checkpoint reports 364 frontend warnings and 0 errors across
505 files. The whole scan reports 1,757 findings: 8 errors and 1,749 warnings, with 1,393
findings in `scripts/` and 364 in `frontend/`. Per the user's scope decision, scripts remain
outside the active cleanup queue; their lint rules and configuration remain unchanged, so the
whole-repository gate is still open. Against the recorded 7,949-finding plan baseline, this
is 6,192 cleared (77.89%) and 1,757 remaining (22.11%). This is a lint-only progress measure;
MI, CRAP, duplication, source limits, full runtime, and browser gates remain open.
This is a repository-wide work queue. A completed phase does not mean the whole cleanup is complete.

## 2026-09-11 — Current pulled-checkout checkpoint

The active branch remains `quality/crap-mi-oxlint-hardening`, with the latest code checkpoint
commit `1a26888` and this evidence record committed in `f3b35a7`. After the remote fast-forward to `596ecc9`, the retained WIP was preserved
and the user-authorized frontend cleanup continued in bounded commits. The latest slices
covered research side-panel rendering, index-test wrappers, globe live-data tests,
navigation state, blindspot interaction selection, and Jest configuration typing.

The fresh direct Oxlint census reports 156 frontend warnings and 0 frontend errors across
44 files with findings. The combined `frontend scripts` scan reports 1,549 findings:
10 errors and 1,539 warnings. `frontend` contributes 156 warnings; `scripts` contributes
1,393 findings (10 errors and 1,383 warnings). Per the user's explicit scope decision,
scripts remain outside the active cleanup queue and their lint configuration is unchanged.

Against the plan baseline of 7,949 direct findings, 6,400 are cleared and 1,549 remain:
80.51% cleared and 19.49% remaining. Relative to the post-pull checkpoint of 364 frontend
warnings and 1,757 combined findings, the current work removed 208 frontend warnings and
208 total findings. That is a 57.14% reduction in the active frontend warning queue and
an 11.84% reduction in the combined count; the whole-project percentage is held back by
the intentionally skipped scripts scope. These are lint-only percentages.

Verification at this checkpoint: full frontend Jest passes 56 suites and 199 tests;
frontend TypeScript and the production Next build pass; the 13 Oxlint rule files pass
204 tests; dependency cycles pass with 0 frontend cycles and no backend cycles; and
duplication passes at 1.04% with 118 clones. The file-line gate still fails on
`frontend/app/search/research/hooks/use-research-controller.ts` (1,157 lines) and
`frontend/lib/api/endpoints.ts` (1,082 lines). Dead-code analysis still reports two
unused files, one unused dependency, one unused dev dependency, and reviewed unused
exports/types. Strict maintainability reports 6,051 functions, 150 failures below MI 50,
and 875 warnings below MI 60. The full `scripts/self-test` reached the repository
quality verifier but was stopped after ten minutes without output while its type-aware
worker remained CPU-active; direct scans and independent gates above are the retained
evidence. Browser verification remains unavailable.

Checkpoint commits include `c610410`, `09f42d3`, `125bb79`, `bd79ea4`, `3eaae7a`, and
`1a26888`. The goal remains active; frontend warnings, maintainability, CRAP, source-line,
dead-code, browser, and the user-excluded scripts lint work are not complete.

## 2026-09-11 — Research controller extraction checkpoint

The next largest frontend cluster was the 1,157-line research controller. Commit `71e0a5e`
split its existing state, prompt submission, chat actions, persistence, derived state,
message actions, transport, and view-prop assembly into nine focused hook modules without
changing the page entry point. Commit `0193f7b` removed three exports that the live dead-code
scan identified as private implementation details.

The post-change direct Oxlint census reports 142 frontend warnings and 0 errors across
42 files with findings. The combined `frontend scripts` census reports 1,535 findings:
10 errors and 1,525 warnings. Frontend contributes 142 warnings; scripts contribute
1,393 findings (10 errors and 1,383 warnings). Scripts remain outside active cleanup by
explicit user scope, with their lint configuration unchanged.

Against the 7,949-finding plan baseline, 6,414 findings are cleared and 1,535 remain:
80.69% cleared and 19.31% remaining. Relative to the post-pull 364-frontend-warning and
1,757-combined-finding checkpoint, this slice removed 222 frontend warnings and 222 total
findings: a 60.99% reduction in the active frontend queue and a 12.64% reduction in the
combined count. These are direct-lint percentages only.

Verification: the full frontend Jest suite passes 56 suites and 199 tests; frontend
TypeScript passes; the production Next build compiles and generates all 12 pages; the
research hook directory has zero direct Oxlint diagnostics; and `git diff --check` passes.
The file-line gate now has one over-limit file, `frontend/lib/api/endpoints.ts` at 1,082
lines against the 1,057 debt cap. Dead-code still reports two unused files, one unused
dependency, one unused dev dependency, 71 unused exports, 30 unused exported types, and
11 configuration hints. Strict maintainability now reports 6,074 functions, 144 failures
below MI 50, and 882 warnings below MI 60. A repeat `scripts/self-test` from this
checkpoint reached `node scripts/quality-hardening.mjs verify --scope repo`, produced no
output for about 4.5 minutes, and was stopped with exit 130 while its type-aware worker
remained CPU-active. Browser verification remains unavailable.

The goal remains active. The next bounded frontend queue is the globe scene/material
cluster, followed by the remaining UI warnings and the open MI, CRAP, dead-code,
duplication, source-line, runtime, browser, and scripts-excluded gates.

## 2026-09-11 — Globe view and scene checkpoint

Commit `07cc7fa` saved the verified globe source and test cluster. The former globe view
and interactive scene ownership now live in focused view, state, workspace, adapter,
lifecycle, shader, material, and scene modules. The scene setup file has zero direct
Oxlint diagnostics after replacing generic recursive readonly attempts with narrow
capability views and explicit uniform mutation callbacks. Three.js mutation boundaries
that still require mutable parameters remain visible in the direct cluster count.

The fresh direct Oxlint census reports 121 frontend warnings and 0 errors across 41 files
with findings. The combined `frontend scripts` census reports 1,514 findings: 10 errors
and 1,504 warnings. Frontend contributes 121 warnings; scripts contribute 1,393 findings
(10 errors and 1,383 warnings). Scripts remain outside the active cleanup queue by the
user's explicit scope, and no scripts lint rule or configuration changed.

Against the 7,949-finding plan baseline, 6,435 findings are cleared and 1,514 remain:
80.95% cleared and 19.05% remaining. Relative to the post-pull checkpoint of 364
frontend warnings and 1,757 combined findings, this slice removed 243 frontend warnings
and 243 combined findings: a 66.76% reduction in the active frontend queue and a 13.83%
reduction in the combined count. These are direct-lint percentages only.

Verification: the focused globe suites pass 2 suites and 5 tests; full frontend Jest
passes 56 suites and 199 tests; frontend TypeScript passes; the production build passes
and generates 17 routes; dependency cycles pass with 0 frontend and 0 backend cycles;
duplication remains 1.04% with 118 clones; and `git diff --check` passes. The line gate
still has only `frontend/lib/api/endpoints.ts` over cap at 1,082 lines versus 1,057.
Strict maintainability reports 6,077 functions, 144 failures below MI 50, and 882
warnings below MI 60. Dead-code remains at 2 unused files, 1 unused dependency, 1 unused
dev dependency, 71 unused exports, 30 unused exported types, and 11 configuration hints.
The repository self-test remains an open gate after the documented type-aware verifier
run window, and browser verification remains unavailable.

The next bounded frontend queue is `frontend/components/highlight-toolbar.tsx` at 14
warnings, followed by the UI sheet/select/table surfaces. The goal remains active.

## 2026-09-08 — Confirmed codemod checkpoint

The [confirmed codemod audit](../agents/traces/confirmed-codemods-2026-09-08.md)
covers every phase below and all 131 rules in the live before/after census.
Applied Knip export/type cleanup, two proven-unused file deletions, symbol-aware
private-declaration removal, unused-import cleanup and reviewed native lint fixes.
The new runner is `node scripts/codemod-lean.mjs`, with `--apply` required to write.

Direct Oxlint moved from 5,550 findings (1,059 errors) to 5,382 (1,022 errors).
Frontend source decreased by 51,420 bytes and 1,271 nonblank lines across 216 modified
files and two deletions. Knip has no remaining unused frontend files or exports/types;
its required external analyzer dependency finding is retained, not suppressed.

Variable-declaration splitting and prop-builder inlining were tried, measured and
reverted where they worsened maintainability. They are not delivered runner options.
The required-undefined native fix was also rejected after TypeScript exposed it.
Frontend tests, TypeScript and build pass; full repository quality remains failed,
and Chrome browser verification is unavailable. This is not phase-16 closure.

## 1. Observable outcome

Make the existing app easier to change by removing unused implementation, duplicate state,
unnecessary conversion layers, repeated presentation logic, and broken tooling.
Preserve every working feature listed in section 4. Fix reproducible behavior and performance
bugs encountered along those paths.

Completion requires:

- Zero Oxlint errors and warnings under the existing rules.
- Zero CCCC violations: cyclomatic complexity at most 10 and cognitive complexity at most 15.
- No owned frontend function below MI 60. Also measure owned JavaScript tooling through the
  controller; do not silently present the frontend-only MI gate as a repository-wide metric.
- Fresh, attributable CRAP coverage. Reach the existing controller ceiling of 8 and final
  target of 6; retain explicit unmapped-method accounting. An N/A score is not a pass.
- No verified unused source files, public exports, or dependencies remaining in the audited scope.
- Duplication stays below the existing 3% gate, with repeated business logic removed where a
  shared implementation actually reduces code and preserves differences.
- Typechecks, behavior tests, schema parity, Rust checks, source limits, build, and full
  scripts/self-test pass.
- Changed user journeys work at desktop and mobile sizes, including failure states.
- Source bytes, nonblank source lines, public exports, and dependency counts are reported
  against this starting worktree. File splitting alone does not count as deletion.
- No feature or data loss, no threshold increases, no new ignores, no suppression comments,
  no reduced test discovery, and no manufactured coverage.

There is no defensible exact minimum line count for this app before its remaining callers
are traced. Use the above contracts and a verified deletion ledger instead of promising an
arbitrary percentage cut.

## 2. Starting state and audit limits

The worktree already contains 76 changed tracked paths, plus substantial untracked application
code and tests. Its tracked diff is approximately +18,430 / -28,725 lines. Those changes
belong to the user and are the baseline, not cleanup performed by this plan.

The inventory includes 966 existing tracked or nonignored untracked paths, 744 source files,
and approximately 191,665 source lines, excluding generated OpenAPI TypeScript.
The line inventory uses newline splitting, so files ending with a newline may differ by one
line from the repository line-limit gate. There are 76 Markdown files; their audiences and
links matter more than the count.

Baseline capture:

- Original tracked patch: /tmp/thesis-lean-audit-fjXLYj/initial.patch.
- Original complete Git status: /tmp/thesis-lean-audit-fjXLYj/initial-status.txt.
- Direct reports: /tmp/thesis-lean-audit-fjXLYj/.
- Controller measurement: qh-measure:8db7772c9523068f93399b28.
- Controller raw record: .quality-hardening/measurements/8db7772c9523068f93399b28.json.

The static census covered the configured source roots. The audit also read route registration,
manifests, native verification commands, existing tests, the shared API client, article mapper,
research reducer, queue queries, saved-item routes/helpers, quality adapters, and representative
sections of the largest controllers and services. Remaining files in the annex are measured
candidates, not claims that every function has received a line-by-line semantic review.
Each implementation phase must finish that review before editing its files.

### Baseline gates

| Check                        | Observed result                                                                                    | Scope or limitation                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Frontend TypeScript          | Pass, zero diagnostics                                                                             | frontend/tsconfig.json, including its tests                  |
| Direct Oxlint                | 2,816 errors, 5,810 warnings; 8,626 total                                                          | frontend and scripts, 321 analyzed files                     |
| Controller Oxlint            | 2,596 errors, 6,262 warnings                                                                       | Controller's explicit selected paths differ from direct lint |
| CCCC                         | 6 hard violations, 10,901 functions, 703 files; no parse errors                                    | Native backend/frontend/scripts census                       |
| Frontend MI                  | 4,075 functions; 235 below 50; 487 in [50,60); minimum 18.6                                        | code-multivitals 1.6.2                                       |
| Existing CRAP input          | 55 measured methods, 2,547 unknown; 15 measured above 8; max 56                                    | Invalid as a current whole-frontend coverage baseline        |
| Duplication                  | Pass: 116 clone groups, 2,186 duplicated lines, 1.15%                                              | 700 files; shared behavior still needs semantic review       |
| Native Knip                  | 1 unused file, 36 value exports, 79 type exports, 1 duplicate export group, 1 dependency candidate | Component-entry wildcard hides some dead components          |
| Controller policy validation | Pass                                                                                               | Configuration parses; does not prove runtime enforcement     |
| Full scripts/self-test       | Failed after 358.53 seconds                                                                         | Wrapper dropped --json; individual checks recovered below    |
| Fresh Jest coverage          | Pass: 51 suites, 176 tests; 38.19% lines, 26.78% functions                                            | Separate audit output directory, preserving prior coverage   |
| Fresh CRAP                   | 2,409 measured, 193 unknown; 680 above 8; 154 above 30; maximum 272                                  | 2,602 methods, plus 2 structural N/A entries                  |
| Browser                      | Chrome MCP cannot connect: missing DevToolsActivePort                                              | Browser verification remains unperformed                     |

Direct lint and controller lint totals must remain separate until their source lists are
reconciled. Different analyzers also count branches differently. For example, the research
reducer is CC 25 in CCCC and CC 24 in code-multivitals. Compare an analyzer only with itself.

Recovered baseline checks: CLI schema parity, Ruff lint, Rust Clippy, and Rust formatting
passed. CLI typecheck, CLI tests (11/12), import integrity, source line limits, backend mypy
(31 errors in 20 files), and Ruff formatting (6 files) failed. The import check invoked a
JavaScript file with Bash; changing its executable to Node repairs execution, not policy.
The CLI source census test still expected the removed frontend/lib/api.ts file.

Fresh coverage and CRAP artifacts are in /tmp/thesis-lean-audit-fjXLYj/coverage/ and
/tmp/thesis-lean-audit-fjXLYj/crap-fresh.json. Fresh CRAP has 696 methods above the final
target of 6. Unknown mappings remain explicit: 36 function-map conflicts and 157
unattributed statement mappings. These results supersede the stale single-file CRAP input,
not the recorded starting source inventory.

### Six CCCC violations

| File                                                   | Function               |  CC | Cognitive | Planned repair                                                                              |
| ------------------------------------------------------ | ---------------------- | --: | --------: | ------------------------------------------------------------------------------------------- |
| frontend/app/search/research/state/research-reducer.ts | researchReducer        |  25 |        12 | Separate typed value assignment from compound chat transitions; preserve functional updates |
| frontend/components/reading-queue-card.tsx             | QueueCard              |  16 |        13 | Derive card facts once and give actions and summary their own cohesive rendering            |
| frontend/components/contradiction-panel.tsx            | ContradictionPanel     |  14 |        13 | Separate loading/empty state from evidence and claim sections                               |
| frontend/components/reading-queue-queries.ts           | useReadingQueueQueries |  14 |         9 | Use existing request helpers, stable query inputs, and one error contract                   |
| frontend/components/story-lineage-panel.tsx            | StoryLineagePanel      |  12 |        11 | Separate lineage/correction rendering with unchanged evidence links                         |
| frontend/lib/api/article.ts                            | mapBackendSource       |  12 |         8 | Compute source identity/default facts once; preserve null/empty distinctions                |

## 3. Confirmed bugs and measurement defects

### B01. Non-JSON HTTP errors become unrelated TypeErrors

File: frontend/lib/api/client.ts, api and readErrorMessage.

The error branch catches JSON decoding failure and substitutes null, then asserts that value
to ApiErrorBody and dereferences payload.detail. JSON null does the same thing.

Reproduction used the production client transpiled by the installed TypeScript compiler with
real Response objects at the fetch boundary:

- HTTP 502 with body "not-json": TypeError, cannot read properties of null.
- HTTP 502 with body "null": the same TypeError.
- HTTP 502 with a string detail: ApiError with status 502.

Repair: validate the error envelope at this boundary using the installed schema tooling or a
small precise guard. Preserve the HTTP status and useful string detail. Invalid/empty/HTML
bodies must produce an ApiError with a status-based message. Preserve fetch rejection and
AbortError behavior. Check FastAPI validation-detail arrays rather than assuming all details
are strings.

Regression: invoke the real client with valid JSON, null, malformed text, nonstring detail,
and a rejected/aborted fetch. Assert error type, status, and message.

### B02. Complexity subprocess failures are accepted as success

File: scripts/quality-hardening/adapters/cccc.mjs, normalizeProcessResult.

Node's close event supplies [code, signal]. The adapter reads the last element, which is
normally null, and Number(null) becomes zero. A subprocess emitting valid report JSON and
exiting 7 was accepted by the real runCccc adapter during this audit.

Repair: consume the exit-code element, reject signal termination/missing exit status, and
preserve the deliberate acceptance of CCCC's findings exit status. Prefer the existing
Node subprocess primitives over the oversized callback/stream helper object where possible.

Regression: real tiny child processes for successful report, findings status, exit 7,
signal termination, malformed JSON, and output-limit failure. Test behavior through runCccc.

Related defect to verify in the same phase: languageForPath currently identifies .py source
as ecmascript. Correct language identity without changing existing unit IDs blindly; review
the ledger migration implications first.

### B03. The MI CLI truncates its machine-readable output

File: scripts/check-maintainability.mjs.

The piped JSON report was cut at exactly 65,536 bytes. The command calls process.exit()
immediately after console output. Redirecting stdout to a regular file recovered the complete
4,075-function result.

Repair: use natural process shutdown with process.exitCode. In JSON mode emit one valid JSON
document; send optional human diagnostics to stderr or omit them in that mode.
Retain existing failure thresholds while making the configured final MI target enforceable
through the existing policy. Do not introduce a second analyzer.

Regression: collect the CLI through a pipe with output larger than a pipe buffer, parse the
whole report, and assert exit status on passing and failing inputs.

### B04. CRAP reuses stale, single-file coverage

Files: scripts/check-crap.mjs; scripts/quality-hardening/adapters/crap.mjs;
scripts/quality-hardening/measure.mjs; frontend/jest.config.js.

The existing frontend/coverage/coverage-final.json is dated 2026-09-02 and contains exactly
one file, frontend/components/interactive-globe.tsx. The installed analyzer's ensureCoverageReport
returns an existing report without generating new coverage. This explains the 55 mapped methods
and 2,547 unknown methods in the current controller report.

Repair: have the existing verification workflow generate coverage for the exact owned source
scope before CRAP, then attribute the coverage to that source snapshot. Reuse package support
for an explicit coverage path. Keep scoped fast checks scoped; final verification must use a
fresh full report. No N/A-to-zero conversion and no inferred test coverage.

Regression: a missing/stale/incomplete report cannot satisfy repository completion; an
explicit fresh report can be consumed by both CRAP entry points. Assert all expected files
are represented, and investigate unmatched method ranges separately.

### B05. Analysis success is confused with quality success

Files: scripts/quality-hardening/measure.mjs; scripts/check-maintainability.mjs;
quality-hardening.config.json; scripts/check-crap.mjs.

measureMi labels a successful analyzer invocation as passed even when low MI is reported,
and the measurement verification list does not include MI. The separate strict MI CLI catches
scores below 50, but does not enforce the configured final floor of 60. Standalone CRAP defaults
to 30 while the controller uses 8 and policy names 6 as the target.

Repair: use the existing policy as the source of thresholds, distinguish analyzer execution
from threshold compliance, and make final verification check the final targets. Test the
threshold boundary values. This tightens enforcement; it must not reduce any requirement.

### B06. Knip's component wildcard obscures reachability

File: frontend/knip.json.

Every components/**/*.tsx file is configured as an entry. Entry files are assumed to be roots,
so an orphan component can remain invisible. Package-local execution is also essential:
running from the repository root with a directory option produced false unused-test findings.

Repair: audit with real Next entry points and recognized test/config entry points. Cross-check
dynamic imports, worker URLs, CSS assets, and route exports. Keep the native package-local
command. Do not delete tests or tooling dependencies because a mis-scoped invocation calls
them unused.

The reported @barney-media/crap-typescript dependency is used by the root CRAP script and the
controller command. It is a cross-package reference, not an approved deletion.

### Behavior hypotheses requiring regression proof

| Candidate                                                    | Evidence inspected                                                                           | Required proof before fixing                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Queue digest fails on special category names                 | groupDigestArticles indexes a plain object, then calls push; category is input text          | Exercise constructor, toString, and **proto** through the real digest action                             |
| Queue reports analysis failure before a request fails        | analysisQuery.error is compared with undefined, although the query error default may be null | Render the actual hook with a fresh QueryClient and inspect loading, success, failure                    |
| Queue query returns undefined as successful data             | Full-text helper returns undefined on HTTP/schema failure                                    | Exercise the hook and verify React Query's response/error contract                                       |
| Article defaults allocate repeated maps                      | Country, bias, and credibility maps are constructed inside per-article helpers               | Measure a representative 10,000-article mapping pass; hoist immutable lookup data                        |
| Unknown publication times look newly published               | resolveArticlePublished falls back to the current timestamp                                  | Test missing-date identity, sorting, and display; agree a stable existing unknown-date representation    |
| Debug tab selection refetches twice                          | Tab-specific enabled queries coexist with explicit refreshDebugTab/loaders                   | Count requests while switching tabs before deleting any refresh path                                     |
| Source identity is reconstructed differently across surfaces | Mapper, saved items, source filters, wiki paths all normalize source labels                  | Run aliases, numeric IDs, missing IDs, punctuation, and unknown-source cases                             |
| Queue duplicate lookup ignores user_id                       | add_to_queue checks article_url alone while some other operations scope user_id              | Test the existing API's actual ownership contract; preserve local single-operator behavior               |
| Unbounded or blocking backend work                           | Large ingestion, resolver, vector-store, and indexer service paths                           | Use existing loop-block, readiness, request-count, and benchmark tests before claiming a performance bug |

## 4. Features that must survive

| Feature surface             | Current implementation anchors                                                                    | Preservation checks                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Main browse workspace       | frontend/app/page.tsx; grid-view.tsx; feed-view.tsx; use-news-index.ts                            | Category, source, country and lens filters; sorting; pagination; view URL; empty/error/loading states               |
| Live feed                   | live-news-view.tsx; stream-card.tsx; useNewsStream.ts; backend stream/news routes                 | Initial cache, incremental articles, deduplication, disconnect/reconnect, category sentinel                         |
| Globe                       | globe-view.tsx; interactive-globe.tsx; globe-ui-state.ts; globe-view-model.ts; globe-workspace.ts | Country selection, expanded/collapsed panels, lighting, heat layers, source links, no data, resize                  |
| Trends and topic clusters   | trending-feed.tsx; cluster-detail-modal.tsx; cluster-display.ts                                   | Ordering, comparison selection, article links, source diversity, stale requests                                     |
| Blindspots                  | blindspot-view.tsx; backend/app/services/blindspot_viewer.py                                      | Bias/credibility/geography lenses, selected sources, explanations, paywall concentration, unavailable embeddings    |
| Reader                      | article-detail-modal*.tsx; use-article-detail.ts; article-content.ts; highlight-store.ts          | Extraction, source/reporter sheets, analysis, highlights, notes, embedded articles, keyboard focus and close        |
| Queue and saved workspace   | reading-queue-_.tsx; saved/_; use-reading-queue.ts; backend reading_queue service/routes          | Daily/permanent queue, shelves, order, read state, notes, digest, existing persistence and recovery                 |
| Bookmarks and likes         | use-article-reaction.ts; useBookmarks.ts; use-liked-articles.ts; backend saved-item routes        | Toggle, dedupe, rollback on failed mutation, correct IDs, reload persistence                                        |
| Research chat               | app/search/research/*; chat-sidebar.tsx; backend/news_research_agent.py; research routes          | Semantic and agentic modes, streaming, cancel, conversations, edit/retry, branches, citations, reload               |
| Intelligence Atlas          | features/intelligence-atlas/_; wiki_atlas route; atlas__ services                                 | Search, filters, graph/list parity, selection URL, inspectors, worker layout, mixed entity types                    |
| Wiki dossiers               | app/wiki/source, reporter, person, organization, ownership, analysis                              | Identity, citations, career history, ownership, funding evidence, dates, deep links, refresh                        |
| Appearance settings         | app/settings/page.tsx; appearance helpers and bootstrap                                           | All token controls, saved values, import/export, reset, invalid JSON, startup theme                                 |
| Debug and source operations | app/debug/_; app/sources/[source]/debug/_; backend debug/observability routes                     | Tabs, URL state, storage filters, parser probes, logs, metrics, refresh and visible failures                        |
| RSS/native ingestion        | rss_parser_rust/src/*; rss_ingestion.py; cache/persistence workers                                | All supported feed formats, Unicode, authors/URLs, multiple feeds, timeout retention, publication before enrichment |
| Search/storage              | search/similarity routes; vector_store.py; database.py; Chroma services                           | Semantic plus lexical fallback, pagination, database persistence, cache parity, no event-loop blocking              |
| CLI and contracts           | scripts/scoop.ts; backend/openapi.json; frontend/lib/generated/openapi.ts                         | Every published HTTP operation, WebSockets, streaming, schema refresh/check, investigations, evidence replay        |
| Compatibility routes        | app/sources/page.tsx; app/sources/debug/page.tsx; wiki/reporters route                            | Existing bookmarked links still reach the intended workspace                                                        |

The backend currently registers 29 feature routers. None is presumed removable simply because
it has no direct frontend import; the generated CLI and external local scripts are consumers.
Preserve database tables, migrations, catalog content, captured evidence, and local user data.

## 5. Deletion ledger

Deletion requires both a reference check and the behavior check for its caller surface.

| Candidate                                                                      | Audit evidence                                                                                    | Action and condition                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| frontend/lib/types/core.ts                                                     | Native Knip flags it; all five named types occur only in this file across frontend/scripts        | Delete the unused speculative model layer; retain generated contracts and real view types                             |
| Unused reexports in frontend/lib/api/index.ts                                  | Knip flags ApiError, api, query at the barrel                                                     | Remove only unnecessary reexports after direct-client tests and caller checks; retain implementations used internally |
| Unused exported types across frontend/lib/api/types.ts                         | 79 type-export candidates across the frontend, many OpenAPI aliases                               | Remove redundant exports; delete definitions only if no local usage remains                                           |
| fetchNewsIndex/fetchLiveBrowseIndex alias pair                                 | Knip reports a duplicate exported implementation                                                  | Choose the canonical name used by the new hook and update all callers/tests together                                  |
| loadHighlightStore/mergeHighlights reexports from article-detail-modal-data.ts | Actual implementations live in highlight-store.ts and are used there                              | Remove only unused pass-through exports; keep highlight persistence behavior                                          |
| frontend/lib/utils.ts dead debounce/debug APIs                                 | No live consumer found for exported debounce or debug toggles; separate logger owns active toggle | Trace local logger use, then remove duplicate inactive implementation                                                 |
| Unused schema exports in search model/schemas.ts                               | Knip flags schema names exposed only for local composition                                        | Make locally used schemas private; delete only unreachable definitions                                                |
| Unused research selector exports                                               | groupArticlesBySource/findLatestMessage flagged                                                   | Check direct test imports and controller callers, then remove unused code or export modifier                          |
| Unused component modules concealed by Knip entries                             | Not yet proven                                                                                    | Build reachability from real routes/tests before naming deletions                                                     |
| One-off lint codemods                                                          | Some remain documented and have tests; lint reports substantial debt in them                      | Inventory callers and ongoing use; retire only obsolete transformations after active cleanup no longer needs them     |
| Repeated prop-builder functions                                                | Present in debug and research controllers; prior code already removed some elsewhere              | Inline one-use wiring where it shortens the actual component path; keep cohesive shared transforms                    |
| Empty wrappers and duplicate state flags                                       | Research and reader use selected-article and modal-state paths                                    | Eliminate only when selection can represent the exact close/reopen and data-retention semantics                       |
| Generated build/log artifacts                                                  | Most are already ignored; tracked runtime/debug directories contain ignore sentinels              | Keep sentinels; remove only task-created leftovers and proven tracked artifacts                                       |
| har/pleasework.har                                                             | Untracked user input                                                                              | Preserve; do not publish, parse for secrets, or count it as source debt                                               |
| .serena deletions                                                              | Already deleted in the starting worktree                                                          | Preserve the user's deletion state                                                                                    |
| Existing developer docs and traces                                             | AGENTS.md explicitly references documentation and trace surfaces                                  | Keep current guides and evidence; consolidate obsolete claims only with link/reference checks                         |
| @barney-media/crap-typescript                                                  | Referenced from repository-owned quality commands                                                 | Keep; fix dependency discovery rather than deleting a required analyzer                                               |
| Native Rust module / Python wrappers                                           | Rust bindings are the authoritative ingestion path                                                | Keep native path; remove a Python fallback only after all callers use a verified binding                              |
| Compatibility redirects                                                        | Existing user deep links rely on them                                                             | Keep redirects; remove unnecessary client directives if verified safe                                                 |

Unused export does not mean unused implementation. Documentation's old April audit already
describes some deletions that happened months ago. Do not count them again.

## 6. Ordered implementation phases

Every phase uses the current diff as its starting point, fixes all applicable findings in
the files it changes, records before/after metrics, and leaves the relevant behavior checks
runnable. Do not introduce a framework, generic component factory, context provider, or
dependency solely to satisfy a score.

### Phase 0: Establish trustworthy verification

Scope: scripts/check-maintainability.mjs; scripts/check-crap.mjs;
scripts/quality-hardening/adapters/cccc.mjs, crap.mjs;
scripts/quality-hardening/measure.mjs, verify.mjs; relevant existing tests.

1. Repair B02 and B03 with subprocess regression tests.
2. Repair B04 using fresh owned-source coverage.
3. Correct B05 threshold/status semantics through the existing policy.
4. Reconcile measurement source roots, including Rust, backend top-level research code,
   frontend feature modules, scripts, and tests. Record intentional generated/vendor exclusions.
5. Ensure signal, timeout, parse error, empty report, and truncated output fail visibly.
6. Check source fingerprints rather than Git status text alone when proving a verifier did not
   change source; status text cannot detect a second edit to an already-dirty file.
7. Verify that repository commands actually collect nested controller/transformation tests.
8. Keep the controller and existing ledger; do not replace them with another campaign engine.

Done: real failures cannot become passes; coverage and thresholds are attributable; all tool
regressions pass. Re-run the census so later reductions have a trustworthy denominator.

### Phase 1: Fix shared boundary bugs before structural changes

Scope: frontend/lib/api/client.ts; frontend/components/reading-queue-queries.ts;
frontend/lib/api/article.ts; their callers and behavior tests.

1. Repair B01 at the shared HTTP client so all endpoints benefit.
2. Reproduce and fix queue special-key grouping, query-error null handling, and undefined query data.
3. Reuse the existing article-content extraction boundary if its response and cancellation
   contract matches queue requirements; avoid another fetch/parser implementation.
4. Preserve 404, validation failure, transient service failure, and user cancellation distinctly.
5. Verify all article null/empty/zero and source identity cases before changing mapper defaults.

Done: regressions fail on old behavior and pass on the fix; API mapping, queue, search,
and frontend typechecks stay green.

### Phase 2: Remove proven unused source and exports

Scope: deletion ledger, frontend/knip.json, affected package manifests/lockfiles only if necessary.

1. Delete core.ts after reference proof.
2. Review all 36 value and 79 type export candidates. Remove only the dead surface.
3. Build a real route/test import graph to find component orphans currently hidden by wildcard entries.
4. Keep framework exports, CSS imports, worker entry points, dynamically loaded modules, and CLI dependencies.
5. Collapse unused compatibility aliases to the actual canonical APIs.
6. Remove unneeded packages only after source/config/runtime evidence and update the matching npm lockfile.
7. Inspect tracked docs and scripts referencing every removed path.

Done: validated unused findings reach zero; imports, build, tests, and existing route links pass;
report the exact deleted paths and source reduction.

### Phase 3: Simplify article mapping and data ownership

Scope: frontend/lib/api/article.ts, types.ts, schemas.ts, endpoints.ts;
frontend/hooks/use-news-index.ts; backend news/search contracts when required.

1. Keep one canonical wire article schema and one view-model conversion.
2. Remove redundant BackendArticleMapping fields and pass-through conversion steps when the final
   NewsArticle can be built directly without losing validated null/legacy handling.
3. Hoist immutable source lookup tables and reusable schema objects out of per-article calls.
4. Derive source slug, source display name, timestamps, and fallback image once.
5. Remove duplicate cached/live-index hook paths already replaced by use-news-index.
6. Keep API timestamps, numeric IDs, persistence markers, country mentions, and geo signals intact.
7. Use generated contract types for wire structures; local models should describe actual UI state.

Checks: api-mapping.property, country-mapping, article-image, date-formatters, semantic-search,
browse-index, live-browse-index/null-fields, backend article/search/index tests, schema parity.
Measure mapping and sorting using a fixed representative 10,000-article input.

### Phase 4: Reader, highlights, and article actions

Scope: article-detail-modal.tsx and its chrome/analysis/actions/language/wiki modules;
article-detail-modal-data/types; highlight-store; use-article-detail.

1. Trace actual open, article change, extraction, highlight hydration, save/sync, close, and reopen.
2. Remove duplicated modal-open flags only if retained article selection semantics allow it.
3. Move fetch ownership to the existing data boundary; remove effects that copy query results
   into parallel state.
4. Replace giant state/prop assembly with cohesive reader, action, and analysis contracts.
5. Delete one-use indirection and duplicated rendering before extracting any new component.
6. Keep highlight ranges, edits, undo/history, remote merge, clipboard/export, and storage recovery.
7. Preserve focus restoration, Escape, nested modal/sheet behavior, and scroll locking.

Checks: article-detail-modal, highlight-utils, highlight-toolbar, highlight-note-popover,
storage-snapshot, keyboard-activation, render-loop-regression. Browser: reader open/switch,
select/highlight/edit, source sheet, close/reopen, mobile scrolling, failed extraction.

### Phase 5: Queue and saved workspace

Scope: reading-queue-sidebar/card/list/article-detail/digest/embeds/queries;
app/saved/*; queue/reaction hooks; backend queue service.

1. Keep one selected item, one ordering source, and one definition of read status.
2. Remove redundant preloaded-text and fetched-text state while preserving offline/preloaded content.
3. Separate card facts from controls to repair QueueCard complexity without tiny JSX wrappers.
4. Consolidate repeated preview/structured-summary stripping through reading-queue-content.
5. Keep digest generation scoped to the requested queue snapshot; prevent an old result from
   overwriting a newly selected queue.
6. Preserve failed-mutation rollback, duplicate URLs, shelves, daily/permanent retention, and notes.
7. Inspect backend per-item extraction and ordering queries for unnecessary round trips; benchmark
   before introducing batching or background work.

Checks: reading-queue, reading-history, bookmarks, liked, backend queue/shelf/digest tests.
Browser: add, reorder, edit, read, remove, reload, open digest and embedded article.

### Phase 6: Research state and streaming

Scope: app/search/research/*; chat-sidebar; research/agentic-search API; news_research_agent.py.

1. Reduce the reducer's 25-branch assignment dispatch without unsafe generic property writes.
2. Keep compound message insertion, chat preview updates, version selection, and edit clearing atomic.
3. Remove duplicated chat-preview calculation between reducer, persistence, and controller.
4. Split the 1,186-line controller at real responsibilities: storage, chat actions, request ownership,
   and view composition. Reuse the existing modules first.
5. Inline one-use prop builders and remove flags derivable from active chat/request state.
6. Keep the active AbortController identity guard for late chunks and terminal events.
7. Preserve both semantic and agentic modes, stream framing, source references, tool progress,
   branch switching, retry/edit, incomplete response recovery, and reload.
8. Review backend agent orchestration and TypedDict/Pydantic state before removing defensive branches.

Checks: search-research-state, search-inline-edit, chat-branching, semantic-search,
api.agentic-search; backend research stream, agentic search, recovery and tools tests.
Browser: send/cancel/send, switch chats during streaming, edit earlier message, restore saved chat.

### Phase 7: Home, feed, grid, trends, and source browsing

Scope: app/page.tsx; grid-view; feed-view; live-news-view; stream-card; virtualized-grid;
trending-feed; feed-ranking; source-groups; pagination hooks.

1. Centralize the existing filter/sort derivation and avoid rebuilding equivalent indexes in each view.
2. Keep feed layout and grid layout separate where interaction semantics differ.
3. Remove duplicate selected-source sets, persisted view state, and copied query arrays.
4. Repair unstable empty arrays and recreated callbacks at actual memo/virtualization boundaries.
5. Simplify source/article/topic row rendering into reusable meaningful units.
6. Preserve pagination reset rules, favorite ranking, source freshness, and same-title deduplication.
7. Verify stable item identity and virtualization scroll behavior when filters or data change.

Checks: feed-ranking, source-groups, pagination, news-view-state, news-lens, browse/live-browse,
cluster-display, trending-clusters, render-loop-regression.
Browser: every home view, filters, favorite source, sorting, load more, live refresh, narrow viewport.

### Phase 8: Globe and WebGL lifecycle

Scope: globe-view; interactive-globe; globe-ui-state; globe-view-model; globe-workspace;
globe-country; globe-live-data; existing globe tests.

1. Remove repeated source/country derivation from collapsed and expanded panels.
2. Keep the existing state model as the authority for selected country and panel transitions.
3. Split cohesive country briefing, source dossier, and dashboard sections; avoid moving a
   2,500-line component unchanged behind a new filename.
4. Separate pure heat/color/geometry calculations from Three.js resource lifecycle.
5. Share constant lookups and derived country counts; avoid rebuilding them per polygon callback.
6. Verify texture error paths, disposal on replacement/unmount, animation cancellation,
   visibility handling, and null WebGL context before simplifying lifecycle code.
7. Preserve lighting calibration controls, mobile behavior, selected-country focus and all heat modes.
8. Capture CPU/frame and retained-resource evidence before making performance claims.

Checks: interactive-globe, interactive-globe-helpers, globe-workspace, globe-live-data,
country-mapping; fresh CRAP mapping for texture and heat paths.
Browser with WebGL: each layer and lighting mode, select/deselect, expand/collapse, resize,
navigate away/back, inspect console and renderer lifecycle.

### Phase 9: Cluster analysis, contradictions, lineage, and blindspots

Scope: cluster-detail-modal; contradiction-panel; story-lineage-panel; blindspot-view;
source-coverage-comparison; related backend services/routes.

1. Separate loading, missing evidence, available evidence, and request failure explicitly.
2. Remove repeated source counting and contrast/coverage derivations shared by topic cards and detail.
3. Simplify comparison selection and independent request ownership.
4. Keep contradictory claims, agreed facts, citations, correction watches, and missing evidence visible.
5. Preserve source-diversity and paywall-concentration semantics; do not turn missing measurements into zero.
6. Review repeated embedding normalization and cluster scans in the backend with representative data.

Checks: cluster-comparison, cluster-display, blindspot-view and matching backend contradiction,
lineage, blindspot, snapshot tests. Browser: comparison add/remove, citation click, no-data lens.

### Phase 10: Intelligence Atlas

Scope: features/intelligence-atlas; wiki_atlas; atlas_entity and graph/evidence projection services.

1. Keep route query state, selected entity, graph layout, and query cache as separate owners.
2. Remove mirrored graph/list filter derivations and duplicate DTO conversions.
3. Simplify atlas-graph's render/data/lifecycle mixture using the existing force-layout module and worker.
4. Preserve mixed entity ranking before bounds, relationship direction, confidence, dated evidence,
   uncertainty, and graph/list selection parity.
5. Replace broad casts with generated/schema-derived input types at the actual boundary.
6. Measure repeated layout/network requests and resource cleanup before optimizing.

Checks: existing Atlas schema/query-state/layout/tests; backend atlas contract/dossier/projection/
stats/cache/research-coverage tests. Browser: search, select, filters, graph/list, deep link, back.

### Phase 11: Wiki, ownership, people, reporters, and funding

Scope: app/wiki/*; features/wiki/ui; entity_wiki_service; funding_researcher;
reporter_indexer; source_credibility; source research/cache services.

1. Reuse existing wiki citation/panel primitives where the same structure and semantics recur.
2. Delete repeated card-specific wrappers and duplicate empty/failure UI.
3. Keep canonical identities and route encoding consistent across all dossier links.
4. Separate retrieval adapters, evidence merging, confidence decisions, and presentation payloads.
5. Preserve evidence URLs, official-profile requirements, dated ownership changes, source mismatch
   rejection, unknown funding, and cache invalidation rules.
6. Review repeated normalization and local query work before new shared helpers.
7. Any provider-specific simplification must pass positive, unrelated-name, unavailable, and
   partial-response fixtures; no inferred replacement data.

Checks: reporter career timeline; backend entity/wiki/reporter/funding/primary-source/cache tests.
Browser: each dossier type, long names, missing profile, expand evidence, refresh, navigation.

### Phase 12: Debug and appearance

Scope: app/debug/debug-dashboard.tsx and child files; source-debug view;
app/settings/page.tsx; appearance store/sync/bootstrap; performance logger.

1. Turn each debug tab into a cohesive module that owns its actual queries and controls.
2. Delete selectDebugDashboardData/createDebugQueryLoaders pass-through layers where direct query
   use is simpler. Retain shared refresh only where one action must refresh several resources.
3. Remove duplicate tab-triggered fetches only after network-count proof.
4. Keep pagination/filter state with the storage tab and maintain URL tab selection.
5. Reuse API error and date formatting boundaries for debug data.
6. Split settings by token category using existing token metadata; preserve all controls.
7. Keep validated import/export, reset, local persistence, and no flash of wrong theme.

Checks: appearance-settings, storage snapshots, source groups, debug/backend observability tests.
Browser: every tab and filter, refresh/failure, settings edit/reload/reset/import/export.

### Phase 13: Backend storage, ingestion, and service simplification

Scope: database.py; cache.py; rss_ingestion.py; persistence and background workers;
vector_store.py; chroma_topics.py; rss_parser_rust/src; relevant route/service helpers.

1. Keep one SQLAlchemy metadata definition and direct Rust binding ownership.
2. Separate database infrastructure, model declarations, and query operations only where that
   removes cycles or clarifies real responsibilities; no repository-class layer.
3. Reuse current saved_article_helpers instead of introducing generic CRUD router factories.
4. Replace duplicated date/source/URL normalization only where contracts match.
5. Remove dead queries and redundant serialization passes after tracing all API/CLI callers.
6. Verify transaction, unique-constraint, commit/rollback, cache invalidation, cancellation,
   thread/loop ownership, and worker shutdown behavior.
7. Preserve publication before image/embedding enrichment and retention of timed-out sources.
8. Keep parser Unicode, author extraction, duplicate-feed, deadline and retry coverage.
9. Do not execute destructive data migrations or reporter cleanup against the user's database
   as part of source-code cleanup. Use disposable fixtures and migrations.

Checks: backend focused tests, mypy --strict, Ruff, Rust format/clippy/native build,
database/schema parity, startup readiness and event-loop regression tests.

### Phase 14: CLI, developer scripts, and repeated tooling

Scope: scripts/scoop.ts; scripts/quality-hardening/_; scripts/transformations/_;
codemod-lint-mechanical; runlocal.sh; verification scripts.

1. Repair actual CLI typecheck/test failures before reducing its command dispatch.
2. Preserve schema-generated HTTP operations, WebSockets, stream handling, argument validation,
   evidence replay isolation, and exit statuses.
3. Reuse standard child-process/fs/path APIs; remove helper-object indirection without weakening
   output caps, cleanup, errors, or cancellation.
4. Identify codemods that are obsolete, duplicate installed safe fixes, or no longer referenced.
5. Preserve any codemod still used by the campaign until its last consumer is removed.
6. Fix test collection for nested tooling tests if the baseline confirms they are omitted.
7. Do not add another linter, controller, scheduler, documentation generator, or migration framework.

Checks: CLI typecheck/test/schema, controller tests, transformation tests, shell syntax,
real local health endpoint smoke and isolated replay when prerequisites exist.

### Phase 15: Close remaining measured debt

Scope: every remaining row in annex A, including files outside the named hotspots.

1. Work by file and root cause, not one warning at a time across the whole repository.
2. Remove unreachable branches and unused helpers before mechanically adjusting syntax.
3. For strict booleans and nullish coalescing, test empty string, zero, false, null and undefined;
   do not apply a global semantic rewrite.
4. For readonly parameters, express real immutable inputs. Keep intentional mutation and framework
   capabilities correct; do not hide findings behind new aliases.
5. For JSX depth, handlers and prop allocation, identify a useful component or stable action
   boundary. Avoid fragments created only to lower a parser count.
6. For variable ordering/export rules, preserve evaluation order, dependency order and framework
   constraints. Use existing safe autofixes only after reviewing their exact output.
7. For promises, await or explicitly handle the failure/cancellation path; do not discard failures.
8. For JSDoc and trivial comments, remove unnecessary documentation where allowed rather than
   expanding boilerplate. Keep reasons, invariants, public contracts and safety constraints.
9. Re-run MI/CCCC/CRAP together so score movement in one does not conceal worse readability elsewhere.

Done: all annex rows resolved or proven obsolete through deletion, with zero lint and final metrics.

### Phase 16: Whole-repository closure and documentation

1. Run scripts/self-test to completion on one stable source snapshot.
2. Run explicit final-threshold MI and CRAP checks with fresh source/coverage attribution.
3. Repeat native Knip and duplication after exports and files stabilize.
4. Build and exercise the feature matrix in section 4 at desktop and mobile sizes.
5. Report source bytes/lines, exported API surface, dependency changes, and before/after metrics.
6. Update README only for changed setup or supported behavior. Update docs/frontend-architecture.md,
   docs/agent/repo-map.md, testing.md and docs/Log.md for real structural/process changes.
7. Correct known-errors/learnings entries made stale by confirmed fixes. Preserve the remaining
   user history; add concise dated corrections instead of silently rewriting unrelated records.
8. Check whether the Wiki needs a matching architecture/troubleshooting update; external publication
   is separate from local implementation and requires the session's authorization.
9. Record executed work and evidence in docs/agents/traces/lean-codebase-cleanup.md.
10. Remove task-created temporary source scaffolding, abandoned exports, and debug code.
11. Review all deletions against source imports, CLI/config references and documentation links.
12. Do not claim completion with failing or unrun gates; name exact external blockers and finish
    all independent executable work.

## 7. Verification commands and evidence rules

Use the existing locked/local toolchain. Do not install replacements merely for this cleanup.

    scripts/self-test
    node scripts/quality-hardening.mjs validate
    npm --prefix frontend run lint
    npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit
    npm --prefix frontend test -- --runInBand
    npm --prefix frontend run test:oxlint-rules
    npm --prefix frontend run build
    npm --prefix frontend run deadcode
    node scripts/check-maintainability.mjs --strict --json
    bash scripts/check-complexity --json
    npm run quality:duplicates
    npm run deps:cycles
    npm run cli:typecheck
    npm run cli:test
    npm run cli:schema:check
    npm run quality:controller:test
    git diff --check

Backend focused commands run in backend:

    MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict
    .venv/bin/pytest tests -m "not slow"

Rust and Ruff commands use the versions already configured in quality-hardening.config.json.
The release extension build is required after Rust changes. Keep it in the project environment.

For every behavior change: record a failing old-behavior reproduction, the smallest regression
that observes the result, the passing focused run, and the broader relevant run.
For performance claims: record input size, command, baseline/candidate samples, output equivalence,
and resource/request-count changes. A smaller file is not evidence of a faster app.

Browser completion requires visible controls, working interactions, screenshots, no blank screen,
no unintended horizontal overflow, and reviewed console/network errors. Build/typecheck alone
cannot replace the browser pass.

## 8. Risks and stop conditions

- Preserve all initial dirty work and untracked modules. Never reset this branch to get a clean diff.
- Keep scope limited to app/code/tooling cleanup; do not delete database contents, personal captures,
  source catalogs, evidence records, credentials, or working host configuration.
- Do not change formatting/lint policies to satisfy the task. Analyzer plumbing fixes must retain
  or tighten what is enforced and include failure-path tests.
- Keep unknown input types at real validation boundaries when needed; deleting unknown by casting
  raw input to a trusted type defeats feature preservation and safety.
- Keep API failure handling and intentional lexical/cache fallback. Remove redundant fallback
  implementations only when the primary path is verified and the feature contract survives.
- Avoid simultaneous builds in the same .next directory or concurrent coverage jobs in the same
  report directory. Keep long-running processes bounded and stop only processes started for this task.
- Browser connection is currently unavailable through Chrome MCP; independently executable checks
  continue. This is a limit on visual evidence, not proof that the UI works.
- Missing optional API keys may limit live research smoke tests. Use deterministic boundary fixtures
  for code correctness and report the exact unverified provider path.
- A phase with an unresolved regression must not be marked complete.

## 9. Progress ledger

| Phase                       | State    | Evidence                                                                       |
| --------------------------- | -------- | ------------------------------------------------------------------------------ |
| Audit and detailed plan     | Recorded | Current metrics, live code inspection, reproducible B01/B02/B03, annexes below |
| 0: Verification correctness | Active   | B02 regression failed before fix and passes after; Luna owns remaining repairs |
| 1: Shared bugs              | Partial  | Root verified 19 API/queue tests; digest failure rendered; scoped lint remains  |
| 2: Dead code                | Partial  | Unreferenced core.ts deleted; native Knip still fails on exports/dependency debt |
| 3: Article/data ownership   | Pending  | Mapper and existing contract migration inspected                               |
| 4: Reader/highlights        | Partial  | Article modal split checkpoint `0cf1299`; focused 6/6 regression and TypeScript pass   |
| 5: Queue/saved              | Pending  | CCCC hotspots and data flow inspection                                         |
| 6: Research                 | Pending  | Reducer/controller/transport/persistence inventory                             |
| 7: Browse/feed/grid         | Partial  | Feed/grid/source slices checkpointed; focused regressions pass; broader metrics remain  |
| 8: Globe                    | Pending  | Highest stale-report CRAP and lifecycle inventory                              |
| 9: Cluster/blindspot        | Partial  | Cluster extraction and blindspot regressions verified; broad cluster debt remains       |
| 10: Atlas                   | Partial  | Atlas panel cleanup checkpointed; remaining entity-list and graph debt remains          |
| 11: Wiki/evidence           | Pending  | Dossier/service/test inventory                                                 |
| 12: Debug/settings          | Partial  | Notification and ownership slices verified; debug dashboard still has broad debt        |
| 13: Backend/native          | Pending  | Service/model/router inventory                                                 |
| 14: CLI/tooling             | Deferred | User requested scripts linting be skipped; rules/config remain unchanged                |
| 15: Remaining metric debt   | Pending  | Complete measured file/rule/function inventories                               |
| 16: Closure                 | Pending  | Requires all prior phases and full feature verification                        |

## 10. Source basis for analyzer behavior

- [Node process documentation](https://nodejs.org/api/process.html): explicit process.exit can
  truncate pending stdout writes; use exitCode and natural shutdown.
- [Knip entry files](https://knip.dev/explanations/entry-files) and
  [project configuration](https://knip.dev/guides/configuring-project-files): entry roots,
  plugin discovery and package configuration determine reachability.
- Installed package source, version 0.5.0:
  frontend/node_modules/@barney-media/crap-typescript-core/dist/coverage.js,
  analyzeProject.js and types.d.ts. Existing coverage is reused before any new test run.
- Repository policy and source are the authority for current lint/MI/CRAP thresholds.
  Historical memory was used only to find likely risks; all baseline numbers above are current.

## Annex A. Complete measured file queue

All files with direct Oxlint findings or frontend MI below 60 are included.
MI entries shown as "-" were not below 60 in this frontend MI run, or were outside that run;
they are not a claim that MI was measured for every file.

| File                                                                   | Errors | Warnings | MI < 50 | MI < 60 | Lowest flagged MI |
| ---------------------------------------------------------------------- | -----: | -------: | ------: | ------: | ----------------: |
| frontend/app/debug/debug-dashboard.tsx                                 |     90 |      367 |       7 |      32 |              30.4 |
| frontend/components/globe-view.tsx                                     |    167 |      149 |       2 |      22 |              24.5 |
| frontend/components/cluster-detail-modal.tsx                           |    102 |      186 |      12 |      23 |              34.4 |
| frontend/components/grid-view.tsx                                      |    102 |      158 |       8 |      13 |              28.9 |
| frontend/app/page.tsx                                                  |     74 |      138 |       4 |      16 |              43.1 |
| frontend/features/intelligence-atlas/atlas-graph.tsx                   |    104 |       88 |       6 |      21 |              47.4 |
| scripts/scoop.ts                                                       |    102 |       88 |       0 |       0 |                 - |
| frontend/components/blindspot-view.tsx                                 |     56 |      126 |       7 |      13 |              39.8 |
| frontend/app/wiki/ownership/source-intelligence-operations.tsx         |     66 |      107 |       2 |      15 |              36.7 |
| frontend/lib/api/types.ts                                              |      1 |      164 |       0 |       0 |                 - |
| frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx             |     62 |      102 |       3 |      13 |              43.2 |
| frontend/lib/api/endpoints.ts                                          |      8 |      146 |       3 |       9 |              49.3 |
| frontend/components/interactive-globe.tsx                              |     71 |       81 |       7 |      16 |              22.2 |
| frontend/app/saved/saved-workspace-view.tsx                            |     49 |       88 |       5 |      17 |              44.3 |
| frontend/app/wiki/reporter/[id]/reporter-wiki-view.tsx                 |     26 |      110 |       1 |       2 |              45.9 |
| frontend/components/trending-feed.tsx                                  |     39 |       87 |       4 |       8 |                36 |
| frontend/features/intelligence-atlas/intelligence-atlas-workspace.tsx  |     55 |       56 |       4 |      14 |              30.9 |
| scripts/quality-hardening/queue.mjs                                    |     35 |       71 |       0 |       0 |                 - |
| frontend/components/article-detail-modal-analysis.tsx                  |     33 |       72 |       1 |       5 |              43.4 |
| frontend/lib/performance-logger.ts                                     |     27 |       76 |       4 |      11 |              39.4 |
| frontend/features/intelligence-atlas/atlas-inspector.tsx               |     23 |       79 |       0 |       6 |                51 |
| scripts/transformations/sort-vars.mjs                                  |     17 |       80 |       0 |       0 |                 - |
| frontend/components/feed-view.tsx                                      |     36 |       51 |       7 |      18 |              37.4 |
| frontend/components/article-detail-modal.tsx                           |     37 |       48 |       6 |      24 |              18.6 |
| scripts/transformations/no-inline-comments.mjs                         |     46 |       34 |       0 |       0 |                 - |
| scripts/check-imports.mjs                                              |      2 |       78 |       0 |       0 |                 - |
| frontend/lib/api/article.ts                                            |      2 |       76 |       1 |       3 |              48.8 |
| scripts/transformations/group-exports.mjs                              |     11 |       65 |       0 |       0 |                 - |
| frontend/app/sources/[source]/debug/source-debug-view.tsx              |     28 |       46 |       2 |       8 |              48.2 |
| frontend/components/chat-sidebar.tsx                                   |     33 |       41 |       3 |       7 |              27.8 |
| scripts/quality-hardening/measure.mjs                                  |     16 |       57 |       0 |       0 |                 - |
| scripts/quality-hardening/cli.mjs                                      |     24 |       49 |       0 |       0 |                 - |
| frontend/components/source-research-panel.tsx                          |     25 |       46 |       1 |       6 |              44.5 |
| scripts/transformations/sort-imports.mjs                               |     44 |       27 |       0 |       0 |                 - |
| scripts/quality-hardening/config.mjs                                   |     26 |       43 |       0 |       0 |                 - |
| frontend/app/source/[sourceId]/page.tsx                                |     23 |       46 |       4 |       7 |              42.3 |
| frontend/components/verification-panel.tsx                             |     16 |       52 |       5 |       6 |              36.6 |
| frontend/app/wiki/person/[id]/person-wiki-view.tsx                     |      5 |       63 |       3 |       5 |              36.6 |
| frontend/features/intelligence-atlas/atlas-entity-list.tsx             |     36 |       31 |       2 |       6 |              32.2 |
| frontend/app/settings/page.tsx                                         |     27 |       40 |       1 |       5 |                23 |
| frontend/components/virtualized-grid.tsx                               |     18 |       42 |       3 |       4 |              31.2 |
| frontend/hooks/useNewsStream.ts                                        |     34 |       23 |       0 |       0 |                 - |
| scripts/quality-hardening/schedule.mjs                                 |      7 |       49 |       0 |       0 |                 - |
| frontend/components/source-sidebar.tsx                                 |     20 |       36 |       2 |       5 |              33.4 |
| frontend/features/intelligence-atlas/lib/atlas-schema.ts               |     29 |       26 |       0 |       1 |              58.5 |
| scripts/tests/scoop.test.ts                                            |     29 |       26 |       0 |       0 |                 - |
| frontend/app/wiki/reporters/page.tsx                                   |     26 |       28 |       3 |       8 |              47.1 |
| frontend/components/reading-queue-article-detail.tsx                   |      0 |       53 |       0 |       5 |              55.1 |
| scripts/quality-hardening/one-shot.mjs                                 |      8 |       42 |       0 |       0 |                 - |
| scripts/transformations/function-style-const.mjs                       |     18 |       31 |       0 |       0 |                 - |
| frontend/hooks/use-reading-queue.ts                                    |     16 |       33 |       0 |      11 |              50.3 |
| frontend/components/add-rss-dialog.tsx                                 |     17 |       32 |       1 |       3 |              31.5 |
| frontend/app/wiki/reporter/[id]/career-timeline.tsx                    |      4 |       44 |       2 |       2 |              39.5 |
| frontend/components/article-detail-modal-actions.tsx                   |     19 |       29 |       0 |       4 |              50.5 |
| frontend/components/reporter-profile.tsx                               |     22 |       25 |       1 |       4 |              49.2 |
| frontend/app/search/research/model/schemas.ts                          |      0 |       46 |       0 |       0 |                 - |
| scripts/quality-hardening/adapters/oxlint.mjs                          |      9 |       35 |       0 |       0 |                 - |
| frontend/features/intelligence-atlas/atlas-topbar.tsx                  |     10 |       32 |       2 |       4 |              34.5 |
| frontend/components/stream-card.tsx                                    |     16 |       26 |       2 |       5 |              27.7 |
| scripts/codemod-lint-mechanical.mjs                                    |     23 |       18 |       0 |       0 |                 - |
| frontend/lib/feed-ranking.ts                                           |     20 |       21 |       1 |       5 |              45.4 |
| frontend/lib/appearance-settings.ts                                    |     27 |       14 |       2 |       5 |              41.2 |
| scripts/quality-hardening/adapters/crap.mjs                            |     10 |       30 |       0 |       0 |                 - |
| scripts/check-file-lines.mjs                                           |      2 |       38 |       0 |       0 |                 - |
| frontend/app/search/research/components/message-item.tsx               |      0 |       39 |       5 |       9 |              44.4 |
| frontend/components/highlight-toolbar.tsx                              |     13 |       26 |       5 |      10 |              33.3 |
| frontend/components/source-coverage-comparison.tsx                     |      7 |       32 |       1 |       2 |              33.5 |
| frontend/app/search/research/hooks/use-research-controller.ts          |      0 |       38 |       8 |      20 |              31.7 |
| frontend/lib/highlight-store.ts                                        |      9 |       28 |       1 |       6 |              49.1 |
| frontend/components/source-credibility-panel.tsx                       |     10 |       25 |       3 |       3 |              34.5 |
| frontend/lib/api/streaming.ts                                          |      6 |       28 |       2 |      15 |              48.2 |
| frontend/components/notification-popup.tsx                             |     12 |       22 |       1 |       2 |              31.4 |
| frontend/app/search/research/state/research-reducer.ts                 |      0 |       33 |       1 |       1 |              31.5 |
| frontend/components/article-inline-embed.tsx                           |     10 |       23 |       1 |       2 |              41.2 |
| scripts/quality-hardening/writer-claim.mjs                             |      5 |       28 |       0 |       0 |                 - |
| scripts/check-maintainability.mjs                                      |      1 |       32 |       0 |       0 |                 - |
| frontend/components/global-navigation.tsx                              |      9 |       23 |       1 |       1 |                29 |
| frontend/lib/verification.ts                                           |     10 |       22 |       1 |       6 |              42.9 |
| frontend/**tests**/article-detail-modal.test.tsx                       |      9 |       23 |       0 |       0 |                 - |
| frontend/components/credibility-badge.tsx                              |     11 |       21 |       2 |       4 |              38.6 |
| frontend/components/story-lineage-panel.tsx                            |     11 |       21 |       1 |       1 |                37 |
| frontend/hooks/use-inline-definition.ts                                |      9 |       21 |       2 |       4 |              44.3 |
| scripts/quality-hardening/hook.mjs                                     |     11 |       19 |       0 |       0 |                 - |
| frontend/lib/globe-live-data.ts                                        |      4 |       26 |       3 |       6 |                40 |
| scripts/tests/transformations/function-style-const.test.mjs            |     26 |        2 |       0 |       0 |                 - |
| scripts/quality-hardening/verify.mjs                                   |      6 |       22 |       0 |       0 |                 - |
| frontend/app/search/research/model/types.ts                            |      0 |       27 |       0 |       0 |                 - |
| frontend/hooks/use-scroll-personalization.ts                           |      7 |       19 |       2 |       5 |                40 |
| frontend/components/live-news-view.tsx                                 |     11 |       15 |       2 |       2 |              32.1 |
| frontend/components/highlights-view.tsx                                |      8 |       18 |       1 |       1 |              32.7 |
| frontend/components/globe-ui-state.ts                                  |      0 |       25 |       3 |       5 |              41.9 |
| frontend/components/reading-queue-sidebar.tsx                          |      2 |       23 |       2 |       5 |              23.7 |
| frontend/**tests**/render-loop-regression.test.tsx                     |      5 |       20 |       0 |       0 |                 - |
| frontend/components/ui/select.tsx                                      |     12 |       13 |       0 |       0 |                 - |
| frontend/hooks/usePaginatedNews.ts                                     |      5 |       20 |       1 |       2 |              32.5 |
| frontend/components/ui/dialog.tsx                                      |     10 |       14 |       0 |       0 |                 - |
| scripts/tests/transformations/sort-vars.test.mjs                       |     24 |        0 |       0 |       0 |                 - |
| scripts/tests/transformations/group-exports.test.mjs                   |     24 |        0 |       0 |       0 |                 - |
| frontend/lib/globe-workspace.ts                                        |     17 |        7 |       0 |       5 |              51.8 |
| frontend/app/search/research/components/research-workspace.tsx         |      0 |       23 |       0 |       3 |              50.7 |
| frontend/lib/cluster-comparison.ts                                     |     10 |       13 |       0 |       1 |              55.9 |
| frontend/app/wiki/organization/[id]/organization-wiki-view.tsx         |     15 |        7 |       0 |       4 |              53.7 |
| frontend/lib/chat-branching.ts                                         |      9 |       13 |       1 |       3 |                48 |
| frontend/components/ui/sheet.tsx                                       |     10 |       12 |       0 |       0 |                 - |
| frontend/components/reading-queue-card.tsx                             |      0 |       22 |       1 |       1 |              35.9 |
| frontend/**tests**/blindspot-view.test.tsx                             |      4 |       18 |       0 |       0 |                 - |
| frontend/lib/api/client.ts                                             |      3 |       17 |       0 |       1 |              56.8 |
| scripts/tests/transformations/sort-imports.test.mjs                    |     20 |        0 |       0 |       0 |                 - |
| frontend/**tests**/feed-ranking.test.ts                                |      4 |       16 |       0 |       0 |                 - |
| frontend/app/search/research/stream/protocol.ts                        |      0 |       19 |       1 |       5 |              48.6 |
| frontend/lib/source-groups.ts                                          |      7 |       12 |       1 |       3 |              48.2 |
| frontend/hooks/use-live-news-preferences.ts                            |      7 |       12 |       0 |       2 |                52 |
| frontend/app/search/research/hooks/use-research-transport.ts           |      0 |       17 |       3 |       6 |              41.8 |
| frontend/app/search/research/state/selectors.ts                        |      0 |       16 |       0 |       2 |              54.6 |
| frontend/components/related-articles.tsx                               |      6 |       10 |       1 |       1 |              38.4 |
| frontend/lib/notification-state.ts                                     |      4 |       12 |       1 |       1 |              47.5 |
| scripts/tests/quality-hardening/controller.test.mjs                    |      8 |        8 |       0 |       0 |                 - |
| frontend/components/globe-view-model.ts                                |      0 |       16 |       1 |       3 |              41.8 |
| frontend/app/search/research/components/empty-research-view.tsx        |      0 |       15 |       1 |       2 |              41.3 |
| frontend/components/ui/card.tsx                                        |      7 |        8 |       0 |       0 |                 - |
| frontend/app/saved/use-saved-workspace-controller.ts                   |      5 |       10 |       3 |       6 |              40.2 |
| scripts/quality-source-files.mjs                                       |      1 |       14 |       0 |       0 |                 - |
| scripts/tests/transformations/no-inline-comments.test.mjs              |     14 |        0 |       0 |       0 |                 - |
| frontend/components/search-suggestions.tsx                             |      6 |        8 |       1 |       1 |              41.8 |
| frontend/**tests**/interactive-globe.test.tsx                          |      7 |        7 |       0 |       0 |                 - |
| frontend/hooks/use-news-index.ts                                       |      1 |       13 |       1 |       1 |              44.3 |
| scripts/tests/quality-hardening/canary.test.mjs                        |      8 |        6 |       0 |       0 |                 - |
| scripts/quality-hardening/ledger.mjs                                   |      2 |       12 |       0 |       0 |                 - |
| frontend/components/live-news-toolbar.tsx                              |      3 |       11 |       1 |       1 |                43 |
| frontend/features/intelligence-atlas/atlas-operations-sheet.tsx        |      5 |        8 |       1 |       1 |              39.6 |
| frontend/app/search/research/components/research-page.tsx              |      0 |       13 |       0 |       1 |                57 |
| frontend/components/confidence-badge.tsx                               |      3 |       10 |       1 |       2 |              41.5 |
| frontend/**tests**/highlight-toolbar.test.tsx                          |     12 |        1 |       0 |       0 |                 - |
| frontend/components/reading-queue-digest.tsx                           |      0 |       13 |       0 |       1 |              58.1 |
| scripts/tests/quality-hardening/schedule.test.mjs                      |     11 |        2 |       0 |       0 |                 - |
| frontend/**tests**/pagination.test.tsx                                 |      7 |        6 |       0 |       0 |                 - |
| frontend/lib/logger.ts                                                 |      3 |        9 |       0 |       1 |              59.4 |
| frontend/**tests**/highlight-note-popover.test.tsx                     |      3 |        9 |       0 |       0 |                 - |
| scripts/check-crap.mjs                                                 |      2 |       10 |       0 |       0 |                 - |
| frontend/lib/storage.ts                                                |      7 |        4 |       0 |       0 |                 - |
| frontend/components/inline-definition.tsx                              |      7 |        4 |       0 |       1 |              55.3 |
| frontend/components/reading-queue-queries.ts                           |      0 |       11 |       1 |       2 |              37.2 |
| frontend/**tests**/cluster-comparison.test.ts                          |      3 |        8 |       0 |       0 |                 - |
| frontend/lib/cluster-display.ts                                        |      5 |        6 |       0 |       1 |              55.3 |
| frontend/**tests**/browse-index.test.tsx                               |      7 |        4 |       0 |       0 |                 - |
| frontend/components/navigation/workspace-search.tsx                    |      8 |        2 |       1 |       1 |              41.6 |
| frontend/hooks/useReadingHistory.ts                                    |      0 |       10 |       2 |       2 |              42.3 |
| frontend/components/ui/tabs.tsx                                        |      4 |        6 |       0 |       0 |                 - |
| frontend/**tests**/globe-workspace.test.ts                             |      1 |        9 |       0 |       0 |                 - |
| frontend/app/debug/article-parser-card.tsx                             |      3 |        7 |       1 |       1 |              46.3 |
| frontend/components/contradiction-panel.tsx                            |      2 |        8 |       1 |       1 |              33.7 |
| scripts/quality-hardening/adapters/code-multivitals.mjs                |      1 |        8 |       0 |       0 |                 - |
| frontend/components/ErrorBoundary.tsx                                  |      2 |        7 |       0 |       1 |              57.9 |
| frontend/features/intelligence-atlas/atlas-stage-shell.tsx             |      8 |        1 |       1 |       4 |              42.3 |
| frontend/components/ui/table.tsx                                       |      0 |        9 |       0 |       0 |                 - |
| frontend/app/search/inline-article-card.tsx                            |      3 |        6 |       0 |       0 |                 - |
| frontend/hooks/use-article-reaction.ts                                 |      5 |        4 |       1 |       2 |              42.1 |
| frontend/**tests**/keyboard-activation.test.ts                         |      8 |        1 |       0 |       0 |                 - |
| frontend/**tests**/notification-popup.test.tsx                         |      2 |        7 |       0 |       0 |                 - |
| frontend/**tests**/cluster-display-logic.test.ts                       |      0 |        9 |       0 |       0 |                 - |
| frontend/app/search/research/components/research-side-panels.tsx       |      0 |        8 |       1 |       8 |              47.5 |
| frontend/lib/api/schemas.ts                                            |      0 |        8 |       0 |       0 |                 - |
| frontend/app/search/research/model/articles.ts                         |      0 |        8 |       0 |       2 |              54.7 |
| frontend/app/sources/[source]/debug/page.tsx                           |      4 |        4 |       1 |       1 |              46.2 |
| frontend/**tests**/global-navigation.test.tsx                          |      0 |        8 |       0 |       0 |                 - |
| frontend/**tests**/country-mapping.test.ts                             |      3 |        5 |       0 |       0 |                 - |
| frontend/app/providers.tsx                                             |      2 |        6 |       0 |       1 |              56.7 |
| frontend/components/article-detail-modal-layout.tsx                    |      8 |        0 |       3 |       4 |              43.5 |
| frontend/components/reading-queue-list.tsx                             |      0 |        7 |       0 |       2 |              54.4 |
| frontend/**tests**/appearance-settings.test.ts                         |      3 |        4 |       0 |       0 |                 - |
| scripts/tests/quality-hardening/config.test.mjs                        |      5 |        2 |       0 |       0 |                 - |
| scripts/tests/check-crap.test.mjs                                      |      5 |        2 |       0 |       0 |                 - |
| frontend/app/saved/saved-workspace-model.ts                            |      2 |        5 |       0 |       2 |              51.7 |
| frontend/**tests**/globe-live-data.test.ts                             |      2 |        5 |       0 |       0 |                 - |
| frontend/components/article-detail-modal-language.tsx                  |      7 |        0 |       0 |       0 |                 - |
| frontend/lib/date-formatters.ts                                        |      0 |        6 |       0 |       0 |                 - |
| frontend/lib/api/primitives.ts                                         |      0 |        6 |       0 |       0 |                 - |
| frontend/components/ui/scroll-area.tsx                                 |      0 |        6 |       0 |       0 |                 - |
| frontend/components/navigation/navigation-state.ts                     |      4 |        2 |       0 |       0 |                 - |
| scripts/quality-hardening/protocol.mjs                                 |      1 |        5 |       0 |       0 |                 - |
| frontend/**tests**/inline-definition.test.tsx                          |      2 |        4 |       0 |       0 |                 - |
| frontend/**tests**/live-browse-index.test.tsx                          |      2 |        4 |       0 |       0 |                 - |
| frontend/**tests**/search-research-state.test.ts                       |      0 |        6 |       0 |       0 |                 - |
| scripts/quality-hardening/cache-key.mjs                                |      2 |        4 |       0 |       0 |                 - |
| frontend/lib/news-lens.ts                                              |      1 |        5 |       0 |       0 |                 - |
| frontend/app/search/research/stream/research-stream.ts                 |      0 |        5 |       1 |       1 |              49.4 |
| frontend/**tests**/interactive-globe-helpers.test.tsx                  |      0 |        5 |       0 |       0 |                 - |
| frontend/features/wiki/ui/wiki-citation-panel.tsx                      |      1 |        4 |       0 |       0 |                 - |
| frontend/lib/globe-country.ts                                          |      3 |        2 |       0 |       0 |                 - |
| frontend/app/wiki/organization/[id]/page.tsx                           |      1 |        4 |       0 |       0 |                 - |
| scripts/tests/quality-hardening/adapters.test.mjs                      |      4 |        1 |       0 |       0 |                 - |
| frontend/app/wiki/person/[id]/page.tsx                                 |      1 |        4 |       0 |       0 |                 - |
| frontend/**tests**/semantic-search.test.ts                             |      3 |        2 |       0 |       0 |                 - |
| scripts/tests/quality-source-files.test.mjs                            |      5 |        0 |       0 |       0 |                 - |
| frontend/jest.config.js                                                |      0 |        5 |       0 |       0 |                 - |
| frontend/**tests**/trending-cluster-nullables.test.ts                  |      2 |        2 |       0 |       0 |                 - |
| frontend/components/ui/button.tsx                                      |      1 |        3 |       0 |       0 |                 - |
| frontend/lib/api/og-image.ts                                           |      0 |        4 |       1 |       1 |              49.5 |
| frontend/components/ui/tooltip.tsx                                     |      0 |        4 |       0 |       0 |                 - |
| frontend/next.config.mjs                                               |      3 |        1 |       0 |       0 |                 - |
| frontend/components/article-detail-modal-sidebar.tsx                   |      4 |        0 |       2 |       3 |              43.7 |
| frontend/app/search/research/components/chat-composer.tsx              |      0 |        3 |       0 |       2 |              50.3 |
| frontend/**tests**/api.agentic-search.test.ts                          |      2 |        1 |       0 |       0 |                 - |
| scripts/tests/quality-hardening/source-units.test.mjs                  |      3 |        0 |       0 |       0 |                 - |
| frontend/**tests**/source-groups.test.ts                               |      3 |        0 |       0 |       0 |                 - |
| frontend/**tests**/api.categories.test.ts                              |      2 |        1 |       0 |       0 |                 - |
| frontend/app/search/research/components/research-messages.tsx          |      0 |        2 |       2 |       2 |              44.9 |
| frontend/components/safe-image.tsx                                     |      0 |        2 |       0 |       1 |              55.3 |
| frontend/lib/article-detail-modal-types.ts                             |      1 |        1 |       0 |       0 |                 - |
| frontend/components/reading-queue-embeds.tsx                           |      0 |        2 |       0 |       0 |                 - |
| frontend/lib/news-view-state.ts                                        |      2 |        0 |       0 |       0 |                 - |
| frontend/hooks/use-article-detail.ts                                   |      2 |        0 |       0 |       0 |                 - |
| frontend/components/article-detail-modal-reader.tsx                    |      2 |        0 |       1 |       4 |              48.9 |
| frontend/app/search/research/state/persistence.ts                      |      0 |        1 |       0 |       0 |                 - |
| frontend/hooks/useBookmarks.ts                                         |      0 |        1 |       0 |       1 |              56.4 |
| frontend/app/search/research/research-page.tsx                         |      0 |        1 |       0 |       0 |                 - |
| scripts/quality-hardening/adapters/cccc.mjs                            |      0 |        1 |       0 |       0 |                 - |
| frontend/**tests**/date-formatters.test.ts                             |      0 |        1 |       0 |       0 |                 - |
| frontend/**tests**/news-view-state.test.ts                             |      0 |        1 |       0 |       0 |                 - |
| scripts/quality-hardening.mjs                                          |      0 |        1 |       0 |       0 |                 - |
| frontend/**tests**/news-lens.test.ts                                   |      1 |        0 |       0 |       0 |                 - |
| frontend/components/observability/browser-telemetry.tsx                |      0 |        0 |       2 |       7 |              45.6 |
| frontend/lib/highlight-markdown.ts                                     |      0 |        0 |       1 |       3 |              46.5 |
| frontend/lib/highlight-utils.tsx                                       |      0 |        0 |       2 |       2 |              46.7 |
| frontend/features/intelligence-atlas/lib/atlas-query-state.ts          |      0 |        0 |       2 |       3 |              46.9 |
| frontend/components/ui/badge.tsx                                       |      0 |        0 |       1 |       1 |                47 |
| frontend/features/intelligence-atlas/hooks/use-atlas-layout.ts         |      0 |        0 |       2 |       5 |              47.1 |
| frontend/components/highlight-note-popover.tsx                         |      0 |        0 |       2 |       8 |              47.7 |
| frontend/hooks/use-favorites.ts                                        |      0 |        0 |       1 |       1 |              47.7 |
| frontend/hooks/use-source-filter.ts                                    |      0 |        0 |       0 |       1 |              50.1 |
| frontend/features/intelligence-atlas/lib/atlas-api.ts                  |      0 |        0 |       0 |       4 |              50.2 |
| frontend/components/article-detail-modal-chrome.tsx                    |      0 |        0 |       0 |       5 |              50.7 |
| frontend/features/intelligence-atlas/atlas-context-panel.tsx           |      0 |        0 |       0 |       1 |              50.7 |
| frontend/features/intelligence-atlas/lib/atlas-force-layout.ts         |      0 |        0 |       0 |       7 |              50.7 |
| frontend/components/novelty-badge.tsx                                  |      0 |        0 |       0 |       3 |              51.5 |
| frontend/components/navigation/sidebar-navigation-item.tsx             |      0 |        0 |       0 |       1 |              51.7 |
| frontend/features/intelligence-atlas/atlas-accessible-list.tsx         |      0 |        0 |       0 |       1 |              52.4 |
| frontend/components/ui/input.tsx                                       |      0 |        0 |       0 |       1 |              52.5 |
| frontend/features/intelligence-atlas/funding-bias-panel.tsx            |      0 |        0 |       0 |       1 |              52.7 |
| frontend/components/theme-toggle.tsx                                   |      0 |        0 |       0 |       2 |              52.9 |
| frontend/lib/highlight-processing.ts                                   |      0 |        0 |       0 |       1 |              53.6 |
| frontend/components/semantic-tags.tsx                                  |      0 |        0 |       0 |       1 |              53.7 |
| frontend/components/digest-card.tsx                                    |      0 |        0 |       0 |       3 |              53.9 |
| frontend/features/intelligence-atlas/ownership-chain.tsx               |      0 |        0 |       0 |       3 |              54.1 |
| frontend/lib/highlight-offset.ts                                       |      0 |        0 |       0 |       4 |              54.2 |
| frontend/components/queue-overview-card.tsx                            |      0 |        0 |       0 |       1 |              55.3 |
| frontend/hooks/use-liked-articles.ts                                   |      0 |        0 |       0 |       1 |              55.6 |
| frontend/app/wiki/ownership/error.tsx                                  |      0 |        0 |       0 |       1 |              56.1 |
| frontend/components/article-detail-modal-wiki.tsx                      |      0 |        0 |       0 |       2 |              56.4 |
| frontend/components/navigation/sidebar-section.tsx                     |      0 |        0 |       0 |       1 |              56.4 |
| frontend/lib/article-content.ts                                        |      0 |        0 |       0 |       1 |              56.6 |
| frontend/hooks/use-modal-integrations.ts                               |      0 |        0 |       0 |       1 |              56.9 |
| frontend/components/live-news-source-picker.tsx                        |      0 |        0 |       0 |       3 |              57.8 |
| frontend/lib/article-detail-modal-data.ts                              |      0 |        0 |       0 |       1 |              58.5 |
| frontend/app/wiki/analysis/funding-bias/funding-bias-analysis-view.tsx |      0 |        0 |       0 |       1 |                59 |
| frontend/components/read-time-badge.tsx                                |      0 |        0 |       0 |       1 |              59.7 |
| frontend/components/theme-provider.tsx                                 |      0 |        0 |       0 |       1 |              59.7 |

## Annex B. Complete direct Oxlint rule inventory

Counts retain the installed tool's diagnostic names. These are findings to fix, not
recommendations to enable, disable, rename or reclassify rules.

| Rule                                                    | Errors | Warnings |
| ------------------------------------------------------- | -----: | -------: |
| typescript(prefer-readonly-parameter-types)             |   1256 |        0 |
| react(jsx-max-depth)                                    |      0 |     1064 |
| eslint(no-ternary)                                      |      0 |      811 |
| eslint(sort-vars)                                       |      0 |      705 |
| typescript(strict-boolean-expressions)                  |      0 |      527 |
| import(group-exports)                                   |      0 |      307 |
| react-perf(jsx-no-new-function-as-prop)                 |    248 |        0 |
| eslint(id-length)                                       |      0 |      234 |
| eslint(max-lines-per-function)                          |      0 |      176 |
| typescript(prefer-nullish-coalescing)                   |      0 |      176 |
| react(function-component-definition)                    |    162 |        0 |
| import(exports-last)                                    |      0 |      156 |
| typescript(no-floating-promises)                        |    142 |        0 |
| jsdoc(require-returns)                                  |      0 |      123 |
| typescript(no-unsafe-member-access)                     |      0 |      122 |
| react(jsx-props-no-spreading)                           |      0 |      112 |
| typescript(consistent-return)                           |    111 |        0 |
| anti-slop(no-runtime-typeof)                            |    105 |        0 |
| eslint(max-statements)                                  |      0 |      100 |
| typescript(no-unsafe-argument)                          |      0 |      100 |
| jsdoc(require-param)                                    |      0 |       87 |
| typescript(no-unsafe-type-assertion)                    |     79 |        0 |
| react(jsx-handler-names)                                |      0 |       78 |
| react-perf(jsx-no-new-object-as-prop)                   |     78 |        0 |
| typescript(no-unsafe-assignment)                        |      0 |       72 |
| eslint(no-unused-vars)                                  |     61 |        0 |
| anti-slop(require-safety-comment-for-type-assertion)    |     58 |        0 |
| typescript(no-unsafe-return)                            |      0 |       52 |
| typescript(strict-void-return)                          |      0 |       49 |
| typescript(no-unsafe-call)                              |      0 |       43 |
| jsdoc(require-param-description)                        |      0 |       38 |
| eslint(sort-keys)                                       |      0 |       38 |
| unicorn(no-array-sort)                                  |     36 |        0 |
| react(no-array-index-key)                               |     36 |        0 |
| anti-slop(no-known-value-widening)                      |     36 |        0 |
| import(no-nodejs-modules)                               |     34 |        0 |
| unicorn(max-nested-calls)                               |      0 |       33 |
| eslint(no-nested-ternary)                               |      0 |       32 |
| eslint(max-lines)                                       |      0 |       30 |
| react-hooks(exhaustive-deps)                            |     30 |        0 |
| react(memo-dependencies)                                |     30 |        0 |
| node(no-sync)                                           |      0 |       29 |
| react-perf(jsx-no-new-array-as-prop)                    |     28 |        0 |
| typescript(no-non-null-assertion)                       |     28 |        0 |
| eslint(no-continue)                                     |      0 |       27 |
| eslint(no-inline-comments)                              |      0 |       27 |
| eslint(eqeqeq)                                          |      0 |       24 |
| typescript(no-deprecated)                               |      0 |       24 |
| anti-slop(no-unknown-parameters)                        |     23 |        0 |
| anti-slop(no-unsafe-dictionary-type)                    |     23 |        0 |
| react(refs)                                             |     22 |        0 |
| promise(prefer-await-to-then)                           |      0 |       21 |
| typescript(require-await)                               |      0 |       21 |
| unicorn(switch-case-braces)                             |      0 |       20 |
| import(max-dependencies)                                |      0 |       19 |
| import(first)                                           |      0 |       19 |
| eslint(no-underscore-dangle)                            |     18 |        0 |
| typescript(no-misused-promises)                         |      0 |       18 |
| typescript(no-base-to-string)                           |     17 |        0 |
| eslint(init-declarations)                               |      0 |       16 |
| unicorn(no-array-callback-reference)                    |      0 |       16 |
| jest(no-conditional-in-test)                            |      0 |       16 |
| anti-slop(no-object-parameters)                         |     16 |        0 |
| import(no-namespace)                                    |      0 |       15 |
| jest(prefer-ending-with-an-expect)                      |      0 |       15 |
| jsx-a11y(prefer-tag-over-role)                          |     14 |        0 |
| eslint(prefer-named-capture-group)                      |      0 |       14 |
| jest(require-hook)                                      |      0 |       13 |
| unicorn(no-await-expression-member)                     |      0 |       13 |
| react(jsx-no-useless-fragment)                          |      0 |       12 |
| typescript(no-unnecessary-type-conversion)              |     11 |        0 |
| jsdoc(require-returns-description)                      |      0 |       10 |
| typescript(no-confusing-void-expression)                |      0 |       10 |
| typescript(no-unnecessary-type-parameters)              |      9 |        0 |
| eslint(no-await-in-loop)                                |      0 |        8 |
| typescript(unbound-method)                              |      8 |        0 |
| thesis(no-hook-object-dependencies)                     |      7 |        0 |
| promise(prefer-await-to-callbacks)                      |      0 |        7 |
| jest(prefer-strict-equal)                               |      0 |        7 |
| unicorn(empty-brace-spaces)                             |      0 |        6 |
| unicorn(no-useless-undefined)                           |      0 |        6 |
| eslint(no-shadow)                                       |      6 |        0 |
| unicorn(no-nested-ternary)                              |      0 |        6 |
| eslint(require-unicode-regexp)                          |      0 |        6 |
| typescript(switch-exhaustiveness-check)                 |      0 |        6 |
| import(newline-after-import)                            |      0 |        5 |
| eslint(max-params)                                      |      5 |        0 |
| react(set-state-in-effect)                              |      5 |        0 |
| anti-slop(no-unknown-returns)                           |      5 |        0 |
| unicorn(filename-case)                                  |      0 |        5 |
| jsx-a11y(click-events-have-key-events)                  |      5 |        0 |
| jest(max-expects)                                       |      0 |        5 |
| eslint(no-useless-return)                               |      0 |        4 |
| unicorn(no-negated-condition)                           |      0 |        4 |
| eslint(no-negated-condition)                            |      0 |        4 |
| promise(avoid-new)                                      |      0 |        4 |
| promise(param-names)                                    |      0 |        4 |
| anti-slop(no-conditional-empty-object-spread)           |      4 |        0 |
| import(consistent-type-specifier-style)                 |      0 |        4 |
| jsx-a11y(no-static-element-interactions)                |      4 |        0 |
| react(immutability)                                     |      4 |        0 |
| oxc(no-map-spread)                                      |      4 |        0 |
| typescript(dot-notation)                                |      0 |        4 |
| typescript(restrict-template-expressions)               |      4 |        0 |
| typescript(array-type)                                  |      0 |        3 |
| jsx-a11y(control-has-associated-label)                  |      3 |        0 |
| eslint(max-depth)                                       |      3 |        0 |
| unicorn(no-immediate-mutation)                          |      0 |        3 |
| promise(always-return)                                  |      3 |        0 |
| anti-slop(no-chained-type-assertions)                   |      3 |        0 |
| eslint(no-eval)                                         |      3 |        0 |
| unicorn(no-object-as-default-parameter)                 |      0 |        3 |
| typescript(prefer-promise-reject-errors)                |      0 |        3 |
| unicorn(prefer-export-from)                             |      0 |        2 |
| jsx-a11y(no-noninteractive-element-to-interactive-role) |      2 |        0 |
| unicorn(prefer-code-point)                              |      0 |        2 |
| react(incompatible-library)                             |      2 |        0 |
| eslint(array-callback-return)                           |      0 |        2 |
| anti-slop(no-shape-in-symbol-names)                     |      2 |        0 |
| react(exhaustive-effect-dependencies)                   |      2 |        0 |
| unicorn(prefer-string-slice)                            |      0 |        2 |
| unicorn(explicit-length-check)                          |      0 |        2 |
| unicorn(prefer-top-level-await)                         |      0 |        2 |
| unicorn(no-useless-switch-case)                         |      0 |        2 |
| react(hook-use-state)                                   |      0 |        2 |
| typescript(no-unnecessary-type-assertion)               |      2 |        0 |
| eslint(arrow-body-style)                                |      0 |        1 |
| unicorn(prefer-math-trunc)                              |      0 |        1 |
| unicorn(prefer-ternary)                                 |      0 |        1 |
| import(no-unassigned-import)                            |      1 |        0 |
| thesis(no-fragile-map-keys)                             |      1 |        0 |
| react(state-in-constructor)                             |      0 |        1 |
| react(no-set-state)                                     |      0 |        1 |
| eslint(no-redeclare)                                    |      0 |        1 |
| eslint(no-promise-executor-return)                      |      0 |        1 |
| jsx-a11y(no-noninteractive-element-interactions)        |      1 |        0 |
| jsx-a11y(no-autofocus)                                  |      1 |        0 |
| jsdoc(require-yields)                                   |      1 |        0 |
| unicorn(no-lonely-if)                                   |      0 |        1 |
| typescript(no-empty-interface)                          |      0 |        1 |
| typescript(no-inferrable-types)                         |      0 |        1 |
| unicorn(no-useless-collection-argument)                 |      0 |        1 |
| eslint(logical-assignment-operators)                    |      0 |        1 |
| node(callback-return)                                   |      0 |        1 |
| unicorn(no-array-reverse)                               |      1 |        0 |
| unicorn(prefer-native-coercion-functions)               |      0 |        1 |
| react(no-object-type-as-default-prop)                   |      1 |        0 |
| eslint(no-unreachable)                                  |      1 |        0 |
| unicorn(prefer-string-replace-all)                      |      0 |        1 |
| unicorn(prefer-string-raw)                              |      0 |        1 |
| eslint(no-unmodified-loop-condition)                    |      1 |        0 |
| react(iframe-missing-sandbox)                           |      1 |        0 |
| jsx-a11y(iframe-has-title)                              |      1 |        0 |
| unicorn(prefer-number-coercion)                         |      0 |        1 |
| react-perf(jsx-no-jsx-as-prop)                          |      1 |        0 |
| unicorn(new-for-builtins)                               |      0 |        1 |
| react(display-name)                                     |      0 |        1 |
| jest(prefer-importing-jest-globals)                     |      0 |        1 |
| typescript(consistent-type-definitions)                 |      1 |        0 |
| unicorn(custom-error-definition)                        |      0 |        1 |
| promise(prefer-catch)                                   |      0 |        1 |
| node(no-mixed-requires)                                 |      0 |        1 |
| react(use-memo)                                         |      1 |        0 |
| eslint(no-unused-expressions)                           |      1 |        0 |
| typescript(no-useless-default-assignment)               |      1 |        0 |
| typescript(no-misused-spread)                           |      1 |        0 |
| typescript(no-unnecessary-type-arguments)               |      1 |        0 |
| typescript(await-thenable)                              |      1 |        0 |

## Annex C. Every frontend function below MI 50

The 487 additional functions between MI 50 and 60 are included in each file's annex A count
and remain part of phase 15. Function names and line numbers refer to the starting snapshot.
Anonymous functions require inspection at that location before assigning a refactor.

| Location                                                                  | Function                          |   MI | Analyzer CC |
| ------------------------------------------------------------------------- | --------------------------------- | ---: | ----------: |
| frontend/components/article-detail-modal.tsx:137                          | ArticleDetailModalContent         | 18.6 |           5 |
| frontend/components/interactive-globe.tsx:1042                            | InteractiveGlobe                  | 22.2 |          23 |
| frontend/app/settings/page.tsx:211                                        | AppearanceSettingsPage            |   23 |           5 |
| frontend/components/reading-queue-sidebar.tsx:95                          | useReadingQueueController         | 23.7 |          26 |
| frontend/components/article-detail-modal.tsx:1394                         | useModalArticleState              |   24 |           3 |
| frontend/components/globe-view.tsx:2261                                   | GlobeViewContent                  | 24.5 |           7 |
| frontend/components/stream-card.tsx:28                                    | StreamCard                        | 27.7 |          23 |
| frontend/components/chat-sidebar.tsx:423                                  | ChatSidebar                       | 27.8 |           8 |
| frontend/components/interactive-globe.tsx:1135                            | <anonymous>                       | 28.4 |          13 |
| frontend/components/grid-view.tsx:1378                                    | GridView                          | 28.9 |           8 |
| frontend/components/global-navigation.tsx:50                              | GlobalNavigation                  |   29 |          14 |
| frontend/app/debug/debug-dashboard.tsx:1504                               | DebugDashboardController          | 30.4 |           2 |
| frontend/features/intelligence-atlas/intelligence-atlas-workspace.tsx:575 | IntelligenceAtlasWorkspace        | 30.9 |           8 |
| frontend/components/virtualized-grid.tsx:189                              | VirtualizedGrid                   | 31.2 |          12 |
| frontend/components/notification-popup.tsx:52                             | NotificationsPopup                | 31.4 |          14 |
| frontend/app/search/research/state/research-reducer.ts:114                | researchReducer                   | 31.5 |          24 |
| frontend/components/add-rss-dialog.tsx:142                                | AddRssDialog                      | 31.5 |          16 |
| frontend/app/search/research/hooks/use-research-controller.ts:332         | useResearchChatState              | 31.7 |           6 |
| frontend/components/virtualized-grid.tsx:43                               | <anonymous>                       |   32 |           9 |
| frontend/components/live-news-view.tsx:103                                | LiveNewsView                      | 32.1 |           5 |
| frontend/features/intelligence-atlas/atlas-entity-list.tsx:426            | AtlasEntityList                   | 32.2 |          16 |
| frontend/hooks/usePaginatedNews.ts:37                                     | usePaginatedNews                  | 32.5 |          20 |
| frontend/components/highlights-view.tsx:11                                | HighlightsView                    | 32.7 |          12 |
| frontend/components/grid-view.tsx:104                                     | SourceArticleCard                 |   33 |          13 |
| frontend/components/highlight-toolbar.tsx:225                             | HighlightToolbar                  | 33.3 |          18 |
| frontend/components/source-sidebar.tsx:629                                | SourceSidebar                     | 33.4 |           5 |
| frontend/components/source-coverage-comparison.tsx:20                     | SourceCoverageComparison          | 33.5 |          13 |
| frontend/components/contradiction-panel.tsx:12                            | ContradictionPanel                | 33.7 |          15 |
| frontend/components/grid-view.tsx:1268                                    | useGridTopicController            | 33.7 |          26 |
| frontend/app/search/research/hooks/use-research-controller.ts:477         | useResearchChatActions            | 33.9 |          11 |
| frontend/components/chat-sidebar.tsx:297                                  | useChatSidebarState               | 33.9 |          14 |
| frontend/components/cluster-detail-modal.tsx:343                          | useClusterComparisonController    | 34.4 |          18 |
| frontend/components/cluster-detail-modal.tsx:1559                         | ClusterDetailModalContent         | 34.4 |           7 |
| frontend/components/source-credibility-panel.tsx:142                      | SourceCredibilityPanel            | 34.5 |          11 |
| frontend/features/intelligence-atlas/atlas-topbar.tsx:63                  | AtlasTopbar                       | 34.5 |          14 |
| frontend/components/grid-view.tsx:1076                                    | useGridSourceController           | 34.9 |          13 |
| frontend/components/interactive-globe.tsx:924                             | usePolygonPresentation            | 35.3 |          22 |
| frontend/components/reading-queue-card.tsx:42                             | QueueCard                         | 35.9 |          15 |
| frontend/components/trending-feed.tsx:130                                 | TrendingFeed                      |   36 |           9 |
| frontend/components/trending-feed.tsx:307                                 | BreakingCard                      |   36 |           8 |
| frontend/app/wiki/person/[id]/person-wiki-view.tsx:88                     | PersonWikiPanels                  | 36.6 |          12 |
| frontend/components/trending-feed.tsx:416                                 | TrendingCard                      | 36.6 |           8 |
| frontend/components/verification-panel.tsx:39                             | VerificationPanel                 | 36.6 |          11 |
| frontend/app/wiki/ownership/source-intelligence-operations.tsx:130        | SourceIntelligenceOperations      | 36.7 |           5 |
| frontend/components/story-lineage-panel.tsx:113                           | StoryLineagePanel                 |   37 |          13 |
| frontend/components/grid-view.tsx:334                                     | SourceGroupSection                | 37.1 |           9 |
| frontend/components/reading-queue-queries.ts:126                          | useReadingQueueQueries            | 37.2 |          14 |
| frontend/components/feed-view.tsx:941                                     | FeedView                          | 37.4 |           1 |
| frontend/components/interactive-globe.tsx:1171                            | bindEarthTextures                 | 37.4 |           4 |
| frontend/components/grid-view.tsx:444                                     | TopicClusterCard                  | 37.9 |           8 |
| frontend/components/reading-queue-sidebar.tsx:319                         | QueueSheetBody                    | 38.4 |           3 |
| frontend/components/related-articles.tsx:18                               | RelatedArticles                   | 38.4 |           7 |
| frontend/components/article-detail-modal.tsx:1606                         | useModalHighlightActions          | 38.6 |           5 |
| frontend/components/credibility-badge.tsx:328                             | CredibilityBadge                  | 38.6 |           9 |
| frontend/app/debug/debug-dashboard.tsx:3027                               | useCoreDebugQueries               | 38.8 |           2 |
| frontend/components/feed-view.tsx:558                                     | FeedStory                         | 38.8 |           4 |
| frontend/features/intelligence-atlas/intelligence-atlas-workspace.tsx:226 | useAtlasSearch                    | 39.1 |          11 |
| frontend/app/wiki/person/[id]/person-wiki-view.tsx:205                    | PersonWikiSidebar                 | 39.4 |           7 |
| frontend/components/grid-view.tsx:1194                                    | useGridModalController            | 39.4 |          11 |
| frontend/lib/performance-logger.ts:269                                    | logPageLoad                       | 39.4 |           7 |
| frontend/app/wiki/reporter/[id]/career-timeline.tsx:21                    | CareerTimeline                    | 39.5 |          16 |
| frontend/components/cluster-detail-modal.tsx:486                          | ClusterDetailView                 | 39.6 |           8 |
| frontend/features/intelligence-atlas/atlas-operations-sheet.tsx:29        | AtlasOperationsSheet              | 39.6 |           8 |
| frontend/components/cluster-detail-modal.tsx:1092                         | EntitiesBlock                     | 39.7 |           3 |
| frontend/components/highlight-toolbar.tsx:275                             | <anonymous>                       | 39.7 |          12 |
| frontend/components/blindspot-view.tsx:841                                | BlindspotView                     | 39.8 |           8 |
| frontend/hooks/use-scroll-personalization.ts:235                          | useScrollPersonalization          |   40 |          13 |
| frontend/lib/globe-live-data.ts:152                                       | buildLocalLensFromArticles        |   40 |          15 |
| frontend/components/feed-view.tsx:873                                     | useFeedRankingState               | 40.1 |           8 |
| frontend/features/intelligence-atlas/intelligence-atlas-workspace.tsx:329 | useAtlasData                      | 40.1 |           4 |
| frontend/app/saved/use-saved-workspace-controller.ts:213                  | useSavedWorkspaceController       | 40.2 |           2 |
| frontend/components/blindspot-view.tsx:389                                | MobileBlindspotTile               | 40.2 |           7 |
| frontend/app/wiki/person/[id]/person-wiki-view.tsx:16                     | PersonWikiView                    | 41.1 |           5 |
| frontend/components/article-inline-embed.tsx:71                           | ArticleInlineEmbed                | 41.2 |           8 |
| frontend/lib/appearance-settings.ts:158                                   | normalizeAppearanceSettings       | 41.2 |           3 |
| frontend/app/search/research/components/empty-research-view.tsx:77        | EmptyResearchComposer             | 41.3 |           6 |
| frontend/components/confidence-badge.tsx:37                               | ConfidenceBadge                   | 41.5 |           6 |
| frontend/components/navigation/workspace-search.tsx:13                    | WorkspaceSearch                   | 41.6 |           6 |
| frontend/app/search/research/hooks/use-research-transport.ts:147          | useResearchTransport              | 41.8 |           5 |
| frontend/components/globe-view-model.ts:149                               | useGlobeDisplayData               | 41.8 |          10 |
| frontend/components/search-suggestions.tsx:18                             | SearchSuggestions                 | 41.8 |           7 |
| frontend/components/globe-ui-state.ts:144                                 | useGlobeInteractionActions        | 41.9 |           9 |
| frontend/components/virtualized-grid.tsx:291                              | <anonymous>                       | 41.9 |           3 |
| frontend/app/wiki/reporter/[id]/career-timeline.tsx:76                    | <anonymous>                       |   42 |          10 |
| frontend/components/live-news-view.tsx:30                                 | useLiveNewsHandlers               |   42 |           7 |
| frontend/hooks/use-article-reaction.ts:61                                 | useArticleReaction                | 42.1 |           7 |
| frontend/components/blindspot-view.tsx:457                                | useBlindspotData                  | 42.2 |          10 |
| frontend/app/debug/debug-dashboard.tsx:1379                               | useDebugActionMutations           | 42.3 |          11 |
| frontend/app/source/[sourceId]/page.tsx:98                                | SourcePage                        | 42.3 |           4 |
| frontend/features/intelligence-atlas/atlas-stage-shell.tsx:148            | AtlasStageShell                   | 42.3 |           3 |
| frontend/hooks/useReadingHistory.ts:22                                    | useReadingHistory                 | 42.3 |           7 |
| frontend/components/cluster-detail-modal.tsx:360                          | <anonymous>                       | 42.4 |           9 |
| frontend/components/feed-view.tsx:1031                                    | FeedViewContent                   | 42.4 |           8 |
| frontend/app/source/[sourceId]/page.tsx:288                               | SourceSidebar                     | 42.6 |           4 |
| frontend/components/blindspot-view.tsx:330                                | StoryRow                          | 42.7 |           4 |
| frontend/lib/verification.ts:80                                           | streamVerification                | 42.9 |           9 |
| frontend/components/globe-ui-state.ts:28                                  | useGlobeSelectionState            |   43 |           1 |
| frontend/components/live-news-toolbar.tsx:17                              | LiveNewsToolbar                   |   43 |           6 |
| frontend/app/page.tsx:1329                                                | useNewsPageViewData               | 43.1 |           2 |
| frontend/app/search/research/hooks/use-research-controller.ts:741         | useResearchDerivedState           | 43.1 |           3 |
| frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx:627            | OrganizationPanel                 | 43.2 |           7 |
| frontend/components/source-credibility-panel.tsx:83                       | CredibilityDimension              | 43.3 |           9 |
| frontend/components/article-detail-modal-analysis.tsx:255                 | FactCheckLiveResearch             | 43.4 |           5 |
| frontend/components/cluster-detail-modal.tsx:287                          | useClusterArticleController       | 43.4 |          11 |
| frontend/components/trending-feed.tsx:230                                 | TrendingFeedContent               | 43.4 |           2 |
| frontend/components/article-detail-modal-layout.tsx:234                   | ArticleDetailPrimaryColumn        | 43.5 |           1 |
| frontend/app/saved/use-saved-workspace-controller.ts:92                   | useSavedLibraryState              | 43.6 |           4 |
| frontend/components/article-detail-modal-sidebar.tsx:52                   | ArticleDetailSidebarReaderTools   | 43.7 |           2 |
| frontend/lib/globe-live-data.ts:57                                        | buildCountryMetricsFromArticles   | 43.8 |           6 |
| frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx:80             | SourceWikiView                    | 44.2 |           2 |
| frontend/app/saved/saved-workspace-view.tsx:240                           | ArticleCardHeader                 | 44.3 |           6 |
| frontend/app/saved/saved-workspace-view.tsx:734                           | QueueTab                          | 44.3 |           8 |
| frontend/components/chat-sidebar.tsx:227                                  | ChatListItemCard                  | 44.3 |           2 |
| frontend/components/cluster-detail-modal.tsx:602                          | ClusterHeader                     | 44.3 |           4 |
| frontend/hooks/use-inline-definition.ts:50                                | requestInlineDefinitionForTerm    | 44.3 |          10 |
| frontend/hooks/use-news-index.ts:31                                       | useNewsIndex                      | 44.3 |          11 |
| frontend/app/search/research/components/message-item.tsx:232              | MessageActionButtons              | 44.4 |           3 |
| frontend/components/cluster-detail-modal.tsx:822                          | ArticleTabHeader                  | 44.4 |           4 |
| frontend/components/verification-panel.tsx:252                            | ClaimCard                         | 44.4 |           6 |
| frontend/lib/appearance-settings.ts:320                                   | numericProperties                 | 44.4 |           1 |
| frontend/components/source-research-panel.tsx:31                          | useSourceResearchController       | 44.5 |           4 |
| frontend/app/page.tsx:1102                                                | useNewsPageState                  | 44.6 |           1 |
| frontend/components/cluster-detail-modal.tsx:215                          | requestComparison                 | 44.6 |           8 |
| frontend/components/article-detail-modal.tsx:486                          | ArticleDetailModalView            | 44.7 |           1 |
| frontend/components/feed-view.tsx:332                                     | fetchImages                       | 44.7 |          10 |
| frontend/components/feed-view.tsx:795                                     | useFeedActionHandlers             | 44.8 |           8 |
| frontend/app/search/research/components/research-messages.tsx:26          | ConversationMessageList           | 44.9 |           2 |
| frontend/app/search/research/hooks/use-research-transport.ts:182          | <anonymous>                       | 44.9 |           2 |
| frontend/components/blindspot-view.tsx:277                                | LeadStoryDetails                  | 44.9 |           4 |
| frontend/components/globe-view.tsx:1156                                   | CollapsedPanelTabContent          | 44.9 |           3 |
| frontend/app/search/research/components/message-item.tsx:176              | MessageVersionControls            |   45 |           6 |
| frontend/components/blindspot-view.tsx:778                                | BlindspotLaneCards                |   45 |           4 |
| frontend/components/globe-ui-state.ts:86                                  | useSheetDragCallbacks             |   45 |          10 |
| frontend/app/debug/debug-dashboard.tsx:1267                               | selectDebugDashboardData          | 45.3 |           7 |
| frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx:771            | AnalysisAxisCard                  | 45.3 |           9 |
| frontend/lib/feed-ranking.ts:380                                          | scoreArticle                      | 45.4 |           9 |
| frontend/app/debug/debug-dashboard.tsx:3097                               | useTabDebugQueries                | 45.5 |           2 |
| frontend/components/observability/browser-telemetry.tsx:235               | setupBrowserTelemetry             | 45.6 |           4 |
| frontend/app/saved/saved-workspace-view.tsx:297                           | CardActionButtons                 | 45.7 |           9 |
| frontend/app/search/research/components/research-messages.tsx:83          | ChatScrollArea                    | 45.8 |           1 |
| frontend/app/source/[sourceId]/page.tsx:228                               | SourceHeader                      | 45.8 |           2 |
| frontend/app/search/research/hooks/use-research-controller.ts:241         | submitResearchPrompt              | 45.9 |           3 |
| frontend/app/wiki/reporter/[id]/reporter-wiki-view.tsx:410                | ReporterWikiView                  | 45.9 |           6 |
| frontend/app/debug/debug-dashboard.tsx:1044                               | useDatabaseDebugState             |   46 |           1 |
| frontend/features/intelligence-atlas/atlas-entity-list.tsx:316            | EntityRow                         |   46 |           7 |
| frontend/app/sources/[source]/debug/page.tsx:62                           | SourceDebugPage                   | 46.2 |           4 |
| frontend/app/debug/article-parser-card.tsx:31                             | ArticleParserResult               | 46.3 |          12 |
| frontend/components/highlight-toolbar.tsx:240                             | <anonymous>                       | 46.5 |           6 |
| frontend/components/interactive-globe.tsx:600                             | createStarField                   | 46.5 |           2 |
| frontend/lib/highlight-markdown.ts:6                                      | buildObsidianMarkdown             | 46.5 |           5 |
| frontend/components/source-sidebar.tsx:470                                | AllSourcesSection                 | 46.7 |           4 |
| frontend/lib/highlight-utils.tsx:115                                      | renderTextWithHighlights          | 46.7 |           7 |
| frontend/app/saved/saved-workspace-view.tsx:681                           | QueueArticle                      | 46.8 |           2 |
| frontend/app/search/research/components/message-item.tsx:425              | InlineMessageEditor               | 46.9 |           5 |
| frontend/app/search/research/hooks/use-research-controller.ts:944         | useResearchPromptSubmission       | 46.9 |           1 |
| frontend/components/verification-panel.tsx:149                            | VerificationPanelContent          | 46.9 |          10 |
| frontend/features/intelligence-atlas/lib/atlas-query-state.ts:129         | buildSerializationEntries         | 46.9 |           5 |
| frontend/components/ui/badge.tsx:23                                       | Badge                             |   47 |           3 |
| frontend/app/wiki/reporters/page.tsx:310                                  | ReporterDirectoryFilters          | 47.1 |           5 |
| frontend/features/intelligence-atlas/hooks/use-atlas-layout.ts:157        | useAtlasLayout                    | 47.1 |           9 |
| frontend/lib/performance-logger.ts:327                                    | logEvent                          | 47.1 |           4 |
| frontend/components/cluster-detail-modal.tsx:927                          | ArticleTabActions                 | 47.2 |           6 |
| frontend/components/observability/browser-telemetry.tsx:86                | collectBrowserTimings             | 47.4 |           7 |
| frontend/features/intelligence-atlas/atlas-graph.tsx:908                  | AtlasGraphCanvas                  | 47.4 |           1 |
| frontend/hooks/useReadingHistory.ts:34                                    | <anonymous>                       | 47.4 |           7 |
| frontend/app/search/research/components/message-item.tsx:504              | MessageBody                       | 47.5 |           5 |
| frontend/app/search/research/components/research-side-panels.tsx:204      | SourceGroupEntry                  | 47.5 |           5 |
| frontend/components/article-detail-modal.tsx:651                          | ModalProgressPointer              | 47.5 |           9 |
| frontend/hooks/use-scroll-personalization.ts:188                          | loadPersonalization               | 47.5 |           5 |
| frontend/lib/notification-state.ts:69                                     | useDismissedNotifications         | 47.5 |           2 |
| frontend/app/search/research/hooks/use-research-controller.ts:1143        | useResearchPageController         | 47.6 |           2 |
| frontend/components/blindspot-view.tsx:231                                | LeadStoryMedia                    | 47.6 |           6 |
| frontend/components/feed-view.tsx:325                                     | useFeedImageLoader                | 47.6 |          10 |
| frontend/components/grid-view.tsx:888                                     | GridViewResults                   | 47.6 |           6 |
| frontend/hooks/use-inline-definition.ts:90                                | useInlineDefinition               | 47.6 |           6 |
| frontend/components/highlight-note-popover.tsx:115                        | HighlightNoteBody                 | 47.7 |           2 |
| frontend/hooks/use-favorites.ts:39                                        | useFavorites                      | 47.7 |           1 |
| frontend/app/page.tsx:1460                                                | useNewsPageActions                | 47.8 |           5 |
| frontend/app/search/research/hooks/use-research-controller.ts:875         | useResearchMessageMutationActions | 47.9 |           9 |
| frontend/components/article-detail-modal.tsx:1748                         | useModalHighlightHistory          | 47.9 |           3 |
| frontend/lib/chat-branching.ts:112                                        | getMessageVersionInfo             |   48 |           5 |
| frontend/lib/performance-logger.ts:536                                    | getSummary                        |   48 |           5 |
| frontend/components/cluster-detail-modal.tsx:1397                         | ComparisonResults                 | 48.1 |           4 |
| frontend/features/intelligence-atlas/atlas-graph.tsx:969                  | AtlasGraphFrame                   | 48.1 |           1 |
| frontend/app/saved/use-saved-workspace-controller.ts:101                  | <anonymous>                       | 48.2 |           4 |
| frontend/app/sources/[source]/debug/source-debug-view.tsx:224             | SubFeedsSection                   | 48.2 |           6 |
| frontend/components/article-detail-modal-layout.tsx:125                   | ArticleDetailDialogOverlays       | 48.2 |           3 |
| frontend/components/stream-card.tsx:73                                    | <anonymous>                       | 48.2 |          12 |
| frontend/features/intelligence-atlas/lib/atlas-query-state.ts:199         | parseAtlasQueryState              | 48.2 |           1 |
| frontend/lib/api/streaming.ts:74                                          | connectAndPumpStream              | 48.2 |           5 |
| frontend/lib/source-groups.ts:37                                          | buildSourceGroups                 | 48.2 |           6 |
| frontend/app/search/research/components/message-item.tsx:301              | MessageActionBar                  | 48.3 |           4 |
| frontend/components/interactive-globe.tsx:746                             | loadManagedTexture                | 48.4 |           7 |
| frontend/components/verification-panel.tsx:197                            | VerificationResults               | 48.5 |           4 |
| frontend/lib/api/streaming.ts:305                                         | handleCacheDataEvent              | 48.5 |           7 |
| frontend/app/search/research/stream/protocol.ts:141                       | processResearchComplete           | 48.6 |           5 |
| frontend/components/interactive-globe.tsx:669                             | getFeatureCenter                  | 48.6 |           6 |
| frontend/components/verification-panel.tsx:305                            | SourceCard                        | 48.6 |           5 |
| frontend/app/source/[sourceId]/page.tsx:433                               | SourceArticleCard                 | 48.7 |           2 |
| frontend/app/wiki/reporters/page.tsx:197                                  | ReporterDirectoryPage             | 48.7 |           2 |
| frontend/components/cluster-detail-modal.tsx:1464                         | ComparisonView                    | 48.7 |           4 |
| frontend/app/debug/debug-dashboard.tsx:2153                               | PipelineSignalsCard               | 48.8 |           7 |
| frontend/app/saved/saved-workspace-view.tsx:180                           | ResearchShelvesCard               | 48.8 |           4 |
| frontend/app/wiki/ownership/source-intelligence-operations.tsx:277        | OperationsContent                 | 48.8 |           8 |
| frontend/components/source-credibility-panel.tsx:23                       | useCredibilityController          | 48.8 |           5 |
| frontend/lib/api/article.ts:357                                           | resolveBackendArticleMapping      | 48.8 |           2 |
| frontend/lib/performance-logger.ts:426                                    | endStream                         | 48.8 |           4 |
| frontend/components/article-detail-modal-reader.tsx:56                    | ModalArticleReaderBody            | 48.9 |           1 |
| frontend/components/highlight-toolbar.tsx:103                             | resolveSelectionOffsets           |   49 |           5 |
| frontend/features/intelligence-atlas/atlas-graph.tsx:831                  | useAtlasGraphPan                  | 49.1 |           6 |
| frontend/lib/highlight-store.ts:53                                        | dedupeLocalHighlights             | 49.1 |           7 |
| frontend/components/highlight-note-popover.tsx:163                        | HighlightNotePopover              | 49.2 |           3 |
| frontend/components/reporter-profile.tsx:129                              | ProfileHeader                     | 49.2 |           7 |
| frontend/features/intelligence-atlas/atlas-graph.tsx:593                  | useAtlasGraphSelectionValues      | 49.2 |           4 |
| frontend/app/search/research/hooks/use-research-controller.ts:674         | useResearchChatPersistence        | 49.3 |           1 |
| frontend/components/credibility-badge.tsx:141                             | DimensionRow                      | 49.3 |           3 |
| frontend/features/intelligence-atlas/atlas-graph.tsx:152                  | AtlasNodeMark                     | 49.3 |           4 |
| frontend/lib/api/endpoints.ts:316                                         | refreshCache                      | 49.3 |           8 |
| frontend/lib/globe-live-data.ts:108                                       | buildCountryListFromArticles      | 49.3 |           7 |
| frontend/app/search/research/stream/research-stream.ts:21                 | addSemanticSearchMessage          | 49.4 |           5 |
| frontend/lib/api/endpoints.ts:189                                         | fetchNewsPaginated                | 49.5 |           8 |
| frontend/lib/api/endpoints.ts:495                                         | semanticSearch                    | 49.5 |           4 |
| frontend/lib/api/og-image.ts:27                                           | fetchOGImage                      | 49.5 |           5 |
| frontend/features/intelligence-atlas/atlas-graph.tsx:691                  | getFittedAtlasTransform           | 49.6 |           2 |
| frontend/features/intelligence-atlas/atlas-topbar.tsx:124                 | <anonymous>                       | 49.7 |           5 |
| frontend/features/intelligence-atlas/hooks/use-atlas-layout.ts:109        | startLayoutAnimation              | 49.7 |           4 |
| frontend/lib/highlight-utils.tsx:130                                      | <anonymous>                       | 49.7 |           4 |
| frontend/app/search/research/hooks/use-research-transport.ts:48           | prepareResearchStart              | 49.8 |           4 |
| frontend/app/wiki/reporters/page.tsx:247                                  | ReporterDirectoryView             | 49.8 |           1 |
| frontend/features/intelligence-atlas/intelligence-atlas-workspace.tsx:479 | WorkspaceSurface                  | 49.8 |           3 |
| frontend/app/page.tsx:1206                                                | useNewsPageQueryData              | 49.9 |           3 |
| frontend/app/sources/[source]/debug/source-debug-view.tsx:410             | SourceDebugHeader                 | 49.9 |           1 |
| frontend/components/article-detail-modal-layout.tsx:160                   | ArticleDetailDialogScrollContent  | 49.9 |           2 |
| frontend/components/article-detail-modal-sidebar.tsx:100                  | ArticleDetailSidebarResearch      | 49.9 |           1 |
| frontend/components/highlight-toolbar.tsx:286                             | handleSelection                   | 49.9 |           8 |

## 2026-09-11 — Select and table wrapper checkpoint

- Removed eight direct Oxlint findings from `frontend/components/ui/select.tsx` and
  eight from `frontend/components/ui/table.tsx` by forwarding the current callers'
  explicit props. The existing dirty refactors in those files remain in the worktree
  and were not folded into a misleading focused commit.
- Fixed the case-insensitive source generator in
  `frontend/__tests__/cluster-comparison.test.ts`; commit `f31f258` records that
  isolated regression fix. The full frontend suite passes 56 suites and 199 tests,
  and frontend TypeScript passes.
- The fresh whole-project Oxlint census is 1,475 findings: 10 errors and 1,465
  warnings. Frontend is 82 warnings and 0 errors; scripts are 1,393 findings,
  including all 10 errors, and remain outside the active lint scope by explicit
  user instruction.
- Against the 7,949-finding baseline, 6,474 are cleared (81.44%) and 1,475 remain
  (18.56%). Dependency cycles, duplication, source-line, maintainability, dead-code,
  repository self-test, CRAP, and browser gates remain open as recorded above.

## 2026-09-11 — Globe boundaries and blindspot fixture checkpoint

The globe cleanup narrowed scene, lifecycle, material, and uniform interfaces to
small capability views while preserving Three.js uniform object identity. The
blindspot view test now builds typed fixtures outside the test cases, keeping the
same two user interactions and assertions. Commits `21aa2e4`, `8f56321`,
`fc6038e`, `51b5e43`, and `e8713a5` record the isolated changes; stream
continuation cleanup is recorded in `c21c8e7`.

Fresh whole-project Oxlint reports 1,446 findings: 10 errors and 1,436 warnings.
Frontend is 53 warnings and 0 errors; scripts are 1,393 findings, including all
10 errors, and remain outside the active cleanup scope by explicit user
instruction. Against the 7,949-finding baseline, 6,503 are cleared (81.81%) and
1,446 remain (18.19%). Full frontend Jest passes 56 suites and 199 tests, and
frontend TypeScript passes. Strict maintainability, source-line, dead-code, CRAP,
repository self-test, and browser gates remain open.

## 2026-09-11 — Modal, navigation, and wrapper checkpoint

- Removed prop spreads from the article modal content/body boundaries, tooltip, and scroll
  area wrappers. Table-driven the global navigation, browse index, and live browse index
  tests without changing their assertions. Narrowed the globe scene context and provider
  children contracts. Commits `3f8e486`, `bea7be3`, `18e6285`, `ec11894`, `7079129`,
  `317ecb2`, `1aa6608`, and `410b70c` record the isolated changes.
- The fresh whole-project Oxlint census is 1,435 findings: 10 errors and 1,425 warnings.
  Frontend is 42 warnings and 0 errors. Scripts are 1,393 findings, including all 10
  errors, and remain outside the active lint cleanup scope by explicit user instruction.
- Against the 7,949-finding baseline, 6,514 are cleared (81.95%) and 1,435 remain
  (18.05%). Full frontend Jest passes 56 suites and 199 tests; frontend TypeScript and
  the focused changed-scope checks pass.
- Remaining gates are strict maintainability, source-line cap, dead-code, CRAP,
  repository self-test, and browser verification. Existing dirty user WIP remains in the
  worktree and is being staged only through focused patches.

## 2026-09-11 — Modal boundary extraction checkpoint

- Split the article modal hero source links and visual renderer into a focused module, and moved
  the article modal overlay group out of the layout module. The modal regression suite passes 6
  tests after both extractions. Pagination cases were also split into named runners and saved in
  commit `8380fc6`; the current modal extraction remains in the worktree with existing dirty
  refactors for focused staging.
- The fresh whole-project Oxlint census is 1,424 findings: 10 errors and 1,414 warnings.
  Frontend is 31 warnings and 0 errors. Scripts are 1,393 findings, including all 10 errors,
  and remain outside the active lint cleanup scope by explicit user instruction.
- Against the 7,949-finding baseline, 6,525 are cleared (82.09%) and 1,424 remain (17.91%).
  Frontend has 91.48% of the post-pull 364-warning queue cleared, with 8.52% remaining.
- Focused Oxlint and frontend TypeScript pass for the modal files; the article modal tests pass
  1 suite and 6 tests. The prior full frontend result remains 56 suites and 199 tests.
- Strict maintainability, source-line cap, dead-code, CRAP completion, repository self-test, and
  browser verification remain open. Scripts lint cleanup remains intentionally skipped.

## 2026-09-11 — Frontend warning queue cleared

The remaining 18 frontend warnings were removed by splitting the oversized API endpoint/type
barrels and the organization wiki view into focused modules. Commit `8b6f8b2` records the
checkpoint. The direct frontend Oxlint census now reports 0 errors and 0 warnings.

The combined `frontend scripts` census reports 1,393 findings: 10 errors and 1,383 warnings.
All remaining findings are in `scripts/`, which stays outside the active lint scope under the
user's explicit instruction. Against the 7,949-finding baseline, 6,556 are cleared (82.48%) and
1,393 remain (17.52%). The active frontend lint queue is 100% cleared.

Verification: frontend TypeScript passes; the eight affected API and UI regression suites pass
with 27 tests; and the staged checkpoint passes `git diff --cached --check`. Strict maintainability,
source-line, dead-code, CRAP, repository self-test, and browser gates remain open.

## 2026-09-11 — Frontend reachability cleanup checkpoint

Removed two unused frontend utility files, the unused `@tanstack/react-virtual` dependency, and
verified unused exports and type aliases in clean tracked modules. Commit `7465956` records the
42-file cleanup. The modal data WIP and untracked debug, response-schema, settings, and stream
modules were preserved and left unstaged.

Fresh direct frontend Oxlint reports 0 errors and 0 warnings. The combined `frontend scripts`
census remains 1,393 findings: 10 errors and 1,383 warnings, all under `scripts/`, which stays
outside the active lint scope by explicit user instruction. Against the 7,949-finding baseline,
6,556 are cleared (82.48%) and 1,393 remain (17.52%). Errors are 10 of 2,560 (0.39%) and
warnings are 1,383 of 5,389 (25.66%).

Package-local Knip reports 0 unused files and 0 unused dependencies. It still reports one
intentional cross-package `@barney-media/crap-typescript` devDependency finding, 31 exported
values, and 12 exported types in preserved WIP or duplicate public surfaces. Frontend TypeScript
passes, and the full frontend Jest suite passes 56 suites and 199 tests. Strict maintainability,
source-line, CRAP, repository self-test, and browser gates remain open.

## 2026-09-11 — One-file maintainability batches

Commits `f4bbfa2` and `e1a4f8e` split globe surface rendering and inline-definition listener
setup into focused boundaries. Each changed file has 0 direct Oxlint errors and warnings;
frontend TypeScript passes; the full frontend Jest suite passes 56 suites and 199 tests. The
scoped quality measurements report no CRAP violations. The globe parent/surface functions now
measure MI 52.8/54.7, and the inline-definition hook/listener functions measure MI 50.3/56.5;
the globe runtime hook remains at MI 46.8 for a later batch.

The whole direct census is unchanged at 1,393 findings: 10 errors and 1,383 warnings, all in
`scripts/`, which remain outside active lint cleanup by explicit user instruction. Against the
7,949-finding baseline, 6,556 are cleared (82.48%) and 1,393 remain (17.52%).
