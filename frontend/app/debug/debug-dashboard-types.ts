import type {
  CacheDebugResponse,
  CacheDeltaResponse,
  CacheStatus,
  ChromaDebugResponse,
  DatabaseDebugResponse,
  DebugErrorEntry,
  SourceStats,
  StartupEventMetric,
  StartupMetricsResponse,
  StorageDriftReport,
} from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { z } from "zod";
import type { ArticleParserTestResult as ArticleParserTestResultPayload } from "./article-parser-card";
import type { DEBUG_SCHEMA_BASE, DEBUG_SCHEMA_COMPOSITES, DEBUG_SCHEMAS, DEBUG_TABS } from "./debug-dashboard-schemas";

type ArticleParserTestResult = Readonly<ArticleParserTestResultPayload>;
type DebugActiveStreamRecord = DeepReadonly<
  z.infer<typeof DEBUG_SCHEMA_BASE.debugActiveStream>
>;
type DebugLogEventRecord = DeepReadonly<z.infer<typeof DEBUG_SCHEMA_BASE.debugLogEvent>>;
type DebugLogFileRecord = DeepReadonly<z.infer<typeof DEBUG_SCHEMA_BASE.debugLogFile>>;
type DebugSlowOperationRecord = DeepReadonly<
  z.infer<typeof DEBUG_SCHEMA_BASE.debugSlowOperation>
>;
type DebugCacheDeltaResponse = DeepReadonly<CacheDeltaResponse>;
type DebugCacheResponse = DeepReadonly<CacheDebugResponse>;
type DebugCacheStatus = DeepReadonly<CacheStatus>;
type DebugChromaResponse = DeepReadonly<ChromaDebugResponse>;
type DebugDatabaseResponse = DeepReadonly<DatabaseDebugResponse>;
type DebugError = Readonly<DebugErrorEntry>;
type DebugLlmEntry = Readonly<{
  duration_ms?: number;
  error_message?: string;
  error_type?: string;
  finish_reason?: string;
  messages?: readonly unknown[];
  model?: string;
  request_id?: string;
  service?: string;
  success?: boolean;
  timestamp?: string;
}>;
type DebugLlmResponse = Readonly<{
  available: boolean;
  entries: readonly DebugLlmEntry[];
  path: string;
  returned: number;
  service?: string | null;
  success_filter?: boolean | null;
  total: number;
}>;
type DebugPerformanceSnapshot = Readonly<{
  activeStreams: readonly Readonly<{
    eventCount: number;
    startTime: number;
    streamId: string;
  }>[];
  recentEvents: readonly Readonly<{
    eventType: string;
    message?: string;
    timestamp: string;
  }>[];
  summary: Readonly<{
    errorCount: number;
    slowOperationsCount: number;
    totalEvents: number;
  }>;
}>;
type DebugSourceStats = DeepReadonly<SourceStats>;
type DebugStartupEvent = DeepReadonly<StartupEventMetric>;
type DebugStartupMetrics = DeepReadonly<StartupMetricsResponse>;
type DebugStorageDrift = DeepReadonly<StorageDriftReport>;
type DebugErrorsPanelData = Readonly<{
  log_file: Readonly<{
    available: boolean;
    entries: readonly DebugError[];
    total: number;
  }>;
  recent_request_stream_errors: readonly DebugError[];
  returned_recent_errors: number;
}>;
type SystemStatusResponse = DeepReadonly<z.infer<typeof DEBUG_SCHEMAS.systemStatus>>;
type RssSampleEntry = DeepReadonly<z.infer<typeof DEBUG_SCHEMA_COMPOSITES.rssSampleEntry>>;
type RssParserTestResult = DeepReadonly<z.infer<typeof DEBUG_SCHEMAS.rssParserTestResult>>;
type ImageErrorCode =
  | "ARTICLE_FETCH_FAILED"
  | "FRONTEND_RENDER_FAILED"
  | "IMAGE_FETCH_FAILED"
  | "IMAGE_FETCH_TIMEOUT"
  | "IMAGE_UNSUPPORTED_TYPE"
  | "IMAGE_URL_INVALID"
  | "MIXED_CONTENT_BLOCKED"
  | "NO_IMAGE_IN_FEED"
  | "OG_IMAGE_NOT_FOUND";
