"use client";

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL, fetchDebugErrors, fetchLlmLogs, triggerWikiIndex } from '@/lib/api';
import type { CacheStatus, DebugErrorsResponse, LlmLogEntry, LlmLogResponse, SourceStats, WikiIndexStatus, WikiSourceProfile } from '@/lib/api';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type workspaceSupport from "./source-intelligence-support";

type WorkspaceTab = (typeof workspaceSupport.tabs)[number]["id"];

const PANEL_CLASS = "rounded-[1.6rem] border border-white/[0.08] bg-background/70 p-4 backdrop-blur-xl",
 SURFACE_CLASS = "rounded-[1.2rem] border border-white/[0.08] bg-black/20 p-4";

interface OperationsPanelProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  tabs: { id: WorkspaceTab; label: string }[];
  sourceStats: SourceStats[];
  cacheStatus: CacheStatus | null;
  wikiIndexStatus: WikiIndexStatus | undefined;
  selectedSourceName: string | null;
  selectedSourceProfile: WikiSourceProfile | null;
  onRefreshAll: () => void;
  onSourceProfileRefresh: () => Promise<void>;
}

interface ParserResult {
  success?: boolean;
  error?: string;
  parse_time_seconds?: number;
  image_url?: string;
  candidates?: { priority?: number; source?: string; url?: string }[];
  sample_entries?: { title?: string; image_extraction?: { image_url?: string; image_error?: string } }[];
  status?: { entries_count?: number };
}

interface NormalizedErrorEvent {
  key: string;
  service: string;
  errorType: string;
  message: string;
}

