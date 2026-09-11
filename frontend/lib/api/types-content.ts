import type { paths as OpenApiPaths, components as OpenApiComponents } from "@/lib/generated/openapi";
import type { ApiOpaqueObject } from "./primitives";
import type {
  AdsTxtSummary,
  ArticleAnalysis,
  CredibilityDataQuality,
  CredibilityDimension,
  SourceReporterSummary,
  SourceResearchValue,
} from "./types-foundation";

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

interface NewsArticle {
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

type NewsPageQueryParams = NonNullable<OpenApiPaths["/news/page"]["get"]["parameters"]["query"]>;

interface NewsSource {
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

interface NoveltyScoreResponse {
  article_id: number;
  novelty_score: number;
  max_similarity_to_history: number;
  avg_similarity_to_history: number;
  history_size: number;
  reason?: string;
}

type OpenApiPaginatedResponse = OpenApiComponents["schemas"]["PaginatedResponse"];

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

interface QueueOverview {
  total_items: number;
  daily_items: number;
  permanent_items: number;
  unread_count: number;
  reading_count: number;
  completed_count: number;
  estimated_total_read_time_minutes: number;
}

type ReadonlyNewsArticle = Readonly<Omit<NewsArticle, "_queueData">>;

interface RelatedArticle {
  readonly id: number;
  readonly title: string;
  readonly source: string;
  readonly sourceId: string;
  readonly summary?: string;
  readonly image?: string;
  readonly publishedAt?: string;
  readonly category?: string;
  readonly url: string;
  readonly similarity_score: number;
}

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

interface SearchSuggestion {
  readonly cluster_id: number;
  readonly label: string;
  readonly relevance: number;
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

interface SemanticSearchResult {
  article: NewsArticle;
  similarityScore?: number | null;
  distance?: number | null;
}

interface SourceCoverageResponse {
  sources: Record<string, SourceCoverageStats>;
  global_article_count: number;
  error?: string;
}

interface SourceCoverageStats {
  article_count: number;
  centroid_distance?: number;
  spread?: number;
  diversity_score?: number;
}

interface SourceCredibilityProfile {
  domain: string;
  dimensions: Record<string, CredibilityDimension>;
  data_quality: CredibilityDataQuality;
  status: string;
}

interface SourceDebugData {
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

interface SourceLedgerMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  description: string;
  status: string;
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

export type {
  LocalLensResponse,
  NewsArticle,
  NewsSource,
  NoveltyScoreResponse,
  PaginatedResponse,
  PaginationParams,
  PolicyTransparencySummary,
  QueueOverview,
  ReadonlyNewsArticle,
  RelatedArticle,
  ReporterProfile,
  SearchSuggestion,
  SellersJsonSummary,
  SemanticSearchResult,
  SourceCoverageResponse,
  SourceCredibilityProfile,
  SourceDebugData,
  SourceLedger,
  SourceLedgerMetric,
  SourceResearchProfile,
};
