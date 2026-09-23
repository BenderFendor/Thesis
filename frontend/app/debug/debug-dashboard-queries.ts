import {
  API_BASE_URL,
  fetchCacheDebugArticles,
  fetchCacheDelta,
  fetchCacheStatus,
  fetchChromaDebugArticles,
  fetchDatabaseDebugArticles,
  fetchDebugErrors,
  fetchLlmLogs,
  fetchSourceStats,
  fetchStartupMetrics,
  fetchStorageDrift,
} from "@/lib/api";
import type {
  CacheDebugResponse,
  CacheDeltaResponse,
  CacheStatus,
  ChromaDebugResponse,
  DatabaseDebugResponse,
  DebugErrorsResponse,
  LlmLogResponse,
  SourceStats,
  StartupMetricsResponse,
  StorageDriftReport,
} from "@/lib/api";
import { exportDebugData } from "@/lib/performance-logger";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { DEBUG_SCHEMAS } from "./debug-dashboard-schemas";
import type {
  DebugQueryOptions,
  DebugTab,
  LogLevelResponse,
  PerformanceDebugData,
  SystemStatusResponse,
} from "./debug-dashboard-types";

const parseDebugResponse = async <Schema extends z.ZodType<unknown>>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema> | undefined> => {
  if (!response.ok) {
    return void 0;
  }
  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return void 0;
  }
  return parsed.data;
};

const fetchDebugLogLevel = async (): Promise<LogLevelResponse> => {
  const response = await fetch(`${API_BASE_URL}/debug/loglevel`);
  if (!response.ok) {
    throw new Error("Failed to load log level");
  }
  const data = await parseDebugResponse(response, DEBUG_SCHEMAS.logLevel);
  if (data === undefined) {
    throw new Error("Failed to parse log level");
  }
  return data;
};

const fetchDebugSystemStatus = async (): Promise<SystemStatusResponse> => {
  const response = await fetch(`${API_BASE_URL}/debug/system/status`);
  if (!response.ok) {
    throw new Error("Failed to load system status");
  }
  const data = await parseDebugResponse(response, DEBUG_SCHEMAS.systemStatus);
  if (data === undefined) {
    throw new Error("Failed to parse system status");
  }
  return data;
};

const fetchPerformanceDebugData = async (): Promise<PerformanceDebugData> => {
  const [reportResponse, eventsResponse, slowResponse, filesResponse] = await Promise.all([
    fetch(`${API_BASE_URL}/debug/logs/report`),
    fetch(`${API_BASE_URL}/debug/logs/events?limit=100`),
    fetch(`${API_BASE_URL}/debug/logs/slow`),
    fetch(`${API_BASE_URL}/debug/logs/files`),
  ]);
  const report = await parseDebugResponse(reportResponse, DEBUG_SCHEMAS.backendDebugReport);
  const eventsData = await parseDebugResponse(eventsResponse, DEBUG_SCHEMAS.debugLogEvents);
  const slowData = await parseDebugResponse(slowResponse, DEBUG_SCHEMAS.debugSlowOperations);
  const filesData = await parseDebugResponse(filesResponse, DEBUG_SCHEMAS.debugLogFiles);

  return {
    backendDebugReport: report ?? undefined,
    backendLogEvents: eventsData?.events ?? [],
    backendLogFiles: filesData?.files ?? [],
    backendSlowOps: slowData?.operations ?? [],
    frontendPerfData: exportDebugData(),
  };
};

const useChromaDebugQuery = (options: DebugQueryOptions, enabled: boolean) =>
  useQuery<ChromaDebugResponse>({
    enabled,
    queryFn: () =>
      fetchChromaDebugArticles({ limit: options.chromaLimit, offset: options.chromaOffset }),
    queryKey: ["debug-chroma", options.chromaLimit, options.chromaOffset],
    retry: 1,
  });

const useDatabaseDebugQuery = (options: DebugQueryOptions, enabled: boolean) =>
  useQuery<DatabaseDebugResponse>({
    enabled,
    queryFn: () =>
      fetchDatabaseDebugArticles({
        limit: options.dbLimit,
        missing_embeddings_only: options.dbMissingOnly,
        offset: options.dbOffset,
        published_after: options.dbAfterFilter,
        published_before: options.dbBeforeFilter,
        sort_direction: options.dbSortDirection,
        source: options.dbSourceFilter,
      }),
    queryKey: [
      "debug-database",
      options.dbLimit,
      options.dbOffset,
      options.dbMissingOnly,
      options.dbSortDirection,
      options.dbSourceFilter,
      options.dbBeforeFilter,
      options.dbAfterFilter,
    ],
    retry: 1,
  });

