"""
Source credibility scoring engine for verification agent.

Loads credibility data from:
1. Database (source_credibility table) - highest priority
2. Environment variable overrides
3. Built-in defaults for well-known sources

Calculates composite scores based on:
- Base credibility score (0.0-1.0)
- Source type weighting
- Recency of publication
- Cross-source agreement
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.database import SourceCredibility as SourceCredibilityModel
from app.models.verification import SourceInfo, SourceType

logger = get_logger("source_credibility")

# Built-in defaults for well-known sources
# Format: domain -> (credibility_score, source_type)
DEFAULT_CREDIBILITY: Dict[str, Tuple[float, SourceType]] = {
    # Wire services - highest credibility
    "reuters.com": (0.95, SourceType.WIRE),
    "apnews.com": (0.95, SourceType.WIRE),
    "afp.com": (0.92, SourceType.WIRE),
    # Fact checkers
    "factcheck.org": (0.94, SourceType.FACT_CHECKER),
    "snopes.com": (0.90, SourceType.FACT_CHECKER),
    "politifact.com": (0.90, SourceType.FACT_CHECKER),
    "mediabiasfactcheck.com": (0.85, SourceType.FACT_CHECKER),
    "fullfact.org": (0.90, SourceType.FACT_CHECKER),
    # Public broadcasters
    "bbc.com": (0.90, SourceType.BROADCAST),
    "bbc.co.uk": (0.90, SourceType.BROADCAST),
    "npr.org": (0.90, SourceType.BROADCAST),
    "pbs.org": (0.88, SourceType.BROADCAST),
    # Major newspapers
    "nytimes.com": (0.88, SourceType.NEWSPAPER),
    "washingtonpost.com": (0.87, SourceType.NEWSPAPER),
    "theguardian.com": (0.86, SourceType.NEWSPAPER),
    "wsj.com": (0.88, SourceType.NEWSPAPER),
    "ft.com": (0.88, SourceType.NEWSPAPER),
    "economist.com": (0.88, SourceType.MAGAZINE),
    "theatlantic.com": (0.82, SourceType.MAGAZINE),
    # Academic/Scientific
    "nature.com": (0.95, SourceType.ACADEMIC),
    "science.org": (0.95, SourceType.ACADEMIC),
    "sciencedirect.com": (0.90, SourceType.ACADEMIC),
    "pubmed.ncbi.nlm.nih.gov": (0.92, SourceType.ACADEMIC),
    "arxiv.org": (0.75, SourceType.ACADEMIC),
    # Government/International orgs
    "gov.uk": (0.85, SourceType.GOVERNMENT),
    "usa.gov": (0.85, SourceType.GOVERNMENT),
    "who.int": (0.88, SourceType.GOVERNMENT),
    "un.org": (0.85, SourceType.GOVERNMENT),
    "europa.eu": (0.85, SourceType.GOVERNMENT),
    # Reference
    "wikipedia.org": (0.70, SourceType.NONPROFIT),
    "en.wikipedia.org": (0.70, SourceType.NONPROFIT),
    "britannica.com": (0.82, SourceType.NONPROFIT),
}

# Source type base weights for diversity scoring
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


class CredibilityScorer:
    """
    Manages source credibility scoring with database and environment overrides.

    Usage:
        scorer = CredibilityScorer()
        await scorer.load_from_db(db_session)  # Optional

        score, source_type = scorer.get_credibility("reuters.com")
        confidence = scorer.calculate_claim_confidence(sources)
    """

    def __init__(self):
        self._cache: Dict[str, Tuple[float, SourceType]] = {}
        self._loaded_from_db = False
        self._load_defaults()
        self._load_env_overrides()

    def _load_defaults(self) -> None:
        """Load built-in default credibility scores."""
        self._cache.update(DEFAULT_CREDIBILITY)
        logger.debug("Loaded %d default credibility entries", len(DEFAULT_CREDIBILITY))

    def _load_env_overrides(self) -> None:
        """
        Load credibility overrides from environment.

        Format: CREDIBILITY_<DOMAIN>=<score>
        Example: CREDIBILITY_EXAMPLE_COM=0.75
        """
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
        """
        Load credibility scores from database, overriding defaults.

        Returns count of entries loaded.
        """
        try:
            result = await db.execute(
                select(SourceCredibilityModel).where(
                    SourceCredibilityModel.is_active == True
                )
            )
            entries = result.scalars().all()

            for entry in entries:
                source_type = self._parse_source_type(entry.source_type)
                self._cache[entry.domain.lower()] = (
                    entry.credibility_score,
                    source_type,
                )

            self._loaded_from_db = True
            logger.info("Loaded %d credibility entries from database", len(entries))
            return len(entries)
        except Exception as exc:
            logger.warning("Failed to load credibility from DB: %s", exc)
            return 0

    def _parse_source_type(self, type_str: Optional[str]) -> SourceType:
        """Parse source type string to enum."""
        if not type_str:
            return SourceType.UNKNOWN
        try:
            return SourceType(type_str.lower())
        except ValueError:
            return SourceType.UNKNOWN

    def _extract_domain(self, url_or_domain: str) -> str:
        """Extract clean domain from URL or domain string."""
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
        """
        Get credibility score and source type for a domain.

        Checks exact match first, then parent domains.
        Returns (0.3, UNKNOWN) for unrecognized domains.
        """
        domain = self._extract_domain(url_or_domain)

        # Exact match
        if domain in self._cache:
            return self._cache[domain]

        # Check parent domains (e.g., news.bbc.co.uk -> bbc.co.uk)
        parts = domain.split(".")
        for i in range(1, len(parts) - 1):
            parent = ".".join(parts[i:])
            if parent in self._cache:
                return self._cache[parent]

        return (0.3, SourceType.UNKNOWN)

    def get_source_info(
        self,
        url: str,
        title: Optional[str] = None,
        published_at: Optional[str] = None,
        supports_claim: bool = True,
        excerpt: Optional[str] = None,
    ) -> SourceInfo:
        """Create SourceInfo with credibility data populated."""
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

    def calculate_claim_confidence(
        self,
        sources: List[SourceInfo],
    ) -> float:
        """
        Calculate confidence score for a claim based on supporting sources.

        Formula:
            confidence = (
                0.35 * avg_credibility +
                0.25 * source_diversity +
                0.20 * recency_score +
                0.20 * agreement_score
            )

        Returns float between 0.0 and 1.0.
        """
        if not sources:
            return 0.0

        supporting = [s for s in sources if s.supports_claim]
        conflicting = [s for s in sources if not s.supports_claim]

        if not supporting:
            return 0.1 if conflicting else 0.0

        # Component 1: Average credibility of supporting sources
        avg_credibility = sum(s.credibility_score for s in supporting) / len(supporting)

        # Component 2: Source diversity (different source types)
        source_diversity = self._calculate_diversity(supporting)

        # Component 3: Recency score
        recency_score = self._calculate_recency(supporting)

        # Component 4: Agreement score (supporting vs conflicting)
        agreement_score = self._calculate_agreement(supporting, conflicting)

        confidence = (
            0.35 * avg_credibility
            + 0.25 * source_diversity
            + 0.20 * recency_score
            + 0.20 * agreement_score
        )

        return max(0.0, min(1.0, confidence))

    def _calculate_diversity(self, sources: List[SourceInfo]) -> float:
        """
        Calculate source diversity score.

        Higher score for sources from different types.
        """
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
        """
        Calculate recency score based on publication dates.

        More recent sources get higher scores.
        """
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
        """
        Calculate agreement score based on supporting vs conflicting sources.

        Weighted by source credibility.
        """
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

    def should_recheck_claim(
        self,
        cached_confidence: float,
        new_context: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Determine if a cached claim should be re-verified.

        Returns (should_recheck, reason).
        """
        threshold = settings.verification_recheck_threshold

        if cached_confidence < threshold:
            return True, f"Low confidence ({cached_confidence:.0%}) below threshold"

        return False, None


# Module-level singleton for convenience
_scorer: Optional[CredibilityScorer] = None


def get_scorer() -> CredibilityScorer:
    """Get or create the global CredibilityScorer instance."""
    global _scorer
    if _scorer is None:
        _scorer = CredibilityScorer()
    return _scorer


async def get_scorer_with_db(db: AsyncSession) -> CredibilityScorer:
    """Get scorer with database entries loaded."""
    scorer = get_scorer()
    if not scorer._loaded_from_db:
        await scorer.load_from_db(db)
    return scorer
