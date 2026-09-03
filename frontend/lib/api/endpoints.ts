// Thin endpoint definitions. Every function is a boring mapping from
// arguments to a request; parsing/validation lives in schemas.ts or client.ts.

import { z } from "zod";

import type { AgenticResearchCitation, AgenticResearchResult } from "./primitives";
import { api, query } from "./client";
import { BackendSourceSchema, CacheStatusSchema, PaginatedPayloadSchema } from "./schemas";
import { mapBackendArticles, mapBackendSource } from "./article";
import { fetchOGImage } from "./og-image";
import type {
AddRssResponse,
ReadonlyNewsArticle,
ApiOpaqueObject,
ArticleAnalysis,
ArticleTopic,
BlindspotCard,
BlindspotLane,
BlindspotLens,
BlindspotSummary,
BookmarkEntry,
BreakingResponse,
CacheDebugResponse,
CacheDeltaResponse,
CacheRefreshProgress,
CacheStatus,
ChromaDebugResponse,
CountryGeoData,
ClusterDetail,
ContradictionPanelResponse,
AllClustersResponse,
CountryListResponse,
DatabaseDebugResponse,
DebugErrorsResponse,
Highlight,
LikedEntry,
LlmLogResponse,
LocalLensResponse,
NewsArticle,
NewsSource,
NoveltyScoreResponse,
PaginatedResponse,
QueueDigest,
QueueOverview,
ReadingQueueItem,
ReadingShelf,
ReadonlyBackendArticle,
RelatedArticlesResponse,
ReporterCareerTimeline,
ReporterProfile,
SearchSuggestionsResponse,
SemanticSearchResponse,
SourceCoverageResponse,
SourceCredibilityProfile,
SourceDebugData,
SourceResearchProfile,
SourceStats,
SourceStatsList,
BookmarkListResponse,
LikedListResponse,
FrontendDebugReportPayload,
LanguageDiagnostics,
StartupMetricsResponse,
StorageDriftReport,
StoryLineageResponse,
TrendingResponse,
WikiIndexStatus,
WikiReporterCard,
WikiReporterDossier,
WikiSourceProfile,
} from "./types";
const NOT_FOUND = 404;
const UNAVAILABLE = 503;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// --- Feature flags & shared cache ---
export { API_BASE_URL, ENABLE_DIGEST, ENABLE_HIGHLIGHTS } from "./client";

export type { AgenticResearchCitation, AgenticResearchResult } from "./primitives";
export { fetchOGImage };

export interface SourceCacheState {
  sources: NewsSource[];
}

const sourceCache: SourceCacheState = { sources: [] };

export async function fetchNewsIndex(
  params: Readonly<{
    category?: string | null;
    source?: string | null;
    sources?: string | null;
    search?: string | null;
  }> = {},
): Promise<PaginatedResponse> {
  const payload: unknown = await api(
    `/news/index/cached${query({
      category: params.category,
      search: params.search,
      source: params.source,
      sources: params.sources,
    })}`,
  );
  const parsed = PaginatedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Browse index response is invalid.");
  }
  return {
    // SAFETY: schema permits null article entries; non-null entries match ReadonlyBackendArticle.
    articles: mapBackendArticles((parsed.data.articles ?? []) as ReadonlyBackendArticle[]),
    has_more: parsed.data.has_more ?? false,
    limit: 0,
    next_cursor: parsed.data.next_cursor ?? null,
    prev_cursor: parsed.data.prev_cursor ?? null,
    total: parsed.data.total ?? 0,
  };
}

export const fetchLiveBrowseIndex = fetchNewsIndex;

export const fetchBrowseIndex = async (
  params: Readonly<{
    category?: string | null;
    source?: string | null;
    sources?: string | null;
    search?: string | null;
  }> = {},
): Promise<PaginatedResponse> => {
  const payload: unknown = await api(
    `/news/index${query({
      category: params.category,
      search: params.search,
      source: params.source,
      sources: params.sources,
    })}`,
  );
  const parsed = PaginatedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Browse index response is invalid.");
  }
  return {
    // SAFETY: schema permits null article entries; non-null entries match ReadonlyBackendArticle.
    articles: mapBackendArticles((parsed.data.articles ?? []) as ReadonlyBackendArticle[]),
    has_more: parsed.data.has_more ?? false,
    limit: 0,
    next_cursor: parsed.data.next_cursor ?? null,
    prev_cursor: parsed.data.prev_cursor ?? null,
    total: parsed.data.total ?? 0,
  };
};

