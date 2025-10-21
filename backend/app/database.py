from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Boolean,
    ARRAY,
    select,
    or_,
)
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from datetime import datetime
import os
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Database URL from environment
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://newsuser:newspass@localhost:6543/newsdb"
)

# Async engine configuration
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # Set to True for SQL debugging
    pool_size=20,  # Adjust based on concurrent users
    max_overflow=0,
)

# Session factory
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()


# Database Models
class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(Text, nullable=False)
    source = Column(String, nullable=False, index=True)
    source_id = Column(String)
    country = Column(String)
    credibility = Column(String)
    bias = Column(String)
    summary = Column(Text)
    content = Column(Text)
    image_url = Column(String)
    published_at = Column(DateTime, nullable=False, index=True)
    category = Column(String, index=True)
    url = Column(String, unique=True, nullable=False, index=True)
    tags = Column(ARRAY(String))
    original_language = Column(String, default="en")
    translated = Column(Boolean, default=False)
    chroma_id = Column(String, unique=True)
    embedding_generated = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Bookmark(Base):
    __tablename__ = "bookmarks"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Preference(Base):
    __tablename__ = "preferences"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False)
    value = Column(Text, nullable=False)  # Store as JSON string
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SearchHistory(Base):
    __tablename__ = "search_history"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(Text, nullable=False)
    search_type = Column(String)  # 'semantic', 'keyword', 'agentic'
    results_count = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)


class ReadingQueueItem(Base):
    __tablename__ = "reading_queue"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)  # For future multi-user support
    article_id = Column(Integer, nullable=False, index=True)
    article_title = Column(Text, nullable=False)
    article_url = Column(String, nullable=False, unique=True)
    article_source = Column(String, nullable=False)
    article_image = Column(String)
    queue_type = Column(String, default="daily", index=True)  # 'daily' or 'permanent'
    position = Column(Integer, default=0, index=True)  # Sort order, lower = top
    read_status = Column(
        String, default="unread", index=True
    )  # 'unread', 'reading', 'completed'
    added_at = Column(DateTime, default=datetime.utcnow, index=True)
    archived_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    word_count = Column(Integer, nullable=True)
    estimated_read_time_minutes = Column(Integer, nullable=True)
    full_text = Column(Text, nullable=True)


class Highlight(Base):
    __tablename__ = "highlights"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)  # For future multi-user support
    article_url = Column(String, nullable=False, index=True)
    highlighted_text = Column(Text, nullable=False)
    color = Column(String, default="yellow")  # 'yellow', 'blue', 'red'
    note = Column(Text, nullable=True)
    character_start = Column(Integer, nullable=False)
    character_end = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# Dependency for FastAPI
async def get_db():
    """Database session dependency for FastAPI endpoints"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# Initialize database tables
async def init_db():
    """Create all tables if they don't exist"""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("✅ Database tables initialized successfully")
    except Exception as e:
        logger.error(f"❌ Failed to initialize database: {e}")
        raise


def article_record_to_dict(record: Article) -> Dict[str, Any]:
    """Convert an Article ORM instance to a serializable dictionary."""
    if record is None:
        return {}

    published = record.published_at.isoformat() if record.published_at else None

    return {
        "id": record.id,
        "title": record.title or "Untitled article",
        "source": record.source or "Unknown",
        "source_id": record.source_id,
        "country": record.country,
        "credibility": record.credibility,
        "bias": record.bias,
        "summary": record.summary,
        "content": record.content,
        "description": record.summary or record.content,
        "image": record.image_url,
        "image_url": record.image_url,
        "published": published,
        "published_at": published,
        "category": record.category or "general",
        "url": record.url,
        "link": record.url,
        "tags": record.tags or [],
        "original_language": record.original_language,
        "translated": record.translated,
        "chroma_id": record.chroma_id,
        "embedding_generated": record.embedding_generated,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


async def fetch_all_articles(
    session: AsyncSession,
    limit: int = 2000,
) -> List[Dict[str, Any]]:
    """Fetch all articles from database (used for cache initialization on startup)."""
    stmt = (
        select(Article)
        .order_by(Article.published_at.desc(), Article.id.desc())
        .limit(limit)
    )

    result = await session.execute(stmt)
    return [article_record_to_dict(record) for record in result.scalars().all()]


async def fetch_recent_articles(
    session: AsyncSession,
    limit: int = 50,
    min_published: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Fetch the most recent articles, optionally after a minimum published timestamp."""
    stmt = (
        select(Article)
        .order_by(Article.published_at.desc(), Article.id.desc())
        .limit(limit)
    )

    if min_published:
        stmt = stmt.where(Article.published_at >= min_published)

    result = await session.execute(stmt)
    return [article_record_to_dict(record) for record in result.scalars().all()]


async def search_articles_by_keyword(
    session: AsyncSession,
    query: str,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Perform a simple keyword search against article title, summary, and content."""
    if not query:
        return []

    pattern = f"%{query}%"
    stmt = (
        select(Article)
        .where(
            or_(
                Article.title.ilike(pattern),
                Article.summary.ilike(pattern),
                Article.content.ilike(pattern),
                Article.source.ilike(pattern),
                Article.category.ilike(pattern),
            )
        )
        .order_by(Article.published_at.desc(), Article.id.desc())
        .limit(limit)
    )

    result = await session.execute(stmt)
    return [article_record_to_dict(record) for record in result.scalars().all()]


async def fetch_articles_by_ids(
    session: AsyncSession,
    article_ids: List[int],
) -> List[Dict[str, Any]]:
    """Fetch specific articles by their integer IDs, preserving the order provided."""
    if not article_ids:
        return []

    stmt = select(Article).where(Article.id.in_(article_ids))
    result = await session.execute(stmt)
    articles = {
        record.id: article_record_to_dict(record) for record in result.scalars().all()
    }

    ordered: List[Dict[str, Any]] = []
    for article_id in article_ids:
        article = articles.get(article_id)
        if article:
            ordered.append(article)

    return ordered
