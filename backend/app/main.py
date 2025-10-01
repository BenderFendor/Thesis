from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import feedparser
from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel
import asyncio
from datetime import datetime
import logging
import threading
import time
import random  # For jitter in backoff
from collections import defaultdict
import html
import re
from urllib.parse import urljoin, urlparse
import json
import requests
import concurrent.futures
from bs4 import BeautifulSoup
import httpx
import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
try:
    from newspaper import Article
except ImportError:
    # newspaper4k uses the same import path
    from newspaper import Article

# Load environment variables
load_dotenv()

# Enhanced logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] - %(message)s'
)
logger = logging.getLogger(__name__)

# Configure Gemini API
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
gemini_client = None
if GEMINI_API_KEY:
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    logger.info("✅ Gemini API configured successfully")
else:
    logger.warning("⚠️ GEMINI_API_KEY not found in environment variables")

# Add streaming-specific logger
stream_logger = logging.getLogger("news_stream")
stream_logger.setLevel(logging.DEBUG)

# Global tracking for active streams and rate limiting
class StreamManager:
    def __init__(self):
        self.active_streams = {}  # stream_id -> stream_info
        self.source_last_accessed = {}  # source_name -> timestamp
        self.stream_counter = 0
        self.lock = threading.Lock()
    
    def register_stream(self, stream_id: str) -> Dict:
        with self.lock:
            stream_info = {
                "id": stream_id,
                "start_time": datetime.now(),
                "status": "starting",
                "sources_completed": 0,
                "total_sources": len(RSS_SOURCES),
                "client_connected": True
            }
            self.active_streams[stream_id] = stream_info
            self.stream_counter += 1
            stream_logger.info(f"🆕 Stream {stream_id} registered. Active streams: {len(self.active_streams)}")
            return stream_info
    
    def update_stream(self, stream_id: str, **updates):
        with self.lock:
            if stream_id in self.active_streams:
                self.active_streams[stream_id].update(updates)
                stream_logger.debug(f"🔄 Stream {stream_id} updated: {updates}")
    
    def unregister_stream(self, stream_id: str):
        with self.lock:
            if stream_id in self.active_streams:
                stream_info = self.active_streams.pop(stream_id)
                duration = (datetime.now() - stream_info["start_time"]).total_seconds()
                stream_logger.info(f"🏁 Stream {stream_id} completed in {duration:.2f}s. Active streams: {len(self.active_streams)}")
    
    def get_active_stream_count(self) -> int:
        with self.lock:
            return len(self.active_streams)
    
    def should_throttle_source(self, source_name: str, min_interval: int = 10) -> Tuple[bool, float]:
        """Check if source should be throttled and return wait time if needed"""
        with self.lock:
            now = time.time()
            last_access = self.source_last_accessed.get(source_name, 0)
            elapsed = now - last_access
            
            if elapsed < min_interval:
                wait_time = min_interval - elapsed
                return True, wait_time
            else:
                self.source_last_accessed[source_name] = now
                return False, 0

# Global stream manager
stream_manager = StreamManager()

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                # On failure, disconnect the client
                self.disconnect(connection)

