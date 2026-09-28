from app.services.rss_parser_rust_bindings import (
    extract_keywords_from_titles_rust,
    extract_keywords_rust,
    generate_cluster_label_rust,
    lexical_cluster,
)


def test_topic_keyword_boundary_preserves_normalized_deduplicated_output() -> None:
    title = (
        "Trump signs executive order on immigration policies. "
        "Trump signs executive order on immigration policies."
    )

    assert extract_keywords_rust(title) == [
        "trump",
        "sign",
        "executive",
        "order",
        "immigration",
        "policy",
    ]
    assert extract_keywords_from_titles_rust([title, title]) == [
        "trump",
        "sign",
        "executive",
        "order",
        "immigration",
        "policy",
    ]


def test_topic_cluster_boundary_returns_feed_ordered_clusters() -> None:
    articles = [
        (3, "New climate report shows rising temperatures", 2),
        (4, "Climate scientists report warming temperatures in oceans", 3),
        (1, "Trump signs executive order on border security", 0),
        (2, "President Trump executive order targets immigration", 1),
    ]

    clusters = lexical_cluster(articles)

    assert [(cluster["anchor_id"], cluster["member_ids"]) for cluster in clusters] == [
        (1, [1, 2]),
        (3, [3, 4]),
    ]
    assert clusters[0]["similarities"][2] == 0.333
    assert clusters[1]["similarities"][4] == 0.286


def test_topic_label_boundary_chooses_highest_scored_title() -> None:
    assert (
        generate_cluster_label_rust(
            [
                ("Breaking: something happened", 2.0),
                ("President Signs Executive Order on Immigration Reform", 15.0),
                ("Short", 3.0),
            ]
        )
        == "President Signs Executive Order on Immigration Reform"
    )
