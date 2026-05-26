"""Reporter Indexer - Background indexing service for the reporter wiki.

Handles:
- Proactively resolving reporter profiles from unresolved article authors
- Bulk seeding reporters via Wikidata SPARQL queries
- Tracking reporter index status in wiki_index_status table
- Re-indexing stale reporter entries (older than 7 days)

Can be used as:
- CLI: python -m app.services.reporter_indexer --all
- Background task: launched from wiki_indexer periodic refresh
"""

from __future__ import annotations

import asyncio
import urllib.parse
from contextlib import suppress
from datetime import datetime, timedelta, UTC
from typing import Any, cast

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import SCOOP_WIKIMEDIA_UA
from app.core.logging import get_logger
from app.database import (
    Article,
    ArticleAuthor,
    AsyncSessionLocal,
    Reporter,
    WikiIndexStatus,
    get_utc_now,
)
from app.data.rss_sources import get_rss_sources
from app.services.entity_wiki_service import build_reporter_dossier, build_resolver_key
from app.services.reporter_profile_store import (
    upsert_reporter_profile,
    _derive_political_leaning_from_profile,
)
from app.services.mbfc_integration import compute_weighted_mbfc_bias
from app.services.littlesis_integration import get_littlesis_affiliations_for_reporter
from app.services.reporter_public_records import build_reporter_activity_summary
from app.services.reporter_social_search import find_social_profiles
from app.services.reporter_web_search import search_reporter_web
from app.services.reporter_wikipedia import fetch_journalist_bio
from app.services.reporter_openalex import search_openalex_author, openalex_claims_from_author
from app.services.reporter_wayback import fetch_wayback_snapshots, wayback_claims_from_snapshots
from app.services.reporter_awards import check_award_for_reporter
from app.services.reporter_conferences import check_conference_for_reporter
from app.services.reporter_cms_crawl import discover_cms_authors
from app.services.reporter_claim_store import (
    store_identity_edge,
    bulk_store_claims,
)
from app.services.reporter_confidence_scorer import (
    update_reporter_confidence,
)

logger = get_logger("reporter_indexer")

STALE_THRESHOLD_DAYS = 7
INDEX_DELAY_SECONDS = 0.3
WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"
SPARQL_BATCH_SIZE = 20

WIKIDATA_JOURNALIST_SPARQL = """
SELECT DISTINCT ?journalist ?journalistLabel ?employerLabel ?twitter ?beatLabel WHERE {
  VALUES ?employerLabel { %s }
  ?journalist wdt:P106 wd:Q1930187 .
  ?journalist wdt:P108 ?employer .
  ?employer rdfs:label ?employerLabel .
  FILTER(LANG(?employerLabel) = "en")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  OPTIONAL { ?journalist wdt:P2002 ?twitter . }
  OPTIONAL { ?journalist wdt:P101 ?beat .  ?beat rdfs:label ?beatLabel . FILTER(LANG(?beatLabel) = "en") }
}
"""


def _enrich_profile_mbfc(profile: dict[str, Any]) -> None:
    """Attach MBFC outlet-level bias data to a resolved reporter profile.

    Uses weighted average by recency: most recent employer gets highest weight.
    Stores result in political_leaning and leaning_confidence with source="mbfc".
    """
    employers = profile.get("career_history") or []
    if not employers:
        return

    mbfc_bias = compute_weighted_mbfc_bias(employers)
    if not mbfc_bias:
        return

    if not profile.get("political_leaning"):
        profile["political_leaning"] = mbfc_bias["political_leaning"]
    if not profile.get("leaning_confidence") or profile.get("leaning_confidence") == "low":
        profile["leaning_confidence"] = mbfc_bias.get("leaning_confidence", "medium")
    sources = profile.get("leaning_sources") or []
    if isinstance(sources, list) and "mbfc" not in sources:
        sources.append("mbfc")
        profile["leaning_sources"] = sources


def _enrich_profile_littlesis(profile: dict[str, Any]) -> None:
    """Cross-reference a reporter against LittleSis and attach affiliations.

    Uses Wikidata QID as primary bridge, falls back to name + employer fuzzy match.
    """
    name = profile.get("canonical_name") or profile.get("name") or ""
    employer = None
    career_history = profile.get("career_history") or []
    if career_history:
        employer = career_history[0].get("organization")
    wikidata_qid = profile.get("wikidata_qid")

    try:
        ls_result = get_littlesis_affiliations_for_reporter(
            reporter_name=name,
            employer_name=employer,
            wikidata_qid=wikidata_qid,
        )
    except Exception as exc:
        logger.debug("LittleSis lookup failed for %s: %s", name, exc)
        return

    if ls_result.get("littlesis_url"):
        profile["littlesis_url"] = ls_result["littlesis_url"]

    affiliations = ls_result.get("institutional_affiliations") or []
    if affiliations:
        existing = profile.get("institutional_affiliations") or []
        if isinstance(existing, list):
            existing_source_urls = {
                a.get("littlesis_url")
                for a in existing
                if isinstance(a, dict) and a.get("littlesis_url")
            }
            for aff in affiliations:
                ls_url = aff.get("littlesis_url")
                if ls_url and ls_url not in existing_source_urls:
                    existing.append(aff)
            profile["institutional_affiliations"] = existing
        else:
            profile["institutional_affiliations"] = affiliations


