from __future__ import annotations

import xml.etree.ElementTree as ET

from app.services.reporter_public_records import extract_article_author_candidates
from scripts import reporter_source_verifier
from scripts.reporter_source_verifier import (
    article_matches_source_domain,
    best_quality,
    byline_quality,
    classify_access_barrier,
    clean_author_name,
    discover_author_pages,
    extract_reporter_from_article,
    extract_articles,
    source_meets_min_quality,
    validate_source_profile_async,
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


def test_source_quality_gate_rejects_weak_when_medium_required() -> None:
    assert source_meets_min_quality({"quality": "strong"}, "medium")
    assert source_meets_min_quality({"quality": "medium"}, "medium")
    assert not source_meets_min_quality({"quality": "weak"}, "medium")
    assert not source_meets_min_quality({"quality": "none"}, "medium")


def test_article_domain_guard_rejects_unscoped_aggregator_link() -> None:
    config = {"url": "https://hnrss.org/frontpage", "site_url": "https://hnrss.org"}
    assert not article_matches_source_domain("https://example-news.org/story", config)


def test_article_domain_guard_accepts_source_article_link() -> None:
    config = {"url": "https://www.bbc.com/news/10628494", "site_url": "https://www.bbc.com"}
    assert article_matches_source_domain("https://www.bbc.co.uk/news/articles/example", config)


def test_classify_access_barrier_detects_cloudflare_and_datadome() -> None:
    assert (
        classify_access_barrier(403, b"<script src='https://challenges.cloudflare.com/x'></script>")
        == "cloudflare_challenge"
    )
    assert classify_access_barrier(401, b"x-datadome") == "datadome"
    assert classify_access_barrier(403, b"Forbidden") == "http_403"


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


def test_metadata_author_counts_as_medium_quality() -> None:
    assert (
        byline_quality(
            confidence=0.5,
            candidate_count=1,
            author_pages=0,
            structured_person_count=0,
            microdata_author_count=0,
            metadata_author_count=1,
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
    assert clean_author_name("Change password") is None
    assert clean_author_name("People") is None
    assert clean_author_name("Board of Directors") is None
    assert clean_author_name("Breitbart TV") is None
    assert clean_author_name("John W. Whitehead – Nisha Whitehead") is None
    assert clean_author_name("Malay Mail") is None
    assert clean_author_name("Empresa Peruana de Servicios Editoriales S.A. Editora Peru") is None
    assert clean_author_name("Amnesty International") is None
    assert clean_author_name("The Costa Rica Star") is None
    assert clean_author_name("The Citizen Reporter") is None
    assert clean_author_name("Australian Associated Press") is None
    assert clean_author_name("Sports Reporter") is None
    assert clean_author_name("Newsday Reporter") is None
    assert clean_author_name("Observer Online reporter") is None
    assert clean_author_name("The Brief") is None
    assert clean_author_name("L'Equipe TV") is None
    assert clean_author_name("The FRANCE 24 Observers") is None
    assert clean_author_name("Onzonkundaneki yetu") is None
    assert clean_author_name("Mengesnamibian com na") is None
    assert clean_author_name("Namibia Press Agency") is None
    assert clean_author_name("Freelancer21 Freelancer21") is None
    assert clean_author_name("Pennsylvania Capital Star") is None
    assert clean_author_name("Sponsored by Independence Blue Cross") is None
    assert clean_author_name("Nashville Public Radio") is None
    assert clean_author_name("National Post View") is None
    assert clean_author_name("Special to National Post") is None
    assert clean_author_name("Contributing Writer") is None
    assert clean_author_name("FPA Obituary") is None
    assert clean_author_name("MND Plus") is None
    assert clean_author_name("El Jalapeno") is None
    assert clean_author_name("El Jalapeño") is None
    assert clean_author_name("Parx Casino") is None
    assert clean_author_name("Chalkbeat Philadelphia") is None
    assert clean_author_name("PhillyVoice in Partnership") is None
    assert clean_author_name("Visit Philadelphia") is None
    assert clean_author_name("University of California") is None
    assert clean_author_name("Our Correspondent\u200b") is None
    assert clean_author_name("Guest Contributor") is None
    assert clean_author_name("Agencia EFE") is None
    assert clean_author_name("Press Release") is None
    assert clean_author_name("The Associated Press") is None
    assert clean_author_name("يمن مونيتور") is None
    assert clean_author_name("Socialism AI") is None
    assert clean_author_name("Guardian sport") is None
    assert clean_author_name("Guardian writers") is None
    assert clean_author_name("Guardian correspondents") is None
    assert clean_author_name("culture correspondent") is None
    assert clean_author_name("crime correspondent") is None
    assert clean_author_name("environment correspondent") is None
    assert clean_author_name("foreign correspondent") is None
    assert clean_author_name("inequalities correspondent") is None
    assert clean_author_name("social affairs") is None
    assert clean_author_name("International Youth and Students for Social Equality (IYSSE)") is None
    assert clean_author_name("qaz_plm") is None
    assert clean_author_name("Anonymous Cuban Surgeon") is None


def test_clean_author_name_preserves_person_names() -> None:
    assert clean_author_name("Georgy Shvanov / Gazeta") == "Georgy Shvanov"
    assert clean_author_name("none@none.com (Syed Irfan Raza)") == "Syed Irfan Raza"
    assert clean_author_name("BY ARIELLA ROITMAN") == "ARIELLA ROITMAN"
    assert clean_author_name("Martha Louis - PC Online Contributor") == "Martha Louis"
    assert clean_author_name("Benita Kolovos Victorian state correspondent") == "Benita Kolovos"
    assert clean_author_name("Peter Walker Senior political correspondent") == "Peter Walker"
    assert clean_author_name("Jane Doe Contributing Writer") == "Jane Doe"
    assert clean_author_name("Jane Doe Guest Contributor") == "Jane Doe"
    assert clean_author_name("Haroon Siddique Legal affairs") == "Haroon Siddique"
    assert clean_author_name("Aamna Mohdin Community affairs correspondent") == "Aamna Mohdin"
    assert clean_author_name("Ajit Niranjan Europe environment correspondent") == "Ajit Niranjan"
    assert clean_author_name("Jamie Jackson at Turf Moor") == "Jamie Jackson"
    assert clean_author_name("Giles Richards at Suzuka") == "Giles Richards"
    assert clean_author_name("Jon Henley Europe") == "Jon Henley"
    assert clean_author_name("Adam Fulton (earlier)") == "Adam Fulton"
    assert clean_author_name("Presented by Annie Kelly") == "Annie Kelly"
    assert clean_author_name("Produced by Ruth Abrahams") == "Ruth Abrahams"
    assert clean_author_name("Photography by Christopher Thomond") == "Christopher Thomond"
    assert clean_author_name("Words by Sam Wollaston") == "Sam Wollaston"
    assert clean_author_name("as told to Katie Cunningham") == "Katie Cunningham"
    assert (
        clean_author_name("Ruddy Allen Sports Writer ruddya@jamaicaobserver.com") == "Ruddy Allen"
    )
    assert (
        clean_author_name(
            "Dashan` Hendricks Business Content Manager hendricksd@jamaicaobserver.com"
        )
        == "Dashan' Hendricks"
    )
    assert (
        clean_author_name("PAUL A REID Observer writer reidp@jamaicaobserver.com") == "PAUL A REID"
    )
    assert clean_author_name("lead producer Zoe Hitch") == "Zoe Hitch"
    assert clean_author_name("Leyland Cecco in Toronto") == "Leyland Cecco"
    assert clean_author_name("Hannah Devlin Science") == "Hannah Devlin"
    assert clean_author_name("Exclusive by Matt Hughes") == "Matt Hughes"


def test_extract_article_author_candidates_reads_metadata_standards() -> None:
    html = """
    <html>
      <head>
        <meta property="article:author" content="Jane Reporter">
        <meta name="dc.creator" content="Backup Reporter">
        <meta property="article:publisher" content="Example News">
        <meta property="og:site_name" content="Example Daily">
      </head>
      <body></body>
    </html>
    """

    result = extract_article_author_candidates(html, "https://example.com/story")

    assert result["metadata_author_names"] == ["Jane Reporter", "Backup Reporter"]
    assert "Jane Reporter" in result["names"]
    assert result["publisher_names"] == ["Example News"]
    assert result["site_names"] == ["Example Daily"]


def test_extract_reporter_marks_generic_feed_byline(monkeypatch) -> None:
    def fake_fetch(_url: str) -> tuple[int, str, bytes]:
        return 200, "text/html", b"<html><title>No author here</title></html>"

    monkeypatch.setattr(reporter_source_verifier, "fetch_feed", fake_fetch)

    result = extract_reporter_from_article(
        {
            "author": "Malay Mail",
            "link": "https://www.malaymail.com/news/example",
            "title": "Example",
        }
    )

    assert result["ok"] is False
    assert result["quality"] == "none"
    assert result["generic_byline"] is True
    assert "generic feed byline filtered" in result["error"]


def test_extract_reporter_marks_blocked_article_with_rss_fallback(monkeypatch) -> None:
    def fake_fetch(_url: str) -> tuple[int, str, bytes]:
        return 403, "text/html", b"<script src='https://challenges.cloudflare.com/x'></script>"

    monkeypatch.setattr(reporter_source_verifier, "fetch_feed", fake_fetch)

    result = extract_reporter_from_article(
        {
            "author": "Example Reporter",
            "link": "https://example.com/news/story",
            "title": "Example",
        }
    )

    assert result["ok"] is True
    assert result["quality"] == "medium"
    assert result["access_barrier"] == "cloudflare_challenge"
    assert "fell back to RSS byline" in result["error"]


def test_discover_author_pages_confirms_same_domain_page(monkeypatch) -> None:
    def fake_fetch(url: str) -> tuple[int, str, bytes]:
        if url != "https://example.com/by/example-reporter":
            return 404, "text/html", b""
        return 200, "text/html", b"<html>Example Reporter archive</html>"

    monkeypatch.setattr(reporter_source_verifier, "fetch_feed", fake_fetch)

    assert discover_author_pages("Example Reporter", "https://example.com/news/story") == [
        "https://example.com/by/example-reporter"
    ]


async def test_validate_source_profile_reports_transparency_and_ad_supply(monkeypatch) -> None:
    async def fake_build_source_profile(source_name: str, website: str | None):
        return {
            "source": source_name,
            "website": website,
            "match_status": "matched",
            "citations": [{"label": "Official website", "url": website}],
            "dossier_sections": [
                {
                    "id": "transparency",
                    "title": "Transparency",
                    "status": "available",
                    "items": [
                        {
                            "label": "ads.txt authorized sellers",
                            "value": "1 authorized sellers (1 DIRECT, 0 RESELLER)",
                        }
                    ],
                }
            ],
            "ads_txt": {
                "url": f"{website}/ads.txt",
                "authorized_sellers": 1,
            },
            "sellers_json": {
                "checked_ad_systems": 1,
                "matched_records": 1,
            },
            "policy_transparency": {
                "checked_pages": 1,
                "available_signals": 1,
                "signals": [
                    {
                        "id": "corrections_process",
                        "label": "Corrections process",
                        "sources": [f"{website}/corrections"],
                        "matched_terms": ["corrections"],
                    }
                ],
            },
        }

    monkeypatch.setattr(reporter_source_verifier, "build_source_profile", fake_build_source_profile)

    result = await validate_source_profile_async(
        "Example Source",
        {"site_url": "https://example.com", "url": "https://example.com/rss.xml"},
    )

    assert result["ok"] is True
    assert result["citations"] == 1
    assert result["transparency_items"] == 1
    assert result["ads_txt"] is True
    assert result["sellers_json"] is True
    assert result["policy_signals"] == 1
    assert result["checked_ad_systems"] == 1
