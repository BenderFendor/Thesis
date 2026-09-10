import type { CacheStatus, SourceStats, WikiIndexStatus } from "@/lib/api";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { hasText } from "@/lib/utils";
import {
  StatCard,
  DataRow,
  PanelTitle,
  SourcesTable,
  StatGrid,
  SURFACE_CLASS,
} from "./source-intelligence-operations-common";
import { ParserTab } from "./source-intelligence-operations-parser";
import { ActivityTab, ErrorsTab, PerformanceTab } from "./source-intelligence-operations-activity";
import { MediaTab } from "./source-intelligence-operations-media";
import type { OperationsContentProps } from "./source-intelligence-operations-types";

const OperationsContent = ({ content }: Readonly<{ content: OperationsContentProps }>) => (
  <div className="h-full overflow-y-auto p-4">
    <ActiveOperationsTab content={content} />
  </div>
);

const ActiveOperationsTab = ({ content }: Readonly<{ content: OperationsContentProps }>) => {
  switch (content.activeTab) {
    case "ingestion": {
      return renderIngestionTab(content);
    }
    case "storage": {
      return renderStorageTab(content);
    }
    case "parser": {
      return renderParserTab(content);
    }
    case "llm": {
      return renderActivityTab(content);
    }
    case "errors": {
      return renderErrorsTab(content);
    }
    case "performance": {
      return renderPerformanceTab(content);
    }
    case "media": {
      return renderMediaTab(content);
    }
    default: {
      return null;
    }
  }
};

const renderIngestionTab = (content: OperationsContentProps) => {
  const handleRefreshAll = content.onRefreshAll;
  return <IngestionTab sources={content.sourceStats} onRefreshAll={handleRefreshAll} />;
};

const renderStorageTab = (content: OperationsContentProps) => (
  <StorageTab
    cacheStatus={content.cacheStatus}
    wikiIndexStatus={content.wikiIndexStatus}
    averageArticles={content.averageArticles}
  />
);

const renderParserTab = (content: OperationsContentProps) => {
  const handleRssUrlChange = content.onRssUrlChange;
  const handleArticleUrlChange = content.onArticleUrlChange;
  const handleTestFeed = content.onTestFeed;
  const handleTestArticle = content.onTestArticle;
  return (
    <ParserTab
      rssUrl={content.rssUrl}
      articleUrl={content.articleUrl}
      onRssUrlChange={handleRssUrlChange}
      onArticleUrlChange={handleArticleUrlChange}
      rssResult={content.rssResult}
      articleResult={content.articleResult}
      testingFeed={content.testingFeed}
      testingArticle={content.testingArticle}
      onTestFeed={handleTestFeed}
      onTestArticle={handleTestArticle}
    />
  );
};

const renderActivityTab = (content: OperationsContentProps) => (
  <ActivityTab
    entries={content.llmEntries}
    successCount={content.successCount}
    failureCount={content.failureCount}
  />
);

const renderErrorsTab = (content: OperationsContentProps) => (
  <ErrorsTab problematicSources={content.problematicSources} recentErrorEvents={content.errors} />
);

const renderPerformanceTab = (content: OperationsContentProps) => (
  <PerformanceTab
    averageArticles={content.averageArticles}
    recentErrorEvents={content.errors}
    latencyValues={content.latencyValues}
  />
);

const renderMediaTab = (content: OperationsContentProps) => {
  const handleIndex = content.onIndex;
  return (
    <MediaTab
      selectedSourceProfile={content.sourceProfile}
      selectedSourceName={content.sourceName}
      indexingSource={content.indexingSource}
      onIndex={handleIndex}
    />
  );
};

const IngestionTab = ({
  sources,
  onRefreshAll,
}: Readonly<{ sources: readonly SourceStats[]; onRefreshAll: () => void }>) => (
  <div>
    <IngestionHeader onRefreshAll={onRefreshAll} />
    <SourcesTable sources={sources} />
  </div>
);

