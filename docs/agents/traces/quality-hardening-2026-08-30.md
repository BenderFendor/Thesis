# Quality Hardening — quality/crap-mi-oxlint-hardening (2026-08-30)

## Goal
Zero oxlint errors, zero tsc errors, zero cccc hard violations (CC>10 / cognitive>15), zero CRAP, maintainability gate green, zero duplicates, zero dead code, zero dependency cycles across the Thesis repo. Preserve behavior; fix, don't suppress.

## Status
IN PROGRESS — wave 3 (MI-first rewrite, 10 agents) running.

## Wave results (1 + 2, completed 2026-08-30 ~12:00)
All 17 wave-1/2 agents exited non-zero (not clean finishes), but landed partial work:
- 150 of 202 files improved; total oxlint 17,799 -> 16,140 before mechanical codemod.
- Lessons: config churn during waves (transient malformed .oxlintrc.json/package.json) burned
  agent time re-probing; large judgment rules (no-magic-numbers 2.1k, jsx-max-depth 2.2k)
  are NOT realistic per-site with stable config unless the refactor is MI-driven.
- Backend agents (BE0..BE5) reported mid-file states; DupBackend cut backend clones 114 -> 76.

## Pivot: MI-first rewrite (user-directed, more efficient)
Rationale: a CC-157 function generates hundreds of no-magic-numbers/strict-boolean/no-ternary/
jsx-max-depth errors. Rewriting for maintainability (MI>=50, CC<=10, cog<=15) fixes both gates
in one edit. Combined driver: /tmp/combined-driver.json (score = oxlint + 3*MI + 2*cccc).
Wave 3 = 10 agents (W30..W39) with dual-gate acceptance (oxlint+tsc+MI+cccc OR mypy+ruff+pytest+cccc).

## Mechanical codemod (scripts/codemod-lint-mechanical.mjs)
Safe transforms (idempotent, tsc-verified): readonly params, globalThis, unicode regexp,
no-null (safe positions), expect.hasAssertions. Reduced tsc 146 -> 26 and cleared thousands of
readonly/globalThis/null regex errors. Unsafe excluded: one-var merge (broke 18 files: merged
export consts, glued `const` after imports — REVERTED via git checkout from HEAD after post-wave
snapshot; the merge transform is disabled until rewritten); exports-last (type-export breakage).
Note: revert preserved wave-1 partial improvements only pre-damage; see git diff for 18 files.

