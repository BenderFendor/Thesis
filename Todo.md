# Features to add

## Error Fixing: ChromaDB Connection Refused (Log Review)

## Page.tsx Regression Workflow
- [ ] Review commit `1eeee81` intent (what it tried to do)
- [ ] Critique the approach (notes for code review)
- [ ] `git checkout HEAD~1` (go one commit back)
- [ ] Re-implement fix with a new commit
- [ ] Primary error: `httpx.ConnectError: [Errno 111] Connection refused` when backend talks to ChromaDB (triggered in `app/services/clustering.py` at `assign_article_to_cluster` calling `self.vector_store.collection.get(...)`).
- [ ] Check ChromaDB is running (Docker: `docker ps`; local: `chroma run`).
- [ ] Verify host/port config (e.g., `CHROMA_SERVER_HOST`, `CHROMA_SERVER_HTTP_PORT`) matches where Chroma is actually listening.
- [ ] Test reachability: `curl http://localhost:8000/api/v1/heartbeat` (adjust host/port as configured).
- [ ] Fix log flooding: clustering loop continues after ConnectError for ~500 articles; add a preflight connectivity check and abort the batch early (or implement backoff + a single summarized error) to avoid massive repeated tracebacks.


---

## Phase 6: Trending & Breaking News Detection (COMPLETE)

Internal clustering + velocity-based trending/breaking detection using existing RSS data and embeddings.

### 6.1 Database Schema
- [x] Create `topic_clusters` table (id, label, centroid_embedding, first_seen, last_seen, article_count)
- [x] Create `article_topics` junction table (article_id, cluster_id, similarity, assigned_at)
- [x] Create `cluster_stats_daily` table (cluster_id, date, article_count, source_count)
- [x] Create `cluster_stats_hourly` table (cluster_id, hour, article_count, source_count) for 3h breaking detection
- [x] Add migration script for new tables (auto-created via SQLAlchemy)

### 6.2 Clustering Engine (Backend)
- [x] Implement article-to-cluster assignment using existing Chroma embeddings
- [x] Cluster creation/merging logic (new cluster if no match > threshold, merge if centroids converge)
- [x] Baseline calculation: trailing 7-day average per cluster
- [x] Trending score formula: window_volume / baseline * source_diversity * recency_weight
- [x] Breaking score formula: 3h_spike / baseline * (1 - prior_volume_factor) * recency_weight
- [x] Background task to update cluster stats hourly/daily
- [x] Measure thresholds from actual data (do not guess)

### 6.3 API Endpoints
- [x] GET `/api/trending?window=1d|1w|1m` - returns top clusters with scores + representative article
- [x] GET `/api/trending/breaking` - returns clusters with spike detection + representative article
- [x] GET `/api/trending/clusters/{id}` - cluster detail with member articles
- [x] GET `/api/trending/stats` - system statistics

### 6.4 Frontend UI
- [x] Trending section component (shows top 5-10 trending topics with scores)
- [x] Breaking news banner/section (shows 3h spikes if any)
- [x] Cluster detail view (click to see all articles in cluster)
- [x] Window selector UI (1d/1w/1m toggle for trending)
- [x] Integrate into main feed (toggle via sidebar)

### Phase 6B: GDELT Integration (FUTURE)
- [ ] Match GDELT entries to clusters by URL or embedding similarity
- [ ] Add `external_count` field to cluster scoring
- [ ] Use as coverage breadth signal, not primary ranking

---

## Phase 7: Multi-Source Story Comparison

Compare how different sources report the same story using the cluster detail modal.

### 7.1 ClusterDetailModal Enhancements
- [ ] Add "Compare Sources" tab alongside individual source tabs
- [ ] Side-by-side view showing 2-3 sources simultaneously
- [ ] Highlight differences in coverage (entities mentioned, framing, word choice)
- [ ] Show omission detection (what Source A mentions that Source B omits)
- [ ] Add tone/sentiment indicator per source (local sentiment analysis, no API)
- [ ] Show publication time delta between sources

### 7.2 Comparison Analysis (No LLM Required)
- [ ] Entity extraction diff (NER on both articles, show unique entities per source)
- [ ] Keyword frequency comparison (what terms each source emphasizes)
- [ ] Quote attribution diff (who does each source quote)
- [ ] Word count / depth comparison
- [ ] Visual diff highlighting using diff-match-patch library

### 7.3 UI for Comparison View
- [ ] Split-pane layout (left source vs right source)
- [ ] Middle column showing key differences summary
- [ ] Toggle between "full text" and "highlights only" mode
- [ ] Export comparison as markdown

