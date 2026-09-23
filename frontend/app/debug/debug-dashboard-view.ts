import type { DeepReadonly } from "@/lib/deep-readonly";
import type { DebugDashboardActions } from "./debug-dashboard-actions";
import type { useDebugQueries } from "./debug-dashboard-queries";
import {
  DEBUG_DEFAULT_OFFSET,
  DEBUG_TABS,
  DEFAULT_DEBUG_TAB,
} from "./debug-dashboard-schemas";
import type {
  DebugCacheDeltaResponse,
  DebugCacheResponse,
  DebugCacheStatus,
  DebugChromaResponse,
  DebugDashboardContentProps,
  DebugDatabaseResponse,
  DebugErrorsPanelData,
  DebugLlmResponse,
  DebugSourceStats,
  DebugStartupEvent,
  DebugStartupMetrics,
  DebugStorageDrift,
  DebugTab,
  PerformanceDebugData,
  SystemStatusResponse,
} from "./debug-dashboard-types";
import type { DebugDashboardState } from "./debug-dashboard-state";

const ZERO = 0;

interface StartupMetricsEvents {
  readonly events?: readonly DebugStartupEvent[];
}

const getDebugTimestamp = (value?: string): number => {
  if (value === undefined || value === "") {
    return DEBUG_DEFAULT_OFFSET;
  }
  return new Date(value).getTime();
};

const sortStartupEvents = (
  startupMetrics: DeepReadonly<StartupMetricsEvents> | undefined,
): DebugStartupEvent[] => {
  if (startupMetrics?.events === undefined || startupMetrics.events.length === ZERO) {
    return [];
  }
  return startupMetrics.events.toSorted(
    (firstEvent, secondEvent) =>
      getDebugTimestamp(firstEvent.startedAt ?? undefined) -
      getDebugTimestamp(secondEvent.startedAt ?? undefined),
  );
};

interface DebugDashboardQueryData {
  readonly cacheData: DebugCacheResponse | undefined;
  readonly cacheDelta: DebugCacheDeltaResponse | undefined;
  readonly cacheStatus: DebugCacheStatus | undefined;
  readonly chromaData: DebugChromaResponse | undefined;
  readonly dbData: DebugDatabaseResponse | undefined;
  readonly debugErrors: DebugErrorsPanelData | undefined;
  readonly driftData: DebugStorageDrift | undefined;
  readonly llmLogs: DebugLlmResponse | undefined;
  readonly logLevel: string;
  readonly sourceStats: readonly DebugSourceStats[];
  readonly startupMetrics: DebugStartupMetrics | undefined;
  readonly systemStatus: SystemStatusResponse | undefined;
}

interface DebugDashboardRequestState {
  readonly loading: boolean;
  readonly error: Error | undefined;
}

interface DebugDashboardViewContext {
  readonly actions: DebugDashboardActions;
  readonly activeTab: DebugTab;
  readonly embedded: boolean;
  readonly performance: PerformanceDebugData;
  readonly queryData: DebugDashboardQueryData;
  readonly requestState: DebugDashboardRequestState;
  readonly startupEvents: readonly DebugStartupEvent[];
  readonly state: DebugDashboardState;
}

const getDebugDashboardQueryData = (
  queries: DeepReadonly<
    Pick<
      ReturnType<typeof useDebugQueries>,
      | "cacheDataQuery"
      | "cacheDeltaQuery"
      | "cacheStatusQuery"
      | "chromaDataQuery"
      | "dbDataQuery"
      | "debugErrorsQuery"
      | "driftDataQuery"
      | "llmLogsQuery"
      | "logLevelQuery"
      | "sourceStatsQuery"
      | "startupMetricsQuery"
      | "systemStatusQuery"
    >
  >,
): DebugDashboardQueryData => ({
  cacheData: queries.cacheDataQuery.data,
  cacheDelta: queries.cacheDeltaQuery.data,
  cacheStatus: queries.cacheStatusQuery.data ?? undefined,
  chromaData: queries.chromaDataQuery.data,
  dbData: queries.dbDataQuery.data,
  debugErrors: queries.debugErrorsQuery.data ?? undefined,
  driftData: queries.driftDataQuery.data,
  llmLogs: queries.llmLogsQuery.data ?? undefined,
  logLevel: queries.logLevelQuery.data?.level ?? "INFO",
  sourceStats: queries.sourceStatsQuery.data ?? [],
  startupMetrics: queries.startupMetricsQuery.data,
  systemStatus: queries.systemStatusQuery.data ?? undefined,
});

