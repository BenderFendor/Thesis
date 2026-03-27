"""Query-time GDELT DOC 2.0 and Context 2.0 helpers.

This service is intentionally separate from the ingest-time event sync service.
It powers live research flows and returns normalized article-like payloads.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_CONTEXT_API_URL = "https://api.gdeltproject.org/api/v2/context/context"
DEFAULT_TIMESPAN = "24h"
DEFAULT_MAX_RECORDS = 10


class GDELTQueryError(RuntimeError):
    """Raised when a live GDELT query fails."""


class GDELTRateLimitedError(GDELTQueryError):
    """Raised when GDELT rejects a request for rate limiting."""


@dataclass(frozen=True)
class GDELTArticleResult:
    url: str
    title: str
    source: str
    summary: str
    published: str
    image: str | None = None
    provider: str = "gdelt"
    language: str | None = None
    source_country: str | None = None
    context_snippet: str | None = None
    sentence: str | None = None
    tone: float | None = None
    result_type: str = "doc"

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "url": self.url,
            "link": self.url,
            "title": self.title,
            "source": self.source,
            "summary": self.summary,
            "description": self.summary,
            "published": self.published,
            "image": self.image,
            "provider": self.provider,
            "language": self.language,
            "source_country": self.source_country,
            "context_snippet": self.context_snippet,
            "sentence": self.sentence,
            "tone": self.tone,
            "result_type": self.result_type,
            "category": "external",
        }
        return {key: value for key, value in payload.items() if value not in (None, "")}


class GDELTQueryService:
    def __init__(self) -> None:
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=20.0,
                follow_redirects=True,
                headers={"User-Agent": "Scoop News Reader/1.0"},
            )
        return self._client

    async def search_doc(
        self,
        query: str,
        *,
        max_records: int = DEFAULT_MAX_RECORDS,
        timespan: str = DEFAULT_TIMESPAN,
    ) -> list[dict[str, Any]]:
        payload = await self._request_json(
            GDELT_DOC_API_URL,
            {
                "query": query,
                "mode": "artlist",
                "maxrecords": max_records,
                "timespan": timespan,
                "sort": "datedesc",
                "format": "json",
            },
        )
        articles = payload.get("articles")
        if not isinstance(articles, list):
            return []

        results: list[dict[str, Any]] = []
        for article in articles:
            if not isinstance(article, dict):
                continue
            normalized = self._normalize_doc_article(article)
            if normalized is not None:
                results.append(normalized.to_dict())
        return results

    async def search_context(
        self,
        query: str,
        *,
        max_records: int = DEFAULT_MAX_RECORDS,
        timespan: str = DEFAULT_TIMESPAN,
    ) -> list[dict[str, Any]]:
        payload = await self._request_json(
            GDELT_CONTEXT_API_URL,
            {
                "query": query,
                "mode": "artlist",
                "maxrecords": max_records,
                "timespan": timespan,
                "sort": "datedesc",
                "format": "json",
            },
        )
        articles = payload.get("articles")
        if not isinstance(articles, list):
            return []

        results: list[dict[str, Any]] = []
        for article in articles:
            if not isinstance(article, dict):
                continue
            normalized = self._normalize_context_article(article)
            if normalized is not None:
                results.append(normalized.to_dict())
        return results

    async def _request_json(
        self,
        url: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        client = await self._get_client()
        response = await client.get(url, params=params)
        response.raise_for_status()
        text = response.text.strip()
        if text.startswith("Please limit requests"):
            raise GDELTRateLimitedError(text)
        payload = response.json()
        if not isinstance(payload, dict):
            raise GDELTQueryError("Unexpected GDELT response shape")
        return payload

    def _normalize_doc_article(
        self,
        article: dict[str, Any],
    ) -> GDELTArticleResult | None:
        url = str(article.get("url") or "").strip()
        if not url:
            return None
        title = str(article.get("title") or "Untitled").strip()
        domain = str(article.get("domain") or "External source").strip()
        published = str(article.get("seendate") or "").strip()
        source_country = str(article.get("sourcecountry") or "").strip() or None
        language = str(article.get("language") or "").strip() or None
        image = str(article.get("socialimage") or "").strip() or None
        return GDELTArticleResult(
            url=url,
            title=title,
            source=domain,
            summary=title,
            published=published,
            image=image,
            language=language,
            source_country=source_country,
            result_type="doc",
        )

    def _normalize_context_article(
        self,
        article: dict[str, Any],
    ) -> GDELTArticleResult | None:
        url = str(article.get("url") or "").strip()
        if not url:
            return None
        title = str(article.get("title") or "Untitled").strip()
        domain = str(article.get("domain") or "External source").strip()
        sentence = str(article.get("sentence") or "").strip() or None
        context = str(article.get("context") or "").strip()
        summary = context or sentence or title
        published = str(article.get("seendate") or "").strip()
        language = str(article.get("language") or "").strip() or None
        image = str(article.get("socialimage") or "").strip() or None
        return GDELTArticleResult(
            url=url,
            title=title,
            source=domain,
            summary=summary,
            published=published,
            image=image,
            language=language,
            context_snippet=context or None,
            sentence=sentence,
            result_type="context",
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def build_debug_url(self, api_url: str, params: dict[str, Any]) -> str:
        return f"{api_url}?{urlencode(params)}"


_gdelt_query_service: Optional[GDELTQueryService] = None


def get_gdelt_query_service() -> GDELTQueryService:
    global _gdelt_query_service
    if _gdelt_query_service is None:
        _gdelt_query_service = GDELTQueryService()
    return _gdelt_query_service
