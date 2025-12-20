from sqlalchemy import (
    Column,
    Index,
    Integer,
    String,
    Text,
    DateTime,
    Boolean,
    JSON,
    select,
    or_,
    func,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.types import TypeDecorator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.exc import OperationalError
import asyncio
import time
from datetime import datetime, timezone
import os
import logging
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# Database URL from environment
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://newsuser:newspass@localhost:6543/newsdb"
)

# Async engine configuration
if settings.enable_database:
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,  # Set to True for SQL debugging
        future=True,
        pool_size=20,  # Adjust based on concurrent users
        max_overflow=0,
    )

    # Session factory
    AsyncSessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
else:
    engine = None
    AsyncSessionLocal = None
    logger.warning("Database disabled via ENABLE_DATABASE=0; skipping engine creation")


def get_utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


Base = declarative_base()


# Custom Types


class TagListType(TypeDecorator):
    """Stores tag arrays as native ARRAY on Postgres and JSON elsewhere."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):  # type: ignore[override]
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.ARRAY(String))
        return dialect.type_descriptor(JSON)

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return []
        if isinstance(value, list):
            return value
        return list(value)

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return value or []


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
    tags = Column(TagListType(), default=list)
    original_language = Column(String, default="en")
    translated = Column(Boolean, default=False)
    chroma_id = Column(String, unique=True)
    embedding_generated = Column(Boolean, default=False)
    created_at = Column(DateTime, default=get_utc_now)
    updated_at = Column(DateTime, default=get_utc_now, onupdate=get_utc_now)

    # Composite indexes for efficient cursor-based pagination
    __table_args__ = (
        # Primary pagination index: published_at DESC, id DESC
        Index("ix_articles_published_at_id_desc", published_at.desc(), id.desc()),
        # Category filtering with date ordering
        Index("ix_articles_category_published", category, published_at.desc()),
        # Source filtering with date ordering
        Index("ix_articles_source_published", source, published_at.desc()),
    )


class Bookmark(Base):
    __tablename__ = "bookmarks"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, nullable=False, unique=True)
    created_at = Column(DateTime, default=get_utc_now)


class Preference(Base):
    __tablename__ = "preferences"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False)
    value = Column(Text, nullable=False)  # Store as JSON string
    updated_at = Column(DateTime, default=get_utc_now, onupdate=get_utc_now)


class SearchHistory(Base):
    __tablename__ = "search_history"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(Text, nullable=False)
    search_type = Column(String)  # 'semantic', 'keyword', 'agentic'
    results_count = Column(Integer)
    created_at = Column(DateTime, default=get_utc_now)


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
    added_at = Column(DateTime, default=get_utc_now, index=True)
    archived_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=get_utc_now)
    updated_at = Column(DateTime, default=get_utc_now, onupdate=get_utc_now)
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
    created_at = Column(DateTime, default=get_utc_now)
    updated_at = Column(DateTime, default=get_utc_now, onupdate=get_utc_now)


# Phase 5B: Reporter and Organization Research Tables


class Reporter(Base):
    """Stores research data about journalists/reporters/authors."""
    __tablename__ = "reporters"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    normalized_name = Column(String, index=True)  # lowercase, stripped for matching
    
    # Profile data
    bio = Column(Text)  # Brief biography
    career_history = Column(JSON)  # List of past employers/positions
    topics = Column(TagListType(), default=list)  # Areas of expertise
    education = Column(JSON)  # Educational background
    
    # Bias/leaning indicators
    political_leaning = Column(String)  # left, center-left, center, center-right, right
    leaning_confidence = Column(String)  # high, medium, low
    leaning_sources = Column(JSON)  # Sources used to determine leaning
    
    # Social/external links
    twitter_handle = Column(String)
    linkedin_url = Column(String)
    wikipedia_url = Column(String)
    
    # Research metadata
    research_sources = Column(JSON)  # Which APIs/sources were consulted
    last_researched_at = Column(DateTime)
    research_confidence = Column(String)  # overall confidence in data quality
    
    created_at = Column(DateTime, default=get_utc_now)
    updated_at = Column(DateTime, default=get_utc_now, onupdate=get_utc_now)


class Organization(Base):
    """Stores research data about news organizations and their ownership."""
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    normalized_name = Column(String, index=True)  # lowercase for matching
    
    # Organization type
    org_type = Column(String)  # publisher, parent_company, owner, funder, advertiser
    
    # Ownership structure
    parent_org_id = Column(Integer, index=True)  # Self-referential for ownership chain
    ownership_percentage = Column(String)  # If known
    
    # Funding information
    funding_type = Column(String)  # public, commercial, non-profit, state-funded, independent
    funding_sources = Column(JSON)  # List of known funding sources
    major_advertisers = Column(JSON)  # Major advertising revenue sources
    
    # 990 / Financial data (for non-profits)
    ein = Column(String)  # Tax ID for 990 lookup
    annual_revenue = Column(String)
    top_donors = Column(JSON)  # From 990 filings
    
    # Bias indicators
    media_bias_rating = Column(String)  # From MBFC or similar
    factual_reporting = Column(String)  # From MBFC
    
    # External links
    website = Column(String)
    wikipedia_url = Column(String)
    littlesis_url = Column(String)
    opensecrets_url = Column(String)
    
    # Research metadata
    research_sources = Column(JSON)
    last_researched_at = Column(DateTime)
    research_confidence = Column(String)
    
    created_at = Column(DateTime, default=get_utc_now)
    updated_at = Column(DateTime, default=get_utc_now, onupdate=get_utc_now)


class ArticleAuthor(Base):
    """Junction table linking articles to their authors/reporters."""
    __tablename__ = "article_authors"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, nullable=False, index=True)
    reporter_id = Column(Integer, nullable=False, index=True)
    author_role = Column(String, default="author")  # author, contributor, editor
    
    created_at = Column(DateTime, default=get_utc_now)

    __table_args__ = (
        Index("ix_article_authors_article_reporter", "article_id", "reporter_id", unique=True),
    )



# Dependency for FastAPI
async def get_db():
    """Database session dependency for FastAPI endpoints"""
    if not settings.enable_database or AsyncSessionLocal is None:
        raise RuntimeError("Database access requested but ENABLE_DATABASE=0")

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
    if not settings.enable_database or engine is None:
        logger.info("Skipping database initialization; ENABLE_DATABASE=0")
        return

    def _iter_exception_chain(exc: BaseException):
        current: BaseException | None = exc
        seen: set[int] = set()
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            yield current
            current = current.__cause__ or current.__context__

    def _is_transient_startup_error(exc: BaseException) -> bool:
        for err in _iter_exception_chain(exc):
            # asyncpg can bubble up directly from SQLAlchemy.
            if err.__class__.__module__.startswith("asyncpg"):
                if err.__class__.__name__ in {
                    "CannotConnectNowError",
                    "ConnectionDoesNotExistError",
                    "TooManyConnectionsError",
                }:
                    return True

            if isinstance(err, OperationalError):
                return True

            message = str(err).lower()
            if "the database system is starting up" in message:
                return True
            if "connection refused" in message or "could not connect" in message:
                return True
            if "timeout" in message and "connect" in message:
                return True
        return False

    timeout_seconds = float(os.getenv("DB_STARTUP_TIMEOUT_SECONDS", "60"))
    deadline = time.monotonic() + timeout_seconds
    delay_seconds = 0.25
    attempt = 0

    while True:
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("Database tables initialized successfully")
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if not _is_transient_startup_error(exc) or time.monotonic() >= deadline:
                logger.error("Failed to initialize database: %s", exc, exc_info=True)
                raise

            attempt += 1
            remaining = max(0.0, deadline - time.monotonic())
            logger.warning(
                "Database not ready yet (attempt %d). Retrying in %.2fs (%.1fs left): %s",
                attempt,
                delay_seconds,
                remaining,
                exc,
            )
            await asyncio.sleep(delay_seconds)
            delay_seconds = min(delay_seconds * 1.5, 5.0)


def article_record_to_dict(record: Article) -> Dict[str, Any]:
    """Convert an Article ORM instance to a serializable dictionary."""
    if record is None:
        return {}

    published = record.published_at.isoformat() if record.published_at else None
    missing_fields = []
    if not hasattr(record, "source_country"):
        missing_fields.append("source_country")
    if not hasattr(record, "mentioned_countries"):
        missing_fields.append("mentioned_countries")
    if missing_fields:
        logger.debug(
            "Article missing fields %s; defaulting to None/empty. id=%s",
            ",".join(missing_fields),
            record.id,
        )

    source_country = getattr(record, "source_country", None)
    mentioned_countries = getattr(record, "mentioned_countries", None)

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
        # Phase 5 Fields
        "source_country": source_country,
        "mentioned_countries": mentioned_countries or [],
        # "author": record.authors[0].name if record.authors else None, # Future: support multiple authors
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


async def fetch_articles_page(
    session: AsyncSession,
    limit: int = 50,
    offset: int = 0,
    source: Optional[str] = None,
    missing_embeddings_only: bool = False,
    sort_direction: str = "desc",
    published_before: Optional[datetime] = None,
    published_after: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Paginate through article rows for debugging and inspection."""

    sort_column = Article.published_at
    order_clause = (
        sort_column.asc() if sort_direction.lower() == "asc" else sort_column.desc()
    )

    filters = []
    if source:
        filters.append(Article.source == source)
    if missing_embeddings_only:
        filters.append(
            or_(
                Article.embedding_generated.is_(False),
                Article.embedding_generated.is_(None),
            )
        )
    if published_before:
        filters.append(Article.published_at <= published_before)
    if published_after:
        filters.append(Article.published_at >= published_after)

    stmt = (
        select(Article)
        .order_by(order_clause, Article.id.desc())
        .limit(limit)
        .offset(offset)
    )
    if filters:
        stmt = stmt.where(*filters)

    count_stmt = select(func.count()).select_from(Article)
    if filters:
        count_stmt = count_stmt.where(*filters)

    result = await session.execute(stmt)
    rows = [article_record_to_dict(record) for record in result.scalars().all()]

    total = (await session.execute(count_stmt)).scalar_one()

    range_stmt = select(func.min(Article.published_at), func.max(Article.published_at))
    if filters:
        range_stmt = range_stmt.where(*filters)
    oldest, newest = (await session.execute(range_stmt)).one()

    return {
        "total": total,
        "returned": len(rows),
        "articles": rows,
        "oldest_published": oldest.isoformat() if oldest else None,
        "newest_published": newest.isoformat() if newest else None,
    }


async def fetch_article_chroma_mappings(session: AsyncSession) -> List[Dict[str, Any]]:
    """Return article→chroma mappings for drift analysis."""

    stmt = select(Article.id, Article.chroma_id, Article.embedding_generated)
    result = await session.execute(stmt)

    mappings = []
    for row in result.all():
        article_id, chroma_id, embedding_generated = row
        mappings.append(
            {
                "id": article_id,
                "chroma_id": chroma_id,
                "embedding_generated": embedding_generated,
            }
        )

    return mappings
