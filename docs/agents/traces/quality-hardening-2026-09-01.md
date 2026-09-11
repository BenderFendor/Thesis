# Quality hardening trace — 2026-09-01

## Goal and done criteria

Continue the quality-hardening handoff in
`docs/agents/quality-hardening/HANDOFF-2026-08-31.md`: make the real frontend
test suite and build reliable, enforce the no-module-mocking policy through
repo-wide Oxlint, and continue reducing CRAP, maintainability-index, CCCC, and
lint debt without weakening the rules.

## Status

The real-module tests are green, including the full frontend suite. The
repo-wide no-module-mocking rule is active and has no application or test
violations. TypeScript and CCCC are green. The strict quality campaign is not
complete: Oxlint, CRAP, maintainability, dead-code, and broader duplication
debt still fail their configured thresholds.

## Files changed

- Root quality configuration and scripts: `.oxlintrc.json`, `verify.sh`,
  `package.json`, `.jscpd.json`, `scripts/check-crap.mjs`,
  `scripts/check-complexity`, `scripts/check-maintainability.mjs`, and the
  mechanical codemod safeguards.
- Frontend test infrastructure: Jest/Vitest configuration, Oxlint rule tests,
  real ESM transpilation, test seams, and removal of legacy mock modules.
- Frontend production code: type/null-contract repairs, navigation/performance
  guards, path/font/style corrections, and the funding-statistic fallback.
- Backend cycle repair: `backend/app/models/evidence_tables.py`,
  `backend/app/database.py`, and `backend/app/models/evidence.py`.
- Durable records: `docs/Log.md`, `docs/agent/testing.md`,
  `docs/agent/known-errors.md`, `docs/agent/learnings.md`, and this trace.

## Commands and tests run