const getDebugPerformanceData = (
  performanceData: PerformanceDebugData | undefined,
): PerformanceDebugData => ({
  backendDebugReport: performanceData?.backendDebugReport,
  backendLogEvents: performanceData?.backendLogEvents ?? [],
  backendLogFiles: performanceData?.backendLogFiles ?? [],
  backendSlowOps: performanceData?.backendSlowOps ?? [],
  frontendPerfData: performanceData?.frontendPerfData,
});

const getDebugDashboardRequestState = (
  queries: DeepReadonly<readonly { error: Error | null; isLoading: boolean }[]>,
): DebugDashboardRequestState => ({
  error: queries.find(({ error }) => error !== null)?.error ?? undefined,
  loading: queries.some(({ isLoading }) => isLoading),
});

const createControlsProps = (
  actions: DeepReadonly<DebugDashboardActions>,
  state: DeepReadonly<DebugDashboardState>,
  logLevel: string,
): DebugDashboardContentProps["controls"] => {
  const handleSetLogLevel = (level: string): void => {
    void actions.handleSetLogLevel(level);
  };
  return {
    frontendDebugMode: state.frontendDebugMode,
    logLevel,
    onSetLogLevel: handleSetLogLevel,
    onToggleFrontendDebug: actions.handleToggleFrontendDebug,
  };
};

const createParserProps = (
  actions: DeepReadonly<DebugDashboardActions>,
  state: DeepReadonly<DebugDashboardState>,
): DebugDashboardContentProps["parser"] => ({
  articleTestLoading: state.articleTestLoading,
  articleTestResult: state.articleTestResult,
  articleTestUrl: state.articleTestUrl,
  rssTestLoading: state.rssTestLoading,
  rssTestResult: state.rssTestResult,
  rssTestUrl: state.rssTestUrl,
  setArticleTestUrl: state.setArticleTestUrl,
  setRssTestUrl: state.setRssTestUrl,
  testArticleParser: actions.handleTestArticleParser,
  testRssParser: actions.handleTestRssParser,
});

const createPerformanceProps = (
  actions: DeepReadonly<DebugDashboardActions>,
  performance: PerformanceDebugData,
): DebugDashboardContentProps["performance"] => ({
  ...performance,
  onRefresh: actions.loadPerformanceData,
});

const createSourceProps = (
  actions: DeepReadonly<DebugDashboardActions>,
  state: DeepReadonly<DebugDashboardState>,
  queryData: DeepReadonly<DebugDashboardQueryData>,
): DebugDashboardContentProps["sources"] => {
  const handleRefreshCache = (): void => {
    void actions.handleRefreshCache();
  };
  return {
    cacheRefreshError: state.cacheRefreshError,
    cacheRefreshMessage: state.cacheRefreshMessage,
    cacheRefreshRunning: state.cacheRefreshRunning,
    cacheStatus: queryData.cacheStatus,
    onRefresh: actions.loadSourceData,
    onRefreshCache: handleRefreshCache,
    sourceStats: queryData.sourceStats,
  };
};

