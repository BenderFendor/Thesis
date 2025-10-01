# AI Article Analysis Feature - Setup Guide

## Overview

This feature provides comprehensive AI-powered analysis of news articles using Google's Gemini AI. When users click on an article, they can request an in-depth analysis that includes source credibility, reporter background, bias detection, and fact-check suggestions.

## Features Implemented

### 1. **Full Article Extraction**
- Automatically extracts complete article text from any URL
- Uses `newspaper3k` library for robust content parsing
- Handles various article formats and layouts

### 2. **Source Analysis**
- Credibility assessment (high/medium/low)
- Ownership information
- Funding model analysis
- Political leaning detection
- Reputation and track record

### 3. **Reporter Analysis**
- Background information on authors
- Areas of expertise
- Known biases or perspectives
- Notable past work or controversies

### 4. **Bias Detection**
- **Tone Bias**: Analysis of emotional tone and word choice
- **Framing Bias**: How the story is presented
- **Selection Bias**: What information is included or excluded
- **Source Diversity**: Diversity of sources quoted
- **Overall Bias Score**: 1-10 scale (5 is neutral)

### 5. **Fact-Check Suggestions**
- Identifies key claims that should be verified
- Provides 3-5 specific claims to fact-check
- Helps readers critically evaluate content

### 6. **AI Summary**
- Concise 2-3 sentence summary of the article
- Captures main points and key information

## Setup Instructions

### Step 1: Get Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the generated API key

### Step 2: Configure Backend

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and add your API key:
   ```bash
   GEMINI_API_KEY=your_actual_api_key_here
   ```

### Step 3: Install Dependencies

If running locally:
```bash
cd backend
pip install -r requirements.txt
```

If using Docker:
```bash
docker compose down
docker compose up --build
```

### Step 4: Verify Installation

1. Start the backend server
2. Visit http://localhost:8001/docs
3. Look for the `/api/article/analyze` endpoint
4. Check backend logs for: `✅ Gemini API configured successfully`

## Usage

### From the UI

1. **Browse articles** in the main news feed
2. **Click on any article** to open the detail modal
3. **Click the "AI Analysis" button** (purple sparkle icon) in the Source Transparency section
4. **Wait 10-30 seconds** for the analysis to complete
5. **View the results** in expandable sections:
   - AI Summary
   - Full Article Text
   - Source Analysis
   - Reporter Analysis
   - Bias Analysis
   - Fact-Check Suggestions

### From the API

```bash
curl -X POST "http://localhost:8001/api/article/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.bbc.com/news/example-article",
    "source_name": "BBC"
  }'
```

## Technical Architecture

### Backend Components

**File**: `/backend/app/main.py`

1. **Article Extraction Function** (`extract_article_content`)
   - Uses `newspaper3k` to download and parse articles
   - Extracts title, authors, publish date, text, images
   - Handles errors gracefully

2. **AI Analysis Function** (`analyze_with_gemini`)
   - Sends article data to Gemini Pro model
   - Uses structured prompt for consistent analysis
   - Parses JSON response from AI

3. **API Endpoint** (`/api/article/analyze`)
   - Accepts POST requests with article URL
   - Orchestrates extraction and analysis
   - Returns structured analysis data

### Frontend Components

**Files**:
- `/frontend/components/article-analysis.tsx` - Display component
- `/frontend/components/article-detail-modal.tsx` - Integration
- `/frontend/lib/api.ts` - API client functions

**Features**:
- Expandable/collapsible sections
- Loading states with spinner
- Error handling and display
- Color-coded bias scoring
- Responsive design

## API Response Structure

```typescript
{
  success: boolean;
  article_url: string;
  full_text?: string;
  title?: string;
  authors?: string[];
  publish_date?: string;
  source_analysis?: {
    credibility_assessment: string;
    ownership: string;
    funding_model: string;
    political_leaning: string;
    reputation: string;
  };
  reporter_analysis?: {
    background: string;
    expertise: string;
    known_biases: string;
    track_record: string;
  };
  bias_analysis?: {
    tone_bias: string;
    framing_bias: string;
    selection_bias: string;
    source_diversity: string;
    overall_bias_score: string;
  };
  fact_check_suggestions?: string[];
  summary?: string;
  error?: string;
}
```

## Rate Limits & Costs

### Gemini API Free Tier
- **60 requests per minute**
- **1,500 requests per day**
- **1 million tokens per month**

For production use, consider:
- Implementing caching for analyzed articles
- Rate limiting on the frontend
- Upgrading to paid tier if needed

## Troubleshooting

### "Gemini API key not configured" Error
- Check that `.env` file exists in `/backend` directory
- Verify `GEMINI_API_KEY` is set correctly
- Restart the backend server after adding the key

### "Failed to extract article content" Error
- Some websites block automated scraping
- Paywalled content may not be accessible
- Try a different article URL

### Analysis Takes Too Long
- Normal response time is 10-30 seconds
- Check your internet connection
- Verify Gemini API is not rate-limited
- Check backend logs for errors

### JSON Parsing Errors
- The AI occasionally returns non-JSON responses
- The system handles this gracefully
- Try the analysis again if it fails

## Future Enhancements

Potential improvements for this feature:

1. **Caching**: Store analyses to avoid re-analyzing the same article
2. **Batch Analysis**: Analyze multiple articles at once
3. **Custom Prompts**: Allow users to customize analysis focus
4. **Export**: Download analysis as PDF or markdown
5. **Comparison**: Compare analyses of the same story from different sources
6. **Historical Tracking**: Track how source bias changes over time
7. **Fact-Check Integration**: Link to actual fact-checking databases
8. **Multi-language Support**: Analyze articles in different languages

## Security Considerations

- ✅ API key stored in environment variables (not in code)
- ✅ `.env` file excluded from git via `.gitignore`
- ✅ No sensitive data logged
- ✅ CORS properly configured
- ⚠️ Consider rate limiting in production
- ⚠️ Consider user authentication for API access

## Performance Optimization

Current implementation:
- **Response Time**: 10-30 seconds per article
- **Concurrent Requests**: Limited by Gemini API rate limits
- **Article Size**: Truncated to 4000 characters for analysis

Recommended optimizations:
1. Implement Redis caching for analyzed articles
2. Add background job queue for analysis requests
3. Compress article text before sending to AI
4. Implement progressive loading (show results as they arrive)

## Support & Resources

- **Gemini API Docs**: https://ai.google.dev/docs
- **Newspaper3k Docs**: https://newspaper.readthedocs.io/
- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **Project Issues**: Check GitHub issues for known problems

---

**Built with ❤️ for better news consumption and media literacy**
