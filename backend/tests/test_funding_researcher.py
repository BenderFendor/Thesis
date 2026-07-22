"""Tests for FundingResearcher.

Covers: name matching, ProPublica validation, Wikidata dict/list parsing,
merge priority logic, and null guards.
"""

import asyncio

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from hypothesis import given, strategies as st

from app.services.funding_researcher import (
    KNOWN_ORGS,
    FundingResearcher,
    _format_wikidata_proportion,
    _select_organization_type,
)


def _make_httpx_response(status_code: int, json_data: dict) -> httpx.Response:
    """Build a fake httpx.Response with JSON body."""
    resp = httpx.Response(
        status_code=status_code,
        json=json_data,
        request=httpx.Request("GET", "https://example.com"),
    )
    return resp


@pytest.fixture
def researcher():
    """Create a FundingResearcher with mocked clients."""
    with patch("app.services.funding_researcher.get_openai_client", return_value=None):
        r = FundingResearcher()
    r.http_client = AsyncMock(spec=httpx.AsyncClient)
    return r


# ── _name_overlap ─────────────────────────────────────────────


class TestNameOverlap:
    def test_identical_names(self):
        assert FundingResearcher._name_overlap("fox news", "fox news") == 1.0

    def test_no_overlap(self):
        assert FundingResearcher._name_overlap("fox news", "bbc world") == 0.0

    def test_partial_overlap(self):
        score = FundingResearcher._name_overlap("fox news channel", "fox news")
        assert score == pytest.approx(2 / 3)

    def test_empty_string_a(self):
        assert FundingResearcher._name_overlap("", "fox news") == 0.0

    def test_empty_string_b(self):
        assert FundingResearcher._name_overlap("fox news", "") == 0.0

    def test_both_empty(self):
        assert FundingResearcher._name_overlap("", "") == 0.0

    def test_single_word_match(self):
        score = FundingResearcher._name_overlap("reuters", "reuters foundation")
        assert score == pytest.approx(1 / 2)

    def test_case_sensitive(self):
        # _name_overlap does not lowercase; caller is responsible
        assert FundingResearcher._name_overlap("Fox News", "fox news") == 0.0


# ── _normalize_name ───────────────────────────────────────────


class TestNormalizeName:
    def test_strips_inc(self):
        r = FundingResearcher.__new__(FundingResearcher)
        assert r._normalize_name("The New York Times Inc.") == "the new york times"

    def test_strips_llc(self):
        r = FundingResearcher.__new__(FundingResearcher)
        assert r._normalize_name("Vice Media LLC") == "vice media"

    def test_strips_company(self):
        r = FundingResearcher.__new__(FundingResearcher)
        assert r._normalize_name("The New York Times Company") == "the new york times"

    def test_lowercase_and_strip(self):
        r = FundingResearcher.__new__(FundingResearcher)
        assert r._normalize_name("  BBC  ") == "bbc"

    def test_strips_registry_punctuation(self):
        r = FundingResearcher.__new__(FundingResearcher)
        assert r._normalize_name("Warner Bros. Discovery, Inc.") == ("warner bros discovery")

    def test_extracts_source_grounded_ownership_changes(self):
        text = (
            "Example Media was formed in 2020. "
            "It agreed to be sold to Buyer Corp in 2026, subject to approval. "
            "The company operates three networks."
        )

        assert FundingResearcher._extract_ownership_changes(text) == (
            "It agreed to be sold to Buyer Corp in 2026, subject to approval."
        )


@pytest.mark.asyncio
async def test_wikipedia_search_prefers_exact_organization_title(researcher):
    search_response = _make_httpx_response(
        200,
        {
            "query": {
                "search": [
                    {
                        "title": (
                            "Proposed acquisition of Warner Bros. Discovery by Paramount Skydance"
                        )
                    },
                    {"title": "List of assets owned by Warner Bros. Discovery"},
                    {"title": "Warner Bros. Discovery"},
                ]
            }
        },
    )
    extract_response = _make_httpx_response(
        200,
        {
            "query": {
                "pages": {
                    "67824355": {
                        "title": "Warner Bros. Discovery",
                        "extract": "Warner Bros. Discovery is a media company.",
                        "fullurl": "https://en.wikipedia.org/wiki/Warner_Bros._Discovery",
                    }
                }
            }
        },
    )
    researcher.http_client.get = AsyncMock(side_effect=[search_response, extract_response])

    result = await researcher._search_wikipedia("Warner Bros. Discovery")

    assert result["page_title"] == "Warner Bros. Discovery"
    extract_params = researcher.http_client.get.await_args_list[1].kwargs["params"]
    assert extract_params["titles"] == "Warner Bros. Discovery"


# ── _search_propublica_nonprofit ──────────────────────────────


