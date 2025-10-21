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

## Implementation Details:
- ✅ Backend endpoint: POST /api/article/analyze
- ✅ Uses Google Gemini AI for analysis
- ✅ Newspaper3k for article content extraction
- ✅ Frontend component: ArticleAnalysisDisplay
- ✅ Integrated into article-detail-modal with "AI Analysis" button
- ✅ Provides:
  - Full article text extraction
  - Source credibility assessment
  - Reporter background and expertise
  - Bias analysis (tone, framing, selection, source diversity)
  - Fact-check suggestions
  - AI-generated summary
- ✅ Environment variable configuration for GEMINI_API_KEY

# Reading Queue Enhancements ✅ COMPLETED
Full reading queue enhancement implementation with distraction-free reader, highlights, digest, and navigation.

## Implementation Details:
- ✅ **Distraction-Free Reader**: `frontend/app/reader/[id]/page.tsx` with clean UI and keyboard navigation
  - Arrow keys (←/→, ↑/↓) navigate articles
  - Enter marks article as read
  - Esc returns to queue
  - Progress indicator in footer
  - Feature-gated: `NEXT_PUBLIC_ENABLE_READER_MODE`

- ✅ **Article Extraction Service**: `backend/app/services/article_extraction.py`
  - Async full-text extraction using newspaper3k
  - Word count calculation
  - Read time estimation (formula: ⌈word_count / 230⌉ minutes)
  - Graceful degradation on extraction failure

- ✅ **Highlight System**: Complete selection-based annotations
  - Colors: Yellow, Blue, Red
  - Database persistence with character ranges
  - Floating toolbar on text selection
  - Highlight list panel with edit/delete
  - Notes support for each highlight
  - `backend/app/services/highlights.py` for CRUD
  - Feature-gated: `NEXT_PUBLIC_ENABLE_HIGHLIGHTS`

- ✅ **Daily Digest**: `GET /api/queue/digest/daily`
  - Top 5 unread articles preview
  - Estimated read time summary
  - Scheduling UI with localStorage persistence
  - DigestCard component in sidebar
  - Feature-gated: `NEXT_PUBLIC_ENABLE_DIGEST`

- ✅ **Queue Overview Card**: Real-time statistics dashboard
  - Total items, daily/permanent split
  - Unread/reading/completed breakdown
  - Estimated read time for unread items
  - 30-second refresh interval
  - `frontend/components/queue-overview-card.tsx`

- ✅ **Read-Time Badges**: `frontend/components/read-time-badge.tsx`
  - Compact and full view modes
  - Word count and time display
  - Integrated into reader header

- ✅ **Backend Enhancements**:
  - `GET /api/queue/{id}/content` - Full article for reader
  - `GET /api/queue/overview` - Queue statistics
  - `GET /api/queue/digest/daily` - Daily digest
  - Highlight endpoints: POST/GET/PATCH/DELETE `/api/queue/highlights/*`
  - Queue service methods: `get_queue_item_by_id()`, `generate_daily_digest()`

- ✅ **API Integration**: `frontend/lib/api.ts`
  - Feature gate constants
  - New functions: `getQueueItemContent()`, `getDailyDigest()`, `getQueueOverview()`

- ✅ **Testing**: Comprehensive test coverage
  - Backend: `backend/test_reading_queue.py` - 10+ async tests
  - Frontend: `frontend/__tests__/reading-queue.test.tsx` - Component tests
  
- ✅ **Code Quality**:
  - Ruff formatting (8 files reformatted)
  - ESLint resolution and React hook fixes
  - Database schema already includes all required columns
- ✅ Documentation updated in README.md

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

## Implementation Details (Reading Queue):
- ✅ Phase 1: LocalStorage-based queue (immediate)
  - Add to queue button on article cards and modals
  - Floating sidebar showing queued articles
  - Toast notifications for add/remove actions
  - Persistent across sessions
  
- ✅ Phase 2: Database storage (optional)
  - PostgreSQL `reading_queue` table with full schema
  - Daily queue with 7-day TTL → auto-move to permanent
  - Permanent queue as unlimited backlog
  - Auto-archival of completed items after 30 days
  - Backend API endpoints for CRUD operations
  - Optional database sync via `NEXT_PUBLIC_USE_DB_QUEUE` flag
  
- 📄 Full documentation: See READING_QUEUE_IMPLEMENTATION.md

## For sources like AP news
I don't like the whole assciotos press 1 - 2 - 3 thing it should just take all the xml concated them as one mega xml then like show the sources as like a sub net or sub brach of the main source but it should act like one source

## Add a feature for like your favorite / most important new sources
so you have like your favorites at the top of your feed and the other at the bottom past those favorites.

## Have a sidebar that shows all the sources you have current as well so you can like select just those sources and see jus tthose sources
It is like this feature of having news from only some sources like a selection thing.

## Also with new sources and articles
Show aritcles for the past week first then older articles from like the last month or years back last. also I would like it if like has the sources that are most current first so like if a source only has 2023 show that at the end of the feed not the top.


# for the sources
FOr the faviorts sources there should be a sleection for sources and it should be like a sidebar with the list of sources and like you can view those sources

