"""Tiered confidence scoring for reporter identity."""

from __future__ import annotations

from typing import Any
from urllib.parse import unquote, urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import ArticleAuthor, Reporter, ReporterClaim, IdentityEdge
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


def _normalized_identity_label(value: str | None) -> str:
    normalized = " ".join(str(value or "").strip().split()).casefold()
    if normalized.startswith("the "):
        normalized = normalized[4:]
    return normalized


def _source_names_from_career_history(reporter: Reporter) -> list[str]:
    """Return organization labels attached to a local reporter profile."""
    source_names: list[str] = []
    seen: set[str] = set()
    entries = reporter.career_history or []
    if not isinstance(entries, list):
        return source_names

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        organization = str(entry.get("organization") or "").strip()
        normalized = _normalized_identity_label(organization)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        source_names.append(organization)
    return source_names


def _is_source_label_byline(value: str | None, source_name: str | None) -> bool:
    author_label = _normalized_identity_label(value)
    source_label = _normalized_identity_label(source_name)
    return bool(author_label and source_label and author_label == source_label)


def _has_clean_local_byline_identity(reporter: Reporter) -> bool:
    """Return False when a local-byline row still exposes source/raw byline residue."""
    if reporter.match_status != "local_byline":
        return True

    raw_values = [
        value
        for value in (str(reporter.name or ""), str(reporter.canonical_name or ""))
        if value.strip()
    ]
    for raw_value in raw_values:
        cleaned = clean_author_name(raw_value)
        if not cleaned:
            return False
        if _normalized_identity_label(raw_value) != _normalized_identity_label(cleaned):
            return False
        if _looks_like_combined_byline_name(raw_value):
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
    if "," not in cleaned:
        return False
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
    for marker in ("http://", "https://"):
        marker_index = path.find(marker)
        if marker_index >= 0:
            return path[marker_index:]
    return None


def is_public_author_url(value: str | None) -> bool:
    """Return True when a URL is suitable as public author-page evidence."""
    if not value:
        return False
    parsed = urlparse(value)
    host = _normalized_host(parsed.netloc)
    if parsed.scheme not in {"http", "https"} or not host:
        return False
    if host in _INVALID_AUTHOR_HOSTS:
        return False
    return not any(host.endswith(suffix) for suffix in _INVALID_AUTHOR_HOST_SUFFIXES)


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
    if host in _NON_AUTHOR_IDENTITY_HOSTS or host.endswith(".wikipedia.org"):
        return False

    path = (parsed.path or "").strip("/").lower()
    if not path:
        return False
    if path.endswith((".xml", ".rss", ".atom", ".json")) or "rss" in path.split("/"):
        return False

    segments = [segment for segment in path.split("/") if segment]
    return any(
        segment in _AUTHOR_PROFILE_PATH_HINTS
        or segment.startswith(("author-", "reporter-"))
        or segment.endswith("reporter")
        for segment in segments
    )


def has_verified_author_page_citation(reporter: Reporter) -> bool:
    """Return True when a citation supports a real author/profile page."""
    author_page_url = str(reporter.author_page_url or "")
    canonical_author_url = str(reporter.canonical_author_url or "")
    if not (is_author_profile_url(author_page_url) or is_author_profile_url(canonical_author_url)):
        return False

    citations = reporter.citations if isinstance(reporter.citations, list) else []
    citation_urls = {author_page_url, canonical_author_url} - {""}
    for citation in citations:
        if not isinstance(citation, dict):
            continue
        citation_url = str(citation.get("url") or "")
        if citation_url not in citation_urls:
            continue
        label = str(citation.get("label") or "")
        source_type = str(citation.get("source_type") or "")
        if (
            label in _VERIFIED_AUTHOR_PAGE_LABELS
            or source_type in _VERIFIED_AUTHOR_PAGE_SOURCE_TYPES
        ):
            return True
    return False


def has_person_like_reporter_name(reporter: Reporter) -> bool:
    """Return True when the reporter row exposes a usable person-like name."""
    if not _has_clean_local_byline_identity(reporter):
        return False
    canonical = str(reporter.canonical_name or "")
    raw_name = str(reporter.name or "")
    return bool(
        clean_author_name(canonical) and not _looks_like_combined_byline_name(canonical)
    ) or bool(clean_author_name(raw_name) and not _looks_like_combined_byline_name(raw_name))


