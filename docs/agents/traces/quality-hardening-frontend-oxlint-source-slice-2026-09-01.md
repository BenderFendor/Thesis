# Quality hardening frontend Oxlint source slices

## Goal and done criteria

Reduce actual Oxlint debt in understandable frontend source files without
changing the hook, weakening rules, or adding tests that only exercise lint
structure. Preserve component behavior, keep CCCC and MI within the file goals,
and verify the real component paths.

## Status

The original digest/read-time slice and the follow-up source slices are
complete. Repository-wide verification remains open on findings outside the
cleaned files. The `article-content.tsx` forwarded-ref boundary and the modal's
first hook-dependency slice are now clean. The modal scroll ref boundary is
clean, and its wiki sheet has been extracted; the parent modal still has
broader debt.

## 2026-09-02 continuation: modal source boundaries

The modal follow-up moved shared contracts into
`frontend/lib/article-detail-modal-types.ts`, extraction/default-service and
highlight loading into `frontend/lib/article-detail-modal-data.ts`, app-state
hooks into `frontend/hooks/use-modal-integrations.ts`, and UI regions into
`article-detail-modal-reader.tsx`, `article-detail-modal-actions.tsx`,
`article-detail-modal-analysis.tsx`, and `article-detail-modal-layout.tsx`.
The loader now takes a stable URL and the reader's ordered sync path uses a
sequential promise reduction. The hook and external hook configuration were
left untouched.

The parent modal direct probe is now 209 errors and 7 warnings, with no
`max-dependencies`, ref-in-render, one-var, unused-import, or no-sync finding.
The reader's sync boundary no longer has max-params, max-statements,
await-in-loop, or no-sync findings. The focused behavior suites pass 4 suites
and 11 tests; frontend TypeScript and `git diff --check` pass. The parent and
separated presentation modules still have strict-style source debt, chiefly
readonly parameter types, declaration ordering, JSX structure, and nullable
boolean handling.

The required `scripts/self-test` was run once after the source changes. It
completed the repository verifier with status `failed`; the verifier's broad
campaign remains open. No second full run was started, and no hook or quality
rule was changed to mask that result.

## Files changed

- `frontend/components/digest-card.tsx`
- `frontend/components/read-time-badge.tsx`
- `frontend/components/safe-image.tsx`
- `frontend/components/semantic-tags.tsx`
- `frontend/components/theme-toggle.tsx`
- `frontend/components/queue-overview-card.tsx`
- `frontend/components/novelty-badge.tsx`
- `frontend/lib/highlight-offset.ts`
- `frontend/lib/highlight-processing.ts`
- `frontend/lib/highlight-markdown.ts`
- `frontend/lib/view-mode-storage.ts`
- `frontend/lib/article-content-ref.ts`
- `frontend/components/article-content.tsx`
- `frontend/components/article-detail-modal.tsx`
- `frontend/components/article-detail-modal-wiki.tsx`
- `frontend/components/article-detail-modal-reader.tsx`
- `frontend/components/article-detail-modal-actions.tsx`
- `frontend/components/article-detail-modal-analysis.tsx`
- `frontend/components/article-detail-modal-layout.tsx`
- `frontend/lib/article-detail-modal-types.ts`
- `frontend/lib/article-detail-modal-data.ts`
- `frontend/hooks/use-modal-integrations.ts`
- `frontend/components/highlight-note-popover.tsx`
- `frontend/lib/highlight-utils.tsx`
- `frontend/__tests__/article-detail-modal.test.tsx`
- `frontend/__tests__/highlight-utils.test.tsx`
- `frontend/__tests__/safe-image.test.tsx`
- `frontend/__tests__/view-mode-storage.test.ts`
- `docs/Log.md`
- `docs/agent/learnings.md`
- This trace

The Codex hook and external hook configuration were not changed in this slice.

## Evidence and decisions

- `digest-card.tsx` went from 35 errors and 1 warning in the initial file
  probe to 0 errors and 0 warnings. The component was split into semantic
  header, item list, schedule form, and summary pieces. The unused `onRefresh`
  prop was removed only after repository-wide reference search found no caller.
- `read-time-badge.tsx` went from 11 errors to 0. Nullable number checks now
  use an explicit positive-measurement predicate, preserving the prior
  no-data behavior for zero values while satisfying strict boolean rules.
- `safe-image.tsx` went from 10 errors to 0. Its prop-derived image source is
  now derived during render, the fallback transition is stateful only for a
  failed source, and the forbidden JSX prop spread is replaced with the
  supported image props used by every caller.
- `semantic-tags.tsx` went from 10 errors to 0. Query/loading/error handling is
  arrow-based, the tag view is readonly-safe, and stable query-key/empty-list
  values avoid creating new array props during render.
- `theme-toggle.tsx` went from 10 errors to 0. The toggle callback is stable,
  hydration fallback remains intact, and theme presentation is split from the
  stateful wrapper.
- `view-mode-storage.ts` went from 12 errors to 0. Browser storage is guarded
  through the `globalThis` contract, exports are consolidated, and nullable
  persisted input is handled explicitly.
- `queue-overview-card.tsx` went from 16 direct diagnostics to 0 after its
  loading, header, stats, summary, and read-time pieces were separated. The
  existing queue overview behavior remains covered by the reading-queue suite.
