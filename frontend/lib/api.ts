import { logger } from "@/lib/logger";
import { z } from "zod";
import type {
  components as OpenApiComponents,
  paths as OpenApiPaths,
} from "@/lib/generated/openapi";
// API utility for communicating with FastAPI backend

const DEFAULT_BACKEND_PORT = "8000"
const LOCAL_BACKEND_FALLBACK = `http://localhost:${DEFAULT_BACKEND_PORT}`
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"])

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.trim().toLowerCase())
}

// Default to localhost backend when env var is not set. If the UI is opened from
// another device on the LAN, rewrite localhost-style backend URLs to the current
// browser hostname so the remote browser still talks to this machine.
const resolveBaseUrl = (value?: string) => {
  const raw = value && value.trim().length > 0 ? value : LOCAL_BACKEND_FALLBACK
  const normalized = raw.replace(/\/+$/, "")

  if (typeof window === "undefined") {
    return normalized
  }

  try {
    const url = new URL(normalized)
    const browserHostname = window.location.hostname

    if (!browserHostname || isLocalHostname(browserHostname) || !isLocalHostname(url.hostname)) {
      return normalized
    }

    url.hostname = browserHostname
    if (!url.port) {
      url.port = DEFAULT_BACKEND_PORT
    }
    return url.toString().replace(/\/+$/, "")
  } catch {
    return normalized
  }
}

export const API_BASE_URL = resolveBaseUrl(process.env.NEXT_PUBLIC_API_URL);

// --- Feature Gates ---
export const ENABLE_DIGEST = process.env.NEXT_PUBLIC_ENABLE_DIGEST === "true";
export const ENABLE_HIGHLIGHTS = true;

const OG_IMAGE_SUCCESS_TTL_MS = 10 * 60 * 1000;
const OG_IMAGE_MISS_TTL_MS = 2 * 60 * 1000;
const OG_IMAGE_ERROR_TTL_MS = 30 * 1000;
const OG_IMAGE_MAX_CACHE_ENTRIES = 2000;

const ogImageCache = new Map<
  string,
  { imageUrl: string | null; expiresAt: number }
>();
const ogImageInFlight = new Map<string, Promise<string | null>>();
const ogImageMetrics = {
  total: 0,
  cacheHit: 0,
  inFlightHit: 0,
  network: 0,
};

function isLikelyNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return (
    error.name === "TypeError" ||
    error.name === "NetworkError" ||
    message.includes("networkerror") ||
    message.includes("failed to fetch") ||
    message.includes("input stream") ||
    message.includes("load failed")
  )
}

const pruneOgImageCache = () => {
  const now = Date.now();
  for (const [key, entry] of ogImageCache.entries()) {
    if (entry.expiresAt <= now) {
      ogImageCache.delete(key);
    }
  }

  if (ogImageCache.size <= OG_IMAGE_MAX_CACHE_ENTRIES) {
    return;
  }

  const keys = Array.from(ogImageCache.keys());
  const overflow = ogImageCache.size - OG_IMAGE_MAX_CACHE_ENTRIES;
  for (let i = 0; i < overflow; i += 1) {
    ogImageCache.delete(keys[i]);
  }
};

// --- Data Types ---

// Data types

export interface NewsSource {
  id: string;
  slug: string;
  name: string;
  country: string;
  url: string;
  rssUrl: string;
  credibility: "high" | "medium" | "low";
  bias: "left" | "center" | "right";
  category: string[];
  language: string;
  funding: string[];
  credibilityScore?: number;
  factualRating?: string;
}

export interface NewsArticle {
  id: number;
  title: string;
  source: string;
  sourceId: string;
  country: string;
  credibility: "high" | "medium" | "low";
  bias: "left" | "center" | "right";
  summary: string;
  content?: string;
  image: string;
  publishedAt: string;
  _parsedTimestamp?: number;
  category: string;
  url: string;
  tags: string[];
  originalLanguage: string;
  translated: boolean;
  // Phase 5 Fields
  source_country?: string;
  mentioned_countries?: string[];
  geo_signal?: {
    id: string;
    label: string;
  };
  author?: string;
  authors?: string[];
  // Preloaded queue data
  _queueData?: {
    fullText?: string;
    readingTimeMinutes?: number;
    aiAnalysis?: ArticleAnalysis;
    preloadedAt?: number;
  };
  hasFullContent?: boolean;
  isPersisted?: boolean;
}

export interface BrowseIndexResponse {
  articles: NewsArticle[];
  total: number;
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "united states": "US",
  usa: "US",
  america: "US",
  "united kingdom": "GB",
  britain: "GB",
  england: "GB",
  china: "CN",
  germany: "DE",
  france: "FR",
  india: "IN",
  japan: "JP",
  canada: "CA",
  australia: "AU",
  russia: "RU",
  ukraine: "UA",
  taiwan: "TW",
  "south korea": "KR",
  "north korea": "KP",
  "hong kong": "HK",
  hongkong: "HK",
  israel: "IL",
  palestine: "PS",
  qatar: "QA",
  turkey: "TR",
  nigeria: "NG",
  singapore: "SG",
  pakistan: "PK",
  indonesia: "ID",
  vietnam: "VN",
  thailand: "TH",
  philippines: "PH",
  mexico: "MX",
  "new zealand": "NZ",
  newzealand: "NZ",
  greece: "GR",
  "south africa": "ZA",
  egypt: "EG",
  argentina: "AR",
  bangladesh: "BD",
  kenya: "KE",
  myanmar: "MM",
  venezuela: "VE",
  colombia: "CO",
  kazakhstan: "KZ",
  international: "International",
};

function normalizeCountryCode(value?: string | null): string {
  if (typeof value !== "string") return "International";
  const trimmed = value.trim();
  if (!trimmed) return "International";
  if (trimmed === "International") return trimmed;

  const compactUpper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(compactUpper)) {
    return compactUpper;
  }

  const normalizedName = trimmed
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const noSpace = normalizedName.replace(/\s+/g, "");
  return COUNTRY_NAME_TO_CODE[normalizedName] || COUNTRY_NAME_TO_CODE[noSpace] || compactUpper;
}

const BackendArticleSchema = z
  .object({
    id: z.number().optional(),
    article_id: z.number().optional(),
    title: z.string().optional(),
    source: z.string().optional(),
    source_name: z.string().optional(),
    source_id: z.string().optional(),
    description: z.string().optional(),
    summary: z.string().optional(),
    content: z.string().optional(),
    image: z.string().optional(),
    image_url: z.string().optional(),
    published_at: z.string().optional(),
    publishedAt: z.string().optional(),
    published: z.string().optional(),
    category: z.string().optional(),
    country: z.string().optional(),
    credibility: z.string().optional(),
    bias: z.string().optional(),
    url: z.string().optional(),
    link: z.string().optional(),
    article_url: z.string().optional(),
    original_url: z.string().optional(),
    author: z.string().optional(),
    authors: z.array(z.string()).optional(),
    original_language: z.string().optional(),
    translated: z.boolean().optional(),
  })
  .passthrough();

const BackendSourceSchema = z
  .object({
    id: z.string().optional(),
    slug: z.string().optional(),
    name: z.string(),
    country: z.string().default("US"),
    url: z.string(),
    rssUrl: z.string().optional(),
    bias_rating: z.string().optional(),
    category: z.string().optional(),
    funding_type: z.string().optional(),
    ownership_label: z.string().optional(),
    factual_rating: z.string().optional(),
    credibility_score: z.number().optional(),
  })
  .passthrough();

export type BackendArticle = z.infer<typeof BackendArticleSchema>;

export interface BookmarkEntry {
  bookmarkId: number;
  articleId: number;
  article: NewsArticle;
  createdAt?: string;
}

export interface SemanticSearchResult {
  article: NewsArticle;
  similarityScore?: number | null;
  distance?: number | null;
}

export interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResult[];
  total: number;
}

// Add streaming interfaces
export interface StreamOptions {
  useCache?: boolean;
  category?: string;
  onProgress?: (progress: StreamProgress) => void;
  onSourceComplete?: (source: string, articles: NewsArticle[]) => void;
  onError?: (error: string) => void;
  signal?: AbortSignal;
}

export interface StreamProgress {
  completed: number;
  total: number;
  percentage: number;
  currentSource?: string;
  message?: string;
}

export interface StreamEvent {
  status:
    | "starting"
    | "initial"
    | "cache_data"
    | "source_complete"
    | "source_error"
    | "complete"
    | "error";
  stream_id?: string;
  message?: string;
  source?: string;
  articles?: BackendArticle[];
  source_stat?: Record<string, unknown>;
  error?: string;
  progress?: StreamProgress;
  cache_age_seconds?: number;
  total_articles?: number;
  successful_sources?: number;
  failed_sources?: number;
  timestamp?: string;
}

// API functions
export async function fetchNews(params?: {
  limit?: number;
  category?: string;
  search?: string;
}): Promise<NewsArticle[]> {
  try {
    const searchParams = new URLSearchParams();
    searchParams.append("use_cache", "true"); // Use cache by default

    if (params?.limit) searchParams.append("limit", params.limit.toString());
    if (params?.category) searchParams.append("category", params.category);

    const url = `${API_BASE_URL}/news/stream${searchParams.toString() ? "?" + searchParams.toString() : ""}`;
    logger.debug(`Fetching news from unified endpoint: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = (await response.json()) as { articles?: unknown[] };
    logger.debug(`Backend response:`, data);

    // Backend returns { articles: [...], total: number, sources: [...], stream_id: string }
    const parsedArticles = BackendArticleSchema.array().safeParse(
      data.articles ?? [],
    );
    const backendArticles: BackendArticle[] = parsedArticles.success
      ? parsedArticles.data
      : [];
    if (!parsedArticles.success) {
      logger.warn(
        "fetchNews received malformed article payload, dropping invalid entries",
      );
    }

    if (backendArticles.length === 0) {
      logger.debug(
        `No articles received from backend. Full response:`,
        JSON.stringify(data, null, 2),
      );
    } else {
      logger.debug(
        `Received ${backendArticles.length} articles from unified backend endpoint`,
      );
    }

    // Convert backend format to frontend format
    let articles = mapBackendArticles(backendArticles);

    // Client-side search filtering if needed
    if (params?.search) {
      const searchTerm = params.search.toLowerCase();
      const beforeFilterCount = articles.length;
      articles = articles.filter(
        (article: NewsArticle) =>
          article.title.toLowerCase().includes(searchTerm) ||
          article.summary.toLowerCase().includes(searchTerm),
      );
      logger.debug(
        `Search filter applied: ${beforeFilterCount} -> ${articles.length} articles (search: "${params.search}")`,
      );
    }

    // Client-side category filtering if needed
    if (params?.category) {
      const beforeFilterCount = articles.length;
      articles = articles.filter(
        (article: NewsArticle) =>
          article.category.toLowerCase() === params.category!.toLowerCase(),
      );
      logger.debug(
        `Category filter applied: ${beforeFilterCount} -> ${articles.length} articles (category: "${params.category}")`,
      );
    }

    if (articles.length === 0) {
      logger.debug(`No articles to return after processing. Params:`, params);
    }

    return articles;
  } catch (error) {
    console.error("Failed to fetch news from unified endpoint:", error);
    throw error;
  }
}

// Helper functions to map source to metadata
function getCountryFromSource(source: string): string {
  const countryMap: { [key: string]: string } = {
    BBC: "GB",
    CNN: "US",
    Reuters: "GB",
    NPR: "US",
    "Fox News": "US",
    "Associated Press": "US",
  };
  return countryMap[source] || "US";
}

function getCredibilityFromSource(source: string): "high" | "medium" | "low" {
  const credibilityMap: { [key: string]: "high" | "medium" | "low" } = {
    BBC: "high",
    CNN: "medium",
    Reuters: "high",
    NPR: "high",
    "Fox News": "medium",
    "Associated Press": "high",
  };
  return credibilityMap[source] || "medium";
}

function getBiasFromSource(source: string): "left" | "center" | "right" {
  const biasMap: { [key: string]: "left" | "center" | "right" } = {
    BBC: "center",
    CNN: "left",
    Reuters: "center",
    NPR: "left",
    "Fox News": "right",
    "Associated Press": "center",
  };
  return biasMap[source] || "center";
}

export async function fetchNewsFromSource(
  sourceId: string,
): Promise<NewsArticle[]> {
  // Refactored to use the main fetchNews function for consistency
  const allArticles = await fetchNews();
  return allArticles.filter((article) => article.sourceId === sourceId);
}

export async function fetchNewsByCategory(
  category: string,
): Promise<NewsArticle[]> {
  return fetchNews({ category });
}

export async function fetchSources(): Promise<NewsSource[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/news/sources`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const payload = await response.json();
    const parsedSources = z.array(BackendSourceSchema).safeParse(payload);
    if (!parsedSources.success) {
      logger.warn("fetchSources received malformed payload");
      return [];
    }
    const sources = parsedSources.data;

    // Convert backend source format to frontend format
    return sources.map((source) => ({
      id:
        source.id || source.slug || source.name.toLowerCase().replace(/\s+/g, "-"),
      slug:
        source.slug ||
        source.id ||
        source.name.toLowerCase().replace(/\s+/g, "-"),
      name: source.name,
      country: source.country,
      url: source.url,
      rssUrl: source.rssUrl || source.url,
      credibility: mapCredibilityScoreToLevel(
        source.credibility_score,
        source.factual_rating,
        source.bias_rating,
      ),
      bias: mapBias(source.bias_rating),
      category: source.category ? [source.category] : ["general"],
      language: "en",
      funding: [source.funding_type || source.ownership_label || "Unknown"],
      credibilityScore: source.credibility_score,
      factualRating: source.factual_rating,
    }));
  } catch (error) {
    console.error("Failed to fetch sources:", error);
    return [];
  }
}

function mapCredibility(biasRating?: string): "high" | "medium" | "low" {
  // Map bias ratings to credibility (this is a simplification)
  if (!biasRating) return "medium";
  if (biasRating.toLowerCase().includes("high")) return "high";
  if (biasRating.toLowerCase().includes("low")) return "low";
  return "medium";
}

function mapCredibilityScoreToLevel(
  score?: number,
  factualRating?: string,
  biasRating?: string,
): "high" | "medium" | "low" {
  if (typeof score === "number") {
    if (score >= 0.75) return "high"
    if (score <= 0.4) return "low"
    return "medium"
  }

  const normalizedFactual = factualRating?.toLowerCase()
  if (normalizedFactual?.includes("high")) return "high"
  if (normalizedFactual?.includes("low") || normalizedFactual?.includes("mixed")) {
    return "low"
  }

  return mapCredibility(biasRating)
}

function mapBias(biasRating?: string): "left" | "center" | "right" {
  if (!biasRating) return "center";
  const rating = biasRating.toLowerCase();
  if (rating.includes("left")) return "left";
  if (rating.includes("right")) return "right";
  return "center";
}

export async function fetchCategories(): Promise<string[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/categories`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    // Backend returns { categories: [...] }
    return Array.isArray(data) ? data : data?.categories || [];
  } catch (error) {
    console.error("Failed to fetch categories:", error);
    return [];
  }
}

// Inline definition API: request a short, one-paragraph definition for a highlighted term
/**
 * Requests a short, one-paragraph AI-generated definition for a highlighted term using the /api/inline/define endpoint.
 * Returns a success flag, the term, and the definition or error.
 */
export async function requestInlineDefinition(
  term: string,
  context?: string,
): Promise<{
  success: boolean;
  term: string;
  definition?: string | null;
  error?: string | null;
}> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/inline/define`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term, context: context ?? "" }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      success: true,
      term,
      definition: data.definition ?? null,
      error: data.error ?? null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("requestInlineDefinition failed", err);
    return {
      success: false,
      term,
      definition: null,
      error: message,
    };
  }
}

