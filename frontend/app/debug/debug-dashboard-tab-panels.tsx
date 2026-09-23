import type { DeepReadonly } from "@/lib/deep-readonly";
import { ControlsSection } from "./debug-dashboard-control-cards";
import { ErrorsSection } from "./debug-dashboard-errors";
import { LlmSection } from "./debug-dashboard-llm";
import { ParserSection } from "./debug-dashboard-parser";
import { PerformanceSection } from "./debug-dashboard-performance";
import { SourcesSection } from "./debug-dashboard-sources";
import { StorageSection } from "./debug-dashboard-storage";
import { SystemStatusSection } from "./debug-dashboard-system";
import type { DebugDashboardContentProps } from "./debug-dashboard-types";

interface DashboardTabProps {
  readonly dashboard: DebugDashboardContentProps;
}

const SystemTab = (props: DeepReadonly<DashboardTabProps>) => {
  const dashboard = props.dashboard;
  const handleRefreshStatus = dashboard.system.onRefreshStatus;
  return (
    <SystemStatusSection
      systemStatus={dashboard.system.systemStatus}
      startupMetrics={dashboard.system.startupMetrics}
      startupEvents={dashboard.system.startupEvents}
      onRefreshStatus={handleRefreshStatus}
    />
  );
};

const SourcesTab = (props: DeepReadonly<DashboardTabProps>) => {
  const dashboard = props.dashboard;
  const handleRefresh = dashboard.sources.onRefresh;
  const handleRefreshCache = dashboard.sources.onRefreshCache;
  return (
    <SourcesSection
      sourceStats={dashboard.sources.sourceStats}
      cacheStatus={dashboard.sources.cacheStatus}
      cacheRefreshMessage={dashboard.sources.cacheRefreshMessage}
      cacheRefreshError={dashboard.sources.cacheRefreshError}
      cacheRefreshRunning={dashboard.sources.cacheRefreshRunning}
      onRefresh={handleRefresh}
      onRefreshCache={handleRefreshCache}
    />
  );
};

const StorageTab = (props: DeepReadonly<DashboardTabProps>) => {
  const dashboard = props.dashboard;
  const storage = dashboard.storage;
  const handleApplyCacheFilters = storage.onApplyCacheFilters;
  const handleApplyDbFilters = storage.onApplyDbFilters;
  return (
    <StorageSection
      chromaData={storage.chromaData}
      dbData={storage.dbData}
      driftData={storage.driftData}
      cacheData={storage.cacheData}
      cacheDelta={storage.cacheDelta}
      startupMetrics={storage.startupMetrics}
      startupEvents={storage.startupEvents}
      chromaLimit={storage.chromaLimit}
      setChromaLimit={storage.setChromaLimit}
      chromaOffset={storage.chromaOffset}
      setChromaOffset={storage.setChromaOffset}
      dbLimit={storage.dbLimit}
      setDbLimit={storage.setDbLimit}
      dbOffset={storage.dbOffset}
      setDbOffset={storage.setDbOffset}
      dbSortDirection={storage.dbSortDirection}
      setDbSortDirection={storage.setDbSortDirection}
      dbMissingOnly={storage.dbMissingOnly}
      setDbMissingOnly={storage.setDbMissingOnly}
      cacheLimit={storage.cacheLimit}
      setCacheLimit={storage.setCacheLimit}
      cacheOffset={storage.cacheOffset}
      setCacheOffset={storage.setCacheOffset}
      cacheSourceDraft={storage.cacheSourceDraft}
      setCacheSourceDraft={storage.setCacheSourceDraft}
      dbSourceDraft={storage.dbSourceDraft}
      setDbSourceDraft={storage.setDbSourceDraft}
      dbBeforeDraft={storage.dbBeforeDraft}
      setDbBeforeDraft={storage.setDbBeforeDraft}
      dbAfterDraft={storage.dbAfterDraft}
      setDbAfterDraft={storage.setDbAfterDraft}
      onApplyCacheFilters={handleApplyCacheFilters}
      onApplyDbFilters={handleApplyDbFilters}
    />
  );
};

const ParserTab = (props: DeepReadonly<DashboardTabProps>) => {
  const parser = props.dashboard.parser;
  return (
    <ParserSection
      rssTestUrl={parser.rssTestUrl}
      setRssTestUrl={parser.setRssTestUrl}
      rssTestResult={parser.rssTestResult}
      rssTestLoading={parser.rssTestLoading}
      testRssParser={parser.testRssParser}
      articleTestUrl={parser.articleTestUrl}
      setArticleTestUrl={parser.setArticleTestUrl}
      articleTestResult={parser.articleTestResult}
      articleTestLoading={parser.articleTestLoading}
      testArticleParser={parser.testArticleParser}
    />
  );
};

const ControlsTab = (props: DeepReadonly<DashboardTabProps>) => {
  const controls = props.dashboard.controls;
  const handleSetLogLevel = controls.onSetLogLevel;
  const handleToggleFrontendDebug = controls.onToggleFrontendDebug;
  return (
    <ControlsSection
      logLevel={controls.logLevel}
      onSetLogLevel={handleSetLogLevel}
      frontendDebugMode={controls.frontendDebugMode}
      onToggleFrontendDebug={handleToggleFrontendDebug}
    />
  );
};

const LlmTab = (props: DeepReadonly<DashboardTabProps>) => {
  const handleRefresh = props.dashboard.llm.onRefresh;
  return <LlmSection llmLogs={props.dashboard.llm.llmLogs} onRefresh={handleRefresh} />;
};

const ErrorsTab = (props: DeepReadonly<DashboardTabProps>) => {
  const handleRefresh = props.dashboard.errors.onRefresh;
  return <ErrorsSection debugErrors={props.dashboard.errors.debugErrors} onRefresh={handleRefresh} />;
};

const PerformanceTab = (props: DeepReadonly<DashboardTabProps>) => {
  const performance = props.dashboard.performance;
  const handleRefresh = performance.onRefresh;
  return (
    <PerformanceSection
      backendDebugReport={performance.backendDebugReport}
      backendLogEvents={performance.backendLogEvents}
      backendSlowOps={performance.backendSlowOps}
      backendLogFiles={performance.backendLogFiles}
      frontendPerfData={performance.frontendPerfData}
      onRefresh={handleRefresh}
    />
  );
};

const DebugDashboardTabPanels = (props: DeepReadonly<DashboardTabProps>) => (
  <>
    <SystemTab dashboard={props.dashboard} />
    <SourcesTab dashboard={props.dashboard} />
    <StorageTab dashboard={props.dashboard} />
    <ParserTab dashboard={props.dashboard} />
    <ControlsTab dashboard={props.dashboard} />
    <LlmTab dashboard={props.dashboard} />
    <ErrorsTab dashboard={props.dashboard} />
    <PerformanceTab dashboard={props.dashboard} />
  </>
);

export { DebugDashboardTabPanels };
