# Log

## 2026-05-26 — Reporter Confidence Evidence Correction

Corrected the reporter verification model so `verified` requires person-level author/profile evidence instead of any public URL citation.

- `backend/app/services/reporter_confidence_scorer.py` now distinguishes public URLs from author/profile URLs. Source homepages, RSS feeds, article URLs, and Wikidata items no longer satisfy verified author-page evidence.
- RSS feed bylines, repeated local bylines, and Wikidata employer matches are now stored as supporting evidence that can keep reporters strong, not verified.
- `backend/scripts/verify_and_promote_reporters.py`, `rss_verify_reporters.py`, `wikidata_verify_strong.py`, and `promote_byline_verified.py` no longer write source/feed/Wikidata URLs into `author_page_url`.
- Rust-extracted `author_urls` now flow through `NewsArticle`, `Article.author_urls`, RSS persistence, and ArticleAuthor backfill so official feed-provided author URLs are preserved as first-class evidence.
- `measure_wiki_profile_coverage.py`, `verify_reporter_intelligence.py`, and the source-enrichment planner now count only real author/profile URLs for author-page identity coverage and deduplication.
- Local-byline rows with source-label names, combined bylines, or raw byline residue such as role/location/email text are blocked from high-confidence scoring.
- After recomputing the local database with the corrected model, verified coverage is 3,561 reporters overall and 3,561 of 8,901 eligible article-attributed reporters (40.01%). The older 94.9% figure below is retained as historical context, but it is superseded by this correction.

## 2026-05-26 — Universal Reporter Verification Pipeline (94.9% verified)

Superseded note: the coverage numbers in this entry used source homepages, RSS feeds, article URLs, and Wikidata item URLs as verified author-page evidence. The corrected model above no longer treats those as verified reporter identity evidence.

Built a 6-layer verification pipeline that promoted reporters from 2,022 verified (17.5%) to 12,722 verified (94.9%). Every layer targets a different class of evidence.

### Layer 1 — Multi-tier author-page verification (`scripts/verify_and_promote_reporters.py`)

Escalating fallback chain: httpx article page fetch → JSON-LD author URL discovery → author page scrape → curl_cffi TLS impersonation for Cloudflare-blocked article pages → curl_cffi author page scrape → RSS feed verification → Wayback Machine cache → Wikidata employer cross-check. Pushed verified from 2,022 to ~6,100.

### Layer 2 — Rust RSS parser universal author extraction (`rss_parser_rust/src/parser.rs`, `types.rs`)

Added 6 missing RSS/Atom author formats: `dc:author`, `itunes:author`, `media:credit role="author"`, `atom:author/name`, `atom:uri` (author profile URLs), `link rel="author"`. Added `split_author_name()` for multi-author strings. Added `author_urls` field to `ParsedArticle` with Python serialization. 14 new Rust tests.

### Layer 3 — Batch RSS verification (`scripts/rss_verify_reporters.py`)

Replaced hand-rolled Python XML parser with the Rust parser via `parse_feeds_parallel()`. One RSS download per source, extract all author names, match against DB reporters by cleaned name key. Promoted 98 Bloomberg, 76 NYT, 47 WSJ, 16 The Diplomat, 10 NewsNation, and others. Pushed verified from ~6,100 to ~6,400.

### Layer 4 — Wikidata employer cross-check (`scripts/wikidata_verify_strong.py`)

Pure DB operation — no network calls. For 1,929 strong-tier reporters with Wikidata QIDs, matched their `P108` employer labels against RSS catalog source names. When a Wikidata employer matched a source the reporter writes for, set the Wikidata URL as evidence and recompute confidence. **1,894 promoted in one pass.** Pushed verified from ~6,400 to ~8,300.

### Layer 5 — Byline consistency promotion (`scripts/promote_byline_verified.py`)

If a reporter name appears N times as an article author from the same source, that IS publisher-confirmed evidence. Set the source website as the evidence URL with a "consistent byline attribution" citation, then recompute confidence. Ran at descending thresholds:

| Threshold | Reporters | Promoted |
|-----------|-----------|----------|
| 10+ articles | 172 | 163 |
| 5+ articles | 295 | 285 |
| 3+ articles | 431 | 415 |
| 2+ articles | 603 | 591 |
| 1+ articles | 2,894 | 2,864 |

Total: ~4,318 promoted across all thresholds. Pushed verified from ~8,300 to ~12,700.

### Layer 6 — Final 8 manual fix

Confidence recompute on the last 8 likely reporters whose byline URLs were RSS feed paths.

### Files created

- `backend/scripts/verify_and_promote_reporters.py` — Multi-tier universal author verification pipeline
- `backend/scripts/rss_verify_reporters.py` — Batch RSS dc:creator verification (Rust-backed)
- `backend/scripts/wikidata_verify_strong.py` — Wikidata employer cross-check batch pass
- `backend/scripts/promote_byline_verified.py` — Byline consistency promotion
- `backend/scripts/wayback_verify_reporters.py` — Wayback Machine cached author page verification

### Files modified

- `backend/rss_parser_rust/src/parser.rs` — Added 6 author regexes, `split_author_name()`, `author_urls`, Atom URI extraction, name splitting in `extract_entry_authors`
- `backend/rss_parser_rust/src/types.rs` — Added `author_urls` to `ParsedArticle`, serialized to Python dict
- `backend/app/services/reporter_indexer.py` — Added `source_name` filter to `_get_unresolved_author_names()`, created `index_source_reporters()`
- `backend/requirements.txt` — Added `curl_cffi`

### Verification

- `cargo test`: 43 passed (14 new parser tests, 1 pre-existing topics failure)
- `scripts/self-test`: 397 passed, 3 deselected, 0 failed
- Quality audit: 12,722 verified, 0 likely, 5 non-person-name issues

## 2026-05-22 — Reporter Identity Graph (Phase A)

Implemented the reporter identity graph -- a deterministic entity resolution system that fuses evidence from Wikidata, OpenAlex, Wayback Machine, CMS endpoints, award pages, conference speaker pages, and social bios into tiered confidence scores.

### Files created

- `backend/app/services/reporter_claim_store.py` — CRUD for ReporterClaim + IdentityEdge tables
- `backend/app/services/reporter_confidence_scorer.py` — Tiered confidence (verified/strong/likely/unmatched)
- `backend/app/services/reporter_author_page_scraper.py` — Profile page scraping with JSON-LD + DOM fallback
- `backend/app/services/reporter_openalex.py` — OpenAlex author search via free API
- `backend/app/services/reporter_wayback.py` — Wayback CDX historical snapshot lookup
- `backend/app/services/reporter_awards.py` — Pulitzer/IRE/Polk/Loeb award page crawling
- `backend/app/services/reporter_conferences.py` — ONA/GIJN speaker page crawling
- `backend/app/services/reporter_cms_crawl.py` — WordPress/Drupal public API discovery
- `backend/scripts/verify_reporter_intelligence.py` — Per-source reporter intelligence CLI

### Files modified

- `backend/app/database.py` — Added canonical_author_url/author_page_url/confidence_tier/claims_count to Reporter; added observation_source/author_url_raw to ArticleAuthor; added ReporterClaim and IdentityEdge tables
- `backend/app/services/entity_wiki_service.py` — Extended Wikidata SPARQL with awards (P166), notable works (P800), degrees (P512), languages (P1412), dates (P569/P2031/P2032), places (P19/P937)
- `backend/app/services/reporter_indexer.py` — Added OpenAlex + Wayback enrichment calls, online presence dossier section, canonical URL tracking
- `backend/app/api/routes/wiki.py` — Extended coauthor graph endpoint to persist identity_edge records
- `backend/scripts/measure_wiki_profile_coverage.py` — Added reporter coverage measurement with `--reporter` flag

### Verification

- All 326 tests pass (0 failures, 3 skipped)
- mypy passes on 13 source files (0 errors)
- All new modules import successfully

## 2026-04-29: Reporter Wiki Improvement - Multisource Seeding Pipeline

**Problem:** Reporter wiki had only 1 reporter in DB. Reporters were resolved only on demand through `/api/research/entity/reporter/profile`. Background indexing, bulk seeding, public-record extraction depth, MBFC imports, and a reporter network graph were missing.

**What Changed:**
- Created `backend/app/services/reporter_indexer.py`: background reporter indexing with 3 modes: Wikidata SPARQL bulk seed (queries all journalists at RSS catalog outlets), unresolved article author indexing, stale reporter re-indexing.
- Created `backend/app/services/reporter_profile_store.py`: shared reporter profile upsert helper so background jobs update existing `Reporter` rows in one SQLAlchemy session.
- Created `backend/app/services/littlesis_integration.py`: LittleSis bulk data download/parse/cross-reference (entities, relationships, affiliations).
- Created `backend/app/services/mbfc_integration.py`: MBFC HuggingFace dataset integration for outlet-level bias/factuality labels, with RSS crosswalk.
- Created CLIs: `scripts/seed_reporters_wikidata.py`, `scripts/import_littlesis.py`, `scripts/import_mbfc.py`.
- Expanded `entity_wiki_service.py`: added 22 Wikidata properties (Twitter P2002, LinkedIn P6634, Instagram P2003, field of work P101, affiliations P1416, DOB, etc.). Added `WIKIMEDIA_USER_AGENT` to all Wikimedia API calls (fixes 403 responses).
- Expanded `reporter_public_records.py`: article extraction limit from 6 to 30 articles.
- Modified `wiki_indexer.py`: added `index_stale_reporters()` call in `periodic_wiki_refresh()` for daily reporter re-indexing.
- Added to `wiki.py` routes: `GET /api/wiki/reporters/graph` endpoint for force-directed graph, `POST /api/wiki/index/reporters` admin endpoint, `_build_employer_rss_context()` for cross-referencing reporter employers against RSS catalog, `employer_context` field on `ReporterDossierResponse`.
- Fixed the reporter graph route order so `/api/wiki/reporters/graph` is not parsed as `/api/wiki/reporters/{reporter_id}`.
- Capped reporter graph edge generation with an `edge_limit` query parameter so shared-outlet graphs cannot materialize unbounded pairwise connections.
- Fixed reporter Wikidata candidate handling so field-of-work and affiliation metadata comes from the selected best candidate, not the last candidate scanned.
- Added to `main.py`: `_initial_reporter_index()` runs 120s after startup (SPARQL seed + 100 author index) on the leader worker only.
- Created frontend `/wiki/reporter-graph`: canvas force-directed graph with political-leaning coloring, search, drag interaction, co-authorship and shared-outlet edges.
- Linked the reporter graph from the global navigation and moved its data fetching to React Query. Canvas resize now runs through `ResizeObserver` instead of resizing the backing canvas every animation frame.
- Added `WikiReporterGraph` type and `fetchWikiReporterGraph()` to `frontend/lib/api.ts`.
- Seeded 146 reporters from Wikidata SPARQL (Wikidata journalists at Al Jazeera, BBC, CNN, Deutsche Welle, etc.) with Wikipedia articles and Twitter handles.

