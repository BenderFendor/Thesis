# Log

## 2025-10-20: Reading Queue Enhancements - Phase 1

### Overview
Implemented comprehensive reading queue improvements to support distraction-free reading, keyboard navigation, highlights, and queue management.

### Features Added

#### 1. **Extended Data Model**
- Added `word_count`, `estimated_read_time_minutes`, and `full_text` columns to `ReadingQueueItem` in both Pydantic model and database
- Added new `Highlight` model for storing user annotations
- Formula for read time: $\text{minutes} = \lceil \frac{\text{word\_count}}{230} \rceil$ (avg adult reading speed)

#### 2. **Navigation Enhancements**
- Extended `useReadingQueue` hook with new methods:
  - `goNext(index)` - Navigate to next unread article
  - `goPrev(index)` - Navigate to previous article  
  - `getCurrentArticle(index)` - Get article at index
  - `getArticleIndex(url)` - Find article index by URL
  - `markAsRead(url)` - Mark article as completed

#### 3. **Distraction-Free Reader Mode**
- Created `frontend/app/reader/page.tsx` with full-screen reading interface
- **Keyboard Shortcuts**:
  - `ArrowRight` - Next article
  - `ArrowLeft` - Previous article
- **Features**:
  - Clean, typography-optimized layout
  - Article metadata (source, publish date)
  - Full article content rendering
  - Navigation footer with progress indicator

#### 4. **Highlight System**
- Added highlight creation, storage, and management
- **Highlight Colors**: Yellow, Blue, Red
- **Storage**: LocalStorage for client-side persistence + optional database sync
- **Highlight Toolbar**: 
  - Appears on text selection
  - Color picker
  - Optional notes for each highlight
  - Delete functionality
- **Highlights List**: Shows all highlights for current article with source links

#### 5. **Queue Overview & Statistics**
- New `GET /api/queue/overview` endpoint returning:
  - Total items count
  - Daily vs permanent split
  - Unread/reading/completed breakdown
  - Estimated total read time for unread articles
- Created `QueueOverviewCard` component for sidebar integration
- Real-time stats with 30-second refresh interval

#### 6. **Backend Highlights API** (`/api/queue/highlights/*`)
- `POST /highlights` - Create highlight
- `GET /highlights` - Get all highlights
- `GET /highlights/article/{url}` - Get highlights for article
- `PATCH /highlights/{id}` - Update highlight (color, note)
- `DELETE /highlights/{id}` - Remove highlight

#### 7. **Frontend API Layer** (`frontend/lib/api.ts`)
Added functions:
- `getQueueOverview()` - Fetch queue statistics
- `createHighlight()` - Save highlight to backend
- `getHighlightsForArticle()` - Fetch article-specific highlights
- `getAllHighlights()` - Fetch user's all highlights  
- `updateHighlight()` - Modify highlight
- `deleteHighlight()` - Remove highlight

#### 8. **UI Components**
- `components/queue-overview-card.tsx` - Dashboard widget showing queue stats
- `components/highlights-view.tsx` - Dedicated highlights management interface
  - Search and filter by color
  - Link back to source articles
  - Delete functionality

### Files Created
- `frontend/app/reader/page.tsx` - Reader mode with navigation & highlights
- `frontend/components/queue-overview-card.tsx` - Queue statistics widget
- `frontend/components/highlights-view.tsx` - Highlights manager
- `backend/app/services/highlights.py` - Highlights CRUD service

### Files Modified
- `backend/app/models/reading_queue.py` - Added Highlight model & updated ReadingQueueItem
- `backend/app/database.py` - Added Highlight table, extended ReadingQueueItem schema
- `backend/app/services/reading_queue.py` - Added helpers for word count, read time, queue overview
- `backend/app/api/routes/reading_queue.py` - Added overview & highlights endpoints
- `frontend/hooks/useReadingQueue.ts` - Extended with navigation methods
- `frontend/lib/api.ts` - Added 8 new API functions for queue/highlights

