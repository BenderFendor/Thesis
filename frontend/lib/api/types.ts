// Frontend API types: wire shapes alias the generated OpenAPI contract; frontend-only concepts are hand-declared.

import type { ApiOpaqueObject } from "./primitives";

import type {
  components,
  components as OpenApiComponents,
  paths as OpenApiPaths,
} from "@/lib/generated/openapi";

export type AgreedFact = components["schemas"]["AgreedFact"];
export type AllCluster = components["schemas"]["AllCluster"];
export type AllClustersResponse = components["schemas"]["AllClustersResponse"];
export type BreakingCluster = components["schemas"]["BreakingCluster"];
export type BreakingResponse = components["schemas"]["BreakingResponse"];
export type ContradictionClaim = components["schemas"]["ContradictionClaim"];
export type ContradictionEvidence = components["schemas"]["ContradictionEvidence"];
export type ContradictionPanelResponse = components["schemas"]["ContradictionPanelResponse"];
export type LanguageDiagnosticExample = components["schemas"]["LanguageDiagnosticExample"];
export type LanguageDiagnosticMetric = components["schemas"]["LanguageDiagnosticMetric"];
export type LanguageDiagnosticOverall = components["schemas"]["LanguageDiagnosticOverall"];
export type LineageArticleEdge = components["schemas"]["LineageArticleEdge"];
export type LineageClaim = components["schemas"]["LineageClaim"];
export type LineageClaimEdge = components["schemas"]["LineageClaimEdge"];
export type LineageCorrection = components["schemas"]["LineageCorrection"];
export type LineageStory = components["schemas"]["LineageStory"];
export type ReadingQueueItem = components["schemas"]["ReadingQueueItem"];
export type ReadingShelf = components["schemas"]["ReadingShelf"];
export type SourceReporterSummary = components["schemas"]["SourceReporterSummary"];
export type SourceResearchValue = components["schemas"]["SourceResearchValue"];
export type StoryLineageResponse = components["schemas"]["StoryLineageResponse"];
export type ThinkingStep = components["schemas"]["ThinkingStep"];
export type TrendingCluster = components["schemas"]["TrendingCluster"];
export type TrendingResponse = components["schemas"]["TrendingResponse"];