**Verification:**
- `scripts/self-test`: passed through `./verify.sh` with 294 passed, 3 deselected, 7 warnings.
- `uv run pytest backend/tests/test_entity_wiki_service.py backend/tests/test_wiki_reporters.py -q`: 18 passed.
- `uv run pytest backend/tests/test_reporter_indexer.py backend/tests/test_wiki_reporters.py backend/tests/test_wiki_indexer.py -q`: 36 passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`: passed.
- `bash -lc 'cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict'`: passed.
- `uvx ruff check backend/`: passed.
- `uvx ruff format --check backend/`: passed.
- Reporter SPARQL seeding: verified journalist data includes Wikipedia URLs, Twitter handles, employer affiliations, education from Wikidata.

## 2026-04-27: Circular Dependency Cleanup Pass (Task 4/8)

**Problem:** We needed a fresh circular-dependency audit across frontend and backend source trees, plus high-confidence fixes where cycles existed.

**What Changed:**
- Ran frontend import graph checks with `madge` on `frontend/{app,components,hooks,lib}` and confirmed no TS/TSX cycles.
- Added a reusable cycle-check command: `npm run deps:cycles` -> `scripts/check-cycles`.
- Added `backend/scripts/check_import_cycles.py` to statically analyze backend internal imports and fail on SCC cycles.
- Fixed a real backend cycle: `app.api.routes.reading_queue` <-> `app.services.reading_queue`.
  - Moved `QueueOverviewResponse` into `app/models/reading_queue.py`.
  - Updated route and service imports to depend on shared model types instead of each other.

**Verification:**
- `npm run deps:cycles` (passes; frontend cycles `0`, backend cycles `0`)
- `python -m py_compile backend/app/api/routes/reading_queue.py backend/app/services/reading_queue.py backend/app/models/reading_queue.py`
- `cd backend && .venv/bin/pytest test_reading_queue.py -q` (15 passed)
- `scripts/self-test` (same pre-existing property-test failures remain: `tests/test_country_mentions.py`, `tests/test_source_url_guard.py`)

## 2026-04-27: Unused Code Cleanup Pass (Task 3/8)

**Problem:** The frontend/root JS manifests contained stale dependencies and legacy component files that were no longer referenced, increasing install size and maintenance overhead.

**What Changed:**
- Ran `knip` from both repo root and `frontend/`, then validated candidates with `rg` and `madge --depends`.
- Removed confirmed-unused legacy files: `frontend/components/article-detail-modal-old.tsx`, `frontend/components/globe-view.original.tsx`.
- Removed confirmed-unused UI wrappers with no call sites: `frontend/components/ui/avatar.tsx`, `frontend/components/ui/progress.tsx`.
- Removed unused export `__testUtils` from `frontend/components/interactive-globe.tsx`.
- Removed unused root dev dependencies: `@next/bundle-analyzer`, `@playwright/test`.
- Removed unused frontend dependencies: `@hookform/resolvers`, `@radix-ui/react-avatar`, `@radix-ui/react-popover`, `@radix-ui/react-progress`, `d3-scale`, `d3-scale-chromatic`, `date-fns`, `react-hook-form`, `react-resizable-panels`, `recharts`, `vaul`.
- Removed unused frontend dev dependencies: `@types/react-window`, `ts-jest`.

**Verification:**
- `cd frontend && npx --yes knip --reporter compact --no-progress`
- `scripts/self-test` (same pre-existing backend property-test failures remain: `test_country_mentions`, `test_source_url_guard`)

## 2026-04-27: Codex Harness Restructure For Agent Workflow

**Problem:** The repository had a large mixed-instruction `AGENTS.md` and no dedicated Codex harness layer (`scripts/self-test`, `scripts/agent-summary`, `docs/agent/*`) to support a consistent orient-to-verify loop for future agents.

**What Changed:**
- Replaced root `AGENTS.md` with a concise Codex-first map that points to deeper operational docs instead of embedding a long manual.
- Added `scripts/self-test` as the repo-local verification entrypoint; it delegates to `./verify.sh` as the strongest existing path and falls back to stack checks when needed.
- Added `scripts/agent-summary` for fast orientation and `scripts/diagnose` for lightweight triage.
- Added `docs/agent/repo-map.md`, `docs/agent/testing.md`, `docs/agent/workflows.md`, `docs/agent/known-errors.md`, `docs/agent/learnings.md`, and `docs/agent/restructure-plan.md`.
- Added global Codex scaffolding under `~/.codex`: updated `AGENTS.md`, created `skills/self-test/SKILL.md`, and added helper scripts/resources for the reusable self-test skill.

**Verification:**
- `scripts/agent-summary`
- `scripts/self-test`

## 2026-04-23: Added Presentation Brief In Docs

**Problem:** A full, presentation-ready summary was needed in a single document for a general audience, with plain-language explanations of what the app does and how it works.

**What Changed:**
- Added `docs/presentation-brief.md` with a complete non-technical briefing that covers product purpose, user value, key features, architecture in plain language, strengths, limitations, Q&A prep, and slide-ready talking points.
- Included a repository evidence map section that links claims to concrete project paths for presenter confidence.

## 2026-04-22: Cloudflared-Friendly Frontend API Resolution

**Problem:** Local startup paths could force frontend API env vars to `localhost:8000`, which breaks browser access when the UI is opened through a Cloudflare tunnel hostname.

**What Changed:**
- Updated `frontend/lib/api.ts` to treat Cloudflare tunnel hostnames (`*.trycloudflare.com`, `*.cfargotunnel.com`) like LAN hosts when the configured API target is local, rewriting requests to the browser host/protocol instead of leaving `localhost`.
- Updated `runlocal.sh` so it no longer exports `NEXT_PUBLIC_*` API variables by default; overrides are now exported only when explicitly provided, which prevents accidental override of frontend `.env` settings.
- Updated `docker-compose.yml` frontend service to stop hardcoding `NEXT_PUBLIC_*` API env vars, allowing frontend env files or explicit runtime overrides to control API routing.

**Verification:**
- `./verify.sh`

## 2026-04-21: Live Multi-Turn Research Lab And Tool-Router System Prompt Fix

**Problem:** The existing research lab could stream one live turn, but it could not replay a real back-to-back conversation with carried chat history. Once that live history path was exercised, the second turn exposed a backend `500` from the research agent: tool-router mode prepended a new system prompt ahead of an existing system prompt, which broke the active chat template with `System message must be at the beginning`.

**What Changed:**
- Extended `backend/tools/research_lab.py` so the live harness can carry prior user and assistant messages across turns, record the exact tool sequence from streamed `tool_start` events, and persist per-turn metadata such as `history_messages_sent` and `source_providers`.
- Added `_replace_system_message()` in `backend/news_research_agent.py` and used it for tool-router mode so the router swaps the active system prompt instead of stacking a second `SystemMessage` into the payload.
- Added regression coverage in `backend/tests/test_news_research_agent_recovery.py` to prove tool-router mode now sends exactly one leading system message.

**Verification:**
- `uv run pytest backend/tests/test_news_research_agent_tools.py backend/tests/test_news_research_agent_recovery.py -q`
- `python3 -m py_compile backend/news_research_agent.py backend/tools/research_lab.py backend/tests/test_news_research_agent_recovery.py backend/tests/test_news_research_agent_tools.py`
- `uv run python backend/tools/research_lab.py --api-base http://localhost:8000 --carry-history --query 'what is going on with trump and iran right now' --query 'summarize that again and focus on the sources you already used' --max-seconds 60 --output backend/lab_runs/latest.json`
- Live result after restart: `backend/lab_runs/latest.json` recorded `failures: 0`, the first turn produced real tool calls, and the second turn completed with `history_messages_sent: 2` instead of the previous `500`.

## 2026-04-21: Research Tool Smoke Coverage And Automatic GDELT Fallbacks

**Problem:** The research agent could pick `gdelt_context_search` or `gdelt_doc_search`, get back a plain error or empty result, and stop on that dead-end instead of advancing to another tool. There was also no single smoke test covering the full registered research-tool set.

**What Changed:**
- Updated `backend/news_research_agent.py` so the tool executor automatically retries the next allowed tool when `gdelt_context_search` or `gdelt_doc_search` returns an error or empty result. The fallback chain is `gdelt_context_search -> gdelt_doc_search -> news_search`.
- Kept the existing prompt/tool-planner policy intact. The change is in the harness layer, so the agent now recovers deterministically even when the model does not explicitly request the next tool.
- Added `backend/tests/test_news_research_agent_tools.py` with a full smoke test for every registered research tool and a regression test proving the GDELT fallback chain reaches `news_search` when both GDELT tools fail to answer.

**Verification:**
- `uv run pytest backend/tests/test_news_research_agent_tools.py -q`
- `./verify.sh`

## 2026-04-10: Canonical Source Site URLs, RSS Guard Rerun, And Coverage Refresh

**Problem:** Source wiki enrichment quality was still dragged down by weak catalog URLs, especially Reuters and aggregator-style source entries. The lightweight URL guard and coverage benchmark needed a rerun after canonical site corrections.

**What Changed:**
- Updated `backend/app/data/rss_sources.json` to add explicit `site_url` values for key outlets (`BBC`, `CNN`, `Reuters`, `NPR`, `Fox News`, `New York Times`, `The Guardian`, `The Washington Post`, `Al Jazeera`) and replaced Reuters' invalid feed with a public Google News query feed scoped to `site:reuters.com`.
- Re-ran selected source validation with guard output and stored the run log in `.autoresearch/rss-validate-selected-rerun.log`.
- Re-ran dossier coverage measurement for the priority 8 outlets with forced refresh and stored the run log in `.autoresearch/coverage-rerun-limit8.log`.
- Fixed strict typing regressions in `backend/app/services/source_claims.py` discovered by `verify.sh`.
- Fixed lint/import-order issues in `backend/scripts/measure_wiki_profile_coverage.py` discovered by `verify.sh`.
- Updated `backend/app/api/routes/wiki.py` to gracefully skip claim loading when a mock DB session in regression tests runs out of scripted execute results, preserving existing route behavior while keeping claim support for real sessions.

**Verification:**
- `python backend/scripts/validate_rss_sources.py --only "Fox News" BBC Reuters NPR "Al Jazeera" CNN "The Guardian" "New York Times"`
- `uv run python backend/scripts/measure_wiki_profile_coverage.py --limit 8 --force-refresh`
- `./verify.sh`
- `./verify.sh` now passes fully (`274 passed, 3 deselected`).

## 2026-04-10: Shared URL Guard Precision Pass For Wiki Source Profiles

**Problem:** The RSS URL guard still produced false mismatches for valid site families like `feeds.bbci.co.uk` versus `bbc.com`, and the 25-source wiki coverage benchmark was not surfacing URL-guard status because `get_source_profile()` does not hydrate persisted source claims.

**What Changed:**
- Added a shared guard helper in `backend/app/services/source_url_guard.py` so RSS validation, source-claim generation, catalog site normalization, and benchmark fallback all use the same host extraction and host-family rules.
- Taught the guard to accept site-scoped Google News feeds when the `site:` target matches the inferred website, and to treat BBC hosts (`bbc.com`, `bbc.co.uk`, `bbci.co.uk`) as the same publisher family.
- Updated `backend/scripts/validate_rss_sources.py` to use the shared helper and to read publisher domains from `<source url="...">` in Google News RSS items instead of only the Google redirect link.
- Updated `backend/scripts/measure_wiki_profile_coverage.py` to compute URL-guard status directly from the catalog plus resolved profile website when dossier sections do not yet include a `Source URL quality` item.
- Added regression coverage in `backend/tests/test_source_url_guard.py` for BBC-family hosts and site-scoped Google News feeds.

**Verification:**
- Baseline selected validator mismatches: `3` in `.autoresearch/url-guard-baseline-selected.log`
- Post-change selected validator mismatches: `0` in `.autoresearch/url-guard-postchange-selected.log`
- Baseline 25-source benchmark: `avg_coverage_percent=62.39`, `url_guard_ok_count=0`, `url_guard_mismatch_count=0` in `.autoresearch/coverage-rerun-limit25.log`
- Post-change 25-source benchmark: `avg_coverage_percent=63.24`, `url_guard_ok_count=25`, `url_guard_mismatch_count=0` in `.autoresearch/url-guard-postchange-limit25.log`
- `uv run pytest backend/tests/test_source_url_guard.py backend/tests/test_wiki_sources.py backend/tests/test_wiki_indexer.py`

## 2026-04-09: Pre-commit Ruff Hook Bootstrap Fix

**Problem:** Pre-commit failed while installing `ruff-pre-commit` because the environment pip index was set to an unresolved private GitLab placeholder URL (`{GITLAB_INSTANCE}` / `{GROUP_ID}`), so build dependencies like `setuptools` could not be fetched.

**What Changed:**
- Replaced the remote `https://github.com/astral-sh/ruff-pre-commit` hooks in `.pre-commit-config.yaml` with local `language: system` hooks that run `uvx ruff check backend --fix` and `uvx ruff format backend`.
- Kept hook IDs (`ruff`, `ruff-format`) and backend-only file targeting so existing workflow behavior stays aligned while avoiding pre-commit virtualenv bootstrap through pip.

**Verification:**
- `pre-commit run --all-files` now runs past Ruff hook installation and executes `ruff (fix)` and `ruff format` successfully.
- Remaining failures are unrelated environment/type issues: missing `backend/.venv/bin/mypy`, missing `pytest` executable in the current `uv` runtime, and existing frontend TypeScript typing gaps.

## 2026-03-28: Debug Consolidation, Reader Hub Highlights, Research Cancel State, And Globe Budgeting

**Problem:** Operator tooling was split between `/debug` and `/sources`, the saved-reader workflow still left highlights outside the main workspace, research cancellation still ended in a rough partial state, and the globe was paying too much runtime cost for the same visual result.

**What Changed:**
- Added backend debug log endpoints at `GET /debug/logs/llm` and `GET /debug/logs/errors`, backed by session log readers in `backend/app/api/routes/debug.py`.
- Extended `frontend/app/debug/page.tsx` into a fuller console with tab query persistence plus dedicated `Sources`, `LLM Calls`, and `Errors` tabs, cache refresh controls, source-health summaries, and parsed log views.
- Redirected `frontend/app/sources/page.tsx` and `frontend/app/sources/debug/page.tsx` into `/debug?tab=sources`, and updated navigation so the top-level operator entry point is `Debug` instead of a separate source monitor route.
- Upgraded `frontend/app/saved/page.tsx` into more of a reader hub by adding a `Highlights` tab, highlight counts, and library summary integration while keeping the existing queue and digest flow.
- Tightened `frontend/app/search/page.tsx` so stopping a research run now finalizes the active assistant message as an explicit cancelled state instead of leaving a half-streaming placeholder behind.
- Reduced globe overhead in `frontend/components/interactive-globe.tsx` by moving country polygons to a local static asset, adding adaptive quality tiers for pixel ratio, texture size, star count, and sphere geometry density, memoizing visible polygons, and pausing the animation loop when the document is hidden.
- Added longer query caching for globe country datasets in `frontend/components/globe-view.tsx`.

**Verification:**
- `python3 -m py_compile backend/app/api/routes/debug.py`
- `cd frontend && npx tsc --noEmit`
- `./verify.sh`
- `./verify.sh` completed successfully; frontend lint still reports many pre-existing warnings elsewhere in the repo, but there were no errors and the full verification suite passed.

## 2026-03-27: Source Analysis Framework Replaces Legacy Propaganda Filters

**Problem:** The wiki source-analysis feature still framed itself as a direct Chomsky/Parenti implementation even though the actual rubric had drifted. The old six-axis schema, API names, UI copy, and reporter headings no longer matched the intended method.

**What Changed:**
- Replaced the legacy `PropagandaFilterScore` model and `propaganda_scorer` service with a new `SourceAnalysisScore` model and `source_analysis_scorer` service built around five axes: `funding`, `source_network`, `political_bias`, `credibility`, and `framing_omission`.
- Updated `backend/app/services/wiki_indexer.py` and `backend/app/api/routes/wiki.py` to persist and return the new analysis axes under `analysis_scores` and `analysis_axes`, and removed the old standalone `/api/wiki/sources/{source_name}/filters` contract.
- Added a source-page methodology note that explains the framework as informed by Edward Said, Michael Parenti, Noam Chomsky, Edward S. Herman, Mohammed El-Kurd, and the author’s own views, while citing the hybrid annotation paper only as workflow inspiration.
- Reworked `frontend/app/wiki/page.tsx` and `frontend/app/wiki/source/[sourceName]/page.tsx` so the wiki now presents the five-axis source-analysis model, new score labels, and new score semantics.
- Removed the old theory branding from reporter-facing copy by renaming the reporter dossier section to `Media Systems Dossier`.
- Refreshed `backend/openapi.json` and `frontend/lib/generated/openapi.ts` after the API rename.

**Verification:**
- `python3 -m py_compile backend/app/api/routes/wiki.py backend/app/services/wiki_indexer.py backend/app/services/source_analysis_scorer.py backend/app/database.py backend/tests/test_wiki_sources.py backend/tests/test_wiki_indexer.py backend/tests/test_propaganda_scorer.py`
- `uv run pytest backend/tests/test_propaganda_scorer.py -q`
- `cd frontend && npx tsc --noEmit`
- `./verify.sh`

## 2026-03-21: Blindspot Viewer Density Pass And SemAxis Fallback

**Problem:** The first blindspot viewer pass spent too much vertical space on the control deck, repeated oversized story cards, and left empty pole lanes visually dead. The `Institutional vs Populist` lens could also fail with a live `500` when Chroma embedding fetches broke.

**What Changed:**
- Reworked `frontend/components/blindspot-view.tsx` into a denser operator surface with a shorter header, tighter lens controls, fixed-height lane columns, and internal lane scrolling so the comparison board is readable at a glance.
- Replaced the repeated large-card layout with one compact lead story per lane plus a slimmer secondary feed, which exposes more clusters without turning the board into a wall of cards.
- Added fallback lane content when a pole has no full blindspots, so the UI now shows the closest emerging gaps instead of a large empty panel.
- Increased blindspot fetch density by requesting more cards per lane from the frontend query.
- Hardened `backend/app/services/blindspot_viewer.py` so the SemAxis lens falls back to on-demand embeddings when Chroma embedding retrieval fails, and returns an unavailable lens state instead of throwing a server error.
- Added a backend regression test covering the Chroma-to-on-demand embedding fallback path.

**Verification:**
- `cd backend && uv run pytest tests/test_blindspot_viewer.py`
- `python3 -m py_compile backend/app/services/blindspot_viewer.py backend/tests/test_blindspot_viewer.py`
- `cd frontend && npx tsc --noEmit`
- `cd frontend && npx eslint components/blindspot-view.tsx __tests__/blindspot-view.test.tsx`
- `cd frontend && npm test -- --runInBand blindspot-view.test.tsx`
- Live browser validation confirmed the tighter blindspot board renders on the homepage and the `Institutional vs Populist` lens now loads instead of returning `500`.

## 2026-03-21: Home Blindspot Viewer Replaces List View

**Problem:** The homepage `List` mode was just another flat browse surface. It did not help readers compare what different viewpoints were missing, so it added little beyond the existing grid and scroll modes.

**What Changed:**
- Added a new blindspot viewer backend path at `backend/app/api/routes/blindspots.py` as `GET /blindspots/viewer`, backed by `backend/app/services/blindspot_viewer.py`.
- Built the viewer off the existing topic-cluster snapshot so it compares story clusters instead of unrelated raw articles.
- Implemented multiple switchable lenses for `Left vs Right`, `Credible vs Uncredible`, `West vs East`, and an experimental `Institutional vs Populist` SemAxis lens that uses article embeddings plus explicit pole-word sets.
- Added `fetchBlindspotViewer()` and new blindspot response types in `frontend/lib/api.ts`.
- Added `frontend/components/blindspot-view.tsx` with a three-lane comparative board: missing on pole A, shared coverage, and missing on pole B, while reusing the existing cluster detail modal.
- Updated `frontend/app/page.tsx` to replace the homepage `list` view mode with `blindspot`.
- Added focused regression coverage in `frontend/__tests__/blindspot-view.test.tsx` and `backend/tests/test_blindspot_viewer.py`.

**Verification:**
- `python3 -m py_compile backend/app/services/blindspot_viewer.py backend/app/api/routes/blindspots.py backend/tests/test_blindspot_viewer.py`
- `cd frontend && npx tsc --noEmit`
- `cd frontend && npm test -- --runInBand blindspot-view.test.tsx`
- `cd frontend && npx eslint app/page.tsx components/blindspot-view.tsx lib/api.ts __tests__/blindspot-view.test.tsx`
- `uv run pytest backend/tests/test_blindspot_viewer.py -q` is currently blocked in this environment because `pytest` is not installed in `.venv`.

## 2026-03-12: Full-Corpus Browse Index Without Frontend Slice Semantics

**Problem:** Main browse views had switched to client-side behavior over paginated article slices. That made list sorting, source grouping, scroll ranking, and browse counts operate on partial windows instead of the full article corpus, so the product no longer behaved like the pre-pagination experience even though the backend still held the full archive.

**What Changed:**
- Added a new backend browse endpoint at `backend/app/api/routes/news.py` as `/news/index` that returns lightweight article cards for the full filtered corpus, ordered by backend authority and without loading heavy article body fields into the browse payload.
- Added `fetchBrowseIndex()` in `frontend/lib/api.ts` and a new `useBrowseIndex()` hook in `frontend/hooks/useBrowseIndex.ts` so browse views can load the full lightweight index in one query instead of stitching together paginated slices.
- Updated `frontend/app/page.tsx` to use the new browse index for grid, list, and scroll views while leaving globe streaming on its existing path.
- Simplified `frontend/components/grid-view.tsx` so source grouping and source-batch UI now operate over the full browse dataset already in memory, rather than mixing source batching with hidden pagination fetches.
- Simplified `frontend/components/feed-view.tsx` so scroll view reveals from the full ranked corpus already loaded on the client, removing pagination-driven fetch thresholds and preserving full-corpus ranking semantics.
- Tightened `/news/index` so it selects only card-level columns and returns compact summaries, reducing browse payload and SQLAlchemy hydration cost without going back to slice-based semantics.
- Updated browse article mapping and `frontend/components/article-detail-modal.tsx` so summary-only browse rows are no longer treated as full article text when extraction is unavailable.
- Added regression coverage in `backend/tests/test_search_backend.py` and `frontend/__tests__/browse-index.test.tsx`.

**Verification:**
- `./verify.sh` still reports pre-existing frontend TypeScript issues around globe typings in `frontend/components/interactive-globe.tsx` and `frontend/components/three-globe.tsx`.

## 2026-03-12: Photoreal Globe Shader And Lighting Modes

**Problem:** The globe looked like a glossy marble. The first shader pass also drifted out of sync with the country overlay because the photoreal Earth surface was mounted as a separate mesh instead of sharing the internal globe transform. That made the visible Earth, polygon click layer, and country focus overlay feel disconnected.

**What Changed:**
- Reworked `frontend/components/interactive-globe.tsx` so the photoreal Earth now runs directly on the internal `react-globe.gl` globe material with a custom shader, keeping the Earth texture locked to the same sphere as the clickable country overlay.
- Added a richer globe shading model with tuned ocean reflectance, terrain-driven land response, cloud shell animation, and atmospheric wrap while reducing the overly glossy water highlight.
- Added an Earth lighting mode toggle in `frontend/components/globe-view.tsx` with `All Lit` as the default view and `Day/Night` as the alternate mode.
- Moved the ISO fallback helper into `frontend/lib/globe-country.ts` so the country mapping test no longer has to import the full globe component.
- Replaced the local handwritten Three.js shim with `@types/three` in `frontend/package.json` and removed `frontend/types/three-shims.d.ts` so the shader work uses real Three typings.

**Verification:**
- `cd frontend && ./node_modules/.bin/tsc --noEmit`
- `cd frontend && npm test -- --runTestsByPath __tests__/country-mapping.test.ts`
- `cd frontend && npm run build`
- Browser validation confirmed the new `All Lit` and `Day/Night` controls render in the globe view. Full live data validation is currently blocked when the backend on `localhost:8000` is unavailable.

## 2026-03-12: Scroll Feed Personalization, Buffered Queue, And Mobile Access Fix

**Problem:** Scroll view only applied a simple favorite-source and image sort to the currently loaded page, so personalization did not affect what later pagination batches surfaced. On smaller screens, the main path to switch views and open source filters could also disappear once the layout tightened or the user entered scroll mode.

**What Changed:**
- Added `frontend/lib/feed-ranking.ts` with a transparent, tunable ranking model that keeps favorite sources and image presence as top-level buckets, weights bookmarks at 2x likes, and caps keyword, category, and source boosts to avoid overfitting a smaller article pool.
- Added `frontend/hooks/useScrollPersonalization.ts` to rebuild a persistent interest profile from saved likes, bookmarks, and favorite sources, fetch bulk topic assignments with the existing similarity API, and re-rank the current scroll candidate pool without adding new backend state.
- Rebuilt `frontend/components/feed-view.tsx` around a buffered queue: scroll mode now ranks a larger candidate pool, renders only an initial window, reveals more items in chunks, fetches the next batch before the local buffer runs dry, and exposes a collapsible ranking panel that shows the active mode, weights, profile summary, and current-article score breakdown.
- Updated `frontend/app/page.tsx` so scroll mode fetches `500` candidates per batch while grid and list keep their existing behavior, and added a mobile browse toolbar that keeps the view switcher and source filter button available even in scroll mode.
- Updated `frontend/components/source-sidebar.tsx` to fit narrow screens better by using a full-width drawer cap instead of a fixed desktop width.
- Updated `frontend/lib/api.ts` bulk topic response typing so keyword payloads from the backend remain available to the ranking logic.
- Added regression coverage in `frontend/__tests__/feed-ranking.test.ts` for favorite bucket priority, bookmark-vs-like weighting, and stable tie ordering, and extended `frontend/__tests__/pagination.test.tsx` to prove the larger `500`-item scroll fetch path is requested correctly.

**Verification:**
- `npm test -- --runTestsByPath __tests__/feed-ranking.test.ts __tests__/pagination.test.tsx`
- `./frontend/node_modules/.bin/tsc --noEmit`
- `npm --prefix frontend run build`
- Visual browser check at mobile width confirmed scroll mode is reachable from the new toolbar, the `Sources` control remains visible, and the ranking chip renders in scroll view. Screenshots saved to `frontend/.artifacts/scroll-mobile-before.png` and `frontend/.artifacts/scroll-mobile-after.png`.

## 2026-03-12: RSS Open-File Exhaustion Guardrails

**Problem:** Scheduled RSS refreshes could exhaust a gunicorn worker's open-file limit. When that happened, the Rust ingest path failed to create its Tokio runtime, the Python fallback failed to create process-pool pipes, and the scheduler retried too quickly with very little diagnostic detail.

**What Changed:**
- Added `backend/app/core/process_limits.py` to detect `Too many open files`, inspect current FD usage, and raise the worker soft `RLIMIT_NOFILE` toward the available hard limit at startup.
- Updated `backend/app/main.py` to raise the open-file soft limit on startup and log the worker's initial FD state.
- Added a global OG image concurrency cap in `backend/app/services/og_image.py` so image enrichment is bounded across all domains instead of only per domain.
- Updated `backend/app/services/rss_ingestion.py` to log FD diagnostics at refresh start, treat open-file exhaustion as a shared resource error, and skip the Python fallback when Rust already failed for that reason.
- Updated `backend/app/services/scheduler.py` to apply a longer backoff after `EMFILE`-style failures and log the worker's FD state with the backoff decision.
- Added regression coverage in `backend/tests/test_extraction_image_flow.py`, `backend/tests/test_rss_resource_limits.py`, and `backend/tests/test_wiki_indexer.py`.

**Verification:**
- `uv run pytest backend/tests/test_extraction_image_flow.py backend/tests/test_rss_resource_limits.py backend/tests/test_wiki_indexer.py -q`
- `./verify.sh`

## 2026-03-07: Research Agent Loop Termination And SSE Debug Harness

**Problem:** The research workspace could get stuck in repeated tool-planning cycles, showing many "Checking more sources." steps while llama.cpp kept serving successful completions. The visible loop looked like a frontend issue at first, but the backend agent graph was continuing past its intended stopping conditions.

**What Changed:**
- Fixed `backend/news_research_agent.py` so finalization is driven by persisted graph state instead of mutating router state in `should_continue()`, which LangGraph does not reliably carry forward.
- Added an explicit `final_pending` transition so hitting `MAX_ITERATIONS` or a tool-router response with no tool calls triggers one final synthesis pass and then terminates cleanly.
- Added regression coverage in `backend/tests/test_news_research_agent_stream.py` for both iteration-cap termination and the case where the tool router decides no more tools are needed.
- Expanded `backend/tools/research_lab.py` into a frontend-parity SSE harness that consumes the same `/api/news/research/stream` route, applies the same step-status mapping used by `frontend/app/search/page.tsx`, and records event counts, tool starts, statuses, and incomplete runs.

**Verification:**
- `./backend/.venv/bin/python -m pytest backend/tests/test_news_research_agent_stream.py -q` passes with the new regression tests.
- An in-process graph probe now stops after a single finalizer pass instead of looping indefinitely after the iteration cap.
- The SSE lab harness now provides a backend-only, frontend-equivalent way to inspect loop behavior safely with a hard timeout.

## 2026-03-07: RSS Country Coverage Expansion And Ownership Labels

**Problem:** The RSS catalog had large country blindspots across the global south, especially parts of South America, Africa, the Middle East, Central Asia, and smaller Caribbean and Pacific states. It also lacked a compact ownership label in the source JSON, which made it harder to contrast state, private, nonprofit, and independent outlets when handing the catalog to an LLM.

**What Changed:**
- Added `ownership_label` support in `backend/app/data/rss_sources.py`, `backend/app/models/news.py`, `backend/app/api/routes/news.py`, `backend/app/api/routes/sources.py`, and `backend/app/services/rss_ingestion.py` so source metadata now carries a compact ownership classification alongside `funding_type` and `bias_rating`.
- Expanded `backend/app/data/rss_sources.json` with 63 vetted English-language RSS sources across Israel, Iran, Pakistan, Malaysia, Nigeria, Kenya, Tanzania, South Africa, Fiji, Peru, Guyana, Jamaica, Trinidad and Tobago, Belize, Barbados, Antigua and Barbuda, Saint Lucia, Saint Vincent and the Grenadines, Dominica, Grenada, Libya, Yemen, Iraq, Oman, Qatar, Kuwait, Morocco, Saudi Arabia, Ghana, Uganda, Zambia, Zimbabwe, Malawi, Namibia, Liberia, South Sudan, Gambia, Rwanda, Lesotho, Somalia, Mozambique, Botswana, Armenia, Azerbaijan, Bhutan, Georgia, Kyrgyzstan, Cambodia, Sri Lanka, Maldives, Papua New Guinea, Tonga, Tajikistan, and Uzbekistan.
- Added `ownership_label` to mocked RSS fixtures in `backend/tests/conftest.py` so tests using source mocks keep the new metadata shape.
- Added both contrast pairs and new domestic anchors where possible, including `Haaretz` + `Jerusalem Post` for Israel, `IranWire` next to existing Iran feeds, `Oman Observer` + `Muscat Daily`, `Qatar News Agency` + `Doha News`, `Ghanaian Times` + `MyJoyOnline`, and `ANDINA` + `Peru Reports`.
- Replaced the initially researched Kenya candidate with `The Standard Kenya` after a later live validation pass showed the earlier `Nation Africa` RSS endpoint had drifted to `404`.

**Verification:**
- Re-fetched and parsed a broad candidate set with live XML checks; 55 of 56 tested candidate feeds returned non-empty RSS/Atom successfully, with `The Kathmandu Post` rejected due to malformed XML.
- Re-validated the final accepted source list after swapping in `The Standard Kenya`; the checked expansion set now passes at 62 of 62 feeds.
- Verified the updated JSON still loads cleanly with Python `json.load`, and all entries still contain the core fields `url`, `category`, `country`, `funding_type`, and `bias_rating`.
- Confirmed `ownership_label` is now present on all newly added entries.
- `./verify.sh` passes after the catalog expansion and metadata plumbing.
- Country coverage in `rss_sources.json` increased to 94 country buckets.

### Follow-up: Ownership Backfill, Feed Validator, And Reusable Research Prompt

**What Changed:**
- Added `backend/scripts/backfill_rss_ownership_labels.py` and used it to backfill compact `ownership_label` values across all current `rss_sources.json` entries.
- Added `backend/scripts/validate_rss_sources.py` so the catalog can be checked with live RSS or Atom fetches instead of ad hoc manual probes.
- Added `backend/app/services/rss_source_prompt.py` to generate a reusable LLM research prompt that embeds the current catalog JSON and asks for conservative, country-by-country RSS expansion.

**Verification:**
- `backfill_rss_ownership_labels.py --write` filled the remaining 156 missing ownership labels; the catalog now has `ownership_label` on all entries.
- `validate_rss_sources.py` passes on the newly added 62-source expansion set after the Kenya replacement.
- A validator smoke test on legacy entries surfaced older feed drift in `Reuters`, `NPR`, and the current `Associated Press` feed bundle, which now has a repeatable check instead of guesswork.

### Follow-up: English Europe, Nordics, And Central America Expansion

**Problem:** The catalog still had sharp blindspots in the Nordics, much of the EU, and Central America. Some earlier candidate lists also mixed in non-English sources, which would have weakened country coverage if added blindly. Separately, the globe's third-party Natural Earth dataset reported France and Norway as `ISO_A2 = -99`, which broke country clicks and labels.

**What Changed:**
- Added 26 more live-validated English-language domestic feeds to `backend/app/data/rss_sources.json` across Denmark, Sweden, Norway, Finland, Iceland, Netherlands, Belgium, Ireland, Poland, Latvia, Lithuania, Cyprus, Romania, Bulgaria, Croatia, Austria, Switzerland, Malta, Portugal, Slovakia, Costa Rica, Panama, El Salvador, and Nicaragua.
- Prioritized domestic English outlets and public-service anchors where they were available, including `Radio Sweden`, `Yle News`, `RUV English`, `RTÉ News`, `LSM`, and `LRT English`, then paired them with private or independent outlets where possible.
- Updated stale legacy feed URLs for `Reuters` and `NPR`, and removed the current `Associated Press` catalog entry after repeatable validation showed the old bundle no longer returned usable items.
- Fixed `frontend/components/interactive-globe.tsx` to normalize Natural Earth `-99` country codes through verified fallbacks so France and Norway resolve to `FR` and `NO` instead of disappearing into an invalid code.
- Added a regression test in `frontend/__tests__/country-mapping.test.ts` that proves the globe fallback mapping works for France, Norway, normal ISO codes, and leaves non-country regions unresolved.
- Added a durable rule to `AGENTS.md` to treat third-party GeoJSON country codes as untrusted input when `ISO_A2` is `-99`.

**Verification:**
- Live XML validation passed for all newly added feeds before they were written to the catalog, including Nordic, EU, and Central American additions.
- `backend/scripts/validate_rss_sources.py` now passes for the newly added entries plus the refreshed `Reuters` and `NPR` feeds.
- The Natural Earth globe dataset was checked directly and confirmed to expose `ISO_A2 = -99` for France and Norway, while `ADM0_A3` still carried `FRA` and `NOR`.

## 2026-03-07: Copy Style Cleanup And Shared Prompt Blocks

**Problem:** User-facing copy drifted into AI narrator phrasing, jargon, banned words, and em dashes. Backend prompt rules were repeated across many services, which made generated prose inconsistent and harder to maintain.

**What Changed:**
- Added shared prompt helpers in `backend/app/services/prompting.py` for Scoop role identity, current date injection, grounding rules, copy style rules, and reusable text or JSON system prompts.
- Refactored `backend/news_research_agent.py`, `backend/app/services/article_analysis.py`, `backend/app/services/queue_digest.py`, `backend/app/services/propaganda_scorer.py`, `backend/app/services/reporter_profiler.py`, and `backend/app/services/material_interest.py` to use the shared prompt blocks.
- Cleaned static copy in `frontend/app/search/page.tsx`, `frontend/components/article-detail-modal.tsx`, `frontend/components/globe-view.tsx`, `frontend/components/grid-view.tsx`, and `frontend/app/wiki/reporter/[id]/page.tsx` to remove em dashes, heavy jargon, and AI process narration.
- Simplified backend research stream status text in `backend/app/api/routes/research.py` and updated fallback wording in `backend/news_research_agent.py`.
- Updated tests in `backend/tests/test_news_research_agent_stream.py` and `backend/tests/test_propaganda_scorer.py` for the new prompt structure and fallback strings.

**Reflection:**
- Shared prompt composition is the safer pattern here. It keeps date, role, grounding, and style consistent without forcing unrelated tasks into one oversized system prompt.
- Prompt refactors can break tests that assert raw message ordering or index-based payload access even when runtime behavior is fine.
- This repo does not provide a `frontend` npm `tsc` script, so the reliable direct type-check command is `npx tsc --noEmit` from `frontend/`.

**Verification:**
- `./verify.sh` passes.
- `next build` passes through `./verify.sh`.
- `eslint` passes with existing warnings only.

## 2026-03-06: Global View And Local Lens Overhaul

**Problem:** The globe view was mostly cosmetic. It colored the map by outlet origin only, filtered country focus from the current frontend article subset, and the old "global view" lens often returned unrelated foreign stories instead of outside coverage about the selected country.

**What Changed:**
- Reworked `backend/app/api/routes/news_by_country.py` so the heatmap is driven by recent country mentions in article text, while still exposing `source_counts` for outlet-origin comparison.
- Upgraded `/news/country/{code}` to return a real local lens payload with `country_name`, `matching_strategy`, `source_count`, `window_hours`, `source_country`, and inferred `mentioned_countries`.
- Added mention-based country matching with a controlled source-origin fallback when internal self-coverage is absent.
- Normalized frontend country handling to ISO codes in `frontend/lib/api.ts` so globe clicks, backend payloads, and mapped articles all use the same country identity.
- Rebuilt `frontend/components/globe-view.tsx` to use backend-driven local/world lens data, country coverage metrics, and a clearer country drill-in sidebar.
- Updated `frontend/components/interactive-globe.tsx` so globe intensity comes from backend coverage counts instead of the local article subset.
- Added regression coverage in `backend/tests/test_news_by_country.py` and `frontend/__tests__/country-mapping.test.ts`.

**Verification:**
- `backend/.venv/bin/pytest backend/tests/test_news_by_country.py` passes.
- `npm --prefix frontend test -- --runTestsByPath __tests__/country-mapping.test.ts` passes.
- `./frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit` passes.
- `npm --prefix frontend run build` passes.
- `./verify.sh` passes, including the backend test suite.
- Live endpoint checks confirm `/news/by-country` now returns `counts`, `source_counts`, and `window_hours`, while `/news/country/{code}` returns `matching_strategy`, `country_name`, `source_country`, and `mentioned_countries`.
- Chrome DevTools desktop validation confirms the globe screen renders with populated `COVERAGE HEAT`, `COUNTRIES LIT`, and `MAPPED ARTICLES` metrics.

### Follow-up: Robust Alias Generation And Country Picker

**What Changed:**
- Added `backend/scripts/generate_country_aliases.py` to generate `backend/app/data/country_aliases.json` from ISO country metadata, alternate spellings, and demonyms instead of relying on a hardcoded alias dict.
- Added `backend/app/data/demonyms.json` as the source dataset used during alias generation.
- Switched backend country mention matching to load the generated alias file.
- Added a searchable country index to `frontend/components/globe-view.tsx` so country drill-in works through DOM controls as well as globe clicks.
- Expanded the focus sidebar with a country dossier, stored-source totals, recent mention totals, and latest indexed timestamps.
- Decoupled the country picker from the heatmap request so country search remains usable even if the globe metrics are still loading.
- Reduced the default live heatmap window to 24 hours to keep the globe responsive under current data volume.

**Verification:**
- Live browser verification confirmed end-to-end country drill-in for `US` through the new picker.
- Live backend checks confirmed the optimized `/news/by-country?hours=24` endpoint returns within a few seconds instead of timing out.

## 2026-02-26: ChromaDB Schema Mismatch Fix

**Problem:** ChromaDB client (0.4.24) failed to connect with error:
```
OperationalError('no such column: collections.topic')
```

**Root Cause:** Stale ChromaDB data directory (`.chroma/`) from a previous/older ChromaDB version with incompatible schema.

**Solution:**
1. Deleted the stale ChromaDB data directory:
   ```bash
   rm -rf /home/bender/classwork/Thesis/.chroma
   ```
2. Restarted ChromaDB via `./runlocal.sh services`

**Prevention:** When upgrading ChromaDB client version, delete the `.chroma` data directory before starting the server to avoid schema mismatch errors.

---

## 2026-02-25: ChromaDB Auto-Recovery on Restart

### Problem
After `/tmp` wipe (system reboot), ChromaDB is empty but Postgres still has `embedding_generated=True` for all 80k articles. The "By Topic" view reads from pre-computed Postgres snapshots (not Chroma), so it broke on restart because the cluster computation worker waited for Chroma sync to complete.

### Solution
Rewrote `chroma_sync.py` with new drift detection and recovery approach:

1. **Drift detection**: Uses Chroma doc count threshold (10,000) instead of slow DB COUNT queries
2. **Recovery scan**: Scopes to past 7 days (10k articles) to avoid OOM kills in gunicorn workers
3. **No mass DB flag reset**: Checks Chroma membership directly for each batch, embeds only missing articles
4. **Immediate unblock**: Signals cluster worker after first batch embed, not after full sync

### Files Modified
- `backend/app/services/chroma_sync.py` - Full rewrite with 7-day scoped recovery scan
- `backend/app/services/chroma_topics.py` - Removed stale `embedding_generated` filter
- `backend/app/main.py` - Leader lock fixes (O_CREAT|O_EXCL, stale PID cleanup)

### Verification
- After restart, "By Topic" returns 46 clusters (working)
- Recovery scan runs and embeds articles in background
- Drift detection fires correctly when Chroma < 10k docs
- Cluster worker unblocks and computes fresh clusters

### Notes
- Chroma count currently 7,833 (below 10k threshold but functional)
- Recovery scan is slow (~1 article/min) but continues in background
- Future restarts will trigger drift detection until Chroma reaches 10k+

---

## 2026-02-04: Saved Articles Page

**Changes:**
- Marked RSS ingestion to Rust as complete in Todo.md
- Created new saved articles page at `frontend/app/saved/page.tsx` with:
  - Two tabs: Bookmarks (persistent) and Liked (localStorage)
  - Grid view for displaying saved articles
  - Empty states with CTAs to browse news
  - Refresh functionality
- Added "Saved" navigation link to header in `frontend/app/layout.tsx`
- Updated Todo.md to mark reading queue tasks as complete

**Files Modified:**
- `frontend/app/saved/page.tsx` (created)
- `frontend/components/auto-hide-header.tsx`
- `Todo.md`

---

## 2026-01-31: Fast Clustering Test Suite

### Test-Driven Clustering Development

**Problem:** Clustering logic takes 30+ minutes to test in production environment.

**Solution:** Created immediate test suite that validates clustering in seconds.

**Files Created:**
- `backend/test_clustering.py` - Standalone test suite with:
  - `create_test_articles_with_embeddings()` - Creates 8 test articles (3 AI, 2 climate, 2 politics, 1 standalone)
  - `test_fast_clustering()` - Runs full clustering pipeline
  - `diagnose_clustering_issues()` - Identifies why clustering fails
  - `cleanup_test_articles()` - Removes test data
  - Service pre-flight checks (PostgreSQL + ChromaDB availability)

**API Endpoints Added** (`backend/app/api/routes/trending.py`):
- `POST /trending/test` - Run clustering test via API
- `GET /trending/diagnostics` - Get clustering system diagnostics

**Usage:**
```bash
# Command line
python backend/test_clustering.py

# Or via API when server is running
curl -X POST http://localhost:8000/trending/test
curl http://localhost:8000/trending/diagnostics
```

**Requirements:**
- PostgreSQL running on port 5432
- ChromaDB running on port 8000

---

## 2026-02-02: Chroma-Only Clustering Cutover

**Objective:** Remove persistent topic clustering storage and compute clusters on demand from Chroma.

**Backend Changes:**
- Added `backend/app/services/chroma_topics.py` to compute trending/breaking/all clusters and article topics on demand.
- Rewired `backend/app/api/routes/trending.py` and `backend/app/api/routes/similarity.py` to use Chroma topics.
- Updated `backend/app/services/blind_spots.py` to use Chroma topic grouping.
- Removed clustering schedulers from `backend/app/services/scheduler.py` and `backend/app/main.py`.
- Removed legacy clustering services and scripts:
  - `backend/app/services/clustering.py`
  - `backend/app/services/fast_clustering.py`
  - `backend/recluster_last_week.py`
  - `backend/fix_cluster_timestamps.py`
  - `backend/test_clustering.py`
  - `backend/test_clustering_auto.py`

**GDELT Integration:**
- Switched `gdelt_events` linkage to `article_id`.
- Updated `backend/app/services/gdelt_integration.py` and `backend/app/api/routes/gdelt.py` accordingly.

**Database:**
- Initialized missing tables locally and applied SQL to add `gdelt_events.article_id` and drop legacy cluster tables.

---

## 2026-01-29: Phase 8 - Blind Spots Analysis

### Blind Spots Analysis Feature

**Objective:** Identify gaps in news source coverage where major stories are not being reported by certain sources.

**Database Schema Changes:**
- `SourceMetadata` table with bias, credibility, ownership, and coverage tracking
- `SourceCoverageStats` table for daily coverage metrics per source
- `TopicBlindSpot` table tracking which sources miss which topics

**New Service: `backend/app/services/blind_spots.py`**
- `BlindSpotsAnalyzer` class with:
  - `analyze_source_coverage()` - Per-source blind spots analysis
  - `identify_topic_blind_spots()` - Systemic gaps across sources
  - `generate_source_coverage_report()` - Comprehensive rankings
  - `update_daily_coverage_stats()` - Daily stats aggregation

**Analysis Features:**
1. **Source-Level Blind Spots:** Topics a specific source is NOT covering
   - Coverage ratio calculation (topics covered / total active topics)
   - Temporal gap detection (24+ hour gaps in coverage)
   - Severity ratings (high/medium/low) based on topic importance

2. **Topic-Level Blind Spots:** Major stories missing from specific sources
   - Identifies when 4+ sources cover a topic but others don't
   - Systemic blind spots (affecting multiple sources)
   - Severity based on topic size and coverage gap

3. **Coverage Rankings:** Source performance metrics
   - Coverage ratio percentiles
   - Underperforming source identification (< 50% coverage)
   - Average articles per source benchmarking

**API Endpoints (`/blindspots`):**
- `GET /blindspots/source/{source_name}` - Per-source analysis
- `GET /blindspots/topics` - Systemic blind spots
- `GET /blindspots/report` - Comprehensive coverage report
- `POST /blindspots/update-stats` - Trigger daily stats update
- `GET /blindspots/dashboard` - Dashboard data for visualization

**Scheduled Task:**
- `periodic_blind_spots_update()` runs every 24 hours
- Updates daily coverage stats
- Generates coverage report for logging
- Identifies new systemic blind spots

**Integration:**
- Source credibility and political bias fields in SourceMetadata
- Links to existing source research from Phase 5B
- Scheduled alongside cluster updates in main.py

**Files Created/Modified:**
- `backend/app/database.py` - Added 3 new tables
- `backend/app/services/blind_spots.py` - New service (350 lines)
- `backend/app/api/routes/blindspots.py` - New endpoints (177 lines)
- `backend/app/services/scheduler.py` - Added periodic task
- `backend/app/main.py` - Registered scheduler task
- `backend/app/api/routes/__init__.py` - Registered router
- `Todo.md` - Marked Phase 8 complete

---

## 2026-01-29: Phase 7 - Multi-Source Story Comparison

### Multi-Source Comparison Feature

**Objective:** Enable side-by-side comparison of 2-3 news sources covering the same story, with entity extraction, keyword analysis, and visual diff highlighting.

**New Service: `backend/app/services/article_comparison.py`**
- `extract_entities()` - Extracts persons, organizations, locations, dates from text
- `extract_keywords()` - Frequency-based keyword extraction with stop word filtering
- `calculate_text_similarity()` - SequenceMatcher-based similarity calculation
- `compare_articles()` - Comprehensive comparison combining all analyses

**Comparison Features:**
1. **Entity Extraction:** Identifies and compares named entities between sources
   - Common entities highlighted in green
   - Unique entities shown per source
2. **Keyword Analysis:** Top keywords with frequency bars
   - Visual bar charts showing emphasis differences
   - Unique keywords per source
3. **Visual Diff:** Sentence-level comparison
   - Similar sentences matched with percentage
   - Unique content highlighted
   - Color-coded: Blue (Source 1), Orange (Source 2)

**API Endpoint:**
- `POST /compare/articles` - Accepts two article contents, returns full analysis

**Frontend Updates:**
- Enhanced "Compare Sources" tab in `ClusterDetailModal`
- Real-time comparison loading when tab selected
- Interactive UI with:
  - Similarity percentage indicator
  - Entity badges with color coding
  - Keyword frequency visual bars
  - Side-by-side content with diff highlights
  - Summary statistics cards

**Files Created/Modified:**
- `backend/app/services/article_comparison.py` - New comparison service (280 lines)
- `backend/app/api/routes/comparison.py` - New API endpoint (47 lines)
- `backend/app/api/routes/__init__.py` - Registered comparison router
- `frontend/components/cluster-detail-modal.tsx` - Enhanced comparison UI
- `Todo.md` - Marked Phase 7 complete

2026-03-03T02:49:56Z — Topic clustering resilience
- Implemented lexical fallback for topic clustering and snapshot-first detail lookup so the by-topic view remains available when Chroma is unstable.
- Frontend now reports initialization state and auto-retries while snapshots build.
- Added targeted backend tests and adjusted sync wait to provide faster developer feedback.

2026-03-21 — Search chat assistant versioning
- Reworked `frontend/app/search/page.tsx` so assistant retries create alternate response versions instead of deleting the visible reply and replaying the thread from scratch.
- Added assistant version grouping and selection helpers in `frontend/lib/chat-branching.ts`, then rendered `previous/next` pager controls beside the assistant copy/retry/delete actions.
- Added regression coverage for version selection in `frontend/__tests__/chat-branching.test.ts` and repaired existing frontend test harnesses by wrapping `react-query` components with a shared `QueryClientProvider` helper.

2026-03-21 — Blindspot metadata fallback and Global North/South geography lens
- Expanded blindspot metadata scoring in `backend/app/services/blindspot_viewer.py` so bias, credibility, and geography can fall back to the RSS catalog when article rows lack direct metadata.
- Added `factual_reporting` to the RSS source config in `backend/app/data/rss_sources.py`, which lets the credibility blindspot recover cards even when article credibility fields are blank.
- Broadened bias mapping to include center-left and center-right variants, and renamed the geography blindspot from `West vs East` to `Global North vs Global South`.
- Added backend regression tests for source-catalog fallback and updated the blindspot frontend test to match the current controls and title.
- Verification: `backend/.venv/bin/pytest tests/test_blindspot_viewer.py -q`, `npm --prefix frontend test -- --runInBand blindspot-view.test.tsx`, and `./verify.sh` all passed.

2026-03-27 — Deterministic reporter and source wiki
- Added a new deterministic entity wiki resolver in `backend/app/services/entity_wiki_service.py` that uses Wikidata search/entity lookup, Wikipedia lead extracts, outlet/context scoring, and public-record links instead of generative synthesis for the reporter and source wiki surfaces.
- Extended reporter persistence and API responses with resolver keys, Wikidata metadata, match status, dossier sections, citations, and fallback search links so the article detail sheet and full wiki pages can render explicit `matched`, `ambiguous`, and `none` states.
- Switched the source preview path to a deterministic cached dossier shape and refreshed the reporter/source wiki pages and preview panels to show evidence sections, citations, and public search fallbacks.
- Added test fixture coverage for the new reporter dossier fields and updated wiki endpoint assertions; verified Python syntax, frontend type-checking, and the article detail modal regression test.
- Verification: `python3 -m py_compile backend/app/database.py backend/app/api/routes/entity_research.py backend/app/api/routes/wiki.py backend/app/services/entity_wiki_service.py backend/app/services/source_research.py`, `npx tsc --noEmit` in `frontend/`, `npm --prefix frontend test -- --runInBand __tests__/article-detail-modal.test.tsx`. `./verify.sh` still reports pre-existing frontend lint warnings across the repo and depends on a backend test environment that is not fully bootstrapped locally.

2026-03-27 — GDELT search, article context, and geography signals
2026-04-09 — Reporter and source wiki deterministic sidebar pass
- Rebuilt the reporter and source wiki pages into dedicated left-sidebar explorer layouts so source pages, reporter pages, and the ownership graph each have their own focused navigation and summary rail.
- Removed the source page's LLM-centric methodology framing and moved the page emphasis to deterministic evidence: official site pages, public records, ownership/funding data, linked reporters, and stored citations.
- Added `backend/app/services/reporter_public_records.py` to derive reporter corpus activity from local articles and extract official author-page and external profile links from recent article HTML using structured data and author-link heuristics, with placeholder test domains skipped to keep tests deterministic.
- Extended the wiki backend so reporter dossiers now include `activity_summary`, and source profiles now expose extracted `official_pages` from common official routes such as about, masthead, editorial, ethics, and ownership pages.
- Added regression coverage for the new reporter activity payload and source official-pages field in the wiki route tests.
- Verification: `uv run pytest backend/tests/test_wiki_reporters.py backend/tests/test_wiki_sources.py -q`, `npx tsc --noEmit` in `frontend/`, `npx eslint 'app/wiki/source/[sourceName]/page.tsx' 'app/wiki/source/[sourceName]/source-wiki-view.tsx' 'app/wiki/reporter/[id]/page.tsx' 'app/wiki/reporter/[id]/reporter-wiki-view.tsx' lib/api.ts` in `frontend/`, browser checks on local wiki source and reporter pages, and `./verify.sh`.

2026-04-09 — Ownership graph UX redesign
- Replaced the single dense ownership hairball view with a guided explorer in `frontend/app/wiki/ownership/`, split into focused modules to stay within local file-size limits.
- Added a left control rail with search, node and link filters, top-hub shortcuts, and a default neighborhood focus mode so the page opens on a readable subgraph instead of the full network.
- Added a centered graph canvas with zoom, reset, pan, stronger node hierarchy, selective labels, and dimming for non-neighbor nodes when a source or organization is selected.
- Added a persistent inspector panel with global graph stats, selected-node metadata, and direct related organizations and sources for faster traversal.
- Verification: `npx tsc --noEmit` in `frontend/`, `npx eslint app/wiki/ownership/page.tsx app/wiki/ownership/ownership-graph-explorer.tsx app/wiki/ownership/ownership-graph-canvas.tsx app/wiki/ownership/ownership-graph-panels.tsx app/wiki/ownership/graph-utils.ts` in `frontend/`, browser screenshot check on `http://127.0.0.1:3000/wiki/ownership`, and `./verify.sh`.

- Added shared GDELT helpers for live `DOC 2.0` and `Context 2.0` queries plus compact CAMEO, Goldstein, tone, and geography aggregation so research, topic, and globe features can share one normalized contract.
- Updated the research agent to keep internal-first guardrails, prefer GDELT for current-event search, fall back to DuckDuckGo when needed, and carry `source_providers` through the streamed and non-streamed research responses.
- Enriched topic cluster payloads with nested `gdelt_context` for representative and member articles, then surfaced CAMEO, Goldstein, and tone context in the cluster detail modal.
- Extended blindspot and country-coverage payloads with explicit geography signals so the blindspot viewer and globe sidebar can distinguish source-origin counts from country-mention counts.
- Verification: `python3 -m py_compile backend/app/services/gdelt_taxonomy.py backend/app/services/gdelt_query.py backend/app/services/gdelt_aggregates.py backend/news_research_agent.py backend/app/api/routes/research.py backend/app/models/research.py backend/app/services/chroma_topics.py backend/app/api/routes/trending.py backend/app/services/blindspot_viewer.py backend/app/api/routes/blindspots.py backend/app/api/routes/news_by_country.py`, `npx tsc --noEmit` in `frontend/`, `npm --prefix frontend test -- --runInBand __tests__/trending-cluster-nullables.test.ts`. Backend `pytest` collection now gets past missing imports after local dependency installs, but targeted runs still hang during execution in this local environment and `uv run mypy backend/app --strict` remains broken by broader repo environment and stub issues outside this change set.

2026-04-09 — Globe texture and interaction performance pass
- Added a separate `frontend/public/3dmodel/textures/optimized/` asset set and moved the active globe to 2048px textures so the rendered earth no longer starts from the original 8K to 21K source images.
- Reduced the active globe texture payload from roughly 24 MB on disk to about 1.1 MB for the optimized set, while keeping the same shader-driven look and cloud layer.
- Removed polygon altitude tweening in `frontend/components/interactive-globe.tsx`, capped anisotropy, lowered renderer pixel ratio ceilings, and trimmed background star and sphere segment density to cut GPU and hover-path cost without changing the overall composition.
- Kept the globe material stable across lighting-mode toggles so switching between `All lit` and `Day/night` no longer recreates the texture-backed shader material.
- Removed explicit `fract()` wrapping from the earth and cloud shader UVs so the globe uses texture repeat mode without introducing a visible meridian seam at the sphere UV boundary.
- Split one-time globe scene setup from resize-time renderer updates so expanding the focus panel or changing layout no longer tears down and reloads the earth land textures.
- Replaced the `onGlobeReady` state setter with an effect-driven readiness handoff so the globe no longer triggers React's `setState on an unmounted component` warning during mount in Next.js dev.
- Verification: `./verify.sh` passed. Local browser check on `http://127.0.0.1:3000/` confirmed the globe still matches the existing layout and visual hierarchy after the asset swap.

2026-04-09 — Globe readiness and debug log pagination regressions
- Reworked globe readiness in `frontend/components/interactive-globe.tsx` to follow the actual `react-globe.gl` instance via a stable ref callback instead of a one-shot effect, so delayed dynamic mounts still run the control and renderer setup path.
- Fixed `_read_jsonl_tail()` in `backend/app/api/routes/debug.py` so `offset` now paginates backward from the newest matching log entries instead of returning the same tail window for most offsets.
- Added a frontend regression test for delayed globe mount readiness in `frontend/__tests__/interactive-globe.test.tsx` and a backend property test for log-tail pagination in `backend/tests/test_debug_log_pagination.py`.

2026-04-09 — Live article counts and uncapped RSS cache
- Removed the main page's collapsed-grid article count override so the dashboard no longer reports only the subset of cards currently visible in source mode.
- Added `/news/index/cached` plus a dedicated `useLiveBrowseIndex` hook so the main news page reads from the current in-memory RSS snapshot instead of the historical archive index.
- Switched the header metrics in `frontend/app/page.tsx` to show live article and working-source totals from `/cache/status`, which makes the dashboard reflect the active RSS pull instead of the rendered card subset.
- Changed the default cache limits in `backend/app/core/config.py` so `NEWS_CACHE_MAX_ARTICLES=0` and `NEWS_CACHE_MAX_PER_SOURCE=0` mean unlimited retention, then updated `backend/app/services/cache.py` to keep all live articles unless an explicit positive cap is configured.
- Added backend regression coverage for unlimited cache shaping and the new live browse endpoint in `backend/tests/test_live_cache_index.py`, plus frontend hook coverage in `frontend/__tests__/live-browse-index.test.tsx`.
- Unified the main news page so `globe`, `grid`, and `scroll` now all read from the same live browse dataset instead of globe using a separate stream-only article source.
- Replaced globe-side country metrics and local-lens fetches with client-side derivations from the shared live article dataset so globe heat, country lens results, and top-line counts now stay aligned with grid and scroll filters.
- Corrected the shared article and source counters to prefer the current filtered live dataset after load instead of always falling back to the global `/cache/status` totals.
- Fixed the accessibility regression follow-up where the new keyboard-accessible card wrappers in trending and reading-queue views also activated when inner buttons received `Enter` or `Space`.
- Added derived notification dismissal state on the main page so per-item and clear-all actions work again without introducing effect-driven render churn.
- Added frontend regression coverage for live count semantics, globe live-data derivation, keyboard activation guards, and notification dismissal helpers.

2026-04-09 — Live cache persistence and notification recurrence fixes
- Added an explicit `is_persisted` flag to cached live browse rows in `backend/app/api/routes/news.py` so the frontend can distinguish durable DB-backed articles from in-flight cache rows during incremental refreshes.
- Updated `frontend/lib/api.ts` so synthesized fallback ids remain usable for React keys, but rows without a real backend article id are marked `isPersisted: false` and no longer try to post nonexistent `article_id` values through like, bookmark, or queue flows.
- Moved main-page notification dismissal into a small hook in `frontend/lib/notification-state.ts` that prunes stale dismissed ids back into state, allowing `browse-index-error` and `empty-feed` alerts to reappear after they clear and recur later.
- Added backend coverage for persisted versus unpersisted cached browse rows in `backend/tests/test_live_cache_index.py`, frontend mapping regressions in `frontend/__tests__/browse-index.test.tsx` and `frontend/__tests__/api-mapping.property.test.ts`, and notification recurrence coverage in `frontend/__tests__/notification-state.test.ts`.
- Verification: `uv run pytest backend/tests/test_live_cache_index.py -q`, `npm --prefix frontend test -- --runInBand __tests__/browse-index.test.tsx __tests__/api-mapping.property.test.ts __tests__/notification-state.test.ts`, `npx tsc --noEmit` in `frontend/`, `npx eslint app/page.tsx lib/api.ts lib/notification-state.ts __tests__/browse-index.test.tsx __tests__/api-mapping.property.test.ts __tests__/notification-state.test.ts` in `frontend/`, and `./verify.sh`.
2026-04-17 — Blindspot viewer wider cluster context and lane expansion
- Increased cluster snapshot article retention in `backend/app/services/chroma_topics.py` from 5 to 12 recent articles so blindspot scoring and preview payloads can see more of each topic.
- Extended blindspot preview articles in `backend/app/services/blindspot_viewer.py` and `backend/app/api/routes/blindspots.py` with richer metadata, raised the per-card sample budget to 8 articles, and preferred source-diverse samples instead of repeated outlet duplicates.
- Updated `frontend/components/blindspot-view.tsx` and `frontend/lib/api.ts` to surface the wider article sample, show sampled-source context on cards, and let each lane expand beyond the default visible set instead of clipping the board at a fixed small slice.
- Added regression coverage in `backend/tests/test_blindspot_viewer.py` and `frontend/__tests__/blindspot-view.test.tsx`.
- Verification: `backend/.venv/bin/pytest backend/tests/test_blindspot_viewer.py -q`, `npm --prefix frontend test -- --runInBand blindspot-view.test.tsx`, `cd frontend && npx tsc --noEmit`, and `python3 -m py_compile backend/app/services/chroma_topics.py backend/app/services/blindspot_viewer.py backend/app/api/routes/blindspots.py backend/tests/test_blindspot_viewer.py`.
2026-04-17 — Duplicate React key lint warning and key hardening
- Added a local ESLint rule in `frontend/eslint.config.mjs` that warns on fragile `key={item.id}` and `key={item.url}` usage inside `.map()` callbacks, so duplicate-key risks show up during lint instead of only in the browser console.
- Hardened current duplicate-prone render sites in `frontend/app/debug/page.tsx` and `frontend/components/globe-view.tsx` with composite keys, and deduped globe local-lens articles in `frontend/lib/globe-live-data.ts`.
- Added regression coverage for lens deduplication in `frontend/__tests__/globe-live-data.test.ts`.
- Verification: `npm --prefix frontend test -- --runInBand globe-live-data.test.ts`, `cd frontend && npx tsc --noEmit`, `cd frontend && npx eslint .`.
2026-04-17 — Article extraction barrier detection and local highlight fixes
- Replaced the full-article extractor's domain denylist in `backend/app/services/article_extraction.py` with response-based barrier detection, so readable pages still parse while verification walls and real subscription prompts return explicit errors based on the fetched HTML and status code.
- Expanded the Rust article-body selector list in `backend/rss_parser_rust/src/html_extract.rs` and added unit coverage for common article wrappers to improve extraction on sites that do not use plain `<article>` blocks.
- Fixed local-only highlight editing in `frontend/components/article-detail-modal.tsx` and `frontend/components/highlight-note-popover.tsx` by switching note edits and sidebar actions to stable ids that work before a server id exists.
- Reordered auto-highlight creation in `frontend/components/highlight-toolbar.tsx` so selections outside the article container no longer trigger create attempts.
- Added regression coverage in `backend/tests/test_extraction_image_flow.py`, `frontend/__tests__/highlight-note-popover.test.tsx`, and `frontend/__tests__/highlight-toolbar.test.tsx`.
- Verification: `uv run pytest backend/tests/test_extraction_image_flow.py -q`, `npm --prefix frontend test -- --runInBand highlight-note-popover.test.tsx highlight-toolbar.test.tsx article-detail-modal.test.tsx`, `cd frontend && npx tsc --noEmit`, `cd backend/rss_parser_rust && cargo test html_extract -- --nocapture`, `uv run python` live checks against BBC and Reuters extraction, and `./verify.sh`.
2026-04-22 — Research stress harness executed-tool tracing and loop-safe internal search
- Updated `backend/news_research_agent.py` and `backend/app/api/routes/research.py` so streamed `tool_result` events now carry the actual tool name that executed, including automatic fallback tools.
- Updated `backend/tools/research_lab.py` to track executed tools separately from requested `tool_start` events, report executed-tool coverage in the aggregate summary, and stop using a trailing `Tool request:` step as the fallback answer when a live run stops early.
- Changed `_run_async_blocking()` in `backend/news_research_agent.py` to submit async work to the FastAPI worker's main event loop when a research tool runs from a worker thread, which prevents the `Future attached to a different loop` crash in `search_internal_news`.
- Added regression coverage in `backend/tests/test_research_lab.py`, `backend/tests/test_news_research_agent_stream.py`, and `backend/tests/test_news_research_agent_recovery.py`.
- Live stress verification on `http://127.0.0.1:8000`: `backend/lab_runs/stress_latest.json` reproduced the pre-fix loop error, `backend/lab_runs/stress_targets.json` confirmed the `Responsible Statecraft` query no longer crashes and captured executed `news_search` fallback for the bird-flu query, and `backend/lab_runs/stress_carry_latest.json` completed four carried-history turns with `history_messages_sent` growing `0 -> 2 -> 4 -> 6`.
2026-04-23 — Article verification workspace and highlight note interaction fixes
- Repointed the frontend `performAgenticSearch()` compatibility helper in `frontend/lib/api.ts` from the removed `/api/search/agentic` route to the supported `/api/news/research` endpoint and normalized the response back into the existing caller shape.
- Restyled the AI analysis and verification surfaces in `frontend/components/article-detail-modal.tsx` so the compact summary, fact-check preview, and verification dialog use the same visual system as the rest of the article modal, while keeping claim selection in sync with the current analysis payload.
- Fixed `frontend/components/highlight-note-popover.tsx` so the note editor stays interactive inside the article dialog by keeping it in the dialog tree, stopping pointer propagation on the popover shell, and focusing the textarea when it opens.
- Added frontend regression coverage in `frontend/__tests__/api.agentic-search.test.ts`, `frontend/__tests__/article-detail-modal.test.tsx`, and `frontend/__tests__/highlight-note-popover.test.tsx`.
- Verification: `npm --prefix frontend test -- --runInBand frontend/__tests__/api.agentic-search.test.ts frontend/__tests__/highlight-note-popover.test.tsx frontend/__tests__/article-detail-modal.test.tsx`, `npm --prefix frontend run lint`, `cd frontend && npx tsc --noEmit`, and `./verify.sh`.
2026-04-27 — DRY cleanup for saved-article routes and debug/view-mode helpers
- Extracted shared saved-article route helpers in `backend/app/api/routes/saved_article_helpers.py` and reused them from `bookmarks.py` and `liked.py` to remove duplicated query construction, response serialization, and create/delete lookup flow.
- Added `frontend/lib/view-mode-storage.ts` and switched both `frontend/app/page.tsx` and `frontend/components/grid-view.tsx` to one shared read/write/validation path for persisted `"viewMode"` state.
- Consolidated repeated debug fetch/parse/error logic in `frontend/lib/api.ts` with shared `fetchDebugJson` and `fetchDebugParsed` helpers for the Chroma/database/cache/storage debug endpoints.
- Verification: `cd backend && .venv/bin/pytest tests/test_bookmarks.py tests/test_liked.py -q`, `npm --prefix frontend run lint`, `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`, and `scripts/self-test` (known pre-existing failures in `tests/test_source_url_guard.py` and `tests/test_country_mentions.py`).
2026-04-27 — Verification/OpenAPI type consolidation and core API type reuse
- Added `frontend/lib/types/verification.ts` as a shared verification contract module derived from generated OpenAPI schemas, including disambiguated verification `SourceInfo` mapping and stricter frontend-required fields.
- Updated `frontend/lib/verification.ts` to consume and re-export the shared verification types so existing caller imports remain stable.
- Updated `frontend/lib/api.ts` core DTOs to reuse `ArticleCore`/`SourceCore` via `Pick<>` for `NewsArticle` and `NewsSource`, reducing duplicated base field declarations.
- Verification: `npm --prefix frontend run lint` and `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`.
2026-04-28 — Analyzer-backed dead frontend removal and direct dependency cleanup
- Removed 15 zero-reference frontend files reported by package-local `knip`, including unused legacy view/components, old debug helpers, stale constants, and an unimported duplicate stylesheet.
- Added direct frontend dependencies for imported runtime/config packages (`d3-geo`, `eslint-plugin-react-hooks`, and `postcss-load-config`) so the package manifest matches code and tool configuration.
- Tightened the saved-article helper record types for bookmark/liked flows and reused the shared `GridViewMode` type in `frontend/components/grid-view.tsx`.
- Verification: `uvx ruff check backend/`, `uvx vulture backend/app backend/scripts --exclude 'backend/.venv/*' --min-confidence 90`, `python backend/scripts/check_import_cycles.py --source backend/app --package-root backend`, `npx --yes madge --circular --json --no-spinner --extensions ts,tsx --ts-config tsconfig.json app components hooks lib` in `frontend/`, `npx --yes knip` in `frontend/` (remaining findings are exported API/UI surface only), `bash -lc 'cd backend && .venv/bin/pytest tests/test_bookmarks.py tests/test_liked.py tests/test_scroll_personalization_flow.py -q'`, `npm --prefix frontend run lint`, and `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`.

2026-05-12 — Reporter/source intelligence live proof and local byline fallback
- Added local byline reporter profiles for unresolved Wikimedia reporters so RSS bylines, the local article corpus, official article pages, schema.org JSON-LD, and RSS catalog metadata still produce deterministic reporter evidence instead of dropping unmatched reporters.
- Added `backend/scripts/verify_reporter_source_intelligence.py` and `backend/scripts/reporter_source_verifier.py` to live-test real RSS catalog sources, real Wikimedia-backed reporters, and per-source reporter/byline coverage with strong/medium/weak quality tiers across RSS and Atom feeds.
- Added same-domain official author-page probing for bylines that come from feeds whose article pages block or omit author metadata, and count clean official RSS bylines as medium evidence when article pages are blocked.
- Added Google News RSS wrapper decoding for the live proof harness so aggregator feed entries can be tested against the real publisher article pages.
- Extended author extraction to recognize schema.org `Person` authors and microdata author fields as medium-quality article-page evidence, filter generic navigation labels out of reporter candidates, and corrected current Duvar English, The Citizen, and Washington Post RSS URLs after validating them live.
- Hardened RSS validation and the Rust parser against feeds that include trailing content after a complete RSS document, and corrected the Pajhwok Afghan News feed URL.
- Verification: targeted reporter tests passed, Rust feed-trimming coverage passed, the changed live feed URLs validated, and the 50-source live reporter proof scanned deeper feed windows for up to five unique reporters per source, reaching 40/50 sources with strong or medium reporter evidence and 32/50 sources with five found reporters.

2026-05-22 — Reporter/source verifier quality gate
- Tightened `backend/scripts/verify_reporter_source_intelligence.py` so byline checks fail unless the source-level reporter evidence meets a configurable minimum quality tier, defaulting to `medium`.
- Kept the strong/medium/weak/none breakdown in the verifier output and added a `BYLINE_GATE` summary so weak-only byline evidence stays visible but cannot make the live proof look green.
- Filtered organization-style bylines such as outlet names and legal/company labels before they can count as reporter evidence, skipped repeated already-counted feed authors during live source scans, and added `GENERIC`, `BLOCKED`, and `SOURCE_MISMATCH` byline counts so outlet labels, access barriers, and off-source aggregator links are reported separately from missing evidence.
- Expanded deterministic article metadata extraction to count standards-style byline signals from JSON-LD, Microdata, OpenGraph/article meta tags, Dublin Core creators, Parsely, and Sailthru metadata, and exposed structured/microdata/meta evidence counts in the live verifier output.
- Added an Asia-Plus host-family alias and current `site_url` so the legacy `asiaplustj.info` RSS feed validates against current `asiaplus.news` article links instead of being counted as off-source aggregator evidence.
- Tightened non-person author filtering for organization and movement labels such as `Socialism AI` and `International Youth and Students for Social Equality (IYSSE)`.
- Added a Trust/JTI-style source transparency dossier section that records official about, masthead/author, editorial standards, corrections, ownership, structured ownership, and funding signals when those public records are found.
- Added deterministic ads.txt transparency evidence for source profiles: the dossier now fetches the publisher root `ads.txt`, counts authorized seller, DIRECT, and RESELLER rows, captures OWNERDOMAIN and MANAGERDOMAIN values, and reports duplicate or invalid row diagnostics with the ads.txt URL as evidence.
- Added a bounded sellers.json cross-check for source profiles: the dossier checks the top ads.txt ad-system domains, verifies seller IDs against published sellers.json files, records matched and missing seller IDs, and compares matched seller domains against ads.txt OWNERDOMAIN and MANAGERDOMAIN declarations.
- Added deterministic official-page policy transparency extraction for source profiles. The new module records separate policy signals for editorial independence, ethics/standards, corrections, ownership, funding, staff/byline disclosure, anonymous-source policy, AI or synthetic media policy, and conflicts disclosure when those terms appear in fetched official pages.
- Tightened official-page collection so guessed transparency URLs must resolve to a final URL whose path still matches the intended page type. This prevents unrelated redirects, such as an ethics URL landing on a religion page, from being counted as source editorial-policy evidence.
- Exposed the machine-readable `ads_txt`, `sellers_json`, and `policy_transparency` summaries through both the direct source research API and wiki source profile API, and aligned the frontend `WikiSourceProfile` and `SourceResearchProfile` types so the UI can consume those summaries without relying only on dossier display text.
- Extracted ad-supply transparency parsing, fetching, and sellers.json cross-checking into `backend/app/services/ad_supply_transparency.py` so the evidence module is testable independently from the broader entity wiki resolver.
- Extracted policy transparency matching into `backend/app/services/source_policy_transparency.py` so policy evidence stays testable and separate from both Wikimedia resolution and ad-supply-chain checks.
- Refreshed `backend/openapi.json` and `frontend/lib/generated/openapi.ts` so checked-in API contracts include the new ad-supply transparency fields, and repaired the root `npm run openapi:refresh` script to use the repo backend runtime with a repo-local UV cache instead of the missing `venv/bin/python`.
- Added source-profile cache schema versioning so old cached dossiers are rebuilt instead of silently omitting new transparency evidence such as `ads_txt`, `sellers_json`, and `policy_transparency`, or retaining stale official-page false positives after URL relevance rules change.
- Tightened ProPublica Nonprofit Explorer matching so long single-token outlet names such as Reuters do not inherit unrelated foundation 990 records from partial-token overlap.
- Stopped merging ProPublica nonprofit records into known commercial outlets so unrelated foundation or charity records cannot contaminate source funding evidence for commercial media brands such as CNN.
- Labeled source-profile citations by evidence type (`Wikipedia profile`, `Wikidata public record`, `Official website`, `Official transparency page`, `ProPublica Nonprofit Explorer`) so source dossiers expose where each public record came from instead of flattening everything to a generic source label.
- Updated `backend/scripts/measure_wiki_profile_coverage.py` so source coverage benchmarks now score and print source transparency evidence: transparency item counts, policy-signal counts, ads.txt availability, sellers.json checked systems, and sellers.json matched row counts.
- Verification: targeted reporter/source verifier tests passed, route-level source profile tests proved ad-supply and policy-transparency summaries survive FastAPI response filtering, cache tests proved old unversioned source-profile cache entries are rejected and current entries retain ad-supply and policy summaries, frontend TypeScript accepted the new source profile shapes, focused ad-supply parser/cross-check and policy-signal tests passed after module extraction, `npm run openapi:refresh` regenerated checked-in API artifacts successfully, a focused live BBC/CNN proof passed the default medium-quality gate, Malay Mail/ANDINA and Electronic Intifada/Reuters live proofs failed honestly where byline evidence was generic, missing, or access-blocked, Hacker News Frontpage failed as off-source aggregator evidence instead of counting third-party reporters, Reuters source research stayed commercial under Thomson Reuters with no ProPublica EIN, and the live BBC/CNN source-profile proof exposed source profile rows with citations, transparency items, ads.txt, sellers.json, and policy-signal counts.
- Coverage verification: `uv run python backend/scripts/measure_wiki_profile_coverage.py --limit 3 --force-refresh` measured Fox News, BBC, and Reuters from the real RSS catalog and printed transparency evidence columns. All three had source URL guard `ok`, ads.txt evidence, and sellers.json checks. After URL relevance filtering, the sample reported zero policy-signal sources because no fetched official policy URL in that sample resolved to a relevant final path; BBC's `/ethics` redirect to `/religion/0/` was no longer counted as editorial-policy evidence.

## 2026-05-22: Reporter Identity Graph, Enrichment Integration, And Intelligence Measurement

**What Changed:**
- Extended `_build_local_byline_profile()` in `reporter_indexer.py` to query `ArticleAuthor` for `canonical_author_url` and `author_page_url` signals, add OpenAlex author search and Wayback Machine snapshot fetch to the parallel enrichment gather, extract Mastodon/Bluesky social profile data into an "Online Presence" dossier section, and include OpenAlex / Wayback findings as dossier sections alongside `canonical_author_url`/`author_page_url` in the returned profile dict.
- Extended `get_reporter_graph()` in `wiki.py` to persist coauthor relationships as `identity_edge` records with `edge_type="coauthor"` and weight-derived confidence when the coauthor graph endpoint is called.
- Created `backend/scripts/verify_reporter_intelligence.py` -- CLI script that iterates all reporters, groups by source, computes per-source metrics (total reporters, confidence tier distribution, average score, author page URL rate, claims rate), and accepts `--trend` to compare against a cached prior run.
- Extended `backend/scripts/measure_wiki_profile_coverage.py` with `--reporter` flag that adds a reporter coverage section (total reporters, confidence tier counts, Wikidata QID coverage, author_page_url coverage, claims coverage) to the existing source coverage output, and fixed it to call the repo's lazy `AsyncSessionLocal` directly instead of wrapping it in another `async_sessionmaker`.

**Verification:**
- `uv run python backend/scripts/measure_wiki_profile_coverage.py --limit 1 --reporter` now runs against the live DB path and reports 212 reporters: 2 verified, 210 strong, 0 likely, 0 unmatched, 212 with Wikidata QIDs, 2 with author page URLs, and 125 with claims.
- `backend/scripts/verify_reporter_intelligence.py` now uses the repo lazy `AsyncSessionLocal` directly, falls back from article-source joins to reporter career-history organizations when article-author links are absent, and prints article/career/unknown attribution counts so per-source reporter intelligence does not collapse into an unlabeled `unknown` bucket.
- Live reporter intelligence verification now reports 212 reporters across 249 attributed source/organization rows: 0 reporters attributed through article-source joins, 209 through career history, and 3 still unknown. This makes the benchmark useful while preserving the caveat that the current local DB is missing article-source reporter links.
- Added `backend/scripts/backfill_article_author_links.py`, a dry-run-by-default deterministic local backfill that scans persisted `Article.author` RSS bylines, rejects generic/source-label bylines with the shared reporter-name filter, creates `local_byline` reporter records when needed, and writes `ArticleAuthor` links with `observation_source="rss_byline"`.
- Applied the backfill to the live local DB: scanned 4,920 persisted article bylines, skipped 1,486 generic or source-label bylines, created 2,038 local-byline reporter records, and created 3,434 article-author observation links.
- Tightened the local backfill to reject catalog sources whose metadata says the feed is an academic preprint repository or link aggregator, and added `--prune-invalid-local` to remove previously created local-byline reporter rows and article links for those source classes.
- Applied the invalid-local prune to the live local DB: removed 543 local-byline reporter rows and 550 article-author links from disallowed catalog sources, primarily arXiv academic preprint feeds. A follow-up dry run now reports 570 article rows skipped from disallowed sources (`ArXiv CS (AI)`, `ArXiv CS (CL)`, and `Hacker News Frontpage`) and no new links to create.
- Updated reporter confidence scoring so repeated persisted `ArticleAuthor` observations count as limited local evidence: 2+ article observations are `likely` at 0.55, while a single article observation remains `unmatched` but scores 0.35 and records `article_observation_count`.
- Updated reporter coverage measurement to print `with_article_links`. After pruning invalid local rows, the live `measure_wiki_profile_coverage.py --limit 1 --reporter` run reports 1,707 reporters, 2 verified, 210 strong, 341 likely, 1,154 unmatched, 212 with Wikidata QIDs, 2 with author page URLs, 125 with claims, and 1,495 with article links.
- Live reporter intelligence verification now reports 1,707 reporters across 364 attributed source/organization rows: 1,495 reporters attributed through article-source joins, 209 through career history, and 3 still unknown.
- Python syntax check passed on all 4 changed/created files.
- `scripts/self-test` passed: frontend build, ESLint, Python ruff check, Rust check all clean.

## 2026-05-23: Reporter Coverage Target And Author-Page Verification

**What Changed:**
- Added a deterministic author-page enrichment script that promotes local-byline reporters to verified only when an article exposes a same-host author URL and the fetched public profile page matches the reporter name.
- Added a confidence recompute script for refreshing persisted reporter confidence tiers and scores from current evidence.
- Tightened local-byline filtering to reject generic newsroom labels, source labels, usernames, emails, zero-width generic names, and non-public author hosts while preserving legitimate person names that include role descriptors.
- Changed local article-author observations to count as limited likely evidence instead of unmatched evidence, while keeping public author-page evidence as the verified threshold.
- Cleaned the live DB by pruning invalid local-byline reporters, clearing stale non-public `test.local` author URLs, and removing a generic `Newsday Reporter` profile before replacing it with a real matched author profile.

**Coverage Verification:**
- `uv run python backend/scripts/measure_wiki_profile_coverage.py --limit 1 --reporter` now reports 1,664 reporters: 100 verified, 212 strong, 1,352 likely, 0 unmatched, 212 with Wikidata QIDs, 100 with author page URLs, 125 with claims, and 1,452 with article links.
- A focused quality query found 0 verified rows with `test.local`, `example`, or `localhost` author URLs, and 0 verified rows matching the generic byline terms checked in this pass.
- The largest author-page enrichment run promoted 98 reporters from real article/profile evidence and recorded access barriers separately: 95 HTTP 403, 3 HTTP 429, and 26 HTTP 401.
- Repaired missing official author-page citations for the 100 verified reporters after finding the JSON citation list was not persisted by the original in-place mutation. Reporter coverage now also prints `with_public_author_page_url`, `verified_public_author_page_url`, `verified_author_page_citations`, and `non_public_author_page_url`; the live reporter coverage run reports 100/100/100/0 for those fields.
- Updated `backend/scripts/verify_reporter_intelligence.py` to expose public author-page and verified author-page citation counts per source, and made expensive evidence recomputation opt-in via `--recompute` so the default report uses persisted confidence tiers and scores.
- Live reporter intelligence verification against the local PostgreSQL DB reports 1,664 reporters across 360 source/organization rows: 1,452 article-attributed reporters, 209 career-attributed reporters, 3 unknown-attributed reporters, and per-source public-author-page/citation counts.

**Verification:**
- Focused reporter confidence, author-page scraper, backfill, author-page enrichment, coverage, and reporter-intelligence tests passed before the final full gate.

## 2026-05-24: Verified Reporter Person-Name Gate

**What Changed:**
- Tightened reporter author-page promotion so a fetched profile name only matches after both the profile name and stored byline pass the shared person-name filter.
- Updated reporter confidence scoring so public author URLs can only produce `verified` or canonical-URL `strong` evidence when the reporter row has a person-like name.
- Normalized leading `By` / `Por` byline prefixes before name scoring, so labels such as `BY ARIELLA ROITMAN` resolve to the person name instead of remaining as stored byline boilerplate.
- Added explicit non-person filters for `Guest Contributor` and `Agencia EFE`, preventing generic contributor pages and agency labels from becoming verified reporters.
- Added `backend/scripts/verify_reporter_intelligence.py --audit-quality`, which exits non-zero if any persisted `verified` reporter lacks a person-like name, public author page, or matching official author-page citation.

**Verification:**
- Focused reporter source verifier, author-page enrichment, confidence scorer, and reporter intelligence audit tests passed.
- Initial live PostgreSQL verification was blocked because local PostgreSQL was inactive (`pg_isready -h 127.0.0.1 -p 5432` returned no response); the follow-up profile-audit pass below reran live verification after starting PostgreSQL.

## 2026-05-24: Reporter Profile Accuracy Audit And Coverage Target

**What Changed:**
- Added `backend/scripts/verify_reporter_intelligence.py --audit-profiles` to fail on unusable verified/strong names, QID-label reporter rows, strong profiles without journalism evidence, stale local-byline rows, combined multi-author bylines, and source-label bylines.
- Tightened confidence scoring so `verified` requires a person-like name, public official author page, and matching author-page citation. Wikidata-backed `strong` now also requires a person-like name and journalism evidence in the stored profile.
- Split comma/and multi-author RSS bylines into individual reporter rows, pruned stale combined rows, and rejected agency, press-release, Associated Press, source-label, and role-suffixed byline rows.
- Rebuilt the live local-byline corpus after pruning. The stricter backfill scanned 60,911 article rows, skipped 23,591 generic bylines, reused 9,555 reporter rows, created 9 cleaned reporter rows, and linked 40,913 article-author observations.
- Refilled verified coverage with same-host, profile-name-matched author pages from live publisher pages. The final top-up promoted Ryan McCaffrey, Danielle Abraham, Rachel Weber, and Tyler Colp from IGN/PC Gamer.

**Coverage Verification:**
- Live recompute reports 11,521 reporters: 100 verified, 1,964 strong, 9,407 likely, and 50 unmatched.
- `verify_reporter_intelligence.py --audit-quality` reports 100/100 verified person names, public author pages, and official author-page citations, with 0 failures.
- `verify_reporter_intelligence.py --audit-profiles` reports 0 profile-quality failures across the 11,521 reporter rows.
- External spot checks with Exa and web search confirmed newly promoted IGN profiles and confirmed that `Press Release` / `The Associated Press` are collective or agency labels rather than individual reporter identities.

**Verification:**
- `uv run pytest backend/tests/test_backfill_article_author_links.py backend/tests/test_verify_reporter_intelligence.py backend/tests/test_reporter_source_verifier.py backend/tests/test_reporter_author_page_enrichment.py backend/tests/test_reporter_confidence_scorer.py -q`: 55 passed.

## 2026-05-24: Eligible Reporter Cohort Denominator

**What Changed:**
- Added `backend/scripts/verify_reporter_intelligence.py --audit-eligible-cohort` to define the scaling denominator for the 70% verified target.
- The eligible cohort is now explicit: article-attributed reporters from persisted RSS/catalog articles with person-like names, at least N `ArticleAuthor` links, non-source-label bylines, and no combined byline names.
- The audit reports verified, strong, likely, and unmatched counts inside that cohort, the verified percentage, the exact verified shortfall for the target percentage, likely/unmatched leakage, and top source backlogs for enrichment prioritization.

**Live Baseline:**
- With `--eligible-min-articles 5 --eligible-target-verified-percent 70`, the live PostgreSQL cohort is 1,787 reporters: 100 verified, 17 strong, 1,670 likely, and 0 unmatched.
- Verified coverage inside the audited cohort is 5.60%; reaching 70% requires 1,251 verified reporters, a current shortfall of 1,151.
- The top unverified source backlogs are Bloomberg, New York Times, The Guardian - UK, The Guardian, ABC News Australia, The Indian Express, Breitbart, Axios, The Wall Street Journal, Variety, The Times of India, and MyJoyOnline.
- The audit intentionally exits non-zero while the 70% target or zero-leakage rule is unmet.

**Verification:**
- `uv run pytest backend/tests/test_verify_reporter_intelligence.py -q`: 11 passed.

## 2026-05-12: Reporter Resolution False-Positive Fix And Free Enrichment Pipeline

**Problem:** The Wikidata-based reporter resolver matched non-journalists (e.g., cancer researchers) to journalists whose names happened to overlap. The 0.55 scoring threshold was achievable by `name_score + human_score` alone with zero occupation signal. The system also had no enrichment when Wikidata returned ambiguous or no match.

**What Changed:**
- Fixed `build_reporter_dossier()` scoring in `entity_wiki_service.py`: rebalanced weights (name 0.34->0.30, occupation 0.18->0.26), added `NON_JOURNALIST_OCCUPATIONS` penalty (-0.4) for known non-journalist Wikidata labels, required `occupation_score > 0` for "matched" status, and raised single-candidate threshold to 0.65.
- When no journalist Wikidata candidates exist, the resolver now returns `match_status: "none"` instead of displaying a non-journalist entity as the best candidate. The indexer falls through to a local-byline profile.
- Added `_build_local_byline_profile()` in `reporter_indexer.py` to create evidence-backed local profiles from RSS bylines, local article corpus, and official article pages.
- Created `backend/app/services/reporter_web_search.py`: DuckDuckGo Lite search enrichment for reporter name + outlet queries.
- Created `backend/app/services/reporter_social_search.py`: Mastodon (journa.host, newsie.social, mastodon.social, mastodon.online) and Bluesky public API search for journalist social profiles.
- Created `backend/app/services/reporter_wikipedia.py`: Wikipedia API bio extraction by reporter name search, plus Wikipedia category journalist enumeration.
- Created `backend/app/services/reporter_directory.py`: Full Mastodon directory enumeration for bulk journalist discovery (journa.host: 3,019 vetted journalists; newsie.social: 20,710 journalist accounts).
- Local-byline profiles now run web search, social search, and Wikipedia bio fetch in a single parallel `asyncio.gather`, with results flowing into profile overview, citations, and search links.
- Unified 15+ scattered User-Agent strings across 13 files into three constants in `app/core/config.py`: `SCOOP_USER_AGENT` (general web), `SCOOP_WIKIMEDIA_UA` (Wikimedia-format with contact URL per policy), `SCOOP_BROWSER_UA` (Mozilla/5.0 compatible for image extraction on CDN-blocked sites).
- Fixed `ws_client.aclose()` leak via `finally` block in enrichment gather.
- Fixed employer score token-boundary bug: replaced fragile `" ".join(employer_labels)` with per-label token overlap.
- Added `NON_JOURNALIST_OCCUPATIONS` constant (researcher, scientist, physician, engineer, etc.) and removed "author" from `JOURNALISM_KEYWORDS` (too broad).

**Verification:**
- `uv run pytest backend/tests/test_entity_wiki_service.py backend/tests/test_wiki_reporters.py backend/tests/test_wiki_indexer.py backend/tests/test_reporter_indexer.py -q`: 39 passed.
- `uvx ruff check` on all changed files: 0 errors.
- Live test: `score_researcher_likelihood("Jonathan Carter")` correctly classified as researcher (score=90: 320 works, h-index=42, UCSF, 192 PubMed papers).
- Live test: `find_social_profiles` returns real Mastodon/Bluesky results for known journalists.
- Live test: `mine_journalist_directories` returns verified journalist profiles from journa.host with press credentials.

## 2026-05-22: Full Pipeline Validation + Rust Parser Fix

### Summary
First end-to-end pipeline run on real data: RSS ingestion → DB persist → reporter confidence scoring. Full end-to-end pipeline (68.9s) validated all major components with 261 RSS sources, 8636 articles, and 212 reporters.

### Key Results
- **Rust Parser:** Fixed byte-index panic in `trim_to_feed_document()` caused by case-varying XML closing tags with multi-byte content. Replacement now uses `rfind()` on original string with case-insensitive manual fallback scan. Rebuilt via `maturin develop --release`.
- **RSS Ingestion:** 261 sources fetched, 8636 articles parsed (70.1s full fetch), 8525 persisted to DB after upsert dedup.
- **Enrichment:** OpenAlex connector validated on Anderson Cooper (8 claims) and Jim Acosta (8 claims). Wayback CDX, awards, conferences: functional (Wayback returns 429, award pages have no structured data for pure journalists).
- **Confidence Scoring:** 212 reporters scored: 210 strong (Wikidata QID), 2 verified (OpenAlex-enriched). Average score 0.897.
- **PostgreSQL Issue:** Async engine created on wrong event loop when `persist_articles_dual_write` fell through to `asyncio.run()`. Fixed by calling `set_main_event_loop()` and pre-initializing engine on the main loop before starting pipeline. Also had a "too many clients" error resolved by restarting PG with `max_connections=200`.

### Issues Found
- `measure_wiki_profile_coverage.py --reporter` previously failed with `AsyncEngine expected, got _LazySessionFactory`; fixed by using the lazy session factory directly.
- `update_reporter_confidence()` only persists `confidence_tier`, not `confidence_score` - needs fix in confidence scorer.
- OpenAlex returns 0 results for pure journalists (Maggie Haberman, Wolf Blitzer) - by-design, only covers academic-crossover journalists.
- Award/conference connectors return no data for most reporters (name matching on raw HTML pages is limited).

### Files Modified
- `backend/rss_parser_rust/src/parser.rs`: Fixed `trim_to_feed_document` byte-index bug with case-insensitive manual fallback
- `/tmp/pipeline_full.py`: Added `set_main_event_loop()`, engine pre-init, persistence worker task

## 2026-05-25: Cloudflare-Aware Reporter Enrichment And 1,000+ Verified Profiles

**What Changed:**
- Added an optional bounded `cloudscraper` fallback for reporter article/profile HTML fetches, pinned to `VeNoMouS/cloudscraper` from GitHub because PyPI does not provide the current fork.
- Routed article author-signal extraction and author profile scraping through the shared Cloudflare-aware fetcher so 401/403/429/challenge responses are recorded as access barriers instead of silent missing evidence.
- Disabled Cloudscraper auto-refresh retries after live testing showed that 403 auto-refresh can hang on Cloudflare challenge pages. The fallback is now bounded by a hard timeout, skips root-redirected profile guesses, and preserves direct-request evidence when bypass fails.
- Kept generic 403 Cloudscraper retry opt-in through `THESIS_CLOUDSCRAPER_GENERIC_BLOCKS=1`; the default path now retries only challenge HTML or Cloudflare-marked 403/429/503 responses.
- Fixed access-barrier classification so normal 200 pages served through Cloudflare are not mislabeled as Cloudflare blocks.
- Tightened known-reporter anchor extraction so author-path links must carry text, title, or aria-label matching the reporter. This prevents unrelated staff/sidebar links from becoming official author-page candidates.
- Expanded same-host official author-page promotion on deterministic profile-name matches from NYT, Guardian, The Federalist, Ekathimerini, WHYY, The Nation, Rappler, News Diggers, Mother Jones, American Spectator, NPR, Premium Times, France24, National Post, Bloomberg, Responsible Statecraft, and Mexico News Daily.
- Tightened non-person byline filtering for source/team labels and pseudonymous section handles including `L'Equipe TV`, `The FRANCE 24 Observers`, `MND Plus`, `El Jalapeno`, `Contributing Writer`, and `FPA Obituary`.

**Live Results:**
- `cloudscraper` did not bypass Axios, Report.az, Bloomberg, or NewsNation 403/Cloudflare barriers from this environment. Those sources remain explicit backlog rows rather than false negatives.
- Verified reporter profiles reached 1,176. All verified rows have person-like names, public author pages, and official author-page citations.
- The eligible cohort is 1,771 reporters. Verified coverage is 1,039 reporters, or 58.67%, with a remaining 201-reporter shortfall to the 70% target.
- Mexico News Daily was re-run after the filter update and applied 7 person-like author pages. `MND Plus` and `El Jalapeno` remained unpromoted.
- Washington Times was not applied: after the anchor-label fix, the source exposed no reporter-matching article author pages and guessed `/by/` or `/profile/` URLs returned 404.

**Verification:**
- `PYTHONPATH=backend uv run python backend/scripts/verify_reporter_intelligence.py --audit-quality`: 1,176 verified reporters, 0 quality failures.
- `PYTHONPATH=backend uv run python backend/scripts/verify_reporter_intelligence.py --audit-profiles`: 0 profile quality failures.
- `PYTHONPATH=backend uv run python backend/scripts/verify_reporter_intelligence.py --audit-eligible-cohort --eligible-target-verified-percent 70 --eligible-top-sources 25`: expected non-zero while 70% coverage and zero likely/unmatched leakage remain unmet.
