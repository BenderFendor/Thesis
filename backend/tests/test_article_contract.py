from datetime import UTC, datetime

from app.api.routes.news import _browse_article_to_dict, _cached_article_to_dict
from app.api.routes.search import _semantic_result_payloads
from app.database import Article
from app.models.news import NewsArticle


def test_browse_and_cached_articles_share_canonical_keys() -> None:
    persisted = _browse_article_to_dict(
        {
            "author": "Reporter",
            "authors": ["Reporter"],
            "bias": "center",
            "category": "world",
            "content": "Full text",
            "country": "US",
            "credibility": "high",
            "id": 7,
            "image_url": "https://example.com/image.jpg",
            "published_at": None,
            "source": "Example News",
            "source_id": "example-news",
            "summary": "Summary",
            "title": "Headline",
            "url": "https://example.com/article",
        }
    )
    cached = _cached_article_to_dict(
        NewsArticle(
            description="Summary",
            id=7,
            image="https://example.com/image.jpg",
            link="https://example.com/article",
            published="2026-04-09T00:00:00+00:00",
            source="Example News",
            title="Headline",
        )
    )

    assert set(persisted) == set(cached)
    assert persisted["url"] == cached["url"]
    assert persisted["image_url"] == cached["image_url"]
    assert "description" not in persisted
    assert "link" not in persisted


def test_semantic_search_wraps_a_canonical_article_without_aliases() -> None:
    article = Article(
        author_urls=["https://example.com/reporter"],
        category="world",
        country="US",
        id=11,
        image_url="https://example.com/image.jpg",
        published_at=datetime(2026, 4, 9, tzinfo=UTC),
        source="Example News",
        source_id="example-news",
        summary="Semantic summary",
        title="Semantic headline",
        url="https://example.com/article",
    )
    [result] = _semantic_result_payloads(
        [
            {
                "article_id": 11,
                "chroma_id": "chroma-11",
                "distance": 0.2,
                "metadata": {},
                "preview": "Semantic summary",
                "similarity_score": 0.8,
            }
        ],
        {11: article},
    )

    payload = result.article.model_dump()
    assert payload["url"] == "https://example.com/article"
    assert payload["image_url"] == "https://example.com/image.jpg"
    assert payload["author_urls"] == ["https://example.com/reporter"]
    assert "published" not in payload
    assert "description" not in payload
    assert "link" not in payload