type BackendDebugReport = DeepReadonly<z.infer<typeof DEBUG_SCHEMAS.backendDebugReport>>;
type LogLevelResponse = DeepReadonly<z.infer<typeof DEBUG_SCHEMAS.logLevel>>;
type DebugTab = (typeof DEBUG_TABS)[number];

interface PerformanceDebugData {
  readonly backendDebugReport: BackendDebugReport | undefined;
  readonly backendLogEvents: readonly DebugLogEventRecord[];
  readonly backendSlowOps: readonly DebugSlowOperationRecord[];
  readonly backendLogFiles: readonly DebugLogFileRecord[];
  readonly frontendPerfData: DebugPerformanceSnapshot | undefined;
}

interface DebugQueryOptions {
  readonly activeTab: DebugTab;
  readonly chromaLimit: number;
  readonly chromaOffset: number;
  readonly dbLimit: number;
  readonly dbOffset: number;
  readonly dbMissingOnly: boolean;
  readonly dbSortDirection: "asc" | "desc";
  readonly dbSourceFilter: string | undefined;
  readonly dbBeforeFilter: string | undefined;
  readonly dbAfterFilter: string | undefined;
  readonly cacheLimit: number;
  readonly cacheOffset: number;
  readonly cacheSourceFilter: string | undefined;
}

interface SystemStatusSectionProps {
  readonly systemStatus: SystemStatusResponse | undefined;
  readonly startupMetrics: DebugStartupMetrics | undefined;
  readonly startupEvents: readonly DebugStartupEvent[];
  readonly onRefreshStatus: () => void;
}

interface SourcesSectionProps {
  readonly sourceStats: readonly DebugSourceStats[];
  readonly cacheStatus: DebugCacheStatus | undefined;
  readonly cacheRefreshMessage: string | undefined;
  readonly cacheRefreshError: string | undefined;
  readonly cacheRefreshRunning: boolean;
  readonly onRefresh: () => void;
  readonly onRefreshCache: () => void;
}

interface StartupTimelineCardProps {
  readonly startupMetrics: DebugStartupMetrics | undefined;
  readonly startupEvents: readonly DebugStartupEvent[];
  readonly detailFallback?: string;
}

interface StorageSectionProps {
  readonly chromaData: DebugChromaResponse | undefined;
  readonly dbData: DebugDatabaseResponse | undefined;
  readonly driftData: DebugStorageDrift | undefined;
  readonly cacheData: DebugCacheResponse | undefined;
  readonly cacheDelta: DebugCacheDeltaResponse | undefined;
  readonly startupMetrics: DebugStartupMetrics | undefined;
  readonly startupEvents: readonly DebugStartupEvent[];
  readonly chromaLimit: number;
  readonly setChromaLimit: (value: number) => void;
  readonly chromaOffset: number;
  readonly setChromaOffset: (value: number) => void;
  readonly dbLimit: number;
  readonly setDbLimit: (value: number) => void;
  readonly dbOffset: number;
  readonly setDbOffset: (value: number) => void;
  readonly dbSortDirection: "asc" | "desc";
  readonly setDbSortDirection: (value: "asc" | "desc") => void;
  readonly dbMissingOnly: boolean;
  readonly setDbMissingOnly: (value: boolean) => void;
  readonly cacheLimit: number;
  readonly setCacheLimit: (value: number) => void;
  readonly cacheOffset: number;
  readonly setCacheOffset: (value: number) => void;
  readonly cacheSourceDraft: string;
  readonly setCacheSourceDraft: (value: string) => void;
  readonly dbSourceDraft: string;
  readonly setDbSourceDraft: (value: string) => void;
  readonly dbBeforeDraft: string;
  readonly setDbBeforeDraft: (value: string) => void;
  readonly dbAfterDraft: string;
  readonly setDbAfterDraft: (value: string) => void;
  readonly onApplyCacheFilters: () => void;
  readonly onApplyDbFilters: () => void;
}