@pytest.mark.asyncio
class TestSearchProPublica:
    async def test_rejects_name_mismatch(self, researcher):
        """ProPublica returning an unrelated org should be rejected."""
        search_resp = _make_httpx_response(
            200,
            {
                "organizations": [
                    {"name": "FRIENDS OF FOX VALLEY", "ein": "123456789"},
                ]
            },
        )
        researcher.http_client.get = AsyncMock(return_value=search_resp)

        result = await researcher._search_propublica_nonprofit("Fox News")
        assert result == {}

    async def test_accepts_matching_name(self, researcher):
        """ProPublica org with matching name should be accepted via substring."""
        search_resp = _make_httpx_response(
            200,
            {
                "organizations": [
                    {"name": "National Public Radio Inc", "ein": "111111111"},
                ]
            },
        )
        org_resp = _make_httpx_response(
            200,
            {
                "organization": {"name": "National Public Radio Inc"},
                "filings_with_data": [
                    {"totrevenue": 5000000, "totassetsend": 2000000, "tax_prd_yr": 2023}
                ],
            },
        )
        researcher.http_client.get = AsyncMock(side_effect=[search_resp, org_resp])

        # _normalize_name("NPR") -> "npr", candidate lowered -> "national public radio inc"
        # Neither is a substring of the other, but let's use a name with better overlap
        result = await researcher._search_propublica_nonprofit("National Public Radio")
        assert result.get("funding_type") == "non-profit"
        assert result["ein"] == "111111111"
        assert result.get("annual_revenue") == "5000000"

    async def test_rejects_all_candidates_when_none_match(self, researcher):
        """When no candidate passes the name filter, return empty."""
        search_resp = _make_httpx_response(
            200,
            {
                "organizations": [
                    {"name": "NEW YORK FOUNDATION FOR THE ARTS", "ein": "001"},
                    {"name": "NEW YORK CITY BALLET", "ein": "002"},
                ]
            },
        )
        researcher.http_client.get = AsyncMock(return_value=search_resp)

        result = await researcher._search_propublica_nonprofit("New York Times")
        assert result == {}

    async def test_empty_organizations_list(self, researcher):
        search_resp = _make_httpx_response(200, {"organizations": []})
        researcher.http_client.get = AsyncMock(return_value=search_resp)

        result = await researcher._search_propublica_nonprofit("Unknown Outlet")
        assert result == {}

    async def test_404_response(self, researcher):
        resp = _make_httpx_response(404, {})
        researcher.http_client.get = AsyncMock(return_value=resp)

        result = await researcher._search_propublica_nonprofit("Any")
        assert result == {}

    async def test_ein_coerced_to_string(self, researcher):
        """EIN should always be a string, even if the API returns an int."""
        search_resp = _make_httpx_response(
            200,
            {
                "organizations": [
                    {"name": "NPR Foundation", "ein": 987654321},
                ]
            },
        )
        org_resp = _make_httpx_response(
            200,
            {
                "organization": {"name": "NPR Foundation"},
                "filings_with_data": [],
            },
        )
        researcher.http_client.get = AsyncMock(side_effect=[search_resp, org_resp])

        result = await researcher._search_propublica_nonprofit("NPR")
        assert result["ein"] == "987654321"
        assert isinstance(result["ein"], str)

    async def test_rejects_single_token_foundation_match(self, researcher):
        """Long single-token outlet names should not match unrelated foundation records."""
        search_resp = _make_httpx_response(
            200,
            {
                "organizations": [
                    {"name": "Reuters Foundation", "ein": "134192037"},
                ]
            },
        )
        researcher.http_client.get = AsyncMock(return_value=search_resp)

        result = await researcher._search_propublica_nonprofit("Reuters")
        assert result == {}

    async def test_substring_match_accepts(self, researcher):
        """Substring containment should pass the name filter."""
        search_resp = _make_httpx_response(
            200,
            {
                "organizations": [
                    {"name": "associated press", "ein": "555"},
                ]
            },
        )
        org_resp = _make_httpx_response(
            200,
            {
                "organization": {"name": "Associated Press"},
                "filings_with_data": [],
            },
        )
        researcher.http_client.get = AsyncMock(side_effect=[search_resp, org_resp])

        result = await researcher._search_propublica_nonprofit("Associated Press")
        assert result != {}
        assert result["ein"] == "555"


# ── _fetch_wikidata ───────────────────────────────────────────