export interface SourceStats {
  name: string;
  url: string;
  category: string;
  country: string;
  funding_type?: string;
  bias_rating?: string;
  article_count: number;
  status: "success" | "warning" | "error";
  error_message?: string;
  last_checked: string;
}

export async function fetchSourceStats(): Promise<SourceStats[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/news/sources/stats`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.sources || [];
  } catch (error) {
    console.error("Failed to fetch source stats:", error);
    return [];
  }
}

export interface CacheStatus {
  last_updated: string;
  update_in_progress: boolean;
  total_articles: number;
  total_sources: number;
  sources_working: number;
  sources_with_errors: number;
  sources_with_warnings: number;
  category_breakdown: Record<string, number>;
  cache_age_seconds: number;
}

export interface LlmLogEntry {
  timestamp?: string;
  request_id?: string;
  service?: string;
  model?: string;
  messages?: Array<Record<string, unknown>>;
  duration_ms?: number;
  success?: boolean;
  finish_reason?: string;
  error_type?: string;
  error_message?: string;
}

export interface LlmLogResponse {
  available: boolean;
  path: string;
  returned: number;
  total: number;
  entries: LlmLogEntry[];
  service?: string | null;
  success_filter?: boolean | null;
}

export interface DebugErrorEntry {
  timestamp?: string;
  request_id?: string;
  service?: string;
  model?: string;
  error_type?: string;
  error_message?: string;
  event_type?: string;
  message?: string;
  component?: string;
  operation?: string;
}

export interface DebugErrorsResponse {
  log_file: LlmLogResponse;
  recent_request_stream_errors: DebugErrorEntry[];
  returned_recent_errors: number;
  include_request_stream_events: boolean;
}

export async function fetchCacheStatus(): Promise<CacheStatus | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/cache/status`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to fetch cache status:", error);
    return null;
  }
}

export async function fetchLlmLogs(
  options: {
    limit?: number;
    offset?: number;
    service?: string;
    success?: boolean;
  } = {},
): Promise<LlmLogResponse> {
  const params = new URLSearchParams();
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  if (typeof options.offset === "number") params.set("offset", String(options.offset));
  if (options.service) params.set("service", options.service);
  if (typeof options.success === "boolean") params.set("success", String(options.success));

  const response = await fetch(
    `${API_BASE_URL}/debug/logs/llm${params.toString() ? `?${params.toString()}` : ""}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function fetchDebugErrors(
  options: {
    limit?: number;
    offset?: number;
    includeRequestStreamEvents?: boolean;
  } = {},
): Promise<DebugErrorsResponse> {
  const params = new URLSearchParams();
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  if (typeof options.offset === "number") params.set("offset", String(options.offset));
  if (typeof options.includeRequestStreamEvents === "boolean") {
    params.set("include_request_stream_events", String(options.includeRequestStreamEvents));
  }

  const response = await fetch(
    `${API_BASE_URL}/debug/logs/errors${params.toString() ? `?${params.toString()}` : ""}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function refreshCache(
  onProgress?: (event: {
    source?: string;
    articlesFromSource?: number;
    totalSourcesProcessed?: number;
    failedSources?: number;
    totalArticles?: number;
    successfulSources?: number;
    message?: string;
  }) => void,
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/cache/refresh/stream`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          if (jsonStr.trim()) {
            try {
              const event = JSON.parse(jsonStr);

              if (event.status === "complete") {
                if (onProgress) {
                  onProgress({
                    message: event.message,
                    totalArticles: event.total_articles,
                    successfulSources: event.successful_sources,
                    failedSources: event.failed_sources,
                  });
                }
                return true;
              } else if (event.status === "source_complete") {
                if (onProgress) {
                  onProgress({
                    source: event.source,
                    articlesFromSource: event.articles_from_source,
                    totalSourcesProcessed: event.total_sources_processed,
                    failedSources: event.failed_sources,
                  });
                }
              } else if (event.status === "error") {
                console.error("Refresh error:", event.message);
                return false;
              }
            } catch (parseError) {
              console.error("Failed to parse SSE event:", jsonStr, parseError);
            }
          }
        }
      }
    }

    return true;
  } catch (error) {
    console.error("Failed to refresh cache:", error);
    return false;
  }
}

export async function semanticSearch(
  query: string,
  options?: { limit?: number; category?: string },
): Promise<SemanticSearchResponse> {
  const params = new URLSearchParams({ query });
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.category) params.append("category", options.category);

  const url = `${API_BASE_URL}/api/search/semantic?${params.toString()}`;

  const response = await fetch(url);
  if (response.status === 503) {
    throw new Error("Semantic search is currently unavailable.");
  }
  if (!response.ok) {
    throw new Error(`Semantic search failed with status ${response.status}`);
  }

  const data = await response.json();
  const rawResults = Array.isArray(data?.results) ? data.results : [];
  const mappedArticles = mapBackendArticles(rawResults);

  const results: SemanticSearchResult[] = mappedArticles.map(
    (article, index) => ({
      article,
      similarityScore: rawResults[index]?.similarity_score ?? null,
      distance: rawResults[index]?.distance ?? null,
    }),
  );

  return {
    query: data?.query || query,
    results,
    total: typeof data?.total === "number" ? data.total : results.length,
  };
}

export async function fetchBookmarks(): Promise<BookmarkEntry[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const bookmarks = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
    const mappedArticles = mapBackendArticles(bookmarks);

    return mappedArticles.map((article, index) => ({
      bookmarkId: bookmarks[index].bookmark_id,
      articleId: bookmarks[index].article_id,
      createdAt: bookmarks[index].created_at,
      article,
    }));
  } catch (error) {
    if (isLikelyNetworkError(error)) {
      logger.warn("Bookmarks are unavailable because the backend is unreachable.")
    } else {
      console.error("Failed to fetch bookmarks:", error);
    }
    return [];
  }
}

export async function fetchBookmark(
  articleId: number,
): Promise<BookmarkEntry | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks/${articleId}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const [article] = mapBackendArticles([data]);
    return {
      bookmarkId: data.bookmark_id,
      articleId: data.article_id,
      createdAt: data.created_at,
      article,
    };
  } catch (error) {
    console.error("Failed to fetch bookmark:", error);
    return null;
  }
}

export async function createBookmark(
  articleId: number,
): Promise<BookmarkEntry | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ article_id: articleId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create bookmark. Status: ${response.status}`);
    }

    // Fetch the complete bookmark details (article metadata + bookmark info)
    return await fetchBookmark(articleId);
  } catch (error) {
    console.error("Failed to create bookmark:", error);
    throw error;
  }
}

export async function updateBookmark(
  articleId: number,
): Promise<BookmarkEntry | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks/${articleId}`, {
      method: "PUT",
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to update bookmark. Status: ${response.status}`);
    }

    return await fetchBookmark(articleId);
  } catch (error) {
    console.error("Failed to update bookmark:", error);
    return null;
  }
}

export async function deleteBookmark(articleId: number): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks/${articleId}`, {
      method: "DELETE",
    });

    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`Failed to delete bookmark. Status: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error("Failed to delete bookmark:", error);
    throw error;
  }
}

export interface LikedEntry {
  likedId: number;
  articleId: number;
  article: NewsArticle;
  createdAt?: string;
}