def _derive_political_leaning(profile: dict[str, Any]) -> tuple[str | None, str | None, list[str]]:
    """Derive political_leaning and leaning_confidence from Wikidata political data."""
    return _derive_political_leaning_from_profile(profile)


async def _run_enrichment_connectors(
    client: httpx.AsyncClient,
    reporter_name: str,
    source_name: str | None,
    domain: str | None = None,
) -> list[dict[str, Any]]:
    """Run all enrichment connectors and return combined claim dicts."""
    all_claims: list[dict[str, Any]] = []

    try:
        award_claims = await check_award_for_reporter(client, reporter_name, source_name)
        all_claims.extend(award_claims or [])
    except Exception:
        pass

    try:
        conf_claims = await check_conference_for_reporter(client, reporter_name, source_name)
        all_claims.extend(conf_claims or [])
    except Exception:
        pass

    if domain:
        try:
            cms_claims = await discover_cms_authors(client, domain, reporter_name)
            all_claims.extend(cms_claims or [])
        except Exception:
            pass

    return all_claims


async def _create_article_author_links(
    session: AsyncSession,
    reporter: Reporter,
    author_name: str,
    source_name: str | None = None,
    confidence: float = 0.8,
) -> None:
    """Create ArticleAuthor junction records linking reporter to their articles."""
    from sqlalchemy import select

    stmt = select(Article.id).where(Article.author == author_name)
    if source_name:
        stmt = stmt.where(Article.source == source_name)

    article_ids = (await session.execute(stmt)).scalars().all()
    created = 0
    for article_id in article_ids:
        existing = await session.execute(
            select(ArticleAuthor).where(
                ArticleAuthor.article_id == article_id,
                ArticleAuthor.reporter_id == reporter.id,
            )
        )
        if existing.scalar_one_or_none():
            continue
        session.add(
            ArticleAuthor(
                article_id=article_id,
                reporter_id=reporter.id,
                author_role="author",
                author_confidence=confidence,  # type: ignore[arg-type]
                observation_source="rss_byline",
                author_url_raw=None,
            )
        )
        created += 1
    if created:
        await session.commit()
        logger.debug("Created %d ArticleAuthor links for %s", created, author_name)


async def _index_reporter_articles(
    session: AsyncSession,
    reporter: Reporter,
    profile: dict[str, Any],
    author_name: str,
    source_name: str | None,
    http_client: httpx.AsyncClient,
) -> None:
    """Store enrichment claims, identity edges, ArticleAuthor links, and persist confidence."""
    reporter_id = cast(int, reporter.id)

    enrichment_claims = await _run_enrichment_connectors(
        http_client,
        author_name,
        source_name,
        domain=None,
    )

    if enrichment_claims:
        await bulk_store_claims(session, reporter_id, enrichment_claims)

    wayback_url = profile.get("author_page_url")
    if wayback_url:
        try:
            snapshots = await fetch_wayback_snapshots(http_client, wayback_url)
            if snapshots:
                wb_claims = wayback_claims_from_snapshots(snapshots, wayback_url)
                if wb_claims:
                    await bulk_store_claims(session, reporter_id, wb_claims)
        except Exception:
            pass

    try:
        oa_authors = await search_openalex_author(http_client, author_name, source_name or None)
        for oa_author in oa_authors:
            oa_claims = openalex_claims_from_author(oa_author, author_name)
            if oa_claims:
                await bulk_store_claims(session, reporter_id, oa_claims)
            oa_id = oa_author.get("id", "")
            if oa_id:
                await store_identity_edge(
                    session,
                    reporter_id,
                    oa_id,
                    "openalex",
                    source_url=oa_id,
                    confidence=0.7,
                )
    except Exception:
        pass

    wikidata_qid = profile.get("wikidata_qid")
    if wikidata_qid:
        await store_identity_edge(
            session,
            reporter_id,
            f"https://www.wikidata.org/wiki/{wikidata_qid}",
            "wikidata",
            source_url=f"https://www.wikidata.org/wiki/{wikidata_qid}",
            confidence=0.9,
        )

    wikipedia_url = profile.get("wikipedia_url")
    if wikipedia_url:
        await store_identity_edge(
            session,
            reporter_id,
            wikipedia_url,
            "sameAs",
            source_url=wikipedia_url,
            confidence=0.85,
        )

    political_leaning, leaning_confidence, leaning_sources = _derive_political_leaning(profile)
    if political_leaning and not reporter.political_leaning:
        reporter.political_leaning = political_leaning
        reporter.leaning_confidence = leaning_confidence
        if leaning_sources:
            existing_sources = reporter.leaning_sources or []
            if isinstance(existing_sources, list):
                for s in leaning_sources:
                    if s not in existing_sources:
                        existing_sources.append(s)
                reporter.leaning_sources = existing_sources

    await _create_article_author_links(session, reporter, author_name, source_name)

    with suppress(Exception):
        await update_reporter_confidence(session, reporter_id)


