"""Reproducible article and ownership measurements for Atlas dossiers."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Article, ArticleAuthor, Reporter
from app.models.evidence import AcceptedRelationship, CalculationTrace, EvidenceEntity
from app.services.evidence_spine import stable_hash

METHOD_VERSION = "media_measurements/1.0"
_CORRECTION_MARKERS = ("correction:", "corrected:", "editor's note:", "retraction:")
_SYNDICATION_MARKERS = ("reuters", "associated press", " republished with permission")


def _window(articles: list[Article]) -> dict[str, str | None]:
    dates = sorted(cast(datetime, article.published_at) for article in articles)
    return {
        "start": dates[0].isoformat() if dates else None,
        "end": dates[-1].isoformat() if dates else None,
    }


async def _persist_trace(
    db: AsyncSession,
    *,
    measurement_name: str,
    corpus_window: dict[str, str | None],
    denominator: int,
    coverage_numerator: int,
    result: dict[str, Any],
    subgraph: dict[str, Any],
    input_claim_ids: list[str] | None = None,
) -> CalculationTrace:
    payload = {
        "corpus_window": corpus_window,
        "denominator": denominator,
        "coverage": {"numerator": coverage_numerator, "denominator": denominator},
        "method_version": METHOD_VERSION,
        **result,
    }
    trace_id = (
        f"calc_{stable_hash(measurement_name, payload, subgraph, input_claim_ids or [])[:32]}"
    )
    existing = await db.get(CalculationTrace, trace_id)
    if existing is not None:
        return existing
    trace = CalculationTrace(
        id=trace_id,
        relationship_id=None,
        measurement_name=measurement_name,
        input_claim_ids=input_claim_ids or [],
        subgraph=subgraph,
        algorithm_version=METHOD_VERSION,
        result=payload,
    )
    db.add(trace)
    await db.flush()
    return trace


async def _author_rows(
    db: AsyncSession, articles: list[Article]
) -> list[tuple[ArticleAuthor, Reporter]]:
    article_ids = [article.id for article in articles]
    if not article_ids:
        return []
    return list(
        (
            await db.execute(
                select(ArticleAuthor, Reporter)
                .join(Reporter, Reporter.id == ArticleAuthor.reporter_id)
                .where(ArticleAuthor.article_id.in_(article_ids))
                .order_by(ArticleAuthor.article_id, Reporter.name)
            )
        )
        .tuples()
        .all()
    )


async def _publication_cadence_trace(
    db: AsyncSession,
    *,
    articles: list[Article],
    corpus_window: dict[str, str | None],
    source_name: str | None,
) -> CalculationTrace:
    denominator = len(articles)
    unique_days = len({cast(datetime, article.published_at).date() for article in articles})
    span_days = (
        max(
            1,
            (
                cast(datetime, articles[-1].published_at) - cast(datetime, articles[0].published_at)
            ).days
            + 1,
        )
        if articles
        else 0
    )
    return await _persist_trace(
        db,
        measurement_name="publication_cadence",
        corpus_window=corpus_window,
        denominator=denominator,
        coverage_numerator=denominator,
        result={
            "article_count": denominator,
            "active_days": unique_days,
            "span_days": span_days,
            "articles_per_day": format(denominator / span_days, ".6f") if span_days else None,
        },
        subgraph={
            "source_name": source_name,
            "article_ids": [article.id for article in articles],
        },
    )


async def _corrections_retractions_trace(
    db: AsyncSession,
    *,
    articles: list[Article],
    corpus_window: dict[str, str | None],
) -> CalculationTrace:
    corrected = []
    retracted = []
    for article in articles:
        searchable = f"{article.title}\n{article.content or ''}".lower()
        if any(marker in searchable for marker in _CORRECTION_MARKERS):
            corrected.append(article.id)
        if "retraction:" in searchable or "retracted" in searchable:
            retracted.append(article.id)
    return await _persist_trace(
        db,
        measurement_name="corrections_retractions",
        corpus_window=corpus_window,
        denominator=len(articles),
        coverage_numerator=sum(article.content is not None for article in articles),
        result={"correction_count": len(corrected), "retraction_count": len(retracted)},
        subgraph={"corrected_article_ids": corrected, "retracted_article_ids": retracted},
    )


async def _byline_coauthor_trace(
    db: AsyncSession,
    *,
    articles: list[Article],
    author_rows: list[tuple[ArticleAuthor, Reporter]],
    corpus_window: dict[str, str | None],
) -> CalculationTrace:
    by_article: dict[int, list[str]] = defaultdict(list)
    for author_link, reporter in author_rows:
        by_article[cast(int, author_link.article_id)].append(cast(str, reporter.name))
    coauthor_pairs: Counter[tuple[str, str]] = Counter()
    for names in by_article.values():
        ordered = sorted(set(names))
        for left_index, left in enumerate(ordered):
            for right in ordered[left_index + 1 :]:
                coauthor_pairs[(left, right)] += 1
    return await _persist_trace(
        db,
        measurement_name="byline_coauthor_network",
        corpus_window=corpus_window,
        denominator=len(articles),
        coverage_numerator=len(by_article),
        result={
            "unique_reporters": len({name for names in by_article.values() for name in names}),
            "coauthor_edges": [
                {"reporter_a": pair[0], "reporter_b": pair[1], "article_count": count}
                for pair, count in sorted(coauthor_pairs.items())
            ],
        },
        subgraph={"article_authors": by_article},
    )


async def _original_vs_syndicated_trace(
    db: AsyncSession,
    *,
    articles: list[Article],
    corpus_window: dict[str, str | None],
) -> CalculationTrace:
    syndicated_ids = []
    for article in articles:
        searchable = (
            f"{article.author or ''} {' '.join(article.tags or [])} {article.content or ''}".lower()
        )
        if any(marker in searchable for marker in _SYNDICATION_MARKERS):
            syndicated_ids.append(article.id)
    return await _persist_trace(
        db,
        measurement_name="original_vs_syndicated",
        corpus_window=corpus_window,
        denominator=len(articles),
        coverage_numerator=sum(
            bool(article.content or article.author or article.tags) for article in articles
        ),
        result={
            "syndicated_count": len(syndicated_ids),
            "original_or_unmarked_count": len(articles) - len(syndicated_ids),
        },
        subgraph={
            "syndicated_article_ids": syndicated_ids,
            "classification": "explicit_marker_only",
        },
    )


async def _reporter_movement_trace(
    db: AsyncSession,
    *,
    articles: list[Article],
    author_rows: list[tuple[ArticleAuthor, Reporter]],
    corpus_window: dict[str, str | None],
) -> CalculationTrace:
    reporter_sources: dict[str, list[tuple[datetime, str]]] = defaultdict(list)
    articles_by_id = {cast(int, article.id): article for article in articles}
    for author_link, reporter in author_rows:
        linked_article = articles_by_id.get(cast(int, author_link.article_id))
        if linked_article is not None:
            reporter_sources[cast(str, reporter.name)].append(
                (
                    cast(datetime, linked_article.published_at),
                    cast(str, linked_article.source),
                )
            )
    movements: list[dict[str, str]] = []
    for reporter_name, events in reporter_sources.items():
        previous: str | None = None
        for event_date, source in sorted(events):
            if previous is not None and source != previous:
                movements.append(
                    {
                        "reporter": reporter_name,
                        "from": previous,
                        "to": source,
                        "observed_at": event_date.isoformat(),
                    }
                )
            previous = source
    return await _persist_trace(
        db,
        measurement_name="reporter_movement",
        corpus_window=corpus_window,
        denominator=len(reporter_sources),
        coverage_numerator=len(reporter_sources),
        result={"observed_movements": movements, "movement_count": len(movements)},
        subgraph={
            "reporter_sources": {
                name: [(date.isoformat(), source) for date, source in events]
                for name, events in reporter_sources.items()
            }
        },
    )


async def _ownership_concentration_trace(db: AsyncSession) -> CalculationTrace:
    ownership_rows = list(
        (
            await db.execute(
                select(AcceptedRelationship).where(
                    AcceptedRelationship.predicate.in_(
                        ("directly_owns", "controls", "owns_equity_in")
                    ),
                    AcceptedRelationship.status == "accepted",
                    AcceptedRelationship.lifecycle_state == "current",
                    AcceptedRelationship.valid_to.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    owner_counts = Counter(cast(str, row.object_entity_id) for row in ownership_rows)
    total_links = len(ownership_rows)
    hhi = (
        sum((count / total_links) ** 2 for count in owner_counts.values()) if total_links else None
    )
    owner_ids = list(owner_counts)
    owner_names = {
        cast(str, entity.id): cast(str, entity.canonical_name)
        for entity in (
            list(
                (await db.execute(select(EvidenceEntity).where(EvidenceEntity.id.in_(owner_ids))))
                .scalars()
                .all()
            )
            if owner_ids
            else []
        )
    }
    return await _persist_trace(
        db,
        measurement_name="ownership_concentration",
        corpus_window={"start": None, "end": None},
        denominator=total_links,
        coverage_numerator=total_links,
        result={
            "herfindahl_hirschman_index": format(hhi, ".6f") if hhi is not None else None,
            "owners": [
                {
                    "entity_id": owner_id,
                    "name": owner_names.get(owner_id, owner_id),
                    "current_relationships": count,
                }
                for owner_id, count in owner_counts.most_common()
            ],
        },
        subgraph={"relationship_ids": [cast(str, row.id) for row in ownership_rows]},
        input_claim_ids=[],
    )


async def calculate_media_measurements(
    db: AsyncSession, *, source_name: str | None = None
) -> list[CalculationTrace]:
    """Calculate six versioned measurements and persist their full traces.

    ``source_name`` scopes article-based results to one outlet. Ownership
    concentration remains a graph-wide measure because its denominator is the
    set of accepted current ownership relationships.
    """
    statement = select(Article)
    if source_name:
        statement = statement.where(Article.source == source_name)
    articles = list((await db.execute(statement.order_by(Article.published_at))).scalars().all())
    corpus_window = _window(articles)
    author_rows = await _author_rows(db, articles)
    return [
        await _publication_cadence_trace(
            db, articles=articles, corpus_window=corpus_window, source_name=source_name
        ),
        await _corrections_retractions_trace(db, articles=articles, corpus_window=corpus_window),
        await _byline_coauthor_trace(
            db, articles=articles, author_rows=author_rows, corpus_window=corpus_window
        ),
        await _original_vs_syndicated_trace(db, articles=articles, corpus_window=corpus_window),
        await _reporter_movement_trace(
            db, articles=articles, author_rows=author_rows, corpus_window=corpus_window
        ),
        await _ownership_concentration_trace(db),
    ]


__all__ = ["METHOD_VERSION", "calculate_media_measurements"]