export async function fetchLikedArticles(): Promise<LikedEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/liked`);
  if (!response.ok) {
    throw new Error(`Failed to load liked articles (${response.status})`);
  }

  const data = await response.json();
  const liked = Array.isArray(data?.liked) ? data.liked : [];
  const mappedArticles = mapBackendArticles(liked);

  return mappedArticles.map((article, index) => ({
    likedId: liked[index].liked_id,
    articleId: liked[index].article_id,
    createdAt: liked[index].created_at,
    article,
  }));
}

export async function createLikedArticle(
  articleId: number,
): Promise<LikedEntry | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/liked`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ article_id: articleId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to like article. Status: ${response.status}`);
    }

    return await fetchLikedArticles().then(
      (liked) => liked.find((entry) => entry.articleId === articleId) || null,
    );
  } catch (error) {
    console.error("Failed to like article:", error);
    throw error;
  }
}

export async function deleteLikedArticle(articleId: number): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/liked/${articleId}`, {
      method: "DELETE",
    });

    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`Failed to unlike article. Status: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error("Failed to unlike article:", error);
    throw error;
  }
}

// Helper functions for compatibility with existing components
let cachedSources: NewsSource[] = [];
let cachedArticles: NewsArticle[] = [];

export async function getSourceById(
  id: string,
): Promise<NewsSource | undefined> {
  if (cachedSources.length === 0) {
    cachedSources = await fetchSources();
  }
  const normalizedId = id.trim().toLowerCase();
  return cachedSources.find(
    (source) =>
      source.id === id ||
      source.slug === id ||
      source.id.toLowerCase() === normalizedId ||
      source.slug.toLowerCase() === normalizedId ||
      source.name.toLowerCase() === normalizedId,
  );
}

export async function getArticlesByCountry(
  country: string,
): Promise<NewsArticle[]> {
  if (cachedArticles.length === 0) {
    cachedArticles = await fetchNews({ limit: 3000 }); // Get more articles for filtering
  }
  const normalized = normalizeCountryCode(country);
  return cachedArticles.filter(
    (article) => normalizeCountryCode(article.country) === normalized,
  );
}

export async function fetchArticlesBySource(
  sourceId: string,
): Promise<NewsArticle[]> {
  if (cachedArticles.length === 0) {
    cachedArticles = await fetchNews({ limit: 3000 });
  }
  return cachedArticles.filter((article) => article.sourceId === sourceId);
}

// Initialize data on module load
export async function initializeData() {
  try {
    cachedSources = await fetchSources();
    cachedArticles = await fetchNews({ limit: 1000 });
  } catch (error) {
    console.error("Failed to initialize data:", error);
  }
}

/**
 * Requests a definition for a term using the /api/inline/definition endpoint.
 * Returns the definition and any error encountered.
 */
export async function fetchInlineDefinition(
  term: string,
  context?: string,
): Promise<{ definition?: string | null; error?: string | null }> {
  // Backwards-compatible wrapper around requestInlineDefinition
  const res = await requestInlineDefinition(term, context);
  return { definition: res.definition ?? null, error: res.error ?? null };
}

export interface SourceDebugData {
  source_name: string;
  source_config: Record<string, unknown> | null;
  rss_url: string;
  all_urls?: string[];
  feed_metadata: {
    title: string;
    description: string;
    link: string;
    language: string;
    updated: string;
    generator: string;
  };
  feed_status: {
    http_status: number | string;
    bozo: boolean;
    bozo_exception: string;
    entries_count: number;
  };
  parsed_entries: Array<{
    index: number;
    title: string;
    link: string;
    description: string;
    published: string;
    author: string;
    tags: unknown[];
    has_images: boolean;
    image_sources: unknown[];
    content_images: string[];
    description_images: string[];
    raw_entry_keys: string[];
  }>;
  cached_articles: Array<Record<string, unknown>>;
  source_statistics?: {
    name: string;
    url: string | string[];
    category: string;
    country: string;
    funding_type: string;
    bias_rating: string;
    article_count: number;
    status: string;
    error_message: string | null;
    last_checked: string;
    is_consolidated?: boolean;
    sub_feeds?: Array<{
      url: string;
      status: "success" | "warning" | "error";
      article_count: number;
      error?: string;
    }>;
  } | null;
  debug_timestamp: string;
  image_analysis: {
    total_entries: number;
    entries_with_images: number;
    image_sources: unknown[];
  };
  error?: string;
}

export async function fetchSourceDebugData(
  sourceName: string,
): Promise<SourceDebugData> {
  // Safely decode the source name in case it's already URL encoded, then encode it properly
  let decodedSourceName: string;
  try {
    decodedSourceName = decodeURIComponent(sourceName);
  } catch {
    // If decoding fails, assume it's not encoded
    decodedSourceName = sourceName;
  }
  const encodedSourceName = encodeURIComponent(decodedSourceName);

  // FIXED: Use correct endpoint path
  const url = `${API_BASE_URL}/debug/sources/${encodedSourceName}`;
  logger.debug(`Fetching debug data for source: ${url}`);
  try {
    const response = await fetch(url);
    logger.debug(
      `Debug response status for source ${sourceName}:`,
      response.status,
    );
    if (!response.ok) {
      return {
        source_name: sourceName,
        source_config: null,
        rss_url: "",
        feed_metadata: {
          title: "",
          description: "",
          link: "",
          language: "",
          updated: "",
          generator: "",
        },
        feed_status: {
          http_status: response.status,
          bozo: false,
          bozo_exception: "",
          entries_count: 0,
        },
        parsed_entries: [],
        cached_articles: [],
        source_statistics: null,
        debug_timestamp: new Date().toISOString(),
        image_analysis: {
          total_entries: 0,
          entries_with_images: 0,
          image_sources: [],
        },
        error: `HTTP error! status: ${response.status}`,
      };
    }

    const debugData = await response.json();
    logger.debug(`Debug data received for ${sourceName}:`, {
      entriesCount: debugData.feed_status?.entries_count,
      cachedArticles: debugData.cached_articles?.length,
      hasError: !!debugData.error,
    });

    return debugData;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    console.error("Error fetching source debug data:", error);
    return {
      source_name: sourceName,
      source_config: null,
      rss_url: "",
      feed_metadata: {
        title: "",
        description: "",
        link: "",
        language: "",
        updated: "",
        generator: "",
      },
      feed_status: {
        http_status: "fetch_failed",
        bozo: false,
        bozo_exception: message,
        entries_count: 0,
      },
      parsed_entries: [],
      cached_articles: [],
      source_statistics: null,
      debug_timestamp: new Date().toISOString(),
      image_analysis: {
        total_entries: 0,
        entries_with_images: 0,
        image_sources: [],
      },
      error: message,
    };
  }
}

export interface ChromaDebugArticle {
  id: string;
  metadata: Record<string, unknown>;
  preview: string;
}

export interface ChromaDebugResponse {
  limit: number;
  offset: number;
  returned: number;
  total?: number;
  articles: ChromaDebugArticle[];
}

const ChromaDebugArticleSchema = z.object({
  id: z.string(),
  metadata: z.record(z.unknown()),
  preview: z.string(),
});

const ChromaDebugResponseSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  returned: z.number(),
  total: z.number().optional(),
  articles: z.array(ChromaDebugArticleSchema),
});

export interface DatabaseDebugResponse {
  limit: number;
  offset: number;
  source?: string | null;
  missing_embeddings_only: boolean;
  sort_direction: "asc" | "desc";
  published_before?: string | null;
  published_after?: string | null;
  total: number;
  returned: number;
  oldest_published?: string | null;
  newest_published?: string | null;
  articles: Array<{
    id: number;
    source: string;
    title: string;
    published_at?: string;
    chroma_id?: string | null;
    embedding_generated?: boolean | null;
    url: string;
    summary?: string | null;
    content?: string | null;
    image_url?: string | null;
    [key: string]: unknown;
  }>;
}

const DatabaseDebugArticleSchema = z
  .object({
    id: z.number(),
    source: z.string(),
    title: z.string(),
    published_at: z.string().optional(),
    chroma_id: z.string().nullable().optional(),
    embedding_generated: z.boolean().nullable().optional(),
    url: z.string(),
    summary: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    image_url: z.string().nullable().optional(),
  })
  .catchall(z.unknown());

const DatabaseDebugResponseSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  source: z.string().nullable().optional(),
  missing_embeddings_only: z.boolean(),
  sort_direction: z.enum(["asc", "desc"]),
  published_before: z.string().nullable().optional(),
  published_after: z.string().nullable().optional(),
  total: z.number(),
  returned: z.number(),
  oldest_published: z.string().nullable().optional(),
  newest_published: z.string().nullable().optional(),
  articles: z.array(DatabaseDebugArticleSchema),
});

export interface StorageDriftReport {
  database_total_articles: number;
  database_with_embeddings: number;
  database_missing_embeddings: number;
  vector_total_documents: number;
  missing_in_chroma_count: number;
  dangling_in_chroma_count: number;
  missing_in_chroma: Array<{
    id: number;
    chroma_id?: string | null;
    embedding_generated?: boolean | null;
  }>;
  dangling_in_chroma: string[];
}

const MissingInChromaItemSchema = z.object({
  id: z.number(),
  chroma_id: z.string().nullable().optional(),
  embedding_generated: z.boolean().nullable().optional(),
});

const StorageDriftReportSchema = z.object({
  database_total_articles: z.number(),
  database_with_embeddings: z.number(),
  database_missing_embeddings: z.number(),
  vector_total_documents: z.number(),
  missing_in_chroma_count: z.number(),
  dangling_in_chroma_count: z.number(),
  missing_in_chroma: z.array(MissingInChromaItemSchema),
  dangling_in_chroma: z.array(z.string()),
});

export interface CacheDebugArticle {
  id?: number | null;
  title: string;
  link: string;
  description: string;
  published: string;
  source: string;
  category: string;
  country?: string | null;
  image?: string | null;
}

export interface CacheDebugResponse {
  limit: number;
  offset: number;
  source?: string | null;
  total: number;
  returned: number;
  articles: CacheDebugArticle[];
}

const CacheDebugArticleSchema = z.object({
  id: z.number().nullable().optional(),
  title: z.string(),
  link: z.string(),
  description: z.string(),
  published: z.string(),
  source: z.string(),
  category: z.string(),
  country: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
});

const CacheDebugResponseSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  source: z.string().nullable().optional(),
  total: z.number(),
  returned: z.number(),
  articles: z.array(CacheDebugArticleSchema),
});

export interface CacheDeltaResponse {
  cache_total: number;
  cache_sampled: number;
  db_total: number;
  missing_in_db_count: number;
  missing_in_db_sample: string[];
  source?: string | null;
  sample_offset: number;
  sample_limit: number;
}

const CacheDeltaResponseSchema = z.object({
  cache_total: z.number(),
  cache_sampled: z.number(),
  db_total: z.number(),
  missing_in_db_count: z.number(),
  missing_in_db_sample: z.array(z.string()),
  source: z.string().nullable().optional(),
  sample_offset: z.number(),
  sample_limit: z.number(),
});

export interface StartupEventMetric {
  name: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StartupMetricsResponse {
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  events: StartupEventMetric[];
  notes: Record<string, unknown>;
}

export async function fetchChromaDebugArticles(params?: {
  limit?: number;
  offset?: number;
}): Promise<ChromaDebugResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.append("limit", String(params.limit));
  if (params?.offset) searchParams.append("offset", String(params.offset));

  const query = searchParams.toString();
  const response = await fetch(
    `${API_BASE_URL}/debug/chromadb/articles${query ? `?${query}` : ""}`,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch Chroma debug data (${response.status})`);
  }

  const payload: unknown = await response.json();
  return ChromaDebugResponseSchema.parse(payload);
}

export async function fetchDatabaseDebugArticles(params?: {
  limit?: number;
  offset?: number;
  source?: string;
  missing_embeddings_only?: boolean;
  sort_direction?: "asc" | "desc";
  published_before?: string;
  published_after?: string;
}): Promise<DatabaseDebugResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.append("limit", String(params.limit));
  if (params?.offset) searchParams.append("offset", String(params.offset));
  if (params?.source) searchParams.append("source", params.source);
  if (params?.missing_embeddings_only) {
    searchParams.append("missing_embeddings_only", "true");
  }
  if (params?.sort_direction) {
    searchParams.append("sort_direction", params.sort_direction);
  }
  if (params?.published_before) {
    searchParams.append("published_before", params.published_before);
  }
  if (params?.published_after) {
    searchParams.append("published_after", params.published_after);
  }

  const query = searchParams.toString();
  const response = await fetch(
    `${API_BASE_URL}/debug/database/articles${query ? `?${query}` : ""}`,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch database debug data (${response.status})`);
  }

  const payload: unknown = await response.json();
  return DatabaseDebugResponseSchema.parse(payload);
}

export async function fetchStorageDrift(
  sampleLimit: number = 50,
): Promise<StorageDriftReport> {
  const response = await fetch(
    `${API_BASE_URL}/debug/storage/drift?sample_limit=${sampleLimit}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch storage drift report (${response.status})`,
    );
  }

  const payload: unknown = await response.json();
  return StorageDriftReportSchema.parse(payload);
}

export async function fetchCacheDebugArticles(params?: {
  limit?: number;
  offset?: number;
  source?: string;
}): Promise<CacheDebugResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.append("limit", String(params.limit));
  if (params?.offset) searchParams.append("offset", String(params.offset));
  if (params?.source) searchParams.append("source", params.source);

  const query = searchParams.toString();
  const response = await fetch(
    `${API_BASE_URL}/debug/cache/articles${query ? `?${query}` : ""}`,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch cache debug data (${response.status})`);
  }

  const payload: unknown = await response.json();
  return CacheDebugResponseSchema.parse(payload);
}

