"use client";
import { hasText } from "@/lib/utils";

import { API_BASE_URL, fetchDebugErrors, fetchLlmLogs, triggerWikiIndex } from "@/lib/api";
import type {
  CacheStatus,
  DebugErrorsResponse,
  LlmLogEntry,
  LlmLogResponse,
  SourceStats,
  WikiIndexStatus,
  WikiSourceProfile,
} from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { ReactNode } from "react";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type workspaceSupport from "./source-intelligence-support";

type WorkspaceTab = (typeof workspaceSupport.tabs)[number]["id"];

interface OperationsPanelProps {
  readonly activeTab: WorkspaceTab;
  readonly onTabChange: (tab: WorkspaceTab) => void;
  readonly tabs: readonly { readonly id: WorkspaceTab; readonly label: string }[];
  readonly sourceStats: readonly SourceStats[];
  readonly cacheStatus: CacheStatus | null;
  readonly wikiIndexStatus: WikiIndexStatus | undefined;
  readonly selectedSourceName: string | null;
  readonly selectedSourceProfile: DeepReadonly<WikiSourceProfile> | null;
  readonly onRefreshAll: () => void;
  readonly onSourceProfileRefresh: () => Promise<void>;
}

interface ParserResult {
  readonly success?: boolean;
  readonly error?: string;
  readonly parse_time_seconds?: number;
  readonly image_url?: string;
  readonly status?: { readonly entries_count?: number };
}

interface NormalizedErrorEvent {
  readonly key: string;
  readonly service: string;
  readonly errorType: string;
  readonly message: string;
}

interface ParserTestRequest {
  readonly url: string;
  readonly endpoint: string;
  readonly failureMessage: string;
  readonly setTesting: (value: boolean) => void;
  readonly setResult: (value: ParserResult | null) => void;
}

interface SourceIndexRequest {
  readonly sourceName: string | null;
  readonly setIndexing: (value: boolean) => void;
  readonly onSourceProfileRefresh: () => Promise<void>;
  readonly onRefreshAll: () => void;
}

