# Search Page Simplification Trace

Goal: simplify the research/search implementation without changing the UI or removing working features.
Done criteria: identify unnecessary code seams, remove duplicated prop wiring and trivial hook wrappers, preserve user flows, run focused checks, and update project records.
Status: implementation, automated checks, and route smoke complete.
Files changed: `frontend/app/search/research/hooks/use-research-controller.ts`, `frontend/app/search/research/components/research-page.tsx`, `research-workspace.tsx`, `empty-research-view.tsx`, `chat-composer.tsx`, and this trace; unrelated working-tree changes preserved.
Commands and tests: pre-edit context scan, TypeScript, scoped Oxlint, focused search tests, full frontend tests, frontend production build, `curl http://127.0.0.1:3000/search` (`200 text/html`), and `git diff --check` passed. The UI-only edits from the previous scope were restored before this implementation.
Tests added: none; existing state and inline-edit tests cover the preserved behavior.
Assumptions: keep rendered markup and styling unchanged; simplify only adapter wiring and controller composition.
Risk tier: medium; prop reshaping and hook consolidation can hide a callback or alter effect timing.
Rollback: revert only the listed search files and this trace; preserve unrelated working-tree changes.

Audit: `ResearchWorkspaceContent`, `ResearchChatMain`, and `ResearchChatAside` manually repeated large prop lists even though their source and destination contracts already matched. The controller also wrapped article derivation, scroll synchronization, article-modal callbacks, and clipboard copying in one-use helpers.
Decision: use existing prop contracts directly with spread props, remove the wrapper component props interface, and keep one-use behavior beside the derived-state/action hook that consumes it. Do not change state, transport, persistence, or rendered markup.
Implementation: `research-page.tsx` now passes empty/chat view models directly; `research-workspace.tsx` passes the complete view contract to its three child components and removes the wrapper interface; `use-research-controller.ts` combines derived article data, scroll synchronization, modal callbacks, and clipboard handling with their consuming hooks. Motion values in `empty-research-view.tsx` are named constants so restoring the original UI does not reintroduce lint errors.
Preserved features: controller/state behavior, history operations, prompt submission, streaming cancellation, edit/retry/version actions, thinking steps, verification, related coverage, source expansion, and article modal callbacks remain unchanged.
Verification: TypeScript, scoped Oxlint (5 files, 0 errors, 92 warnings), focused search tests (2 suites, 4 tests), full frontend tests (51 suites, 176 tests), frontend production build, and `git diff --check` pass.
Remaining blockers: none for the code-only scope. Chrome visual verification is not applicable because rendered UI was restored rather than changed. The documented trace helper is absent, so this worksheet is maintained manually.
