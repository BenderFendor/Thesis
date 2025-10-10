// API utility for communicating with FastAPI backend

// Default to localhost backend when env var is not set (makes dev easier)
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const DOCKER_API_BASE_URL = process.env.NEXT_PUBLIC_DOCKER_API_URL || API_BASE_URL
// Use DOCKER_API_BASE_URL when running in Docker
// This allows the frontend to reach the backend when both are in Docker containers
// Which uses 8001 instead of 8000 to avoid conflict with Next.js dev server
// (In production, both frontend and backend would be served from the same origin)

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
  status: 'starting' | 'cache_data' | 'source_complete' | 'source_error' | 'complete' | 'error';
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
      id: source.name.toLowerCase(),
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
    const response = await fetch(`${API_BASE_URL}/sources/stats`);
    
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


export async function refreshCache(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/cache/refresh`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.error('Failed to refresh cache:', error);
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

export interface SourceDebugData {
  source_name: string;
  source_config: any;
  rss_url: string;
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
  source_statistics: any;
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
  const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const params = new URLSearchParams({
    use_cache: String(useCache),
  });
  if (category) {
    params.append('category', category);
  }
  const sseUrl = `${baseUrl}/news/stream?${params.toString()}`;
  
  const promise = new Promise<{
    articles: NewsArticle[];
    sources: string[];
    streamId?: string;
    errors: string[];
  }>((resolve, reject) => {
    const articles: NewsArticle[] = [];
    const sources = new Set<string>();
    const errors: string[] = [];
    let streamId: string | undefined;
    let hasReceivedData = false;
    let settled = false;
    
    console.log(`🔗 Connecting to unified stream endpoint: ${sseUrl}`);
    
    const eventSource = new EventSource(sseUrl);
    let timeoutId: NodeJS.Timeout;
    
    // Set timeout to prevent hanging
    const startTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        console.error('🚨 Stream timeout - closing connection');
        eventSource.close();
        if (!hasReceivedData) {
          reject(new Error('Stream timeout - no data received'));
        } else {
          resolve({
            articles,
            sources: Array.from(sources),
            streamId,
            errors: [...errors, 'Stream timeout']
          });
        }
      }, 120000); // 2 minutes timeout
    };
    
    startTimeout();
    
    // Allow external abort to close SSE and resolve with partial data
    const handleAbort = () => {
      if (settled) return;
      console.warn('🧹 Streaming aborted by signal. Closing SSE.');
      try { clearTimeout(timeoutId); } catch {}
      try { eventSource.close(); } catch {}
      settled = true;
      resolve({
        articles: removeDuplicateArticles(articles),
        sources: Array.from(sources),
        streamId,
        errors: [...errors, 'aborted']
      });
    };
    if (signal) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener('abort', handleAbort, { once: true });
    }
    
    eventSource.onopen = () => {
      console.log('✅ SSE connection opened');
    };
    
    eventSource.onmessage = (event: MessageEvent) => {
      try {
        console.log(`[streamNews] Raw SSE event data:`, event.data);
        
        let data: StreamEvent;
        try {
          // First attempt to parse, assuming it's a clean JSON object string
          data = JSON.parse(event.data);
        } catch (e) {
          // If it fails, it might be a string-encoded JSON (e.g. '"{\\"status\\":...}"')
          console.warn(`[streamNews] First JSON.parse failed, attempting to re-parse as string-encoded JSON.`);
          data = JSON.parse(JSON.parse(`"${event.data}"`));
        }

        console.log(`📬 Stream event [${data.status}]:`, {
          streamId: data.stream_id,
          source: data.source,
          articlesCount: data.articles?.length,
          progress: data.progress,
          message: data.message
        });
        
        // Update stream ID
        if (data.stream_id && !streamId) {
          streamId = data.stream_id;
        }
        
        // Reset timeout on each message
        startTimeout();
        
        switch (data.status) {
          case 'starting':
            console.log(`🚀 Stream ${streamId} starting: ${data.message}`);
            onProgress?.({
              completed: 0,
              total: 0,
              percentage: 0,
              message: data.message
            });
            break;
            
          case 'cache_data':
            hasReceivedData = true;
            if (data.articles && Array.isArray(data.articles)) {
              const mappedArticles = mapBackendArticles(data.articles);
              articles.push(...mappedArticles);
              mappedArticles.forEach(article => sources.add(article.source));
              
              console.log(`💾 Stream ${streamId} cache data: ${mappedArticles.length} articles (cache age: ${data.cache_age_seconds}s)`);
              
              // Immediately notify about the cached articles
              if (onSourceComplete) {
                // We can use a special source name for cached data
                onSourceComplete('cache', mappedArticles);
              }

              onProgress?.({
                completed: sources.size, // Or some other logic for progress
                total: sources.size, // Unsure of total at this point
                percentage: 0, // Or calculate based on expected sources
                message: `Loaded ${mappedArticles.length} cached articles`
              });
            } else {
                console.warn(`[streamNews] 'cache_data' event received but 'articles' is not an array or is missing.`, data);
            }
            break;
            
          case 'source_complete':
            hasReceivedData = true;
            if (data.articles && data.source) {
              const mappedArticles = mapBackendArticles(data.articles);
              articles.push(...mappedArticles);
              sources.add(data.source);
              
              console.log(`✅ Stream ${streamId} source complete: ${data.source} (${mappedArticles.length} articles)`);
              
              onSourceComplete?.(data.source, mappedArticles);
              
              if (data.progress) {
                onProgress?.(data.progress);
              }
            }
            break;
            
          case 'source_error':
            const errorMsg = `Error loading ${data.source}: ${data.error}`;
            console.warn(`❌ Stream ${streamId} source error:`, errorMsg);
            errors.push(errorMsg);
            onError?.(errorMsg);
            
            if (data.progress) {
              onProgress?.(data.progress);
            }
            break;
            
          case 'complete':
            console.log(`🏁 Stream ${streamId} complete:`, {
              totalArticles: data.total_articles,
              successfulSources: data.successful_sources,
              failedSources: data.failed_sources,
              message: data.message
            });
            
            clearTimeout(timeoutId);
            eventSource.close();
            
            if (!settled) {
              settled = true;
              resolve({
                articles: removeDuplicateArticles(articles),
                sources: Array.from(sources),
                streamId,
                errors
              });
            }
            break;
            
          case 'error':
            console.error(`💥 Stream ${streamId} error:`, data.error);
            clearTimeout(timeoutId);
            eventSource.close();
            
            if (hasReceivedData) {
              // Return partial data if we got some
              if (!settled) {
                settled = true;
                resolve({
                  articles: removeDuplicateArticles(articles),
                  sources: Array.from(sources),
                  streamId,
                  errors: [...errors, data.error || 'Stream error']
                });
              }
            } else {
              if (!settled) {
                settled = true;
                reject(new Error(data.error || 'Stream error'));
              }
            }
            break;
            
          default:
            console.log(`❓ Stream ${streamId} unknown status: ${data.status}`);
        }
        
      } catch (error) {
        console.error('🚨 Error parsing stream event:', error, 'Raw data:', event.data);
        onError?.(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    
    eventSource.onerror = (error: Event) => {
      console.error('🚨 SSE connection error:', error);
      clearTimeout(timeoutId);
      eventSource.close();
      
      const errorMsg = 'Stream connection error';
      
      if (hasReceivedData) {
        // Return partial data if we got some
        if (!settled) {
          settled = true;
          resolve({
            articles: removeDuplicateArticles(articles),
            sources: Array.from(sources),
            streamId,
            errors: [...errors, errorMsg]
          });
        }
      } else {
        if (!settled) {
          settled = true;
          reject(new Error(errorMsg));
        }
      }
    };
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
