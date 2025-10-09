# Search Structured Response Implementation

## Overview
Enhanced the news research search feature to return both structured JSON article data AND markdown analysis from the LLM in a dual-format response.

## What Was Changed

### Backend Changes

#### 1. **news_research_agent.py**
- Modified `research_news()` function to return structured article JSON alongside markdown analysis
- Added new field `structured_articles` that contains articles in JSON format wrapped in special markers:
  ```python
  structured_articles_block = f"\n```json:articles\n{json.dumps(articles_json, indent=2)}\n```\n"
  ```
- The JSON includes:
  - `articles`: Array of referenced article objects
  - `total`: Count of articles
  - `query`: Original search query

#### 2. **backend/app/main.py**
- Updated `/api/news/research/stream` SSE endpoint to send multiple event types:
  - `articles_json`: Contains the structured JSON block for grid display
  - `referenced_articles`: Contains raw article data for conversion
  - `complete`: Contains the final markdown analysis from the LLM
- These are sent as separate SSE events so the frontend can handle them independently

### Frontend Changes

#### 3. **frontend/app/search/page.tsx**

**Interface Updates:**
- Added `structured_articles_json?: any` to the `Message` interface to store parsed article data

**SSE Event Handling:**
- Added handler for `articles_json` event type that:
  - Parses the ```json:articles markdown code block
  - Extracts the JSON data
  - Stores it in the message state
- Added handler for `referenced_articles` event type (alternative data source)
- Updated `complete` handler to preserve structured articles in final message

**UI Display:**
- Added a new grid display section that renders when `structured_articles_json` is present
- Displays articles in a 2-column responsive grid with:
  - Article thumbnail images
  - Title (clickable, opens detail modal)
  - Source name
  - Category badge
  - Hover effects and transitions
- The grid appears below the markdown analysis with a section header showing article count

## How It Works

### Request Flow:
1. User submits search query
2. Backend agent searches through articles and generates analysis
3. Backend creates TWO outputs:
   - **Structured JSON**: Articles wrapped in ```json:articles code block
   - **Markdown Analysis**: LLM's textual analysis with citations

### Response Flow (SSE Stream):
1. `status` events: Progress updates
2. `thinking_step` events: Chain-of-thought reasoning
3. `articles_json` event: Structured JSON article data (NEW)
4. `referenced_articles` event: Raw article data (NEW)
5. `complete` event: Final markdown analysis

### Frontend Rendering:
1. Markdown analysis is rendered with ReactMarkdown
2. Structured articles are parsed and displayed in a grid below the analysis
3. Each article card is clickable and opens the ArticleDetailModal
4. Both formats coexist: users get the AI analysis AND can browse the actual articles

## Benefits

✅ **Dual Format**: Users get both AI insights AND structured article data  
✅ **Embeddable Articles**: Articles can be displayed in a grid/card format  
✅ **Separation of Concerns**: JSON data separate from markdown content  
✅ **Special Markers**: ```json:articles syntax clearly identifies article data  
✅ **Flexible Display**: Frontend can render articles in grid, list, or any format  
✅ **Modal Integration**: Articles integrate seamlessly with existing ArticleDetailModal  
✅ **Backward Compatible**: Existing markdown rendering still works  

## Example Output

### Backend Returns:
```json
{
  "success": true,
  "answer": "Here's what I found about climate change...",
  "structured_articles": "\n```json:articles\n{\n  \"articles\": [...],\n  \"total\": 5,\n  \"query\": \"climate change\"\n}\n```\n",
  "referenced_articles": [...]
}
```

### Frontend Displays:
1. **Markdown Section**: AI analysis with inline citations
2. **Related Articles Grid**: 2-column grid of clickable article cards

## Testing

To test the new feature:

```bash
# Start the services
docker compose up --build

# Navigate to http://localhost:3000/search
# Enter a query like "Which sources have covered AI recently?"
# Observe:
# 1. Markdown analysis appears first
# 2. "Related Articles" grid appears below with clickable cards
# 3. Click any article card to open detail modal
```

## Future Enhancements

- Add filtering/sorting options for the article grid
- Support different grid layouts (1, 2, 3 columns)
- Add "Show more" pagination for large result sets
- Include article relevance scores from the agent
- Support alternative display modes (list, compact, etc.)
