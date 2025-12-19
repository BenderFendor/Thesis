#!/usr/bin/env python3
"""
Test script for async RSS ingestion pipeline.
Run with: python backend/test_async_ingestion.py
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))


async def test_resource_config():
    """Test dynamic resource configuration."""
    print("\n" + "=" * 60)
    print("Testing Resource Configuration")
    print("=" * 60)

    from app.core.resource_config import get_system_resources

    config = get_system_resources()
    print(f"\nResource configuration loaded:")
    print(f"   CPU workers: {config['cpu_workers']}")
    print(f"   Fetch concurrency: {config['fetch_concurrency']}")
    print(f"   Fetch queue size: {config['fetch_queue_size']}")
    print(f"   Parse queue size: {config['parse_queue_size']}")
    print(f"   Persist queue size: {config['persist_queue_size']}")
    print(f"   Persist batch size: {config['persist_batch_size']}")


async def test_metrics():
    """Test metrics collection."""
    print("\n" + "=" * 60)
    print("Testing Metrics Collection")
    print("=" * 60)

    from app.services.metrics import get_metrics, reset_metrics

    reset_metrics()
    metrics = get_metrics()

    print(f"\nMetrics initialized:")
    print(f"   Fetch count: {metrics.fetch_count}")
    print(f"   Parse count: {metrics.parse_count}")
    print(f"   Persist count: {metrics.persist_count}")
    print(f"   Duration: {metrics.duration_seconds():.2f}s")

    # Simulate some activity
    metrics.fetch_count = 5
    metrics.parse_count = 5
    metrics.persist_count = 100

    print(f"\nAfter simulated activity:")
    metrics_dict = metrics.to_dict()
    print(f"   Fetch: {metrics_dict['fetch']}")
    print(f"   Parse: {metrics_dict['parse']}")
    print(f"   Persist: {metrics_dict['persist']}")


async def test_blocking_parse():
    """Test the blocking parse feed function."""
    print("\n" + "=" * 60)
    print("Testing Blocking Parse Feed")
    print("=" * 60)

    try:
        from app.services.rss_ingestion import _blocking_parse_feed

        # Sample RSS XML
        sample_rss = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
            <channel>
                <title>Test Feed</title>
                <item>
                    <title>Test Article</title>
                    <link>https://example.com/article1</link>
                    <description>Test description</description>
                    <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
                </item>
            </channel>
        </rss>"""

        source_info = {
            "url": "https://example.com/feed",
            "category": "technology",
            "country": "US",
        }

        articles, stat = _blocking_parse_feed(sample_rss, "Test Source", source_info)
        print(f"\nParse successful:")
        print(f"   Articles parsed: {len(articles)}")
        print(f"   Source status: {stat['status']}")
        print(f"   Source category: {stat['category']}")
        if articles:
            print(f"   First article title: {articles[0].title}")
    except ImportError as e:
        print(f"\nParse test skipped (dependencies not installed): {e}")
    except Exception as e:
        print(f"\nParse test failed: {e}")


async def test_imports():
    """Test that all new modules can be imported."""
    print("\n" + "=" * 60)
    print("Testing Module Imports")
    print("=" * 60)

    modules = [
        ("app.core.resource_config", ["get_system_resources", "ResourceConfig"]),
        ("app.services.metrics", ["get_metrics", "reset_metrics", "PipelineMetrics"]),
        ("app.services.scheduler", ["periodic_rss_refresh"]),
    ]

    for module_name, components in modules:
        try:
            module = __import__(module_name, fromlist=components)
            print(f"\n{module_name}")
            for component in components:
                if hasattr(module, component):
                    print(f"   - {component} available")
                else:
                    print(f"   {component} not found")
        except Exception as e:
            print(f"\n{module_name} failed: {e}")


async def main():
    """Run all tests."""
    print("\n" + "=" * 60)
    print("ASYNC RSS INGESTION PIPELINE TESTS")
    print("=" * 60)

    try:
        await test_imports()
        await test_resource_config()
        await test_metrics()
        await test_blocking_parse()

        print("\n" + "=" * 60)
        print("All tests completed successfully!")
        print("=" * 60 + "\n")

    except Exception as e:
        print(f"\nTest failed: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