---

## Phase 8: Dual View Organization (Source vs Topic)

Reorganize the main feed to support two primary views: by source and by topic (clustered).

### 8.1 View Toggle UI
- [ ] Add view mode toggle to GridView header (tabs or segmented control)
- [ ] "By Source" view (current behavior - articles grouped by source)
- [ ] "By Topic" view (articles grouped by cluster/topic)
- [ ] Persist view preference in localStorage

### 8.2 Backend: All Clusters Endpoint
- [ ] GET `/api/clusters?window=1d|1w` - returns all clusters (not just trending)
- [ ] Include cluster label, article count, source diversity, representative article
- [ ] Pagination support for large cluster counts
- [ ] Filter by minimum article count (exclude single-article clusters)

### 8.3 By Topic View Implementation
- [ ] Fetch all clusters for current time window (not just trending)
- [ ] Display clusters as expandable groups (like source groups)
- [ ] Show cluster label, article count, source diversity per group
- [ ] Expand cluster to show all member articles
- [ ] Click article opens ClusterDetailModal (multi-source view)

### 8.4 Trending/Breaking Integration
- [ ] Trending & Breaking section stays at top in both views
- [ ] In "By Topic" view, trending clusters are visually distinguished (badge/border)
- [ ] Breaking clusters get priority placement with alert styling

### 8.5 Cluster Card Design
- [ ] Cluster card shows representative article image
- [ ] Badge with source count (e.g., "5 sources")
- [ ] Keywords/tags displayed on card
- [ ] Recency indicator (newest article timestamp)
- [ ] Quick actions: add all to queue, compare sources

### 8.6 Blind Spots Analysis
Identify which perspectives are NOT covering a story.

- [ ] Add source metadata table (political_lean, region, type)
  - Political: left, center-left, center, center-right, right
  - Region: US, Europe, Asia, Middle East, Africa, Latin America, Oceania
  - Type: mainstream, alternative, wire_service, state_run, nonprofit
- [ ] Populate source metadata for existing sources in rss_sources.json
- [ ] Backend: Calculate coverage gaps per cluster
  - For each cluster, count sources by political lean and region
  - Identify which categories have zero coverage
  - Return as `blind_spots` array in cluster response
- [ ] Frontend: Display "Not covered by" indicator on cluster cards
  - Show missing political perspectives (e.g., "No right-leaning coverage")
  - Show missing regional perspectives (e.g., "No Asian media coverage")
  - Visual badge or expandable section
- [ ] Add blind spots summary to ClusterDetailModal
  - Full breakdown of coverage by category
  - Highlight gaps prominently

---

## Phase 5A: Globe + Country-Coded News (COMPLETE)

- [x] ISO country codes in rss_sources.json (already done)
- [x] `/news/by-country` endpoint for globe heatmap data
- [x] `/news/country/{code}` endpoint with Local Lens views (internal/external)
- [x] `/news/countries/list` for country article counts
- [x] `/news/countries/geo` for static lat/lng data
- [x] `countries.json` with 60+ country coordinates
- [x] `ThreeGlobe` component enhanced with intensity-based marker sizing/coloring
- [x] `LocalLensView` component for internal vs external news comparison

---

## Phase 5B: Reporter/Organization Research (COMPLETE)

### Database
- [x] Create `reporters` table (name, bio, leanings, confidence)
- [x] Create `organizations` table (name, parent, ownership, funding)
- [x] Create `article_authors` junction table

### Backend Agents
- [x] Implement ReporterProfiler agent (identity, career history, topics, leanings)
- [x] Implement FundingResearcher agent (ownership, 990 filings, SEC data)
- [x] Uses Wikipedia + ProPublica Nonprofit Explorer + known org data

### API Endpoints
- [x] Create `/research/entity/reporter/profile` endpoints
- [x] Create `/research/entity/organization/research` endpoints
- [x] Create `/research/entity/organization/{name}/ownership-chain` endpoint

### Frontend Components
- [x] Create `reporter-profile.tsx` with topics/leaning badges
- [x] Create `organization-panel.tsx` with ownership chain display

---

## Phase 5C: Material Interest Analysis (COMPLETE)

- [x] MaterialInterestAgent with trade relationships data
- [x] `/research/entity/material-context` endpoint
- [x] `/research/entity/country/{code}/economic-profile` endpoint
- [x] `material-context-panel.tsx` with conflict detection

---

# Backlog: Uncompleted Ideas (Todo + Devlogs)