const useStorageDriftQuery = (enabled: boolean) =>
  useQuery<StorageDriftReport>({
    enabled,
    queryFn: () => fetchStorageDrift(100),
    queryKey: ["debug-storage-drift"],
    retry: 1,
  });

const useStartupMetricsQuery = (enabled: boolean) =>
  useQuery<StartupMetricsResponse>({
    enabled,
    queryFn: fetchStartupMetrics,
    queryKey: ["debug-startup-metrics"],
    retry: 1,
  });

const useCacheDebugQueries = (options: DebugQueryOptions, enabled: boolean) => {
  const cacheDataQuery = useQuery<CacheDebugResponse>({
    enabled,
    queryFn: () =>
      fetchCacheDebugArticles({
        limit: options.cacheLimit,
        offset: options.cacheOffset,
        source: options.cacheSourceFilter,
      }),
    queryKey: ["debug-cache", options.cacheLimit, options.cacheOffset, options.cacheSourceFilter],
    retry: 1,
  });
  const cacheDeltaQuery = useQuery<CacheDeltaResponse>({
    enabled,
    queryFn: () =>
      fetchCacheDelta({
        sample_limit: options.cacheLimit,
        sample_offset: options.cacheOffset,
        sample_preview_limit: 50,
        source: options.cacheSourceFilter,
      }),
    queryKey: [
      "debug-cache-delta",
      options.cacheLimit,
      options.cacheOffset,
      options.cacheSourceFilter,
    ],
    retry: 1,
  });
  return { cacheDataQuery, cacheDeltaQuery };
};

const useCoreDebugQueries = (options: DebugQueryOptions) => {
  const storageEnabled = options.activeTab === "storage";
  const startupEnabled = storageEnabled || options.activeTab === "system";
  const chromaDataQuery = useChromaDebugQuery(options, storageEnabled);
  const dbDataQuery = useDatabaseDebugQuery(options, storageEnabled);
  const driftDataQuery = useStorageDriftQuery(storageEnabled);
  const startupMetricsQuery = useStartupMetricsQuery(startupEnabled);
  const { cacheDataQuery, cacheDeltaQuery } = useCacheDebugQueries(options, storageEnabled);
  const logLevelQuery = useQuery<LogLevelResponse>({
    queryFn: fetchDebugLogLevel,
    queryKey: ["debug-log-level"],
    retry: 1,
  });
  const systemStatusQuery = useQuery<SystemStatusResponse>({
    queryFn: fetchDebugSystemStatus,
    queryKey: ["debug-system-status"],
    retry: 1,
  });
  return {
    cacheDataQuery,
    cacheDeltaQuery,
    chromaDataQuery,
    dbDataQuery,
    driftDataQuery,
    logLevelQuery,
    startupMetricsQuery,
    systemStatusQuery,
  };
};

const getPerformanceRefetchInterval = (activeTab: DebugTab): number | false => {
  if (activeTab === "performance") {
    return 5000;
  }
  return false;
};

const useTabDebugQueries = (options: DebugQueryOptions) => {
  const cacheStatusQuery = useQuery<CacheStatus | null>({
    enabled: options.activeTab === "sources",
    queryFn: fetchCacheStatus,
    queryKey: ["debug-cache-status"],
    retry: 1,
  });
  const debugErrorsQuery = useQuery<DebugErrorsResponse>({
    enabled: options.activeTab === "errors",
    queryFn: () => fetchDebugErrors({ includeRequestStreamEvents: true, limit: 50 }),
    queryKey: ["debug-errors"],
    retry: 1,
  });
  const llmLogsQuery = useQuery<LlmLogResponse>({
    enabled: options.activeTab === "llm",
    queryFn: () => fetchLlmLogs({ limit: 50 }),
    queryKey: ["debug-llm-logs"],
    retry: 1,
  });
  const performanceDataQuery = useQuery<PerformanceDebugData>({
    enabled: options.activeTab === "performance",
    queryFn: fetchPerformanceDebugData,
    queryKey: ["debug-performance", options.activeTab],
    refetchInterval: getPerformanceRefetchInterval(options.activeTab),
    retry: 1,
  });
  const sourceStatsQuery = useQuery<SourceStats[]>({
    enabled: options.activeTab === "sources",
    queryFn: fetchSourceStats,
    queryKey: ["debug-source-stats"],
    retry: 1,
  });

  return {
    cacheStatusQuery,
    debugErrorsQuery,
    llmLogsQuery,
    performanceDataQuery,
    sourceStatsQuery,
  };
};

const useDebugQueries = (options: DebugQueryOptions) => ({
  ...useCoreDebugQueries(options),
  ...useTabDebugQueries(options),
});

export { fetchDebugLogLevel, fetchDebugSystemStatus, parseDebugResponse, useDebugQueries };
