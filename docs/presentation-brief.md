# Scoop / Thesis App — Complete Presentation Brief (General Audience Version)

## 1. What this app is (in one sentence)

**This app is a global news intelligence platform that helps people see the same story from many perspectives, then uses AI to help them research, compare, and fact-check what they are reading.**

---

## 2. The big idea (opening message)

Most people do not have a "news problem."  
They have a **context problem**.

People see headlines, but usually through one lens: one country, one media bubble, one editorial framing.  
Scoop/Thesis solves that by combining:

1. broad source coverage,
2. source-context signals,
3. research tools,
4. and verification workflows.

So users are not only consuming headlines; they are **investigating information**.

---

## 3. The problem this product solves

### Pain points in normal news consumption

1. **Filter bubbles:** audiences only see one narrative stream.
2. **Trust confusion:** it is hard to assess source reliability and incentives.
3. **Research friction:** users must manually open many tabs to compare coverage.
4. **Misinformation pressure:** claims spread faster than verification.
5. **Coverage asymmetry:** some stories are heavily covered in one region but under-covered in others.

### Product response

Scoop/Thesis combines global aggregation + source metadata + AI research + claim verification into one workflow.

---

## 4. What users can do in the app

## A) Switch between four reading perspectives

The primary app view supports:

- **Globe**
- **Grid**
- **Scroll**
- **Blindspot**

This lets users move from map-based discovery to structured browsing to feed reading to coverage-gap analysis.

## B) Search and investigate

Users can run semantic-style search and open AI-assisted research flows that gather evidence and summarize findings with references.

## C) Evaluate source context

Users can inspect source-level context such as ownership/funding/bias-oriented metadata and profile-style wiki details.

## D) Save and organize

Users can like/bookmark/queue items and maintain a personal reading workflow over time.

---

## 5. How it works (plain-language system flow)

Think of the product as a newsroom assistant pipeline:

1. **Collect:** ingest article streams from curated feed sources.
2. **Store:** persist and index the data.
3. **Understand:** cluster related coverage and compute context signals.
4. **Assist:** provide AI-supported research and verification endpoints.
5. **Present:** expose multiple user views for perspective comparison.

---

## 6. Product strengths to highlight in a presentation

### 1) Perspective over popularity

Many products optimize for engagement; this one optimizes for **cross-perspective understanding**.

### 2) Context-rich reading

Stories are paired with source context and research tooling instead of being isolated headlines.

### 3) Blindspot detection

The blindspot view is a major differentiator because it surfaces **coverage asymmetry**.

### 4) Practical AI usage

AI is used as a research/verification assistant, not as a single opaque answer engine.

### 5) Operational discipline

The codebase includes strong quality gates and reproducible run/verify workflows.

---

## 7. Architecture explained for non-technical audiences

Use this simple three-layer story:

### Layer 1: User experience layer (Frontend)

- Interactive web interface
- Four reading modes
- Search and exploration flows

### Layer 2: Intelligence/API layer (Backend)

- Routes for news, search, verification, research, trends, blindspots, wiki/context, and debug
- Service orchestration for ingestion and analysis

### Layer 3: Data layer

- Relational storage for structured records
- Vector/semantic storage for meaning-based retrieval
- Curated feed catalog with metadata

---

## 8. Trust and credibility narrative

For your audience, frame trust like this:

1. The app does not ask users to "just trust the summary."
2. It gives users tools to inspect source context and compare framing.
3. It includes verification-oriented routes and diagnostics.
4. It has consistent engineering checks and quality scripts for reliability.

Short line for slides:

**"This platform is built to make information auditable, not just consumable."**

---

## 9. Concrete facts you can present confidently

1. Frontend brand metadata: **"Scoop - Multi-perspective News"**
2. Backend API title: **"Global News Aggregation API"**
3. Core home views: **Globe, Grid, Scroll, Blindspot**
4. Broad backend route coverage across news/search/research/verification/wiki/blindspots/trending/debug domains
5. Local and Docker run paths both exist
6. Source catalog is metadata-rich and designed for curated feed ingestion

---

## 10. Honest limitations (good for Q&A credibility)

1. Feed health is partly dependent on external publishers and feed stability.
2. AI output still requires user judgment and source review.
3. Some roadmap items remain in progress, which is normal for an evolving product.

---

## 11. Suggested talk track (ready to read)

## Opening

"Most people do not need more news. They need better context. This app helps users see how the same event is covered across different perspectives, then gives them tools to verify what they are reading."

## Middle

"Users can browse in four modes depending on how they think: geographic, structured, feed-based, or blindspot-based. They can then move into research and verification without leaving the platform."

## Close

"The goal is not to tell users what to think. The goal is to help users think with better evidence."

---

## 12. Q&A cheat sheet

### Q: Is this just another news feed?

No. Its value is perspective comparison plus verification support, not only aggregation.

### Q: Where does the data come from?

From a curated catalog of feed sources, then processed through platform indexing/analysis services.

### Q: Why use AI here?

To reduce research time and organize evidence trails; it supports user reasoning.

### Q: What makes this trustworthy?

Source-context surfacing, comparison tooling, verification paths, and operational quality gates.

### Q: Who is it for?

Researchers, journalists, policy observers, media-literate readers, and general users who want broader context.

---

## 13. Slide-ready one-liners

Pick one:

1. **"Scoop turns news reading into evidence-based understanding."**
2. **"From headlines to context: compare narratives, inspect sources, verify claims."**
3. **"A multi-perspective news platform designed to reduce blindspots."**

---

## 14. Evidence map (repository paths)

Use these references if someone asks, "Where is that in the project?"

- Product overview and architecture: `README.md`
- Home view modes and app flow: `frontend/app/page.tsx`
- App metadata/title: `frontend/app/layout.tsx`
- API wiring entry point: `backend/app/main.py`
- Route registry: `backend/app/api/routes/__init__.py`
- Route modules: `backend/app/api/routes/*.py`
- Source catalog: `backend/app/data/rss_sources.json`
- Local run automation: `runlocal.sh`
- Verification script: `verify.sh`

---

## 15. 60-second executive summary (for fast intros)

Scoop/Thesis is a multi-perspective news platform that helps users move from passive reading to active understanding. It aggregates global coverage, exposes source context, and provides AI-assisted research and verification workflows. Instead of only ranking what is most clickable, it helps users compare how stories are framed, identify blindspots, and make more informed judgments.

