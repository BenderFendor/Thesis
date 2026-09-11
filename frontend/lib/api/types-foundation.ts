import type { components } from "@/lib/generated/openapi";
import type { ApiOpaqueObject } from "./primitives";
import type { DeepReadonly } from "../deep-readonly";

type AllCluster = DeepReadonly<components["schemas"]["AllCluster"]>;
type AllClustersResponse = components["schemas"]["AllClustersResponse"];
type BreakingCluster = DeepReadonly<components["schemas"]["BreakingCluster"]>;
type ClusterArticle = DeepReadonly<components["schemas"]["ClusterArticle"]>;
type BreakingResponse = components["schemas"]["BreakingResponse"];
type BookmarkEntry = components["schemas"]["BookmarkEntry"];
type LikedEntry = components["schemas"]["LikedEntry"];

type ContradictionPanelResponse = components["schemas"]["ContradictionPanelResponse"];
type LanguageDiagnosticExample = DeepReadonly<components["schemas"]["LanguageDiagnosticExample"]>;
type LanguageDiagnosticMetric = DeepReadonly<components["schemas"]["LanguageDiagnosticMetric"]>;
type LanguageDiagnosticOverall = DeepReadonly<components["schemas"]["LanguageDiagnosticOverall"]>;

type ReadingQueueItem = components["schemas"]["ReadingQueueItem"];
type ReadingShelf = components["schemas"]["ReadingShelf"];
type SourceReporterSummary = components["schemas"]["SourceReporterSummary"];
type SourceResearchValue = components["schemas"]["SourceResearchValue"];
type StoryLineageResponse = components["schemas"]["StoryLineageResponse"];
type ThinkingStep = components["schemas"]["ThinkingStep"];
type TrendingCluster = DeepReadonly<components["schemas"]["TrendingCluster"]>;
type TrendingResponse = components["schemas"]["TrendingResponse"];

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

interface LanguageDiagnostics {
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

interface LlmLogEntry {
  readonly timestamp?: string;
  readonly request_id?: string;
  readonly service?: string;
  readonly model?: string;
  readonly messages?: readonly ApiOpaqueObject[];
  readonly duration_ms?: number;
  readonly success?: boolean;
  readonly finish_reason?: string;
  readonly error_type?: string;
  readonly error_message?: string;
}

interface LlmLogResponse {
  readonly available: boolean;
  readonly path: string;
  readonly returned: number;
  readonly total: number;
  readonly entries: readonly LlmLogEntry[];
  readonly service?: string | null;
  readonly success_filter?: boolean | null;
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

interface ArticleAnalysis {
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

interface ArticleTopic {
  readonly cluster_id: number;
  readonly label: string;
  readonly similarity: number | null;
  readonly keywords?: readonly string[];
}

interface BlindspotSummary {
  readonly category?: string | null;
  readonly eligible_clusters: number;
  readonly generated_at: string;
  readonly source_filters: readonly string[];
  readonly window: string;
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

interface BlindspotLane {
  id: "pole_a" | "shared" | "pole_b";
  label: string;
  description: string;
  cluster_count: number;
}

interface BlindspotLens {
  id: "bias" | "credibility" | "geography" | "institutional_populist";
  label: string;
  description: string;
  available: boolean;
  unavailable_reason?: string | null;
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

interface CountryListItem {
  code: string;
  article_count: number;
  latest_article: string | null;
}

interface CountryListResponse {
  countries: CountryListItem[];
  total_countries: number;
}

interface CredibilityDataQuality {
  dimensions_available: number;
  dimensions_total: number;
  completeness_pct: number;
  last_updated: string | null;
}

interface CredibilityDimension {
  score: number | null;
  confidence: number;
  explanation: string;
  signals_available: number;
  signals_missing: number;
  provenance: { source: string; url: string; last_updated?: string; provenance_tag?: string }[];
  status: string;
  dimension: string;
}

interface DebugErrorEntry {
  readonly timestamp?: string;
  readonly request_id?: string;
  readonly service?: string;
  readonly model?: string;
  readonly error_type?: string;
  readonly error_message?: string;
  readonly event_type?: string;
  readonly message?: string;
  readonly component?: string;
  readonly operation?: string;
}

interface DebugErrorsResponse {
  readonly log_file: LlmLogResponse;
  readonly recent_request_stream_errors: readonly DebugErrorEntry[];
  readonly returned_recent_errors: number;
  readonly include_request_stream_events: boolean;
}

interface FactCheckResult {
  readonly claim: string;
  readonly verification_status: "verified" | "partially-verified" | "unverified" | "false";
  readonly evidence: string;
  readonly sources: readonly string[];
  readonly confidence: "high" | "medium" | "low";
  readonly notes?: string;
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

interface GdeltTopCameo {
  code?: string | null;
  label?: string | null;
  count: number;
}

export type {
  AllCluster,
  AllClustersResponse,
  BreakingCluster,
  ClusterArticle,
  BreakingResponse,
  BookmarkEntry,
  LikedEntry,
  ContradictionPanelResponse,
  LanguageDiagnosticExample,
  LanguageDiagnosticMetric,
  ReadingQueueItem,
  ReadingShelf,
  SourceReporterSummary,
  SourceResearchValue,
  StoryLineageResponse,
  ThinkingStep,
  TrendingCluster,
  TrendingResponse,
  AddRssResponse,
  LanguageDiagnostics,
  LlmLogEntry,
  LlmLogResponse,
  AdsTxtSummary,
  ArticleAnalysis,
  ArticleTopic,
  BlindspotSummary,
  BlindspotCard,
  BlindspotLane,
  BlindspotLens,
  CacheDeltaResponse,
  ChromaDebugResponse,
  CountryArticleCounts,
  CountryListItem,
  CountryListResponse,
  CredibilityDataQuality,
  CredibilityDimension,
  DebugErrorEntry,
  DebugErrorsResponse,
  FactCheckResult,
  FrontendDebugReportPayload,
  GdeltContext,
};
