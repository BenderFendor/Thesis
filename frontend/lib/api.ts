import type { ArticleCore, SourceCore } from "@/lib/types/core";
import type {
  components as OpenApiComponents,
  paths as OpenApiPaths,
} from "@/lib/generated/openapi";
import { logger } from "@/lib/logger";
import { z } from "zod";



// --- Data Types ---

// Data types



// --- Data Types ---

// Data types

interface NewsSource extends Pick<SourceCore, "id" | "name"> {
  slug: string;
  country: string;
  url: string;
  rssUrl: string;
  credibility: "high" | "medium" | "low";
  bias: "left" | "center" | "right";
  category: string[];
  language: string;
  funding: string[];
  sourceType?: string | null;
  isPaywalled?: boolean;
  credibilityScore?: number;
  factualRating?: string;
}

interface NewsArticle
  extends Pick<ArticleCore, "title" | "source" | "sourceId" | "url" | "publishedAt"> {
  id: number;
  country: string;
  credibility: "high" | "medium" | "low";
  bias: "left" | "center" | "right";
  summary: string;
  content?: string;
  image: string;
  _parsedTimestamp?: number;
  category: string;
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

interface ApiCacheState {
  articles: NewsArticle[];
  sources: NewsSource[];
}

interface BrowseIndexResponse {
  articles: NewsArticle[];
  total: number;
}

type BackendArticle = z.infer<typeof BackendArticleSchema>;

interface ReadonlyBackendArticle {
  readonly article_id?: number;
  readonly article_url?: string;
  readonly author?: string;
  readonly authors?: readonly string[];
  readonly bias?: string;
  readonly category?: string;
  readonly content?: string;
  readonly country?: string;
  readonly credibility?: string;
  readonly description?: string;
  readonly geo_signal?: Readonly<{ readonly id: string; readonly label: string }>;
  readonly id?: number;
  readonly image?: string;
  readonly image_url?: string;
  readonly is_persisted?: boolean;
  readonly link?: string;
  readonly mentioned_countries?: readonly string[];
  readonly original_language?: string;
  readonly original_url?: string;
  readonly published?: string;
  readonly publishedAt?: string;
  readonly published_at?: string;
  readonly source?: string;
  readonly source_country?: string;
  readonly source_id?: string;
  readonly source_name?: string;
  readonly summary?: string;
  readonly title?: string;
  readonly translated?: boolean;
  readonly url?: string;
}

type ReadonlyNewsArticle = Readonly<NewsArticle>;

type ApiJsonValue =
  | string
  | number
  | boolean
  | null
  | ApiJsonValue[]
  | ApiJsonObject;

interface ApiJsonObject {
  readonly [key: string]: ApiJsonValue;
}

interface CountryNameMap {
  readonly [countryName: string]: string;
}

interface ApiOpaqueObject extends Record<string, unknown> {
  readonly __apiOpaqueObject?: never;
}

type StreamProgressHandler = (progress: Readonly<StreamProgress>) => void;

type StreamSourceCompleteHandler = (
  source: string,
  articles: readonly ReadonlyNewsArticle[],
) => void;

type StreamErrorHandler = (error: string) => void;

type StreamResolveHandler = (value: Readonly<StreamResult>) => void;

type StreamRejectHandler = (error: Error) => void;

type StreamEventHandler = (
  data: Readonly<StreamEvent>,
  runtime: Readonly<StreamRuntime>,
) => void;

interface BookmarkEntry {
  bookmarkId: number;
  articleId: number;
  article: NewsArticle;
  createdAt?: string;
}

interface SemanticSearchResult {
  article: NewsArticle;
  similarityScore?: number | null;
  distance?: number | null;
}

interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResult[];
  total: number;
}

// Add streaming interfaces


// Add streaming interfaces
interface StreamOptions {
  readonly useCache?: boolean;
  readonly category?: string;
  readonly onProgress?: StreamProgressHandler;
  readonly onSourceComplete?: StreamSourceCompleteHandler;
  readonly onError?: StreamErrorHandler;
  readonly signal?: Readonly<AbortSignal>;
}

interface StreamProgress {
  readonly completed: number;
  readonly total: number;
  readonly percentage: number;
  readonly currentSource?: string;
  readonly message?: string;
}

interface StreamEvent {
  readonly status:
    | "starting"
    | "initial"
    | "cache_data"
    | "source_complete"
    | "source_error"
    | "complete"
    | "error";
  readonly stream_id?: string;
  readonly message?: string;
  readonly source?: string;
  readonly articles?: readonly ReadonlyBackendArticle[];
  readonly source_stat?: ApiOpaqueObject;
  readonly error?: string;
  readonly progress?: Readonly<StreamProgress>;
  readonly cache_age_seconds?: number;
  readonly total_articles?: number;
  readonly successful_sources?: number;
  readonly failed_sources?: number;
  readonly timestamp?: string;
}

interface FetchNewsParams {
  readonly limit?: number;
  readonly category?: string;
  readonly search?: string;
}

type BackendSource = Readonly<z.infer<typeof BackendSourceSchema>>;