def _normalize_for_resolver(name: str) -> str:
    return " ".join(name.lower().strip().split())


def _is_fetchable_article_url(url: str) -> bool:
    from urllib.parse import urlparse

    host = urlparse(url).netloc.lower().replace("www.", "")
    return bool(host) and not host.endswith(".example.com") and host != "example.com"


async def _get_session() -> AsyncSession:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available for reporter indexing")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    return factory()


async def _upsert_index_status(
    session: AsyncSession,
    entity_type: str,
    entity_name: str,
    status: str,
    error_message: str | None = None,
    duration_ms: int | None = None,
) -> None:
    result = await session.execute(
        select(WikiIndexStatus).where(
            WikiIndexStatus.entity_type == entity_type,
            WikiIndexStatus.entity_name == entity_name,
        )
    )
    existing = result.scalar_one_or_none()
    now = get_utc_now()

    if existing:
        existing.status = status
        existing.error_message = error_message
        existing.updated_at = now
        if status == "complete":
            existing.last_indexed_at = now
            existing.next_index_at = now + timedelta(days=STALE_THRESHOLD_DAYS)
            existing.index_duration_ms = duration_ms
        elif status == "failed":
            existing.error_message = error_message
            existing.next_index_at = now + timedelta(hours=6)
    else:
        entry = WikiIndexStatus(
            entity_type=entity_type,
            entity_name=entity_name,
            status=status,
            error_message=error_message,
            index_duration_ms=duration_ms,
            last_indexed_at=now if status == "complete" else None,
            next_index_at=(
                now + timedelta(days=STALE_THRESHOLD_DAYS)
                if status == "complete"
                else now + timedelta(hours=6)
            ),
        )
        session.add(entry)

    await session.commit()


async def _get_unresolved_author_names(
    session: AsyncSession,
    limit: int = 500,
    source_name: str | None = None,
) -> list[tuple[str, str | None]]:
    """Find authors in articles that do not yet have a resolved Reporter record.

    When source_name is set, only return authors from that specific source.
    """
    stmt = (
        select(Article.author, Article.source)
        .where(Article.author.isnot(None))
        .where(Article.author != "")
        .distinct()
    )
    if source_name:
        stmt = stmt.where(Article.source == source_name)
    stmt = stmt.limit(limit * 3)

    result = await session.execute(stmt)
    all_authors: list[tuple[str, str | None]] = []
    seen = set()
    for row in result.all():
        author_name = cast(str, row[0]).strip()
        src_name = cast(str | None, row[1])
        normalized = _normalize_for_resolver(author_name)
        if normalized and normalized not in seen:
            seen.add(normalized)
            all_authors.append((author_name, src_name))
            if len(all_authors) >= limit:
                break

    reporter_result = await session.execute(select(Reporter.normalized_name))
    existing_names = {cast(str, r[0]) for r in reporter_result.all()}

    unresolved = [
        (name, source)
        for name, source in all_authors
        if _normalize_for_resolver(name) not in existing_names
    ]
    return unresolved


