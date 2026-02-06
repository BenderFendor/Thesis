"""Tests for FundingResearcher.

Covers: name matching, ProPublica validation, Wikidata dict/list parsing,
merge priority logic, and null guards.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.funding_researcher import FundingResearcher, KNOWN_ORGS


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

    def test_lowercase_and_strip(self):
        r = FundingResearcher.__new__(FundingResearcher)
        assert r._normalize_name("  BBC  ") == "bbc"


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
        assert result["ein"] == "999"

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
        assert "propublica" in result["research_sources"]


# ── User-Agent header ────────────────────────────────────────


class TestHttpClientSetup:
    def test_user_agent_header_set(self):
        with patch(
            "app.services.funding_researcher.get_openai_client", return_value=None
        ):
            r = FundingResearcher()
        assert "User-Agent" in r.http_client.headers
        assert "ScoopNewsApp" in r.http_client.headers["User-Agent"]


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
        assert result["ein"] == "999"  # EIN still captured
