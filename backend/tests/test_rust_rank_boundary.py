from app.services.rss_parser_rust_bindings import rank_articles


def test_rank_articles_preserves_result_shape_and_priority_order() -> None:
    articles = [
        {
            "id": 1,
            "title": "Climate policy update",
            "summary": "New climate policy details",
            "category": "World",
            "source": "Example Wire",
            "source_id": "wire",
            "tags": ["climate"],
            "image": "https://example.org/article.jpg",
        },
        {
            "id": 2,
            "title": "Climate policy debate",
            "summary": "Policy debate details",
            "category": "World",
            "source": "Example Wire",
            "source_id": "wire",
            "tags": ["policy"],
            "image": "none",
        },
        {
            "id": 3,
            "title": "Climate policy response",
            "summary": "Response details",
            "category": "World",
            "source": "Other Outlet",
            "source_id": "other",
            "tags": ["response"],
            "image": "https://example.org/response.jpg",
        },
        {"title": "Missing id is skipped"},
    ]

    results = rank_articles(
        articles,
        liked_article_ids=[1],
        bookmarked_article_ids=[],
        favorite_source_ids=["wire"],
    )

    assert [result["article_id"] for result in results] == [1, 2, 3]
    assert [result["bucket_rank"] for result in results] == [3, 2, 1]
    assert results[0]["bucket_label"] == "favorite source + image"
    assert "climate" in results[0]["matched_keywords"]
    for result in results:
        assert set(result) == {
            "article_id",
            "total_score",
            "bucket_rank",
            "bucket_label",
            "keyword_score",
            "category_score",
            "source_score",
            "matched_keywords",
            "matched_categories",
            "matched_source",
        }