export async function fetchCacheDelta(params?: {
  sample_limit?: number;
  sample_offset?: number;
  source?: string;
  sample_preview_limit?: number;
}): Promise<CacheDeltaResponse> {
  const searchParams = new URLSearchParams();
  if (params?.sample_limit) {
    searchParams.append("sample_limit", String(params.sample_limit));
  }
  if (params?.sample_offset) {
    searchParams.append("sample_offset", String(params.sample_offset));
  }
  if (params?.source) {
    searchParams.append("source", params.source);
  }
  if (params?.sample_preview_limit != null) {
    searchParams.append(
      "sample_preview_limit",
      String(params.sample_preview_limit),
    );
  }

  const query = searchParams.toString();
  const response = await fetch(
    `${API_BASE_URL}/debug/cache/delta${query ? `?${query}` : ""}`,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch cache delta (${response.status})`);
  }

  const payload: unknown = await response.json();
  return CacheDeltaResponseSchema.parse(payload);
}

export async function fetchStartupMetrics(): Promise<StartupMetricsResponse> {
  const response = await fetch(`${API_BASE_URL}/debug/startup`);
  if (!response.ok) {
    throw new Error(`Failed to fetch startup metrics (${response.status})`);
  }

  const data = await response.json();
  const events: StartupEventMetric[] = Array.isArray(data?.events)
    ? data.events.map((event: Record<string, unknown>) => ({
        name: typeof event?.name === "string" ? event.name : "event",
        startedAt:
          typeof event?.started_at === "string" ? event.started_at : null,
        completedAt:
          typeof event?.completed_at === "string" ? event.completed_at : null,
        durationSeconds:
          typeof event?.duration_seconds === "number"
            ? event.duration_seconds
            : null,
        detail: typeof event?.detail === "string" ? event.detail : null,
        metadata:
          typeof event?.metadata === "object" && event.metadata !== null
            ? (event.metadata as Record<string, unknown>)
            : {},
      }))
    : [];

  return {
    startedAt: data?.started_at ?? null,
    completedAt: data?.completed_at ?? null,
    durationSeconds: data?.duration_seconds ?? null,
    events,
    notes: data?.notes ?? {},
  };
}

// Enhanced news streaming function
export function streamNews(options: StreamOptions = {}): {
  promise: Promise<{
    articles: NewsArticle[];
    sources: string[];
    streamId?: string;
    errors: string[];
  }>;
  url: string;
} {
  const {
    useCache = true,
    category,
    onProgress,
    onSourceComplete,
    onError,
    signal,
  } = options;

  logger.debug(
    `Starting news stream with useCache=${useCache} and category=${category}`,
  );

  // Build SSE URL with parameters
  const baseUrl = (
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  ).replace(/\/+$/, "");
  const params = new URLSearchParams({
    use_cache: String(useCache),
  });
  if (category) {
    params.append("category", category);
  }
  const sseUrl = `${baseUrl}/news/stream?${params.toString()}`;

  const promise = new Promise<{
    articles: NewsArticle[];
    sources: string[];
    streamId?: string;
    errors: string[];
  }>(async (resolve, reject) => {
    const articles: NewsArticle[] = [];
    const sources = new Set<string>();
    const errors: string[] = [];
    let streamId: string | undefined;
    let hasReceivedData = false;
    let settled = false;
    let abortController: AbortController | null = null;

    logger.debug(`Connecting to unified stream endpoint: ${sseUrl}`);

    try {
      // Create abort controller for fetch
      abortController = new AbortController();

      // Handle external signal abort
      const handleAbort = () => {
        if (abortController && !abortController.signal.aborted) {
          console.warn("Streaming aborted by external signal");
          abortController.abort();
        }
      };

      if (signal) {
        if (signal.aborted) {
          handleAbort();
          if (!settled) {
            settled = true;
            resolve({
              articles: removeDuplicateArticles(articles),
              sources: Array.from(sources),
              streamId,
              errors: ["Aborted before connection"],
            });
          }
          return;
        }
        signal.addEventListener("abort", handleAbort, { once: true });
      }

      // Use fetch with manual SSE handling instead of EventSource
      // This gives us better control over connection lifecycle
      const response = await fetch(sseUrl, {
        method: "GET",
        signal: abortController.signal,
        headers: {
          Accept: "text/event-stream",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Stream request failed with status ${response.status}: ${response.statusText}`,
        );
      }

      if (!response.body) {
        throw new Error("No response body received from stream");
      }

      logger.debug("Stream connection opened, reading body...");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastMessageTime = Date.now();
      const messageTimeout = 120000; // 2 minutes
      const cacheLoadTimeout = 15000; // 15 seconds - if cache loads but no complete event, auto-resolve

      // Start timeout monitor
      const timeoutInterval = setInterval(() => {
        const timeSinceLastMessage = Date.now() - lastMessageTime;
        if (timeSinceLastMessage > messageTimeout) {
          console.error("Stream timeout - no data received in 2 minutes");
          if (abortController) {
            abortController.abort();
          }
        }
      }, 5000);

      // Stall detector - if we've received cache but nothing for 10s, auto-complete
      const stallInterval = setInterval(() => {
        if (
          hasReceivedData &&
          !settled &&
          Date.now() - lastMessageTime > cacheLoadTimeout
        ) {
          console.warn(
            `Stream ${streamId} stalled after cache load - auto-completing`,
          );
          clearInterval(timeoutInterval);
          clearInterval(stallInterval);
          if (!settled) {
            settled = true;
            resolve({
              articles: removeDuplicateArticles(articles),
              sources: Array.from(sources),
              streamId,
              errors: [
                ...errors,
                "Stream auto-completed due to inactivity after cache load",
              ],
            });
          }
        }
      }, 3000);

      while (true) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            logger.debug("Stream reader completed");
            clearInterval(timeoutInterval);
            clearInterval(stallInterval);
            if (!settled) {
              settled = true;
              if (!hasReceivedData) {
                reject(new Error("Stream ended without receiving data"));
              } else {
                resolve({
                  articles: removeDuplicateArticles(articles),
                  sources: Array.from(sources),
                  streamId,
                  errors,
                });
              }
            }
            break;
          }

          // Decode chunk and add to buffer
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          lastMessageTime = Date.now(); // Reset timeout on receiving data

          // Process complete SSE messages from buffer
          const lines = buffer.split("\n");
          buffer = lines[lines.length - 1]; // Keep incomplete line in buffer

          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i];

            // Skip empty lines and comments
            if (!line || line.startsWith(":")) {
              continue;
            }

            // Process SSE data line
            if (line.startsWith("data: ")) {
              const eventData = line.substring(6);

              try {
                let data: StreamEvent;
                try {
                  data = JSON.parse(eventData);
                } catch {
                  console.warn(
                    "[streamNews] First JSON.parse failed, attempting to re-parse",
                  );
                  data = JSON.parse(JSON.parse(`"${eventData}"`));
                }

                logger.debug(`Stream event [${data.status}]:`, {
                  streamId: data.stream_id,
                  source: data.source,
                  articlesCount: data.articles?.length,
                  progress: data.progress,
                  message: data.message,
                });

                // Update stream ID
                if (data.stream_id && !streamId) {
                  streamId = data.stream_id;
                }

                switch (data.status) {
                  case "initial":
                    // INSTANT response with cached data
                    hasReceivedData = true;
                    if (data.articles && Array.isArray(data.articles)) {
                      const mappedArticles = mapBackendArticles(data.articles);
                      const BATCH_SIZE = 500;
                      const cacheAge = data.cache_age_seconds || 999;

                      logger.debug(
                        `Stream ${streamId} INITIAL data: ${mappedArticles.length} articles (cache age: ${cacheAge}s)`,
                      );

                      // Process articles in batches to avoid UI freeze
                      (async () => {
                        for (
                          let i = 0;
                          i < mappedArticles.length;
                          i += BATCH_SIZE
                        ) {
                          const batch = mappedArticles.slice(i, i + BATCH_SIZE);
                          articles.push(...batch);
                          batch.forEach((article) =>
                            sources.add(article.source),
                          );

                          // Notify about this batch immediately
                          if (onSourceComplete) {
                            onSourceComplete(
                              `initial-batch-${Math.floor(i / BATCH_SIZE)}`,
                              batch,
                            );
                          }

                          // Yield to the event loop to prevent blocking
                          if (i + BATCH_SIZE < mappedArticles.length) {
                            await new Promise((resolve) =>
                              setTimeout(resolve, 0),
                            );
                          }
                        }

                        // Final progress update after all batches loaded
                        onProgress?.({
                          completed: 0,
                          total: 0,
                          percentage: 0,
                          message: `Instantly loaded ${mappedArticles.length} articles from cache`,
                        });
                      })();
                    } else {
                      console.warn(
                        "[streamNews] 'initial' event received but 'articles' is not an array or is missing.",
                        data,
                      );
                    }
                    break;

                  case "starting":
                    logger.debug(
                      `Stream ${streamId} starting: ${data.message}`,
                    );
                    onProgress?.({
                      completed: 0,
                      total: 0,
                      percentage: 0,
                      message: data.message,
                    });
                    break;

                  case "cache_data":
                    hasReceivedData = true;
                    if (data.articles && Array.isArray(data.articles)) {
                      const mappedArticles = mapBackendArticles(data.articles);
                      const BATCH_SIZE = 500;
                      const cacheAge = data.cache_age_seconds || 999;

                      logger.debug(
                        `Stream ${streamId} cache data: ${mappedArticles.length} articles (cache age: ${cacheAge}s, fresh: ${cacheAge < 120})`,
                      );

                      // Process articles in batches to avoid UI freeze
                      (async () => {
                        for (
                          let i = 0;
                          i < mappedArticles.length;
                          i += BATCH_SIZE
                        ) {
                          const batch = mappedArticles.slice(i, i + BATCH_SIZE);
                          articles.push(...batch);
                          batch.forEach((article) =>
                            sources.add(article.source),
                          );

                          // Notify about this batch immediately
                          if (onSourceComplete) {
                            onSourceComplete(
                              `cache-batch-${Math.floor(i / BATCH_SIZE)}`,
                              batch,
                            );
                          }

                          // Yield to the event loop to prevent blocking
                          if (i + BATCH_SIZE < mappedArticles.length) {
                            await new Promise((resolve) =>
                              setTimeout(resolve, 0),
                            );
                          }
                        }

                        // Final progress update after all batches loaded
                        onProgress?.({
                          completed: sources.size,
                          total: sources.size,
                          percentage: 0,
                          message: `Loaded ${mappedArticles.length} cached articles`,
                        });

                        // If cache is fresh (<120s), set a short timeout to auto-complete if server doesn't send complete event
                        if (cacheAge < 120) {
                          logger.debug(
                            `Cache is fresh (${cacheAge}s), waiting for completion or timeout after 5s...`,
                          );
                          setTimeout(() => {
                            if (!settled && hasReceivedData) {
                              logger.debug(
                                `Auto-completing stream after fresh cache timeout`,
                              );
                              if (abortController) {
                                abortController.abort();
                              }
                            }
                          }, 5000);
                        }
                      })();
                    } else {
                      console.warn(
                        "[streamNews] 'cache_data' event received but 'articles' is not an array or is missing.",
                        data,
                      );
                    }
                    break;

                  case "source_complete":
                    hasReceivedData = true;
                    if (data.articles && data.source) {
                      const mappedArticles = mapBackendArticles(data.articles);
                      articles.push(...mappedArticles);
                      sources.add(data.source);

                      logger.debug(
                        `Stream ${streamId} source complete: ${data.source} (${mappedArticles.length} articles)`,
                      );

                      onSourceComplete?.(data.source, mappedArticles);

                      if (data.progress) {
                        onProgress?.(data.progress);
                      }
                    }
                    break;

                  case "source_error":
                    const errorMsg = `Error loading ${data.source}: ${data.error}`;
                    console.warn(`Stream ${streamId} source error:`, errorMsg);
                    errors.push(errorMsg);
                    onError?.(errorMsg);

                    if (data.progress) {
                      onProgress?.(data.progress);
                    }
                    break;

                  case "complete":
                    logger.debug(`Stream ${streamId} complete:`, {
                      totalArticles: data.total_articles,
                      successfulSources: data.successful_sources,
                      failedSources: data.failed_sources,
                      message: data.message,
                    });

                    clearInterval(timeoutInterval);
                    clearInterval(stallInterval);

                    if (!settled) {
                      settled = true;
                      resolve({
                        articles: removeDuplicateArticles(articles),
                        sources: Array.from(sources),
                        streamId,
                        errors,
                      });
                    }
                    break;

                  case "error":
                    console.error(`Stream ${streamId} error:`, data.error);
                    clearInterval(timeoutInterval);
                    clearInterval(stallInterval);

                    if (hasReceivedData) {
                      if (!settled) {
                        settled = true;
                        resolve({
                          articles: removeDuplicateArticles(articles),
                          sources: Array.from(sources),
                          streamId,
                          errors: [...errors, data.error || "Stream error"],
                        });
                      }
                    } else {
                      if (!settled) {
                        settled = true;
                        reject(new Error(data.error || "Stream error"));
                      }
                    }
                    break;

                  default:
                    logger.debug(
                      `Stream ${streamId} unknown status: ${data.status}`,
                    );
                }
              } catch (parseError) {
                console.error(
                  "Error parsing stream event:",
                  parseError,
                  "Raw data:",
                  eventData,
                );
                onError?.(
                  `Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                );
              }
            }
          }
        } catch (readError: unknown) {
          clearInterval(timeoutInterval);
          clearInterval(stallInterval);

          if (readError instanceof Error && readError.name === "AbortError") {
            console.warn("Stream reader aborted");
            if (!settled) {
              settled = true;
              resolve({
                articles: removeDuplicateArticles(articles),
                sources: Array.from(sources),
                streamId,
                errors: [...errors, "Stream aborted"],
              });
            }
          } else {
            if (isLikelyNetworkError(readError)) {
              logger.warn("News stream disconnected before completion.")
            } else {
              console.error("Stream reader error:", readError);
            }
            if (!settled) {
              settled = true;
              reject(readError);
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error("Stream fetch error:", error);

      if (!settled) {
        settled = true;
        if (error instanceof Error && error.name === "AbortError") {
          resolve({
            articles: removeDuplicateArticles(articles),
            sources: Array.from(sources),
            streamId,
            errors: [...errors, "Aborted"],
          });
        } else {
          reject(error);
        }
      }
    }
  });

  return { promise, url: sseUrl };
}

const hashStringToInt = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

// Helper function to map backend articles to frontend format
export function mapBackendArticles(
  backendArticles: BackendArticle[],
): NewsArticle[] {
  logger.debug(
    `[mapBackendArticles] Mapping ${backendArticles.length} articles from backend format to frontend format.`,
  );
  return backendArticles.map((article) => {
    const sourceName = article.source || article.source_name || "Unknown";

    const summary = article.summary || article.description || "";
    const content = article.content || undefined;
    const rawImage = article.image || article.image_url;
    const image =
      rawImage && rawImage !== "none" ? rawImage : "/placeholder.svg";
    const published =
      article.published_at ||
      article.publishedAt ||
      article.published ||
      new Date().toISOString();
    const parsedTimestamp = new Date(published).getTime();
    const category = article.category || "general";
    const rawUrl =
      article.url ||
      article.link ||
      article.article_url ||
      article.original_url ||
      "";
    const stableKey =
      rawUrl || `${sourceName}|${article.title || ""}|${published}`;
    const resolvedId =
      typeof article.id === "number"
        ? article.id
        : typeof article.article_id === "number"
          ? article.article_id
          : hashStringToInt(stableKey);
    const url = rawUrl;
    const author =
      article.author ||
      (Array.isArray(article.authors) ? article.authors[0] : undefined);
    const authors = Array.isArray(article.authors)
      ? article.authors.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : author
        ? [author]
        : [];

    const rawCountry = typeof article.country === "string" ? article.country : undefined;
    const country = normalizeCountryCode(rawCountry || getCountryFromSource(sourceName));
    const sourceCountry = normalizeCountryCode(
      typeof article.source_country === "string"
        ? article.source_country
        : rawCountry || getCountryFromSource(sourceName),
    );
    const mentionedCountries = Array.isArray(article.mentioned_countries)
      ? article.mentioned_countries
          .filter((value): value is string => typeof value === "string")
          .map((value) => normalizeCountryCode(value))
      : [];
    const credibilityValue =
      typeof article.credibility === "string"
        ? article.credibility.toLowerCase()
        : undefined;
    const biasValue =
      typeof article.bias === "string" ? article.bias.toLowerCase() : undefined;

    const credibility =
      credibilityValue && ["high", "medium", "low"].includes(credibilityValue)
        ? (credibilityValue as "high" | "medium" | "low")
        : getCredibilityFromSource(sourceName);

    const bias =
      biasValue && ["left", "center", "right"].includes(biasValue)
        ? (biasValue as "left" | "center" | "right")
        : getBiasFromSource(sourceName);

    const normalizedSourceId =
      typeof article.source_id === "string" && article.source_id.trim().length > 0
        ? article.source_id.trim().toLowerCase()
        : sourceName.toLowerCase().replace(/\s+/g, "-")
    const geoSignal =
      article.geo_signal && typeof article.geo_signal === "object"
        ? (article.geo_signal as { id?: unknown; label?: unknown })
        : null

    const mappedArticle: NewsArticle = {
      id: resolvedId,
      title: article.title || "No title",
      source: sourceName,
      sourceId: normalizedSourceId,
      country,
      credibility,
      bias,
      summary: summary || "No description",
      content,
      image,
      publishedAt: published,
      _parsedTimestamp: Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp,
      category,
      url,
      tags: [category, sourceName].filter(Boolean),
      originalLanguage: article.original_language || "en",
      translated: article.translated ?? false,
      author: author || undefined,
      authors,
      hasFullContent: typeof article.content === "string" && article.content.trim().length > 0,
      source_country: sourceCountry,
      mentioned_countries: mentionedCountries,
      geo_signal:
        geoSignal &&
        typeof geoSignal.id === "string" &&
        typeof geoSignal.label === "string"
          ? {
              id: geoSignal.id,
              label: geoSignal.label,
            }
          : undefined,
      isPersisted: true,
    };

    return mappedArticle;
  });
}

// Helper function to remove duplicate articles
export function removeDuplicateArticles(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  const seenIds = new Set<number>();
  return articles.filter((article) => {
    // Check for duplicate IDs first (most reliable)
    if (seenIds.has(article.id)) {
      return false;
    }
    seenIds.add(article.id);
    
    // Also check for duplicate title-source combinations
    const key = `${article.title}-${article.source}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Add debug endpoint for stream status
export async function fetchStreamStatus(): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/debug/streams`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Stream status:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch stream status:", error);
    return null;
  }
}

export interface FrontendDebugReportPayload {
  session_id: string;
  summary: {
    sessionId: string;
    startTime: string;
    totalEvents: number;
    slowOperationsCount: number;
    errorCount: number;
    streamMetrics: Array<{
      streamId: string;
      eventCount: number;
      startTime: number;
    }>;
    componentStats: Record<
      string,
      {
        count: number;
        avgDurationMs: number;
        maxDurationMs: number;
        errorCount: number;
      }
    >;
  };
  recent_events: Array<{
    eventId: string;
    eventType: string;
    timestamp: string;
    component: string;
    operation: string;
    message?: string;
    durationMs?: number;
    details?: Record<string, unknown>;
    error?: string;
    stackTrace?: string;
    isSlow?: boolean;
    streamId?: string;
    requestId?: string;
  }>;
  slow_operations: Array<{
    eventId: string;
    eventType: string;
    timestamp: string;
    component: string;
    operation: string;
    message?: string;
    durationMs?: number;
    details?: Record<string, unknown>;
    error?: string;
    stackTrace?: string;
    isSlow?: boolean;
    streamId?: string;
    requestId?: string;
  }>;
  errors: Array<{
    eventId: string;
    eventType: string;
    timestamp: string;
    component: string;
    operation: string;
    message?: string;
    durationMs?: number;
    details?: Record<string, unknown>;
    error?: string;
    stackTrace?: string;
    isSlow?: boolean;
    streamId?: string;
    requestId?: string;
  }>;
  dom_stats?: {
    node_count: number;
    body_text_length: number;
    viewport: {
      width: number;
      height: number;
    };
    title: string;
  };
  location?: string;
  user_agent?: string;
  generated_at?: string;
}

export async function sendFrontendDebugReport(
  payload: FrontendDebugReportPayload,
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/debug/logs/frontend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    if (!isLikelyNetworkError(error)) {
      console.error("Failed to send frontend debug report:", error);
    }
  }
}

// Article Analysis Types
export interface FactCheckResult {
  claim: string;
  verification_status:
    | "verified"
    | "partially-verified"
    | "unverified"
    | "false";
  evidence: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  notes?: string;
}

// --- Trending & Breaking News ---
// The interfaces and functions for fetching trending and breaking news
// are now consolidated at the bottom of this file (Phase 6 section) to avoid duplication.

export interface ArticleAnalysis {
  success: boolean;
  article_url: string;
  full_text?: string;
  title?: string;
  authors?: string[];
  publish_date?: string;
  source_analysis?: {
    credibility_assessment: string;
    ownership: string;
    funding_model: string;
    political_leaning: string;
    reputation: string;
  };
  reporter_analysis?: {
    background: string;
    expertise: string;
    known_biases: string;
    track_record: string;
  };
  bias_analysis?: {
    tone_bias: string;
    framing_bias: string;
    selection_bias: string;
    source_diversity: string;
    overall_bias_score: string;
  };
  fact_check_suggestions?: string[];
  fact_check_results?: FactCheckResult[];
    grounding_metadata?: {
      grounding_chunks?: Array<{ uri?: string; title?: string }>;
      grounding_supports?: unknown[];
      web_search_queries?: string[];
    };
  summary?: string;
  error?: string;
}

// Analyze article with AI
export async function analyzeArticle(
  url: string,
  sourceName?: string,
): Promise<ArticleAnalysis> {
  try {
    logger.debug(`Analyzing article: ${url}`);
    const response = await fetch(`${API_BASE_URL}/api/article/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        source_name: sourceName,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Article analysis complete:", data);
    return data;
  } catch (error) {
    console.error("Failed to analyze article:", error);
    throw error;
  }
}

// News Research Agent Types
export interface ThinkingStep {
  type: "thought" | "action" | "tool_start" | "observation" | "answer";
  content: string;
  timestamp: string;
}

export interface NewsResearchResponse {
  success: boolean;
  query: string;
  answer: string;
  thinking_steps: ThinkingStep[];
  articles_searched: number;
  referenced_articles?: BackendArticle[]; // Full article objects from backend
  error?: string;
}

// Perform news research using the AI agent
export async function performNewsResearch(
  query: string,
  includeThinking: boolean = true,
): Promise<NewsResearchResponse> {
  try {
    logger.debug(`Performing news research: ${query}`);
    const response = await fetch(`${API_BASE_URL}/api/news/research`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        include_thinking: includeThinking,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("News research complete:", data);
    return data;
  } catch (error) {
    console.error("Failed to perform news research:", error);
    throw error;
  }
}

// Agentic search (LangChain backend agent)
export interface AgenticSearchRequest {
  query: string;
  max_steps?: number;
}

export interface AgenticSearchResponse {
  success: boolean;
  answer: string;
  reasoning?: unknown[];
  citations?: unknown[];
}

export async function performAgenticSearch(
  query: string,
  maxSteps: number = 8,
): Promise<AgenticSearchResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/search/agentic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, max_steps: maxSteps }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data as AgenticSearchResponse;
  } catch (error) {
    console.error("Agentic search failed:", error);
    throw error;
  }
}

