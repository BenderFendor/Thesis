# Features to add

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


# Add the feature so that when you like on one of the tabs like games or business it truly changes what new articles show up

# Source debugging

Also update the source page to work with the new backend and add a like toggle for debugging mode and user mode and have it so that you can debug mode has all the console.log prints and all those debugging like meals then those are removed when your in user mode so the end user doesn't have hella things on the screen

improve thie to work with the new backend

# Image source debugging

For this Im thinking we have to add like errors for parsing but what type of error. Like image found but not parsedable by frontend. No images in the json/source at all. Images founded and we can use them but it still doesn't any us to display them idk why?

<https://forum.kustom.rocks/t/help-me-get-images-from-google-news-rss-feed/7173> may help here

# Add a logger feature

So it like turns the debug print logs off or on

# RSS and Image Parsing

I need a more robust image parsing and also some that can get the images and load them when they are http or https

Also for the rss and image parsing I should make a debug menu or page that I can like just input an rss feed or input an article url and see how the backend parses it and it like gives me a breakdown of how the rss and even the page url and article are being parsed.

# Sources that don't get their images parsed right at the moment

New york times and CNN

# Features to add

## Add Static code anylsis as well

## Add a feature for like your favorite / most important new sources

so you have like your favorites at the top of your feed and the other at the bottom past those favorites.

## Have a sidebar that shows all the sources you have current as well so you can like select just those sources and see jus tthose sources

It is like this feature of having news from only some sources like a selection thing.

## Also with new sources and articles

Show aritcles for the past week first then older articles from like the last month or years back last. also I would like it if like has the sources that are most current first so like if a source only has 2023 show that at the end of the feed not the top.

# for the sources

FOr the faviorts sources there should be a sleection for sources and it should be like a sidebar with the list of sources and like you can view those sources

# Add a feature to research the author of an article

give like an overview background facts that could should their baises and leanings etc.

# Add a feature to see liked and bookmarked articles

also what is the difference between the two and do I need both like and bookmarked

Im thinking you use like for getting recs for articles and bookmarks for saving articles but the yoiu have the reading queue which I guess after you read get put in the the read part of that and idk I feel like I can combined this features into like 2 or 1 so just like reading queue plus likes or something idk

# For favorites

That should only be for sources not articles themselves.

# This should be removed

The fact check under that fact check results that just tells you to fact check stuff.

# For the aritcle to read (Making reading articles easier)

This is for the reading queue itself

Category 1: Triage & Prioritization (Helping the User Decide What to Read First)

These features help the user quickly assess the 20-article queue and decide where to start, or what to skip.

## Queue Overview Button

**UX:** This is the ultimate "boss level" feature. The user doesn't even open the queue. They have a setting to "Receive a reading Digest."

- This "article" is AI-generated. It synthesizes all 20 (or however many) articles in their queue into a cohesive, skimmable newsletter, complete with headlines, summaries of each theme, and links to the source articles if they want to dive deeper.
- It fetches all unread articles for a user.
- It performs the "Story Clustering" logic (Category 1) to find themes.
- It then uses a series of complex LLM prompts:  
  - "First, summarize these 5 articles on AI. Now, summarize these 3 on finance..."
- A final prompt combines everything:  
  - "You are a personal research assistant. Create a 'Daily Briefing' email for your boss based on the following summaries. Adopt a professional, informative tone. Group the insights by theme. Here are the summaries: [insert all summaries here]..."

---

### In-line Context & Definitions

**UX:** While reading, the user comes across a name they don't know ("Janet Yellen") or a concept ("quantitative easing"). They can double-tap or highlight the term. A non-intrusive pop-over appears with a one-paragraph, AI-generated definition. This keeps the user in the "flow" of reading, preventing them from opening a new tab to Google it.

**Tech:**  

- Combines a simple UI event listener (for the highlight) with an LLM call.
- Prompt:  
  - "The user is reading an article. They highlighted the term '[HIGHLIGHTED_TEXT]'. Provide a brief, one-paragraph explanation of this term in the context of [article's main topic, e.g., 'US economics']."

---

### Digital Highlighter & Centralized Notes

**UX:** As the user reads in the clean reader view, they can select text and choose a highlight color (e.g., yellow, blue, red). They can also add a short note to any highlight.

- The app has a separate "Highlights" tab. Here, the user sees a feed of all their highlights from all their articles, with each highlight linking back to its source. They can filter this feed by tag or search it.

**Tech:**  

- When a user highlights text, use the browser's Selection API to get the text and its location (e.g., the "XPath" or character offset).
- Save this as a JSON object in your database, linked to the user's ID and the article's ID.
- The "Highlights" page is a new interface that queries and displays all these saved JSON objects.

---

## Maybe Later Features to Add to Article Reading

