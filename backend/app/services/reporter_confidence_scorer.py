"""Tiered confidence scoring for reporter identity."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import unquote, urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import ArticleAuthor, IdentityEdge, Reporter, ReporterClaim
from app.services.reporter_public_records import clean_author_name

_INVALID_AUTHOR_HOST_SUFFIXES = (".example.com", ".invalid", ".local", ".test")
_INVALID_AUTHOR_HOSTS = {"example.com", "localhost", "test.local"}
_AUTHOR_PROFILE_PATH_HINTS = {
    "author",
    "authors",
    "bio",
    "bios",
    "by",
    "byline",
    "columnist",
    "columnists",
    "contributor",
    "contributors",
    "people",
    "person",
    "profile",
    "profiles",
    "reporter",
    "staff",
    "team",
    "toireporter",
}
_NON_AUTHOR_IDENTITY_HOSTS = {
    "wikidata.org",
    "www.wikidata.org",
    "wikipedia.org",
    "www.wikipedia.org",
}
_VERIFIED_AUTHOR_PAGE_LABELS = {"Official author page", "Wayback Machine archive"}
_VERIFIED_AUTHOR_PAGE_SOURCE_TYPES = {"official_author_page", "archived_author_page"}
_SUPPORTING_BYLINE_LABELS = {
    "Consistent byline attribution",
    "RSS dc:creator attribution",
}
JOURNALISM_EVIDENCE_TERMS = (
    "anchor",
    "broadcaster",
    "columnist",
    "correspondent",
    "editor",
    "editor-in-chief",
    "journalism",
    "journalist",
    "news",
    "photojournalist",
    "presenter",
    "publisher",
    "reporter",
    "writer",
)

CONFIDENCE_VERIFIED = "verified"
CONFIDENCE_STRONG = "strong"
CONFIDENCE_LIKELY = "likely"
CONFIDENCE_UNMATCHED = "unmatched"


@dataclass(slots=True)
class _ConfidenceContext:
    reporter: Reporter
    edges: list[IdentityEdge]
    claims: list[ReporterClaim]
    article_observation_count: int
    has_person_name: bool
    has_canonical: bool
    has_author_page: bool
    has_author_page_evidence: bool
    has_byline_evidence: bool
    has_journalism_evidence: bool
    has_wikidata: bool
    source_types: set[str] = field(default_factory=set)
    edge_types: set[str] = field(default_factory=set)

    @property
    def claims_count(self) -> int:
        return len(self.claims)

    @property
    def source_type_count(self) -> int:
        return len(self.source_types)

    @property
    def has_identity_edges_3plus(self) -> bool:
        return len(self.edge_types) >= 3 or len(self.edges) >= 3


@dataclass(slots=True)
class _ConfidenceDecision:
    tier: str
    score: float
    evidence: dict[str, Any] = field(default_factory=dict)


def _normalized_identity_label(value: str | None) -> str:
    normalized = " ".join(str(value or "").strip().split()).casefold()
    return normalized[4:] if normalized.startswith("the ") else normalized


def _source_names_from_career_history(reporter: Reporter) -> list[str]:
    """Return organization labels attached to a local reporter profile."""
    entries = reporter.career_history if isinstance(reporter.career_history, list) else []
    names: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        organization = str(entry.get("organization") or "").strip()
        normalized = _normalized_identity_label(organization)
        if normalized:
            names.setdefault(normalized, organization)
    return list(names.values())


def _is_source_label_byline(value: str | None, source_name: str | None) -> bool:
    author_label = _normalized_identity_label(value)
    source_label = _normalized_identity_label(source_name)
    return bool(author_label and source_label and author_label == source_label)


def _identity_value_is_clean(value: str) -> bool:
    cleaned = clean_author_name(value)
    if not cleaned:
        return False
    normalized_matches = _normalized_identity_label(value) == _normalized_identity_label(cleaned)
    return normalized_matches and not _looks_like_combined_byline_name(value)


def _has_clean_local_byline_identity(reporter: Reporter) -> bool:
    """Return False when a local-byline row still exposes source/raw byline residue."""
    if reporter.match_status != "local_byline":
        return True
    raw_values = [
        value
        for value in (str(reporter.name or ""), str(reporter.canonical_name or ""))
        if value.strip()
    ]
    if not all(_identity_value_is_clean(value) for value in raw_values):
        return False
    source_names = _source_names_from_career_history(reporter)
    return not any(
        _is_source_label_byline(raw_value, source_name)
        for raw_value in raw_values
        for source_name in source_names
    )


def _looks_like_combined_byline_name(value: str | None) -> bool:
    cleaned = clean_author_name(str(value or ""))
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if any(separator in lowered for separator in (" and ", " with ", " & ", " y ")):
        return True
    parts = [part.strip() for part in cleaned.split(",") if part.strip()]
    if len(parts) < 2:
        return False
    suffixes = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "ph.d."}
    return parts[1].lower() not in suffixes


def _normalized_host(value: str) -> str:
    return value.lower().removeprefix("www.")


def _wayback_original_url(value: str) -> str | None:
    parsed = urlparse(value)
    if _normalized_host(parsed.netloc) != "web.archive.org":
        return None
    path = unquote(parsed.path or "")
    marker_positions = [
        position for marker in ("http://", "https://") if (position := path.find(marker)) >= 0
    ]
    return path[min(marker_positions) :] if marker_positions else None


def is_public_author_url(value: str | None) -> bool:
    """Return True when a URL is suitable as public author-page evidence."""
    if not value:
        return False
    parsed = urlparse(value)
    host = _normalized_host(parsed.netloc)
    valid_origin = parsed.scheme in {"http", "https"} and bool(host)
    blocked_host = host in _INVALID_AUTHOR_HOSTS or any(
        host.endswith(suffix) for suffix in _INVALID_AUTHOR_HOST_SUFFIXES
    )
    return valid_origin and not blocked_host


def _is_non_author_identity_host(host: str) -> bool:
    return host in _NON_AUTHOR_IDENTITY_HOSTS or host.endswith(".wikipedia.org")


def _is_feed_path(path: str) -> bool:
    return path.endswith((".xml", ".rss", ".atom", ".json")) or "rss" in path.split("/")


def _profile_path_segment(segment: str) -> bool:
    return (
        segment in _AUTHOR_PROFILE_PATH_HINTS
        or segment.startswith(("author-", "reporter-"))
        or segment.endswith("reporter")
    )


def is_author_profile_url(value: str | None) -> bool:
    """Return True only for URLs that look like person-level publisher profiles."""
    if not is_public_author_url(value):
        return False
    assert value is not None
    original = _wayback_original_url(value)
    if original:
        return is_author_profile_url(original)

    parsed = urlparse(value)
    host = _normalized_host(parsed.netloc)
    path = (parsed.path or "").strip("/").lower()
    if _is_non_author_identity_host(host) or not path or _is_feed_path(path):
        return False
    return any(_profile_path_segment(segment) for segment in path.split("/") if segment)


def _citation_verifies_url(citation: object, valid_urls: set[str]) -> bool:
    if not isinstance(citation, dict):
        return False
    if str(citation.get("url") or "") not in valid_urls:
        return False
    label = str(citation.get("label") or "")
    source_type = str(citation.get("source_type") or "")
    return (
        label in _VERIFIED_AUTHOR_PAGE_LABELS or source_type in _VERIFIED_AUTHOR_PAGE_SOURCE_TYPES
    )


def has_verified_author_page_citation(reporter: Reporter) -> bool:
    """Return True when a citation supports a real author/profile page."""
    valid_urls = {
        url
        for url in (str(reporter.author_page_url or ""), str(reporter.canonical_author_url or ""))
        if is_author_profile_url(url)
    }
    citations = reporter.citations if isinstance(reporter.citations, list) else []
    return bool(valid_urls) and any(
        _citation_verifies_url(citation, valid_urls) for citation in citations
    )


def has_person_like_reporter_name(reporter: Reporter) -> bool:
    """Return True when the reporter row exposes a usable person-like name."""
    if not _has_clean_local_byline_identity(reporter):
        return False
    names = (str(reporter.canonical_name or ""), str(reporter.name or ""))
    return any(
        clean_author_name(name) and not _looks_like_combined_byline_name(name) for name in names
    )


def has_journalism_profile_evidence(reporter: Reporter) -> bool:
    """Return True when profile evidence links the person to journalism."""
    parts = [
        str(reporter.name or ""),
        str(reporter.canonical_name or ""),
        str(reporter.overview or ""),
        str(reporter.match_explanation or ""),
    ]
    collections = (reporter.career_history, reporter.dossier_sections, reporter.citations)
    parts.extend(str(collection) for collection in collections if isinstance(collection, list))
    haystack = " ".join(parts).lower()
    return any(term in haystack for term in JOURNALISM_EVIDENCE_TERMS)


def has_supporting_byline_evidence(reporter: Reporter) -> bool:
    """Return True when citations support byline presence but not profile identity."""
    citations = reporter.citations if isinstance(reporter.citations, list) else []
    labels = _SUPPORTING_BYLINE_LABELS
    source_types = {"rss_feed_author", "byline_frequency"}
    return any(
        isinstance(citation, dict)
        and (
            str(citation.get("label") or "") in labels
            or str(citation.get("source_type") or "") in source_types
        )
        for citation in citations
    )


def _identity_flags(reporter: Reporter) -> dict[str, bool]:
    """Compute the person-identity boolean flags for a reporter."""
    has_person_name = has_person_like_reporter_name(reporter)
    has_journalism_evidence = has_journalism_profile_evidence(reporter)
    return {
        "has_person_name": has_person_name,
        "has_canonical": has_person_name and is_author_profile_url(reporter.canonical_author_url),
        "has_author_page": has_person_name and is_author_profile_url(reporter.author_page_url),
        "has_author_page_evidence": has_person_name and has_verified_author_page_citation(reporter),
        "has_byline_evidence": has_person_name and has_supporting_byline_evidence(reporter),
        "has_journalism_evidence": has_journalism_evidence,
        "has_wikidata": has_person_name and has_journalism_evidence and bool(reporter.wikidata_qid),
    }


async def _load_confidence_context(session: AsyncSession, reporter: Reporter) -> _ConfidenceContext:
    edges_result = await session.execute(
        select(IdentityEdge).where(IdentityEdge.reporter_id == reporter.id)
    )
    edges = list(edges_result.scalars().all())
    claims_result = await session.execute(
        select(ReporterClaim)
        .where(ReporterClaim.reporter_id == reporter.id, ReporterClaim.is_current.is_(True))
        .order_by(ReporterClaim.created_at.desc())
    )
    claims = list(claims_result.scalars().all())
    article_result = await session.execute(
        select(ArticleAuthor).where(ArticleAuthor.reporter_id == reporter.id)
    )
    article_observation_count = len(list(article_result.scalars().all()))

    flags = _identity_flags(reporter)
    return _ConfidenceContext(
        reporter=reporter,
        edges=edges,
        claims=claims,
        article_observation_count=article_observation_count,
        has_person_name=flags["has_person_name"],
        has_canonical=flags["has_canonical"],
        has_author_page=flags["has_author_page"],
        has_author_page_evidence=flags["has_author_page_evidence"],
        has_byline_evidence=flags["has_byline_evidence"],
        has_journalism_evidence=flags["has_journalism_evidence"],
        has_wikidata=flags["has_wikidata"],
        source_types={str(claim.source_type) for claim in claims if claim.source_type},
        edge_types={str(edge.edge_type) for edge in edges if edge.edge_type},
    )


def _publisher_confirmed(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.has_canonical and context.has_author_page_evidence:
        return _ConfidenceDecision(CONFIDENCE_VERIFIED, 0.95, {"publisher_confirmed": True})
    return None


def _wikidata_multisource(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.has_wikidata and context.has_identity_edges_3plus and context.claims_count >= 1:
        return _ConfidenceDecision(
            CONFIDENCE_STRONG,
            0.88,
            {
                "wikidata_matched": True,
                "multi_source_identity": len(context.edge_types),
                "has_claims": context.claims_count,
            },
        )
    return None


def _multisource_claims(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.has_identity_edges_3plus and context.claims_count >= 3:
        return _ConfidenceDecision(
            CONFIDENCE_STRONG,
            0.85,
            {"multi_source_identity": len(context.edge_types), "has_claims": context.claims_count},
        )
    return None


def _wikidata_with_claims(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.has_wikidata and context.claims_count >= 1:
        return _ConfidenceDecision(
            CONFIDENCE_STRONG,
            0.80,
            {"wikidata_matched": True, "has_claims": context.claims_count},
        )
    return None


def _wikidata_only(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.has_wikidata:
        return _ConfidenceDecision(
            CONFIDENCE_STRONG,
            0.78,
            {"wikidata_matched": True, "entity_resolved": True},
        )
    return None


def _canonical_profile(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.has_canonical:
        return _ConfidenceDecision(CONFIDENCE_STRONG, 0.80, {"canonical_url_found": True})
    return None


def _publisher_byline(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.has_byline_evidence and context.article_observation_count >= 5:
        return _ConfidenceDecision(
            CONFIDENCE_STRONG,
            0.70,
            {
                "article_observations": context.article_observation_count,
                "publisher_byline_evidence": True,
            },
        )
    return None


def _multi_article_claim(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.article_observation_count >= 5 and context.claims_count >= 1:
        return _ConfidenceDecision(
            CONFIDENCE_STRONG,
            0.70,
            {
                "article_observations": context.article_observation_count,
                "has_claims": context.claims_count,
                "multi_article_evidence": True,
            },
        )
    return None


def _diverse_claims(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.claims_count >= 3 and context.source_type_count >= 2:
        return _ConfidenceDecision(
            CONFIDENCE_STRONG,
            0.75,
            {
                "multiple_claims": {
                    "count": context.claims_count,
                    "source_types": context.source_type_count,
                }
            },
        )
    return None


def _identity_edge(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    has_wikidata_edge = "wikidata" in context.edge_types
    has_sameas_edge = "sameAs" in context.edge_types
    if not (has_wikidata_edge or has_sameas_edge):
        return None
    tier = CONFIDENCE_STRONG if has_wikidata_edge else CONFIDENCE_LIKELY
    score = 0.75 if has_wikidata_edge else 0.60
    return _ConfidenceDecision(tier, score, {"identity_edges": list(context.edge_types)})


def _claim_only(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    if context.claims_count >= 1:
        return _ConfidenceDecision(CONFIDENCE_LIKELY, 0.50, {"has_claims": context.claims_count})
    return None


def _article_observations(context: _ConfidenceContext) -> _ConfidenceDecision | None:
    count = context.article_observation_count
    if count >= 3:
        return _ConfidenceDecision(
            CONFIDENCE_LIKELY,
            0.60,
            {"article_observations": count, "multi_article_evidence": True},
        )
    if count == 2:
        return _ConfidenceDecision(CONFIDENCE_LIKELY, 0.55, {"article_observations": count})
    if count == 1:
        return _ConfidenceDecision(
            CONFIDENCE_LIKELY,
            0.45,
            {"article_observations": count, "single_article_observation": True},
        )
    return None


_DECISION_RULES: tuple[Callable[[_ConfidenceContext], _ConfidenceDecision | None], ...] = (
    _publisher_confirmed,
    _wikidata_multisource,
    _multisource_claims,
    _wikidata_with_claims,
    _wikidata_only,
    _canonical_profile,
    _publisher_byline,
    _multi_article_claim,
    _diverse_claims,
    _identity_edge,
    _claim_only,
    _article_observations,
)


def _choose_decision(context: _ConfidenceContext) -> _ConfidenceDecision:
    for rule in _DECISION_RULES:
        decision = rule(context)
        if decision is not None:
            return decision
    return _ConfidenceDecision(CONFIDENCE_UNMATCHED, 0.10)


def _score_boosts(context: _ConfidenceContext) -> tuple[float, list[str]]:
    boosts: list[str] = []
    total = 0.0
    if context.source_type_count > 1:
        amount = min(0.05 * (context.source_type_count - 1), 0.10)
        total += amount
        boosts.append(f"+{amount:.2f} from {context.source_type_count} source types")
    if context.has_author_page:
        total += 0.05
        boosts.append("+0.05 from author page URL")
    if context.reporter.wikipedia_url:
        total += 0.05
        boosts.append("+0.05 from Wikipedia extract")
    if context.reporter.twitter_handle or context.reporter.linkedin_url:
        total += 0.03
        boosts.append("+0.03 from social links")
    return total, boosts


def _base_evidence(context: _ConfidenceContext, score: float, tier: str) -> dict[str, Any]:
    return {
        "score": score,
        "tier": tier,
        "person_like_name": context.has_person_name,
        "journalism_profile_evidence": context.has_journalism_evidence,
        "claims_count": context.claims_count,
        "article_observation_count": context.article_observation_count,
        "source_type_count": context.source_type_count,
        "edge_count": len(context.edges),
    }


def _non_person_result(context: _ConfidenceContext) -> tuple[str, float, dict[str, Any]]:
    evidence = _base_evidence(context, 0.10, CONFIDENCE_UNMATCHED)
    evidence["non_person_name_filtered"] = True
    return CONFIDENCE_UNMATCHED, 0.10, evidence


async def compute_confidence_tier(
    session: AsyncSession,
    reporter: Reporter,
) -> tuple[str, float, dict[str, Any]]:
    """Compute confidence from an ordered set of explicit evidence rules."""
    context = await _load_confidence_context(session, reporter)
    if not context.has_person_name:
        return _non_person_result(context)

    decision = _choose_decision(context)
    boost_total, boosts = _score_boosts(context)
    score = round(min(decision.score + boost_total, 1.0), 3)
    evidence = _base_evidence(context, score, decision.tier)
    evidence.update(decision.evidence)
    if boosts:
        evidence["boosts"] = boosts
    return decision.tier, score, evidence


def tier_rank(tier: str) -> int:
    """Return numeric rank for sorting: verified=4, strong=3, likely=2, unmatched=1."""
    ranks = {"verified": 4, "strong": 3, "likely": 2, "unmatched": 1}
    return ranks.get(tier, 0)


async def update_reporter_confidence(
    session: AsyncSession,
    reporter_id: int,
) -> str:
    """Recompute and persist confidence tier for a reporter. Returns the tier."""
    reporter = (
        await session.execute(select(Reporter).where(Reporter.id == reporter_id))
    ).scalar_one_or_none()
    if not reporter:
        return CONFIDENCE_UNMATCHED

    tier, score, _evidence = await compute_confidence_tier(session, reporter)
    reporter.confidence_tier = tier
    reporter.confidence_score = score  # type: ignore[assignment]
    await session.commit()
    return tier


def format_confidence_badge(tier: str) -> str:
    """Return human-readable confidence label for display."""
    badges = {
        CONFIDENCE_VERIFIED: "Verified",
        CONFIDENCE_STRONG: "Strong",
        CONFIDENCE_LIKELY: "Likely",
        CONFIDENCE_UNMATCHED: "Unmatched",
    }
    return badges.get(tier, "Unknown")
