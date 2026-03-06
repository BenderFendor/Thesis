"""
Verification API routes.

Provides endpoints for:
- POST /api/verification/verify - Verify research claims
- GET /api/verification/status - Check if verification is enabled
- DELETE /api/verification/cache - Clear expired cache entries
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable
from importlib import import_module
from typing import Any, Dict, Protocol, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.database import get_db
from app.models.verification import (
    SourceInfo,
    VerificationRequest,
    VerificationResult,
    VerificationStreamEvent,
    VerifiedClaim,
)

logger = get_logger("api.verification")

router = APIRouter(prefix="/api/verification", tags=["verification"])


class _VerifyResearchFn(Protocol):
    def __call__(
        self,
        request: VerificationRequest,
        db: AsyncSession,
    ) -> Awaitable[VerificationResult]: ...


class _CleanupExpiredCacheFn(Protocol):
    def __call__(self, db: AsyncSession) -> Awaitable[int]: ...


class _FormatJsonResponseFn(Protocol):
    def __call__(
        self,
        claims: list[VerifiedClaim],
        sources: dict[str, SourceInfo],
        overall_confidence: float,
    ) -> dict[str, Any]: ...


class _CleanupStaleWorkspacesFn(Protocol):
    def __call__(self, max_age_hours: int = 24) -> int: ...


async def _verify_research(
    request: VerificationRequest,
    db: AsyncSession,
) -> VerificationResult:
    verify = cast(
        _VerifyResearchFn,
        getattr(import_module("app.services.verification_agent"), "verify_research"),
    )
    return await verify(request, db)


async def _cleanup_expired_cache(db: AsyncSession) -> int:
    cleanup = cast(
        _CleanupExpiredCacheFn,
        getattr(
            import_module("app.services.verification_agent"),
            "cleanup_expired_cache",
        ),
    )
    return await cleanup(db)


def _format_json_response(
    claims: list[VerifiedClaim],
    sources: dict[str, SourceInfo],
    overall_confidence: float,
) -> dict[str, Any]:
    formatter = cast(
        _FormatJsonResponseFn,
        getattr(
            import_module("app.services.verification_output"),
            "format_json_response",
        ),
    )
    return formatter(claims, sources, overall_confidence)


def _cleanup_stale_workspaces(max_age_hours: int = 24) -> int:
    cleanup = cast(
        _CleanupStaleWorkspacesFn,
        getattr(
            import_module("app.services.verification_sandbox"),
            "cleanup_stale_workspaces",
        ),
    )
    return cleanup(max_age_hours)


@router.get("/status")
async def get_verification_status() -> Dict[str, Any]:
    """Check verification agent status and configuration."""
    return {
        "enabled": settings.enable_verification,
        "max_duration_seconds": settings.verification_max_duration_seconds,
        "max_claims": settings.verification_max_claims,
        "max_sources_per_claim": settings.verification_max_sources_per_claim,
        "cache_ttl_hours": settings.verification_cache_ttl_hours,
        "recheck_threshold": settings.verification_recheck_threshold,
        "allowed_domains_count": len(settings.verification_allowed_domains),
    }


@router.post("/verify")
async def verify_claims(
    request: VerificationRequest,
    db: AsyncSession = Depends(get_db),
) -> VerificationResult:
    """
    Verify claims from research output.

    Request body:
    - query: The original research query
    - main_answer: The research agent's response text
    - main_findings: Optional list of structured findings

    Returns verification result with:
    - overall_confidence: 0.0-1.0 score
    - verified_claims: List of claims with confidence levels
    - sources: Dictionary of source information
    - markdown_report: Formatted report with footnotes
    """
    if not settings.enable_verification:
        raise HTTPException(
            status_code=503,
            detail="Verification is disabled",
        )

    logger.info("Verification requested for query: %s", request.query[:100])

    try:
        result = await asyncio.wait_for(
            _verify_research(request, db),
            timeout=settings.verification_max_duration_seconds + 5,
        )

        logger.info(
            "Verification complete: %d claims, %.0f%% confidence, %dms",
            len(result.verified_claims),
            result.overall_confidence * 100,
            result.duration_ms,
        )

        return result

    except asyncio.TimeoutError:
        logger.warning("Verification timed out for query: %s", request.query[:50])
        raise HTTPException(
            status_code=504,
            detail="Verification timed out",
        )
    except Exception as exc:
        logger.error("Verification failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Verification failed: {exc}",
        )


@router.post("/verify/stream")
async def verify_claims_stream(
    request: VerificationRequest,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    Stream verification progress as Server-Sent Events.

    Events:
    - type: "started" - Verification begun
    - type: "claim" - Individual claim verified
    - type: "progress" - Progress update (0.0-1.0)
    - type: "complete" - Final result
    - type: "error" - Error occurred
    """
    if not settings.enable_verification:
        raise HTTPException(
            status_code=503,
            detail="Verification is disabled",
        )

    async def generate() -> AsyncIterator[str]:
        import json

        yield f"data: {json.dumps({'type': 'started', 'query': request.query})}\n\n"

        try:
            result = await _verify_research(request, db)

            for i, claim in enumerate(result.verified_claims):
                progress = (i + 1) / max(len(result.verified_claims), 1)
                event = VerificationStreamEvent(
                    type="claim",
                    claim=claim,
                    progress=progress,
                )
                yield f"data: {event.model_dump_json()}\n\n"
                await asyncio.sleep(0)

            final_event = VerificationStreamEvent(
                type="complete",
                result=result,
            )
            yield f"data: {final_event.model_dump_json()}\n\n"

        except Exception as exc:
            logger.error("Stream verification failed: %s", exc)
            error_event = VerificationStreamEvent(
                type="error",
                content=str(exc),
            )
            yield f"data: {error_event.model_dump_json()}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/verify/json")
async def verify_claims_json(
    request: VerificationRequest,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Verify claims and return structured JSON response.

    Returns a summary-focused format for frontend widgets.
    """
    if not settings.enable_verification:
        raise HTTPException(
            status_code=503,
            detail="Verification is disabled",
        )

    result = await _verify_research(request, db)

    return _format_json_response(
        result.verified_claims,
        result.sources,
        result.overall_confidence,
    )


@router.delete("/cache")
async def clear_cache(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Clear expired verification cache entries.

    Also cleans up stale sandbox workspaces.
    """
    deleted_cache = await _cleanup_expired_cache(db)

    background_tasks.add_task(_cleanup_stale_workspaces, 24)

    return {
        "deleted_cache_entries": deleted_cache,
        "workspace_cleanup": "scheduled",
    }


@router.get("/domains")
async def list_allowed_domains() -> Dict[str, Any]:
    """List domains allowed for verification source searches."""
    return {
        "count": len(settings.verification_allowed_domains),
        "domains": list(settings.verification_allowed_domains),
    }
