"""Persistence for reporter claims and identity edges."""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Reporter, ReporterClaim, IdentityEdge, get_utc_now


async def store_reporter_claim(
    session: AsyncSession,
    reporter_id: int,
    claim_type: str,
    claim_value: str,
    source_type: str,
    source_url: str | None = None,
    confidence: float = 0.5,
) -> ReporterClaim:
    """Store a new reporter claim. Marks previous claims of same type as not current."""
    now = get_utc_now()

    await session.execute(
        update(ReporterClaim)
        .where(
            ReporterClaim.reporter_id == reporter_id,
            ReporterClaim.claim_type == claim_type,
            ReporterClaim.is_current.is_(True),
        )
        .values(is_current=False, valid_to=now)
    )

    claim = ReporterClaim(
        reporter_id=reporter_id,
        claim_type=claim_type,
        claim_value=claim_value,
        source_url=source_url,
        source_type=source_type,
        confidence=cast(Any, confidence),
        is_current=True,
        valid_from=now,
    )
    session.add(claim)
    await session.flush()

    count_stmt = select(func.count()).where(
        ReporterClaim.reporter_id == reporter_id,
        ReporterClaim.is_current.is_(True),
    )
    count = (await session.execute(count_stmt)).scalar() or 0
    await session.execute(
        update(Reporter).where(Reporter.id == reporter_id).values(claims_count=int(count))
    )

    await session.commit()
    return claim


async def get_reporter_claims(
    session: AsyncSession,
    reporter_id: int,
    claim_type: str | None = None,
    current_only: bool = True,
) -> list[ReporterClaim]:
    """Get claims for a reporter, optionally filtered by type."""
    stmt = select(ReporterClaim).where(ReporterClaim.reporter_id == reporter_id)
    if current_only:
        stmt = stmt.where(ReporterClaim.is_current.is_(True))
    if claim_type:
        stmt = stmt.where(ReporterClaim.claim_type == claim_type)
    stmt = stmt.order_by(ReporterClaim.created_at.desc())
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_claims_count(
    session: AsyncSession,
    reporter_id: int,
) -> int:
    """Count current claims for a reporter."""
    stmt = select(func.count()).where(
        ReporterClaim.reporter_id == reporter_id,
        ReporterClaim.is_current.is_(True),
    )
    result = await session.execute(stmt)
    return int(result.scalar() or 0)


async def store_identity_edge(
    session: AsyncSession,
    reporter_id: int,
    target_url: str,
    edge_type: str,
    source_url: str | None = None,
    confidence: float = 0.5,
) -> IdentityEdge:
    """Store a new identity edge."""
    exist_stmt = select(IdentityEdge).where(
        IdentityEdge.reporter_id == reporter_id,
        IdentityEdge.target_url == target_url,
        IdentityEdge.edge_type == edge_type,
    )
    existing = (await session.execute(exist_stmt)).scalar_one_or_none()
    if existing:
        cast(Any, existing).confidence = max(existing.confidence or 0.0, confidence)
        if source_url:
            existing.source_url = source_url
        await session.commit()
        return existing

    edge = IdentityEdge(
        reporter_id=reporter_id,
        target_url=target_url,
        edge_type=edge_type,
        source_url=source_url,
        confidence=cast(Any, confidence),
    )
    session.add(edge)
    await session.commit()
    return edge


async def get_identity_edges(
    session: AsyncSession,
    reporter_id: int,
    edge_type: str | None = None,
) -> list[IdentityEdge]:
    """Get identity edges for a reporter."""
    stmt = select(IdentityEdge).where(IdentityEdge.reporter_id == reporter_id)
    if edge_type:
        stmt = stmt.where(IdentityEdge.edge_type == edge_type)
    stmt = stmt.order_by(IdentityEdge.confidence.desc(), IdentityEdge.created_at.desc())
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def bulk_store_claims(
    session: AsyncSession,
    reporter_id: int,
    claims: list[dict[str, Any]],
) -> list[ReporterClaim]:
    """Store multiple claims at once. Each dict: claim_type, claim_value, source_type, source_url, confidence."""
    stored: list[ReporterClaim] = []
    now = get_utc_now()

    seen_types = set()
    for claim_data in claims:
        claim_type = claim_data.get("claim_type", "")
        seen_types.add(claim_type)
        claim = ReporterClaim(
            reporter_id=reporter_id,
            claim_type=claim_type,
            claim_value=claim_data.get("claim_value", ""),
            source_url=claim_data.get("source_url"),
            source_type=claim_data.get("source_type", ""),
            confidence=cast(Any, claim_data.get("confidence", 0.5)),
            is_current=True,
            valid_from=now,
        )
        session.add(claim)
        stored.append(claim)

    for claim_type in seen_types:
        await session.execute(
            update(ReporterClaim)
            .where(
                ReporterClaim.reporter_id == reporter_id,
                ReporterClaim.claim_type == claim_type,
                ReporterClaim.is_current.is_(True),
                ReporterClaim.id.notin_(
                    select(ReporterClaim.id)
                    .where(
                        ReporterClaim.reporter_id == reporter_id,
                        ReporterClaim.claim_type == claim_type,
                    )
                    .order_by(ReporterClaim.created_at.desc())
                    .limit(len([c for c in claims if c.get("claim_type") == claim_type]))
                ),
            )
            .values(is_current=False, valid_to=now)
        )

    await session.flush()

    count_stmt = select(func.count()).where(
        ReporterClaim.reporter_id == reporter_id,
        ReporterClaim.is_current.is_(True),
    )
    count = (await session.execute(count_stmt)).scalar() or 0
    await session.execute(
        update(Reporter).where(Reporter.id == reporter_id).values(claims_count=int(count))
    )

    await session.commit()
    return stored
