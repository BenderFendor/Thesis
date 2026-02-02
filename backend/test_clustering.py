#!/usr/bin/env python3
"""
Fast clustering test suite for test-driven development.

Run this to test clustering immediately instead of waiting 30 minutes:
- python backend/test_clustering.py

This creates test articles with embeddings and runs clustering to verify
the entire pipeline works end-to-end within seconds.
"""

import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import List, Dict, Any, Tuple

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Set required environment variables before importing config
os.environ.setdefault("ENABLE_DATABASE", "1")
os.environ.setdefault("ENABLE_VECTOR_STORE", "1")  # Enable for testing

# Setup basic logging first
import logging

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("clustering_test")

# Try to import settings, fallback to manual config
try:
    from app.core.config import settings
except ImportError as e:
    logger.warning(f"Could not import settings: {e}")

    # Create minimal settings object
    class Settings:
        enable_database = os.getenv("ENABLE_DATABASE", "1") not in {
            "0",
            "false",
            "False",
        }
        enable_vector_store = os.getenv("ENABLE_VECTOR_STORE", "1") not in {
            "0",
            "false",
            "False",
        }

    settings = Settings()


def generate_test_embedding(text: str, dimension: int = 384):
    """Generate a deterministic test embedding based on text content."""
    import numpy as np

    np.random.seed(hash(text) % (2**32))
    embedding = np.random.randn(dimension).astype(np.float32)
    embedding = embedding / np.linalg.norm(embedding)
    return embedding.tolist()


async def create_test_articles_with_embeddings(count: int = 8) -> List[int]:
    """Create test articles with embeddings for immediate clustering testing."""
    if not settings.enable_database:
        logger.error("Database disabled - cannot create test articles")
        return []

    from app.database import AsyncSessionLocal, Article
    from app.vector_store import get_vector_store

    vector_store = get_vector_store()
    if vector_store is None:
        logger.error("Vector store unavailable - cannot create embeddings")
        return []

    # Test article templates grouped by expected cluster
    test_groups = [
        # AI/Tech cluster
        [
            {
                "title": "OpenAI Announces GPT-5 with Revolutionary Capabilities",
                "summary": "The new model demonstrates unprecedented reasoning abilities and could transform multiple industries including healthcare and education.",
                "source": "TechCrunch",
                "category": "technology",
            },
            {
                "title": "GPT-5 Launch Marks New Era in Artificial Intelligence",
                "summary": "Industry experts hail the latest OpenAI release as a major breakthrough for automation and decision-making.",
                "source": "The Verge",
                "category": "technology",
            },
            {
                "title": "How GPT-5 Changes the Landscape for AI Startups",
                "summary": "Venture capital firms reassess portfolios as OpenAI model creates opportunities for emerging AI companies.",
                "source": "Wired",
                "category": "technology",
            },
        ],
        # Climate cluster
        [
            {
                "title": "Global Temperature Records Broken Again This Summer",
                "summary": "Scientists confirm that 2024 is on track to be the hottest year with implications for extreme weather patterns.",
                "source": "BBC",
                "category": "science",
            },
            {
                "title": "New Study Links Rising Temperatures to Agricultural Crisis",
                "summary": "Researchers warn that crop yields could decline by 30 percent within decades if warming trends continue.",
                "source": "Reuters",
                "category": "science",
            },
        ],
        # Politics cluster
        [
            {
                "title": "Senate Passes New Infrastructure Bill with Bipartisan Support",
                "summary": "The landmark legislation allocates 1.2 trillion for roads, bridges, and broadband expansion over the next decade.",
                "source": "Politico",
                "category": "politics",
            },
            {
                "title": "House Expected to Vote on Infrastructure Package Next Week",
                "summary": "Speaker announces timeline for considering the Senate-passed bill with moderate Democrats pushing for quick action.",
                "source": "CNN",
                "category": "politics",
            },
        ],
        # Standalone article
        [
            {
                "title": "Local Zoo Welcomes Rare Baby Red Panda Cubs",
                "summary": "The triplets born last month are drawing visitors from across the region to the municipal wildlife center.",
                "source": "Local News",
                "category": "lifestyle",
            },
        ],
    ]

    created_ids = []

    async with AsyncSessionLocal() as session:
        for group_idx, group in enumerate(test_groups):
            for article_idx, article_data in enumerate(group):
                # Create unique URL
                timestamp = datetime.now(timezone.utc).timestamp()
                url = f"https://test.example.com/article-{group_idx}-{article_idx}-{timestamp}"

                article = Article(
                    title=article_data["title"],
                    source=article_data["source"],
                    summary=article_data["summary"],
                    url=url,
                    published_at=datetime.now(timezone.utc).replace(tzinfo=None),
                    category=article_data["category"],
                    embedding_generated=True,
                )
                session.add(article)
                await session.flush()

                article_id = article.id
                chroma_id = f"article_{article_id}"

                # Generate and store embedding
                text_for_embedding = (
                    f"{article_data['title']} {article_data['summary']}"
                )
                embedding = generate_test_embedding(text_for_embedding)

                # Store in ChromaDB
                vector_store.collection.add(
                    ids=[chroma_id],
                    embeddings=[embedding],
                    documents=[text_for_embedding],
                    metadatas=[
                        {
                            "source": article_data["source"],
                            "category": article_data["category"],
                            "published": article.published_at.isoformat(),
                        }
                    ],
                )

                created_ids.append(article_id)
                logger.info(
                    f"Created test article {article_id}: {article_data['title'][:50]}..."
                )

        await session.commit()

    logger.info(f"Created {len(created_ids)} test articles with embeddings")
    return created_ids