async def _build_local_byline_profile(
    session: AsyncSession,
    author_name: str,
    source_name: str | None,
) -> dict[str, Any]:
    """Build an evidence-backed local profile when public entity matching is weak."""
    normalized_name = _normalize_for_resolver(author_name)
    resolver_key = build_resolver_key(author_name, source_name)
    stmt = (
        select(Article.title, Article.url, Article.published_at, Article.category)
        .where(Article.author == author_name)
        .order_by(Article.published_at.desc().nullslast())
        .limit(10)
    )
    if source_name:
        stmt = stmt.where(Article.source == source_name)

    rows = (await session.execute(stmt)).all()
    article_items: list[dict[str, Any]] = []
    activity_articles: list[dict[str, Any]] = []
    article_urls: list[str] = []
    latest = None
    categories: list[str] = []
    for title, url, published_at, category in rows:
        if published_at and (latest is None or published_at > latest):
            latest = published_at
        if isinstance(category, str) and category:
            categories.append(category)
        if isinstance(url, str) and url:
            article_urls.append(url)
        activity_articles.append(
            {
                "title": title,
                "url": url,
                "source": source_name,
                "published_at": published_at.isoformat() if published_at else None,
                "category": category,
            }
        )
        article_items.append(
            {
                "label": "Article",
                "value": str(title or url or "Untitled article"),
                "sources": [url] if isinstance(url, str) and url else [],
            }
        )

    source_config = get_rss_sources().get(source_name or "", {}) if source_name else {}
    source_site = source_config.get("site_url") or source_config.get("url")
    activity_summary = await build_reporter_activity_summary(author_name.strip(), activity_articles)
    author_pages = [
        item["url"]
        for item in activity_summary.get("author_pages", [])
        if isinstance(item, dict) and isinstance(item.get("url"), str)
    ]
    external_profiles = [
        item["url"]
        for item in activity_summary.get("external_profiles", [])
        if isinstance(item, dict) and isinstance(item.get("url"), str)
    ]

    wayback_target_url = author_pages[0] if author_pages else None

    web_search_results: list[dict[str, str]] = []
    social_profiles: dict[str, Any] = {"found": False}
    wiki_bio: dict[str, Any] = {"found": False}
    openalex_results: list[dict[str, Any]] = []
    wayback_results: list[dict[str, Any]] = []
    ws_client = httpx.AsyncClient(timeout=15.0)
    try:
        ws_task = search_reporter_web(author_name.strip(), source_name, http_client=ws_client)
        social_task = find_social_profiles(author_name.strip(), source_name, http_client=ws_client)
        wiki_task = fetch_journalist_bio(author_name.strip(), http_client=ws_client)
        oa_task = search_openalex_author(ws_client, author_name.strip(), source_name or None)
        gather_tasks = [ws_task, social_task, wiki_task, oa_task]
        if wayback_target_url:
            gather_tasks.append(fetch_wayback_snapshots(ws_client, wayback_target_url))

        gather_results = await asyncio.gather(*gather_tasks, return_exceptions=True)

        ws_result = gather_results[0] if len(gather_results) > 0 else None
        social_result = gather_results[1] if len(gather_results) > 1 else None
        wiki_result = gather_results[2] if len(gather_results) > 2 else None
        oa_result = gather_results[3] if len(gather_results) > 3 else None
        wb_result = gather_results[4] if len(gather_results) > 4 else None

        if isinstance(ws_result, dict) and ws_result.get("found"):
            web_search_results = ws_result.get("results", [])
        if isinstance(social_result, dict):
            social_profiles = social_result
        if isinstance(wiki_result, dict):
            wiki_bio = wiki_result
        if isinstance(oa_result, list):
            openalex_results = oa_result
        if isinstance(wb_result, list):
            wayback_results = wb_result
    except Exception:
        web_search_results = []
    finally:
        await ws_client.aclose()

    canonical_author_url: str | None = None
    author_page_url: str | None = None
    try:
        author_signal_result = await session.execute(
            select(ArticleAuthor.author_url_raw, ArticleAuthor.observation_source)
            .join(Article, Article.id == ArticleAuthor.article_id)
            .where(Article.author == author_name)
            .where(ArticleAuthor.author_url_raw.isnot(None))
            .where(ArticleAuthor.author_url_raw != "")
            .order_by(ArticleAuthor.id.desc())
            .limit(10)
        )
        author_signals = author_signal_result.all()
        all_raw_urls: list[str] = []
        for url_raw, obs_source in author_signals:
            if url_raw and url_raw not in all_raw_urls:
                all_raw_urls.append(str(url_raw))
                if obs_source in ("jsonld", "sameAs") and not canonical_author_url:
                    canonical_author_url = str(url_raw)
        author_page_url = (
            all_raw_urls[0] if all_raw_urls else (author_pages[0] if author_pages else None)
        )
        if not canonical_author_url:
            canonical_author_url = author_page_url
    except Exception:
        pass

    source_items = []
    if source_name:
        source_items.append(
            {
                "label": "Observed outlet",
                "value": source_name,
                "sources": [source_site] if isinstance(source_site, str) else [],
            }
        )

    social_items: list[dict[str, Any]] = []
    if isinstance(social_profiles, dict):
        mastodon_data = social_profiles.get("mastodon") or {}
        bluesky_data = social_profiles.get("bluesky") or {}
        for acct in mastodon_data.get("accounts") or []:
            social_items.append(
                {
                    "label": "Mastodon",
                    "value": f"{acct.get('display_name', '')} - {acct.get('bio', '')[:100]}",
                    "sources": [acct["url"]] if acct.get("url") else [],
                }
            )
        for acct in bluesky_data.get("accounts") or []:
            social_items.append(
                {
                    "label": "Bluesky",
                    "value": f"{acct.get('display_name', '')} - {acct.get('description', '')[:100]}",
                    "sources": [f"https://bsky.app/profile/{acct['handle']}"]
                    if acct.get("handle")
                    else [],
                }
            )

    openalex_items: list[dict[str, Any]] = []
    for oa_author in openalex_results:
        name_val = oa_author.get("display_name", "")
        inst = oa_author.get("last_known_institution") or ""
        parts = [name_val]
        if inst:
            parts.append(inst)
        openalex_items.append(
            {
                "label": "OpenAlex author",
                "value": f"{' - '.join(parts)} ({oa_author.get('works_count', 0)} works)",
                "sources": [oa_author["id"]] if oa_author.get("id") else [],
            }
        )

    wayback_items: list[dict[str, Any]] = []
    seen_ts = set()
    for snap in wayback_results:
        ts = str(snap.get("timestamp", ""))
        if ts in seen_ts:
            continue
        seen_ts.add(ts)
        wayback_items.append(
            {
                "label": "Wayback snapshot",
                "value": f"Archived {ts[:4]}-{ts[4:6]}-{ts[6:8]} ({snap.get('status_code', '?')})",
                "sources": [snap.get("original_url") or ""] if snap.get("original_url") else [],
            }
        )

    dossier_sections: list[dict[str, Any]] = [
        {
            "id": "identity",
            "title": "Identity",
            "status": "available",
            "items": [
                {
                    "label": "Name",
                    "value": author_name.strip(),
                    "sources": article_urls[:5],
                },
                {
                    "label": "Match",
                    "value": "No unambiguous Wikidata/Wikipedia match was found; this profile is grounded in RSS bylines and local article records.",
                    "sources": article_urls[:5],
                },
            ],
        },
        {
            "id": "source_context",
            "title": "Source Context",
            "status": "available" if source_items else "missing",
            "items": source_items,
        },
        {
            "id": "online_presence",
            "title": "Online Presence",
            "status": "available" if social_items else "missing",
            "items": social_items,
        },
        {
            "id": "article_evidence",
            "title": "Article Evidence",
            "status": "available" if article_items else "missing",
            "items": article_items,
        },
        {
            "id": "official_author_records",
            "title": "Official Author Records",
            "status": "available" if author_pages or external_profiles else "missing",
            "items": [
                {
                    "label": "Author page",
                    "value": url,
                    "sources": [url],
                }
                for url in author_pages
            ]
            + [
                {
                    "label": "External profile",
                    "value": url,
                    "sources": [url],
                }
                for url in external_profiles
            ],
        },
    ]
    if openalex_items:
        dossier_sections.append(
            {
                "id": "openalex",
                "title": "OpenAlex Research Profile",
                "status": "available",
                "items": openalex_items,
            }
        )
    if wayback_items:
        dossier_sections.append(
            {
                "id": "wayback_machine",
                "title": "Wayback Machine Evidence",
                "status": "available",
                "items": wayback_items,
            }
        )

    return {
        "name": author_name.strip(),
        "normalized_name": normalized_name,
        "canonical_name": author_name.strip(),
        "resolver_key": resolver_key,
        "match_status": "local_byline",
        "overview": (
            wiki_bio.get("extract")
            or f"{author_name.strip()} appears as an RSS/local-corpus byline"
            + (f" for {source_name}." if source_name else ".")
        ),
        "bio": None,
        "career_history": (
            [
                {
                    "organization": source_name,
                    "role": "byline outlet",
                    "source": "rss_catalog",
                }
            ]
            if source_name
            else []
        ),
        "topics": sorted(set(categories)),
        "education": [],
        "dossier_sections": dossier_sections,
        "web_search_results": web_search_results,
        "social_profiles": social_profiles,
        "wikipedia_url": wiki_bio.get("url"),
        "wikidata_qid": None,
        "canonical_author_url": canonical_author_url,
        "author_page_url": author_page_url,
        "citations": [{"label": "Local article evidence", "url": url} for url in article_urls[:5]]
        + [{"label": "Official author page", "url": url} for url in author_pages[:5]]
        + [{"label": "Structured external profile", "url": url} for url in external_profiles[:5]],
        "search_links": {
            "wikipedia": f"https://en.wikipedia.org/w/index.php?search={urllib.parse.quote(author_name.strip())}",
            "wikidata": f"https://www.wikidata.org/w/index.php?search={urllib.parse.quote(author_name.strip())}",
            "web_search": f"https://lite.duckduckgo.com/lite/?q={urllib.parse.quote(author_name.strip() + ' ' + (source_name or ''))}",
        },
        "match_explanation": "Stored as a local byline profile because public entity matching was absent or ambiguous.",
        "research_sources": [
            "rss_byline",
            "local_article_corpus",
            "official_article_pages",
            "schema_org_json_ld",
            "rss_catalog",
            "web_search",
            "openalex",
            "wayback",
        ],
        "research_confidence": "medium" if article_items else "low",
        "article_count": len(rows),
        "last_article_at": latest,
    }


