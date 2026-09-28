from __future__ import annotations

import json

from app.services.article_comparison import compare_articles
from rss_parser_rust import compare_articles_json


def _canonicalize_nondeterministic_lists(payload: dict) -> dict:
    for source in ("source_1", "source_2"):
        for category in ("persons", "organizations", "locations"):
            payload["entities"][source][category] = sorted(
                item.lower() for item in payload["entities"][source][category]
            )

    for section in ("common_entities", "unique_to_source_1", "unique_to_source_2"):
        for category in ("persons", "organizations", "locations"):
            payload["entities"]["comparison"][section][category] = sorted(
                item.lower() for item in payload["entities"]["comparison"][section][category]
            )

    comparison = payload["keywords"]["comparison"]
    comparison["common_keywords"].sort(key=lambda item: (-abs(item["difference"]), item["keyword"]))
    for key in ("unique_to_source_1", "unique_to_source_2"):
        comparison[key].sort(key=lambda item: (-item["frequency"], item["keyword"]))
    return payload


def test_rust_article_comparison_matches_python_service_behavior() -> None:
    fixtures = [
        (
            "Dr. Alice Smith said Acme Corporation opened a New York City office on January 3, 2025. "
            "The election policy changed today.",
            "Governor Bob Jones said Acme Corporation opened a New York City office on January 3, 2025. "
            "The election reform changed yesterday.",
            "Acme expansion report",
            "Acme expansion report update",
        ),
        (
            "The same article has a report.",
            "The same article has a report.",
            "Same title",
            "Same title",
        ),
        ("", "A source published a report.", "", "A report"),
    ]

    for content_1, content_2, title_1, title_2 in fixtures:
        python_payload = compare_articles(content_1, content_2, title_1, title_2)
        rust_payload = json.loads(compare_articles_json(content_1, content_2, title_1, title_2))
        assert _canonicalize_nondeterministic_lists(rust_payload) == (
            _canonicalize_nondeterministic_lists(python_payload)
        )