interface StorageSnapshotSectionProps {
  readonly chromaData: DebugChromaResponse | undefined;
  readonly dbData: DebugDatabaseResponse | undefined;
  readonly driftStats: DebugStorageDrift | undefined;
  readonly cacheData: DebugCacheResponse | undefined;
  readonly chromaLimit: number;
  readonly setChromaLimit: (value: number) => void;
  readonly chromaOffset: number;
  readonly setChromaOffset: (value: number) => void;
  readonly dbLimit: number;
  readonly setDbLimit: (value: number) => void;
  readonly dbOffset: number;
  readonly setDbOffset: (value: number) => void;
  readonly dbSortDirection: "asc" | "desc";
  readonly setDbSortDirection: (value: "asc" | "desc") => void;
  readonly dbMissingOnly: boolean;
  readonly setDbMissingOnly: (value: boolean) => void;
  readonly cacheLimit: number;
  readonly setCacheLimit: (value: number) => void;
  readonly cacheOffset: number;
  readonly setCacheOffset: (value: number) => void;
}

interface ControlsSectionProps {
  readonly logLevel: string;
  readonly onSetLogLevel: (level: string) => void;
  readonly frontendDebugMode: boolean;
  readonly onToggleFrontendDebug: () => void;
}

interface DebugDashboardContentProps {
  readonly embedded: boolean;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly activeTab: DebugTab;
  readonly onTabChange: (value: string) => void;
  readonly onRefresh: () => void;
  readonly system: SystemStatusSectionProps;
  readonly sources: SourcesSectionProps;
  readonly storage: StorageSectionProps;
  readonly parser: ParserSectionProps;
  readonly controls: ControlsSectionProps;
  readonly llm: LlmSectionProps;
  readonly errors: ErrorsSectionProps;
  readonly performance: PerformanceSectionProps;
}

interface ParserSectionProps {
  readonly rssTestUrl: string;
  readonly setRssTestUrl: (value: string) => void;
  readonly rssTestResult: RssParserTestResult | undefined;
  readonly rssTestLoading: boolean;
  readonly testRssParser: () => void;
  readonly articleTestUrl: string;
  readonly setArticleTestUrl: (value: string) => void;
  readonly articleTestResult: ArticleParserTestResult | undefined;
  readonly articleTestLoading: boolean;
  readonly testArticleParser: () => void;
}

interface LlmSectionProps {
  readonly llmLogs: DebugLlmResponse | undefined;
  readonly onRefresh: () => void;
}

interface LlmCallCardProps {
  readonly entry: DebugLlmEntry;
}

interface ErrorsSectionProps {
  readonly debugErrors: DebugErrorsPanelData | undefined;
  readonly onRefresh: () => void;
}

interface PerformanceSectionProps {
  readonly backendDebugReport: BackendDebugReport | undefined;
  readonly backendLogEvents: readonly DebugLogEventRecord[];
  readonly backendSlowOps: readonly DebugSlowOperationRecord[];
  readonly backendLogFiles: readonly DebugLogFileRecord[];
  readonly frontendPerfData: DebugPerformanceSnapshot | undefined;
  readonly onRefresh: () => void;
}

export type {
  ArticleParserTestResult,
  BackendDebugReport,
  DebugActiveStreamRecord,
  DebugCacheDeltaResponse,
  DebugCacheResponse,
  DebugCacheStatus,
  DebugChromaResponse,
  DebugDatabaseResponse,
  DebugError,
  DebugErrorsPanelData,
  DebugLogEventRecord,
  DebugLogFileRecord,
  DebugLlmEntry,
  DebugLlmResponse,
  DebugPerformanceSnapshot,
  DebugQueryOptions,
  DebugSlowOperationRecord,
  DebugSourceStats,
  DebugStartupEvent,
  DebugStartupMetrics,
  DebugStorageDrift,
  DebugTab,
  DebugDashboardContentProps,
  ErrorsSectionProps,
  ImageErrorCode,
  LlmCallCardProps,
  LlmSectionProps,
  LogLevelResponse,
  ParserSectionProps,
  PerformanceDebugData,
  PerformanceSectionProps,
  RssParserTestResult,
  RssSampleEntry,
  SourcesSectionProps,
  StartupTimelineCardProps,
  StorageSectionProps,
  StorageSnapshotSectionProps,
  SystemStatusResponse,
  SystemStatusSectionProps,
  ControlsSectionProps,
};
