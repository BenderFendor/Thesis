from __future__ import annotations

import xml.etree.ElementTree as ET

from scripts import reporter_source_verifier
from scripts.reporter_source_verifier import (
    best_quality,
    byline_quality,
    clean_author_name,
    discover_author_pages,
    extract_articles,
)


def test_extract_articles_reads_atom_entries() -> None:
    root = ET.fromstring(
        """<?xml version="1.0" encoding="utf-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>tag:example.com,2026:1</id>
            <author><name>Example Reporter</name></author>
            <title>Atom story</title>
            <link href="https://example.com/story" rel="alternate" type="text/html" />
          </entry>
        </feed>
        """
    )

    assert extract_articles(root, limit=5) == [
        {
            "author": "Example Reporter",
            "link": "https://example.com/story",
            "title": "Atom story",
        }
    ]


def test_best_quality_uses_best_source_signal() -> None:
    assert best_quality({"strong": 0, "medium": 1, "weak": 4, "none": 0}) == "medium"
    assert best_quality({"strong": 1, "medium": 3, "weak": 1, "none": 0}) == "strong"
    assert best_quality({"strong": 0, "medium": 0, "weak": 0, "none": 5}) == "none"


def test_structured_person_author_counts_as_medium_quality() -> None:
    assert (
        byline_quality(
            confidence=0.5,
            candidate_count=1,
            author_pages=0,
            structured_person_count=1,
            microdata_author_count=0,
        )
        == "medium"
    )


def test_microdata_author_counts_as_medium_quality() -> None:
    assert (
        byline_quality(
            confidence=0.5,
            candidate_count=1,
            author_pages=0,
            structured_person_count=0,
            microdata_author_count=1,
        )
        == "medium"
    )


def test_official_feed_byline_counts_as_medium_quality() -> None:
    assert (
        byline_quality(
            confidence=0.5,
            candidate_count=1,
            author_pages=0,
            official_feed_byline=True,
        )
        == "medium"
    )


def test_clean_author_name_filters_navigation_labels() -> None:
    assert clean_author_name("Bluesky") is None
    assert clean_author_name("view license") is None
    assert clean_author_name("People") is None
    assert clean_author_name("Board of Directors") is None


def test_clean_author_name_preserves_person_names() -> None:
    assert clean_author_name("Georgy Shvanov / Gazeta") == "Georgy Shvanov"
    assert clean_author_name("none@none.com (Syed Irfan Raza)") == "Syed Irfan Raza"


def test_discover_author_pages_confirms_same_domain_page(monkeypatch) -> None:
    def fake_fetch(url: str) -> tuple[int, str, bytes]:
        if url != "https://example.com/by/example-reporter":
            return 404, "text/html", b""
        return 200, "text/html", b"<html>Example Reporter archive</html>"

    monkeypatch.setattr(reporter_source_verifier, "fetch_feed", fake_fetch)

    assert discover_author_pages(
        "Example Reporter", "https://example.com/news/story"
    ) == ["https://example.com/by/example-reporter"]
