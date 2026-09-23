# Confirmed codemod audit — 2026-09-08

## Goal and status

Audit the live Oxlint findings and every phase of the lean-codebase plan, implement only
confirmed mechanical changes, run them, and preserve the starting dirty worktree.
Baseline: commit bc93b24 plus the user's existing changes, not the commit alone.

The confirmed cleanup has been applied. This is not completion of the repository-wide
quality plan: direct lint and the full quality gate still fail, and browser verification
is unavailable. No rule, threshold, suppression, package manifest, or lockfile was relaxed.

## Stop-hook follow-up

The stop review exposed TS2554 in scripts/quality-hardening/schedule.mjs. Existing
callers and tests omit the repair class, and the implementation already handles its
absence; the JSDoc now correctly marks that argument optional without changing its
value type. Added scripts/tests/schedule-contract.test.ts inside the tooling compiler's
test discovery. `tsc -p scripts/tsconfig.json --noEmit` now passes.

The controller rerun exposed three filesystem-error regressions: plain-object guards
rejected native Error instances, so missing effects/task ledgers and released writer
claims incorrectly threw ENOENT. Corrected the guards in ledger.mjs, queue.mjs and
writer-claim.mjs, retaining rethrows for other errors. All 26 controller/contract tests
now pass, including the previously failing queue and writer-claim regressions.

The next structural-lint review found buttons nested inside navigation links in the
saved workspace. Reused the existing buttonVariants styling helper to render single
links, preserving styling and removing nested interactive elements. The first reported
JSX-depth violation is resolved; the file still has excessive dependencies, size and
other lint findings. Frontend TypeScript and 197 tests pass after this bounded repair.
This does not clear the wider quality gate. The numeric census below records the
codemod batch before these follow-ups.

## Results

| Measure | Before | After |
| --- | ---: | ---: |
| Direct Oxlint errors | 1,059 | 1,022 |
| Direct Oxlint warnings | 4,491 | 4,360 |
| Direct Oxlint total | 5,550 | 5,382 |
| Knip unused value exports, corrected entry graph | 78 | 0 |
| Knip unused type exports, corrected entry graph | 133 | 0 |
| Knip unused files, corrected entry graph | 2 | 0 |

The direct lint reduction is 168 diagnostics: 37 errors and 131 warnings. Counts include
frontend and scripts, including new tooling/tests. These are net reductions, not a claim
that every occurrence of the affected rules has a safe rewrite.

Application-source comparison covers 216 modified files and two deleted files:
51,420 bytes and 1,271 nonblank lines removed. New codemod tooling is not included in
that application-only deletion number. There were no dependency removals.

Deleted, after route/test graph and reference checks:

- frontend/components/source-credibility-panel.tsx
- frontend/lib/article-detail-modal-logic.ts

The original files remain in the pre-task tar backup. Historical plan/trace mentions are
retained as historical measurements, not live imports.

## Confirmed transformations

| Transformation | Implementation and guard | Executed |
| --- | --- | --- |
| Unused export/type surfaces | Native Knip export/type fixes, after removing the component-entry wildcard; preserves framework/test roots | Yes, repeated to a fixed point |
| Unused source modules | Native Knip file fix after explicit reference checks; only the two named files | Yes |
| Private unused declarations | TypeScript symbol identity; only top-level functions, function-valued single const declarations, interfaces and type aliases; excludes merged declarations, exports, scripts, parse errors, eval and type-directive ambiguities | Yes |
| Unused imports | Native TypeScript RemoveUnused; keeps side-effect imports and module scope; ignores whitespace-only proposals | Yes |
| Native safe lint fixes | Evaluated against typechecking and the exact snapshot; required-undefined fix rejected | Yes, accepted results retained |
| Variable sorter safety repair | Reject nested calls, getters, computed keys, mutation and spread rather than reorder their evaluation | Tool repaired and runtime-tested; not used as a broad source sweep |

The debug dashboard also needed its existing StartupTimelineCard implementation exported
and imported at its storage-tab call site. This repaired the baseline TS2304 error.

## Rejected or restricted transforms

- Splitting function-local variable declarations preserved runtime order but worsened
  minimum MI in 88 files and increased statement counts. The full trial batch was restored
  from the exact pre-task snapshot, then accepted deletion/import fixes were reapplied.
- One-use prop-builder inlining made the debug controller's minimum MI worse. The trial
  was restored and the transform removed from the delivered runner.
- Blanket variable sorting is not confirmed. Existing regression tests now cover nested
  calls, getters, mutation and iterator spread; literal-looking syntax alone is insufficient.
- Native unicorn/no-useless-undefined removed the required argument in
  onToggleExpanded(undefined), producing TS2554. The argument was restored. Do not run an
  unreviewed native --fix sweep and assume its safe label proves TypeScript compatibility.
