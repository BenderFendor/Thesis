from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import feedparser
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import asyncio
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Data models
class NewsArticle(BaseModel):
    title: str
    link: str
    description: str
    published: str
    source: str
    category: str = "general"
    image: Optional[str] = None

class NewsResponse(BaseModel):
    articles: List[NewsArticle]
    total: int
    sources: List[str]

class SourceInfo(BaseModel):
    name: str
    url: str
    category: str
    country: str = "US"
    funding_type: Optional[str] = None
    bias_rating: Optional[str] = None

# RSS Sources with categories
RSS_SOURCES = {
    "BBC": {
        "url": "https://feeds.bbci.co.uk/news/rss.xml",
        "category": "general",
        "country": "UK",
        "funding_type": "Public",
        "bias_rating": "Center"
    },
    "CNN": {
        "url": "https://rss.cnn.com/rss/cnn_topstories.rss",
        "category": "general", 
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Left-Center"
    },
    "Reuters": {
        "url": "https://www.reuters.com/tools/rss",
        "category": "general",
        "country": "UK", 
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "NPR": {
        "url": "http://www.npr.org/rss/rss.php?id=1001",
        "category": "general",
        "country": "US",
        "funding_type": "Public",
        "bias_rating": "Left-Center"
    },
    "Fox News": {
        "url": "https://feeds.foxnews.com/foxnews/latest",
        "category": "politics",
        "country": "US",
        "funding_type": "Commercial", 
        "bias_rating": "Right"
    },
    "Associated Press": {
        "url": "https://apnews.com/rss/topnews",
        "category": "general",
        "country": "US",
        "funding_type": "Non-profit",
        "bias_rating": "Center"
    },
    "New York Times": {
        "url": "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
        "category": "general",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Left"
    },
    "The Guardian": {
        "url": "https://www.theguardian.com/world/rss",
        "category": "general",
        "country": "UK",
        "funding_type": "Commercial",
        "bias_rating": "Left"
    },
    "The Washington Post": {
        "url": "http://feeds.washingtonpost.com/rss/national",
        "category": "general",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Left-Center"
    },
    "Al Jazeera": {
        "url": "https://www.aljazeera.com/xml/rss/all.xml",
        "category": "general",
        "country": "QA",
        "funding_type": "State-funded",
        "bias_rating": "Left-Center"
    },
    "972mag.com": {
        "url": "https://972mag.com/feed/",
        "category": "general",
        "country": "IL",
        "funding_type": "Independent",
        "bias_rating": "Left"
    },
    "NGO Monitor": {
        "url": "https://ngo-monitor.org/feed/",
        "category": "politics",
        "country": "IL",
        "funding_type": "Non-profit",
        "bias_rating": "Right-Center"
    },
    "Truth Out": {
        "url": "https://truthout.org/feed/",
        "category": "politics",
        "country": "US",
        "funding_type": "Non-profit",
        "bias_rating": "Left"
    },
    "Psychology Today": {
        "url": "https://www.psychologytoday.com/intl/rss",
        "category": "general",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "Novara Media": {
        "url": "https://novaramedia.com/feed/",
        "category": "politics",
        "country": "UK",
        "funding_type": "Independent",
        "bias_rating": "Left"
    },
    "Democracy Now!": {
        "url": "https://www.democracynow.org/democracynow.rss",
        "category": "politics",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Left"
    },
    "The Wall Street Journal": {
        "url": "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
        "category": "business",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Right-Center"
    },
    "Monthly Review": {
        "url": "https://monthlyreview.org/feed/",
        "category": "politics",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Left"
    },
    "Big Think": {
        "url": "https://bigthink.com/feed/",
        "category": "technology",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "Beautiful Pixels": {
        "url": "https://beautifulpixels.com/feed/",
        "category": "technology",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Center"
    },
    "National Geographic": {
        "url": "https://www.nationalgeographic.com/rss/daily-news",
        "category": "general",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "WSWS": {
        "url": "https://www.wsws.org/en/rss.xml",
        "category": "politics",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Left"
    },
    "CounterPunch": {
        "url": "https://www.counterpunch.org/feed/",
        "category": "politics",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Left"
    },
    "Project Syndicate": {
        "url": "https://www.project-syndicate.org/rss",
        "category": "general",
        "country": "International",
        "funding_type": "Non-profit",
        "bias_rating": "Center"
    },
    "Japan Today": {
        "url": "https://japantoday.com/rss",
        "category": "general",
        "country": "JP",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "The Japan Times": {
        "url": "https://www.japantimes.co.jp/feed/",
        "category": "general",
        "country": "JP",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    }
}

app = FastAPI(
    title="Global News Aggregation API", 
    version="1.0.0",
    description="A comprehensive news aggregation platform providing diverse global perspectives"
)

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # Next.js ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def parse_rss_feed(url: str, source_name: str, source_info: Dict) -> List[NewsArticle]:
    """Parse RSS feed and return list of articles"""
    try:
        feed = feedparser.parse(url)
        articles = []
        
        for entry in feed.entries[:15]:  # Limit to 15 articles per source
            # Extract image URL from various possible locations
            image_url = None
            
            # Check for media:thumbnail
            if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
                image_url = entry.media_thumbnail[0].get('url') if isinstance(entry.media_thumbnail, list) else entry.media_thumbnail.get('url')
            
            # Check for media:content
            elif hasattr(entry, 'media_content') and entry.media_content:
                for media in entry.media_content:
                    if media.get('type', '').startswith('image/'):
                        image_url = media.get('url')
                        break
            
            # Check for enclosure (podcast/media)
            elif hasattr(entry, 'enclosures') and entry.enclosures:
                for enclosure in entry.enclosures:
                    if enclosure.get('type', '').startswith('image/'):
                        image_url = enclosure.get('href')
                        break
            
            # Check for image in links
            elif hasattr(entry, 'links') and entry.links:
                for link in entry.links:
                    if link.get('type', '').startswith('image/'):
                        image_url = link.get('href')
                        break
            
            # Check for image tag in content
            elif hasattr(entry, 'content') and entry.content:
                import re
                content_text = entry.content[0].value if isinstance(entry.content, list) else str(entry.content)
                img_match = re.search(r'<img[^>]+src="([^"]+)"', content_text)
                if img_match:
                    image_url = img_match.group(1)
            
            # Check for image in description/summary
            if not image_url and entry.get('description'):
                import re
                img_match = re.search(r'<img[^>]+src="([^"]+)"', entry.description)
                if img_match:
                    image_url = img_match.group(1)
            
            article = NewsArticle(
                title=entry.get('title', 'No title'),
                link=entry.get('link', ''),
                description=entry.get('description', 'No description'),
                published=entry.get('published', str(datetime.now())),
                source=source_name,
                category=source_info.get('category', 'general'),
                image=image_url
            )
            articles.append(article)
        
        logger.info(f"Successfully parsed {len(articles)} articles from {source_name}")
        return articles
    except Exception as e:
        logger.error(f"Error parsing {source_name}: {e}")
        return []

@app.get("/", response_model=Dict[str, str])
async def read_root():
    return {
        "message": "Global News Aggregation API is running!",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.get("/news", response_model=NewsResponse)
async def get_news(
    limit: int = 50,
    category: Optional[str] = None,
    source: Optional[str] = None
):
    """Get aggregated news from all sources with optional filtering"""
    all_articles = []
    
    # Filter sources based on parameters
    sources_to_parse = RSS_SOURCES
    if source and source in RSS_SOURCES:
        sources_to_parse = {source: RSS_SOURCES[source]}
    
    # Parse all RSS feeds
    for source_name, source_info in sources_to_parse.items():
        if category and source_info.get('category') != category:
            continue
            
        articles = parse_rss_feed(source_info['url'], source_name, source_info)
        all_articles.extend(articles)
    
    # Sort by published date (newest first)
    try:
        all_articles.sort(key=lambda x: x.published, reverse=True)
    except:
        # Fallback if date parsing fails
        pass
    
    # Limit results
    limited_articles = all_articles[:limit]
    
    return NewsResponse(
        articles=limited_articles,
        total=len(limited_articles),
        sources=list(sources_to_parse.keys())
    )

@app.get("/news/source/{source_name}", response_model=List[NewsArticle])
async def get_news_by_source(source_name: str):
    """Get news from a specific source"""
    if source_name not in RSS_SOURCES:
        raise HTTPException(status_code=404, detail="Source not found")
    
    source_info = RSS_SOURCES[source_name]
    articles = parse_rss_feed(source_info['url'], source_name, source_info)
    
    return articles

@app.get("/news/category/{category_name}", response_model=NewsResponse)
async def get_news_by_category(category_name: str, limit: int = 30):
    """Get news from a specific category"""
    all_articles = []
    
    for source_name, source_info in RSS_SOURCES.items():
        if source_info.get('category') == category_name:
            articles = parse_rss_feed(source_info['url'], source_name, source_info)
            all_articles.extend(articles)
    
    # Sort by published date
    try:
        all_articles.sort(key=lambda x: x.published, reverse=True)
    except:
        pass
    
    limited_articles = all_articles[:limit]
    
    return NewsResponse(
        articles=limited_articles,
        total=len(limited_articles),
        sources=[name for name, info in RSS_SOURCES.items() if info.get('category') == category_name]
    )

@app.get("/sources", response_model=List[SourceInfo])
async def get_sources():
    """Get list of available news sources with their information"""
    sources = []
    for name, info in RSS_SOURCES.items():
        source = SourceInfo(
            name=name,
            url=info['url'],
            category=info.get('category', 'general'),
            country=info.get('country', 'US'),
            funding_type=info.get('funding_type'),
            bias_rating=info.get('bias_rating')
        )
        sources.append(source)
    
    return sources

@app.get("/categories")
async def get_categories():
    """Get list of available categories"""
    categories = set()
    for source_info in RSS_SOURCES.values():
        categories.add(source_info.get('category', 'general'))
    
    return {"categories": list(categories)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