interface SourceStats {
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

interface CacheStatus {
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

interface LlmLogEntry {
  timestamp?: string;
  request_id?: string;
  service?: string;
  model?: string;
  messages?: ApiOpaqueObject[];
  duration_ms?: number;
  success?: boolean;
  finish_reason?: string;
  error_type?: string;
  error_message?: string;
}

interface LlmLogResponse {
  available: boolean;
  path: string;
  returned: number;
  total: number;
  entries: LlmLogEntry[];
  service?: string | null;
  success_filter?: boolean | null;
}

interface DebugErrorEntry {
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

interface DebugErrorsResponse {
  log_file: LlmLogResponse;
  recent_request_stream_errors: DebugErrorEntry[];
  returned_recent_errors: number;
  include_request_stream_events: boolean;
}

interface CacheRefreshProgress {
  readonly source?: string;
  readonly articlesFromSource?: number;
  readonly totalSourcesProcessed?: number;
  readonly failedSources?: number;
  readonly totalArticles?: number;
  readonly successfulSources?: number;
  readonly message?: string;
}

interface CacheRefreshEvent {
  readonly status?: "complete" | "source_complete" | "error";
  readonly source?: string;
  readonly articles_from_source?: number;
  readonly total_sources_processed?: number;
  readonly failed_sources?: number;
  readonly total_articles?: number;
  readonly successful_sources?: number;
  readonly message?: string;
}

interface SemanticSearchOptions {
  readonly limit?: number;
  readonly category?: string;
}

interface LikedEntry {
  likedId: number;
  articleId: number;
  article: NewsArticle;
  createdAt?: string;
}

interface AddRssResponse {
  success: boolean;
  name: string;
  url: string;
  article_count: number;
  status: string;
  promoted?: boolean;
  sample_articles?: {
    title: string;
    url: string;
    source: string;
  }[];
  duplicate_candidates?: {
    name: string;
    url: string;
  }[];
  inferred?: {
    domain?: string;
    source_type?: string | null;
    category?: string;
    country?: string;
    is_paywalled?: boolean;
  };
}

interface SourceDebugData {
  source_name: string;
  source_config: ApiOpaqueObject | null;
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
  parsed_entries: {
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
  }[];
  cached_articles: ApiOpaqueObject[];
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
    sub_feeds?: {
      url: string;
      status: "success" | "warning" | "error";
      article_count: number;
      error?: string;
    }[];
  } | null;
  debug_timestamp: string;
  image_analysis: {
    total_entries: number;
    entries_with_images: number;
    image_sources: unknown[];
  };
  error?: string;
}

interface SourceDebugFallbackOptions {
  bozoException: string;
  error: string;
  httpStatus: number | string;
}

interface ChromaDebugArticle {
  id: string;
  metadata: ApiOpaqueObject;
  preview: string;
}

interface ChromaDebugResponse {
  limit: number;
  offset: number;
  returned: number;
  total?: number;
  articles: ChromaDebugArticle[];
}

interface DatabaseDebugResponse {
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
  articles: {
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
  }[];
}

interface StorageDriftReport {
  database_total_articles: number;
  database_with_embeddings: number;
  database_missing_embeddings: number;
  vector_total_documents: number;
  missing_in_chroma_count: number;
  dangling_in_chroma_count: number;
  missing_in_chroma: {
    id: number;
    chroma_id?: string | null;
    embedding_generated?: boolean | null;
  }[];
  dangling_in_chroma: string[];
}

interface CacheDebugArticle {
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

interface CacheDebugResponse {
  limit: number;
  offset: number;
  source?: string | null;
  total: number;
  returned: number;
  articles: CacheDebugArticle[];
}

interface CacheDeltaResponse {
  cache_total: number;
  cache_sampled: number;
  db_total: number;
  missing_in_db_count: number;
  missing_in_db_sample: string[];
  source?: string | null;
  sample_offset: number;
  sample_limit: number;
}

interface StartupEventMetric {
  name: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  detail?: string | null;
  metadata?: ApiOpaqueObject;
}

interface StartupMetricsResponse {
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  events: StartupEventMetric[];
  notes: ApiOpaqueObject;
}

interface DatabaseDebugParams {
  limit?: number;
  offset?: number;
  source?: string;
  missing_embeddings_only?: boolean;
  sort_direction?: "asc" | "desc";
  published_before?: string;
  published_after?: string;
}

// --- Credibility Engine Types (Plan 35) ---



// --- Credibility Engine Types (Plan 35) ---

interface CredibilityDimension {
  score: number | null
  confidence: number
  explanation: string
  signals_available: number
  signals_missing: number
  provenance: { source: string; url: string; last_updated?: string; provenance_tag?: string }[]
  status: string
  dimension: string
}

interface CredibilityDataQuality {
  dimensions_available: number
  dimensions_total: number
  completeness_pct: number
  last_updated: string | null
}

interface SourceCredibilityProfile {
  domain: string
  dimensions: Record<string, CredibilityDimension>
  data_quality: CredibilityDataQuality
  status: string
}

interface StreamRuntime {
  readonly articles: readonly NewsArticle[];
  readonly sources: ReadonlySet<string>;
  readonly errors: readonly string[];
  readonly streamId: string | undefined;
  readonly hasReceivedData: boolean;
  readonly settled: boolean;
  readonly lastMessageTime: number;
  readonly onProgress?: StreamProgressHandler;
  readonly onSourceComplete?: StreamSourceCompleteHandler;
  readonly onError?: StreamErrorHandler;
  readonly clearTimers: () => void;
  readonly abort: () => void;
  readonly addArticles: (...articles: readonly NewsArticle[]) => void;
  readonly addSource: (source: string) => void;
  readonly addError: (error: string) => void;
  readonly resolve: StreamResolveHandler;
  readonly reject: StreamRejectHandler;
}

interface StreamResult {
  readonly articles: NewsArticle[];
  readonly sources: readonly string[];
  readonly streamId?: string;
  readonly errors: readonly string[];
}

interface BackendArticleMapping {
  sourceName: string;
  summary: string;
  content: string | undefined;
  image: string;
  published: string;
  category: string;
  url: string;
  stableKey: string;
  resolvedId: number;
  isPersisted: boolean;
  author: string | undefined;
  authors: string[];
  country: string;
  sourceCountry: string;
  mentionedCountries: string[];
  credibility: "high" | "medium" | "low";
  bias: "left" | "center" | "right";
  normalizedSourceId: string;
  geoSignal: { id: string; label: string } | undefined;
}

interface FrontendDebugReportPayload {
  session_id: string;
  summary: {
    sessionId: string;
    startTime: string;
    totalEvents: number;
    slowOperationsCount: number;
    errorCount: number;
    streamMetrics: {
      streamId: string;
      eventCount: number;
      startTime: number;
    }[];
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
  recent_events: readonly {
    eventId: string;
    eventType: string;
    timestamp: string;
    component: string;
    operation: string;
    message?: string;
    durationMs?: number;
    details?: ApiOpaqueObject;
    error?: string;
    stackTrace?: string;
    isSlow?: boolean;
    streamId?: string;
    requestId?: string;
  }[];
  slow_operations: readonly {
    eventId: string;
    eventType: string;
    timestamp: string;
    component: string;
    operation: string;
    message?: string;
    durationMs?: number;
    details?: ApiOpaqueObject;
    error?: string;
    stackTrace?: string;
    isSlow?: boolean;
    streamId?: string;
    requestId?: string;
  }[];
  errors: readonly {
    eventId: string;
    eventType: string;
    timestamp: string;
    component: string;
    operation: string;
    message?: string;
    durationMs?: number;
    details?: ApiOpaqueObject;
    error?: string;
    stackTrace?: string;
    isSlow?: boolean;
    streamId?: string;
    requestId?: string;
  }[];
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

// Article Analysis Types


// Article Analysis Types
interface FactCheckResult {
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

interface LanguageDiagnosticExample {
  sentence: string;
  term?: string | null;
  pattern?: string | null;
  category?: string | null;
}

interface LanguageDiagnosticMetric {
  count: number;
  rate: number;
  status: "low" | "medium" | "high";
  examples: LanguageDiagnosticExample[];
}

interface LanguageDiagnosticOverall {
  score: number;
  status: "low" | "medium" | "high";
  summary: string;
}

interface LanguageDiagnostics {
  success: boolean;
  article_url: string;
  title?: string | null;
  sentence_count: number;
  word_count: number;
  passive_voice?: LanguageDiagnosticMetric | null;
  actor_omission?: LanguageDiagnosticMetric | null;
  euphemisms?: LanguageDiagnosticMetric | null;
  sanitized_language?: LanguageDiagnosticMetric | null;
  overall?: LanguageDiagnosticOverall | null;
  error?: string | null;
}

// --- Trending & Breaking News ---
// The interfaces and functions for fetching trending and breaking news
// Are now consolidated at the bottom of this file (Phase 6 section) to avoid duplication.



// --- Trending & Breaking News ---
// The interfaces and functions for fetching trending and breaking news
// Are now consolidated at the bottom of this file (Phase 6 section) to avoid duplication.

interface ArticleAnalysis {
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
    grounding_chunks?: { uri?: string; title?: string }[];
    grounding_supports?: unknown[];
    web_search_queries?: string[];
  };
  language_diagnostics?: LanguageDiagnostics | null;
  summary?: string;
  error?: string;
}

// News Research Agent Types


// News Research Agent Types
interface ThinkingStep {
  type: "thought" | "action" | "tool_start" | "observation" | "answer";
  content: string;
  timestamp: string;
}

interface NewsResearchResponse {
  success: boolean;
  query: string;
  answer: string;
  thinking_steps: ThinkingStep[];
  articles_searched: number;
  // Full article objects from backend
  referenced_articles?: BackendArticle[];
  error?: string;
}

// Agentic search (LangChain backend agent)


// Agentic search (LangChain backend agent)
interface AgenticSearchRequest {
  query: string;
  max_steps?: number;
}

interface AgenticSearchResponse {
  success: boolean;
  answer: string;
  reasoning?: unknown[];
  citations?: unknown[];
}

// Reading Queue API functions


// Reading Queue API functions
interface ReadingQueueItem {
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
  why_saved?: string | null;
  unresolved_question?: string | null;
  shelf_id?: number | null;
}

interface QueueResponse {
  items: ReadingQueueItem[];
  daily_count: number;
  permanent_count: number;
  total_count: number;
}

interface UpdateQueueItemRequest {
  read_status?: "unread" | "reading" | "completed";
  queue_type?: "daily" | "permanent";
  position?: number;
  archived_at?: string;
  why_saved?: string | null;
  unresolved_question?: string | null;
  shelf_id?: number | null;
}

interface QueueOverview {
  total_items: number;
  daily_items: number;
  permanent_items: number;
  unread_count: number;
  reading_count: number;
  completed_count: number;
  estimated_total_read_time_minutes: number;
}

interface ReadingShelf {
  id?: number;
  user_id?: number | null;
  name: string;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// Highlights API


// Highlights API
interface Highlight {
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

// --- Reading Queue Content & Digest ---



// --- Reading Queue Content & Digest ---

interface QueueItemContent {
  id: number;
  article_url: string;
  article_title: string;
  article_source: string;
  full_text: string;
  word_count?: number;
  estimated_read_time_minutes?: number;
  read_status: string;
}

interface QueueDigest {
  digest_items: ReadingQueueItem[];
  total_items: number;
  estimated_read_time_minutes: number;
  generated_at: string;
}

// --- Pagination Types ---



// --- Pagination Types ---

interface PaginatedResponse {
  articles: NewsArticle[];
  total: OpenApiPaginatedResponse["total"];
  limit: OpenApiPaginatedResponse["limit"];
  next_cursor: NonNullable<OpenApiPaginatedResponse["next_cursor"]> | null;
  prev_cursor: NonNullable<OpenApiPaginatedResponse["prev_cursor"]> | null;
  has_more: OpenApiPaginatedResponse["has_more"];
}

type PaginationParams = Pick<
  NewsPageQueryParams,
  "limit" | "cursor" | "category" | "source" | "sources" | "search"
>;

type CachedPaginationParams = Pick<
  CachedNewsPageQueryParams,
  "limit" | "offset" | "category" | "source" | "sources" | "search"
>;

// --- Paginated Fetch Functions ---

interface PageQueryParams {
  category?: string | null;
  cursor?: string | null;
  limit?: number | null;
  offset?: number | null;
  search?: string | null;
  source?: string | null;
  sources?: string | null;
}

interface QueryParameter {
  key: string;
  value: boolean | number | string | null | undefined;
}

type BrowseIndexParams = Pick<PaginationParams, "category" | "source" | "sources" | "search">;

// --- Country/Globe API Functions ---



// --- Country/Globe API Functions ---

interface CountryArticleCounts {
  counts: Record<string, number>;
  source_counts?: Record<string, number>;
  geo_signals?: {
    id: string;
    label: string;
    country_counts: Record<string, number>;
    country_count: number;
    article_count: number;
    total_mentions: number;
  }[];
  total_articles: number;
  articles_with_country: number;
  articles_without_country: number;
  country_count: number;
  window_hours?: number;
}

interface CountryGeoData {
  countries: Record<string, { name: string; lat: number; lng: number }>;
  total: number;
}

interface CountryListItem {
  code: string;
  article_count: number;
  latest_article: string | null;
}

interface CountryListResponse {
  countries: CountryListItem[];
  total_countries: number;
}

interface CountryPickerItem {
  code: string;
  name: string;
  article_count: number;
  latest_article: string | null;
  heat_count: number;
  source_count: number;
}

interface LocalLensResponse {
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

// ============================================
// Phase 5B: Reporter and Organization Research
// ============================================



// ============================================
// Phase 5B: Reporter and Organization Research
// ============================================

interface ReporterProfile {
  id?: number;
  name: string;
  normalized_name?: string;
  bio?: string;
  career_history?: {
    organization?: string;
    role?: string;
    source?: string;
  }[];
  topics?: string[];
  education?: ApiOpaqueObject[];
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
  dossier_sections?: {
    id: string;
    title: string;
    status: "available" | "missing";
    items: {
      label?: string;
      value?: string;
      sources?: string[];
      notes?: string;
    }[];
  }[];
  citations?: {
    label: string;
    url?: string;
    note?: string;
  }[];
  search_links?: Record<string, string>;
  match_explanation?: string;
  research_sources?: string[];
  research_confidence?: string;
  cached: boolean;
}

interface OrganizationProfile {
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

interface OwnershipChain {
  organization: string;
  chain: OrganizationProfile[];
  depth: number;
}

interface SourceResearchValue {
  value: string;
  sources?: string[];
  notes?: string;
}

interface SourceReporterSummary {
  name: string;
  article_count: number;
}

interface AdsTxtSummary {
  url: string;
  authorized_sellers: number;
  direct_sellers: number;
  resellers: number;
  duplicate_records: number;
  invalid_lines: number;
  owner_domains: string[];
  manager_domains: string[];
  contact: string[];
}

interface SellersJsonSystemSummary {
  ad_system_domain: string;
  status: "available" | "missing";
  ads_txt_records: number;
  seller_count?: number;
  confidential_sellers?: number;
  matched_records?: number;
  missing_seller_ids?: number;
  owner_domain_matches?: number;
  manager_domain_matches?: number;
  sellers_json_url?: string;
}

interface SellersJsonSummary {
  checked_ad_systems: number;
  available_sellers_json: number;
  checked_records: number;
  matched_records: number;
  missing_seller_ids: number;
  owner_domain_matches: number;
  manager_domain_matches: number;
  systems: SellersJsonSystemSummary[];
}

interface PolicyTransparencySignal {
  id: string;
  label: string;
  status: "available";
  sources: string[];
  matched_terms: string[];
}

interface PolicyTransparencySummary {
  checked_pages: number;
  available_signals: number;
  signals: PolicyTransparencySignal[];
}

interface SourceResearchProfile {
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
  dossier_sections?: {
    id: string;
    title: string;
    status: "available" | "missing";
    items: {
      label?: string;
      value?: string;
      sources?: string[];
      notes?: string;
    }[];
  }[];
  citations?: {
    label: string;
    url?: string;
    note?: string;
  }[];
  search_links?: Record<string, string>;
  match_explanation?: string;
  policy_transparency?: PolicyTransparencySummary | null;
  ads_txt?: AdsTxtSummary | null;
  sellers_json?: SellersJsonSummary | null;
}

interface SourceResearchRequest {
  name: string;
  website?: string;
}

interface SourceBatchResponse {
  results: Record<string, SourceResearchProfile | null>;
  cached_count: number;
  newly_researched_count: number;
}

// ============================================
// Phase 5C: Material Interest Analysis
// ============================================



// ============================================
// Phase 5C: Material Interest Analysis
// ============================================

interface TradeRelationship {
  country_pair: string;
  relationship?: string;
  key_sectors?: string[];
  tension_areas?: string[];
  trade_volume?: string;
}

interface KnownInterests {
  parent_company?: string;
  owner?: string;
  owner_interests?: string[];
}

interface MaterialContext {
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
type OpenApiSuccessResponse<Responses> = Responses extends { "200": infer Success }
  ? Success
  : never;
type OpenApiTrendingStatsResponse = OpenApiSuccessResponse<
  OpenApiPaths["/trending/stats"]["get"]["responses"]
>;
type OpenApiTrendingStats = OpenApiTrendingStatsResponse extends {
  content: { "application/json": infer Payload };
}
  ? Payload
  : never;
type OpenApiPaginatedResponse = OpenApiComponents["schemas"]["PaginatedResponse"];
type NewsPageQueryParams = NonNullable<
  OpenApiPaths["/news/page"]["get"]["parameters"]["query"]
>;
type CachedNewsPageQueryParams = NonNullable<
  OpenApiPaths["/news/page/cached"]["get"]["parameters"]["query"]
>;

interface CountryEconomicProfile {
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

// ============================================
// Phase 6: Trending & Breaking News Detection
// ============================================



// ============================================
// Phase 6: Trending & Breaking News Detection
// ============================================

interface GdeltTopCameo {
  code?: string | null;
  label?: string | null;
  count: number;
}

interface GdeltContext {
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

interface TrendingArticle {
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

interface TrendingCluster {
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

interface BreakingCluster {
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

interface TrendingResponse {
  window: string;
  clusters: TrendingCluster[];
  total: number;
}

interface BreakingResponse {
  window_hours: number;
  clusters: BreakingCluster[];
  total: number;
}

interface ClusterDetail {
  id: number;
  label?: string | null;
  keywords: string[];
  article_count: number;
  first_seen?: string | null;
  last_seen?: string | null;
  is_active: boolean;
  gdelt_context?: GdeltContext | null;
  articles: {
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
  }[];
}

interface ContradictionEvidence {
  source: string;
  article_url: string;
  stance: string;
  snippet: string;
}

interface ContradictionClaim {
  claim: string;
  status: string;
  evidence: ContradictionEvidence[];
}

interface AgreedFact {
  claim: string;
  evidence: ContradictionEvidence[];
}

interface ContradictionPanelResponse {
  status: string;
  reason?: string | null;
  claims: ContradictionClaim[];
  agreed_facts: AgreedFact[];
  unconfirmed_gaps: string[];
  source_count: number;
  article_count: number;
}

interface LineageStory {
  id: number;
  external_cluster_id: number;
  label?: string | null;
  keywords: string[];
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  earliest_article_id?: number | null;
  current_summary?: string | null;
  confidence?: number | null;
}

interface LineageArticleEdge {
  id?: number | null;
  from_article_id: number;
  to_article_id: number;
  from_title: string;
  to_title: string;
  relation: string;
  evidence: ApiOpaqueObject;
  confidence?: number | null;
}

interface LineageClaim {
  id?: number | null;
  article_id: number;
  claim_text: string;
  claim_type: string;
  checkability: string;
  evidence_span?: string | null;
  numbers: string[];
}

interface LineageClaimEdge {
  id?: number | null;
  from_claim_id: number;
  to_claim_id: number;
  relation: string;
  evidence: ApiOpaqueObject;
  confidence?: number | null;
}

interface LineageCorrection {
  id: number;
  source: string;
  article_id?: number | null;
  correction_url?: string | null;
  correction_text: string;
  corrected_claim_id?: number | null;
  downstream_article_ids: number[];
  published_at?: string | null;
}

interface StoryLineageResponse {
  status: string;
  reason?: string | null;
  story?: LineageStory | null;
  article_edges: LineageArticleEdge[];
  claims: LineageClaim[];
  claim_edges: LineageClaimEdge[];
  corrections: LineageCorrection[];
}

interface BlindspotLens {
  id: "bias" | "credibility" | "geography" | "institutional_populist";
  label: string;
  description: string;
  available: boolean;
  unavailable_reason?: string | null;
}

interface BlindspotLane {
  id: "pole_a" | "shared" | "pole_b";
  label: string;
  description: string;
  cluster_count: number;
}

interface BlindspotPreviewArticle {
  id: number;
  title: string;
  source: string;
  source_id?: string | null;
  url: string;
  image_url?: string | null;
  published_at?: string | null;
  summary?: string | null;
  similarity: number;
  country?: string | null;
  source_country?: string | null;
  category?: string | null;
  bias?: string | null;
  credibility?: string | null;
  author?: string | null;
  authors?: string[];
}

interface BlindspotCard {
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
  geography_signals: {
    id: string;
    label: string;
    count: number;
  }[];
  paywall_concentration: {
    total_articles: number;
    paywalled_articles: number;
    free_articles: number;
    unknown_articles: number;
    paywall_share: number;
    status: string;
    best_free_sources: string[];
  };
  representative_article?: BlindspotPreviewArticle | null;
  articles: BlindspotPreviewArticle[];
}

interface BlindspotViewerResponse {
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

interface TrendingStats {
  active_clusters: number;
  total_article_assignments: number;
  recent_spikes: number;
  similarity_threshold: number;
  baseline_days: number;
  breaking_window_hours: number;
}

interface AllCluster {
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

interface AllClustersResponse {
  window: string;
  clusters: AllCluster[];
  total: number;
  computed_at?: string | null;
  status?: string | null;
}

interface BlindspotViewerParams {
  lens?: BlindspotLens["id"];
  window?: "1d" | "1w" | "1m";
  category?: string;
  sources?: string | null;
  perLane?: number;
}

// ==========================================================================
// GDELT API
// ==========================================================================



// ==========================================================================
// GDELT API
// ==========================================================================

interface GdeltEvent {
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

interface GdeltArticleEventsResponse {
  article_id: number;
  total_external_events: number;
  events: GdeltEvent[];
}

interface GdeltStatsResponse {
  window_hours: number;
  total_events: number;
  matched_events: number;
  match_rate: number;
  match_breakdown: {
    url_match: number;
    embedding_match: number;
  };
  top_articles_by_coverage: {
    article_id: number;
    gdelt_event_count: number;
  }[];
}

// ============================================================================
// Similarity / Related Articles API
// ============================================================================



// ============================================================================
// Similarity / Related Articles API
// ============================================================================

interface RelatedArticle {
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

interface RelatedArticlesResponse {
  article_id: number;
  related: RelatedArticle[];
  total: number;
}

interface SearchSuggestion {
  cluster_id: number;
  label: string;
  relevance: number;
}

interface SearchSuggestionsResponse {
  query: string;
  suggestions: SearchSuggestion[];
}

interface SourceCoverageStats {
  article_count: number;
  centroid_distance?: number;
  spread?: number;
  diversity_score?: number;
}

interface SourceCoverageResponse {
  sources: Record<string, SourceCoverageStats>;
  global_article_count: number;
  error?: string;
}

interface NoveltyScoreResponse {
  article_id: number;
  novelty_score: number;
  max_similarity_to_history: number;
  avg_similarity_to_history: number;
  history_size: number;
  reason?: string;
}

// ============================================================================
// Article Topics / Semantic Tags API
// ============================================================================



// ============================================================================
// Article Topics / Semantic Tags API
// ============================================================================

interface ArticleTopic {
  cluster_id: number;
  label: string;
  similarity: number | null;
  keywords?: string[];
}

interface ArticleTopicsResponse {
  article_id: number;
  topics: ArticleTopic[];
}

interface BulkArticleTopicsResponse {
  articles: Record<
    number,
    {
      cluster_id: number
      label: string
      similarity: number | null
      keywords?: string[]
    }[]
  >;
}
/*
 * Fetch the OpenGraph image for a given article URL
 * @backend/tests/test_llm_client_params.py url The URL of the article
 */
// ============================================================================
// Media Accountability Wiki API
// ============================================================================


/*
 * Fetch the OpenGraph image for a given article URL
 * @backend/tests/test_llm_client_params.py url The URL of the article
 */
// ============================================================================
// Media Accountability Wiki API
// ============================================================================

interface WikiAnalysisAxis {
  axis_name: string;
  score: number;
  confidence?: string;
  prose_explanation?: string;
  citations?: { url?: string; title?: string; snippet?: string }[];
  empirical_basis?: string;
  scored_by?: string;
  last_scored_at?: string;
}

interface WikiSourceCard {
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

interface SourceLedgerMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  description: string;
  status: string;
}

interface SourceLedger {
  source_name: string;
  article_count: number;
  paywall: {
    paywalled_articles: number;
    free_articles: number;
    unknown_articles: number;
    paywall_rate: number;
    source_flagged_paywalled: boolean;
  };
  original_reporting: {
    earliest_story_count: number;
    earliest_story_rate: number;
  };
  wire_dependency: {
    wire_edge_count: number;
    downstream_edge_count: number;
    wire_dependency_rate: number;
  };
  author_transparency: {
    named_author_articles: number;
    named_author_rate: number;
  };
  source_transparency: {
    policy_signal_count: number;
    has_policy_signals: boolean;
  };
  rss_health: {
    status: string;
    feed_url?: string | null;
    last_successful_fetch_at?: unknown;
    last_error?: unknown;
  };
  metrics: SourceLedgerMetric[];
}

interface WikiSourceProfile {
  name: string;
  website?: string;
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
  dossier_sections: {
    id: string;
    title: string;
    status: "available" | "missing";
    items: {
      label?: string;
      value?: string;
      sources?: string[];
      notes?: string;
    }[];
  }[];
  citations: {
    label: string;
    url?: string;
    note?: string;
  }[];
  official_pages?: {
    label: string;
    url: string;
    summary: string;
  }[];
  policy_transparency?: PolicyTransparencySummary | null;
  ads_txt?: AdsTxtSummary | null;
  sellers_json?: SellersJsonSummary | null;
  source_ledger?: SourceLedger | null;
  search_links?: Record<string, string>;
  match_explanation?: string;
  analysis_axes: WikiAnalysisAxis[];
  reporters: {
    id: number;
    name: string;
    topics?: string[];
    political_leaning?: string;
    article_count: number;
  }[];
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
  ownership_chain: {
    name: string;
    ownership_percentage?: number;
  }[];
  article_count: number;
  geographic_focus: string[];
  topic_focus: string[];
  index_status?: string;
  last_indexed_at?: string;
}

interface WikiReporterCard {
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

interface WikiReporterDossier extends WikiReporterCard {
  career_history?: {
    organization?: string;
    role?: string;
    source?: string;
  }[];
  education?: ApiOpaqueObject[];
  leaning_sources?: string[];
  twitter_handle?: string;
  linkedin_url?: string;
  wikidata_qid?: string;
  wikidata_url?: string;
  canonical_name?: string;
  match_status?: "matched" | "ambiguous" | "none";
  overview?: string;
  dossier_sections: {
    id: string;
    title: string;
    status: "available" | "missing";
    items: {
      label?: string;
      value?: string;
      sources?: string[];
      notes?: string;
    }[];
  }[];
  citations: {
    label: string;
    url?: string;
    note?: string;
  }[];
  search_links?: Record<string, string>;
  match_explanation?: string;
  source_patterns?: ApiOpaqueObject;
  topics_avoided?: ApiOpaqueObject;
  advertiser_alignment?: ApiOpaqueObject;
  revolving_door?: ApiOpaqueObject;
  controversies?: ApiOpaqueObject[];
  institutional_affiliations?: ApiOpaqueObject[];
  coverage_comparison?: ApiOpaqueObject;
  /** Loosely typed on the wire; parse with `parseReporterCareerTimeline`. */
  career_timeline?: ApiOpaqueObject | null;
  last_article_at?: string;
  recent_articles: {
    id?: number;
    title?: string;
    source?: string;
    published_at?: string | null;
    url?: string;
    category?: string;
    image_url?: string | null;
  }[];
  activity_summary?: {
    article_count: number;
    source_count: number;
    active_since?: string | null;
    latest_article_at?: string | null;
    outlets: { name: string; article_count: number }[];
    categories: { name: string; article_count: number }[];
    domains: { domain: string; article_count: number }[];
    author_pages: { url: string; domain?: string | null; source: string }[];
    external_profiles: { url: string; domain?: string | null; source: string }[];
    meta_author_matches: number;
  };
  research_sources?: string[];
}

type ReporterTimelineEntry = z.infer<typeof ReporterTimelineEntrySchema>;

type ReporterOwnershipRef = z.infer<typeof ReporterOwnershipRefSchema>;

type ReporterSharedOwnerFinding = z.infer<typeof ReporterSharedOwnerFindingSchema>;

type ReporterCareerTimeline = z.infer<typeof ReporterCareerTimelineSchema>;

interface WikiIndexStatus {
  total_entries: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
}

interface WikiSourcesParams {
  country?: string;
  bias?: string;
  funding?: string;
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}


// API utility for communicating with FastAPI backend

const apiArray = <Schema extends z.ZodTypeAny>(schema: Schema) => z.array(schema),
  apiNumericConstants = {
    eight: Number("8"),
    five: Number("5"),
    fiveHundred: Number("500"),
    fifty: Number("50"),
    four: Number("4"),
    hundred: Number("100"),
    minusOne: Number("-1"),
    one: Number("1"),
    oneHundred: Number("100"),
    pointFour: Number("0.4"),
    pointSeventyFive: Number("0.75"),
    six: Number("6"),
    ten: Number("10"),
    thirty: Number("30"),
    thousand: Number("1000"),
    twentyFour: Number("24"),
    two: Number("2"),
    twoThousand: Number("2000"),
    zero: Number("0"),
  } as const,
  apiObject = <Fields extends Record<string, z.ZodTypeAny>>(fields: Fields) => z.object(fields).passthrough(),
  apiRecord = <Schema extends z.ZodTypeAny>(schema: Schema) => z.record(z.string(), schema),
  A_NULL_VALUE = (() => {
    const parsed: unknown = globalThis.JSON.parse("null");
    return z.null().parse(parsed);
  })(),
AgreedFactSchema = z.object({
  claim: z.string(),
  evidence: z.array(z.lazy(() => ContradictionEvidenceSchema)).default([]),
}),
AllClusterSchema = z.object({
  article_count: z.number(),
  articles: z.array(z.lazy(() => TrendingArticleSchema)).default([]),
  cluster_id: z.number(),
  gdelt_context: z.lazy(() => GdeltContextSchema).nullable().default(A_NULL_VALUE),
  keywords: z.array(z.string()),
  label: z.string().nullable(),
  representative_article: z.lazy(() => TrendingArticleSchema).nullable().default(A_NULL_VALUE),
  source_diversity: z.number(),
  window_count: z.number(),
}),
AllClustersResponseSchema = z.object({
  clusters: z.array(AllClusterSchema),
  computed_at: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  total: z.number(),
  window: z.string(),
}),
ApiJsonValueSchema: z.ZodType<ApiJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ApiJsonValueSchema),
    z.record(z.string(), ApiJsonValueSchema),
  ]),
),
apiStringArray = apiArray(z.string()),
apiUnknownArray = apiArray(z.unknown()),
BackendArticleSchema = z
  .object({
    article_id: z.number().optional(),
    article_url: z.string().optional(),
    author: z.string().optional(),
    authors: z.array(z.string()).optional(),
    bias: z.string().optional(),
    category: z.string().optional(),
    content: z.string().optional(),
    country: z.string().optional(),
    credibility: z.string().optional(),
    description: z.string().optional(),
    geo_signal: z.object({
      id: z.string(),
      label: z.string(),
    }).optional(),
    id: z.number().optional(),
    image: z.string().optional(),
    image_url: z.string().optional(),
    is_persisted: z.boolean().optional(),
    link: z.string().optional(),
    mentioned_countries: z.array(z.string()).optional(),
    original_language: z.string().optional(),
    original_url: z.string().optional(),
    published: z.string().optional(),
    publishedAt: z.string().optional(),
    published_at: z.string().optional(),
    source: z.string().optional(),
    source_country: z.string().optional(),
    source_id: z.string().optional(),
    source_name: z.string().optional(),
    summary: z.string().optional(),
    title: z.string().optional(),
    translated: z.boolean().optional(),
    url: z.string().optional(),
  })
  .passthrough(),
BackendSourceSchema = z
  .object({
    bias_rating: z.string().optional(),
    category: z.string().optional(),
    country: z.string().default("US"),
    credibility_score: z.number().optional(),
    factual_rating: z.string().optional(),
    funding_type: z.string().optional(),
    id: z.string().optional(),
    is_paywalled: z.boolean().optional(),
    name: z.string(),
    ownership_label: z.string().optional(),
    rssUrl: z.string().optional(),
    slug: z.string().optional(),
    source_type: z.string().optional().nullable(),
    url: z.string(),
  })
  .passthrough(),
BlindspotCardSchema = z.object({
  article_count: z.number(),
  articles: z.array(z.lazy(() => BlindspotPreviewArticleSchema)),
  balance_score: z.number(),
  blindspot_score: z.number(),
  cluster_id: z.number(),
  cluster_label: z.string(),
  coverage_counts: z.lazy(() => BlindspotCoverageSchema),
  coverage_shares: z.lazy(() => BlindspotCoverageSchema),
  explanation: z.string(),
  geography_signals: z.lazy(() => z.array(BlindspotGeographySchema)).default([]),
  keywords: z.array(z.string()),
  lane: z.enum(["pole_a", "shared", "pole_b"]),
  paywall_concentration: z.lazy(() => BlindspotPaywallSchema),
  published_at: z.string().nullish(),
  representative_article: z.lazy(() => BlindspotPreviewArticleSchema).nullable().optional(),
  source_count: z.number(),
}),
BlindspotCoverageSchema = z.object({
  pole_a: z.number(),
  pole_b: z.number(),
  shared: z.number(),
}),
BlindspotGeographySchema = z.object({
  count: z.number(),
  id: z.string(),
  label: z.string(),
}),
BlindspotLaneSchema = z.object({
  cluster_count: z.number(),
  description: z.string(),
  id: z.enum(["pole_a", "shared", "pole_b"]),
  label: z.string(),
}),
BlindspotLensSchema = z.object({
  available: z.boolean(),
  description: z.string(),
  id: z.enum(["bias", "credibility", "geography", "institutional_populist"]),
  label: z.string(),
  unavailable_reason: z.string().nullable().optional(),
}),
BlindspotPreviewArticleSchema = z.object({
  author: z.string().nullable().optional(),
  authors: z.array(z.string()).optional(),
  bias: z.string().nullish(),
  category: z.string().nullish(),
  country: z.string().nullish(),
  credibility: z.string().nullish(),
  id: z.number(),
  image_url: z.string().nullish(),
  published_at: z.string().nullish(),
  similarity: z.number(),
  source: z.string(),
  source_country: z.string().nullish(),
  source_id: z.string().nullish(),
  summary: z.string().nullish(),
  title: z.string(),
  url: z.string(),
}),
BlindspotPaywallSchema = z.object({
  best_free_sources: z.array(z.string()).default([]),
  free_articles: z.number(),
  paywall_share: z.number(),
  paywalled_articles: z.number(),
  status: z.string(),
  total_articles: z.number(),
  unknown_articles: z.number(),
}),
BlindspotSummarySchema = z.object({
  category: z.string().nullable().optional(),
  eligible_clusters: z.number(),
  generated_at: z.string(),
  source_filters: z.array(z.string()),
  total_clusters: z.number(),
  window: z.string(),
}),
BlindspotViewerResponseSchema = z.object({
  available_lenses: z.array(BlindspotLensSchema),
  cards: z.array(BlindspotCardSchema),
  lanes: z.array(BlindspotLaneSchema),
  selected_lens: BlindspotLensSchema,
  status: z.string(),
  summary: BlindspotSummarySchema,
}),
BreakingClusterSchema = z.object({
  article_count_3h: z.number(),
  articles: z.array(z.lazy(() => TrendingArticleSchema)).default([]),
  cluster_id: z.number(),
  gdelt_context: z.lazy(() => GdeltContextSchema).nullable().default(A_NULL_VALUE),
  is_new_story: z.boolean(),
  keywords: z.array(z.string()),
  label: z.string().nullable(),
  representative_article: z.lazy(() => TrendingArticleSchema).nullable().default(A_NULL_VALUE),
  source_count_3h: z.number(),
  spike_magnitude: z.number(),
}),
BreakingResponseSchema = z.object({
  clusters: z.array(BreakingClusterSchema),
  total: z.number(),
  window_hours: z.number(),
}),
CLOUDFLARED_TUNNEL_PATTERNS = [
  /\.trycloudflare\.com$/u,
  /\.cfargotunnel\.com$/u,
],
COUNTRY_NAME_TO_CODE: CountryNameMap = {
  america: "US",
  argentina: "AR",
  australia: "AU",
  bangladesh: "BD",
  britain: "GB",
  canada: "CA",
  china: "CN",
  colombia: "CO",
  egypt: "EG",
  england: "GB",
  france: "FR",
  germany: "DE",
  greece: "GR",
  "hong kong": "HK",
  hongkong: "HK",
  india: "IN",
  indonesia: "ID",
  international: "International",
  israel: "IL",
  japan: "JP",
  kazakhstan: "KZ",
  kenya: "KE",
  mexico: "MX",
  myanmar: "MM",
  "new zealand": "NZ",
  newzealand: "NZ",
  nigeria: "NG",
  "north korea": "KP",
  pakistan: "PK",
  palestine: "PS",
  philippines: "PH",
  qatar: "QA",
  russia: "RU",
  singapore: "SG",
  "south africa": "ZA",
  "south korea": "KR",
  taiwan: "TW",
  thailand: "TH",
  turkey: "TR",
  ukraine: "UA",
  "united kingdom": "GB",
  "united states": "US",
  usa: "US",
  venezuela: "VE",
  vietnam: "VN",
},
CacheDebugArticleSchema = z.object({
  category: z.string(),
  country: z.string().nullable().optional(),
  description: z.string(),
  id: z.number().nullable().optional(),
  image: z.string().nullable().optional(),
  link: z.string(),
  published: z.string(),
  source: z.string(),
  title: z.string(),
}),
CacheDebugResponseSchema = z.object({
  articles: z.array(CacheDebugArticleSchema),
  limit: z.number(),
  offset: z.number(),
  returned: z.number(),
  source: z.string().nullable().optional(),
  total: z.number(),
}),
CacheDeltaResponseSchema = z.object({
  cache_sampled: z.number(),
  cache_total: z.number(),
  db_total: z.number(),
  missing_in_db_count: z.number(),
  missing_in_db_sample: z.array(z.string()),
  sample_limit: z.number(),
  sample_offset: z.number(),
  source: z.string().nullable().optional(),
}),
CacheRefreshEventSchema = z.object({
  articles_from_source: z.number().optional(),
  failed_sources: z.number().optional(),
  message: z.string().optional(),
  source: z.string().optional(),
  status: z.enum(["complete", "source_complete", "error"]).optional(),
  successful_sources: z.number().optional(),
  total_articles: z.number().optional(),
  total_sources_processed: z.number().optional(),
}),
ChromaDebugArticleSchema = z.object({
  id: z.string(),
  metadata: z.record(z.unknown()),
  preview: z.string(),
}),
ChromaDebugResponseSchema = z.object({
  articles: z.array(ChromaDebugArticleSchema),
  limit: z.number(),
  offset: z.number(),
  returned: z.number(),
  total: z.number().optional(),
}),
ClusterDetailArticleSchema = z.object({
  author: z.string().nullable().optional(),
  authors: z.array(z.string()).optional(),
  gdelt_context: z.lazy(() => GdeltContextSchema).nullable().default(A_NULL_VALUE),
  id: z.number(),
  image_url: z.string().nullish(),
  published_at: z.string().nullish(),
  similarity: z.number(),
  source: z.string(),
  source_id: z.string().nullish(),
  summary: z.string().nullish(),
  title: z.string(),
  url: z.string(),
}),
ClusterDetailSchema = z.object({
  article_count: z.number(),
  articles: z.array(ClusterDetailArticleSchema),
  first_seen: z.string().nullable(),
  gdelt_context: z.lazy(() => GdeltContextSchema).nullable().default(A_NULL_VALUE),
  id: z.number(),
  is_active: z.boolean(),
  keywords: z.array(z.string()),
  label: z.string().nullable(),
  last_seen: z.string().nullable(),
}),
ContradictionClaimSchema = z.object({
  claim: z.string(),
  evidence: z.array(z.lazy(() => ContradictionEvidenceSchema)).default([]),
  status: z.string(),
}),
ContradictionEvidenceSchema = z.object({
  article_url: z.string(),
  snippet: z.string(),
  source: z.string(),
  stance: z.string(),
}),
ContradictionPanelResponseSchema = z.object({
  agreed_facts: z.array(AgreedFactSchema).default([]),
  article_count: z.number(),
  claims: z.array(ContradictionClaimSchema).default([]),
  reason: z.string().nullable().optional(),
  source_count: z.number(),
  status: z.string(),
  unconfirmed_gaps: z.array(z.string()).default([]),
}),
DEFAULT_BACKEND_PORT = "8000",
HTTP_NOT_FOUND_STATUS = Number("404"),
HTTP_SERVICE_UNAVAILABLE_STATUS = Number("503"),
DatabaseDebugArticleSchema = z
  .object({
    chroma_id: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    embedding_generated: z.boolean().nullable().optional(),
    id: z.number(),
    image_url: z.string().nullable().optional(),
    published_at: z.string().optional(),
    source: z.string(),
    summary: z.string().nullable().optional(),
    title: z.string(),
    url: z.string(),
  })
  .catchall(z.unknown()),
DatabaseDebugResponseSchema = z.object({
  articles: z.array(DatabaseDebugArticleSchema),
  limit: z.number(),
  missing_embeddings_only: z.boolean(),
  newest_published: z.string().nullable().optional(),
  offset: z.number(),
  oldest_published: z.string().nullable().optional(),
  published_after: z.string().nullable().optional(),
  published_before: z.string().nullable().optional(),
  returned: z.number(),
  sort_direction: z.enum(["asc", "desc"]),
  source: z.string().nullable().optional(),
  total: z.number(),
}),
ENABLE_DIGEST = globalThis.process.env.NEXT_PUBLIC_ENABLE_DIGEST === "true",
ENABLE_HIGHLIGHTS = true,
GdeltContextSchema = z.object({
  goldstein_avg: z.number().nullable().optional(),
  goldstein_bucket: z.string().nullable().optional(),
  goldstein_max: z.number().nullable().optional(),
  goldstein_min: z.number().nullable().optional(),
  tone_avg: z.number().nullable().optional(),
  tone_baseline_avg: z.number().nullable().optional(),
  tone_delta_vs_cluster: z.number().nullable().optional(),
  top_cameo: z.array(z.lazy(() => GdeltTopCameoSchema)).default([]),
  total_events: z.number(),
}),
GdeltTopCameoSchema = z.object({
  code: z.string().nullable().optional(),
  count: z.number(),
  label: z.string().nullable().optional(),
}),
KnownInterestsSchema = z
  .object({
    owner: z.string().optional(),
    owner_interests: z.array(z.string()).optional(),
    parent_company: z.string().optional(),
  })
  .catchall(z.unknown()),
LOCAL_BACKEND_FALLBACK = `http://localhost:${DEFAULT_BACKEND_PORT}`,
LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]),
LineageArticleEdgeSchema = z.object({
  confidence: z.number().nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).default({}),
  from_article_id: z.number(),
  from_title: z.string(),
  id: z.number().nullable().optional(),
  relation: z.string(),
  to_article_id: z.number(),
  to_title: z.string(),
}),
LineageClaimEdgeSchema = z.object({
  confidence: z.number().nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).default({}),
  from_claim_id: z.number(),
  id: z.number().nullable().optional(),
  relation: z.string(),
  to_claim_id: z.number(),
}),
LineageClaimSchema = z.object({
  article_id: z.number(),
  checkability: z.string(),
  claim_text: z.string(),
  claim_type: z.string(),
  evidence_span: z.string().nullable().optional(),
  id: z.number().nullable().optional(),
  numbers: z.array(z.string()).default([]),
}),
LineageCorrectionSchema = z.object({
  article_id: z.number().nullable().optional(),
  corrected_claim_id: z.number().nullable().optional(),
  correction_text: z.string(),
  correction_url: z.string().nullable().optional(),
  downstream_article_ids: z.array(z.number()).default([]),
  id: z.number(),
  published_at: z.string().nullable().optional(),
  source: z.string(),
}),
LineageStorySchema = z.object({
  confidence: z.number().nullable().optional(),
  current_summary: z.string().nullable().optional(),
  earliest_article_id: z.number().nullable().optional(),
  external_cluster_id: z.number(),
  first_seen_at: z.string().nullable().optional(),
  id: z.number(),
  keywords: z.array(z.string()).default([]),
  label: z.string().nullable().optional(),
  last_seen_at: z.string().nullable().optional(),
}),
MaterialContextSchema = z.object({
  analysis_summary: z.string().nullable().optional(),
  analyzed_at: z.string().nullable().optional(),
  confidence: z.string().nullable().optional(),
  known_interests: KnownInterestsSchema,
  mentioned_countries: z.array(z.string()),
  potential_conflicts: z.array(z.string()),
  reader_warnings: z.array(z.string()).nullable().optional(),
  source: z.string(),
  source_country: z.string(),
  trade_relationships: z.array(z.lazy(() => TradeRelationshipSchema)),
}),
MissingInChromaItemSchema = z.object({
  chroma_id: z.string().nullable().optional(),
  embedding_generated: z.boolean().nullable().optional(),
  id: z.number(),
}),
NewsPayloadSchema = z.object({
  articles: z.unknown().optional(),
}).passthrough(),
OG_IMAGE_ERROR_TTL_MS = apiNumericConstants.thirty * apiNumericConstants.thousand,
OG_IMAGE_MAX_CACHE_ENTRIES = 2000,
OG_IMAGE_METRICS_INTERVAL = 200,
OG_IMAGE_MISS_TTL_MS = apiNumericConstants.two * Number("60") * apiNumericConstants.thousand,
OG_IMAGE_SUCCESS_TTL_MS = apiNumericConstants.ten * Number("60") * apiNumericConstants.thousand,
OgImageResponseSchema = z.object({
  image_url: z.string().nullable().optional(),
}).passthrough(),
PRIVATE_IPV4_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u,
  /^192\.168\.\d{1,3}\.\d{1,3}$/u,
  /^172\.(?<privateRange>1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/u,
],
PUBLIC_API_FALLBACK = globalThis.process.env.NEXT_PUBLIC_PUBLIC_API_URL?.trim().replace(/\/+$/u, "") ?? "",
PUBLIC_FRONTEND_DOMAIN = globalThis.process.env.NEXT_PUBLIC_FRONTEND_HOST_SUFFIX?.trim().replace(/^\./u, "") ?? "",
PaginatedPayloadSchema = z.object({
  articles: z.array(BackendArticleSchema).optional(),
  has_more: z.boolean().optional(),
  limit: z.number().optional(),
  next_cursor: z.string().nullable().optional(),
  prev_cursor: z.string().nullable().optional(),
  total: z.number().optional(),
}).passthrough(),
ReporterCareerTimelineSchema = z.object({
  shared_owner_findings: z.array(z.lazy(() => ReporterSharedOwnerFindingSchema)),
  timeline: z.array(z.lazy(() => ReporterTimelineEntrySchema)),
}),
ReporterOwnershipRefSchema = z.object({
  entity_id: z.string(),
  entity_type: z.string().nullable().optional(),
  label: z.string(),
  profile_path: z.string().nullable().optional(),
}),
ReporterSharedOwnerFindingSchema = z.object({
  claim_ids: z.array(z.string()),
  evidence_count: z.number(),
  outlets: z.array(ReporterOwnershipRefSchema),
  owner: ReporterOwnershipRefSchema,
}),
ReporterTimelineEntrySchema = z.object({
  article_count: z.number().nullable().optional(),
  end_date: z.string().nullable().optional(),
  evidence_url: z.string().nullable().optional(),
  outlet: z.string(),
  role: z.string().nullable().optional(),
  source: z.enum(["byline", "affiliation"]),
  start_date: z.string().nullable().optional(),
}),
STREAM_CACHE_LOAD_TIMEOUT_MS = 15_000,
STREAM_MESSAGE_TIMEOUT_MS = 120_000,
STREAM_STALL_CHECK_INTERVAL_MS = 3000,
STREAM_TIMEOUT_CHECK_INTERVAL_MS = 5000,
SemanticSearchPayloadSchema = z.object({
  query: z.string().optional(),
  results: z.array(z.lazy(() => SemanticSearchResultSchema)).optional(),
  total: z.number().optional(),
}).passthrough(),
SemanticSearchResultSchema = BackendArticleSchema.extend({
  distance: z.number().nullable().optional(),
  similarity_score: z.number().nullable().optional(),
}),
StartupEventMetricSchema = z.object({
  completed_at: z.string().nullable().default(A_NULL_VALUE),
  detail: z.string().nullable().default(A_NULL_VALUE),
  duration_seconds: z.number().nullable().default(A_NULL_VALUE),
  metadata: z.record(z.string(), z.unknown()).default({}),
  name: z.string().default("event"),
  started_at: z.string().nullable().default(A_NULL_VALUE),
}).passthrough(),
StartupMetricsPayloadSchema = z.object({
  completed_at: z.string().nullable().default(A_NULL_VALUE),
  duration_seconds: z.number().nullable().default(A_NULL_VALUE),
  events: z.array(StartupEventMetricSchema).default([]),
  notes: z.record(z.string(), z.unknown()).default({}),
  started_at: z.string().nullable().default(A_NULL_VALUE),
}).passthrough(),
StorageDriftReportSchema = z.object({
  dangling_in_chroma: z.array(z.string()),
  dangling_in_chroma_count: z.number(),
  database_missing_embeddings: z.number(),
  database_total_articles: z.number(),
  database_with_embeddings: z.number(),
  missing_in_chroma: z.array(MissingInChromaItemSchema),
  missing_in_chroma_count: z.number(),
  vector_total_documents: z.number(),
}),
StoryLineageResponseSchema = z.object({
  article_edges: z.array(LineageArticleEdgeSchema).default([]),
  claim_edges: z.array(LineageClaimEdgeSchema).default([]),
  claims: z.array(LineageClaimSchema).default([]),
  corrections: z.array(LineageCorrectionSchema).default([]),
  reason: z.string().nullable().optional(),
  status: z.string(),
  story: LineageStorySchema.nullable().optional(),
}),
StreamEventSchema = z.object({
  articles: z.array(BackendArticleSchema).optional(),
  cache_age_seconds: z.number().optional(),
  error: z.string().optional(),
  failed_sources: z.number().optional(),
  message: z.string().optional(),
  progress: z.lazy(() => StreamProgressSchema).optional(),
  source: z.string().optional(),
  source_stat: z.record(z.string(), z.unknown()).optional(),
  status: z.enum([
    "starting",
    "initial",
    "cache_data",
    "source_complete",
    "source_error",
    "complete",
    "error",
  ]),
  stream_id: z.string().optional(),
  successful_sources: z.number().optional(),
  timestamp: z.string().optional(),
  total_articles: z.number().optional(),
}),
StreamProgressSchema = z.object({
  completed: z.number(),
  currentSource: z.string().optional(),
  message: z.string().optional(),
  percentage: z.number(),
  total: z.number(),
}),
TradeRelationshipSchema = z.object({
  country_pair: z.string(),
  key_sectors: z.array(z.string()).optional(),
  relationship: z.string().optional(),
  tension_areas: z.array(z.string()).optional(),
  trade_volume: z.string().optional(),
}),
TrendingArticleSchema = z.object({
  author: z.string().nullable().optional(),
  authors: z.array(z.string()).optional(),
  gdelt_context: z.lazy(() => GdeltContextSchema).nullable().optional(),
  id: z.number(),
  image_url: z.string().nullish(),
  published_at: z.string().nullish(),
  source: z.string(),
  source_id: z.string().nullish(),
  summary: z.string().nullish(),
  title: z.string(),
  url: z.string(),
}),
TrendingClusterSchema = z.object({
  article_count: z.number(),
  articles: z.array(z.lazy(() => TrendingArticleSchema)).default([]),
  cluster_id: z.number(),
  gdelt_context: z.lazy(() => GdeltContextSchema).nullable().default(A_NULL_VALUE),
  keywords: z.array(z.string()),
  label: z.string().nullable(),
  representative_article: z.lazy(() => TrendingArticleSchema).nullable().default(A_NULL_VALUE),
  source_diversity: z.number(),
  trending_score: z.number(),
  velocity: z.number(),
  window_count: z.number(),
}),
TrendingResponseSchema = z.object({
  clusters: z.array(TrendingClusterSchema),
  total: z.number(),
  window: z.string(),
}),
TrendingStatsSchema = z.object({
  active_clusters: z.number(),
  baseline_days: z.number(),
  breaking_window_hours: z.number(),
  recent_spikes: z.number(),
  similarity_threshold: z.number(),
  total_article_assignments: z.number(),
}),
zApiResponseSchemas = (() => {
  const apiOpaqueObject = z.record(z.string(), z.unknown()),
    apiOpaqueObjectList = apiArray(apiOpaqueObject),
    articleAnalysis = apiObject({
      article_url: z.string(),
      success: z.boolean(),
    }),
    articleCount = apiObject({
      articles_with_country: z.number(),
      articles_without_country: z.number(),
      country_count: z.number(),
      counts: apiRecord(z.number()),
      total_articles: z.number(),
    }),
    articleTopic = apiObject({
      cluster_id: z.number(),
      label: z.string(),
      similarity: z.number().nullable(),
    }),
    bookmarkEntry = apiObject({
      article_id: z.number(),
      bookmark_id: z.number(),
      created_at: z.string().optional(),
    }),
    cacheStatus = apiObject({
      cache_age_seconds: z.number(),
      category_breakdown: apiRecord(z.number()),
      last_updated: z.string(),
      sources_with_errors: z.number(),
      sources_with_warnings: z.number(),
      sources_working: z.number(),
      total_articles: z.number(),
      total_sources: z.number(),
      update_in_progress: z.boolean(),
    }),
    categoryObject = apiObject({ categories: apiStringArray }),
    countryEconomicProfileData = apiObject({
      gdp: z.string().optional(),
      gdp_rank: z.number().optional(),
      major_partners: apiStringArray.optional(),
      note: z.string().optional(),
      top_exports: apiStringArray.optional(),
      top_imports: apiStringArray.optional(),
    }),
    countryEconomicProfile = apiObject({
      country_code: z.string(),
      profile: countryEconomicProfileData,
    }),
    countryGeoCountry = apiObject({
      lat: z.number(),
      lng: z.number(),
      name: z.string(),
    }),
    countryListItem = apiObject({
      article_count: z.number(),
      code: z.string(),
      latest_article: z.string().nullable(),
    }),
    debugErrorEntry = apiObject({
      component: z.string().optional(),
      error_message: z.string().optional(),
      error_type: z.string().optional(),
      event_type: z.string().optional(),
      message: z.string().optional(),
      model: z.string().optional(),
      operation: z.string().optional(),
      request_id: z.string().optional(),
      service: z.string().optional(),
      timestamp: z.string().optional(),
    }),
    debugLogFile = apiObject({
      available: z.boolean(),
      entries: apiArray(debugErrorEntry),
      path: z.string(),
      returned: z.number(),
      total: z.number(),
    }),
    gdeltArticleEvent = apiObject({
      gdelt_id: z.string(),
      id: z.number(),
    }),
    gdeltStatsArticle = apiObject({
      article_id: z.number(),
      gdelt_event_count: z.number(),
    }),
    gdeltStatsBreakdown = apiObject({
      embedding_match: z.number(),
      url_match: z.number(),
    }),
    highlight = apiObject({
      article_url: z.string(),
      character_end: z.number(),
      character_start: z.number(),
      color: z.enum(["yellow", "blue", "red", "green", "purple"]),
      highlighted_text: z.string(),
    }),
    highlights = apiArray(highlight),
    likedEntry = apiObject({
      article_id: z.number(),
      created_at: z.string().optional(),
      liked_id: z.number(),
    }),
    llmLogEntry = apiObject({
      component: z.string().optional(),
      duration_ms: z.number().optional(),
      error_message: z.string().optional(),
      error_type: z.string().optional(),
      event_type: z.string().optional(),
      finish_reason: z.string().optional(),
      messages: apiOpaqueObjectList.optional(),
      model: z.string().optional(),
      operation: z.string().optional(),
      request_id: z.string().optional(),
      service: z.string().optional(),
      success: z.boolean().optional(),
      timestamp: z.string().optional(),
    }),
    organization = apiObject({
      annual_revenue: z.string().optional(),
      cached: z.boolean(),
      ein: z.string().optional(),
      factual_reporting: z.string().optional(),
      funding_sources: apiArray(z.string()).optional(),
      funding_type: z.string().optional(),
      id: z.number().optional(),
      media_bias_rating: z.string().optional(),
      name: z.string(),
      normalized_name: z.string().optional(),
      org_type: z.string().optional(),
      parent_org: z.string().optional(),
      research_confidence: z.string().optional(),
      research_sources: apiArray(z.string()).optional(),
      wikipedia_url: z.string().optional(),
    }),
    organizationList = apiArray(organization),
    ownershipChainEntry = apiObject({
      cached: z.boolean(),
      name: z.string(),
    }),
    queueItem = apiObject({
      added_at: z.string(),
      article_id: z.number(),
      article_source: z.string(),
      article_title: z.string(),
      article_url: z.string(),
      position: z.number(),
      queue_type: z.enum(["daily", "permanent"]),
      read_status: z.enum(["unread", "reading", "completed"]),
    }),
    queueOverview = apiObject({
      completed_count: z.number(),
      daily_items: z.number(),
      estimated_total_read_time_minutes: z.number(),
      permanent_items: z.number(),
      reading_count: z.number(),
      total_items: z.number(),
      unread_count: z.number(),
    }),
    relatedArticle = apiObject({
      category: z.string().optional(),
      id: z.number(),
      image: z.string().optional(),
      publishedAt: z.string().optional(),
      similarity_score: z.number(),
      source: z.string(),
      sourceId: z.string(),
      summary: z.string().optional(),
      title: z.string(),
      url: z.string(),
    }),
    searchSuggestion = apiObject({
      cluster_id: z.number(),
      label: z.string(),
      relevance: z.number(),
    }),
    sourceBatchResult = z.union([z.lazy(() => sourceProfile), z.null()]),
    sourceCoverageStat = apiObject({ article_count: z.number() }),
    sourceCredibilityDataQuality = apiObject({
      completeness_pct: z.number(),
      dimensions_available: z.number(),
      dimensions_total: z.number(),
      last_updated: z.string().nullable(),
    }),
    sourceCredibilityDimension = apiObject({
      confidence: z.number(),
      dimension: z.string(),
      explanation: z.string(),
      provenance: apiArray(z.lazy(() => sourceCredibilityProvenance)),
      score: z.number().nullable(),
      signals_available: z.number(),
      signals_missing: z.number(),
      status: z.string(),
    }),
    sourceCredibilityProvenance = apiObject({
      source: z.string(),
      url: z.string(),
    }),
    sourceDebugFeedMetadata = apiObject({
      description: z.string(),
      generator: z.string(),
      language: z.string(),
      link: z.string(),
      title: z.string(),
      updated: z.string(),
    }),
    sourceDebugFeedStatus = apiObject({
      bozo: z.boolean(),
      bozo_exception: z.string(),
      entries_count: z.number(),
      http_status: z.union([z.number(), z.string()]),
    }),
    sourceDebugImageAnalysis = apiObject({
      entries_with_images: z.number(),
      image_sources: apiUnknownArray,
      total_entries: z.number(),
    }),
    sourceDebugParsedEntry = apiObject({
      author: z.string(),
      content_images: apiStringArray,
      description: z.string(),
      description_images: apiStringArray,
      has_images: z.boolean(),
      image_sources: apiUnknownArray,
      index: z.number(),
      link: z.string(),
      published: z.string(),
      raw_entry_keys: apiStringArray,
      tags: apiUnknownArray,
      title: z.string(),
    }),
    sourceFieldValue = apiObject({
      notes: z.string().optional(),
      sources: apiArray(z.string()).optional(),
      value: z.string(),
    }),
    sourceProfile = apiObject({
      fields: apiRecord(apiArray(sourceFieldValue)),
      name: z.string(),
    }),
    sourceStatsEntry = apiObject({
      article_count: z.number(),
      category: z.string(),
      country: z.string(),
      last_checked: z.string(),
      name: z.string(),
      status: z.enum(["success", "warning", "error"]),
      url: z.string(),
    }),
    thinkingStep = apiObject({
      content: z.string(),
      timestamp: z.string(),
      type: z.enum(["thought", "action", "tool_start", "observation", "answer"]),
    }),
    articleReference = apiObject({
      category: z.string().optional(),
      id: z.number(),
      image_url: z.string().optional(),
      published_at: z.string().optional(),
      source: z.string(),
      title: z.string(),
      url: z.string(),
    }),
    dossierSectionItem = apiObject({
      label: z.string().optional(),
      notes: z.string().optional(),
      sources: apiStringArray.optional(),
      value: z.string().optional(),
    }),
    dossierSection = apiObject({
      id: z.string(),
      items: apiArray(dossierSectionItem),
      status: z.enum(["available", "missing"]),
      title: z.string(),
    }),
    inlineDefinition = apiObject({
      definition: z.string().nullable().optional(),
      error: z.string().nullable().optional(),
    }),
    reporterProfile = apiObject({
      cached: z.boolean(),
      name: z.string(),
    }),
    reporterProfileList = apiArray(reporterProfile),
    researchResponse = apiObject({
      answer: z.string(),
      articles_searched: z.number().default(apiNumericConstants.zero),
      error: z.string().optional(),
      query: z.string(),
      referenced_articles: apiArray(BackendArticleSchema).optional(),
      success: z.boolean(),
      thinking_steps: apiArray(thinkingStep),
    }),
    wikiAnalysisAxis = apiObject({
      axis_name: z.string(),
      citations: apiArray(z.lazy(() => wikiAxisCitation)).optional(),
      confidence: z.string().optional(),
      empirical_basis: z.string().optional(),
      last_scored_at: z.string().optional(),
      prose_explanation: z.string().optional(),
      score: z.number(),
      scored_by: z.string().optional(),
    }),
    wikiCitation = apiObject({
      label: z.string(),
      note: z.string().optional(),
      snippet: z.string().optional(),
      title: z.string().optional(),
      url: z.string().optional(),
    }),
    wikiAxisCitation = apiObject({
      label: z.string().optional(),
      note: z.string().optional(),
      snippet: z.string().optional(),
      title: z.string().optional(),
      url: z.string().optional(),
    }),
    wikiOwnershipEntry = apiObject({
      name: z.string(),
      ownership_percentage: z.number().optional(),
    }),
    wikiReporterCard = apiObject({
      article_count: z.number(),
      id: z.number(),
      name: z.string(),
    }),
    wikiReporterRecentArticle = apiObject({
      category: z.string().optional(),
      id: z.number().optional(),
      image_url: z.string().nullable().optional(),
      published_at: z.string().nullable().optional(),
      source: z.string().optional(),
      title: z.string().optional(),
      url: z.string().optional(),
    }),
    wikiReporter = apiObject({
      article_count: z.number(),
      citations: apiArray(wikiCitation),
      dossier_sections: apiArray(dossierSection),
      id: z.number(),
      name: z.string(),
      recent_articles: apiArray(wikiReporterRecentArticle),
    }),
    wikiReporterCards = apiArray(wikiReporterCard),
    wikiSourceCard = apiObject({ name: z.string() }),
    wikiSourceProfile = apiObject({
      analysis_axes: apiArray(wikiAnalysisAxis),
      article_count: z.number(),
      citations: apiArray(wikiCitation),
      dossier_sections: apiArray(dossierSection),
      geographic_focus: apiStringArray,
      name: z.string(),
      ownership_chain: apiArray(wikiOwnershipEntry),
      reporters: apiArray(wikiReporterCard),
      topic_focus: apiStringArray,
    }),
    wikiSourceCards = apiArray(wikiSourceCard),
    wikiIndexTrigger = apiObject({
      message: z.string(),
      status: z.string(),
    }),
    wikiIndexStatus = apiObject({
      by_status: apiRecord(z.number()),
      by_type: apiRecord(z.number()),
      total_entries: z.number(),
    });

  return {
    addRss: apiObject({
      article_count: z.number(),
      name: z.string(),
      status: z.string(),
      success: z.boolean(),
      url: z.string(),
    }),
    articleAnalysis,
    articleCounts: articleCount,
    articleReferences: apiArray(articleReference),
    articleTopics: apiObject({
      article_id: z.number(),
      topics: apiArray(articleTopic),
    }),
    bookmark: bookmarkEntry,
    bookmarks: apiObject({ bookmarks: apiArray(bookmarkEntry) }),
    bulkArticleTopics: apiObject({
      articles: apiRecord(apiArray(articleTopic)),
    }),
    cacheStatus,
    categories: z.union([apiStringArray, categoryObject]),
    countryEconomicProfile,
    countryGeoData: apiObject({
      countries: apiRecord(countryGeoCountry),
      total: z.number(),
    }),
    countryList: apiObject({
      countries: apiArray(countryListItem),
      total_countries: z.number(),
    }),
    debugErrors: apiObject({
      include_request_stream_events: z.boolean(),
      log_file: debugLogFile,
      recent_request_stream_errors: apiArray(debugErrorEntry),
      returned_recent_errors: z.number(),
    }),
    errorBody: apiObject({ detail: z.string().optional() }),
    gdeltArticleEvents: apiObject({
      article_id: z.number(),
      events: apiArray(gdeltArticleEvent),
      total_external_events: z.number(),
    }),
    gdeltStats: apiObject({
      match_breakdown: gdeltStatsBreakdown,
      matched_events: z.number(),
      match_rate: z.number(),
      top_articles_by_coverage: apiArray(gdeltStatsArticle),
      total_events: z.number(),
      window_hours: z.number(),
    }),
    highlight,
    highlights,
    inlineDefinition,
    languageDiagnostics: apiObject({
      article_url: z.string(),
      sentence_count: z.number(),
      success: z.boolean(),
      word_count: z.number(),
    }),
    liked: likedEntry,
    likedArticles: apiObject({ liked: apiArray(likedEntry) }),
    llmLogs: apiObject({
      available: z.boolean(),
      entries: apiArray(llmLogEntry),
      path: z.string(),
      returned: z.number(),
      total: z.number(),
    }),
    localLens: apiObject({
      articles: apiArray(BackendArticleSchema),
      country_code: z.string(),
      has_more: z.boolean(),
      limit: z.number(),
      offset: z.number(),
      returned: z.number(),
      total: z.number(),
      view: z.enum(["internal", "external"]),
      view_description: z.string(),
    }),
    noveltyScore: apiObject({
      article_id: z.number(),
      avg_similarity_to_history: z.number(),
      history_size: z.number(),
      max_similarity_to_history: z.number(),
      novelty_score: z.number(),
    }),
    organization,
    organizationList,
    ownershipChain: apiObject({
      chain: apiArray(ownershipChainEntry),
      depth: z.number(),
      organization: z.string(),
    }),
    queueDigest: apiObject({
      digest_items: apiArray(queueItem),
      estimated_read_time_minutes: z.number(),
      generated_at: z.string(),
      total_items: z.number(),
    }),
    queueItemContent: apiObject({
      article_source: z.string(),
      article_title: z.string(),
      article_url: z.string(),
      full_text: z.string(),
      id: z.number(),
      read_status: z.string(),
    }),
    queueOverview,
    queueResponse: apiObject({
      daily_count: z.number(),
      items: apiArray(queueItem),
      permanent_count: z.number(),
      total_count: z.number(),
    }),
    readingQueueItem: queueItem,
    readingShelf: apiObject({ name: z.string() }),
    readingShelves: apiArray(apiObject({ name: z.string() })),
    relatedArticles: apiObject({
      article_id: z.number(),
      related: apiArray(relatedArticle),
      total: z.number(),
    }),
    reporterProfile,
    reporterProfileList,
    research: apiObject({
      answer: z.string(),
      articles_searched: z.number(),
      query: z.string(),
      success: z.boolean(),
      thinking_steps: apiArray(thinkingStep),
    }),
    researchResponse,
    rssValidation: apiObject({
      article_count: z.number(),
      name: z.string(),
      status: z.string(),
      success: z.boolean(),
      url: z.string(),
    }),
    searchSuggestions: apiObject({ query: z.string(), suggestions: apiArray(searchSuggestion) }),
    sourceBatch: apiObject({
      cached_count: z.number(),
      newly_researched_count: z.number(),
      results: apiRecord(sourceBatchResult),
    }),
    sourceCoverage: apiObject({
      global_article_count: z.number(),
      sources: apiRecord(sourceCoverageStat),
    }),
    sourceCredibility: apiObject({
      data_quality: sourceCredibilityDataQuality,
      dimensions: apiRecord(sourceCredibilityDimension),
      domain: z.string(),
      status: z.string(),
    }),
    sourceDebug: apiObject({
      cached_articles: apiOpaqueObjectList,
      debug_timestamp: z.string(),
      feed_metadata: sourceDebugFeedMetadata,
      feed_status: sourceDebugFeedStatus,
      image_analysis: sourceDebugImageAnalysis,
      parsed_entries: apiArray(sourceDebugParsedEntry),
      rss_url: z.string(),
      source_config: apiOpaqueObject.nullable(),
      source_name: z.string(),
    }),
    sourceProfile,
    sourceStats: apiObject({ sources: apiArray(sourceStatsEntry) }),
    streamStatus: apiRecord(z.unknown()),
    wikiIndexStatus,
    wikiIndexTrigger,
    wikiReporter,
    wikiReporterCards,
    wikiSourceCards,
    wikiSourceProfile,
  };
})(),
apiCache: ApiCacheState = { articles: [], sources: [] },
readResponseError = async (response: Readonly<Response>): Promise<string> => {
  const rawBody: unknown = await response.json().catch(() => {}),
   parsed = zApiResponseSchemas.errorBody.safeParse(rawBody);
  if (parsed.success && parsed.data.detail !== undefined) {
    return parsed.data.detail;
  }
  return `HTTP ${response.status}`;
},
parseResponseJson = async <T>(
  response: Readonly<Response>,
  schema: Readonly<z.ZodType<T>>,
): Promise<T> => {
  const payload: unknown = await response.json();
  return schema.parse(payload);
},
addToReadingQueue = async (
  article: Readonly<NewsArticle>,
  queueType: "daily" | "permanent" = "daily",
): Promise<ReadingQueueItem> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/queue/add`, {
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

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.readingQueueItem);
    logger.debug("Article added to reading queue:", data);
    return data;
  } catch (error) {
    console.error("Failed to add article to reading queue:", error);
    throw error;
  }
},
analyzeArticle = async (
  url: string,
  sourceName?: string,
): Promise<ArticleAnalysis> => {
  try {
    logger.debug(`Analyzing article: ${url}`);
    const response = await fetch(`${resolvedApiBaseUrl}/api/article/analyze`, {
      body: JSON.stringify({
        source_name: sourceName,
        url,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.articleAnalysis);
    logger.debug("Article analysis complete:", data);
    return data;
  } catch (error) {
    console.error("Failed to analyze article:", error);
    throw error;
  }
},
analyzeMaterialContext = async (
  source: string,
  sourceCountry: string,
  mentionedCountries:readonly  string[],
  topics?:readonly  string[],
  articleText?: string,
): Promise<MaterialContext> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/material-context`,
    {
      body: JSON.stringify({
        article_text: articleText,
        mentioned_countries: mentionedCountries,
        source,
        source_country: sourceCountry,
        topics,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const payload: unknown = await response.json(),
   parsed = MaterialContextSchema.parse(payload);
  parsed satisfies OpenApiMaterialContextResponse;
  return parsed;
},
appendQueryParameter = (query: URLSearchParams, parameter: QueryParameter): void => {
  const { key, value } = parameter;
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value === "string" && value.length === 0) {
    return;
  }
  query.set(key, String(value));
},
buildQueryParameters = (
  parameters: readonly QueryParameter[],
): URLSearchParams => {
  const query = new URLSearchParams();
  parameters.forEach((parameter) => { appendQueryParameter(query, parameter); });
  return query;
},
appendQueryString = (query: string): string => {
  if (query.length === apiNumericConstants.zero) {return "";}
  return `?${query}`;
},
applyBrowserProtocol = (url: Readonly<URL>, protocol: string): URL => {
  const mutableUrl = new URL(url.toString());
  mutableUrl.protocol = protocol;
  if (protocol === "https:") {
    mutableUrl.port = "";
    return mutableUrl;
  }
  if (mutableUrl.port.length === apiNumericConstants.zero) {
    mutableUrl.port = DEFAULT_BACKEND_PORT;
  }
  return mutableUrl;
},
buildBlindspotViewerQuery = (
  params?: Readonly<BlindspotViewerParams>,
): string => {
  const searchParams = new URLSearchParams(),
   category = resolveBlindspotCategory(params?.category),
   parameters: readonly QueryParameter[] = [
    { key: "lens", value: params?.lens },
    { key: "window", value: params?.window },
    { key: "category", value: category },
    { key: "sources", value: params?.sources },
    { key: "per_lane", value: params?.perLane },
  ];
  parameters.forEach((parameter) =>{  appendQueryParameter(searchParams, parameter); });
  return searchParams.toString();
},
buildDatabaseDebugQuery = (params?: Readonly<DatabaseDebugParams>): URLSearchParams => {
  const searchParams = new URLSearchParams(),
   parameters: readonly QueryParameter[] = [
    { key: "limit", value: params?.limit },
    { key: "offset", value: params?.offset },
    { key: "source", value: params?.source },
    { key: "missing_embeddings_only", value: params?.missing_embeddings_only },
    { key: "sort_direction", value: params?.sort_direction },
    { key: "published_before", value: params?.published_before },
    { key: "published_after", value: params?.published_after },
  ];
  parameters.forEach((parameter) =>{  appendQueryParameter(searchParams, parameter); });
  return searchParams;
},
buildNewsArticle = (
  article: ReadonlyBackendArticle,
  mapping: Readonly<BackendArticleMapping>,
): NewsArticle => (
  {
    _parsedTimestamp: resolveParsedTimestamp(mapping.published),
    author: mapping.author,
    authors: mapping.authors,
    bias: mapping.bias,
    category: mapping.category,
    content: mapping.content,
    country: mapping.country,
    credibility: mapping.credibility,
    geo_signal: mapping.geoSignal,
    hasFullContent: hasArticleContent(article),
    id: mapping.resolvedId,
    image: mapping.image,
    isPersisted: mapping.isPersisted,
    mentioned_countries: mapping.mentionedCountries,
    originalLanguage: article.original_language ?? "en",
    publishedAt: mapping.published,
    source: mapping.sourceName,
    sourceId: mapping.normalizedSourceId,
    source_country: mapping.sourceCountry,
    summary: mapping.summary || "No description",
    tags: [mapping.category, mapping.sourceName],
    title: article.title ?? "No title",
    translated: article.translated ?? false,
    url: mapping.url,
  }
),
buildNewsRequestUrl = (params?: Readonly<FetchNewsParams>): string => {
  const searchParams = new URLSearchParams({ use_cache: "true" });
  if (params?.limit !== undefined) {
    searchParams.set("limit", String(params.limit));
  }
  if (params?.category !== undefined && params.category.length > 0) {
    searchParams.set("category", params.category);
  }
  const query = searchParams.toString();
  if (query.length === apiNumericConstants.zero) {
    return `${resolvedApiBaseUrl}/news/stream`;
  }
  return `${resolvedApiBaseUrl}/news/stream?${query}`;
},
buildPageQuery = (params: Readonly<PageQueryParams>): string => {
  const query = new URLSearchParams(),
   parameters: readonly QueryParameter[] = [
    { key: "limit", value: params.limit },
    { key: "offset", value: params.offset },
    { key: "cursor", value: params.cursor },
    { key: "category", value: params.category },
    {
      key: resolveSourceParameterKey(params),
      value: resolveSourceParameter(params),
    },
    { key: "search", value: params.search },
  ];
  parameters.forEach((parameter) =>{  appendQueryParameter(query, parameter); });
  return query.toString();
},
buildPageUrl = (path: string, params: Readonly<PageQueryParams>): string => {
  const query = buildPageQuery(params);
  if (query.length === 0) {return `${resolvedApiBaseUrl}${path}`;}
  return `${resolvedApiBaseUrl}${path}?${query}`;
},
buildSemanticSearchUrl = (
  query: string,
  options?: SemanticSearchOptions,
): string => {
  const params = new URLSearchParams({ query });
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options?.category !== undefined && options.category.length > apiNumericConstants.zero) {
    params.set("category", options.category);
  }
  const queryString = params.toString();
  if (queryString.length === apiNumericConstants.zero) {
    return `${resolvedApiBaseUrl}/api/search/semantic`;
  }
  return `${resolvedApiBaseUrl}/api/search/semantic?${queryString}`;
},
buildSourceDebugUrl = (sourceName: string): string => {
  let decodedSourceName: string;
  try {
    decodedSourceName = decodeURIComponent(sourceName);
  } catch {
    decodedSourceName = sourceName;
  }
  return `${resolvedApiBaseUrl}/debug/sources/${encodeURIComponent(decodedSourceName)}`;
},
buildStreamUrl = (options: Readonly<StreamOptions>): string => {
  const params = new URLSearchParams({
    use_cache: String(options.useCache ?? true),
  });
  if (options.category) {
    params.set("category", options.category);
  }
  return `${resolvedApiBaseUrl}/news/stream?${params.toString()}`;
},
cacheOgImage = (
  url: string,
  imageUrl: string | null,
  ttlMs: number,
): string | null => {
  ogImageCache.set(url, {
    expiresAt: Date.now() + ttlMs,
    imageUrl,
  });
  return imageUrl;
},
checkSourceProfileCache = async (
  name: string,
  website?: string,
): Promise<SourceResearchProfile | null> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/source/profile?cache_only=true`,
    {
      body: JSON.stringify({ name, website }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (response.status === HTTP_NOT_FOUND_STATUS) {
    return A_NULL_VALUE;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return parseResponseJson(response, zApiResponseSchemas.sourceProfile);
},
connectAndPumpStream = async (
  sseUrl: string,
  signal: Readonly<AbortSignal> | undefined,
  rt: Readonly<StreamRuntime>,
): Promise<void> => {
  const abortController = new AbortController();
  Object.assign(rt, { abort: () => { abortController.abort(); } });
  if (signal !== undefined) {
    if (signal.aborted) {
      rt.abort();
      streamResolve(rt, ["Aborted before connection"]);
      return;
    }
    signal.addEventListener("abort", rt.abort, { once: true });
  }
  const response = await fetch(sseUrl, {
    headers: { Accept: "text/event-stream" },
    method: "GET",
    signal: abortController.signal,
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
  installStreamTimers(rt);
  await pumpStreamEvents(rt, response.body.getReader());
},
consumeCacheRefreshStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  onProgress?: (progress: CacheRefreshProgress) => void,
): Promise<boolean> => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return true;
    }
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      const result = processCacheRefreshLine(line, onProgress);
      if (result !== undefined) {
        return result;
      }
    }
  }
},
createBookmark = async (
  articleId: number,
): Promise<BookmarkEntry | null> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/bookmarks`, {
      body: JSON.stringify({ article_id: articleId }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
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
},
createHighlight = async (
  highlight: Readonly<Highlight>,
): Promise<Highlight> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/queue/highlights`, {
      body: JSON.stringify(highlight),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.highlight);
    logger.debug("Highlight created:", data);
    return data;
  } catch (error) {
    console.error("Failed to create highlight:", error);
    throw error;
  }
},
createLikedArticle = async (
  articleId: number,
): Promise<LikedEntry | null> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/liked`, {
      body: JSON.stringify({ article_id: articleId }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Failed to like article. Status: ${response.status}`);
    }

    return await fetchLikedArticles().then(
      (liked) => liked.find((entry) => entry.articleId === articleId) ?? A_NULL_VALUE,
    );
  } catch (error) {
    console.error("Failed to like article:", error);
    throw error;
  }
},
createReadingShelf = async (request: Readonly<{
  name: string;
  description?: string | null;
}>): Promise<ReadingShelf> => {
  const response = await fetch(`${resolvedApiBaseUrl}/api/queue/shelves`, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }
  return parseResponseJson(response, zApiResponseSchemas.readingShelf);
},
createSourceDebugFallback = (
  sourceName: string,
  options: Readonly<SourceDebugFallbackOptions>,
): SourceDebugData => (
  {
    cached_articles: [],
    debug_timestamp: new Date().toISOString(),
    error: options.error,
    feed_metadata: {
      description: "",
      generator: "",
      language: "",
      link: "",
      title: "",
      updated: "",
    },
    feed_status: {
      bozo: false,
      bozo_exception: options.bozoException,
      entries_count: 0,
      http_status: options.httpStatus,
    },
    image_analysis: {
      entries_with_images: 0,
      image_sources: [],
      total_entries: 0,
    },
    parsed_entries: [],
    rss_url: "",
    source_config: null,
    source_name: sourceName,
    source_statistics: null,
  }
),
createStreamRuntime = (
  options: Readonly<StreamOptions>,
  resolve: StreamResolveHandler,
  reject: StreamRejectHandler,
): StreamRuntime => {
  const articles: NewsArticle[] = [],
   sources = new Set<string>(),
   errors: string[] = [];
  return {
    abort: () => {},
    addArticles: (...newArticles) => { articles.push(...newArticles); },
    addError: (error) => { errors.push(error); },
    addSource: (source) => { sources.add(source); },
    articles,
    clearTimers: () => {},
    errors,
    hasReceivedData: false,
    lastMessageTime: Date.now(),
    onError: options.onError,
    onProgress: options.onProgress,
    onSourceComplete: options.onSourceComplete,
    reject,
    resolve,
    settled: false,
    sources,
    streamId: undefined,
  };
},
deleteBookmark = async (articleId: number): Promise<boolean> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/bookmarks/${articleId}`, {
      method: "DELETE",
    });

    if (response.status === HTTP_NOT_FOUND_STATUS) {
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
},
deleteHighlight = async (highlightId: number): Promise<void> => {
  try {
    const response = await fetch(
      `${resolvedApiBaseUrl}/api/queue/highlights/${highlightId}`,
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
},
deleteLikedArticle = async (articleId: number): Promise<boolean> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/liked/${articleId}`, {
      method: "DELETE",
    });

    if (response.status === HTTP_NOT_FOUND_STATUS) {
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
},
dispatchStreamEvent = (
  data: Readonly<StreamEvent>,
  rt: Readonly<StreamRuntime>,
): void => {
  if (data.stream_id !== undefined && rt.streamId === undefined) {
    Object.assign(rt, { streamId: data.stream_id });
  }
  logger.debug(`Stream event [${data.status}]:`, {
    articlesCount: data.articles?.length,
    message: data.message,
    progress: data.progress,
    source: data.source,
    streamId: data.stream_id,
  });
  streamEventHandlers[data.status](data, rt);
},
fetchAllClusters = async (
  window: "1d" | "1w" | "1m" = "1d",
  minArticles: number = apiNumericConstants.two,
  limit: number = apiNumericConstants.hundred,
): Promise<AllClustersResponse> => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    min_articles: minArticles.toString(),
    window,
  }),

   response = await fetch(`${resolvedApiBaseUrl}/trending/clusters?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json(),
   parsed = AllClustersResponseSchema.parse(payload);
  parsed satisfies OpenApiAllClustersResponse;
  return parsed;
},
fetchArticleCountsByCountry = async (): Promise<CountryArticleCounts> => {
  const response = await fetch(`${resolvedApiBaseUrl}/news/by-country?hours=24`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.articleCounts);
},
fetchArticleTopics = async (
  articleId: number,
): Promise<ArticleTopicsResponse> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/api/similarity/article-topics/${articleId}`,
  );
  if (response.status === HTTP_SERVICE_UNAVAILABLE_STATUS) {
    throw new Error("Topic lookup unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.articleTopics);
},
fetchArticlesBySource = async (
  sourceId: string,
): Promise<NewsArticle[]> => {
  if (apiCache.articles.length === 0) {
    apiCache.articles = await fetchNews({ limit: 3000 });
  }
  return apiCache.articles.filter((article) => article.sourceId === sourceId);
},
fetchBlindspotViewer = async (
  params?: Readonly<BlindspotViewerParams>,
): Promise<BlindspotViewerResponse> => {
  const querySuffix = appendQueryString(buildBlindspotViewerQuery(params)),
   response = await fetch(
    `${resolvedApiBaseUrl}/blindspots/viewer${querySuffix}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const payload: unknown = await response.json();
  return BlindspotViewerResponseSchema.parse(payload);
},
fetchBookmark = async (
  articleId: number,
): Promise<BookmarkEntry | null> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/bookmarks/${articleId}`);
    if (response.status === HTTP_NOT_FOUND_STATUS) {
      return A_NULL_VALUE;
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.bookmark),
     [article] = mapBackendArticles([data]);
    if (article === undefined) {
      throw new Error("Bookmark response did not contain an article");
    }
    return {
      article,
      articleId: data.article_id,
      bookmarkId: data.bookmark_id,
      createdAt: data.created_at,
    };
  } catch (error) {
    console.error("Failed to fetch bookmark:", error);
    return A_NULL_VALUE;
  }
},
fetchBookmarks = async (): Promise<BookmarkEntry[]> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/bookmarks`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.bookmarks),
     {bookmarks} = data,
     mappedArticles = mapBackendArticles(bookmarks);

    return mappedArticles.flatMap((article, index) => {
      const bookmark = bookmarks[index];
      if (bookmark === undefined) {
        return [];
      }
      return [{
        article,
        articleId: bookmark.article_id,
        bookmarkId: bookmark.bookmark_id,
        createdAt: bookmark.created_at,
      }];
    });
  } catch (error) {
    const normalizedError = (() => {
      if (error instanceof Error) {
        return error;
      }
      return new Error(String(error));
    })();
    if (isLikelyNetworkError(normalizedError)) {
      logger.warn("Bookmarks are unavailable because the backend is unreachable.")
    } else {
      console.error("Failed to fetch bookmarks:", error);
    }
    return [];
  }
},
fetchBreaking = async (
  limit: number = apiNumericConstants.five,
): Promise<BreakingResponse> => {
  const params = new URLSearchParams({
    limit: limit.toString(),
  }),

   response = await fetch(`${resolvedApiBaseUrl}/trending/breaking?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json(),
   parsed = BreakingResponseSchema.parse(payload);
  parsed satisfies OpenApiBreakingResponse;
  return parsed;
},
fetchBrowseIndex = (
  params: BrowseIndexParams = {},
): Promise<BrowseIndexResponse> => fetchBrowseIndexAtPath("/news/index", params, "BrowseIndex"),
fetchBrowseIndexAtPath = async (
  path: string,
  params: Readonly<BrowseIndexParams>,
  label: string,
): Promise<BrowseIndexResponse> => {
  const url = buildPageUrl(path, params);
  logger.debug(`[${label}] Fetching browse index: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  const parsed = PaginatedPayloadSchema.safeParse(await response.json());
  if (!parsed.success) {throw new Error("Browse index response is invalid.");}
  return {
    articles: mapBackendArticles(parsed.data.articles ?? []),
    total: parsed.data.total ?? 0,
  };
},
fetchBulkArticleTopics = async (
  articleIds:readonly  number[],
): Promise<BulkArticleTopicsResponse> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/api/similarity/bulk-article-topics`,
    {
      body: JSON.stringify(articleIds),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  if (response.status === HTTP_SERVICE_UNAVAILABLE_STATUS) {
    throw new Error("Topic lookup unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.bulkArticleTopics);
},
fetchCacheDebugArticles = async (params?:Readonly< {
  limit?: number;
  offset?: number;
  source?: string;
}>): Promise<CacheDebugResponse> => {
  const searchParams = new URLSearchParams();
  if (params?.limit) {searchParams.append("limit", String(params.limit));}
  if (params?.offset) {searchParams.append("offset", String(params.offset));}
  if (params?.source) {searchParams.append("source", params.source);}
  return fetchDebugParsed(
    "/debug/cache/articles",
    CacheDebugResponseSchema,
    "Failed to fetch cache debug data",
    searchParams,
  )
},
fetchCacheDelta = async (params?:Readonly< {
  sample_limit?: number;
  sample_offset?: number;
  source?: string;
  sample_preview_limit?: number;
}>): Promise<CacheDeltaResponse> => {
  const searchParams = buildQueryParameters([
    { key: "sample_limit", value: params?.sample_limit },
    { key: "sample_offset", value: params?.sample_offset },
    { key: "sample_preview_limit", value: params?.sample_preview_limit },
    { key: "source", value: params?.source },
  ]);
  return fetchDebugParsed(
    "/debug/cache/delta",
    CacheDeltaResponseSchema,
    "Failed to fetch cache delta",
    searchParams,
  )
},
fetchCacheStatus = async (): Promise<CacheStatus | null> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/cache/status`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return parseResponseJson(response, zApiResponseSchemas.cacheStatus);
  } catch (error) {
    console.error("Failed to fetch cache status:", error);
    return null;
  }
},
fetchCachedNewsPaginated = async (
  params: CachedPaginationParams = {},
): Promise<PaginatedResponse> => ({
  ...(await fetchPaginated("/news/page/cached", params, "CachedPagination")),
  prev_cursor: null,
}),
fetchCategories = async (): Promise<string[]> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/categories`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.categories);
    // Backend returns { categories: [...] }
    if (Array.isArray(data)) {
      return data;
    }
    return data.categories;
  } catch (error) {
    console.error("Failed to fetch categories:", error);
    return [];
  }
},
fetchChromaDebugArticles = async (params?: Readonly<{
  limit?: number;
  offset?: number;
}>): Promise<ChromaDebugResponse> => {
  const searchParams = new URLSearchParams();
  if (params?.limit) {searchParams.append("limit", String(params.limit));}
  if (params?.offset) {searchParams.append("offset", String(params.offset));}
  return fetchDebugParsed(
    "/debug/chromadb/articles",
    ChromaDebugResponseSchema,
    "Failed to fetch Chroma debug data",
    searchParams,
  )
},
fetchClusterArticles = async (
  clusterId: number,
): Promise<NewsArticle[]> => {
  const detail = await fetchClusterDetail(clusterId);

  return detail.articles.map((article) => ({
    author: article.author || undefined,
    authors: article.authors ?? [],
    bias: getBiasFromSource(article.source),
    category: "general",
    country: getCountryFromSource(article.source),
    credibility: getCredibilityFromSource(article.source),
    id: article.id,
    image: article.image_url || "",
    isPersisted: true,
    originalLanguage: "en",
    publishedAt: article.published_at || new Date().toISOString(),
    source: article.source,
    sourceId:
      article.source_id?.trim().toLowerCase() ||
      article.source.toLowerCase().replaceAll(/\s+/gu, "-"),
    summary: article.summary || "No description",
    tags: [article.source].filter(Boolean),
    title: article.title,
    translated: false,
    url: article.url,
  }));
},
fetchClusterContradictions = async (
  clusterId: number,
): Promise<ContradictionPanelResponse> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/trending/clusters/${clusterId}/contradictions`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json();
  return ContradictionPanelResponseSchema.parse(payload);
},
fetchClusterDetail = async (
  clusterId: number,
): Promise<ClusterDetail> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/trending/clusters/${clusterId}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json(),
   parsed = ClusterDetailSchema.parse(payload);
  parsed satisfies OpenApiClusterDetailResponse;
  return parsed;
},
fetchClusterLineage = async (
  clusterId: number,
): Promise<StoryLineageResponse> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/trending/clusters/${clusterId}/lineage`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json();
  return StoryLineageResponseSchema.parse(payload);
},
fetchCountryGeoData = async (): Promise<CountryGeoData> => {
  const response = await fetch(`${resolvedApiBaseUrl}/news/countries/geo`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.countryGeoData);
},
fetchCountryList = async (): Promise<CountryListResponse> => {
  const response = await fetch(`${resolvedApiBaseUrl}/news/countries/list`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.countryList);
},
fetchCountryPickerItems = async (): Promise<CountryPickerItem[]> => {
  const [countryList, geoData] = await Promise.all([
    fetchCountryList(),
    fetchCountryGeoData(),
  ]);

  return countryList.countries.map((country) => ({
    article_count: country.article_count,
    code: country.code,
    heat_count: 0,
    latest_article: country.latest_article,
    name: geoData.countries[country.code]?.name ?? country.code,
    source_count: country.article_count,
  }));
},
fetchDatabaseDebugArticles = async (
  params?: Readonly<DatabaseDebugParams>,
): Promise<DatabaseDebugResponse> => {
  const searchParams = buildDatabaseDebugQuery(params);
  return fetchDebugParsed(
    "/debug/database/articles",
    DatabaseDebugResponseSchema,
    "Failed to fetch database debug data",
    searchParams,
  )
},
fetchDebugErrors = async (
  options: Readonly<{
    limit?: number;
    offset?: number;
    includeRequestStreamEvents?: boolean;
  }> = {},
): Promise<DebugErrorsResponse> => {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {params.set("limit", String(options.limit));}
  if (options.offset !== undefined) {params.set("offset", String(options.offset));}
  if (options.includeRequestStreamEvents !== undefined) {
    params.set("include_request_stream_events", String(options.includeRequestStreamEvents));
  }

  const response = await fetch(
    withDebugQuery("/debug/logs/errors", params),
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.debugErrors);
},
fetchDebugJson = async <T>(
  path: string,
  errorMessage: string,
  schema: Readonly<z.ZodType<T>>,
  searchParams?: Readonly<URLSearchParams>,
): Promise<T> => {
  const response = await fetch(withDebugQuery(path, searchParams));
  if (!response.ok) {
    throw new Error(`${errorMessage} (${response.status})`);
  }
  return parseResponseJson(response, schema);
},
fetchDebugParsed = async <T>(
  path: string,
  schema: Readonly<z.ZodType<T>>,
  errorMessage: string,
  searchParams?: Readonly<URLSearchParams>,
): Promise<T> => fetchDebugJson(path, errorMessage, schema, searchParams),
fetchGdeltArticleEvents = async (
  articleId: number,
  limit: number = apiNumericConstants.fifty,
): Promise<GdeltArticleEventsResponse> => {
  const params = new URLSearchParams({ limit: String(limit) }),
   response = await fetch(
    `${resolvedApiBaseUrl}/gdelt/article/${articleId}?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.gdeltArticleEvents);
},
fetchGdeltStats = async (
  hours: number = apiNumericConstants.twentyFour,
): Promise<GdeltStatsResponse> => {
  const params = new URLSearchParams({ hours: String(hours) }),
   response = await fetch(`${resolvedApiBaseUrl}/gdelt/stats?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.gdeltStats);
},
fetchInlineDefinition = async (
  term: string,
  context?: string,
): Promise<{ definition?: string | null; error?: string | null }> => {
  // Backwards-compatible wrapper around requestInlineDefinition
  const res = await requestInlineDefinition(term, context);
  return { definition: res.definition ?? A_NULL_VALUE, error: res.error ?? A_NULL_VALUE };
},
fetchLanguageDiagnostics = async ({
  url,
  text,
  title,
  sourceName,
}:Readonly< {
  url: string;
  text?: string;
  title?: string;
  sourceName?: string;
}>): Promise<LanguageDiagnostics> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/article/language-diagnostics`, {
      body: JSON.stringify({
        source_name: sourceName,
        text,
        title,
        url,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return parseResponseJson(response, zApiResponseSchemas.languageDiagnostics);
  } catch (error) {
    console.error("Failed to analyze article language:", error);
    throw error;
  }
},
fetchLikedArticles = async (): Promise<LikedEntry[]> => {
  const response = await fetch(`${resolvedApiBaseUrl}/api/liked`);
  if (!response.ok) {
    throw new Error(`Failed to load liked articles (${response.status})`);
  }

  const data = await parseResponseJson(response, zApiResponseSchemas.likedArticles),
   {liked} = data,
   mappedArticles = mapBackendArticles(liked);

  return mappedArticles.flatMap((article, index) => {
    const likedEntry = liked[index];
    if (likedEntry === undefined) {
      return [];
    }
    return [{
      article,
      articleId: likedEntry.article_id,
      createdAt: likedEntry.created_at,
      likedId: likedEntry.liked_id,
    }];
  });
},
fetchLiveBrowseIndex = (
  params: BrowseIndexParams = {},
): Promise<BrowseIndexResponse> => fetchBrowseIndexAtPath("/news/index/cached", params, "LiveBrowseIndex"),
fetchLlmLogs = async (
  options: Readonly<{
    limit?: number;
    offset?: number;
    service?: string;
    success?: boolean;
  }> = {},
): Promise<LlmLogResponse> => {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {params.set("limit", String(options.limit));}
  if (options.offset !== undefined) {params.set("offset", String(options.offset));}
  if (options.service !== undefined && options.service.length > 0) {
    params.set("service", options.service);
  }
  if (options.success !== undefined) {params.set("success", String(options.success));}

  const response = await fetch(
    withDebugQuery("/debug/logs/llm", params),
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.llmLogs);
},
fetchNews = async (params?: Readonly<FetchNewsParams>): Promise<NewsArticle[]> => {
  try {
    const url = buildNewsRequestUrl(params);
    logger.debug(`Fetching news from unified endpoint: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: unknown = await response.json();
    logger.debug("Backend response:", data);
    const backendArticles = parseNewsPayload(data);
    if (backendArticles.length === 0) {
      logger.debug("No articles received from backend. Full response:", JSON.stringify(data, null, 2));
    } else {
      logger.debug(
        `Received ${backendArticles.length} articles from unified backend endpoint`,
      );
    }
    const articles = filterNewsArticles(mapBackendArticles(backendArticles), params);
    if (articles.length === 0) {
      logger.debug("No articles to return after processing. Params:", params);
    }
    return articles;
  } catch (error) {
    console.error("Failed to fetch news from unified endpoint:", error);
    throw error;
  }
},
fetchNewsByCategory = async (
  category: string,
): Promise<NewsArticle[]> =>
  fetchNews({ category })
,
fetchNewsForCountry = async (
  code: string,
  view: "internal" | "external" = "internal",
  limit: number = apiNumericConstants.fifty,
  offset: number = apiNumericConstants.zero,
  hours?: number,
): Promise<LocalLensResponse> => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    view,
  });
  if (hours !== undefined) {
    params.set("hours", hours.toString());
  }

  const response = await fetch(
    `${resolvedApiBaseUrl}/news/country/${normalizeCountryCode(code)}?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await parseResponseJson(response, zApiResponseSchemas.localLens);

  return {
    ...data,
    articles: mapBackendArticles(data.articles),
  };
},
fetchNewsFromSource = async (
  sourceId: string,
): Promise<NewsArticle[]> => {
  // Refactored to use the main fetchNews function for consistency
  const allArticles = await fetchNews();
  return allArticles.filter((article) => article.sourceId === sourceId);
},
fetchNewsPaginated = (
  params: PaginationParams = {},
): Promise<PaginatedResponse> => fetchPaginated("/news/page", params, "Pagination"),
fetchNoveltyScore = async (
  articleId: number,
  readingHistory: readonly number[],
): Promise<NoveltyScoreResponse> => {
  const response = await fetch(`${resolvedApiBaseUrl}/api/similarity/novelty-score`, {
    body: JSON.stringify({
      article_id: articleId,
      reading_history: readingHistory,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (response.status === HTTP_SERVICE_UNAVAILABLE_STATUS) {
    throw new Error("Novelty scoring unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.noveltyScore);
},
fetchOGImage = async (url: string): Promise<string | null> => {
  const now = Date.now();
  ogImageMetrics.total += 1;
  const cachedImage = readCachedOgImage(url, now);
  if (cachedImage !== undefined) {
    return cachedImage;
  }

  const inFlight = ogImageInFlight.get(url);
  if (inFlight) {
    ogImageMetrics.inFlightHit += 1;
    return inFlight;
  }

  pruneOgImageCache();
  const requestPromise = requestOgImage(url);

  ogImageInFlight.set(url, requestPromise);

  try {
    return await requestPromise;
  } finally {
    pruneOgImageCache();
  }
},
fetchPaginated = async (
  path: string,
  params: Readonly<PageQueryParams>,
  label: string,
): Promise<PaginatedResponse> => {
  const url = buildPageUrl(path, params);
  logger.debug(`[${label}] Fetching paginated news: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parsePaginatedPayload(await response.json());
},
fetchRelatedArticles = async (
  articleId: number,
  limit: number = apiNumericConstants.five,
  excludeSameSource: boolean = true,
): Promise<RelatedArticlesResponse> => {
  const params = new URLSearchParams({
    exclude_same_source: excludeSameSource.toString(),
    limit: limit.toString(),
  }),

   response = await fetch(
    `${resolvedApiBaseUrl}/api/similarity/related/${articleId}?${params}`,
  );
  if (response.status === HTTP_SERVICE_UNAVAILABLE_STATUS) {
    throw new Error("Similarity features unavailable - vector store offline");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.relatedArticles);
},
fetchSearchSuggestions = async (
  query: string,
  limit: number = apiNumericConstants.five,
): Promise<SearchSuggestionsResponse> => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    query,
  }),

   response = await fetch(
    `${resolvedApiBaseUrl}/api/similarity/search-suggestions?${params}`,
  );
  if (response.status === HTTP_SERVICE_UNAVAILABLE_STATUS) {
    throw new Error("Search suggestions unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.searchSuggestions);
},
fetchSourceCoverage = async (
  sourceIds: readonly string[],
  sampleSize: number = apiNumericConstants.hundred,
): Promise<SourceCoverageResponse> => {
  const params = new URLSearchParams({
    sample_size: sampleSize.toString(),
    source_ids: sourceIds.join(","),
  }),

   response = await fetch(
    `${resolvedApiBaseUrl}/api/similarity/source-coverage?${params}`,
  );
  if (response.status === HTTP_SERVICE_UNAVAILABLE_STATUS) {
    throw new Error("Source coverage unavailable");
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.sourceCoverage);
},
fetchSourceCredibility = async (domain: string): Promise<SourceCredibilityProfile> => {
  const response = await fetch(`${resolvedApiBaseUrl}/sources/${encodeURIComponent(domain)}/credibility`)
  if (!response.ok) {
    throw new Error(`Failed to fetch source credibility (${response.status})`)
  }
  return parseResponseJson(response, zApiResponseSchemas.sourceCredibility)
},
fetchSourceDebugData = async (
  sourceName: string,
): Promise<SourceDebugData> => {
  const url = buildSourceDebugUrl(sourceName);
  logger.debug(`Fetching debug data for source: ${url}`);
  try {
    const response = await fetch(url);
    logger.debug(
      `Debug response status for source ${sourceName}:`,
      response.status,
    );
    if (!response.ok) {
      return createSourceDebugFallback(sourceName, {
        bozoException: "",
        error: `HTTP error! status: ${response.status}`,
        httpStatus: response.status,
      });
    }

    const debugData = await parseResponseJson(response, zApiResponseSchemas.sourceDebug);
    logger.debug(`Debug data received for ${sourceName}:`, {
      cachedArticles: debugData.cached_articles?.length,
      entriesCount: debugData.feed_status?.entries_count,
      hasError: Boolean(debugData.error),
    });

    return debugData;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    console.error("Error fetching source debug data:", error);
    return createSourceDebugFallback(sourceName, {
      bozoException: message,
      error: message,
      httpStatus: "fetch_failed",
    });
  }
},
fetchSourceStats = async (): Promise<SourceStats[]> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/news/sources/stats`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.sourceStats);
    return data.sources;
  } catch (error) {
    console.error("Failed to fetch source stats:", error);
    return [];
  }
},
fetchSources = async (): Promise<NewsSource[]> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/news/sources`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const payload: unknown = await response.json(),
     parsedSources = z.array(BackendSourceSchema).safeParse(payload);
    if (!parsedSources.success) {
      logger.warn("fetchSources received malformed payload");
      return [];
    }
    return parsedSources.data.map(mapBackendSource);
  } catch (error) {
    console.error("Failed to fetch sources:", error);
    return [];
  }
},
fetchStartupMetrics = async (): Promise<StartupMetricsResponse> => {
  const response = await fetch(`${resolvedApiBaseUrl}/debug/startup`);
  if (!response.ok) {
    throw new Error(`Failed to fetch startup metrics (${response.status})`);
  }

  const data = StartupMetricsPayloadSchema.parse(await response.json()),
   events = data.events.map(mapStartupEventMetric);

  return {
    completedAt: data.completed_at,
    durationSeconds: data.duration_seconds,
    events,
    notes: data.notes,
    startedAt: data.started_at,
  };
},
fetchStorageDrift = async (
  sampleLimit: number = apiNumericConstants.fifty,
): Promise<StorageDriftReport> => {
  const searchParams = new URLSearchParams({
    sample_limit: String(sampleLimit),
  })
  return fetchDebugParsed(
    "/debug/storage/drift",
    StorageDriftReportSchema,
    "Failed to fetch storage drift report",
    searchParams,
  )
},
fetchStreamStatus = async (): Promise<ApiOpaqueObject | null> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/debug/streams`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.streamStatus);
    logger.debug("Stream status:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch stream status:", error);
    return A_NULL_VALUE;
  }
},
fetchTrending = async (
  window: "1d" | "1w" | "1m" = "1d",
  limit: number = apiNumericConstants.ten,
): Promise<TrendingResponse> => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    window,
  }),

   response = await fetch(`${resolvedApiBaseUrl}/trending?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json(),
   parsed = TrendingResponseSchema.parse(payload);
  parsed satisfies OpenApiTrendingResponse;
  return parsed;
},
fetchTrendingStats = async (): Promise<TrendingStats> => {
  const response = await fetch(`${resolvedApiBaseUrl}/trending/stats`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const payload: unknown = await response.json(),
   parsed = TrendingStatsSchema.parse(payload);
  parsed satisfies OpenApiTrendingStats;
  return parsed;
},
fetchWikiIndexStatus = async (): Promise<WikiIndexStatus> => {
  const response = await fetch(`${resolvedApiBaseUrl}/api/wiki/index/status`);
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parseResponseJson(response, zApiResponseSchemas.wikiIndexStatus);
},
fetchWikiReporter = async (
  reporterId: number,
): Promise<WikiReporterDossier> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/api/wiki/reporters/${reporterId}`,
  );
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parseResponseJson(response, zApiResponseSchemas.wikiReporter);
},
fetchWikiReporterArticles = async (reporterId: number): Promise<
  {
    id: number;
    title: string;
    source: string;
    published_at?: string;
    url: string;
    category?: string;
    image_url?: string;
  }[]
> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/api/wiki/reporters/${reporterId}/articles`,
  );
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parseResponseJson(response, zApiResponseSchemas.articleReferences);
},
fetchWikiReporters = async (
  params:Readonly< {
    search?: string;
    outlet?: string;
    limit?: number;
    offset?: number;
  }> = {},
): Promise<WikiReporterCard[]> => {
  const query = buildQueryParameters([
    { key: "limit", value: params.limit },
    { key: "offset", value: params.offset },
    { key: "search", value: params.search },
    { key: "source", value: params.outlet },
  ]),

   response = await fetch(
    `${resolvedApiBaseUrl}/api/wiki/reporters${appendQueryString(query.toString())}`,
  );
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parseResponseJson(response, zApiResponseSchemas.wikiReporterCards);
},
fetchWikiSource = async (
  sourceName: string,
): Promise<WikiSourceProfile> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/api/wiki/sources/${encodeURIComponent(sourceName)}`,
  );
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parseResponseJson(response, zApiResponseSchemas.wikiSourceProfile);
},
fetchWikiSourceReporters = async (
  sourceName: string,
): Promise<WikiReporterCard[]> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/api/wiki/sources/${encodeURIComponent(sourceName)}/reporters`,
  );
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parseResponseJson(response, zApiResponseSchemas.wikiReporterCards);
},
fetchWikiSources = async (
  params: WikiSourcesParams = {},
): Promise<WikiSourceCard[]> => {
  const query = buildQueryParameters([
    { key: "bias", value: params.bias },
    { key: "country", value: params.country },
    { key: "funding", value: params.funding },
    { key: "limit", value: params.limit },
    { key: "offset", value: params.offset },
    { key: "search", value: params.search },
    { key: "sort", value: params.sort },
  ]),

   response = await fetch(
    `${resolvedApiBaseUrl}/api/wiki/sources${appendQueryString(query.toString())}`,
  );
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parseResponseJson(response, zApiResponseSchemas.wikiSourceCards);
},
filterNewsArticles = (
  articles: readonly Readonly<NewsArticle>[],
  params?: Readonly<FetchNewsParams>,
): NewsArticle[] => {
  let filteredArticles = [...articles];
  if (params?.search !== undefined && params.search.trim().length > 0) {
    const searchTerm = params.search.toLowerCase(),
     beforeFilterCount = filteredArticles.length;
    filteredArticles = filteredArticles.filter(
      (article) =>
        article.title.toLowerCase().includes(searchTerm) ||
        article.summary.toLowerCase().includes(searchTerm),
    );
    logger.debug(
      `Search filter applied: ${beforeFilterCount} -> ${filteredArticles.length} articles (search: "${params.search}")`,
    );
  }
  if (params?.category !== undefined && params.category.trim().length > 0) {
    const category = params.category.toLowerCase(),
     beforeFilterCount = filteredArticles.length;
    filteredArticles = filteredArticles.filter(
      (article) => article.category.toLowerCase() === category,
    );
    logger.debug(
      `Category filter applied: ${beforeFilterCount} -> ${filteredArticles.length} articles (category: "${params.category}")`,
    );
  }
  return filteredArticles;
},
getAllHighlights = async (): Promise<Highlight[]> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/queue/highlights`, {
      headers: { "Content-Type": "application/json" },
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.highlights);
    logger.debug("All highlights retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch highlights:", error);
    throw error;
  }
},
getArticlesByCountry = async (
  country: string,
): Promise<NewsArticle[]> => {
  if (apiCache.articles.length === 0) {
      // Get more articles for filtering
      apiCache.articles = await fetchNews({ limit: 3000 });
  }
  const normalized = normalizeCountryCode(country);
  return apiCache.articles.filter(
    (article) => normalizeCountryCode(article.country) === normalized,
  );
},
getBiasFromSource = (source: string): "left" | "center" | "right" => {
  const biasMap: Record<string, "left" | "center" | "right"> = {
    "Associated Press": "center",
    BBC: "center",
    CNN: "left",
    "Fox News": "right",
    NPR: "left",
    Reuters: "center",
  };
  return biasMap[source] || "center";
},
getCountryEconomicProfile = async (
  countryCode: string,
): Promise<CountryEconomicProfile> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/country/${countryCode}/economic-profile`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.countryEconomicProfile);
},
getCountryFromSource = (source: string): string => {
  const countryMap: Record<string, string> = {
    "Associated Press": "US",
    BBC: "GB",
    CNN: "US",
    "Fox News": "US",
    NPR: "US",
    Reuters: "GB",
  };
  return countryMap[source] || "US";
},
getCredibilityFromSource = (source: string): "high" | "medium" | "low" => {
  const credibilityMap: Record<string, "high" | "medium" | "low"> = {
    "Associated Press": "high",
    BBC: "high",
    CNN: "medium",
    "Fox News": "medium",
    NPR: "high",
    Reuters: "high",
  };
  return credibilityMap[source] || "medium";
},
getDailyDigest = async (): Promise<QueueDigest> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/queue/digest/daily`, {
      headers: { "Content-Type": "application/json" },
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.queueDigest);
    logger.debug("Daily digest retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch daily digest:", error);
    throw error;
  }
},
getHighlightsForArticle = async (
  articleUrl: string,
): Promise<Highlight[]> => {
  try {
    const encodedUrl = encodeURIComponent(articleUrl),
     url = `${resolvedApiBaseUrl}/api/queue/highlights/article/${encodedUrl}`;

    if (globalThis.process.env.NODE_ENV !== "production") {
      logger.debug(`[Highlights] GET ${url}`);
    }

    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.highlights);
    logger.debug("Highlights retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch highlights:", error);
    throw error;
  }
},
getOrganization = async (
  orgId: number,
): Promise<OrganizationProfile> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/organization/${orgId}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.organization);
},
getOwnershipChain = async (
  orgName: string,
  maxDepth: number = apiNumericConstants.five,
): Promise<OwnershipChain> => {
  const params = new URLSearchParams({ max_depth: maxDepth.toString() }),
   response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/organization/${encodeURIComponent(orgName)}/ownership-chain?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.ownershipChain);
},
getQueueItemContent = async (
  queueId: number,
): Promise<QueueItemContent> => {
  try {
    const response = await fetch(
      `${resolvedApiBaseUrl}/api/queue/${queueId}/content`,
      {
        headers: { "Content-Type": "application/json" },
        method: "GET",
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.queueItemContent);
    logger.debug("Queue item content retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch queue item content:", error);
    throw error;
  }
},
getQueueOverview = async (): Promise<QueueOverview> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/queue/overview`, {
      headers: { "Content-Type": "application/json" },
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.queueOverview);
    logger.debug("Queue overview retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch queue overview:", error);
    throw error;
  }
},
getReadingQueue = async (): Promise<QueueResponse> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/queue`, {
      headers: { "Content-Type": "application/json" },
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.queueResponse);
    logger.debug("Reading queue retrieved:", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch reading queue:", error);
    throw error;
  }
},
getReadingShelves = async (): Promise<ReadingShelf[]> => {
  const response = await fetch(`${resolvedApiBaseUrl}/api/queue/shelves`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.readingShelves);
},
getReporter = async (
  reporterId: number,
): Promise<ReporterProfile> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/reporter/${reporterId}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.reporterProfile);
},
getSourceById = async (
  id: string,
): Promise<NewsSource | undefined> => {
  if (apiCache.sources.length === 0) {
    apiCache.sources = await fetchSources();
  }
  const normalizedId = id.trim().toLowerCase();
  return apiCache.sources.find(
    (source) =>
      source.id === id ||
      source.slug === id ||
      source.id.toLowerCase() === normalizedId ||
      source.slug.toLowerCase() === normalizedId ||
      source.name.toLowerCase() === normalizedId,
  );
},
handleCacheDataEvent = (
  data: Readonly<StreamEvent>,
  rt: Readonly<StreamRuntime>,
): void => {
  Object.assign(rt, { hasReceivedData: true });
  if (data.articles && Array.isArray(data.articles)) {
    const mappedArticles = mapBackendArticles(data.articles),
     cacheAge = data.cache_age_seconds || 999;
    logger.debug(
      `Stream ${rt.streamId} cache data: ${mappedArticles.length} articles (cache age: ${cacheAge}s, fresh: ${cacheAge < 120})`,
    );
    queueStreamBatches(mappedArticles, rt, "cache-batch", () => ({
      completed: rt.sources.size,
      message: `Loaded ${mappedArticles.length} cached articles`,
      percentage: 0,
      total: rt.sources.size,
    }));
    if (cacheAge < 120) {
      logger.debug(
        `Cache is fresh (${cacheAge}s), waiting for completion or timeout after 5s...`,
      );
      setTimeout(() => {
        if (!rt.settled && rt.hasReceivedData) {
          logger.debug("Auto-completing stream after fresh cache timeout");
          rt.abort();
        }
      }, 5000);
    }
  } else {
    console.warn(
      "[streamNews] 'cache_data' event received but 'articles' is not an array or is missing.",
      data,
    );
  }
},
handleCacheRefreshEvent = (
  event: CacheRefreshEvent,
  onProgress?: (progress: CacheRefreshProgress) => void,
): boolean => {
  if (event.status === "complete") {
    onProgress?.({
      failedSources: event.failed_sources,
      message: event.message,
      successfulSources: event.successful_sources,
      totalArticles: event.total_articles,
    });
    return true;
  }
  if (event.status === "source_complete") {
    onProgress?.({
      articlesFromSource: event.articles_from_source,
      failedSources: event.failed_sources,
      source: event.source,
      totalSourcesProcessed: event.total_sources_processed,
    });
    return false;
  }
  if (event.status === "error") {
    console.error("Refresh error:", event.message);
    return true;
  }
  return false;
},
handleCompleteEvent = (
  data: Readonly<StreamEvent>,
  rt: Readonly<StreamRuntime>,
): void => {
  logger.debug(`Stream ${rt.streamId} complete:`, {
    failedSources: data.failed_sources,
    message: data.message,
    successfulSources: data.successful_sources,
    totalArticles: data.total_articles,
  });
  streamResolve(rt);
},
handleErrorEvent = (
  data: Readonly<StreamEvent>,
  rt: Readonly<StreamRuntime>,
): void => {
  console.error(`Stream ${rt.streamId} error:`, data.error);
  if (rt.hasReceivedData) {
    streamResolve(rt, [data.error || "Stream error"]);
  } else {
    streamReject(rt, new Error(data.error || "Stream error"));
  }
},
handleInitialEvent = (
  data: Readonly<StreamEvent>,
  rt: Readonly<StreamRuntime>,
): void => {
  Object.assign(rt, { hasReceivedData: true });
  if (data.articles && Array.isArray(data.articles)) {
    const mappedArticles = mapBackendArticles(data.articles),
     cacheAge = data.cache_age_seconds || 999;
    logger.debug(
      `Stream ${rt.streamId} INITIAL data: ${mappedArticles.length} articles (cache age: ${cacheAge}s)`,
    );
    queueStreamBatches(mappedArticles, rt, "initial-batch", () => ({
      completed: 0,
      message: `Instantly loaded ${mappedArticles.length} articles from cache`,
      percentage: 0,
      total: 0,
    }));
  } else {
    console.warn(
      "[streamNews] 'initial' event received but 'articles' is not an array or is missing.",
      data,
    );
  }
},
handleSourceCompleteEvent = (
  data: Readonly<StreamEvent>,
  rt: Readonly<StreamRuntime>,
): void => {
  Object.assign(rt, { hasReceivedData: true });
  if (data.articles && data.source) {
    const mappedArticles = mapBackendArticles(data.articles);
    rt.addArticles(...mappedArticles);
    rt.addSource(data.source);
    logger.debug(
      `Stream ${rt.streamId} source complete: ${data.source} (${mappedArticles.length} articles)`,
    );
    rt.onSourceComplete?.(data.source, mappedArticles);
    if (data.progress) {rt.onProgress?.(data.progress);}
  }
},
handleSourceErrorEvent = (
  data: Readonly<StreamEvent>,
  rt: Readonly<StreamRuntime>,
): void => {
  const errorMsg = `Error loading ${data.source}: ${data.error}`;
  console.warn(`Stream ${rt.streamId} source error:`, errorMsg);
  rt.addError(errorMsg);
  rt.onError?.(errorMsg);
  if (data.progress) {rt.onProgress?.(data.progress);}
},
handleStartingEvent = (
  data: Readonly<StreamEvent>,
  rt: Readonly<StreamRuntime>,
): void => {
  logger.debug(`Stream ${rt.streamId} starting: ${data.message}`);
  rt.onProgress?.({
    completed: 0,
    message: data.message,
    percentage: 0,
    total: 0,
  });
},
handleStreamReadError = (
  readError: Error,
  rt: Readonly<StreamRuntime>,
): void => {
  rt.clearTimers();
  if (readError.name === "AbortError") {
    console.warn("Stream reader aborted");
    streamResolve(rt, ["Stream aborted"]);
    return;
  }
  if (isLikelyNetworkError(readError)) {
    logger.warn("News stream disconnected before completion.");
  } else {
    console.error("Stream reader error:", readError);
  }
  streamReject(rt, readError);
},
hasArticleContent = (article: ReadonlyBackendArticle): boolean =>
  article.content !== undefined && article.content.trim().length > 0
