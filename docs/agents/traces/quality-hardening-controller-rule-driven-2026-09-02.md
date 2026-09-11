# Quality-hardening controller: rule-driven implementation trace

## Goal and done criteria

Implement the repository-side portions of the quality-hardening architecture:
one policy for verification commands, correct changed-file measurement, real
Oxlint diagnostic normalization, and root-cause task grouping. Preserve the
existing hook, analyzer thresholds, and unrelated dirty work.

## Status

Repository controller phases 1-3 are partially implemented. The shared
user-level hook core, SQLite cache, parity canaries, CI replacement, and full
quality cleanup campaign are not complete.

## Evidence and decisions

- Real Oxlint JSON used `eslint(no-null)` and diagnostic-level `filename`.
  The adapter now normalizes the code and reads the filename before queueing.
- Changed scope now combines `git diff --name-only -z --diff-filter=ACMR HEAD`
  with `git ls-files --others --exclude-standard -z`, then applies configured
  source roots and extensions.
- Mechanical task keys use factor, taxonomy cluster, and exact rule. Task
  paths retain every affected file. Structural source-unit grouping is unchanged.
- The expanded modal sidebar now has its own boundary; both the extracted
  sidebar and the remaining layout pass direct Oxlint without changing behavior.
- The reader and chrome boundaries now pass direct Oxlint as well. The reader
  is below the max-lines limit with no `no-ternary` findings, and the chrome
  keeps optional JSX, event propagation, progress styles, and ref mutation
  behind explicit component or callback boundaries.
- The highlight sync controller exposes a readonly token view plus an explicit
  setter, so helper parameters satisfy the readonly contract without hiding
  mutation behind a nested ref assignment.
- Verification commands and profile membership now live in
  `quality-hardening.config.json`; `verify.mjs` only resolves and runs them.
- The mutation-aware readonly codemod predicate now rejects array mutation and
  opaque direct handoffs; its dry run returns zero additional edits for the
  repaired modal/store files.
- No separate Codemode capability was available in this session. The existing
  repository `scripts/codemod-lint-mechanical.mjs` was used instead, with
  transforms selected from normalized Oxlint rule IDs.

## Files changed

- `quality-hardening.config.json`
- `scripts/quality-hardening/adapters/oxlint.mjs`
- `scripts/quality-hardening/config.mjs`
- `scripts/quality-hardening/cli.mjs`
- `scripts/quality-hardening/measure.mjs`
- `scripts/quality-hardening/queue.mjs`
- `scripts/quality-hardening/source-units.mjs`
- `scripts/quality-hardening/verify.mjs`
- `frontend/components/article-detail-modal-layout.tsx`
- `frontend/components/article-detail-modal-sidebar.tsx`
- `frontend/components/article-detail-modal-reader.tsx`
- `frontend/components/article-detail-modal-chrome.tsx`
- `frontend/components/article-detail-modal-language.tsx`
- `frontend/lib/article-detail-modal-types.ts`
- `frontend/components/article-detail-modal.tsx`
- `scripts/codemod-lint-mechanical.mjs`
- `scripts/tests/quality-hardening/adapters.test.mjs`
- `scripts/tests/quality-hardening/config.test.mjs`
- `docs/agents/quality-hardening/QUALITY-HARDENING-MULTI-OBJECTIVE-AGENT-ARCHITECTURE.md`
- `docs/Log.md`
- `docs/agent/learnings.md`

Other dirty files were present before this slice and were preserved.

## Commands and tests run

- `scripts/agent-summary`
- `node scripts/quality-hardening.mjs validate`
- `npm run cli:typecheck`
- `node --test scripts/tests/quality-hardening/*.test.mjs`
- focused modal Jest suites: 4 suites, 11 tests passed
- frontend TypeScript check passed
- changed measurement selected 53 changed source files and reported 2,038
  units, 1,984 Oxlint errors, 44 warnings, and 0 unknown lint paths after
  adapter normalization
- queue rebuild from measurement `qh-measure:8c679685662ff3181e365e7d`
  produced 173 grouped tasks; the next exact-rule task is derived from the
  refreshed changed scope
- direct Oxlint passes for the reader, chrome, language, layout, and sidebar;
  frontend TypeScript passes; focused modal tests pass 4 suites and 11 tests
- direct Oxlint on the modal layout/sidebar, frontend TypeScript, and focused
  modal Jest suites passed after the sidebar extraction
- the existing rule-specific codemod was dry-run with the `readonly` rule; it
  identified 2 applicable files. Applying it required restoring two mutable
  accumulator parameters after TypeScript caught invalid `.push()` calls.
- A grouped `unicorn/no-null` codemod attempt retained type-safe local
  replacements and restored unsafe replacements after TypeScript identified
  legitimate `null` API, state, ref, and cache contracts. That rule remains
  contextual rather than an automatic transform.
- `node scripts/quality-hardening.mjs verify --scope changed --json`: all four
  configured changed-scope checks passed; measurement failed on existing debt;
  tracked worktree remained unchanged
- `scripts/self-test`: completed with `verification repo: failed`. The latest
  repo measurement `qh-measure:0b378f00ffe356e99ebde442` recorded CCCC 0,
  Oxlint 12,331 errors and 311 warnings, and CRAP 288 violations across
  1,138 measured and 1,582 unknown-coverage units.
- `git diff --check`

## Assumptions and risks

- Git `HEAD` exists for the repository, and NUL-delimited output is available.
- The repository policy and native analyzer configs are trusted local inputs.
- Existing stale queue records from pre-normalization measurements remain in
  the ledger and are marked stale by rebuild; they are not treated as current.
- The full Oxlint and CRAP gates remain red across the dirty repository. The
  fixed modal reader/chrome slice is not the repository-wide blocker.

## Remaining failures or blockers

- The full repository quality gate still reports broad Oxlint, CRAP, and other
  repository debt. This is executable cleanup work, not a claimed pass.
- `hook.mjs` remains a neutral coordinator stub because the active user hook
  is intentionally out of scope for this repository change.
- The planned shared Python hook core, SQLite cache, verifier/dead-code/jscpd
  adapter separation, canaries, CI migration, and final cleanup are pending.

## Rollback or next executable step

Rebuild from the latest changed measurement with
`node scripts/quality-hardening.mjs queue rebuild --from 8c679685662ff3181e365e7d`.
To roll back this slice, restore the listed controller/docs files while
preserving the pre-existing dirty frontend and backend changes.