## Feed & Navigation
- [x] Liked category tabs must filter feed results
- [x] Category filters driven by RSS feed categories
- [x] Sorting controls for feed (recency, source freshness)
- [x] Sort articles by recency (past week first, older after)
- [x] Sort sources by most current content (stale sources last)
- [x] Source favorites (sources only) + pin favorites to top
- [x] Source filter sidebar (select sources to view)
- [x] Group feed by source with preview list and expand
- [x] Fix article mismatch in grid view (wrong article opens)
- [x] Fix "Open in reader" action disabled (env var: NEXT_PUBLIC_ENABLE_READER_MODE)
- [x] Alert button not clickable (portal fix)
- [x] Leading story detection using open-source trending data (see Phase 6: internal clustering + velocity)

## Source & Article Views
- [x] Update source page for new backend
- [ ] Source modal shows reporter + human-readable date
- [x] Add Open Graph image fallback for unsupported sources
- [x] Improve RSS + image parsing (http/https, fallbacks)
- [ ] Fix image parsing for NYT and CNN
- [ ] Redesign article modal to match app UI
- [ ] Speed up full-article loading in modal/reader
- [ ] Hide placeholder images in article modal
- [ ] Avoid duplicate rendering when full article text already present

## Debugging & Logging
- [x] Add debug/user mode toggle on source/debug pages
- [x] Debug mode shows verbose logs; user mode hides them
- [x] Logger feature to toggle debug logs globally
- [ ] Define image parsing error taxonomy (no image, parse fail, display fail)
- [ ] Show image parsing errors in debug tooling
- [ ] Add RSS/article URL debug page with parsing breakdown
- [ ] Rename sources debug page to general debug page
- [ ] Show all Postgres + Chroma articles in debug mode
- [ ] Add startup timing breakdown (backend, RSS parser, Chroma init)
- [ ] Add log file for agentic debug + performance metrics

## Reading Queue + Reader UX
- [ ] Decide/implement liked vs bookmarked vs reading queue model
- [ ] Page to view liked and/or bookmarked articles (aligned to final model)
- [ ] Queue overview digest (AI summary of unread queue by theme)
- [ ] Reading digest UI update (importance + breaking focus)
- [ ] Inline term definitions on highlight
- [ ] Highlights + notes with centralized highlights tab
- [ ] Export highlights/notes to Obsidian markdown
- [ ] Clean reader view (Readability.js or equivalent)
- [ ] Speed reader mode
- [ ] Automatic tagging + topic filters
- [ ] Story clustering with multi-source summary
- [ ] Novelty score vs previously read content
- [ ] Preload full text + reading time + AI analysis on add-to-read
- [ ] Remove the "fact check" prompt under fact check results

## Research + Agent UX
- [ ] Unify Brief + Flow + Canvas into a single chat UI with expandable steps
- [ ] Preserve research chat memory/context across turns
- [ ] Redesign research sidebar (bulk delete, clearer layout)
- [ ] Consolidate redundant Search/Research entry points
- [ ] Replace or augment Gemini due to rate limits
- [ ] Add OpenRouter model selection in config
- [ ] Reduce background AI calls; audit what is computed/displayed
- [ ] Add verbose step-by-step progress updates during research
- [ ] Side-by-side narrative comparison UI (event diff)
- [ ] Event clustering by vector similarity + time window
- [ ] Gap analysis without LLM (diff + entity diff + sentiment)
- [ ] Add source credibility/political bias research agent
- [ ] Add reporter profile template to reduce token use
- [ ] Add reporter-to-article many-to-many linking
- [ ] Add reporter/org graph visualization (network view)
- [ ] Enforce English Wikipedia sources when available

## Global News + Local Lens
- [ ] Globe interaction polish (zoom, hover UI, reduced lag)
- [ ] Add dataset overlays (press freedom, ownership, coverage diversity)
- [ ] Add globe toggle for "news volume" vs overlay data
- [ ] Add Local Lens context tab with static dataset info
- [ ] Expand global source coverage (one strong source per country/region)

## Funding + Ownership Research
- [ ] Add ownership/funding force-directed graph
- [ ] Integrate LittleSis data for power networks
- [ ] Integrate OpenSecrets lobbying/PAC data
- [ ] Integrate ProPublica Nonprofit Explorer 990 data
- [ ] Integrate SEC EDGAR ownership data
- [ ] Add conflict-of-interest flagging based on ownership + article topics

