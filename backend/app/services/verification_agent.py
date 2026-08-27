"""Verification agent for cross-referencing research claims."""

from __future__ import annotations

import asyncio
import hashlib
import re
import time
from datetime import UTC, datetime, timedelta
from types import TracebackType
from typing import Any, cast

from ddgs import DDGS
from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.database import (
    VerificationCache,
    fetch_article_records_by_ids,
    search_article_records_by_keyword,
)
from app.models.verification import (
    ConfidenceLevel,
    SourceInfo,
    SourceType,
    VerificationRequest,
    VerificationResult,
    VerifiedClaim,
)
from app.services.source_credibility import CredibilityScorer, get_scorer_with_db
from app.services.verification_sandbox import VerificationSandbox

logger = get_logger("verification_agent")


def _confidence_to_level(confidence: float) -> ConfidenceLevel:
    if confidence >= 0.8:
        return ConfidenceLevel.HIGH
    if confidence >= 0.5:
        return ConfidenceLevel.MEDIUM
    if confidence >= 0.2:
        return ConfidenceLevel.LOW
    return ConfidenceLevel.VERY_LOW


def _hash_claim(claim_text: str) -> str:
    normalized = " ".join(claim_text.lower().split())
    return hashlib.sha256(normalized.encode()).hexdigest()[:32]


def _source_ids_by_support(sources: list[SourceInfo], supports: bool) -> list[str]:
    return [source.id for source in sources if source.supports_claim is supports]


