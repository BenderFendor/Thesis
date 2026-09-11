import type { components } from "@/lib/generated/openapi";
import type { ApiOpaqueObject } from "./primitives";
import type { DeepReadonly } from "../deep-readonly";
import type { GdeltContext, ReadingQueueItem } from "./types-foundation";
import type { RelatedArticle, SearchSuggestion, SemanticSearchResult } from "./types-content";
import type { StartupEventMetric } from "./types-runtime";

type CacheStatus = DeepReadonly<components["schemas"]["CacheStatus"]>;

type SourceStatsList = components["schemas"]["SourceStatsList"];

type CacheDebugResponse = components["schemas"]["CacheDebugResponse"];

type DatabaseDebugResponse = components["schemas"]["DatabaseDebugResponse"];

type CountryGeoData = components["schemas"]["CountryGeoData"];

type LikedListResponse = components["schemas"]["LikedListResponse"];

type BookmarkListResponse = components["schemas"]["BookmarkListResponse"];
interface Highlight {
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

interface StartupMetricsResponse {
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  events: StartupEventMetric[];
  notes: ApiOpaqueObject;
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

interface CacheRefreshProgress {
  readonly source?: string;
  readonly articlesFromSource?: number;
  readonly totalSourcesProcessed?: number;
  readonly failedSources?: number;
  readonly totalArticles?: number;
  readonly successfulSources?: number;
  readonly message?: string;
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

interface QueueDigest {
  digest_items: ReadingQueueItem[];
  total_items: number;
  estimated_read_time_minutes: number;
  generated_at: string;
}

interface RelatedArticlesResponse {
  readonly article_id: number;
  readonly related: readonly RelatedArticle[];
  readonly total: number;
}

interface SearchSuggestionsResponse {
  readonly query: string;
  readonly suggestions: readonly SearchSuggestion[];
}

interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResult[];
  total: number;
}

export type {
  CacheStatus,
  SourceStatsList,
  CacheDebugResponse,
  DatabaseDebugResponse,
  CountryGeoData,
  LikedListResponse,
  BookmarkListResponse,
  Highlight,
  StartupMetricsResponse,
  BackendArticleMapping,
  CacheRefreshProgress,
  ClusterDetail,
  QueueDigest,
  RelatedArticlesResponse,
  SearchSuggestionsResponse,
  SemanticSearchResponse,
};