### Database Migrations Required
```sql
ALTER TABLE reading_queue
ADD COLUMN word_count INTEGER,
ADD COLUMN estimated_read_time_minutes INTEGER,
ADD COLUMN full_text TEXT;

CREATE TABLE highlights (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  article_url VARCHAR NOT NULL,
  highlighted_text TEXT NOT NULL,
  color VARCHAR DEFAULT 'yellow',
  note TEXT,
  character_start INTEGER NOT NULL,
  character_end INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Next Steps (Future)
- Inline definitions (double-tap term → LLM explanation)
- Daily digest synthesis
- Keyboard shortcut for fullscreen toggle  
- Highlight export/sharing
- Story clustering & novelty scoring (deferred)

## 2025-10-19: Fix RSS Ingestion Timeout with Streaming Progress

### Problem
Fetching latest news was stalling/timing out because the backend was waiting for the entire cache refresh to complete before returning a response. With 12,000+ articles, this took too long and exceeded timeout limits.

### Root Cause
- `/cache/refresh` endpoint was **synchronous** - it awaited the entire `refresh_news_cache()` function
- Processing 12,000+ articles in parallel (5 sources at a time) still takes minutes
- Frontend had **no visibility** into progress, just waiting indefinitely

### Solution: Implement Streaming Progress
1. **Backend changes (`app/services/rss_ingestion.py`)**:
   - Added optional `source_progress_callback` parameter to `refresh_news_cache()`
   - Callback invoked for each source as it completes
   - Callback also called on errors for visibility into failures

2. **Backend changes (`app/api/routes/cache.py`)**:
   - Created new `/cache/refresh/stream` POST endpoint
   - Replaced blocking architecture with SSE (Server-Sent Events) streaming
   - Uses `queue.Queue` for thread-safe communication between refresh thread and event generator
   - Emits events for each source completion with metadata (articles count, status, etc.)
   - Final completion event includes summary stats

3. **Frontend changes (`frontend/lib/api.ts`)**:
   - Updated `refreshCache()` to consume SSE stream instead of waiting for response
   - Added `onProgress` callback parameter for progress updates
   - Properly parses SSE `data:` format events
   - Returns only when complete event received

4. **Frontend changes (`frontend/app/sources/page.tsx`)**:
   - Added `refreshProgress` state to track streaming updates
   - Updated UI to show real-time progress:
     - Displays number of sources processed
     - Shows articles from last source
     - Displays final summary when complete
   - Progress visible while refresh is in progress (no more hanging)

### Expected Behavior
- User clicks "Refresh Cache"
- Progress immediately starts showing ("Processing: 1 source completed, 45 articles...")
- As each source completes, progress updates (2 sources, 3 sources, etc.)
- When complete, shows final summary (total articles, successful/failed sources)
- Frontend no longer times out waiting for completion

### Files Modified
- `backend/app/services/rss_ingestion.py` - Added callback support
- `backend/app/api/routes/cache.py` - New `/cache/refresh/stream` endpoint  
- `frontend/lib/api.ts` - Updated `refreshCache()` for streaming
- `frontend/app/sources/page.tsx` - UI progress display

## 2025-10-19: Docker Build Optimization

### Changes Made
- ✅ Created root-level `.dockerignore` to exclude build context bloat (node_modules, .git, caches)
- ✅ Restructured `backend/Dockerfile` for better layer caching (deps → code separation)
- ✅ Updated `docker-compose.yml` backend context from `./backend` to `.` (repo root)
- ✅ Enhanced `frontend/.dockerignore` with additional exclusions
- ✅ Updated backend COPY paths to use `backend/` prefix (matching new context)

### Expected Performance Improvements
- Build context size: ~500MB → ~50MB (90% reduction)
- Clean build time: ~1436s → 200-300s (78-86% faster)
- Incremental builds: ~608s → 10-30s (95-98% faster)
- Layer cache hits on code-only changes

### Build Commands
```bash
# Enable BuildKit (add to ~/.zshrc for persistence)
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Parallel build with cache
docker compose build --parallel