manager = ConnectionManager()


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
            logger.debug(f"📋 Cache accessed: {len(self.articles)} articles available")
            return self.articles.copy()
    
    def get_source_stats(self) -> List[Dict]:
        with self.lock:
            logger.debug(f"📊 Source stats accessed: {len(self.source_stats)} sources")
            return self.source_stats.copy()
    
    def update_cache(self, articles: List[NewsArticle], source_stats: List[Dict]):
        with self.lock:
            old_count = len(self.articles)
            self.articles = articles
            self.source_stats = source_stats
            self.last_updated = datetime.now()
            self.update_in_progress = False
            self.update_count = getattr(self, 'update_count', 0) + 1
            
            logger.info(f"🔄 Cache updated #{self.update_count}: {old_count} -> {len(articles)} articles from {len(source_stats)} sources")
            
            # Log cache health
            working_sources = [s for s in source_stats if s.get('status') == 'success']
            error_sources = [s for s in source_stats if s.get('status') == 'error']
            logger.info(f"📊 Cache health: {len(working_sources)} working, {len(error_sources)} error sources")

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
        "url": "http://rss.cnn.com/rss/cnn_topstories.rss",
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
        "url": [
            "http://associated-press.s3-website-us-east-1.amazonaws.com/business.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/climate-and-environment.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/entertainment.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/health.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/lifestyle.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/oddities.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/politics.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/religion.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/science.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/sports.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/technology.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/travel.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/us-news.xml",
            "http://associated-press.s3-website-us-east-1.amazonaws.com/world-news.xml"
        ],
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
        "url": "https://rss-bridge.org/bridge01/?action=display&bridge=NationalGeographicBridge&context=By+Topic&topic=latest-stories&full=on&format=Mrss",
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
    "Financial Times": {
        "url": "https://www.ft.com/myft/following/7d5b226f-2da0-4530-b9ab-15675a1b5f22.rss",
        "category": "business",
        "country": "International",
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
    
    # Start background refresh scheduler first
    start_cache_refresh_scheduler()
    
    # Start image scraping scheduler
    start_image_scraping_scheduler()
    
    # Initial cache population in background thread
    import threading
    def init_cache():
        refresh_news_cache()
        logger.info("✅ Initial cache population complete!")
    
    thread = threading.Thread(target=init_cache, daemon=True)
    thread.start()
    
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
        


        # Try to get channel-level image (for fallback)
        channel_image_url = None
        if hasattr(feed, 'feed') and hasattr(feed.feed, 'image') and feed.feed.image:
            # feed.feed.image is a dict, can have 'url' or 'href'
            if isinstance(feed.feed.image, dict):
                channel_image_url = feed.feed.image.get('url') or feed.feed.image.get('href')

        for entry in feed.entries:  # Get all articles from source
            # Extract image URL from various possible locations
            image_url = None

            # Check for media:thumbnail (CNN and some feeds nest url arrays)
            if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
                thumb = entry.media_thumbnail
                try:
                    # Case 1: list of dicts
                    if isinstance(thumb, list):
                        first = thumb[0]
                        if isinstance(first, dict):
                            url_field = first.get('url') or first.get('href')
                            if isinstance(url_field, list) and len(url_field) > 0:
                                first_inner = url_field[0]
                                if isinstance(first_inner, dict):
                                    image_url = first_inner.get('url') or first_inner.get('href')
                                elif isinstance(first_inner, str):
                                    image_url = first_inner
                            elif isinstance(url_field, str):
                                image_url = url_field
                            elif isinstance(url_field, dict):
                                image_url = url_field.get('url') or url_field.get('href')
                    # Case 2: single dict
                    elif isinstance(thumb, dict):
                        url_field = thumb.get('url') or thumb.get('href')
                        if isinstance(url_field, list) and len(url_field) > 0:
                            first_inner = url_field[0]
                            if isinstance(first_inner, dict):
                                image_url = first_inner.get('url') or first_inner.get('href')
                            elif isinstance(first_inner, str):
                                image_url = first_inner
                        elif isinstance(url_field, str):
                            image_url = url_field
                        elif isinstance(url_field, dict):
                            image_url = url_field.get('url') or url_field.get('href')
                except Exception:
                    pass

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

            # Check for <img> tag in content:encoded (WordPress feeds)
            elif hasattr(entry, 'content') and entry.content:
                import re
                content_text = entry.content[0].value if isinstance(entry.content, list) else str(entry.content)
                img_match = re.search(r'<img[^>]+src="([^"]+)"', content_text)
                if img_match:
                    image_url = img_match.group(1)

            # Check for <img> tag in description/summary
            if not image_url and entry.get('description'):
                img_match = re.search(r'<img[^>]+src="([^"]+)"', entry.description)
                if img_match:
                    image_url = img_match.group(1)

            # If still no image, check for <img> in content:encoded (sometimes present as entry.content:encoded)
            if not image_url and hasattr(entry, 'content_encoded'):
                img_match = re.search(r'<img[^>]+src="([^"]+)"', entry.content_encoded)
                if img_match:
                    image_url = img_match.group(1)
                    
            # if there is no images just take any link that ends with jpg/png/gif
            if not image_url:
                if hasattr(entry, 'links') and entry.links:
                    for link in entry.links:
                        href = link.get('href', '')
                        if re.search(r'\.(jpg|jpeg|png|gif)$', href, re.IGNORECASE):
                            image_url = href
                            break
            # If still no image, use channel-level image as fallback
            if not image_url and channel_image_url:
                image_url = channel_image_url
            
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

def get_rss_as_json(url: str, source_name: str) -> Tuple[Dict[str, Any], Any]:
    """Fetch RSS feed and convert to JSON for better debugging, with retry logic for network errors."""
    max_retries = 3
    base_delay = 5  # seconds
    for attempt in range(max_retries):
        try:
            headers = {
                'User-Agent': 'NewsAggregator/1.0 (RSS to JSON converter)',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*'
            }
            response = requests.get(url, headers=headers, timeout=60)  # Increased timeout
            response.raise_for_status()
            
            # Clean up potential XML issues
            content = response.text.strip()
            content = content.lstrip('\ufeff\xff\xfe')
            
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
        
        except (requests.exceptions.RequestException, OSError) as e:
            logger.warning(f"Attempt {attempt + 1}/{max_retries} failed for {source_name}: {e}")
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)  # Exponential backoff with jitter
                logger.info(f"Retrying {source_name} in {delay:.2f}s...")
                time.sleep(delay)
            else:
                logger.error(f"All retries failed for {source_name}: {e}")
                feed = feedparser.parse(url, agent='NewsAggregator/1.0')
                return {"error": str(e), "fallback": True}, feed

def _process_source(source_name: str, source_info: Dict) -> Tuple[List[NewsArticle], Dict]:
    """Process a single RSS source, fetching and parsing its feed, with per-source throttling."""
    try:
        urls = source_info['url']
        if isinstance(urls, str):
            urls = [urls]
        
        articles = []
        feed_status = "success"
        error_message = None
        
        for url in urls:
            feed_json, feed = get_rss_as_json(url, source_name)
            
            if source_name in ['Novara Media', 'CNN Politics']:
                logger.info(f"📄 RSS JSON for {source_name}: {json.dumps(feed_json, indent=2)}")
            
            if hasattr(feed, 'status') and feed.status >= 400:
                feed_status = "error"
                error_message = f"HTTP {feed.status} error"
                logger.error(f"❌ HTTP {feed.status} for {source_name}: {url}")
                continue
            elif hasattr(feed, 'bozo') and feed.bozo:
                feed_status = "warning"
                bozo_error = str(getattr(feed, 'bozo_exception', 'Unknown error'))
                error_message = f"Parse warning: {bozo_error}"
                parsed_articles = parse_rss_feed_entries(feed.entries, source_name, source_info)
                articles.extend(parsed_articles)
                logger.warning(f"⚠️ XML parsing issue for {source_name}: {bozo_error} (got {len(parsed_articles)} articles)")
            elif not hasattr(feed, 'entries') or len(feed.entries) == 0:
                feed_status = "warning"
                error_message = "No articles found in feed"
                logger.warning(f"⚠️ No entries found for {source_name}: {url}")
                continue
            else:
                parsed_articles = parse_rss_feed_entries(feed.entries, source_name, source_info)
                articles.extend(parsed_articles)
                logger.info(f"✅ Parsed {len(parsed_articles)} articles from {source_name} ({url})")

        source_stat = {
            "name": source_name,
            "url": urls if len(urls) > 1 else urls[0],
            "category": source_info.get('category', 'general'),
            "country": source_info.get('country', 'US'),
            "funding_type": source_info.get('funding_type'),
            "bias_rating": source_info.get('bias_rating'),
            "article_count": len(articles),
            "status": feed_status,
            "error_message": error_message,
            "last_checked": datetime.now().isoformat()
        }
        return articles, source_stat

    except Exception as e:
        logger.error(f"💥 Error processing {source_name}: {e}")
        source_stat = {
            "name": source_name,
            "url": source_info.get('url'),
            "category": source_info.get('category', 'general'),
            "country": source_info.get('country', 'US'),
            "funding_type": source_info.get('funding_type'),
            "bias_rating": source_info.get('bias_rating'),
            "article_count": 0,
            "status": "error",
            "error_message": str(e),
            "last_checked": datetime.now().isoformat()
        }
        return [], source_stat