export function SourceIntelligenceOperations({
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
}: OperationsPanelProps) {
  const [rssUrl, setRssUrl] = useState(""),
   [articleUrl, setArticleUrl] = useState(""),
   [rssResult, setRssResult] = useState<ParserResult | null>(undefined),
   [articleResult, setArticleResult] = useState<ParserResult | null>(undefined),
   [testingFeed, setTestingFeed] = useState(false),
   [testingArticle, setTestingArticle] = useState(false),
   [indexingSource, setIndexingSource] = useState(false),

   llmLogsQuery = useQuery<LlmLogResponse>({
    enabled: activeTab === "llm",
    queryFn: () => fetchLlmLogs({ limit: 12 }),
    queryKey: ["source-intelligence-llm"],
    retry: 1,
  }),
   errorsQuery = useQuery<DebugErrorsResponse>({
    enabled: activeTab === "errors",
    queryFn: () => fetchDebugErrors({ includeRequestStreamEvents: true, limit: 12 }),
    queryKey: ["source-intelligence-errors"],
    retry: 1,
  }),

   topSources = useMemo(() => sourceStats.slice(0, 10), [sourceStats]),
   problematicSources = useMemo(
    () => sourceStats.filter((source) => source.status !== "success").slice(0, 6),
    [sourceStats],
  ),
   averageArticles = useMemo(() => {
    if (sourceStats.length === 0) {return 0;}
    const total = sourceStats.reduce((sum, source) => sum + source.article_count, 0);
    return Math.round(total / sourceStats.length);
  }, [sourceStats]),
   modelSuccessCount = llmLogsQuery.data?.entries.filter((entry) => entry.success).length ?? 0,
   modelFailureCount = llmLogsQuery.data?.entries.filter((entry) => entry.success === false).length ?? 0,
   recentErrorEvents = [
    ...(errorsQuery.data?.log_file.entries ?? []).map<NormalizedErrorEvent>((entry, index) => ({
      errorType: entry.error_type || "error",
      key: `${entry.request_id || "log"}-${index}`,
      message: entry.error_message || "No error message recorded.",
      service: entry.service || "unknown service",
    })),
    ...(errorsQuery.data?.recent_request_stream_errors ?? []).map<NormalizedErrorEvent>((entry, index) => ({
      errorType: entry.error_type || entry.event_type || "error",
      key: `${entry.request_id || "stream"}-${index}`,
      message: entry.error_message || entry.message || "No error message recorded.",
      service: entry.service || entry.component || "unknown service",
    })),
  ];

  async function testFeed() {
    if (!rssUrl.trim()) {return;}
    setTestingFeed(true);
    setRssResult(undefined);
    try {
      const response = await fetch(`${API_BASE_URL}/debug/parser/test/rss?url=${encodeURIComponent(rssUrl)}`, {
        method: "POST",
      });
      setRssResult(await response.json());
    } catch (error) {
      setRssResult({ error: error instanceof Error ? error.message : "Feed test failed" });
    } finally {
      setTestingFeed(false);
    }
  }

  async function testArticle() {
    if (!articleUrl.trim()) {return;}
    setTestingArticle(true);
    setArticleResult(undefined);
    try {
      const response = await fetch(`${API_BASE_URL}/debug/parser/test/article?url=${encodeURIComponent(articleUrl)}`, {
        method: "POST",
      });
      setArticleResult(await response.json());
    } catch (error) {
      setArticleResult({ error: error instanceof Error ? error.message : "Article test failed" });
    } finally {
      setTestingArticle(false);
    }
  }

  async function indexSelectedSource() {
    if (!selectedSourceName) {return;}
    setIndexingSource(true);
    try {
      await triggerWikiIndex(selectedSourceName);
      await onSourceProfileRefresh();
      onRefreshAll();
    } finally {
      setIndexingSource(false);
    }
  }

  return (
    <section className={`${PANEL_CLASS} flex min-h-0 flex-col`}>
      <div className="mb-4 flex items-center gap-6 overflow-x-auto border-b border-white/[0.08] pb-0 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() =>{  onTabChange(tab.id); }}
            className={`whitespace-nowrap border-b-2 px-1 py-2 text-[11px] font-mono uppercase tracking-[0.18em] ${
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-white/20"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[1.2rem] border border-white/[0.08] bg-black/[0.15]">
        <div className="h-full overflow-y-auto p-4">
          {activeTab === "ingestion" && (
            <IngestionTab sources={topSources} onRefreshAll={onRefreshAll} />
          )}

          {activeTab === "storage" && (
            <StorageTab cacheStatus={cacheStatus} wikiIndexStatus={wikiIndexStatus} averageArticles={averageArticles} />
          )}

          {activeTab === "parser" && (
            <ParserTab
              rssUrl={rssUrl}
              articleUrl={articleUrl}
              onRssUrlChange={setRssUrl}
              onArticleUrlChange={setArticleUrl}
              rssResult={rssResult}
              articleResult={articleResult}
              testingFeed={testingFeed}
              testingArticle={testingArticle}
              onTestFeed={() => void testFeed()}
              onTestArticle={() => void testArticle()}
            />
          )}

          {activeTab === "llm" && (
            <LlmTab entries={llmLogsQuery.data?.entries ?? []} successCount={modelSuccessCount} failureCount={modelFailureCount} />
          )}

          {activeTab === "errors" && (
            <ErrorsTab problematicSources={problematicSources} recentErrorEvents={recentErrorEvents} />
          )}

          {activeTab === "performance" && (
            <PerformanceTab
              averageArticles={averageArticles}
              recentErrorEvents={recentErrorEvents}
              latencyValues={llmLogsQuery.data?.entries.map((entry) => entry.duration_ms) ?? []}
            />
          )}

          {activeTab === "media" && (
            <MediaTab
              selectedSourceProfile={selectedSourceProfile}
              selectedSourceName={selectedSourceName}
              indexingSource={indexingSource}
              onIndex={() => void indexSelectedSource()}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function IngestionTab({ sources, onRefreshAll }:Readonly< { sources: SourceStats[]; onRefreshAll: () => void }>) {
  return (
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
}

function SourcesTable({ sources }:Readonly< { sources: SourceStats[] }>) {
  return (
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
}

function Th({ children }:Readonly< { children: ReactNode }>) {
  return (
    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </TableHead>
  );
}

function SourceRow({ source }:Readonly< { source: SourceStats }>) {
  return (
    <TableRow className="border-white/5 hover:bg-white/[0.02]">
      <TableCell className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-black/40 text-[9px] text-muted-foreground">
            {(source.country || source.name).slice(0, 2).toUpperCase()}
          </span>
          {source.name}
        </div>
      </TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">{source.category || "—"}</TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">{source.bias_rating || "—"}</TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">{source.funding_type || "—"}</TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">{source.country || "—"}</TableCell>
      <TableCell className="px-3 py-2">
        <span
          className={
            source.status === "success"
              ? "text-emerald-400"
              : (source.status === "warning"
                ? "text-amber-400"
                : "text-red-400")
          }
        >
          {source.status === "success" ? "Healthy" : (source.status === "warning" ? "Needs review" : "Issue")}
        </span>
      </TableCell>
      <TableCell className="px-3 py-2 text-foreground">{source.article_count}</TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">
        {source.last_checked
          ? new Date(source.last_checked).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—"}
      </TableCell>
    </TableRow>
  );
}

function StorageTab({
  cacheStatus,
  wikiIndexStatus,
  averageArticles,
}:Readonly< {
  cacheStatus: CacheStatus | null;
  wikiIndexStatus: WikiIndexStatus | undefined;
  averageArticles: number;
}>) {
  return (
    <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
      <div className={SURFACE_CLASS}>
        <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cache Summary</div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total Articles" value={cacheStatus?.total_articles?.toLocaleString() ?? "—"} />
          <StatCard label="Source Records" value={cacheStatus?.total_sources ?? "—"} />
          <StatCard label="Working Sources" value={cacheStatus?.sources_working ?? "—"} />
          <StatCard label="Average Articles" value={averageArticles || "—"} />
        </div>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          <DataRow label="Last cache update" value={cacheStatus?.last_updated ? new Date(cacheStatus.last_updated).toLocaleString() : "—"} />
          <DataRow label="Refresh state" value={cacheStatus?.update_in_progress ? "Running" : "Idle"} />
          <DataRow label="Cache age" value={cacheStatus?.cache_age_seconds == null ? "—" : `${cacheStatus.cache_age_seconds.toFixed(1)}s`} />
        </div>
      </div>

      <WikiIndexCard wikiIndexStatus={wikiIndexStatus} />
    </div>
  );
}

function WikiIndexCard({ wikiIndexStatus }:Readonly< { wikiIndexStatus: WikiIndexStatus | undefined }>) {
  return (
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Wiki Index</div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Entries" value={wikiIndexStatus?.total_entries ?? "—"} />
        <StatCard label="Indexed" value={wikiIndexStatus?.by_status.indexed ?? 0} />
        <StatCard label="Sources" value={wikiIndexStatus?.by_type.source ?? 0} />
        <StatCard label="Organizations" value={wikiIndexStatus?.by_type.organization ?? 0} />
      </div>
      <div className="mt-4 space-y-2">
        {Object.entries(wikiIndexStatus?.by_status ?? {}).map(([status, count]) => (
          <DataRow key={status} label={status.replaceAll("_", " ")} value={String(count)} />
        ))}
      </div>
    </div>
  );
}

function ParserTab({
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
}:Readonly< {
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
}>) {
  return (
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
}

function ParserTestCard({
  title,
  placeholder,
  value,
  onValueChange,
  onTest,
  testing,
  result,
  rows,
}:Readonly< {
  title: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  onTest: () => void;
  testing: boolean;
  result: ParserResult | null;
  rows: { label: string; value: string }[];
}>) {
  return (
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) =>{  onValueChange(event.target.value); }}
          placeholder={placeholder}
          className="border-white/10 bg-black/30 text-foreground"
        />
        <Button onClick={onTest} disabled={testing}>
          {testing ? "Testing..." : "Run"}
        </Button>
      </div>
      {result ? (
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          {rows.map((row) => (
            <DataRow key={row.label} label={row.label} value={row.value} />
          ))}
          {result.error ? <div className="text-red-300">{result.error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function feedResultRows(result: ParserResult | null): { label: string; value: string }[] {
  if (!result) {return [];}
  return [
    { label: "Result", value: result.success ? "Feed parsed" : "Feed failed" },
    { label: "Entries", value: String(result.status?.entries_count ?? "—") },
    { label: "Parse time", value: result.parse_time_seconds ? `${result.parse_time_seconds}s` : "—" },
  ];
}

function articleResultRows(result: ParserResult | null): { label: string; value: string }[] {
  if (!result) {return [];}
  return [
    { label: "Result", value: result.success ? "Image found" : "No image found" },
    { label: "Image URL", value: result.image_url ?? "—" },
  ];
}

function LlmTab({
  entries,
  successCount,
  failureCount,
}:Readonly< {
  entries: LlmLogEntry[];
  successCount: number;
  failureCount: number;
}>) {
  return (
    <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
      <div className={SURFACE_CLASS}>
        <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Model Activity</div>
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
}

function LlmEntries({ entries }:Readonly< { entries: LlmLogEntry[] }>) {
  return (
    <div className="space-y-3">
      {entries.map((entry, index) => (
        <LlmEntryCard key={`${entry.request_id || "llm"}-${index}`} entry={entry} />
      ))}
    </div>
  );
}

function LlmEntryCard({ entry }:Readonly< { entry: LlmLogEntry }>) {
  return (
    <div className={SURFACE_CLASS}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-foreground">
            {entry.service || "unknown"} · {entry.model || "unknown"}
          </div>
          <div className="text-xs text-muted-foreground">{entry.timestamp || "—"}</div>
        </div>
        <div className={entry.success ? "text-emerald-300" : "text-red-300"}>
          {entry.success ? "success" : "failed"}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>{entry.duration_ms ? `${entry.duration_ms}ms` : "No latency recorded"}</span>
        <span>{entry.finish_reason || "No finish reason"}</span>
      </div>
      {entry.error_message ? <div className="mt-2 text-sm text-red-300">{entry.error_message}</div> : null}
    </div>
  );
}

function ErrorsTab({
  problematicSources,
  recentErrorEvents,
}:Readonly< {
  problematicSources: SourceStats[];
  recentErrorEvents: NormalizedErrorEvent[];
}>) {
  return (
    <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
      <div className={SURFACE_CLASS}>
        <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Current Issues</div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Open issues" value={problematicSources.length} />
          <StatCard label="Recent errors" value={recentErrorEvents.length} />
        </div>
        <div className="mt-4 space-y-2">
          {problematicSources.length === 0 ? (
            <div className="text-sm text-muted-foreground">No non-healthy sources in the latest sample.</div>
          ) : (
            problematicSources.map((source) => (
              <DataRow key={source.name} label={source.name} value={source.error_message || source.status} />
            ))
          )}
        </div>
      </div>

      <div className="space-y-3">
        {recentErrorEvents.map((entry, index) => (
          <ErrorEventCard key={`${entry.key}-${index}`} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function ErrorEventCard({ entry }:Readonly< { entry: NormalizedErrorEvent }>) {
  return (
    <div className={SURFACE_CLASS}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-foreground">{entry.service}</div>
        <div className="text-red-300">{entry.errorType}</div>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{entry.message}</div>
    </div>
  );
}

function PerformanceTab({
  averageArticles,
  recentErrorEvents,
  latencyValues,
}:Readonly< {
  averageArticles: number;
  recentErrorEvents: NormalizedErrorEvent[];
  latencyValues: (number | undefined)[];
}>) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className={SURFACE_CLASS}>
        <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Feed Throughput</div>
        <StatCard label="Avg articles per source" value={averageArticles || "—"} />
      </div>
      <div className={SURFACE_CLASS}>
        <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Model Latency</div>
        <StatCard label="Average call time" value={formatAverageLatency(latencyValues)} />
      </div>
      <div className={SURFACE_CLASS}>
        <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Stability</div>
        <StatCard label="Recent error count" value={recentErrorEvents.length} />
      </div>
    </div>
  );
}

function MediaTab({
  selectedSourceProfile,
  selectedSourceName,
  indexingSource,
  onIndex,
}:Readonly< {
  selectedSourceProfile: WikiSourceProfile | null;
  selectedSourceName: string | null;
  indexingSource: boolean;
  onIndex: () => void;
}>) {
  return (
    <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4">
        <div className={SURFACE_CLASS}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Source Summary</div>
            <button
              onClick={onIndex}
              disabled={!selectedSourceName || indexingSource}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/5 disabled:opacity-50"
            >
              {indexingSource ? "Indexing..." : "Index source"}
            </button>
          </div>
          <p className="text-sm leading-7 text-foreground/90">
            {selectedSourceProfile?.overview || "No summary has been written for this source yet."}
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
}

function DossierSectionsCard({ profile }:Readonly< { profile: WikiSourceProfile | null }>) {
  return (
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Dossier Sections</div>
      <div className="space-y-2">
        {(profile?.dossier_sections ?? []).slice(0, 5).map((section) => (
          <div key={section.id} className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
            <div className="text-sm text-foreground">{section.title}</div>
            <div className="text-xs text-muted-foreground">
              {section.status === "available" ? `${section.items.length} saved items` : "No saved items yet"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OwnershipChainCard({ profile }:Readonly< { profile: WikiSourceProfile | null }>) {
  const chain = profile?.ownership_chain ?? [];
  return (
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ownership Chain</div>
      <div className="space-y-2">
        {chain.slice(0, 6).map((org) => (
          <div key={org.name} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-foreground">
            {org.name}
          </div>
        ))}
        {chain.length === 0 ? (
          <div className="text-sm text-muted-foreground">No ownership chain recorded yet.</div>
        ) : null}
      </div>
    </div>
  );
}

function QuickFactsCard({ profile }:Readonly< { profile: WikiSourceProfile | null }>) {
  return (
    <div className={SURFACE_CLASS}>
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Quick Facts</div>
      <div className="space-y-2 text-sm text-muted-foreground">
        <DataRow label="Country" value={profile?.country || "—"} />
        <DataRow label="Funding" value={profile?.funding_type || "—"} />
        <DataRow label="Bias" value={profile?.bias_rating || "—"} />
        <DataRow label="Parent company" value={profile?.parent_company || "—"} />
        <DataRow label="Articles" value={String(profile?.article_count ?? "—")} />
        <DataRow label="Last indexed" value={profile?.last_indexed_at || "—"} />
      </div>
    </div>
  );
}

function StatCard({ label, value }:Readonly< { label: string; value: string | number }>) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 p-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg text-foreground">{value}</div>
    </div>
  );
}

function DataRow({ label, value }:Readonly< { label: string; value: string }>) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right text-foreground">{value}</span>
    </div>
  );
}

function formatAverageLatency(values: (number | undefined)[] | undefined): string {
  const numericValues = (values ?? []).filter((value): value is number => typeof value === "number");
  if (numericValues.length === 0) {return "—";}
  const average = Math.round(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length);
  return `${average}ms`;
}