@pytest.mark.asyncio
class TestFetchWikidata:
    async def test_dict_format_entities(self, researcher):
        """Wikidata returns entities as a dict keyed by QID."""
        wikidata_resp = _make_httpx_response(
            200,
            {
                "entities": {
                    "Q1160945": {
                        "id": "Q1160945",
                        "type": "item",
                        "claims": {
                            "P127": [
                                {
                                    "mainsnak": {
                                        "datavalue": {"value": {"id": "Q7414"}},
                                        "snaktype": "value",
                                    }
                                }
                            ],
                        },
                        "labels": {"en": {"value": "Al Jazeera"}},
                    }
                }
            },
        )
        # Label resolution call
        label_resp = _make_httpx_response(
            200,
            {
                "entities": {
                    "Q7414": {
                        "id": "Q7414",
                        "labels": {"en": {"value": "Qatar"}},
                    }
                }
            },
        )
        researcher.http_client.get = AsyncMock(side_effect=[wikidata_resp, label_resp])

        result = await researcher._fetch_wikidata("Al Jazeera")
        assert result["qid"] == "Q1160945"
        assert "Qatar" in result.get("owned_by", [])

    async def test_empty_entities(self, researcher):
        resp = _make_httpx_response(200, {"entities": {}})
        researcher.http_client.get = AsyncMock(return_value=resp)

        result = await researcher._fetch_wikidata("Nonexistent Source")
        assert result == {}

    async def test_missing_entities_key(self, researcher):
        resp = _make_httpx_response(200, {})
        researcher.http_client.get = AsyncMock(return_value=resp)

        result = await researcher._fetch_wikidata("Bad Response")
        assert result == {}

    async def test_non_200_returns_empty(self, researcher):
        resp = _make_httpx_response(403, {})
        researcher.http_client.get = AsyncMock(return_value=resp)

        result = await researcher._fetch_wikidata("Forbidden")
        assert result == {}

    async def test_entity_without_claims(self, researcher):
        """Entity exists but has no claims section."""
        resp = _make_httpx_response(
            200,
            {
                "entities": {
                    "Q999": {
                        "id": "Q999",
                        "claims": {},
                        "labels": {"en": {"value": "Bare Entity"}},
                    }
                }
            },
        )
        researcher.http_client.get = AsyncMock(return_value=resp)

        result = await researcher._fetch_wikidata("Bare Entity")
        assert result["qid"] == "Q999"
        assert result["owned_by"] == []
        assert result["parent_orgs"] == []


# ── _resolve_wikidata_labels ──────────────────────────────────


@pytest.mark.asyncio
class TestResolveWikidataLabels:
    async def test_dict_format_response(self, researcher):
        resp = _make_httpx_response(
            200,
            {
                "entities": {
                    "Q123": {"id": "Q123", "labels": {"en": {"value": "Foo Corp"}}},
                    "Q456": {"id": "Q456", "labels": {"en": {"value": "Bar Inc"}}},
                }
            },
        )
        researcher.http_client.get = AsyncMock(return_value=resp)

        labels = await researcher._resolve_wikidata_labels(["Q123", "Q456"])
        assert labels == {"Q123": "Foo Corp", "Q456": "Bar Inc"}

    async def test_empty_input(self, researcher):
        labels = await researcher._resolve_wikidata_labels([])
        assert labels == {}
        researcher.http_client.get.assert_not_called()

    async def test_deduplicates_ids(self, researcher):
        resp = _make_httpx_response(
            200,
            {
                "entities": {
                    "Q100": {"id": "Q100", "labels": {"en": {"value": "Only One"}}},
                }
            },
        )
        researcher.http_client.get = AsyncMock(return_value=resp)

        labels = await researcher._resolve_wikidata_labels(["Q100", "Q100", "Q100"])
        assert labels == {"Q100": "Only One"}
        # Should have been called once with Q100 (not Q100|Q100|Q100)
        call_args = researcher.http_client.get.call_args
        assert call_args[1]["params"]["ids"] == "Q100"

    async def test_skips_entity_without_label(self, researcher):
        resp = _make_httpx_response(
            200,
            {
                "entities": {
                    "Q1": {"id": "Q1", "labels": {}},
                    "Q2": {"id": "Q2", "labels": {"en": {"value": "Labeled"}}},
                }
            },
        )
        researcher.http_client.get = AsyncMock(return_value=resp)

        labels = await researcher._resolve_wikidata_labels(["Q1", "Q2"])
        assert "Q1" not in labels
        assert labels["Q2"] == "Labeled"


# ── _merge_org_data ───────────────────────────────────────────


