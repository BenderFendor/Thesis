# Log

## 2026-03-07: RSS Country Coverage Expansion And Ownership Labels

**Problem:** The RSS catalog had large country blindspots across the global south, especially parts of South America, Africa, the Middle East, Central Asia, and smaller Caribbean and Pacific states. It also lacked a compact ownership label in the source JSON, which made it harder to contrast state, private, nonprofit, and independent outlets when handing the catalog to an LLM.

**What Changed:**
- Added `ownership_label` support in `backend/app/data/rss_sources.py`, `backend/app/models/news.py`, `backend/app/api/routes/news.py`, `backend/app/api/routes/sources.py`, and `backend/app/services/rss_ingestion.py` so source metadata now carries a compact ownership classification alongside `funding_type` and `bias_rating`.
- Expanded `backend/app/data/rss_sources.json` with 63 vetted English-language RSS sources across Israel, Iran, Pakistan, Malaysia, Nigeria, Kenya, Tanzania, South Africa, Fiji, Peru, Guyana, Jamaica, Trinidad and Tobago, Belize, Barbados, Antigua and Barbuda, Saint Lucia, Saint Vincent and the Grenadines, Dominica, Grenada, Libya, Yemen, Iraq, Oman, Qatar, Kuwait, Morocco, Saudi Arabia, Ghana, Uganda, Zambia, Zimbabwe, Malawi, Namibia, Liberia, South Sudan, Gambia, Rwanda, Lesotho, Somalia, Mozambique, Botswana, Armenia, Azerbaijan, Bhutan, Georgia, Kyrgyzstan, Cambodia, Sri Lanka, Maldives, Papua New Guinea, Tonga, Tajikistan, and Uzbekistan.
- Added `ownership_label` to mocked RSS fixtures in `backend/tests/conftest.py` so tests using source mocks keep the new metadata shape.
- Added both contrast pairs and new domestic anchors where possible, including `Haaretz` + `Jerusalem Post` for Israel, `IranWire` next to existing Iran feeds, `Oman Observer` + `Muscat Daily`, `Qatar News Agency` + `Doha News`, `Ghanaian Times` + `MyJoyOnline`, and `ANDINA` + `Peru Reports`.

**Verification:**
- Re-fetched and parsed a broad candidate set with live XML checks; 55 of 56 tested candidate feeds returned non-empty RSS/Atom successfully, with `The Kathmandu Post` rejected due to malformed XML.
- Verified the updated JSON still loads cleanly with Python `json.load`, and all entries still contain the core fields `url`, `category`, `country`, `funding_type`, and `bias_rating`.
- Confirmed `ownership_label` is now present on all newly added entries.
- `./verify.sh` passes after the catalog expansion and metadata plumbing.
- Country coverage in `rss_sources.json` increased to 94 country buckets.

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