const EMPTY_LLM_ENTRIES: readonly LlmLogEntry[] = [],
  PANEL_CLASS =
    "rounded-[1.6rem] border border-white/[0.08] bg-background/70 p-4 backdrop-blur-xl",
  SURFACE_CLASS = "rounded-[1.2rem] border border-white/[0.08] bg-black/20 p-4",
  averageSourceArticles = (sources: readonly SourceStats[]): number => {
    if (sources.length === 0) {
      return 0;
    }
    return Math.round(
      sources.reduce((total, source) => total + source.article_count, 0) / sources.length,
    );
  },
  buildRecentErrorEvents = (
    data: DeepReadonly<DebugErrorsResponse> | undefined,
  ): NormalizedErrorEvent[] => [
    ...(data?.log_file.entries ?? []).map<NormalizedErrorEvent>((entry, index) => ({
      errorType: entry.error_type ?? "error",
      key: `${entry.request_id ?? "log"}-${index}`,
      message: entry.error_message ?? "No error message recorded.",
      service: entry.service ?? "unknown service",
    })),
    ...(data?.recent_request_stream_errors ?? []).map<NormalizedErrorEvent>((entry, index) => ({
      errorType: entry.error_type ?? entry.event_type ?? "error",
      key: `${entry.request_id ?? "stream"}-${index}`,
      message: entry.error_message ?? entry.message ?? "No error message recorded.",
      service: entry.service ?? entry.component ?? "unknown service",
    })),
  ],
  countSuccessfulLogs = (entries: readonly LlmLogEntry[], success: boolean): number =>
    entries.filter((entry) => entry.success === success).length,
  displaySourceValue = (value: string | number | null | undefined): string =>
    (() => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
})(),
  formatCheckedTime = (value: string | null | undefined): string =>
    (() => {
  if (hasText(value)) {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return "—";
})(),
  indexSource = async ({
    sourceName,
    setIndexing,
    onSourceProfileRefresh,
    onRefreshAll,
  }: SourceIndexRequest): Promise<void> => {
    if (!hasText(sourceName)) {
      return;
    }
    setIndexing(true);
    try {
      await triggerWikiIndex(sourceName);
      await onSourceProfileRefresh();
      onRefreshAll();
    } finally {
      setIndexing(false);
    }
  },
  runParserTest = async ({
    url,
    endpoint,
    failureMessage,
    setTesting,
    setResult,
  }: ParserTestRequest): Promise<void> => {
    if (!url.trim()) {
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}?url=${encodeURIComponent(url)}`, {
        method: "POST",
      });
      setResult(await response.json());
    } catch (error) {
      setResult({ error: (() => {
  if (error instanceof Error) {
    return error.message;
  }
  return failureMessage;
})() });
    } finally {
      setTesting(false);
    }
  };

const SourceIntelligenceOperations = ({
  activeTab,
  onTabChange,
  tabs,
  sourceStats,
  cacheStatus,
  wikiIndexStatus,
  selectedSourceName,
  selectedSourceProfile,
  onRefreshAll,
  onSourceProfileRefresh,
}: Readonly<OperationsPanelProps>) => {
  const [rssUrl, setRssUrl] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [rssResult, setRssResult] = useState<ParserResult | null>(null);
  const [articleResult, setArticleResult] = useState<ParserResult | null>(null);
  const [testingFeed, setTestingFeed] = useState(false);
  const [testingArticle, setTestingArticle] = useState(false);
  const [indexingSource, setIndexingSource] = useState(false);
  const llmLogsQuery = useQuery<LlmLogResponse>({
      enabled: activeTab === "llm",
      queryFn: () => fetchLlmLogs({ limit: 12 }),
      queryKey: ["source-intelligence-llm"],
      retry: 1,
    });
  const errorsQuery = useQuery<DebugErrorsResponse>({
      enabled: activeTab === "errors",
      queryFn: () => fetchDebugErrors({ includeRequestStreamEvents: true, limit: 12 }),
      queryKey: ["source-intelligence-errors"],
      retry: 1,
    });
  const topSources = sourceStats.slice(0, 10);
  const problematicSources = sourceStats.filter((source) => source.status !== "success").slice(0, 6);
  const averageArticles = averageSourceArticles(sourceStats);
  const llmEntries = llmLogsQuery.data?.entries ?? EMPTY_LLM_ENTRIES;
  const latencyValues = useMemo(() => llmEntries.map((entry) => entry.duration_ms), [llmEntries]);
  const modelSuccessCount = countSuccessfulLogs(llmEntries, true);
  const modelFailureCount = countSuccessfulLogs(llmEntries, false);
  const recentErrorEvents = buildRecentErrorEvents(errorsQuery.data);

  const handleIndex = useCallback(() => {
    void indexSource({
      onRefreshAll,
      onSourceProfileRefresh,
      setIndexing: setIndexingSource,
      sourceName: selectedSourceName,
    });
  }, [onRefreshAll, onSourceProfileRefresh, selectedSourceName]);
  const handleTestArticle = useCallback(() => {
    void runParserTest({
      endpoint: "/debug/parser/test/article",
      failureMessage: "Article test failed",
      setResult: setArticleResult,
      setTesting: setTestingArticle,
      url: articleUrl,
    });
  }, [articleUrl]);
  const handleTestFeed = useCallback(() => {
    void runParserTest({
      endpoint: "/debug/parser/test/rss",
      failureMessage: "Feed test failed",
      setResult: setRssResult,
      setTesting: setTestingFeed,
      url: rssUrl,
    });
  }, [rssUrl]);

  return (
    <section className={`${PANEL_CLASS} flex min-h-0 flex-col`}>
      <OperationsTabNav activeTab={activeTab} onTabChange={onTabChange} tabs={tabs} />

      <div className="min-h-0 flex-1 overflow-hidden rounded-[1.2rem] border border-white/[0.08] bg-black/[0.15]">
        <OperationsContent
          activeTab={activeTab}
          articleResult={articleResult}
          articleUrl={articleUrl}
          averageArticles={averageArticles}
          errors={recentErrorEvents}
          failureCount={modelFailureCount}
          indexingSource={indexingSource}
          latencyValues={latencyValues}
          llmEntries={llmEntries}
          onArticleUrlChange={setArticleUrl}
          onIndex={handleIndex}
          onRssUrlChange={setRssUrl}
          onTestArticle={handleTestArticle}
          onTestFeed={handleTestFeed}
          problematicSources={problematicSources}
          rssResult={rssResult}
          rssUrl={rssUrl}
          sourceStats={topSources}
          sourceProfile={selectedSourceProfile}
          sourceName={selectedSourceName}
          testingArticle={testingArticle}
          testingFeed={testingFeed}
          wikiIndexStatus={wikiIndexStatus}
          cacheStatus={cacheStatus}
          onRefreshAll={onRefreshAll}
          successCount={modelSuccessCount}
        />
      </div>
    </section>
  );
};

const OperationsTabNav = ({
  activeTab,
  onTabChange,
  tabs,
}: DeepReadonly<Pick<OperationsPanelProps, "activeTab" | "onTabChange" | "tabs">>) => {
  const tabHandlers = useMemo(
    () =>
      new Map(
        tabs.map((tab): [WorkspaceTab, () => void] => [
          tab.id,
          () => {
            onTabChange(tab.id);
          },
        ]),
      ),
    [onTabChange, tabs],
  );

  return (
    <div className="mb-4 flex items-center gap-6 overflow-x-auto border-b border-white/[0.08] pb-0 shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={tabHandlers.get(tab.id)}
          className={`whitespace-nowrap border-b-2 px-1 py-2 text-[11px] font-mono uppercase tracking-[0.18em] ${
            (() => {
  if (activeTab === tab.id) {
    return "border-primary text-foreground";
  }
  return "border-transparent text-muted-foreground hover:border-white/20";
})()
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

interface OperationsContentProps {
  readonly activeTab: WorkspaceTab;
  readonly articleResult: ParserResult | null;
  readonly articleUrl: string;
  readonly averageArticles: number;
  readonly cacheStatus: CacheStatus | null;
  readonly errors: readonly NormalizedErrorEvent[];
  readonly failureCount: number;
  readonly indexingSource: boolean;
  readonly latencyValues: readonly (number | undefined)[];
  readonly llmEntries: readonly LlmLogEntry[];
  readonly onArticleUrlChange: (value: string) => void;
  readonly onIndex: () => void;
  readonly onRefreshAll: () => void;
  readonly onRssUrlChange: (value: string) => void;
  readonly onTestArticle: () => void;
  readonly onTestFeed: () => void;
  readonly problematicSources: readonly SourceStats[];
  readonly rssResult: ParserResult | null;
  readonly rssUrl: string;
  readonly sourceName: string | null;
  readonly sourceProfile: DeepReadonly<WikiSourceProfile> | null;
  readonly sourceStats: readonly SourceStats[];
  readonly successCount: number;
  readonly testingArticle: boolean;
  readonly testingFeed: boolean;
  readonly wikiIndexStatus: WikiIndexStatus | undefined;
}

const OperationsContent = ({
  activeTab,
  articleResult,
  articleUrl,
  averageArticles,
  cacheStatus,
  errors,
  failureCount,
  indexingSource,
  latencyValues,
  llmEntries,
  onArticleUrlChange,
  onIndex,
  onRefreshAll,
  onRssUrlChange,
  onTestArticle,
  onTestFeed,
  problematicSources,
  rssResult,
  rssUrl,
  sourceName,
  sourceProfile,
  sourceStats,
  successCount,
  testingArticle,
  testingFeed,
  wikiIndexStatus,
}: Readonly<OperationsContentProps>) => (
  <div className="h-full overflow-y-auto p-4">
    {activeTab === "ingestion" && (
      <IngestionTab sources={sourceStats} onRefreshAll={onRefreshAll} />
    )}
    {activeTab === "storage" && (
      <StorageTab
        cacheStatus={cacheStatus}
        wikiIndexStatus={wikiIndexStatus}
        averageArticles={averageArticles}
      />
    )}
    {activeTab === "parser" && (
      <ParserTab
        rssUrl={rssUrl}
        articleUrl={articleUrl}
        onRssUrlChange={onRssUrlChange}
        onArticleUrlChange={onArticleUrlChange}
        rssResult={rssResult}
        articleResult={articleResult}
        testingFeed={testingFeed}
        testingArticle={testingArticle}
        onTestFeed={onTestFeed}
        onTestArticle={onTestArticle}
      />
    )}
    {activeTab === "llm" && (
      <LlmTab entries={llmEntries} successCount={successCount} failureCount={failureCount} />
    )}
    {activeTab === "errors" && (
      <ErrorsTab problematicSources={problematicSources} recentErrorEvents={errors} />
    )}
    {activeTab === "performance" && (
      <PerformanceTab
        averageArticles={averageArticles}
        recentErrorEvents={errors}
        latencyValues={latencyValues}
      />
    )}
    {activeTab === "media" && (
      <MediaTab
        selectedSourceProfile={sourceProfile}
        selectedSourceName={sourceName}
        indexingSource={indexingSource}
        onIndex={onIndex}
      />
    )}
  </div>
);

const IngestionTab = ({
  sources,
  onRefreshAll,
}: DeepReadonly<{ sources: SourceStats[]; onRefreshAll: () => void }>) => (
  <div>
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="text-sm text-muted-foreground">
        Check feed health, volume, and recent ingest runs for the current catalog.
      </div>
      <div className="flex gap-2">
        <button
          onClick={onRefreshAll}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/5"
        >
          Refresh data
        </button>
      </div>
    </div>

    <SourcesTable sources={sources} />
  </div>
);

const SourcesTable = ({ sources }: DeepReadonly<{ sources: SourceStats[] }>) => (
  <Table className="text-foreground">
    <TableHeader>
      <TableRow className="border-white/10 hover:bg-transparent">
        <Th>Source</Th>
        <Th>Type</Th>
        <Th>Bias</Th>
        <Th>Funding</Th>
        <Th>Country</Th>
        <Th>Status</Th>
        <Th>Articles</Th>
        <Th>Last Checked</Th>
      </TableRow>
    </TableHeader>
    <TableBody>
      {sources.map((source) => (
        <SourceRow key={`${source.name}-${source.url}`} source={source} />
      ))}
    </TableBody>
  </Table>
);

const Th = ({ children }: Readonly<{ children: ReactNode }>) => (
  <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
    {children}
  </TableHead>
);

const SourceRow = ({ source }: Readonly<{ source: SourceStats }>) => (
  <TableRow className="border-white/5 hover:bg-white/[0.02]">
    <TableCell className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-black/40 text-[9px] text-muted-foreground">
          {(source.country || source.name).slice(0, 2).toUpperCase()}
        </span>
        {source.name}
      </div>
    </TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {displaySourceValue(source.category)}
    </TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {displaySourceValue(source.bias_rating)}
    </TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {displaySourceValue(source.funding_type)}
    </TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {displaySourceValue(source.country)}
    </TableCell>
    <TableCell className="px-3 py-2">
      <SourceStatus status={source.status} />
    </TableCell>
    <TableCell className="px-3 py-2 text-foreground">{source.article_count}</TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {formatCheckedTime(source.last_checked)}
    </TableCell>
  </TableRow>
);

const SourceStatus = ({ status }: DeepReadonly<{ status: SourceStats["status"] }>) => {
  const statusDetails = {
    error: { className: "text-red-400", label: "Issue" },
    success: { className: "text-emerald-400", label: "Healthy" },
    warning: { className: "text-amber-400", label: "Needs review" },
  }[status] ?? { className: "text-red-400", label: "Issue" };
  return <span className={statusDetails.className}>{statusDetails.label}</span>;
};

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
}: DeepReadonly<{
  cacheStatus: CacheStatus | null;
  averageArticles: number;
}>) => (
  <div className={SURFACE_CLASS}>
    <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      Cache Summary
    </div>
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        label="Total Articles"
        value={cacheStatus?.total_articles?.toLocaleString() ?? "—"}
      />
      <StatCard label="Source Records" value={cacheStatus?.total_sources ?? "—"} />
      <StatCard label="Working Sources" value={cacheStatus?.sources_working ?? "—"} />
      <StatCard label="Average Articles" value={averageArticles || "—"} />
    </div>
    <CacheMetadataRows cacheStatus={cacheStatus} />
  </div>
);

const CacheMetadataRows = ({ cacheStatus }: DeepReadonly<{ cacheStatus: CacheStatus | null }>) => (
  <div className="mt-4 space-y-2 text-sm text-muted-foreground">
    <DataRow
      label="Last cache update"
      value={(() => {
  if (hasText(cacheStatus?.last_updated)) {
    return formatArticleDateTime(cacheStatus.last_updated);
  }
  return "—";
})()}
    />
    <DataRow label="Refresh state" value={(() => {
  if (cacheStatus?.update_in_progress === true) {
    return "Running";
  }
  return "Idle";
})()} />
    <DataRow
      label="Cache age"
      value={
        (() => {
  if (cacheStatus?.cache_age_seconds === null || cacheStatus?.cache_age_seconds === undefined) {
    return "—";
  }
  return `${cacheStatus.cache_age_seconds.toFixed(1)}s`;
})()
      }
    />
  </div>
);

const WikiIndexCard = ({
  wikiIndexStatus,
}: Readonly<{ wikiIndexStatus: WikiIndexStatus | undefined }>) => (
  <div className={SURFACE_CLASS}>
    <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      Wiki Index
    </div>
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Entries" value={wikiIndexStatus?.total_entries ?? "—"} />
      <StatCard label="Indexed" value={wikiIndexStatus?.by_status.indexed ?? 0} />
      <StatCard label="Sources" value={wikiIndexStatus?.by_type.source ?? 0} />
      <StatCard label="Organizations" value={wikiIndexStatus?.by_type.organization ?? 0} />
    </div>
    <WikiIndexStatusRows status={wikiIndexStatus?.by_status} />
  </div>
);

const WikiIndexStatusRows = ({
  status,
}: DeepReadonly<{ status: WikiIndexStatus["by_status"] | undefined }>) => (
  <div className="mt-4 space-y-2">
    {Object.entries(status ?? {}).map(([key, count]) => (
      <DataRow key={key} label={key.replaceAll("_", " ")} value={String(count)} />
    ))}
  </div>
);

const ParserTab = ({
  rssUrl,
  articleUrl,
  onRssUrlChange,
  onArticleUrlChange,
  rssResult,
  articleResult,
  testingFeed,
  testingArticle,
  onTestFeed,
  onTestArticle,
}: DeepReadonly<{
  rssUrl: string;
  articleUrl: string;
  onRssUrlChange: (value: string) => void;
  onArticleUrlChange: (value: string) => void;
  rssResult: ParserResult | null;
  articleResult: ParserResult | null;
  testingFeed: boolean;
  testingArticle: boolean;
  onTestFeed: () => void;
  onTestArticle: () => void;
}>) => (
  <div className="grid gap-4 md:grid-cols-2">
    <ParserTestCard
      title="Feed Parser"
      placeholder="Paste an RSS feed URL"
      value={rssUrl}
      onValueChange={onRssUrlChange}
      onTest={onTestFeed}
      testing={testingFeed}
      result={rssResult}
      rows={feedResultRows(rssResult)}
    />
    <ParserTestCard
      title="Article Image Check"
      placeholder="Paste an article URL"
      value={articleUrl}
      onValueChange={onArticleUrlChange}
      onTest={onTestArticle}
      testing={testingArticle}
      result={articleResult}
      rows={articleResultRows(articleResult)}
    />
  </div>
);

const ParserTestCard = ({
  title,
  placeholder,
  value,
  onValueChange,
  onTest,
  testing,
  result,
  rows,
}: DeepReadonly<{
  title: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  onTest: () => void;
  testing: boolean;
  result: ParserResult | null;
  rows: { label: string; value: string }[];
}>) => {
  const handleValueChange = useCallback(
    (event: { readonly target: { readonly value: string } }) => {
      onValueChange(event.target.value);
    },
    [onValueChange],
  );

  return (
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={handleValueChange}
          placeholder={placeholder}
          className="border-white/10 bg-black/30 text-foreground"
        />
        <Button onClick={onTest} disabled={testing}>
          {(() => {
  if (testing) {
    return "Testing...";
  }
  return "Run";
})()}
        </Button>
      </div>
      {result !== null && <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          {rows.map(row => <DataRow key={row.label} label={row.label} value={row.value} />)}
          {(() => {
  if (hasText(result.error)) {
    return <div className="text-red-300">{result.error}</div>;
  }
  return null;
})()}
        </div>}
    </div>
  );
};

function feedResultRows(result: ParserResult | null): { label: string; value: string }[] {
  if (!result) {
    return [];
  }
  return [
    { label: "Result", value: (() => {
  if (result.success === true) {
    return "Feed parsed";
  }
  return "Feed failed";
})() },
    { label: "Entries", value: String(result.status?.entries_count ?? "—") },
    {
      label: "Parse time",
      value: (() => {
  if (
    result.parse_time_seconds !== undefined &&
    result.parse_time_seconds !== null &&
    result.parse_time_seconds !== 0
  ) {
    return `${result.parse_time_seconds}s`;
  }
  return "—";
})(),
    },
  ];
}

function articleResultRows(result: ParserResult | null): { label: string; value: string }[] {
  if (!result) {
    return [];
  }
  return [
    { label: "Result", value: (() => {
  if (result.success === true) {
    return "Image found";
  }
  return "No image found";
})() },
    { label: "Image URL", value: result.image_url ?? "—" },
  ];
}

const LlmTab = ({
  entries,
  successCount,
  failureCount,
}: Readonly<{
  entries: readonly LlmLogEntry[];
  successCount: number;
  failureCount: number;
}>) => (
  <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Model Activity
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Calls" value={entries.length} />
        <StatCard label="Success" value={successCount} />
        <StatCard label="Failed" value={failureCount} />
        <StatCard
          label="Avg latency"
          value={formatAverageLatency(entries.map((entry) => entry.duration_ms))}
        />
      </div>
    </div>

    <LlmEntries entries={entries} />
  </div>
);

const LlmEntries = ({ entries }: Readonly<{ entries: readonly LlmLogEntry[] }>) => (
  <div className="space-y-3">
    {entries.map((entry) => (
      <LlmEntryCard
        key={
          entry.request_id ??
          `${entry.timestamp ?? "llm"}-${entry.service ?? "unknown"}-${entry.model ?? "unknown"}-${entry.duration_ms ?? "none"}`
        }
        entry={entry}
      />
    ))}
  </div>
);

const LlmEntryCard = ({ entry }: Readonly<{ entry: LlmLogEntry }>) => (
  <div className={SURFACE_CLASS}>
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-foreground">
          {entry.service ?? "unknown"} · {entry.model ?? "unknown"}
        </div>
        <div className="text-xs text-muted-foreground">{entry.timestamp ?? "—"}</div>
      </div>
      <div className={(() => {
  if (entry.success === true) {
    return "text-emerald-300";
  }
  return "text-red-300";
})()}>
        {(() => {
  if (entry.success === true) {
    return "success";
  }
  return "failed";
})()}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span>{(() => {
  if (entry.duration_ms !== undefined && entry.duration_ms !== null && entry.duration_ms !== 0) {
    return `${entry.duration_ms}ms`;
  }
  return "No latency recorded";
})()}</span>
      <span>{entry.finish_reason ?? "No finish reason"}</span>
    </div>
    {Boolean(entry.error_message) && <div className="mt-2 text-sm text-red-300">{entry.error_message}</div>}
  </div>
);

const ErrorsTab = ({
  problematicSources,
  recentErrorEvents,
}: DeepReadonly<{
  problematicSources: SourceStats[];
  recentErrorEvents: NormalizedErrorEvent[];
}>) => (
  <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Current Issues
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Open issues" value={problematicSources.length} />
        <StatCard label="Recent errors" value={recentErrorEvents.length} />
      </div>
      <div className="mt-4 space-y-2">
        {(() => {
  if (problematicSources.length === 0) {
    return <div className="text-sm text-muted-foreground">
            No non-healthy sources in the latest sample.
          </div>;
  }
  return problematicSources.map(source => <DataRow key={source.name} label={source.name} value={source.error_message ?? source.status} />);
})()}
      </div>
    </div>

    <div className="space-y-3">
      {recentErrorEvents.map((entry) => (
        <ErrorEventCard key={entry.key} entry={entry} />
      ))}
    </div>
  </div>
);

const ErrorEventCard = ({ entry }: Readonly<{ entry: NormalizedErrorEvent }>) => (
  <div className={SURFACE_CLASS}>
    <div className="flex items-center justify-between gap-3">
      <div className="text-foreground">{entry.service}</div>
      <div className="text-red-300">{entry.errorType}</div>
    </div>
    <div className="mt-2 text-sm text-muted-foreground">{entry.message}</div>
  </div>
);

const PerformanceTab = ({
  averageArticles,
  recentErrorEvents,
  latencyValues,
}: DeepReadonly<{
  averageArticles: number;
  recentErrorEvents: NormalizedErrorEvent[];
  latencyValues: (number | undefined)[];
}>) => (
  <div className="grid gap-4 md:grid-cols-3">
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Feed Throughput
      </div>
      <StatCard label="Avg articles per source" value={averageArticles || "—"} />
    </div>
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Model Latency
      </div>
      <StatCard label="Average call time" value={formatAverageLatency(latencyValues)} />
    </div>
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Stability
      </div>
      <StatCard label="Recent error count" value={recentErrorEvents.length} />
    </div>
  </div>
);

const MediaTab = ({
  selectedSourceProfile,
  selectedSourceName,
  indexingSource,
  onIndex,
}: DeepReadonly<{
  selectedSourceProfile: WikiSourceProfile | null;
  selectedSourceName: string | null;
  indexingSource: boolean;
  onIndex: () => void;
}>) => (
  <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
    <div className="space-y-4">
      <div className={SURFACE_CLASS}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Source Summary
          </div>
          <button
            onClick={onIndex}
            disabled={!hasText(selectedSourceName) || indexingSource}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/5 disabled:opacity-50"
          >
            {(() => {
  if (indexingSource) {
    return "Indexing...";
  }
  return "Index source";
})()}
          </button>
        </div>
        <p className="text-sm leading-7 text-foreground/90">
          {selectedSourceProfile?.overview ?? "No summary has been written for this source yet."}
        </p>
      </div>

      <DossierSectionsCard profile={selectedSourceProfile} />
    </div>

    <div className="space-y-4">
      <OwnershipChainCard profile={selectedSourceProfile} />
      <QuickFactsCard profile={selectedSourceProfile} />
    </div>
  </div>
);

const DossierSectionsCard = ({ profile }: DeepReadonly<{ profile: WikiSourceProfile | null }>) => (
  <div className={SURFACE_CLASS}>
    <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      Dossier Sections
    </div>
    <div className="space-y-2">
      {(profile?.dossier_sections ?? []).slice(0, 5).map((section) => (
        <div key={section.id} className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
          <div className="text-sm text-foreground">{section.title}</div>
          <div className="text-xs text-muted-foreground">
            {(() => {
  if (section.status === "available") {
    return `${section.items.length} saved items`;
  }
  return "No saved items yet";
})()}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const OwnershipChainCard = ({ profile }: DeepReadonly<{ profile: WikiSourceProfile | null }>) => {
  const chain = profile?.ownership_chain ?? [];
  return (
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Ownership Chain
      </div>
      <div className="space-y-2">
        {chain.slice(0, 6).map((org) => (
          <div
            key={org.name}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-foreground"
          >
            {org.name}
          </div>
        ))}
        {chain.length === 0 && <div className="text-sm text-muted-foreground">No ownership chain recorded yet.</div>}
      </div>
    </div>
  );
};

const QuickFactsCard = ({ profile }: DeepReadonly<{ profile: WikiSourceProfile | null }>) => (
  <div className={SURFACE_CLASS}>
    <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      Quick Facts
    </div>
    <div className="space-y-2 text-sm text-muted-foreground">
      <DataRow label="Country" value={displaySourceValue(profile?.country)} />
      <DataRow label="Funding" value={displaySourceValue(profile?.funding_type)} />
      <DataRow label="Bias" value={displaySourceValue(profile?.bias_rating)} />
      <DataRow label="Parent company" value={displaySourceValue(profile?.parent_company)} />
      <DataRow label="Articles" value={displaySourceValue(profile?.article_count)} />
      <DataRow label="Last indexed" value={displaySourceValue(profile?.last_indexed_at)} />
    </div>
  </div>
);

const StatCard = ({ label, value }: Readonly<{ label: string; value: string | number }>) => (
  <div className="rounded-xl border border-white/10 bg-black/10 p-3">
    <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 text-lg text-foreground">{value}</div>
  </div>
);

const DataRow = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-muted-foreground">{label}</span>
    <span className="max-w-[60%] text-right text-foreground">{value}</span>
  </div>
);

function formatAverageLatency(values: readonly (number | undefined)[] | undefined): string {
  const numericValues = (values ?? []).filter(
    (value): value is number => typeof value === "number",
  );
  if (numericValues.length === 0) {
    return "—";
  }
  return `${Math.round(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length)}ms`;
}

export { SourceIntelligenceOperations };