## Material Interest Research
- [ ] Add OEC and/or UNCTAD data ingestion
- [ ] Add resource map agent for conflicts/trade stories
- [ ] Add historical context snippets by country/topic
- [ ] Add beneficiary table (stability vs instability)
- [ ] Add commodity price trend callouts when relevant

## UI/UX Polish
- [ ] Redesign loading screen
- [x] Fix notification panel transparency and make notifications useful
- [ ] Replace icon pack / typography
- [ ] Add tooltips/popovers to explain controls
- [ ] Improve list typography + hover expand for descriptions
- [ ] Add smooth but minimal scroll/transition animations
- [ ] Remove redundant UI (duplicate Index, hide/show deck, desk feature)
- [x] Move source debug + research to header bar
- [x] Remove or repurpose Settings/Profile for local-only app
- [ ] Add favicon
- [ ] Enforce no-emoji UI policy in frontend

## Cluster Label Improvement
- [ ] Improve auto-generated cluster labels (current labels like "Afridi Hold Rally", "Korea Drone Claims" are awkward)
- [ ] Options to explore:
  - Lightweight LLM (250M params) to generate readable titles from keywords + representative headline
  - Rule-based approach: extract subject + verb + object from representative article title
  - Use representative article title directly if label quality is low
  - Backend: add `label_quality` score, regenerate low-scoring labels with LLM
- [ ] Keep latency minimal - labels should generate during clustering, not on-demand

## Performance + Infra
- [ ] Investigate slow startup; measure and add Server-Timing header
- [ ] Migrate RSS ingestion to Rust (feed_rs + tokio + pyo3/maturin)
- [ ] Consider broader Rust backend migration after ingestion
- [ ] Debug RSS ingestion locally without Docker
- [ ] Add backend tests
- [ ] Add static code analysis

## Docs + Cleanup
- [ ] Update README to match current setup
- [ ] Remove legacy v0/deployment references from docs



# Search Methodology & Tool Implementation Guide

Here's the technical breakdown of how I approached researching Julia Conley, which you can translate into your Reporter Agent's search logic:

## 1. **Query Architecture (Layered Search Strategy)**

I used a **4-layer cascading search** approach, each with specific query patterns:

### **Layer 1: Identity & Contact**
```python
# Query templates
queries = [
    f"{reporter_name} journalist site:linkedin.com",
    f"{reporter_name} {outlet_name} staff writer",
    f"{reporter_name} Twitter/X",
    f"{reporter_name} Muck Rack profile",
    f"{reporter_name} email contact"
]
```
**Priority**: Direct self-reported sources (LinkedIn, Twitter bio, official outlet bio)

### **Layer 2: Career Timeline**
```python
queries = [
    f"{reporter_name} {outlet_name} biography history",
    f"{reporter_name} PBS Bill Moyers",  # specific past employer from Layer 1
    f"{reporter_name} Al Jazeera America producer",
    f"{reporter_name} documentary filmmaker"
]
```
**Logic**: Once I found "Bill Moyers" in initial results, I drilled down on that specific employer to verify dates and roles.

### **Layer 3: Organizational Funding**
```python
queries = [
    f"{outlet_name} nonprofit 990 funding",
    f"{outlet_name} Media Bias Fact Check",
    f"{outlet_name} foundation donors",
    f"{outlet_name} Wikipedia ownership"
]
```
**Key Find**: Common Dreams' 990 form (EIN: 20-3368194) revealed exact revenue ($1.57M) and donor count.

### **Layer 4: Content & Bias Analysis**
```python
queries = [
    f"{reporter_name} Gaza Israel articles",
    f"{reporter_name} union labor coverage",
    f"{reporter_name} site:commondreams.org climate",
    f"{outlet_name} political bias rating"
]
```
**Technique**: Sample 5-10 recent articles, extract keywords for topic modeling.

---

## 2. **Source Reliability Hierarchy**

I prioritized sources in this order for your Postgres `reporters` table `bio_summary` field:

| Tier | Source Type | Trust Score | Example |
|------|-------------|-------------|---------|
| **T1** | Self-reported, verified | 10/10 | LinkedIn, official bio, Twitter |
| **T2** | Professional directories | 8/10 | Muck Rack, Journalistfolio |
| **T3** | Third-party bias raters | 7/10 | MBFC, AllSides, Ad Fontes |
| **T4** | Wikipedia | 6/10 | Only if well-cited |
| **T5** | Article content inference | 5/10 | Requires >20 samples |
| **T6** | Social media behavior | 4/10 | Retweet patterns, follows |

**Rule**: Only use T5/T6 if T1-T3 are absent.

---

## 3. **Radar Chart Scoring Algorithm**

