from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Article, ArticleEdge, Correction, SourceMetadata, StoryCluster
from app.services.source_ledger import build_source_ledger


@pytest.mark.asyncio
async def test_source_ledger_builds_observed_metrics(seeded_db: AsyncSession) -> None:
    source_meta = SourceMetadata(
        source_name="Ledger Daily",
        normalized_name="ledger daily",
        is_paywalled=True,
        research_sources={
            "policy_transparency": {
                "signals": [
                    {"id": "corrections", "status": "available"},
                    {"id": "ownership", "status": "available"},
                ]
            }
        },
    )
    seeded_db.add(source_meta)

    test_news_a = await seeded_db.get(Article, 1)
    test_news_b = await seeded_db.get(Article, 2)
    assert test_news_a is not None
    assert test_news_b is not None
    test_news_a.paywall_status = "metered"
    test_news_b.paywall_status = "free"

    seeded_db.add_all(
        [
            StoryCluster(
                external_cluster_id=9001,
                label="Ledger test story",
                earliest_article_id=1,
            ),
            ArticleEdge(
                story_cluster_id=1,
                from_article_id=3,
                to_article_id=1,
                relation="same_wire_story",
            ),
            ArticleEdge(
                story_cluster_id=1,
                from_article_id=4,
                to_article_id=2,
                relation="follow_up",
            ),
            Correction(
                source="Test News",
                article_id=1,
                correction_url="https://testnews.example.com/correction",
                correction_text="Corrected the figure.",
            ),
        ]
    )
    await seeded_db.commit()

    ledger = await build_source_ledger(
        seeded_db,
        source_name="Test News",
        matched_source_names=["Test News"],
        source_config={"url": "https://testnews.example.com/rss", "last_error": "timeout"},
        meta=source_meta,
    )

    assert ledger["article_count"] == 2
    assert ledger["paywall"]["paywalled_articles"] == 1
    assert ledger["paywall"]["free_articles"] == 1
    assert ledger["paywall"]["paywall_rate"] == 0.5
    assert ledger["original_reporting"]["earliest_story_count"] == 1
    assert ledger["wire_dependency"]["wire_dependency_rate"] == 0.5
    assert ledger["author_transparency"]["named_author_rate"] == 1.0
    assert ledger["source_transparency"]["policy_signal_count"] == 2
    assert ledger["rss_health"]["status"] == "degraded"
    assert {metric["id"] for metric in ledger["metrics"]} >= {
        "corrections",
        "original_reporting",
        "wire_dependency",
        "paywall",
        "author_transparency",
        "source_transparency",
    }
