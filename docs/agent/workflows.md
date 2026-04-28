# Workflows

These workflows keep changes consistent with the Codex loop:

`orient -> inspect -> edit -> self-test -> diagnose -> fix -> verify -> record learning`

## Fix Bug

- read first
  - `AGENTS.md`
  - `docs/agent/repo-map.md`
  - `docs/agent/testing.md`
  - relevant route/service/component and call sites

- edit steps
  - reproduce with the smallest failing command or request
  - patch the smallest root cause
  - add or update regression test when practical

- verification command
  - `scripts/self-test`

- learning update
  - add reusable failure/fix to `docs/agent/known-errors.md`
  - add durable lesson to `docs/agent/learnings.md`

## Add Feature

- read first
  - `AGENTS.md`
  - `docs/agent/repo-map.md`
  - existing feature-adjacent code paths

- edit steps
  - design within existing architecture
  - implement minimal viable change
  - add tests for core success/failure behavior

- verification command
  - `scripts/self-test`

- learning update
  - document new verification caveats or conventions in `docs/agent/learnings.md`

## Refactor

- read first
  - `AGENTS.md`
  - `docs/agent/repo-map.md`
  - all call sites and affected interfaces

- edit steps
  - preserve behavior first
  - reduce complexity in small, reviewable steps
  - keep interface changes explicit and synchronized

- verification command
  - `scripts/self-test`

- learning update
  - capture any new safe refactor patterns in `docs/agent/learnings.md`

## Broad Cleanup

- read first
  - `AGENTS.md`
  - `docs/agent/code-quality-audit.md` when the task is cleanup-driven
  - manifests and lockfiles for every touched package

- edit steps
  - group changes by behavior surface: backend contracts, frontend routes, dependencies, docs
  - before deleting files, confirm no live imports with `rg` and, when useful, import-graph tooling
  - keep only one active package-manager lockfile family per package
  - update audit docs after late deletions so the record does not mention removed files as pending work

- verification command
  - focused lint/typecheck after each large cleanup batch
  - `scripts/self-test` before handoff

- learning update
  - record baseline failures separately from cleanup-caused failures

## Merge Or Push Repair

- read first
  - `git status`
  - `git log --oneline --decorate --graph --max-count=12 --all`
  - conflicted files, especially `docs/Log.md` and `docs/Todo.md`

- edit steps
  - preserve both useful sides of changelog conflicts in reverse chronological order
  - remove conflict markers from the final file, not just from the worktree view
  - validate structured files touched by the merge, such as JSON catalogs

- verification command
  - `rg -n '<<<<<<<|=======|>>>>>>>' <touched-files>`
  - `git diff --check`
  - targeted validators for touched structured files

- completion
  - conclude the merge with `git commit --no-edit` only after checks pass
  - push only after `git status -sb` shows the branch is ahead with no unresolved worktree changes

## Documentation Health

- read first
  - `AGENTS.md`
  - `docs/documentation-maintenance.md`
  - `docs/documentation-style-guide.md`
  - `README.md` when public setup or usage changed

- inspect
  - current git diff and recent commits
  - whether user-facing behavior, setup, config, API, UI workflows, architecture, troubleshooting, dependencies, screenshots, or release behavior changed
  - whether the GitHub Wiki needs an end-user update

- edit steps
  - keep README short and link to deeper docs
  - keep `/docs` developer, maintainer, and agent-facing
  - keep GitHub Wiki end-user and long-guide facing
  - update only docs that are stale because of a concrete repo change
  - apply `docs/documentation-style-guide.md`

- verification command
  - `git diff --check`
  - markdown lint if the repo adds one
  - wiki repo `git diff --check` before committing wiki changes

- final response
  - `Docs updated: ...`
  - `Docs checked, no update needed: ...`
  - `Docs update needed but not pushed: ...`

## Update UI

- read first
  - `AGENTS.md`
  - relevant page/component/hook files under `frontend/`
  - existing tests in `frontend/__tests__/`

- edit steps
  - preserve established visual language unless redesign requested
  - update component + caller props together
  - update tests and snapshots if behavior changes

- verification command
  - `scripts/self-test`
  - if scope is UI-only and full run is too slow, run targeted frontend checks first, then `scripts/self-test`

- learning update
  - record reusable UI gotchas in `docs/agent/learnings.md`

## Add Test

- read first
  - `docs/agent/testing.md`
  - nearby existing tests for style and fixtures

- edit steps
  - choose the narrowest test level (unit/integration)
  - assert behavior, not implementation trivia
  - include failure-path coverage when relevant

- verification command
  - run the new test directly
  - run `scripts/self-test`

- learning update
  - if test setup needs non-obvious env/tooling, document in `docs/agent/testing.md`

## Update Dependency

- read first
  - `AGENTS.md`
  - lockfiles/manifests (`package.json`, `frontend/package.json`, `backend/requirements.txt`, `backend/rss_parser_rust/Cargo.toml`)
  - upstream release/migration notes (websearch/exa-code as needed)

- edit steps
  - update the minimum necessary dependency set
  - update or remove stale lockfiles in the same change
  - adapt code/config for breaking changes
  - avoid unrelated version churn

- verification command
  - `scripts/self-test`

- learning update
  - record migration pitfalls and stable fixes in `docs/agent/learnings.md`
  - record recurring dependency failure signatures in `docs/agent/known-errors.md`
