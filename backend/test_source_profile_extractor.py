import re
import sys
from pathlib import Path

import httpx
import pytest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))

from app.services.source_profile_extractor import SourceDocument, build_fields_from_documents


def _values(fields, key):
    return {entry["value"] for entry in fields[key]}


def test_extracts_funding_editorial_and_corrections():
    document = SourceDocument(
        url="https://example.org/about",
        title="About",
        text=(
            "Truthout is a nonprofit newsroom supported by reader donations and memberships. "
            "Our mission is to advance social justice and advocacy journalism. "
            "Corrections policy: if we make mistakes, we correct them."
        ),
    )

    fields = build_fields_from_documents([document])

    funding = _values(fields, "funding")
    assert "non-profit" in funding
    assert "donation-supported" in funding
    assert "member-supported" in funding
    assert "reader-supported" in funding

    editorial = _values(fields, "editorial_stance")
    assert "mission-led" in editorial
    assert "social justice focus" in editorial
    assert "advocacy journalism" in editorial

    corrections = _values(fields, "corrections_history")
    assert "Corrections policy published" in corrections


def test_extracts_bias_and_factual_reporting():
    document = SourceDocument(
        url="https://example.org/profile",
        title="Profile",
        text="Bias Rating: left. Factual reporting: mixed.",
    )

    fields = build_fields_from_documents([document])

    assert "left" in _values(fields, "political_bias")
    assert "mixed" in _values(fields, "factual_reporting")


def test_extracts_ownership_affiliations_and_reach():
    document = SourceDocument(
        url="https://example.org/mission",
        title="Mission",
        text=(
            "Owned by Example Media Group. Member of Investigative News Network. "
            "Our audience reaches 2 million monthly visitors."
        ),
    )

    fields = build_fields_from_documents([document])

    assert "Example Media Group" in _values(fields, "ownership")
    assert "Investigative News Network" in _values(fields, "affiliations")
    assert "2 million monthly visitors" in _values(fields, "reach_traffic")


def test_dedupes_values_across_documents():
    documents = [
        SourceDocument(
            url="https://example.org/about",
            title="About",
            text="A nonprofit newsroom supported by readers.",
        ),
        SourceDocument(
            url="https://example.org/mission",
            title="Mission",
            text="Nonprofit newsroom supported by readers and donations.",
        ),
    ]

    fields = build_fields_from_documents(documents)

    funding = _values(fields, "funding")
    assert "non-profit" in funding
    assert "reader-supported" in funding
    assert len(fields["funding"]) == len(funding)


LIVE_SOURCES = [
    {
        "name": "ProPublica",
        "urls": ["https://www.propublica.org/about"],
        "expected_funding": {"non-profit", "donation-supported"},
    },
    {
        "name": "The Texas Tribune",
        "urls": ["https://www.texastribune.org/about/"],
        "expected_funding": {"non-profit", "member-supported"},
    },
    {
        "name": "The Marshall Project",
        "urls": ["https://www.themarshallproject.org/about"],
        "expected_funding": {"non-profit"},
    },
    {
        "name": "NPR",
        "urls": ["https://www.npr.org/about/"],
        "expected_funding": {"non-profit"},
    },
    {
        "name": "Associated Press",
        "urls": ["https://www.ap.org/about/our-people/"],
        "expected_funding": {"non-profit"},
    },
]


@pytest.mark.parametrize("case", LIVE_SOURCES)
def test_live_source_pages_extract_funding(case):
    documents = _fetch_live_documents(case["urls"])
    assert documents, f"No documents fetched for {case['name']}"
    fields = build_fields_from_documents(documents)
    funding_values = _values(fields, "funding")
    missing = case["expected_funding"] - funding_values
    assert not missing, f"Missing funding values for {case['name']}: {sorted(missing)}"


def _fetch_live_documents(urls):
    documents = []
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"}
    with httpx.Client(timeout=20.0, follow_redirects=True, headers=headers) as client:
        for url in urls:
            response = client.get(url)
            assert response.status_code == 200, f"Fetch failed for {url}: {response.status_code}"
            text, title = _extract_text_and_title(response.text)
            assert text, f"No text extracted from {url}"
            documents.append(SourceDocument(url=str(response.url), title=title or url, text=text))
    return documents


def _extract_text_and_title(html):
    soup = BeautifulSoup(html, "html.parser")
    title = ""
    title_tag = soup.find("title")
    if title_tag and title_tag.text:
        title = title_tag.text.strip()

    main = soup.find("main") or soup.find("article") or soup.body
    if not main:
        return "", title

    text = " ".join(segment.strip() for segment in main.stripped_strings)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:12000], title