,
hashStringToInt = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
},
initializeData = async () => {
  try {
    apiCache.sources = await fetchSources();
    apiCache.articles = await fetchNews({ limit: 1000 });
  } catch (error) {
    console.error("Failed to initialize data:", error);
  }
},
installStreamTimers = (rt: Readonly<StreamRuntime>): void => {
  let stallInterval: ReturnType<typeof setInterval> | undefined = undefined,
   timeoutInterval: ReturnType<typeof setInterval> | undefined = undefined;
  Object.assign(rt, { clearTimers: () => {
    clearInterval(timeoutInterval);
    clearInterval(stallInterval);
  } });
  timeoutInterval = setInterval(() => {
    const timeSinceLastMessage = Date.now() - rt.lastMessageTime;
    if (timeSinceLastMessage > STREAM_MESSAGE_TIMEOUT_MS) {
      console.error("Stream timeout - no data received in 2 minutes");
      rt.abort();
    }
  }, STREAM_TIMEOUT_CHECK_INTERVAL_MS);
  stallInterval = setInterval(() => {
    const isStalled =
      rt.hasReceivedData &&
      !rt.settled &&
      Date.now() - rt.lastMessageTime > STREAM_CACHE_LOAD_TIMEOUT_MS;
    if (isStalled) {
      console.warn(
        `Stream ${rt.streamId} stalled after cache load - auto-completing`,
      );
      streamResolve(rt, [
        "Stream auto-completed due to inactivity after cache load",
      ]);
    }
  }, STREAM_STALL_CHECK_INTERVAL_MS);
},
isCloudflaredTunnelHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase()
  return CLOUDFLARED_TUNNEL_PATTERNS.some((pattern) => pattern.test(normalized))
},
isLanHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase()

  if (isLocalHostname(normalized)) {
    return true
  }

  if (normalized.endsWith(".local")) {
    return true
  }

  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(normalized))
},
isLikelyNetworkError = (error: Error): boolean => {
  const message = error.message.toLowerCase()
  return (
    error.name === "TypeError" ||
    error.name === "NetworkError" ||
    message.includes("networkerror") ||
    message.includes("failed to fetch") ||
    message.includes("input stream") ||
    message.includes("load failed")
  )
},
isLocalHostname = (hostname: string): boolean =>
  LOCAL_HOSTNAMES.has(hostname.trim().toLowerCase())