Here's the **quantitative framework** for your `leanings_json` field:

```javascript
// Scoring rubric (0-10 per axis)
{
  "pro_labor": {
    "calculation": "(labor_articles / total_articles) * 10 + sentiment_boost",
    "sentiment_boost": "+2 if pro-union language, -2 if corporate framing",
    "julia_score": 9,  // 14/15 sampled articles were pro-labor
    "evidence_keywords": ["union victory", "worker rights", "corporate greed"]
  },
  "anti_imperialist": {
    "calculation": "coverage_of_us_foreign_policy + framing_score",
    "framing_score": "+3 for 'war crimes' language, +2 for ICJ citation",
    "julia_score": 9,  // Consistent pro-Palestinian framing, anti-US intervention
    "evidence_keywords": ["ICJ ruling", "UNRWA", "ethnic cleansing"]
  },
  "anti_establishment": {
    "calculation": "critiques_of_both_parties + alt_media_positioning",
    "outlet_boost": "+2 if outlet explicitly anti-mainstream media",
    "julia_score": 9,  // Common Dreams markets as "corporate media alternative"
  },
  "progressive_populist": {
    "calculation": "people_vs_elites_framing + wealth_inequality_focus",
    "julia_score": 8,  // Frequent "rich vs poor" narratives
  }
}
```

**Implementation**: Your Llama 3.1 agent should extract these keywords and calculate scores automatically.

---

## 4. **Funding Independence Score (for `organizations` table)**

```python
def calculate_funding_independence(org_name):
    # Search for 990 forms, foundation grants
    grants = search_foundation_grants(org_name)
    small_donations = search_reader_donations(org_name)
    
    if grants is None:  # No data
        return None
    
    total_revenue = grants['total']
    foundation_pct = grants['foundation_amount'] / total_revenue
    
    if foundation_pct < 0.1 and small_donations > 10000:
        return 10  # Fully independent
    elif foundation_pct < 0.3:
        return 8   # Mostly independent (Common Dreams)
    elif foundation_pct < 0.6:
        return 5   # Mixed funding
    else:
        return 2   # Foundation-dependent

# For Common Dreams: foundation_pct = 0.25 → Score: 8
```

---

## 5. **When Primary Sources Are Missing**

If no LinkedIn/Wikipedia exists (common for less known reporters):

1. **Byline Extraction**:
   ```python
   # Scrape author page on outlet
   author_page = fetch_url(f"{outlet}/author/{reporter_slug}")
   bio_text = extract_byline(author_page)
   # Parse for past employers, location, focus areas
   ```

2. **Article Topic Modeling**:
   ```python
   articles = fetch_recent_articles(reporter_name, count=20)
   topics = extract_keywords(articles, top_n=5)
   # Returns: ['Gaza', 'unions', 'climate', 'immigration', 'wealth inequality']
   ```

3. **Social Network Analysis**:
   ```python
   twitter_data = fetch_twitter_profile(handle)
   following = get_following(twitter_data)
   # If following @BernieSanders, @AOC → leftist leaning
   retweets = get_recent_retweets(twitter_data)
   # Analyze retweeted sources for bias confirmation
   ```

4. **Default Filler**:
   ```sql
   INSERT INTO reporters (bio_summary) 
   VALUES ('Limited public information; profile built from article analysis');
   ```

---

## 6. **Database Population Workflow**

```python
# Pseudocode for your profiler agent queue
def process_reporter(reporter_name, outlet_name):
    # Step 1: Check if exists
    if reporter_exists(reporter_name):
        return
    
    # Step 2: Run layered searches
    identity_data = search_identity_layer(reporter_name, outlet_name)
    career_data = search_career_layer(reporter_name)
    org_data = search_organization_layer(outlet_name)
    content_data = search_content_layer(reporter_name, outlet_name)
    
    # Step 3: LLM extraction (your Llama 3.1 8B step)
    prompt = f"""
    Read these snippets about {reporter_name}:
    Identity: {identity_data}
    Career: {career_data}
    Content Topics: {content_data['topics']}
    
    Extract:
    1. Past employers (list with dates)
    2. Top 5 frequent topics (keywords)
    3. Labor vs Capital framing (score 0-10, pro-labor)
    4. Funding independence (score 0-10)
    5. Establishment distance (score 0-10)
    
    Output JSON only.
    """
    
    llm_output = llama_31_generate(prompt)
    
    # Step 4: Insert to Postgres
    insert_reporter_to_db(reporter_name, llm_output, org_data)
    
    # Step 5: Generate radar chart coordinates
    radar_data = calculate_radar_scores(llm_output)
    return radar_data
```

