"""API response models for routes that previously returned untyped dicts.

These mirror exactly the JSON shapes the frontend consumes (see
frontend/lib/api/types.ts hand-declared wire types). Declaring them lets
OpenAPI generation produce a complete contract so the frontend can stop
hand-maintaining response shapes.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class CacheStatus(BaseModel):
    """CacheStatus API response model."""
    cache_age_seconds: float
    category_breakdown: dict[str, int]
    last_updated: str
    sources_with_errors: int
    sources_with_warnings: int
    sources_working: int
    total_articles: int
    total_sources: int
    update_in_progress: bool


class SourceStatsList(BaseModel):
    """SourceStatsList API response model."""
    sources: list[SourceStats]
    total_sources: int


class SourceStats(BaseModel):
    """SourceStats API response model."""
    article_count: int
    bias_rating: str | None = None
    category: str
    country: str
    error_message: str | None = None
    funding_type: str | None = None
    last_checked: str
    name: str
    status: str
    url: str


class CacheDebugArticle(BaseModel):
    """CacheDebugArticle API response model."""
    category: str
    country: str | None = None
    description: str
    id: int | None = None
    image: str | None = None
    link: str
    published: str
    source: str
    title: str


class CacheDebugResponse(BaseModel):
    """CacheDebugResponse API response model."""
    articles: list[CacheDebugArticle]
    limit: int
    offset: int
    returned: int
    source: str | None = None
    total: int


class ChromaDebugArticle(BaseModel):
    """ChromaDebugArticle API response model."""
    id: str
    metadata: dict[str, Any]
    preview: str


class ChromaDebugResponse(BaseModel):
    """ChromaDebugResponse API response model."""
    articles: list[ChromaDebugArticle]
    limit: int
    offset: int
    returned: int
    total: int | None = None


class DatabaseDebugArticle(BaseModel):
    """DatabaseDebugArticle API response model."""
    chroma_id: str | None = None
    content: str | None = None
    embedding_generated: bool | None = None
    id: int
    image_url: str | None = None
    published_at: str | None = None
    source: str
    summary: str | None = None
    title: str
    url: str


class DatabaseDebugResponse(BaseModel):
    """DatabaseDebugResponse API response model."""
    articles: list[DatabaseDebugArticle]
    limit: int
    missing_embeddings_only: bool
    newest_published: str | None = None
    offset: int
    oldest_published: str | None = None
    published_after: str | None = None
    published_before: str | None = None
    returned: int
    sort_direction: str
    source: str | None = None
    total: int


class StorageDriftReport(BaseModel):
    """StorageDriftReport API response model."""
    dangling_in_chroma: list[str]
    database_missing_embeddings: int
    database_total_articles: int
    database_with_embeddings: int
    missing_in_chroma: list[dict[str, Any]]
    missing_in_chroma_count: int
    vector_total_documents: int


class LlmLogEntry(BaseModel):
    """LlmLogEntry API response model."""
    duration_ms: int | None = None
    error_message: str | None = None
    error_type: str | None = None
    finish_reason: str | None = None
    messages: list[dict[str, Any]] | None = None
    model: str | None = None
    request_id: str | None = None
    service: str | None = None
    success: bool | None = None
    timestamp: str | None = None


class LlmLogResponse(BaseModel):
    """LlmLogResponse API response model."""
    available: bool
    entries: list[LlmLogEntry]
    path: str
    returned: int
    service: str | None = None
    success_filter: bool | None = None
    total: int


class DebugErrorEntry(BaseModel):
    """DebugErrorEntry API response model."""
    component: str | None = None
    error_message: str | None = None
    error_type: str | None = None
    event_type: str | None = None
    message: str | None = None
    model: str | None = None
    operation: str | None = None
    request_id: str | None = None
    service: str | None = None
    timestamp: str | None = None


class DebugErrorsResponse(BaseModel):
    """DebugErrorsResponse API response model."""
    include_request_stream_events: bool
    log_file: LlmLogResponse
    recent_request_stream_errors: list[DebugErrorEntry]
    returned_recent_errors: int


class StartupEventMetric(BaseModel):
    """StartupEventMetric API response model."""
    completed_at: str | None = None
    detail: str | None = None
    duration_seconds: float | None = None
    metadata: dict[str, Any] | None = None
    name: str
    started_at: str | None = None


class StartupMetricsResponse(BaseModel):
    """StartupMetricsResponse API response model."""
    completed_at: str | None = None
    duration_seconds: float | None = None
    events: list[StartupEventMetric]
    notes: dict[str, Any]
    started_at: str | None = None


class CountryListItem(BaseModel):
    """CountryListItem API response model."""
    article_count: int
    code: str
    latest_article: str | None


class CountryListResponse(BaseModel):
    """CountryListResponse API response model."""
    countries: list[CountryListItem]
    total_countries: int


class CountryGeoData(BaseModel):
    """CountryGeoData API response model."""
    countries: dict[str, dict[str, Any]]
    total: int


class CountryPickerItem(BaseModel):
    """CountryPickerItem API response model."""
    article_count: int
    code: str
    heat_count: int
    latest_article: str | None
    name: str
    source_count: int


class LocalLensResponse(BaseModel):
    """LocalLensResponse API response model."""
    articles: list[dict[str, Any]]
    country_code: str
    country_name: str | None = None
    geo_signal: dict[str, Any] | None = None
    has_more: bool
    limit: int
    matching_strategy: str | None = None
    offset: int
    returned: int
    source_count: int | None = None
    total: int
    view: str
    view_description: str
    window_hours: int | None = None


class LikedEntry(BaseModel):
    """LikedEntry API response model."""
    article: dict[str, Any]
    articleId: int
    createdAt: str | None = None
    likedId: int


class LikedListResponse(BaseModel):
    """LikedListResponse API response model."""
    liked: list[LikedEntry]
    total: int


class BookmarkEntry(BaseModel):
    """BookmarkEntry API response model."""
    article: dict[str, Any]
    articleId: int
    bookmarkId: int
    createdAt: str | None = None


class BookmarkListResponse(BaseModel):
    """BookmarkListResponse API response model."""
    bookmarks: list[BookmarkEntry]
    total: int


class AddRssResponse(BaseModel):
    """AddRssResponse API response model."""
    article_count: int
    duplicate_candidates: list[dict[str, Any]] | None = None
    inferred: dict[str, Any] | None = None
    name: str
    promoted: bool | None = None
    sample_articles: list[dict[str, Any]] | None = None
    status: str
    success: bool
    url: str


class RelatedArticlesResponse(BaseModel):
    """RelatedArticlesResponse API response model."""
    article_id: int
    related: list[dict[str, Any]]
    total: int


class NoveltyScoreResponse(BaseModel):
    """NoveltyScoreResponse API response model."""
    article_id: int
    avg_similarity_to_history: float
    history_size: int
    max_similarity_to_history: float
    novelty_score: float
    reason: str | None = None


class ArticleTopic(BaseModel):
    """ArticleTopic API response model."""
    cluster_id: int
    keywords: list[str] | None = None
    label: str
    similarity: float | None


class ArticleTopicsResponse(BaseModel):
    """ArticleTopicsResponse API response model."""
    article_id: int
    topics: list[ArticleTopic]


class BulkArticleTopicsResponse(BaseModel):
    """BulkArticleTopicsResponse API response model."""
    articles: dict[str, list[ArticleTopic]]


class SearchSuggestionsResponse(BaseModel):
    """SearchSuggestionsResponse API response model."""
    query: str
    suggestions: list[dict[str, Any]]


class SourceCoverageStats(BaseModel):
    """SourceCoverageStats API response model."""
    article_count: int
    centroid_distance: float | None = None
    diversity_score: float | None = None
    spread: float | None = None


class SourceCoverageResponse(BaseModel):
    """SourceCoverageResponse API response model."""
    error: str | None = None
    global_article_count: int
    sources: dict[str, SourceCoverageStats]


class TrendingStats(BaseModel):
    """TrendingStats API response model."""
    active_clusters: int
    baseline_days: int
    breaking_window_hours: int
    recent_spikes: int
    similarity_threshold: float
    total_article_assignments: int


class BlindspotGeographySignal(BaseModel):
    """BlindspotGeographySignal API response model."""
    count: int
    id: str
    label: str


class BlindspotCoverageCounts(BaseModel):
    """BlindspotCoverageCounts API response model."""
    pole_a: int
    shared: int
    pole_b: int


class BlindspotPaywallConcentration(BaseModel):
    """BlindspotPaywallConcentration API response model."""
    best_free_sources: list[str]
    free_articles: int
    paywalled_articles: int
    paywall_share: float
    status: str
    total_articles: int
    unknown_articles: int


class BlindspotPreviewArticle(BaseModel):
    """BlindspotPreviewArticle API response model."""
    authors: list[str] | None = None
    author: str | None = None
    bias: str | None = None
    category: str | None = None
    country: str | None = None
    credibility: str | None = None
    id: int
    image_url: str | None = None
    published_at: str | None = None
    similarity: float
    source: str
    source_country: str | None = None
    source_id: str | None = None
    summary: str | None = None
    title: str
    url: str


class BlindspotCard(BaseModel):
    """BlindspotCard API response model."""
    article_count: int
    articles: list[BlindspotPreviewArticle]
    balance_score: float
    blindspot_score: float
    cluster_id: int
    cluster_label: str
    coverage_counts: BlindspotCoverageCounts
    coverage_shares: BlindspotCoverageCounts
    explanation: str
    geography_signals: list[BlindspotGeographySignal]
    keywords: list[str]
    lane: str
    paywall_concentration: BlindspotPaywallConcentration
    published_at: str | None = None
    representative_article: BlindspotPreviewArticle | None = None
    source_count: int


class BlindspotLensResponse(BaseModel):
    """BlindspotLensResponse API response model."""
    available: bool
    description: str
    id: str
    label: str
    unavailable_reason: str | None = None


class BlindspotLaneResponse(BaseModel):
    """BlindspotLaneResponse API response model."""
    cluster_count: int
    description: str
    id: str
    label: str


class BlindspotSummary(BaseModel):
    """BlindspotSummary API response model."""
    category: str | None = None
    eligible_clusters: int
    generated_at: str
    source_filters: list[str]
    window: str


class BlindspotViewerResponse(BaseModel):
    """BlindspotViewerResponse API response model."""
    available_lenses: list[BlindspotLensResponse]
    cards: list[BlindspotCard]
    lanes: list[BlindspotLaneResponse]
    selected_lens: BlindspotLensResponse
    status: str
    summary: BlindspotSummary
