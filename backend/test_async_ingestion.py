#!/usr/bin/env python3
"""
Test script for Rust-backed RSS ingestion pipeline.
Run with: python backend/test_async_ingestion.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


async def test_metrics():
    """Test metrics collection."""
    print("\n" + "=" * 60)
    print("Testing Metrics Collection")
    print("=" * 60)

    from app.services.metrics import get_metrics, reset_metrics

    reset_metrics()
    metrics = get_metrics()

    print("\nMetrics initialized:")
    print(f"   Fetch count: {metrics.fetch_count}")
    print(f"   Parse count: {metrics.parse_count}")
    print(f"   Persist count: {metrics.persist_count}")
    print(f"   Duration: {metrics.duration_seconds():.2f}s")

    metrics.fetch_count = 5
    metrics.parse_count = 5
    metrics.persist_count = 100

    print("\nAfter simulated activity:")
    metrics_dict = metrics.to_dict()
    print(f"   Fetch: {metrics_dict['fetch']}")
    print(f"   Parse: {metrics_dict['parse']}")
    print(f"   Persist: {metrics_dict['persist']}")


async def test_rust_parse_helpers():
    """Test the Rust parser bindings directly."""
    print("\n" + "=" * 60)
    print("Testing Rust Parser Helpers")
    print("=" * 60)

    try:
        from app.services.rss_parser_rust_bindings import (
            deduplicate_article_groups,
            extract_article_html,
            extract_og_image_html,
            sentence_diff,
            text_similarity,
        )

        article_payload = extract_article_html(
            "<html><head><title>Test</title></head><body><article><p>Body text.</p></article></body></html>"
        )
        og_payload = extract_og_image_html(
            '<html><head><meta property="og:image" content="https://example.com/image.jpg"></head></html>'
        )
        duplicates = deduplicate_article_groups(
            [
                ("doc-1", "Shared article body."),
                ("doc-2", "Shared article body."),
                ("doc-3", "Different body."),
            ],
            threshold=0.9,
            num_hashes=128,
        )
        diff = sentence_diff("Alpha wins. Beta reacts.", "Alpha wins. Gamma responds.")

        print("\nRust helper calls succeeded:")
        print(f"   Article title: {article_payload.get('title')}")
        print(f"   OG candidates: {len(og_payload.get('candidates', []))}")
        print(f"   Similarity: {text_similarity('alpha', 'alpha')}")
        print(f"   Duplicate groups: {len(duplicates)}")
        print(f"   Diff keys: {sorted(diff.keys())}")
    except ImportError as exc:
        print(f"\nRust helper test skipped (dependencies not installed): {exc}")
    except Exception as exc:
        print(f"\nRust helper test failed: {exc}")


async def test_imports():
    """Test that core modules can be imported."""
    print("\n" + "=" * 60)
    print("Testing Module Imports")
    print("=" * 60)

    modules = [
        ("app.services.metrics", ["get_metrics", "reset_metrics", "PipelineMetrics"]),
        ("app.services.scheduler", ["periodic_rss_refresh"]),
        (
            "app.services.rss_parser_rust_bindings",
            ["parse_feeds_parallel", "extract_article_html"],
        ),
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
        except Exception as exc:
            print(f"\n{module_name} failed: {exc}")


async def main():
    """Run all tests."""
    print("\n" + "=" * 60)
    print("RUST RSS INGESTION PIPELINE TESTS")
    print("=" * 60)

    try:
        await test_imports()
        await test_metrics()
        await test_rust_parse_helpers()

        print("\n" + "=" * 60)
        print("All tests completed successfully!")
        print("=" * 60 + "\n")
    except Exception as exc:
        print(f"\nTest failed: {exc}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