---

## 7. **Rate Limiting & Source-Specific Tools**

- **LinkedIn**: Requires login (use Proxycurl API or scrape with Selenium)
- **Twitter/X**: Need API tier 1 or Nitter scraper
- **Foundation Grants**: Search ProPublica Nonprofit Explorer API
- **MBFC**: Simple HTML scrape (`mediabiasfactcheck.com/{outlet}`)
- **Wikipedia**: MediaWiki API (`action=parse`)

**Your 3060 with Ollama**: Batch process 5-10 reporters at once. Each LLM call takes ~2-3 seconds with 8B model.

---

## 8. **Confidence Scoring**

Add a `confidence` field to your `reporters` table:

```sql
ALTER TABLE reporters ADD COLUMN confidence DECIMAL(3,2);

-- 1.00 = T1 sources verified
-- 0.75 = Mix of T2/T3
-- 0.50 = T5/T6 only (inferred)
-- 0.25 = Minimal data
```

For Julia Conley: **0.90** (T1 sources + verified 990 + extensive article samples)

---

This methodology gives you a deterministic pipeline: search → extract → score → store → visualize. The key is **layered fallback**: always try high-confidence sources first before inferring from content.

# Really adding this
Ok so each one of this should be a phase and have there own development.

Idk where to start but like it should be broken down to like 1 - 5 stages for each one so like one for the globe view etc.

But when you look at it. Is the globe view and then like 5 different agents for like different taks so that is what is similar and different about each.

## News from different parts of the world.
*What I mean here is having the global feature world and show show news from around the world.*

So like you have each country and then you can like click on it to view news there and what is happen their and get like a global out look as well.

So with the current globe it is just a 3D global without article mapping.

So with this I should get a static dataset like Reporters without borders *I need better more critically sources but for know this will have a western bias lowkey*

- Show users **WHY** a reporter got a certain bias score
    
- Publish your training data and feature weights

For like Press Freedom Overlay *im not a fan of this there has to be a more like marxist emparical thing but for now it can be a filler*

these critical alternatives:

- **Media Ownership Monitor (EurOMo)**

- - EU-funded but transparent methodology, tracks 3,000+ outlets
    
- **Media Cloud** (Harvard/MIT) - Multi-lingual, tracks actual coverage diversity, not just "freedom" scores
    
- **LittleSis.org** - Already in your plan, tracks power networks, not liberal "freedom" metrics
    
- **GDELT Project**
    
- **MASSIVE** open dataset: 215 years, 2.5TB/year, 100+ languages, tracks **actual events** not press freedom hypotheticals

Maybe it could have a local lens feature. Showing how the world views the country vs how the country views itself.

**The "Local Lens" Feature:** Simple SQL filter.
    Examples
- _View 1 (Internal):_ `SELECT * FROM articles WHERE country_code = 'CN' AND source_origin = 'CN'` (What China says about China).
        
- _View 2 (External):_ `SELECT * FROM articles WHERE country_code = 'CN' AND source_origin != 'CN'` (What the West/others say about China).

On the UI we could have heatmaps so instead of just having a market color the global based on new intensity which can be volume of recent vectors covering that region.

*Just put the location into the source so we don't have to like dynamically get it saves resources *
## Reporter / source research like wiki pages.

So for the reporters it does research on them using agentic research makes an information page about them then saves that to the database as an a part of the like reporters database. It then can like make graphs to other reporters say by their leanings political or funding or for what plan they report.

This should be like a template that is fulled in to save on tokens and to have some style and uniformity.

So I need on the database side to make a reporters and organizations table / that could just be gotten from the sources table from the organizations part.

Wikipedia could be really useful here so having a Wikipedia tool to search as one of the options is good.

The search query should have the reporters name and the source they are reporting on to make sure it gets the right person. Most new sources also have some reporter information like page if you click it so that is also an option.


Take this and link articles to thesis entites via many-to many relationships *idk what that is* maybe using like a obsidian like graph view type thing.

### Reporter Agent
So this agentic gets a reporters profile.

So look at anything about the reporter so like linkedln twitter/muckrock *Wikipedia if you can get it etc* good credible sources. Use snippets and execepts to help build the profile on the reporter.

Try to find politcal biases funding, history etc as important infomation to get on the reporters.

Having a leangs rador charat: a visual graph plootting them on some axes like soical liberal vs conservative ,leftist , marxist idk stuff like that.

Funding web so how their funded by employer get the from the organization graph and if that have any other funding.