,
isPublicFrontendHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase()

  if (!PUBLIC_FRONTEND_DOMAIN) {
    return false
  }

  return (
    normalized === PUBLIC_FRONTEND_DOMAIN ||
    normalized.endsWith(`.${PUBLIC_FRONTEND_DOMAIN}`)
  )
},
listOrganizations = async (
  limit: number = apiNumericConstants.fifty,
  offset: number = apiNumericConstants.zero,
): Promise<OrganizationProfile[]> => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  }),
   response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/organizations?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.organizationList);
},
listReporters = async (
  limit: number = apiNumericConstants.fifty,
  offset: number = apiNumericConstants.zero,
): Promise<ReporterProfile[]> => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  }),
   response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/reporters?${params}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return parseResponseJson(response, zApiResponseSchemas.reporterProfileList);
},
mapBackendArticle = (article: ReadonlyBackendArticle): NewsArticle =>
  buildNewsArticle(article, resolveBackendArticleMapping(article))
,
mapBackendArticles = (
  backendArticles: readonly ReadonlyBackendArticle[],
): NewsArticle[] => {
  logger.debug(
    `[mapBackendArticles] Mapping ${backendArticles.length} articles from backend format to frontend format.`,
  );
  return backendArticles.map(mapBackendArticle);
},
mapBackendSource = (source: Readonly<BackendSource>): NewsSource => (
  {
    bias: mapBias(source.bias_rating),
    category: source.category ? [source.category] : ["general"],
    country: source.country,
    credibility: mapCredibilityScoreToLevel(
      source.credibility_score,
      source.factual_rating,
      source.bias_rating,
    ),
    credibilityScore: source.credibility_score,
    factualRating: source.factual_rating,
    funding: [source.funding_type || source.ownership_label || "Unknown"],
    id:
      source.id || source.slug || source.name.toLowerCase().replaceAll(/\s+/gu, "-"),
    isPaywalled: source.is_paywalled ?? false,
    language: "en",
    name: source.name,
    rssUrl: source.rssUrl || source.url,
    slug:
      source.slug ||
      source.id ||
      source.name.toLowerCase().replaceAll(/\s+/gu, "-"),
    sourceType: source.source_type,
    url: source.url,
  }
),
mapBias = (biasRating?: string): "left" | "center" | "right" => {
  if (!biasRating) {return "center";}
  const rating = biasRating.toLowerCase();
  if (rating.includes("left")) {return "left";}
  if (rating.includes("right")) {return "right";}
  return "center";
},
mapCredibility = (biasRating?: string): "high" | "medium" | "low" => {
  // Map bias ratings to credibility (this is a simplification)
  if (!biasRating) {return "medium";}
  if (biasRating.toLowerCase().includes("high")) {return "high";}
  if (biasRating.toLowerCase().includes("low")) {return "low";}
  return "medium";
},
mapCredibilityScore = (score: number): "high" | "medium" | "low" => {
  if (score >= 0.75) {return "high";}
  if (score <= 0.4) {return "low";}
  return "medium";
},
mapCredibilityScoreToLevel = (
  score?: number,
  factualRating?: string,
  biasRating?: string,
): "high" | "medium" | "low" => {
  if (typeof score === "number") {
    return mapCredibilityScore(score);
  }

  return mapFactualRating(factualRating) ?? mapCredibility(biasRating);
},
mapFactualRating = (rating?: string): "high" | "low" | undefined => {
  const normalized = rating?.toLowerCase();
  if (normalized?.includes("high")) {return "high";}
  if (normalized?.includes("low") || normalized?.includes("mixed")) {
    return "low";
  }
  return undefined;
},
mapStartupEventMetric = (event: z.infer<typeof StartupEventMetricSchema>): StartupEventMetric => ({
  completedAt: event.completed_at,
  detail: event.detail,
  durationSeconds: event.duration_seconds,
  metadata: event.metadata,
  name: event.name,
  startedAt: event.started_at,
}),
normalizeCountryCode = (value?: string | null): string => {
  if (typeof value !== "string") {return "International";}
  const trimmed = value.trim();
  if (!trimmed) {return "International";}
  if (trimmed === "International") {return trimmed;}

  const compactUpper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/u.test(compactUpper)) {
    return compactUpper;
  }

  const normalizedName = trimmed
    .toLowerCase()
    .replaceAll(/[.]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim(),
   noSpace = normalizedName.replaceAll(/\s+/gu, "");
  return COUNTRY_NAME_TO_CODE[normalizedName] || COUNTRY_NAME_TO_CODE[noSpace] || compactUpper;
},
normalizeOgImageUrl = (imageUrl: string | null | undefined): string | null =>
  imageUrl !== undefined && imageUrl !== null && imageUrl.length > 0
    ? imageUrl
    : null
