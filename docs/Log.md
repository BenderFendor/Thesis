# Log

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