def _process_source_with_debug(source_name: str, source_info: Dict, stream_id: str) -> Tuple[List[NewsArticle], Dict]:
    """Enhanced version of _process_source with detailed debug logging for streaming"""
    stream_logger.debug(f"🔍 Stream {stream_id} processing source: {source_name}")
    
    try:
        start_time = time.time()
        articles, source_stat = _process_source(source_name, source_info)
        processing_time = time.time() - start_time
        
        stream_logger.info(f"⚡ Stream {stream_id} processed {source_name} in {processing_time:.2f}s: {len(articles)} articles, status: {source_stat.get('status')}")
        
        # Add stream-specific metadata
        source_stat.update({
            "stream_id": stream_id,
            "processing_time_seconds": round(processing_time, 2)
        })
        
        return articles, source_stat
        
    except Exception as e:
        stream_logger.error(f"💥 Stream {stream_id} error processing {source_name}: {e}")
        raise

def refresh_news_cache():
    """Refresh the news cache by parsing all RSS sources concurrently, with per-source throttling to avoid rate limits."""
    if news_cache.update_in_progress:
        logger.info("Cache update already in progress, skipping...")
        return
    
    all_articles = []
    source_stats = []
    source_last_processed = {}  # Per-source throttle tracking

    def partial_update_callback(new_articles, new_source_stat):
        logger.info(f"[Partial] Loaded {len(new_articles)} articles from {new_source_stat['name']}")

    throttle_interval = 20  # seconds per source

    def throttled_process_source(name, info):
        now = time.time()
        last_time = source_last_processed.get(name, 0)
        elapsed = now - last_time
        if elapsed < throttle_interval:
            sleep_time = throttle_interval - elapsed
            logger.info(f"Throttling {name}: Sleeping {sleep_time:.1f}s (per-source limit)")
            time.sleep(sleep_time)
        source_last_processed[name] = time.time()
        return _process_source(name, info)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:  # Reduced workers for less concurrency
        future_to_source = {executor.submit(throttled_process_source, name, info): name for name, info in RSS_SOURCES.items()}
        for future in concurrent.futures.as_completed(future_to_source):
            source_name = future_to_source[future]
            try:
                articles, source_stat = future.result()
                all_articles.extend(articles)
                source_stats.append(source_stat)
                partial_update_callback(articles, source_stat)
            except Exception as exc:
                logger.error(f"💥 Exception for {source_name}: {exc}")
                source_stat = {
                    "name": source_name,
                    "url": RSS_SOURCES[source_name].get('url'),
                    "category": RSS_SOURCES[source_name].get('category', 'general'),
                    "country": RSS_SOURCES[source_name].get('country', 'US'),
                    "funding_type": RSS_SOURCES[source_name].get('funding_type'),
                    "bias_rating": RSS_SOURCES[source_name].get('bias_rating'),
                    "article_count": 0,
                    "status": "error",
                    "error_message": str(exc),
                    "last_checked": datetime.now().isoformat()
                }
                source_stats.append(source_stat)

    # Sort articles by published date (newest first)
    try:
        all_articles.sort(key=lambda x: x.published, reverse=True)
    except:
        pass

    news_cache.update_cache(all_articles, source_stats)
    logger.info(f"✅ Cache refresh completed: {len(all_articles)} total articles")

    # Notify WebSocket clients of the update
    async def notify_clients():
        await manager.broadcast({
            "type": "cache_updated",
            "message": "News cache has been updated",
            "timestamp": datetime.now().isoformat(),
            "stats": {
                "total_articles": len(all_articles),
                "sources_processed": len(source_stats),
            }
        })
    # Run the async broadcast function
    try:
        asyncio.run(notify_clients())
    except RuntimeError:
        # In case an event loop is already running in the thread, schedule it
        loop = asyncio.get_event_loop()
        loop.create_task(notify_clients())


    if len(all_articles) == 0:
        logger.warning(f"⚠️ Cache refresh resulted in 0 articles! Check RSS sources.")
        working_sources = [s for s in source_stats if s['status'] == 'success']
        error_sources = [s for s in source_stats if s['status'] == 'error']
        logger.info(f"📊 Source status: {len(working_sources)} working, {len(error_sources)} with errors")
    else:
        category_counts = {}
        for article in all_articles:
            category_counts[article.category] = category_counts.get(article.category, 0) + 1
        logger.info(f"📊 Articles by category: {category_counts}")
        category_counts = {}
        for article in all_articles:
            category_counts[article.category] = category_counts.get(article.category, 0) + 1
        logger.info(f"📊 Articles by category: {category_counts}")

async def _get_og_image_from_url(url: str) -> Optional[str]:
    """Asynchronously scrape the article URL to find the Open Graph image tag."""
    if not url:
        return None
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        # Use an async HTTP client like httpx for non-blocking requests
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, timeout=10, follow_redirects=True)
            response.raise_for_status()
        
        
        soup = BeautifulSoup(response.content, 'html.parser')
        og_image = soup.find('meta', property='og:image')
        
        if og_image and og_image.get('content'):
            image_url = og_image['content']
            logger.info(f"Scraped og:image: {image_url} from {url}")
            return image_url
            
    except requests.exceptions.RequestException as e:
        logger.warning(f"Could not fetch URL {url} for image scraping: {e}")
    except Exception as e:
        logger.error(f"Error scraping image from {url}: {e}")
        
    return None

