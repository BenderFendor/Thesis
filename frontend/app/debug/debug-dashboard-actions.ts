import { refreshCache, API_BASE_URL } from "@/lib/api";
import { logger, setDebugMode } from "@/lib/logger";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useMutation } from "@tanstack/react-query";
import { parseDebugResponse } from "./debug-dashboard-queries";
import type { useDebugQueries } from "./debug-dashboard-queries";
import {
  DEBUG_PARSER_SAMPLE_LIMIT,
  DEBUG_SCHEMAS,
  DEBUG_TABS,
} from "./debug-dashboard-schemas";
import type {
  ArticleParserTestResult,
  DebugTab,
  RssParserTestResult,
} from "./debug-dashboard-types";
import type { DebugDashboardState } from "./debug-dashboard-state";

interface DebugDashboardRouter {
  readonly replace: (href: string) => void;
}

interface DebugDashboardSearchParams {
  readonly get: (name: string) => string | null;
  readonly toString: () => string;
}

interface DebugTabRefreshers {
  readonly performance: () => void;
  readonly sources: () => void;
  readonly llm: () => void;
  readonly errors: () => void;
}

interface DebugCacheRefreshProgress {
  readonly message?: string;
  readonly source?: string;
  readonly articlesFromSource?: number;
  readonly totalSourcesProcessed?: number;
}

interface DebugDashboardActionContext {
  readonly router: DebugDashboardRouter;
  readonly searchParams: DebugDashboardSearchParams;
  readonly state: DebugDashboardState;
  readonly queries: ReturnType<typeof useDebugQueries>;
}

const isDebugTab = (value: string | null): value is DebugTab => DEBUG_TABS.some((tab) => tab === value);

const getCacheRefreshMessage = (event: DebugCacheRefreshProgress): string => {
  if (event.message !== undefined && event.message !== "") {
    return event.message;
  }
  if (event.source !== undefined && event.source !== "") {
    if (event.articlesFromSource === undefined) {
      return `Processed ${event.source}`;
    }
    return `Processed ${event.source} · ${event.articlesFromSource} articles`;
  }
  if (event.totalSourcesProcessed === undefined) {
    return "Refreshing cache...";
  }
  return `Processed ${event.totalSourcesProcessed} sources`;
};

const refreshDebugTab = (value: DebugTab, refreshers: DebugTabRefreshers): void => {
  switch (value) {
    case "performance": {
      refreshers.performance();
      break;
    }
    case "sources": {
      refreshers.sources();
      break;
    }
    case "llm": {
      refreshers.llm();
      break;
    }
    case "errors": {
      refreshers.errors();
      break;
    }
    case "controls":
    case "parser":
    case "storage":
    case "system": {
      break;
    }
  }
};