- `npm --prefix frontend test -- --runInBand` — 40 suites, 156 tests passed.
- `npm --prefix frontend run test:oxlint-rules` — 13 files, 204 tests passed.
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit` —
  failed with 35 errors in the debug, saved, search, globe, reading-queue,
  and news-stream modules.
- `node scripts/check-imports.mjs` — 197 files, all aliases resolved.
- `npm --prefix frontend run build` — passed.
- `npm run cli:test` — 12/12 passed.
- `bash ./scripts/check-cycles` — frontend and backend cycles: zero.
- Strict Oxlint reported 13,565 errors and 378 warnings across 143 files. CCCC
  reported 35 hard violations across 9,701 functions. Maintainability reported
  220 fails and 420 warnings across 3,518 functions. The descriptive MI mean
  is 50.36, median 52.50, and minimum 0.00. CRAP reported 37 failures at
  threshold 30, with a maximum score of 217.217. Dead-code and duplication
  checks were not treated as green.
- `scripts/self-test` was rerun after the focused repair and stopped at
  TypeScript with exit 2 because 35 errors remain; later stages were not
  claimed by that run.

## Assumptions and risks

- The working tree contains a large pre-existing quality campaign. Changes
  were kept in place and not reset or selectively discarded.
- Two additional Luna workers were used with disjoint ownership of
  `performance-logger.ts` and `atlas-query-state.ts`. The larger performance
  rewrite was discarded after it failed owned-file lint checks; the Atlas
  refactor was repaired and retained after targeted tests and lint passed.
- The Oxlint rule-test fixtures intentionally contain forbidden examples and
  are excluded from the application scan. This is the only deliberate
  exclusion; the root lint command scans `frontend` and `scripts`.
- Browser visual verification was not available in this pass, so runtime
  layout behavior remains unverified beyond build and DOM test coverage.

## Stop-hook follow-up — 2026-09-01

The stop-hook findings were reproduced. Ruff found an unsorted database import
block; the root TypeScript compiler could not see Node declarations for the
real CLI; the global Oxlint 1.71 binary rejected React rules that are present
in the repository-pinned Oxlint 1.80; and AST-grep rejected the layout's raw
HTML injection.

Repairs:

- Ruff-sorted and formatted `backend/app/database.py`, narrowed two defensive
  catches, and used `logger.exception` for the terminal startup failure.
- Added `types: ["node"]` to `scripts/tsconfig.json`.
- Made the stop hook prefer the repository-local Oxlint and expose its bin
  directory so `tsgolint` resolves with it.
- Switched the appearance bootstrap to `next/script` inline children and added
  only the documented root-layout exceptions for Next's required CSS/font and
  document nesting structure.
- Sorted the evidence model `__all__` list for Ruff `RUF022`.
- Kept Atlas schema types in a top-level type-only import and runtime
  validators in a value import, resolving the duplicate-import and
  import-order findings without importing types at runtime.

Follow-up verification:

- `lint_changed_files` on the repaired database and layout returned no lint or
  AST-grep failures.
- Hook suite: 24 passed.
- Scripts typecheck, CLI tests, layout Oxlint, AST-grep, Ruff, formatting, and
  Next build passed.
- Evidence model Ruff `RUF022` and formatting checks passed.
- Atlas schema/query/inspector tests: 3 suites, 20 tests passed.
- Atlas API strict Oxlint and the exact changed-file stop-hook probe passed
  with zero lint or AST-grep findings.
- The full self-test still stops at repo-wide strict Oxlint on existing
  `scripts/codemod-lint-mechanical.mjs` unsafe-`any` diagnostics.

## Verifier and ownership test stop-hook repair — 2026-09-01

- Ruff-sorted and formatted `backend/scripts/reporter_source_verifier.py` and
  narrowed its source-profile failure boundary to HTTP, timeout, OS, and
  value errors.
- Sorted and structurally repaired
  `frontend/features/intelligence-atlas/tests/ownership-chain.test.tsx`:
  assertions are split by behavior and still render the real component with
  typed data; no module mocks were introduced.
- Sorted the Phase 2 Atlas projection test imports and split its ownership
  assertions into focused helpers.
- Repaired the reporter career-timeline test's structural lint findings with
  readonly typed fixtures and focused real-component input data.
- Repaired `atlas-force-layout.ts` with a private vector value object for
  simulation mutation, readonly map boundaries, sorted declarations, and one
  final export block.
- Restructured `atlas-schema.test.ts` around named real payload fixtures,
  focused parser cases, and explicit expected values; it uses no module mocks.
- Repaired `ownership-chain.tsx` with a real Atlas hop view that is deeply
  readonly, explicit component return JSDoc, sorted imports, and one link per
  non-current hop; its test still renders the real component with real typed
  inputs and no module mocks.
- Repaired `sidebar-navigation-item.tsx` with readonly icon contracts,
  explicit link/button renderers, and named conditional-class helpers; the
  real global-navigation test remains green.
- Exact changed-file stop-hook probe: zero lint and AST-grep findings for all
  eight repaired files.
- Reporter verifier tests: 17 passed. Ownership-chain test: 4 passed.
- Career-timeline test: 3 passed. Phase 2 projection test import and format
  checks passed.
- Atlas force-layout strict Oxlint and TypeScript checks passed.
- Full frontend Jest: 39 suites / 155 tests passed.
- Global navigation test after the sidebar repair: 7 passed.
- Atlas schema test: 10 passed.
- The full self-test still stops at the existing repo-wide strict Oxlint
  findings in `scripts/codemod-lint-mechanical.mjs`.
- The broader repository strict Oxlint/CCCC/MI/CRAP campaign remains active;
  this follow-up did not claim those gates were green.

## Remaining failures or blockers

- Strict Oxlint has 13,698 errors and 341 warnings across 147 files.
- Maintainability reports 233 functions below MI 50 and 494 warnings below MI
  60; the minimum is 12.8.
- Coverage-first CRAP reports 68 methods over 30, a maximum of 110, and 1,246
  unmeasured methods.
- Backend Ruff has 30 findings, backend tests have 10 failures, and CLI schema
  parity has generated-description drift.
- Dead-code analysis reports 105 unused exports, 3 duplicate exports, 1 unused
  development dependency, and 11 hints. Duplication reports 95 clone groups
  and 1.11% duplicated code.
- CCCC is currently green at 0 hard violations across 10,036 functions in 587
  files and must remain there.
- These are executable cleanup tasks, not accepted exemptions. The worktree
  must not be called fully green until the configured strict gates pass.

## Rollback or next executable step

Repair the backend scorer regression and CLI schema drift first. Then use
disjoint ownership slices for component/app code, library/hooks, scripts, and
real behavior coverage. Each slice must fix all applicable lint families in
its files, preserve CCCC at zero, and record metric deltas. Finish with
dead-code, duplication, `scripts/self-test`, `./verify.sh`, and direct metric
commands. Do not run the old text-based regexp codemod; use the
AST-constrained version and verify build-sensitive paths after every
mechanical rewrite.

## 2026-09-01 — Unified closure census and work plan

The active goal is now explicitly repo-wide: preserve CCCC at zero, keep the
repo-wide no-module-mocking rule at error severity, and close strict Oxlint,
CRAP, maintainability, dead-code, duplication, type, backend-test, and schema
gates without weakening rules or replacing real behavior with mocks.

Current evidence from one tree snapshot:

- Strict Oxlint: 13,118 errors and 341 warnings across 147 files. The largest
  repeatable families are readonly parameter types (2,551), magic numbers
  (1,508), JSX depth (1,123), variable ordering (1,120), ternaries (765),
  function style (692), strict booleans (570), and one-var (538).
- Maintainability: 3,884 functions; 230 below MI 50; 499 below MI 60; minimum
  12.8.
- CRAP: 2,630 methods; 1,222 covered by statement/branch data; 1,408 N/A;
  51 above 30; maximum 110.
- CCCC: 0 hard violations across 10,221 functions.
- Knip: 105 unused exports, 3 duplicate exports, 1 unused dev dependency,
  and 11 hints. jscpd: 95 clone groups, 1.10% duplicated lines, and 1.14%
  duplicated tokens.

Green guardrails are frontend Jest (40 suites/156 tests), Oxlint rule tests
(13 files/204 tests), frontend TypeScript, CLI typecheck and tests, imports,
cycles, build, backend Ruff/format, backend tests (735 passed/3 deselected),
and OpenAPI schema parity. The corrected application/test scan has zero
forbidden module-mocking calls outside the rule fixtures.

The final `scripts/self-test` run exits at the repo-wide strict Oxlint stage;
the first reported tooling findings are in `check-maintainability.mjs`,
`check-crap.mjs`, `check-imports.mjs`, `quality-source-files.mjs`, and
`codemod-lint-mechanical.mjs`, followed by the frontend findings counted
above. This is a measured failure, not a claim that the remaining gates are
complete.

The work is split into disjoint packets: (1) largest components and app
routes, (2) libraries and hooks, (3) Atlas/wiki modules, (4) scripts and
quality tooling, (5) real behavior coverage plus MI/CRAP refactors, and (6)
final dead-code, duplication, full-gate, and runtime integration. Mechanical
import/declaration changes may be batched, but JSX depth, strict typing,
effects, unsafe values, and coverage require semantic review. Every packet
must leave TypeScript, affected behavior tests, and CCCC green and record
metric deltas before integration.

The remaining work is not blocked by backend behavior or schema drift. It is
unfinished executable debt concentrated in the frontend and scripts; the
repo must not be called complete until strict Oxlint and the remaining metric
gates pass.

## 2026-09-01 final measurement pass

- Full frontend Jest: 40 suites and 156 tests passed.
- Focused `article-detail-modal` real-component test: 6 tests passed. A
  temporary render split was discarded after source-map coverage association
  changed the CRAP result; the retained repair fixes the missing
  `bookmarkLoading` binding and restores the ArrowDown scroll minimum to 72.
- Oxlint rule tests: 13 files and 204 tests passed. The repo-wide
  `anti-slop/no-module-mocking` rule remains an error, and the application/test
  scan found zero forbidden module-mocking calls outside its own fixtures.
- Current strict measurements: Oxlint 13,565 errors and 378 warnings across
  143 files; CCCC 35 hard violations across 9,701 functions; MI 220 failures
  and 420 warnings across 3,518 functions; descriptive MI mean 50.36, median
  52.50, minimum 0.00; CRAP 36 failures with maximum 217.217 at threshold 30.
- `scripts/self-test` was run and stops at TypeScript with 35 errors, so no
  later full-gate success is claimed. The requested Luna fleet also could not
  be expanded because the platform concurrency cap is two and the available
  Luna threads are at their usage limit.

## 2026-09-01 post-fleet measurement

Goal: reduce CCCC hard violations to zero, enforce repo-wide no-module-mocking,
and reduce strict Oxlint, CRAP, and maintainability debt without weakening the
quality rules or replacing real behavior with mocks.

Status: incomplete. CCCC is green, but strict Oxlint, CRAP, and the MI floor
remain red.

- Two disjoint workers repaired the remaining CCCC ownership slices and the
  current check reports 0 hard violations across 10,028 functions.
- Strict Oxlint reports 13,765 errors and 340 warnings across 148 files. The
  safe `--fix` pass removed 52 findings; the remaining issues require semantic
  refactors, type narrowing, and test restructuring.
- The aggregate frontend MI measurement is 3,824 functions: mean 76.55,
  median 80.50, minimum 12.80, maximum 99.90. The configured floor reports
  233 functions below MI 50 and 493 warnings below MI 60.
- CRAP reports 29 failed methods at threshold 30; the maximum is 72 for
  `lib/api.ts:5600 semanticSearch` and
  `lib/highlight-utils.tsx:8 getDirectTextNodeOffset`.
- `npm exec -- tsc -p tsconfig.json --noEmit`, `npm run build`, and the full
  frontend Jest suite pass: 40 suites and 156 tests. Tests render real
  application components; the repo scan found zero forbidden module-mocking
  calls. Existing injected service fakes and fixture values remain separate
  from module mocking and need a separate test-confidence review if the policy
  is intended to ban all test doubles.
- `scripts/self-test` was rerun against this tree and exits 1 at strict
  Oxlint, with the remaining unsafe/type-aware findings concentrated in
  `scripts/codemod-lint-mechanical.mjs` and many frontend files.
- The latest targeted repairs pass Ruff for the replay and ad-supply modules,
  and the API mapping property test passes TypeScript, targeted Oxlint, and
  all four Jest properties.
- The source-picker refactor passes targeted Oxlint and TypeScript, and the
  atlas entity service passes Ruff after import and unused-variable repair.
- `git diff --check` passes. No lint threshold, rule, exclusion, or suppression
  was weakened.

Remaining work: continue the Oxlint judgment-based cleanup in disjoint file
slices, add behavior-level coverage for the CRAP failures, and raise the
lowest-MI functions while rerunning TypeScript, Jest, build, CCCC, CRAP, MI,
and strict Oxlint after each slice.

## 2026-09-01 fresh census and closure plan

The current census supersedes the earlier post-fleet numbers for planning:

- CCCC: 0 hard violations across 10,036 functions and 587 files.
- Strict Oxlint: 13,698 errors and 341 warnings across 147 files.
- Maintainability: 3,824 functions, 233 below MI 50, 494 warnings below MI
  60, and minimum 12.8.
- Coverage-first CRAP: 2,562 methods, 1,316 measured, 1,246 unmeasured, 68
  over threshold 30, and maximum 110.
- Ruff: 30 findings. Backend tests: 723 passed, 10 failed, and 3 deselected.
- CLI schema parity fails because generated OpenAPI descriptions drift from
  the news route declarations. Frontend TypeScript, frontend Jest, CLI
  typecheck/tests, imports, cycles, and the no-module-mocking scan pass.

Execution order:

1. Restore `_llm_score_axes` to `SourceAnalysisScorer`, make the propaganda
   scorer tests pass, and reconcile the generated OpenAPI descriptions.
2. Process Oxlint and Ruff in disjoint file-owned slices, grouping safe
   declaration/import fixes while treating JSX depth, strict types, React
   effects, and unsafe typing as semantic refactors.
3. Refactor CRAP and MI hotspots with behavior coverage that uses real
   production modules and representative typed inputs. Keep CCCC at zero.
4. Re-run dead-code and duplication after export/component boundaries settle,
   then run the complete verification stack and record deltas.

This is baseline evidence and an execution plan, not a green-status claim.