def parse_rss_feed_entries(entries, source_name: str, source_info: Dict) -> List[NewsArticle]:
    """Parse RSS feed entries into NewsArticle objects"""
    articles = []
    
    for entry in entries:  # Get all articles from source
        # Extract image URL from various possible locations
        image_url = None
        
        # Check for image tag in content:encoded first, as it's often the main image
        if hasattr(entry, 'content') and entry.content:
            content_text = entry.content[0].value if isinstance(entry.content, list) else str(entry.content)
            img_match = re.search(r'<img[^>]+src="([^"]+)"', content_text)
            if img_match:
                image_url = img_match.group(1)

        # Check for media:thumbnail (handle nested url list like CNN)
        if not image_url and hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
            thumb = entry.media_thumbnail
            try:
                if isinstance(thumb, list):
                    first = thumb[0]
                    if isinstance(first, dict):
                        url_field = first.get('url') or first.get('href')
                        if isinstance(url_field, list) and len(url_field) > 0:
                            first_inner = url_field[0]
                            if isinstance(first_inner, dict):
                                image_url = first_inner.get('url') or first_inner.get('href')
                            elif isinstance(first_inner, str):
                                image_url = first_inner
                        elif isinstance(url_field, str):
                            image_url = url_field
                        elif isinstance(url_field, dict):
                            image_url = url_field.get('url') or url_field.get('href')
                elif isinstance(thumb, dict):
                    url_field = thumb.get('url') or thumb.get('href')
                    if isinstance(url_field, list) and len(url_field) > 0:
                        first_inner = url_field[0]
                        if isinstance(first_inner, dict):
                            image_url = first_inner.get('url') or first_inner.get('href')
                        elif isinstance(first_inner, str):
                            image_url = first_inner
                    elif isinstance(url_field, str):
                        image_url = url_field
                    elif isinstance(url_field, dict):
                        image_url = url_field.get('url') or url_field.get('href')
            except Exception:
                pass
        
        # Check for media:content
        elif not image_url and hasattr(entry, 'media_content') and entry.media_content:
            for media in entry.media_content:
                if media.get('type', '').startswith('image/'):
                    image_url = media.get('url')
                    break
        
        # Check for enclosure (podcast/media)
        elif not image_url and hasattr(entry, 'enclosures') and entry.enclosures:
            for enclosure in entry.enclosures:
                if enclosure.get('type', '').startswith('image/'):
                    image_url = enclosure.get('href')
                    break
        
        # Check for image in links
        elif not image_url and hasattr(entry, 'links') and entry.links:
            for link in entry.links:
                if link.get('type', '').startswith('image/'):
                    image_url = link.get('href')
                    break
        
        # Check for image in description/summary as a fallback
        if not image_url and entry.get('description'):
            img_match = re.search(r'<img[^>]+src="([^"]+)"', entry.description)
            if img_match:
                image_url = img_match.group(1)

        # Note: Image scraping will be handled separately via WebSocket updates
        
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

async def _scrape_and_update_image(article_url: str):
    """Scrape an article for an image and send an update via WebSocket."""
    logger.info(f"🖼️ Starting background image scrape for: {article_url}")
    image_url = await _get_og_image_from_url(article_url)
    if image_url:
        logger.info(f"✅ Found image for {article_url}: {image_url}")
        await _send_image_update(article_url, image_url)
    else:
        logger.info(f"🤷 No image found for {article_url}")

async def _send_image_update(article_url: str, image_url: str):
    """Send a WebSocket message to update an article's image on the frontend."""
    message = {
        "type": "image_update",
        "article_url": article_url,
        "image_url": image_url
    }
    await manager.broadcast(message)

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

def start_image_scraping_scheduler():
    """Start the background thread that scrapes images for articles without them"""
    def image_scraper():
        while True:
            try:
                asyncio.run(scrape_missing_images())
                time.sleep(60)  # Wait 60 seconds before next scrape
            except Exception as e:
                logger.error(f"Error in image scraper: {e}")
                time.sleep(60)  # Still wait 60 seconds even if there's an error
    
    thread = threading.Thread(target=image_scraper, daemon=True)
    thread.start()
    logger.info("🚀 Image scraping scheduler started (60-second intervals)")

