"""Regression tests for source profile coverage measurement."""

from __future__ import annotations

import pytest

from scripts import measure_wiki_profile_coverage as coverage


def test_coverage_counts_source_transparency_evidence() -> None:
    profile = {
        "fields": {
            "overview": [{"value": "Example overview"}],
            "ownership": [{"value": "Example Media"}],
            "funding": [{"value": "commercial"}],
        },
        "overview": "Example profile.",
        "official_pages": [
            {"label": "about", "url": "https://example.com/about"},
            {"label": "corrections", "url": "https://example.com/corrections"},
        ],
        "citations": [{"label": "Official website", "url": "https://example.com"}],
        "match_status": "matched",
        "dossier_sections": [
            {
                "id": "transparency",
                "items": [
                    {"label": "About page", "value": "available"},
                    {"label": "Corrections policy", "value": "available"},
                    {"label": "ads.txt authorized sellers", "value": "2 authorized sellers"},
                ],
            }
        ],
        "policy_transparency": {
            "available_signals": 2,
            "signals": [
                {"id": "corrections_process"},
                {"id": "ownership_disclosure"},
            ],
        },
        "ads_txt": {"url": "https://example.com/ads.txt"},
        "sellers_json": {
            "checked_ad_systems": 1,
            "checked_records": 2,
            "matched_records": 1,
        },
    }

    assert coverage._transparency_item_count(profile) == 3
    assert coverage._policy_signal_count(profile) == 2
    assert coverage._ads_txt_available(profile) is True
    assert coverage._sellers_json_metrics(profile) == (1, 2, 1)

    baseline = dict(profile)
    baseline.pop("dossier_sections")
    baseline.pop("policy_transparency")
    baseline.pop("ads_txt")
    baseline.pop("sellers_json")

    assert coverage._coverage(profile) > coverage._coverage(baseline)


@pytest.mark.asyncio
async def test_reporter_coverage_uses_lazy_session_factory(monkeypatch) -> None:
    from app import database

    class FakeResult:
        def __init__(
            self,
            scalar: int | None = None,
            rows: list[tuple[str | None, int]] | None = None,
            scalars: list[object] | None = None,
        ):
            self._scalar = scalar
            self._rows = rows or []
            self._scalars = scalars or []

        def scalar_one(self) -> int | None:
            return self._scalar

        def all(self) -> list[tuple[str | None, int]]:
            return self._scalars or self._rows

        def scalars(self):
            return self

    class FakeSession:
        def __init__(self) -> None:
            self.calls = 0
            self.closed = False

        async def execute(self, _stmt):
            self.calls += 1
            if self.calls == 1:
                return FakeResult(scalar=4)
            if self.calls == 2:
                return FakeResult(rows=[("strong", 3), (None, 1)])
            if self.calls == 3:
                return FakeResult(scalar=3)
            if self.calls == 4:
                return FakeResult(scalar=2)
            if self.calls == 5:
                return FakeResult(scalar=1)
            if self.calls == 6:
                return FakeResult(scalar=1)
            return FakeResult(
                scalars=[
                    database.Reporter(
                        id=1,
                        name="Jane Doe",
                        confidence_tier="verified",
                        author_page_url="https://example.org/author/jane",
                        citations=[
                            {
                                "label": "Official author page",
                                "url": "https://example.org/author/jane",
                            }
                        ],
                    ),
                    database.Reporter(
                        id=2,
                        name="Test Person",
                        confidence_tier="strong",
                        author_page_url="https://test.local/author/test",
                    ),
                ]
            )

        async def close(self) -> None:
            self.closed = True

    fake_session = FakeSession()

    def fake_session_factory() -> FakeSession:
        return fake_session

    monkeypatch.setattr(database, "AsyncSessionLocal", fake_session_factory)

    result = await coverage._measure_reporter_coverage()

    assert result == {
        "total_reporters": 4,
        "tier_counts": {"strong": 3, "unmatched": 1},
        "with_wikidata_qid": 3,
        "with_author_page_url": 2,
        "with_public_author_page_url": 1,
        "with_author_profile_url": 1,
        "verified_public_author_page_url": 1,
        "verified_author_profile_url": 1,
        "verified_author_page_citations": 1,
        "non_public_author_page_url": 1,
        "non_profile_author_page_url": 1,
        "with_claims": 1,
        "with_article_links": 1,
    }
    assert fake_session.closed is True
