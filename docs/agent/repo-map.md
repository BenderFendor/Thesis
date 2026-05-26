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

- `backend/scripts/verify_and_promote_reporters.py`: multi-tier universal author verification. Escalates through httpx → JSON-LD → curl_cffi → RSS → Wayback → Wikidata.
- `backend/scripts/rss_verify_reporters.py`: batch RSS dc:creator verification using the Rust parser. One feed download per source, bulk promotion.
- `backend/scripts/wikidata_verify_strong.py`: Wikidata employer cross-check. Matches Wikidata P108 employer labels against RSS catalog sources.
- `backend/scripts/promote_byline_verified.py`: byline consistency promotion. Uses article observation counts as publisher-confirmed evidence.
- `backend/scripts/wayback_verify_reporters.py`: Wayback Machine cached author page discovery and verification.

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