- `novelty-badge.tsx` went from 20 direct diagnostics to 0. Its named score
  thresholds and presentation helper preserve the existing query, loading
  state, no-history behavior, and badge text while removing nested ternaries.
- `highlight-utils.tsx` was reduced to the DOM renderer and now has 0 direct
  diagnostics. Offset traversal, highlight normalization, and Markdown export
  live in `highlight-offset.ts`, `highlight-processing.ts`, and
  `highlight-markdown.ts`; the existing `highlight-utils` imports remain valid
  through direct re-exports.
- `highlight-utils.test.tsx` is behavior coverage for highlight activation,
  DOM offsets, Markdown serialization, and Obsidian export. It is not a test
  of Oxlint configuration or source structure.
- `article-content.tsx` now uses a readonly callback argument tuple and a
  runtime ref-shape check to satisfy the readonly parameter rule without
  narrowing the public forwarded-ref contract. Its direct Oxlint result is
  now 0; the article-detail modal suite passes all 6 behavior tests.
- The modal scroll listener now memoizes its action helper, its progress effect
  has only values it reads, and its setter callbacks declare dependencies. The
  scroll content destructures ref-bearing fields before render, removing all
  21 `react(refs)` findings. The modal wiki sheet is now a separate module
  with zero direct Oxlint findings; the parent modal's direct probe is 803
  errors and 27 warnings, including the remaining max-dependencies finding.
- The modal source slice also removed unused scroll-tracker inputs, stale
  state returns, two unnecessary non-null assertions, and two max-statements
  findings plus one shadowed parameter. The parent remains a large follow-up
  slice rather than a reason to modify the hook.
- The highlight renderer now passes a narrow read-only anchor capability to
  its consumers. Article-detail state and popover inputs use that same shape,
  reducing 10 diagnostics in the modal and 2 in the renderer utility while
  preserving the actual DOM element behavior.
- The focused Oxlint count for the unchanged `frontend scripts` scope fell
  from 14,356 to 14,147 diagnostics. `queue-overview-card.tsx`,
  `novelty-badge.tsx`, and the four highlight modules are at 0;
  `article-content.tsx` is now at 0.
- Direct file metrics after the final edits:
  - `digest-card.tsx`: Oxlint 0/0, CC 4, cognitive 2, MI 53.9.
- `read-time-badge.tsx`: Oxlint 0/0, CC 4, cognitive 3, MI 60.0.
- `article-content.tsx`: Oxlint 0/0, MI 67.5.
- `article-detail-modal-wiki.tsx`: Oxlint 0/0.
- `view-mode-storage.ts`: Oxlint 0/0, MI above 72.

## Commands and tests run

- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`
- `npm --prefix frontend test -- --runInBand __tests__/reading-queue.test.tsx`
- `npm --prefix frontend test -- --runInBand __tests__/highlight-utils.test.tsx
  __tests__/highlight-toolbar.test.tsx`
- Direct pinned Oxlint on `novelty-badge.tsx` and `queue-overview-card.tsx`
- `npm --prefix frontend test -- --runInBand __tests__/safe-image.test.tsx`
- `npm --prefix frontend test -- --runInBand __tests__/view-mode-storage.test.ts`
- `npm --prefix frontend test -- --runInBand __tests__/highlight-note-popover.test.tsx`
- `npm --prefix frontend test -- --runInBand __tests__/article-detail-modal.test.tsx`
- Pinned Oxlint on both edited files with `.oxlintrc.json`
- Pinned Oxlint on each follow-up source slice with `.oxlintrc.json`
- Pinned aggregate Oxlint JSON for `frontend scripts`
- Direct per-file `quality_metrics.analyze_file` probes
- `npm run quality:controller:test`
- `npm run quality:controller:validate`
- `scripts/self-test`
- `node scripts/quality-hardening.mjs verify --scope repo --json`
- `git diff --check`

The article-detail modal suite passed all 6 tests. The reading-queue suite passed all 12 tests. The SafeImage suite passed 1 test,
the view-mode storage suite passed 2 tests, and the highlight popover suite
passed 2 tests. Frontend TypeScript and each focused Oxlint command passed for
the clean slices. The self-test and repository verifier exited 1 because the
repository still has unrelated maintainability, dead-code, CRAP, broad
Oxlint, and backend mypy failures. CCCC, frontend typecheck, frontend tests,
build, imports, CLI checks, Rust checks, and backend tests passed in the final
verifier report.

## Assumptions and risks

- `getDailyDigest` remains the source of truth for the digest item shape; the
  local readonly view is intentionally derived from that function's return
  type.
- Returning `false` for intentionally empty React output preserves the visible
  behavior while satisfying the repository's consistent-return and no-null
  rules.
- The current repo-wide Oxlint command remains a separate integration failure;
  the cleaned source slices pass the pinned binary directly. The article-detail
  modal remains the largest frontend source debt, while the renderer utility
  and article-content source slices are clean.

## Remaining failures or blockers

The full verifier reports 229 maintainability failures, dead-code findings,
312 CRAP violations, broad frontend Oxlint findings, and 24 backend mypy
errors. None names either edited file in the captured failure output. These
remain the next ownership slices; they are not reasons to modify the hook.

## Rollback or next executable step

Review or revert only the source paths whose behavior review finds a problem.
The next executable step is to select the next small frontend component from
the Oxlint inventory, inspect its callers and tests, and repeat the same
measure-edit-test cycle without broad hook changes.
