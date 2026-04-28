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
  - adapt code/config for breaking changes
  - avoid unrelated version churn

- verification command
  - `scripts/self-test`

- learning update
  - record migration pitfalls and stable fixes in `docs/agent/learnings.md`
  - record recurring dependency failure signatures in `docs/agent/known-errors.md`