async def index_unresolved_reporters(
    limit: int = 500,
    delay_seconds: float = INDEX_DELAY_SECONDS,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Index reporters for all unresolved article authors."""
    session = await _get_session()
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=20.0)
    try:
        unresolved = await _get_unresolved_author_names(session, limit)
        if not unresolved:
            logger.info("No unresolved reporter names found")
            return {"total": 0, "resolved": 0, "failed": 0, "skipped": 0}

        resolved = 0
        failed = 0
        skipped = 0
        total = len(unresolved)

        logger.info("Indexing %d unresolved reporters", total)

        for i, (author_name, source_name) in enumerate(unresolved, 1):
            resolver_key = build_resolver_key(author_name, source_name)
            entity_name = resolver_key or _normalize_for_resolver(author_name)

            try:
                await _upsert_index_status(session, "reporter", entity_name, "indexing")

                profile = await build_reporter_dossier(
                    name=author_name,
                    organization=source_name,
                    http_client=client,
                )

                if profile.get("match_status") == "matched":
                    _enrich_profile_mbfc(profile)
                    _enrich_profile_littlesis(profile)
                    await upsert_reporter_profile(session, profile)
                    reporter = await session.execute(
                        select(Reporter).where(Reporter.resolver_key == profile.get("resolver_key"))
                    )
                    reporter_obj = reporter.scalar_one_or_none()
                    if reporter_obj:
                        await _index_reporter_articles(
                            session,
                            reporter_obj,
                            profile,
                            author_name,
                            source_name,
                            client,
                        )
                    await _upsert_index_status(session, "reporter", entity_name, "complete")
                    resolved += 1
                    logger.debug(
                        "[%d/%d] Resolved: %s -> %s",
                        i,
                        total,
                        author_name,
                        profile.get("canonical_name"),
                    )
                else:
                    local_profile = await _build_local_byline_profile(
                        session, author_name, source_name
                    )
                    await upsert_reporter_profile(session, local_profile)
                    reporter = await session.execute(
                        select(Reporter).where(
                            Reporter.resolver_key == local_profile.get("resolver_key")
                        )
                    )
                    reporter_obj = reporter.scalar_one_or_none()
                    if reporter_obj:
                        await _index_reporter_articles(
                            session,
                            reporter_obj,
                            local_profile,
                            author_name,
                            source_name,
                            client,
                        )
                    await _upsert_index_status(session, "reporter", entity_name, "complete")
                    skipped += 1
                    logger.debug(
                        "[%d/%d] Unresolvable: %s (status=%s)",
                        i,
                        total,
                        author_name,
                        profile.get("match_status"),
                    )

            except Exception as exc:
                await session.rollback()
                logger.error("Failed to index reporter %s: %s", author_name, exc)
                await _upsert_index_status(
                    session,
                    "reporter",
                    entity_name,
                    "failed",
                    error_message=str(exc),
                )
                failed += 1

            if i < total:
                await asyncio.sleep(delay_seconds)

        return {
            "total": total,
            "resolved": resolved,
            "failed": failed,
            "skipped": skipped,
            "completed_at": datetime.now(UTC).isoformat(),
        }
    finally:
        await session.close()
        if owned_client:
            await client.aclose()


async def index_source_reporters(
    source_name: str,
    limit: int = 500,
    delay_seconds: float = INDEX_DELAY_SECONDS,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Index reporters for a single RSS source.

    Finds all unresolved article authors for the given source and runs
    the full enrichment pipeline (Wikidata resolution, MBFC, LittleSis,
    local-byline free enrichment) on each.
    """
    session = await _get_session()
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=20.0)
    try:
        unresolved = await _get_unresolved_author_names(session, limit, source_name)
        if not unresolved:
            logger.info("No unresolved reporter names for source %s", source_name)
            return {"source": source_name, "total": 0, "resolved": 0, "failed": 0, "skipped": 0}

        resolved = 0
        failed = 0
        skipped = 0
        total = len(unresolved)

        logger.info("Indexing %d unresolved reporters for source %s", total, source_name)

        for i, (author_name, _src_name) in enumerate(unresolved, 1):
            resolver_key = build_resolver_key(author_name, source_name)
            entity_name = resolver_key or _normalize_for_resolver(author_name)

            try:
                await _upsert_index_status(session, "reporter", entity_name, "indexing")

                profile = await build_reporter_dossier(
                    name=author_name,
                    organization=source_name,
                    http_client=client,
                )

                if profile.get("match_status") == "matched":
                    _enrich_profile_mbfc(profile)
                    _enrich_profile_littlesis(profile)
                    await upsert_reporter_profile(session, profile)
                    reporter = await session.execute(
                        select(Reporter).where(Reporter.resolver_key == profile.get("resolver_key"))
                    )
                    reporter_obj = reporter.scalar_one_or_none()
                    if reporter_obj:
                        await _index_reporter_articles(
                            session,
                            reporter_obj,
                            profile,
                            author_name,
                            source_name,
                            client,
                        )
                    await _upsert_index_status(session, "reporter", entity_name, "complete")
                    resolved += 1
                    logger.debug(
                        "[%d/%d] Resolved: %s -> %s",
                        i,
                        total,
                        author_name,
                        profile.get("canonical_name"),
                    )
                else:
                    local_profile = await _build_local_byline_profile(
                        session, author_name, source_name
                    )
                    await upsert_reporter_profile(session, local_profile)
                    reporter = await session.execute(
                        select(Reporter).where(
                            Reporter.resolver_key == local_profile.get("resolver_key")
                        )
                    )
                    reporter_obj = reporter.scalar_one_or_none()
                    if reporter_obj:
                        await _index_reporter_articles(
                            session,
                            reporter_obj,
                            local_profile,
                            author_name,
                            source_name,
                            client,
                        )
                    await _upsert_index_status(session, "reporter", entity_name, "complete")
                    skipped += 1
                    logger.debug(
                        "[%d/%d] Unresolvable: %s (status=%s)",
                        i,
                        total,
                        author_name,
                        profile.get("match_status"),
                    )

            except Exception as exc:
                await session.rollback()
                logger.error(
                    "Failed to index reporter %s for %s: %s", author_name, source_name, exc
                )
                await _upsert_index_status(
                    session,
                    "reporter",
                    entity_name,
                    "failed",
                    error_message=str(exc),
                )
                failed += 1

            if i < total:
                await asyncio.sleep(delay_seconds)

        return {
            "source": source_name,
            "total": total,
            "resolved": resolved,
            "failed": failed,
            "skipped": skipped,
            "completed_at": datetime.now(UTC).isoformat(),
        }
    finally:
        await session.close()
        if owned_client:
            await client.aclose()