const createLogLevelHandler =
  (loadLogLevel: () => void): ((level: string) => Promise<void>) =>
  async (level: string): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/debug/loglevel?level=${level}`, {
        method: "POST",
      });
      if (response.ok) {
        loadLogLevel();
      }
    } catch (caughtError) {
      logger.error("Failed to set log level", caughtError);
    }
  };

const createTabChangeHandler =
  ({
    loadDebugErrors,
    loadLlmLogs,
    loadPerformanceData,
    loadSourceData,
    router,
    searchParams,
  }: DeepReadonly<{
    loadDebugErrors: () => void;
    loadLlmLogs: () => void;
    loadPerformanceData: () => void;
    loadSourceData: () => void;
    router: DebugDashboardRouter;
    searchParams: DebugDashboardSearchParams;
  }>): ((value: string) => void) =>
  (value: string): void => {
    if (!isDebugTab(value)) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", value);
    router.replace(`/debug?${nextParams.toString()}`);
    refreshDebugTab(value, {
      errors: loadDebugErrors,
      llm: loadLlmLogs,
      performance: loadPerformanceData,
      sources: loadSourceData,
    });
  };

const useCacheRefreshMutation = (
  state: DeepReadonly<DebugDashboardState>,
  loadSourceData: () => void,
  loadSystemStatus: () => void,
) =>
  useMutation<void>({
    mutationFn: async () => {
      const success = await refreshCache((event) => {
        state.setCacheRefreshMessage(getCacheRefreshMessage(event));
      });
      if (!success) {
        throw new Error("Cache refresh did not complete successfully.");
      }
    },
    onError: (error) => {
      state.setCacheRefreshError(error.message || "Cache refresh failed.");
      state.setCacheRefreshMessage(undefined);
    },
    onMutate: () => {
      state.setCacheRefreshError(undefined);
      state.setCacheRefreshMessage("Starting cache refresh...");
      state.setCacheRefreshRunning(true);
    },
    onSettled: () => {
      state.setCacheRefreshRunning(false);
    },
    onSuccess: () => {
      state.setCacheRefreshMessage("Cache refresh completed.");
      loadSourceData();
      loadSystemStatus();
    },
  });

interface ParserMutation<TResult> {
  readonly mutateAsync: (url: string) => Promise<TResult>;
}

const runRssParserTest = async (
  state: DeepReadonly<DebugDashboardState>,
  mutation: ParserMutation<RssParserTestResult>,
): Promise<void> => {
  if (!state.rssTestUrl.trim()) {
    return;
  }
  state.setRssTestLoading(true);
  state.setRssTestResult(undefined);
  try {
    state.setRssTestResult(await mutation.mutateAsync(state.rssTestUrl));
  } catch (caughtError) {
    if (caughtError instanceof Error) {
      state.setRssTestResult({ error: caughtError.message });
    } else {
      state.setRssTestResult({ error: "Test failed" });
    }
  } finally {
    state.setRssTestLoading(false);
  }
};

const runArticleParserTest = async (
  state: DeepReadonly<DebugDashboardState>,
  mutation: ParserMutation<ArticleParserTestResult>,
): Promise<void> => {
  if (!state.articleTestUrl.trim()) {
    return;
  }
  state.setArticleTestLoading(true);
  state.setArticleTestResult(undefined);
  try {
    state.setArticleTestResult(await mutation.mutateAsync(state.articleTestUrl));
  } catch (caughtError) {
    if (caughtError instanceof Error) {
      state.setArticleTestResult({ error: caughtError.message });
    } else {
      state.setArticleTestResult({ error: "Test failed" });
    }
  } finally {
    state.setArticleTestLoading(false);
  }
};

const useParserMutations = (state: DeepReadonly<DebugDashboardState>) => {
  const rssParserMutation = useMutation<RssParserTestResult, Error, string>({
    mutationFn: async (url) => {
      const response = await fetch(
        `${API_BASE_URL}/debug/parser/test/rss?url=${encodeURIComponent(url)}&max_entries=${DEBUG_PARSER_SAMPLE_LIMIT}`,
      );
      const data = await parseDebugResponse(response, DEBUG_SCHEMAS.rssParserTestResult);
      if (data === undefined) {
        throw new Error("Test failed");
      }
      return data;
    },
  });
  const articleParserMutation = useMutation<ArticleParserTestResult, Error, string>({
    mutationFn: async (url) => {
      const response = await fetch(
        `${API_BASE_URL}/debug/parser/test/article?url=${encodeURIComponent(url)}`,
      );
      const data = await parseDebugResponse(response, DEBUG_SCHEMAS.articleParserTestResult);
      if (data === undefined) {
        throw new Error("Test failed");
      }
      return data;
    },
  });
  const testRssParser = (): Promise<void> => runRssParserTest(state, rssParserMutation);
  const testArticleParser = (): Promise<void> =>
    runArticleParserTest(state, articleParserMutation);
  return { testArticleParser, testRssParser };
};

const useDebugActionMutations = ({
  loadSourceData,
  loadSystemStatus,
  state,
}: DeepReadonly<{
  loadSourceData: () => void;
  loadSystemStatus: () => void;
  state: DeepReadonly<DebugDashboardState>;
}>) => {
  const cacheRefreshMutation = useCacheRefreshMutation(state, loadSourceData, loadSystemStatus);
  const parserMutations = useParserMutations(state);
  return {
    handleRefreshCache: () => cacheRefreshMutation.mutateAsync(),
    ...parserMutations,
  };
};

const createDebugDashboardLoaders = (
  queries: DeepReadonly<ReturnType<typeof useDebugQueries>>,
) => {
  const {
    cacheDataQuery,
    cacheDeltaQuery,
    cacheStatusQuery,
    chromaDataQuery,
    dbDataQuery,
    debugErrorsQuery,
    driftDataQuery,
    llmLogsQuery,
    logLevelQuery,
    performanceDataQuery,
    sourceStatsQuery,
    startupMetricsQuery,
    systemStatusQuery,
  } = queries;
  return {
    loadData: (): void => {
      void Promise.all([
        cacheDataQuery.refetch(),
        cacheDeltaQuery.refetch(),
        chromaDataQuery.refetch(),
        dbDataQuery.refetch(),
        driftDataQuery.refetch(),
        startupMetricsQuery.refetch(),
      ]);
    },
    loadDebugErrors: (): void => {
      void debugErrorsQuery.refetch();
    },
    loadLlmLogs: (): void => {
      void llmLogsQuery.refetch();
    },
    loadLogLevel: (): void => {
      void logLevelQuery.refetch();
    },
    loadPerformanceData: (): void => {
      void performanceDataQuery.refetch();
    },
    loadSourceData: (): void => {
      void sourceStatsQuery.refetch();
      void cacheStatusQuery.refetch();
    },
    loadSystemStatus: (): void => {
      void systemStatusQuery.refetch();
    },
  };
};

const createDebugFilterHandlers = (state: DeepReadonly<DebugDashboardState>) => ({
  applyCacheFilters: (): void => {
    state.setCacheSourceFilter(state.cacheSourceDraft.trim() || undefined);
  },
  applyDbFilters: (): void => {
    state.setDbSourceFilter(state.dbSourceDraft.trim() || undefined);
    state.setDbBeforeFilter(state.dbBeforeDraft || undefined);
    state.setDbAfterFilter(state.dbAfterDraft || undefined);
  },
});

const useDebugDashboardActions = ({
  queries,
  router,
  searchParams,
  state,
}: DeepReadonly<DebugDashboardActionContext>) => {
  const loaders = createDebugDashboardLoaders(queries);
  const filters = createDebugFilterHandlers(state);
  const handleSetLogLevel = createLogLevelHandler(loaders.loadLogLevel);
  const handleTabChange = createTabChangeHandler({ ...loaders, router, searchParams });
  const handleToggleFrontendDebug = (): void => {
    setDebugMode(!state.frontendDebugMode);
  };
  const mutations = useDebugActionMutations({
    loadSourceData: loaders.loadSourceData,
    loadSystemStatus: loaders.loadSystemStatus,
    state,
  });
  const handleTestRssParser = (): void => {
    void mutations.testRssParser();
  };
  const handleTestArticleParser = (): void => {
    void mutations.testArticleParser();
  };
  return {
    ...filters,
    ...loaders,
    handleRefreshCache: mutations.handleRefreshCache,
    handleSetLogLevel,
    handleTabChange,
    handleTestArticleParser,
    handleTestRssParser,
    handleToggleFrontendDebug,
  };
};

type DebugDashboardActions = ReturnType<typeof useDebugDashboardActions>;

export { useDebugDashboardActions };
export type { DebugDashboardActions };
