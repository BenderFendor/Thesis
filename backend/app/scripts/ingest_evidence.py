"""CLI entry point for the Phase 1 evidence-spine ingestors.

Usage:
    python -m app.scripts.ingest_evidence --source wikidata|littlesis|mbfc|edgar|ads_txt|all [--limit N]

Runs against the app's configured database (see `app.database.AsyncSessionLocal`).
Safe to run repeatedly -- see `app.services.evidence_ingest` for the
idempotency guarantees (deterministic document/snapshot ids, claim_hash
dedupe).

`--source edgar` ingests Exhibit-21 subsidiary lists for a fixed set of
public media parent companies (CIK map below); `--limit` there caps how many
of those parents are processed, not how many subsidiaries per filing.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import configure_logging, get_logger
from app.database import AsyncSessionLocal, init_db
from app.models.evidence import EntityExternalId
from app.services.atlas_graph_helpers import normalize_entity_label
from app.services.entity_backfill import _catalog_domain, _catalog_sources
from app.services.evidence_ingest import (
    IngestReport,
    ingest_ads_supply,
    ingest_edgar_subsidiaries,
    ingest_littlesis_ownership,
    ingest_mbfc_ownership,
    ingest_wikidata_ownership_claims,
    run_ownership_smoke_check,
)
from app.services.primary_source_adapters import (
    CapturedPayload,
    ingest_article_records,
    ingest_companies_house_records,
    ingest_corporate_records,
    ingest_fcc_records,
    ingest_gleif_records,
    ingest_irs_990_records,
    ingest_sellers_json_records,
    ingest_sponsorship_records,
    ingest_usaspending_records,
)

logger = get_logger(__name__)

# Public media parent companies with a fixed CIK -- ownership BFS scope for
# EDGAR per the Phase 1 plan (Warner Bros. Discovery, Comcast, News Corp, Fox
# Corp), not a bulk import of every filer.
EDGAR_PARENT_CIKS: dict[str, str] = {
    "1437107": "Warner Bros. Discovery, Inc.",
    "1166691": "Comcast Corporation",
    "1564708": "News Corporation",
    "1564709": "Fox Corporation",
}


def _print_report(report: IngestReport) -> None:
    print(f"[{report.source}]")
    print(f"  documents created:     {report.documents_created}")
    print(f"  snapshots created:     {report.snapshots_created}")
    print(f"  observations created:  {report.observations_created}")
    print(f"  claims created:        {report.claims_created}")
    print(f"  claims deduped:        {report.claims_deduped}")
    print(f"  accepted (tier-auto):  {report.accepted}")
    print(f"  candidates (review):   {report.candidates}")
    if report.acceptance_failures:
        print(f"  acceptance failures:   {len(report.acceptance_failures)}")
        for reason in report.acceptance_failures[:5]:
            print(f"    - {reason}")


def _catalog_domain_map() -> dict[str, str]:
    """Build a normalized outlet name -> domain map, for MBFC entity resolution."""
    result: dict[str, str] = {}
    for name, config in _catalog_sources().items():
        domain = _catalog_domain(config)
        if domain:
            result[normalize_entity_label(name)] = domain
    return result


async def _entity_id_for_domain(db: AsyncSession, domain: str) -> str | None:
    row = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "domain", EntityExternalId.value == domain
            )
        )
    ).scalar_one_or_none()
    return cast(str, row.entity_id) if row is not None else None


async def _catalog_publishers(db: AsyncSession) -> dict[str, str]:
    """Return publication entity id -> canonical website for ads.txt capture."""
    publishers: dict[str, str] = {}
    for _name, config in _catalog_sources().items():
        domain = _catalog_domain(config)
        website = cast(str | None, config.get("site_url") or config.get("url"))
        if not domain or not website:
            continue
        entity_id = await _entity_id_for_domain(db, domain)
        if entity_id:
            publishers[entity_id] = website
    return publishers


async def _entity_id_for_cik(db: AsyncSession, cik: str) -> str | None:
    row = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "cik", EntityExternalId.value == cik
            )
        )
    ).scalar_one_or_none()
    return cast(str, row.entity_id) if row is not None else None


async def _run_smoke_check(db: AsyncSession) -> None:
    """Run `compute_indirect_interest` for CNN->WBD and Fox News->Fox Corp.

    Resolves each outlet by the `domain` external id the catalog backfill
    attaches (see `entity_backfill.py`) and each parent by the `cik` external
    id the EDGAR ingestor attaches. A pair that doesn't resolve (e.g. EDGAR
    hasn't run yet, or a filing/page shape changed and no subsidiary matched)
    is reported as skipped rather than guessed at.
    """
    chains = [
        ("cnn.com", "1437107", "CNN -> Warner Bros. Discovery"),
        ("foxnews.com", "1564709", "Fox News -> Fox Corporation"),
    ]
    for domain, cik, label in chains:
        target_id = await _entity_id_for_domain(db, domain)
        owner_id = await _entity_id_for_cik(db, cik)
        if target_id is None or owner_id is None:
            print(
                f"  [skip] {label}: entity not yet resolved (target={target_id}, owner={owner_id})"
            )
            continue
        [trace] = await run_ownership_smoke_check(db, owner_target_pairs=[(owner_id, target_id)])
        aggregate = trace.get("aggregate")
        paths = cast(list[object], trace.get("paths") or [])
        print(f"  {label}: aggregate={aggregate!r} paths={len(paths)}")


async def main() -> None:
    """Parse CLI args, run the requested ingestor(s), then the ownership smoke check."""
    parser = argparse.ArgumentParser(description="Run Phase 1 evidence-spine ingestors")
    parser.add_argument(
        "--source",
        choices=[
            "wikidata",
            "littlesis",
            "mbfc",
            "edgar",
            "ads_txt",
            "gleif",
            "companies_house",
            "corporate_records",
            "irs_990",
            "usaspending",
            "fcc",
            "article_records",
            "sellers_json",
            "sponsorship",
            "all",
        ],
        required=True,
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--input",
        type=Path,
        help="Frozen JSON payload for a primary-source adapter; never enables network retrieval.",
    )
    parser.add_argument(
        "--skip-smoke-check",
        action="store_true",
        help="Skip the compute_indirect_interest smoke check after ingestion.",
    )
    args = parser.parse_args()

    configure_logging()
    await init_db()
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available for evidence ingestion")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)

    sources = (
        ["wikidata", "littlesis", "mbfc", "edgar", "ads_txt"]
        if args.source == "all"
        else [args.source]
    )

    broad_adapters = {
        "gleif": ingest_gleif_records,
        "companies_house": ingest_companies_house_records,
        "corporate_records": ingest_corporate_records,
        "irs_990": ingest_irs_990_records,
        "usaspending": ingest_usaspending_records,
        "fcc": ingest_fcc_records,
        "article_records": ingest_article_records,
        "sellers_json": ingest_sellers_json_records,
        "sponsorship": ingest_sponsorship_records,
    }
    broad_source = args.source in broad_adapters
    if broad_source and args.input is None:
        parser.error(f"--source {args.source} requires --input with frozen capture metadata")
    if args.source == "companies_house" and not os.getenv("COMPANIES_HOUSE_API_KEY"):
        parser.error("COMPANIES_HOUSE_API_KEY is required; no fallback source is permitted")

    async with factory() as db:
        for source in sources:
            if source == "wikidata":
                report = await ingest_wikidata_ownership_claims(db, limit=args.limit)
            elif source == "littlesis":
                report = await ingest_littlesis_ownership(db, limit=args.limit)
            elif source == "mbfc":
                report = await ingest_mbfc_ownership(
                    db, catalog_domains=_catalog_domain_map(), limit=args.limit
                )
            elif source == "edgar":
                ciks = dict(EDGAR_PARENT_CIKS)
                if args.limit is not None:
                    ciks = dict(list(ciks.items())[: args.limit])
                report = await ingest_edgar_subsidiaries(db, ciks=ciks)
            elif source == "ads_txt":
                report = await ingest_ads_supply(
                    db, publishers=await _catalog_publishers(db), limit=args.limit
                )
            elif source in broad_adapters:
                assert args.input is not None
                raw_input = json.loads(args.input.read_text(encoding="utf-8"))
                captured = raw_input["capture"]
                payload = CapturedPayload(
                    source_url=str(captured["source_url"]),
                    body=Path(str(captured["body_path"])).read_bytes(),
                    retrieved_at=datetime.fromisoformat(
                        str(captured["retrieved_at"]).replace("Z", "+00:00")
                    ).replace(tzinfo=None),
                    http_status=int(captured.get("http_status", 200)),
                    content_type=str(captured.get("content_type", "application/json")),
                )
                report = await broad_adapters[source](
                    db,
                    payload=payload,
                    records=cast(list[dict[str, object]], raw_input["records"]),
                )
            else:  # pragma: no cover - argparse choices already restrict this
                raise ValueError(f"unknown source {source!r}")
            await db.commit()
            _print_report(report)

        if not args.skip_smoke_check:
            print("\n[smoke check] compute_indirect_interest over ingested chains")
            # A null aggregate means the ownership *fact* was accepted but no
            # source supplied a quantified interest (SEC Exhibit 21 doesn't
            # disclose percentages; Wikidata rarely carries a P1107
            # proportion qualifier) -- not a pipeline failure. See
            # `ingest_edgar_subsidiaries`'s docstring.
            await _run_smoke_check(db)


if __name__ == "__main__":
    asyncio.run(main())
