"""
Source credibility scoring engine for verification agent.

Phase 1 (Plan 35): Multi-dimensional credibility scoring with 6 axes.
Replaces the legacy single-float DEFAULT_CREDIBILITY model with a
data-driven CredibilitySignalStore that computes per-source profiles.

Dimensions:
  funding_transparency         – ownership disclosure, govt funding, donor transparency
  source_network_diversity     – citation breadth, geographic spread, wire dependency
  political_orientation_disclosure – editorial stance, party affiliation, news-vs-opinion
  correction_record            – corrections page, retraction count, fabrication incidents
  methodology_transparency     – reporting process, source verification, byline attribution
  cross_verification_alignment – tone deviation vs global/language peers (GDELT)

Each dimension returns: {score, confidence, explanation, signals_available,
                        signals_missing, provenance}
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, cast
from urllib.parse import urlparse

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import (
    SourceCredibility as SourceCredibilityModel,
    SourceMetadata,
    Organization,
    GDELTEvent,
    SourceAnalysisScore,
)
from app.models.verification import SourceInfo, SourceType

logger = get_logger("source_credibility")

SOURCE_TYPE_WEIGHTS: Dict[SourceType, float] = {
    SourceType.WIRE: 1.0,
    SourceType.FACT_CHECKER: 0.95,
    SourceType.ACADEMIC: 0.95,
    SourceType.GOVERNMENT: 0.90,
    SourceType.BROADCAST: 0.88,
    SourceType.NEWSPAPER: 0.85,
    SourceType.MAGAZINE: 0.80,
    SourceType.NONPROFIT: 0.75,
    SourceType.BLOG: 0.40,
    SourceType.SOCIAL: 0.20,
    SourceType.UNKNOWN: 0.30,
}

CREDIBILITY_DIMENSIONS = [
    "funding_transparency",
    "source_network_diversity",
    "political_orientation_disclosure",
    "correction_record",
    "methodology_transparency",
    "cross_verification_alignment",
]


def _make_empty_dimension(dimension_name: str) -> Dict[str, Any]:
    return {
        "score": None,
        "confidence": 0.0,
        "explanation": "No data available for this dimension.",
        "signals_available": 0,
        "signals_missing": 6,
        "provenance": [],
        "status": "insufficient_data",
        "dimension": dimension_name,
    }


def _make_provenance_entry(
    source: str, url: str = "", last_updated: Optional[str] = None
) -> Dict[str, Any]:
    return {
        "source": source,
        "url": url,
        "last_updated": last_updated or datetime.now(timezone.utc).isoformat(),
    }


class CredibilitySignalStore:
    """Computes 6-dimension credibility profiles for news sources."""

    def __init__(self) -> None:
        self._profile_cache: Dict[str, Dict[str, Any]] = {}
        self._cache_timestamp: Optional[datetime] = None

    def clear_cache(self) -> None:
        self._profile_cache.clear()
        self._cache_timestamp = None

    def get_credibility_profile(self, domain: str) -> Dict[str, Any]:
        """Get the full 6-dimension credibility profile for a domain."""
        domain = self._extract_domain(domain)
        cached = self._profile_cache.get(domain)
        if cached:
            return cached
        return {
            "domain": domain,
            "dimensions": {
                dim: _make_empty_dimension(dim) for dim in CREDIBILITY_DIMENSIONS
            },
            "data_quality": {
                "dimensions_available": 0,
                "dimensions_total": 6,
                "completeness_pct": 0.0,
                "last_updated": self._cache_timestamp.isoformat()
                if self._cache_timestamp
                else None,
            },
            "status": "insufficient_data",
        }

    async def compute_all_source_credibility(self, db: AsyncSession) -> int:
        """Recompute all 6 dimensions for every source in source_metadata.

        Returns count of sources scored.
        """
        result = await db.execute(
            select(SourceMetadata.source_name, SourceMetadata.domain)
        )
        rows = result.all()
        scored = 0

        for source_name, domain in rows:
            if not domain:
                continue
            try:
                profile = await self._compute_dimensions(db, source_name, domain)
                self._profile_cache[domain] = profile
                await self._store_scores(db, source_name, profile)
                scored += 1
            except Exception as exc:
                logger.warning(
                    "Failed to compute credibility for %s (%s): %s",
                    source_name,
                    domain,
                    exc,
                )

        self._cache_timestamp = datetime.now(timezone.utc)
        logger.info("Computed credibility profiles for %d sources", scored)
        return scored

    async def compute_single_source(
        self, db: AsyncSession, domain: str
    ) -> Dict[str, Any]:
        """Compute credibility profile for a single domain on demand."""
        domain = self._extract_domain(domain)

        result = await db.execute(
            select(SourceMetadata).where(SourceMetadata.domain == domain)
        )
        meta = result.scalars().first()

        if not meta:
            return self.get_credibility_profile(domain)

        profile = await self._compute_dimensions(
            db, meta.source_name or domain, meta.domain or domain
        )
        self._profile_cache[domain] = profile
        return profile

    async def _compute_dimensions(
        self, db: AsyncSession, source_name: str, domain: str
    ) -> Dict[str, Any]:
        dims = {}
        dims["funding_transparency"] = await self._compute_funding_transparency(
            db, source_name
        )
        dims["source_network_diversity"] = await self._compute_source_network_diversity(
            db, source_name, domain
        )
        dims[
            "political_orientation_disclosure"
        ] = await self._compute_political_orientation(db, source_name)
        dims["correction_record"] = await self._compute_correction_record(
            db, source_name
        )
        dims["methodology_transparency"] = await self._compute_methodology_transparency(
            db, source_name
        )
        dims["cross_verification_alignment"] = await self._compute_cross_verification(
            db, source_name, domain
        )

        available = sum(1 for d in dims.values() if d.get("score") is not None)
        status = "data_available" if available > 0 else "insufficient_data"

        return {
            "domain": domain,
            "dimensions": dims,
            "data_quality": {
                "dimensions_available": available,
                "dimensions_total": 6,
                "completeness_pct": round(available / 6 * 100, 1),
                "last_updated": datetime.now(timezone.utc).isoformat(),
            },
            "status": status,
        }

    async def _compute_funding_transparency(
        self, db: AsyncSession, source_name: str
    ) -> Dict[str, Any]:
        signals_available = 0
        signals_missing = 5
        provenance: List[Dict[str, Any]] = []
        score = 0.0
        weight_total = 0.0

        org_result = await db.execute(
            select(Organization).where(
                func.lower(Organization.name) == func.lower(source_name)
            )
        )
        org = org_result.scalars().first()

        if org:
            if org.funding_type:
                weight = 0.25
                sub = (
                    75.0
                    if org.funding_type in ("public", "independent", "non-profit")
                    else 40.0
                )
                score += sub * weight
                weight_total += weight
                signals_available += 1
                provenance.append(_make_provenance_entry("wikidata_organization", ""))

            if (
                org.parent_orgs
                and isinstance(org.parent_orgs, list)
                and len(org.parent_orgs) > 0
            ):
                weight = 0.20
                depth = min(len(org.parent_orgs), 5)
                score += (depth * 20.0) * weight
                weight_total += weight
                signals_available += 1
                provenance.append(
                    _make_provenance_entry("wikidata_ownership_chain", "")
                )

            if org.ein:
                weight = 0.20
                score += 60.0 * weight
                weight_total += weight
                signals_available += 1
                provenance.append(_make_provenance_entry("irs_990_data", ""))

            if (
                org.funding_sources
                and isinstance(org.funding_sources, list)
                and len(org.funding_sources) > 0
            ):
                weight = 0.20
                score += 50.0 * weight
                weight_total += weight
                signals_available += 1
                provenance.append(_make_provenance_entry("organization_funding", ""))

            if org.annual_revenue:
                weight = 0.15
                score += 40.0 * weight
                weight_total += weight
                signals_available += 1
                provenance.append(_make_provenance_entry("organization_revenue", ""))

        if weight_total == 0:
            return _make_empty_dimension("funding_transparency")

        normalized_score = min(100.0, round(score / weight_total, 1))
        signals_missing = 5 - signals_available

        return {
            "score": normalized_score,
            "confidence": round(0.4 + (signals_available / 5) * 0.6, 2),
            "explanation": f"Funding transparency assessed from {signals_available} signals.",
            "signals_available": signals_available,
            "signals_missing": signals_missing,
            "provenance": provenance,
            "status": "partial_data" if signals_available < 3 else "data_available",
            "dimension": "funding_transparency",
        }

    async def _compute_source_network_diversity(
        self, db: AsyncSession, source_name: str, domain: str
    ) -> Dict[str, Any]:
        signals_available = 0
        signals_missing = 4
        provenance: List[Dict[str, Any]] = []
        score = 0.0
        weight_total = 0.0

        actor_country_result = await db.execute(
            select(func.count(GDELTEvent.actor1_country.distinct())).where(
                GDELTEvent.source == domain
            )
        )
        distinct_actor_countries = actor_country_result.scalar() or 0

        actor_result = await db.execute(
            select(func.count(func.distinct(GDELTEvent.actor1_name))).where(
                GDELTEvent.source == domain
            )
        )
        distinct_actors = actor_result.scalar() or 0

        if distinct_actors > 0:
            weight = 0.40
            actors_score = min(100.0, (distinct_actors / 50.0) * 100.0)
            score += actors_score * weight
            weight_total += weight
            signals_available += 1
            provenance.append(_make_provenance_entry("gdelt_actor_counts", ""))

        if distinct_actor_countries > 0:
            weight = 0.35
            geo_score = min(100.0, (distinct_actor_countries / 20.0) * 100.0)
            score += geo_score * weight
            weight_total += weight
            signals_available += 1
            provenance.append(_make_provenance_entry("gdelt_geographic_spread", ""))

        total_count_result = await db.execute(
            select(func.count(GDELTEvent.id)).where(GDELTEvent.source == domain)
        )
        total_count = total_count_result.scalar() or 0

        if total_count > 0:
            weight = 0.25
            article_vol_score = min(100.0, (total_count / 1000.0) * 100.0)
            score += article_vol_score * weight
            weight_total += weight
            signals_available += 1
            provenance.append(_make_provenance_entry("gdelt_article_volume", ""))

        if weight_total == 0:
            return _make_empty_dimension("source_network_diversity")

        normalized_score = min(100.0, round(score / weight_total, 1))
        signals_missing = 3 - signals_available

        return {
            "score": normalized_score,
            "confidence": round(0.4 + (signals_available / 3) * 0.6, 2),
            "explanation": f"Network diversity from {signals_available} GDELT signals.",
            "signals_available": signals_available,
            "signals_missing": signals_missing,
            "provenance": provenance,
            "status": "partial_data" if signals_available < 2 else "data_available",
            "dimension": "source_network_diversity",
        }

    async def _compute_political_orientation(
        self, db: AsyncSession, source_name: str
    ) -> Dict[str, Any]:
        provenance: List[Dict[str, Any]] = []
        signals_available = 0
        signals_missing = 4
        score = 0.0
        weight_total = 0.0

        result = await db.execute(
            select(SourceMetadata).where(
                func.lower(SourceMetadata.source_name) == func.lower(source_name)
            )
        )
        meta = result.scalars().first()

        if meta and meta.political_bias:
            weight = 0.40
            score += 70.0 * weight
            weight_total += weight
            signals_available += 1
            provenance.append(_make_provenance_entry("source_metadata_bias", ""))

        org_result = await db.execute(
            select(Organization).where(
                func.lower(Organization.name) == func.lower(source_name)
            )
        )
        org = org_result.scalars().first()

        if org and org.media_bias_rating:
            weight = 0.40
            score += 60.0 * weight
            weight_total += weight
            signals_available += 1
            provenance.append(_make_provenance_entry("mbfc_bias_rating", "", ""))
            provenance[-1]["provenance_tag"] = "mbfc_dataset_v1"

        if weight_total == 0:
            return _make_empty_dimension("political_orientation_disclosure")

        normalized_score = min(100.0, round(score / weight_total, 1))
        signals_missing = 4 - signals_available

        return {
            "score": normalized_score,
            "confidence": round(0.3 + (signals_available / 4) * 0.7, 2),
            "explanation": f"Political orientation assessed from {signals_available} signals.",
            "signals_available": signals_available,
            "signals_missing": signals_missing,
            "provenance": provenance,
            "status": "partial_data",
            "dimension": "political_orientation_disclosure",
        }

    async def _compute_correction_record(
        self, db: AsyncSession, source_name: str
    ) -> Dict[str, Any]:
        return _make_empty_dimension("correction_record")

    async def _compute_methodology_transparency(
        self, db: AsyncSession, source_name: str
    ) -> Dict[str, Any]:
        return _make_empty_dimension("methodology_transparency")

    async def _compute_cross_verification(
        self, db: AsyncSession, source_name: str, domain: str
    ) -> Dict[str, Any]:
        provenance: List[Dict[str, Any]] = []
        signals_available = 0
        signals_missing = 2

        tone_result = await db.execute(
            select(func.avg(GDELTEvent.tone)).where(GDELTEvent.source == domain)
        )
        source_avg_tone = tone_result.scalar()

        global_result = await db.execute(select(func.avg(GDELTEvent.tone)))
        global_avg_tone = global_result.scalar()

        if source_avg_tone is None or global_avg_tone is None:
            return _make_empty_dimension("cross_verification_alignment")

        stddev_result = await db.execute(select(func.stddev_pop(GDELTEvent.tone)))
        global_stddev = stddev_result.scalar() or 1.0

        deviation = (source_avg_tone - global_avg_tone) / max(global_stddev, 0.01)
        sigma_abs = abs(deviation)
        tone_score = max(0.0, 100.0 - sigma_abs * 15.0)
        score = min(100.0, tone_score)
        signals_available += 1
        provenance.append(
            _make_provenance_entry(
                "gdelt_tone_deviation_vs_global",
                "",
                datetime.now(timezone.utc).isoformat(),
            )
        )

        goldstein_result = await db.execute(
            select(func.avg(GDELTEvent.goldstein_scale)).where(
                GDELTEvent.source == domain
            )
        )
        source_goldstein = goldstein_result.scalar()
        global_goldstein_result = await db.execute(
            select(func.avg(GDELTEvent.goldstein_scale))
        )
        global_goldstein = global_goldstein_result.scalar()

        if source_goldstein is not None and global_goldstein is not None:
            signals_available += 1
            provenance.append(
                _make_provenance_entry(
                    "gdelt_goldstein_deviation",
                    "",
                    datetime.now(timezone.utc).isoformat(),
                )
            )

        signals_missing = 2 - signals_available

        return {
            "score": round(score, 1),
            "confidence": round(0.5 + (signals_available / 2) * 0.5, 2),
            "explanation": f"Cross-verification alignment: tone sigma={round(deviation, 2)}",
            "signals_available": signals_available,
            "signals_missing": signals_missing,
            "provenance": provenance,
            "status": "partial_data" if signals_available < 2 else "data_available",
            "dimension": "cross_verification_alignment",
        }

    async def _store_scores(
        self, db: AsyncSession, source_name: str, profile: Dict[str, Any]
    ) -> None:
        dims = profile.get("dimensions", {})
        for axis_name in CREDIBILITY_DIMENSIONS:
            dim_data = dims.get(axis_name, {})
            score_val = dim_data.get("score")

            result = await db.execute(
                select(SourceAnalysisScore).where(
                    SourceAnalysisScore.source_name == source_name,
                    SourceAnalysisScore.axis_name == axis_name,
                )
            )
            existing = result.scalars().first()

            if existing and score_val is not None:
                existing.score = int(round(score_val / 20.0))
                existing.confidence = (
                    "high" if dim_data.get("confidence", 0) >= 0.7 else "medium"
                )
                existing.prose_explanation = dim_data.get("explanation", "")
                existing.citations = dim_data.get("provenance", [])
                existing.empirical_basis = (
                    "gdelt_and_wikidata"
                    if "gdelt" in str(dim_data.get("provenance", [])).lower()
                    else "structured_data"
                )
                existing.last_scored_at = datetime.now(timezone.utc)
                existing.scored_by = "credibility_engine"
            elif existing is None and score_val is not None:
                new_score = SourceAnalysisScore(
                    source_name=source_name,
                    axis_name=axis_name,
                    score=int(round(score_val / 20.0)),
                    confidence="high"
                    if dim_data.get("confidence", 0) >= 0.7
                    else "medium",
                    prose_explanation=dim_data.get("explanation", ""),
                    citations=dim_data.get("provenance", []),
                    empirical_basis="gdelt_and_wikidata"
                    if "gdelt" in str(dim_data.get("provenance", [])).lower()
                    else "structured_data",
                    scored_by="credibility_engine",
                    last_scored_at=datetime.now(timezone.utc),
                )
                db.add(new_score)

        await db.flush()

    @staticmethod
    def _extract_domain(url_or_domain: str) -> str:
        if "://" in url_or_domain:
            parsed = urlparse(url_or_domain)
            domain = parsed.netloc.lower()
        else:
            domain = url_or_domain.lower()
        domain = domain.split(":")[0]
        if domain.startswith("www."):
            domain = domain[4:]
        return domain


_signal_store: Optional[CredibilitySignalStore] = None


def get_signal_store() -> CredibilitySignalStore:
    global _signal_store
    if _signal_store is None:
        _signal_store = CredibilitySignalStore()
    return _signal_store


async def compute_all_source_credibility(db: AsyncSession) -> int:
    """Entry point for scheduled job: recompute all credibility profiles."""
    return await get_signal_store().compute_all_source_credibility(db)


async def run_credibility_scoring_scheduler(interval_seconds: int = 86400) -> None:
    """Periodic background task that recomputes source credibility profiles.

    Designed to be launched as an asyncio.Task from main.py.
    """
    from app.database import AsyncSessionLocal
    from app.core.config import settings as app_settings

    logger.info(
        "Starting credibility scoring scheduler (interval: %ds)", interval_seconds
    )

    await asyncio.sleep(300)

    while True:
        try:
            await asyncio.sleep(interval_seconds)

            if not app_settings.enable_database or AsyncSessionLocal is None:
                continue

            logger.info(
                "Starting credibility scoring run at %s", datetime.now(timezone.utc)
            )
            async with AsyncSessionLocal() as session:
                count = await compute_all_source_credibility(session)
                logger.info("Credibility scoring complete: %d sources scored", count)

        except asyncio.CancelledError:
            logger.info("Credibility scoring scheduler cancelled")
            break
        except Exception as e:
            logger.error("Credibility scoring run failed: %s", e, exc_info=True)


class CredibilityScorer:
    """Legacy scorer that wraps CredibilitySignalStore for backward compat."""

    def __init__(self) -> None:
        self._cache: Dict[str, Tuple[float, SourceType]] = {}
        self._loaded_from_db = False
        self._load_env_overrides()

    def _load_env_overrides(self) -> None:
        prefix = "CREDIBILITY_"
        for key, value in os.environ.items():
            if not key.startswith(prefix):
                continue
            domain = key[len(prefix) :].lower().replace("_", ".")
            try:
                score = float(value)
                if 0.0 <= score <= 1.0:
                    self._cache[domain] = (score, SourceType.UNKNOWN)
                    logger.debug("Environment override: %s = %.2f", domain, score)
            except ValueError:
                logger.warning("Invalid credibility override: %s=%s", key, value)

    async def load_from_db(self, db: AsyncSession) -> int:
        try:
            result = await db.execute(
                select(SourceCredibilityModel).where(
                    SourceCredibilityModel.is_active.is_(True)
                )
            )
            entries = result.scalars().all()

            for entry in entries:
                source_type = self._parse_source_type(entry.source_type)
                domain = cast(str, entry.domain)
                credibility_score = cast(float, entry.credibility_score)
                self._cache[domain.lower()] = (credibility_score, source_type)

            self._loaded_from_db = True
            logger.info("Loaded %d credibility entries from database", len(entries))
            return len(entries)
        except Exception as exc:
            logger.warning("Failed to load credibility from DB: %s", exc)
            return 0

    def _parse_source_type(self, type_str: Optional[str]) -> SourceType:
        if not type_str:
            return SourceType.UNKNOWN
        try:
            return SourceType(type_str.lower())
        except ValueError:
            return SourceType.UNKNOWN

    @staticmethod
    def _extract_domain(url_or_domain: str) -> str:
        if "://" in url_or_domain:
            parsed = urlparse(url_or_domain)
            domain = parsed.netloc.lower()
        else:
            domain = url_or_domain.lower()
        domain = domain.split(":")[0]
        if domain.startswith("www."):
            domain = domain[4:]
        return domain

    def get_credibility(self, url_or_domain: str) -> Tuple[float, SourceType]:
        domain = self._extract_domain(url_or_domain)

        if domain in self._cache:
            return self._cache[domain]

        parts = domain.split(".")
        for i in range(1, len(parts) - 1):
            parent = ".".join(parts[i:])
            if parent in self._cache:
                return self._cache[parent]

        profile = get_signal_store().get_credibility_profile(domain)
        dims = profile.get("dimensions", {})
        scores = [d.get("score") for d in dims.values() if d.get("score") is not None]

        if scores:
            mean_score = sum(scores) / len(scores) / 100.0
            return (round(mean_score, 2), SourceType.UNKNOWN)

        return (0.3, SourceType.UNKNOWN)

    def get_credibility_profile(self, url_or_domain: str) -> Dict[str, Any]:
        """Return the 6-dimension credibility profile for a domain."""
        domain = self._extract_domain(url_or_domain)
        return get_signal_store().get_credibility_profile(domain)

    def get_source_info(
        self,
        url: str,
        title: Optional[str] = None,
        published_at: Optional[str] = None,
        supports_claim: bool = True,
        excerpt: Optional[str] = None,
    ) -> SourceInfo:
        import hashlib

        domain = self._extract_domain(url)
        credibility, source_type = self.get_credibility(domain)

        source_id = hashlib.sha256(url.encode()).hexdigest()[:12]

        return SourceInfo(
            id=source_id,
            url=url,
            title=title,
            domain=domain,
            credibility_score=credibility,
            source_type=source_type,
            published_at=published_at,
            supports_claim=supports_claim,
            excerpt=excerpt,
        )

    def calculate_claim_confidence(self, sources: List[SourceInfo]) -> float:
        if not sources:
            return 0.0

        supporting = [s for s in sources if s.supports_claim]
        conflicting = [s for s in sources if not s.supports_claim]

        if not supporting:
            return 0.1 if conflicting else 0.0

        avg_credibility = sum(s.credibility_score for s in supporting) / len(supporting)
        source_diversity = self._calculate_diversity(supporting)
        recency_score = self._calculate_recency(supporting)
        agreement_score = self._calculate_agreement(supporting, conflicting)

        confidence = (
            0.35 * avg_credibility
            + 0.25 * source_diversity
            + 0.20 * recency_score
            + 0.20 * agreement_score
        )

        return max(0.0, min(1.0, confidence))

    def _calculate_diversity(self, sources: List[SourceInfo]) -> float:
        if len(sources) <= 1:
            return 0.5

        unique_types = set(s.source_type for s in sources)
        unique_domains = set(s.domain for s in sources)

        type_diversity = min(len(unique_types) / 4, 1.0)
        domain_diversity = min(len(unique_domains) / 3, 1.0)

        type_quality = sum(SOURCE_TYPE_WEIGHTS.get(t, 0.3) for t in unique_types) / max(
            len(unique_types), 1
        )

        return 0.4 * type_diversity + 0.3 * domain_diversity + 0.3 * type_quality

    def _calculate_recency(self, sources: List[SourceInfo]) -> float:
        now = datetime.now(timezone.utc)
        scores = []

        for source in sources:
            if not source.published_at:
                scores.append(0.5)
                continue

            try:
                if isinstance(source.published_at, str):
                    pub_date = datetime.fromisoformat(
                        source.published_at.replace("Z", "+00:00")
                    )
                else:
                    pub_date = source.published_at

                if pub_date.tzinfo is None:
                    pub_date = pub_date.replace(tzinfo=timezone.utc)

                days_old = (now - pub_date).days

                if days_old < 1:
                    scores.append(1.0)
                elif days_old < 7:
                    scores.append(0.9)
                elif days_old < 30:
                    scores.append(0.8)
                elif days_old < 90:
                    scores.append(0.6)
                elif days_old < 365:
                    scores.append(0.4)
                else:
                    scores.append(0.2)
            except (ValueError, TypeError):
                scores.append(0.5)

        return sum(scores) / len(scores) if scores else 0.5

    def _calculate_agreement(
        self,
        supporting: List[SourceInfo],
        conflicting: List[SourceInfo],
    ) -> float:
        if not supporting and not conflicting:
            return 0.5

        supporting_weight = sum(s.credibility_score for s in supporting)
        conflicting_weight = sum(s.credibility_score for s in conflicting)

        total_weight = supporting_weight + conflicting_weight
        if total_weight == 0:
            return 0.5

        agreement_ratio = supporting_weight / total_weight

        conflict_penalty = 0.0
        if conflicting:
            max_conflict_cred = max(s.credibility_score for s in conflicting)
            if max_conflict_cred > 0.8:
                conflict_penalty = 0.2
            elif max_conflict_cred > 0.6:
                conflict_penalty = 0.1

        return max(0.0, agreement_ratio - conflict_penalty)


_scorer: Optional[CredibilityScorer] = None


def get_scorer() -> CredibilityScorer:
    global _scorer
    if _scorer is None:
        _scorer = CredibilityScorer()
    return _scorer


async def get_scorer_with_db(db: AsyncSession) -> CredibilityScorer:
    scorer = get_scorer()
    if not scorer._loaded_from_db:
        await scorer.load_from_db(db)
    return scorer
