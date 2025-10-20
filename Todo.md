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