// Reading Queue API functions
export interface ReadingQueueItem {
  id?: number;
  user_id?: number;
  article_id: number;
  article_title: string;
  article_url: string;
  article_source: string;
  article_image?: string;
  queue_type: "daily" | "permanent";
  position: number;
  read_status: "unread" | "reading" | "completed";
  added_at: string;
  archived_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface QueueResponse {
  items: ReadingQueueItem[];
  daily_count: number;
  permanent_count: number;
  total_count: number;
}

export async function addToReadingQueue(
  article: NewsArticle,
  queueType: "daily" | "permanent" = "daily",
): Promise<ReadingQueueItem> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        article_id: article.id,
        article_title: article.title,
        article_url: article.url,
        article_source: article.source,
        article_image: article.image,
        queue_type: queueType,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Article added to reading queue:", data);
    return data;
  } catch (error) {
    console.error("Failed to add article to reading queue:", error);
    throw error;
  }
}

export async function removeFromReadingQueue(
  queueItemId: number,
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/${queueItemId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    logger.debug("Article removed from reading queue");
  } catch (error) {
    console.error("Failed to remove article from reading queue:", error);
    throw error;
  }
}

export async function removeFromReadingQueueByUrl(
  articleUrl: string,
): Promise<void> {
  try {
    const encodedUrl = encodeURIComponent(articleUrl);
    const response = await fetch(
      `${API_BASE_URL}/api/queue/url/${encodedUrl}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    logger.debug("Article removed from reading queue by URL");
  } catch (error) {
    console.error("Failed to remove article from reading queue:", error);
    throw error;
  }
}

export async function getReadingQueue(): Promise<QueueResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Reading queue retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch reading queue:", error);
    throw error;
  }
}

export interface UpdateQueueItemRequest {
  read_status?: "unread" | "reading" | "completed";
  queue_type?: "daily" | "permanent";
  position?: number;
  archived_at?: string;
}

export async function updateReadingQueueItem(
  queueItemId: number,
  updates: UpdateQueueItemRequest,
): Promise<ReadingQueueItem> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/${queueItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Queue item updated:", data);
    return data;
  } catch (error) {
    console.error("Failed to update queue item:", error);
    throw error;
  }
}

export interface QueueOverview {
  total_items: number;
  daily_items: number;
  permanent_items: number;
  unread_count: number;
  reading_count: number;
  completed_count: number;
  estimated_total_read_time_minutes: number;
}

export async function getQueueOverview(): Promise<QueueOverview> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/overview`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Queue overview retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch queue overview:", error);
    throw error;
  }
}

// Highlights API
export interface Highlight {
  id?: number;
  user_id?: number;
  client_id?: string;
  article_url: string;
  highlighted_text: string;
  color: "yellow" | "blue" | "red" | "green" | "purple";
  note?: string;
  character_start: number;
  character_end: number;
  created_at?: string;
  updated_at?: string;
}

export async function createHighlight(
  highlight: Highlight,
): Promise<Highlight> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/highlights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(highlight),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Highlight created:", data);
    return data;
  } catch (error) {
    console.error("Failed to create highlight:", error);
    throw error;
  }
}

export async function getHighlightsForArticle(
  articleUrl: string,
): Promise<Highlight[]> {
  try {
    const encodedUrl = encodeURIComponent(articleUrl);
    const url = `${API_BASE_URL}/api/queue/highlights/article/${encodedUrl}`;

    if (process.env.NODE_ENV !== "production") {
      logger.debug(`[Highlights] GET ${url}`);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Highlights retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch highlights:", error);
    throw error;
  }
}

export async function getAllHighlights(): Promise<Highlight[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/highlights`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("All highlights retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch highlights:", error);
    throw error;
  }
}

export async function updateHighlight(
  highlightId: number,
  updates: Partial<Highlight>,
): Promise<Highlight> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/queue/highlights/${highlightId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Highlight updated:", data);
    return data;
  } catch (error) {
    console.error("Failed to update highlight:", error);
    throw error;
  }
}

export async function deleteHighlight(highlightId: number): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/queue/highlights/${highlightId}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    logger.debug("Highlight deleted");
  } catch (error) {
    console.error("Failed to delete highlight:", error);
    throw error;
  }
}

// --- Reading Queue Content & Digest ---

export interface QueueItemContent {
  id: number;
  article_url: string;
  article_title: string;
  article_source: string;
  full_text: string;
  word_count?: number;
  estimated_read_time_minutes?: number;
  read_status: string;
}

export interface QueueDigest {
  digest_items: ReadingQueueItem[];
  total_items: number;
  estimated_read_time_minutes: number;
  generated_at: string;
}

export async function getQueueItemContent(
  queueId: number,
): Promise<QueueItemContent> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/queue/${queueId}/content`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Queue item content retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch queue item content:", error);
    throw error;
  }
}

export async function getDailyDigest(): Promise<QueueDigest> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/digest/daily`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug("Daily digest retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch daily digest:", error);
    throw error;
  }
}

// --- Pagination Types ---

export interface PaginatedResponse {
  articles: NewsArticle[];
  total: OpenApiPaginatedResponse["total"];
  limit: OpenApiPaginatedResponse["limit"];
  next_cursor: NonNullable<OpenApiPaginatedResponse["next_cursor"]> | null;
  prev_cursor: NonNullable<OpenApiPaginatedResponse["prev_cursor"]> | null;
  has_more: OpenApiPaginatedResponse["has_more"];
}

export type PaginationParams = Pick<
  NewsPageQueryParams,
  "limit" | "cursor" | "category" | "source" | "sources" | "search"
>;

type CachedPaginationParams = Pick<
  CachedNewsPageQueryParams,
  "limit" | "offset" | "category" | "source" | "sources" | "search"
>;

// --- Paginated Fetch Functions ---

export async function fetchNewsPaginated(
  params: PaginationParams = {},
): Promise<PaginatedResponse> {
  const searchParams = new URLSearchParams();

  if (params.limit) searchParams.append("limit", params.limit.toString());
  if (params.cursor) searchParams.append("cursor", params.cursor);
  if (params.category) searchParams.append("category", params.category);
  // Support both single source and multi-source
  if (params.sources) {
    searchParams.append("sources", params.sources);
  } else if (params.source) {
    searchParams.append("source", params.source);
  }
  if (params.search) searchParams.append("search", params.search);

  const url = `${API_BASE_URL}/news/page${searchParams.toString() ? "?" + searchParams.toString() : ""}`;

  logger.debug(`[Pagination] Fetching paginated news: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

  // Map backend format to frontend format
  const articles = mapBackendArticles(data.articles || []);

  return {
    articles,
    total: data.total,
    limit: data.limit,
    next_cursor: data.next_cursor,
    prev_cursor: data.prev_cursor,
    has_more: data.has_more,
  };
}

export async function fetchCachedNewsPaginated(
  params: CachedPaginationParams = {},
): Promise<PaginatedResponse> {
  const searchParams = new URLSearchParams();

  if (params.limit) searchParams.append("limit", params.limit.toString());
  if (params.offset !== undefined)
    searchParams.append("offset", params.offset.toString());
  if (params.category) searchParams.append("category", params.category);
  // Support both single source and multi-source
  if (params.sources) {
    searchParams.append("sources", params.sources);
  } else if (params.source) {
    searchParams.append("source", params.source);
  }
  if (params.search) searchParams.append("search", params.search);

  const url = `${API_BASE_URL}/news/page/cached${searchParams.toString() ? "?" + searchParams.toString() : ""}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const articles = mapBackendArticles(data.articles || []);

  return {
    articles,
    total: data.total,
    limit: data.limit,
    next_cursor: data.next_cursor,
    prev_cursor: null,
    has_more: data.has_more,
  };
}

export async function fetchBrowseIndex(
  params: Pick<PaginationParams, "category" | "source" | "sources" | "search"> = {},
): Promise<BrowseIndexResponse> {
  const searchParams = new URLSearchParams();

  if (params.category) searchParams.append("category", params.category);
  if (params.sources) {
    searchParams.append("sources", params.sources);
  } else if (params.source) {
    searchParams.append("source", params.source);
  }
  if (params.search) searchParams.append("search", params.search);

  const url = `${API_BASE_URL}/news/index${searchParams.toString() ? "?" + searchParams.toString() : ""}`;
  logger.debug(`[BrowseIndex] Fetching browse index: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

  return {
    articles: mapBackendArticles(data.articles || []),
    total: typeof data.total === "number" ? data.total : 0,
  };
}

// --- Country/Globe API Functions ---

export interface CountryArticleCounts {
  counts: Record<string, number>;
  source_counts?: Record<string, number>;
  geo_signals?: Array<{
    id: string;
    label: string;
    country_counts: Record<string, number>;
    country_count: number;
    article_count: number;
    total_mentions: number;
  }>;
  total_articles: number;
  articles_with_country: number;
  articles_without_country: number;
  country_count: number;
  window_hours?: number;
}

export interface CountryGeoData {
  countries: Record<string, { name: string; lat: number; lng: number }>;
  total: number;
}

export interface CountryListItem {
  code: string;
  article_count: number;
  latest_article: string | null;
}

export interface CountryListResponse {
  countries: CountryListItem[];
  total_countries: number;
}

