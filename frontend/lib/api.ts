import { logger } from "@/lib/logger"
// API utility for communicating with FastAPI backend

// Default to localhost backend when env var is not set (makes dev easier)
const resolveBaseUrl = (value?: string) => {
  const fallback = 'http://localhost:8000';
  const raw = value && value.trim().length > 0 ? value : fallback;
  return raw.replace(/\/+$/, '');
};

export const API_BASE_URL = resolveBaseUrl(process.env.NEXT_PUBLIC_API_URL);
const DOCKER_API_BASE_URL = resolveBaseUrl(process.env.NEXT_PUBLIC_DOCKER_API_URL || API_BASE_URL);

// Use DOCKER_API_BASE_URL when running in Docker
// This allows the frontend to reach the backend when both are in Docker containers
// Which uses 8001 instead of 8000 to avoid conflict with Next.js dev server
// (In production, both frontend and backend would be served from the same origin)

// --- Feature Gates ---
export const ENABLE_DIGEST = process.env.NEXT_PUBLIC_ENABLE_DIGEST === "true"
export const ENABLE_HIGHLIGHTS = true

// --- Data Types ---

// Data types

export interface NewsSource {
  id: string
  name: string
  country: string
  url: string
  rssUrl: string
  credibility: "high" | "medium" | "low"
  bias: "left" | "center" | "right"
  category: string[]
  language: string
  funding: string[]
}

export interface NewsArticle {
  id: number
  title: string
  source: string
  sourceId: string
  country: string
  credibility: "high" | "medium" | "low"
  bias: "left" | "center" | "right"
  summary: string
  content?: string
  image: string
  publishedAt: string
  category: string
  url: string
  tags: string[]
  originalLanguage: string
  translated: boolean
  // Phase 5 Fields
  source_country?: string
  mentioned_countries?: string[]
  author?: string
  // Preloaded queue data
  _queueData?: {
    fullText?: string
    readingTimeMinutes?: number
    aiAnalysis?: ArticleAnalysis
    preloadedAt?: number
  }
}

export interface BookmarkEntry {
  bookmarkId: number
  articleId: number
  article: NewsArticle
  createdAt?: string
}

export interface SemanticSearchResult {
  article: NewsArticle
  similarityScore?: number | null
  distance?: number | null
}

export interface SemanticSearchResponse {
  query: string
  results: SemanticSearchResult[]
  total: number
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
  status: 'starting' | 'initial' | 'cache_data' | 'source_complete' | 'source_error' | 'complete' | 'error';
  stream_id?: string;
  message?: string;
  source?: string;
  articles?: any[];
  source_stat?: any;
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
    searchParams.append('use_cache', 'true'); // Use cache by default

    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.category) searchParams.append('category', params.category);

    const url = `${API_BASE_URL}/news/stream${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
    logger.debug(`Fetching news from unified endpoint: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug(`Backend response:`, data);

    // Backend returns { articles: [...], total: number, sources: [...], stream_id: string }
    let articles = data.articles || [];

    if (articles.length === 0) {
      logger.debug(`No articles received from backend. Full response:`, JSON.stringify(data, null, 2));
    } else {
      logger.debug(`Received ${articles.length} articles from unified backend endpoint`);
    }

    // Convert backend format to frontend format
    articles = mapBackendArticles(articles);

    // Client-side search filtering if needed
    if (params?.search) {
      const searchTerm = params.search.toLowerCase();
      const beforeFilterCount = articles.length;
      articles = articles.filter((article: NewsArticle) =>
        article.title.toLowerCase().includes(searchTerm) ||
        article.summary.toLowerCase().includes(searchTerm)
      );
      logger.debug(`Search filter applied: ${beforeFilterCount} -> ${articles.length} articles (search: "${params.search}")`);
    }

    // Client-side category filtering if needed
    if (params?.category) {
      const beforeFilterCount = articles.length;
      articles = articles.filter((article: NewsArticle) =>
        article.category.toLowerCase() === params.category!.toLowerCase()
      );
      logger.debug(`Category filter applied: ${beforeFilterCount} -> ${articles.length} articles (category: "${params.category}")`);
    }

    if (articles.length === 0) {
      logger.debug(`No articles to return after processing. Params:`, params);
    }

    return articles;
  } catch (error) {
    console.error('Failed to fetch news from unified endpoint:', error);
    throw error;
  }
}

// Helper functions to map source to metadata
function getCountryFromSource(source: string): string {
  const countryMap: { [key: string]: string } = {
    'BBC': 'United Kingdom',
    'CNN': 'United States',
    'Reuters': 'United Kingdom',
    'NPR': 'United States',
    'Fox News': 'United States',
    'Associated Press': 'United States'
  };
  return countryMap[source] || 'United States';
}

function getCredibilityFromSource(source: string): "high" | "medium" | "low" {
  const credibilityMap: { [key: string]: "high" | "medium" | "low" } = {
    'BBC': 'high',
    'CNN': 'medium',
    'Reuters': 'high',
    'NPR': 'high',
    'Fox News': 'medium',
    'Associated Press': 'high'
  };
  return credibilityMap[source] || 'medium';
}

function getBiasFromSource(source: string): "left" | "center" | "right" {
  const biasMap: { [key: string]: "left" | "center" | "right" } = {
    'BBC': 'center',
    'CNN': 'left',
    'Reuters': 'center',
    'NPR': 'left',
    'Fox News': 'right',
    'Associated Press': 'center'
  };
  return biasMap[source] || 'center';
}

export async function fetchNewsFromSource(sourceId: string): Promise<NewsArticle[]> {
  // Refactored to use the main fetchNews function for consistency
  const allArticles = await fetchNews();
  return allArticles.filter(article => article.sourceId === sourceId);
}

export async function fetchNewsByCategory(category: string): Promise<NewsArticle[]> {
  return fetchNews({ category });
}