export interface AddRssResponse {
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

export interface AdsTxtSummary {
  url: string;
  authorized_sellers: number;
  direct_sellers: number;
  resellers: number;
  duplicate_records: number;
  invalid_lines: number;
  owner_domains: string[]
  manager_domains: string[]
  contact: string[]
}

export type { ApiJsonValue, ApiOpaqueObject, StreamReader, ApiRequestInit } from "./primitives";
export interface ArticleAnalysis {
  readonly success: boolean;
  readonly article_url: string;
  readonly full_text?: string;
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly publish_date?: string;
  readonly source_analysis?: {
    readonly credibility_assessment: string;
    readonly ownership: string;
    readonly funding_model: string;
    readonly political_leaning: string;
    readonly reputation: string;
  };
  readonly reporter_analysis?: {
    readonly background: string;
    readonly expertise: string;
    readonly known_biases: string;
    readonly track_record: string;
  };
  readonly bias_analysis?: {
    readonly tone_bias: string;
    readonly framing_bias: string;
    readonly selection_bias: string;
    readonly source_diversity: string;
    readonly overall_bias_score: string;
  };
  readonly fact_check_suggestions?: readonly string[];
  readonly fact_check_results?: readonly FactCheckResult[];
  readonly grounding_metadata?: {
    readonly grounding_chunks?: readonly { readonly uri?: string; readonly title?: string }[];
    readonly grounding_supports?: readonly unknown[];
    readonly web_search_queries?: readonly string[];
  };
  readonly language_diagnostics?: LanguageDiagnostics | null;
  readonly summary?: string;
  readonly error?: string;
}

export interface ArticleTopic {
  cluster_id: number;
  label: string;
  similarity: number | null;
  keywords?: string[]
}

export interface BlindspotSummary {
  readonly category?: string | null;
  readonly eligible_clusters: number;
  readonly generated_at: string;
  readonly source_filters: readonly string[];
  readonly window: string;
}

export interface BlindspotCard {
  cluster_id: number;
  cluster_label: string;
  keywords: string[]
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
  articles: BlindspotPreviewArticle[]
}

export interface BlindspotLane {
  id: "pole_a" | "shared" | "pole_b";
  label: string;
  description: string;
  cluster_count: number;
}

export interface BlindspotLens {
  id: "bias" | "credibility" | "geography" | "institutional_populist";
  label: string;
  description: string;
  available: boolean;
  unavailable_reason?: string | null;
}

export interface BlindspotPreviewArticle {
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
  authors?: string[]
}

export interface BookmarkEntry {
  bookmarkId: number;
  articleId: number;
  article: NewsArticle;
  createdAt?: string;
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

export interface CacheDeltaResponse {
  cache_total: number;
  cache_sampled: number;
  db_total: number;
  missing_in_db_count: number;
  missing_in_db_sample: string[]
  source?: string | null;
  sample_offset: number;
  sample_limit: number;
}

export interface ChromaDebugArticle {
  id: string;
  metadata: ApiOpaqueObject;
  preview: string;
}

export interface ChromaDebugResponse {
  limit: number;
  offset: number;
  returned: number;
  total?: number;
  articles: ChromaDebugArticle[]
}

export interface CountryArticleCounts {
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

export interface CountryListItem {
  code: string;
  article_count: number;
  latest_article: string | null;
}

export interface CountryListResponse {
  countries: CountryListItem[]
  total_countries: number;
}

export interface CredibilityDataQuality {
  dimensions_available: number
  dimensions_total: number
  completeness_pct: number
  last_updated: string | null
}

export interface CredibilityDimension {
  score: number | null
  confidence: number
  explanation: string
  signals_available: number
  signals_missing: number
  provenance: { source: string; url: string; last_updated?: string; provenance_tag?: string }[]
  status: string
  dimension: string
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
  recent_request_stream_errors: DebugErrorEntry[]
  returned_recent_errors: number;
  include_request_stream_events: boolean;
}

export interface FactCheckResult {
  readonly claim: string;
  readonly verification_status:
    | "verified"
    | "partially-verified"
    | "unverified"
    | "false";
  readonly evidence: string;
  readonly sources: readonly string[];
  readonly confidence: "high" | "medium" | "low";
  readonly notes?: string;
}

export interface FrontendDebugReportPayload {
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

export interface GdeltContext {
  total_events: number;
  top_cameo: GdeltTopCameo[]
  goldstein_avg?: number | null;
  goldstein_min?: number | null;
  goldstein_max?: number | null;
  goldstein_bucket?: string | null;
  tone_avg?: number | null;
  tone_baseline_avg?: number | null;
  tone_delta_vs_cluster?: number | null;
}

export interface GdeltTopCameo {
  code?: string | null;
  label?: string | null;
  count: number;
}

export interface LanguageDiagnostics {
  readonly success: boolean;
  readonly article_url: string;
  readonly title?: string | null;
  readonly sentence_count: number;
  readonly word_count: number;
  readonly passive_voice?: LanguageDiagnosticMetric | null;
  readonly actor_omission?: LanguageDiagnosticMetric | null;
  readonly euphemisms?: LanguageDiagnosticMetric | null;
  readonly sanitized_language?: LanguageDiagnosticMetric | null;
  readonly overall?: LanguageDiagnosticOverall | null;
  readonly error?: string | null;
}

export interface LikedEntry {
  likedId: number;
  articleId: number;
  article: NewsArticle;
  createdAt?: string;
}

export interface LlmLogEntry {
  timestamp?: string;
  request_id?: string;
  service?: string;
  model?: string;
  messages?: ApiOpaqueObject[]
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
  entries: LlmLogEntry[]
  service?: string | null;
  success_filter?: boolean | null;
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
  articles: NewsArticle[]
}

export interface NewsArticle {
  readonly title: string;
  readonly source: string;
  readonly sourceId: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly id: number;
  readonly country: string;
  readonly credibility: "high" | "medium" | "low";
  readonly bias: "left" | "center" | "right";
  readonly summary: string;
  readonly content?: string;
  readonly image: string;
  readonly _parsedTimestamp?: number;
  readonly category: string;
  readonly tags: readonly string[];
  readonly originalLanguage: string;
  readonly translated: boolean;
  // Phase 5 Fields
  readonly source_country?: string;
  readonly mentioned_countries?: readonly string[];
  readonly geo_signal?: {
    readonly id: string;
    readonly label: string;
  };
  readonly author?: string;
  readonly authors?: readonly string[];
  // Preloaded queue data
  readonly _queueData?: {
    readonly fullText?: string;
    readonly readingTimeMinutes?: number;
    readonly aiAnalysis?: ArticleAnalysis;
    readonly preloadedAt?: number;
  };
  readonly hasFullContent?: boolean;
  readonly isPersisted?: boolean;
}

export type NewsPageQueryParams = NonNullable<
  OpenApiPaths["/news/page"]["get"]["parameters"]["query"]
>;

export interface NewsSource {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly country: string;
  readonly url: string;
  readonly rssUrl: string;
  readonly credibility: "high" | "medium" | "low";
  readonly bias: "left" | "center" | "right";
  readonly category: readonly string[];
  readonly language: string;
  readonly funding: readonly string[];
  readonly sourceType?: string | null;
  readonly isPaywalled?: boolean;
  readonly credibilityScore?: number;
  readonly factualRating?: string;
}

export interface NoveltyScoreResponse {
  article_id: number;
  novelty_score: number;
  max_similarity_to_history: number;
  avg_similarity_to_history: number;
  history_size: number;
  reason?: string;
}

export type OpenApiPaginatedResponse = OpenApiComponents["schemas"]["PaginatedResponse"];

export interface PaginatedResponse {
  articles: NewsArticle[]
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

export interface PolicyTransparencySignal {
  id: string;
  label: string;
  status: "available";
  sources: string[]
  matched_terms: string[]
}

export interface PolicyTransparencySummary {
  checked_pages: number;
  available_signals: number;
  signals: PolicyTransparencySignal[]
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

export type ReadonlyNewsArticle = Readonly<NewsArticle>;

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

export interface ReporterProfile {
  id?: number;
  name: string;
  normalized_name?: string;
  bio?: string;
  career_history?: {
    organization?: string;
    role?: string;
    source?: string;
  }[];
  topics?: string[]
  education?: ApiOpaqueObject[]
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
  research_sources?: string[]
  research_confidence?: string;
  cached: boolean;
}

export interface SearchSuggestion {
  cluster_id: number;
  label: string;
  relevance: number;
}

export interface SellersJsonSummary {
  checked_ad_systems: number;
  available_sellers_json: number;
  checked_records: number;
  matched_records: number;
  missing_seller_ids: number;
  owner_domain_matches: number;
  manager_domain_matches: number;
  systems: SellersJsonSystemSummary[]
}

export interface SellersJsonSystemSummary {
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

export interface SemanticSearchResult {
  article: NewsArticle;
  similarityScore?: number | null;
  distance?: number | null;
}

export interface SourceCoverageResponse {
  sources: Record<string, SourceCoverageStats>;
  global_article_count: number;
  error?: string;
}

export interface SourceCoverageStats {
  article_count: number;
  centroid_distance?: number;
  spread?: number;
  diversity_score?: number;
}

export interface SourceCredibilityProfile {
  domain: string
  dimensions: Record<string, CredibilityDimension>
  data_quality: CredibilityDataQuality
  status: string
}

export interface SourceDebugData {
  readonly source_name: string;
  readonly source_config: Readonly<ApiOpaqueObject> | null;
  readonly rss_url: string;
  readonly all_urls?: readonly string[];
  readonly feed_metadata: {
    readonly title: string;
    readonly description: string;
    readonly link: string;
    readonly language: string;
    readonly updated: string;
    readonly generator: string;
  };
  readonly feed_status: {
    readonly http_status: number | string;
    readonly bozo: boolean;
    readonly bozo_exception: string;
    readonly entries_count: number;
  };
  readonly parsed_entries: readonly {
    readonly index: number;
    readonly title: string;
    readonly link: string;
    readonly description: string;
    readonly published: string;
    readonly author: string;
    readonly tags: readonly unknown[];
    readonly has_images: boolean;
    readonly image_sources: readonly unknown[];
    readonly content_images: readonly string[];
    readonly description_images: readonly string[];
    readonly raw_entry_keys: readonly string[];
  }[];
  readonly cached_articles: readonly Readonly<ApiOpaqueObject>[];
  readonly source_statistics?: {
    readonly name: string;
    readonly url: string | readonly string[];
    readonly category: string;
    readonly country: string;
    readonly funding_type: string;
    readonly bias_rating: string;
    readonly article_count: number;
    readonly status: string;
    readonly error_message: string | null;
    readonly last_checked: string;
    readonly is_consolidated?: boolean;
    readonly sub_feeds?: readonly {
      readonly url: string;
      readonly status: "success" | "warning" | "error";
      readonly article_count: number;
      readonly error?: string;
    }[];
  } | null;
  readonly debug_timestamp: string;
  readonly image_analysis: {
    readonly total_entries: number;
    readonly entries_with_images: number;
    readonly image_sources: readonly unknown[];
  };
  readonly error?: string;
}

export interface SourceLedger {
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
  metrics: SourceLedgerMetric[]
}

export interface SourceLedgerMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  description: string;
  status: string;
}

export interface SourceResearchProfile {
  name: string;
  canonical_name?: string;
  website?: string;
  fetched_at?: string;
  cached?: boolean;
  fields: Record<string, SourceResearchValue[]>;
  key_reporters?: SourceReporterSummary[]
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

export interface StartupEventMetric {
  name: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  detail?: string | null;
  metadata?: ApiOpaqueObject;
}

export interface StorageDriftReport {
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
  dangling_in_chroma: string[]
}

export type StreamErrorHandler = (error: string) => void;

export interface StreamEvent {
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

export interface StreamOptions {
  readonly useCache?: boolean;
  readonly category?: string;
  readonly onProgress?: StreamProgressHandler;
  readonly onSourceComplete?: StreamSourceCompleteHandler;
  readonly onError?: StreamErrorHandler;
  readonly signal?: Readonly<AbortSignal>;
}

export interface StreamProgress {
  readonly completed: number;
  readonly total: number;
  readonly percentage: number;
  readonly currentSource?: string;
  readonly message?: string;
}

export type StreamProgressHandler = (progress: Readonly<StreamProgress>) => void;

export interface StreamResult {
  readonly articles: readonly NewsArticle[];
  readonly sources: readonly string[];
  readonly streamId?: string;
  readonly errors: readonly string[];
}

export interface StreamRuntime {
  readonly articles: readonly NewsArticle[];
  readonly sources: readonly string[];
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

export type StreamSourceCompleteHandler = (
  source: string,
  articles: readonly ReadonlyNewsArticle[],
) => void;

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
  authors?: string[]
  gdelt_context?: GdeltContext | null;
}

export interface WikiAnalysisAxis {
  axis_name: string;
  score: number;
  confidence?: string;
  prose_explanation?: string;
  citations?: { url?: string; title?: string; snippet?: string }[];
  empirical_basis?: string;
  scored_by?: string;
  last_scored_at?: string;
}

export interface WikiIndexStatus {
  total_entries: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
}

export interface WikiReporterCard {
  id: number;
  name: string;
  normalized_name?: string;
  bio?: string;
  topics?: string[]
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
  career_history?: {
    organization?: string;
    role?: string;
    source?: string;
  }[];
  education?: ApiOpaqueObject[]
  leaning_sources?: string[]
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
  controversies?: ApiOpaqueObject[]
  institutional_affiliations?: ApiOpaqueObject[]
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
  research_sources?: string[]
}

export interface WikiSourceProfile {
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
  analysis_axes: WikiAnalysisAxis[]
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
  geographic_focus: string[]
  topic_focus: string[]
  index_status?: string;
  last_indexed_at?: string;
}

export interface BackendSource {
  readonly bias_rating?: string;
  readonly category?: string;
  readonly country: string;
  readonly credibility_score?: number | null;
  readonly factual_rating?: string | null;
  readonly funding_type?: string;
  readonly id?: string;
  readonly is_paywalled?: boolean;
  readonly name: string;
  readonly ownership_label?: string;
  readonly rssUrl?: string;
  readonly slug?: string;
  readonly source_type?: string | null;
  readonly url: string;
}

export interface ReporterOwnershipRef {
  readonly entity_id: string;
  readonly entity_type?: string | null;
  readonly label: string;
  readonly profile_path?: string | null;
}

export interface ReporterSharedOwnerFinding {
  readonly claim_ids: readonly string[];
  readonly evidence_count: number;
  readonly outlets: readonly ReporterOwnershipRef[];
  readonly owner: ReporterOwnershipRef;
}

export interface ReporterTimelineEntry {
  readonly article_count?: number | null;
  readonly end_date?: string | null;
  readonly evidence_url?: string | null;
  readonly outlet: string;
  readonly role?: string | null;
  readonly source: "byline" | "affiliation";
  readonly start_date?: string | null;
}

export interface ReporterCareerTimeline {
  readonly shared_owner_findings: readonly ReporterSharedOwnerFinding[];
  readonly timeline: readonly ReporterTimelineEntry[];
}
export interface ReadonlyBackendArticle {
  readonly article_id?: number;
  readonly article_url?: string | null;
  readonly author?: string | null;
  readonly authors?: readonly string[] | null;
  readonly bias?: string | null;
  readonly category?: string | null;
  readonly content?: string | null;
  readonly country?: string | null;
  readonly credibility?: string | null;
  readonly description?: string | null;
  readonly geo_signal?: Readonly<{ readonly id: string; readonly label: string }> | null;
  readonly id?: number;
  readonly image?: string | null;
  readonly image_url?: string | null;
  readonly is_persisted?: boolean;
  readonly link?: string | null;
  readonly mentioned_countries?: readonly string[] | null;
  readonly original_language?: string | null;
  readonly original_url?: string | null;
  readonly published?: string | null;
  readonly publishedAt?: string | null;
  readonly published_at?: string | null;
  readonly source?: string | null;
  readonly source_country?: string | null;
  readonly source_id?: string | null;
  readonly source_name?: string | null;
  readonly summary?: string | null;
  readonly title?: string | null;
  readonly translated?: boolean;
  readonly url?: string | null;
}

export type CacheStatus = components["schemas"]["CacheStatus"];

export type SourceStatsList = components["schemas"]["SourceStatsList"];

export type CacheDebugResponse = components["schemas"]["CacheDebugResponse"];

export type DatabaseDebugResponse = components["schemas"]["DatabaseDebugResponse"];

export type CountryGeoData = components["schemas"]["CountryGeoData"];

export type TrendingStats = components["schemas"]["TrendingStats"];

export type LikedListResponse = components["schemas"]["LikedListResponse"];

export type BookmarkListResponse = components["schemas"]["BookmarkListResponse"];
export interface Highlight {
  readonly id?: number;
  readonly user_id?: number;
  readonly client_id?: string;
  readonly article_url: string;
  readonly highlighted_text: string;
  readonly color: "yellow" | "blue" | "red" | "green" | "purple";
  readonly note?: string;
  readonly character_start: number;
  readonly character_end: number;
  readonly created_at?: string;
  readonly updated_at?: string;
}

export interface StartupEventMetric {
  name: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  detail?: string | null;
  metadata?: ApiOpaqueObject;
}

export interface StartupMetricsResponse {
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  events: StartupEventMetric[]
  notes: ApiOpaqueObject;
}

export interface BackendArticleMapping {
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
  authors: string[]
  country: string;
  sourceCountry: string;
  mentionedCountries: string[]
  credibility: "high" | "medium" | "low";
  bias: "left" | "center" | "right";
  normalizedSourceId: string;
  geoSignal: { id: string; label: string } | undefined;
}

export type CountryNameMap = Record<string, string>;

export interface CacheRefreshProgress {
  readonly source?: string;
  readonly articlesFromSource?: number;
  readonly totalSourcesProcessed?: number;
  readonly failedSources?: number;
  readonly totalArticles?: number;
  readonly successfulSources?: number;
  readonly message?: string;
}

export interface ClusterDetail {
  id: number;
  label?: string | null;
  keywords: string[]
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

export interface QueueDigest {
  digest_items: ReadingQueueItem[]
  total_items: number;
  estimated_read_time_minutes: number;
  generated_at: string;
}

export interface RelatedArticlesResponse {
  article_id: number;
  related: RelatedArticle[]
  total: number;
}

export interface SearchSuggestionsResponse {
  query: string;
  suggestions: SearchSuggestion[]
}

export interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResult[]
  total: number;
}

export type StreamResolveHandler = (value: StreamResult) => void;

export type StreamRejectHandler = (error: Readonly<Error>) => void;

export type StreamEventHandler = (
  data: Readonly<StreamEvent>,
  runtime: Readonly<StreamRuntime>,
) => void;

