#!/usr/bin/env python3
"""Backfill ArticleAuthor links from persisted RSS bylines.

This is deterministic and local-only: it does not fetch pages or resolve public
identity records. It creates local-byline reporter records only for bylines that
pass the shared reporter-like name filter, then links matching article rows with
`observation_source="rss_byline"`.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from app.database import Article, ArticleAuthor, Reporter, get_utc_now  # noqa: E402
from app.data.rss_sources import get_rss_sources  # noqa: E402
from app.services.entity_wiki_service import build_resolver_key  # noqa: E402
from app.services.reporter_indexer import _normalize_for_resolver  # noqa: E402
from app.services.reporter_public_records import clean_author_name  # noqa: E402

DISALLOWED_LOCAL_BYLINE_SOURCE_TERMS = (
    "academic preprint",
    "aggregator",
    "link aggregator",
    "platform-owned",
)
_MULTI_AUTHOR_SPLIT_PATTERN = re.compile(
    r"\s+(?:and|with|&)\s+|\s+y\s+",
    re.IGNORECASE,
)


@dataclass
class BylinedArticle:
    article_id: int
    source: str | None
    author: str
    title: str | None
    url: str | None
    published_at: Any | None
    category: str | None


@dataclass
class BackfillMetrics:
    articles_scanned: int = 0
    skipped_generic_bylines: int = 0
    candidate_groups: int = 0
    reporters_created: int = 0
    reporters_reused: int = 0
    links_created: int = 0
    existing_links: int = 0
    skipped_disallowed_sources: int = 0
    invalid_reporters_pruned: int = 0
    invalid_links_pruned: int = 0
    sample_created_reporters: list[str] = field(default_factory=list)
    sample_linked_bylines: list[str] = field(default_factory=list)
    sample_skipped_sources: list[str] = field(default_factory=list)
    sample_pruned_reporters: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "articles_scanned": self.articles_scanned,
            "skipped_generic_bylines": self.skipped_generic_bylines,
            "candidate_groups": self.candidate_groups,
            "reporters_created": self.reporters_created,
            "reporters_reused": self.reporters_reused,
            "links_created": self.links_created,
            "existing_links": self.existing_links,
            "skipped_disallowed_sources": self.skipped_disallowed_sources,
            "invalid_reporters_pruned": self.invalid_reporters_pruned,
            "invalid_links_pruned": self.invalid_links_pruned,
            "sample_created_reporters": self.sample_created_reporters,
            "sample_linked_bylines": self.sample_linked_bylines,
            "sample_skipped_sources": self.sample_skipped_sources,
            "sample_pruned_reporters": self.sample_pruned_reporters,
        }


def _group_key(author: str, source: str | None) -> str:
    return build_resolver_key(author, source) or _normalize_for_resolver(author)


def _normalized_source_label(value: str | None) -> str:
    normalized = _normalize_for_resolver(value or "")
    if normalized.startswith("the "):
        return normalized[4:]
    return normalized


def _is_source_label_byline(author: str, source: str | None) -> bool:
    author_label = _normalized_source_label(author)
    source_label = _normalized_source_label(source)
    return bool(author_label and source_label and author_label == source_label)


def _clean_author_names(value: str | None) -> list[str]:
    """Return one or more reporter-like names from a persisted byline."""
    cleaned = clean_author_name(str(value or ""))
    if not cleaned:
        return []

    has_separator = bool(_MULTI_AUTHOR_SPLIT_PATTERN.search(cleaned) or re.search(r"[,;]", cleaned))
    if not has_separator:
        return [cleaned]

    split_ready = _MULTI_AUTHOR_SPLIT_PATTERN.sub(", ", cleaned)
    parts = [part.strip() for part in re.split(r"\s*[,;]\s*", split_ready) if part.strip()]
    names = [name for part in parts if (name := clean_author_name(part))]
    if not names:
        return []
    if len(names) < 2:
        return names

    unique: list[str] = []
    seen: set[str] = set()
    for name in names:
        key = _normalize_for_resolver(name)
        if key in seen:
            continue
        seen.add(key)
        unique.append(name)
    return unique


def _is_combined_byline_name(value: str | None) -> bool:
    cleaned = clean_author_name(str(value or ""))
    if not cleaned:
        return False
    has_separator = bool(_MULTI_AUTHOR_SPLIT_PATTERN.search(cleaned) or re.search(r"[,;]", cleaned))
    if not has_separator:
        return False
    names = _clean_author_names(value)
    return len(names) != 1 or names[0] != cleaned


def _source_config_for_name(
    source_name: str | None,
    source_configs: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    if not source_name:
        return None
    if source_name in source_configs:
        return source_configs[source_name]
    normalized_source = _normalized_source_label(source_name)
    for name, config in source_configs.items():
        if _normalized_source_label(name) == normalized_source:
            return config
    return None


def _source_allows_local_byline(
    source_name: str | None,
    source_configs: dict[str, dict[str, Any]],
) -> bool:
    config = _source_config_for_name(source_name, source_configs)
    if config is None:
        return True
    evidence_text = " ".join(
        str(config.get(key) or "") for key in ("ownership_label", "category", "funding_type", "url")
    ).lower()
    return not any(term in evidence_text for term in DISALLOWED_LOCAL_BYLINE_SOURCE_TERMS)


def _source_from_reporter_career(reporter: Reporter) -> str | None:
    career_history = reporter.career_history or []
    if not isinstance(career_history, list):
        return None
    for entry in career_history:
        if isinstance(entry, dict) and entry.get("organization"):
            return str(entry["organization"])
    return None


def _has_valid_local_byline_name(reporter: Reporter) -> bool:
    raw_name = str(reporter.name or "")
    cleaned = clean_author_name(raw_name)
    source_name = _source_from_reporter_career(reporter)
    return bool(
        cleaned
        and _normalize_for_resolver(cleaned) == _normalize_for_resolver(raw_name)
        and not _is_combined_byline_name(raw_name)
        and not _is_source_label_byline(cleaned, source_name)
        and not _is_source_label_byline(raw_name, source_name)
    )


def _local_reporter_profile(
    author: str,
    source: str | None,
    articles: list[BylinedArticle],
) -> dict[str, Any]:
    latest = None
    categories: list[str] = []
    urls: list[str] = []
    article_items: list[dict[str, Any]] = []
    for article in articles:
        if article.published_at and (latest is None or article.published_at > latest):
            latest = article.published_at
        if article.category:
            categories.append(article.category)
        if article.url:
            urls.append(article.url)
        article_items.append(
            {
                "label": "Article",
                "value": article.title or article.url or f"Article {article.article_id}",
                "sources": [article.url] if article.url else [],
            }
        )

    career_history = (
        [{"organization": source, "role": "byline outlet", "source": "rss_catalog"}]
        if source
        else []
    )
    return {
        "name": author,
        "normalized_name": _normalize_for_resolver(author),
        "canonical_name": author,
        "resolver_key": _group_key(author, source),
        "match_status": "local_byline",
        "overview": (
            f"{author} appears as an RSS/local-corpus byline"
            + (f" for {source}." if source else ".")
        ),
        "career_history": career_history,
        "topics": sorted(set(categories)),
        "education": [],
        "dossier_sections": [
            {
                "id": "identity",
                "title": "Identity",
                "status": "available",
                "items": [
                    {"label": "Name", "value": author, "sources": urls[:5]},
                    {
                        "label": "Match",
                        "value": "Local byline profile grounded in persisted RSS article records.",
                        "sources": urls[:5],
                    },
                ],
            },
            {
                "id": "source_context",
                "title": "Source Context",
                "status": "available" if source else "missing",
                "items": (
                    [
                        {
                            "label": "Observed outlet",
                            "value": source,
                            "sources": [],
                        }
                    ]
                    if source
                    else []
                ),
            },
            {
                "id": "article_evidence",
                "title": "Article Evidence",
                "status": "available" if article_items else "missing",
                "items": article_items[:10],
            },
        ],
        "citations": [{"label": "Local article evidence", "url": url} for url in urls[:5]],
        "search_links": {},
        "match_explanation": "Created by deterministic local RSS-byline backfill.",
        "research_sources": ["rss_byline", "local_article_corpus", "rss_catalog"],
        "research_confidence": "medium" if len(articles) >= 2 else "low",
        "article_count": len(articles),
        "last_article_at": latest,
        "confidence_tier": "likely" if len(articles) >= 2 else "unmatched",
        "confidence_score": 0.55 if len(articles) >= 2 else 0.35,
        "claims_count": 0,
    }


async def _load_groups(
    session: AsyncSession,
    limit: int | None,
    source_configs: dict[str, dict[str, Any]],
) -> tuple[dict[str, list[BylinedArticle]], int, int, int, list[str]]:
    stmt = (
        select(
            Article.id,
            Article.source,
            Article.author,
            Article.title,
            Article.url,
            Article.published_at,
            Article.category,
        )
        .where(Article.author.isnot(None))
        .where(Article.author != "")
        .order_by(Article.id)
    )
    if limit:
        stmt = stmt.limit(limit)

    groups: dict[str, list[BylinedArticle]] = defaultdict(list)
    scanned = 0
    skipped_generic = 0
    skipped_disallowed = 0
    sample_skipped_sources: list[str] = []
    for article_id, source, raw_author, title, url, published_at, category in (
        await session.execute(stmt)
    ).all():
        scanned += 1
        source_name = str(source) if source else None
        if not _source_allows_local_byline(source_name, source_configs):
            skipped_disallowed += 1
            if source_name and source_name not in sample_skipped_sources:
                sample_skipped_sources.append(source_name)
            continue
        authors = [
            author
            for author in _clean_author_names(str(raw_author or ""))
            if not _is_source_label_byline(author, source_name)
        ]
        if not authors:
            skipped_generic += 1
            continue
        for author in authors:
            group_key = _group_key(author, source_name)
            groups[group_key].append(
                BylinedArticle(
                    article_id=int(article_id),
                    source=source_name,
                    author=author,
                    title=str(title) if title else None,
                    url=str(url) if url else None,
                    published_at=published_at,
                    category=str(category) if category else None,
                )
            )
    return groups, scanned, skipped_generic, skipped_disallowed, sample_skipped_sources[:10]


async def _get_or_create_reporter(
    session: AsyncSession,
    profile: dict[str, Any],
    apply: bool,
    metrics: BackfillMetrics,
) -> Reporter | None:
    stmt = select(Reporter).where(Reporter.resolver_key == profile["resolver_key"])
    reporter = (await session.execute(stmt)).scalar_one_or_none()
    if reporter:
        metrics.reporters_reused += 1
        if apply:
            reporter.article_count = max(int(reporter.article_count or 0), profile["article_count"])
            reporter.last_article_at = profile["last_article_at"]
        return reporter

    metrics.reporters_created += 1
    if len(metrics.sample_created_reporters) < 10:
        metrics.sample_created_reporters.append(str(profile["resolver_key"]))
    if not apply:
        return None

    reporter = Reporter()
    for key, value in profile.items():
        setattr(reporter, key, value)
    reporter.last_researched_at = get_utc_now()
    session.add(reporter)
    await session.flush()
    return reporter


async def backfill_article_author_links(
    session: AsyncSession,
    *,
    apply: bool = False,
    limit: int | None = None,
    source_configs: dict[str, dict[str, Any]] | None = None,
) -> BackfillMetrics:
    source_configs = source_configs if source_configs is not None else get_rss_sources()
    (
        groups,
        scanned,
        skipped_generic,
        skipped_disallowed,
        sample_skipped_sources,
    ) = await _load_groups(session, limit, source_configs)
    metrics = BackfillMetrics(
        articles_scanned=scanned,
        skipped_generic_bylines=skipped_generic,
        skipped_disallowed_sources=skipped_disallowed,
        candidate_groups=len(groups),
        sample_skipped_sources=sample_skipped_sources,
    )

    for articles in groups.values():
        first = articles[0]
        profile = _local_reporter_profile(first.author, first.source, articles)
        reporter = await _get_or_create_reporter(session, profile, apply, metrics)

        for article in articles:
            existing = None
            if reporter and reporter.id is not None:
                existing = (
                    await session.execute(
                        select(ArticleAuthor).where(
                            ArticleAuthor.article_id == article.article_id,
                            ArticleAuthor.reporter_id == reporter.id,
                        )
                    )
                ).scalar_one_or_none()
            if existing:
                metrics.existing_links += 1
                continue

            metrics.links_created += 1
            if len(metrics.sample_linked_bylines) < 10:
                metrics.sample_linked_bylines.append(f"{first.source or 'unknown'}::{first.author}")
            if apply and reporter and reporter.id is not None:
                session.add(
                    ArticleAuthor(
                        article_id=article.article_id,
                        reporter_id=reporter.id,
                        author_role="author",
                        author_confidence=0.55,
                        observation_source="rss_byline",
                        author_url_raw=None,
                    )
                )

    if apply:
        await session.commit()
    else:
        await session.rollback()
    return metrics


async def prune_invalid_local_byline_links(
    session: AsyncSession,
    *,
    apply: bool = False,
    source_configs: dict[str, dict[str, Any]] | None = None,
) -> BackfillMetrics:
    source_configs = source_configs if source_configs is not None else get_rss_sources()
    metrics = BackfillMetrics()
    result = await session.execute(
        select(Reporter).where(Reporter.match_status == "local_byline").order_by(Reporter.id)
    )
    invalid_reporters: list[Reporter] = []
    for reporter in result.scalars().all():
        source_name = _source_from_reporter_career(reporter)
        if _source_allows_local_byline(
            source_name, source_configs
        ) and _has_valid_local_byline_name(reporter):
            continue
        invalid_reporters.append(reporter)
        if len(metrics.sample_pruned_reporters) < 10:
            metrics.sample_pruned_reporters.append(str(reporter.resolver_key or reporter.name))

    reporter_ids = [int(r.id) for r in invalid_reporters if r.id is not None]
    metrics.invalid_reporters_pruned = len(reporter_ids)
    if reporter_ids:
        link_count_result = await session.execute(
            select(func.count())
            .select_from(ArticleAuthor)
            .where(ArticleAuthor.reporter_id.in_(reporter_ids))
        )
        metrics.invalid_links_pruned = int(link_count_result.scalar_one() or 0)

    if apply and reporter_ids:
        await session.execute(
            delete(ArticleAuthor).where(ArticleAuthor.reporter_id.in_(reporter_ids))
        )
        await session.execute(delete(Reporter).where(Reporter.id.in_(reporter_ids)))
        await session.commit()
    else:
        await session.rollback()
    return metrics


async def _get_session() -> AsyncSession:
    from app.database import AsyncSessionLocal

    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


async def main_async(apply: bool, limit: int | None, prune_invalid: bool) -> int:
    session = await _get_session()
    try:
        if prune_invalid:
            metrics = await prune_invalid_local_byline_links(session, apply=apply)
        else:
            metrics = await backfill_article_author_links(session, apply=apply, limit=limit)
        for key, value in metrics.as_dict().items():
            print(f"{key}={value}")
        print(f"mode={'apply' if apply else 'dry_run'}")
        print(f"operation={'prune_invalid' if prune_invalid else 'backfill'}")
    finally:
        await session.close()
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill reporter/article links from persisted RSS bylines."
    )
    parser.add_argument(
        "--apply", action="store_true", help="Write reporter and ArticleAuthor rows."
    )
    parser.add_argument("--limit", type=int, default=None, help="Limit scanned article rows.")
    parser.add_argument(
        "--prune-invalid-local",
        action="store_true",
        help="Remove local_byline reporters and links for catalog sources that cannot support reporter bylines.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return asyncio.run(
        main_async(apply=args.apply, limit=args.limit, prune_invalid=args.prune_invalid_local)
    )


if __name__ == "__main__":
    raise SystemExit(main())