export const fetchCachedNewsPaginated = async (
  params: Readonly<{
    limit?: number;
    offset?: number;
    category?: string | null;
    source?: string | null;
    sources?: string | null;
    search?: string | null;
  }> = {},
): Promise<PaginatedResponse> => {
  const payload: unknown = await api(
    `/news/page/cached${query({
      category: params.category,
      limit: params.limit,
      offset: params.offset,
      search: params.search,
      source: params.source,
      sources: params.sources,
    })}`,
  );
  const parsed = PaginatedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Browse index response is invalid.");
  }
  return {
    // SAFETY: schema permits null article entries; non-null entries match ReadonlyBackendArticle.
    articles: mapBackendArticles((parsed.data.articles ?? []) as ReadonlyBackendArticle[]),
    has_more: parsed.data.has_more ?? false,
    limit: parsed.data.limit ?? 0,
    next_cursor: parsed.data.next_cursor ?? null,
    prev_cursor: null,
    total: parsed.data.total ?? 0,
  };
};

export const fetchNewsPaginated = async (
  params: Readonly<{
    limit?: number;
    cursor?: string | null;
    category?: string | null;
    source?: string | null;
    sources?: string | null;
    search?: string | null;
    sort_order?: string;
  }> = {},
): Promise<PaginatedResponse> => {
  const payload: unknown = await api(
    `/news/page${query({
      category: params.category,
      cursor: params.cursor,
      limit: params.limit,
      search: params.search,
      sort_order: params.sort_order,
      source: params.source,
      sources: params.sources,
    })}`,
  );
  const parsed = PaginatedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Browse index response is invalid.");
  }
  return {
    // SAFETY: schema permits null article entries; non-null entries match ReadonlyBackendArticle.
    articles: mapBackendArticles((parsed.data.articles ?? []) as ReadonlyBackendArticle[]),
    has_more: parsed.data.has_more ?? false,
    limit: parsed.data.limit ?? 0,
    next_cursor: parsed.data.next_cursor ?? null,
    prev_cursor: parsed.data.prev_cursor ?? null,
    total: parsed.data.total ?? 0,
  };
};

// --- Sources ---

export const fetchSources = async (): Promise<NewsSource[]> => {
  const payload: unknown = await api("/news/sources");
  const parsed = z.array(BackendSourceSchema).safeParse(payload);
  if (!parsed.success) {
    console.warn("fetchSources received malformed payload");
    return [];
  }
  return parsed.data.map(mapBackendSource);
};

export const fetchCategories = async (): Promise<string[]> => {
  const payload = await api<string[]>("/categories");
  return payload;
};

export const getSourceById = async (id: string): Promise<NewsSource | undefined> => {
  if (sourceCache.sources.length === 0) {
    sourceCache.sources = await fetchSources();
  }
  const normalized = id.trim().toLowerCase();
  return sourceCache.sources.find((source) => source.id === normalized);
};

const isSourceStatsStatus = (value: string): value is SourceStats["status"] =>
  ["success", "warning", "error"].includes(value);

export const fetchSourceStats = async (): Promise<SourceStats[]> => {
  const payload = await api<SourceStatsList>("/news/sources/stats");
  return payload.sources.map((source) => ({
    article_count: source.article_count,
    bias_rating: source.bias_rating ?? undefined,
    category: source.category,
    country: source.country,
    error_message: source.error_message ?? undefined,
    funding_type: source.funding_type ?? undefined,
    last_checked: source.last_checked,
    name: source.name,
    status: isSourceStatsStatus(source.status) ? source.status : "error",
    url: source.url,
  }));
};

export const fetchSourceDebugData = (sourceName: string): Promise<SourceDebugData> =>
  api(`/debug/sources/${encodeURIComponent(sourceName)}`);