# Clean build test
docker compose down -v
docker system prune -af
time docker compose build --parallel
```

### Validation
```bash
# Check build context size
docker build --no-cache -f backend/Dockerfile . 2>&1 | grep "Sending build context"

# Test incremental build
echo "# test" >> backend/app/main.py
time docker compose build backend
```

---

# Database Integration Guide - PostgreSQL + ChromaDB

This guide provides updated best practices for integrating PostgreSQL and ChromaDB into the Thesis news platform based on 2025 documentation and patterns.

## Architecture Overview

**PostgreSQL**: Structured data (articles, bookmarks, preferences, metadata)  
**ChromaDB**: Vector embeddings for semantic search and article similarity  
**Pattern**: Dual-write - store article metadata in PostgreSQL, embeddings in ChromaDB

## PostgreSQL Setup

### Docker Compose Configuration (Recommended)

```yaml
services:
  postgres:
    image: postgres:17-alpine  # Latest stable version
    restart: unless-stopped
    environment:
      POSTGRES_USER: newsuser
      POSTGRES_PASSWORD: newspass
      POSTGRES_DB: newsdb
    ports:
      - "6543:6543"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/init.sql:/docker-entrypoint-initdb.d/init.sql
    # Performance tuning for news aggregation workload
    command: |
      postgres
      -c shared_buffers=256MB
      -c effective_cache_size=1GB
      -c maintenance_work_mem=64MB
      -c wal_compression=zstd
      -c max_connections=100
      -c random_page_cost=1.1
      -c effective_io_concurrency=200
      -c work_mem=4MB
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U newsuser -d newsdb"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://newsuser:newspass@postgres:6543/newsdb
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - CHROMA_HOST=chromadb
      - CHROMA_PORT=8000
    depends_on:
      postgres:
        condition: service_healthy
      chromadb:
        condition: service_started

volumes:
  postgres_data:
```

### Database URL Format

```python
# For async operations (recommended for FastAPI)
DATABASE_URL = "postgresql+asyncpg://newsuser:newspass@postgres:6543/newsdb"

# For sync operations (if needed)
DATABASE_URL = "postgresql+psycopg2://newsuser:newspass@postgres:6543/newsdb"
```

### Backend Integration (backend/app/database.py)

```python
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Boolean, ARRAY
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

# Use async engine for better performance
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://newsuser:newspass@localhost:6543/newsdb")

# Async engine configuration
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # Set to True for SQL debugging
    future=True,
    pool_size=20,  # Adjust based on concurrent users
    max_overflow=0
)

AsyncSessionLocal = sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

Base = declarative_base()

# Dependency for FastAPI
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```

### Schema Design (backend/init.sql)

```sql
-- Articles table with full-text search
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  country TEXT,
  credibility TEXT,
  bias TEXT,
  summary TEXT,
  content TEXT,
  image_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  category TEXT,
  url TEXT UNIQUE NOT NULL,
  tags TEXT[],
  original_language TEXT DEFAULT 'en',
  translated BOOLEAN DEFAULT false,
  chroma_id TEXT UNIQUE,  -- Links to ChromaDB
  embedding_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_articles_source ON articles(source);
CREATE INDEX idx_articles_category ON articles(category);
CREATE INDEX idx_articles_published ON articles(published_at DESC);
CREATE INDEX idx_articles_url ON articles(url);
CREATE INDEX idx_articles_chroma_id ON articles(chroma_id);

-- Full-text search index (for fallback search)
CREATE INDEX idx_articles_search ON articles USING GIN(to_tsvector('english', title || ' ' || COALESCE(summary, '')));

-- Bookmarks (no user auth needed for self-hosted)
CREATE TABLE IF NOT EXISTS bookmarks (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_id)
);

