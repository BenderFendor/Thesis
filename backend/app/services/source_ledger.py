"""Observed source ledger metrics for source wiki pages."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import Article, ArticleEdge, Correction, SourceMetadata, StoryCluster

PAYWALL_LOCKED_STATUSES = {"hard_paywall", "paywalled", "metered", "subscription_required"}
PAYWALL_FREE_STATUSES = {"free", "open", "available"}


@dataclass(slots=True)
class _ArticleStats:
    count: int = 0
    paywalled: int = 0
    free: int = 0
    unknown_paywall: int = 0
    named_author: int = 0


@dataclass(slots=True)
class _LineageStats:
    corrections: int
    originals: int
    downstream_edges: int
    wire_edges: int


@dataclass(slots=True)
class _LedgerSummary:
    source_name: str
    articles: _ArticleStats
    lineage: _LineageStats
    source_flagged_paywalled: bool
    paywall_rate: float
    policy_signal_count: int
    source_config: dict[str, Any]


def _ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator / denominator, 4)


def _policy_signal_count(meta: SourceMetadata | None) -> int:
    if meta is None or not isinstance(meta.research_sources, dict):
        return 0
    policy = meta.research_sources.get("policy_transparency")
    if not isinstance(policy, dict):
        return 0
    signals = policy.get("signals")
    if not isinstance(signals, list):
        return 0
    return sum(isinstance(signal, dict) for signal in signals)


def _rss_health(source_config: dict[str, Any]) -> dict[str, Any]:
    explicit_status = str(source_config.get("status") or source_config.get("health") or "").strip()
    last_success = source_config.get("last_successful_fetch_at") or source_config.get("last_success")
    error = source_config.get("last_error") or source_config.get("error")
    if explicit_status:
        status = explicit_status
    elif error:
        status = "degraded"
    elif source_config.get("url"):
        status = "configured"
    else:
        status = "unknown"
    return {
        "status": status,
        "feed_url": source_config.get("url"),
        "last_successful_fetch_at": last_success,
        "last_error": error,
    }


def _classify_paywall(stats: _ArticleStats, status: str) -> None:
    if status in PAYWALL_LOCKED_STATUSES:
        stats.paywalled += 1
    elif status in PAYWALL_FREE_STATUSES:
        stats.free += 1
    else:
        stats.unknown_paywall += 1


def _has_named_author(row: Any) -> bool:
    author = str(row.author or "").strip()
    authors = cast(list[str], row.authors or [])
    return bool(author or any(str(item).strip() for item in authors))


def _article_stats(rows: list[Any]) -> _ArticleStats:
    stats = _ArticleStats(count=len(rows))
    for row in rows:
        _classify_paywall(stats, str(row.paywall_status or "unknown").strip().lower())
        stats.named_author += int(_has_named_author(row))
    return stats


async def _load_article_stats(db: AsyncSession, source_names: list[str]) -> _ArticleStats:
    result = await db.execute(
        select(Article.id, Article.author, Article.authors, Article.paywall_status).where(
            Article.source.in_(source_names)
        )
    )
    return _article_stats(list(result.all()))


async def _count_corrections(db: AsyncSession, source_names: list[str]) -> int:
    count = await db.scalar(
        select(func.count(Correction.id)).where(Correction.source.in_(source_names))
    )
    return int(count or 0)


async def _count_originals(db: AsyncSession, source_names: list[str]) -> int:
    count = await db.scalar(
        select(func.count(StoryCluster.id))
        .join(Article, StoryCluster.earliest_article_id == Article.id)
        .where(Article.source.in_(source_names))
    )
    return int(count or 0)


async def _edge_counts(db: AsyncSession, source_names: list[str]) -> dict[str, int]:
    target_article = aliased(Article)
    result = await db.execute(
        select(ArticleEdge.relation, func.count(ArticleEdge.id))
        .join(target_article, ArticleEdge.to_article_id == target_article.id)
        .where(target_article.source.in_(source_names))
        .group_by(ArticleEdge.relation)
    )
    return {str(row[0]): int(row[1] or 0) for row in result.all()}


async def _load_lineage_stats(db: AsyncSession, source_names: list[str]) -> _LineageStats:
    corrections = await _count_corrections(db, source_names)
    originals = await _count_originals(db, source_names)
    edge_counts = await _edge_counts(db, source_names)
    return _LineageStats(
        corrections=corrections,
        originals=originals,
        downstream_edges=sum(edge_counts.values()),
        wire_edges=edge_counts.get("same_wire_story", 0),
    )


def _source_paywall_flag(meta: SourceMetadata | None, source_config: dict[str, Any]) -> bool:
    return bool(meta.is_paywalled) if meta else bool(source_config.get("is_paywalled"))


def _paywall_rate(stats: _ArticleStats, source_flagged_paywalled: bool) -> float:
    if stats.count:
        return _ratio(stats.paywalled, stats.count)
    return 1.0 if source_flagged_paywalled else 0.0


def _metric_rows(
    articles: _ArticleStats,
    lineage: _LineageStats,
    paywall_rate: float,
    policy_signal_count: int,
) -> list[dict[str, Any]]:
    return [
        {
            "id": "corrections",
            "label": "Corrections observed",
            "value": lineage.corrections,
            "unit": "records",
            "description": "Correction-watch records matched to this source.",
            "status": "observed" if lineage.corrections else "not_observed",
        },
        {
            "id": "original_reporting",
            "label": "Earliest in cluster",
            "value": lineage.originals,
            "unit": "stories",
            "description": "Story clusters where this source is the earliest detected article.",
            "status": "observed" if lineage.originals else "not_observed",
        },
        {
            "id": "wire_dependency",
            "label": "Wire dependency",
            "value": _ratio(lineage.wire_edges, lineage.downstream_edges),
            "unit": "share",
            "description": "Share of lineage edges into this source that look like wire reuse.",
            "status": "observed" if lineage.downstream_edges else "insufficient_data",
        },
        {
            "id": "paywall",
            "label": "Paywall rate",
            "value": paywall_rate,
            "unit": "share",
            "description": "Share of stored articles marked as paywalled, with source-level fallback.",
            "status": "observed" if articles.count else "source_metadata",
        },
        {
            "id": "author_transparency",
            "label": "Named bylines",
            "value": _ratio(articles.named_author, articles.count),
            "unit": "share",
            "description": "Share of stored articles with an author or byline list.",
            "status": "observed" if articles.count else "insufficient_data",
        },
        {
            "id": "source_transparency",
            "label": "Policy signals",
            "value": policy_signal_count,
            "unit": "signals",
            "description": "Disclosure signals from policy-transparency extraction.",
            "status": "observed" if policy_signal_count else "not_observed",
        },
    ]


def _ledger_payload(summary: _LedgerSummary) -> dict[str, Any]:
    articles = summary.articles
    lineage = summary.lineage
    return {
        "source_name": summary.source_name,
        "article_count": articles.count,
        "paywall": {
            "paywalled_articles": articles.paywalled,
            "free_articles": articles.free,
            "unknown_articles": articles.unknown_paywall,
            "paywall_rate": summary.paywall_rate,
            "source_flagged_paywalled": summary.source_flagged_paywalled,
        },
        "original_reporting": {
            "earliest_story_count": lineage.originals,
            "earliest_story_rate": _ratio(lineage.originals, articles.count),
        },
        "wire_dependency": {
            "wire_edge_count": lineage.wire_edges,
            "downstream_edge_count": lineage.downstream_edges,
            "wire_dependency_rate": _ratio(lineage.wire_edges, lineage.downstream_edges),
        },
        "author_transparency": {
            "named_author_articles": articles.named_author,
            "named_author_rate": _ratio(articles.named_author, articles.count),
        },
        "source_transparency": {
            "policy_signal_count": summary.policy_signal_count,
            "has_policy_signals": summary.policy_signal_count > 0,
        },
        "rss_health": _rss_health(summary.source_config),
        "metrics": _metric_rows(
            articles,
            lineage,
            summary.paywall_rate,
            summary.policy_signal_count,
        ),
    }


async def build_source_ledger(
    db: AsyncSession,
    *,
    source_name: str,
    matched_source_names: list[str],
    source_config: dict[str, Any],
    meta: SourceMetadata | None,
) -> dict[str, Any]:
    """Build transparent, observed source metrics without a single trust score."""
    articles = await _load_article_stats(db, matched_source_names)
    lineage = await _load_lineage_stats(db, matched_source_names)
    source_flagged_paywalled = _source_paywall_flag(meta, source_config)
    paywall_rate = _paywall_rate(articles, source_flagged_paywalled)
    policy_signal_count = _policy_signal_count(meta)
    return _ledger_payload(
        _LedgerSummary(
            source_name=source_name,
            articles=articles,
            lineage=lineage,
            source_flagged_paywalled=source_flagged_paywalled,
            paywall_rate=paywall_rate,
            policy_signal_count=policy_signal_count,
            source_config=source_config,
        )
    )
