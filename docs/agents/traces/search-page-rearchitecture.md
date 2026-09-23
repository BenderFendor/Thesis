# Search Page Rearchitecture Trace

Goal: split the search route into typed model, state, stream, transport, and view modules without changing the research workflow.
Done criteria: preserve inline editing and search submission, validate persistence and stream envelopes, own abort lifecycle, pass focused checks, run the route, and record blockers.
Status: implementation and readonly-boundary cleanup complete; repository-wide lint and self-test remain blocked by existing quality debt and a watchdog timeout.
Files changed: `frontend/app/search/page.tsx`, `frontend/app/search/research/`, `frontend/__tests__/search-inline-edit.test.tsx`, `frontend/__tests__/search-research-state.test.tsx`, `.oxlintrc.json`, `docs/Log.md`, `docs/agent/learnings.md`.
Commands run: targeted Jest, full frontend Jest, frontend TypeScript, scoped Oxlint, frontend build, frontend lint, browser smoke, `git diff --check`, bounded `scripts/self-test`, and a pinned `oxlint-tsgolint` install verification.
Tests added: reducer summary immutability, visibility-set transitions, persisted-envelope validation, timestamp revival.
Risk tier: high; the route combines React state, localStorage, streamed responses, semantic side effects, and URL handoff behavior.
Assumptions: existing backend stream payloads remain compatible with the new Zod envelopes; `CHAT_STORAGE_VERSION` remains `1`; existing service injection remains the test boundary.
Verification: focused search tests pass 4/4; the current full frontend suite passes 51 suites and 176 tests; frontend TypeScript passes; frontend production build passes; browser smoke rendered desktop and mobile `/search`, created an empty session, and a sample-query click left the expected value in the focused textarea.
Readonly evidence: the 18-file research scope exits Oxlint with 0 errors and 338 warnings; the readonly parameter error count fell from 137 to 0. The model uses readonly article projections and callback capabilities for input focus and scroll behavior.
Layout evidence: desktop and mobile page widths matched viewport widths (1440/1440 and 390/390) with no horizontal overflow.
Lint evidence: full frontend lint previously exited nonzero with 8,923 diagnostics across 215 files; the full lint was not rerun after this scoped cleanup.
Self-test evidence: `scripts/self-test` was run through the command watchdog and timed out after 300 seconds while `verify.sh` was running.
Assumptions and risks: stream transport gates updates on active `AbortController` identity; backend semantic requests remain independently started by the existing API helper and are not cancellable through the stream signal. The unused composer form ref was removed; form submission behavior remains local to the composer.
Rollback: restore `frontend/app/search/page.tsx` from the current branch and remove the new `frontend/app/search/research/` modules plus the added state test; retain unrelated working-tree changes.
Next executable step: continue the repository quality campaign by addressing the existing Oxlint debt, then rerun `scripts/self-test` with the documented 600-second repository budget.
