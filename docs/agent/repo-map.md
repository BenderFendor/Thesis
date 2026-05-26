# Repository Map

## Purpose

This map helps Codex agents orient quickly before editing.

## Top-Level Layout

- `backend/`: FastAPI app, services, scripts, and tests.
- `frontend/`: Next.js app, UI components, hooks, and tests.
- `docs/`: project docs, including `docs/agent/` operational guidance.
- `docs/documentation-maintenance.md`: README, docs, and GitHub Wiki sync workflow.
- `docs/documentation-style-guide.md`: project documentation writing rules.
- `scripts/`: repo-local Codex helper commands.
- `verify.sh`: strongest full-stack verification path.

## Backend Hotspots

- `backend/app/main.py`: FastAPI entrypoint.
- `backend/app/api/routes/`: API routes grouped by domain.
- `backend/app/services/`: business logic and orchestration.
- `backend/app/services/entity_wiki_service.py`: Wikidata/Wikipedia entity resolution and reporter scoring.
- `backend/app/services/reporter_indexer.py`: background reporter indexing, local-byline profile builder.
- `backend/app/services/reporter_web_search.py`: DuckDuckGo Lite web search enrichment.
- `backend/app/services/reporter_social_search.py`: Mastodon and Bluesky social profile search.
- `backend/app/services/reporter_wikipedia.py`: Wikipedia bio extraction and category mining.
- `backend/app/services/reporter_directory.py`: Mastodon journalist directory enumeration.
- `backend/app/data/rss_sources.json`: curated RSS catalog.
- `backend/tests/`: backend regression tests.
- `backend/scripts/validate_rss_sources.py`: RSS health validation.
- `backend/scripts/backfill_rss_ownership_labels.py`: ownership label backfill.

## Reporter Verification Pipeline

- `backend/scripts/verify_and_promote_reporters.py`: multi-tier author-page verification. Only person-level author/profile pages can move a reporter to `verified`; RSS, byline-frequency, and Wikidata-only evidence remain supporting evidence.
- `backend/scripts/rss_verify_reporters.py`: batch RSS dc:creator evidence using the Rust parser. One feed download per source, bulk supporting-evidence updates.
- `backend/scripts/wikidata_verify_strong.py`: Wikidata employer cross-check. Matches Wikidata P108 employer labels against RSS catalog sources as supporting evidence.
- `backend/scripts/promote_byline_verified.py`: byline consistency evidence. Uses article observation counts as source-level support without treating source homepages as author pages.
- `backend/scripts/wayback_verify_reporters.py`: Wayback Machine cached author page discovery and verification.
- `backend/scripts/verify_reporter_intelligence.py`: quality gates for verified author-profile citations, high-confidence profile validity, alias conflicts, and the honest 70% eligible-cohort coverage target.
- `backend/scripts/plan_reporter_source_enrichment.py`: source/reporter backlog planner. Dedupe identity keys only use real author/profile URLs, not source homepages or feeds.

## Rust RSS Parser

- `backend/rss_parser_rust/src/parser.rs`: feed parsing with universal author extraction (dc:creator, dc:author, itunes:author, media:credit, atom:author/name, atom:uri, link rel=author, multi-author splitting).
- `backend/rss_parser_rust/src/types.rs`: `ParsedArticle` with `authors` and `author_urls` fields, Python dict serialization.

## Frontend Hotspots

- `frontend/app/`: route-driven pages.
- `frontend/components/`: reusable UI and feature components.
- `frontend/lib/`: API wrappers and helpers.
- `frontend/hooks/`: query/state hooks.
- `frontend/__tests__/`: frontend tests.

## Verification Entry Points

- Preferred: `scripts/self-test`.
- Strongest path in this repo: `./verify.sh` (invoked by `scripts/self-test`).
- Orientation command: `scripts/agent-summary`.
- Triage helper: `scripts/diagnose`.

## Notes For Future Agents

- Treat `AGENTS.md` as the short map and `docs/agent/*` as detailed operational docs.
- If verification fails with reusable patterns, update `docs/agent/known-errors.md`.
- If you learn a repeatable repo-specific practice, update `docs/agent/learnings.md`.
