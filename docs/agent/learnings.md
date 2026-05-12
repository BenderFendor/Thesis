# Learnings

## 2026-05-12 — Non-journalist Wikidata false positives require occupation gate

Context:
- The reporter entity resolver (`build_reporter_dossier`) scored Wikidata candidates on name + human + occupation + organization + context. With weights 0.34/0.22/0.18/0.14/0.12, a human with a matching name cleared the 0.55 threshold even with zero journalist signal.
- Jonathan Carter (NewsNation reporter) matched Q64821312 (cancer researcher with 320 papers, h=42) because `name_score + human_score = 0.56 > 0.55`.

What worked:
- Rebalancing weights to reduce name_score (0.34->0.30) and increase occupation_score (0.18->0.26) so name alone cannot carry a match.
- Adding a `NON_JOURNALIST_OCCUPATIONS` set with a hard penalty (-0.4) for known non-journalist Wikidata occupation labels.
- Requiring at least one candidate with `occupation_score > 0` before a match is possible. When no journalist candidates exist, return `match_status: "none"` immediately instead of displaying the top non-journalist as "best candidate."
- Raising the single-candidate threshold to 0.65 when only one Wikidata result exists, since there is no competitor to calibrate against.
- Removing "author" from `JOURNALISM_KEYWORDS` (matches fiction authors, academic authors, etc.).

Future Codex agents should:
- Never let name similarity alone determine entity resolution confidence.
- Require domain-specific occupation or affiliation signals before marking a match.
- Treat the outlet/employer context as a strong inverse signal: a byline from a news outlet is a journalist until proven otherwise.

## 2026-05-12 — Unified User-Agent constants prevent site-specific blocking

Context:
- The codebase had 15+ different User-Agent strings across 13 files, ranging from inline strings to module-level constants. Image extraction used a Mozilla/5.0 browser pattern while Wikimedia services used descriptive bot format.
- CDN-protected news sites often block non-browser User-Agent strings on image endpoints.

What worked:
- Centralizing into three constants in `app/core/config.py`: `SCOOP_USER_AGENT` (general web, descriptive bot format), `SCOOP_WIKIMEDIA_UA` (Wikimedia-format with contact URL and wiki user reference per their policy), `SCOOP_BROWSER_UA` (Mozilla/5.0 compatible pattern for image/CDN endpoints).
- Keeping image extraction, OG image, and image proxy on the browser-format UA since they fetch from domains that filter bot-looking requests.

Future Codex agents should:
- Use `SCOOP_USER_AGENT` for general API calls, `SCOOP_WIKIMEDIA_UA` for Wikimedia/Wikipedia/Wikidata, and `SCOOP_BROWSER_UA` for bulk page/image fetching.
- Never add a new inline User-Agent string. Import from config instead.

## 2026-05-12 — Free enrichment pipeline for local-byline reporter profiles

Context:
- When Wikidata returned no journalist match, the system had no way to enrich the reportor profile beyond RSS byline text and local article records.
- Muck Rack required payment, LinkedIn required login, and most journalist databases were proprietary.

What worked:
- Searching Mastodon instances (journa.host with 3,019 vetted journalists, newsie.social with 20,710 accounts) and Bluesky's public API for social profile discovery. Both are free, have public APIs, and require no authentication.
- Using Wikipedia's opensearch and extract API for bio text extraction by journalist name lookup.
- Using DuckDuckGo Lite for web search fallback when structured APIs returned nothing.
- Running all three enrichments in a single `asyncio.gather` with a shared httpx client so the local-byline profile builds with no additional serial latency.

Future Codex agents should:
- Prefer free, public APIs (Mastodon, Bluesky, Wikipedia, OpenAlex) over scrapers for enrichment.
- Run independent enrichment tasks in parallel with `asyncio.gather` and `return_exceptions=True` so one failure does not block the others.
- Always close owned httpx clients in a `finally` block.

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

## 2026-04-27 — Property tests must match their generators

Context:
- Full `scripts/self-test` can expose Hypothesis counterexamples unrelated to the files being edited.
- The source URL guard normalizes `www.` away, so property tests must assert normalized hosts.
- The country mention extractor returns every valid country alias in the generated text, so arbitrary generated prefix/suffix text can add valid countries.

What worked:
- Running focused tests for changed modules first to validate refactors.
- Updating property assertions to match the real invariant instead of expecting fixed output from arbitrary generated text.
- Keeping a deterministic fixed-input test for the exact country mention output.

Future Codex agents should:
- Keep generated text strategies and exact assertions in sync.
- If arbitrary generated text may contain extra valid entities, assert inclusion, sorting, and uniqueness, then use a separate fixed-input test for exact output.
- Still run `scripts/self-test` before final handoff.

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

## 2026-05-12 — Reporter proof needs source-level quality gates

Context:
- Reporter coverage looked better before filtering because article-page extraction picked up labels like social links, section names, and organization bylines.
- Some publishers block article pages but still publish usable bylines in official RSS feeds.

What worked:
- Filtering generic author labels before scoring.
- Treating clean official RSS bylines as medium evidence when article pages return 401/403.
- Scanning a deeper feed window and stopping after five unique reporter names per source.

Future Codex agents should:
- Keep source-level reporter proof separate from article-level counts.
- Report blocked or generic feeds explicitly instead of folding them into coverage.
- Validate feed URL repairs with `backend/scripts/validate_rss_sources.py --only ...`.
