from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.database import Article
from app.services.chroma_topics import ChromaTopicService
from app.services.cluster_cache import save_snapshot


def _utc(hours_ago: int) -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours_ago)


def _article(
    article_id: int,
    title: str,
    source: str,
    url: str,
    published_at: datetime,
) -> Article:
    return Article(
        id=article_id,
        title=title,
        source=source,
        url=url,
        published_at=published_at,
        summary=title,
        content=title,
    )


@pytest.mark.asyncio
async def test_cluster_articles_uses_lexical_fallback_when_chroma_unreachable(
    monkeypatch,
):
    service = ChromaTopicService()
    monkeypatch.setattr("app.services.chroma_topics.is_chroma_reachable", lambda: False)

    articles = [
        _article(
            1,
            "US election debate highlights and voter turnout",
            "source-a",
            "https://example.com/1",
            _utc(1),
        ),
        _article(
            2,
            "Voter turnout rises after US election debate",
            "source-b",
            "https://example.com/2",
            _utc(2),
        ),
        _article(
            3,
            "NASA mission launches new moon lander",
            "source-c",
            "https://example.com/3",
            _utc(3),
        ),
    ]

    clusters = await service._cluster_articles(articles)

    assert clusters
    clustered_members = [set(cluster.member_ids) for cluster in clusters]
    assert any({1, 2}.issubset(member_ids) for member_ids in clustered_members)


@pytest.mark.asyncio
async def test_get_cluster_detail_reads_from_snapshot_when_available(db_session):
    cluster_payload = {
        "cluster_id": 99,
        "label": "Election debate",
        "keywords": ["election", "debate"],
        "article_count": 2,
        "window_count": 2,
        "source_diversity": 2,
        "representative_article": None,
        "articles": [
            {
                "id": 10,
                "title": "Debate recap",
                "source": "source-a",
                "url": "https://example.com/debate-recap",
                "image_url": None,
                "published_at": "2026-03-01T10:00:00",
            },
            {
                "id": 11,
                "title": "Post-debate analysis",
                "source": "source-b",
                "url": "https://example.com/debate-analysis",
                "image_url": None,
                "published_at": "2026-03-01T12:00:00",
            },
        ],
    }
    await save_snapshot(db_session, "1w", [cluster_payload])

    service = ChromaTopicService()
    detail = await service.get_cluster_detail(db_session, 99)

    assert detail is not None
    assert detail["id"] == 99
    assert detail["article_count"] == 2
    assert len(detail["articles"]) == 2
    assert detail["first_seen"] == "2026-03-01T10:00:00"
    assert detail["last_seen"] == "2026-03-01T12:00:00"


@pytest.mark.asyncio
async def test_get_cluster_detail_reclusters_recent_articles_when_snapshot_missing(
    db_session, monkeypatch
):
    articles = [
        _article(
            201,
            "Semiconductor exports lift South Korea current account surplus",
            "source-a",
            "https://example.com/south-korea-1",
            _utc(1),
        ),
        _article(
            202,
            "South Korea surplus widens on semiconductor exports",
            "source-b",
            "https://example.com/south-korea-2",
            _utc(2),
        ),
        _article(
            203,
            "NASA prepares a new moon lander mission",
            "source-c",
            "https://example.com/moon-lander",
            _utc(3),
        ),
    ]
    db_session.add_all(articles)
    await db_session.commit()

    service = ChromaTopicService()
    monkeypatch.setattr(service, "_get_vector_store", lambda: None)

    clusters = await service.get_trending_clusters(db_session, window="1d", limit=5)

    assert clusters

    detail = await service.get_cluster_detail(db_session, clusters[0]["cluster_id"])

    assert detail is not None
    assert detail["id"] == clusters[0]["cluster_id"]
    assert detail["article_count"] == 2
    assert {article["id"] for article in detail["articles"]} == {201, 202}
