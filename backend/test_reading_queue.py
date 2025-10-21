"""
Tests for reading queue service functionality.

Covers queue operations, digest generation, and metrics calculation.
"""

import pytest
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select

from app.database import Base, ReadingQueueItem
from app.models.reading_queue import (
    AddToQueueRequest,
    UpdateQueueItemRequest,
)
from app.services import reading_queue as queue_service
from app.services.article_extraction import (
    calculate_word_count,
    calculate_read_time_minutes,
)


# Test database setup
@pytest.fixture
async def test_db():
    """Create an in-memory SQLite database for testing."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        yield session

    await engine.dispose()


class TestArticleExtraction:
    """Tests for article extraction utilities."""

    def test_calculate_word_count(self):
        """Test word count calculation."""
        text = "This is a test article with some words."
        count = calculate_word_count(text)
        assert count == 8

    def test_calculate_word_count_empty(self):
        """Test word count with empty text."""
        assert calculate_word_count(None) is None
        assert calculate_word_count("") is None

    def test_calculate_read_time(self):
        """Test read time calculation."""
        # Create a text with approximately 230 words (1 minute read time)
        text = " ".join(["word"] * 230)
        read_time = calculate_read_time_minutes(text)
        assert read_time == 1

    def test_calculate_read_time_multiple_minutes(self):
        """Test read time calculation with multiple minutes."""
        # Create a text with approximately 700 words (3-4 minutes read time)
        text = " ".join(["word"] * 700)
        read_time = calculate_read_time_minutes(text)
        assert read_time >= 3

    def test_calculate_read_time_empty(self):
        """Test read time with empty text."""
        assert calculate_read_time_minutes(None) is None
        assert calculate_read_time_minutes("") is None


class TestReadingQueueService:
    """Tests for reading queue service operations."""

    @pytest.mark.asyncio
    async def test_add_to_queue(self, test_db):
        """Test adding an article to the queue."""
        request = AddToQueueRequest(
            article_id=1,
            article_title="Test Article",
            article_url="https://example.com/article1",
            article_source="Example News",
            article_image="https://example.com/image.jpg",
            queue_type="daily",
        )

        result = await queue_service.add_to_queue(test_db, request)
        assert result.article_title == "Test Article"
        assert result.article_url == "https://example.com/article1"
        assert result.queue_type == "daily"
        assert result.read_status == "unread"

    @pytest.mark.asyncio
    async def test_add_duplicate_to_queue(self, test_db):
        """Test that duplicate articles are not added."""
        request = AddToQueueRequest(
            article_id=1,
            article_title="Test Article",
            article_url="https://example.com/article1",
            article_source="Example News",
            queue_type="daily",
        )

        result1 = await queue_service.add_to_queue(test_db, request)
        result2 = await queue_service.add_to_queue(test_db, request)

        # Both should reference the same item
        assert result1.article_url == result2.article_url

    @pytest.mark.asyncio
    async def test_get_queue(self, test_db):
        """Test retrieving queue items."""
        # Add some items
        for i in range(3):
            request = AddToQueueRequest(
                article_id=i,
                article_title=f"Article {i}",
                article_url=f"https://example.com/article{i}",
                article_source="Example News",
                queue_type="daily",
            )
            await queue_service.add_to_queue(test_db, request)

        items, daily_count, permanent_count = await queue_service.get_queue(test_db)
        assert len(items) == 3
        assert daily_count == 3
        assert permanent_count == 0

    @pytest.mark.asyncio
    async def test_update_queue_item(self, test_db):
        """Test updating a queue item."""
        request = AddToQueueRequest(
            article_id=1,
            article_title="Test Article",
            article_url="https://example.com/article1",
            article_source="Example News",
            queue_type="daily",
        )

        item = await queue_service.add_to_queue(test_db, request)
        assert item.read_status == "unread"

        # Update status
        update_request = UpdateQueueItemRequest(read_status="reading")
        updated = await queue_service.update_queue_item(
            test_db, item.id, update_request
        )
        assert updated.read_status == "reading"

    @pytest.mark.asyncio
    async def test_remove_from_queue(self, test_db):
        """Test removing an item from the queue."""
        request = AddToQueueRequest(
            article_id=1,
            article_title="Test Article",
            article_url="https://example.com/article1",
            article_source="Example News",
            queue_type="daily",
        )

        item = await queue_service.add_to_queue(test_db, request)
        success = await queue_service.remove_from_queue(test_db, item.id)
        assert success

        # Verify it's removed
        items, _, _ = await queue_service.get_queue(test_db)
        assert len(items) == 0

    @pytest.mark.asyncio
    async def test_remove_by_url(self, test_db):
        """Test removing an item by URL."""
        request = AddToQueueRequest(
            article_id=1,
            article_title="Test Article",
            article_url="https://example.com/article1",
            article_source="Example News",
            queue_type="daily",
        )

        await queue_service.add_to_queue(test_db, request)
        success = await queue_service.remove_by_url(
            test_db, "https://example.com/article1"
        )
        assert success

        items, _, _ = await queue_service.get_queue(test_db)
        assert len(items) == 0

    @pytest.mark.asyncio
    async def test_get_queue_overview(self, test_db):
        """Test queue overview generation."""
        # Add items with different statuses
        for i in range(3):
            request = AddToQueueRequest(
                article_id=i,
                article_title=f"Article {i}",
                article_url=f"https://example.com/article{i}",
                article_source="Example News",
                queue_type="daily",
            )
            item = await queue_service.add_to_queue(test_db, request)

            if i == 0:
                # Mark first as reading
                update_req = UpdateQueueItemRequest(read_status="reading")
                await queue_service.update_queue_item(test_db, item.id, update_req)
            elif i == 1:
                # Mark second as completed
                update_req = UpdateQueueItemRequest(read_status="completed")
                await queue_service.update_queue_item(test_db, item.id, update_req)

        overview = await queue_service.get_queue_overview(test_db)
        assert overview.total_items == 3
        assert overview.daily_items == 3
        assert overview.unread_count == 1
        assert overview.reading_count == 1
        assert overview.completed_count == 1

    @pytest.mark.asyncio
    async def test_generate_daily_digest(self, test_db):
        """Test daily digest generation."""
        # Add items
        for i in range(5):
            request = AddToQueueRequest(
                article_id=i,
                article_title=f"Article {i}",
                article_url=f"https://example.com/article{i}",
                article_source="Example News",
                queue_type="daily",
            )
            await queue_service.add_to_queue(test_db, request)

        digest = await queue_service.generate_daily_digest(test_db)
        assert digest["total_items"] == 5
        # Should include top 5 items
        assert len(digest["digest_items"]) <= 5

    @pytest.mark.asyncio
    async def test_move_expired_to_permanent(self, test_db):
        """Test moving expired daily items to permanent queue."""
        # Add an old daily item
        old_date = datetime.utcnow() - timedelta(days=8)

        item = ReadingQueueItem(
            user_id=1,
            article_id=1,
            article_title="Old Article",
            article_url="https://example.com/old",
            article_source="Example News",
            queue_type="daily",
            position=0,
            read_status="unread",
            added_at=old_date,
        )

        test_db.add(item)
        await test_db.commit()

        # Move expired
        count = await queue_service.move_expired_to_permanent(test_db)
        assert count == 1

        # Verify it's now permanent
        updated = await test_db.execute(
            select(ReadingQueueItem).where(ReadingQueueItem.id == item.id)
        )
        updated_item = updated.scalar_one()
        assert updated_item.queue_type == "permanent"

    @pytest.mark.asyncio
    async def test_archive_completed_items(self, test_db):
        """Test archiving completed items older than 30 days."""
        # Add an old completed item
        old_date = datetime.utcnow() - timedelta(days=31)

        item = ReadingQueueItem(
            user_id=1,
            article_id=1,
            article_title="Old Article",
            article_url="https://example.com/old",
            article_source="Example News",
            queue_type="daily",
            position=0,
            read_status="completed",
            added_at=datetime.utcnow(),
            updated_at=old_date,
        )

        test_db.add(item)
        await test_db.commit()

        # Archive old items
        count = await queue_service.archive_completed_items(test_db)
        assert count == 1

        # Verify it's archived
        updated = await test_db.execute(
            select(ReadingQueueItem).where(ReadingQueueItem.id == item.id)
        )
        updated_item = updated.scalar_one()
        assert updated_item.archived_at is not None