class TestMergeOrgData:
    def _make_researcher(self):
        r = FundingResearcher.__new__(FundingResearcher)
        return r

    def test_known_data_takes_priority_over_propublica(self):
        """Commercial outlet from KNOWN_ORGS should not be overridden by ProPublica non-profit."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Fox News",
            normalized_name="fox news",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={
                "ein": "999",
                "funding_type": "non-profit",
                "annual_revenue": "1000000",
            },
            known={"funding_type": "commercial", "parent": "Fox Corporation"},
        )
        assert result["funding_type"] == "commercial"
        assert result["parent_org"] == "Fox Corporation"
        assert result["ein"] is None
        assert "propublica" not in result["research_sources"]

    def test_propublica_sets_funding_type_when_no_prior(self):
        """When no higher-priority source sets funding_type, ProPublica can set it."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Small Nonprofit",
            normalized_name="small nonprofit",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={"ein": "123", "funding_type": "non-profit"},
            known={},
        )
        assert result["funding_type"] == "non-profit"

    def test_propublica_does_not_classify_a_person_as_a_nonprofit(self):
        """A same-name foundation must not overwrite a Wikidata human profile."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Larry Ellison",
            normalized_name="larry ellison",
            website=None,
            wikipedia={},
            wikidata={
                "qid": "Q92749",
                "org_types": ["human"],
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={
                "ein": "943269827",
                "funding_type": "non-profit",
                "annual_revenue": "179381252",
            },
            known={},
        )

        assert result["org_type"] == "human"
        assert result["funding_type"] is None
        assert result["ein"] is None
        assert result["annual_revenue"] is None
        assert "propublica" not in result["research_sources"]

    def test_wikipedia_ownership_none_does_not_crash(self):
        """Wikipedia data with ownership=None should not raise AttributeError."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Test Outlet",
            normalized_name="test outlet",
            website=None,
            wikipedia={"ownership": None, "url": "https://en.wikipedia.org/wiki/Test"},
            wikidata={},
            nonprofit={},
            known={},
        )
        assert result["wikipedia_url"] == "https://en.wikipedia.org/wiki/Test"
        assert result["parent_org"] is None

    def test_wikidata_parent_org_fills_gap(self):
        """Wikidata parent_orgs should populate parent_org when empty."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Outlet",
            normalized_name="outlet",
            website=None,
            wikipedia={},
            wikidata={
                "qid": "Q123",
                "wikidata_url": "https://wikidata.org/wiki/Q123",
                "parent_orgs": ["MegaCorp"],
                "owned_by": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["parent_org"] == "MegaCorp"

    def test_wikidata_does_not_override_known_parent(self):
        """Wikidata parent should not override KNOWN_ORGS parent."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="CNN",
            normalized_name="cnn",
            website=None,
            wikipedia={},
            wikidata={
                "qid": "Q999",
                "parent_orgs": ["Wrong Parent"],
                "owned_by": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={"funding_type": "commercial", "parent": "Warner Bros. Discovery"},
        )
        assert result["parent_org"] == "Warner Bros. Discovery"

    def test_propublica_ein_none_stays_none(self):
        """If ProPublica has ein=None, org should keep ein as None (not "None")."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="No EIN",
            normalized_name="no ein",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={"ein": None, "funding_type": "non-profit"},
            known={},
        )
        assert result["ein"] is None

    def test_confidence_escalation(self):
        """research_confidence should escalate: low -> medium (wiki) -> high (known)."""
        r = self._make_researcher()

        # Only wikidata -> medium
        result = r._merge_org_data(
            name="A",
            normalized_name="a",
            website=None,
            wikipedia={},
            wikidata={
                "qid": "Q1",
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["research_confidence"] == "medium"

    def test_confidence_stays_high_from_known(self):
        """Known data sets confidence to high, which should stick."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="BBC",
            normalized_name="bbc",
            website=None,
            wikipedia={"ownership": {"parent": None}},
            wikidata={},
            nonprofit={},
            known={"funding_type": "public", "parent": None},
        )
        assert result["research_confidence"] == "high"

    def test_wikidata_website_fills_gap(self):
        """Wikidata official_website should populate website when not set."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Source",
            normalized_name="source",
            website=None,
            wikipedia={},
            wikidata={
                "official_website": "https://example.com",
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["website"] == "https://example.com"

    def test_explicit_website_not_overridden(self):
        """Explicitly passed website should not be overridden by Wikidata."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Source",
            normalized_name="source",
            website="https://original.com",
            wikipedia={},
            wikidata={
                "official_website": "https://different.com",
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["website"] == "https://original.com"

    def test_all_sources_tracked(self):
        """research_sources should list all sources that contributed data."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Full",
            normalized_name="full",
            website=None,
            wikipedia={"url": "https://en.wikipedia.org/wiki/Full"},
            wikidata={
                "qid": "Q1",
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={"ein": "123"},
            known={"funding_type": "commercial"},
        )
        assert "known_data" in result["research_sources"]
        assert "wikipedia" in result["research_sources"]
        assert "wikidata" in result["research_sources"]
        assert "propublica" not in result["research_sources"]


@pytest.mark.asyncio
async def test_ai_enrichment_does_not_fill_source_grounded_fields(researcher):
    response = MagicMock()
    response.choices = [
        MagicMock(
            message=MagicMock(
                content="""{
                    "org_type": "media conglomerate",
                    "funding_type": "commercial",
                    "funding_sources": ["advertising", "subscriptions"],
                    "parent_org": null,
                    "ownership_percentage": null,
                    "media_bias_rating": "center",
                    "factual_reporting": "high",
                    "estimated_revenue": "$40B-$45B",
                    "major_donors": [],
                    "major_advertisers": [],
                    "recent_ownership_changes": "A proposed acquisition is pending.",
                    "funding_transparency": "transparent",
                    "has_paywall": false
                }"""
            )
        )
    ]
    researcher.client = MagicMock()
    researcher.client.chat.completions.create.return_value = response
    org = {
        "name": "Warner Bros. Discovery",
        "org_type": None,
        "parent_org": None,
        "ownership_percentage": None,
        "funding_type": None,
        "funding_sources": [],
        "major_advertisers": [],
        "annual_revenue": None,
        "top_donors": [],
        "media_bias_rating": None,
        "factual_reporting": None,
        "research_sources": ["wikipedia"],
        "research_confidence": "medium",
    }

    result = await researcher._ai_enhance_org_data(org)

    # Structured facts stay empty without source-grounded evidence.
    assert result["org_type"] is None
    assert result["funding_type"] is None
    assert result["parent_org"] is None
    assert result["ownership_percentage"] is None
    assert result["annual_revenue"] is None
    assert result.get("recent_ownership_changes") is None
    assert "ai_inference" in result["research_sources"]
    # AI does not set funding sources, advertisers, or donors.
    assert result["funding_sources"] == []
    assert result["major_advertisers"] == []
    assert result["top_donors"] == []
    call_kwargs = researcher.client.chat.completions.create.call_args.kwargs
    assert call_kwargs["response_format"] == {"type": "json_object"}
    assert call_kwargs["max_tokens"] == 1200


# ── User-Agent header ────────────────────────────────────────


class TestHttpClientSetup:
    def test_user_agent_header_set(self):
        with patch("app.services.funding_researcher.get_openai_client", return_value=None):
            r = FundingResearcher()
        assert "User-Agent" in r.http_client.headers
        assert "ScoopNewsApp" in r.http_client.headers["User-Agent"]


@pytest.mark.asyncio
async def test_research_organization_uses_limited_parallelism(researcher):
    active_calls = 0
    max_active_calls = 0

    async def _tracked_result(payload: dict[str, str]) -> dict[str, str]:
        nonlocal active_calls, max_active_calls
        active_calls += 1
        max_active_calls = max(max_active_calls, active_calls)
        await asyncio.sleep(0)
        active_calls -= 1
        return payload

    researcher._search_wikipedia = AsyncMock(
        side_effect=lambda name: _tracked_result({"wikipedia_url": "https://example.com/wiki"})
    )
    researcher._search_propublica_nonprofit = AsyncMock(
        side_effect=lambda name: _tracked_result({"ein": "123"})
    )
    researcher._get_known_org_data = AsyncMock(
        side_effect=lambda name: _tracked_result({"funding_type": "commercial"})
    )
    researcher._fetch_wikidata = AsyncMock(return_value={})

    await researcher.research_organization("Example News", use_ai=False)

    assert max_active_calls <= 2


@pytest.mark.asyncio
async def test_research_organization_awaits_awaitable_dependency_results(researcher):
    async def _delayed(payload: dict[str, str]) -> dict[str, str]:
        await asyncio.sleep(0)
        return payload

    researcher._search_wikipedia = AsyncMock(
        side_effect=lambda name: _delayed(
            {"wikipedia_url": "https://example.com/wiki", "page_title": "Example News"}
        )
    )
    researcher._search_propublica_nonprofit = AsyncMock(
        side_effect=lambda name: _delayed({"ein": "123"})
    )
    researcher._get_known_org_data = MagicMock(
        side_effect=lambda name: _delayed({"funding_type": "commercial"})
    )
    researcher._fetch_wikidata = AsyncMock(return_value={})

    result = await researcher.research_organization("Example News", use_ai=False)

    assert result["funding_type"] == "commercial"
    assert result["ein"] is None
    assert result["research_sources"] == ["known_data", "wikipedia"]
    researcher._fetch_wikidata.assert_awaited_once_with("Example News")


# ── KNOWN_ORGS coverage ──────────────────────────────────────


class TestKnownOrgsExpanded:
    """Verify the 22 newly added KNOWN_ORGS entries resolve correctly."""

    def _make_researcher(self):
        r = FundingResearcher.__new__(FundingResearcher)
        return r

    @pytest.mark.parametrize(
        "name,expected_type,expected_parent",
        [
            ("ABC News", "commercial", "The Walt Disney Company"),
            ("American Spectator", "non-profit", "American Spectator Foundation"),
            ("Axios", "commercial", "Cox Enterprises"),
            ("Big Think", "commercial", "Freethink Media"),
            ("Bloomberg", "commercial", "Bloomberg L.P."),
            ("CBC", "public", "Canadian Broadcasting Corporation"),
            ("Hacker News", "commercial", "Y Combinator"),
            ("IGN", "commercial", "Ziff Davis"),
            ("Le Monde", "commercial", "Groupe Le Monde"),
            ("Mother Jones", "non-profit", "Foundation for National Progress"),
            (
                "National Geographic",
                "commercial",
                "National Geographic Partners (Disney 73%)",
            ),
            ("National Post", "commercial", "Postmedia Network"),
            ("National Review", "non-profit", "National Review Institute"),
            ("RealClearPolitics", "commercial", "Real Clear Holdings LLC"),
            ("Reason", "non-profit", "Reason Foundation"),
            ("The Atlantic", "commercial", "Emerson Collective"),
            ("The Dispatch", "commercial", "Dispatch Media Inc."),
            ("The Economist", "commercial", "The Economist Group"),
            ("The Guardian", "trust-owned", "Scott Trust Limited"),
            ("The Nation", "commercial", "The Nation Company, L.P."),
            ("Variety", "commercial", "Penske Media Corporation"),
            (
                "Washington Times",
                "commercial",
                "Operations Holdings (Unification Church)",
            ),
            ("Democracy Now!", "non-profit", "Democracy Now! Productions"),
        ],
    )
    def test_known_org_resolves(self, name, expected_type, expected_parent):
        """Each expanded KNOWN_ORG should be found by _get_known_org_data
        and produce correct funding_type when merged."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name=name,
            normalized_name=r._normalize_name(name),
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={},
            known=KNOWN_ORGS.get(r._normalize_name(name), {}),
        )
        assert result["funding_type"] == expected_type, (
            f"{name}: expected {expected_type}, got {result['funding_type']}"
        )
        assert result["parent_org"] == expected_parent

    @pytest.mark.asyncio
    async def test_known_outlet_does_not_match_its_parent_company(self):
        r = self._make_researcher()
        result = await r._get_known_org_data("The New York Times Company")
        assert result == {}

    def test_known_orgs_override_propublica_for_bloomberg(self):
        """Bloomberg should be commercial even when ProPublica says non-profit."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Bloomberg",
            normalized_name="bloomberg",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={
                "ein": "999",
                "funding_type": "non-profit",
                "annual_revenue": "1000000",
            },
            known=KNOWN_ORGS["bloomberg"],
        )
        assert result["funding_type"] == "commercial"
        assert result["parent_org"] == "Bloomberg L.P."
        assert result["ein"] is None
        assert "propublica" not in result["research_sources"]


@given(st.text())
def test_normalize_name_never_crashes(name: str):
    researcher = FundingResearcher.__new__(FundingResearcher)
    normalized = researcher._normalize_name(name)
    assert isinstance(normalized, str)


# ── Deterministic generalized field extraction ───────────────


class TestSubsidiariesFromWikidata:
    """P355 subsidiary labels populate merge output when Wikidata provides them."""

    def _make_researcher(self):
        return FundingResearcher.__new__(FundingResearcher)

    def test_subsidiaries_extracted_from_wikidata(self):
        r = self._make_researcher()
        result = r._merge_org_data(
            name="ParentCo",
            normalized_name="parentco",
            website=None,
            wikipedia={},
            wikidata={
                "subsidiaries": ["Sub A", "Sub B", "Sub C"],
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["subsidiaries"] == ["Sub A", "Sub B", "Sub C"]

    def test_no_subsidiaries_defaults_to_empty(self):
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Solo Org",
            normalized_name="solo org",
            website=None,
            wikipedia={},
            wikidata={
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["subsidiaries"] == []


class TestOwnershipPercentageFromWikidata:
    """P1107 proportion qualifier on P127/P749 should populate ownership_percentage."""

    def _make_researcher(self):
        return FundingResearcher.__new__(FundingResearcher)

    def test_proportion_from_owned_by(self):
        r = self._make_researcher()
        result = r._merge_org_data(
            name="HeldCo",
            normalized_name="heldco",
            website=None,
            wikipedia={},
            wikidata={
                "owned_with_proportion": [("Big Owner", "85%")],
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["ownership_percentage"] == "85%"

    def test_proportion_from_parent(self):
        r = self._make_researcher()
        result = r._merge_org_data(
            name="ChildCo",
            normalized_name="childco",
            website=None,
            wikipedia={},
            wikidata={
                "parent_with_proportion": [("Parent Holdings", "100%")],
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["ownership_percentage"] == "100%"

    def test_no_proportion_leaves_null(self):
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Standalone",
            normalized_name="standalone",
            website=None,
            wikipedia={},
            wikidata={
                "owned_with_proportion": [("Holder", None)],
                "owned_by": [],
                "parent_orgs": [],
                "part_of": [],
                "headquarters": [],
            },
            nonprofit={},
            known={},
        )
        assert result["ownership_percentage"] is None

    @pytest.mark.parametrize(
        ("amount", "expected"),
        [("+0.85", "85%"), ("1", "100%"), ("25", "25%"), ("invalid", None)],
    )
    def test_raw_wikidata_proportion_is_display_percentage(
        self, amount: str, expected: str | None
    ) -> None:
        assert _format_wikidata_proportion(amount) == expected


def test_wikidata_org_type_prefers_specific_legal_form() -> None:
    assert (
        _select_organization_type(["business", "enterprise", "public company"]) == "public company"
    )


class TestKnownOrgTypeExtraction:
    """org_type should be populated from KNOWN_ORGS and SEC data."""

    def _make_researcher(self):
        return FundingResearcher.__new__(FundingResearcher)

    def test_org_type_from_known_data(self):
        r = self._make_researcher()
        result = r._merge_org_data(
            name="BBC",
            normalized_name="bbc",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={},
            known={"org_type": "public broadcaster", "funding_type": "public"},
        )
        assert result["org_type"] == "public broadcaster"

    def test_org_type_from_sec_tickers(self):
        """SEC tickers should set org_type to public company when KNOWN_ORGS has none."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Unknown Public Co",
            normalized_name="unknown public co",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={},
            known={},
            sec={"cik": "0012345678", "tickers": ["XXX"]},
        )
        assert result["org_type"] == "public company"

    def test_known_org_type_not_overridden_by_sec(self):
        """KNOWN_ORGS org_type should not be overridden by SEC's ticker inference."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="NPR",
            normalized_name="npr",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={},
            known={"org_type": "nonprofit", "funding_type": "non-profit"},
            sec={"cik": "0000000001", "tickers": ["X"]},
        )
        assert result["org_type"] == "nonprofit"


class TestFundingSourcesFromKnown:
    """funding_sources should only come from KNOWN_ORGS, never from AI."""

    def _make_researcher(self):
        return FundingResearcher.__new__(FundingResearcher)

    def test_funding_sources_from_known(self):
        r = self._make_researcher()
        result = r._merge_org_data(
            name="BBC",
            normalized_name="bbc",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={},
            known={
                "org_type": "public broadcaster",
                "funding_type": "public",
                "funding_sources": ["license fee", "government grant"],
            },
        )
        assert result["funding_sources"] == ["license fee", "government grant"]

    def test_no_funding_sources_stays_empty(self):
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Empty Co",
            normalized_name="empty co",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={},
            known={},
        )
        assert result["funding_sources"] == []

    def test_major_advertisers_always_empty_unless_source_given(self):
        """major_advertisers cannot be populated by AI or inference."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Any Co",
            normalized_name="any co",
            website=None,
            wikipedia={},
            wikidata={},
            nonprofit={},
            known={},
        )
        assert result["major_advertisers"] == []


