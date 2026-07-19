"""Observed source ledger metrics for source wiki pages."""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import (
    Article,
    ArticleEdge,
    Correction,
    SourceMetadata,
    StoryCluster,
)

PAYWALL_LOCKED_STATUSES = {"hard_paywall", "paywalled", "metered", "subscription_required"}
PAYWALL_FREE_STATUSES = {"free", "open", "available"}


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
    return len([signal for signal in signals if isinstance(signal, dict)])


def _rss_health(source_config: dict[str, Any]) -> dict[str, Any]:
    explicit_status = str(source_config.get("status") or source_config.get("health") or "").strip()
    last_success = source_config.get("last_successful_fetch_at") or source_config.get(
        "last_success"
    )
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


async def build_source_ledger(
    db: AsyncSession,
    *,
    source_name: str,
    matched_source_names: list[str],
    source_config: dict[str, Any],
    meta: SourceMetadata | None,
) -> dict[str, Any]:
    """Build transparent, observed source metrics without a single trust score."""
    article_result = await db.execute(
        select(Article.id, Article.author, Article.authors, Article.paywall_status).where(
            Article.source.in_(matched_source_names)
        )
    )
    article_rows = article_result.all()
    article_count = len(article_rows)

    paywalled_count = 0
    free_count = 0
    unknown_paywall_count = 0
    named_author_count = 0
    for row in article_rows:
        status = str(row.paywall_status or "unknown").strip().lower()
        if status in PAYWALL_LOCKED_STATUSES:
            paywalled_count += 1
        elif status in PAYWALL_FREE_STATUSES:
            free_count += 1
        else:
            unknown_paywall_count += 1

        author = str(row.author or "").strip()
        authors = cast(list[str], row.authors or [])
        if author or any(str(item).strip() for item in authors):
            named_author_count += 1

    correction_count = await db.scalar(
        select(func.count(Correction.id)).where(Correction.source.in_(matched_source_names))
    )

    original_count = await db.scalar(
        select(func.count(StoryCluster.id))
        .join(Article, StoryCluster.earliest_article_id == Article.id)
        .where(Article.source.in_(matched_source_names))
    )

    target_article = aliased(Article)
    edge_result = await db.execute(
        select(ArticleEdge.relation, func.count(ArticleEdge.id))
        .join(target_article, ArticleEdge.to_article_id == target_article.id)
        .where(target_article.source.in_(matched_source_names))
        .group_by(ArticleEdge.relation)
    )
    edge_counts = {str(row[0]): int(row[1] or 0) for row in edge_result.all()}
    downstream_edge_count = sum(edge_counts.values())
    wire_dependency_count = edge_counts.get("same_wire_story", 0)

    policy_signal_count = _policy_signal_count(meta)
    is_source_paywalled = (
        bool(meta.is_paywalled) if meta else bool(source_config.get("is_paywalled"))
    )
    observed_paywall_rate = _ratio(paywalled_count, article_count)
    paywall_rate = observed_paywall_rate if article_count else (1.0 if is_source_paywalled else 0.0)

    metrics = [
        {
            "id": "corrections",
            "label": "Corrections observed",
            "value": int(correction_count or 0),
            "unit": "records",
            "description": "Correction-watch records matched to this source.",
            "status": "observed" if correction_count else "not_observed",
        },
        {
            "id": "original_reporting",
            "label": "Earliest in cluster",
            "value": int(original_count or 0),
            "unit": "stories",
            "description": "Story clusters where this source is the earliest detected article.",
            "status": "observed" if original_count else "not_observed",
        },
        {
            "id": "wire_dependency",
            "label": "Wire dependency",
            "value": _ratio(wire_dependency_count, downstream_edge_count),
            "unit": "share",
            "description": "Share of lineage edges into this source that look like wire reuse.",
            "status": "observed" if downstream_edge_count else "insufficient_data",
        },
        {
            "id": "paywall",
            "label": "Paywall rate",
            "value": paywall_rate,
            "unit": "share",
            "description": "Share of stored articles marked as paywalled, with source-level fallback.",
            "status": "observed" if article_count else "source_metadata",
        },
        {
            "id": "author_transparency",
            "label": "Named bylines",
            "value": _ratio(named_author_count, article_count),
            "unit": "share",
            "description": "Share of stored articles with an author or byline list.",
            "status": "observed" if article_count else "insufficient_data",
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

    return {
        "source_name": source_name,
        "article_count": article_count,
        "paywall": {
            "paywalled_articles": paywalled_count,
            "free_articles": free_count,
            "unknown_articles": unknown_paywall_count,
            "paywall_rate": paywall_rate,
            "source_flagged_paywalled": is_source_paywalled,
        },
        "original_reporting": {
            "earliest_story_count": int(original_count or 0),
            "earliest_story_rate": _ratio(int(original_count or 0), article_count),
        },
        "wire_dependency": {
            "wire_edge_count": wire_dependency_count,
            "downstream_edge_count": downstream_edge_count,
            "wire_dependency_rate": _ratio(wire_dependency_count, downstream_edge_count),
        },
        "author_transparency": {
            "named_author_articles": named_author_count,
            "named_author_rate": _ratio(named_author_count, article_count),
        },
        "source_transparency": {
            "policy_signal_count": policy_signal_count,
            "has_policy_signals": policy_signal_count > 0,
        },
        "rss_health": _rss_health(source_config),
        "metrics": metrics,
    }