Also if you can't find any like wikis or other sources on them, you can also base your anaylsis on their arctiles themselves and or soical media like twitter / x.

- **Database Schema (Postgres):**
    - You don't need a graph DB. You need three standard tables:
        
        1. `reporters` (id, name, bio_summary, leanings_json)
            
        2. `organizations` (id, name, parent_company, ownership_type)
            
        3. `article_authors` (junction table linking articles to reporters)
            
- **The "Profiler" Agent (Local LLM):**
    - **Trigger:** When a new author appears, add a job to a queue.
        
    - **Agent:** Use **Llama 3.1 8B (Quantized)** running locally on your 3060 via **Ollama**. It fits easily in VRAM.
        
    - **Task:** "Read these 5 snippets about [Reporter]. Extract: 1. Past Employers. 2. Frequent Topics. 3. Estimated political framing (Labor vs Capital)."
        
- **Uniform Template:**
    - **Radar Chart:** Use a React charting library (`Recharts`). Axes: _Pro-Labor_, _Anti-Imperialist_, _Establishment_, _Populist_.
        
    - **Career Timeline:** A simple visual line showing `Guardian -> BBC -> Independent`.
![[Reporter agent idea]]
## Funding reports. So how does the source get there funding what is there backing etc.
So things like public records,tax fillings and donor list that are legally available for key organizations, involved in news story, Taking like NGOs,Loggyist,politcal action committess,Show simple visuiualations of their funding strcuture.

Get a corpate tree to reveal conflicts of internet.

Making an agentic to search for who owns x source or major shhareholders of x parnet company , board members of x ngo.

Look for 10-k fllings if publuc or about us donor ngos if NGO.

Make a force-direct graph using a libary like react-force graph on the front end. Nodes: the news outlets -> parent company -> holding company -> major shareholders/CEOS

Edges: Label with "Ownership %" or funding amount if avabile..

Conflict of interest flagging.

If an article discusses "Oil Prices" and the source is owned by a conglomerate heavily invested in fossil fuels, the UI should trigger a "Potential Conflict of Interest" badge automatically based on the graph data.

**LittleSis (Oppositional Research):** This is the "Marxist/Critical" alternative to standard corporate data. They track power networks, lobbyists, and corporate influence. They have an API/Data dumps. Use this to populate your `organizations` table.

**Better than LittleSis?** LittleSis IS your leftist alternative. But add:

- **OpenSecrets.org** - Tracks lobbying, PAC money, dark money networks
    
- **ProPublica Nonprofit Explorer** - 990 filings for nonprofit news orgs
    
- **SEC EDGAR API** - For public company ownership

- **Visualization (Force-Directed Graph):**
    
    - Use `react-force-graph` on the frontend.
        
    - **Nodes:** The Outlet (CNN) -> Parent (Warner Bros. Discovery) -> Major Shareholders (Vanguard, Blackrock).
        
    - **Material Logic:** If the parent company has board members who also sit on Defense Contractor boards (cross-referenced via LittleSis data), add a specific edge styled in Red labeled "Conflict Link."
        
- **Conflict Flagging System:**
    
    - **Logic:** Simple keyword intersection.
        
    - IF Article contains "Strike" OR "Union"
        
    - AND Source Owner = "Anti-Union Lobbyist" (from DB)
        
    - THEN show Badge: "Potential Conflict: Ownership Interest."

```python
# Don't just check keywords, check against material interests
def flag_conflict(article, source_owner):
    article_topics = extract_topics(article)  # Use NER + GDELT themes
    
    # Check against owner's business interests
    owner_interests = get_business_interests(source_owner)  # From OEC, SEC filings
    
    # Material conflict, not just lexical
    overlap = article_topics.intersection(owner_interests)
    if overlap:
        return {
            "severity": calculate_severity(overlap),  # High if direct profit motive
            "explanation": f"Owner profits from {overlap}",
            "sources": ["SEC filing", "OEC trade data"]
        }
```

## Interactive Research
*Side-by-Side Comparison:** A view mode that lets users compare how two different news sources (e.g., a Western source vs. a Chinese source) covered the _exact same_ event at the same time.


**Concept:** A "Diff View" for narratives.

- **Event Clustering (Backend):**
    
    - You need a robust way to identify that Article A (CNN) and Article B (Al Jazeera) are about the _exact same event_.
        
    - Use **Time-Bounded Vector Similarity**: Search ChromaDB for vectors with >0.85 similarity published within a 24-hour window of the target article.
        