const createStorageProps = (
  actions: DeepReadonly<DebugDashboardActions>,
  state: DeepReadonly<DebugDashboardState>,
  queryData: DeepReadonly<DebugDashboardQueryData>,
  startupEvents: readonly DebugStartupEvent[],
): DebugDashboardContentProps["storage"] => ({
  cacheData: queryData.cacheData,
  cacheDelta: queryData.cacheDelta,
  cacheLimit: state.cacheLimit,
  cacheOffset: state.cacheOffset,
  cacheSourceDraft: state.cacheSourceDraft,
  chromaData: queryData.chromaData,
  chromaLimit: state.chromaLimit,
  chromaOffset: state.chromaOffset,
  dbAfterDraft: state.dbAfterDraft,
  dbBeforeDraft: state.dbBeforeDraft,
  dbData: queryData.dbData,
  dbLimit: state.dbLimit,
  dbMissingOnly: state.dbMissingOnly,
  dbOffset: state.dbOffset,
  dbSortDirection: state.dbSortDirection,
  dbSourceDraft: state.dbSourceDraft,
  driftData: queryData.driftData,
  onApplyCacheFilters: actions.applyCacheFilters,
  onApplyDbFilters: actions.applyDbFilters,
  setCacheLimit: state.setCacheLimit,
  setCacheOffset: state.setCacheOffset,
  setCacheSourceDraft: state.setCacheSourceDraft,
  setChromaLimit: state.setChromaLimit,
  setChromaOffset: state.setChromaOffset,
  setDbAfterDraft: state.setDbAfterDraft,
  setDbBeforeDraft: state.setDbBeforeDraft,
  setDbLimit: state.setDbLimit,
  setDbMissingOnly: state.setDbMissingOnly,
  setDbOffset: state.setDbOffset,
  setDbSortDirection: state.setDbSortDirection,
  setDbSourceDraft: state.setDbSourceDraft,
  startupEvents,
  startupMetrics: queryData.startupMetrics,
});

const createSystemProps = (
  actions: DeepReadonly<DebugDashboardActions>,
  queryData: DeepReadonly<DebugDashboardQueryData>,
  startupEvents: readonly DebugStartupEvent[],
): DebugDashboardContentProps["system"] => ({
  onRefreshStatus: actions.loadSystemStatus,
  startupEvents,
  startupMetrics: queryData.startupMetrics,
  systemStatus: queryData.systemStatus,
});

const createDebugDashboardViewProps = ({
  actions,
  activeTab,
  embedded,
  performance,
  queryData,
  requestState,
  startupEvents,
  state,
}: DeepReadonly<DebugDashboardViewContext>): DebugDashboardContentProps => ({
  activeTab,
  controls: createControlsProps(actions, state, queryData.logLevel),
  embedded,
  error: requestState.error?.message,
  errors: { debugErrors: queryData.debugErrors, onRefresh: actions.loadDebugErrors },
  llm: { llmLogs: queryData.llmLogs, onRefresh: actions.loadLlmLogs },
  loading: requestState.loading,
  onRefresh: actions.loadData,
  onTabChange: actions.handleTabChange,
  parser: createParserProps(actions, state),
  performance: createPerformanceProps(actions, performance),
  sources: createSourceProps(actions, state, queryData),
  storage: createStorageProps(actions, state, queryData, startupEvents),
  system: createSystemProps(actions, queryData, startupEvents),
});

const createDebugQueryOptions = (
  activeTab: DebugTab,
  state: DeepReadonly<DebugDashboardState>,
) => ({
  activeTab,
  cacheLimit: state.cacheLimit,
  cacheOffset: state.cacheOffset,
  cacheSourceFilter: state.cacheSourceFilter,
  chromaLimit: state.chromaLimit,
  chromaOffset: state.chromaOffset,
  dbAfterFilter: state.dbAfterFilter,
  dbBeforeFilter: state.dbBeforeFilter,
  dbLimit: state.dbLimit,
  dbMissingOnly: state.dbMissingOnly,
  dbOffset: state.dbOffset,
  dbSortDirection: state.dbSortDirection,
  dbSourceFilter: state.dbSourceFilter,
});

const isDebugTab = (value: string | null): value is DebugTab => DEBUG_TABS.some((tab) => tab === value);

const getActiveDebugTab = (value: string | null): DebugTab => {
  if (isDebugTab(value)) {
    return value;
  }
  return DEFAULT_DEBUG_TAB;
};

export {
  createDebugDashboardViewProps,
  createDebugQueryOptions,
  getActiveDebugTab,
  getDebugDashboardQueryData,
  getDebugDashboardRequestState,
  getDebugPerformanceData,
  sortStartupEvents,
};