# For the aritcle to read (Making reading articles easier)
It so allow to go to the the next and previous article.

It shouw have keyboard controls as well so like right arrow for next article, it should have the full text from the article like the grid view popup,

This is for the reading queue itself

Category 1: Triage & Prioritization (Helping the User Decide What to Read First)

These features help the user quickly assess the 20-article queue and decide where to start, or what to skip.

2. The "Daily Digest" Synthesis

    UX: This is the ultimate "boss level" feature. The user doesn't even open the queue. They have a setting to "Receive a Daily Digest."

        Every morning at 8 AM, they get a single, new item at the top of their queue (or as an email) titled "Your Daily Briefing."

        This "article" is AI-generated. It synthesizes all 20 (or however many) articles in their queue into a cohesive, skimmable newsletter, complete with headlines, summaries of each theme, and links to the source articles if they want to dive deeper.

 #       Have a button for like an queue overview

        It fetches all unread articles for a user.

        It performs the "Story Clustering" logic (Category 1) to find themes.

        It then uses a series of complex LLM prompts: "First, summarize these 5 articles on AI. Now, summarize these 3 on finance..."

        A final prompt combines everything: "You are a personal research assistant. Create a 'Daily Briefing' email for your boss based on the following summaries. Adopt a professional, informative tone. Group the insights by theme. Here are the summaries: [insert all summaries here]..."

    Estimated Read Time: A simple "5 min read" or "12 min read" tag next to each title. This lets the user batch their reading (e.g., "I only have 10 minutes, I'll read these two short ones").

    Automatic Tagging & Grouping:

        Topic Tags: Use AI to automatically tag articles (e.g., Politics, Tech, AI, Finance). The user can then filter the queue by topic.

        Story Clustering: Automatically group articles about the same event. Instead of 5 separate articles on the same topic, the UI shows one "Story" with 5 sources, preventing redundant reading.

    "Novelty" Score: An AI-powered score that tells the user how new the information in an article is compared to what they've already read in their queue or in the past. A low score means "You can probably skip this, it's a rehash."


    Distraction-Free Reader Mode: This is essential. It strips all ads, sidebars, pop-ups, and navigation, leaving only the article's text and images in a clean, readable format.
2. Estimated Read Time UX: A simple, clear tag on the card: 7 min read Tech: This is simple. When the article is parsed, you run a word count. Read Time = Total Words / 230 (an average adult reading speed).

1. The Distraction-Free Parser

    UX: The user clicks the article and is not taken to the original, cluttered website. Instead, they see a clean, local view with only the text, title, and key images.

    Tech: This is a solved problem. You use a library like Mozilla's Readability.js. This open-source tool is the engine behind Firefox's Reader View. It scans the article's HTML, heuristics to find the <div> or <article> tag that contains the main content, and strips everything else (ads, nav bars, scripts, pop-ups).

    n-line Context & Definitions

    UX: While reading, the user comes across a name they don't know ("Janet Yellen") or a concept ("quantitative easing"). They can double-tap or highlight the term. A non-intrusive pop-over appears with a one-paragraph, AI-generated definition. This keeps the user in the "flow" of reading, preventing them from opening a new tab to Google it.

    Tech: This combines a simple UI event listener (for the highlight) with an LLM call. The prompt would be: "The user is reading an article. They highlighted the term '[HIGHLIGHTED_TEXT]'. Provide a brief, one-paragraph explanation of this term in the context of [article's main topic, e.g., 'US economics']."

    1. Digital Highlighter & Centralized Notes

    UX: As the user reads in the clean reader view, they can select text and choose a highlight color (e.g., yellow, blue, red). They can also add a short note to any highlight.

        The Payoff: The app has a separate "Highlights" tab. Here, the user sees a feed of all their highlights from all their articles, with each highlight linking back to its source. They can filter this feed by tag or search it.

    Tech: When a user highlights text, you use the browser's Selection API to get the text and its location (e.g., the "XPath" or character offset). You save this as a JSON object in your database, linked to the user's ID and the article's ID. The "Highlights" page is just a new interface that queries and displays all these saved JSON objects.

    ## Maybe later features to add to the reading for articles
    Speed Reader: A tool (like Instapaper has) that flashes one word at a time in the center of the screen to train the user to read faster by eliminating eye movement.

    3. Story Clustering (De-duplication)

    UX: Instead of seeing 5 separate articles about the same product launch, the user sees one "stacked" card titled "Apple's New M5 Chip Launch". A small badge says 5 Sources.

        Clicking this "stack" expands it to show the 5 articles.

        At the top of this expanded view is a new AI summary, one that synthesizes all 5 sources. (e.g., "TechCrunch focused on the speed, while The Verge discussed the price. All sources agree it's an iterative update.")

    Tech: This is more advanced. When a new article is added, you use AI to generate a "vector embedding" of its content (a numerical representation of its meaning). You then compare this vector to the vectors of other unread articles. If it's semantically very similar (high cosine similarity) to one or more others, you automatically group them. The "cluster summary" is generated by sending all 5 texts to an LLM at once.