- **The comparison UI:**
    
    - **Split View:** Left and Right panes.
        
    - **The "Gap Analysis" (AI Generated):** A middle column that explicitly lists: *Maybe I would like something that doesn't need an API call if needed.*
        
        - **Omission Check:** "Source A mentioned the protest count, Source B omitted it."
            
        - **Diction Diff:** "Source A used the word 'Riot', Source B used 'Demonstration'."
            
        - **Framing:** "Source A focused on property damage, Source B focused on police response."
*Without AI*
**Goal:** Compare narratives on the _exact same event_.

- **Event Clustering (Backend - ChromaDB):**
    
    - You need to find the "Same Event."
        
    - **Query:** Fetch vector of Article A. Search ChromaDB for vectors with `> 0.85 similarity`.
        
    - **Time Filter:** strictly within `± 24 hours`.
        
    - **Source Filter:** strictly `source != current_source`.
        
- **The Gap Analysis (No API Cost):**
    
    - **Visual Diff:** Don't use an LLM for everything. Use a library like `diff-match-patch` to highlight text that is _identical_ (boilerplate) vs text that is _unique_ (framing).
        
    - **Entity Diff:** Extract Named Entities (People, Places) from both.
        
        - _Result:_ "Al Jazeera mentions [Casualty Count]. CNN omits [Casualty Count]."
            
    - **Tone Analysis:** Use a local sentiment library (like `VADER` or `TextBlob` - runs on CPU instantly). Compare Score A vs Score B.
## Material interest reports of say like on going conflicts could be useful.

This is something that could be a feature where you like use the agentic search to look at say a the civil war in sudan look at the matieral interest so like the UAE and gold and the / cross and source that infomation with the other like social or politcal interesnt / plus say historial context that would be needed in as netural of a tone as

### 5. Material Interest Reports (Cui Bono?)

_Current limitations: General bias analysis, but lacks economic/materialist depth._

*This can use chromadb*

Load the CIA Factbook JSON into Postgres. It maps Countries -> Commodities (e.g., Sudan -> Gold, Oil). *Can we get something along side this like something more leftist marxist factual not by the us goverment idk*

 Use **OEC (Observatory of Economic Complexity)** data. It is empirical trade data.

**UNCTAD** (UN Conference on Trade & Development) - Commodity data without US bias

*This is way better*

Download their country profiles (CSV). When a user clicks "Sudan," show: "Top Export: Gold ($X Billion). Top Destination: UAE." This is neutral, hard economic data that contextually explains conflicts.

**Concept:** An analysis layer focused strictly on resources, commodities, and strategic geography.

- **The "Resource Map" Agent:**
    
    - When a conflict or geopolitical event is analyzed, this specific agent runs a check against a list of strategic resources (Oil, Lithium, Gold, Rare Earths, Trade Routes/Canals).
        
    - **Prompt Strategy:** "Analyze the region of [Region]. List major natural resources, pipelines, or shipping lanes. Cross-reference these with the nations or corporations intervening in the news story."
        
- **Historical Context Layer:**
    
    - Often news ignores history. This agent should specifically query: "Post-colonial history of [Region]" or "Previous conflicts over [Resource] in [Region]."
        
- **Output Format:**
    
    - **Beneficiary Table:** A structured list answering "Who benefits from stability here?" vs "Who benefits from instability?"
        
    - **Commodity Tickers:** If the news affects a specific resource (e.g., Semiconductor supply chain), show the relevant commodity price trend next to the news.

**Goal:** An automated "Who benefits?" report.

- **The "Resource Map" Agent:**
    
    - **Data:** Pre-load a Postgres table with "Strategic Resources" by country (using OEC data).
        
    - **Trigger:** If article topic = "Conflict" or "Trade Deal."
        
    - **Workflow:**
        
        1. Extract Country (e.g., "DRC").
            
        2. Query Postgres: "What are top resources in DRC?" -> _Cobalt, Copper._
            
        3. Query Database: "Which corporations mentioned in the article trade in Cobalt?"
            
    - **Output:** A simple "Material Context" sidebar.
        
        - "Strategic Resource: Cobalt (Electronics supply chain)."
            
        - "Price Trend: +5% this month." (Fetch from a free finance API).
            
- **Historical Context Layer:**
    
    - **Concept:** Prevent "History started yesterday" bias.
        
    - **Implementation:** A pre-written "Context Snippet" database.
        
        - If Country = "Haiti", retrieve snippet: "Independence 1804, French Indemnity Debt..."
            
        - Inject this into the context window of your Chatbot so it knows the history before answering user questions.
