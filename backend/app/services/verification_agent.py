"""
Verification agent for cross-referencing research claims.

Extracts claims from research output, searches for supporting/conflicting sources,
calculates confidence scores, and generates verification reports.

Design:
- Runs in parallel with main research agent (fire and forget)
- Uses sandbox for isolated workspace
- Respects timeout limits (15s default)
- Caches verified claims to avoid redundant checks
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple, cast

from ddgs import DDGS
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.database import VerificationCache
from app.models.verification import (
    ConfidenceLevel,
    SourceInfo,
    SourceType,
    VerificationRequest,
    VerificationResult,
    VerificationStreamEvent,
    VerifiedClaim,
)
from app.services.source_credibility import CredibilityScorer, get_scorer_with_db
from app.services.verification_sandbox import VerificationSandbox

logger = get_logger("verification_agent")


def _confidence_to_level(confidence: float) -> ConfidenceLevel:
    """Convert numeric confidence to level."""
    if confidence >= 0.8:
        return ConfidenceLevel.HIGH
    if confidence >= 0.5:
        return ConfidenceLevel.MEDIUM
    if confidence >= 0.2:
        return ConfidenceLevel.LOW
    return ConfidenceLevel.VERY_LOW


def _hash_claim(claim_text: str) -> str:
    """Generate consistent hash for claim text."""
    normalized = " ".join(claim_text.lower().split())
    return hashlib.sha256(normalized.encode()).hexdigest()[:32]


class VerificationAgent:
    """
    Cross-references research claims against multiple sources.

    Usage:
        async with VerificationAgent(db) as agent:
            result = await agent.verify(request)
    """

    def __init__(
        self,
        db: Optional[AsyncSession] = None,
        session_id: Optional[str] = None,
    ):
        self.db = db
        self.session_id = session_id
        self.sandbox: Optional[VerificationSandbox] = None
        self.scorer: Optional[CredibilityScorer] = None
        self._start_time: Optional[float] = None
        self._sources: Dict[str, SourceInfo] = {}
        self._footnote_counter = 0

    async def __aenter__(self) -> "VerificationAgent":
        self.sandbox = VerificationSandbox(self.session_id)
        if self.db:
            self.scorer = await get_scorer_with_db(self.db)
        else:
            from app.services.source_credibility import get_scorer

            self.scorer = get_scorer()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self.sandbox:
            self.sandbox.cleanup()

    def _time_remaining_ms(self) -> int:
        """Get remaining time before timeout in milliseconds."""
        if not self._start_time:
            return settings.verification_max_duration_seconds * 1000
        elapsed = (time.time() - self._start_time) * 1000
        remaining = (settings.verification_max_duration_seconds * 1000) - elapsed
        return max(0, int(remaining))

    def _should_abort(self) -> bool:
        """Check if we should abort due to timeout."""
        return self._time_remaining_ms() < 500

    async def verify(
        self,
        request: VerificationRequest,
    ) -> VerificationResult:
        """
        Verify claims from research output.

        Steps:
        1. Extract claims from main_answer
        2. Check cache for previously verified claims
        3. Search for supporting/conflicting sources
        4. Calculate confidence scores
        5. Generate verification result
        """
        self._start_time = time.time()
        self._sources = {}
        self._footnote_counter = 0

        try:
            claims_text = self._extract_claims(request.main_answer or "")

            if not claims_text:
                return VerificationResult(
                    query=request.query,
                    overall_confidence=0.0,
                    overall_confidence_level=ConfidenceLevel.VERY_LOW,
                    verified_claims=[],
                    sources={},
                    markdown_report="No verifiable claims found in the response.",
                    duration_ms=int((time.time() - self._start_time) * 1000),
                )

            claims_text = claims_text[: settings.verification_max_claims]

            verified_claims: List[VerifiedClaim] = []
            for claim_text in claims_text:
                if self._should_abort():
                    logger.info("Verification timeout, stopping early")
                    break

                verified = await self._verify_single_claim(claim_text)
                if verified:
                    verified_claims.append(verified)

            overall_confidence = self._calculate_overall_confidence(verified_claims)

            from app.services.verification_output import format_markdown_report

            markdown = format_markdown_report(
                verified_claims,
                self._sources,
                overall_confidence,
            )

            duration_ms = int((time.time() - self._start_time) * 1000)

            return VerificationResult(
                query=request.query,
                overall_confidence=overall_confidence,
                overall_confidence_level=_confidence_to_level(overall_confidence),
                verified_claims=verified_claims,
                sources=self._sources,
                markdown_report=markdown,
                duration_ms=duration_ms,
            )

        except Exception as exc:
            logger.error("Verification failed: %s", exc, exc_info=True)
            duration_ms = int((time.time() - self._start_time) * 1000)
            return VerificationResult(
                query=request.query,
                overall_confidence=0.0,
                overall_confidence_level=ConfidenceLevel.VERY_LOW,
                verified_claims=[],
                sources={},
                markdown_report="",
                duration_ms=duration_ms,
                error=str(exc),
            )

    def _extract_claims(self, text: str) -> List[str]:
        """
        Extract verifiable factual claims from text.

        Looks for:
        - Statements with numbers/statistics
        - Quotes attributed to people
        - Date-specific events
        - Comparative statements
        """
        if not text:
            return []

        sentences = re.split(r"(?<=[.!?])\s+", text)
        claims = []

        for sentence in sentences:
            sentence = sentence.strip()
            if len(sentence) < 20 or len(sentence) > 500:
                continue

            if self._is_verifiable_claim(sentence):
                claims.append(sentence)

        return claims

    def _is_verifiable_claim(self, sentence: str) -> bool:
        """Determine if a sentence contains a verifiable claim."""
        has_number = bool(re.search(r"\d+", sentence))
        has_quote = '"' in sentence or "'" in sentence
        has_date = bool(
            re.search(
                r"\b(january|february|march|april|may|june|july|august|"
                r"september|october|november|december|\d{4})\b",
                sentence.lower(),
            )
        )
        has_attribution = bool(
            re.search(
                r"\b(said|stated|reported|announced|according to|"
                r"claims|confirmed|denied)\b",
                sentence.lower(),
            )
        )
        has_comparison = bool(
            re.search(
                r"\b(more than|less than|greater|fewer|increased|decreased|"
                r"rose|fell|dropped|surged)\b",
                sentence.lower(),
            )
        )

        meta_patterns = [
            r"^(note|remember|keep in mind|it'?s important)",
            r"^(in summary|to summarize|in conclusion)",
            r"^(for more information|see also|related)",
        ]
        is_meta = any(re.search(p, sentence.lower()) for p in meta_patterns)

        if is_meta:
            return False

        return has_number or has_quote or has_date or has_attribution or has_comparison

    async def _verify_single_claim(
        self,
        claim_text: str,
    ) -> Optional[VerifiedClaim]:
        """Verify a single claim by searching for sources."""
        claim_hash = _hash_claim(claim_text)

        cached = await self._check_cache(claim_hash)
        if cached:
            logger.debug("Cache hit for claim: %s", claim_text[:50])
            return cached

        sources = await self._search_sources(claim_text)

        if not sources:
            verified = VerifiedClaim(
                id=claim_hash,
                claim_text=claim_text,
                confidence=0.2,
                confidence_level=ConfidenceLevel.LOW,
                supporting_sources=[],
                conflicting_sources=[],
                footnotes=[],
                needs_recheck=True,
                recheck_reason="No sources found",
            )
        else:
            supporting = [s.id for s in sources if s.supports_claim]
            conflicting = [s.id for s in sources if not s.supports_claim]

            confidence = (
                self.scorer.calculate_claim_confidence(sources) if self.scorer else 0.5
            )

            footnotes = []
            for source in sources:
                self._footnote_counter += 1
                footnotes.append(self._footnote_counter)
                self._sources[source.id] = source

            needs_recheck = confidence < settings.verification_recheck_threshold

            verified = VerifiedClaim(
                id=claim_hash,
                claim_text=claim_text,
                confidence=confidence,
                confidence_level=_confidence_to_level(confidence),
                supporting_sources=supporting,
                conflicting_sources=conflicting,
                footnotes=footnotes,
                needs_recheck=needs_recheck,
                recheck_reason="Low confidence" if needs_recheck else None,
            )

        await self._cache_claim(verified)

        return verified

    async def _check_cache(self, claim_hash: str) -> Optional[VerifiedClaim]:
        """Check if claim is in cache and still valid."""
        if not self.db:
            return None

        try:
            result = await self.db.execute(
                select(VerificationCache).where(
                    VerificationCache.claim_hash == claim_hash,
                    VerificationCache.expires_at > datetime.now(timezone.utc),
                )
            )
            cached = result.scalar_one_or_none()

            if not cached:
                return None

            sources_data = cached.sources_json or []
            for source_dict in sources_data:
                source = SourceInfo(**source_dict)
                self._sources[source.id] = source
                self._footnote_counter += 1

            return VerifiedClaim(
                id=claim_hash,
                claim_text=cached.claim_text,
                confidence=cached.confidence,
                confidence_level=ConfidenceLevel(cached.confidence_level),
                supporting_sources=[
                    s["id"] for s in sources_data if s.get("supports_claim", True)
                ],
                conflicting_sources=[
                    s["id"] for s in sources_data if not s.get("supports_claim", True)
                ],
                footnotes=list(range(1, len(sources_data) + 1)),
                needs_recheck=False,
            )
        except Exception as exc:
            logger.warning("Cache check failed: %s", exc)
            return None

    async def _cache_claim(self, claim: VerifiedClaim) -> None:
        """Cache verified claim for future lookups."""
        if not self.db:
            return

        try:
            sources_json = [
                self._sources[sid].model_dump()
                for sid in claim.supporting_sources + claim.conflicting_sources
                if sid in self._sources
            ]

            expires_at = datetime.now(timezone.utc) + timedelta(
                hours=settings.verification_cache_ttl_hours
            )

            cache_entry = VerificationCache(
                claim_hash=claim.id,
                claim_text=claim.claim_text,
                confidence=claim.confidence,
                confidence_level=claim.confidence_level.value,
                sources_json=sources_json,
                expires_at=expires_at,
            )

            await self.db.merge(cache_entry)
            await self.db.commit()
        except Exception as exc:
            logger.warning("Cache write failed: %s", exc)

    async def _search_sources(
        self,
        claim_text: str,
    ) -> List[SourceInfo]:
        """
        Search for sources that support or contradict the claim.

        Strategy:
        1. Search internal sources first (ChromaDB + PostgreSQL)
        2. Supplement with DuckDuckGo for external verification
        """
        sources: List[SourceInfo] = []
        max_sources = settings.verification_max_sources_per_claim
        seen_urls: set[str] = set()

        internal_sources = await self._search_internal_sources(claim_text)
        for source in internal_sources:
            if len(sources) >= max_sources:
                break
            if source.url not in seen_urls:
                seen_urls.add(source.url)
                sources.append(source)

        if len(sources) < max_sources:
            remaining = max_sources - len(sources)
            external_sources = await self._search_external_sources(
                claim_text, remaining
            )
            for source in external_sources:
                if len(sources) >= max_sources:
                    break
                if source.url not in seen_urls:
                    seen_urls.add(source.url)
                    sources.append(source)

        return sources

    async def _search_internal_sources(
        self,
        claim_text: str,
    ) -> List[SourceInfo]:
        """
        Search ChromaDB and PostgreSQL for relevant articles.

        Returns SourceInfo objects for matching internal articles.
        """
        from app.vector_store import get_vector_store
        from app.database import Article as ArticleRecord

        sources: List[SourceInfo] = []

        vector_store = get_vector_store()
        if vector_store:
            try:
                vector_results = await asyncio.to_thread(
                    vector_store.search_similar,
                    claim_text,
                    limit=5,
                )

                article_ids = [
                    r.get("article_id") for r in vector_results if r.get("article_id")
                ]

                if article_ids and self.db:
                    result = await self.db.execute(
                        select(ArticleRecord).where(ArticleRecord.id.in_(article_ids))
                    )
                    articles = result.scalars().all()
                    article_map = {a.id: a for a in articles}

                    for vr in vector_results:
                        article_id = vr.get("article_id")
                        article = article_map.get(article_id) if article_id else None
                        if not article or not article.url:
                            continue

                        source = self._article_to_source_info(
                            article,
                            similarity_score=vr.get("similarity_score", 0.5),
                        )
                        sources.append(source)

                        logger.debug(
                            "Internal source found: %s (similarity=%.2f)",
                            article.title[:50] if article.title else "Untitled",
                            vr.get("similarity_score", 0),
                        )

            except Exception as exc:
                logger.warning("Internal vector search failed: %s", exc)

        return sources

    def _article_to_source_info(
        self,
        article: Any,
        similarity_score: float = 0.5,
    ) -> SourceInfo:
        """Convert a database Article to SourceInfo."""
        from urllib.parse import urlparse

        url = article.url or ""
        domain = urlparse(url).netloc if url else "internal"

        credibility, source_type = (
            self.scorer.get_credibility(domain)
            if self.scorer
            else (0.7, SourceType.UNKNOWN)
        )

        credibility = max(credibility, 0.6 + (similarity_score * 0.2))

        published_at = None
        if article.published_at:
            published_at = article.published_at.isoformat()

        return SourceInfo(
            id=f"internal_{article.id}",
            url=url,
            title=article.title,
            domain=domain,
            credibility_score=min(credibility, 1.0),
            source_type=source_type,
            published_at=published_at,
            supports_claim=True,
            excerpt=(article.summary or "")[:200],
        )

    async def _search_external_sources(
        self,
        claim_text: str,
        max_results: int = 5,
    ) -> List[SourceInfo]:
        """
        Search DuckDuckGo for external sources.

        Filters to allowed domains only.
        """
        sources: List[SourceInfo] = []
        query = self._build_search_query(claim_text)

        try:
            results = await asyncio.to_thread(self._ddg_search, query, max_results * 2)

            for result in results:
                if len(sources) >= max_results:
                    break

                url = result.get("href") or result.get("link")
                if not url:
                    continue

                if self.sandbox and not self.sandbox.is_domain_allowed(url):
                    continue

                source = (
                    self.scorer.get_source_info(
                        url=url,
                        title=result.get("title"),
                        published_at=result.get("published"),
                        supports_claim=True,
                        excerpt=result.get("body", "")[:200],
                    )
                    if self.scorer
                    else SourceInfo(
                        id=hashlib.sha256(url.encode()).hexdigest()[:12],
                        url=url,
                        title=result.get("title"),
                        domain=url.split("/")[2] if "/" in url else url,
                        credibility_score=0.5,
                        supports_claim=True,
                        excerpt=result.get("body", "")[:200],
                    )
                )

                sources.append(source)

        except Exception as exc:
            logger.warning("External source search failed: %s", exc)

        return sources

    def _build_search_query(self, claim_text: str) -> str:
        """Build search query from claim text."""
        tokens = claim_text.split()
        if len(tokens) > 12:
            tokens = tokens[:12]
        return " ".join(tokens)

    def _ddg_search(self, query: str, max_results: int = 10) -> List[Dict[str, Any]]:
        """Perform DuckDuckGo search (blocking, run in thread)."""
        try:
            ddgs = cast(Any, DDGS())
            results = list(ddgs.text(query, max_results=max_results))
            return results
        except Exception as exc:
            logger.warning("DDG search failed: %s", exc)
            return []

    def _calculate_overall_confidence(
        self,
        claims: List[VerifiedClaim],
    ) -> float:
        """Calculate overall confidence across all claims."""
        if not claims:
            return 0.0

        weighted_sum = sum(
            c.confidence * len(c.supporting_sources + c.conflicting_sources)
            for c in claims
        )
        total_sources = sum(
            len(c.supporting_sources + c.conflicting_sources) for c in claims
        )

        if total_sources == 0:
            return sum(c.confidence for c in claims) / len(claims)

        return weighted_sum / total_sources


async def cleanup_expired_cache(db: AsyncSession) -> int:
    """Remove expired cache entries."""
    try:
        result = await db.execute(
            delete(VerificationCache).where(
                VerificationCache.expires_at < datetime.now(timezone.utc)
            )
        )
        await db.commit()
        deleted = result.rowcount
        if deleted:
            logger.info("Cleaned up %d expired cache entries", deleted)
        return deleted
    except Exception as exc:
        logger.warning("Cache cleanup failed: %s", exc)
        return 0


async def verify_research(
    request: VerificationRequest,
    db: Optional[AsyncSession] = None,
    session_id: Optional[str] = None,
) -> VerificationResult:
    """
    Convenience function to verify research claims.

    Usage:
        result = await verify_research(request, db)
    """
    async with VerificationAgent(db, session_id) as agent:
        return await agent.verify(request)