## Files changed (main process, prior + current)
- frontend/jest.setup.js — import "@testing-library/jest-dom/jest-globals" (matcher types under @jest/globals)
- frontend/tsconfig.json — types: "@testing-library/jest-dom/jest-globals" (was plain jest-dom entry)
- .oxlintrc.json — rule decisions:
  - import/no-named-export OFF (Next.js app-router requires named exports; types can't be default-exported)
  - import/prefer-default-export OFF (same conflict)
  - react/function-component-definition = arrow-function (was function-declaration; conflicts with func-style which demands expressions)
  - react/preserve-manual-memoization OFF (conflicts with eslint/one-var merged-statement style: retain manual memoization; repo has no React Compiler)
- frontend/package.json — declare @jest/globals 30.2.0 (used by 39 tests, was unlisted); fix crap script (CLI has no --config; use --threshold 30 --agent)
- package.json — quality:all script (cycles + duplicates + maintainability + complexity + deadcode + crap)
- scripts/check-complexity — new cccc gate (pinned 1.6.0 download, sha256 verify, CC>10/cog>15 hard)
- scripts/check-maintainability.mjs — new MI gate (code-multivitals, per-function MI; THESIS_MI_CAP=50 default)
- .jscpd.json — minimal config (no ignore field — Rust jscpd needs -p pattern + CLI dirs)
- frontend/knip.json — entry/project/ignore config (frontend-relative paths)
- frontend/components/article-detail-modal.tsx — ArticleDetailServices typed DI seam (services prop)
- frontend/__tests__/article-detail-modal.test.tsx — removed all module mocks (jest.mock banned by anti-slop), uses services seam + real hooks
- frontend/__tests__/api.agentic-search.test.ts — typed fetcher seam
- frontend/lib/performance-logger.ts — isNavigationTiming guard, optional getEntriesByType, timing fallback

## Rule findings (verified by probes against final config)
1. anti-slop/no-module-mocking is ACTIVE — jest.mock cannot be lint-clean in ANY form (probe p1/p2 both fire it; typed factory also fires no-untyped-mock-factory; global jest fires prefer-importing-jest-globals). DI conversion is mandatory for all mocked deps.
2. next/jest SWC hoisting: jest.mock hoists only with GLOBAL jest. Moot once DI-only (no jest.mock remains).
3. @jest/globals full import is REQUIRED by prefer-importing-jest-globals (describe/expect/it/jest) once no jest.mock remains (hoisting unaffected).
4. one-var vs preserve-manual-memoization conflict: two error rules mutually unsatisfiable for merged memo deps; decided: keep memoization (perf), disable preserve rule.
5. react-markdown etc. are ESM-only in jest; DI/real-router-context is the clean route (next/navigation AppRouterContext/SearchParamsContext wrappers).

## Gate baselines (before waves)
- oxlint: 18,069 errors + 1,104 warnings; after `--fix`: 17,799 (270 auto-fixed; rule histogram: 7,941 mechanical, 10,873 judgment)
- tsc: 48 errors across 15 files (mostly module-mock factory types + atlas unknown query data)
- cccc: 379 hard violations (CC>10 || cog>15) of 7,907 functions (257 backend-only + 122 frontend/scripts)
- jscpd: 114 clones, 1.49% (backend tests + frontend components)
- knip: 72 unused exports + 9 probe files (probes are agent artifacts)
- complexity fix pass 1 (cccc): CC max 56 -> 38 pre-wave (complexity-refactor-2026-08-27 trace)

## Wave 1 — frontend (11 agents, disjoint ownership)
B1Api (lib/api.ts 2172), B2Libcore (modal+highlight libs), B3Debug (debug pages), B4Search (search+settings+verification), B5Globe (globe components), B6Components (feed/grid/cluster/queue), B7Pages (app pages + view components), B8Atlas (atlas feature), B9ScriptsWiki (scoop CLI + wiki views), B10HooksMisc (hooks+libs), B11Components2 (ui/* + remaining components + tests)
Acceptance per agent: 0 oxlint errors on files, 0 tsc errors on files, jest green on their tests.
B4Search delivered first: search-inline-edit.test.tsx 0 oxlint/0 tsc/1 pass; turned out stale (probed against broken config, 22 errors remain) — rework assigned.

## Wave 2 — backend (6 agents)
BE0..BE5 cccc hard functions (257 functions across 108 files), mypy --strict/ruff/pytest per file set.

## Wave 3 — duplicates (1 agent)
DupBackend: 114 backend clones -> 0 (jscpd -p pattern).

## Verification done (main)
- maintainability gate runs: 0 fails at MI<50 in frontend (top offenders CC 157 functions found in search/page, article-detail-modal, grid-view — inside wave 1 files)
- duplicates gate runs: 114 clones baseline
- complexity gate runs: 379 hard baseline
- knip gate runs: 72 unused exports baseline, config fixed

## Assumptions
- oxlint config stays "fix not suppress"; rules disabled ONLY where maximally conflicting (4 documented above).
- No new dependencies added (all tools already in manifests; @jest/globals already installed transitively, version pinned).
- Backend Python must keep mypy strict + ruff clean; behavior unchanged.
- Rust clippy -D warnings maintained for rss_parser_rust.

## Known remaining after waves
- openapi schema drift (pre-existing, needs live backend regenerate) — out of scope here.

## Rollback
- git branch quality/crap-mi-oxlint-hardening; WIP commits per phase; trace/docs/Log.md updated at end.
