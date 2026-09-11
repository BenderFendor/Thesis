import type { ApiOpaqueObject } from "./primitives";
import type { AdsTxtSummary } from "./types-foundation";
import type {
  PolicyTransparencySummary,
  SellersJsonSummary,
  SourceLedger,
  NewsArticle,
  ReadonlyNewsArticle,
} from "./types-content";

interface SourceStats {
  readonly name: string;
  readonly url: string;
  readonly category: string;
  readonly country: string;
  readonly funding_type?: string;
  readonly bias_rating?: string;
  readonly article_count: number;
  readonly status: "success" | "warning" | "error";
  readonly error_message?: string;
  readonly last_checked: string;
}

interface StartupEventMetric {
  name: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  detail?: string | null;
  metadata?: ApiOpaqueObject;
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

type StreamErrorHandler = (error: string) => void;

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

type StreamProgressHandler = (progress: Readonly<StreamProgress>) => void;

interface StreamResult {
  readonly articles: readonly NewsArticle[];
  readonly sources: readonly string[];
  readonly streamId?: string;
  readonly errors: readonly string[];
}

type StreamResolveHandler = (value: StreamResult) => void;

type StreamRejectHandler = (error: Readonly<Error>) => void;

interface StreamRuntime {
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

type StreamSourceCompleteHandler = (
  source: string,
  articles: readonly ReadonlyNewsArticle[],
) => void;

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

interface WikiIndexStatus {
  readonly total_entries: number;
  readonly by_status: Readonly<Record<string, number>>;
  readonly by_type: Readonly<Record<string, number>>;
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

interface BackendSource {
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

interface ReporterOwnershipRef {
  readonly entity_id: string;
  readonly entity_type?: string | null;
  readonly label: string;
  readonly profile_path?: string | null;
}

interface ReporterSharedOwnerFinding {
  readonly claim_ids: readonly string[];
  readonly evidence_count: number;
  readonly outlets: readonly ReporterOwnershipRef[];
  readonly owner: ReporterOwnershipRef;
}

interface ReporterTimelineEntry {
  readonly article_count?: number | null;
  readonly end_date?: string | null;
  readonly evidence_url?: string | null;
  readonly outlet: string;
  readonly role?: string | null;
  readonly source: "byline" | "affiliation";
  readonly start_date?: string | null;
}

interface ReporterCareerTimeline {
  readonly shared_owner_findings: readonly ReporterSharedOwnerFinding[];
  readonly timeline: readonly ReporterTimelineEntry[];
}
interface ReadonlyBackendArticle {
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
  readonly geo_signal?: Readonly<Record<string, string>> | null;
  readonly id?: number | null;
  readonly image?: string | null;
  readonly image_url?: string | null;
  readonly is_persisted?: boolean | null;
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
  readonly translated?: boolean | null;
  readonly url?: string | null;
}

export type {
  SourceStats,
  StartupEventMetric,
  StorageDriftReport,
  StreamOptions,
  StreamProgress,
  StreamResult,
  StreamRuntime,
  StreamResolveHandler,
  StreamRejectHandler,
  WikiAnalysisAxis,
  WikiIndexStatus,
  WikiReporterCard,
  WikiReporterDossier,
  WikiSourceProfile,
  BackendSource,
  ReporterCareerTimeline,
  ReadonlyBackendArticle,
};
