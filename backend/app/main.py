from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
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

import concurrent.futures

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

        # Check for media:thumbnail
        if not image_url and hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
            image_url = entry.media_thumbnail[0].get('url') if isinstance(entry.media_thumbnail, list) else entry.media_thumbnail.get('url')
        
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
    logger.info(f"📡 /news endpoint called - Total cached articles: {len(all_articles)}, filters: category={category}, source={source}, limit={limit}")
    
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
    
    if len(limited_articles) == 0:
        logger.warning(f"⚠️ No articles to return after filtering. Cache has {len(all_articles)} total articles")
        if len(all_articles) > 0:
            # Log sample of available articles for debugging
            sample_articles = all_articles[:3]
            logger.info(f"📋 Sample cached articles: {[{'title': a.title, 'category': a.category, 'source': a.source} for a in sample_articles]}")
    else:
        logger.info(f"✅ Returning {len(limited_articles)} articles from {len(sources_included)} sources")
    
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
async def stream_news(request: Request):
    """Stream news articles as they are loaded using Server-Sent Events (SSE)."""
    async def event_generator():
        # Send initial status message
        yield f"data: {json.dumps({'status': 'starting', 'message': 'Loading news articles...'})}\n\n"
        
        loop = asyncio.get_event_loop()
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            # Submit all RSS source processing tasks
            future_to_source = {
                loop.run_in_executor(executor, _process_source, name, info): name 
                for name, info in RSS_SOURCES.items()
            }
            
            completed_sources = 0
            total_sources = len(RSS_SOURCES)
            
            # Process sources as they complete
            for future in asyncio.as_completed(future_to_source):
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                
                try:
                    articles, source_stat = await future
                    completed_sources += 1
                    
                    # Send progress update with articles from this source
                    data = {
                        "status": "partial_update",
                        "source": source_stat["name"],
                        "articles": [a.dict() for a in articles],
                        "source_stat": source_stat,
                        "progress": {
                            "completed": completed_sources,
                            "total": total_sources,
                            "percentage": round((completed_sources / total_sources) * 100, 1)
                        }
                    }
                    yield f"data: {json.dumps(data)}\n\n"
                    
                except Exception as exc:
                    completed_sources += 1
                    source_name = future_to_source.get(future, "unknown")
                    logger.error(f"SSE stream error for {source_name}: {exc}")
                    
                    # Send error for this source
                    error_data = {
                        "status": "source_error",
                        "source": source_name,
                        "error": str(exc),
                        "progress": {
                            "completed": completed_sources,
                            "total": total_sources,
                            "percentage": round((completed_sources / total_sources) * 100, 1)
                        }
                    }
                    yield f"data: {json.dumps(error_data)}\n\n"
            
            # Send completion message
            final_data = {
                "status": "complete",
                "message": f"Loaded articles from {total_sources} sources",
                "progress": {
                    "completed": total_sources,
                    "total": total_sources,
                    "percentage": 100
                }
            }
            yield f"data: {json.dumps(final_data)}\n\n"
    
    return StreamingResponse(
        event_generator(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
