#!/usr/bin/env python3
"""
Test database connections before full integration
Run with: python backend/test_connections.py
"""

import asyncio
import os
import sys

from app.core.config import settings

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


async def test_postgresql():
    """Test PostgreSQL connection"""
    if not settings.enable_database:
        print("INFO: PostgreSQL test skipped (ENABLE_DATABASE=0)\n")
        return True
    try:
        from app.database import engine, AsyncSessionLocal
        from sqlalchemy import text

        print("Testing PostgreSQL connection...")

        # Test basic connection
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT version();"))
            version = result.fetchone()
            print(f"PostgreSQL connected: {version[0][:50]}...")

        # Test session
        async with AsyncSessionLocal() as session:
            result = await session.execute(text("SELECT COUNT(*) FROM articles;"))
            count = result.scalar()
            print(f"Articles table accessible: {count} articles found")

        print("PostgreSQL test passed!\n")
        return True

    except Exception as e:
        print(f"PostgreSQL test failed: {e}\n")
        return False


def test_chromadb():
    """Test ChromaDB connection"""
    from app.vector_store import get_vector_store

    if not settings.enable_vector_store:
        print("INFO: ChromaDB test skipped (ENABLE_VECTOR_STORE=0)\n")
        return True

    try:
        vector_store = get_vector_store()
        print("Testing ChromaDB connection...")

        if vector_store is None:
            print("ChromaDB not initialized")
            return False

        # Test connection
        stats = vector_store.get_collection_stats()
        print(
            f"ChromaDB connected: {stats['total_articles']} documents in '{stats['collection_name']}'"
        )

        # Test embedding generation
        print("Testing embedding generation...")
        test_text = "This is a test article about technology and AI."
        embedding = vector_store.embedding_model.encode(test_text).tolist()
        print(f"Generated embedding: {len(embedding)} dimensions")

        print("ChromaDB test passed!\n")
        return True

    except Exception as e:
        print(f"ChromaDB test failed: {e}\n")
        return False


async def test_dual_write():
    """Test writing to both databases"""
    if not settings.enable_database:
        print("INFO: Dual-write test skipped (ENABLE_DATABASE=0)\n")
        return True
    try:
        from app.database import AsyncSessionLocal, Article
        from app.vector_store import get_vector_store
        from datetime import datetime, timezone

        vector_store = get_vector_store()
        if vector_store is None:
            print("INFO: Dual-write test skipped (vector store unavailable)\n")
            return True

        print("Testing dual-write pattern...")

        test_article_data = {
            "title": "Test Article for Database Integration",
            "source": "Test Source",
            "summary": "This is a test article to verify dual-write functionality between PostgreSQL and ChromaDB.",
            "url": f"https://test.example.com/article-{datetime.now(timezone.utc).timestamp()}",
            "published_at": datetime.now(timezone.utc).replace(tzinfo=None),
            "category": "test",
            "tags": ["test", "integration"],
        }

        # 1. Write to PostgreSQL
        async with AsyncSessionLocal() as session:
            article = Article(**test_article_data)
            session.add(article)
            await session.commit()
            await session.refresh(article)
            article_id = article.id
            print(f"Article saved to PostgreSQL: ID {article_id}")

        # 2. Write to ChromaDB
        chroma_id = f"article_{article_id}"
        success = vector_store.add_article(
            article_id=chroma_id,
            title=test_article_data["title"],
            summary=test_article_data["summary"],
            content=test_article_data["summary"],
            metadata={
                "source": test_article_data["source"],
                "category": test_article_data["category"],
                "published": test_article_data["published_at"].isoformat(),
            },
        )

        if success:
            print(f"Article saved to ChromaDB: {chroma_id}")
        else:
            print("Failed to save to ChromaDB")
            return False

        # 3. Update PostgreSQL with ChromaDB reference
        async with AsyncSessionLocal() as session:
            article = await session.get(Article, article_id)
            article.chroma_id = chroma_id
            article.embedding_generated = True
            await session.commit()
            print("Article updated with chroma_id reference")

        # 4. Test semantic search
        results = vector_store.search_similar(
            query="test article database integration", limit=5
        )

        found = any(r["chroma_id"] == chroma_id for r in results)
        if found:
            print("Test article found in semantic search")
        else:
            print("Test article not found in search (may need more data)")

        print("Dual-write test passed!\n")
        return True

    except Exception as e:
        print(f"Dual-write test failed: {e}\n")
        import traceback

        traceback.print_exc()
        return False


async def main():
    """Run all tests"""
    print("=" * 60)
    print("DATABASE CONNECTION TESTS")
    print("=" * 60)
    print()

    # Load environment variables
    from dotenv import load_dotenv

    load_dotenv()

    results = {
        "postgresql": await test_postgresql(),
        "chromadb": test_chromadb(),
        "dual_write": await test_dual_write(),
    }

    print("=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    for test_name, passed in results.items():
        status = "PASSED" if passed else "FAILED"
        print(f"{test_name.upper()}: {status}")

    all_passed = all(results.values())
    print()
    if all_passed:
        print("All tests passed! Database integration is ready.")
        return 0
    else:
        print("Some tests failed. Check the errors above.")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
