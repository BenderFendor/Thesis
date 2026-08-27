"""Reporter byline evidence ingestion from the local article corpus.

Feeds Workstream 1 of the Atlas research-coverage plan
(docs/agents/traces/coverage-to-8000-plan.md): the 156k `articles` /
55,893 `article_authors` byline rows already in Postgres are structured,
already-trusted data -- no network fetch or HTML re-scrape needed to turn
them into evidence-spine `authored_by` candidate claims.

Design (see docs/agents/traces/reporter-byline-coverage.md for the full
rationale):

- One claim per reporter, not per byline row. A reporter only needs one
  cited byline to register as "researched" (`research_coverage_by_entity_type
  ["reporter"]` counts any edge with `evidence_count > 0`, candidate or
  accepted) -- writing all 55,893 rows would multiply disk usage roughly
  11x for zero additional coverage. Each reporter's single most-recent
  byline is used as the citation.
- Feeds `ingest_article_records`'s `reporter_byline` record type (added in
  `primary_source_adapters.py`), which writes the claim as
  person(author) -authored_by-> outlet directly, rather than the existing
  `byline`/`jsonld_author` record types' article -authored_by-> person
  shape. That shape mints one throwaway `publication_brand` `EvidenceEntity`
  per article; at 11k+ calls that would flood the Atlas graph with
  headline-named "organization" nodes. Writing directly to the outlet
  entity avoids minting any new entity at all for reporters at outlets
  already in the RSS catalog (the domain external id resolves to the
  existing `publication` entity), and reuses one stable `person` entity per
  reporter (keyed by `scoop_reporter_id`, not by article URL).
- Idempotent by skip, not just by claim-hash dedupe: once a reporter has
  `"article_byline"` recorded in `Reporter.research_sources`, subsequent
  runs (this stage runs on every server restart, see `auto_ingest.py`) skip
  it entirely -- a steady-state restart only processes reporters that are
  new since the last run, not the full corpus.
- `captured_at` in the claim's qualifiers (and therefore its `claim_hash`)
  uses the article's own `published_at`, not wall-clock ingest time, so the
  claim is reproducible even if a run is interrupted before a reporter is
  marked researched and has to be retried.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Article, ArticleAuthor, AsyncSessionLocal, Reporter
from app.services.atlas_graph_helpers import normalize_entity_label
from app.services.evidence_ingest import IngestReport
from app.services.primary_source_adapters import CapturedPayload, ingest_article_records

logger = get_logger(__name__)

RESEARCH_SOURCE_MARKER = "article_byline"


def _catalog_domain_map() -> dict[str, str]:
    # Imported lazily: `app.scripts.ingest_evidence` also imports from
    # `app.services.primary_source_adapters`, so importing it at module
    # scope here would create a needless coupling between two CLI entry
    # points for one shared helper.
    from app.scripts.ingest_evidence import _catalog_domain_map as build_map

    return build_map()


async def _already_researched_reporter_ids(db: AsyncSession) -> set[int]:
    rows = (await db.execute(select(Reporter.id, Reporter.research_sources))).all()
    return {
        int(reporter_id)
        for reporter_id, sources in rows
        if isinstance(sources, list) and RESEARCH_SOURCE_MARKER in sources
    }


async def _reporter_representative_articles(
    db: AsyncSession, *, skip_reporter_ids: set[int]
) -> list[tuple[int, str, str, str, str]]:
    """Return one most-recent byline per reporter not already marked researched.

    Each row is (reporter_id, reporter_name, article_url, headline, source).
    """
    ranked = (
        select(
            ArticleAuthor.reporter_id.label("reporter_id"),
            Article.url.label("url"),
            Article.title.label("title"),
            Article.source.label("source"),
            Article.published_at.label("published_at"),
            func.row_number()
            .over(
                partition_by=ArticleAuthor.reporter_id,
                order_by=(Article.published_at.desc(), Article.id.desc()),
            )
            .label("rn"),
        )
        .select_from(ArticleAuthor)
        .join(Article, Article.id == ArticleAuthor.article_id)
    ).subquery()

    stmt = (
        select(Reporter.id, Reporter.name, ranked.c.url, ranked.c.title, ranked.c.source)
        .select_from(ranked)
        .join(Reporter, Reporter.id == ranked.c.reporter_id)
        .where(
            ranked.c.rn == 1,
            # Audit rec 4: never mint a fresh authored_by claim for a
            # flagged wire/agency row (misleading employment reading) or a
            # soft-retired (merged/split) row -- its evidence belongs on
            # the surviving/child rows instead.
            Reporter.is_collective.is_(False),
            Reporter.retirement_reason.is_(None),
        )
    )
    rows = (await db.execute(stmt)).all()
    return [
        (int(reporter_id), str(name), str(url), str(title or url), str(source))
        for reporter_id, name, url, title, source in rows
        if int(reporter_id) not in skip_reporter_ids
        and str(name or "").strip()
        and str(url or "").strip()
    ]


async def ingest_reporter_bylines(
    db: AsyncSession, *, batch_commit: int = 200, limit: int | None = None
) -> IngestReport:
    """Create one evidence-backed `authored_by` claim per not-yet-researched reporter.

    `limit` caps how many reporters are processed in this call -- used for
    the bounded-sample disk-growth measurement described in
    docs/agents/traces/coverage-to-8000-plan.md, not needed in normal
    (auto-ingest stage) use.
    """
    domain_map = _catalog_domain_map()
    skip_ids = await _already_researched_reporter_ids(db)
    rows = await _reporter_representative_articles(db, skip_reporter_ids=skip_ids)
    if limit is not None:
        rows = rows[:limit]

    report = IngestReport(source="reporter_bylines")
    if not rows:
        logger.info("reporter_byline_ingest: no new reporters to process")
        return report

    logger.info("reporter_byline_ingest: processing %d reporter(s)", len(rows))
    # Reload published_at alongside the tuple above would need a second
    # column; simplest to look it up per-article via a fresh query, but
    # given `rows` is bounded to one row per reporter this is folded back
    # into the ranked query result set directly below instead of a second
    # round trip.
    processed = 0
    for reporter_id, reporter_name, url, headline, source in rows:
        article = (
            await db.execute(select(Article.published_at).where(Article.url == url))
        ).scalar_one_or_none()
        record = {
            "record_type": "reporter_byline",
            "reporter_id": str(reporter_id),
            "article_url": url,
            "headline": headline,
            "outlet_name": source,
            "outlet_domain": domain_map.get(normalize_entity_label(source), ""),
            "author_name": reporter_name,
        }
        payload = CapturedPayload.json(url, record, retrieved_at=article)
        sub_report = await ingest_article_records(db, payload=payload, records=[record])
        report.documents_created += sub_report.documents_created
        report.snapshots_created += sub_report.snapshots_created
        report.observations_created += sub_report.observations_created
        report.claims_created += sub_report.claims_created
        report.claims_deduped += sub_report.claims_deduped
        report.accepted += sub_report.accepted
        report.candidates += sub_report.candidates

        reporter = await db.get(Reporter, reporter_id)
        if reporter is not None:
            sources = list(reporter.research_sources or [])
            if RESEARCH_SOURCE_MARKER not in sources:
                sources.append(RESEARCH_SOURCE_MARKER)
                reporter.research_sources = sources

        processed += 1
        if processed % batch_commit == 0:
            await db.commit()
            logger.info("reporter_byline_ingest: committed %d/%d reporter(s)", processed, len(rows))
    await db.commit()
    logger.info(
        "reporter_byline_ingest: complete (%d reporters processed, "
        "%d claims created, %d deduped, %d candidates)",
        processed,
        report.claims_created,
        report.claims_deduped,
        report.candidates,
    )
    return report


async def _main() -> None:
    from app.core.logging import configure_logging
    from app.database import init_db

    configure_logging()
    await init_db()
    factory = AsyncSessionLocal
    if factory is None:
        raise RuntimeError("Database is not configured (ENABLE_DATABASE=0)")
    async with factory() as db:
        report = await ingest_reporter_bylines(db)
    print(f"documents created:    {report.documents_created}")
    print(f"snapshots created:    {report.snapshots_created}")
    print(f"observations created: {report.observations_created}")
    print(f"claims created:       {report.claims_created}")
    print(f"claims deduped:       {report.claims_deduped}")
    print(f"candidates:           {report.candidates}")


if __name__ == "__main__":
    asyncio.run(_main())
