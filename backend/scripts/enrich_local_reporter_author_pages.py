#!/usr/bin/env python3
"""Enrich local-byline reporters with official publisher author pages.

Dry-run by default. With --apply, this script updates local_byline reporters
only when an article page exposes an author URL for the same reporter name on
the same publisher host family. Those rows become publisher-confirmed evidence
for the existing verified confidence tier.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from app.database import Article, ArticleAuthor, Reporter, get_utc_now  # noqa: E402
from app.services.reporter_author_page_scraper import scrape_author_profile  # noqa: E402
from app.services.reporter_confidence_scorer import (  # noqa: E402
    compute_confidence_tier,
    is_public_author_url,
    update_reporter_confidence,
)
from app.services.reporter_public_records import (  # noqa: E402
    _fetch_article_author_signals,
    _name_matches,
    clean_author_name,
)
from app.services.source_url_guard import extract_host, hosts_match  # noqa: E402


ACCESS_BARRIER_PHRASES = (
    "just a moment",
    "checking your browser",
    "verify you are human",
    "needs to review the security of your connection",
    "datadome",
)
GENERIC_AUTHOR_PATH_TEMPLATES = (
    "/by/{slug}",
    "/profile/{slug}",
    "/author/{slug}/",
    "/authors/{slug}",
    "/profile/author/{slug}/",
    "/profile/guest-writer/{slug}/",
    "/profile/columnist/{slug}/",
    "/staff/{slug}/",
    "/people/{slug}/",
    "/person/{slug}/",
    "/contributor/{slug}/",
    "/contributors/{slug}/",
    "/news/author/{slug}",
)
HOST_AUTHOR_PATH_TEMPLATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("nytimes.com", ("/by/{hyphen}",)),
    ("theguardian.com", ("/profile/{compact}", "/profile/{hyphen}")),
    (
        "indianexpress.com",
        (
            "/profile/author/{hyphen}/",
            "/profile/guest-writer/{hyphen}/",
            "/profile/columnist/{hyphen}/",
        ),
    ),
    ("axios.com", ("/authors/{initial_last}", "/authors/{hyphen}", "/authors/{compact}")),
    ("thediplomat.com", ("/authors/{hyphen}/",)),
    ("warontherocks.com", ("/author/{hyphen}/",)),
    ("variety.com", ("/author/{hyphen}/",)),
    ("washingtontimes.com", ("/staff/{hyphen}/",)),
    ("wsj.com", ("/news/author/{hyphen}", "/news/author/{compact}")),
    ("nationalreview.com", ("/author/{hyphen}/",)),
    ("phillyvoice.com", ("/staff-contributors/{hyphen}/",)),
)


@dataclass
class EnrichmentMetrics:
    reporters_considered: int = 0
    article_urls_checked: int = 0
    author_pages_found: int = 0
    author_pages_guessed: int = 0
    author_pages_rejected: int = 0
    profile_pages_checked: int = 0
    profile_name_matches: int = 0
    reporters_promoted: int = 0
    already_verified: int = 0
    access_barriers: Counter[str] = field(default_factory=Counter)
    sample_promoted: list[str] = field(default_factory=list)
    sample_rejected: list[str] = field(default_factory=list)
    sample_barriers: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "reporters_considered": self.reporters_considered,
            "article_urls_checked": self.article_urls_checked,
            "author_pages_found": self.author_pages_found,
            "author_pages_guessed": self.author_pages_guessed,
            "author_pages_rejected": self.author_pages_rejected,
            "profile_pages_checked": self.profile_pages_checked,
            "profile_name_matches": self.profile_name_matches,
            "reporters_promoted": self.reporters_promoted,
            "already_verified": self.already_verified,
            "access_barriers": dict(self.access_barriers),
            "sample_promoted": self.sample_promoted,
            "sample_rejected": self.sample_rejected,
            "sample_barriers": self.sample_barriers,
        }


@dataclass
class CitationRepairMetrics:
    reporters_scanned: int = 0
    public_author_pages: int = 0
    citations_already_present: int = 0
    citations_missing: int = 0
    citations_repaired: int = 0
    skipped_non_public_author_pages: int = 0
    sample_repaired: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "reporters_scanned": self.reporters_scanned,
            "public_author_pages": self.public_author_pages,
            "citations_already_present": self.citations_already_present,
            "citations_missing": self.citations_missing,
            "citations_repaired": self.citations_repaired,
            "skipped_non_public_author_pages": self.skipped_non_public_author_pages,
            "sample_repaired": self.sample_repaired,
        }


def _author_page_citation_present(reporter: Reporter, author_url: str | None = None) -> bool:
    target_url = author_url or str(reporter.author_page_url or "")
    if not target_url:
        return False
    citations = reporter.citations if isinstance(reporter.citations, list) else []
    return any(
        isinstance(citation, dict) and str(citation.get("url") or "") == target_url
        for citation in citations
    )


def _set_author_page_citation(reporter: Reporter, author_url: str) -> bool:
    if _author_page_citation_present(reporter, author_url):
        return False
    existing = reporter.citations if isinstance(reporter.citations, list) else []
    reporter.citations = [
        *existing,
        {
            "label": "Official author page",
            "url": author_url,
            "source_type": "official_author_page",
        },
    ]
    return True


def _same_publisher_host(article_url: str, author_url: str) -> bool:
    article_host = extract_host(article_url)
    author_host = extract_host(author_url)
    return bool(article_host and author_host and hosts_match(article_host, author_host))


def _profile_name_matches_reporter(profile_name: str | None, reporter_name: str) -> bool:
    clean_profile_name = clean_author_name(profile_name)
    clean_reporter_name = clean_author_name(reporter_name)
    return bool(
        clean_profile_name
        and clean_reporter_name
        and _name_matches(clean_profile_name, clean_reporter_name)
    )


def _slug_tokens(value: str) -> list[str]:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.findall(r"[a-z0-9]+", ascii_value.lower())


def _slug_variants(reporter_name: str) -> dict[str, str]:
    cleaned_name = clean_author_name(reporter_name)
    if not cleaned_name:
        return {}
    tokens = _slug_tokens(cleaned_name)
    if len(tokens) < 2:
        return {}

    variants = {
        "hyphen": "-".join(tokens),
        "compact": "".join(tokens),
        "initial_last": f"{tokens[0][0]}{tokens[-1]}",
    }
    return {key: value for key, value in variants.items() if value}


def _host_specific_author_path_templates(host: str) -> list[str]:
    normalized_host = host.lower().removeprefix("www.")
    templates: list[str] = []
    for suffix, suffix_templates in HOST_AUTHOR_PATH_TEMPLATES:
        if normalized_host == suffix or normalized_host.endswith(f".{suffix}"):
            templates.extend(suffix_templates)
    return templates


def _format_author_path(template: str, variants: dict[str, str]) -> list[str]:
    if "{slug}" in template:
        return [template.format(slug=slug) for slug in dict.fromkeys(variants.values())]
    try:
        return [template.format(**variants)]
    except KeyError:
        return []


def _dedupe_urls(
    values: list[tuple[str, str]], *, max_candidates: int | None = None
) -> list[tuple[str, str]]:
    seen: set[str] = set()
    deduped: list[tuple[str, str]] = []
    for url, evidence_type in values:
        if url in seen:
            continue
        seen.add(url)
        deduped.append((url, evidence_type))
        if max_candidates is not None and len(deduped) >= max_candidates:
            break
    return deduped


def _guessed_author_pages(
    article_url: str,
    reporter_name: str,
    *,
    max_candidates: int = 10,
) -> list[str]:
    """Build bounded same-host author profile candidates for common publisher patterns."""
    parsed = urlparse(article_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return []

    variants = _slug_variants(reporter_name)
    if not variants:
        return []

    path_templates = [
        *_host_specific_author_path_templates(parsed.netloc),
        *GENERIC_AUTHOR_PATH_TEMPLATES,
    ]
    candidates: list[tuple[str, str]] = []
    for template in path_templates:
        for path in _format_author_path(template, variants):
            candidates.append(
                (
                    urlunparse(
                        (
                            parsed.scheme,
                            parsed.netloc,
                            path,
                            "",
                            "",
                            "",
                        )
                    ),
                    "guessed_author_page",
                )
            )
    return [url for url, _evidence_type in _dedupe_urls(candidates, max_candidates=max_candidates)]


def _candidate_author_pages(
    signals: dict[str, Any],
    article_url: str,
    reporter_name: str,
    *,
    include_guessed: bool,
    max_guessed_pages: int,
) -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = [
        (url, "profile_name_match")
        for url in signals.get("author_pages", [])
        if isinstance(url, str)
    ]
    has_same_host_candidate = any(
        _same_publisher_host(article_url, url) for url, _evidence_type in candidates
    )
    if include_guessed and not has_same_host_candidate:
        candidates.extend(
            (url, "guessed_profile_name_match")
            for url in _guessed_author_pages(
                article_url,
                reporter_name,
                max_candidates=max_guessed_pages,
            )
        )
    return _dedupe_urls(candidates)


def _barrier_from_result(result: dict[str, Any]) -> str | None:
    access_barrier = result.get("access_barrier")
    if isinstance(access_barrier, str) and access_barrier:
        return access_barrier
    error = str(result.get("error") or "").lower()
    url = str(result.get("url") or "")
    if not error:
        return None
    if "http 403" in error:
        return "http_403"
    if "http 401" in error:
        return "http_401"
    if "http 429" in error:
        return "http_429"
    if "cloudflare" in error or "/cdn-cgi/" in url:
        return "cloudflare"
    if "datadome" in error:
        return "datadome"
    return None


def _evidence_type_with_access_path(
    evidence_type: str,
    *,
    article_access_path: str | None,
    profile_access_path: str | None,
) -> str:
    access_paths = []
    if article_access_path == "cloudscraper":
        access_paths.append("article")
    if profile_access_path == "cloudscraper":
        access_paths.append("profile")
    if not access_paths:
        return evidence_type
    return f"cloudscraper_{'_'.join(access_paths)}_{evidence_type}"


async def _fetch_barrier_type(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        response = await client.get(url, follow_redirects=True)
    except Exception:
        return "fetch_failed"
    if response.status_code in {401, 403, 429}:
        return f"http_{response.status_code}"
    text = response.text[:5000].lower()
    if "/cdn-cgi/" in text or "challenges.cloudflare.com" in text:
        return "cloudflare"
    if any(phrase in text for phrase in ACCESS_BARRIER_PHRASES):
        if "datadome" in text:
            return "datadome"
        return "cloudflare"
    return None


async def _load_candidate_reporters(
    session: AsyncSession,
    *,
    limit_reporters: int | None,
    source: str | None,
) -> list[Reporter]:
    stmt = (
        select(Reporter)
        .join(ArticleAuthor, ArticleAuthor.reporter_id == Reporter.id)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(Reporter.match_status == "local_byline")
        .where((Reporter.author_page_url.is_(None)) | (Reporter.author_page_url == ""))
        .where(Article.url.isnot(None))
        .where(Article.url != "")
        .group_by(Reporter.id)
        .order_by(func.count(ArticleAuthor.id).desc(), Reporter.id)
    )
    if source:
        stmt = stmt.where(Article.source == source)
    if limit_reporters:
        stmt = stmt.limit(limit_reporters)
    return list((await session.execute(stmt)).scalars().all())


async def _article_rows_for_reporter(
    session: AsyncSession,
    reporter_id: int,
    *,
    max_articles: int,
) -> list[tuple[ArticleAuthor, Article]]:
    stmt = (
        select(ArticleAuthor, Article)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(ArticleAuthor.reporter_id == reporter_id)
        .where(Article.url.isnot(None))
        .where(Article.url != "")
        .order_by(Article.published_at.desc().nullslast(), Article.id.desc())
        .limit(max_articles)
    )
    return list((await session.execute(stmt)).all())


async def _confirmed_author_page(
    client: httpx.AsyncClient,
    reporter_name: str,
    article_url: str,
    metrics: EnrichmentMetrics,
    *,
    include_guessed: bool = False,
    max_guessed_pages: int = 10,
) -> tuple[str | None, str | None, str | None]:
    metrics.article_urls_checked += 1
    signals = await _fetch_article_author_signals(client, reporter_name, article_url)
    signal_barrier = signals.get("access_barrier")
    if isinstance(signal_barrier, str) and signal_barrier:
        metrics.access_barriers[signal_barrier] += 1
        if len(metrics.sample_barriers) < 10:
            metrics.sample_barriers.append(f"{signal_barrier}: {article_url}")
    author_pages = [url for url in signals.get("author_pages", []) if isinstance(url, str)]
    metrics.author_pages_found += len(author_pages)
    candidates = _candidate_author_pages(
        signals,
        article_url,
        reporter_name,
        include_guessed=include_guessed,
        max_guessed_pages=max_guessed_pages,
    )
    metrics.author_pages_guessed += sum(
        1 for _url, evidence_type in candidates if evidence_type == "guessed_profile_name_match"
    )

    if not candidates:
        if not signal_barrier:
            barrier = await _fetch_barrier_type(client, article_url)
            if barrier:
                metrics.access_barriers[barrier] += 1
                if len(metrics.sample_barriers) < 10:
                    metrics.sample_barriers.append(f"{barrier}: {article_url}")
        return None, None, None

    article_access_path = signals.get("access_path") if isinstance(signals, dict) else None
    for author_page, evidence_type in candidates:
        if not _same_publisher_host(article_url, author_page):
            metrics.author_pages_rejected += 1
            if len(metrics.sample_rejected) < 10:
                metrics.sample_rejected.append(f"cross_host: {reporter_name} -> {author_page}")
            continue

        metrics.profile_pages_checked += 1
        profile = await scrape_author_profile(client, author_page)
        barrier = _barrier_from_result(profile)
        if barrier:
            metrics.access_barriers[barrier] += 1
            if len(metrics.sample_barriers) < 10:
                metrics.sample_barriers.append(f"{barrier}: {author_page}")
            metrics.author_pages_rejected += 1
            if len(metrics.sample_rejected) < 10:
                metrics.sample_rejected.append(f"{barrier}: {reporter_name} -> {author_page}")
            continue

        full_name = profile.get("full_name")
        profile_name = clean_author_name(full_name) if isinstance(full_name, str) else None
        if profile_name and _profile_name_matches_reporter(profile_name, reporter_name):
            metrics.profile_name_matches += 1
            return (
                author_page,
                _evidence_type_with_access_path(
                    evidence_type,
                    article_access_path=(
                        article_access_path if isinstance(article_access_path, str) else None
                    ),
                    profile_access_path=profile.get("access_path")
                    if isinstance(profile.get("access_path"), str)
                    else None,
                ),
                profile_name,
            )
        metrics.author_pages_rejected += 1
        if len(metrics.sample_rejected) < 10:
            metrics.sample_rejected.append(
                f"profile_name_mismatch: {reporter_name} -> {author_page}"
            )

    return None, None, None


async def enrich_local_reporter_author_pages(
    session: AsyncSession,
    *,
    apply: bool = False,
    target_promotions: int = 100,
    limit_reporters: int | None = None,
    max_articles_per_reporter: int = 3,
    source: str | None = None,
    include_guessed_author_pages: bool = False,
    max_guessed_author_pages: int = 10,
) -> EnrichmentMetrics:
    metrics = EnrichmentMetrics()
    reporters = await _load_candidate_reporters(
        session,
        limit_reporters=limit_reporters,
        source=source,
    )
    timeout = httpx.Timeout(20.0)
    headers = {"User-Agent": "Scoop reporter intelligence verifier/0.1"}
    async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
        for reporter in reporters:
            if metrics.reporters_promoted >= target_promotions:
                break
            if reporter.id is None:
                continue
            reporter_name = clean_author_name(str(reporter.name or ""))
            if not reporter_name:
                continue
            metrics.reporters_considered += 1
            tier, _score, _evidence = await compute_confidence_tier(session, reporter)
            if tier == "verified":
                metrics.already_verified += 1
                continue
            article_rows = await _article_rows_for_reporter(
                session,
                int(reporter.id),
                max_articles=max_articles_per_reporter,
            )
            for article_author, article in article_rows:
                if not article.url:
                    continue
                author_url, evidence_type, profile_name = await _confirmed_author_page(
                    client,
                    reporter_name,
                    str(article.url),
                    metrics,
                    include_guessed=include_guessed_author_pages,
                    max_guessed_pages=max_guessed_author_pages,
                )
                if not author_url:
                    continue

                if apply:
                    reporter.canonical_name = profile_name or reporter_name
                    reporter.author_page_url = author_url
                    reporter.canonical_author_url = author_url
                    reporter.last_researched_at = get_utc_now()
                    reporter.research_confidence = "high"
                    reporter.research_sources = sorted(
                        set((reporter.research_sources or []) + ["official_author_page"])
                    )
                    _set_author_page_citation(reporter, author_url)
                    article_author.author_url_raw = author_url
                    article_author.observation_source = evidence_type
                    await session.flush()
                    await update_reporter_confidence(session, int(reporter.id))

                metrics.reporters_promoted += 1
                if len(metrics.sample_promoted) < 10:
                    metrics.sample_promoted.append(f"{reporter_name}: {author_url}")
                break

    if apply:
        await session.commit()
    else:
        await session.rollback()
    return metrics


async def repair_verified_author_page_citations(
    session: AsyncSession,
    *,
    apply: bool = False,
    limit_reporters: int | None = None,
) -> CitationRepairMetrics:
    metrics = CitationRepairMetrics()
    stmt = (
        select(Reporter)
        .where(Reporter.confidence_tier == "verified")
        .where(Reporter.author_page_url.isnot(None))
        .where(Reporter.author_page_url != "")
        .order_by(Reporter.id)
    )
    if limit_reporters:
        stmt = stmt.limit(limit_reporters)

    reporters = list((await session.execute(stmt)).scalars().all())
    for reporter in reporters:
        metrics.reporters_scanned += 1
        author_url = str(reporter.author_page_url or "")
        if not is_public_author_url(author_url):
            metrics.skipped_non_public_author_pages += 1
            continue
        metrics.public_author_pages += 1
        if _author_page_citation_present(reporter, author_url):
            metrics.citations_already_present += 1
            continue
        metrics.citations_missing += 1
        if apply and _set_author_page_citation(reporter, author_url):
            metrics.citations_repaired += 1
            if len(metrics.sample_repaired) < 10:
                metrics.sample_repaired.append(f"{reporter.name}: {author_url}")

    if apply:
        await session.commit()
    else:
        await session.rollback()
    return metrics


async def _get_session() -> AsyncSession:
    from app.database import AsyncSessionLocal

    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


async def main_async(args: argparse.Namespace) -> int:
    session = await _get_session()
    try:
        if args.repair_citations:
            metrics = await repair_verified_author_page_citations(
                session,
                apply=args.apply,
                limit_reporters=args.limit_reporters,
            )
        else:
            metrics = await enrich_local_reporter_author_pages(
                session,
                apply=args.apply,
                target_promotions=args.target_promotions,
                limit_reporters=args.limit_reporters,
                max_articles_per_reporter=args.max_articles_per_reporter,
                source=args.source,
                include_guessed_author_pages=args.include_guessed_author_pages,
                max_guessed_author_pages=args.max_guessed_author_pages,
            )
        for key, value in metrics.as_dict().items():
            print(f"{key}={value}")
        print(f"mode={'apply' if args.apply else 'dry_run'}")
    finally:
        await session.close()
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Promote local-byline reporters using official publisher author pages."
    )
    parser.add_argument("--apply", action="store_true", help="Write verified author-page evidence.")
    parser.add_argument("--target-promotions", type=int, default=100)
    parser.add_argument("--limit-reporters", type=int, default=None)
    parser.add_argument("--max-articles-per-reporter", type=int, default=3)
    parser.add_argument("--source", default=None, help="Optional source name filter.")
    parser.add_argument(
        "--include-guessed-author-pages",
        action="store_true",
        help=(
            "Try bounded same-host author-page URL patterns when article metadata does not "
            "expose an author URL. Promotions still require a fetched profile-name match."
        ),
    )
    parser.add_argument("--max-guessed-author-pages", type=int, default=10)
    parser.add_argument(
        "--repair-citations",
        action="store_true",
        help="Repair missing Official author page citations for verified reporters.",
    )
    return parser.parse_args()


def main() -> int:
    return asyncio.run(main_async(parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
