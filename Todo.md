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

# Fonts to switch to
 Instrument Serif and maybe Libre Bodoni

 # Add Static code anylsis as well
 