class VerificationAgent:
    """Cross-reference research claims against internal and external sources."""

    def __init__(
        self,
        db: AsyncSession | None = None,
        session_id: str | None = None,
    ) -> None:
        self.db = db
        self.session_id = session_id
        self.sandbox: VerificationSandbox | None = None
        self.scorer: CredibilityScorer | None = None
        self._start_time: float | None = None
        self._sources: dict[str, SourceInfo] = {}
        self._footnote_counter = 0

    async def __aenter__(self) -> VerificationAgent:
        self.sandbox = VerificationSandbox(self.session_id)
        if self.db:
            self.scorer = await get_scorer_with_db(self.db)
        else:
            from app.services.source_credibility import get_scorer

            self.scorer = get_scorer()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        _exc_tb: TracebackType | None,
    ) -> None:
        if self.sandbox:
            self.sandbox.cleanup()

    def _time_remaining_ms(self) -> int:
        if not self._start_time:
            return settings.verification_max_duration_seconds * 1000
        elapsed = (time.time() - self._start_time) * 1000
        remaining = (settings.verification_max_duration_seconds * 1000) - elapsed
        return max(0, int(remaining))

    def _should_abort(self) -> bool:
        return self._time_remaining_ms() < 500

    def _empty_result(self, request: VerificationRequest, message: str) -> VerificationResult:
        assert self._start_time is not None
        return VerificationResult(
            query=request.query,
            overall_confidence=0.0,
            overall_confidence_level=ConfidenceLevel.VERY_LOW,
            verified_claims=[],
            sources={},
            markdown_report=message,
            duration_ms=int((time.time() - self._start_time) * 1000),
        )

    async def _verify_claims(self, claims: list[str]) -> list[VerifiedClaim]:
        verified_claims: list[VerifiedClaim] = []
        for claim_text in claims[: settings.verification_max_claims]:
            if self._should_abort():
                logger.info("Verification timeout, stopping early")
                break
            verified = await self._verify_single_claim(claim_text)
            if verified is not None:
                verified_claims.append(verified)
        return verified_claims

    async def verify(self, request: VerificationRequest) -> VerificationResult:
        """Extract, verify, score, and format the claims in a research answer."""
        self._start_time = time.time()
        self._sources = {}
        self._footnote_counter = 0
        try:
            claims = self._extract_claims(request.main_answer or "")
            if not claims:
                return self._empty_result(request, "No verifiable claims found in the response.")
            verified_claims = await self._verify_claims(claims)
            confidence = self._calculate_overall_confidence(verified_claims)
            from app.services.verification_output import format_markdown_report

            return VerificationResult(
                query=request.query,
                overall_confidence=confidence,
                overall_confidence_level=_confidence_to_level(confidence),
                verified_claims=verified_claims,
                sources=self._sources,
                markdown_report=format_markdown_report(
                    verified_claims,
                    self._sources,
                    confidence,
                ),
                duration_ms=int((time.time() - self._start_time) * 1000),
            )
        except Exception as exc:
            logger.error("Verification failed: %s", exc, exc_info=True)
            result = self._empty_result(request, "")
            result.error = str(exc)
            return result

    def _extract_claims(self, text: str) -> list[str]:
        if not text:
            return []
        sentences = (sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", text))
        return [
            sentence
            for sentence in sentences
            if 20 <= len(sentence) <= 500 and self._is_verifiable_claim(sentence)
        ]

    def _is_verifiable_claim(self, sentence: str) -> bool:
        lowered = sentence.lower()
        meta_patterns = (
            r"^(note|remember|keep in mind|it'?s important)",
            r"^(in summary|to summarize|in conclusion)",
            r"^(for more information|see also|related)",
        )
        if any(re.search(pattern, lowered) for pattern in meta_patterns):
            return False
        signal_patterns = (
            r"\d+",
            r"[\"']",
            r"\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{4})\b",
            r"\b(said|stated|reported|announced|according to|claims|confirmed|denied)\b",
            r"\b(more than|less than|greater|fewer|increased|decreased|rose|fell|dropped|surged)\b",
        )
        return any(re.search(pattern, lowered) for pattern in signal_patterns)

    def _claim_without_sources(self, claim_hash: str, claim_text: str) -> VerifiedClaim:
        return VerifiedClaim(
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

    def _register_sources(self, sources: list[SourceInfo]) -> list[int]:
        footnotes: list[int] = []
        for source in sources:
            self._footnote_counter += 1
            footnotes.append(self._footnote_counter)
            self._sources[source.id] = source
        return footnotes

    def _claim_with_sources(
        self, claim_hash: str, claim_text: str, sources: list[SourceInfo]
    ) -> VerifiedClaim:
        confidence = self.scorer.calculate_claim_confidence(sources) if self.scorer else 0.5
        needs_recheck = confidence < settings.verification_recheck_threshold
        return VerifiedClaim(
            id=claim_hash,
            claim_text=claim_text,
            confidence=confidence,
            confidence_level=_confidence_to_level(confidence),
            supporting_sources=_source_ids_by_support(sources, True),
            conflicting_sources=_source_ids_by_support(sources, False),
            footnotes=self._register_sources(sources),
            needs_recheck=needs_recheck,
            recheck_reason="Low confidence" if needs_recheck else None,
        )

    async def _verify_single_claim(self, claim_text: str) -> VerifiedClaim:
        claim_hash = _hash_claim(claim_text)
        cached = await self._check_cache(claim_hash)
        if cached is not None:
            logger.debug("Cache hit for claim: %s", claim_text[:50])
            return cached
        sources = await self._search_sources(claim_text)
        verified = (
            self._claim_with_sources(claim_hash, claim_text, sources)
            if sources
            else self._claim_without_sources(claim_hash, claim_text)
        )
        await self._cache_claim(verified)
        return verified

    def _restore_cached_sources(self, source_dicts: list[dict[str, Any]]) -> None:
        for source_dict in source_dicts:
            source = SourceInfo(**source_dict)
            self._sources[source.id] = source
            self._footnote_counter += 1

    def _claim_from_cache(self, claim_hash: str, cached: VerificationCache) -> VerifiedClaim:
        source_dicts = [item for item in (cached.sources_json or []) if isinstance(item, dict)]
        self._restore_cached_sources(source_dicts)
        return VerifiedClaim(
            id=claim_hash,
            claim_text=cast(str, cached.claim_text),
            confidence=cast(float, cached.confidence),
            confidence_level=ConfidenceLevel(cached.confidence_level or "medium"),
            supporting_sources=[item["id"] for item in source_dicts if item.get("supports_claim", True)],
            conflicting_sources=[item["id"] for item in source_dicts if not item.get("supports_claim", True)],
            footnotes=list(range(1, len(source_dicts) + 1)),
            needs_recheck=False,
        )

    async def _check_cache(self, claim_hash: str) -> VerifiedClaim | None:
        if not self.db:
            return None
        try:
            result = await self.db.execute(
                select(VerificationCache).where(
                    VerificationCache.claim_hash == claim_hash,
                    VerificationCache.expires_at > datetime.now(UTC),
                )
            )
            cached = result.scalar_one_or_none()
            return self._claim_from_cache(claim_hash, cached) if cached else None
        except Exception as exc:
            logger.warning("Cache check failed: %s", exc)
            return None

    async def _cache_claim(self, claim: VerifiedClaim) -> None:
        if not self.db:
            return
        try:
            source_ids = claim.supporting_sources + claim.conflicting_sources
            sources_json = [self._sources[source_id].model_dump() for source_id in source_ids if source_id in self._sources]
            cache_entry = VerificationCache(
                claim_hash=claim.id,
                claim_text=claim.claim_text,
                confidence=cast(Any, claim.confidence),
                confidence_level=claim.confidence_level.value,
                sources_json=sources_json,
                expires_at=datetime.now(UTC)
                + timedelta(hours=settings.verification_cache_ttl_hours),
            )
            await self.db.merge(cache_entry)
            await self.db.commit()
        except Exception as exc:
            logger.warning("Cache write failed: %s", exc)

    @staticmethod
    def _append_unique(
        destination: list[SourceInfo],
        candidates: list[SourceInfo],
        seen_urls: set[str],
        limit: int,
    ) -> None:
        for source in candidates:
            if len(destination) >= limit:
                return
            if source.url in seen_urls:
                continue
            seen_urls.add(source.url)
            destination.append(source)

    async def _search_sources(self, claim_text: str) -> list[SourceInfo]:
        max_sources = settings.verification_max_sources_per_claim
        sources: list[SourceInfo] = []
        seen_urls: set[str] = set()
        self._append_unique(
            sources,
            await self._search_internal_sources(claim_text),
            seen_urls,
            max_sources,
        )
        if len(sources) < max_sources:
            self._append_unique(
                sources,
                await self._search_external_sources(claim_text, max_sources - len(sources)),
                seen_urls,
                max_sources,
            )
        return sources

    async def _keyword_sources(self, claim_text: str) -> tuple[list[SourceInfo], set[int]]:
        if not self.db:
            return [], set()
        try:
            articles = await search_article_records_by_keyword(self.db, query=claim_text, limit=5)
        except Exception as exc:
            logger.warning("Internal keyword search failed: %s", exc)
            return [], set()
        valid = [article for article in articles if article.id is not None and article.url]
        return (
            [self._article_to_source_info(article, similarity_score=0.7) for article in valid],
            {int(article.id) for article in valid},
        )

    async def _vector_results(self, claim_text: str) -> list[dict[str, Any]]:
        from app.vector_store import get_vector_store

        vector_store = get_vector_store()
        if vector_store is None:
            return []
        try:
            results = await asyncio.to_thread(vector_store.search_similar, claim_text, limit=5)
            return [result for result in results if isinstance(result, dict)]
        except Exception as exc:
            logger.warning("Internal vector search failed: %s", exc)
            return []

    async def _fetch_vector_articles(
        self, vector_results: list[dict[str, Any]]
    ) -> dict[int, Any]:
        if not self.db:
            return {}
        article_ids = [
            article_id
            for result in vector_results
            if isinstance((article_id := result.get("article_id")), int)
        ]
        if not article_ids:
            return {}
        articles = await fetch_article_records_by_ids(self.db, article_ids)
        return {
            article_id: article
            for article in articles
            if isinstance((article_id := getattr(article, "id", None)), int)
        }

    def _vector_sources(
        self,
        vector_results: list[dict[str, Any]],
        article_map: dict[int, Any],
        seen_ids: set[int],
    ) -> list[SourceInfo]:
        sources: list[SourceInfo] = []
        for result in vector_results:
            article_id = result.get("article_id")
            if not isinstance(article_id, int) or article_id in seen_ids:
                continue
            article = article_map.get(article_id)
            if article is None or not getattr(article, "url", None):
                continue
            sources.append(
                self._article_to_source_info(
                    article,
                    similarity_score=float(result.get("similarity_score", 0.5)),
                )
            )
            seen_ids.add(article_id)
        return sources

    async def _search_internal_sources(self, claim_text: str) -> list[SourceInfo]:
        """Combine database keyword matches and vector similarity matches."""
        keyword_sources, seen_ids = await self._keyword_sources(claim_text)
        vector_results = await self._vector_results(claim_text)
        article_map = await self._fetch_vector_articles(vector_results)
        return keyword_sources + self._vector_sources(vector_results, article_map, seen_ids)

    def _article_to_source_info(
        self,
        article: Any,
        similarity_score: float = 0.5,
    ) -> SourceInfo:
        from urllib.parse import urlparse

        url = article.url or ""
        domain = urlparse(url).netloc if url else "internal"
        credibility, source_type = (
            self.scorer.get_credibility(domain) if self.scorer else (0.7, SourceType.UNKNOWN)
        )
        credibility = max(credibility, 0.6 + (similarity_score * 0.2))
        published_at = article.published_at.isoformat() if article.published_at else None
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

    def _external_source(self, result: dict[str, Any]) -> SourceInfo | None:
        url = result.get("href") or result.get("link")
        if not isinstance(url, str) or not url:
            return None
        if self.sandbox and not self.sandbox.is_domain_allowed(url):
            return None
        if self.scorer:
            return self.scorer.get_source_info(
                url=url,
                title=result.get("title"),
                published_at=result.get("published"),
                supports_claim=True,
                excerpt=str(result.get("body", ""))[:200],
            )
        return SourceInfo(
            id=hashlib.sha256(url.encode()).hexdigest()[:12],
            url=url,
            title=result.get("title"),
            domain=url.split("/")[2] if "/" in url else url,
            credibility_score=0.5,
            supports_claim=True,
            excerpt=str(result.get("body", ""))[:200],
        )

    async def _search_external_sources(
        self,
        claim_text: str,
        max_results: int = 5,
    ) -> list[SourceInfo]:
        query = self._build_search_query(claim_text)
        try:
            results = await asyncio.to_thread(self._ddg_search, query, max_results * 2)
        except Exception as exc:
            logger.warning("External source search failed: %s", exc)
            return []
        sources = [source for result in results if (source := self._external_source(result))]
        return sources[:max_results]

    def _build_search_query(self, claim_text: str) -> str:
        return " ".join(claim_text.split()[:12])

    def _ddg_search(self, query: str, max_results: int = 10) -> list[dict[str, Any]]:
        try:
            return list(cast(Any, DDGS()).text(query, max_results=max_results))
        except Exception as exc:
            logger.warning("DDG search failed: %s", exc)
            return []

    def _calculate_overall_confidence(self, claims: list[VerifiedClaim]) -> float:
        if not claims:
            return 0.0
        source_counts = [len(claim.supporting_sources + claim.conflicting_sources) for claim in claims]
        total_sources = sum(source_counts)
        if total_sources == 0:
            return sum(claim.confidence for claim in claims) / len(claims)
        weighted_sum = sum(
            claim.confidence * source_count
            for claim, source_count in zip(claims, source_counts, strict=True)
        )
        return weighted_sum / total_sources


async def cleanup_expired_cache(db: AsyncSession) -> int:
    """Remove expired cache entries."""
    try:
        result = await db.execute(
            delete(VerificationCache).where(VerificationCache.expires_at < datetime.now(UTC))
        )
        await db.commit()
        deleted = cast(CursorResult[Any], result).rowcount or 0
        if deleted:
            logger.info("Cleaned up %d expired cache entries", deleted)
        return deleted
    except Exception as exc:
        logger.warning("Cache cleanup failed: %s", exc)
        return 0


async def verify_research(
    request: VerificationRequest,
    db: AsyncSession | None = None,
    session_id: str | None = None,
) -> VerificationResult:
    """Convenience entry point for research verification."""
    async with VerificationAgent(db, session_id) as agent:
        return await agent.verify(request)