- **Speed Reader:** A tool (like Instapaper has) that flashes one word at a time in the center of the screen to train the user to read faster by eliminating eye movement.

- **Clean Reader View:**  
  - UX: The user clicks the article and is not taken to the original, cluttered website. Instead, they see a clean, local view with only the text, title, and key images.
  - Tech: Use a library like Mozilla's Readability.js to extract main content and strip everything else.

- **Automatic Tagging & Grouping:**  
  - Topic Tags: Use AI to automatically tag articles (e.g., Politics, Tech, AI, Finance). The user can then filter the queue by topic.
  - Story Clustering: Automatically group articles about the same event. Instead of 5 separate articles on the same topic, the UI shows one "Story" with 5 sources, preventing redundant reading.

- **Novelty Score:**  
  - An AI-powered score that tells the user how new the information in an article is compared to what they've already read in their queue or in the past. A low score means "You can probably skip this, it's a rehash."

---

### Story Clustering (De-duplication)

**UX:** Instead of seeing 5 separate articles about the same product launch, the user sees one "stacked" card titled "Apple's New M5 Chip Launch". A small badge says 5 Sources.

- Clicking this "stack" expands it to show the 5 articles.
- At the top of this expanded view is a new AI summary, one that synthesizes all 5 sources. (e.g., "TechCrunch focused on the speed, while The Verge discussed the price. All sources agree it's an iterative update.")

**Tech:**  

- When a new article is added, use AI to generate a "vector embedding" of its content (a numerical representation of its meaning).
- Compare this vector to the vectors of other unread articles. If it's semantically very similar (high cosine similarity) to one or more others, automatically group them.
- The "cluster summary" is generated by sending all 5 texts to an LLM at once.

# reading digest

When an article is add to the read it should have its ai anyslsis reading time and full text article added as well so that it doesn't have to load when you click the article since we can make the good guess that the reader wants to read that later and have it preloaded for them

# Sources leaning

I need to make more clean the political leaning of sources from like a glance as I can't tell myself.

Favorited sources should be on the top of the grid view

Also I should add a debug mode that show all the articles I have in the postgres and chromadb and what those look like add that to the debug view.

Changing the debug sources page to a debug page.

# Debug page ideas

It should have like start up time, breaking that down from the backend to the rss parser to the chormadb init all those useful infomation about init / start up time should be in that page.

# Improving Agentic search

Take my personal AI tool and all the AI tools here and get a model with a huge context window to critque my ai tools and then add all the improvements I made to this ai

# Features to add

News from differnet parts of the world. *What I mean here is having the global feature world and show show news from around the world.*

Reporter / source research like wiki pages.

So for the reporters it does research on them using agentic research makes a infomation page about them then saves that to the database as a apart of the like reporters database. It then can like make graphs to other reporters say by their leanings politcal or funding or for what plan they report.

Funding reports. So how does the source get there funding what is there backing etc.

Material interest reports of say like on going conflicts could be useful.

This is something that could be a feature where you like use the agentic search to look at say a the civil war in sudan look at the matieral interest so like the UAE and gold and the / cross and source that infomation with the other like social or politcal interesnt / plus say historial context that would be needed in as netural of a tone as

# Research / search page ideas

So have it give more verbose errors as well as better like step by step infomation on what the agent and tool is doing

so instead of like Researching...

Still working — gathering more coverage... / give real infomation so like calling x api waiting for x response etc. adding more infomation if it hangs etc. flesh this out more.

Also gemini is really rate limiting so switching to something else would be nice.

# for open router

add in the confg the model you want so in the

# RSS source more then 80

need to improve like pagation or something so when you have 2000+ article then aren't all loaded at once and lag the page out etc.

# Global News & Local Lens (Planned)

## 1. Backend Data Standardization
- [ ] Update `rss_sources.py` to use ISO country codes (US, GB, CN, etc.) instead of full names.
- [ ] Ensure `NewsArticle` model passes this code to the frontend.

## 2. Globe Visualization
- [ ] Create `countries.json` with Lat/Lng/ISO codes for major world countries.
- [ ] Update `ThreeGlobe` to load markers dynamically from this JSON.
- [ ] **Heatmap Logic**: Color/Size markers based on the count of cached articles from that country (News Intensity).

## 3. "Local Lens" Feature
- [ ] Update `GlobeView` to show a split view or tabs when a country is selected:
    - **Internal View**: `SELECT * FROM articles WHERE source_country = 'CODE'`
    - **External View**: `SELECT * FROM articles WHERE content CONTAINS 'Country Name' AND source_country != 'CODE'`
- [ ] Add "Context" tab for static data (Press Freedom Index, Media Ownership info).

## 4. Data Overlays (Future)
- [ ] Integrate static datasets for context (Reporters Without Borders, etc.).
- [ ] Add visual toggle on Globe to switch between "News Volume" and "Press Freedom" coloring.



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