- Oxfmt reduced MI in four files; their pre-format accepted contents were restored:
  globe-view-expanded-right.tsx, grid-view-controls.tsx,
  interactive-globe-scene-setup.ts, reading-queue-sidebar.tsx.
- Oxfmt removes parentheses required by unicorn/no-nested-ternary. The lint repair runs
  after formatting. Neither formatter nor lint configuration was weakened.
- Readonly, booleans/nullish defaults, promises, keys, JSX decomposition, type narrowing,
  JSDoc meaning and public-name changes require their actual contracts. No blanket
  semantics-changing transform is confirmed merely because the syntax is repetitive.

## Whole-plan assessment

| Plan phase | Codemod decision |
| --- | --- |
| 0 — Verification integrity | Tests and analyzer repairs, not a source-wide codemod. Existing controller reused. |
| 1 — Shared boundary bugs | Contract-specific fixes and regressions; not a blanket rewrite. |
| 2 — Unused source/exports | Confirmed and applied using Knip plus symbol-aware deletion. Required analyzer dependency retained. |
| 3 — Article mapping | Unused surfaces confirmed. Lookup hoisting/date helpers already exist in the current tree; no duplicate credit. Wire/view/null contracts need individual validation. |
| 4 — Reader/highlights/actions | Unused surfaces confirmed. Selected state, reader lifetime and persistence changes are not mechanical. |
| 5 — Queue/saved | Unused surfaces confirmed. Snapshot ownership, rollback and selected-article state need behavior checks. |
| 6 — Research/streaming | Unused surfaces confirmed. Builder trial rejected; reducer atomicity and cancellation are semantic. |
| 7 — Home/feed/grid/trends | Unused surfaces confirmed. Stable keys, callbacks, memoization and pagination require consumer-specific work. |
| 8 — Globe/WebGL | Unused surfaces confirmed. Resource disposal, renderer lifecycle and lookup sharing need runtime/identity evidence. |
| 9 — Cluster/evidence | Unused surfaces confirmed. Missing evidence versus zero and request ownership must remain explicit. |
| 10 — Atlas | Unused surfaces confirmed. DTO casts and graph/list ownership are not safe global replacements. |
| 11 — Wiki/funding | Unused surfaces confirmed. Similar normalizers and evidence adapters have differing contracts. |
| 12 — Debug/appearance | Unused surfaces confirmed; missing component wiring repaired. Builder trial rejected; tab/query ownership is manual. |
| 13 — Backend/Rust | No additional blanket codemod confirmed. Transactions, native binding ownership and normalization contracts must be preserved. |
| 14 — CLI/tooling | Reused installed compiler/Knip and existing file collector/test subprocess helper. Hardened sorter; did not build another controller. |
| 15 — Remaining metrics/lint | Accepted native fixes and deletion only. Structural and semantic findings remain open. |
| 16 — Closure/docs | Deterministic verification is executable, but it is not a codemod. Global closure remains failed. |

## Reproduction

From the repository root:

```bash
node scripts/codemod-lean.mjs
node scripts/codemod-lean.mjs --apply
node --test scripts/tests/transformations/*.test.mjs
frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit
```

The runner is dry-run by default. Its only selectable rules are dead and imports.
It scans owned frontend production roots, validates all source snapshots before writing,
and reports each changed file, applied rule and byte difference. It does not alter
linter policy or run the rejected transforms.

From frontend, audit exports and files with the installed Knip:

```bash
npx --no-install knip --reporter json --no-config-hints
npx --no-install knip --fix --fix-type exports,types --reporter json --no-config-hints
```

Do not automatically delete every future Knip file/dependency finding. This audit approved
only the two named source files. @barney-media/crap-typescript remains required by the
repository quality commands despite Knip's frontend-only dependency finding.

## Verification evidence

- Transformation suite: 103 tests passed; includes execution-order, live binding, module scope,
  malformed-source, required-undefined and idempotence regressions.
- Frontend: 55 Jest suites / 197 tests passed.
- Frontend TypeScript and production build passed after restoring the required undefined.
- Custom TypeScript transforms passed strict standalone typechecking.
- New runner and transformation modules have zero scoped lint findings.
- New production-tool minimum MI: lean-local 60.8, runner 60.6, unused-imports 60.4.
- The pre-format retained application batch had no minimum-MI regression in 216 files.
  Four later formatting regressions were identified and restored individually; a rerun
  confirms each returned exactly to its baseline minimum MI. No retained application
  file has a lower minimum MI than its pre-task baseline.
- Full scripts/self-test ran to exit 1 after 558.758 seconds. Its measurement
  4679e098d3d877a534a10632 reports five CCCC violations, failed lint, 1,186 functions
  below MI 60, and 311 CRAP violations with 1,444 unknown units. This is a failed
  broader gate, not a codemod pass disguised as repository closure.
