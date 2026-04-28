"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  API_BASE_URL,
  fetchDebugErrors,
  fetchLlmLogs,
  triggerWikiIndex,
  type CacheStatus,
  type DebugErrorsResponse,
  type LlmLogResponse,
  type SourceStats,
  type WikiIndexStatus,
  type WikiSourceProfile,
} from "@/lib/api";
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
import type { WorkspaceTab } from "./source-intelligence-support";

const PANEL_CLASS = "rounded-[1.6rem] border border-white/[0.08] bg-background/70 p-4 backdrop-blur-xl";
const SURFACE_CLASS = "rounded-[1.2rem] border border-white/[0.08] bg-black/20 p-4";

interface OperationsPanelProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  tabs: Array<{ id: WorkspaceTab; label: string }>;
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
  candidates?: Array<{ priority?: number; source?: string; url?: string }>;
  sample_entries?: Array<{ title?: string; image_extraction?: { image_url?: string; image_error?: string } }>;
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
  const [rssUrl, setRssUrl] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [rssResult, setRssResult] = useState<ParserResult | null>(null);
  const [articleResult, setArticleResult] = useState<ParserResult | null>(null);
  const [testingFeed, setTestingFeed] = useState(false);
  const [testingArticle, setTestingArticle] = useState(false);
  const [indexingSource, setIndexingSource] = useState(false);

  const llmLogsQuery = useQuery<LlmLogResponse>({
    queryKey: ["source-intelligence-llm"],
    queryFn: () => fetchLlmLogs({ limit: 12 }),
    enabled: activeTab === "llm",
    retry: 1,
  });
  const errorsQuery = useQuery<DebugErrorsResponse>({
    queryKey: ["source-intelligence-errors"],
    queryFn: () => fetchDebugErrors({ limit: 12, includeRequestStreamEvents: true }),
    enabled: activeTab === "errors",
    retry: 1,
  });

  const topSources = useMemo(() => sourceStats.slice(0, 10), [sourceStats]);
  const problematicSources = useMemo(
    () => sourceStats.filter((source) => source.status !== "success").slice(0, 6),
    [sourceStats],
  );
  const averageArticles = useMemo(() => {
    if (sourceStats.length === 0) return 0;
    const total = sourceStats.reduce((sum, source) => sum + source.article_count, 0);
    return Math.round(total / sourceStats.length);
  }, [sourceStats]);
  const modelSuccessCount = llmLogsQuery.data?.entries.filter((entry) => entry.success).length ?? 0;
  const modelFailureCount = llmLogsQuery.data?.entries.filter((entry) => entry.success === false).length ?? 0;
  const recentErrorEvents = [
    ...(errorsQuery.data?.log_file.entries ?? []).map<NormalizedErrorEvent>((entry, index) => ({
      key: `${entry.request_id || "log"}-${index}`,
      service: entry.service || "unknown service",
      errorType: entry.error_type || "error",
      message: entry.error_message || "No error message recorded.",
    })),
    ...(errorsQuery.data?.recent_request_stream_errors ?? []).map<NormalizedErrorEvent>((entry, index) => ({
      key: `${entry.request_id || "stream"}-${index}`,
      service: entry.service || entry.component || "unknown service",
      errorType: entry.error_type || entry.event_type || "error",
      message: entry.error_message || entry.message || "No error message recorded.",
    })),
  ];

  async function testFeed() {
    if (!rssUrl.trim()) return;
    setTestingFeed(true);
    setRssResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/debug/parser/test/feed?url=${encodeURIComponent(rssUrl)}`, {
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
    if (!articleUrl.trim()) return;
    setTestingArticle(true);
    setArticleResult(null);
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
    if (!selectedSourceName) return;
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
            onClick={() => onTabChange(tab.id)}
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

              <Table className="text-foreground">
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Source</TableHead>
                    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Type</TableHead>
                    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Bias</TableHead>
                    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Funding</TableHead>
                    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Country</TableHead>
                    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Status</TableHead>
                    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Articles</TableHead>
                    <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Last Checked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topSources.map((source) => (
                    <TableRow key={`${source.name}-${source.url}`} className="border-white/5 hover:bg-white/[0.02]">
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
                              : source.status === "warning"
                                ? "text-amber-400"
                                : "text-red-400"
                          }
                        >
                          {source.status === "success" ? "Healthy" : source.status === "warning" ? "Needs review" : "Issue"}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-foreground">{source.article_count}</TableCell>
                      <TableCell className="px-3 py-2 text-muted-foreground">
                        {source.last_checked
                          ? new Date(source.last_checked).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {activeTab === "storage" && (
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
                  <DataRow label="Cache age" value={cacheStatus?.cache_age_seconds != null ? `${cacheStatus.cache_age_seconds.toFixed(1)}s` : "—"} />
                </div>
              </div>

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
            </div>
          )}

          {activeTab === "parser" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className={SURFACE_CLASS}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Feed Parser</div>
                <div className="flex gap-2">
                  <Input
                    value={rssUrl}
                    onChange={(event) => setRssUrl(event.target.value)}
                    placeholder="Paste an RSS feed URL"
                    className="border-white/10 bg-black/30 text-foreground"
                  />
                  <Button onClick={() => void testFeed()} disabled={testingFeed}>
                    {testingFeed ? "Testing..." : "Run"}
                  </Button>
                </div>
                {rssResult ? (
                  <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                    <DataRow label="Result" value={rssResult.success ? "Feed parsed" : "Feed failed"} />
                    <DataRow label="Entries" value={String(rssResult.status?.entries_count ?? "—")} />
                    <DataRow
                      label="Parse time"
                      value={rssResult.parse_time_seconds ? `${rssResult.parse_time_seconds}s` : "—"}
                    />
                    {rssResult.error ? <div className="text-red-300">{rssResult.error}</div> : null}
                  </div>
                ) : null}
              </div>

              <div className={SURFACE_CLASS}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Article Image Check</div>
                <div className="flex gap-2">
                  <Input
                    value={articleUrl}
                    onChange={(event) => setArticleUrl(event.target.value)}
                    placeholder="Paste an article URL"
                    className="border-white/10 bg-black/30 text-foreground"
                  />
                  <Button onClick={() => void testArticle()} disabled={testingArticle}>
                    {testingArticle ? "Testing..." : "Run"}
                  </Button>
                </div>
                {articleResult ? (
                  <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                    <DataRow label="Result" value={articleResult.success ? "Image found" : "No image found"} />
                    <DataRow label="Image URL" value={articleResult.image_url ?? "—"} />
                    {articleResult.error ? <div className="text-red-300">{articleResult.error}</div> : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeTab === "llm" && (
            <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
              <div className={SURFACE_CLASS}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Model Activity</div>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Calls" value={llmLogsQuery.data?.entries.length ?? 0} />
                  <StatCard label="Success" value={modelSuccessCount} />
                  <StatCard label="Failed" value={modelFailureCount} />
                  <StatCard
                    label="Avg latency"
                    value={formatAverageLatency(llmLogsQuery.data?.entries.map((entry) => entry.duration_ms))}
                  />
                </div>
              </div>

              <div className="space-y-3">
                {(llmLogsQuery.data?.entries ?? []).map((entry, index) => (
                  <div key={`${entry.request_id || "llm"}-${index}`} className={SURFACE_CLASS}>
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
                ))}
              </div>
            </div>
          )}

          {activeTab === "errors" && (
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
                  <div key={`${entry.key}-${index}`} className={SURFACE_CLASS}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-foreground">{entry.service}</div>
                      <div className="text-red-300">{entry.errorType}</div>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">{entry.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "performance" && (
            <div className="grid gap-4 md:grid-cols-3">
              <div className={SURFACE_CLASS}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Feed Throughput</div>
                <StatCard label="Avg articles per source" value={averageArticles || "—"} />
              </div>
              <div className={SURFACE_CLASS}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Model Latency</div>
                <StatCard label="Average call time" value={formatAverageLatency(llmLogsQuery.data?.entries.map((entry) => entry.duration_ms))} />
              </div>
              <div className={SURFACE_CLASS}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Stability</div>
                <StatCard label="Recent error count" value={recentErrorEvents.length} />
              </div>
            </div>
          )}

          {activeTab === "media" && (
            <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div className={SURFACE_CLASS}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Source Summary</div>
                    <button
                      onClick={() => {
                        void indexSelectedSource();
                      }}
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

                <div className={SURFACE_CLASS}>
                  <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Dossier Sections</div>
                  <div className="space-y-2">
                    {(selectedSourceProfile?.dossier_sections ?? []).slice(0, 5).map((section) => (
                      <div key={section.id} className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                        <div className="text-sm text-foreground">{section.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {section.status === "available" ? `${section.items.length} saved items` : "No saved items yet"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className={SURFACE_CLASS}>
                  <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ownership Chain</div>
                  <div className="space-y-2">
                    {(selectedSourceProfile?.ownership_chain ?? []).slice(0, 6).map((org) => (
                      <div key={org.name} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-foreground">
                        {org.name}
                      </div>
                    ))}
                    {(selectedSourceProfile?.ownership_chain ?? []).length === 0 ? (
                      <div className="text-sm text-muted-foreground">No ownership chain recorded yet.</div>
                    ) : null}
                  </div>
                </div>

                <div className={SURFACE_CLASS}>
                  <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Quick Facts</div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <DataRow label="Country" value={selectedSourceProfile?.country || "—"} />
                    <DataRow label="Funding" value={selectedSourceProfile?.funding_type || "—"} />
                    <DataRow label="Bias" value={selectedSourceProfile?.bias_rating || "—"} />
                    <DataRow label="Parent company" value={selectedSourceProfile?.parent_company || "—"} />
                    <DataRow label="Articles" value={String(selectedSourceProfile?.article_count ?? "—")} />
                    <DataRow label="Last indexed" value={selectedSourceProfile?.last_indexed_at || "—"} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 p-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg text-foreground">{value}</div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right text-foreground">{value}</span>
    </div>
  );
}

function formatAverageLatency(values: Array<number | undefined> | undefined): string {
  const numericValues = (values ?? []).filter((value): value is number => typeof value === "number");
  if (numericValues.length === 0) return "—";
  const average = Math.round(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length);
  return `${average}ms`;
}
