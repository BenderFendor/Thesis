# Learnings

## 2026-04-28 — Documentation health spans README, docs, and GitHub Wiki

Context:
- The repo needed a durable Codex rule for keeping user-facing documentation synced without treating `docs/` as the GitHub Wiki.
- GitHub Wikis are edited through a separate `.wiki.git` repository, while `/docs` remains better suited for developer, maintainer, and agent-facing material.

What worked:
- Adding a short rule to `AGENTS.md` and putting the detailed workflow in `docs/documentation-maintenance.md`.
- Adding `docs/documentation-style-guide.md` so documentation updates follow concrete, maintainer-like writing instead of generic AI-sounding prose.
- Making final responses report whether docs were updated, checked, or blocked.

Future Codex agents should:
- Check documentation health when public behavior, setup, config, architecture, troubleshooting, dependencies, or user workflows change.
- Keep README short, keep `/docs` for developer and agent material, and use the GitHub Wiki for longer end-user guides.
- Read the documentation style guide before editing README, docs, or wiki pages.

## 2026-04-28 — Broad cleanup needs lockfile and deletion verification

Context:
- A cleanup commit removed unused frontend dependencies and deleted unused components.
- The code was clean, but a stale `frontend/pnpm-lock.yaml` still referenced removed packages and would have kept an alternate install path out of sync.
- A stop hook also attempted to lint a deleted TSX file path, causing a false ESLint failure.

What worked:
- Verifying deleted components with `rg` and import/build checks before committing.
- Removing the stale alternate lockfile instead of leaving two package-manager states.
- Updating the global lint hook to skip deleted paths before invoking ESLint.

Future Codex agents should:
- Treat package manifests and tracked lockfiles as one change unit.
- Before committing cleanup, inspect `git diff --cached --name-status` and confirm deleted files have no live references.
- If hook failures reference deleted files, fix hook scope or stale targets instead of restoring dead code.

## 2026-04-28 — Merge repairs need explicit conflict-marker checks

Context:
- A push was rejected because local and remote `main` diverged.
- The merge resolution had left conflict markers in `docs/Log.md`, even though Git considered all conflicts fixed.

What worked:
- Keeping both useful changelog entries in chronological order.
- Running `rg -n '<<<<<<<|=======|>>>>>>>'` across touched files before concluding the merge.
- Validating structured files touched by the merge, including RSS JSON.

Future Codex agents should:
- After resolving merges, always search touched text files for conflict markers.
- For changelog conflicts, preserve both sides unless one entry is clearly duplicate or obsolete.
- Run `git status -sb` before push and only push once the branch is ahead without unresolved worktree changes.

## 2026-04-27 — Keep API response DTOs out of route modules

Context:
- A backend import cycle appeared between `app.api.routes.reading_queue` and `app.services.reading_queue` because the service imported `QueueOverviewResponse` from the route module.

What worked:
- Moving `QueueOverviewResponse` into `app.models.reading_queue` and importing that shared model from both layers.
- Adding a dedicated cycle check command (`npm run deps:cycles`) that runs `madge` for frontend and `backend/scripts/check_import_cycles.py` for backend.

Future Codex agents should:
- Keep request/response DTOs in `app.models.*` (or another shared contract module), not inside route files consumed by services.
- Run `npm run deps:cycles` during refactors that touch cross-layer imports.

## 2026-04-27 — Prefer package-local knip execution in this monorepo

Context:
- Running `knip` from repo root produced noisy or misleading results for frontend because plugin resolution and entry discovery were mixed across root/frontend manifests.
- Running from the package directory (`cd frontend && npx knip`) produced a much cleaner unused-code signal.

What worked:
- Combining package-local `knip` results with `rg` reference checks and `madge --depends` before deleting files/dependencies.
- Treating only zero-reference candidates as high-confidence removals.

Future Codex agents should:
- Execute `knip` from each package directory in this repo instead of only at root.
- Confirm every removal candidate with both text search and import-graph dependency checks before editing manifests.

## 2026-04-27 — Prefer verify.sh as strongest path

Context:
- This repository already has a strong cross-stack verifier at `./verify.sh`.
- The new `scripts/self-test` command should avoid duplicating that flow.

What worked:
- Detecting and delegating to `./verify.sh` first inside `scripts/self-test`.
- Keeping fallback stack checks only for repositories where `verify.sh` is missing.

What failed:
- Running ad-hoc per-stack commands first can drift from repo-owned verification logic.

Future Codex agents should:
- Use `scripts/self-test` as the default command.
- Treat `./verify.sh` output as source of truth for full verification in this repo.

## 2026-04-27 — Keep AGENTS.md short and map-oriented

Context:
- The previous root `AGENTS.md` mixed long policy details with durable instructions.
- It was costly to parse and harder to keep current.

What worked:
- Converting root `AGENTS.md` to a short operational map.
- Moving repeatable details into `docs/agent/*` with explicit read order.

What failed:
- Keeping too many implementation-level rules in one instructions file.

Future Codex agents should:
- Update focused docs under `docs/agent/` for deep guidance.
- Keep `AGENTS.md` concise and link out instead of expanding inline.

## 2026-04-27 — Code Quality Audit Insights

Context:
- Ran 8 subagent code quality audit in parallel across DRY, types, unused code, circular deps, weak types, defensive catch, legacy code, and comment slop.
- Identified high-confidence removals and consolidation targets.

What worked:
- knip + manual grep verification for unused code (27 packages, 8 files identified)
- madge for circular dependency detection (clean codebase confirmed)
- TypeScript strict mode for weak type identification
- Parallel subagent execution for broad coverage in single session

What failed:
- Some high-value refactors (API error handler, type consolidation) too risky for bulk apply
- Pre-existing test failure exposed during verification (unrelated to our changes)

Future Codex agents should:
- Use `docs/agent/code-quality-audit.md` as reference for follow-up work
- Apply type consolidation in phased approach with backward-compatible re-exports
- Test after each change category to isolate regressions

## 2026-04-27 — Property tests can fail outside touched scope

Context:
- Full `scripts/self-test` can expose existing Hypothesis counterexamples unrelated to the files being edited.
- In this repo, `test_source_url_guard` and `test_country_mentions` may fail depending on generated examples.

What worked:
- Running focused tests for changed modules first to validate refactors.
- Recording pre-existing property-test failures in `docs/agent/known-errors.md` with concrete symptom/cause text.

Future Codex agents should:
- Treat these failures as known baseline issues unless your task modifies the extraction logic.
- Still run `scripts/self-test` and report the failures explicitly rather than skipping full verification.

## 2026-04-27 — Use generated OpenAPI types for verification contracts

Context:
- Frontend verification DTOs were manually re-declared even though `frontend/lib/generated/openapi.ts` already exposes canonical verification schemas.
- Backend has two different `SourceInfo` models, so generated schema keys are disambiguated (`app__models__news__SourceInfo` vs `app__models__verification__SourceInfo`).

What worked:
- Moving verification contract types into `frontend/lib/types/verification.ts` and deriving them from generated OpenAPI schemas while preserving stricter frontend-required fields.
- Re-exporting those shared types from `frontend/lib/verification.ts` to keep caller imports stable.

Future Codex agents should:
- Prefer OpenAPI-derived types for frontend API contracts before adding manual DTO interfaces.
- Use schema-specific names (the disambiguated generated keys) when backend model names collide.