- An earlier 300-second watchdog attempt timed out. The controller child continued;
  its in-flight source snapshot was invalidated by a file deletion. Do not use that
  earlier CRAP analyzer error as a final source result.
- Chrome MCP could not connect: DevToolsActivePort was absent at
  /home/bender/.config/google-chrome/DevToolsActivePort. No visual verification claimed.

## Changed tooling and records

- scripts/codemod-lean.mjs
- scripts/transformations/lean-local.ts
- scripts/transformations/unused-imports.ts
- scripts/transformations/sort-vars.mjs
- Corresponding scripts/tests/transformations tests
- frontend/knip.json; accepted frontend export/import/deletion changes
- Native safe-fix edits in frontend/scripts, reviewed against the snapshot
- docs/agent/lean-codebase-plan.md, known-errors.md, learnings.md, docs/Log.md

## Evidence and rollback

Raw reports and the exact starting snapshot:
 /tmp/thesis-confirmed-codemods-rtCrBb/

source-before.tar contains the original frontend/scripts, including untracked source.
initial.patch and initial-status.txt identify the user's original dirty state.
Do not restore Git HEAD over this worktree. Restore only affected paths from the exact
snapshot if rolling back this audit, checking for subsequent user edits first.

Next executable work is contract-specific lint/metric repair, not another unreviewed
global syntax sweep. Browser verification additionally needs the configured Chrome
debugging session.

## Complete direct rule census

Every rule present before or after is listed. Lower counts can result from deleting
unused code; they do not prove a general rewrite exists for that rule.