class TestWBDPendingAcquisition:
    """Pending Paramount Skydance acquisition must live in recent_ownership_changes,
    never in parent_org."""

    def _make_researcher(self):
        return FundingResearcher.__new__(FundingResearcher)

    def test_known_wbd_has_no_parent(self):
        """WBD as public company has parent=None."""
        known = KNOWN_ORGS.get("warner bros. discovery", {})
        assert known.get("parent") is None
        assert known.get("org_type") == "public company"

    def test_merger_in_recent_ownership_changes_not_parent(self):
        """Wikipedia text with pending acquisition should populate
        recent_ownership_changes, not parent_org."""
        r = self._make_researcher()
        text = (
            "Warner Bros. Discovery is an American media conglomerate. "
            "It agreed to be sold to Paramount Skydance in 2026, subject to regulatory approval. "
            "The company operates many networks."
        )
        changes = FundingResearcher._extract_ownership_changes(text)
        assert changes is not None
        assert "agreed to be sold" in changes

        result = r._merge_org_data(
            name="Warner Bros. Discovery",
            normalized_name="warner bros. discovery",
            website=None,
            wikipedia={
                "recent_ownership_changes": changes,
                "url": "https://en.wikipedia.org/wiki/Warner_Bros._Discovery",
            },
            wikidata={},
            nonprofit={},
            known={},
        )
        assert result["parent_org"] is None
        assert "agreed to be sold" in (result["recent_ownership_changes"] or "")

    def test_known_wbd_contains_only_stable_classification(self):
        known = KNOWN_ORGS.get("warner bros. discovery", {})
        assert known.get("org_type") == "public company"
        assert known.get("parent") is None
        assert "annual_revenue" not in known
        assert "recent_ownership_changes" not in known