export interface CountryPickerItem {
  code: string;
  name: string;
  article_count: number;
  latest_article: string | null;
  heat_count: number;
  source_count: number;
}

export interface LocalLensResponse {
  country_code: string;
  country_name?: string;
  view: "internal" | "external";
  view_description: string;
  matching_strategy?: string;
  total: number;
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  source_count?: number;
  window_hours?: number | null;
  geo_signal?: {
    id: string;
    label: string;
  };
  articles: NewsArticle[];
}

/**
 * Get article counts grouped by country for globe heatmap
 */
export async function fetchArticleCountsByCountry(): Promise<CountryArticleCounts> {
  const response = await fetch(`${API_BASE_URL}/news/by-country?hours=24`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Get static country geographic data for globe markers
 */
export async function fetchCountryGeoData(): Promise<CountryGeoData> {
  const response = await fetch(`${API_BASE_URL}/news/countries/geo`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Get list of countries with article counts
 */
export async function fetchCountryList(): Promise<CountryListResponse> {
  const response = await fetch(`${API_BASE_URL}/news/countries/list`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function fetchCountryPickerItems(): Promise<CountryPickerItem[]> {
  const [countryList, geoData] = await Promise.all([
    fetchCountryList(),
    fetchCountryGeoData(),
  ]);

  return countryList.countries.map((country) => ({
    code: country.code,
    name: geoData.countries[country.code]?.name || country.code,
    article_count: country.article_count,
    latest_article: country.latest_article,
    heat_count: 0,
    source_count: country.article_count,
  }));
}

/**
 * Local Lens: Get news for a specific country
 * @backend/tests/test_llm_client_params.py code ISO country code
 * @backend/tests/test_llm_client_params.py view "internal" (from country) or "external" (about country)
 */
export async function fetchNewsForCountry(
  code: string,
  view: "internal" | "external" = "internal",
  limit: number = 50,
  offset: number = 0,
  hours?: number,
): Promise<LocalLensResponse> {
  const params = new URLSearchParams({
    view,
    limit: limit.toString(),
    offset: offset.toString(),
  });
  if (typeof hours === "number") {
    params.set("hours", hours.toString());
  }

  const response = await fetch(
    `${API_BASE_URL}/news/country/${normalizeCountryCode(code)}?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

  return {
    ...data,
    articles: mapBackendArticles(data.articles || []),
  };
}

// ============================================
// Phase 5B: Reporter and Organization Research
// ============================================

export interface ReporterProfile {
  id?: number;
  name: string;
  normalized_name?: string;
  bio?: string;
  career_history?: Array<{
    organization?: string;
    role?: string;
    source?: string;
  }>;
  topics?: string[];
  education?: Array<Record<string, unknown>>;
  political_leaning?: string;
  leaning_confidence?: string;
  twitter_handle?: string;
  linkedin_url?: string;
  wikipedia_url?: string;
  wikidata_qid?: string;
  wikidata_url?: string;
  canonical_name?: string;
  match_status?: "matched" | "ambiguous" | "none";
  overview?: string;
  dossier_sections?: Array<{
    id: string;
    title: string;
    status: "available" | "missing";
    items: Array<{
      label?: string;
      value?: string;
      sources?: string[];
      notes?: string;
    }>;
  }>;
  citations?: Array<{
    label: string;
    url?: string;
    note?: string;
  }>;
  search_links?: Record<string, string>;
  match_explanation?: string;
  research_sources?: string[];
  research_confidence?: string;
  cached: boolean;
}

export interface OrganizationProfile {
  id?: number;
  name: string;
  normalized_name?: string;
  org_type?: string;
  parent_org?: string;
  funding_type?: string;
  funding_sources?: string[];
  ein?: string;
  annual_revenue?: string;
  media_bias_rating?: string;
  factual_reporting?: string;
  wikipedia_url?: string;
  research_sources?: string[];
  research_confidence?: string;
  cached: boolean;
}

export interface OwnershipChain {
  organization: string;
  chain: OrganizationProfile[];
  depth: number;
}

export interface SourceResearchValue {
  value: string;
  sources?: string[];
  notes?: string;
}

export interface SourceReporterSummary {
  name: string;
  article_count: number;
}

export interface SourceResearchProfile {
  name: string;
  canonical_name?: string;
  website?: string;
  fetched_at?: string;
  cached?: boolean;
  fields: Record<string, SourceResearchValue[]>;
  key_reporters?: SourceReporterSummary[];
  overview?: string;
  match_status?: "matched" | "ambiguous" | "none";
  wikipedia_url?: string;
  wikidata_qid?: string;
  wikidata_url?: string;
  dossier_sections?: Array<{
    id: string;
    title: string;
    status: "available" | "missing";
    items: Array<{
      label?: string;
      value?: string;
      sources?: string[];
      notes?: string;
    }>;
  }>;
  citations?: Array<{
    label: string;
    url?: string;
    note?: string;
  }>;
  search_links?: Record<string, string>;
  match_explanation?: string;
}

/**
 * Profile a reporter/journalist
 */
export async function profileReporter(
  name: string,
  organization?: string,
  articleContext?: string,
  forceRefresh: boolean = false,
): Promise<ReporterProfile> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  const response = await fetch(
    `${API_BASE_URL}/research/entity/reporter/profile${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        organization,
        article_context: articleContext,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a cached reporter by ID
 */
export async function getReporter(
  reporterId: number,
): Promise<ReporterProfile> {
  const response = await fetch(
    `${API_BASE_URL}/research/entity/reporter/${reporterId}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * List all cached reporters
 */
export async function listReporters(
  limit: number = 50,
  offset: number = 0,
): Promise<ReporterProfile[]> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  });
  const response = await fetch(
    `${API_BASE_URL}/research/entity/reporters?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Research a news organization's funding and ownership
 */
export async function researchOrganization(
  name: string,
  website?: string,
  forceRefresh: boolean = false,
): Promise<OrganizationProfile> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  const response = await fetch(
    `${API_BASE_URL}/research/entity/organization/research${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, website }),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Build or fetch a cached source research profile
 */
export async function researchSourceProfile(
  name: string,
  website?: string,
  forceRefresh: boolean = false,
): Promise<SourceResearchProfile> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  const response = await fetch(
    `${API_BASE_URL}/research/entity/source/profile${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, website }),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Check if a cached source research profile exists (no research triggered)
 * Returns the cached profile or null if not cached
 */
export async function checkSourceProfileCache(
  name: string,
  website?: string,
): Promise<SourceResearchProfile | null> {
  const response = await fetch(
    `${API_BASE_URL}/research/entity/source/profile?cache_only=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, website }),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export interface SourceResearchRequest {
  name: string;
  website?: string;
}

export interface SourceBatchResponse {
  results: Record<string, SourceResearchProfile | null>;
  cached_count: number;
  newly_researched_count: number;
}

/**
 * Research multiple sources in a single batch request
 * Uses caching and parallelizes research under the hood
 */
export async function researchSourceProfilesBatch(
  sources: SourceResearchRequest[],
  forceRefresh: boolean = false,
): Promise<SourceBatchResponse> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  const response = await fetch(
    `${API_BASE_URL}/research/entity/source/batch${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources }),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a cached organization by ID
 */
export async function getOrganization(
  orgId: number,
): Promise<OrganizationProfile> {
  const response = await fetch(
    `${API_BASE_URL}/research/entity/organization/${orgId}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Get ownership chain for an organization
 */
export async function getOwnershipChain(
  orgName: string,
  maxDepth: number = 5,
): Promise<OwnershipChain> {
  const params = new URLSearchParams({ max_depth: maxDepth.toString() });
  const response = await fetch(
    `${API_BASE_URL}/research/entity/organization/${encodeURIComponent(orgName)}/ownership-chain?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * List all cached organizations
 */
export async function listOrganizations(
  limit: number = 50,
  offset: number = 0,
): Promise<OrganizationProfile[]> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  });
  const response = await fetch(
    `${API_BASE_URL}/research/entity/organizations?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// ============================================
// Phase 5C: Material Interest Analysis
// ============================================

export interface TradeRelationship {
  country_pair: string;
  relationship?: string;
  key_sectors?: string[];
  tension_areas?: string[];
  trade_volume?: string;
}

const TradeRelationshipSchema = z.object({
  country_pair: z.string(),
  relationship: z.string().optional(),
  key_sectors: z.array(z.string()).optional(),
  tension_areas: z.array(z.string()).optional(),
  trade_volume: z.string().optional(),
});

export interface KnownInterests {
  parent_company?: string;
  owner?: string;
  owner_interests?: string[];
  [key: string]: unknown;
}

const KnownInterestsSchema = z
  .object({
    parent_company: z.string().optional(),
    owner: z.string().optional(),
    owner_interests: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

export interface MaterialContext {
  source: string;
  source_country: string;
  mentioned_countries: string[];
  trade_relationships: TradeRelationship[];
  known_interests: KnownInterests;
  potential_conflicts: string[];
  analysis_summary?: string | null;
  reader_warnings?: string[] | null;
  confidence?: string | null;
  analyzed_at?: string | null;
}

type OpenApiMaterialContextResponse =
  OpenApiComponents["schemas"]["MaterialContextResponse"];
type OpenApiTrendingResponse = OpenApiComponents["schemas"]["TrendingResponse"];
type OpenApiBreakingResponse = OpenApiComponents["schemas"]["BreakingResponse"];
type OpenApiAllClustersResponse =
  OpenApiComponents["schemas"]["AllClustersResponse"];
type OpenApiClusterDetailResponse =
  OpenApiComponents["schemas"]["ClusterDetailResponse"];
type OpenApiTrendingStats =
  OpenApiPaths["/trending/stats"]["get"]["responses"][200]["content"]["application/json"];
type OpenApiPaginatedResponse = OpenApiComponents["schemas"]["PaginatedResponse"];
type NewsPageQueryParams = NonNullable<
  OpenApiPaths["/news/page"]["get"]["parameters"]["query"]
>;
type CachedNewsPageQueryParams = NonNullable<
  OpenApiPaths["/news/page/cached"]["get"]["parameters"]["query"]
>;

const MaterialContextSchema = z.object({
  source: z.string(),
  source_country: z.string(),
  mentioned_countries: z.array(z.string()),
  trade_relationships: z.array(TradeRelationshipSchema),
  known_interests: KnownInterestsSchema,
  potential_conflicts: z.array(z.string()),
  analysis_summary: z.string().nullable().optional(),
  reader_warnings: z.array(z.string()).nullable().optional(),
  confidence: z.string().nullable().optional(),
  analyzed_at: z.string().nullable().optional(),
});

export interface CountryEconomicProfile {
  country_code: string;
  profile: {
    gdp?: string;
    gdp_rank?: number;
    top_exports?: string[];
    top_imports?: string[];
    major_partners?: string[];
    note?: string;
  };
}

/**
 * Analyze material interests affecting news coverage
 */
export async function analyzeMaterialContext(
  source: string,
  sourceCountry: string,
  mentionedCountries: string[],
  topics?: string[],
  articleText?: string,
): Promise<MaterialContext> {
  const response = await fetch(
    `${API_BASE_URL}/research/entity/material-context`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        source_country: sourceCountry,
        mentioned_countries: mentionedCountries,
        topics,
        article_text: articleText,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const payload: unknown = await response.json();
  const parsed = MaterialContextSchema.parse(payload);
  parsed satisfies OpenApiMaterialContextResponse;
  return parsed;
}

/**
 * Get economic profile for a country
 */
export async function getCountryEconomicProfile(
  countryCode: string,
): Promise<CountryEconomicProfile> {
  const response = await fetch(
    `${API_BASE_URL}/research/entity/country/${countryCode}/economic-profile`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// ============================================
// Phase 6: Trending & Breaking News Detection
// ============================================

export interface GdeltTopCameo {
  code?: string | null;
  label?: string | null;
  count: number;
}

export interface GdeltContext {
  total_events: number;
  top_cameo: GdeltTopCameo[];
  goldstein_avg?: number | null;
  goldstein_min?: number | null;
  goldstein_max?: number | null;
  goldstein_bucket?: string | null;
  tone_avg?: number | null;
  tone_baseline_avg?: number | null;
  tone_delta_vs_cluster?: number | null;
}

export interface TrendingArticle {
  id: number;
  title: string;
  source: string;
  source_id?: string | null;
  url: string;
  image_url?: string | null;
  published_at?: string | null;
  summary?: string | null;
  author?: string | null;
  authors?: string[];
  gdelt_context?: GdeltContext | null;
}

export interface TrendingCluster {
  cluster_id: number;
  label?: string | null;
  keywords: string[];
  article_count: number;
  window_count: number;
  source_diversity: number;
  trending_score: number;
  velocity: number;
  representative_article?: TrendingArticle | null;
  articles?: TrendingArticle[];
  gdelt_context?: GdeltContext | null;
}

export interface BreakingCluster {
  cluster_id: number;
  label?: string | null;
  keywords: string[];
  article_count_3h: number;
  source_count_3h: number;
  spike_magnitude: number;
  is_new_story: boolean;
  representative_article?: TrendingArticle | null;
  articles?: TrendingArticle[];
  gdelt_context?: GdeltContext | null;
}

export interface TrendingResponse {
  window: string;
  clusters: TrendingCluster[];
  total: number;
}

export interface BreakingResponse {
  window_hours: number;
  clusters: BreakingCluster[];
  total: number;
}

export interface ClusterDetail {
  id: number;
  label?: string | null;
  keywords: string[];
  article_count: number;
  first_seen?: string | null;
  last_seen?: string | null;
  is_active: boolean;
  gdelt_context?: GdeltContext | null;
  articles: Array<{
    id: number;
    title: string;
    source: string;
    source_id?: string | null;
    url: string;
    image_url?: string | null;
    published_at?: string | null;
    summary?: string | null;
    similarity: number;
    author?: string | null;
    authors?: string[];
    gdelt_context?: GdeltContext | null;
  }>;
}

export interface BlindspotLens {
  id: "bias" | "credibility" | "geography" | "institutional_populist";
  label: string;
  description: string;
  available: boolean;
  unavailable_reason?: string | null;
}

export interface BlindspotLane {
  id: "pole_a" | "shared" | "pole_b";
  label: string;
  description: string;
  cluster_count: number;
}

export interface BlindspotPreviewArticle {
  id: number;
  title: string;
  source: string;
  url: string;
  image_url?: string | null;
  published_at?: string | null;
  summary?: string | null;
  similarity: number;
}

export interface BlindspotCard {
  cluster_id: number;
  cluster_label: string;
  keywords: string[];
  article_count: number;
  source_count: number;
  lane: "pole_a" | "shared" | "pole_b";
  blindspot_score: number;
  balance_score: number;
  published_at?: string | null;
  explanation: string;
  coverage_counts: {
    pole_a: number;
    shared: number;
    pole_b: number;
  };
  coverage_shares: {
    pole_a: number;
    shared: number;
    pole_b: number;
  };
  geography_signals: Array<{
    id: string;
    label: string;
    count: number;
  }>;
  representative_article?: BlindspotPreviewArticle | null;
  articles: BlindspotPreviewArticle[];
}

export interface BlindspotViewerResponse {
  available_lenses: BlindspotLens[];
  selected_lens: BlindspotLens;
  summary: {
    window: string;
    total_clusters: number;
    eligible_clusters: number;
    generated_at: string;
    category?: string | null;
    source_filters: string[];
  };
  lanes: BlindspotLane[];
  cards: BlindspotCard[];
  status: string;
}

export interface TrendingStats {
  active_clusters: number;
  total_article_assignments: number;
  recent_spikes: number;
  similarity_threshold: number;
  baseline_days: number;
  breaking_window_hours: number;
}

export interface AllCluster {
  cluster_id: number;
  label?: string | null;
  keywords: string[];
  article_count: number;
  window_count: number;
  source_diversity: number;
  representative_article?: TrendingArticle | null;
  articles?: TrendingArticle[];
  gdelt_context?: GdeltContext | null;
}

export interface AllClustersResponse {
  window: string;
  clusters: AllCluster[];
  total: number;
  computed_at?: string | null;
  status?: "ok" | "initializing" | string | null;
}

const GdeltTopCameoSchema = z.object({
  code: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  count: z.number(),
});

const GdeltContextSchema = z.object({
  total_events: z.number(),
  top_cameo: z.array(GdeltTopCameoSchema).default([]),
  goldstein_avg: z.number().nullable().optional(),
  goldstein_min: z.number().nullable().optional(),
  goldstein_max: z.number().nullable().optional(),
  goldstein_bucket: z.string().nullable().optional(),
  tone_avg: z.number().nullable().optional(),
  tone_baseline_avg: z.number().nullable().optional(),
  tone_delta_vs_cluster: z.number().nullable().optional(),
});

const TrendingArticleSchema = z.object({
  id: z.number(),
  title: z.string(),
  source: z.string(),
  source_id: z.string().nullish(),
  url: z.string(),
  image_url: z.string().nullish(),
  published_at: z.string().nullish(),
  summary: z.string().nullish(),
  author: z.string().nullable().optional(),
  authors: z.array(z.string()).optional(),
  gdelt_context: GdeltContextSchema.nullable().optional(),
});

const TrendingClusterSchema = z.object({
  cluster_id: z.number(),
  label: z.string().nullable(),
  keywords: z.array(z.string()),
  article_count: z.number(),
  window_count: z.number(),
  source_diversity: z.number(),
  trending_score: z.number(),
  velocity: z.number(),
  representative_article: TrendingArticleSchema.nullable().default(null),
  articles: z.array(TrendingArticleSchema).default([]),
  gdelt_context: GdeltContextSchema.nullable().default(null),
});

const BreakingClusterSchema = z.object({
  cluster_id: z.number(),
  label: z.string().nullable(),
  keywords: z.array(z.string()),
  article_count_3h: z.number(),
  source_count_3h: z.number(),
  spike_magnitude: z.number(),
  is_new_story: z.boolean(),
  representative_article: TrendingArticleSchema.nullable().default(null),
  articles: z.array(TrendingArticleSchema).default([]),
  gdelt_context: GdeltContextSchema.nullable().default(null),
});

const TrendingResponseSchema = z.object({
  window: z.string(),
  clusters: z.array(TrendingClusterSchema),
  total: z.number(),
});

const BreakingResponseSchema = z.object({
  window_hours: z.number(),
  clusters: z.array(BreakingClusterSchema),
  total: z.number(),
});

const AllClusterSchema = z.object({
  cluster_id: z.number(),
  label: z.string().nullable(),
  keywords: z.array(z.string()),
  article_count: z.number(),
  window_count: z.number(),
  source_diversity: z.number(),
  representative_article: TrendingArticleSchema.nullable().default(null),
  articles: z.array(TrendingArticleSchema).default([]),
  gdelt_context: GdeltContextSchema.nullable().default(null),
});

const AllClustersResponseSchema = z.object({
  window: z.string(),
  clusters: z.array(AllClusterSchema),
  total: z.number(),
  computed_at: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

const ClusterDetailArticleSchema = z.object({
  id: z.number(),
  title: z.string(),
  source: z.string(),
  source_id: z.string().nullish(),
  url: z.string(),
  image_url: z.string().nullish(),
  published_at: z.string().nullish(),
  summary: z.string().nullish(),
  similarity: z.number(),
  author: z.string().nullable().optional(),
  authors: z.array(z.string()).optional(),
  gdelt_context: GdeltContextSchema.nullable().default(null),
});

const ClusterDetailSchema = z.object({
  id: z.number(),
  label: z.string().nullable(),
  keywords: z.array(z.string()),
  article_count: z.number(),
  first_seen: z.string().nullable(),
  last_seen: z.string().nullable(),
  is_active: z.boolean(),
  articles: z.array(ClusterDetailArticleSchema),
  gdelt_context: GdeltContextSchema.nullable().default(null),
});

const BlindspotLensSchema = z.object({
  id: z.enum(["bias", "credibility", "geography", "institutional_populist"]),
  label: z.string(),
  description: z.string(),
  available: z.boolean(),
  unavailable_reason: z.string().nullable().optional(),
});

const BlindspotLaneSchema = z.object({
  id: z.enum(["pole_a", "shared", "pole_b"]),
  label: z.string(),
  description: z.string(),
  cluster_count: z.number(),
});

const BlindspotPreviewArticleSchema = z.object({
  id: z.number(),
  title: z.string(),
  source: z.string(),
  url: z.string(),
  image_url: z.string().nullish(),
  published_at: z.string().nullish(),
  summary: z.string().nullish(),
  similarity: z.number(),
});

const BlindspotCardSchema = z.object({
  cluster_id: z.number(),
  cluster_label: z.string(),
  keywords: z.array(z.string()),
  article_count: z.number(),
  source_count: z.number(),
  lane: z.enum(["pole_a", "shared", "pole_b"]),
  blindspot_score: z.number(),
  balance_score: z.number(),
  published_at: z.string().nullish(),
  explanation: z.string(),
  coverage_counts: z.object({
    pole_a: z.number(),
    shared: z.number(),
    pole_b: z.number(),
  }),
  coverage_shares: z.object({
    pole_a: z.number(),
    shared: z.number(),
    pole_b: z.number(),
  }),
  geography_signals: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        count: z.number(),
      }),
    )
    .default([]),
  representative_article: BlindspotPreviewArticleSchema.nullable().optional(),
  articles: z.array(BlindspotPreviewArticleSchema),
});

const BlindspotViewerResponseSchema = z.object({
  available_lenses: z.array(BlindspotLensSchema),
  selected_lens: BlindspotLensSchema,
  summary: z.object({
    window: z.string(),
    total_clusters: z.number(),
    eligible_clusters: z.number(),
    generated_at: z.string(),
    category: z.string().nullable().optional(),
    source_filters: z.array(z.string()),
  }),
  lanes: z.array(BlindspotLaneSchema),
  cards: z.array(BlindspotCardSchema),
  status: z.string(),
});

const TrendingStatsSchema = z.object({
  active_clusters: z.number(),
  total_article_assignments: z.number(),
  recent_spikes: z.number(),
  similarity_threshold: z.number(),
  baseline_days: z.number(),
  breaking_window_hours: z.number(),
});

/**
 * Get trending topic clusters
 * @backend/tests/test_llm_client_params.py window Time window: "1d", "1w", or "1m"
 * @backend/tests/test_llm_client_params.py limit Max clusters to return
 */
export async function fetchTrending(
  window: "1d" | "1w" | "1m" = "1d",
  limit: number = 10,
): Promise<TrendingResponse> {
  const params = new URLSearchParams({
    window,
    limit: limit.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/trending?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json();
  const parsed = TrendingResponseSchema.parse(payload);
  parsed satisfies OpenApiTrendingResponse;
  return parsed;
}

/**
 * Get breaking news clusters (3-hour spike detection)
 * @backend/tests/test_llm_client_params.py limit Max clusters to return
 */
export async function fetchBreaking(
  limit: number = 5,
): Promise<BreakingResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/trending/breaking?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json();
  const parsed = BreakingResponseSchema.parse(payload);
  parsed satisfies OpenApiBreakingResponse;
  return parsed;
}

/**
 * Get all clusters for topic-based view
 * @backend/tests/test_llm_client_params.py window Time window: "1d", "1w", or "1m"
 * @backend/tests/test_llm_client_params.py minArticles Minimum articles per cluster
 * @backend/tests/test_llm_client_params.py limit Max clusters to return
 */
export async function fetchAllClusters(
  window: "1d" | "1w" | "1m" = "1d",
  minArticles: number = 2,
  limit: number = 100,
): Promise<AllClustersResponse> {
  const params = new URLSearchParams({
    window,
    min_articles: minArticles.toString(),
    limit: limit.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/trending/clusters?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json();
  const parsed = AllClustersResponseSchema.parse(payload);
  parsed satisfies OpenApiAllClustersResponse;
  return parsed;
}

/**
 * Get detailed info about a specific topic cluster
 */
export async function fetchClusterDetail(
  clusterId: number,
): Promise<ClusterDetail> {
  const response = await fetch(
    `${API_BASE_URL}/trending/clusters/${clusterId}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json();
  const parsed = ClusterDetailSchema.parse(payload);
  parsed satisfies OpenApiClusterDetailResponse;
  return parsed;
}

export async function fetchBlindspotViewer(params?: {
  lens?: BlindspotLens["id"];
  window?: "1d" | "1w" | "1m";
  category?: string;
  sources?: string;
  perLane?: number;
}): Promise<BlindspotViewerResponse> {
  const searchParams = new URLSearchParams();

  if (params?.lens) searchParams.set("lens", params.lens);
  if (params?.window) searchParams.set("window", params.window);
  if (params?.category && params.category !== "all") {
    searchParams.set("category", params.category);
  }
  if (params?.sources) searchParams.set("sources", params.sources);
  if (typeof params?.perLane === "number") {
    searchParams.set("per_lane", params.perLane.toString());
  }

  const response = await fetch(
    `${API_BASE_URL}/blindspots/viewer${searchParams.toString() ? `?${searchParams}` : ""}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const payload: unknown = await response.json();
  return BlindspotViewerResponseSchema.parse(payload);
}

/**
 * Fetch all articles for a cluster and transform to NewsArticle format
 * Used by topic view expansion
 */
export async function fetchClusterArticles(
  clusterId: number,
): Promise<NewsArticle[]> {
  const detail = await fetchClusterDetail(clusterId);

  return detail.articles.map((article) => ({
    id: article.id,
    title: article.title,
    source: article.source,
    sourceId:
      article.source_id?.trim().toLowerCase() ||
      article.source.toLowerCase().replace(/\s+/g, "-"),
    country: getCountryFromSource(article.source),
    credibility: getCredibilityFromSource(article.source),
    bias: getBiasFromSource(article.source),
    summary: article.summary || "No description",
    image: article.image_url || "",
    publishedAt: article.published_at || new Date().toISOString(),
    category: "general",
    url: article.url,
    tags: [article.source].filter(Boolean),
    originalLanguage: "en",
    translated: false,
    author: article.author || undefined,
    authors: article.authors ?? [],
    isPersisted: true,
  }));
}

/**
 * Get trending system statistics
 */
export async function fetchTrendingStats(): Promise<TrendingStats> {
  const response = await fetch(`${API_BASE_URL}/trending/stats`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json();
  const parsed = TrendingStatsSchema.parse(payload);
  parsed satisfies OpenApiTrendingStats;
  return parsed;
}

// ==========================================================================
// GDELT API
// ==========================================================================

export interface GdeltEvent {
  id: number;
  gdelt_id: string;
  url?: string | null;
  title?: string | null;
  source?: string | null;
  published_at?: string | null;
  event_code?: string | null;
  event_root_code?: string | null;
  actor1_name?: string | null;
  actor2_name?: string | null;
  tone?: number | null;
  goldstein_scale?: number | null;
  match_method?: string | null;
  similarity_score?: number | null;
  matched_at?: string | null;
}

export interface GdeltArticleEventsResponse {
  article_id: number;
  total_external_events: number;
  events: GdeltEvent[];
}

export interface GdeltStatsResponse {
  window_hours: number;
  total_events: number;
  matched_events: number;
  match_rate: number;
  match_breakdown: {
    url_match: number;
    embedding_match: number;
  };
  top_articles_by_coverage: Array<{
    article_id: number;
    gdelt_event_count: number;
  }>;
}

export async function fetchGdeltArticleEvents(
  articleId: number,
  limit: number = 50,
): Promise<GdeltArticleEventsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await fetch(
    `${API_BASE_URL}/gdelt/article/${articleId}?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function fetchGdeltStats(
  hours: number = 24,
): Promise<GdeltStatsResponse> {
  const params = new URLSearchParams({ hours: String(hours) });
  const response = await fetch(`${API_BASE_URL}/gdelt/stats?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// ============================================================================
// Similarity / Related Articles API
// ============================================================================

export interface RelatedArticle {
  id: number;
  title: string;
  source: string;
  sourceId: string;
  summary?: string;
  image?: string;
  publishedAt?: string;
  category?: string;
  url: string;
  similarity_score: number;
}

export interface RelatedArticlesResponse {
  article_id: number;
  related: RelatedArticle[];
  total: number;
}

export interface SearchSuggestion {
  cluster_id: number;
  label: string;
  relevance: number;
}

export interface SearchSuggestionsResponse {
  query: string;
  suggestions: SearchSuggestion[];
}

export interface SourceCoverageStats {
  article_count: number;
  centroid_distance?: number;
  spread?: number;
  diversity_score?: number;
}

export interface SourceCoverageResponse {
  sources: Record<string, SourceCoverageStats>;
  global_article_count: number;
  error?: string;
}

export interface NoveltyScoreResponse {
  article_id: number;
  novelty_score: number;
  max_similarity_to_history: number;
  avg_similarity_to_history: number;
  history_size: number;
  reason?: string;
}

/**
 * Get articles similar to a given article
 * @backend/tests/test_llm_client_params.py articleId The article to find similar articles for
 * @backend/tests/test_llm_client_params.py limit Max number of related articles to return
 * @backend/tests/test_llm_client_params.py excludeSameSource Whether to exclude articles from the same source
 */
export async function fetchRelatedArticles(
  articleId: number,
  limit: number = 5,
  excludeSameSource: boolean = true,
): Promise<RelatedArticlesResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    exclude_same_source: excludeSameSource.toString(),
  });

  const response = await fetch(
    `${API_BASE_URL}/api/similarity/related/${articleId}?${params}`,
  );
  if (response.status === 503) {
    throw new Error("Similarity features unavailable - vector store offline");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Get search suggestions based on topic clusters
 * @backend/tests/test_llm_client_params.py query The search query to get suggestions for
 * @backend/tests/test_llm_client_params.py limit Max number of suggestions
 */
export async function fetchSearchSuggestions(
  query: string,
  limit: number = 5,
): Promise<SearchSuggestionsResponse> {
  const params = new URLSearchParams({
    query,
    limit: limit.toString(),
  });

  const response = await fetch(
    `${API_BASE_URL}/api/similarity/search-suggestions?${params}`,
  );
  if (response.status === 503) {
    throw new Error("Search suggestions unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Compare embedding coverage between sources
 * @backend/tests/test_llm_client_params.py sourceIds Array of source IDs to compare
 * @backend/tests/test_llm_client_params.py sampleSize Number of articles to sample per source
 */
export async function fetchSourceCoverage(
  sourceIds: string[],
  sampleSize: number = 100,
): Promise<SourceCoverageResponse> {
  const params = new URLSearchParams({
    source_ids: sourceIds.join(","),
    sample_size: sampleSize.toString(),
  });

  const response = await fetch(
    `${API_BASE_URL}/api/similarity/source-coverage?${params}`,
  );
  if (response.status === 503) {
    throw new Error("Source coverage unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Compute novelty score for an article compared to reading history
 * @backend/tests/test_llm_client_params.py articleId The article to score
 * @backend/tests/test_llm_client_params.py readingHistory Array of article IDs the user has read
 */
export async function fetchNoveltyScore(
  articleId: number,
  readingHistory: number[],
): Promise<NoveltyScoreResponse> {
  const response = await fetch(`${API_BASE_URL}/api/similarity/novelty-score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      article_id: articleId,
      reading_history: readingHistory,
    }),
  });
  if (response.status === 503) {
    throw new Error("Novelty scoring unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// ============================================================================
// Article Topics / Semantic Tags API
// ============================================================================

export interface ArticleTopic {
  cluster_id: number;
  label: string;
  similarity: number | null;
  keywords?: string[];
}

export interface ArticleTopicsResponse {
  article_id: number;
  topics: ArticleTopic[];
}

export interface BulkArticleTopicsResponse {
  articles: Record<
    number,
    Array<{
      cluster_id: number
      label: string
      similarity: number | null
      keywords?: string[]
    }>
  >;
}

/**
 * Get topic/cluster assignments for an article
 * @backend/tests/test_llm_client_params.py articleId The article to get topics for
 */
export async function fetchArticleTopics(
  articleId: number,
): Promise<ArticleTopicsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/similarity/article-topics/${articleId}`,
  );
  if (response.status === 503) {
    throw new Error("Topic lookup unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Get topic/cluster assignments for multiple articles
 * @backend/tests/test_llm_client_params.py articleIds Array of article IDs
 */
export async function fetchBulkArticleTopics(
  articleIds: number[],
): Promise<BulkArticleTopicsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/similarity/bulk-article-topics`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(articleIds),
    },
  );
  if (response.status === 503) {
    throw new Error("Topic lookup unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}
/**
 * Fetch the OpenGraph image for a given article URL
 * @backend/tests/test_llm_client_params.py url The URL of the article
 */
// ============================================================================
// Media Accountability Wiki API
// ============================================================================

export interface WikiAnalysisAxis {
  axis_name: string;
  score: number;
  confidence?: string;
  prose_explanation?: string;
  citations?: Array<{ url?: string; title?: string; snippet?: string }>;
  empirical_basis?: string;
  scored_by?: string;
  last_scored_at?: string;
}

export interface WikiSourceCard {
  name: string;
  country?: string;
  funding_type?: string;
  bias_rating?: string;
  category?: string;
  parent_company?: string;
  credibility_score?: number;
  analysis_scores?: Record<string, number>;
  index_status?: string;
  last_indexed_at?: string;
}

export interface WikiSourceProfile {
  name: string;
  country?: string;
  funding_type?: string;
  bias_rating?: string;
  category?: string;
  parent_company?: string;
  credibility_score?: number;
  is_state_media?: boolean;
  source_type?: string;
  overview?: string;
  match_status?: "matched" | "ambiguous" | "none";
  wikipedia_url?: string;
  wikidata_qid?: string;
  wikidata_url?: string;
  dossier_sections: Array<{
    id: string;
    title: string;
    status: "available" | "missing";
    items: Array<{
      label?: string;
      value?: string;
      sources?: string[];
      notes?: string;
    }>;
  }>;
  citations: Array<{
    label: string;
    url?: string;
    note?: string;
  }>;
  search_links?: Record<string, string>;
  match_explanation?: string;
  analysis_axes: WikiAnalysisAxis[];
  reporters: Array<{
    id: number;
    name: string;
    topics?: string[];
    political_leaning?: string;
    article_count: number;
  }>;
  organization?: {
    id: number;
    name: string;
    org_type?: string;
    funding_type?: string;
    funding_sources?: unknown[];
    major_advertisers?: unknown[];
    ein?: string;
    annual_revenue?: number;
    media_bias_rating?: string;
    factual_reporting?: string;
    wikipedia_url?: string;
    research_confidence?: string;
  } | null;
  ownership_chain: Array<{
    name: string;
    ownership_percentage?: number;
    [key: string]: unknown;
  }>;
  article_count: number;
  geographic_focus: string[];
  topic_focus: string[];
  index_status?: string;
  last_indexed_at?: string;
}

export interface WikiReporterCard {
  id: number;
  name: string;
  normalized_name?: string;
  bio?: string;
  topics?: string[];
  political_leaning?: string;
  leaning_confidence?: string;
  article_count: number;
  current_outlet?: string;
  wikipedia_url?: string;
  canonical_name?: string;
  match_status?: "matched" | "ambiguous" | "none";
  research_confidence?: string;
}

export interface WikiReporterDossier extends WikiReporterCard {
  career_history?: Array<{
    organization?: string;
    role?: string;
    source?: string;
  }>;
  education?: Array<Record<string, unknown>>;
  leaning_sources?: string[];
  twitter_handle?: string;
  linkedin_url?: string;
  wikidata_qid?: string;
  wikidata_url?: string;
  canonical_name?: string;
  match_status?: "matched" | "ambiguous" | "none";
  overview?: string;
  dossier_sections: Array<{
    id: string;
    title: string;
    status: "available" | "missing";
    items: Array<{
      label?: string;
      value?: string;
      sources?: string[];
      notes?: string;
    }>;
  }>;
  citations: Array<{
    label: string;
    url?: string;
    note?: string;
  }>;
  search_links?: Record<string, string>;
  match_explanation?: string;
  source_patterns?: Record<string, unknown>;
  topics_avoided?: Record<string, unknown>;
  advertiser_alignment?: Record<string, unknown>;
  revolving_door?: Record<string, unknown>;
  controversies?: Array<Record<string, unknown>>;
  institutional_affiliations?: Array<Record<string, unknown>>;
  coverage_comparison?: Record<string, unknown>;
  last_article_at?: string;
  recent_articles: Array<{
    id?: number;
    title?: string;
    source?: string;
    published_at?: string | null;
    url?: string;
    category?: string;
    image_url?: string | null;
  }>;
  research_sources?: string[];
}

export interface WikiOwnershipGraph {
  nodes: Array<{
    id: string;
    label: string;
    type?: string;
    bias?: string;
    funding?: string;
    country?: string;
    [key: string]: unknown;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type?: string;
    percentage?: number;
    [key: string]: unknown;
  }>;
}

export interface WikiIndexStatus {
  total_entries: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
}

export interface WikiSourcesParams {
  country?: string;
  bias?: string;
  funding?: string;
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch the wiki source directory with optional filters
 */
export async function fetchWikiSources(
  params: WikiSourcesParams = {},
): Promise<WikiSourceCard[]> {
  const query = new URLSearchParams();
  if (params.country) query.set("country", params.country);
  if (params.bias) query.set("bias", params.bias);
  if (params.funding) query.set("funding", params.funding);
  if (params.search) query.set("search", params.search);
  if (params.sort) query.set("sort", params.sort);
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.offset) query.set("offset", params.offset.toString());

  const qs = query.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/wiki/sources${qs ? `?${qs}` : ""}`,
  );
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch the full wiki profile for a single source
 */
export async function fetchWikiSource(
  sourceName: string,
): Promise<WikiSourceProfile> {
  const response = await fetch(
    `${API_BASE_URL}/api/wiki/sources/${encodeURIComponent(sourceName)}`,
  );
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch reporters associated with a source
 */
export async function fetchWikiSourceReporters(
  sourceName: string,
): Promise<WikiReporterCard[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/wiki/sources/${encodeURIComponent(sourceName)}/reporters`,
  );
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch the wiki reporter directory
 */
export async function fetchWikiReporters(
  params: {
    search?: string;
    outlet?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<WikiReporterCard[]> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.outlet) query.set("source", params.outlet);
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.offset) query.set("offset", params.offset.toString());

  const qs = query.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/wiki/reporters${qs ? `?${qs}` : ""}`,
  );
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch a full reporter dossier
 */
export async function fetchWikiReporter(
  reporterId: number,
): Promise<WikiReporterDossier> {
  const response = await fetch(
    `${API_BASE_URL}/api/wiki/reporters/${reporterId}`,
  );
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch articles by a reporter (returns simplified article objects)
 */
export async function fetchWikiReporterArticles(reporterId: number): Promise<
  Array<{
    id: number;
    title: string;
    source: string;
    published_at?: string;
    url: string;
    category?: string;
    image_url?: string;
  }>
> {
  const response = await fetch(
    `${API_BASE_URL}/api/wiki/reporters/${reporterId}/articles`,
  );
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch the ownership graph for the force-directed visualization
 */
export async function fetchWikiOwnershipGraph(): Promise<WikiOwnershipGraph> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/organizations/graph`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch wiki indexing status summary
 */
export async function fetchWikiIndexStatus(): Promise<WikiIndexStatus> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/index/status`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Trigger wiki indexing for a specific source
 */
export async function triggerWikiIndex(
  sourceName: string,
): Promise<{ status: string; message: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/wiki/index/${encodeURIComponent(sourceName)}`,
    {
      method: "POST",
    },
  );
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

export async function fetchOGImage(url: string): Promise<string | null> {
  const now = Date.now();
  ogImageMetrics.total += 1;
  const cached = ogImageCache.get(url);
  if (cached && cached.expiresAt > now) {
    ogImageMetrics.cacheHit += 1;
    return cached.imageUrl;
  }
  if (cached && cached.expiresAt <= now) {
    ogImageCache.delete(url);
  }

  const inFlight = ogImageInFlight.get(url);
  if (inFlight) {
    ogImageMetrics.inFlightHit += 1;
    return inFlight;
  }

  pruneOgImageCache();

  const requestPromise = (async () => {
    ogImageMetrics.network += 1;
    if (ogImageMetrics.total % 200 === 0) {
      logger.debug("OG image fetch metrics", {
        total: ogImageMetrics.total,
        cacheHit: ogImageMetrics.cacheHit,
        inFlightHit: ogImageMetrics.inFlightHit,
        network: ogImageMetrics.network,
        cacheSize: ogImageCache.size,
      });
    }

    const cacheResult = (imageUrl: string | null, ttlMs: number) => {
      ogImageCache.set(url, {
        imageUrl,
        expiresAt: Date.now() + ttlMs,
      });
      return imageUrl;
    };

    try {
      const response = await fetch(
        `${API_BASE_URL}/image/og?url=${encodeURIComponent(url)}`,
      );
      if (!response.ok) {
        if (response.status === 404) {
          return cacheResult(null, OG_IMAGE_MISS_TTL_MS);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return cacheResult(data.image_url || null, OG_IMAGE_SUCCESS_TTL_MS);
    } catch (error) {
      console.error("Failed to fetch OG image:", error);
      return cacheResult(null, OG_IMAGE_ERROR_TTL_MS);
    } finally {
      ogImageInFlight.delete(url);
    }
  })();

  ogImageInFlight.set(url, requestPromise);

  try {
    return await requestPromise;
  } finally {
    pruneOgImageCache();
  }
}