async def test_fast_clustering() -> Dict[str, Any]:
    """Test the fast clustering pipeline end-to-end."""
    logger.info("=" * 60)
    logger.info("FAST CLUSTERING TEST")
    logger.info("=" * 60)

    if not settings.enable_database:
        return {
            "error": "Database disabled",
            "success": False,
            "test_articles_created": 0,
            "articles_clustered": 0,
            "clusters_created": 0,
            "test_duration_seconds": 0,
            "errors": ["Database is disabled (ENABLE_DATABASE=0)"],
        }

    if not settings.enable_vector_store:
        return {
            "error": "Vector store disabled",
            "success": False,
            "test_articles_created": 0,
            "articles_clustered": 0,
            "clusters_created": 0,
            "test_duration_seconds": 0,
            "errors": ["Vector store is disabled (ENABLE_VECTOR_STORE=0)"],
        }

    from app.database import AsyncSessionLocal
    from app.services.fast_clustering import fast_process_unassigned_articles
    from sqlalchemy import select, func
    from app.database import TopicCluster, ArticleTopic

    results = {
        "test_articles_created": 0,
        "articles_clustered": 0,
        "clusters_created": 0,
        "test_duration_seconds": 0,
        "success": False,
        "errors": [],
    }

    start_time = datetime.now(timezone.utc)

    # Import asyncio timeout for connection handling
    try:
        from asyncio import timeout as async_timeout
    except ImportError:
        # Python < 3.11 compatibility
        import asyncio

        async_timeout = asyncio.wait_for

    try:
        # Step 1: Create test articles with embeddings
        logger.info("Step 1: Creating test articles with embeddings...")
        test_ids = await create_test_articles_with_embeddings()
        results["test_articles_created"] = len(test_ids)

        if not test_ids:
            results["errors"].append("Failed to create test articles")
            return results

        # Step 2: Run fast clustering with timeout
        logger.info("Step 2: Running fast clustering...")
        async with async_timeout(30):  # 30 second timeout for clustering
            async with AsyncSessionLocal() as session:
                assigned = await fast_process_unassigned_articles(session, limit=500)
            await session.commit()
            results["articles_clustered"] = assigned

            # Count clusters
            cluster_count = await session.execute(
                select(func.count(TopicCluster.id)).where(
                    TopicCluster.is_active == True
                )
            )
            results["clusters_created"] = cluster_count.scalar() or 0

            # Get detailed cluster info
            clusters = await session.execute(
                select(TopicCluster).where(TopicCluster.is_active == True)
            )
            cluster_details = []
            for cluster in clusters.scalars().all():
                article_count = await session.execute(
                    select(func.count(ArticleTopic.id)).where(
                        ArticleTopic.cluster_id == cluster.id
                    )
                )
                cluster_details.append(
                    {
                        "id": cluster.id,
                        "label": cluster.label,
                        "article_count": article_count.scalar() or 0,
                    }
                )
            results["cluster_details"] = cluster_details

        # Calculate duration
        end_time = datetime.now(timezone.utc)
        duration = (end_time - start_time).total_seconds()
        results["test_duration_seconds"] = round(duration, 2)

        # Validate results
        if results["articles_clustered"] >= 7:  # At least 7 of 8 should cluster
            results["success"] = True
            logger.info(
                f"SUCCESS: Clustered {results['articles_clustered']} articles in {duration:.2f}s"
            )
        else:
            results["errors"].append(
                f"Only {results['articles_clustered']} of {len(test_ids)} articles clustered"
            )
            logger.warning(
                f"PARTIAL: Only {results['articles_clustered']} articles clustered"
            )

    except Exception as e:
        results["errors"].append(str(e))
        logger.error(f"Test failed: {e}", exc_info=True)

    return results