export async function fetchSources(): Promise<NewsSource[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/sources`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const sources = await response.json();

    // Convert backend source format to frontend format
    return sources.map((source: any) => ({
      id: source.name.toLowerCase().replace(/\s+/g, '-'),
      name: source.name,
      country: source.country,
      url: source.url,
      rssUrl: source.url, // Backend doesn't separate RSS URL
      credibility: mapCredibility(source.bias_rating),
      bias: mapBias(source.bias_rating),
      category: [source.category],
      language: "en",
      funding: [source.funding_type || "Unknown"]
    }));
  } catch (error) {
    console.error('Failed to fetch sources:', error);
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
    return Array.isArray(data) ? data : (data?.categories || []);
  } catch (error) {
    console.error('Failed to fetch categories:', error);
    return [];
  }
}

// Inline definition API: request a short, one-paragraph definition for a highlighted term
/**
 * Requests a short, one-paragraph AI-generated definition for a highlighted term using the /api/inline/define endpoint.
 * Returns a success flag, the term, and the definition or error.
 */
export async function requestInlineDefinition(term: string, context?: string): Promise<{ success: boolean; term: string; definition?: string | null; error?: string | null }> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/inline/define`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term, context: context ?? '' }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return { success: true, term, definition: data.definition ?? null, error: data.error ?? null };
  } catch (err: any) {
    console.error('requestInlineDefinition failed', err);
    return { success: false, term, definition: null, error: err?.message ?? String(err) };
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
    console.error('Failed to fetch source stats:', error);
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

export async function fetchCacheStatus(): Promise<CacheStatus | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/cache/status`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to fetch cache status:', error);
    return null;
  }
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
  }) => void
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
  options?: { limit?: number; category?: string }
): Promise<SemanticSearchResponse> {
  const params = new URLSearchParams({ query })
  if (options?.limit) params.append('limit', options.limit.toString())
  if (options?.category) params.append('category', options.category)

  const url = `${API_BASE_URL}/api/search/semantic?${params.toString()}`

  const response = await fetch(url)
  if (response.status === 503) {
    throw new Error('Semantic search is currently unavailable.')
  }
  if (!response.ok) {
    throw new Error(`Semantic search failed with status ${response.status}`)
  }

  const data = await response.json()
  const rawResults = Array.isArray(data?.results) ? data.results : []
  const mappedArticles = mapBackendArticles(rawResults)

  const results: SemanticSearchResult[] = mappedArticles.map((article, index) => ({
    article,
    similarityScore: rawResults[index]?.similarity_score ?? null,
    distance: rawResults[index]?.distance ?? null
  }))

  return {
    query: data?.query || query,
    results,
    total: typeof data?.total === 'number' ? data.total : results.length
  }
}

export async function fetchBookmarks(): Promise<BookmarkEntry[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    const bookmarks = Array.isArray(data?.bookmarks) ? data.bookmarks : []
    const mappedArticles = mapBackendArticles(bookmarks)

    return mappedArticles.map((article, index) => ({
      bookmarkId: bookmarks[index].bookmark_id,
      articleId: bookmarks[index].article_id,
      createdAt: bookmarks[index].created_at,
      article
    }))
  } catch (error) {
    console.error('Failed to fetch bookmarks:', error)
    return []
  }
}

export async function fetchBookmark(articleId: number): Promise<BookmarkEntry | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks/${articleId}`)
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    const [article] = mapBackendArticles([data])
    return {
      bookmarkId: data.bookmark_id,
      articleId: data.article_id,
      createdAt: data.created_at,
      article
    }
  } catch (error) {
    console.error('Failed to fetch bookmark:', error)
    return null
  }
}

export async function createBookmark(articleId: number): Promise<BookmarkEntry | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ article_id: articleId })
    })

    if (!response.ok) {
      throw new Error(`Failed to create bookmark. Status: ${response.status}`)
    }

    // Fetch the complete bookmark details (article metadata + bookmark info)
    return await fetchBookmark(articleId)
  } catch (error) {
    console.error('Failed to create bookmark:', error)
    throw error
  }
}

export async function updateBookmark(articleId: number): Promise<BookmarkEntry | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks/${articleId}`, {
      method: 'PUT'
    })

    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Failed to update bookmark. Status: ${response.status}`)
    }

    return await fetchBookmark(articleId)
  } catch (error) {
    console.error('Failed to update bookmark:', error)
    return null
  }
}

export async function deleteBookmark(articleId: number): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bookmarks/${articleId}`, {
      method: 'DELETE'
    })

    if (response.status === 404) {
      return false
    }
    if (!response.ok) {
      throw new Error(`Failed to delete bookmark. Status: ${response.status}`)
    }

    return true
  } catch (error) {
    console.error('Failed to delete bookmark:', error)
    throw error
  }
}

export interface LikedEntry {
  likedId: number
  articleId: number
  article: NewsArticle
  createdAt?: string
}

export async function fetchLikedArticles(): Promise<LikedEntry[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/liked`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    const liked = Array.isArray(data?.liked) ? data.liked : []
    const mappedArticles = mapBackendArticles(liked)

    return mappedArticles.map((article, index) => ({
      likedId: liked[index].liked_id,
      articleId: liked[index].article_id,
      createdAt: liked[index].created_at,
      article
    }))
  } catch (error) {
    console.error('Failed to fetch liked articles:', error)
    return []
  }
}

export async function createLikedArticle(articleId: number): Promise<LikedEntry | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/liked`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ article_id: articleId })
    })

    if (!response.ok) {
      throw new Error(`Failed to like article. Status: ${response.status}`)
    }

    return await fetchLikedArticles().then(liked => 
      liked.find(entry => entry.articleId === articleId) || null
    )
  } catch (error) {
    console.error('Failed to like article:', error)
    throw error
  }
}

export async function deleteLikedArticle(articleId: number): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/liked/${articleId}`, {
      method: 'DELETE'
    })

    if (response.status === 404) {
      return false
    }
    if (!response.ok) {
      throw new Error(`Failed to unlike article. Status: ${response.status}`)
    }

    return true
  } catch (error) {
    console.error('Failed to unlike article:', error)
    throw error
  }
}

