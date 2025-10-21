# Features to add

I would like to add sql backend for this so that I don't have to load the articles each time I st12art up the website. It should also track the date of the article and make sure not to add dupicalates as well which should be easy.

# Add the feature so that when you like on one of the tabs like games or business it truly changes what new articles show up.

# Source debugging
Also update the source page to work with the new backend and add a like toggle for debugging mode and user mode and have it so that you can debug mode has all the console.log prints and all those debugging like meals then those are removed when your in user mode so the end user doesn't have hella things on the screen

# Styling
The font like the main main header one should be like garamond or some seirf then it should use geisit for the most of the other fonts.
Also there is no hover animation or color for any of the button on this page and the backgroudns and secondy backgruonds are the same color I like the dark black but there should be a lighter black for the other panels like 20% lighter

# Image source debugging
For this Im thinking we have to add like errors for parsing but what type of error. Like image found but not parsedable by frontend. No images in the json/source at all. Images founded and we can use them but it still doesn't any us to display them idk why?

# The stream vs static source.
I don't really understand why that exist it really show be the same thing and just two parts of it right now it is coded like two different features instead of one fused backend feature for getting sources.

# Add a logger feature
So it like turns the debug print logs off or on

# RSS and Image Parsing
I need a more robust image parsing and also some that can get the images and load them when they are http or https

Also for the rss and image parsing I should make a debug menu or page that I can like just input an rss feed or input an article url and see how the backend parses it and it like gives me a breakdown of how the rss and even the page url and article are being parsed.

# Sources that don't get their iamges parsed right at the moment.
New york times and CNN

# Fact Checking API
Google as a fact checking api as well which we could maybe uses. as well as https://rapidapi.com/mbfcnews/api/media-bias-fact-check-ratings-api2 as it has a free tier

# Add an article feature. ✅ COMPLETED
So for this you can like click on an article and it like parses the article and gives you the full articles as well as like the background of say like the sources if it can find any and the reporter and their baises and background

# Free LLM APIs 
https://github.com/cheahjs/free-llm-api-resources?tab=readme-ov-file#free-providers

# Bias Detector
## Tone Bias
Say for tone bias it looks like the wording and highlights words or senetces have seem to have a tone bias.

## Framing Bias
Same with framing bias as well

## Selection / Sourcing Bias
Where do they get their infomation and where don't they.

## Ownership Bias
Who owns this source and what are their parents companies etc.

## Common Enemy (Idealogy)
Having some scapegoat as common figure to down talk.

## Factual Sources
How true is their infomation
## Left and Right leaning

https://dl.acm.org/doi/10.1145/3706598.3713716

# Remove fake likes shares and comments ✅ COMPLETED

## Implementation Details:
- ✅ Removed `likes`, `comments`, and `shares` from NewsArticle interface
- ✅ Removed fake random number generation for engagement metrics
- ✅ Removed display of fake counts in all UI components:
  - article-detail-modal.tsx
  - article-detail-modal-old.tsx
  - feed-view.tsx
  - scroll-view.tsx
  - search page
  - article-inline-embed.tsx
- ✅ Kept like and bookmark buttons for user interaction (client-side state only)
- ✅ Removed comments and shares buttons since there's no real data
- ✅ Cleaned up unused imports (MessageCircle, Share2)


# Speeding up the database loading
The backend loads up really slowly so if I could speed that up that would be great.

# Features to add

## Fonts to switch to
 Instrument Serif and maybe Libre Bodoni

## Add Static code anylsis as well


## Add a feature where you can open articles up as like tabs ✅ COMPLETED
So like it is like a temp reading list then a permainlty reading list

as right now my workflow is just openning all the articles in like 30 tabs so there has to be a way to streamline that.

So like it should go like you add an article that that goes to the up of the read queue you can have a daily read queue and a like permanlty read queue so it has the daily one and any ones that go past that are put in the perm read queue as a backlog and it just adds the new article to the top of this queue.


## For sources like AP news
I don't like the whole assciotos press 1 - 2 - 3 thing it should just take all the xml concated them as one mega xml then like show the sources as like a sub net or sub brach of the main source but it should act like one source

### ✅ COMPLETED
Implemented consolidated RSS sources feature. Multi-feed sources (AP News, Bloomberg, etc.) can now be configured with `"consolidate": true` in `rss_sources.json` to appear as a single unified source instead of being split into numbered sub-sources.

**Implementation Details:**
- ✅ Modified `backend/app/data/rss_sources.py` - `get_rss_sources()` now checks for `"consolidate"` flag; when `true`, keeps multi-URL sources as single entries
- ✅ Updated `backend/app/services/rss_ingestion.py` - `_process_source()` tracks individual sub-feed stats (URL, status, article_count, error) and includes them in source stats when consolidated
- ✅ Added `"consolidate": true` to Associated Press and Bloomberg in `rss_sources.json`
- ✅ Updated `frontend/lib/api.ts` - `SourceDebugData` interface now includes sub_feeds array
- ✅ Enhanced `frontend/app/sources/[source]/debug/page.tsx` - displays sub-feeds section with status indicators for each feed URL

**How to use:**
- For existing sources, add `"consolidate": true` to the JSON entry in `rss_sources.json`
- Articles from all sub-feeds merge into single source stream
- Debug page shows each sub-feed URL, status (success/warning/error), and article count
- Users see "Associated Press" instead of "AP - 1", "AP - 2", etc.

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