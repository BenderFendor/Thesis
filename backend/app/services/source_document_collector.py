from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from ddgs import DDGS

from app.core.logging import get_logger
from app.services.source_profile_extractor import SourceDocument
from app.services.source_search_planner import SourceSearchPlanner

logger = get_logger("source_document_collector")

MAX_DOCS = 6
MAX_RESULTS_PER_QUERY = 5
KNOWN_PATHS = [
    "/about",
    "/about-us",
    "/about/",
    "/mission",
    "/mission/",
    "/editorial-policy",
    "/editorial-policies",
    "/editorial-policies/",
    "/corrections",
    "/corrections/",
    "/ethics",
    "/ethics/",
    "/transparency",
    "/transparency/",
    "/donate",
    "/donate/",
]

REFERENCE_DOMAINS = [
    "wikipedia.org",
    "wikidata.org",
    "projects.propublica.org",
    "mediabiasfactcheck.com",
    "allsides.com",
    "adfontesmedia.com",
]


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str


class DuckDuckGoSearcher:
    async def search(self, query: str, max_results: int = MAX_RESULTS_PER_QUERY) -> List[SearchResult]:
        return await asyncio.to_thread(self._search_sync, query, max_results)

    def _search_sync(self, query: str, max_results: int) -> List[SearchResult]:
        try:
            ddgs = DDGS()
            results = list(ddgs.text(query, max_results=max_results))
        except Exception as exc:
            logger.warning("Web search failed for '%s': %s", query, exc)
            return []

        payload: List[SearchResult] = []
        for item in results:
            url = item.get("href") or item.get("url")
            if not url:
                continue
            payload.append(
                SearchResult(
                    title=str(item.get("title") or ""),
                    url=str(url),
                    snippet=str(item.get("body") or ""),
                )
            )
        return payload


async def collect_source_documents(
    source_name: str,
    website: Optional[str] = None,
    max_docs: int = MAX_DOCS,
    max_total_docs: Optional[int] = None,
    existing_documents: Optional[Sequence[SourceDocument]] = None,
    extra_queries: Optional[Sequence[str]] = None,
    searcher: Optional[DuckDuckGoSearcher] = None,
    planner: Optional[SourceSearchPlanner] = None,
    use_llm_planner: bool = False,
) -> List[SourceDocument]:
    searcher = searcher or DuckDuckGoSearcher()
    planner = planner or SourceSearchPlanner()
    normalized_name = _normalize_source_name(source_name)
    official_domain = _extract_domain(website)

    documents: List[SourceDocument] = list(existing_documents or [])
    existing_urls = {doc.url for doc in documents}

    candidate_urls = _candidate_urls_from_known_paths(website)
    search_queries = _build_search_queries(source_name, website)
    if extra_queries:
        search_queries.extend(extra_queries)
    if use_llm_planner:
        agentic_queries = await planner.plan_queries(source_name, website)
        search_queries.extend(agentic_queries)
    search_queries = _dedupe_queries(search_queries)

    for query in search_queries:
        results = await searcher.search(query, MAX_RESULTS_PER_QUERY)
        for result in results:
            url = _normalize_url(result.url)
            if not url:
                continue
            if _is_candidate_url(url, official_domain, normalized_name):
                candidate_urls.add(url)

    prioritized = _prioritize_urls(candidate_urls, official_domain)
    limit = max_total_docs if max_total_docs is not None else max_docs

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for url in prioritized:
            if len(documents) >= limit:
                break
            if url in existing_urls:
                continue
            document = await _fetch_document(client, url)
            if document:
                documents.append(document)
                existing_urls.add(document.url)

    logger.info("Collected %s source documents for %s", len(documents), source_name)
    return documents


def _candidate_urls_from_known_paths(website: Optional[str]) -> set[str]:
    urls: set[str] = set()
    if not website:
        return urls
    for path in KNOWN_PATHS:
        urls.add(urljoin(website.rstrip("/") + "/", path.lstrip("/")))
    return urls


def _build_search_queries(source_name: str, website: Optional[str]) -> List[str]:
    site_filter = ""
    if website:
        domain = _extract_domain(website)
        if domain:
            site_filter = f" site:{domain}"
    return [
        f"{source_name} about{site_filter}",
        f"{source_name} mission{site_filter}",
        f"{source_name} editorial policy{site_filter}",
        f"{source_name} corrections policy{site_filter}",
        f"{source_name} funding{site_filter}",
        f"{source_name} donors{site_filter}",
        f"{source_name} nonprofit{site_filter}",
        f"{source_name} 990",
        f"{source_name} annual report",
        f"{source_name} media bias rating",
        f"{source_name} site:mediabiasfactcheck.com",
        f"{source_name} site:allsides.com",
        f"{source_name} site:adfontesmedia.com",
        f"{source_name} site:en.wikipedia.org",
        f"{source_name} site:projects.propublica.org/nonprofits",
    ]


def _normalize_source_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _extract_domain(website: Optional[str]) -> Optional[str]:
    if not website:
        return None
    parsed = urlparse(website)
    if parsed.netloc:
        return parsed.netloc.lower()
    return website.lower()


def _normalize_url(url: str) -> Optional[str]:
    if not url:
        return None
    cleaned = url.strip()
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        return cleaned
    return None


def _is_candidate_url(url: str, official_domain: Optional[str], normalized_name: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower()

    if host.endswith("wikipedia.org"):
        return True

    if official_domain and host.endswith(official_domain):
        return True

    if any(host.endswith(domain) for domain in REFERENCE_DOMAINS):
        return True

    if normalized_name and normalized_name in host.replace(".", ""):
        return True

    return False


def _prioritize_urls(urls: Iterable[str], official_domain: Optional[str]) -> List[str]:
    def score(url: str) -> int:
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        if host.endswith("wikipedia.org"):
            return 0
        if host.endswith("wikidata.org"):
            return 1
        if host.endswith("projects.propublica.org"):
            return 2
        if official_domain and host.endswith(official_domain):
            return 3
        if any(host.endswith(domain) for domain in REFERENCE_DOMAINS):
            return 4
        return 5

    return sorted(set(urls), key=score)


def _dedupe_queries(queries: Sequence[str]) -> List[str]:
    seen: set[str] = set()
    deduped: List[str] = []
    for query in queries:
        cleaned = " ".join(query.split())
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(cleaned)
    return deduped


async def _fetch_document(
    client: httpx.AsyncClient,
    url: str,
) -> Optional[SourceDocument]:
    try:
        response = await client.get(url)
    except Exception as exc:
        logger.debug("Source fetch failed for %s: %s", url, exc)
        return None

    if response.status_code != 200:
        logger.debug("Source fetch status %s for %s", response.status_code, url)
        return None

    html = response.text
    text, title = _extract_text_and_title(html)
    if not text:
        return None

    resolved_url = str(response.url)
    return SourceDocument(url=resolved_url, title=title or resolved_url, text=text)


def _extract_text_and_title(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")

    title = ""
    title_tag = soup.find("title")
    if title_tag and title_tag.text:
        title = title_tag.text.strip()

    main = soup.find("main") or soup.find("article") or soup.body
    if not main:
        return "", title

    text = " ".join(segment.strip() for segment in main.stripped_strings)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:12000], title
