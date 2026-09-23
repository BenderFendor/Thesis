"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DebugDashboardContent } from "./debug-dashboard-layout";
import { useDebugDashboardActions } from "./debug-dashboard-actions";
import { useDebugQueries } from "./debug-dashboard-queries";
import {
  useCacheRefreshState,
  useParserDebugState,
  useStorageDebugState,
} from "./debug-dashboard-state";
import {
  createDebugDashboardViewProps,
  createDebugQueryOptions,
  getDebugDashboardQueryData,
  getDebugDashboardRequestState,
  getDebugPerformanceData,
  getActiveDebugTab,
  sortStartupEvents,
} from "./debug-dashboard-view";

const useDebugDashboardControllerState = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = getActiveDebugTab(searchParams.get("tab"));
  const embedded = searchParams.get("embedded") === "1";
  const state = {
    ...useStorageDebugState(),
    ...useCacheRefreshState(),
    ...useParserDebugState(),
  };
  const debugQueries = useDebugQueries(createDebugQueryOptions(activeTab, state));
  const actions = useDebugDashboardActions({
    queries: debugQueries,
    router,
    searchParams,
    state,
  });
  return { actions, activeTab, debugQueries, embedded, state };
};

const DebugDashboardController = () => {
  const { actions, activeTab, debugQueries, embedded, state } =
    useDebugDashboardControllerState();
  const queryData = getDebugDashboardQueryData(debugQueries);
  const performance = getDebugPerformanceData(debugQueries.performanceDataQuery.data);
  const requestState = getDebugDashboardRequestState([
    debugQueries.cacheDataQuery,
    debugQueries.cacheDeltaQuery,
    debugQueries.chromaDataQuery,
    debugQueries.dbDataQuery,
    debugQueries.driftDataQuery,
    debugQueries.startupMetricsQuery,
  ]);
  const startupEvents = useMemo(
    () => sortStartupEvents(queryData.startupMetrics),
    [queryData.startupMetrics],
  );
  const viewProps = createDebugDashboardViewProps({
    actions,
    activeTab,
    embedded,
    performance,
    queryData,
    requestState,
    startupEvents,
    state,
  });

  return <DebugDashboardContent dashboard={viewProps} />;
};

export const DebugDashboard = DebugDashboardController;
