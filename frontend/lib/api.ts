// API utility for communicating with FastAPI backend

// Default to localhost backend when env var is not set (makes dev easier)
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const DOCKER_API_BASE_URL = process.env.NEXT_PUBLIC_DOCKER_API_URL || API_BASE_URL

// Use DOCKER_API_BASE_URL when running in Docker
// This allows the frontend to reach the backend when both are in Docker containers
// Which uses 8001 instead of 8000 to avoid conflict with Next.js dev server
// (In production, both frontend and backend would be served from the same origin)

// --- Feature Gates ---
export const ENABLE_READER_MODE = process.env.NEXT_PUBLIC_ENABLE_READER_MODE === "true"
export const ENABLE_DIGEST = process.env.NEXT_PUBLIC_ENABLE_DIGEST === "true"
export const ENABLE_HIGHLIGHTS = process.env.NEXT_PUBLIC_ENABLE_HIGHLIGHTS === "true"

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
    console.log(`🔄 Fetching news from unified endpoint: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`📡 Backend response:`, data);
    
    // Backend returns { articles: [...], total: number, sources: [...], stream_id: string }
    let articles = data.articles || [];
    
    if (articles.length === 0) {
      console.log(`⚠️ No articles received from backend. Full response:`, JSON.stringify(data, null, 2));
    } else {
      console.log(`✅ Received ${articles.length} articles from unified backend endpoint`);
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
      console.log(`🔍 Search filter applied: ${beforeFilterCount} → ${articles.length} articles (search: "${params.search}")`);
    }
    
    // Client-side category filtering if needed
    if (params?.category) {
      const beforeFilterCount = articles.length;
      articles = articles.filter((article: NewsArticle) =>
        article.category.toLowerCase() === params.category!.toLowerCase()
      );
      console.log(`🏷️ Category filter applied: ${beforeFilterCount} → ${articles.length} articles (category: "${params.category}")`);
    }
    
    if (articles.length === 0) {
      console.log(`❌ No articles to return after processing. Params:`, params);
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
  const url = `${API_BASE_URL}/debug/source/${encodedSourceName}`;
  console.log(`� Fetching debug data for source: ${url}`);
  try {
    const response = await fetch(url);
    console.log(`📡 Debug response status for source ${sourceName}:`, response.status);
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
    console.log(`✅ Debug data received for ${sourceName}:`, {
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

  console.log(`🎯 Starting news stream with useCache=${useCache} and category=${category}`);

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

    console.log(`🔗 Connecting to unified stream endpoint: ${sseUrl}`);

    try {
      // Create abort controller for fetch
      abortController = new AbortController();

      // Handle external signal abort
      const handleAbort = () => {
        if (abortController && !abortController.signal.aborted) {
          console.warn("🧹 Streaming aborted by external signal");
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

      console.log("✅ Stream connection opened, reading body...");

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
          console.error("🚨 Stream timeout - no data received in 2 minutes");
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
            `⚠️ Stream ${streamId} stalled after cache load - auto-completing`
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
            console.log("📪 Stream reader completed");
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

                console.log(`📬 Stream event [${data.status}]:`, {
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

                      console.log(
                        `⚡ Stream ${streamId} INITIAL data: ${mappedArticles.length} articles (cache age: ${cacheAge}s)`
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
                    console.log(`🚀 Stream ${streamId} starting: ${data.message}`);
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

                      console.log(
                        `💾 Stream ${streamId} cache data: ${mappedArticles.length} articles (cache age: ${cacheAge}s, fresh: ${cacheAge < 120})`
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
                          console.log(
                            `⏰ Cache is fresh (${cacheAge}s), waiting for completion or timeout after 5s...`
                          );
                          setTimeout(() => {
                            if (!settled && hasReceivedData) {
                              console.log(
                                `⏱️ Auto-completing stream after fresh cache timeout`
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

                      console.log(
                        `✅ Stream ${streamId} source complete: ${data.source} (${mappedArticles.length} articles)`
                      );

                      onSourceComplete?.(data.source, mappedArticles);

                      if (data.progress) {
                        onProgress?.(data.progress);
                      }
                    }
                    break;

                  case "source_error":
                    const errorMsg = `Error loading ${data.source}: ${data.error}`;
                    console.warn(`❌ Stream ${streamId} source error:`, errorMsg);
                    errors.push(errorMsg);
                    onError?.(errorMsg);

                    if (data.progress) {
                      onProgress?.(data.progress);
                    }
                    break;

                  case "complete":
                    console.log(`🏁 Stream ${streamId} complete:`, {
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
                    console.error(`💥 Stream ${streamId} error:`, data.error);
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
                    console.log(
                      `❓ Stream ${streamId} unknown status: ${data.status}`
                    );
                }
              } catch (parseError) {
                console.error(
                  "🚨 Error parsing stream event:",
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
            console.warn("🧹 Stream reader aborted");
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
      console.error("🚨 Stream fetch error:", error);
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

// Helper function to map backend articles to frontend format
function mapBackendArticles(backendArticles: any[]): NewsArticle[] {
  console.log(`[mapBackendArticles] Mapping ${backendArticles.length} articles from backend format to frontend format.`);
  return backendArticles.map((article: any, index: number) => {
    const sourceName = article.source || article.source_name || 'Unknown';

    const resolvedId = typeof article.id === 'number'
      ? article.id
      : typeof article.article_id === 'number'
        ? article.article_id
        : Date.now() + index;

    const summary = article.summary || article.description || '';
    const content = article.content || summary;
    const image = article.image || article.image_url || "/placeholder.svg";
    const published = article.published_at || article.publishedAt || article.published || new Date().toISOString();
    const category = article.category || 'general';
    const url = article.url || article.link || '';

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
      translated: article.translated ?? false
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
    console.log('📊 Stream status:', data);
    return data;
  } catch (error) {
    console.error('❌ Failed to fetch stream status:', error);
    return null;
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
    grounding_chunks?: Array<{uri?: string; title?: string}>;
    grounding_supports?: any[];
    web_search_queries?: string[];
  };
  summary?: string;
  error?: string;
}

// Analyze article with AI
export async function analyzeArticle(url: string, sourceName?: string): Promise<ArticleAnalysis> {
  try {
    console.log(`🤖 Analyzing article: ${url}`);
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
    console.log('✅ Article analysis complete:', data);
    return data;
  } catch (error) {
    console.error('❌ Failed to analyze article:', error);
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
    console.log(`🔍 Performing news research: ${query}`);
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
    console.log('✅ News research complete:', data);
    return data;
  } catch (error) {
    console.error('❌ Failed to perform news research:', error);
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
    console.error('❌ Agentic search failed:', error)
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
    console.log('✅ Article added to reading queue:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to add article to reading queue:', error)
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

    console.log('✅ Article removed from reading queue')
  } catch (error) {
    console.error('❌ Failed to remove article from reading queue:', error)
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

    console.log('✅ Article removed from reading queue by URL')
  } catch (error) {
    console.error('❌ Failed to remove article from reading queue:', error)
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
    console.log('✅ Reading queue retrieved:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to fetch reading queue:', error)
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
    console.log('✅ Queue item updated:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to update queue item:', error)
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
    console.log('✅ Queue overview retrieved:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to fetch queue overview:', error)
    throw error
  }
}

// Highlights API
export interface Highlight {
  id?: number
  user_id?: number
  article_url: string
  highlighted_text: string
  color: 'yellow' | 'blue' | 'red'
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
    console.log('✅ Highlight created:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to create highlight:', error)
    throw error
  }
}

export async function getHighlightsForArticle(
  articleUrl: string
): Promise<Highlight[]> {
  try {
    const encodedUrl = encodeURIComponent(articleUrl)
    const response = await fetch(
      `${API_BASE_URL}/api/queue/highlights/article/${encodedUrl}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    )

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    console.log('✅ Highlights retrieved:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to fetch highlights:', error)
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
    console.log('✅ All highlights retrieved:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to fetch highlights:', error)
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
    console.log('✅ Highlight updated:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to update highlight:', error)
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

    console.log('✅ Highlight deleted')
  } catch (error) {
    console.error('❌ Failed to delete highlight:', error)
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
    console.log('✅ Queue item content retrieved:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to fetch queue item content:', error)
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
    console.log('✅ Daily digest retrieved:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to fetch daily digest:', error)
    throw error
  }
}
