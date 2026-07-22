"""CLI entry point for the Phase 0 entity-model backfill.

Usage:
    python -m app.scripts.backfill_entities

Safe to run repeatedly -- see `app.services.entity_backfill` for the
idempotency guarantees.
"""

from __future__ import annotations

import asyncio
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import configure_logging, get_logger
from app.database import AsyncSessionLocal, init_db
from app.services.entity_backfill import run_backfill

logger = get_logger(__name__)


async def main() -> None:
    """Run the backfill against the app's configured database."""
    configure_logging()
    await init_db()

    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available for entity backfill")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)

    async with factory() as db:
        report = await run_backfill(db)
        await db.commit()

    print("Entity backfill complete:")
    print(f"  catalog entities created:            {report.catalog_entities_created}")
    print(f"  catalog entities already resolved:   {report.catalog_entities_matched}")
    print(f"  publisher orgs auto-merged:          {report.publisher_merged}")
    print(f"  publisher orgs sent to adjudication:  {report.publisher_adjudicated}")
    print(f"  publisher orgs already processed:    {report.publisher_skipped_already_processed}")
    print(f"  legal entities created:              {report.legal_entities_created}")
    print(f"  legal entities already resolved:     {report.legal_entities_matched}")


if __name__ == "__main__":
    asyncio.run(main())