export const validateRssUrl = (url: string): Promise<AddRssResponse> =>
  api("/sources/rss/validate", {
    body: JSON.stringify({ url }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const promoteRssSource = (
  request: Readonly<{
    url: string;
    name?: string;
    category?: string;
    country?: string;
    source_type?: string;
    funding_type?: string;
    bias_rating?: string;
    ownership_label?: string;
    factual_reporting?: string;
    is_paywalled?: boolean;
  }>,
): Promise<AddRssResponse> =>
  api("/sources/rss/promote", {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

// --- Cache ---

export const fetchCacheStatus = async (): Promise<CacheStatus | null> => {
  try {
    const payload: unknown = await api("/cache/status");
    const parsed = CacheStatusSchema.safeParse(payload);
    if (!parsed.success) {
      console.error("Failed to parse cache status:", parsed.error);
      return null;
    }
    return parsed.data;
  } catch (error) {
    console.error("Failed to fetch cache status:", error);
    return null;
  }
};

export const refreshCache = async (
  onProgress?: (progress: CacheRefreshProgress) => void,
): Promise<boolean> => {
  const response = await fetch(`${API_BASE_URL}/cache/refresh/stream`, { method: "POST" });
  if (!response.ok || response.body === null) {
    return false;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return true;
    }
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      if (!line.startsWith("data:")) {
        continue;
      }
      try {
        // SAFETY: the SSE cache_stream wire format matches CacheRefreshProgress.
        const event = JSON.parse(line.slice(5).trim()) as CacheRefreshProgress;
        onProgress?.(event);
      } catch {
        return true;
      }
    }
  }
};

// --- Bookmarks / liked / highlights / queue ---

export const fetchBookmarks = (): Promise<BookmarkListResponse> => api("/api/bookmarks");

export const createBookmark = async (
  articleId: number,
): Promise<BookmarkEntry | null> => {
  try {
    return await api<BookmarkEntry>("/api/bookmarks", {
      body: JSON.stringify({ article_id: articleId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    console.error("Failed to create bookmark:", error);
    return null;
  }
};

export const deleteBookmark = async (articleId: number): Promise<boolean> => {
  const response = await fetch(`${API_BASE_URL}/api/bookmarks/${articleId}`, {
    method: "DELETE",
  });
  if (response.status === NOT_FOUND) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return true;
};

export const fetchLikedArticles = (): Promise<LikedListResponse> => api("/api/liked");

export const createLikedArticle = async (
  articleId: number,
): Promise<LikedEntry | null> => {
  try {
    return await api<LikedEntry>("/api/liked", {
      body: JSON.stringify({ article_id: articleId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    console.error("Failed to like article:", error);
    return null;
  }
};

export const deleteLikedArticle = async (articleId: number): Promise<boolean> => {
  const response = await fetch(`${API_BASE_URL}/api/liked/${articleId}`, {
    method: "DELETE",
  });
  if (response.status === NOT_FOUND) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return true;
};

export const getAllHighlights = (): Promise<Highlight[]> => api("/api/queue/highlights");

export const deleteHighlight = async (highlightId: number): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/queue/highlights/${highlightId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
};

export const getQueueOverview = (): Promise<QueueOverview> => api("/api/queue/overview");

export const getDailyDigest = (): Promise<QueueDigest> => api("/api/queue/digest/daily");

export const getReadingShelves = (): Promise<ReadingShelf[]> => api("/api/queue/shelves");

export const createReadingShelf = (
  request: Readonly<{ name: string; description?: string | null }>,
): Promise<ReadingShelf> =>
  api("/api/queue/shelves", {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const addToReadingQueue = (
  article: ReadonlyNewsArticle,
  queueType: "daily" | "permanent" = "daily",
): Promise<ReadingQueueItem> =>
  api("/api/queue/add", {
    body: JSON.stringify({
      article_id: article.id,
      article_image: article.image,
      article_source: article.source,
      article_title: article.title,
      article_url: article.url,
      queue_type: queueType,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const removeFromReadingQueueByUrl = async (articleUrl: string): Promise<void> => {
  const encodedUrl = encodeURIComponent(articleUrl);
  const response = await fetch(`${API_BASE_URL}/api/queue/url/${encodedUrl}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
};

// --- Trending / breaking / clusters ---

export const fetchTrending = (
  window: "1d" | "1w" | "1m" = "1d",
  limit = 10,
): Promise<TrendingResponse> => api(`/trending${query({ limit, window })}`);

export const fetchBreaking = (limit = 5): Promise<BreakingResponse> =>
  api(`/trending/breaking${query({ limit })}`);

export const fetchAllClusters = (
  window: "1d" | "1w" | "1m" = "1d",
  minArticles = 2,
  limit = 100,
): Promise<AllClustersResponse> =>
  api(`/trending/clusters${query({ limit, min_articles: minArticles, window })}`);

export const fetchClusterDetail = (clusterId: number): Promise<ClusterDetail> =>
  api(`/trending/clusters/${clusterId}`);

export const fetchClusterContradictions = (
  clusterId: number,
): Promise<ContradictionPanelResponse> =>
  api(`/trending/clusters/${clusterId}/contradictions`);

export const fetchClusterLineage = (clusterId: number): Promise<StoryLineageResponse> =>
  api(`/trending/clusters/${clusterId}/lineage`);

export const fetchClusterArticles = async (clusterId: number): Promise<NewsArticle[]> => {
  const detail = await fetchClusterDetail(clusterId);
  return detail.articles.map((article) => ({
    author: article.author ?? undefined,
    authors: article.authors ?? [],
    bias: "center",
    category: "trending",
    country: "US",
    credibility: "medium",
    id: article.id,
    image: article.image_url ?? "/placeholder.svg",
    originalLanguage: "en",
    publishedAt: article.published_at ?? "",
    source: article.source,
    sourceId: article.source_id ?? article.source.toLowerCase().replaceAll(/\s+/gu, "-"),
    summary: article.summary ?? "",
    tags: ["trending", article.source],
    title: article.title,
    translated: false,
    url: article.url,
  }));
};

// --- Search ---

export const semanticSearch = async (
  queryText: string,
  options: Readonly<{ limit?: number; category?: string }> = {},
): Promise<SemanticSearchResponse> => {
  const url = `/api/search/semantic${query({
    category: options.category,
    limit: options.limit,
    query: queryText,
  })}`;
  const response = await fetch(`${API_BASE_URL}${url}`);
  if (response.status === UNAVAILABLE) {
    throw new Error("Semantic search is currently unavailable.");
  }
  const payload: unknown = await response.json();
  return payload as SemanticSearchResponse;
};

export const fetchSearchSuggestions = async (
  queryText: string,
  limit = 5,
): Promise<SearchSuggestionsResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/similarity/search-suggestions${query({ limit, query: queryText })}`,
  );
  if (response.status === UNAVAILABLE) {
    throw new Error("Search suggestions unavailable");
  }
  const payload: unknown = await response.json();
  return payload as SearchSuggestionsResponse;
};

// --- Similarity / topics ---

export const fetchRelatedArticles = (
  articleId: number,
  limit = 5,
  excludeSameSource = true,
): Promise<RelatedArticlesResponse> =>
  api(`/api/similarity/related${query({
    article_id: articleId,
    exclude_same_source: excludeSameSource,
    limit,
  })}`);

export const fetchSourceCoverage = async (
  sourceIds: readonly string[],
  sampleSize = 100,
): Promise<SourceCoverageResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/similarity/source-coverage${query({
      sample_size: sampleSize,
      source_ids: sourceIds.join(","),
    })}`,
  );
  if (response.status === UNAVAILABLE) {
    throw new Error("Source coverage unavailable");
  }
  const payload: unknown = await response.json();
  return payload as SourceCoverageResponse;
};

export const fetchNoveltyScore = (
  articleId: number,
  readingHistory: readonly number[],
): Promise<NoveltyScoreResponse> =>
  api("/api/similarity/novelty-score", {
    body: JSON.stringify({ article_id: articleId, reading_history: readingHistory }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const fetchArticleTopics = async (
  articleId: number,
): Promise<{ article_id: number; topics: ArticleTopic[] }> => {
  const response = await fetch(`${API_BASE_URL}/api/similarity/article-topics/${articleId}`);
  if (response.status === UNAVAILABLE) {
    throw new Error("Topic lookup unavailable");
  }
  const payload: unknown = await response.json();
  return payload as { article_id: number; topics: ArticleTopic[] };
};

export const fetchBulkArticleTopics = async (
  articleIds: readonly number[],
): Promise<{ articles: Record<number, ArticleTopic[]> }> =>
  api<{ articles: Record<number, ArticleTopic[]> }>("/api/similarity/bulk-article-topics", {
    body: JSON.stringify(articleIds),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

// --- Geography ---

export const fetchCountryGeoData = (): Promise<CountryGeoData> =>
  api("/news/countries/geo");

export const fetchCountryList = (): Promise<CountryListResponse> => api("/news/countries");

export const fetchLocalLens = (
  countryCode: string,
  params: Readonly<{ limit?: number; offset?: number }> = {},
): Promise<LocalLensResponse> =>
  api(`/news/countries/${countryCode}/local${query(params)}`);

// --- Blindspot ---

export const fetchBlindspotViewer = (
  params: Readonly<{
    lens?: BlindspotLens["id"];
    window?: "1d" | "1w" | "1m";
    category?: string;
    sources?: string | null;
    perLane?: number;
  }> = {},
): Promise<{
  available_lenses: BlindspotLens[];
  selected_lens: BlindspotLens;
  summary: BlindspotSummary;
  lanes: BlindspotLane[];
  cards: BlindspotCard[];
  status: string;
}> =>
  api(`/blindspots/viewer${query({
    category: params.category,
    lens: params.lens,
    per_lane: params.perLane,
    sources: params.sources,
    window: params.window,
  })}`);

// --- Analysis / research ---

export const analyzeArticle = (
  url: string,
  sourceName?: string,
): Promise<ArticleAnalysis> =>
  api("/api/article/analyze", {
    body: JSON.stringify({ source_name: sourceName, url }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const performAgenticSearch = async (
  queryText: string,
  maxSteps = 8,
): Promise<AgenticResearchResult> => {
  const payload = await api<{
    readonly answer: string;
    readonly query?: string;
    readonly referenced_articles?: readonly AgenticResearchCitation[];
    readonly success: boolean;
    readonly thinking_steps?: readonly unknown[];
  }>("/api/news/research", {
    body: JSON.stringify({ max_steps: maxSteps, query: queryText }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return {
    answer: payload.answer,
    citations: payload.referenced_articles,
    reasoning: payload.thinking_steps,
    success: payload.success,
  };
};

export const researchSourceProfile = (
  name: string,
  website?: string,
  forceRefresh = false,
): Promise<SourceResearchProfile> =>
  api(`/research/entity/source/profile${forceRefresh ? "?force_refresh=true" : ""}`, {
    body: JSON.stringify({ name, website }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const checkSourceProfileCache = (
  name: string,
  website?: string,
): Promise<SourceResearchProfile | null> =>
  api<SourceResearchProfile | null>("/research/entity/source/profile?cache_only=true", {
    body: JSON.stringify({ name, website }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const profileReporter = (
  name: string,
  organization?: string,
  articleContext?: string,
  forceRefresh = false,
): Promise<ReporterProfile> =>
  api(`/research/entity/reporter/profile${forceRefresh ? "?force_refresh=true" : ""}`, {
    body: JSON.stringify({ article_context: articleContext, name, organization }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const fetchSourceCredibility = (
  domain: string,
): Promise<SourceCredibilityProfile> =>
  api(`/sources/${encodeURIComponent(domain)}/credibility`);

// --- Wiki ---

export const fetchWikiSource = (sourceName: string): Promise<WikiSourceProfile> =>
  api(`/api/wiki/sources/${encodeURIComponent(sourceName)}`);

export const fetchWikiReporters = (
  params: Readonly<{ search?: string; outlet?: string; limit?: number; offset?: number }> = {},
): Promise<WikiReporterCard[]> => api(`/api/wiki/reporters${query(params)}`);

export const fetchWikiReporter = (reporterId: number): Promise<WikiReporterDossier> =>
  api(`/api/wiki/reporters/${reporterId}`);

const ReporterOwnershipRefSchema = z.object({
  entity_id: z.string(),
  entity_type: z.string().nullable().optional(),
  label: z.string(),
  profile_path: z.string().nullable().optional(),
});

const ReporterSharedOwnerFindingSchema = z.object({
  claim_ids: z.array(z.string()),
  evidence_count: z.number(),
  outlets: z.array(ReporterOwnershipRefSchema),
  owner: ReporterOwnershipRefSchema,
});

const ReporterTimelineEntrySchema = z.object({
  article_count: z.number().nullable().optional(),
  end_date: z.string().nullable().optional(),
  evidence_url: z.string().nullable().optional(),
  outlet: z.string(),
  role: z.string().nullable().optional(),
  source: z.enum(["byline", "affiliation"]),
  start_date: z.string().nullable().optional(),
});

const ReporterCareerTimelineSchema = z.object({
  shared_owner_findings: z.array(ReporterSharedOwnerFindingSchema),
  timeline: z.array(ReporterTimelineEntrySchema),
});

export type ReporterCareerTimelineInput = z.input<typeof ReporterCareerTimelineSchema>;

export type ReporterCareerTimelineCandidate = ReporterCareerTimelineInput | ApiOpaqueObject | null;

export const parseReporterCareerTimeline = (
  raw: ReporterCareerTimelineCandidate,
): ReporterCareerTimeline | null => {
  if (!raw) {
    return null;
  }
  const result = ReporterCareerTimelineSchema.safeParse(raw);
  return result.success ? result.data : null;
};

export const fetchWikiIndexStatus = (): Promise<WikiIndexStatus> =>
  api("/api/wiki/index/status");

export const triggerWikiIndex = (
  sourceName: string,
): Promise<{ status: string; message: string }> =>
  api(`/api/wiki/index/${encodeURIComponent(sourceName)}`, { method: "POST" });

// --- Highlights / language diagnostics / inline definition ---

export const createHighlight = (
  request: Readonly<{
    article_url: string;
    highlighted_text: string;
    color: Highlight["color"];
    note?: string;
    character_start: number;
    character_end: number;
    client_id?: string;
  }>,
): Promise<Highlight> =>
  api("/api/queue/highlights", {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const updateHighlight = (
  highlightId: number,
  request: Readonly<{
    note?: string;
    color?: Highlight["color"];
    article_url?: string;
    highlighted_text?: string;
    character_start?: number;
    character_end?: number;
  }>,
): Promise<Highlight> =>
  api(`/api/queue/highlights/${highlightId}`, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });

export const getHighlightsForArticle = (
  articleUrl: string,
): Promise<Highlight[]> =>
  api(`/api/queue/highlights/article/${encodeURIComponent(articleUrl)}`);

export const fetchLanguageDiagnostics = (
  request: Readonly<{
    url: string;
    sourceName?: string;
    text?: string;
    title?: string;
  }>,
): Promise<LanguageDiagnostics> =>
  api("/api/article/language-diagnostics", {
    body: JSON.stringify({
      source_name: request.sourceName,
      text: request.text,
      title: request.title,
      url: request.url,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const requestInlineDefinition = (
  term: string,
  context?: string,
): Promise<{
  success: boolean;
  term: string;
  definition?: string | null;
  error?: string | null;
}> =>
  api("/api/inline/define", {
    body: JSON.stringify({ context, term }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export const sendFrontendDebugReport = async (
  payload: FrontendDebugReportPayload,
): Promise<void> => {
  try {
    await api("/debug/logs/frontend", {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    console.error("Failed to send frontend debug report:", error);
  }
};

// --- Debug ---

export const fetchDebugErrors = (
  options: Readonly<{
    limit?: number;
    offset?: number;
    includeRequestStreamEvents?: boolean;
  }> = {},
): Promise<DebugErrorsResponse> =>
  api(`/debug/errors${query({
    include_request_stream_events: options.includeRequestStreamEvents,
    limit: options.limit,
    offset: options.offset,
  })}`);

export const fetchLlmLogs = (
  options: Readonly<{ limit?: number; offset?: number; service?: string; success?: boolean }> = {},
): Promise<LlmLogResponse> =>
  api(`/debug/llm/logs${query({
    limit: options.limit,
    offset: options.offset,
    service: options.service,
    success: options.success,
  })}`);

export const fetchStartupMetrics = async (): Promise<StartupMetricsResponse> => {
  const raw = await api<{
    started_at?: string | null;
    completed_at?: string | null;
    duration_seconds?: number | null;
    events: readonly {
      name: string;
      started_at?: string | null;
      completed_at?: string | null;
      duration_seconds?: number | null;
      detail?: string | null;
      metadata?: ApiOpaqueObject;
    }[];
    notes: ApiOpaqueObject;
  }>("/debug/startup");
  return {
    completedAt: raw.completed_at ?? null,
    durationSeconds: raw.duration_seconds ?? null,
    events: raw.events.map((event) => ({
      completedAt: event.completed_at ?? null,
      detail: event.detail ?? null,
      durationSeconds: event.duration_seconds ?? null,
      metadata: event.metadata,
      name: event.name,
      startedAt: event.started_at ?? null,
    })),
    notes: raw.notes,
    startedAt: raw.started_at ?? null,
  };
};

export const fetchCacheDebugArticles = (
  params: Readonly<{ limit?: number; offset?: number; source?: string }> = {},
): Promise<CacheDebugResponse> =>
  api(`/debug/cache/articles${query({ limit: params.limit, offset: params.offset, source: params.source })}`);

export const fetchCacheDelta = (
  params: Readonly<{
    sample_limit?: number;
    sample_offset?: number;
    source?: string;
    sample_preview_limit?: number;
  }> = {},
): Promise<CacheDeltaResponse> =>
  api(`/debug/cache/delta${query({
    sample_limit: params.sample_limit,
    sample_offset: params.sample_offset,
    sample_preview_limit: params.sample_preview_limit,
    source: params.source,
  })}`);

export const fetchChromaDebugArticles = (
  params: Readonly<{ limit?: number; offset?: number }> = {},
): Promise<ChromaDebugResponse> =>
  api(`/debug/chroma/articles${query({ limit: params.limit, offset: params.offset })}`);

export const fetchDatabaseDebugArticles = (
  params: Readonly<{
    limit?: number;
    offset?: number;
    source?: string;
    missing_embeddings_only?: boolean;
    sort_direction?: "asc" | "desc";
    published_before?: string;
    published_after?: string;
  }> = {},
): Promise<DatabaseDebugResponse> =>
  api(`/debug/database/articles${query({
    limit: params.limit,
    missing_embeddings_only: params.missing_embeddings_only,
    offset: params.offset,
    published_after: params.published_after,
    published_before: params.published_before,
    sort_direction: params.sort_direction,
    source: params.source,
  })}`);

export const fetchStorageDrift = (sampleLimit = 50): Promise<StorageDriftReport> =>
  api(`/debug/storage/drift${query({ sample_limit: sampleLimit })}`);

// --- Re-exports used by consumers ---

export { mapBackendArticles, mapBackendSource } from "./article";
export { streamNews, removeDuplicateArticles } from "./streaming";
export { PaginatedPayloadSchema } from "./schemas";
export type {
  StreamEvent,
  StreamOptions,
  StreamProgress,
  StreamResult,
  StreamRuntime,
  ApiOpaqueObject,
  BackendArticleMapping,
  ReadonlyBackendArticle,
  NewsArticle,
  NewsSource,
  GdeltContext,
  ThinkingStep,
  ArticleAnalysis,
  DebugErrorEntry,
  LlmLogEntry,
  CacheStatus,
  CacheDebugResponse,
  CacheDeltaResponse,
  ChromaDebugResponse,
  DatabaseDebugResponse,
  StorageDriftReport,
  StartupEventMetric,
  StartupMetricsResponse,
  SourceStats,
  SourceDebugData,
  SourceCredibilityProfile,
  SourceResearchProfile,
  ReporterProfile,
  ReporterCareerTimeline,
  AddRssResponse,
  QueueOverview,
  ReadingShelf,
  Highlight,
  PaginatedResponse,
  PaginationParams,
  FactCheckResult,
  LanguageDiagnosticExample,
  LanguageDiagnosticMetric,
  LanguageDiagnostics,
  FrontendDebugReportPayload,
  TrendingResponse,
  BreakingResponse,
  AllClustersResponse,
  ClusterDetail,
  ContradictionPanelResponse,
  StoryLineageResponse,
  BlindspotLens,
  BlindspotLane,
  BlindspotCard,
  NoveltyScoreResponse,
  SearchSuggestionsResponse,
  SemanticSearchResponse,
  SourceCoverageResponse,
  ArticleTopic,
  WikiAnalysisAxis,
  WikiIndexStatus,
  WikiReporterCard,
  WikiReporterDossier,
  WikiSourceProfile,
  CountryArticleCounts,
  CountryListItem,
  CountryListResponse,
  LocalLensResponse,
  AllCluster,
  BlindspotSummary,
BookmarkEntry,
  BreakingCluster,
  CredibilityDimension,
  DebugErrorsResponse,
  LikedEntry,
  LlmLogResponse,
  RelatedArticle,
  SearchSuggestion,
  SemanticSearchResult,
  SourceLedger,
  SourceLedgerMetric,
  TrendingArticle,
  TrendingCluster,
} from "./types";
