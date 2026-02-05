# Active TODOs

---

# Completed

## ChromaDB Connection Fix (COMPLETED 2026-01-29)
- [x] Add `is_chroma_reachable()` lightweight preflight check
- [x] Add `check_chroma_health()` function for monitoring
- [x] Implement connection backoff mechanism (5s initial, 2x multiplier, 5min max)
- [x] Add log throttling - only log every 5th failure to prevent flooding
- [x] Track connection state: `_last_connection_attempt`, `_failed_attempts`, `_connection_backoff_until`

## Modal Reader Unification + Highlights Sync (COMPLETED 2026-01-29)
- [x] Remove `frontend/app/reader` route directory (already removed/not present)
- [x] Add local-first highlight store module (`frontend/lib/highlight-store.ts`)
- [x] Implement sync engine for highlights (load local → merge with server → persist) in `ArticleDetailModal`
- [x] Refactor HighlightToolbar to be UI-only with callbacks (`onCreate`, `onUpdate`, `onDelete`)
- [x] Add sync status indicator UI in ArticleDetailModal (shows "Saving", "Offline", "Failed", "Synced")

# Completed Phases

## Phase 5A: Globe + Country-Coded News (COMPLETE)
- ISO country codes in rss_sources.json
- `/news/by-country` endpoint for globe heatmap
- `/news/country/{code}` endpoint with Local Lens views
- `countries.json` with 60+ country coordinates
- `ThreeGlobe` component with intensity-based markers
- `LocalLensView` component

## Phase 5B: Reporter/Organization Research (COMPLETE)
- `reporters`, `organizations`, `article_authors` tables
- ReporterProfiler and FundingResearcher agents
- API endpoints for reporter/organization research
- `reporter-profile.tsx` and `organization-panel.tsx` components

## Phase 5C: Material Interest Analysis (COMPLETE)
- MaterialInterestAgent with trade relationships
- `/research/entity/material-context` endpoint
- `/research/entity/country/{code}/economic-profile` endpoint
- `material-context-panel.tsx` component

## Phase 6: Trending & Breaking News Detection (COMPLETE)
- Database schema for topic clusters and stats
- Clustering engine with velocity-based scoring
- API endpoints: `/api/trending`, `/api/trending/breaking`, `/api/trending/clusters/{id}`
- Frontend: Trending section, Breaking banner, Cluster detail view

## Frontend Performance (COMPLETED 2026-01-22)
- Dynamic imports for GlobeView, ThreeGlobe, VirtualizedGrid
- Early-exit memoization for sourceRecency
- Fixed filteredNews dependency array

---

# Backlog / Future Ideas

## Phase 6B: GDELT Integration (COMPLETED 2026-01-29)
- [x] Created `GDELTEvent` database table for storing GDELT events
- [x] Added `external_count` field to `ClusterStatsDaily` and `ClusterStatsHourly`
- [x] Created `GDELTIntegration` service with URL and embedding matching
- [x] Created GDELT API endpoints: `/gdelt/sync`, `/gdelt/cluster/{id}`, `/gdelt/stats`, `/gdelt/recent`
- [x] Updated trending/breaking scoring to include external_count (5% per event)
- [x] Added topic aggregation trigger in `/api/trending/clusters` when no clusters exist

## Phase 7: Multi-Source Story Comparison (COMPLETED 2026-01-29)
- [x] Add "Compare Sources" tab to ClusterDetailModal
- [x] Side-by-side view for 2-3 sources with content preview
- [x] Entity extraction and comparison (persons, organizations, locations, dates)
- [x] Keyword frequency comparison with visual bar charts
- [x] Visual diff highlighting (similar sentences, unique content)
- [x] Comparison service with text similarity calculation
- [x] API endpoint: `POST /compare/articles`

## Phase 8: Dual View Organization (COMPLETED 2026-01-29)
- [x] View mode toggle (implemented)
- [x] GET `/api/clusters?window=1d|1w` endpoint (implemented)
- [x] By Topic view with auto-aggregation when empty (implemented)
- [x] Blind spots analysis with source metadata table
- [x] Source coverage tracking and gap identification
- [x] Topic-level blind spots with severity ratings
- [x] Daily coverage statistics per source
- [x] Coverage report with source rankings

## Feed & Navigation
- [ ] Fix image parsing for NYT and CNN
- [ ] Redesign article modal to match app UI
- [ ] Speed up full-article loading in modal

## Debugging & Logging
- [ ] Show all Postgres + Chroma articles in debug mode
- [ ] Add log file for agentic debug + performance metrics

## Reading Queue + Reader UX
- [x] Finalize liked vs bookmarked vs reading queue model
- [x] Page to view liked/bookmarked articles
- [ ] Queue overview digest
- [ ] Highlights + notes with centralized tab
- [ ] Export highlights/notes to Obsidian markdown

## Research + Agent UX
- [ ] Unify Brief + Flow + Canvas into single chat UI
- [ ] Preserve research chat memory
- [ ] Add OpenRouter model selection
- [ ] Side-by-side narrative comparison UI
- [x] Source credibility/political bias fields (integrated into SourceMetadata)

## Global News + Local Lens
- [ ] Globe interaction polish
- [ ] Add dataset overlays
- [ ] Expand global source coverage

## Funding + Ownership Research
- [ ] Add ownership/funding force-directed graph
- [ ] Integrate LittleSis, OpenSecrets, ProPublica, SEC EDGAR
- [ ] Conflict-of-interest flagging

## UI/UX Polish
- [ ] Redesign loading screen
- [ ] Replace icon pack / typography
- [ ] Add smooth scroll/transition animations
- [ ] Enforce no-emoji UI policy

## Performance + Infra
- [ ] Investigate slow startup
- [x] Migrate RSS ingestion to Rust
- [ ] Add backend tests
- [ ] Update README

---

# Done - Feed & Navigation
- Category tabs filter feed results
- Category filters driven by RSS feed categories
- Sorting controls for feed
- Sort articles by recency
- Sort sources by most current content
- Source favorites + pin to top
- Source filter sidebar
- Group feed by source with preview list
- Fix article mismatch in grid view
- Fix "Open in reader" disabled
- Alert button not clickable fix
- Leading story detection

# Done - Source & Article Views
- Update source page for new backend
- Source modal shows reporter + date
- Open Graph image fallback
- Improve RSS + image parsing
- Hide placeholder images
- Avoid duplicate rendering

# Done - Debugging & Logging
- Debug/user mode toggle
- Logger feature toggle
- Image parsing error taxonomy
- Show image parsing errors in debug
- RSS/article URL debug page
- Rename sources debug page
- Startup timing breakdown

# Done - UI/UX Polish
- Fix notification panel transparency
- Add tooltips/popovers
- Improve list typography
- Move source debug + research to header
- Remove/repurpose Settings/Profile
- Add favicon