async def scrape_missing_images():
    """Find articles without images and scrape them"""
    articles = news_cache.get_articles()
    articles_without_images = [
        article for article in articles 
        if not article.image or article.image.endswith('placeholder.svg')
    ]
    
    if not articles_without_images:
        return
    
    logger.info(f"🖼️ Found {len(articles_without_images)} articles without images, starting scrape...")
    
    # Limit to 5 articles per batch to avoid overwhelming the system
    batch = articles_without_images[:5]
    
    for article in batch:
        try:
            await _scrape_and_update_image(article.link)
        except Exception as e:
            logger.error(f"Error scraping image for {article.link}: {e}")
        
        # Small delay between requests
        await asyncio.sleep(1)


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

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# DEPRECATED: /news endpoint removed - use /news/stream?immediate=true instead

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
async def get_news_by_category(category_name: str):
    """Get news from a specific category from cached data"""
    # Get articles from cache and filter by category
    all_articles = news_cache.get_articles()
    category_articles = [article for article in all_articles if article.category == category_name]
    
    # Get unique sources for this category
    sources_included = list(set(article.source for article in category_articles))
    
    limited_articles = category_articles
    
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
        url = info['url']
        if isinstance(url, list):
            if len(url) == 1:
                # Single URL in a list
                url = url[0]
            else:
                # Multiple URLs - use the first one as primary or create separate entries
                # For now, use the first URL as the primary
                url = url[0]
        source = SourceInfo(
            name=name,
            url=url,
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
    
    # Log cache status for debugging
    logger.info(f"📊 Cache Status: {total_articles} articles, {sources_with_articles} working sources, {sources_with_errors} error sources")
    
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

@app.get("/debug/source/{source_name}")
async def get_source_debug_data(source_name: str):
    """Get detailed debug data for a specific RSS source including parsed feed data"""
    
    if source_name not in RSS_SOURCES:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")
    
    source_info = RSS_SOURCES[source_name]
    
    try:
        # Get the URL to parse - handle both single URL and list of URLs
        rss_url = source_info["url"]
        if isinstance(rss_url, list):
            # For sources with multiple URLs, use the first one for debug data
            rss_url = rss_url[0]
        
        # Get fresh parse of the RSS feed with detailed debug info
        feed = feedparser.parse(rss_url, agent='NewsAggregator/1.0')
        
        # Get cached articles for this source
        cached_articles = [article for article in news_cache.get_articles() if article.source == source_name]
        
        # Get source stats
        source_stats = [stats for stats in news_cache.get_source_stats() if stats['name'] == source_name]
        source_stat = source_stats[0] if source_stats else None
        
        debug_data = {
            "source_name": source_name,
            "source_config": source_info,
            "rss_url": rss_url,
            "all_urls": source_info["url"] if isinstance(source_info["url"], list) else [source_info["url"]],
            "feed_metadata": {
                "title": getattr(feed.feed, 'title', 'N/A'),
                "description": getattr(feed.feed, 'description', 'N/A'),
                "link": getattr(feed.feed, 'link', 'N/A'),
                "language": getattr(feed.feed, 'language', 'N/A'),
                "updated": getattr(feed.feed, 'updated', 'N/A'),
                "generator": getattr(feed.feed, 'generator', 'N/A'),
            },
            "feed_status": {
                "http_status": getattr(feed, 'status', 'N/A'),
                "bozo": getattr(feed, 'bozo', False),
                "bozo_exception": str(getattr(feed, 'bozo_exception', 'None')),
                "entries_count": len(feed.entries) if hasattr(feed, 'entries') else 0,
            },
            "parsed_entries": [],
            "cached_articles": [article.dict() for article in cached_articles],
            "source_statistics": source_stat,
            "debug_timestamp": datetime.now().isoformat(),
            "image_analysis": {
                "total_entries": len(feed.entries) if hasattr(feed, 'entries') else 0,
                "entries_with_images": 0,
                "image_sources": []
            }
        }
        
        # Parse first 10 entries for detailed analysis
        if hasattr(feed, 'entries'):
            for i, entry in enumerate(feed.entries[:10]):
                # Extract all possible image sources
                image_sources = []
                
                if hasattr(entry, 'media_thumbnail'):
                    image_sources.append({"type": "media_thumbnail", "url": entry.media_thumbnail})
                    # Attempt to normalize CNN-style nested url
                    try:
                        thumb = entry.media_thumbnail
                        normalized = None
                        if isinstance(thumb, list) and thumb:
                            first = thumb[0]
                            if isinstance(first, dict):
                                url_field = first.get('url') or first.get('href')
                                if isinstance(url_field, list) and url_field:
                                    inner = url_field[0]
                                    if isinstance(inner, dict):
                                        normalized = inner.get('url') or inner.get('href')
                                    elif isinstance(inner, str):
                                        normalized = inner
                                elif isinstance(url_field, str):
                                    normalized = url_field
                        elif isinstance(thumb, dict):
                            url_field = thumb.get('url') or thumb.get('href')
                            if isinstance(url_field, list) and url_field:
                                inner = url_field[0]
                                if isinstance(inner, dict):
                                    normalized = inner.get('url') or inner.get('href')
                                elif isinstance(inner, str):
                                    normalized = inner
                            elif isinstance(url_field, str):
                                normalized = url_field
                        if normalized:
                            image_sources.append({"type": "media_thumbnail_normalized", "url": normalized})
                    except Exception:
                        pass
                if hasattr(entry, 'media_content'):
                    image_sources.append({"type": "media_content", "data": entry.media_content})
                if hasattr(entry, 'enclosures'):
                    image_sources.append({"type": "enclosures", "data": entry.enclosures})
                
                # Check for images in content
                content_images = []
                if hasattr(entry, 'content'):
                    content_text = entry.content[0].value if isinstance(entry.content, list) else str(entry.content)
                    img_matches = re.findall(r'<img[^>]+src="([^"]+)"', content_text)
                    content_images = img_matches
                
                # Check for images in description
                desc_images = []
                if entry.get('description'):
                    desc_matches = re.findall(r'<img[^>]+src="([^"]+)"', entry.description)
                    desc_images = desc_matches
                
                has_images = bool(image_sources or content_images or desc_images)
                if has_images:
                    debug_data["image_analysis"]["entries_with_images"] += 1
                
                parsed_entry = {
                    "index": i,
                    "title": entry.get('title', 'No title'),
                    "link": entry.get('link', ''),
                    "description": entry.get('description', 'No description')[:200] + "..." if entry.get('description') and len(entry.get('description', '')) > 200 else entry.get('description', 'No description'),
                    "published": entry.get('published', 'No date'),
                    "author": entry.get('author', 'No author'),
                    "tags": entry.get('tags', []),
                    "has_images": has_images,
                    "image_sources": image_sources,
                    "content_images": content_images,
                    "description_images": desc_images,
                    "raw_entry_keys": list(entry.keys()) if hasattr(entry, 'keys') else []
                }
                
                debug_data["parsed_entries"].append(parsed_entry)
                debug_data["image_analysis"]["image_sources"].extend([
                    {"entry_index": i, "source": "content", "urls": content_images},
                    {"entry_index": i, "source": "description", "urls": desc_images},
                    {"entry_index": i, "source": "metadata", "data": image_sources}
                ])
        
        return debug_data
        
    except Exception as e:
        logger.error(f"Error fetching debug data for {source_name}: {str(e)}")
        return {
            "source_name": source_name,
            "source_config": source_info,
            "error": str(e),
            "debug_timestamp": datetime.now().isoformat()
        }

@app.get("/news/stream")
async def stream_news(request: Request, background_tasks: BackgroundTasks, use_cache: bool = True, category: Optional[str] = None):
    """
    Streams news articles progressively. It uses a cache for initial data and then fetches fresh articles in the background.

    Parameters:
    - use_cache: If True, uses cached data for an immediate response.
    - category: Filters articles by a specific category.
    """
    
    # Generate unique stream ID for tracking
    stream_id = f"stream_{int(time.time())}_{random.randint(1000, 9999)}"
    stream_logger.info(f"🎯 NEWS REQUEST: {stream_id}, use_cache={use_cache}")
    
    active_count = stream_manager.get_active_stream_count()
    if active_count >= 5:  # Limit concurrent streams
        stream_logger.warning(f"🚫 Stream {stream_id} rejected: too many active streams ({active_count})")
        async def error_stream():
            yield f"data: {json.dumps({'status': 'error', 'message': f'Too many active streams ({active_count}). Please try again later.'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")
    
    # Register stream for tracking
    stream_info = stream_manager.register_stream(stream_id)
    
    stream_logger.info(f"🚀 {stream_id} using streaming mode")
    stream_manager.update_stream(stream_id, status="starting")
    
    async def event_generator():
        try:
            stream_logger.info(f"🚀 Stream {stream_id} starting event generation")
            
            # Send initial status
            initial_status = {
                'status': 'starting',
                'stream_id': stream_id,
                'message': f'Initializing news stream (use_cache={use_cache})...',
                'timestamp': datetime.now().isoformat(),
                'active_streams': stream_manager.get_active_stream_count()
            }
            stream_logger.debug(f"📤 Stream {stream_id} sending initial status")
            yield f"data: {json.dumps(initial_status)}\n\n"
            
            # Check if we should use cache
            cached_articles = []
            if use_cache:
                stream_logger.info(f"💾 Stream {stream_id} using cache-first approach")
                
                # First, send cached articles immediately
                cached_articles = news_cache.get_articles()
                cached_stats = news_cache.get_source_stats()
                cache_age = (datetime.now() - news_cache.last_updated).total_seconds()
                
                stream_logger.info(f"📋 Stream {stream_id} found {len(cached_articles)} cached articles (age: {cache_age:.1f}s)")
                
                if cached_articles:
                    # Filter by category if provided
                    if category:
                        cached_articles = [a for a in cached_articles if a.category == category]

                    cache_data = {
                        "status": "cache_data",
                        "stream_id": stream_id,
                        "articles": [a.dict() for a in cached_articles],  # No limit on initial burst
                        "source_stats": cached_stats,
                        "cache_age_seconds": cache_age,
                        "message": f"Loaded {len(cached_articles)} cached articles",
                        "timestamp": datetime.now().isoformat()
                    }
                    stream_logger.debug(f"📤 Stream {stream_id} sending cached data: {len(cached_articles)} articles")
                    yield f"data: {json.dumps(cache_data)}\n\n"
                
                # Check if cache is fresh enough (less than 2 minutes old)
                if cache_age < 120 and len(cached_articles) > 0:
                    stream_logger.info(f"✅ Stream {stream_id} cache is fresh enough ({cache_age:.1f}s), ending stream")
                    final_data = {
                        "status": "complete",
                        "stream_id": stream_id,
                        "message": "Used fresh cached data",
                        "cache_age_seconds": cache_age,
                        "timestamp": datetime.now().isoformat()
                    }
                    yield f"data: {json.dumps(final_data)}\n\n"
                    return
                else:
                    stream_logger.info(f"⏰ Stream {stream_id} cache is stale ({cache_age:.1f}s), fetching fresh data")
            
            # Fetch fresh data
            stream_logger.info(f"🔄 Stream {stream_id} starting fresh data fetch")
            stream_manager.update_stream(stream_id, status="fetching_fresh")
            
            loop = asyncio.get_event_loop()
            
            # Process sources with rate limiting awareness
            sources_to_process = list(RSS_SOURCES.items())

            # Filter sources by category if provided
            if category:
                sources_to_process = [(name, info) for name, info in sources_to_process if info.get('category') == category]
                stream_logger.info(f"Applied category filter '{category}', processing {len(sources_to_process)} sources.")

            stream_logger.info(f"📊 Stream {stream_id} will process {len(sources_to_process)} sources")
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:  # Reduced concurrency
                # Create futures with throttling
                future_to_source = {}
                
                for name, info in sources_to_process:
                    # Check if this source needs throttling
                    should_throttle, wait_time = stream_manager.should_throttle_source(name)
                    
                    if should_throttle:
                        stream_logger.info(f"⏳ Stream {stream_id} throttling source {name} for {wait_time:.1f}s")
                        # Create a delayed task
                        async def delayed_process():
                            await asyncio.sleep(wait_time)
                            return await loop.run_in_executor(executor, _process_source_with_debug, name, info, stream_id)
                        future = asyncio.create_task(delayed_process())
                    else:
                        future = loop.run_in_executor(executor, _process_source_with_debug, name, info, stream_id)
                    
                    future_to_source[future] = name
                
                completed_sources = 0
                total_sources = len(sources_to_process)
                all_articles = []
                all_source_stats = []
                
                stream_logger.info(f"⚡ Stream {stream_id} processing {total_sources} sources with {len(future_to_source)} futures")
                
                # Process completed futures
                for future in asyncio.as_completed(list(future_to_source.keys())):
                    # Check if client disconnected
                    if await request.is_disconnected():
                        stream_logger.warning(f"🔌 Stream {stream_id} client disconnected")
                        stream_manager.update_stream(stream_id, client_connected=False)
                        break
                    
                    try:
                        articles, source_stat = await future
                        source_name = source_stat.get('name', 'unknown') if isinstance(source_stat, dict) else 'unknown'
                        completed_sources += 1
                        
                        all_articles.extend(articles)
                        all_source_stats.append(source_stat)
                        
                        # Update stream tracking
                        stream_manager.update_stream(stream_id, 
                                                   sources_completed=completed_sources,
                                                   status="processing")
                        
                        stream_logger.info(f"✅ Stream {stream_id} completed source {source_name}: {len(articles)} articles")
                        
                        # Send progress update
                        progress_data = {
                            "status": "source_complete",
                            "stream_id": stream_id,
                            "source": source_name,
                            "articles": [a.dict() for a in articles] if len(articles) <= 20 else [a.dict() for a in articles[:20]],  # Limit per-source articles
                            "source_stat": source_stat,
                            "progress": {
                                "completed": completed_sources,
                                "total": total_sources,
                                "percentage": round((completed_sources / total_sources) * 100, 1)
                            },
                            "timestamp": datetime.now().isoformat()
                        }
                        
                        stream_logger.debug(f"📤 Stream {stream_id} sending progress: {completed_sources}/{total_sources}")
                        yield f"data: {json.dumps(progress_data)}\n\n"
                        
                    except Exception as exc:
                        completed_sources += 1
                        source_name = future_to_source.get(future, "unknown")
                        stream_logger.error(f"❌ Stream {stream_id} error for {source_name}: {exc}")
                        
                        # Send error for this source
                        error_data = {
                            "status": "source_error",
                            "stream_id": stream_id,
                            "source": source_name,
                            "error": str(exc),
                            "progress": {
                                "completed": completed_sources,
                                "total": total_sources,
                                "percentage": round((completed_sources / total_sources) * 100, 1)
                            },
                            "timestamp": datetime.now().isoformat()
                        }
                        yield f"data: {json.dumps(error_data)}\n\n"
                
                # Sort and send final results
                stream_logger.info(f"🏁 Stream {stream_id} completed: {len(all_articles)} total articles from {len(all_source_stats)} sources")
                
                try:
                    all_articles.sort(key=lambda x: x.published, reverse=True)
                except Exception as e:
                    stream_logger.warning(f"⚠️ Stream {stream_id} couldn't sort articles: {e}")
                
                # Send completion message
                final_data = {
                    "status": "complete",
                    "stream_id": stream_id,
                    "message": f"Successfully loaded {len(all_articles)} articles from {len(all_source_stats)} sources",
                    "total_articles": len(all_articles),
                    "successful_sources": len([s for s in all_source_stats if s.get('status') == 'success']),
                    "failed_sources": len([s for s in all_source_stats if s.get('status') == 'error']),
                    "progress": {
                        "completed": total_sources,
                        "total": total_sources,
                        "percentage": 100
                    },
                    "timestamp": datetime.now().isoformat()
                }
                stream_logger.info(f"📤 Stream {stream_id} sending completion data")
                yield f"data: {json.dumps(final_data)}\n\n"
                
        except asyncio.CancelledError:
            stream_logger.warning(f"🚫 Stream {stream_id} was cancelled")
            raise
        except Exception as e:
            stream_logger.error(f"💥 Stream {stream_id} unexpected error: {e}")
            error_response = {
                "status": "error",
                "stream_id": stream_id,
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
            yield f"data: {json.dumps(error_response)}\n\n"
        finally:
            stream_manager.unregister_stream(stream_id)
            stream_logger.info(f"🧹 Stream {stream_id} cleanup completed")
    
    return StreamingResponse(
        event_generator(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Stream-ID": stream_id,
        }
    )

# Add endpoint to get stream manager status
@app.get("/debug/streams")
async def get_stream_status():
    """Get current streaming status for debugging"""
    with stream_manager.lock:
        return {
            "active_streams": len(stream_manager.active_streams),
            "total_streams_created": stream_manager.stream_counter,
            "streams": {
                stream_id: {
                    "status": info["status"],
                    "sources_completed": info["sources_completed"],
                    "total_sources": info["total_sources"],
                    "duration_seconds": (datetime.now() - info["start_time"]).total_seconds(),
                    "client_connected": info["client_connected"]
                }
                for stream_id, info in stream_manager.active_streams.items()
            },
            "source_throttling": dict(stream_manager.source_last_accessed)
        }

@app.websocket("/ws/news")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Article Analysis Models
class ArticleAnalysisRequest(BaseModel):
    url: str
    source_name: Optional[str] = None

class ArticleAnalysisResponse(BaseModel):
    success: bool
    article_url: str
    full_text: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[List[str]] = None
    publish_date: Optional[str] = None
    source_analysis: Optional[Dict[str, Any]] = None
    reporter_analysis: Optional[Dict[str, Any]] = None
    bias_analysis: Optional[Dict[str, Any]] = None
    fact_check_suggestions: Optional[List[str]] = None
    summary: Optional[str] = None
    error: Optional[str] = None

async def extract_article_content(url: str) -> Dict[str, Any]:
    """Extract full article content using newspaper3k"""
    try:
        article = Article(url)
        article.download()
        article.parse()
        
        return {
            "success": True,
            "title": article.title,
            "authors": article.authors,
            "publish_date": str(article.publish_date) if article.publish_date else None,
            "text": article.text,
            "top_image": article.top_image,
            "images": list(article.images),
            "keywords": article.keywords if hasattr(article, 'keywords') else [],
            "meta_description": article.meta_description if hasattr(article, 'meta_description') else None
        }
    except Exception as e:
        logger.error(f"Error extracting article from {url}: {e}")
        return {
            "success": False,
            "error": str(e)
        }

async def analyze_with_gemini(article_data: Dict[str, Any], source_name: Optional[str] = None) -> Dict[str, Any]:
    """Use Gemini AI to analyze the article with Google Search grounding"""
    if not gemini_client:
        return {
            "error": "Gemini API key not configured"
        }
    
    try:
        # Configure Google Search grounding tool
        grounding_tool = types.Tool(
            google_search=types.GoogleSearch()
        )
        
        config = types.GenerateContentConfig(
            tools=[grounding_tool],
            response_modalities=["TEXT"]
        )
        
        # Prepare the prompt for comprehensive analysis
        prompt = f"""
You are an expert media analyst. Analyze the following news article comprehensively and use Google Search to verify facts and gather additional context about the source and reporters:

**Article Title:** {article_data.get('title', 'Unknown')}
**Source:** {source_name or 'Unknown'}
**Authors:** {', '.join(article_data.get('authors', [])) if article_data.get('authors') else 'Unknown'}
**Published:** {article_data.get('publish_date', 'Unknown')}

**Article Text:**
{article_data.get('text', '')[:4000]}  

Please provide a detailed analysis in the following JSON format:

{{
  "summary": "A concise 2-3 sentence summary of the article",
  "source_analysis": {{
    "credibility_assessment": "Assessment of source credibility (high/medium/low)",
    "ownership": "Information about who owns this publication",
    "funding_model": "How is this source funded",
    "political_leaning": "Political bias assessment (left/center/right)",
    "reputation": "General reputation and track record"
  }},
  "reporter_analysis": {{
    "background": "Background information on the reporter(s) if available",
    "expertise": "Reporter's area of expertise",
    "known_biases": "Any known biases or perspectives",
    "track_record": "Notable past work or controversies"
  }},
  "bias_analysis": {{
    "tone_bias": "Analysis of emotional tone and word choice",
    "framing_bias": "How the story is framed or presented",
    "selection_bias": "What information is included or excluded",
    "source_diversity": "Diversity of sources quoted in the article",
    "overall_bias_score": "Overall bias rating (1-10, where 5 is neutral)"
  }},
  "fact_check_suggestions": [
    "Key claim 1 that should be fact-checked",
    "Key claim 2 that should be fact-checked",
    "Key claim 3 that should be fact-checked"
  ],
  "context": "Important background context for understanding this story",
  "missing_perspectives": "What perspectives or information might be missing"
}}

Provide only the JSON response, no additional text.
"""
        
        # Generate content with grounding
        response = gemini_client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=prompt,
            config=config
        )
        
        # Extract grounding metadata if available
        grounding_metadata = {}
        if response.candidates and len(response.candidates) > 0:
            candidate = response.candidates[0]
            if hasattr(candidate, 'grounding_metadata') and candidate.grounding_metadata:
                metadata = candidate.grounding_metadata
                grounding_metadata = {
                    "grounding_chunks": [],
                    "grounding_supports": [],
                    "web_search_queries": []
                }
                
                # Extract grounding chunks (sources)
                if hasattr(metadata, 'grounding_chunks') and metadata.grounding_chunks:
                    for chunk in metadata.grounding_chunks:
                        if hasattr(chunk, 'web') and chunk.web:
                            grounding_metadata["grounding_chunks"].append({
                                "uri": chunk.web.uri if hasattr(chunk.web, 'uri') else None,
                                "title": chunk.web.title if hasattr(chunk.web, 'title') else None
                            })
                
                # Extract web search queries
                if hasattr(metadata, 'web_search_queries') and metadata.web_search_queries:
                    grounding_metadata["web_search_queries"] = list(metadata.web_search_queries)
                
                logger.info(f"📚 Grounding metadata: {len(grounding_metadata.get('grounding_chunks', []))} sources found")
        
        # Parse the JSON response
        try:
            # Extract JSON from response
            response_text = response.text.strip()
            # Remove markdown code blocks if present
            if response_text.startswith('```'):
                response_text = response_text.split('```')[1]
                if response_text.startswith('json'):
                    response_text = response_text[4:]
            
            analysis = json.loads(response_text)
            
            # Add grounding metadata to the analysis
            if grounding_metadata:
                analysis["grounding_metadata"] = grounding_metadata
            
            return analysis
        except json.JSONDecodeError:
            # If JSON parsing fails, return raw response
            return {
                "raw_response": response.text,
                "grounding_metadata": grounding_metadata,
                "error": "Failed to parse AI response as JSON"
            }
            
    except Exception as e:
        logger.error(f"Error analyzing with Gemini: {e}")
        return {
            "error": str(e)
        }