class TestGeneralization:
    """Prove the extractor is not name-specific — works for arbitrary orgs."""

    def _make_researcher(self):
        return FundingResearcher.__new__(FundingResearcher)

    def test_non_known_org_gets_fields_from_sec_and_wikidata(self):
        """An org not in KNOWN_ORGS should still populate from structured sources."""
        r = self._make_researcher()
        result = r._merge_org_data(
            name="Acme Media Group",
            normalized_name="acme media group",
            website=None,
            wikipedia={
                "url": "https://en.wikipedia.org/wiki/Acme_Media_Group",
                "ownership": {"parent": "Big Corp"},
                "description": "A test media company",
            },
            wikidata={
                "qid": "Q999999",
                "owned_by": ["Big Corp"],
                "parent_orgs": ["Big Corp"],
                "part_of": [],
                "headquarters": ["Springfield"],
                "subsidiaries": ["Sub Inc"],
                "inception": "2020-01-01",
            },
            nonprofit={},
            known={},
            sec={
                "cik": "0001234567",
                "ein": "12-3456789",
                "tickers": ["ACM"],
                "revenue": "500000000",
            },
        )
        assert result["name"] == "Acme Media Group"
        assert result["parent_org"] == "Big Corp"
        assert result["org_type"] == "public company"  # from SEC tickers
        assert result["cik"] == "0001234567"
        assert result["ein"] == "12-3456789"
        assert result["annual_revenue"] == "500000000"
        assert result["subsidiaries"] == ["Sub Inc"]
        # Fields requiring KNOWN_ORGS or source grounding remain empty for unknown orgs
        assert result["funding_sources"] == []
        assert result["major_advertisers"] == []
        assert result["ownership_percentage"] is None
        assert "known_data" not in result["research_sources"]
        assert "sec_edgar" in result["research_sources"]
        assert "wikidata" in result["research_sources"]
        assert "wikipedia" in result["research_sources"]


