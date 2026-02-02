# Log

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