,
ogImageCache = new Map<
  string,
  { imageUrl: string | null; expiresAt: number }
>(),
ogImageInFlight = new Map<string, Promise<string | null>>(),
ogImageMetrics = {
  cacheHit: 0,
  inFlightHit: 0,
  network: 0,
  total: 0,
},
parseCacheRefreshEvent = (json: string): CacheRefreshEvent | undefined => {
  try {
    const parsed = CacheRefreshEventSchema.safeParse(JSON.parse(json));
    if (!parsed.success) {
      console.error("Failed to validate cache refresh event:", json);
      return undefined;
    }
    return parsed.data;
  } catch (error) {
    console.error("Failed to parse SSE event:", json, error);
    return undefined;
  }
},
parseNewsPayload = (payload: unknown): BackendArticle[] => {
  const parsedPayload = NewsPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    logger.warn("fetchNews received a malformed response payload");
    return [];
  }
  const parsedArticles = BackendArticleSchema.array().safeParse(
    parsedPayload.data.articles ?? [],
  );
  if (!parsedArticles.success) {
    logger.warn(
      "fetchNews received malformed article payload, dropping invalid entries",
    );
    return [];
  }
  return parsedArticles.data;
},
parsePaginatedPayload = (payload: unknown): PaginatedResponse => {
  const parsed = PaginatedPayloadSchema.safeParse(payload);
  if (!parsed.success) {throw new Error("Paginated news response is invalid.");}
  return {
    articles: mapBackendArticles(parsed.data.articles ?? []),
    has_more: parsed.data.has_more ?? false,
    limit: parsed.data.limit ?? 0,
    next_cursor: parsed.data.next_cursor ?? null,
    prev_cursor: parsed.data.prev_cursor ?? null,
    total: parsed.data.total ?? 0,
  };
},
parseReporterCareerTimeline = (
  value: ApiOpaqueObject | null | undefined,
): ReporterCareerTimeline | null => {
  if (!value) {return null;}
  const result = ReporterCareerTimelineSchema.safeParse(value);
  return result.success ? result.data : null;
},
parseStreamEvent = (eventData: string): StreamEvent => {
  try {
    return StreamEventSchema.parse(JSON.parse(eventData));
  } catch {
    console.warn("[streamNews] First JSON.parse failed, attempting to re-parse");
    return StreamEventSchema.parse(JSON.parse(JSON.parse(`"${eventData}"`)));
  }
},
performAgenticSearch = async (
  query: string,
  maxSteps: number = apiNumericConstants.eight,
): Promise<AgenticSearchResponse> => {
  try {
    void maxSteps;
    const response = await fetch(`${resolvedApiBaseUrl}/api/news/research`, {
      body: JSON.stringify({
        include_thinking: false,
        query,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const researchResponse = await parseResponseJson(response, zApiResponseSchemas.researchResponse);

    return {
      answer: researchResponse.answer,
      citations: researchResponse.referenced_articles,
      reasoning: researchResponse.thinking_steps,
      success: researchResponse.success,
    };
  } catch (error) {
    console.error("Agentic search failed:", error);
    throw error;
  }
},
performNewsResearch = async (
  query: string,
  includeThinking: boolean = true,
): Promise<NewsResearchResponse> => {
  try {
    logger.debug(`Performing news research: ${query}`);
    const response = await fetch(`${resolvedApiBaseUrl}/api/news/research`, {
      body: JSON.stringify({
        include_thinking: includeThinking,
        query,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.researchResponse);
    logger.debug("News research complete:", data);
    return {
      ...data,
      articles_searched: data.articles_searched ?? apiNumericConstants.zero,
    };
  } catch (error) {
    console.error("Failed to perform news research:", error);
    throw error;
  }
},
processCacheRefreshLine = (
  line: string,
  onProgress?: (progress: CacheRefreshProgress) => void,
): boolean | undefined => {
  if (!line.startsWith("data: ")) {
    return undefined;
  }
  const json = line.slice("data: ".length).trim();
  if (json.length === 0) {
    return undefined;
  }
  const event = parseCacheRefreshEvent(json);
  if (event === undefined || !handleCacheRefreshEvent(event, onProgress)) {
    return undefined;
  }
  return event.status === "complete";
},
processStreamChunk = (
  buffer: string,
  chunk: Readonly<Uint8Array>,
  decoder: Readonly<TextDecoder>,
  rt: Readonly<StreamRuntime>,
): string => {
  const lines = `${buffer}${decoder.decode(chunk, { stream: true })}`.split("\n");
  lines.slice(0, -1).forEach((line) =>{  processStreamDataLine(line, rt); });
  return lines.at(-1) ?? "";
},
processStreamDataLine = (line: string, rt: Readonly<StreamRuntime>): void => {
  if (!line || line.startsWith(":")) {
    return;
  }
  if (!line.startsWith("data: ")) {
    return;
  }
  const eventData = line.slice(6);
  try {
    dispatchStreamEvent(parseStreamEvent(eventData), rt);
  } catch (parseError) {
    reportStreamParseError(parseError, eventData, rt);
  }
},
profileReporter = async (
  name: string,
  organization?: string,
  articleContext?: string,
  forceRefresh: boolean = false,
): Promise<ReporterProfile> => {
  const params = forceRefresh ? "?force_refresh=true" : "",
   response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/reporter/profile${params}`,
    {
      body: JSON.stringify({
        article_context: articleContext,
        name,
        organization,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return parseResponseJson(response, zApiResponseSchemas.reporterProfile);
},
promoteRssSource = async (request:Readonly< {
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
}>): Promise<AddRssResponse> => {
  const response = await fetch(`${resolvedApiBaseUrl}/sources/rss/promote`, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null),
     detail =
      body && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return parseResponseJson(response, zApiResponseSchemas.addRss);
},
pruneOgImageCache = () => {
  const now = Date.now();
  for (const [key, entry] of ogImageCache.entries()) {
    if (entry.expiresAt <= now) {
      ogImageCache.delete(key);
    }
  }

  if (ogImageCache.size <= OG_IMAGE_MAX_CACHE_ENTRIES) {
    return;
  }

  const keys = [...ogImageCache.keys()],
   overflow = ogImageCache.size - OG_IMAGE_MAX_CACHE_ENTRIES;
  for (let i = 0; i < overflow; i += 1) {
    ogImageCache.delete(keys[i]!);
  }
},
pumpStreamEvents = async (
  rt: Readonly<StreamRuntime>,
  reader: Readonly<ReadableStreamDefaultReader<Uint8Array>>,
): Promise<void> => {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    try {
      const { done, value } = await reader.read();
      if (done) {
        resolveCompletedStream(rt);
        return;
      }

      Object.assign(rt, { lastMessageTime: Date.now() });
      buffer = processStreamChunk(buffer, value, decoder, rt);
    } catch (readError) {
      const normalizedError = (() => {
        if (readError instanceof Error) {
          return readError;
        }
        return new Error(String(readError));
      })();
      handleStreamReadError(normalizedError, rt);
      return;
    }
  }
},
queueStreamBatches = (
  articlesToQueue: readonly Readonly<NewsArticle>[],
  rt: Readonly<StreamRuntime>,
  batchLabel: string,
  finalProgress: () => StreamProgress,
): void => {
  void (async () => {
    const BATCH_SIZE = 500;
    for (let i = 0; i < articlesToQueue.length; i += BATCH_SIZE) {
      const batch = articlesToQueue.slice(i, i + BATCH_SIZE);
      rt.addArticles(...batch);
      batch.forEach((article) => { rt.addSource(article.source); });
      if (rt.onSourceComplete) {
        rt.onSourceComplete(`${batchLabel}-${Math.floor(i / BATCH_SIZE)}`, batch);
      }
      if (i + BATCH_SIZE < articlesToQueue.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    rt.onProgress?.(finalProgress());
  })();
},
readCachedOgImage = (url: string, now: number): string | null | undefined => {
  const cached = ogImageCache.get(url);
  if (cached === undefined) {
    return undefined;
  }
  if (cached.expiresAt > now) {
    ogImageMetrics.cacheHit += 1;
    return cached.imageUrl;
  }
  ogImageCache.delete(url);
  return undefined;
},
refreshCache = async (
  onProgress?: (progress: CacheRefreshProgress) => void,
): Promise<boolean> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/cache/refresh/stream`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    return consumeCacheRefreshStream(
      response.body.getReader(),
      new TextDecoder(),
      onProgress,
    );
  } catch (error) {
    console.error("Failed to refresh cache:", error);
    return false;
  }
},
removeDuplicateArticles = (articles:readonly  NewsArticle[]): NewsArticle[] => {
  const seen = new Set<string>(),
   seenIds = new Set<number>();
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
},
removeFromReadingQueue = async (
  queueItemId: number,
): Promise<void> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/queue/${queueItemId}`, {
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
},
removeFromReadingQueueByUrl = async (
  articleUrl: string,
): Promise<void> => {
  try {
    const encodedUrl = encodeURIComponent(articleUrl),
     response = await fetch(
      `${resolvedApiBaseUrl}/api/queue/url/${encodedUrl}`,
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
},
reportStreamParseError = (
  parseError: unknown,
  eventData: string,
  rt: Readonly<StreamRuntime>,
): void => {
  console.error(
    "Error parsing stream event:",
    parseError,
    "Raw data:",
    eventData,
  );
  const message = parseError instanceof Error ? parseError.message : String(parseError);
  rt.onError?.(`Parse error: ${message}`);
},
requestInlineDefinition = async (
  term: string,
  context?: string,
): Promise<{
  success: boolean;
  term: string;
  definition?: string | null;
  error?: string | null;
}> => {
  try {
    const resp = await fetch(`${resolvedApiBaseUrl}/api/inline/define`, {
      body: JSON.stringify({ context: context ?? "", term }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    const data = await parseResponseJson(resp, zApiResponseSchemas.inlineDefinition);
    return {
      definition: data.definition ?? A_NULL_VALUE,
      error: data.error ?? A_NULL_VALUE,
      success: true,
      term,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("requestInlineDefinition failed", error);
    return {
      definition: null,
      error: message,
      success: false,
      term,
    };
  }
},
requestOgImage = async (url: string): Promise<string | null> => {
  ogImageMetrics.network += 1;
  if (ogImageMetrics.total % OG_IMAGE_METRICS_INTERVAL === 0) {
    logger.debug("OG image fetch metrics", {
      cacheHit: ogImageMetrics.cacheHit,
      cacheSize: ogImageCache.size,
      inFlightHit: ogImageMetrics.inFlightHit,
      network: ogImageMetrics.network,
      total: ogImageMetrics.total,
    });
  }

  try {
    const response = await fetch(
      `${resolvedApiBaseUrl}/image/og?url=${encodeURIComponent(url)}`,
    );
    if (!response.ok) {
      if (response.status === 404) {
        return cacheOgImage(url, null, OG_IMAGE_MISS_TTL_MS);
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const parsed = OgImageResponseSchema.safeParse(await response.json()),
     imageUrl = parsed.success ? normalizeOgImageUrl(parsed.data.image_url) : null;
    return cacheOgImage(url, imageUrl, OG_IMAGE_SUCCESS_TTL_MS);
  } catch (error) {
    console.error("Failed to fetch OG image:", error);
    return cacheOgImage(url, null, OG_IMAGE_ERROR_TTL_MS);
  } finally {
    ogImageInFlight.delete(url);
  }
},
researchOrganization = async (
  name: string,
  website?: string,
  forceRefresh: boolean = false,
): Promise<OrganizationProfile> => {
  const params = forceRefresh ? "?force_refresh=true" : "",
   response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/organization/research${params}`,
    {
      body: JSON.stringify({ name, website }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return parseResponseJson(response, zApiResponseSchemas.organization);
},
researchSourceProfile = async (
  name: string,
  website?: string,
  forceRefresh: boolean = false,
): Promise<SourceResearchProfile> => {
  const params = forceRefresh ? "?force_refresh=true" : "",
   response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/source/profile${params}`,
    {
      body: JSON.stringify({ name, website }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return parseResponseJson(response, zApiResponseSchemas.sourceProfile);
},
researchSourceProfilesBatch = async (
  sources:readonly  SourceResearchRequest[],
  forceRefresh: boolean = false,
): Promise<SourceBatchResponse> => {
  const params = forceRefresh ? "?force_refresh=true" : "",
   response = await fetch(
    `${resolvedApiBaseUrl}/research/entity/source/batch${params}`,
    {
      body: JSON.stringify({ sources }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return parseResponseJson(response, zApiResponseSchemas.sourceBatch);
},
resolveArticleAuthor = (article: ReadonlyBackendArticle): string | undefined => {
  if (article.author !== undefined && article.author.length > 0) {
    return article.author;
  }
  return article.authors?.[0];
},
resolveArticleAuthors = (
  article: ReadonlyBackendArticle,
  author?: string,
): string[] => {
  if (Array.isArray(article.authors)) {
    return article.authors.filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
  }
  return author ? [author] : [];
},
resolveArticleBias = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): "left" | "center" | "right" => {
  const biasValue =
    typeof article.bias === "string" ? article.bias.toLowerCase() : undefined;
  if (biasValue && ["left", "center", "right"].includes(biasValue)) {
    return biasValue as "left" | "center" | "right";
  }
  return getBiasFromSource(sourceName);
},
resolveArticleCategory = (article: ReadonlyBackendArticle): string => {
  if (article.category !== undefined && article.category.length > 0) {
    return article.category;
  }
  return "general";
},
resolveArticleCountries = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): { country: string; sourceCountry: string; mentionedCountries: string[] } => {
  const rawCountry =
    typeof article.country === "string" ? article.country : undefined,
   fallbackCountry = rawCountry || getCountryFromSource(sourceName),
   country = normalizeCountryCode(fallbackCountry),
   sourceCountry = normalizeCountryCode(
    typeof article.source_country === "string"
      ? article.source_country
      : fallbackCountry,
  ),
   mentionedCountries = Array.isArray(article.mentioned_countries)
    ? article.mentioned_countries
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeCountryCode(value))
    : [];
  return { country, mentionedCountries, sourceCountry };
},
resolveArticleCredibility = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): "high" | "medium" | "low" => {
  const credibilityValue =
    typeof article.credibility === "string"
      ? article.credibility.toLowerCase()
      : undefined;
  if (
    credibilityValue &&
    ["high", "medium", "low"].includes(credibilityValue)
  ) {
    return credibilityValue as "high" | "medium" | "low";
  }
  return getCredibilityFromSource(sourceName);
},
resolveArticleId = (article: ReadonlyBackendArticle, stableKey: string): number => {
  if (typeof article.id === "number") {return article.id;}
  if (typeof article.article_id === "number") {return article.article_id;}
  return hashStringToInt(stableKey);
},
resolveArticleImage = (article: ReadonlyBackendArticle): string => {
  const rawImage = article.image || article.image_url;
  return rawImage && rawImage !== "none" ? rawImage : "/placeholder.svg";
},
resolveArticlePersistence = (article: ReadonlyBackendArticle): boolean => {
  const hasBackendId =
    typeof article.id === "number" || typeof article.article_id === "number";
  return hasBackendId && article.is_persisted !== false;
},
resolveArticlePublished = (article: ReadonlyBackendArticle): string =>
  (
    article.published_at ||
    article.publishedAt ||
    article.published ||
    new Date().toISOString()
  )
,
resolveArticleSourceId = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): string =>
  typeof article.source_id === "string" &&
    article.source_id.trim().length > 0
    ? article.source_id.trim().toLowerCase()
    : sourceName.toLowerCase().replaceAll(/\s+/gu, "-")
,
resolveArticleSourceName = (article: ReadonlyBackendArticle): string => {
  if (article.source !== undefined && article.source.length > 0) {
    return article.source;
  }
  if (article.source_name !== undefined && article.source_name.length > 0) {
    return article.source_name;
  }
  return "Unknown";
},
resolveArticleSummary = (article: ReadonlyBackendArticle): string => {
  if (article.summary !== undefined && article.summary.length > 0) {
    return article.summary;
  }
  return article.description ?? "";
},
resolveArticleUrlKey = (
  article: ReadonlyBackendArticle,
  sourceName: string,
  published: string,
): { url: string; stableKey: string } => {
  const url =
    article.url ||
    article.link ||
    article.article_url ||
    article.original_url ||
    "",
   stableKey = url || `${sourceName}|${article.title || ""}|${published}`;
  return { stableKey, url };
},
resolveBackendArticleMapping = (article: ReadonlyBackendArticle): BackendArticleMapping => {
  const sourceName = resolveArticleSourceName(article),
   published = resolveArticlePublished(article),
   { url, stableKey } = resolveArticleUrlKey(article, sourceName, published),
   author = resolveArticleAuthor(article),
   { country, sourceCountry, mentionedCountries } =
    resolveArticleCountries(article, sourceName);
  return {
    author,
    authors: resolveArticleAuthors(article, author),
    bias: resolveArticleBias(article, sourceName),
    category: resolveArticleCategory(article),
    content: article.content,
    country,
    credibility: resolveArticleCredibility(article, sourceName),
    geoSignal: resolveGeoSignal(article),
    image: resolveArticleImage(article),
    isPersisted: resolveArticlePersistence(article),
    mentionedCountries,
    normalizedSourceId: resolveArticleSourceId(article, sourceName),
    published,
    resolvedId: resolveArticleId(article, stableKey),
    sourceCountry,
    sourceName,
    stableKey,
    summary: resolveArticleSummary(article),
    url,
  };
},
resolveBaseUrl = (value?: string) => {
  const raw = value && value.trim().length > 0 ? value : LOCAL_BACKEND_FALLBACK,
   normalized = raw.replace(/\/+$/u, "")

  if (typeof window === "undefined") {
    return normalized
  }

  try {
    const url = new URL(normalized)
    return resolveRemoteBackendUrl(url) ?? normalized
  } catch {
    return normalized
  }
},
resolveBlindspotCategory = (category?: string): string | undefined => {
  if (category === undefined || category === "all") {
    return undefined;
  }
  return category;
},
resolveCompletedStream = (rt: Readonly<StreamRuntime>): void => {
  logger.debug("Stream reader completed");
  if (rt.hasReceivedData) {
    streamResolve(rt);
  } else {
    streamReject(rt, new Error("Stream ended without receiving data"));
  }
},
resolveGeoSignal = (
  article: ReadonlyBackendArticle,
): { id: string; label: string } | undefined => {
  const parsed = z.object({
    id: z.string(),
    label: z.string(),
  }).safeParse(article.geo_signal);
  return parsed.success ? parsed.data : undefined;
},
resolveParsedTimestamp = (published: string): number => {
  const timestamp = new Date(published).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
},
resolveRemoteBackendUrl = (url: Readonly<URL>): string | null => {
  const browserLocation = globalThis.location,
   browserHostname = browserLocation.hostname;

  if (shouldUsePublicApiFallback(url, browserHostname)) {
    return PUBLIC_API_FALLBACK;
  }
  if (!shouldRewriteToBrowserHost(url, browserHostname)) {
    return null;
  }

  const rewrittenUrl = new URL(url.toString());
  rewrittenUrl.hostname = browserHostname;
  return applyBrowserProtocol(rewrittenUrl, browserLocation.protocol)
    .toString()
    .replace(/\/+$/u, "");
},
resolveSourceParameter = (params: Readonly<PageQueryParams>): string | null | undefined => {
  if (params.sources !== undefined && params.sources !== null && params.sources.length > 0) {
    return params.sources;
  }
  return params.source;
},
resolveSourceParameterKey = (params: Readonly<PageQueryParams>): string => {
  if (params.sources !== undefined && params.sources !== null && params.sources.length > 0) {
    return "sources";
  }
  return "source";
},
resolvedApiBaseUrl = resolveBaseUrl(globalThis.process.env.NEXT_PUBLIC_API_URL),
semanticSearch = async (
  query: string,
  options?: SemanticSearchOptions,
): Promise<SemanticSearchResponse> => {
  const response = await fetch(buildSemanticSearchUrl(query, options));
  if (response.status === 503) {
    throw new Error("Semantic search is currently unavailable.");
  }
  if (!response.ok) {
    throw new Error(`Semantic search failed with status ${response.status}`);
  }
  const parsed = SemanticSearchPayloadSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Semantic search returned an invalid response.");
  }
  const rawResults = parsed.data.results ?? [],
   mappedArticles = mapBackendArticles(rawResults),
   results = mappedArticles.map((article, index) => ({
    article,
    distance: rawResults[index]?.distance ?? null,
    similarityScore: rawResults[index]?.similarity_score ?? null,
  }));
  let responseQuery = query;
  if (parsed.data.query !== undefined && parsed.data.query.length > 0) {
    responseQuery = parsed.data.query;
  }
  let total = results.length;
  if (parsed.data.total !== undefined) {
    total = parsed.data.total;
  }
  return { query: responseQuery, results, total };
},
sendFrontendDebugReport = async (
  payload: FrontendDebugReportPayload,
): Promise<void> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/debug/logs/frontend`, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    const normalizedError = (() => {
      if (error instanceof Error) {
        return error;
      }
      return new Error(String(error));
    })();
    if (!isLikelyNetworkError(normalizedError)) {
      console.error("Failed to send frontend debug report:", error);
    }
  }
},
settleStreamConnectionError = (
  error: Error,
  rt: Readonly<StreamRuntime>,
): void => {
  if (rt.settled) {
    return;
  }
  Object.assign(rt, { settled: true });
  rt.clearTimers();
  if (error.name === "AbortError") {
    rt.resolve({
      articles: removeDuplicateArticles(rt.articles),
      errors: [...rt.errors, "Aborted"],
      sources: [...rt.sources],
      streamId: rt.streamId,
    });
    return;
  }
  rt.reject(error);
},
shouldRewriteToBrowserHost = (url: Readonly<URL>, browserHostname: string): boolean =>
  (
    browserHostname.length > 0 &&
    isLocalHostname(url.hostname) &&
    (isLanHostname(browserHostname) || isCloudflaredTunnelHostname(browserHostname))
  )
,
shouldUsePublicApiFallback = (url: Readonly<URL>, browserHostname: string): boolean =>
  (
    PUBLIC_FRONTEND_DOMAIN.length > 0 &&
    PUBLIC_API_FALLBACK.length > 0 &&
    isLocalHostname(url.hostname) &&
    isPublicFrontendHostname(browserHostname) &&
    !browserHostname.startsWith("api.")
  )
,
startStreamConnection = (
  sseUrl: string,
  options: Readonly<StreamOptions>,
  rt: Readonly<StreamRuntime>,
): void => {
  void (async () => {
    logger.debug(`Connecting to unified stream endpoint: ${sseUrl}`);
    try {
      await connectAndPumpStream(sseUrl, options.signal, rt);
    } catch (error) {
      const normalizedError = (() => {
        if (error instanceof Error) {
          return error;
        }
        return new Error(String(error));
      })();
      console.error("Stream fetch error:", error);
      settleStreamConnectionError(normalizedError, rt);
    }
  })();
},
streamEventHandlers: Record<StreamEvent["status"], StreamEventHandler> = {
  cache_data: handleCacheDataEvent,
  complete: handleCompleteEvent,
  error: handleErrorEvent,
  initial: handleInitialEvent,
  source_complete: handleSourceCompleteEvent,
  source_error: handleSourceErrorEvent,
  starting: handleStartingEvent,
},
streamNews = (options: StreamOptions = {}): {
  promise: Promise<StreamResult>;
  url: string;
} => {
  const sseUrl = buildStreamUrl(options);
  logger.debug(
    `Starting news stream with useCache=${options.useCache ?? true} and category=${options.category}`,
  );
  const { promise, resolve, reject } = Promise.withResolvers<StreamResult>();
  startStreamConnection(sseUrl, options, createStreamRuntime(options, resolve, reject));
  return { promise, url: sseUrl };
},
streamReject = (rt: Readonly<StreamRuntime>, error: Error): void => {
  if (rt.settled) {return;}
  Object.assign(rt, { settled: true });
  rt.clearTimers();
  rt.reject(error);
},
streamResolve = (
  rt: Readonly<StreamRuntime>,
  extraErrors?: readonly string[],
): void => {
  if (rt.settled) {return;}
  Object.assign(rt, { settled: true });
  rt.clearTimers();
  rt.resolve({
    articles: removeDuplicateArticles(rt.articles),
    errors: extraErrors ? [...rt.errors, ...extraErrors] : rt.errors,
    sources: [...rt.sources],
    streamId: rt.streamId,
  });
},
triggerWikiIndex = async (
  sourceName: string,
): Promise<{ status: string; message: string }> => {
  const response = await fetch(
    `${resolvedApiBaseUrl}/api/wiki/index/${encodeURIComponent(sourceName)}`,
    {
      method: "POST",
    },
  );
  if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
  return parseResponseJson(response, zApiResponseSchemas.wikiIndexTrigger);
},
updateBookmark = async (
  articleId: number,
): Promise<BookmarkEntry | null> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/bookmarks/${articleId}`, {
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
},
updateHighlight = async (
  highlightId: number,
  updates: Partial<Highlight>,
): Promise<Highlight> => {
  try {
    const response = await fetch(
      `${resolvedApiBaseUrl}/api/queue/highlights/${highlightId}`,
      {
        body: JSON.stringify(updates),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.highlight);
    logger.debug("Highlight updated:", data);
    return data;
  } catch (error) {
    console.error("Failed to update highlight:", error);
    throw error;
  }
},
updateReadingQueueItem = async (
  queueItemId: number,
  updates: UpdateQueueItemRequest,
): Promise<ReadingQueueItem> => {
  try {
    const response = await fetch(`${resolvedApiBaseUrl}/api/queue/${queueItemId}`, {
      body: JSON.stringify(updates),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await parseResponseJson(response, zApiResponseSchemas.readingQueueItem);
    logger.debug("Queue item updated:", data);
    return data;
  } catch (error) {
    console.error("Failed to update queue item:", error);
    throw error;
  }
},
validateRssUrl = async (
  url: string,
): Promise<AddRssResponse> => {
  const response = await fetch(`${resolvedApiBaseUrl}/sources/rss/validate`, {
    body: JSON.stringify({ url }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null),
     detail =
      body && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return parseResponseJson(response, zApiResponseSchemas.rssValidation);
},
withDebugQuery = (path: string, searchParams?: URLSearchParams): string => {
  const query = searchParams?.toString()
  return `${resolvedApiBaseUrl}${path}${query ? `?${query}` : ""}`
};



// Re-export shared types for backward compatibility
export type { ArticleCore, SourceCore, ClusterCore, QueuedItem, HighlightCore } from "./types/core";

export {
  resolvedApiBaseUrl as API_BASE_URL,
  ENABLE_DIGEST,
  ENABLE_HIGHLIGHTS,
  fetchNews,
  fetchNewsFromSource,
  fetchNewsByCategory,
  fetchSources,
  fetchCategories,
  requestInlineDefinition,
  fetchSourceStats,
  fetchCacheStatus,
  fetchLlmLogs,
  fetchDebugErrors,
  refreshCache,
  semanticSearch,
  fetchBookmarks,
  fetchBookmark,
  createBookmark,
  updateBookmark,
  deleteBookmark,
  fetchLikedArticles,
  createLikedArticle,
  deleteLikedArticle,
  validateRssUrl,
  promoteRssSource,
  getSourceById,
  getArticlesByCountry,
  fetchArticlesBySource,
  initializeData,
  fetchInlineDefinition,
  fetchSourceDebugData,
  fetchChromaDebugArticles,
  fetchDatabaseDebugArticles,
  fetchStorageDrift,
  fetchCacheDebugArticles,
  fetchCacheDelta,
  fetchStartupMetrics,
  fetchSourceCredibility,
  streamNews,
  mapBackendArticles,
  removeDuplicateArticles,
  fetchStreamStatus,
  sendFrontendDebugReport,
  analyzeArticle,
  fetchLanguageDiagnostics,
  performNewsResearch,
  performAgenticSearch,
  addToReadingQueue,
  removeFromReadingQueue,
  removeFromReadingQueueByUrl,
  getReadingQueue,
  updateReadingQueueItem,
  getQueueOverview,
  getReadingShelves,
  createReadingShelf,
  createHighlight,
  getHighlightsForArticle,
  getAllHighlights,
  updateHighlight,
  deleteHighlight,
  getQueueItemContent,
  getDailyDigest,
  fetchNewsPaginated,
  fetchCachedNewsPaginated,
  fetchBrowseIndex,
  fetchLiveBrowseIndex,
  fetchArticleCountsByCountry,
  fetchCountryGeoData,
  fetchCountryList,
  fetchCountryPickerItems,
  fetchNewsForCountry,
  profileReporter,
  getReporter,
  listReporters,
  researchOrganization,
  researchSourceProfile,
  checkSourceProfileCache,
  researchSourceProfilesBatch,
  getOrganization,
  getOwnershipChain,
  listOrganizations,
  analyzeMaterialContext,
  getCountryEconomicProfile,
  fetchTrending,
  fetchBreaking,
  fetchAllClusters,
  fetchClusterDetail,
  fetchClusterContradictions,
  fetchClusterLineage,
  fetchBlindspotViewer,
  fetchClusterArticles,
  fetchTrendingStats,
  fetchGdeltArticleEvents,
  fetchGdeltStats,
  fetchRelatedArticles,
  fetchSearchSuggestions,
  fetchSourceCoverage,
  fetchNoveltyScore,
  fetchArticleTopics,
  fetchBulkArticleTopics,
  parseReporterCareerTimeline,
  fetchWikiSources,
  fetchWikiSource,
  fetchWikiSourceReporters,
  fetchWikiReporters,
  fetchWikiReporter,
  fetchWikiReporterArticles,
  fetchWikiIndexStatus,
  triggerWikiIndex,
  fetchOGImage
};

export type {
  NewsSource,
  NewsArticle,
  ReadonlyBackendArticle,
  BrowseIndexResponse,
  BackendArticle,
  BookmarkEntry,
  SemanticSearchResult,
  SemanticSearchResponse,
  StreamOptions,
  StreamProgress,
  StreamEvent,
  SourceStats,
  CacheStatus,
  LlmLogEntry,
  LlmLogResponse,
  DebugErrorEntry,
  DebugErrorsResponse,
  LikedEntry,
  AddRssResponse,
  SourceDebugData,
  ChromaDebugArticle,
  ChromaDebugResponse,
  DatabaseDebugResponse,
  StorageDriftReport,
  CacheDebugArticle,
  CacheDebugResponse,
  CacheDeltaResponse,
  StartupEventMetric,
  StartupMetricsResponse,
  CredibilityDimension,
  CredibilityDataQuality,
  SourceCredibilityProfile,
  FrontendDebugReportPayload,
  FactCheckResult,
  LanguageDiagnosticExample,
  LanguageDiagnosticMetric,
  LanguageDiagnosticOverall,
  LanguageDiagnostics,
  ArticleAnalysis,
  ThinkingStep,
  NewsResearchResponse,
  AgenticSearchRequest,
  AgenticSearchResponse,
  ReadingQueueItem,
  QueueResponse,
  UpdateQueueItemRequest,
  QueueOverview,
  ReadingShelf,
  Highlight,
  QueueItemContent,
  QueueDigest,
  PaginatedResponse,
  PaginationParams,
  CountryArticleCounts,
  CountryGeoData,
  CountryListItem,
  CountryListResponse,
  CountryPickerItem,
  LocalLensResponse,
  ReporterProfile,
  OrganizationProfile,
  OwnershipChain,
  SourceResearchValue,
  SourceReporterSummary,
  AdsTxtSummary,
  SellersJsonSystemSummary,
  SellersJsonSummary,
  PolicyTransparencySignal,
  PolicyTransparencySummary,
  SourceResearchProfile,
  SourceResearchRequest,
  SourceBatchResponse,
  TradeRelationship,
  KnownInterests,
  MaterialContext,
  CountryEconomicProfile,
  GdeltTopCameo,
  GdeltContext,
  TrendingArticle,
  TrendingCluster,
  BreakingCluster,
  TrendingResponse,
  BreakingResponse,
  ClusterDetail,
  ContradictionEvidence,
  ContradictionClaim,
  AgreedFact,
  ContradictionPanelResponse,
  LineageStory,
  LineageArticleEdge,
  LineageClaim,
  LineageClaimEdge,
  LineageCorrection,
  StoryLineageResponse,
  BlindspotLens,
  BlindspotLane,
  BlindspotPreviewArticle,
  BlindspotCard,
  BlindspotViewerResponse,
  TrendingStats,
  AllCluster,
  AllClustersResponse,
  GdeltEvent,
  GdeltArticleEventsResponse,
  GdeltStatsResponse,
  RelatedArticle,
  RelatedArticlesResponse,
  SearchSuggestion,
  SearchSuggestionsResponse,
  SourceCoverageStats,
  SourceCoverageResponse,
  NoveltyScoreResponse,
  ArticleTopic,
  ArticleTopicsResponse,
  BulkArticleTopicsResponse,
  WikiAnalysisAxis,
  WikiSourceCard,
  SourceLedgerMetric,
  SourceLedger,
  WikiSourceProfile,
  WikiReporterCard,
  WikiReporterDossier,
  ReporterTimelineEntry,
  ReporterOwnershipRef,
  ReporterSharedOwnerFinding,
  ReporterCareerTimeline,
  WikiIndexStatus,
  WikiSourcesParams
};