// Helper functions for compatibility with existing components
let cachedSources: NewsSource[] = [];
let cachedArticles: NewsArticle[] = [];

export async function getSourceById(id: string): Promise<NewsSource | undefined> {
  if (cachedSources.length === 0) {
    cachedSources = await fetchSources();
  }
  return cachedSources.find(source => source.id === id);
}

export async function getArticlesByCountry(country: string): Promise<NewsArticle[]> {
  if (cachedArticles.length === 0) {
    cachedArticles = await fetchNews({ limit: 3000 }); // Get more articles for filtering
  }
  return cachedArticles.filter(article =>
    article.country.toLowerCase() === country.toLowerCase()
  );
}

export async function fetchArticlesBySource(sourceId: string): Promise<NewsArticle[]> {
  if (cachedArticles.length === 0) {
    cachedArticles = await fetchNews({ limit: 3000 });
  }
  return cachedArticles.filter(article => article.sourceId === sourceId);
}

// Initialize data on module load
export async function initializeData() {
  try {
    cachedSources = await fetchSources();
    cachedArticles = await fetchNews({ limit: 1000 });
  } catch (error) {
    console.error('Failed to initialize data:', error);
  }
}


/**
 * Requests a definition for a term using the /api/inline/definition endpoint.
 * Returns the definition and any error encountered.
 */
export async function fetchInlineDefinition(term: string, context?: string): Promise<{ definition?: string | null; error?: string | null }> {
  // Backwards-compatible wrapper around requestInlineDefinition
  const res = await requestInlineDefinition(term, context);
  return { definition: res.definition ?? null, error: res.error ?? null };
}

export interface SourceDebugData {
  source_name: string;
  source_config: any;
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
    tags: any[];
    has_images: boolean;
    image_sources: any[];
    content_images: string[];
    description_images: string[];
    raw_entry_keys: string[];
  }>;
  cached_articles: any[];
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
    image_sources: any[];
  };
  error?: string;
}

export async function fetchSourceDebugData(sourceName: string): Promise<SourceDebugData> {
  // Safely decode the source name in case it's already URL encoded, then encode it properly
  let decodedSourceName: string;
  try {
    decodedSourceName = decodeURIComponent(sourceName);
  } catch (decodeError) {
    // If decoding fails, assume it's not encoded
    decodedSourceName = sourceName;
  }
  const encodedSourceName = encodeURIComponent(decodedSourceName);

  // FIXED: Use correct endpoint path
  const url = `${API_BASE_URL}/debug/sources/${encodedSourceName}`;
  logger.debug(`Fetching debug data for source: ${url}`);
  try {
    const response = await fetch(url);
    logger.debug(`Debug response status for source ${sourceName}:`, response.status);
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
          generator: ""
        },
        feed_status: {
          http_status: response.status,
          bozo: false,
          bozo_exception: "",
          entries_count: 0
        },
        parsed_entries: [],
        cached_articles: [],
        source_statistics: null,
        debug_timestamp: new Date().toISOString(),
        image_analysis: {
          total_entries: 0,
          entries_with_images: 0,
          image_sources: []
        },
        error: `HTTP error! status: ${response.status}`
      };
    }

    const debugData = await response.json();
    logger.debug(`Debug data received for ${sourceName}:`, {
      entriesCount: debugData.feed_status?.entries_count,
      cachedArticles: debugData.cached_articles?.length,
      hasError: !!debugData.error
    });

    return debugData;
  } catch (error: any) {
    console.error('Error fetching source debug data:', error);
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
        generator: ""
      },
      feed_status: {
        http_status: "fetch_failed",
        bozo: false,
        bozo_exception: error?.message || "Unknown fetch error",
        entries_count: 0
      },
      parsed_entries: [],
      cached_articles: [],
      source_statistics: null,
      debug_timestamp: new Date().toISOString(),
      image_analysis: {
        total_entries: 0,
        entries_with_images: 0,
        image_sources: []
      },
      error: error?.message || "Unknown fetch error"
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

export interface StorageDriftReport {
  database_total_articles: number;
  database_with_embeddings: number;
  database_missing_embeddings: number;
  vector_total_documents: number;
  missing_in_chroma_count: number;
  dangling_in_chroma_count: number;
  missing_in_chroma: Array<{ id: number; chroma_id?: string | null; embedding_generated?: boolean | null }>;
  dangling_in_chroma: string[];
}

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
    `${API_BASE_URL}/debug/chromadb/articles${query ? `?${query}` : ""}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch Chroma debug data (${response.status})`);
  }

  return (await response.json()) as ChromaDebugResponse;
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
    `${API_BASE_URL}/debug/database/articles${query ? `?${query}` : ""}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch database debug data (${response.status})`);
  }

  return (await response.json()) as DatabaseDebugResponse;
}

export async function fetchStorageDrift(sampleLimit: number = 50): Promise<StorageDriftReport> {
  const response = await fetch(
    `${API_BASE_URL}/debug/storage/drift?sample_limit=${sampleLimit}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch storage drift report (${response.status})`);
  }

  return (await response.json()) as StorageDriftReport;
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
    `${API_BASE_URL}/debug/cache/articles${query ? `?${query}` : ""}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch cache debug data (${response.status})`);
  }

  return (await response.json()) as CacheDebugResponse;
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
    searchParams.append("sample_preview_limit", String(params.sample_preview_limit));
  }

  const query = searchParams.toString();
  const response = await fetch(
    `${API_BASE_URL}/debug/cache/delta${query ? `?${query}` : ""}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch cache delta (${response.status})`);
  }

  return (await response.json()) as CacheDeltaResponse;
}