async def diagnose_clustering_issues() -> Dict[str, Any]:
    """Diagnose why clustering might not be working."""
    logger.info("=" * 60)
    logger.info("CLUSTERING DIAGNOSTICS")
    logger.info("=" * 60)

    results = {
        "database_enabled": settings.enable_database,
        "vector_store_enabled": settings.enable_vector_store,
        "total_articles": 0,
        "articles_with_embeddings": 0,
        "articles_without_embeddings": 0,
        "unassigned_articles": 0,
        "total_clusters": 0,
        "active_clusters": 0,
        "vector_store_stats": {},
        "issues": [],
    }

    if not settings.enable_database:
        results["issues"].append("Database is disabled (ENABLE_DATABASE=0)")
        return results

    if not settings.enable_vector_store:
        results["issues"].append("Vector store is disabled (ENABLE_VECTOR_STORE=0)")
        return results

    # Check if we can import required modules
    try:
        from app.database import AsyncSessionLocal, Article, ArticleTopic, TopicCluster
        from app.vector_store import get_vector_store
        from sqlalchemy import select, func, and_
    except ImportError as e:
        results["issues"].append(f"Failed to import required modules: {e}")
        return results

    # Test database connection with timeout
    logger.info("Testing database connection...")
    try:
        import asyncio
        from asyncio import timeout as async_timeout

        # Try to connect with a timeout
        async with async_timeout(5):
            async with AsyncSessionLocal() as session:
                # Count total articles
                total = await session.execute(select(func.count(Article.id)))
                results["total_articles"] = total.scalar() or 0

                # Count articles with embeddings
                with_emb = await session.execute(
                    select(func.count(Article.id)).where(
                        Article.embedding_generated == True
                    )
                )
                results["articles_with_embeddings"] = with_emb.scalar() or 0
                results["articles_without_embeddings"] = (
                    results["total_articles"] - results["articles_with_embeddings"]
                )

                # Count unassigned articles
                unassigned = await session.execute(
                    select(func.count(Article.id))
                    .outerjoin(ArticleTopic, ArticleTopic.article_id == Article.id)
                    .where(
                        and_(
                            ArticleTopic.id == None,
                            Article.embedding_generated == True,
                        )
                    )
                )
                results["unassigned_articles"] = unassigned.scalar() or 0

                # Count clusters
                total_clusters = await session.execute(
                    select(func.count(TopicCluster.id))
                )
                results["total_clusters"] = total_clusters.scalar() or 0

                active = await session.execute(
                    select(func.count(TopicCluster.id)).where(
                        TopicCluster.is_active == True
                    )
                )
                results["active_clusters"] = active.scalar() or 0

                # Vector store stats inside the session block
                vector_store = get_vector_store()
                if vector_store:
                    try:
                        stats = vector_store.get_collection_stats()
                        results["vector_store_stats"] = stats
                    except Exception as e:
                        results["issues"].append(
                            f"Failed to get vector store stats: {e}"
                        )
                else:
                    results["issues"].append("Vector store is None")

                # Identify issues
                if results["articles_with_embeddings"] == 0:
                    results["issues"].append("No articles have embeddings generated")

                if (
                    results["unassigned_articles"] == 0
                    and results["articles_with_embeddings"] > 0
                ):
                    results["issues"].append(
                        "All embedded articles are already assigned to clusters"
                    )

                if results["vector_store_stats"].get("total_articles", 0) == 0:
                    results["issues"].append("Vector store collection is empty")

    except asyncio.TimeoutError:
        results["issues"].append(
            "Database connection timed out (PostgreSQL not running?)"
        )
    except Exception as e:
        results["issues"].append(f"Diagnostic query failed: {e}")

    return results


