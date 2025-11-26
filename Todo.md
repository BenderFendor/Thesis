# Features to add

I would like to add sql backend for this so that I don't have to load the articles each time I st12art up the website. It should also track the date of the article and make sure not to add dupicalates as well which should be easy.

# Add the feature so that when you like on one of the tabs like games or business it truly changes what new articles show up

# Source debugging

Also update the source page to work with the new backend and add a like toggle for debugging mode and user mode and have it so that you can debug mode has all the console.log prints and all those debugging like meals then those are removed when your in user mode so the end user doesn't have hella things on the screen

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

# 🌍 Global News & Local Lens (Planned)

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