def has_journalism_profile_evidence(reporter: Reporter) -> bool:
    """Return True when profile evidence links the person to journalism."""
    parts = [
        str(reporter.name or ""),
        str(reporter.canonical_name or ""),
        str(reporter.overview or ""),
        str(reporter.match_explanation or ""),
    ]
    for collection in (reporter.career_history, reporter.dossier_sections, reporter.citations):
        if isinstance(collection, list):
            parts.append(str(collection))
    haystack = " ".join(parts).lower()
    return any(term in haystack for term in JOURNALISM_EVIDENCE_TERMS)


def has_supporting_byline_evidence(reporter: Reporter) -> bool:
    """Return True when citations support byline presence but not profile identity."""
    citations = reporter.citations if isinstance(reporter.citations, list) else []
    return any(
        isinstance(citation, dict)
        and (
            str(citation.get("label") or "") in _SUPPORTING_BYLINE_LABELS
            or str(citation.get("source_type") or "") in {"rss_feed_author", "byline_frequency"}
        )
        for citation in citations
    )


CONFIDENCE_VERIFIED = "verified"
CONFIDENCE_STRONG = "strong"
CONFIDENCE_LIKELY = "likely"
CONFIDENCE_UNMATCHED = "unmatched"


async def compute_confidence_tier(
    session: AsyncSession,
    reporter: Reporter,
) -> tuple[str, float, dict[str, Any]]:
    """Compute confidence tier and numeric score for a reporter.

    Returns (tier_name, score_0_to_1, evidence_summary).

    Scoring logic:
    - Has Wikidata QID + journalist occupation match -> tier=strong, base score=0.85
    - Has canonical_author_url + author_page_url -> tier=verified, score=0.95 (publisher-confirmed)
    - Has canonical_author_url only (found in article JSON-LD) -> tier=strong, score=0.80
    - Has wikidata identity_edge records -> tier=strong, score=0.75
    - Has sameAs identity_edge records -> tier=likely, score=0.60
    - claims_count >= 3 from >= 2 source_types -> tier=strong, score=0.75
    - claims_count >= 1 -> tier=likely, score=0.50
    - Has persisted ArticleAuthor observations -> tier=likely, score scales by count
    - No claims, no wikidata -> tier=unmatched, score=0.10
    """
    reporter_id = reporter.id
    score = 0.10
    tier = CONFIDENCE_UNMATCHED
    evidence: dict[str, Any] = {}

    has_person_name = has_person_like_reporter_name(reporter)
    has_canonical = has_person_name and is_author_profile_url(reporter.canonical_author_url)
    has_author_page = has_person_name and is_author_profile_url(reporter.author_page_url)
    has_author_page_evidence = has_person_name and has_verified_author_page_citation(reporter)
    has_byline_evidence = has_person_name and has_supporting_byline_evidence(reporter)
    has_journalism_evidence = has_journalism_profile_evidence(reporter)
    has_wikidata = has_person_name and has_journalism_evidence and bool(reporter.wikidata_qid)

    edges_stmt = select(IdentityEdge).where(IdentityEdge.reporter_id == reporter_id)
    edges_result = await session.execute(edges_stmt)
    edges = list(edges_result.scalars().all())

    claims_stmt = (
        select(ReporterClaim)
        .where(
            ReporterClaim.reporter_id == reporter_id,
            ReporterClaim.is_current.is_(True),
        )
        .order_by(ReporterClaim.created_at.desc())
    )
    claims_result = await session.execute(claims_stmt)
    claims = list(claims_result.scalars().all())
    claims_count = len(claims)

    article_author_stmt = select(ArticleAuthor).where(ArticleAuthor.reporter_id == reporter_id)
    article_author_result = await session.execute(article_author_stmt)
    article_observations = list(article_author_result.scalars().all())
    article_observation_count = len(article_observations)

    source_types = set(c.source_type for c in claims if c.source_type)
    source_type_count = len(source_types)

    edge_types = set(e.edge_type for e in edges)
    has_sameas_edge = "sameAs" in edge_types
    has_wikidata_edge = "wikidata" in edge_types
    has_identity_edges_3plus = len(edge_types) >= 3 or len(edges) >= 3

    if not has_person_name:
        evidence["score"] = score
        evidence["tier"] = tier
        evidence["person_like_name"] = False
        evidence["journalism_profile_evidence"] = has_journalism_evidence
        evidence["claims_count"] = claims_count
        evidence["article_observation_count"] = article_observation_count
        evidence["source_type_count"] = source_type_count
        evidence["edge_count"] = len(edges)
        evidence["non_person_name_filtered"] = True
        return tier, score, evidence

    # Tier logic
    if has_canonical and has_author_page_evidence:
        tier = CONFIDENCE_VERIFIED
        score = 0.95
        evidence["publisher_confirmed"] = True
    elif has_wikidata and has_identity_edges_3plus and claims_count >= 1:
        tier = CONFIDENCE_STRONG
        score = 0.88
        evidence["wikidata_matched"] = True
        evidence["multi_source_identity"] = len(edge_types)
        evidence["has_claims"] = claims_count
    elif has_identity_edges_3plus and claims_count >= 3:
        tier = CONFIDENCE_STRONG
        score = 0.85
        evidence["multi_source_identity"] = len(edge_types)
        evidence["has_claims"] = claims_count
    elif has_wikidata and claims_count >= 1:
        tier = CONFIDENCE_STRONG
        score = 0.80
        evidence["wikidata_matched"] = True
        evidence["has_claims"] = claims_count
    elif has_wikidata:
        tier = CONFIDENCE_STRONG
        score = 0.78
        evidence["wikidata_matched"] = True
        evidence["entity_resolved"] = True
    elif has_canonical:
        tier = CONFIDENCE_STRONG
        score = 0.80
        evidence["canonical_url_found"] = True
    elif has_byline_evidence and article_observation_count >= 5:
        tier = CONFIDENCE_STRONG
        score = 0.70
        evidence["article_observations"] = article_observation_count
        evidence["publisher_byline_evidence"] = True
    elif article_observation_count >= 5 and claims_count >= 1:
        tier = CONFIDENCE_STRONG
        score = 0.70
        evidence["article_observations"] = article_observation_count
        evidence["has_claims"] = claims_count
        evidence["multi_article_evidence"] = True
    elif claims_count >= 3 and source_type_count >= 2:
        tier = CONFIDENCE_STRONG
        score = 0.75
        evidence["multiple_claims"] = {"count": claims_count, "source_types": source_type_count}
    elif has_sameas_edge or has_wikidata_edge:
        if has_wikidata_edge:
            tier = CONFIDENCE_STRONG
            score = max(score, 0.75)
        else:
            tier = CONFIDENCE_LIKELY
            score = max(score, 0.60)
        evidence["identity_edges"] = list(edge_types)
    elif claims_count >= 1:
        tier = CONFIDENCE_LIKELY
        score = 0.50
        evidence["has_claims"] = claims_count
    elif article_observation_count >= 3:
        tier = CONFIDENCE_LIKELY
        score = 0.60
        evidence["article_observations"] = article_observation_count
        evidence["multi_article_evidence"] = True
    elif article_observation_count >= 2:
        tier = CONFIDENCE_LIKELY
        score = 0.55
        evidence["article_observations"] = article_observation_count
    elif article_observation_count == 1:
        tier = CONFIDENCE_LIKELY
        score = 0.45
        evidence["article_observations"] = article_observation_count
        evidence["single_article_observation"] = True

    # Score boosts
    boosts: list[str] = []
    if source_type_count > 1:
        boost = min(0.05 * (source_type_count - 1), 0.10)
        score += boost
        boosts.append(f"+{boost:.2f} from {source_type_count} source types")
    if has_author_page:
        score += 0.05
        boosts.append("+0.05 from author page URL")
    if reporter.wikipedia_url:
        score += 0.05
        boosts.append("+0.05 from Wikipedia extract")
    if reporter.twitter_handle or reporter.linkedin_url:
        score += 0.03
        boosts.append("+0.03 from social links")

    score = min(score, 1.0)
    score = round(score, 3)

    evidence["score"] = score
    evidence["tier"] = tier
    evidence["person_like_name"] = has_person_name
    evidence["journalism_profile_evidence"] = has_journalism_evidence
    evidence["claims_count"] = claims_count
    evidence["article_observation_count"] = article_observation_count
    evidence["source_type_count"] = source_type_count
    evidence["edge_count"] = len(edges)
    if boosts:
        evidence["boosts"] = boosts

    return tier, score, evidence


def tier_rank(tier: str) -> int:
    """Return numeric rank for sorting: verified=4, strong=3, likely=2, unmatched=1."""
    ranks = {"verified": 4, "strong": 3, "likely": 2, "unmatched": 1}
    return ranks.get(tier, 0)


async def update_reporter_confidence(
    session: AsyncSession,
    reporter_id: int,
) -> str:
    """Recompute and persist confidence tier for a reporter. Returns the tier."""
    stmt = select(Reporter).where(Reporter.id == reporter_id)
    reporter = (await session.execute(stmt)).scalar_one_or_none()
    if not reporter:
        return CONFIDENCE_UNMATCHED

    tier, score, evidence = await compute_confidence_tier(session, reporter)

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
