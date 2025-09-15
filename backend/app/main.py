from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import feedparser
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import asyncio
from datetime import datetime
import logging
import threading
import time
from collections import defaultdict
import html
import re
from urllib.parse import urljoin, urlparse
import json
import requests
import requests

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

# Global cache system
class NewsCache:
    def __init__(self):
        self.articles: List[NewsArticle] = []
        self.source_stats: List[Dict] = []
        self.last_updated: datetime = datetime.now()
        self.lock = threading.Lock()
        self.update_in_progress = False
    
    def get_articles(self) -> List[NewsArticle]:
        with self.lock:
            return self.articles.copy()
    
    def get_source_stats(self) -> List[Dict]:
        with self.lock:
            return self.source_stats.copy()
    
    def update_cache(self, articles: List[NewsArticle], source_stats: List[Dict]):
        with self.lock:
            self.articles = articles
            self.source_stats = source_stats
            self.last_updated = datetime.now()
            self.update_in_progress = False
            logger.info(f"🔄 Cache updated: {len(articles)} articles from {len(source_stats)} sources")

# Global cache instance
news_cache = NewsCache()

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
    },
    "Axios": {
        "url": "https://www.axios.com/feed",
        "category": "general",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "Hacker News": {
        "url": "https://news.ycombinator.com/rss",
        "category": "technology",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Center"
    },
    "Hacker News Frontpage": {
        "url": "https://hnrss.org/frontpage",
        "category": "technology",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Center"
    },
    "CNN Technology": {
        "url": "http://rss.cnn.com/rss/edition_technology.rss",
        "category": "technology",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Left-Center"
    },
    "CNN Politics": {
        "url": "http://rss.cnn.com/rss/edition_politics.rss",
        "category": "politics",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Left-Center"
    },
    "IGN": {
        "url": "https://feeds.ign.com/ign/all",
        "category": "technology",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "PC Gamer": {
        "url": "https://www.pcgamer.com/rss/",
        "category": "technology",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "Human Rights Watch": {
        "url": "https://www.hrw.org/rss/news",
        "category": "politics",
        "country": "US",
        "funding_type": "Non-profit",
        "bias_rating": "Left-Center"
    },
    "Amnesty International": {
        "url": "https://www.amnesty.org/en/latest/feed/",
        "category": "politics",
        "country": "International",
        "funding_type": "Non-profit",
        "bias_rating": "Left-Center"
    },
    "Doctors Without Borders": {
        "url": "https://www.doctorswithoutborders.org/rss.xml",
        "category": "general",
        "country": "International",
        "funding_type": "Non-profit",
        "bias_rating": "Center"
    },
    "Liberation News": {
        "url": "https://www.liberationnews.org/feed/",
        "category": "politics",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Left"
    },
    "Electronic Intifada": {
        "url": "https://electronicintifada.net/rss.xml",
        "category": "politics",
        "country": "US",
        "funding_type": "Independent",
        "bias_rating": "Left"
    },
    "WHYY": {
        "url": "https://whyy.org/feed/",
        "category": "general",
        "country": "US",
        "funding_type": "Public",
        "bias_rating": "Center"
    },
    "PhillyVoice": {
        "url": "https://www.phillyvoice.com/feed/",
        "category": "general",
        "country": "US",
        "funding_type": "Commercial",
        "bias_rating": "Center"
    },
    "NBC10 Philadelphia": {
        "url": "https://news.google.com/rss/search?q=site:nbcphiladelphia.com",
        "category": "general",
        "country": "US",
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

@app.on_event("startup")
async def startup_event():
    """Initialize cache and start background refresh scheduler on startup"""
    logger.info("🚀 Starting Global News Aggregation API...")
    
    # Initial cache population
    refresh_news_cache()
    
    # Start background refresh scheduler
    start_cache_refresh_scheduler()
    
    logger.info("✅ API startup complete!")

def parse_rss_feed(url: str, source_name: str, source_info: Dict) -> List[NewsArticle]:
    """Parse RSS feed and return list of articles with improved error handling"""
    import html
    import re
    from urllib.parse import urljoin, urlparse
    
    try:
        # Add user agent to avoid blocking
        feed = feedparser.parse(url, agent='NewsAggregator/1.0')
        articles = []
        
        # Check if feed was parsed successfully
        if hasattr(feed, 'bozo') and feed.bozo:
            logger.warning(f"Feed parsing warning for {source_name}: {getattr(feed, 'bozo_exception', 'Unknown error')}")
        
        # Check feed status
        if hasattr(feed, 'status') and feed.status >= 400:
            logger.error(f"HTTP error {feed.status} for {source_name}: {url}")
            return []
        
        if not hasattr(feed, 'entries') or len(feed.entries) == 0:
            logger.warning(f"No entries found for {source_name}: {url}")
            return []
        
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
                img_match = re.search(r'<img[^>]+src="([^"]+)"', entry.description)
                if img_match:
                    image_url = img_match.group(1)
            
            # Clean title and description
            title = entry.get('title', 'No title')
            description = entry.get('description', 'No description')
            
            # Decode HTML entities and remove HTML tags
            title = html.unescape(title)
            title = re.sub(r'<[^>]+>', '', title).strip()
            
            description = html.unescape(description)
            # Remove HTML tags but preserve some basic structure
            description = re.sub(r'<script[^>]*>.*?</script>', '', description, flags=re.DOTALL | re.IGNORECASE)
            description = re.sub(r'<style[^>]*>.*?</style>', '', description, flags=re.DOTALL | re.IGNORECASE)
            description = re.sub(r'<[^>]+>', ' ', description)
            description = re.sub(r'\s+', ' ', description).strip()
            
            # Ensure image URL is absolute
            if image_url and not image_url.startswith(('http://', 'https://')):
                try:
                    parsed_url = urlparse(url)
                    base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"
                    image_url = urljoin(base_url, image_url)
                except:
                    image_url = None
            
            article = NewsArticle(
                title=title,
                link=entry.get('link', ''),
                description=description,
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

def get_rss_as_json(url: str, source_name: str) -> Dict[str, Any]:
    """Fetch RSS feed and convert to JSON for better debugging"""
    try:
        # First try with requests to get raw content
        headers = {
            'User-Agent': 'NewsAggregator/1.0 (RSS to JSON converter)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        
        # Clean up potential XML issues
        content = response.text.strip()
        # Remove any leading whitespace or BOM that might cause XML parsing issues
        content = content.lstrip('\ufeff\xff\xfe')
        
        # Parse with feedparser using the cleaned content
        feed = feedparser.parse(content)
        
        # Convert feedparser result to clean JSON structure
        feed_json = {
            "feed_info": {
                "title": getattr(feed.feed, 'title', ''),
                "description": getattr(feed.feed, 'description', ''),
                "link": getattr(feed.feed, 'link', ''),
                "updated": getattr(feed.feed, 'updated', ''),
                "language": getattr(feed.feed, 'language', ''),
            },
            "status": getattr(feed, 'status', None),
            "bozo": getattr(feed, 'bozo', False),
            "bozo_exception": str(getattr(feed, 'bozo_exception', '')),
            "total_entries": len(feed.entries),
            "entries": []
        }
        
        # Add first few entries as examples
        for i, entry in enumerate(feed.entries[:3]):  # Just first 3 for logging
            entry_json = {
                "title": getattr(entry, 'title', ''),
                "link": getattr(entry, 'link', ''),
                "description": getattr(entry, 'description', '')[:200] + '...' if len(getattr(entry, 'description', '')) > 200 else getattr(entry, 'description', ''),
                "published": getattr(entry, 'published', ''),
                "author": getattr(entry, 'author', ''),
            }
            feed_json["entries"].append(entry_json)
        
        return feed_json, feed
        
    except Exception as e:
        logger.error(f"Failed to fetch {source_name} as JSON: {e}")
        # Fallback to regular feedparser
        feed = feedparser.parse(url, agent='NewsAggregator/1.0')
        return {"error": str(e), "fallback": True}, feed

def refresh_news_cache():
    """Refresh the news cache by parsing all RSS sources"""
    if news_cache.update_in_progress:
        logger.info("Cache update already in progress, skipping...")
        return
    
    news_cache.update_in_progress = True
    logger.info("🔄 Starting cache refresh...")
    
    all_articles = []
    source_stats = []
    
    for source_name, source_info in RSS_SOURCES.items():
        try:
            # Get RSS as JSON for better debugging
            feed_json, feed = get_rss_as_json(source_info['url'], source_name)
            
            # Log JSON representation for debugging
            if source_name in ['Novara Media', 'CNN Politics']:  # Log problematic sources
                logger.info(f"📄 RSS JSON for {source_name}: {json.dumps(feed_json, indent=2)}")
            
            # Initialize status
            feed_status = "success"
            error_message = None
            
            # Check for HTTP errors
            if hasattr(feed, 'status') and feed.status >= 400:
                feed_status = "error"
                error_message = f"HTTP {feed.status} error"
                article_count = 0
                articles = []
                logger.error(f"❌ HTTP {feed.status} for {source_name}: {source_info['url']}")
            # Check for parsing errors
            elif hasattr(feed, 'bozo') and feed.bozo:
                feed_status = "warning"
                bozo_error = str(getattr(feed, 'bozo_exception', 'Unknown error'))
                error_message = f"Parse warning: {bozo_error}"
                articles = parse_rss_feed_entries(feed.entries, source_name, source_info)
                article_count = len(articles)
                logger.warning(f"⚠️  XML parsing issue for {source_name}: {bozo_error} (still got {article_count} articles)")
            # Check if no entries found
            elif not hasattr(feed, 'entries') or len(feed.entries) == 0:
                feed_status = "warning"
                error_message = "No articles found in feed"
                article_count = 0
                articles = []
                logger.warning(f"⚠️  No entries found for {source_name}: {source_info['url']}")
            else:
                articles = parse_rss_feed_entries(feed.entries, source_name, source_info)
                article_count = len(articles)
                logger.info(f"✅ Successfully parsed {article_count} articles from {source_name}")
            
            # Add articles to main list
            all_articles.extend(articles)
            
            # Create source stat
            source_stat = {
                "name": source_name,
                "url": source_info['url'],
                "category": source_info.get('category', 'general'),
                "country": source_info.get('country', 'US'),
                "funding_type": source_info.get('funding_type'),
                "bias_rating": source_info.get('bias_rating'),
                "article_count": article_count,
                "status": feed_status,
                "error_message": error_message,
                "last_checked": datetime.now().isoformat()
            }
            source_stats.append(source_stat)
            
        except Exception as e:
            # Create error source stat
            source_stat = {
                "name": source_name,
                "url": source_info['url'],
                "category": source_info.get('category', 'general'),
                "country": source_info.get('country', 'US'),
                "funding_type": source_info.get('funding_type'),
                "bias_rating": source_info.get('bias_rating'),
                "article_count": 0,
                "status": "error",
                "error_message": str(e),
                "last_checked": datetime.now().isoformat()
            }
            source_stats.append(source_stat)
            logger.error(f"💥 Error processing {source_name}: {e}")
    
    # Sort articles by published date (newest first)
    try:
        all_articles.sort(key=lambda x: x.published, reverse=True)
    except:
        # Fallback if date parsing fails
        pass
    
    # Update cache
    news_cache.update_cache(all_articles, source_stats)
    logger.info(f"✅ Cache refresh completed: {len(all_articles)} total articles")

def parse_rss_feed_entries(entries, source_name: str, source_info: Dict) -> List[NewsArticle]:
    """Parse RSS feed entries into NewsArticle objects"""
    articles = []
    
    for entry in entries[:15]:  # Limit to 15 articles per source
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
            content_text = entry.content[0].value if isinstance(entry.content, list) else str(entry.content)
            img_match = re.search(r'<img[^>]+src="([^"]+)"', content_text)
            if img_match:
                image_url = img_match.group(1)
        
        # Check for image in description/summary
        if not image_url and entry.get('description'):
            img_match = re.search(r'<img[^>]+src="([^"]+)"', entry.description)
            if img_match:
                image_url = img_match.group(1)
        
        # Clean title and description
        title = entry.get('title', 'No title')
        description = entry.get('description', 'No description')
        
        # Decode HTML entities and remove HTML tags
        title = html.unescape(title)
        title = re.sub(r'<[^>]+>', '', title).strip()
        
        description = html.unescape(description)
        # Remove HTML tags but preserve some basic structure
        description = re.sub(r'<script[^>]*>.*?</script>', '', description, flags=re.DOTALL | re.IGNORECASE)
        description = re.sub(r'<style[^>]*>.*?</style>', '', description, flags=re.DOTALL | re.IGNORECASE)
        description = re.sub(r'<[^>]+>', ' ', description)
        description = re.sub(r'\s+', ' ', description).strip()
        
        # Ensure image URL is absolute
        if image_url and not image_url.startswith(('http://', 'https://')):
            try:
                parsed_url = urlparse(source_info['url'])
                base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"
                image_url = urljoin(base_url, image_url)
            except:
                image_url = None
        
        article = NewsArticle(
            title=title,
            link=entry.get('link', ''),
            description=description,
            published=entry.get('published', str(datetime.now())),
            source=source_name,
            category=source_info.get('category', 'general'),
            image=image_url
        )
        articles.append(article)
    
    return articles

def start_cache_refresh_scheduler():
    """Start the background thread that refreshes the cache every 30 seconds"""
    def cache_scheduler():
        while True:
            try:
                refresh_news_cache()
                time.sleep(30)  # Wait 30 seconds before next refresh
            except Exception as e:
                logger.error(f"Error in cache scheduler: {e}")
                time.sleep(30)  # Still wait 30 seconds even if there's an error
    
    thread = threading.Thread(target=cache_scheduler, daemon=True)
    thread.start()
    logger.info("🚀 Cache refresh scheduler started (30-second intervals)")

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
    """Get aggregated news from cached data with optional filtering"""
    # Get all articles from cache
    all_articles = news_cache.get_articles()
    
    # Apply filters
    filtered_articles = []
    sources_included = set()
    
    for article in all_articles:
        # Apply source filter
        if source and article.source != source:
            continue
        
        # Apply category filter  
        if category and article.category != category:
            continue
        
        filtered_articles.append(article)
        sources_included.add(article.source)
    
    # Limit results
    limited_articles = filtered_articles[:limit]
    
    return NewsResponse(
        articles=limited_articles,
        total=len(limited_articles),
        sources=list(sources_included)
    )

@app.get("/news/source/{source_name}", response_model=List[NewsArticle])
async def get_news_by_source(source_name: str):
    """Get news from a specific source from cached data"""
    if source_name not in RSS_SOURCES:
        raise HTTPException(status_code=404, detail="Source not found")
    
    # Get articles from cache and filter by source
    all_articles = news_cache.get_articles()
    source_articles = [article for article in all_articles if article.source == source_name]
    
    return source_articles

@app.get("/news/category/{category_name}", response_model=NewsResponse)
async def get_news_by_category(category_name: str, limit: int = 30):
    """Get news from a specific category from cached data"""
    # Get articles from cache and filter by category
    all_articles = news_cache.get_articles()
    category_articles = [article for article in all_articles if article.category == category_name]
    
    # Get unique sources for this category
    sources_included = list(set(article.source for article in category_articles))
    
    # Limit results
    limited_articles = category_articles[:limit]
    
    return NewsResponse(
        articles=limited_articles,
        total=len(limited_articles),
        sources=sources_included
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

@app.get("/sources/stats")
async def get_source_stats():
    """Get statistics for each RSS source from cached data"""
    source_stats = news_cache.get_source_stats()
    return {"sources": source_stats, "total_sources": len(source_stats)}

@app.post("/cache/refresh")
async def manual_cache_refresh():
    """Manually trigger a cache refresh"""
    if news_cache.update_in_progress:
        return {"message": "Cache refresh already in progress", "status": "in_progress"}
    
    # Trigger refresh in background
    threading.Thread(target=refresh_news_cache, daemon=True).start()
    
    return {"message": "Cache refresh started", "status": "started"}

@app.get("/cache/status")
async def get_cache_status():
    """Get current cache status and statistics"""
    articles = news_cache.get_articles()
    source_stats = news_cache.get_source_stats()
    
    # Calculate some statistics
    total_articles = len(articles)
    sources_with_articles = len([s for s in source_stats if s['article_count'] > 0])
    sources_with_errors = len([s for s in source_stats if s['status'] == 'error'])
    sources_with_warnings = len([s for s in source_stats if s['status'] == 'warning'])
    
    # Get category breakdown
    category_counts = defaultdict(int)
    for article in articles:
        category_counts[article.category] += 1
    
    return {
        "last_updated": news_cache.last_updated.isoformat(),
        "update_in_progress": news_cache.update_in_progress,
        "total_articles": total_articles,
        "total_sources": len(source_stats),
        "sources_working": sources_with_articles,
        "sources_with_errors": sources_with_errors,
        "sources_with_warnings": sources_with_warnings,
        "category_breakdown": dict(category_counts),
        "cache_age_seconds": (datetime.now() - news_cache.last_updated).total_seconds()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