async def cleanup_test_articles() -> int:
    """Remove test articles created by this test suite."""
    if not settings.enable_database:
        return 0

    from app.database import AsyncSessionLocal, Article
    from app.vector_store import get_vector_store
    from sqlalchemy import select, delete

    vector_store = get_vector_store()
    deleted_count = 0

    async with AsyncSessionLocal() as session:
        # Find test articles by URL pattern
        result = await session.execute(
            select(Article).where(
                Article.url.like("https://test.example.com/article-%")
            )
        )
        test_articles = result.scalars().all()

        for article in test_articles:
            # Delete from ChromaDB
            if vector_store:
                try:
                    vector_store.collection.delete(ids=[f"article_{article.id}"])
                except Exception as e:
                    logger.warning(f"Failed to delete from ChromaDB: {e}")

            await session.delete(article)
            deleted_count += 1

        await session.commit()

    logger.info(f"Cleaned up {deleted_count} test articles")
    return deleted_count


async def check_services_available():
    """Quick check if required services are running."""
    import socket

    checks = {
        "postgresql": False,
        "chromadb": False,
    }

    # Check PostgreSQL (port 5432)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex(("localhost", 5432))
        sock.close()
        checks["postgresql"] = result == 0
    except Exception:
        pass

    # Check ChromaDB (port 8000)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex(("localhost", 8000))
        sock.close()
        checks["chromadb"] = result == 0
    except Exception:
        pass

    return checks


async def main():
    """Run all clustering tests."""
    print("=" * 60)
    print("CLUSTERING TEST SUITE")
    print("=" * 60)
    print()

    # Check if services are available
    print("Checking service availability...")
    services = await check_services_available()
    print(f"  PostgreSQL: {'Running' if services['postgresql'] else 'Not running'}")
    print(f"  ChromaDB: {'Running' if services['chromadb'] else 'Not running'}")
    print()

    if not services["postgresql"] or not services["chromadb"]:
        print("ERROR: Required services are not running!")
        print()
        print("To run this test, you need:")
        print("  1. PostgreSQL running on port 5432")
        print("  2. ChromaDB running on port 8000")
        print()
        print("If using Docker:")
        print("  docker compose up postgres chromadb -d")
        print()
        print("If running locally:")
        print("  # Start PostgreSQL")
        print("  sudo systemctl start postgresql")
        print("  # Start ChromaDB")
        print("  chroma run --path ./chroma_data")
        return 1

    # Run diagnostics first
    diag = await diagnose_clustering_issues()
    print("DIAGNOSTICS:")
    print(f"  Database enabled: {diag['database_enabled']}")
    print(f"  Vector store enabled: {diag['vector_store_enabled']}")
    print(f"  Total articles: {diag['total_articles']}")
    print(f"  Articles with embeddings: {diag['articles_with_embeddings']}")
    print(f"  Unassigned articles: {diag['unassigned_articles']}")
    print(f"  Active clusters: {diag['active_clusters']}")
    print(
        f"  Vector store documents: {diag['vector_store_stats'].get('total_articles', 0)}"
    )

    if diag["issues"]:
        print(f"\n  Issues found:")
        for issue in diag["issues"]:
            print(f"    - {issue}")
    print()

    # Run clustering test
    print("Running clustering test...")
    results = await test_fast_clustering()

    print("\nRESULTS:")
    print(f"  Test articles created: {results['test_articles_created']}")
    print(f"  Articles clustered: {results['articles_clustered']}")
    print(f"  Clusters created: {results['clusters_created']}")
    print(f"  Test duration: {results['test_duration_seconds']}s")

    if results.get("cluster_details"):
        print(f"\n  Cluster details:")
        for cluster in results["cluster_details"]:
            print(
                f"    - Cluster {cluster['id']}: {cluster['label']} ({cluster['article_count']} articles)"
            )

    if results["errors"]:
        print(f"\n  Errors:")
        for error in results["errors"]:
            print(f"    - {error}")

    # Cleanup
    print("\nCleaning up test articles...")
    cleaned = await cleanup_test_articles()
    print(f"  Deleted {cleaned} test articles")

    print("\n" + "=" * 60)
    if results["success"]:
        print("TEST PASSED")
        return 0
    else:
        print("TEST FAILED")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
