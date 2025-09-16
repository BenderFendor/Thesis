// API utility for communicating with FastAPI backend

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'; // The port should match the backend server port

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
  likes: number
  comments: number
  shares: number
  tags: string[]
  originalLanguage: string
  translated: boolean
}

// API functions
export async function fetchNews(params?: {
  limit?: number;
  category?: string;
  search?: string;
}): Promise<NewsArticle[]> {
  try {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.category) searchParams.append('category', params.category);
    // Note: backend doesn't support search yet, so we'll filter client-side
    
    const url = `${API_BASE_URL}/news${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
    console.log(`🔄 Fetching news from: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`📡 Backend response:`, data);
    
    // Backend returns { articles: [...], total: number, sources: [...] }
    let articles = data.articles || [];
    
    if (articles.length === 0) {
      console.log(`⚠️ No articles received from backend. Full response:`, JSON.stringify(data, null, 2));
    } else {
      console.log(`✅ Received ${articles.length} articles from backend`);
    }
    
    // Convert backend format to frontend format
    articles = articles.map((article: any) => ({
      id: Math.random(), // Generate a temporary ID since backend doesn't provide one
      title: article.title,
      source: article.source,
      sourceId: article.source.toLowerCase(),
      country: getCountryFromSource(article.source),
      credibility: getCredibilityFromSource(article.source),
      bias: getBiasFromSource(article.source),
      summary: article.description,
      content: article.description,
      image: article.image || "/placeholder.svg",
      publishedAt: article.published,
      category: article.category,
      url: article.link,
      likes: Math.floor(Math.random() * 100),
      comments: Math.floor(Math.random() * 50),
      shares: Math.floor(Math.random() * 25),
      tags: [article.category, article.source],
      originalLanguage: "en",
      translated: false
    }));
    
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
    
    if (articles.length === 0) {
      console.log(`❌ No articles to return after processing. Params:`, params);
    }
    
    return articles;
  } catch (error) {
    console.error('❌ Failed to fetch news:', error);
    return [];
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
  try {
    const url = `${API_BASE_URL}/news/source/${sourceId}`;
    console.log(`🔄 Fetching news from source: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`📡 Backend response for source ${sourceId}:`, data);
    
    if (!data || data.length === 0) {
      console.log(`⚠️ No articles received from source ${sourceId}. Full response:`, JSON.stringify(data, null, 2));
    } else {
      console.log(`✅ Received ${data.length} articles from source ${sourceId}`);
    }
    
    return data;
  } catch (error) {
    console.error(`❌ Failed to fetch news from source ${sourceId}:`, error);
    return [];
  }
}

export async function fetchNewsByCategory(category: string): Promise<NewsArticle[]> {
  try {
    const url = `${API_BASE_URL}/news/category/${category}`;
    console.log(`🔄 Fetching news by category: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`📡 Backend response for category ${category}:`, data);
    
    // Backend returns { articles: [...], total: number, sources: [...] } for category endpoint
    const articles = data.articles || data;
    
    if (!articles || articles.length === 0) {
      console.log(`⚠️ No articles received for category ${category}. Full response:`, JSON.stringify(data, null, 2));
    } else {
      console.log(`✅ Received ${articles.length} articles for category ${category}`);
    }
    
    return articles;
  } catch (error) {
    console.error(`❌ Failed to fetch news by category ${category}:`, error);
    return [];
  }
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
    
    return await response.json();
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
    cachedArticles = await fetchNews({ limit: 1000 }); // Get more articles for filtering
  }
  return cachedArticles.filter(article => 
    article.country.toLowerCase() === country.toLowerCase()
  );
}

// Initialize data on module load
export async function initializeData() {
  try {
    cachedSources = await fetchSources();
    cachedArticles = await fetchNews({ limit: 100 });
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
  try {
    // Decode the source name first in case it's already URL encoded, then encode it properly
    const decodedSourceName = decodeURIComponent(sourceName);
    const response = await fetch(`${API_BASE_URL}/debug/source/${encodeURIComponent(decodedSourceName)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching source debug data:', error);
    throw error;
  }
}