-- Preferences (shared or single-user)
CREATE TABLE IF NOT EXISTS preferences (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Search history for analytics
CREATE TABLE IF NOT EXISTS search_history (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  search_type TEXT,  -- 'semantic', 'keyword', 'agentic'
  results_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_preferences_updated_at BEFORE UPDATE ON preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

## ChromaDB Setup

### Docker Compose Configuration

```yaml
services:
  chromadb:
    image: chromadb/chroma:latest
    restart: unless-stopped
    ports:
      - "8001:8000"  # Use 8001 to avoid conflict with backend
    volumes:
      - chromadb_data:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE
      - ANONYMIZED_TELEMETRY=FALSE
      - CHROMA_SERVER_HOST=0.0.0.0
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/heartbeat"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  chromadb_data:
```

### Backend Integration (backend/app/vector_store.py)

```python
import chromadb
from chromadb.config import Settings
from typing import List, Dict, Optional
import os
import logging
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8001"))

class VectorStore:
    def __init__(self):
        # Use HTTP client for Docker setup
        self.client = chromadb.HttpClient(
            host=CHROMA_HOST,
            port=CHROMA_PORT,
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True  # Enable for development
            )
        )
        
        # Create or get collection
        self.collection = self.client.get_or_create_collection(
            name="news_articles",
            metadata={"hnsw:space": "cosine"}  # Cosine similarity for text
        )
        
        # Use lightweight embedding model
        # Alternative: 'all-MiniLM-L6-v2' (384 dims, faster)
        # or 'BAAI/bge-small-en-v1.5' (384 dims, better quality)
        self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
        
        logger.info(f"✅ Connected to ChromaDB at {CHROMA_HOST}:{CHROMA_PORT}")
        logger.info(f"📊 Collection '{self.collection.name}' has {self.collection.count()} documents")
    
    def add_article(
        self,
        article_id: str,
        title: str,
        summary: str,
        content: str,
        metadata: Dict
    ) -> bool:
        """Add article embedding to ChromaDB"""
        try:
            # Combine title, summary, and content for richer embeddings
            text = f"{title}\n\n{summary}"
            if content and content != summary:
                text += f"\n\n{content[:500]}"  # Limit content length
            
            # Generate embedding
            embedding = self.embedding_model.encode(text).tolist()
            
            # Store in ChromaDB with metadata
            self.collection.add(
                ids=[article_id],
                embeddings=[embedding],
                documents=[text],
                metadatas=[{
                    **metadata,
                    'title': title,
                    'summary': summary[:200]  # Truncate for metadata
                }]
            )
            
            logger.debug(f"Added article {article_id} to vector store")
            return True
            
        except Exception as e:
            logger.error(f"Failed to add article to vector store: {e}")
            return False
    
    def search_similar(
        self,
        query: str,
        limit: int = 10,
        filter_metadata: Optional[Dict] = None
    ) -> List[Dict]:
        """Semantic search for similar articles"""
        try:
            # Generate query embedding
            query_embedding = self.embedding_model.encode(query).tolist()
            
            # Build where clause for filtering
            where_clause = filter_metadata if filter_metadata else None
            
            # Search ChromaDB
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=limit,
                where=where_clause,
                include=["metadatas", "documents", "distances"]
            )
            
            # Format results
            articles = []
            if results['ids'] and len(results['ids'][0]) > 0:
                for i in range(len(results['ids'][0])):
                    articles.append({
                        'chroma_id': results['ids'][0][i],
                        'article_id': int(results['ids'][0][i].replace('article_', '')),
                        'distance': results['distances'][0][i],
                        'similarity_score': 1 - results['distances'][0][i],  # Convert to similarity
                        'metadata': results['metadatas'][0][i],
                        'preview': results['documents'][0][i][:200]
                    })
            
            logger.info(f"Found {len(articles)} similar articles for query: '{query[:50]}...'")
            return articles
            
        except Exception as e:
            logger.error(f"Vector search failed: {e}")
            return []
    
    def batch_add_articles(self, articles: List[Dict]) -> int:
        """Batch insert articles for better performance"""
        try:
            ids = []
            embeddings = []
            documents = []
            metadatas = []
            
            for article in articles:
                text = f"{article['title']}\n\n{article['summary']}"
                embedding = self.embedding_model.encode(text).tolist()
                
                ids.append(article['chroma_id'])
                embeddings.append(embedding)
                documents.append(text)
                metadatas.append(article['metadata'])
            
            self.collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas
            )
            
            logger.info(f"Batch added {len(articles)} articles to vector store")
            return len(articles)
            
        except Exception as e:
            logger.error(f"Batch add failed: {e}")
            return 0
    
    def delete_article(self, article_id: str) -> bool:
        """Remove article from vector store"""
        try:
            self.collection.delete(ids=[article_id])
            return True
        except Exception as e:
            logger.error(f"Failed to delete article: {e}")
            return False
    
    def get_collection_stats(self) -> Dict:
        """Get vector store statistics"""
        try:
            count = self.collection.count()
            return {
                "total_articles": count,
                "collection_name": self.collection.name,
                "embedding_dimension": 384,  # For all-MiniLM-L6-v2
                "similarity_metric": "cosine"
            }
        except Exception as e:
            logger.error(f"Failed to get stats: {e}")
            return {"total_articles": 0, "error": str(e)}

# Global instance
vector_store = VectorStore()
```

## Integration Pattern

### Dual-Write Strategy (backend/app/main.py)

```python
from app.database import Article, get_db
from app.vector_store import vector_store
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime

async def store_article(article_data: Dict[str, Any], db: Session) -> bool:
    """Store article in both PostgreSQL and ChromaDB"""
    try:
        # 1. Store in PostgreSQL
        existing = db.query(Article).filter(Article.url == article_data['link']).first()
        
        if existing:
            # Update existing article
            existing.title = article_data['title']
            existing.summary = article_data['description']
            existing.updated_at = datetime.utcnow()
            db.commit()
            article_id = existing.id
        else:
            # Insert new article
            article = Article(
                title=article_data['title'],
                source=article_data['source'],
                summary=article_data['description'],
                content=article_data['description'],
                image_url=article_data.get('image'),
                published_at=datetime.fromisoformat(article_data['published'].replace('Z', '+00:00')),
                category=article_data.get('category', 'general'),
                url=article_data['link'],
                tags=[article_data.get('category'), article_data['source']],
            )
            db.add(article)
            db.commit()
            db.refresh(article)
            article_id = article.id
        
        # 2. Store in ChromaDB
        chroma_id = f"article_{article_id}"
        success = vector_store.add_article(
            article_id=chroma_id,
            title=article_data['title'],
            summary=article_data['description'],
            content=article_data['description'],
            metadata={
                'source': article_data['source'],
                'category': article_data.get('category', 'general'),
                'published': article_data['published'],
                'country': article_data.get('country', 'US')
            }
        )
        
        # 3. Update PostgreSQL with ChromaDB reference
        if success:
            article = db.query(Article).filter(Article.id == article_id).first()
            article.chroma_id = chroma_id
            article.embedding_generated = True
            db.commit()
        
        return True
        
    except Exception as e:
        logger.error(f"Failed to store article: {e}")
        db.rollback()
        return False
```

## API Endpoints

### Semantic Search

```python
@app.get("/api/search/semantic")
async def semantic_search(
    query: str = Query(..., min_length=3),
    limit: int = Query(10, le=50),
    category: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Semantic search using ChromaDB + PostgreSQL enrichment"""
    try:
        # 1. Search ChromaDB for similar embeddings
        filter_metadata = {}
        if category and category.lower() != 'all':
            filter_metadata['category'] = category.lower()
        
        chroma_results = vector_store.search_similar(
            query=query,
            limit=limit,
            filter_metadata=filter_metadata if filter_metadata else None
        )
        
        if not chroma_results:
            return {"query": query, "results": [], "total": 0}
        
        # 2. Fetch full article details from PostgreSQL
        article_ids = [r['article_id'] for r in chroma_results]
        articles = db.query(Article).filter(Article.id.in_(article_ids)).all()
        
        # 3. Map articles with similarity scores
        articles_dict = {a.id: a for a in articles}
        results = []
        
        for chroma_result in chroma_results:
            article_id = chroma_result['article_id']
            if article_id in articles_dict:
                article = articles_dict[article_id]
                results.append({
                    "id": article.id,
                    "title": article.title,
                    "source": article.source,
                    "summary": article.summary,
                    "image": article.image_url,
                    "published": article.published_at.isoformat(),
                    "category": article.category,
                    "url": article.url,
                    "similarity_score": chroma_result['similarity_score'],
                    "distance": chroma_result['distance']
                })
        
        # Track search for analytics
        search_record = SearchHistory(
            query=query,
            search_type='semantic',
            results_count=len(results)
        )
        db.add(search_record)
        db.commit()
        
        return {
            "query": query,
            "results": results,
            "total": len(results)
        }
        
    except Exception as e:
        logger.error(f"Semantic search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

## Migration Strategy

### Phase 1: Setup (Week 1)
1. Add PostgreSQL and ChromaDB to docker-compose.yml
2. Create database schema (init.sql)
3. Install dependencies: `asyncpg`, `chromadb`, `sentence-transformers`
4. Test database connections

### Phase 2: Dual-Write (Week 1-2)
1. Implement database.py and vector_store.py
2. Update article storage to write to both databases
3. Keep in-memory cache as fallback during transition
4. Test with small batch of articles

### Phase 3: Migration (Week 2)
1. Script to migrate existing cached articles to databases
2. Verify data integrity
3. Update all read operations to use PostgreSQL
4. Remove in-memory cache dependency

### Phase 4: Features (Week 3+)
1. Implement semantic search endpoint
2. Add bookmark management
3. Build "similar articles" feature
4. Add analytics dashboard

## Performance Considerations

- **Embedding Generation**: ~50ms per article with all-MiniLM-L6-v2
- **Batch Processing**: Use `batch_add_articles()` for initial ingestion
- **Connection Pooling**: Configure pool_size based on concurrent users (20-50 typical)
- **Indexes**: PostgreSQL indexes critical for fast queries
- **ChromaDB**: HNSW index automatically optimized for cosine similarity

## Backup & Recovery

```bash
# Backup PostgreSQL
docker exec -t thesis-postgres-1 pg_dump -U newsuser newsdb > backup.sql

# Restore PostgreSQL
docker exec -i thesis-postgres-1 psql -U newsuser newsdb < backup.sql

# Backup ChromaDB (volume backup)
docker run --rm -v thesis_chromadb_data:/data -v $(pwd):/backup alpine tar czf /backup/chroma-backup.tar.gz /data

# Restore ChromaDB
docker run --rm -v thesis_chromadb_data:/data -v $(pwd):/backup alpine tar xzf /backup/chroma-backup.tar.gz -C /
```

## Resources

- PostgreSQL Docker Hub: https://hub.docker.com/_/postgres
- ChromaDB Documentation: https://docs.trychroma.com/
- SQLAlchemy Async: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- Sentence Transformers: https://www.sbert.net/

---

# Database Setup Quick Start

## Implementation Status ✅

All database integration files have been created:
- ✅ `docker-compose.yml` - Added PostgreSQL and ChromaDB services
- ✅ `backend/init.sql` - Database schema with indexes and triggers
- ✅ `backend/requirements.txt` - Added asyncpg, chromadb, sentence-transformers
- ✅ `backend/app/database.py` - SQLAlchemy async models and session management
- ✅ `backend/app/vector_store.py` - ChromaDB client with embedding generation
- ✅ `backend/test_connections.py` - Automated connection testing script

## Next Steps

### 1. Start Database Services

```bash
# Start only databases first to verify setup
docker compose up -d postgres chromadb

# Watch logs for startup (wait ~10-15 seconds)
docker compose logs -f postgres chromadb

# Expected output:
# postgres: "database system is ready to accept connections"
# chromadb: "Application startup complete"
```

### 2. Verify Database Connectivity

```bash
# Test PostgreSQL
docker exec -it thesis-postgres-1 psql -U newsuser -d newsdb -c "\dt"
# Should show: articles, bookmarks, preferences, search_history

# Test ChromaDB
curl http://localhost:8001/api/v1/heartbeat
# Should return: {"nanosecond heartbeat": ...}
```

### 3. Install Python Dependencies

```bash
cd backend

# Install new database dependencies
pip install asyncpg sqlalchemy psycopg2-binary chromadb sentence-transformers

# Or reinstall all
pip install -r requirements.txt
```

### 4. Run Connection Tests

```bash
# From project root
python backend/test_connections.py

# This will test:
# ✅ PostgreSQL connection
# ✅ ChromaDB connection
# ✅ Embedding generation
# ✅ Dual-write pattern (writes test article to both DBs)
```

### 5. Start Full Stack

```bash
# Stop database-only containers
docker compose down

# Rebuild with new dependencies
docker compose up --build

# Access points:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:8000/docs
# - PostgreSQL: localhost:6543
# - ChromaDB: http://localhost:8001
```

## Troubleshooting

### "Cannot connect to PostgreSQL"
```bash
# Check if container is healthy
docker compose ps

# View detailed logs
docker compose logs postgres

# Verify health check
docker compose exec backend ping postgres
```

### "ChromaDB not available"
```bash
# Check ChromaDB status
curl -v http://localhost:8001/api/v1/heartbeat

# View logs
docker compose logs chromadb

# Restart if needed
docker compose restart chromadb
```

### "Import errors in Python"
```bash
# Ensure you're in the backend directory
cd backend

# Verify installation
pip list | grep -E "asyncpg|chromadb|sentence"

# Reinstall if missing
pip install asyncpg chromadb sentence-transformers
```

## What's Next After Setup

Once databases are running successfully:

1. **Update main.py** to import database and vector_store
2. **Modify RSS ingestion** to write to databases (dual-write)
3. **Add semantic search endpoint** (already coded in this guide)
4. **Implement bookmark endpoints** (create/read/delete)
5. **Migrate existing cache** to databases
6. **Remove in-memory cache** dependency

See sections above for complete code examples of each integration pattern.

## Database Management Commands

```bash
# View PostgreSQL data
docker exec -it thesis-postgres-1 psql -U newsuser -d newsdb
# Then: SELECT COUNT(*) FROM articles;

# Reset databases (⚠️ deletes all data)
docker compose down -v
docker compose up -d postgres chromadb

# Backup PostgreSQL
docker exec -t thesis-postgres-1 pg_dump -U newsuser newsdb > backup_$(date +%Y%m%d).sql

# Backup ChromaDB
docker run --rm -v thesis_chromadb_data:/data -v $(pwd):/backup alpine tar czf /backup/chroma_$(date +%Y%m%d).tar.gz /data
```

## 2025-10-13

### Refactor: Monolithic `main.py` to Modular Architecture

**Objective:** Decompose the monolithic `backend/app/main.py` into a clean, maintainable, and scalable structure following clean architecture principles.

**Changes:**

1.  **Architecture:**
    *   **`api/`**: Contains FastAPI routers for each domain.
        *   `routes/`: `general`, `news`, `cache`, `stream`, `debug`, `bookmarks`, `research`, `search`, `article_analysis`.
        *   `__init__.py`: Aggregates all routers into a single `APIRouter`.
    *   **`core/`**: Core application logic and configuration.
        *   `config.py`: Manages settings and initializes the Gemini client.
        *   `logging.py`: Configures application-wide logging.
    *   **`data/`**: Manages static data assets.
        *   `rss_sources.json`: Externalized RSS source definitions.
        *   `rss_sources.py`: Loader for the JSON configuration.
    *   **`models/`**: Pydantic models for data structures.
        *   `news.py`, `article_analysis.py`, `research.py`.
    *   **`services/`**: Encapsulates business logic.
        *   `cache.py`: In-memory `NewsCache`.
        *   `persistence.py`: Handles database writes with an async queue.
        *   `rss_ingestion.py`: Manages RSS fetching, parsing, and cache refresh scheduling.
        *   `stream_manager.py`: Tracks active SSE streams and handles throttling.
        *   `websocket_manager.py`: Manages WebSocket connections for real-time updates.
        *   `article_analysis.py`: Integrates with `newspaper4k` and Gemini for content analysis.
        *   `news_research.py`: Powers the news research agent.
    *   **`database.py`**: Defines SQLAlchemy models and async database session management.
    *   **`vector_store.py`**: Manages ChromaDB connection and vector search functionalities.

2.  **`main.py` Rewrite:**
    *   The original 8000+ line file was replaced with a ~150-line bootstrap file.
    *   **Responsibilities:**
        *   Initializes the FastAPI application.
        *   Configures CORS middleware.
        *   Includes the aggregated API router from `app.api.routes`.
        *   Manages application lifecycle events (`startup`, `shutdown`).
        *   Initializes background tasks for database persistence, cache loading, and schedulers.
        *   Provides the primary WebSocket endpoint.

3.  3.  **Key Improvements:**
    *   **Separation of Concerns:** Logic is now cleanly separated into distinct modules.
    *   **Maintainability:** Smaller, focused files are easier to understand and modify.
    *   **Scalability:** The modular router design allows for easy expansion.
    *   **Testability:** Services and components can be unit-tested in isolation.
    *   **Configuration Management:** Settings and secrets are centralized in `core/config.py`.

## 2025-10-15

### Feature: Instant Load with Background Cache Refresh

**Objective:** Provide users with instant content on app startup while keeping articles fresh in the background.

**Implementation:**

1.  **Backend Changes (`app/main.py`):**
    *   **Increased DB load limit:** Changed from 2,000 to 10,000 articles on startup for richer initial cache.
    *   **Non-blocking startup:** DB cache load runs on a daemon thread to not block API readiness.
    *   **Delayed RSS refresh:** Background RSS parser starts after 2-second delay, allowing DB load to complete first.
    *   **Timeline:**
        - T=0s: API starts
        - T=1s: DB query begins (loads 10k articles)
        - T=3-5s: Cache populated, API ready, user sees articles
        - T=5s+: RSS refresh begins silently in background
        - T=30s+: Cache updated with fresh data

2.  **Frontend Changes (`hooks/useNewsStream.ts`):**
    *   Updated initial status message: "Loading cached articles from database..." provides better UX clarity.
    *   Existing `cache_data` event from SSE endpoint already sends articles immediately to user.

3.  **Database Optimization:**
    *   `published_at` column is indexed for fast sorting in `fetch_all_articles()`.
    *   Query sorts by `published_at DESC` then `id DESC` for consistent ordering.

4.  **Architecture Flow:**
    ```
    User opens app
    ↓
    [Startup] API initializes DB connection
    ↓
    [Thread 1] Load 10k cached articles from DB (2-5 seconds)
    ↓
    [Main] Cache populated with articles
    ↓
    [Thread 2] Background RSS refresh starts (does not block)
    ↓
    User sees articles immediately while fresh data loads
    ```

5.  **Key Features:**
    *   Articles served from cache first (no loading delay).
    *   RSS refresh happens silently in background, updates cache without user interruption.
    *   If cache is fresh (<2 min old), stream returns cached data immediately.
    *   If cache is stale, stream fetches fresh RSS data while showing cached results.
    *   Fallback: If DB is empty, RSS refresh happens immediately.

6.  **Benefits:**
    *   **Instant UX:** Users see 10k articles immediately on load.
    *   **Fresh Data:** Background refresh ensures content is updated.
    *   **Non-blocking:** No startup delays for the API.
    *   **Graceful Degradation:** Works with or without database/RSS sources.

````
