"""
API routes for Phase 5B: Reporter and Organization Research.

Provides endpoints for:
- Reporter profiling and lookup
- Organization funding/ownership research
- Material context for articles
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, cast
from urllib.parse import parse_qs, quote, unquote, urlparse

import httpx

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import get_db, Reporter, Organization
from app.services.entity_wiki_service import build_reporter_dossier, build_resolver_key
from app.services.funding_researcher import get_funding_researcher
from app.services.source_research import get_source_profile

router = APIRouter(prefix="/research/entity", tags=["entity-research"])
logger = get_logger("entity_research_routes")

_WIKIPEDIA_URL_CACHE: Dict[str, str] = {}


def _required_str(value: Optional[str]) -> str:
    return cast(str, value)


def _extract_wikipedia_lang_and_title(url: str) -> tuple[Optional[str], Optional[str]]:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if not host.endswith("wikipedia.org"):
        return None, None

    host_parts = host.split(".")
    if len(host_parts) < 3:
        return None, None

    lang = host_parts[0]
    if len(host_parts) > 3 and host_parts[1] == "m":
        lang = host_parts[0]

    title = None
    if parsed.path.startswith("/wiki/"):
        title = parsed.path[len("/wiki/") :]
    else:
        query = parse_qs(parsed.query)
        if "title" in query:
            title = query["title"][0]

    if not title:
        return lang, None

    title = unquote(title)
    if "#" in title:
        title = title.split("#", 1)[0]

    return lang, title


async def _resolve_english_wikipedia_url(url: str, client: httpx.AsyncClient) -> str:
    cached = _WIKIPEDIA_URL_CACHE.get(url)
    if cached:
        return cached

    lang, title = _extract_wikipedia_lang_and_title(url)
    if not lang or not title or lang == "en":
        _WIKIPEDIA_URL_CACHE[url] = url
        return url

    try:
        params = {
            "action": "query",
            "prop": "langlinks",
            "lllang": "en",
            "titles": title,
            "format": "json",
        }
        response = await client.get(
            f"https://{lang}.wikipedia.org/w/api.php", params=params
        )
        if response.status_code != 200:
            _WIKIPEDIA_URL_CACHE[url] = url
            return url

        data = response.json()
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            langlinks = page.get("langlinks") or []
            for link in langlinks:
                if link.get("lang") == "en":
                    en_title = link.get("*") or link.get("title")
                    if en_title:
                        normalized = f"https://en.wikipedia.org/wiki/{quote(en_title.replace(' ', '_'))}"
                        _WIKIPEDIA_URL_CACHE[url] = normalized
                        return normalized
    except Exception as exc:
        logger.debug("Wikipedia normalization failed for %s: %s", url, exc)

    _WIKIPEDIA_URL_CACHE[url] = url
    return url


async def _normalize_wikipedia_urls(
    urls: List[Optional[str]],
) -> List[Optional[str]]:
    unique_urls = [url for url in {u for u in urls if u}]
    if not unique_urls:
        return urls

    async with httpx.AsyncClient(timeout=10.0) as client:
        tasks = [_resolve_english_wikipedia_url(url, client) for url in unique_urls]
        results = await asyncio.gather(*tasks)

    normalized_map = dict(zip(unique_urls, results))
    return [normalized_map.get(url) if url else None for url in urls]


async def _ensure_english_wikipedia_url(
    url: Optional[str],
) -> Optional[str]:
    if not url:
        return None
    return (await _normalize_wikipedia_urls([url]))[0]


# Request/Response Models


class ReporterProfileRequest(BaseModel):
    name: str
    organization: Optional[str] = None
    article_context: Optional[str] = None


class ReporterProfileResponse(BaseModel):
    id: Optional[int] = None
    name: str
    normalized_name: Optional[str] = None
    bio: Optional[str] = None
    career_history: Optional[List[Dict[str, Any]]] = None
    topics: Optional[List[str]] = None
    education: Optional[List[Dict[str, Any]]] = None
    political_leaning: Optional[str] = None
    leaning_confidence: Optional[str] = None
    twitter_handle: Optional[str] = None
    linkedin_url: Optional[str] = None
    wikipedia_url: Optional[str] = None
    wikidata_qid: Optional[str] = None
    wikidata_url: Optional[str] = None
    canonical_name: Optional[str] = None
    match_status: Optional[str] = None
    overview: Optional[str] = None
    dossier_sections: Optional[List[Dict[str, Any]]] = None
    citations: Optional[List[Dict[str, str]]] = None
    search_links: Optional[Dict[str, str]] = None
    match_explanation: Optional[str] = None
    research_sources: Optional[List[str]] = None
    research_confidence: Optional[str] = None
    cached: bool = False


class OrganizationResearchRequest(BaseModel):
    name: str
    website: Optional[str] = None


class OrganizationResearchResponse(BaseModel):
    id: Optional[int] = None
    name: str
    normalized_name: Optional[str] = None
    org_type: Optional[str] = None
    parent_org: Optional[str] = None
    funding_type: Optional[str] = None
    funding_sources: Optional[List[str]] = None
    ein: Optional[str] = None
    annual_revenue: Optional[str] = None
    media_bias_rating: Optional[str] = None
    factual_reporting: Optional[str] = None
    wikipedia_url: Optional[str] = None
    research_sources: Optional[List[str]] = None
    research_confidence: Optional[str] = None
    cached: bool = False


class SourceResearchRequest(BaseModel):
    name: str
    website: Optional[str] = None


class SourceBatchRequest(BaseModel):
    sources: List[SourceResearchRequest]
    force_refresh: bool = False


class SourceBatchResponse(BaseModel):
    results: Dict[str, Optional[SourceResearchResponse]]
    cached_count: int
    newly_researched_count: int


class SourceResearchValue(BaseModel):
    value: str
    sources: Optional[List[str]] = None
    notes: Optional[str] = None


class SourceReporterSummary(BaseModel):
    name: str
    article_count: int


class SourceResearchResponse(BaseModel):
    name: str
    canonical_name: Optional[str] = None
    website: Optional[str] = None
    fetched_at: Optional[str] = None
    cached: bool = False
    fields: Dict[str, List[SourceResearchValue]]
    key_reporters: List[SourceReporterSummary] = []
    overview: Optional[str] = None
    match_status: Optional[str] = None
    wikipedia_url: Optional[str] = None
    wikidata_qid: Optional[str] = None
    wikidata_url: Optional[str] = None
    dossier_sections: Optional[List[Dict[str, Any]]] = None
    citations: Optional[List[Dict[str, str]]] = None
    search_links: Optional[Dict[str, str]] = None
    match_explanation: Optional[str] = None


class OwnershipChainResponse(BaseModel):
    organization: str
    chain: List[Dict[str, Any]]
    depth: int


# Endpoints


def _reporter_response_from_record(
    reporter: Reporter,
    wikipedia_url: Optional[str],
    cached: bool,
) -> ReporterProfileResponse:
    return ReporterProfileResponse(
        id=reporter.id,
        name=_required_str(reporter.name),
        normalized_name=reporter.normalized_name,
        bio=reporter.bio,
        career_history=reporter.career_history,
        topics=reporter.topics,
        education=reporter.education,
        political_leaning=reporter.political_leaning,
        leaning_confidence=reporter.leaning_confidence,
        twitter_handle=reporter.twitter_handle,
        linkedin_url=reporter.linkedin_url,
        wikipedia_url=wikipedia_url,
        wikidata_qid=reporter.wikidata_qid,
        wikidata_url=reporter.wikidata_url,
        canonical_name=reporter.canonical_name,
        match_status=reporter.match_status,
        overview=reporter.overview,
        dossier_sections=reporter.dossier_sections,
        citations=reporter.citations,
        search_links=reporter.search_links,
        match_explanation=reporter.match_explanation,
        research_sources=reporter.research_sources,
        research_confidence=reporter.research_confidence,
        cached=cached,
    )


@router.post("/reporter/profile", response_model=ReporterProfileResponse)
async def profile_reporter(
    request: ReporterProfileRequest,
    db: AsyncSession = Depends(get_db),
    force_refresh: bool = Query(False, description="Force re-research even if cached"),
) -> ReporterProfileResponse:
    """
    Profile a reporter/journalist.

    First checks the database for cached data, then researches if needed.
    """
    logger.info(f"Reporter profile request: {request.name}")
    resolver_key = build_resolver_key(request.name, request.organization)

    # Check cache first
    if not force_refresh:
        stmt = select(Reporter).where(Reporter.resolver_key == resolver_key)
        result = await db.execute(stmt)
        cached = result.scalar_one_or_none()

        if cached:
            logger.info(f"Returning cached profile for {request.name}")
            normalized_wikipedia_url = await _ensure_english_wikipedia_url(
                cached.wikipedia_url
            )
            return _reporter_response_from_record(
                cached, normalized_wikipedia_url, True
            )

    profile_data = await build_reporter_dossier(
        name=request.name,
        organization=request.organization,
        article_context=request.article_context,
    )

    profile_data["wikipedia_url"] = await _ensure_english_wikipedia_url(
        profile_data.get("wikipedia_url")
    )

    if profile_data.get("match_status") != "matched":
        return ReporterProfileResponse(
            name=_required_str(profile_data.get("name")),
            normalized_name=profile_data.get("normalized_name"),
            bio=profile_data.get("bio"),
            career_history=profile_data.get("career_history"),
            topics=profile_data.get("topics"),
            education=profile_data.get("education"),
            twitter_handle=profile_data.get("twitter_handle"),
            linkedin_url=profile_data.get("linkedin_url"),
            wikipedia_url=profile_data.get("wikipedia_url"),
            wikidata_qid=profile_data.get("wikidata_qid"),
            wikidata_url=profile_data.get("wikidata_url"),
            canonical_name=profile_data.get("canonical_name"),
            match_status=profile_data.get("match_status"),
            overview=profile_data.get("overview"),
            dossier_sections=profile_data.get("dossier_sections"),
            citations=profile_data.get("citations"),
            search_links=profile_data.get("search_links"),
            match_explanation=profile_data.get("match_explanation"),
            research_sources=profile_data.get("research_sources"),
            research_confidence=profile_data.get("research_confidence"),
            cached=False,
        )

    stmt = select(Reporter).where(Reporter.resolver_key == resolver_key)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    reporter = existing or Reporter()
    reporter.name = profile_data.get("name")
    reporter.normalized_name = profile_data.get("normalized_name")
    reporter.bio = profile_data.get("bio")
    reporter.career_history = profile_data.get("career_history")
    reporter.topics = profile_data.get("topics")
    reporter.education = profile_data.get("education")
    reporter.political_leaning = profile_data.get("political_leaning")
    reporter.leaning_confidence = profile_data.get("leaning_confidence")
    reporter.leaning_sources = profile_data.get("leaning_sources")
    reporter.twitter_handle = profile_data.get("twitter_handle")
    reporter.linkedin_url = profile_data.get("linkedin_url")
    reporter.wikipedia_url = profile_data.get("wikipedia_url")
    reporter.wikidata_qid = profile_data.get("wikidata_qid")
    reporter.wikidata_url = profile_data.get("wikidata_url")
    reporter.canonical_name = profile_data.get("canonical_name")
    reporter.resolver_key = resolver_key
    reporter.match_status = profile_data.get("match_status")
    reporter.overview = profile_data.get("overview")
    reporter.dossier_sections = profile_data.get("dossier_sections")
    reporter.citations = profile_data.get("citations")
    reporter.search_links = profile_data.get("search_links")
    reporter.match_explanation = profile_data.get("match_explanation")
    reporter.research_sources = profile_data.get("research_sources")
    reporter.research_confidence = profile_data.get("research_confidence")

    db.add(reporter)
    await db.commit()
    await db.refresh(reporter)

    normalized_wikipedia_url = await _ensure_english_wikipedia_url(
        reporter.wikipedia_url
    )
    return _reporter_response_from_record(reporter, normalized_wikipedia_url, False)


@router.get("/reporter/{reporter_id}", response_model=ReporterProfileResponse)
async def get_reporter(
    reporter_id: int,
    db: AsyncSession = Depends(get_db),
) -> ReporterProfileResponse:
    """Get a reporter by ID."""
    stmt = select(Reporter).where(Reporter.id == reporter_id)
    result = await db.execute(stmt)
    reporter = result.scalar_one_or_none()

    if not reporter:
        raise HTTPException(status_code=404, detail="Reporter not found")

    normalized_wikipedia_url = await _ensure_english_wikipedia_url(
        reporter.wikipedia_url
    )
    return _reporter_response_from_record(reporter, normalized_wikipedia_url, True)


@router.post("/organization/research", response_model=OrganizationResearchResponse)
async def research_organization(
    request: OrganizationResearchRequest,
    db: AsyncSession = Depends(get_db),
    force_refresh: bool = Query(False, description="Force re-research even if cached"),
) -> OrganizationResearchResponse:
    """
    Research a news organization's funding and ownership.
    """
    logger.info(f"Organization research request: {request.name}")

    # Check cache first
    if not force_refresh:
        stmt = select(Organization).where(
            Organization.normalized_name == request.name.lower().strip()
        )
        result = await db.execute(stmt)
        cached = result.scalar_one_or_none()

        if cached:
            logger.info(f"Returning cached org data for {request.name}")
            normalized_wikipedia_url = await _ensure_english_wikipedia_url(
                cached.wikipedia_url
            )
            return OrganizationResearchResponse(
                id=cached.id,
                name=_required_str(cached.name),
                normalized_name=cached.normalized_name,
                org_type=cached.org_type,
                parent_org=None,
                funding_type=cached.funding_type,
                funding_sources=cached.funding_sources,
                ein=cached.ein,
                annual_revenue=cached.annual_revenue,
                media_bias_rating=cached.media_bias_rating,
                factual_reporting=cached.factual_reporting,
                wikipedia_url=normalized_wikipedia_url,
                research_sources=cached.research_sources,
                research_confidence=cached.research_confidence,
                cached=True,
            )

    # Research the organization
    researcher = get_funding_researcher()
    org_data = await researcher.research_organization(
        name=request.name, website=request.website
    )

    org_data["wikipedia_url"] = await _ensure_english_wikipedia_url(
        org_data.get("wikipedia_url")
    )

    # Save to database
    organization = Organization(
        name=org_data.get("name"),
        normalized_name=org_data.get("normalized_name"),
        org_type=org_data.get("org_type"),
        funding_type=org_data.get("funding_type"),
        funding_sources=org_data.get("funding_sources"),
        ein=org_data.get("ein"),
        annual_revenue=org_data.get("annual_revenue"),
        media_bias_rating=org_data.get("media_bias_rating"),
        factual_reporting=org_data.get("factual_reporting"),
        website=org_data.get("website"),
        wikipedia_url=org_data.get("wikipedia_url"),
        research_sources=org_data.get("research_sources"),
        research_confidence=org_data.get("research_confidence"),
    )

    db.add(organization)
    await db.commit()
    await db.refresh(organization)

    return OrganizationResearchResponse(
        id=organization.id,
        name=_required_str(organization.name),
        normalized_name=organization.normalized_name,
        org_type=organization.org_type,
        parent_org=org_data.get("parent_org"),
        funding_type=organization.funding_type,
        funding_sources=organization.funding_sources,
        ein=organization.ein,
        annual_revenue=organization.annual_revenue,
        media_bias_rating=organization.media_bias_rating,
        factual_reporting=organization.factual_reporting,
        wikipedia_url=organization.wikipedia_url,
        research_sources=organization.research_sources,
        research_confidence=organization.research_confidence,
        cached=False,
    )


@router.post("/source/profile", response_model=SourceResearchResponse)
async def research_source_profile(
    request: SourceResearchRequest,
    force_refresh: bool = Query(
        False, description="Force refresh cached source profile"
    ),
    cache_only: bool = Query(
        False, description="Only return cached data, 404 if not cached"
    ),
) -> SourceResearchResponse:
    """
    Build a source profile with funding, ownership, bias, and related metadata.
    Uses file-based caching unless force_refresh is requested.
    If cache_only=true, returns cached data or 404 without triggering research.
    """
    if not request.name.strip():
        raise HTTPException(status_code=400, detail="Source name is required")

    logger.info("Source research request: %s (cache_only=%s)", request.name, cache_only)
    profile = await get_source_profile(
        source_name=request.name.strip(),
        website=request.website,
        force_refresh=force_refresh,
        cache_only=cache_only,
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="No cached profile available")
    return SourceResearchResponse(**profile)


@router.post("/source/batch", response_model=SourceBatchResponse)
async def research_source_batch(
    request: SourceBatchRequest,
) -> SourceBatchResponse:
    """
    Research multiple sources in a single request.
    Uses file-based caching unless force_refresh is requested.
    Returns results for all sources, using cache when available.
    """
    from app.services.source_research import get_source_profile

    valid_sources: List[tuple[SourceResearchRequest, str]] = []
    for source_req in request.sources:
        source_name = source_req.name.strip()
        if not source_name:
            raise HTTPException(
                status_code=400,
                detail=f"Source name cannot be empty: '{source_req.name}'",
            )
        valid_sources.append((source_req, source_name))

    async def fetch_profile(
        source_req: SourceResearchRequest,
        source_name: str,
    ) -> tuple[str, Optional[Dict[str, Any]]]:
        profile = await get_source_profile(
            source_name=source_name,
            website=source_req.website,
            force_refresh=request.force_refresh,
            cache_only=False,
        )
        return source_name, profile

    fetch_results = await asyncio.gather(
        *[fetch_profile(sr, sn) for sr, sn in valid_sources]
    )

    results: Dict[str, Optional[SourceResearchResponse]] = {}
    cached_count = 0
    newly_researched_count = 0

    for source_name, profile in fetch_results:
        if profile:
            results[source_name] = SourceResearchResponse(**profile)
            if profile.get("cached"):
                cached_count += 1
            else:
                newly_researched_count += 1
        else:
            results[source_name] = None

    return SourceBatchResponse(
        results=results,
        cached_count=cached_count,
        newly_researched_count=newly_researched_count,
    )


@router.get("/organization/{org_id}", response_model=OrganizationResearchResponse)
async def get_organization(
    org_id: int,
    db: AsyncSession = Depends(get_db),
) -> OrganizationResearchResponse:
    """Get an organization by ID."""
    stmt = select(Organization).where(Organization.id == org_id)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    normalized_wikipedia_url = await _ensure_english_wikipedia_url(org.wikipedia_url)
    return OrganizationResearchResponse(
        id=org.id,
        name=_required_str(org.name),
        normalized_name=org.normalized_name,
        org_type=org.org_type,
        parent_org=None,
        funding_type=org.funding_type,
        funding_sources=org.funding_sources,
        ein=org.ein,
        annual_revenue=org.annual_revenue,
        media_bias_rating=org.media_bias_rating,
        factual_reporting=org.factual_reporting,
        wikipedia_url=normalized_wikipedia_url,
        research_sources=org.research_sources,
        research_confidence=org.research_confidence,
        cached=True,
    )


@router.get(
    "/organization/{org_name}/ownership-chain", response_model=OwnershipChainResponse
)
async def get_ownership_chain(
    org_name: str,
    max_depth: int = Query(5, ge=1, le=10),
) -> OwnershipChainResponse:
    """Get the ownership chain for an organization."""
    researcher = get_funding_researcher()
    chain = await researcher.get_ownership_chain(org_name, max_depth)

    return OwnershipChainResponse(organization=org_name, chain=chain, depth=len(chain))


@router.get("/reporters", response_model=List[ReporterProfileResponse])
async def list_reporters(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> List[ReporterProfileResponse]:
    """List all cached reporters."""
    stmt = select(Reporter).limit(limit).offset(offset)
    result = await db.execute(stmt)
    reporters = result.scalars().all()
    normalized_wikipedia_urls = await _normalize_wikipedia_urls(
        [r.wikipedia_url for r in reporters]
    )
    return [
        _reporter_response_from_record(r, normalized_wikipedia_urls[idx], True)
        for idx, r in enumerate(reporters)
    ]


@router.get("/organizations", response_model=List[OrganizationResearchResponse])
async def list_organizations(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> List[OrganizationResearchResponse]:
    """List all cached organizations."""
    stmt = select(Organization).limit(limit).offset(offset)
    result = await db.execute(stmt)
    orgs = result.scalars().all()
    normalized_wikipedia_urls = await _normalize_wikipedia_urls(
        [o.wikipedia_url for o in orgs]
    )
    return [
        OrganizationResearchResponse(
            id=o.id,
            name=_required_str(o.name),
            normalized_name=o.normalized_name,
            org_type=o.org_type,
            parent_org=None,
            funding_type=o.funding_type,
            funding_sources=o.funding_sources,
            ein=o.ein,
            annual_revenue=o.annual_revenue,
            media_bias_rating=o.media_bias_rating,
            factual_reporting=o.factual_reporting,
            wikipedia_url=normalized_wikipedia_urls[idx],
            research_sources=o.research_sources,
            research_confidence=o.research_confidence,
            cached=True,
        )
        for idx, o in enumerate(orgs)
    ]


# Phase 5C: Material Interest Analysis


class MaterialContextRequest(BaseModel):
    source: str
    source_country: str
    mentioned_countries: List[str]
    topics: Optional[List[str]] = None
    article_text: Optional[str] = None


class MaterialContextResponse(BaseModel):
    source: str
    source_country: str
    mentioned_countries: List[str]
    trade_relationships: List[Dict[str, Any]]
    known_interests: Dict[str, Any]
    potential_conflicts: List[str]
    analysis_summary: Optional[str] = None
    reader_warnings: Optional[List[str]] = None
    confidence: Optional[str] = None
    analyzed_at: Optional[str] = None


@router.post("/material-context", response_model=MaterialContextResponse)
async def analyze_material_context(
    request: MaterialContextRequest,
) -> MaterialContextResponse:
    """
    Analyze material interests that may affect news coverage.

    Examines trade relationships, ownership interests, and potential
    conflicts of interest for a given news source and story.
    """
    from app.services.material_interest import get_material_interest_agent

    logger.info(
        f"Material context analysis: {request.source} on {request.mentioned_countries}"
    )

    agent = get_material_interest_agent()
    analysis = await agent.analyze_material_context(
        article_source=request.source,
        source_country=request.source_country,
        mentioned_countries=request.mentioned_countries,
        topics=request.topics,
        article_text=request.article_text,
    )

    return MaterialContextResponse(
        source=analysis.get("source", request.source),
        source_country=analysis.get("source_country", request.source_country),
        mentioned_countries=analysis.get(
            "mentioned_countries", request.mentioned_countries
        ),
        trade_relationships=analysis.get("trade_relationships", []),
        known_interests=analysis.get("known_interests", {}),
        potential_conflicts=analysis.get("potential_conflicts", []),
        analysis_summary=analysis.get("analysis_summary"),
        reader_warnings=analysis.get("reader_warnings"),
        confidence=analysis.get("confidence"),
        analyzed_at=analysis.get("analyzed_at"),
    )


@router.get("/country/{country_code}/economic-profile")
async def get_country_economic_profile(country_code: str) -> Dict[str, Any]:
    """Get economic profile for a country."""
    from app.services.material_interest import get_material_interest_agent

    agent = get_material_interest_agent()
    profile = await agent.get_country_economic_profile(country_code.upper())

    return {"country_code": country_code.upper(), "profile": profile}