export async function fetchStartupMetrics(): Promise<StartupMetricsResponse> {
  const response = await fetch(`${API_BASE_URL}/debug/startup`);
  if (!response.ok) {
    throw new Error(`Failed to fetch startup metrics (${response.status})`);
  }

  const data = await response.json();
  const events: StartupEventMetric[] = Array.isArray(data?.events)
    ? data.events.map((event: any) => ({
      name: event?.name ?? "event",
      startedAt: event?.started_at ?? null,
      completedAt: event?.completed_at ?? null,
      durationSeconds: event?.duration_seconds ?? null,
      detail: event?.detail ?? null,
      metadata: event?.metadata ?? {},
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
  const { useCache = true, category, onProgress, onSourceComplete, onError, signal } = options;

  logger.debug(`Starting news stream with useCache=${useCache} and category=${category}`);

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
          `Stream request failed with status ${response.status}: ${response.statusText}`
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
            `Stream ${streamId} stalled after cache load - auto-completing`
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
                } catch (e) {
                  console.warn(
                    "[streamNews] First JSON.parse failed, attempting to re-parse"
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
                        `Stream ${streamId} INITIAL data: ${mappedArticles.length} articles (cache age: ${cacheAge}s)`
                      );

                      // Process articles in batches to avoid UI freeze
                      (async () => {
                        for (
                          let i = 0;
                          i < mappedArticles.length;
                          i += BATCH_SIZE
                        ) {
                          const batch = mappedArticles.slice(
                            i,
                            i + BATCH_SIZE
                          );
                          articles.push(...batch);
                          batch.forEach((article) =>
                            sources.add(article.source)
                          );

                          // Notify about this batch immediately
                          if (onSourceComplete) {
                            onSourceComplete(
                              `initial-batch-${Math.floor(i / BATCH_SIZE)}`,
                              batch
                            );
                          }

                          // Yield to the event loop to prevent blocking
                          if (i + BATCH_SIZE < mappedArticles.length) {
                            await new Promise((resolve) =>
                              setTimeout(resolve, 0)
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
                        data
                      );
                    }
                    break;

                  case "starting":
                    logger.debug(`Stream ${streamId} starting: ${data.message}`);
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
                        `Stream ${streamId} cache data: ${mappedArticles.length} articles (cache age: ${cacheAge}s, fresh: ${cacheAge < 120})`
                      );

                      // Process articles in batches to avoid UI freeze
                      (async () => {
                        for (
                          let i = 0;
                          i < mappedArticles.length;
                          i += BATCH_SIZE
                        ) {
                          const batch = mappedArticles.slice(
                            i,
                            i + BATCH_SIZE
                          );
                          articles.push(...batch);
                          batch.forEach((article) =>
                            sources.add(article.source)
                          );

                          // Notify about this batch immediately
                          if (onSourceComplete) {
                            onSourceComplete(
                              `cache-batch-${Math.floor(i / BATCH_SIZE)}`,
                              batch
                            );
                          }

                          // Yield to the event loop to prevent blocking
                          if (i + BATCH_SIZE < mappedArticles.length) {
                            await new Promise((resolve) =>
                              setTimeout(resolve, 0)
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
                            `Cache is fresh (${cacheAge}s), waiting for completion or timeout after 5s...`
                          );
                          setTimeout(() => {
                            if (!settled && hasReceivedData) {
                              logger.debug(
                                `Auto-completing stream after fresh cache timeout`
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
                        data
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
                        `Stream ${streamId} source complete: ${data.source} (${mappedArticles.length} articles)`
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
                      `Stream ${streamId} unknown status: ${data.status}`
                    );
                }
              } catch (parseError) {
                console.error(
                  "Error parsing stream event:",
                  parseError,
                  "Raw data:",
                  eventData
                );
                onError?.(
                  `Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`
                );
              }
            }
          }
        } catch (readError: unknown) {
          clearInterval(timeoutInterval);
          clearInterval(stallInterval);

          if (
            readError instanceof Error &&
            readError.name === "AbortError"
          ) {
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
            console.error("� Stream reader error:", readError);
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
      clearInterval(undefined as any); // This will be caught, it's ok

      if (!settled) {
        settled = true;
        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
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

// A simple in-memory cache for API responses
const apiCache = new Map<string, { data: any; timestamp: number }>();

const hashStringToInt = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

// Helper function to map backend articles to frontend format
function mapBackendArticles(backendArticles: any[]): NewsArticle[] {
  logger.debug(`[mapBackendArticles] Mapping ${backendArticles.length} articles from backend format to frontend format.`);
  return backendArticles.map((article: any) => {
    const sourceName = article.source || article.source_name || 'Unknown';

    const summary = article.summary || article.description || '';
    const content = article.content || summary;
    const rawImage = article.image || article.image_url;
    const image = (rawImage && rawImage !== "none") ? rawImage : "/placeholder.svg";
    const published = article.published_at || article.publishedAt || article.published || new Date().toISOString();
    const category = article.category || 'general';
    const rawUrl = article.url || article.link || article.article_url || article.original_url || '';
    const stableKey = rawUrl || `${sourceName}|${article.title || ''}|${published}`;
    const resolvedId = typeof article.id === 'number'
      ? article.id
      : typeof article.article_id === 'number'
        ? article.article_id
        : hashStringToInt(stableKey);
    const url = rawUrl;
    const author = article.author
      || (Array.isArray(article.authors) ? article.authors[0] : undefined);

    const country = article.country || getCountryFromSource(sourceName);
    const credibilityValue = typeof article.credibility === 'string' ? article.credibility.toLowerCase() : undefined;
    const biasValue = typeof article.bias === 'string' ? article.bias.toLowerCase() : undefined;

    const credibility = credibilityValue && ['high', 'medium', 'low'].includes(credibilityValue)
      ? (credibilityValue as 'high' | 'medium' | 'low')
      : getCredibilityFromSource(sourceName);

    const bias = biasValue && ['left', 'center', 'right'].includes(biasValue)
      ? (biasValue as 'left' | 'center' | 'right')
      : getBiasFromSource(sourceName);

    const mappedArticle: NewsArticle = {
      id: resolvedId,
      title: article.title || 'No title',
      source: sourceName,
      sourceId: sourceName.toLowerCase().replace(/\s+/g, '-'),
      country,
      credibility,
      bias,
      summary: summary || 'No description',
      content,
      image,
      publishedAt: published,
      category,
      url,
      tags: [category, sourceName].filter(Boolean),
      originalLanguage: article.original_language || 'en',
      translated: article.translated ?? false,
      author: author || undefined
    };

    return mappedArticle;
  });
}

// Helper function to remove duplicate articles
function removeDuplicateArticles(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  return articles.filter(article => {
    const key = `${article.title}-${article.source}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Add debug endpoint for stream status
export async function fetchStreamStatus(): Promise<any> {
  try {
    const response = await fetch(`${API_BASE_URL}/debug/streams`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug('Stream status:', data);
    return data;
  } catch (error) {
    console.error('Failed to fetch stream status:', error);
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
    componentStats: Record<string, {
      count: number;
      avgDurationMs: number;
      maxDurationMs: number;
      errorCount: number;
    }>;
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
  payload: FrontendDebugReportPayload
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/debug/logs/frontend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send frontend debug report:', error);
  }
}

// Article Analysis Types
export interface FactCheckResult {
  claim: string;
  verification_status: 'verified' | 'partially-verified' | 'unverified' | 'false';
  evidence: string;
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
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
    grounding_supports?: any[];
    web_search_queries?: string[];
  };
  summary?: string;
  error?: string;
}

// Analyze article with AI
export async function analyzeArticle(url: string, sourceName?: string): Promise<ArticleAnalysis> {
  try {
    logger.debug(`Analyzing article: ${url}`);
    const response = await fetch(`${API_BASE_URL}/api/article/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        source_name: sourceName
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug('Article analysis complete:', data);
    return data;
  } catch (error) {
    console.error('Failed to analyze article:', error);
    throw error;
  }
}

// News Research Agent Types
export interface ThinkingStep {
  type: 'thought' | 'action' | 'tool_start' | 'observation' | 'answer';
  content: string;
  timestamp: string;
}

export interface NewsResearchResponse {
  success: boolean;
  query: string;
  answer: string;
  thinking_steps: ThinkingStep[];
  articles_searched: number;
  referenced_articles?: any[];  // Full article objects from backend
  error?: string;
}

// Perform news research using the AI agent
export async function performNewsResearch(
  query: string,
  includeThinking: boolean = true
): Promise<NewsResearchResponse> {
  try {
    logger.debug(`Performing news research: ${query}`);
    const response = await fetch(`${API_BASE_URL}/api/news/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        include_thinking: includeThinking
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug('News research complete:', data);
    return data;
  } catch (error) {
    console.error('Failed to perform news research:', error);
    throw error;
  }
}

// Agentic search (LangChain backend agent)
export interface AgenticSearchRequest {
  query: string
  max_steps?: number
}

export interface AgenticSearchResponse {
  success: boolean
  answer: string
  reasoning?: any[]
  citations?: any[]
}

export async function performAgenticSearch(query: string, maxSteps: number = 8): Promise<AgenticSearchResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/search/agentic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_steps: maxSteps })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return data as AgenticSearchResponse
  } catch (error) {
    console.error('Agentic search failed:', error)
    throw error
  }
}

// Reading Queue API functions
export interface ReadingQueueItem {
  id?: number
  user_id?: number
  article_id: number
  article_title: string
  article_url: string
  article_source: string
  article_image?: string
  queue_type: 'daily' | 'permanent'
  position: number
  read_status: 'unread' | 'reading' | 'completed'
  added_at: string
  archived_at?: string
  created_at?: string
  updated_at?: string
}

export interface QueueResponse {
  items: ReadingQueueItem[]
  daily_count: number
  permanent_count: number
  total_count: number
}

export async function addToReadingQueue(
  article: NewsArticle,
  queueType: 'daily' | 'permanent' = 'daily'
): Promise<ReadingQueueItem> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: article.id,
        article_title: article.title,
        article_url: article.url,
        article_source: article.source,
        article_image: article.image,
        queue_type: queueType,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Article added to reading queue:', data)
    return data
  } catch (error) {
    console.error('Failed to add article to reading queue:', error)
    throw error
  }
}

export async function removeFromReadingQueue(queueItemId: number): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/${queueItemId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    logger.debug('Article removed from reading queue')
  } catch (error) {
    console.error('Failed to remove article from reading queue:', error)
    throw error
  }
}

export async function removeFromReadingQueueByUrl(
  articleUrl: string
): Promise<void> {
  try {
    const encodedUrl = encodeURIComponent(articleUrl)
    const response = await fetch(
      `${API_BASE_URL}/api/queue/url/${encodedUrl}`,
      { method: 'DELETE' }
    )

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    logger.debug('Article removed from reading queue by URL')
  } catch (error) {
    console.error('Failed to remove article from reading queue:', error)
    throw error
  }
}

export async function getReadingQueue(): Promise<QueueResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Reading queue retrieved:', data)
    return data
  } catch (error) {
    console.error('Failed to fetch reading queue:', error)
    throw error
  }
}

export interface UpdateQueueItemRequest {
  read_status?: 'unread' | 'reading' | 'completed'
  queue_type?: 'daily' | 'permanent'
  position?: number
  archived_at?: string
}

export async function updateReadingQueueItem(
  queueItemId: number,
  updates: UpdateQueueItemRequest
): Promise<ReadingQueueItem> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/${queueItemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Queue item updated:', data)
    return data
  } catch (error) {
    console.error('Failed to update queue item:', error)
    throw error
  }
}

export interface QueueOverview {
  total_items: number
  daily_items: number
  permanent_items: number
  unread_count: number
  reading_count: number
  completed_count: number
  estimated_total_read_time_minutes: number
}

export async function getQueueOverview(): Promise<QueueOverview> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/overview`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Queue overview retrieved:', data)
    return data
  } catch (error) {
    console.error('Failed to fetch queue overview:', error)
    throw error
  }
}

// Highlights API
export interface Highlight {
  id?: number
  user_id?: number
  article_url: string
  highlighted_text: string
  color: 'yellow' | 'blue' | 'red' | 'green' | 'purple'
  note?: string
  character_start: number
  character_end: number
  created_at?: string
  updated_at?: string
}

export async function createHighlight(highlight: Highlight): Promise<Highlight> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/highlights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(highlight),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Highlight created:', data)
    return data
  } catch (error) {
    console.error('Failed to create highlight:', error)
    throw error
  }
}

export async function getHighlightsForArticle(
  articleUrl: string
): Promise<Highlight[]> {
  try {
    const encodedUrl = encodeURIComponent(articleUrl)
    const url = `${API_BASE_URL}/api/queue/highlights/article/${encodedUrl}`

    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`[Highlights] GET ${url}`)
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Highlights retrieved:', data)
    return data
  } catch (error) {
    console.error('Failed to fetch highlights:', error)
    throw error
  }
}

export async function getAllHighlights(): Promise<Highlight[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/highlights`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('All highlights retrieved:', data)
    return data
  } catch (error) {
    console.error('Failed to fetch highlights:', error)
    throw error
  }
}

export async function updateHighlight(
  highlightId: number,
  updates: Partial<Highlight>
): Promise<Highlight> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/highlights/${highlightId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Highlight updated:', data)
    return data
  } catch (error) {
    console.error('Failed to update highlight:', error)
    throw error
  }
}

export async function deleteHighlight(highlightId: number): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/highlights/${highlightId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    logger.debug('Highlight deleted')
  } catch (error) {
    console.error('Failed to delete highlight:', error)
    throw error
  }
}

// --- Reading Queue Content & Digest ---

export interface QueueItemContent {
  id: number
  article_url: string
  article_title: string
  article_source: string
  full_text: string
  word_count?: number
  estimated_read_time_minutes?: number
  read_status: string
}

export interface QueueDigest {
  digest_items: ReadingQueueItem[]
  total_items: number
  estimated_read_time_minutes: number
  generated_at: string
}

export async function getQueueItemContent(queueId: number): Promise<QueueItemContent> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/${queueId}/content`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Queue item content retrieved:', data)
    return data
  } catch (error) {
    console.error('Failed to fetch queue item content:', error)
    throw error
  }
}

export async function getDailyDigest(): Promise<QueueDigest> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/queue/digest/daily`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('Daily digest retrieved:', data)
    return data
  } catch (error) {
    console.error('Failed to fetch daily digest:', error)
    throw error
  }
}

// --- Pagination Types ---

export interface PaginatedResponse {
  articles: NewsArticle[];
  total: number;
  limit: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more: boolean;
}

export interface PaginationParams {
  limit?: number;
  cursor?: string;
  category?: string;
  source?: string;
  sources?: string;  // Comma-separated source names for multi-select
  search?: string;
}

// --- Paginated Fetch Functions ---

export async function fetchNewsPaginated(
  params: PaginationParams = {}
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
  params: PaginationParams & { offset?: number } = {}
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

// --- Country/Globe API Functions ---

export interface CountryArticleCounts {
  counts: Record<string, number>;
  total_articles: number;
  articles_with_country: number;
  articles_without_country: number;
  country_count: number;
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

export interface LocalLensResponse {
  country_code: string;
  view: "internal" | "external";
  view_description: string;
  total: number;
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  articles: NewsArticle[];
}

/**
 * Get article counts grouped by country for globe heatmap
 */
export async function fetchArticleCountsByCountry(): Promise<CountryArticleCounts> {
  const response = await fetch(`${API_BASE_URL}/news/by-country`);
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

/**
 * Local Lens: Get news for a specific country
 * @param code ISO country code
 * @param view "internal" (from country) or "external" (about country)
 */
export async function fetchNewsForCountry(
  code: string,
  view: "internal" | "external" = "internal",
  limit: number = 50,
  offset: number = 0
): Promise<LocalLensResponse> {
  const params = new URLSearchParams({
    view,
    limit: limit.toString(),
    offset: offset.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/news/country/${code}?${params}`);
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
  career_history?: Array<{ organization?: string; role?: string; source?: string }>;
  topics?: string[];
  political_leaning?: string;
  leaning_confidence?: string;
  twitter_handle?: string;
  linkedin_url?: string;
  wikipedia_url?: string;
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
  website?: string;
  fetched_at?: string;
  cached?: boolean;
  fields: Record<string, SourceResearchValue[]>;
  key_reporters?: SourceReporterSummary[];
}

/**
 * Profile a reporter/journalist
 */
export async function profileReporter(
  name: string,
  organization?: string,
  articleContext?: string,
  forceRefresh: boolean = false
): Promise<ReporterProfile> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  const response = await fetch(`${API_BASE_URL}/research/entity/reporter/profile${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      organization,
      article_context: articleContext,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a cached reporter by ID
 */
export async function getReporter(reporterId: number): Promise<ReporterProfile> {
  const response = await fetch(`${API_BASE_URL}/research/entity/reporter/${reporterId}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * List all cached reporters
 */
export async function listReporters(limit: number = 50, offset: number = 0): Promise<ReporterProfile[]> {
  const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
  const response = await fetch(`${API_BASE_URL}/research/entity/reporters?${params}`);
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
  forceRefresh: boolean = false
): Promise<OrganizationProfile> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  const response = await fetch(`${API_BASE_URL}/research/entity/organization/research${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, website }),
  });

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
  forceRefresh: boolean = false
): Promise<SourceResearchProfile> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  const response = await fetch(`${API_BASE_URL}/research/entity/source/profile${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, website }),
  });

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
  website?: string
): Promise<SourceResearchProfile | null> {
  const response = await fetch(`${API_BASE_URL}/research/entity/source/profile?cache_only=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, website }),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a cached organization by ID
 */
export async function getOrganization(orgId: number): Promise<OrganizationProfile> {
  const response = await fetch(`${API_BASE_URL}/research/entity/organization/${orgId}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Get ownership chain for an organization
 */
export async function getOwnershipChain(orgName: string, maxDepth: number = 5): Promise<OwnershipChain> {
  const params = new URLSearchParams({ max_depth: maxDepth.toString() });
  const response = await fetch(
    `${API_BASE_URL}/research/entity/organization/${encodeURIComponent(orgName)}/ownership-chain?${params}`
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * List all cached organizations
 */
export async function listOrganizations(limit: number = 50, offset: number = 0): Promise<OrganizationProfile[]> {
  const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
  const response = await fetch(`${API_BASE_URL}/research/entity/organizations?${params}`);
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

export interface MaterialContext {
  source: string;
  source_country: string;
  mentioned_countries: string[];
  trade_relationships: TradeRelationship[];
  known_interests: Record<string, any>;
  potential_conflicts: string[];
  analysis_summary?: string;
  reader_warnings?: string[];
  confidence?: string;
  analyzed_at?: string;
}

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
  articleText?: string
): Promise<MaterialContext> {
  const response = await fetch(`${API_BASE_URL}/research/entity/material-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source,
      source_country: sourceCountry,
      mentioned_countries: mentionedCountries,
      topics,
      article_text: articleText,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Get economic profile for a country
 */
export async function getCountryEconomicProfile(countryCode: string): Promise<CountryEconomicProfile> {
  const response = await fetch(`${API_BASE_URL}/research/entity/country/${countryCode}/economic-profile`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// ============================================
// Phase 6: Trending & Breaking News Detection
// ============================================

export interface TrendingArticle {
  id: number;
  title: string;
  source: string;
  url: string;
  image_url?: string;
  published_at?: string;
  summary?: string;
}

export interface TrendingCluster {
  cluster_id: number;
  label?: string;
  keywords: string[];
  article_count: number;
  window_count: number;
  source_diversity: number;
  trending_score: number;
  velocity: number;
  representative_article?: TrendingArticle;
  articles?: TrendingArticle[];
}

export interface BreakingCluster {
  cluster_id: number;
  label?: string;
  keywords: string[];
  article_count_3h: number;
  source_count_3h: number;
  spike_magnitude: number;
  is_new_story: boolean;
  representative_article?: TrendingArticle;
  articles?: TrendingArticle[];
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
  label?: string;
  keywords: string[];
  article_count: number;
  first_seen?: string;
  last_seen?: string;
  is_active: boolean;
  articles: Array<{
    id: number;
    title: string;
    source: string;
    url: string;
    image_url?: string;
    published_at?: string;
    similarity: number;
  }>;
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
  label?: string;
  keywords: string[];
  article_count: number;
  window_count: number;
  source_diversity: number;
  representative_article?: TrendingArticle;
  articles?: TrendingArticle[];
}

export interface AllClustersResponse {
  window: string;
  clusters: AllCluster[];
  total: number;
}

/**
 * Get trending topic clusters
 * @param window Time window: "1d", "1w", or "1m"
 * @param limit Max clusters to return
 */
export async function fetchTrending(
  window: "1d" | "1w" | "1m" = "1d",
  limit: number = 10
): Promise<TrendingResponse> {
  const params = new URLSearchParams({
    window,
    limit: limit.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/trending?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Get breaking news clusters (3-hour spike detection)
 * @param limit Max clusters to return
 */
export async function fetchBreaking(limit: number = 5): Promise<BreakingResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/trending/breaking?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Get all clusters for topic-based view
 * @param window Time window: "1d", "1w", or "1m"
 * @param minArticles Minimum articles per cluster
 * @param limit Max clusters to return
 */
export async function fetchAllClusters(
  window: "1d" | "1w" | "1m" = "1d",
  minArticles: number = 2,
  limit: number = 100
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
  return response.json();
}

/**
 * Get detailed info about a specific topic cluster
 */
export async function fetchClusterDetail(clusterId: number): Promise<ClusterDetail> {
  const response = await fetch(`${API_BASE_URL}/trending/clusters/${clusterId}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch all articles for a cluster and transform to NewsArticle format
 * Used by topic view expansion
 */
export async function fetchClusterArticles(clusterId: number): Promise<NewsArticle[]> {
  const detail = await fetchClusterDetail(clusterId);
  
  return detail.articles.map((article) => ({
    id: article.id,
    title: article.title,
    source: article.source,
    sourceId: article.source.toLowerCase().replace(/\s+/g, "-"),
    country: "US",
    credibility: "medium" as const,
    bias: "center" as const,
    summary: "",
    image: article.image_url || "",
    publishedAt: article.published_at || new Date().toISOString(),
    category: "news",
    url: article.url,
    tags: [],
    originalLanguage: "en",
    translated: false,
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
  return response.json();
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
  limit: number = 50
): Promise<GdeltArticleEventsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await fetch(
    `${API_BASE_URL}/gdelt/article/${articleId}?${params}`
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function fetchGdeltStats(
  hours: number = 24
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
 * @param articleId The article to find similar articles for
 * @param limit Max number of related articles to return
 * @param excludeSameSource Whether to exclude articles from the same source
 */
export async function fetchRelatedArticles(
  articleId: number,
  limit: number = 5,
  excludeSameSource: boolean = true
): Promise<RelatedArticlesResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    exclude_same_source: excludeSameSource.toString(),
  });

  const response = await fetch(
    `${API_BASE_URL}/api/similarity/related/${articleId}?${params}`
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
 * @param query The search query to get suggestions for
 * @param limit Max number of suggestions
 */
export async function fetchSearchSuggestions(
  query: string,
  limit: number = 5
): Promise<SearchSuggestionsResponse> {
  const params = new URLSearchParams({
    query,
    limit: limit.toString(),
  });

  const response = await fetch(
    `${API_BASE_URL}/api/similarity/search-suggestions?${params}`
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
 * @param sourceIds Array of source IDs to compare
 * @param sampleSize Number of articles to sample per source
 */
export async function fetchSourceCoverage(
  sourceIds: string[],
  sampleSize: number = 100
): Promise<SourceCoverageResponse> {
  const params = new URLSearchParams({
    source_ids: sourceIds.join(","),
    sample_size: sampleSize.toString(),
  });

  const response = await fetch(
    `${API_BASE_URL}/api/similarity/source-coverage?${params}`
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
 * @param articleId The article to score
 * @param readingHistory Array of article IDs the user has read
 */
export async function fetchNoveltyScore(
  articleId: number,
  readingHistory: number[]
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
  articles: Record<number, Array<{ cluster_id: number; label: string; similarity: number | null }>>;
}

/**
 * Get topic/cluster assignments for an article
 * @param articleId The article to get topics for
 */
export async function fetchArticleTopics(
  articleId: number
): Promise<ArticleTopicsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/similarity/article-topics/${articleId}`
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
 * @param articleIds Array of article IDs
 */
export async function fetchBulkArticleTopics(
  articleIds: number[]
): Promise<BulkArticleTopicsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/similarity/bulk-article-topics`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(articleIds),
    }
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
 * @param url The URL of the article
 */
// ============================================================================
// Media Accountability Wiki API
// ============================================================================

export interface WikiFilterScore {
  filter_name: string;
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
  filter_scores?: Record<string, number>;
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
  filter_scores: WikiFilterScore[];
  reporters: Array<Record<string, unknown>>;
  organization?: Record<string, unknown>;
  ownership_chain: Array<Record<string, unknown>>;
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
  research_confidence?: string;
}

export interface WikiReporterDossier extends WikiReporterCard {
  career_history?: Array<{ organization?: string; role?: string; source?: string }>;
  education?: Array<Record<string, unknown>>;
  leaning_sources?: string[];
  twitter_handle?: string;
  linkedin_url?: string;
  source_patterns?: Record<string, unknown>;
  topics_avoided?: Record<string, unknown>;
  advertiser_alignment?: Record<string, unknown>;
  revolving_door?: Record<string, unknown>;
  controversies?: Array<Record<string, unknown>>;
  institutional_affiliations?: Array<Record<string, unknown>>;
  coverage_comparison?: Record<string, unknown>;
  last_article_at?: string;
  recent_articles: Array<Record<string, unknown>>;
  research_sources?: string[];
}

export interface WikiOwnershipGraph {
  nodes: Array<{ id: string; label: string; type?: string; bias?: string; [key: string]: unknown }>;
  edges: Array<{ source: string; target: string; relationship?: string; [key: string]: unknown }>;
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
export async function fetchWikiSources(params: WikiSourcesParams = {}): Promise<WikiSourceCard[]> {
  const query = new URLSearchParams();
  if (params.country) query.set("country", params.country);
  if (params.bias) query.set("bias", params.bias);
  if (params.funding) query.set("funding", params.funding);
  if (params.search) query.set("search", params.search);
  if (params.sort) query.set("sort", params.sort);
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.offset) query.set("offset", params.offset.toString());

  const qs = query.toString();
  const response = await fetch(`${API_BASE_URL}/api/wiki/sources${qs ? `?${qs}` : ""}`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch the full wiki profile for a single source
 */
export async function fetchWikiSource(sourceName: string): Promise<WikiSourceProfile> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/sources/${encodeURIComponent(sourceName)}`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch propaganda filter scores for a source
 */
export async function fetchWikiSourceFilters(sourceName: string): Promise<WikiFilterScore[]> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/sources/${encodeURIComponent(sourceName)}/filters`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch reporters associated with a source
 */
export async function fetchWikiSourceReporters(sourceName: string): Promise<WikiReporterCard[]> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/sources/${encodeURIComponent(sourceName)}/reporters`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch the wiki reporter directory
 */
export async function fetchWikiReporters(params: {
  search?: string;
  outlet?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<WikiReporterCard[]> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.outlet) query.set("source", params.outlet);
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.offset) query.set("offset", params.offset.toString());

  const qs = query.toString();
  const response = await fetch(`${API_BASE_URL}/api/wiki/reporters${qs ? `?${qs}` : ""}`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch a full reporter dossier
 */
export async function fetchWikiReporter(reporterId: number): Promise<WikiReporterDossier> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/reporters/${reporterId}`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

/**
 * Fetch articles by a reporter (returns simplified article objects)
 */
export async function fetchWikiReporterArticles(reporterId: number): Promise<Array<{
  id: number;
  title: string;
  source: string;
  published_at?: string;
  url: string;
  category?: string;
  image_url?: string;
}>> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/reporters/${reporterId}/articles`);
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
export async function triggerWikiIndex(sourceName: string): Promise<{ status: string; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/index/${encodeURIComponent(sourceName)}`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

export async function fetchOGImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/image/og?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.image_url || null;
  } catch (error) {
    console.error("Failed to fetch OG image:", error);
    return null;
  }
}