@app.post("/api/article/analyze", response_model=ArticleAnalysisResponse)
async def analyze_article(request: ArticleAnalysisRequest):
    """
    Analyze a news article using AI to extract full content, source information,
    reporter background, and bias analysis.
    """
    logger.info(f"📰 Analyzing article: {request.url}")
    
    try:
        # Step 1: Extract article content
        article_data = await extract_article_content(request.url)
        
        if not article_data.get("success"):
            return ArticleAnalysisResponse(
                success=False,
                article_url=request.url,
                error=article_data.get("error", "Failed to extract article content")
            )
        
        # Step 2: Analyze with Gemini AI
        ai_analysis = await analyze_with_gemini(article_data, request.source_name)
        
        if "error" in ai_analysis and "raw_response" not in ai_analysis:
            return ArticleAnalysisResponse(
                success=False,
                article_url=request.url,
                full_text=article_data.get("text"),
                title=article_data.get("title"),
                authors=article_data.get("authors"),
                publish_date=article_data.get("publish_date"),
                error=ai_analysis.get("error")
            )
        
        # Step 3: Combine results
        return ArticleAnalysisResponse(
            success=True,
            article_url=request.url,
            full_text=article_data.get("text"),
            title=article_data.get("title"),
            authors=article_data.get("authors"),
            publish_date=article_data.get("publish_date"),
            source_analysis=ai_analysis.get("source_analysis"),
            reporter_analysis=ai_analysis.get("reporter_analysis"),
            bias_analysis=ai_analysis.get("bias_analysis"),
            fact_check_suggestions=ai_analysis.get("fact_check_suggestions"),
            summary=ai_analysis.get("summary")
        )
        
    except Exception as e:
        logger.error(f"💥 Error analyzing article {request.url}: {e}")
        return ArticleAnalysisResponse(
            success=False,
            article_url=request.url,
            error=str(e)
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