@pytest.mark.asyncio
async def test_wbd_sec_data_mocked(researcher):
    """WBD identity via SEC: mocked CIK, EIN, tickers, and revenue."""
    cik_resp = _make_httpx_response(
        200,
        {"0": {"cik_str": 1437107, "ticker": "WBD", "title": "Warner Bros. Discovery, Inc."}},
    )
    sec_data = {
        "name": "Warner Bros. Discovery, Inc.",
        "ein": 352333914,
        "sicDescription": "Cable & Other Pay Television Services",
        "tickers": ["WBD"],
        "exchanges": ["Nasdaq"],
    }
    facts_data = {
        "facts": {
            "us-gaap": {
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {
                        "USD": [
                            {
                                "val": 41321000000,
                                "end": "2024-12-31",
                                "fy": 2025,
                                "form": "10-K",
                                "filed": "2026-02-27",
                            },
                            {
                                "val": 37296000000,
                                "end": "2025-12-31",
                                "fy": 2025,
                                "form": "10-K",
                                "filed": "2026-02-27",
                            },
                        ]
                    }
                }
            }
        }
    }
    researcher.http_client.get = AsyncMock(
        side_effect=[
            cik_resp,
            _make_httpx_response(200, sec_data),
            _make_httpx_response(200, facts_data),
        ]
    )
    result = await researcher._search_sec_edgar("Warner Bros. Discovery")
    assert result["cik"] == "0001437107"
    assert result["ein"] == 352333914
    assert result["tickers"] == ["WBD"]
    assert result["revenue"] == "37296000000"  # FY2025, deduplicated
    assert "sec_edgar" in result.get("source", "")