async def seed_reporters_from_wikidata(
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Bulk-seed reporters from Wikidata using SPARQL.

    Queries Wikidata for journalists whose employer labels match outlets
    in the RSS catalog, then resolves full dossiers for each.
    """
    sources = get_rss_sources()
    unique_sources: dict[str, Any] = {}
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if base_name not in unique_sources:
            unique_sources[base_name] = config

    employer_names = sorted({name for name in unique_sources if len(name) > 2})

    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=30.0)
    try:
        all_journalist_names: list[tuple[str, str]] = []

        for batch_start in range(0, len(employer_names), SPARQL_BATCH_SIZE):
            batch = employer_names[batch_start : batch_start + SPARQL_BATCH_SIZE]
            quoted = " ".join(f'"{employer}"@en' for employer in batch)
            query = WIKIDATA_JOURNALIST_SPARQL % quoted

            logger.info(
                "Querying Wikidata SPARQL batch %d-%d/%d ...",
                batch_start + 1,
                min(batch_start + SPARQL_BATCH_SIZE, len(employer_names)),
                len(employer_names),
            )

            sparql_url = (
                f"{WIKIDATA_SPARQL_URL}?"
                f"{urllib.parse.urlencode({'format': 'json', 'query': query})}"
            )
            response = await client.get(
                sparql_url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": SCOOP_WIKIMEDIA_UA,
                },
            )

            if response.status_code != 200:
                logger.warning(
                    "Wikidata SPARQL batch failed: HTTP %d at batch %d-%d",
                    response.status_code,
                    batch_start + 1,
                    min(batch_start + SPARQL_BATCH_SIZE, len(employer_names)),
                )
                continue

            data = response.json()
            batch_bindings: Any = (data.get("results") or {}).get("bindings") or []

            for binding in batch_bindings:
                name = str(binding.get("journalistLabel", {}).get("value", "")).strip()
                employer = str(binding.get("employerLabel", {}).get("value", "")).strip()
                if name and employer:
                    all_journalist_names.append((name, employer))

            logger.debug("Batch returned %d results", len(batch_bindings))

        all_journalist_names = list(dict.fromkeys(all_journalist_names))

        logger.info(
            "Wikidata SPARQL returned %d unique journalist-employer pairs",
            len(all_journalist_names),
        )

        resolved = 0
        failed = 0
        total = len(all_journalist_names)

        session = await _get_session()
        try:
            for i, (name, employer) in enumerate(all_journalist_names, 1):
                resolver_key = build_resolver_key(name, employer)
                entity_name = resolver_key or _normalize_for_resolver(name)

                stmt = select(Reporter).where(Reporter.resolver_key == resolver_key)
                existing = (await session.execute(stmt)).scalar_one_or_none()
                if existing and existing.match_status == "matched":
                    resolved += 1
                    continue

                try:
                    profile = await build_reporter_dossier(
                        name=name,
                        organization=employer,
                        http_client=client,
                    )

                    if profile.get("match_status") == "matched":
                        _enrich_profile_mbfc(profile)
                        _enrich_profile_littlesis(profile)
                        await upsert_reporter_profile(session, profile)
                        reporter = await session.execute(
                            select(Reporter).where(
                                Reporter.resolver_key == profile.get("resolver_key")
                            )
                        )
                        reporter_obj = reporter.scalar_one_or_none()
                        if reporter_obj:
                            await _index_reporter_articles(
                                session,
                                reporter_obj,
                                profile,
                                name,
                                employer,
                                client,
                            )
                        await _upsert_index_status(session, "reporter", entity_name, "complete")
                        resolved += 1

                        if resolved % 20 == 0:
                            logger.info(
                                "[%d/%d] SPARQL seeded: %d resolved",
                                i,
                                total,
                                resolved,
                            )

                    else:
                        failed += 1

                except Exception as exc:
                    await session.rollback()
                    logger.error("SPARQL seed failed for %s: %s", name, exc)
                    failed += 1

                if i < total:
                    await asyncio.sleep(INDEX_DELAY_SECONDS)

        finally:
            await session.close()

        return {
            "total": total,
            "resolved": resolved,
            "failed": failed,
            "completed_at": datetime.now(UTC).isoformat(),
        }

    finally:
        if owned_client:
            await client.aclose()


async def index_stale_reporters(
    stale_days: int = STALE_THRESHOLD_DAYS,
    delay_seconds: float = INDEX_DELAY_SECONDS,
) -> dict[str, Any]:
    """Re-index reporters whose wiki data is older than stale_days."""
    session = await _get_session()
    try:
        cutoff = get_utc_now() - timedelta(days=stale_days)

        result = await session.execute(
            select(WikiIndexStatus).where(
                WikiIndexStatus.entity_type == "reporter",
                WikiIndexStatus.status.in_(["complete", "stale", "failed"]),
                or_(
                    WikiIndexStatus.last_indexed_at.is_(None),
                    WikiIndexStatus.last_indexed_at < cutoff,
                ),
            )
        )
        stale_entries = result.scalars().all()

        if not stale_entries:
            logger.info("No stale reporter entries found")
            return {"total": 0, "resolved": 0, "failed": 0}

        total = len(stale_entries)
        resolved = 0
        failed = 0

        logger.info("Re-indexing %d stale reporters", total)

        async with httpx.AsyncClient(timeout=20.0) as client:
            for i, entry in enumerate(stale_entries, 1):
                entity_name = cast(str, entry.entity_name)
                parts = entity_name.rsplit("::", 1)
                reporter_name = parts[0] if parts else entity_name
                org_name = parts[1] if len(parts) > 1 else None

                try:
                    profile = await build_reporter_dossier(
                        name=reporter_name,
                        organization=org_name,
                        http_client=client,
                    )

                    if profile.get("match_status") == "matched":
                        _enrich_profile_mbfc(profile)
                        _enrich_profile_littlesis(profile)
                        await upsert_reporter_profile(session, profile)

                    await _upsert_index_status(session, "reporter", entity_name, "complete")
                    resolved += 1

                except Exception as exc:
                    await session.rollback()
                    logger.error(
                        "Stale reporter re-index failed for %s: %s",
                        entity_name,
                        exc,
                    )
                    await _upsert_index_status(
                        session,
                        "reporter",
                        entity_name,
                        "failed",
                        error_message=str(exc),
                    )
                    failed += 1

                if i < total:
                    await asyncio.sleep(delay_seconds)

        return {"total": total, "resolved": resolved, "failed": failed}

    finally:
        await session.close()


async def index_all_reporters(
    delay_seconds: float = INDEX_DELAY_SECONDS,
) -> dict[str, Any]:
    """Full reporter indexing pipeline: SPARQL seed + unresolved author indexing."""
    logger.info("Starting full reporter indexing pipeline")

    sparql_result = await seed_reporters_from_wikidata()
    logger.info("SPARQL seeding result: %s", sparql_result)

    author_result = await index_unresolved_reporters(delay_seconds=delay_seconds)
    logger.info("Unresolved author indexing result: %s", author_result)

    return {
        "sparql_seed": sparql_result,
        "author_index": author_result,
        "completed_at": datetime.now(UTC).isoformat(),
    }
