"""GDELT Global Database of Events, Language, and Tone integration service.

Provides functionality to fetch GDELT events and match them to articles
using URL matching and embedding similarity.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.database import (
    GDELTEvent,
    Article,
)
from app.vector_store import get_vector_store

logger = logging.getLogger(__name__)

GDELT_BASE_URL = "https://data.gdeltproject.org/gdeltv2"
GDELT_MASTER_URL = "http://data.gdeltproject.org/gdeltv2/masterfilelist.txt"

SIMILARITY_THRESHOLD = 0.75  # Cosine similarity threshold for embedding matches


class GDELTIntegration:
    """Handles fetching and matching GDELT events to articles."""

    def __init__(self):
        self.vector_store = None
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=60.0,
                follow_redirects=True,
                headers={"User-Agent": "Scoop News Reader/1.0"},
            )
        return self._client

    async def fetch_recent_events(
        self, minutes: int = 15, limit: int = 250
    ) -> List[Dict[str, Any]]:
        """Fetch recent GDELT events from the last N minutes.

        Args:
            minutes: Number of minutes back to fetch (default 15)
            limit: Maximum events to fetch

        Returns:
            List of GDELT event dictionaries
        """
        now = datetime.now(timezone.utc)
        target_time = now - timedelta(minutes=minutes)

        # Format: YYYYMMDDHHMMSS
        target_str = target_time.strftime("%Y%m%d%H%M%S")

        # For last 15 minutes, we use the "lastupdate" API
        # which returns events since a given timestamp
        url = f"{GDELT_BASE_URL}/lastupdate.txt"

        try:
            client = await self._get_client()
            response = await client.get(url)
            response.raise_for_status()

            # Parse the lastupdate file to get current CSV URLs
            lines = response.text.strip().split("\n")
            if not lines:
                logger.warning("GDELT lastupdate returned empty")
                return []

            # Get the most recent export URLs
            export_urls = []
            for line in lines[:3]:  # Check last 3 updates
                parts = line.split()
                if len(parts) >= 3:
                    export_url = (
                        parts[2] if parts[2].endswith(".export.CSV.zip") else None
                    )
                    if export_url and export_url.startswith("http"):
                        export_urls.append(export_url)

            events = []
            for export_url in export_urls[:2]:  # Fetch last 2 updates
                batch_events = await self._fetch_export_csv(export_url, limit=limit)
                events.extend(batch_events)
                if len(events) >= limit:
                    break

            return events[:limit]

        except Exception as e:
            logger.error(f"Failed to fetch GDELT events: {e}")
            return []

    async def _fetch_export_csv(
        self, csv_url: str, limit: int = 250
    ) -> List[Dict[str, Any]]:
        """Fetch and parse a GDELT export CSV file.

        Args:
            csv_url: URL to the CSV file
            limit: Maximum events to parse

        Returns:
            List of parsed event dictionaries
        """
        try:
            client = await self._get_client()
            response = await client.get(csv_url)
            response.raise_for_status()

            # GDELT CSVs are tab-delimited
            content = response.text
            reader = csv.DictReader(io.StringIO(content), delimiter="\t")

            events = []
            for i, row in enumerate(reader):
                if i >= limit:
                    break

                # Parse GDELT event
                event = self._parse_gdelt_row(row)
                if event:
                    events.append(event)

            logger.info(f"Parsed {len(events)} events from {csv_url}")
            return events

        except Exception as e:
            logger.error(f"Failed to fetch/parse GDELT CSV {csv_url}: {e}")
            return []

    def _parse_gdelt_row(self, row: Dict[str, str]) -> Optional[Dict[str, Any]]:
        """Parse a GDELT CSV row into a structured event dictionary.

        Args:
            row: CSV row dictionary

        Returns:
            Parsed event dict or None if invalid
        """
        try:
            # Required fields
            gdelt_id = row.get("GlobalEventID", "").strip()
            if not gdelt_id:
                return None

            # Parse date
            date_str = row.get("SQLDATE", "")
            if date_str and len(date_str) == 8:
                # Format: YYYYMMDD
                year = int(date_str[:4])
                month = int(date_str[4:6])
                day = int(date_str[6:8])
                published_at = datetime(year, month, day, 0, 0, 0)
            else:
                published_at = datetime.now(timezone.utc)

            # Parse URLs from Mention URLs
            url = row.get("SOURCEURL", "").strip()

            # Skip if no URL
            if not url:
                return None

            # Parse tone
            tone_str = row.get("AvgTone", "0")
            try:
                tone = float(tone_str)
            except ValueError:
                tone = 0.0

            # Parse Goldstein scale
            goldstein_str = row.get("GoldsteinScale", "0")
            try:
                goldstein_scale = float(goldstein_str)
            except ValueError:
                goldstein_scale = 0.0

            # Extract source domain from URL
            source = self._extract_source_domain(url)

            return {
                "gdelt_id": gdelt_id,
                "url": url,
                "title": row.get(
                    "DocumentIdentifier", ""
                ),  # Use document identifier as title
                "source": source,
                "published_at": published_at,
                "event_code": row.get("EventCode", ""),
                "event_root_code": row.get("EventRootCode", ""),
                "actor1_name": row.get("Actor1Name", ""),
                "actor1_country": row.get("Actor1CountryCode", ""),
                "actor2_name": row.get("Actor2Name", ""),
                "actor2_country": row.get("Actor2CountryCode", ""),
                "tone": tone,
                "goldstein_scale": goldstein_scale,
                "raw_data": dict(row),
            }

        except Exception as e:
            logger.warning(f"Failed to parse GDELT row: {e}")
            return None

    def _extract_source_domain(self, url: str) -> str:
        """Extract domain from URL."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc
            # Remove www. prefix
            if domain.startswith("www."):
                domain = domain[4:]
            return domain
        except Exception:
            return ""

    async def match_events_to_articles(
        self, session: AsyncSession, events: List[Dict[str, Any]]
    ) -> Tuple[int, int]:
        """Match GDELT events to existing articles.

        Uses two methods:
        1. URL matching - exact URL match to existing articles
        2. Embedding similarity - semantic similarity to recent articles

        Args:
            session: Database session
            events: List of GDELT events to match

        Returns:
            Tuple of (matched_count, total_events)
        """
        if not events:
            return 0, 0

        matched_count = 0

        # Get vector store for embedding comparisons
        if self.vector_store is None:
            self.vector_store = get_vector_store()

        for event in events:
            try:
                # Method 1: URL matching
                article_id = await self._match_by_url(session, event["url"])
                match_method = "url"

                # Method 2: Embedding similarity if no URL match
                if article_id is None and self.vector_store:
                    article_id = await self._match_by_embedding(session, event)
                    match_method = "embedding"

                # Store the event with match info
                await self._store_gdelt_event(session, event, article_id, match_method)

                if article_id:
                    matched_count += 1
                    logger.debug(
                        f"Matched GDELT event {event['gdelt_id']} to article {article_id} "
                        f"via {match_method}"
                    )

            except Exception as e:
                logger.warning(
                    f"Failed to match GDELT event {event.get('gdelt_id')}: {e}"
                )
                continue

        await session.commit()
        logger.info(f"Matched {matched_count}/{len(events)} GDELT events to articles")

        return matched_count, len(events)

    async def _match_by_url(self, session: AsyncSession, url: str) -> Optional[int]:
        """Match GDELT event to article by URL.

        Args:
            session: Database session
            url: URL to match

        Returns:
            Article ID if matched, None otherwise
        """
        # Find article with this URL
        article_result = await session.execute(
            select(Article).where(Article.url == url)
        )
        article = article_result.scalar_one_or_none()

        if not article:
            return None

        article_id = article.id
        if article_id is None:
            return None
        return int(article_id)

    async def _match_by_embedding(
        self, session: AsyncSession, event: Dict[str, Any]
    ) -> Optional[int]:
        """Match GDELT event to article by embedding similarity.

        Generates an embedding from the event title and compares to
        recent article embeddings.
        """
        if not self.vector_store:
            return None

        # Create text for embedding from title
        text = event.get("title", "")
        if not text:
            return None

        try:
            # Generate embedding
            embedding = self.vector_store.embedding_model.encode(text).tolist()

            best_article_id = None
            best_similarity = 0.0

            result = self.vector_store.collection.query(
                query_embeddings=[embedding],
                n_results=10,
                include=["distances"],
            )

            ids_payload = result.get("ids") if result else None
            ids = ids_payload[0] if ids_payload else []
            distances_payload = result.get("distances") if result else None
            distances = distances_payload[0] if distances_payload else []

            for chroma_id, distance in zip(ids, distances):
                if not chroma_id or not chroma_id.startswith("article_"):
                    continue
                similarity = 1 - distance if distance is not None else 0.0
                if similarity > best_similarity:
                    best_similarity = similarity
                    try:
                        best_article_id = int(chroma_id.replace("article_", ""))
                    except ValueError:
                        continue

            if best_similarity >= SIMILARITY_THRESHOLD:
                return best_article_id

        except Exception as e:
            logger.warning(f"Embedding match failed for GDELT event: {e}")

        return None

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        import numpy as np

        v1 = np.array(vec1)
        v2 = np.array(vec2)

        dot_product = np.dot(v1, v2)
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)

        if norm1 == 0 or norm2 == 0:
            return 0.0

        return float(dot_product / (norm1 * norm2))

    async def _store_gdelt_event(
        self,
        session: AsyncSession,
        event: Dict[str, Any],
        article_id: Optional[int],
        match_method: str,
    ) -> None:
        """Store GDELT event to database.

        Args:
            session: Database session
            event: Event dictionary
            article_id: Matched article ID (None if unmatched)
            match_method: How the match was made ('url', 'embedding', or 'none')
        """
        # Check if event already exists
        existing = await session.execute(
            select(GDELTEvent).where(GDELTEvent.gdelt_id == event["gdelt_id"])
        )
        if existing.scalar_one_or_none():
            return  # Already stored

        # Calculate similarity score if cluster matched
        similarity_score = None
        if article_id and match_method == "embedding":
            similarity_score = 0.0

        gdelt_event = GDELTEvent(
            gdelt_id=event["gdelt_id"],
            url=event["url"],
            title=event.get("title", "")[:500],  # Limit length
            source=event.get("source", ""),
            published_at=event["published_at"],
            event_code=event.get("event_code", ""),
            event_root_code=event.get("event_root_code", ""),
            actor1_name=event.get("actor1_name", ""),
            actor1_country=event.get("actor1_country", ""),
            actor2_name=event.get("actor2_name", ""),
            actor2_country=event.get("actor2_country", ""),
            tone=event.get("tone"),
            goldstein_scale=event.get("goldstein_scale"),
            article_id=article_id,
            matched_at=datetime.now(timezone.utc) if article_id else None,
            match_method=match_method if article_id else None,
            similarity_score=similarity_score,
            raw_data=event.get("raw_data"),
        )

        session.add(gdelt_event)

    async def update_article_external_count(
        self, session: AsyncSession, article_id: int
    ) -> int:
        """Count GDELT events matched to a specific article."""
        count_result = await session.execute(
            select(func.count(GDELTEvent.id)).where(GDELTEvent.article_id == article_id)
        )
        return count_result.scalar_one() or 0

    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None


# Global instance
_gdelt_integration: Optional[GDELTIntegration] = None


def get_gdelt_integration() -> GDELTIntegration:
    """Get or create GDELT integration instance."""
    global _gdelt_integration
    if _gdelt_integration is None:
        _gdelt_integration = GDELTIntegration()
    return _gdelt_integration


async def sync_gdelt_to_articles(
    session: AsyncSession, minutes: int = 15, limit: int = 250
) -> Tuple[int, int]:
    """Convenience function to sync recent GDELT events to articles.

    Args:
        session: Database session
        minutes: Minutes back to fetch
        limit: Maximum events to process

    Returns:
        Tuple of (matched_count, total_events)
    """
    gdelt = get_gdelt_integration()

    try:
        # Fetch events
        events = await gdelt.fetch_recent_events(minutes=minutes, limit=limit)

        if not events:
            logger.info("No GDELT events to process")
            return 0, 0

        matched, total = await gdelt.match_events_to_articles(session, events)

        await session.commit()

        return matched, total

    except Exception as e:
        logger.error(f"GDELT sync failed: {e}")
        await session.rollback()
        return 0, 0
    finally:
        await gdelt.close()