@pytest.mark.asyncio
async def test_wbd_research_organization_full_flow(researcher):
    """Full mocked research_organization flow for WBD regression.
    Verify: parent_org null, org_type public company, cik set,
    pending acquisition in recent_ownership_changes, advertisers empty."""

    wikipedia_result = {
        "source": "wikipedia",
        "title": "Warner Bros. Discovery",
        "page_title": "Warner Bros. Discovery",
        "description": "Warner Bros. Discovery is an American media conglomerate.",
        "url": "https://en.wikipedia.org/wiki/Warner_Bros._Discovery",
        "recent_ownership_changes": (
            "It agreed to be sold to Paramount Skydance in 2026, subject to regulatory approval."
        ),
        "ownership": {"parent": None},
        "confidence": "high",
    }
    wikidata_result = {
        "source": "wikidata",
        "qid": "Q107374193",
        "wikidata_url": "https://www.wikidata.org/wiki/Q107374193",
        "owned_by": [],
        "parent_orgs": [],
        "part_of": [],
        "headquarters": [],
        "subsidiaries": [],
        "inception": "2022-04-08",
        "confidence": "medium",
    }
    sec_result = {
        "source": "sec_edgar",
        "cik": "0001437107",
        "ein": 352333914,
        "tickers": ["WBD"],
        "exchanges": ["Nasdaq"],
        "revenue": "37296000000",
        "confidence": "high",
    }

    researcher._search_wikipedia = AsyncMock(return_value=wikipedia_result)
    researcher._search_propublica_nonprofit = AsyncMock(return_value={})
    researcher._get_known_org_data = AsyncMock(return_value=KNOWN_ORGS["warner bros. discovery"])
    researcher._search_sec_edgar = AsyncMock(return_value=sec_result)
    researcher._resolve_org_wikidata_sparql = AsyncMock(return_value={})
    researcher._fetch_wikidata = AsyncMock(return_value=wikidata_result)

    result = await researcher.research_organization("Warner Bros. Discovery", use_ai=False)

    # Core assertions
    assert result["parent_org"] is None
    assert result["org_type"] == "public company"  # from KNOWN_ORGS
    assert result["cik"] == "0001437107"
    assert result["ein"] == "352333914"
    assert result["annual_revenue"] == "37296000000"
    # Pending acquisition in recent_ownership_changes, NOT parent_org
    assert result["recent_ownership_changes"] is not None
    assert "Paramount" not in (result["parent_org"] or "")
    # Fields that must remain empty without source grounding
    assert result["major_advertisers"] == []
    assert result["funding_sources"] == []
    assert result["ownership_percentage"] is None
    # Research sources tracked
    assert "known_data" in result["research_sources"]
    assert "sec_edgar" in result["research_sources"]
    assert "wikipedia" in result["research_sources"]
    assert "wikidata" in result["research_sources"]
    # Verify methods were called
    researcher._search_wikipedia.assert_awaited_once_with("Warner Bros. Discovery")
    researcher._search_sec_edgar.assert_awaited_once_with("Warner Bros. Discovery")