| Rule | Before | After |
| --- | ---: | ---: |
| anti-slop(no-known-value-widening) | 22 | 22 |
| anti-slop(no-object-parameters) | 1 | 1 |
| anti-slop(no-runtime-typeof) | 48 | 48 |
| anti-slop(no-unknown-parameters) | 14 | 14 |
| anti-slop(no-unknown-returns) | 3 | 3 |
| anti-slop(no-unsafe-dictionary-type) | 18 | 17 |
| anti-slop(require-safety-comment-for-type-assertion) | 18 | 18 |
| eslint(array-callback-return) | 2 | 2 |
| eslint(eqeqeq) | 13 | 10 |
| eslint(id-length) | 216 | 215 |
| eslint(init-declarations) | 19 | 19 |
| eslint(max-lines) | 32 | 30 |
| eslint(max-lines-per-function) | 195 | 192 |
| eslint(max-statements) | 94 | 93 |
| eslint(no-await-in-loop) | 7 | 7 |
| eslint(no-continue) | 26 | 26 |
| eslint(no-inline-comments) | 8 | 8 |
| eslint(no-nested-ternary) | 24 | 23 |
| eslint(no-promise-executor-return) | 1 | 1 |
| eslint(no-shadow) | 3 | 3 |
| eslint(no-ternary) | 700 | 692 |
| eslint(no-underscore-dangle) | 16 | 16 |
| eslint(no-unmodified-loop-condition) | 1 | 1 |
| eslint(no-unused-vars) | 37 | 17 |
| eslint(no-useless-return) | 6 | 6 |
| eslint(prefer-named-capture-group) | 14 | 14 |
| eslint(require-unicode-regexp) | 6 | 6 |
| eslint(sort-keys) | 3 | 3 |
| eslint(sort-vars) | 515 | 512 |
| import(exports-last) | 52 | 45 |
| import(first) | 19 | 19 |
| import(group-exports) | 27 | 21 |
| import(max-dependencies) | 19 | 19 |
| import(no-namespace) | 15 | 15 |
| import(no-unassigned-import) | 1 | 1 |
| jest(max-expects) | 2 | 2 |
| jest(no-conditional-in-test) | 30 | 30 |
| jest(prefer-ending-with-an-expect) | 9 | 9 |
| jest(require-hook) | 11 | 11 |
| jsdoc(require-param) | 81 | 81 |
| jsdoc(require-param-description) | 47 | 47 |
| jsdoc(require-param-type) | 6 | 6 |
| jsdoc(require-returns) | 163 | 163 |
| jsdoc(require-returns-description) | 13 | 13 |
| jsdoc(require-returns-type) | 1 | 1 |
| jsx-a11y(click-events-have-key-events) | 5 | 4 |
| jsx-a11y(control-has-associated-label) | 2 | 2 |
| jsx-a11y(iframe-has-title) | 1 | 1 |
| jsx-a11y(no-noninteractive-element-interactions) | 1 | 1 |
| jsx-a11y(no-noninteractive-element-to-interactive-role) | 2 | 2 |
| jsx-a11y(no-static-element-interactions) | 4 | 3 |
| jsx-a11y(prefer-tag-over-role) | 9 | 9 |
| node(callback-return) | 1 | 1 |
| node(no-mixed-requires) | 1 | 1 |
| node(no-sync) | 29 | 29 |
| oxc(no-map-spread) | 1 | 1 |
| promise(always-return) | 1 | 1 |
| promise(avoid-new) | 2 | 2 |
| promise(param-names) | 1 | 1 |
| promise(prefer-await-to-callbacks) | 7 | 7 |
| promise(prefer-await-to-then) | 19 | 19 |
| promise(prefer-catch) | 1 | 1 |
| react(display-name) | 1 | 1 |
| react(exhaustive-effect-dependencies) | 1 | 1 |
| react(hook-use-state) | 1 | 1 |
| react(iframe-missing-sandbox) | 1 | 1 |
| react(immutability) | 3 | 3 |
| react(incompatible-library) | 2 | 2 |
| react(jsx-handler-names) | 52 | 52 |
| react(jsx-max-depth) | 870 | 862 |
| react(jsx-no-undef) | 1 | 0 |
| react(jsx-no-useless-fragment) | 12 | 12 |
| react(jsx-props-no-spreading) | 84 | 76 |
| react(memo-dependencies) | 11 | 11 |
| react(no-array-index-key) | 26 | 25 |
| react(no-object-type-as-default-prop) | 1 | 1 |
| react(no-set-state) | 1 | 1 |
| react(set-state-in-effect) | 3 | 3 |
| react(state-in-constructor) | 1 | 1 |
| react(use-memo) | 1 | 1 |
| react-hooks(exhaustive-deps) | 17 | 17 |
| react-perf(jsx-no-new-array-as-prop) | 12 | 12 |
| react-perf(jsx-no-new-function-as-prop) | 204 | 200 |
| react-perf(jsx-no-new-object-as-prop) | 37 | 36 |
| thesis(no-fragile-map-keys) | 1 | 1 |
| thesis(no-hook-object-dependencies) | 5 | 5 |
| typescript(consistent-return) | 70 | 70 |
| typescript(consistent-type-imports) | 1 | 0 |
| typescript(no-base-to-string) | 1 | 1 |
| typescript(no-confusing-void-expression) | 2 | 2 |
| typescript(no-deprecated) | 21 | 21 |
| typescript(no-empty-interface) | 2 | 2 |
| typescript(no-inferrable-types) | 1 | 1 |
| typescript(no-misused-promises) | 21 | 21 |
| typescript(no-non-null-assertion) | 3 | 3 |
| typescript(no-unnecessary-type-conversion) | 2 | 2 |
| typescript(no-unnecessary-type-parameters) | 3 | 3 |
| typescript(no-unsafe-argument) | 93 | 79 |
| typescript(no-unsafe-assignment) | 78 | 71 |
| typescript(no-unsafe-call) | 52 | 32 |
| typescript(no-unsafe-member-access) | 125 | 100 |
| typescript(no-unsafe-return) | 49 | 42 |
| typescript(no-unsafe-type-assertion) | 21 | 21 |
| typescript(prefer-nullish-coalescing) | 75 | 75 |
| typescript(prefer-promise-reject-errors) | 1 | 1 |
| typescript(prefer-readonly-parameter-types) | 412 | 406 |
| typescript(require-await) | 8 | 8 |
| typescript(strict-boolean-expressions) | 367 | 361 |
| typescript(strict-void-return) | 45 | 45 |
| typescript(switch-exhaustiveness-check) | 5 | 4 |
| typescript(unbound-method) | 2 | 2 |
| unicorn(custom-error-definition) | 1 | 1 |
| unicorn(explicit-length-check) | 2 | 2 |
| unicorn(filename-case) | 5 | 5 |
| unicorn(max-nested-calls) | 30 | 30 |
| unicorn(new-for-builtins) | 1 | 1 |
| unicorn(no-array-callback-reference) | 17 | 17 |
| unicorn(no-array-sort) | 10 | 10 |
| unicorn(no-await-expression-member) | 12 | 12 |
| unicorn(no-immediate-mutation) | 3 | 3 |
| unicorn(no-lonely-if) | 1 | 1 |
| unicorn(no-nested-ternary) | 1 | 1 |
| unicorn(no-object-as-default-parameter) | 3 | 3 |
| unicorn(no-useless-collection-argument) | 1 | 1 |
| unicorn(no-useless-switch-case) | 1 | 1 |
| unicorn(no-useless-undefined) | 1 | 1 |
| unicorn(prefer-export-from) | 2 | 2 |
| unicorn(prefer-number-coercion) | 1 | 1 |
| unicorn(prefer-string-slice) | 2 | 2 |
| unicorn(prefer-ternary) | 1 | 1 |
| unicorn(prefer-top-level-await) | 2 | 2 |