const IngestionHeader = ({ onRefreshAll }: Readonly<{ onRefreshAll: () => void }>) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <div className="text-sm text-muted-foreground">
      Check feed health, volume, and recent ingest runs for the current catalog.
    </div>
    <button
      onClick={onRefreshAll}
      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/5"
    >
      Refresh data
    </button>
  </div>
);

const StorageTab = ({
  cacheStatus,
  wikiIndexStatus,
  averageArticles,
}: Readonly<{
  cacheStatus: CacheStatus | null;
  wikiIndexStatus: WikiIndexStatus | undefined;
  averageArticles: number;
}>) => (
  <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
    <CacheSummaryCard cacheStatus={cacheStatus} averageArticles={averageArticles} />
    <WikiIndexCard wikiIndexStatus={wikiIndexStatus} />
  </div>
);

const CacheSummaryCard = ({
  cacheStatus,
  averageArticles,
}: Readonly<{
  cacheStatus: CacheStatus | null;
  averageArticles: number;
}>) => (
  <div className={SURFACE_CLASS}>
    <PanelTitle>Cache Summary</PanelTitle>
    <StatGrid>
      <StatCard
        label="Total Articles"
        value={cacheStatus?.total_articles?.toLocaleString() ?? "—"}
      />
      <StatCard label="Source Records" value={cacheStatus?.total_sources ?? "—"} />
      <StatCard label="Working Sources" value={cacheStatus?.sources_working ?? "—"} />
      <StatCard label="Average Articles" value={averageArticles || "—"} />
    </StatGrid>
    <CacheMetadataRows cacheStatus={cacheStatus} />
  </div>
);

const CacheMetadataRows = ({ cacheStatus }: Readonly<{ cacheStatus: CacheStatus | null }>) => (
  <div className="mt-4 space-y-2 text-sm text-muted-foreground">
    <DataRow label="Last cache update" value={cacheUpdateLabel(cacheStatus)} />
    <DataRow label="Refresh state" value={refreshStateLabel(cacheStatus)} />
    <DataRow label="Cache age" value={cacheAgeLabel(cacheStatus)} />
  </div>
);

const cacheUpdateLabel = (cacheStatus: CacheStatus | null): string => {
  if (hasText(cacheStatus?.last_updated)) {
    return formatArticleDateTime(cacheStatus.last_updated);
  }
  return "—";
};

const refreshStateLabel = (cacheStatus: CacheStatus | null): string => {
  if (cacheStatus?.update_in_progress === true) {
    return "Running";
  }
  return "Idle";
};

const cacheAgeLabel = (cacheStatus: CacheStatus | null): string => {
  if (cacheStatus?.cache_age_seconds === null || cacheStatus?.cache_age_seconds === undefined) {
    return "—";
  }
  return `${cacheStatus.cache_age_seconds.toFixed(1)}s`;
};

const WikiIndexCard = ({
  wikiIndexStatus,
}: Readonly<{ wikiIndexStatus: WikiIndexStatus | undefined }>) => (
  <div className={SURFACE_CLASS}>
    <PanelTitle>Wiki Index</PanelTitle>
    <StatGrid>
      <StatCard label="Entries" value={wikiIndexStatus?.total_entries ?? "—"} />
      <StatCard label="Indexed" value={wikiIndexStatus?.by_status.indexed ?? 0} />
      <StatCard label="Sources" value={wikiIndexStatus?.by_type.source ?? 0} />
      <StatCard label="Organizations" value={wikiIndexStatus?.by_type.organization ?? 0} />
    </StatGrid>
    <WikiIndexStatusRows status={wikiIndexStatus?.by_status} />
  </div>
);

const WikiIndexStatusRows = ({
  status,
}: Readonly<{ status: WikiIndexStatus["by_status"] | undefined }>) => (
  <div className="mt-4 space-y-2">
    {Object.entries(status ?? {}).map(([key, count]) => (
      <DataRow key={key} label={key.replaceAll("_", " ")} value={String(count)} />
    ))}
  </div>
);

export { OperationsContent };
