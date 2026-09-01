"use client"

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
  refreshCache,
} from "@/lib/api"
import type { CacheDebugResponse, CacheDeltaResponse, CacheStatus, ChromaDebugResponse, DatabaseDebugResponse, DebugErrorEntry, DebugErrorsResponse, LlmLogEntry, LlmLogResponse, SourceStats, StartupEventMetric, StartupMetricsResponse, StorageDriftReport } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ChangeEvent, ComponentProps, ReactNode } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { logger, setDebugMode } from "@/lib/logger"
import { Suspense, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { GlobalNavigation } from "@/components/global-navigation"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { SafeImage } from "@/components/safe-image"
import { exportDebugData } from "@/lib/performance-logger"
import { useDebugMode } from "@/hooks/use-debug-mode"
import { useQuery } from "@tanstack/react-query"
import { z } from "zod"

interface DebugActiveStreamRecord {
  readonly duration_so_far?: number
  readonly request_path?: string
  readonly stream_id?: string
}

interface DebugLogEventRecord {
  readonly event_type?: string
  readonly message?: string
  readonly timestamp?: string
}

interface DebugLogFileRecord {
  readonly created?: string
  readonly filename?: string
  readonly modified?: string
  readonly size_bytes?: number
  readonly size_kb?: number
}

interface DebugSlowOperationRecord {
  readonly duration_ms?: number
  readonly event_type?: string
  readonly request_id?: string
  readonly stream_id?: string
}

interface BackendDebugSummary {
  readonly errors?: number
  readonly slow_operations?: number
  readonly total_events?: number
}

interface SystemStatusResponse {
  components?: {
    cache?: {
      healthy?: boolean
      article_count?: number
      last_updated?: string
      age_seconds?: number
      update_in_progress?: boolean
      update_count?: number
      incremental_enabled?: boolean
      sources_tracked?: number
    }
    database?: { healthy?: boolean }
    vector_store?: { healthy?: boolean }
    embedding_queue?: {
      depth?: number
      batch_size?: number
      max_per_minute?: number
    }
  }
  runtime?: {
    python_version?: string
    platform?: string
    pid?: number
  }
  pipeline?: {
    fetch?: {
      not_modified?: number
      errors?: number
    }
  }
}

interface RssSampleEntry {
  title?: string
  image_extraction?: {
    image_url?: string
    image_error?: string
    selected_source?: string
    image_error_details?: string
  }
}

interface RssParserTestResult {
  success?: boolean
  parse_time_seconds?: number
  feed_info?: { title?: string }
  status?: { entries_count?: number }
  sample_entries?: RssSampleEntry[]
  error?: string
}

interface ArticleCandidate {
  priority?: number
  source?: string
  url?: string
}

interface ArticleParserTestResult {
  success?: boolean
  image_url?: string
  candidates?: ArticleCandidate[]
  error?: string
  error_details?: string
}

type ImageErrorCode =
  | "ARTICLE_FETCH_FAILED"
  | "FRONTEND_RENDER_FAILED"
  | "IMAGE_FETCH_FAILED"
  | "IMAGE_FETCH_TIMEOUT"
  | "IMAGE_UNSUPPORTED_TYPE"
  | "IMAGE_URL_INVALID"
  | "MIXED_CONTENT_BLOCKED"
  | "NO_IMAGE_IN_FEED"
  | "OG_IMAGE_NOT_FOUND"

interface BackendDebugReport {
  generated_at?: string
  summary?: BackendDebugSummary
  active_streams?: readonly DebugActiveStreamRecord[]
  recommendations?: readonly string[]
}

interface LogLevelResponse {
  level?: string
}

interface DashboardData {
  chromaData: ChromaDebugResponse
  dbData: DatabaseDebugResponse
  driftData: StorageDriftReport
  startupMetrics: StartupMetricsResponse
  cacheData: CacheDebugResponse
  cacheDelta: CacheDeltaResponse
}

interface PerformanceDebugData {
  backendDebugReport: BackendDebugReport | undefined
  backendLogEvents: readonly DebugLogEventRecord[]
  backendSlowOps: readonly DebugSlowOperationRecord[]
  backendLogFiles: readonly DebugLogFileRecord[]
  frontendPerfData: ReturnType<typeof exportDebugData> | undefined
}

interface DebugQueryOptions {
  readonly activeTab: DebugTab
  readonly chromaLimit: number
  readonly chromaOffset: number
  readonly dbLimit: number
  readonly dbOffset: number
  readonly dbMissingOnly: boolean
  readonly dbSortDirection: "asc" | "desc"
  readonly dbSourceFilter: string | undefined
  readonly dbBeforeFilter: string | undefined
  readonly dbAfterFilter: string | undefined
  readonly cacheLimit: number
  readonly cacheOffset: number
  readonly cacheSourceFilter: string | undefined
}

type DebugTab = (typeof DEBUG_TABS)[number]

interface SystemStatusSectionProps {
  systemStatus: SystemStatusResponse | undefined;
  startupMetrics: StartupMetricsResponse | undefined;
  startupEvents: readonly StartupEventMetric[];
  onRefreshStatus: () => void;
}

interface StatusLine {
  label: string;
  value: ReactNode;
}

interface PipelineSignal {
  detail: ReactNode;
  label: string;
  value: ReactNode;
}

interface PipelineSignalRowProps {
  readonly signal: PipelineSignal
}

interface SourcesSectionProps {
  sourceStats: readonly SourceStats[];
  cacheStatus: CacheStatus | undefined;
  cacheRefreshMessage: string | undefined;
  cacheRefreshError: string | undefined;
  cacheRefreshRunning: boolean;
  onRefresh: () => void;
  onRefreshCache: () => void;
}

interface StartupTimelineCardProps {
  startupMetrics: StartupMetricsResponse | undefined;
  startupEvents: readonly StartupEventMetric[];
  detailFallback?: string;
}

interface StorageSectionProps {
  chromaData: ChromaDebugResponse | undefined;
  dbData: DatabaseDebugResponse | undefined;
  driftData: StorageDriftReport | undefined;
  cacheData: CacheDebugResponse | undefined;
  cacheDelta: CacheDeltaResponse | undefined;
  startupMetrics: StartupMetricsResponse | undefined;
  startupEvents: StartupEventMetric[];
  chromaLimit: number;
  setChromaLimit: (value: number) => void;
  chromaOffset: number;
  setChromaOffset: (value: number) => void;
  dbLimit: number;
  setDbLimit: (value: number) => void;
  dbOffset: number;
  setDbOffset: (value: number) => void;
  dbSortDirection: "asc" | "desc";
  setDbSortDirection: (value: "asc" | "desc") => void;
  dbMissingOnly: boolean;
  setDbMissingOnly: (value: boolean) => void;
  cacheLimit: number;
  setCacheLimit: (value: number) => void;
  cacheOffset: number;
  setCacheOffset: (value: number) => void;
  cacheSourceDraft: string;
  setCacheSourceDraft: (value: string) => void;
  dbSourceDraft: string;
  setDbSourceDraft: (value: string) => void;
  dbBeforeDraft: string;
  setDbBeforeDraft: (value: string) => void;
  dbAfterDraft: string;
  setDbAfterDraft: (value: string) => void;
  onApplyCacheFilters: () => void;
  onApplyDbFilters: () => void;
}

interface StorageSnapshotSectionProps {
  chromaData: ChromaDebugResponse | undefined
  dbData: DatabaseDebugResponse | undefined
  driftStats: StorageDriftReport | undefined
  cacheData: CacheDebugResponse | undefined
  chromaLimit: number
  setChromaLimit: (value: number) => void
  chromaOffset: number
  setChromaOffset: (value: number) => void
  dbLimit: number
  setDbLimit: (value: number) => void
  dbOffset: number
  setDbOffset: (value: number) => void
  dbSortDirection: "asc" | "desc"
  setDbSortDirection: (value: "asc" | "desc") => void
  dbMissingOnly: boolean
  setDbMissingOnly: (value: boolean) => void
  cacheLimit: number
  setCacheLimit: (value: number) => void
  cacheOffset: number
  setCacheOffset: (value: number) => void
}

interface SnapshotPaginationProps {
  limit: number
  onLimitChange: (value: number) => void
  offset: number
  onOffsetChange: (value: number) => void
  compact?: boolean
}

interface CacheDeltaCardProps { cacheDelta: CacheDeltaResponse | undefined }

interface ParserSectionProps {
  rssTestUrl: string;
  setRssTestUrl: (value: string) => void;
  rssTestResult: RssParserTestResult | undefined;
  rssTestLoading: boolean;
  testRssParser: () => void;
  articleTestUrl: string;
  setArticleTestUrl: (value: string) => void;
  articleTestResult: ArticleParserTestResult | undefined;
  articleTestLoading: boolean;
  testArticleParser: () => void;
}

interface ControlsSectionProps {
  logLevel: string;
  onSetLogLevel: (level: string) => void;
  frontendDebugMode: boolean;
  onToggleFrontendDebug: () => void;
}

interface LlmSectionProps {
  llmLogs: LlmLogResponse | undefined;
  onRefresh: () => void;
}

interface LlmCallCardProps {
  entry: LlmLogEntry
}

interface ErrorsSectionProps {
  debugErrors: DebugErrorsResponse | undefined;
  onRefresh: () => void;
}

interface PerformanceSectionProps {
  backendDebugReport: BackendDebugReport | undefined;
  backendLogEvents: readonly DebugLogEventRecord[];
  backendSlowOps: readonly DebugSlowOperationRecord[];
  backendLogFiles: readonly DebugLogFileRecord[];
  frontendPerfData: ReturnType<typeof exportDebugData> | undefined;
  onRefresh: () => void;
}

interface DebugDashboardContentProps {
  embedded: boolean
  loading: boolean
  error: string | undefined
  activeTab: DebugTab
  onTabChange: (value: string) => void
  onRefresh: () => void
  system: ComponentProps<typeof SystemStatusSection>
  sources: ComponentProps<typeof SourcesSection>
  storage: ComponentProps<typeof StorageSection>
  parser: ComponentProps<typeof ParserSection>
  controls: ComponentProps<typeof ControlsSection>
  llm: ComponentProps<typeof LlmSection>
  errors: ComponentProps<typeof ErrorsSection>
  performance: ComponentProps<typeof PerformanceSection>
}

interface DebugDashboardState {
  chromaLimit: number
  setChromaLimit: (value: number) => void
  chromaOffset: number
  setChromaOffset: (value: number) => void
  dbLimit: number
  setDbLimit: (value: number) => void
  dbOffset: number
  setDbOffset: (value: number) => void
  dbSortDirection: "asc" | "desc"
  setDbSortDirection: (value: "asc" | "desc") => void
  dbMissingOnly: boolean
  setDbMissingOnly: (value: boolean) => void
  dbSourceDraft: string
  setDbSourceDraft: (value: string) => void
  dbSourceFilter: string | undefined
  setDbSourceFilter: (value: string | undefined) => void
  dbBeforeDraft: string
  setDbBeforeDraft: (value: string) => void
  dbBeforeFilter: string | undefined
  setDbBeforeFilter: (value: string | undefined) => void
  dbAfterDraft: string
  setDbAfterDraft: (value: string) => void
  dbAfterFilter: string | undefined
  setDbAfterFilter: (value: string | undefined) => void
  cacheLimit: number
  setCacheLimit: (value: number) => void
  cacheOffset: number
  setCacheOffset: (value: number) => void
  cacheSourceDraft: string
  setCacheSourceDraft: (value: string) => void
  cacheSourceFilter: string | undefined
  setCacheSourceFilter: (value: string | undefined) => void
  frontendDebugMode: boolean
  cacheRefreshRunning: boolean
  setCacheRefreshRunning: (value: boolean) => void
  cacheRefreshMessage: string | undefined
  setCacheRefreshMessage: (value: string | undefined) => void
  cacheRefreshError: string | undefined
  setCacheRefreshError: (value: string | undefined) => void
  rssTestUrl: string
  setRssTestUrl: (value: string) => void
  rssTestResult: RssParserTestResult | undefined
  setRssTestResult: (value: RssParserTestResult | undefined) => void
  rssTestLoading: boolean
  setRssTestLoading: (value: boolean) => void
  articleTestUrl: string
  setArticleTestUrl: (value: string) => void
  articleTestResult: ArticleParserTestResult | undefined
  setArticleTestResult: (value: ArticleParserTestResult | undefined) => void
  articleTestLoading: boolean
  setArticleTestLoading: (value: boolean) => void
}

interface DebugDashboardRouter {
  replace: (href: string) => void
}

interface DebugDashboardSearchParams {
  get: (name: string) => string | null
  toString: () => string
}

interface DebugTabRefreshers {
  performance: () => void
  sources: () => void
  llm: () => void
  errors: () => void
}

interface DebugDashboardActions {
  loadData: () => void
  loadPerformanceData: () => void
  loadSystemStatus: () => void
  loadSourceData: () => void
  loadLlmLogs: () => void
  loadDebugErrors: () => void
  handleSetLogLevel: (level: string) => Promise<void>
  handleToggleFrontendDebug: () => void
  handleRefreshCache: () => Promise<void>
  handleTabChange: (value: string) => void
  applyDbFilters: () => void
  applyCacheFilters: () => void
  testRssParser: () => Promise<void>
  testArticleParser: () => Promise<void>
}

interface DebugQueryLoaders {
  loadData: () => void
  loadPerformanceData: () => void
  loadSystemStatus: () => void
  loadLogLevel: () => void
  loadSourceData: () => void
  loadLlmLogs: () => void
  loadDebugErrors: () => void
}

interface DebugDashboardData {
  chromaData: ChromaDebugResponse | undefined
  dbData: DatabaseDebugResponse | undefined
  driftData: StorageDriftReport | undefined
  startupMetrics: StartupMetricsResponse | undefined
  cacheData: CacheDebugResponse | undefined
  cacheDelta: CacheDeltaResponse | undefined
  systemStatus: SystemStatusResponse | undefined
  logLevel: string
  backendDebugReport: BackendDebugReport | undefined
  frontendPerfData: ReturnType<typeof exportDebugData> | undefined
  backendLogEvents: readonly DebugLogEventRecord[]
  backendSlowOps: readonly DebugSlowOperationRecord[]
  backendLogFiles: readonly DebugLogFileRecord[]
  sourceStats: readonly SourceStats[]
  cacheStatus: CacheStatus | undefined
  llmLogs: LlmLogResponse | undefined
  debugErrors: DebugErrorsResponse | undefined
}

interface DebugDashboardViewContext {
  activeTab: DebugTab
  embedded: boolean
  loading: boolean
  error: string | undefined
  data: DebugDashboardData
  state: DebugDashboardState
  actions: DebugDashboardActions
  startupEvents: StartupEventMetric[]
}

interface DebugCacheRefreshProgress {
  readonly message?: string
  readonly source?: string
  readonly articlesFromSource?: number
  readonly totalSourcesProcessed?: number
}

interface DebugParserActionContext<Result extends { error?: string }> {
  url: string
  requestUrl: string
  schema: z.ZodType<Result>
  setLoading: (value: boolean) => void
  setResult: (value: Result | undefined) => void
  setError: (message: string) => void
}

interface DebugDashboardActionContext {
  router: DebugDashboardRouter
  searchParams: DebugDashboardSearchParams
  state: DebugDashboardState
  queries: ReturnType<typeof useDebugQueries>
}

const ArticleParserResult = ({ result }: Readonly<{ result: ArticleParserTestResult }>) => {
  const candidates = result.candidates ?? []
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className={chooseValue(result.success === true, "text-green-600", "text-red-600")}>
          {chooseValue(result.success === true, "Found", "Not Found")}
        </span>
      </div>
      {result.image_url !== undefined && result.image_url !== "" && (
        <div className="space-y-2">
          <p className="text-sm break-all">{result.image_url}</p>
          <SafeImage src={result.image_url} alt="Preview" width={320} height={180} className="max-w-xs rounded border" />
        </div>
      )}
      {candidates.length > ZERO && (
        <div>
          <h4 className="font-medium text-sm mb-1">All Candidates</h4>
          <ul className="text-xs space-y-1">
            {candidates.map((candidate: ArticleCandidate) => (
              <li key={`${candidate.url ?? candidate.source ?? "candidate"}-${candidate.priority ?? "priority"}`} className="p-1 bg-muted rounded">
                [{candidate.priority}] {candidate.source}: {candidate.url?.slice(0, 60)}...
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.error !== undefined && result.error !== "" && (
        <p className="text-sm text-red-600">
          {getImageErrorLabel(result.error)}: {textOr(result.error_details, getImageErrorDetails(result.error))}
        </p>
      )}
    </div>
  )
},

ArticleParserCard = ({ articleTestUrl, setArticleTestUrl, articleTestResult, articleTestLoading, testArticleParser }: Readonly<{
  articleTestUrl: string; setArticleTestUrl: (value: string) => void; articleTestResult: ArticleParserTestResult | undefined; articleTestLoading: boolean; testArticleParser: () => void;
}>) => (
  <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Article Image Extractor</CardTitle>
      <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Test og:image extraction from article pages</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder="Enter article URL..." value={articleTestUrl} onChange={inputValueChange(setArticleTestUrl)} className="flex-1" />
        <Button onClick={testArticleParser} disabled={articleTestLoading}>
          {chooseValue(articleTestLoading, "Testing...", "Extract Image")}
        </Button>
      </div>
      {articleTestResult && <ArticleParserResult result={articleTestResult} />}
    </CardContent>
  </Card>
)
,

BackendEventsCard = ({ backendLogEvents }: Readonly<{ backendLogEvents: readonly DebugLogEventRecord[] }>) =>
  (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Recent Backend Events</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Last 100 debug events from the backend</CardDescription>
            </CardHeader>
            <CardContent>
              {chooseValue(backendLogEvents.length !== ZERO, (
                <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-xs">
                  {backendLogEvents.slice(0, 50).map((event) => (
                    <div key={`${event.timestamp ?? "event"}-${event.event_type ?? "type"}-${event.message ?? "message"}`} className="flex items-start gap-2 p-1 hover:bg-muted rounded">
                      <span className="text-muted-foreground w-20 flex-shrink-0">
                        {new Date(event.timestamp ?? "").toLocaleTimeString()}
                      </span>
                      <span className={`px-1 rounded text-xs flex-shrink-0 ${debugEventClassName(event.event_type)}`}>
                        {event.event_type ?? ""}
                      </span>
                      <span className="flex-1 truncate">{event.message ?? ""}</span>
                    </div>
                  ))}
                </div>
              ), (
                <p className="text-sm text-muted-foreground">No events logged yet</p>
              ))}
            </CardContent>
          </Card>

  )
,

CacheDeltaCard = ({ cacheDelta }: CacheDeltaCardProps) =>
  (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Cache vs database delta</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Compares the current cache window against Postgres</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <CacheDeltaMetrics cacheDelta={cacheDelta} />

              <div>
                <p className="text-xs text-muted-foreground mb-2">Missing cache URLs (sample)</p>
                <div className="max-h-40 overflow-auto rounded border border-border bg-muted/30 p-3 text-xs">
                  <CacheDeltaSample urls={cacheDelta?.missing_in_db_sample ?? []} />
                </div>
              </div>
            </CardContent>
          </Card>

  )
,

CacheDeltaMetrics = ({ cacheDelta }: CacheDeltaCardProps) => (
  <div className="grid gap-2 md:grid-cols-4">
    <div>
      <p className="text-muted-foreground">Cache total</p>
      <p className="text-lg font-semibold">{cacheDelta?.cache_total ?? "-"}</p>
    </div>
    <div>
      <p className="text-muted-foreground">Cache sampled</p>
      <p className="text-lg font-semibold">{cacheDelta?.cache_sampled ?? "-"}</p>
    </div>
    <div>
      <p className="text-muted-foreground">DB total</p>
      <p className="text-lg font-semibold">{cacheDelta?.db_total ?? "-"}</p>
    </div>
    <div>
      <p className="text-muted-foreground">Missing in DB</p>
      <p className="text-lg font-semibold">{cacheDelta?.missing_in_db_count ?? "-"}</p>
    </div>
  </div>
),

CacheDeltaSample = ({ urls }: Readonly<{ urls: readonly string[] }>) =>
  chooseValue(urls.length !== ZERO, (
    <ul className="space-y-1">
      {urls.map((url) => (
        <li key={url} className="break-all">{url}</li>
      ))}
    </ul>
  ), (
    <p className="text-muted-foreground">No missing URLs in sample.</p>
  )),

CacheSnapshotCard = ({
  cacheData,
  cacheLimit,
  setCacheLimit,
  cacheOffset,
  setCacheOffset,
}: Pick<StorageSnapshotSectionProps, "cacheData" | "cacheLimit" | "setCacheLimit" | "cacheOffset" | "setCacheOffset">) =>
  (
    <SnapshotCard title="Cache Snapshot">
      <p>Total cached: {cacheData?.total ?? "-"}</p>
      <p>Showing: {cacheData?.returned ?? "-"}</p>
      <SnapshotPagination
        limit={cacheLimit}
        onLimitChange={setCacheLimit}
        offset={cacheOffset}
        onOffsetChange={setCacheOffset}
      />
    </SnapshotCard>
  )
,

CachedArticlesCard = ({ cacheData }:Readonly< { cacheData: CacheDebugResponse | undefined }>) =>
  (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Cached articles</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Published</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cacheData?.articles?.map((article) => (
                    <TableRow key={debugArticleRowKey(article.id ?? article.link, article.link)}>
                      <TableCell>{article.source}</TableCell>
                      <TableCell>
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {article.title}
                        </a>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {chooseValue(article.published !== "", new Date(article.published).toLocaleString(), "-")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableCaption>
                  Showing {cacheData?.returned ?? 0} / {cacheData?.total ?? 0} cached
                </TableCaption>
              </Table>
            </CardContent>
          </Card>

  )
,

ChromaDocumentsCard = ({ chromaData }:Readonly< { chromaData: ChromaDebugResponse | undefined }>) =>
  (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Chroma documents</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chromaData?.articles.map((article) => (
                    <TableRow
                      key={debugArticleRowKey(
                        article.id,
                        formatMetadataValue(article.metadata?.source) ?? "unknown",
                      )}
                    >
                      <TableCell className="font-mono text-xs">{article.id}</TableCell>
                      <TableCell>{formatMetadataValue(article.metadata?.title) ?? "(no title)"}</TableCell>
                      <TableCell>{formatMetadataValue(article.metadata?.source) ?? "?"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{article.preview}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableCaption>
                  Showing {chromaData?.returned ?? 0} / {chromaData?.total ?? chromaData?.returned ?? 0} vectors
                </TableCaption>
              </Table>
            </CardContent>
          </Card>

  )
,

ChromaSnapshotCard = ({
  chromaData,
  chromaLimit,
  setChromaLimit,
  chromaOffset,
  setChromaOffset,
}: Pick<StorageSnapshotSectionProps, "chromaData" | "chromaLimit" | "setChromaLimit" | "chromaOffset" | "setChromaOffset">) =>
  (
    <SnapshotCard title="Chroma Snapshot">
      <p>Total vectors: {chromaData?.total ?? "-"}</p>
      <p>Showing: {chromaData?.returned ?? "-"}</p>
      <SnapshotPagination
        limit={chromaLimit}
        onLimitChange={setChromaLimit}
        offset={chromaOffset}
        onOffsetChange={setChromaOffset}
      />
    </SnapshotCard>
  )
,

ControlsSection = ({ logLevel, onSetLogLevel, frontendDebugMode, onToggleFrontendDebug }: ControlsSectionProps) =>
  (
<TabsContent value="controls" className="space-y-4">
          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Backend Log Level</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Change runtime log verbosity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="text-sm">Current level:</span>
                <Select value={logLevel} onValueChange={onSetLogLevel}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEBUG">DEBUG</SelectItem>
                    <SelectItem value="INFO">INFO</SelectItem>
                    <SelectItem value="WARNING">WARNING</SelectItem>
                    <SelectItem value="ERROR">ERROR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Changes are applied immediately to all backend loggers.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Frontend Debug Mode</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Toggle verbose frontend logging</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={frontendDebugMode}
                    onChange={onToggleFrontendDebug}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Enable debug mode</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                When enabled, detailed logs will appear in the browser console.
                Stored in localStorage as <code>thesis_debug_mode</code>.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

  )
,

DEBUG_OPTIONAL_SCHEMAS = {
  boolean: z.boolean().optional(),
  number: z.number().optional(),
  string: z.string().optional(),
},

DEBUG_SCHEMA_BASE = {
  articleCandidate: z.object({
    priority: DEBUG_OPTIONAL_SCHEMAS.number,
    source: DEBUG_OPTIONAL_SCHEMAS.string,
    url: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  backendDebugSummary: z.object({
    errors: DEBUG_OPTIONAL_SCHEMAS.number,
    slow_operations: DEBUG_OPTIONAL_SCHEMAS.number,
    total_events: DEBUG_OPTIONAL_SCHEMAS.number,
  }),
  debugActiveStream: z.object({
    duration_so_far: DEBUG_OPTIONAL_SCHEMAS.number,
    request_path: DEBUG_OPTIONAL_SCHEMAS.string,
    stream_id: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  debugLogEvent: z.object({
    event_type: DEBUG_OPTIONAL_SCHEMAS.string,
    message: DEBUG_OPTIONAL_SCHEMAS.string,
    timestamp: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  debugLogFile: z.object({
    created: DEBUG_OPTIONAL_SCHEMAS.string,
    filename: DEBUG_OPTIONAL_SCHEMAS.string,
    modified: DEBUG_OPTIONAL_SCHEMAS.string,
    size_bytes: DEBUG_OPTIONAL_SCHEMAS.number,
    size_kb: DEBUG_OPTIONAL_SCHEMAS.number,
  }),
  debugSlowOperation: z.object({
    duration_ms: DEBUG_OPTIONAL_SCHEMAS.number,
    event_type: DEBUG_OPTIONAL_SCHEMAS.string,
    request_id: DEBUG_OPTIONAL_SCHEMAS.string,
    stream_id: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  feedInfo: z.object({ title: DEBUG_OPTIONAL_SCHEMAS.string }),
  imageExtraction: z.object({
    image_error: DEBUG_OPTIONAL_SCHEMAS.string,
    image_error_details: DEBUG_OPTIONAL_SCHEMAS.string,
    image_url: DEBUG_OPTIONAL_SCHEMAS.string,
    selected_source: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  pipelineFetch: z.object({
    errors: DEBUG_OPTIONAL_SCHEMAS.number,
    not_modified: DEBUG_OPTIONAL_SCHEMAS.number,
  }),
  rssStatus: z.object({ entries_count: DEBUG_OPTIONAL_SCHEMAS.number }),
  systemCache: z.object({
    age_seconds: DEBUG_OPTIONAL_SCHEMAS.number,
    article_count: DEBUG_OPTIONAL_SCHEMAS.number,
    healthy: DEBUG_OPTIONAL_SCHEMAS.boolean,
    incremental_enabled: DEBUG_OPTIONAL_SCHEMAS.boolean,
    last_updated: DEBUG_OPTIONAL_SCHEMAS.string,
    sources_tracked: DEBUG_OPTIONAL_SCHEMAS.number,
    update_count: DEBUG_OPTIONAL_SCHEMAS.number,
    update_in_progress: DEBUG_OPTIONAL_SCHEMAS.boolean,
  }),
  systemRuntime: z.object({
    pid: DEBUG_OPTIONAL_SCHEMAS.number,
    platform: DEBUG_OPTIONAL_SCHEMAS.string,
    python_version: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
},

DEBUG_SCHEMA_COMPOSITES = {
  rssSampleEntry: z.object({
    image_extraction: DEBUG_SCHEMA_BASE.imageExtraction.optional(),
    title: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  systemComponents: z.object({
    cache: DEBUG_SCHEMA_BASE.systemCache.optional(),
    database: z.object({ healthy: DEBUG_OPTIONAL_SCHEMAS.boolean }).optional(),
    embedding_queue: z.object({
      batch_size: DEBUG_OPTIONAL_SCHEMAS.number,
      depth: DEBUG_OPTIONAL_SCHEMAS.number,
      max_per_minute: DEBUG_OPTIONAL_SCHEMAS.number,
    }).optional(),
    vector_store: z.object({ healthy: DEBUG_OPTIONAL_SCHEMAS.boolean }).optional(),
  }),
  systemPipeline: z.object({ fetch: DEBUG_SCHEMA_BASE.pipelineFetch.optional() }),
},

DEBUG_SCHEMAS = {
  articleParserTestResult: z.object({
    candidates: z.array(DEBUG_SCHEMA_BASE.articleCandidate).optional(),
    error: DEBUG_OPTIONAL_SCHEMAS.string,
    error_details: DEBUG_OPTIONAL_SCHEMAS.string,
    image_url: DEBUG_OPTIONAL_SCHEMAS.string,
    success: DEBUG_OPTIONAL_SCHEMAS.boolean,
  }),
  backendDebugReport: z.object({
    active_streams: z.array(DEBUG_SCHEMA_BASE.debugActiveStream).optional(),
    generated_at: DEBUG_OPTIONAL_SCHEMAS.string,
    recommendations: z.array(z.string()).optional(),
    summary: DEBUG_SCHEMA_BASE.backendDebugSummary.optional(),
  }),
  debugLogEvents: z.object({
    events: z.array(DEBUG_SCHEMA_BASE.debugLogEvent).optional(),
  }),
  debugLogFiles: z.object({
    files: z.array(DEBUG_SCHEMA_BASE.debugLogFile).optional(),
  }),
  debugSlowOperations: z.object({
    operations: z.array(DEBUG_SCHEMA_BASE.debugSlowOperation).optional(),
  }),
  logLevel: z.object({ level: DEBUG_OPTIONAL_SCHEMAS.string }),
  rssParserTestResult: z.object({
    error: DEBUG_OPTIONAL_SCHEMAS.string,
    feed_info: DEBUG_SCHEMA_BASE.feedInfo.optional(),
    parse_time_seconds: DEBUG_OPTIONAL_SCHEMAS.number,
    sample_entries: z.array(DEBUG_SCHEMA_COMPOSITES.rssSampleEntry).optional(),
    status: DEBUG_SCHEMA_BASE.rssStatus.optional(),
    success: DEBUG_OPTIONAL_SCHEMAS.boolean,
  }),
  systemStatus: z.object({
    components: DEBUG_SCHEMA_COMPOSITES.systemComponents.optional(),
    pipeline: DEBUG_SCHEMA_COMPOSITES.systemPipeline.optional(),
    runtime: DEBUG_SCHEMA_BASE.systemRuntime.optional(),
  }),
},

DEBUG_TABS = [
  "system",
  "sources",
  "storage",
  "parser",
  "controls",
  "llm",
  "errors",
  "performance",
] as const,

DEBUG_DEFAULT_OFFSET = 0,

DEBUG_DEFAULT_PAGE_SIZE = 25,

DEBUG_DRIFT_SAMPLE_LIMIT = 20,

DEBUG_MAX_DATABASE_PAGE_SIZE = 200,

DEBUG_MAX_OFFSET = 5000,

DEBUG_MAX_PAGE_SIZE = 500,

DEBUG_MIN_PAGE_SIZE = 5,

DEBUG_PARSER_SAMPLE_LIMIT = 5,

DEFAULT_DEBUG_TAB: DebugTab = "storage",

formatDatabaseSnapshotDate = (value?: string | null): string => {
  if (value === undefined || value === null || value === "") {
    return "?"
  }
  return new Date(value).toLocaleString()
},

DatabaseSnapshotRange = ({ dbData }: Pick<StorageSnapshotSectionProps, "dbData">) => (
  <p>
    Range: {formatDatabaseSnapshotDate(dbData?.oldest_published)} → {formatDatabaseSnapshotDate(dbData?.newest_published)}
  </p>
),

DatabaseSnapshotControls = ({
  dbLimit,
  dbMissingOnly,
  dbOffset,
  dbSortDirection,
  setDbLimit,
  setDbMissingOnly,
  setDbOffset,
  setDbSortDirection,
}: Pick<StorageSnapshotSectionProps, "dbLimit" | "dbMissingOnly" | "dbOffset" | "dbSortDirection" | "setDbLimit" | "setDbMissingOnly" | "setDbOffset" | "setDbSortDirection">) => (
  <div className="flex flex-wrap gap-2 text-sm">
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={dbMissingOnly} onChange={(event) => {setDbMissingOnly(event.target.checked)}} />
      Missing embeddings only
    </label>
    <Select value={dbSortDirection} onValueChange={setDbSortDirection}>
      <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="desc">Newest first</SelectItem>
        <SelectItem value="asc">Oldest first</SelectItem>
      </SelectContent>
    </Select>
    <Input type="number" className="w-24" value={dbOffset} onChange={(event) => {setDbOffset(Number(event.target.value))}} placeholder="Offset" />
    <Input type="number" className="w-24" value={dbLimit} onChange={(event) => {setDbLimit(Number(event.target.value))}} placeholder="Limit" />
  </div>
),

DatabaseSnapshotCard = (props: Pick<StorageSnapshotSectionProps, "dbData" | "dbLimit" | "setDbLimit" | "dbOffset" | "setDbOffset" | "dbSortDirection" | "setDbSortDirection" | "dbMissingOnly" | "setDbMissingOnly">) => (
  <SnapshotCard title="Database Snapshot">
    <p>Total rows: {props.dbData?.total ?? "-"}</p>
    <p>Showing: {props.dbData?.returned ?? "-"}</p>
    <DatabaseSnapshotRange dbData={props.dbData} />
    <DatabaseSnapshotControls
      dbLimit={props.dbLimit}
      dbMissingOnly={props.dbMissingOnly}
      dbOffset={props.dbOffset}
      dbSortDirection={props.dbSortDirection}
      setDbLimit={props.setDbLimit}
      setDbMissingOnly={props.setDbMissingOnly}
      setDbOffset={props.setDbOffset}
      setDbSortDirection={props.setDbSortDirection}
    />
  </SnapshotCard>
),

DebugDashboardContent = ({
  embedded,
  loading,
  error,
  activeTab,
  onTabChange,
  onRefresh,
  system,
  sources,
  storage,
  parser,
  controls,
  llm,
  errors,
  performance,
}: DebugDashboardContentProps) =>
  (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      {!embedded && <GlobalNavigation />}
      <div className={`flex-1 overflow-y-auto relative z-10 custom-scrollbar ${chooseValue(embedded, "p-4", "p-6")}`}>
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
        <div className="space-y-6">
          {!embedded && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold font-serif">Debug Console</h1>
                <p className="text-sm text-muted-foreground">
                  System status, source operations, storage inspection, parser testing, and runtime controls.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {loading && <span className="text-sm text-muted-foreground">Refreshing...</span>}
                <Button asChild variant="outline">
                  <Link href="/wiki/ownership">Open Wiki</Link>
                </Button>
                <Button onClick={onRefresh} variant="default">
                  Refresh data
                </Button>
              </div>
            </div>
          )}
          {error && (
            <Card className="border-red-500/30 bg-red-500/10 bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
            </Card>
          )}
          <Tabs value={activeTab} onValueChange={onTabChange}>
            <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8">
              <TabsTrigger value="system">System</TabsTrigger>
              <TabsTrigger value="sources">Sources</TabsTrigger>
              <TabsTrigger value="storage">Storage</TabsTrigger>
              <TabsTrigger value="parser">Parser Tester</TabsTrigger>
              <TabsTrigger value="controls">Controls</TabsTrigger>
              <TabsTrigger value="llm">LLM Calls</TabsTrigger>
              <TabsTrigger value="errors">Errors</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
            </TabsList>
            <SystemStatusSection
              systemStatus={system.systemStatus}
              startupMetrics={system.startupMetrics}
              startupEvents={system.startupEvents}
              onRefreshStatus={system.onRefreshStatus}
            />
            <SourcesSection
              sourceStats={sources.sourceStats}
              cacheStatus={sources.cacheStatus}
              cacheRefreshMessage={sources.cacheRefreshMessage}
              cacheRefreshError={sources.cacheRefreshError}
              cacheRefreshRunning={sources.cacheRefreshRunning}
              onRefresh={sources.onRefresh}
              onRefreshCache={sources.onRefreshCache}
            />
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
              onApplyCacheFilters={storage.onApplyCacheFilters}
              onApplyDbFilters={storage.onApplyDbFilters}
            />
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
            <ControlsSection
              logLevel={controls.logLevel}
              onSetLogLevel={controls.onSetLogLevel}
              frontendDebugMode={controls.frontendDebugMode}
              onToggleFrontendDebug={controls.onToggleFrontendDebug}
            />
            <LlmSection llmLogs={llm.llmLogs} onRefresh={llm.onRefresh} />
            <ErrorsSection debugErrors={errors.debugErrors} onRefresh={errors.onRefresh} />
            <PerformanceSection
              backendDebugReport={performance.backendDebugReport}
              backendLogEvents={performance.backendLogEvents}
              backendSlowOps={performance.backendSlowOps}
              backendLogFiles={performance.backendLogFiles}
              frontendPerfData={performance.frontendPerfData}
              onRefresh={performance.onRefresh}
            />
          </Tabs>
        </div>
      </div>
    </div>
  )
,

useChromaDebugState = () => {
  const [chromaLimit, setChromaLimit] = usePersistentNumber(
      DEBUG_DEFAULT_PAGE_SIZE,
      DEBUG_MIN_PAGE_SIZE,
      DEBUG_MAX_PAGE_SIZE,
    ),
    [chromaOffset, setChromaOffset] = usePersistentNumber(
      DEBUG_DEFAULT_OFFSET,
      DEBUG_DEFAULT_OFFSET,
      DEBUG_MAX_OFFSET,
    )
  return {
    chromaLimit,
    chromaOffset,
    setChromaLimit,
    setChromaOffset,
  }
},

useDatabaseDebugState = () => {
  const [dbLimit, setDbLimit] = usePersistentNumber(
      DEBUG_DEFAULT_PAGE_SIZE,
      DEBUG_MIN_PAGE_SIZE,
      DEBUG_MAX_DATABASE_PAGE_SIZE,
    ),
    [dbOffset, setDbOffset] = usePersistentNumber(
      DEBUG_DEFAULT_OFFSET,
      DEBUG_DEFAULT_OFFSET,
      DEBUG_MAX_OFFSET,
    ),
    [dbSortDirection, setDbSortDirection] = useState<"asc" | "desc">("desc"),
    [dbMissingOnly, setDbMissingOnly] = useState(false),
    [dbSourceDraft, setDbSourceDraft] = useState(""),
    [dbSourceFilter, setDbSourceFilter] = useState<string | undefined>(),
    [dbBeforeDraft, setDbBeforeDraft] = useState(""),
    [dbBeforeFilter, setDbBeforeFilter] = useState<string | undefined>(),
    [dbAfterDraft, setDbAfterDraft] = useState(""),
    [dbAfterFilter, setDbAfterFilter] = useState<string | undefined>()

  return {
    dbAfterDraft,
    dbAfterFilter,
    dbBeforeDraft,
    dbBeforeFilter,
    dbLimit,
    dbMissingOnly,
    dbOffset,
    dbSortDirection,
    dbSourceDraft,
    dbSourceFilter,
    setDbAfterDraft,
    setDbAfterFilter,
    setDbBeforeDraft,
    setDbBeforeFilter,
    setDbLimit,
    setDbMissingOnly,
    setDbOffset,
    setDbSortDirection,
    setDbSourceDraft,
    setDbSourceFilter,
  }
},

useCacheDebugState = () => {
  const [cacheLimit, setCacheLimit] = usePersistentNumber(
      DEBUG_DEFAULT_PAGE_SIZE,
      DEBUG_MIN_PAGE_SIZE,
      DEBUG_MAX_PAGE_SIZE,
    ),
    [cacheOffset, setCacheOffset] = usePersistentNumber(
      DEBUG_DEFAULT_OFFSET,
      DEBUG_DEFAULT_OFFSET,
      DEBUG_MAX_OFFSET,
    ),
    [cacheSourceDraft, setCacheSourceDraft] = useState(""),
    [cacheSourceFilter, setCacheSourceFilter] = useState<string | undefined>()

  return {
    cacheLimit,
    cacheOffset,
    cacheSourceDraft,
    cacheSourceFilter,
    setCacheLimit,
    setCacheOffset,
    setCacheSourceDraft,
    setCacheSourceFilter,
  }
},

useStorageDebugState = () => ({
  ...useChromaDebugState(),
  ...useDatabaseDebugState(),
  ...useCacheDebugState(),
}),

useCacheRefreshState = () => {
  const frontendDebugMode = useDebugMode(),
    [cacheRefreshRunning, setCacheRefreshRunning] = useState(false),
    [cacheRefreshMessage, setCacheRefreshMessage] = useState<string | undefined>(),
    [cacheRefreshError, setCacheRefreshError] = useState<string | undefined>()

  return {
    cacheRefreshError,
    cacheRefreshMessage,
    cacheRefreshRunning,
    frontendDebugMode,
    setCacheRefreshError,
    setCacheRefreshMessage,
    setCacheRefreshRunning,
  }
},

useParserDebugState = () => {
  const [rssTestUrl, setRssTestUrl] = useState(""),
    [rssTestResult, setRssTestResult] = useState<RssParserTestResult | undefined>(),
    [rssTestLoading, setRssTestLoading] = useState(false),
    [articleTestUrl, setArticleTestUrl] = useState(""),
    [articleTestResult, setArticleTestResult] = useState<ArticleParserTestResult | undefined>(),
    [articleTestLoading, setArticleTestLoading] = useState(false)

  return {
    articleTestLoading,
    articleTestResult,
    articleTestUrl,
    rssTestLoading,
    rssTestResult,
    rssTestUrl,
    setArticleTestLoading,
    setArticleTestResult,
    setArticleTestUrl,
    setRssTestLoading,
    setRssTestResult,
    setRssTestUrl,
  }
},

useDebugDashboardState = (): DebugDashboardState => ({
  ...useStorageDebugState(),
  ...useCacheRefreshState(),
  ...useParserDebugState(),
}),

getDebugErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.message
  }
  return undefined
},

getDebugTimestamp = (value?: string): number => {
  if (value === undefined || value === "") {
    return DEBUG_DEFAULT_OFFSET
  }
  return new Date(value).getTime()
},

sortStartupEvents = (startupMetrics: StartupMetricsResponse | undefined): StartupEventMetric[] => {
  if (startupMetrics?.events === undefined || startupMetrics.events.length === ZERO) {
    return []
  }
  return startupMetrics.events.toSorted(
    (firstEvent, secondEvent) =>
      getDebugTimestamp(firstEvent.startedAt ?? undefined) -
      getDebugTimestamp(secondEvent.startedAt ?? undefined),
  )
},

getCacheRefreshMessage = (event: DebugCacheRefreshProgress): string => {
  if (event.message) {
    return event.message
  }
  if (event.source) {
    if (event.articlesFromSource === undefined) {
      return `Processed ${event.source}`
    }
    return `Processed ${event.source} · ${event.articlesFromSource} articles`
  }
  if (event.totalSourcesProcessed === undefined) {
    return "Refreshing cache..."
  }
  return `Processed ${event.totalSourcesProcessed} sources`
},

refreshDebugTab = (value: DebugTab, refreshers: DebugTabRefreshers): void => {
  switch (value) {
    case "performance": {
      refreshers.performance()
      break
    }
    case "sources": {
      refreshers.sources()
      break
    }
    case "llm": {
      refreshers.llm()
      break
    }
    case "errors": {
      refreshers.errors()
      break
    }
    default: {
      break
    }
  }
},

createLogLevelHandler = (loadLogLevel: () => void): ((level: string) => Promise<void>) =>
  async (level: string): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/debug/loglevel?level=${level}`, {
        method: "POST",
      })
      if (response.ok) {
        loadLogLevel()
      }
    } catch (caughtError) {
      logger.error("Failed to set log level", caughtError)
    }
  },

createCacheRefreshHandler = ({
  loadSourceData,
  loadSystemStatus,
  setCacheRefreshError,
  setCacheRefreshMessage,
  setCacheRefreshRunning,
}: Pick<DebugDashboardState, "setCacheRefreshError" | "setCacheRefreshMessage" | "setCacheRefreshRunning"> & {
  loadSourceData: () => void
  loadSystemStatus: () => void
}): (() => Promise<void>) =>
  async (): Promise<void> => {
    setCacheRefreshRunning(true)
    setCacheRefreshError(undefined)
    setCacheRefreshMessage("Starting cache refresh...")
    try {
      const success = await refreshCache((event) => {
        setCacheRefreshMessage(getCacheRefreshMessage(event))
      })
      if (!success) {
        throw new Error("Cache refresh did not complete successfully.")
      }
      setCacheRefreshMessage("Cache refresh completed.")
      loadSourceData()
      loadSystemStatus()
    } catch (caughtError) {
      setCacheRefreshError(getDebugErrorMessage(caughtError) ?? "Cache refresh failed.")
      setCacheRefreshMessage(undefined)
    } finally {
      setCacheRefreshRunning(false)
    }
  },

createParserTestHandler = <Result extends { error?: string }>({
  requestUrl,
  schema,
  setError,
  setLoading,
  setResult,
  url,
}: DebugParserActionContext<Result>): (() => Promise<void>) =>
  async (): Promise<void> => {
    if (!url.trim()) {
      return
    }
    setLoading(true)
    setResult(undefined)
    try {
      const response = await fetch(requestUrl, { method: "POST" }),
       data = await parseDebugResponse(response, schema)
      setResult(data)
    } catch (caughtError) {
      setError(getDebugErrorMessage(caughtError) ?? "Test failed")
    } finally {
      setLoading(false)
    }
  },

createTabChangeHandler = ({
  loadDebugErrors,
  loadLlmLogs,
  loadPerformanceData,
  loadSourceData,
  router,
  searchParams,
}: {
  loadDebugErrors: () => void
  loadLlmLogs: () => void
  loadPerformanceData: () => void
  loadSourceData: () => void
  router: DebugDashboardRouter
  searchParams: DebugDashboardSearchParams
}): ((value: string) => void) => (value: string): void => {
  if (!isDebugTab(value)) {
    return
  }
  const nextParams = new URLSearchParams(searchParams.toString())
  nextParams.set("tab", value)
  router.replace(`/debug?${nextParams.toString()}`)
  refreshDebugTab(value, {
    errors: loadDebugErrors,
    llm: loadLlmLogs,
    performance: loadPerformanceData,
    sources: loadSourceData,
  })
},

selectDebugDashboardData = (queries: ReturnType<typeof useDebugQueries>): DebugDashboardData => {
  const {
    cacheStatusQuery,
    dashboardDataQuery,
    debugErrorsQuery,
    llmLogsQuery,
    logLevelQuery,
    performanceDataQuery,
    sourceStatsQuery,
    systemStatusQuery,
  } = queries
  return {
    backendDebugReport: pickData(performanceDataQuery.data, "backendDebugReport"),
    backendLogEvents: pickDataOr(performanceDataQuery.data, "backendLogEvents", []),
    backendLogFiles: pickDataOr(performanceDataQuery.data, "backendLogFiles", []),
    backendSlowOps: pickDataOr(performanceDataQuery.data, "backendSlowOps", []),
    cacheData: pickData(dashboardDataQuery.data, "cacheData"),
    cacheDelta: pickData(dashboardDataQuery.data, "cacheDelta"),
    cacheStatus: cacheStatusQuery.data ?? undefined,
    chromaData: pickData(dashboardDataQuery.data, "chromaData"),
    dbData: pickData(dashboardDataQuery.data, "dbData"),
    debugErrors: debugErrorsQuery.data ?? undefined,
    driftData: pickData(dashboardDataQuery.data, "driftData"),
    frontendPerfData: pickData(performanceDataQuery.data, "frontendPerfData"),
    llmLogs: llmLogsQuery.data ?? undefined,
    logLevel: logLevelQuery.data?.level ?? "INFO",
    sourceStats: sourceStatsQuery.data ?? [],
    startupMetrics: pickData(dashboardDataQuery.data, "startupMetrics"),
    systemStatus: systemStatusQuery.data ?? undefined,
  }
},

createDebugQueryLoaders = (queries: ReturnType<typeof useDebugQueries>): DebugQueryLoaders => {
  const {
    cacheStatusQuery,
    dashboardDataQuery,
    debugErrorsQuery,
    llmLogsQuery,
    logLevelQuery,
    performanceDataQuery,
    sourceStatsQuery,
    systemStatusQuery,
  } = queries
  return {
    loadData: () => { void dashboardDataQuery.refetch() },
    loadDebugErrors: () => { void debugErrorsQuery.refetch() },
    loadLlmLogs: () => { void llmLogsQuery.refetch() },
    loadLogLevel: () => { void logLevelQuery.refetch() },
    loadPerformanceData: () => { void performanceDataQuery.refetch() },
    loadSourceData: () => {
      void sourceStatsQuery.refetch()
      void cacheStatusQuery.refetch()
    },
    loadSystemStatus: () => { void systemStatusQuery.refetch() },
  }
},

createDebugFilterActions = (state: Readonly<DebugDashboardState>): Pick<DebugDashboardActions, "applyCacheFilters" | "applyDbFilters"> => ({
  applyCacheFilters: () => {
    state.setCacheSourceFilter(state.cacheSourceDraft.trim() || undefined)
  },
  applyDbFilters: () => {
    state.setDbSourceFilter(state.dbSourceDraft.trim() || undefined)
    state.setDbBeforeFilter(state.dbBeforeDraft || undefined)
    state.setDbAfterFilter(state.dbAfterDraft || undefined)
  },
}),

createDebugDashboardHandlers = ({
  loaders,
  router,
  searchParams,
  state,
}: Readonly<{
  loaders: DebugQueryLoaders
  router: DebugDashboardRouter
  searchParams: DebugDashboardSearchParams
  state: DebugDashboardState
}>): Pick<DebugDashboardActions, "handleRefreshCache" | "handleSetLogLevel" | "handleTabChange" | "handleToggleFrontendDebug"> => ({
  handleRefreshCache: createCacheRefreshHandler({
    loadSourceData: loaders.loadSourceData,
    loadSystemStatus: loaders.loadSystemStatus,
    setCacheRefreshError: state.setCacheRefreshError,
    setCacheRefreshMessage: state.setCacheRefreshMessage,
    setCacheRefreshRunning: state.setCacheRefreshRunning,
  }),
  handleSetLogLevel: createLogLevelHandler(loaders.loadLogLevel),
  handleTabChange: createTabChangeHandler({
    loadDebugErrors: loaders.loadDebugErrors,
    loadLlmLogs: loaders.loadLlmLogs,
    loadPerformanceData: loaders.loadPerformanceData,
    loadSourceData: loaders.loadSourceData,
    router,
    searchParams,
  }),
  handleToggleFrontendDebug: () => {
    setDebugMode(!state.frontendDebugMode)
  },
}),

createDebugParserActions = (state: Readonly<DebugDashboardState>): Pick<DebugDashboardActions, "testArticleParser" | "testRssParser"> => ({
  testArticleParser: createParserTestHandler({
    requestUrl: `${API_BASE_URL}/debug/parser/test/article?url=${encodeURIComponent(state.articleTestUrl)}`,
    schema: DEBUG_SCHEMAS.articleParserTestResult,
    setError: (message) =>{  state.setArticleTestResult({ error: message }); },
    setLoading: state.setArticleTestLoading,
    setResult: state.setArticleTestResult,
    url: state.articleTestUrl,
  }),
  testRssParser: createParserTestHandler({
    requestUrl: `${API_BASE_URL}/debug/parser/test/rss?url=${encodeURIComponent(state.rssTestUrl)}&max_entries=${DEBUG_PARSER_SAMPLE_LIMIT}`,
    schema: DEBUG_SCHEMAS.rssParserTestResult,
    setError: (message) =>{  state.setRssTestResult({ error: message }); },
    setLoading: state.setRssTestLoading,
    setResult: state.setRssTestResult,
    url: state.rssTestUrl,
  }),
}),

useDebugDashboardActions = ({
  queries,
  router,
  searchParams,
  state,
}: DebugDashboardActionContext): DebugDashboardActions => {
  const loaders = createDebugQueryLoaders(queries),
    filters = createDebugFilterActions(state),
    handlers = createDebugDashboardHandlers({ loaders, router, searchParams, state }),
    parserActions = createDebugParserActions(state)
  return {
    ...filters,
    ...handlers,
    loadData: loaders.loadData,
    loadDebugErrors: loaders.loadDebugErrors,
    loadLlmLogs: loaders.loadLlmLogs,
    loadPerformanceData: loaders.loadPerformanceData,
    loadSourceData: loaders.loadSourceData,
    loadSystemStatus: loaders.loadSystemStatus,
    ...parserActions,
  }
},

createDebugDashboardProps = ({
  activeTab,
  actions,
  data,
  embedded,
  error,
  loading,
  startupEvents,
  state,
}: DebugDashboardViewContext): DebugDashboardContentProps => ({
  activeTab,
  controls: {
    frontendDebugMode: state.frontendDebugMode,
    logLevel: data.logLevel,
    onSetLogLevel: actions.handleSetLogLevel,
    onToggleFrontendDebug: actions.handleToggleFrontendDebug,
  },
  embedded,
  error,
  errors: { debugErrors: data.debugErrors, onRefresh: actions.loadDebugErrors },
  llm: { llmLogs: data.llmLogs, onRefresh: actions.loadLlmLogs },
  loading,
  onRefresh: actions.loadData,
  onTabChange: actions.handleTabChange,
  parser: {
    articleTestLoading: state.articleTestLoading,
    articleTestResult: state.articleTestResult,
    articleTestUrl: state.articleTestUrl,
    rssTestLoading: state.rssTestLoading,
    rssTestResult: state.rssTestResult,
    rssTestUrl: state.rssTestUrl,
    setArticleTestUrl: state.setArticleTestUrl,
    setRssTestUrl: state.setRssTestUrl,
    testArticleParser: actions.testArticleParser,
    testRssParser: actions.testRssParser,
  },
  performance: {
    backendDebugReport: data.backendDebugReport,
    backendLogEvents: data.backendLogEvents,
    backendLogFiles: data.backendLogFiles,
    backendSlowOps: data.backendSlowOps,
    frontendPerfData: data.frontendPerfData,
    onRefresh: actions.loadPerformanceData,
  },
  sources: {
    cacheRefreshError: state.cacheRefreshError,
    cacheRefreshMessage: state.cacheRefreshMessage,
    cacheRefreshRunning: state.cacheRefreshRunning,
    cacheStatus: data.cacheStatus,
    onRefresh: actions.loadSourceData,
    onRefreshCache: actions.handleRefreshCache,
    sourceStats: data.sourceStats,
  },
  storage: {
    cacheData: data.cacheData,
    cacheDelta: data.cacheDelta,
    cacheLimit: state.cacheLimit,
    cacheOffset: state.cacheOffset,
    cacheSourceDraft: state.cacheSourceDraft,
    chromaData: data.chromaData,
    chromaLimit: state.chromaLimit,
    chromaOffset: state.chromaOffset,
    dbAfterDraft: state.dbAfterDraft,
    dbBeforeDraft: state.dbBeforeDraft,
    dbData: data.dbData,
    dbLimit: state.dbLimit,
    dbMissingOnly: state.dbMissingOnly,
    dbOffset: state.dbOffset,
    dbSortDirection: state.dbSortDirection,
    dbSourceDraft: state.dbSourceDraft,
    driftData: data.driftData,
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
    startupMetrics: data.startupMetrics,
  },
  system: {
    onRefreshStatus: actions.loadSystemStatus,
    startupEvents,
    startupMetrics: data.startupMetrics,
    systemStatus: data.systemStatus,
  },
}),

createDebugQueryOptions = (activeTab: DebugTab, state: Readonly<DebugDashboardState>): DebugQueryOptions => ({
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
}),

DebugDashboardController = () => {
  const router = useRouter(),
   searchParams = useSearchParams(),
   activeTabParam = searchParams.get("tab"),
   activeTab = isDebugTab(activeTabParam) ? activeTabParam : DEFAULT_DEBUG_TAB,
   embedded = searchParams.get("embedded") === "1",
   state = useDebugDashboardState(),
   debugQueries = useDebugQueries(createDebugQueryOptions(activeTab, state)),
  actions = useDebugDashboardActions({
    queries: debugQueries,
    router,
    searchParams,
    state,
  }),
  data = selectDebugDashboardData(debugQueries),
  startupEvents = useMemo(() => sortStartupEvents(data.startupMetrics), [data.startupMetrics]),
  viewProps = createDebugDashboardProps({
    actions,
    activeTab,
    data,
    embedded,
    error: getDebugErrorMessage(debugQueries.dashboardDataQuery.error),
    loading: debugQueries.dashboardDataQuery.isLoading,
    startupEvents,
    state,
  })











  return <DebugDashboardContent {...viewProps} />
},

DriftMissingSamples = ({ entries }: Readonly<{
  entries: NonNullable<StorageDriftReport["missing_in_chroma"]>
}>) => (
  <div>
    <h3 className="mb-2 text-sm font-semibold">Articles missing in Chroma</h3>
    <ul className="space-y-1 text-xs">
      {entries.length > ZERO ? entries.map((entry) => (
        <li key={debugArticleRowKey(entry.id, entry.chroma_id || "missing")} className="rounded bg-muted p-2">
          #{entry.id} - {entry.chroma_id || "(no chroma id)"}
        </li>
      )) : <li className="text-muted-foreground">No gaps detected.</li>}
    </ul>
  </div>
),

DriftDanglingSamples = ({ ids }: Readonly<{
  ids: NonNullable<StorageDriftReport["dangling_in_chroma"]>
}>) => (
  <div>
    <h3 className="mb-2 text-sm font-semibold">Dangling Chroma IDs</h3>
    <ul className="space-y-1 text-xs">
      {ids.length > ZERO ? ids.map((chromaId) => (
        <li key={chromaId} className="rounded bg-muted p-2 font-mono">{chromaId}</li>
      )) : <li className="text-muted-foreground">No extra vectors detected.</li>}
    </ul>
  </div>
),

DriftSamplesCard = ({ driftData }: Readonly<{ driftData: StorageDriftReport | undefined }>) => {
  const missingSamples = driftData?.missing_in_chroma?.slice(0, DEBUG_DRIFT_SAMPLE_LIMIT) ?? [],
    danglingSamples = driftData?.dangling_in_chroma?.slice(0, DEBUG_DRIFT_SAMPLE_LIMIT) ?? []
  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader><CardTitle className="font-serif">Drift samples</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <DriftMissingSamples entries={missingSamples} />
        <DriftDanglingSamples ids={danglingSamples} />
      </CardContent>
    </Card>
  )
},

getErrorSummaryValues = (debugErrors: DebugErrorsResponse | undefined) => {
  if (debugErrors === undefined) {
    return {
      description: "Session error log file not available.",
      logged: ZERO,
      recent: ZERO,
      showing: ZERO,
    }
  }

  const { log_file: logFile, recent_request_stream_errors: recentRequestStreamErrors } = debugErrors
  return {
    description: logFile.available
      ? `${logFile.total} API errors logged`
      : "Session error log file not available.",
    logged: logFile.total ?? ZERO,
    recent: debugErrors.returned_recent_errors ?? ZERO,
    showing: logFile.entries.length + recentRequestStreamErrors.length,
  }
},

getDebugErrorKey = (prefix: string, entry: DebugErrorEntry): string =>
  `${prefix}-${entry.request_id ?? entry.timestamp ?? entry.error_message ?? entry.message ?? entry.service ?? entry.component ?? "error"}`,

ErrorSummaryCard = ({ debugErrors }: Pick<ErrorsSectionProps, "debugErrors">) => {
  const summary = getErrorSummaryValues(debugErrors)
  return (
  <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Error Summary</CardTitle>
      <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
        {summary.description}
      </CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4 md:grid-cols-3">
      <div><p className="text-sm text-muted-foreground">Logged API errors</p><p className="text-2xl font-semibold">{summary.logged}</p></div>
      <div><p className="text-sm text-muted-foreground">Recent request/stream errors</p><p className="text-2xl font-semibold text-red-600 dark:text-red-400">{summary.recent}</p></div>
      <div><p className="text-sm text-muted-foreground">Showing</p><p className="text-2xl font-semibold">{summary.showing}</p></div>
    </CardContent>
  </Card>
  )
},

DebugLogErrorCard = ({ entry }: Readonly<{ entry: DebugErrorEntry }>) => (
  <div key={getDebugErrorKey("log", entry)} className="rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">{entry.service || "unknown service"} · {entry.model || "unknown model"}</p>
        <p className="text-xs text-muted-foreground">{formatTimestamp(entry.timestamp)} · request {entry.request_id || "n/a"}</p>
      </div>
      <span className="text-red-600 dark:text-red-400">{entry.error_type || "error"}</span>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{entry.error_message || "No error message recorded."}</p>
  </div>
),

RequestStreamErrorCard = ({ entry }: Readonly<{ entry: DebugErrorEntry }>) => (
  <div key={getDebugErrorKey("event", entry)} className="rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">{entry.event_type || entry.component || "request error"}</p>
        <p className="text-xs text-muted-foreground">{formatTimestamp(entry.timestamp)} · request {entry.request_id || "n/a"}</p>
      </div>
      <span className="text-red-600 dark:text-red-400">{entry.operation || "request"}</span>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{entry.message || entry.error_message || "No error message recorded."}</p>
  </div>
),

RecentFailuresCard = ({ debugErrors }: Pick<ErrorsSectionProps, "debugErrors">) => {
  if (debugErrors === undefined || (debugErrors.log_file.entries.length === ZERO && debugErrors.recent_request_stream_errors.length === ZERO)) {
    return <p className="text-sm text-muted-foreground">No recent errors logged.</p>
  }
  return (
    <>
      {debugErrors.log_file.entries.map((entry) => <DebugLogErrorCard key={entry.request_id ?? entry.timestamp ?? entry.error_message ?? entry.service ?? "error"} entry={entry} />)}
      {debugErrors.recent_request_stream_errors.map((entry) => <RequestStreamErrorCard key={entry.request_id ?? entry.timestamp ?? entry.message ?? entry.component ?? "error"} entry={entry} />)}
    </>
  )
},

ErrorsSection = ({ debugErrors, onRefresh }: ErrorsSectionProps) => (
  <TabsContent value="errors" className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-medium font-serif">Errors</h2>
        <p className="text-sm text-muted-foreground">Combined API error log plus recent request and stream failures.</p>
      </div>
      <Button variant="outline" onClick={onRefresh}>Refresh errors</Button>
    </div>
    <ErrorSummaryCard debugErrors={debugErrors} />
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader><CardTitle className="font-serif">Recent Failures</CardTitle></CardHeader>
      <CardContent className="space-y-3"><RecentFailuresCard debugErrors={debugErrors} /></CardContent>
    </Card>
  </TabsContent>
),

FrontendPerformanceSummary = ({ summary, activeStreamCount }: Readonly<{
  summary: ReturnType<typeof exportDebugData>["summary"]
  activeStreamCount: number
}>) => (
  <div className="grid gap-4 md:grid-cols-4">
    <div className="text-center p-3 bg-muted rounded-lg">
      <p className="text-xl font-bold">{summary.totalEvents}</p>
      <p className="text-xs text-muted-foreground">Total Events</p>
    </div>
    <div className="text-center p-3 bg-muted rounded-lg">
      <p className="text-xl font-bold text-red-600">{summary.errorCount}</p>
      <p className="text-xs text-muted-foreground">Errors</p>
    </div>
    <div className="text-center p-3 bg-muted rounded-lg">
      <p className="text-xl font-bold">{activeStreamCount}</p>
      <p className="text-xs text-muted-foreground">Active Streams</p>
    </div>
    <div className="text-center p-3 bg-muted rounded-lg">
      <p className="text-xl font-bold">{summary.slowOperationsCount}</p>
      <p className="text-xs text-muted-foreground">Slow Operations</p>
    </div>
  </div>
),

FrontendActiveStreams = ({ activeStreams, currentTime }: Readonly<{
  activeStreams: ReturnType<typeof exportDebugData>["activeStreams"]
  currentTime: number
}>) => {
  if (activeStreams.length === ZERO) {
    return false
  }
  return (
    <div>
      <h3 className="font-medium mb-2 text-sm">Active Frontend Streams</h3>
      <div className="space-y-1">
        {activeStreams.map((stream) => (
          <div key={stream.streamId} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
            <span className="font-mono text-xs">{stream.streamId.slice(0, 12)}...</span>
            <span>{stream.eventCount} events</span>
            <span className="text-muted-foreground">
              {((currentTime - stream.startTime) / 1000).toFixed(1)}s
            </span>
          </div>
        ))}
      </div>
    </div>
  )
},

FrontendRecentEvents = ({ recentEvents }: Readonly<{
  recentEvents: ReturnType<typeof exportDebugData>["recentEvents"]
}>) => (
  <div>
    <h3 className="font-medium mb-2 text-sm">Recent Frontend Events</h3>
    <div className="space-y-1 max-h-40 overflow-y-auto font-mono text-xs">
      {recentEvents.slice(-20).toReversed().map((event) => (
        <div key={`${event.timestamp}-${event.eventType}-${event.message}`} className="flex items-start gap-2 p-1 hover:bg-muted rounded">
          <span className="text-muted-foreground w-20 flex-shrink-0">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
          <span className={`px-1 rounded ${
            event.eventType === "error" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
            (event.eventType === "stream_event" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
            "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300")
          }`}>
            {event.eventType}
          </span>
          <span className="flex-1 truncate">{event.message}</span>
        </div>
      ))}
    </div>
  </div>
),

FrontendPerfCard = ({ frontendPerfData }: Readonly<{
  frontendPerfData: ReturnType<typeof exportDebugData> | undefined
}>) => {
  const [currentTime] = useState(() => Date.now())
  if (frontendPerfData === undefined) {return false}
  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Frontend Performance</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Browser-side metrics and stream tracking</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FrontendPerformanceSummary
          activeStreamCount={frontendPerfData.activeStreams.length}
          summary={frontendPerfData.summary}
        />
        <FrontendActiveStreams activeStreams={frontendPerfData.activeStreams} currentTime={currentTime} />
        <FrontendRecentEvents recentEvents={frontendPerfData.recentEvents} />
      </CardContent>
    </Card>
  )
},

IMAGE_ERROR_DETAILS = {
  ARTICLE_FETCH_FAILED: "Failed to download the article HTML.",
  FRONTEND_RENDER_FAILED: "Browser could not render the image asset.",
  IMAGE_FETCH_FAILED: "Remote server rejected the image request.",
  IMAGE_FETCH_TIMEOUT: "Fetching the image timed out.",
  IMAGE_UNSUPPORTED_TYPE: "Image type is not supported by the extractor.",
  IMAGE_URL_INVALID: "The article URL is malformed or missing.",
  MIXED_CONTENT_BLOCKED: "HTTPS page blocked an HTTP image URL.",
  NO_IMAGE_IN_FEED: "No image candidates found in the RSS entry.",
  OG_IMAGE_NOT_FOUND: "No og:image or twitter:image metadata found.",
} satisfies Record<ImageErrorCode, string>,

IMAGE_ERROR_LABELS = {
  ARTICLE_FETCH_FAILED: "Article fetch failed",
  FRONTEND_RENDER_FAILED: "Frontend render failed",
  IMAGE_FETCH_FAILED: "Image fetch failed",
  IMAGE_FETCH_TIMEOUT: "Image fetch timeout",
  IMAGE_UNSUPPORTED_TYPE: "Unsupported image type",
  IMAGE_URL_INVALID: "Invalid image URL",
  MIXED_CONTENT_BLOCKED: "Mixed content blocked",
  NO_IMAGE_IN_FEED: "No image in RSS",
  OG_IMAGE_NOT_FOUND: "No og:image found",
} satisfies Record<ImageErrorCode, string>,

ImageErrorTaxonomyCard = () =>
  (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Image Error Taxonomy</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Standardized error labels used by image extraction</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm md:grid-cols-2">
                {Object.entries(IMAGE_ERROR_LABELS).map(([key, label]) => (
                  <li key={key} className="rounded border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-2">
                    <div className="font-mono text-xs text-muted-foreground">{key}</div>
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{getImageErrorDetails(key)}</div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

  )
,

LlmSummaryCard = ({ llmLogs }: LlmSectionProps) => {
  const entries = llmLogs?.entries ?? [],
    successfulCalls = entries.filter((entry) => entry.success).length,
    failedCalls = entries.filter((entry) => entry.success === false).length,
    averageLatency = entries.length === ZERO
      ? "—"
      : `${Math.round(entries.reduce((total, entry) => total + (entry.duration_ms ?? 0), 0) / entries.length)}ms`
  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Call Summary</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
          {llmLogs?.available
            ? `${llmLogs.total} calls logged in ${llmLogs.path}`
            : "LLM log file is not available in this session directory."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-4">
        <div><p className="text-sm text-muted-foreground">Returned</p><p className="text-2xl font-semibold">{llmLogs?.returned ?? 0}</p></div>
        <div><p className="text-sm text-muted-foreground">Successes</p><p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{successfulCalls}</p></div>
        <div><p className="text-sm text-muted-foreground">Failures</p><p className="text-2xl font-semibold text-red-600 dark:text-red-400">{failedCalls}</p></div>
        <div><p className="text-sm text-muted-foreground">Avg latency</p><p className="text-2xl font-semibold">{averageLatency}</p></div>
      </CardContent>
    </Card>
  )
},

getLlmCallStatusClass = (success?: boolean): string => {
  if (success) {
    return "text-emerald-600 dark:text-emerald-400"
  }
  return "text-red-600 dark:text-red-400"
},

getLlmCallStatusLabel = (success?: boolean): string => {
  if (success) {
    return "success"
  }
  return "failed"
},

LlmCallMeta = ({ entry }: LlmCallCardProps) => (
  <div className="flex items-center gap-3 text-xs">
    <span className={getLlmCallStatusClass(entry.success)}>{getLlmCallStatusLabel(entry.success)}</span>
    <span>{formatMilliseconds(entry.duration_ms)}</span>
    <span>{entry.messages?.length ?? 0} messages</span>
  </div>
),

LlmCallErrorDetails = ({ entry }: LlmCallCardProps) => {
  if (!entry.error_type && !entry.error_message && !entry.finish_reason) {
    return false
  }
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      {entry.finish_reason && <span>Finish: {entry.finish_reason}</span>}
      {entry.error_type && <span className="ml-3">Type: {entry.error_type}</span>}
      {entry.error_message && <span className="ml-3">{entry.error_message}</span>}
    </div>
  )
},

LlmCallCard = ({ entry }: LlmCallCardProps) => (
  <div key={entry.request_id ?? entry.timestamp ?? entry.service ?? entry.model ?? "llm"} className="rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">{entry.service || "unknown service"} · {entry.model || "unknown model"}</p>
        <p className="text-xs text-muted-foreground">{formatTimestamp(entry.timestamp)} · request {entry.request_id || "n/a"}</p>
      </div>
      <LlmCallMeta entry={entry} />
    </div>
    <LlmCallErrorDetails entry={entry} />
  </div>
),

LlmRecentCalls = ({ entries }: Readonly<{ entries: readonly LlmLogEntry[] }>) =>
  entries.length === ZERO ? (
    <p className="text-sm text-muted-foreground">No LLM calls logged yet.</p>
  ) : (
    <div className="space-y-3 max-h-[36rem] overflow-y-auto">
      {entries.map((entry) => <LlmCallCard key={entry.request_id ?? entry.timestamp ?? entry.service ?? entry.model ?? "llm"} entry={entry} />)}
    </div>
  ),

LlmSection = ({ llmLogs, onRefresh }: LlmSectionProps) => (
  <TabsContent value="llm" className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-medium font-serif">LLM Calls</h2>
        <p className="text-sm text-muted-foreground">Parsed model calls with latency and outcome details.</p>
      </div>
      <Button variant="outline" onClick={onRefresh}>Refresh LLM logs</Button>
    </div>
    <LlmSummaryCard llmLogs={llmLogs} onRefresh={onRefresh} />
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader><CardTitle className="font-serif">Recent Calls</CardTitle></CardHeader>
      <CardContent><LlmRecentCalls entries={llmLogs?.entries ?? []} /></CardContent>
    </Card>
  </TabsContent>
),

LogFilesCard = ({ backendLogFiles }: Readonly<{ backendLogFiles: readonly DebugLogFileRecord[] }>) =>
  (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Debug Log Files</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">JSON Lines log files saved on the backend</CardDescription>
            </CardHeader>
            <CardContent>
              {backendLogFiles.length > 0 ? (
                <div className="space-y-2">
                  {backendLogFiles.map((file) => (
                    <div key={file.filename ?? `${file.modified ?? "file"}-${file.size_bytes ?? "size"}`} className="flex items-center justify-between p-2 border rounded text-sm">
                      <div>
                        <span className="font-mono">{String(file.filename)}</span>
                        <span className="ml-2 text-muted-foreground text-xs">
                          {file.size_bytes === undefined ? "" : `${(file.size_bytes / 1024).toFixed(1)} KB`}
                        </span>
                      </div>
                      <a
                        href={`${API_BASE_URL}/debug/logs/file/${file.filename}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs"
                      >
                        Download
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No log files available</p>
              )}
            </CardContent>
          </Card>

  )
,

ParserSection = (props: ParserSectionProps) =>
  (
    <TabsContent value="parser" className="space-y-4">
      <RssParserCard rssTestUrl={props.rssTestUrl} setRssTestUrl={props.setRssTestUrl} rssTestResult={props.rssTestResult} rssTestLoading={props.rssTestLoading} testRssParser={props.testRssParser} />
      <ArticleParserCard articleTestUrl={props.articleTestUrl} setArticleTestUrl={props.setArticleTestUrl} articleTestResult={props.articleTestResult} articleTestLoading={props.articleTestLoading} testArticleParser={props.testArticleParser} />
      <ImageErrorTaxonomyCard />
    </TabsContent>
  )
,

PerformanceReportSummary = ({ summary }: Pick<BackendDebugReport, "summary">) => (
  <div className="grid gap-4 md:grid-cols-3">
    <div className="text-center p-4 bg-muted rounded-lg">
      <p className="text-2xl font-bold">{summary?.total_events ?? 0}</p>
      <p className="text-sm text-muted-foreground">Total Events</p>
    </div>
    <div className="text-center p-4 bg-muted rounded-lg">
      <p className="text-2xl font-bold text-yellow-600">{summary?.slow_operations ?? 0}</p>
      <p className="text-sm text-muted-foreground">Slow Operations</p>
    </div>
    <div className="text-center p-4 bg-muted rounded-lg">
      <p className="text-2xl font-bold text-red-600">{summary?.errors ?? 0}</p>
      <p className="text-sm text-muted-foreground">Errors</p>
    </div>
  </div>
),

ActiveBackendStreams = ({ streams }: Readonly<{ streams: readonly DebugActiveStreamRecord[] }>) => {
  if (streams.length === ZERO) {
    return false
  }
  return (
    <div>
      <h3 className="font-medium mb-2">Active Streams</h3>
      <div className="space-y-2">
        {streams.map((stream) => (
          <div key={stream.stream_id ?? `${stream.request_path ?? "stream"}-${stream.duration_so_far ?? "duration"}`} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
            <span className="font-mono">{(stream.stream_id ?? "").slice(0, 8)}...</span>
            <span>{stream.request_path ?? ""}</span>
            <span className="text-muted-foreground">{(stream.duration_so_far ?? 0).toFixed(1)}s</span>
          </div>
        ))}
      </div>
    </div>
  )
},

DebugRecommendations = ({ recommendations }: Readonly<{ recommendations: readonly string[] }>) => {
  if (recommendations.length === ZERO) {
    return false
  }
  return (
    <div>
      <h3 className="font-medium mb-2">Recommendations</h3>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {recommendations.map((recommendation) => (
          <li key={recommendation} className="flex items-start gap-2">
            <span className="text-yellow-500">!</span>
            {recommendation}
          </li>
        ))}
      </ul>
    </div>
  )
},

PerformanceReportCard = ({ backendDebugReport }:Readonly< { backendDebugReport: BackendDebugReport | undefined }>) => {
  if (backendDebugReport === undefined) {
    return false
  }
  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Backend Debug Report</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
          Generated at {backendDebugReport.generated_at ? new Date(String(backendDebugReport.generated_at)).toLocaleString() : "unknown"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PerformanceReportSummary summary={backendDebugReport.summary} />
        <ActiveBackendStreams streams={backendDebugReport.active_streams ?? []} />
        <DebugRecommendations recommendations={backendDebugReport.recommendations ?? []} />
      </CardContent>
    </Card>
  )
},

PerformanceSection = (props: PerformanceSectionProps) =>
  (
    <TabsContent value="performance" className="space-y-4">
      <PerformanceReportCard backendDebugReport={props.backendDebugReport} />
      <SlowOperationsCard backendSlowOps={props.backendSlowOps} />
      <BackendEventsCard backendLogEvents={props.backendLogEvents} />
      <FrontendPerfCard frontendPerfData={props.frontendPerfData} />
      <LogFilesCard backendLogFiles={props.backendLogFiles} />
    </TabsContent>
  )
,

PipelineSignalRow = ({ signal }: Readonly<PipelineSignalRowProps>) => (
  <div>
    <p className="text-muted-foreground">{signal.label}</p>
    <p className="text-lg font-semibold">{signal.value}</p>
    <p className="text-xs text-muted-foreground">{signal.detail}</p>
  </div>
),

PipelineSignalsCard = ({ systemStatus }:Readonly< { systemStatus: SystemStatusResponse | undefined }>) => {
  const { components = {}, pipeline = {} } = systemStatus ?? {},
   { embedding_queue: embeddingQueue = {} } = components,
   { fetch = {} } = pipeline,
   signals: readonly PipelineSignal[] = [
    {
      detail: "Not-modified responses in current run",
      label: "ETag hits",
      value: fetch.not_modified ?? "—",
    },
    { detail: "Failures during feed fetch", label: "Fetch errors", value: fetch.errors ?? "—" },
    {
      detail: `Batch size ${embeddingQueue.batch_size ?? "—"} · max/min ${embeddingQueue.max_per_minute ?? "—"}`,
      label: "Embedding queue depth",
      value: embeddingQueue.depth ?? "—",
    },
  ];

  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Pipeline Signals</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
          RSS fetch cadence, cache behavior, and embeddings
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3 text-sm">
        {signals.map((signal) => <PipelineSignalRow key={signal.label} signal={signal} />)}
      </CardContent>
    </Card>
  );
},

PostgresArticlesCard = ({ dbData }:Readonly< { dbData: DatabaseDebugResponse | undefined }>) =>
  (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Postgres articles</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead>Embedding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dbData?.articles?.map((article) => (
                    <TableRow
                      key={debugArticleRowKey(article.id, article.url)}
                    >
                      <TableCell className="font-mono text-xs">{article.id}</TableCell>
                      <TableCell>{article.source}</TableCell>
                      <TableCell>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {article.title}
                        </a>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {article.published_at
                          ? new Date(article.published_at).toLocaleString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {article.embedding_generated ? "" : "—"} {article.chroma_id && (
                          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                            {article.chroma_id}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableCaption>
                  Showing {dbData?.returned ?? 0} / {dbData?.total ?? 0} rows
                </TableCaption>
              </Table>
            </CardContent>
          </Card>

  )
,

RssParserStatus = ({ result }: Readonly<{ result: RssParserTestResult }>) => (
  <div className="flex items-center gap-2">
    <span className={result.success ? "text-green-600" : "text-red-600"}>{result.success ? "Success" : "Failed"}</span>
    {result.parse_time_seconds && <span className="text-sm text-muted-foreground">({result.parse_time_seconds}s)</span>}
  </div>
),

RssFeedInfo = ({ result }: Readonly<{ result: RssParserTestResult }>) => {
  if (result.feed_info === undefined) {
    return false
  }
  return (
    <div className="text-sm">
      <p><strong>Title:</strong> {result.feed_info.title}</p>
      <p><strong>Entries:</strong> {result.status?.entries_count}</p>
    </div>
  )
},

RssSampleSource = ({ entry }: Readonly<{ entry: RssSampleEntry }>) => {
  if (!entry.image_extraction?.selected_source) {
    return false
  }
  return <p className="text-muted-foreground">Source: {entry.image_extraction.selected_source}</p>
},

RssSampleError = ({ entry }: Readonly<{ entry: RssSampleEntry }>) => {
  if (!entry.image_extraction?.image_error) {
    return false
  }
  return (
    <p className="text-muted-foreground">
      Error detail: {getImageErrorDetails(entry.image_extraction.image_error) || entry.image_extraction.image_error_details}
    </p>
  )
},

RssSampleEntryCard = ({ entry }: Readonly<{ entry: RssSampleEntry }>) => (
  <div key={entry.title ?? entry.image_extraction?.image_url ?? "sample-entry"} className="text-xs p-2 bg-muted rounded">
    <p className="font-medium">{entry.title}</p>
    <p className="text-muted-foreground">Image: {textOr(entry.image_extraction?.image_url, getImageErrorLabel(entry.image_extraction?.image_error))}</p>
    <RssSampleSource entry={entry} />
    <RssSampleError entry={entry} />
  </div>
),

RssSampleEntries = ({ result }: Readonly<{ result: RssParserTestResult }>) => {
  const entries = result.sample_entries ?? []
  if (entries.length === ZERO) {
    return false
  }
  return (
    <div className="mt-2">
      <h4 className="font-medium text-sm mb-2">Sample Entries</h4>
      <div className="space-y-2">{entries.map((entry) => <RssSampleEntryCard key={entry.title ?? entry.image_extraction?.image_url ?? "sample-entry"} entry={entry} />)}</div>
    </div>
  )
},

RssParserError = ({ result }: Readonly<{ result: RssParserTestResult }>) => {
  if (!result.error) {
    return false
  }
  return <p className="text-sm text-red-600">{result.error}</p>
},

RssParserResult = ({ result }: Readonly<{ result: RssParserTestResult | undefined }>) => {
  if (result === undefined) {
    return false
  }
  return (
    <div className="mt-4 space-y-2">
      <RssParserStatus result={result} />
      <RssFeedInfo result={result} />
      <RssSampleEntries result={result} />
      <RssParserError result={result} />
    </div>
  )
},

RssParserCard = ({ rssTestUrl, setRssTestUrl, rssTestResult, rssTestLoading, testRssParser }: Readonly<Pick<ParserSectionProps, "rssTestUrl" | "setRssTestUrl" | "rssTestResult" | "rssTestLoading" | "testRssParser">>) => (
  <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">RSS Feed Parser</CardTitle>
      <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Test RSS parsing on any feed URL</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder="Enter RSS feed URL..." value={rssTestUrl} onChange={inputValueChange(setRssTestUrl)} className="flex-1" />
        <Button onClick={testRssParser} disabled={rssTestLoading}>{rssTestLoading ? "Testing..." : "Test Feed"}</Button>
      </div>
      <RssParserResult result={rssTestResult} />
    </CardContent>
  </Card>
),

SNAPSHOT_CARD_CLASS = "bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg",

ZERO = 0,

SlowOperationsCard = ({ backendSlowOps }: Readonly<{ backendSlowOps: readonly DebugSlowOperationRecord[] }>) => {
  if (backendSlowOps.length === 0) {return false}
  return (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Slow Operations</CardTitle>
                <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Operations exceeding performance thresholds</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {backendSlowOps.map((op) => (
                    <div
                      key={`${op.stream_id ?? op.request_id ?? op.event_type ?? "operation"}-${op.duration_ms ?? "duration"}`}
                      className="flex items-center justify-between p-2 border rounded text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          op.event_type === "error" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                        }`}>
                          {String(op.event_type)}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {op.stream_id ? String(op.stream_id).slice(0, 8) : (op.request_id ? String(op.request_id).slice(0, 8) : "")}
                        </span>
                      </div>
                      <span className="text-red-600 font-medium">
                          {op.duration_ms === undefined ? "" : `${op.duration_ms.toFixed(0)}ms`}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

  )
},

SnapshotCard = ({ title, children }: { title: string; children: ReactNode }) =>
  (
    <Card className={SNAPSHOT_CARD_CLASS}>
      <CardHeader><CardTitle className="font-serif">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  )
,

SnapshotPagination = ({ limit, onLimitChange, offset, onOffsetChange, compact = false }: SnapshotPaginationProps) =>
  (
    <div className={compact ? "flex items-center gap-2" : "flex flex-wrap items-center gap-2"}>
      <span>Limit</span>
      <Select value={String(limit)} onValueChange={(value) => {onLimitChange(Number(value))}}>
        <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {[10, 25, 50, 100, 200, 500].map((size) => (
            <SelectItem key={size} value={String(size)}>{size}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span>Offset</span>
      <Input
        type="number"
        className="w-24"
        value={offset}
        onChange={(event) => {onOffsetChange(Number(event.target.value))}}
      />
    </div>
  )
,

SourceCacheCategories = ({ categories }: Readonly<{
  categories: readonly (readonly [string, number])[]
}>) => {
  if (categories.length === ZERO) {
    return <p className="text-muted-foreground">No category breakdown available.</p>
  }
  return (
    <div className="space-y-1 text-muted-foreground">
      {categories.map(([category, count]) => (
        <div key={category} className="flex items-center justify-between">
          <span>{category}</span><span>{count}</span>
        </div>
      ))}
    </div>
  )
},

SourceCacheSummary = ({ cacheStatus }: Pick<SourcesSectionProps, "cacheStatus">) => (
  <>
    <p>Total cached articles: {cacheStatus?.total_articles ?? "—"}</p>
    <p>Refresh state: {cacheStatus?.update_in_progress ? "Running" : "Idle"}</p>
    <p>Cache age: {formatDuration(cacheStatus?.cache_age_seconds)}</p>
  </>
),

SourceCacheSnapshot = ({ cacheStatus }: Pick<SourcesSectionProps, "cacheStatus">) => {
  const categories = Object.entries(cacheStatus?.category_breakdown ?? {}).toSorted(
    (firstCategory, secondCategory) => secondCategory[1] - firstCategory[1],
  )
  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Cache Snapshot</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
          Last update {formatTimestamp(cacheStatus?.last_updated)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <SourceCacheSummary cacheStatus={cacheStatus} />
        <div className="space-y-1">
          <p className="font-medium">Category breakdown</p>
          <SourceCacheCategories categories={categories} />
        </div>
      </CardContent>
    </Card>
  )
},

SourceHealthTable = ({ sourceStats }: Pick<SourcesSectionProps, "sourceStats">) =>
  (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Source Health</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
          Current feed status from the ingestion catalog.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sourceStats.length > 0 ? (
          <div className="max-h-[32rem] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Country</TableHead>
                  <TableHead>Articles</TableHead><TableHead>Checked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourceStats.map((source) => (
                  <TableRow key={sourceStatsRowKey(source)}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{source.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {source.category} · {source.funding_type || "unknown funding"}
                        </div>
                        {source.error_message ? <div className="text-xs text-red-600 dark:text-red-400">{source.error_message}</div> : undefined}
                      </div>
                    </TableCell>
                    <TableCell className={sourceStatusTone(source.status)}>{source.status}</TableCell>
                    <TableCell>{source.country || "—"}</TableCell>
                    <TableCell>{source.article_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatTimestamp(source.last_checked)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">No source statistics available.</p>}
      </CardContent>
    </Card>
  )
,

SourceMetricCards = ({ sourceStats, cacheStatus }: Pick<SourcesSectionProps, "sourceStats" | "cacheStatus">) => {
  const healthy = sourceStats.filter((source) => source.status === "success").length,
   warnings = sourceStats.filter((source) => source.status === "warning").length,
   errors = sourceStats.filter((source) => source.status === "error").length,
   metrics = [
    { label: "Total Sources", value: cacheStatus?.total_sources ?? sourceStats.length },
    { label: "Healthy", value: cacheStatus?.sources_working ?? healthy },
    { label: "Warnings", value: cacheStatus?.sources_with_warnings ?? warnings },
    { label: "Errors", value: cacheStatus?.sources_with_errors ?? errors },
  ]
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric.label} className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
          <CardHeader><CardTitle className="font-serif">{metric.label}</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{metric.value}</CardContent>
        </Card>
      ))}
    </div>
  )
},

SourcesSection = ({ sourceStats, cacheStatus, cacheRefreshMessage, cacheRefreshError, cacheRefreshRunning, onRefresh, onRefreshCache }: SourcesSectionProps) =>
  (
    <TabsContent value="sources" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium font-serif">Ingestion And Sources</h2>
          <p className="text-sm text-muted-foreground">Source health, cache coverage, and refresh controls in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onRefresh}>Refresh source data</Button>
          <Button onClick={onRefreshCache} disabled={cacheRefreshRunning}>
            {cacheRefreshRunning ? "Refreshing cache..." : "Run cache refresh"}
          </Button>
        </div>
      </div>
      {cacheRefreshMessage || cacheRefreshError ? (
        <Card className={cacheRefreshError ? "border-red-500/30 bg-red-500/10 bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg" : "bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg"}>
          <CardContent className="py-4 text-sm">{cacheRefreshError || cacheRefreshMessage}</CardContent>
        </Card>
      ) : undefined}
      <SourceMetricCards sourceStats={sourceStats} cacheStatus={cacheStatus} />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1.8fr]">
        <SourceCacheSnapshot cacheStatus={cacheStatus} />
        <SourceHealthTable sourceStats={sourceStats} />
      </div>
    </TabsContent>
  )
,

StartupTimelineCard = ({ startupMetrics, startupEvents, detailFallback = "—" }: StartupTimelineCardProps) =>
  (
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Startup Timeline</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Backend startup phase breakdown</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Backend boot</p>
                  <p className="text-lg font-semibold">
                    {formatDuration(startupMetrics?.durationSeconds)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Started</p>
                  <p>{formatTimestamp(startupMetrics?.startedAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Completed</p>
                  <p>{formatTimestamp(startupMetrics?.completedAt)}</p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phase</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {startupEvents.map((event) => (
                    <TableRow key={`${event.name}-${event.startedAt}`}>
                      <TableCell className="font-medium capitalize">{event.name.replaceAll('_', " ")}</TableCell>
                      <TableCell>{formatDuration(event.durationSeconds)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {event.detail || detailFallback}
                        {renderMetadataBadges(event.metadata)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTimestamp(event.completedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {startupEvents.length === 0 && (
                  <TableCaption>No startup metrics recorded yet.</TableCaption>
                )}
              </Table>
            </CardContent>
          </Card>

  )
,

StatusLines = ({ items, muted = false }:Readonly< { items: readonly StatusLine[]; muted?: boolean }>) => {
  const className = muted ? "space-y-2 text-sm text-muted-foreground" : "space-y-2 text-sm";
  return (
    <div className={className}>
      {items.map((item) => (
        <p key={item.label}>
          {item.label}: {item.value}
        </p>
      ))}
    </div>
  );
},

StorageDriftCard = ({ driftStats }: Pick<StorageSnapshotSectionProps, "driftStats">) =>
  (
    <SnapshotCard title="Storage Drift">
      <p>DB rows with embeddings: {driftStats?.database_with_embeddings ?? "-"}</p>
      <p>Chroma vectors: {driftStats?.vector_total_documents ?? "-"}</p>
      <p>Missing in Chroma: {driftStats?.missing_in_chroma_count ?? "-"}</p>
      <p>Dangling in Chroma: {driftStats?.dangling_in_chroma_count ?? "-"}</p>
    </SnapshotCard>
  )
,

StorageFilterCards = ({ cacheSourceDraft, setCacheSourceDraft, onApplyCacheFilters, dbSourceDraft, setDbSourceDraft, dbBeforeDraft, setDbBeforeDraft, dbAfterDraft, setDbAfterDraft, onApplyDbFilters }:Readonly< { cacheSourceDraft: string; setCacheSourceDraft: (value: string) => void; onApplyCacheFilters: () => void; dbSourceDraft: string; setDbSourceDraft: (value: string) => void; dbBeforeDraft: string; setDbBeforeDraft: (value: string) => void; dbAfterDraft: string; setDbAfterDraft: (value: string) => void; onApplyDbFilters: () => void; }>) =>
  (
    <>
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="font-serif">Cache filters</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Source (e.g. bbc)"
                  className="w-40"
                  value={cacheSourceDraft}
                  onChange={(event) =>{  setCacheSourceDraft(event.target.value); }}
                />
                <Button variant="secondary" onClick={onApplyCacheFilters}>
                  Apply filters
                </Button>
              </div>
            </CardHeader>
          </Card>
<Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="font-serif">Database filters</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Source (e.g. bbc)"
                  className="w-40"
                  value={dbSourceDraft}
                  onChange={(event) =>{  setDbSourceDraft(event.target.value); }}
                />
                <Input
                  type="datetime-local"
                  className="w-56"
                  value={dbAfterDraft}
                  onChange={(event) =>{  setDbAfterDraft(event.target.value); }}
                  placeholder="Published after"
                />
                <Input
                  type="datetime-local"
                  className="w-56"
                  value={dbBeforeDraft}
                  onChange={(event) =>{  setDbBeforeDraft(event.target.value); }}
                  placeholder="Published before"
                />
                <Button variant="secondary" onClick={onApplyDbFilters}>
                  Apply filters
                </Button>
              </div>
            </CardHeader>
          </Card>

    </>
  )
,

StorageSection = (props: StorageSectionProps) =>
  (
    <TabsContent value="storage" className="space-y-4">
      <StorageSnapshotSection
        chromaData={props.chromaData}
        dbData={props.dbData}
        driftStats={props.driftData}
        cacheData={props.cacheData}
        chromaLimit={props.chromaLimit}
        setChromaLimit={props.setChromaLimit}
        chromaOffset={props.chromaOffset}
        setChromaOffset={props.setChromaOffset}
        dbLimit={props.dbLimit}
        setDbLimit={props.setDbLimit}
        dbOffset={props.dbOffset}
        setDbOffset={props.setDbOffset}
        dbSortDirection={props.dbSortDirection}
        setDbSortDirection={props.setDbSortDirection}
        dbMissingOnly={props.dbMissingOnly}
        setDbMissingOnly={props.setDbMissingOnly}
        cacheLimit={props.cacheLimit}
        setCacheLimit={props.setCacheLimit}
        cacheOffset={props.cacheOffset}
        setCacheOffset={props.setCacheOffset}
      />
      <StorageFilterCards
        cacheSourceDraft={props.cacheSourceDraft}
        setCacheSourceDraft={props.setCacheSourceDraft}
        onApplyCacheFilters={props.onApplyCacheFilters}
        dbSourceDraft={props.dbSourceDraft}
        setDbSourceDraft={props.setDbSourceDraft}
        dbBeforeDraft={props.dbBeforeDraft}
        setDbBeforeDraft={props.setDbBeforeDraft}
        dbAfterDraft={props.dbAfterDraft}
        setDbAfterDraft={props.setDbAfterDraft}
        onApplyDbFilters={props.onApplyDbFilters}
      />
      <CacheDeltaCard cacheDelta={props.cacheDelta} />
      <StartupTimelineCard startupMetrics={props.startupMetrics} startupEvents={props.startupEvents} />
      <ChromaDocumentsCard chromaData={props.chromaData} />
      <CachedArticlesCard cacheData={props.cacheData} />
      <PostgresArticlesCard dbData={props.dbData} />
      <DriftSamplesCard driftData={props.driftData} />
    </TabsContent>
  )
,

StorageSnapshotSection = (props: StorageSnapshotSectionProps) =>
  (
    <div className="grid gap-4 md:grid-cols-4">
      <CacheSnapshotCard
        cacheData={props.cacheData}
        cacheLimit={props.cacheLimit}
        setCacheLimit={props.setCacheLimit}
        cacheOffset={props.cacheOffset}
        setCacheOffset={props.setCacheOffset}
      />
      <ChromaSnapshotCard
        chromaData={props.chromaData}
        chromaLimit={props.chromaLimit}
        setChromaLimit={props.setChromaLimit}
        chromaOffset={props.chromaOffset}
        setChromaOffset={props.setChromaOffset}
      />
      <DatabaseSnapshotCard
        dbData={props.dbData}
        dbLimit={props.dbLimit}
        setDbLimit={props.setDbLimit}
        dbOffset={props.dbOffset}
        setDbOffset={props.setDbOffset}
        dbSortDirection={props.dbSortDirection}
        setDbSortDirection={props.setDbSortDirection}
        dbMissingOnly={props.dbMissingOnly}
        setDbMissingOnly={props.setDbMissingOnly}
      />
      <StorageDriftCard driftStats={props.driftStats} />
    </div>
  )
,

getSystemComponentItems = (components: SystemStatusResponse["components"] = {}): readonly StatusLine[] => {
  const { cache = {}, database = {}, vector_store: vectorStore = {}, embedding_queue: embeddingQueue = {} } = components
  return [
    { label: "Cache", value: `${healthLabel(cache.healthy, "Healthy", "Unhealthy")} (${cache.article_count ?? ""} articles)` },
    { label: "Cache updated", value: formatTimestamp(cache.last_updated) },
    { label: "Cache age", value: formatDuration(cache.age_seconds) },
    { label: "Cache refresh", value: healthLabel(cache.update_in_progress, "Running", "Idle") },
    { label: "Cache updates", value: cache.update_count ?? "—" },
    { label: "Incremental cache", value: healthLabel(cache.incremental_enabled, "Enabled", "Disabled") },
    { label: "Sources tracked", value: cache.sources_tracked ?? "—" },
    { label: "Database", value: healthLabel(database.healthy, "Healthy", "Unavailable") },
    { label: "Vector Store", value: healthLabel(vectorStore.healthy, "Healthy", "Unavailable") },
    { label: "Embedding queue", value: embeddingQueue.depth ?? "—" },
  ]
},

getSystemRuntimeItems = (runtime: SystemStatusResponse["runtime"] = {}): readonly StatusLine[] => [
    { label: "Python", value: runtime.python_version?.split(" ")[0] },
    { label: "Platform", value: runtime.platform },
    { label: "PID", value: runtime.pid },
  ],

SystemStatusDetails = ({ systemStatus }: Readonly<{ systemStatus: SystemStatusResponse | undefined }>) => {
  if (systemStatus === undefined) {
    return <p className="text-sm text-muted-foreground">Loading system status...</p>
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="font-medium mb-2">Components</h3>
        <StatusLines items={getSystemComponentItems(systemStatus.components)} />
      </div>
      <div>
        <h3 className="font-medium mb-2">Runtime</h3>
        <StatusLines items={getSystemRuntimeItems(systemStatus.runtime)} muted />
      </div>
    </div>
  )
},

SystemStatusSection = ({ systemStatus, startupMetrics, startupEvents, onRefreshStatus }: SystemStatusSectionProps) =>
  (
    <TabsContent value="system" className="space-y-4">
      <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
        <CardHeader>
          <CardTitle className="font-serif">System Status</CardTitle>
          <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
            Component health and runtime information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SystemStatusDetails systemStatus={systemStatus} />
          <Button variant="outline" size="sm" onClick={onRefreshStatus}>
            Refresh Status
          </Button>
        </CardContent>
      </Card>
      <PipelineSignalsCard systemStatus={systemStatus} />
      <StartupTimelineCard
        startupMetrics={startupMetrics}
        startupEvents={startupEvents}
        detailFallback="-"
      />
    </TabsContent>
  )
,

chooseValue = <Value,>(condition: boolean, whenTrue: Value, whenFalse: Value): Value => {
  if (condition) {return whenTrue}
  return whenFalse
},

debugArticleRowKey = (
  articleId: number | string,
  fallback: string,
): string =>
  `${articleId}-${fallback}`
,

debugEventClassName = (eventType: string | undefined): string => {
  if (eventType === "error") {
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
  }
  if (eventType === "stream_event") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
  }
  if (eventType === "request_start") {
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
  }
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
},

fetchDashboardData = async (options: DebugQueryOptions): Promise<DashboardData> => {
  const [chromaData, dbData, driftData, startupMetrics, cacheData, cacheDelta] = await Promise.all([
    fetchChromaDebugArticles({ limit: options.chromaLimit, offset: options.chromaOffset }),
    fetchDatabaseDebugArticles({
      limit: options.dbLimit,
      missing_embeddings_only: options.dbMissingOnly,
      offset: options.dbOffset,
      published_after: options.dbAfterFilter,
      published_before: options.dbBeforeFilter,
      sort_direction: options.dbSortDirection,
      source: options.dbSourceFilter,
    }),
    fetchStorageDrift(100),
    fetchStartupMetrics(),
    fetchCacheDebugArticles({
      limit: options.cacheLimit,
      offset: options.cacheOffset,
      source: options.cacheSourceFilter,
    }),
    fetchCacheDelta({
      sample_limit: options.cacheLimit,
      sample_offset: options.cacheOffset,
      sample_preview_limit: 50,
      source: options.cacheSourceFilter,
    }),
  ])

  return { cacheData, cacheDelta, chromaData, dbData, driftData, startupMetrics }
},

fetchDebugLogLevel = async (): Promise<LogLevelResponse> => {
  const response = await fetch(`${API_BASE_URL}/debug/loglevel`),
   data = response.ok ? await parseDebugResponse(response, DEBUG_SCHEMAS.logLevel) : undefined
  if (!response.ok) {
    throw new Error("Failed to load log level")
  }
  if (data === undefined) {
    throw new Error("Failed to parse log level")
  }
  return data
},

fetchDebugSystemStatus = async (): Promise<SystemStatusResponse> => {
  const response = await fetch(`${API_BASE_URL}/debug/system/status`),
   data = response.ok ? await parseDebugResponse(response, DEBUG_SCHEMAS.systemStatus) : undefined
  if (!response.ok) {
    throw new Error("Failed to load system status")
  }
  if (data === undefined) {
    throw new Error("Failed to parse system status")
  }
  return data
},

fetchPerformanceDebugData = async (): Promise<PerformanceDebugData> => {
  const [reportResponse, eventsResponse, slowResponse, filesResponse] = await Promise.all([
    fetch(`${API_BASE_URL}/debug/logs/report`),
    fetch(`${API_BASE_URL}/debug/logs/events?limit=100`),
    fetch(`${API_BASE_URL}/debug/logs/slow`),
    fetch(`${API_BASE_URL}/debug/logs/files`),
  ]),
   report = await parseDebugResponse(reportResponse, DEBUG_SCHEMAS.backendDebugReport),
   eventsData = await parseDebugResponse(eventsResponse, DEBUG_SCHEMAS.debugLogEvents),
   slowData = await parseDebugResponse(slowResponse, DEBUG_SCHEMAS.debugSlowOperations),
   filesData = await parseDebugResponse(filesResponse, DEBUG_SCHEMAS.debugLogFiles)

  return {
    backendDebugReport: report ?? undefined,
    backendLogEvents: eventsData?.events ?? [],
    backendLogFiles: filesData?.files ?? [],
    backendSlowOps: slowData?.operations ?? [],
    frontendPerfData: exportDebugData(),
  }
},

parseDebugResponse = async <Schema extends z.ZodType<unknown>>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema> | undefined> => {
  if (!response.ok) {return undefined}
  const payload: unknown = await response.json(),
   parsed = schema.safeParse(payload)
  if (!parsed.success) {return undefined}
  return parsed.data
},

formatDuration = (value?: number | null, fallback = "—") => {
    if (value === undefined || value === null) {return fallback}
    if (value > 1000) {
      return `${Math.round(value).toLocaleString()}s`
    }
    return `${value.toFixed(2)}s`
  },

formatMilliseconds = (value?: number | null): string => {
  if (value === undefined || value === null) {return "—"}
  return `${Math.round(value)}ms`
},

formatMetadataValue = (value: NonNullable<StartupEventMetric["metadata"]>[string]): string | undefined => {
    const primitive = z.union([z.boolean(), z.number(), z.string()]).safeParse(value)
    if (primitive.success) {return String(primitive.data)}
    try {
      return JSON.stringify(value) ?? undefined
    } catch {
      return Object.prototype.toString.call(value)
    }
  },

formatTimestamp = (value?: string | null) => {
    if (value === undefined || value === null || value === "") {return "—"}
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {return value}
    return date.toLocaleString()
  },

getImageErrorDetails = (value?: string | null) => {
  if (value === undefined || value === null || value === "") {return ""}
  if (!isImageErrorCode(value)) {return ""}
  return IMAGE_ERROR_DETAILS[value] ?? ""
},

getImageErrorLabel = (value?: string | null) => {
  if (value === undefined || value === null || value === "") {return "None"}
  if (!isImageErrorCode(value)) {return value}
  return IMAGE_ERROR_LABELS[value] ?? value
},

healthLabel = (healthy: boolean | undefined, healthyLabel: string, unhealthyLabel: string) =>
  healthy === true ? healthyLabel : unhealthyLabel
,

inputValueChange = (setter: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
  setter(event.target.value)
},

isDebugTab = (value: string | null): value is DebugTab =>
  DEBUG_TABS.some((tab) => tab === value),

isImageErrorCode = (value: string): value is ImageErrorCode =>
  Object.hasOwn(IMAGE_ERROR_DETAILS, value),

pickData = <T, K extends keyof T>(data: T | null | undefined, key: K): T[K] | undefined =>
  data?.[key],

pickDataOr = <T, K extends keyof T>(data: T | null | undefined, key: K, fallback: T[K]): T[K] =>
  data?.[key] ?? fallback,

renderMetadataBadges = (metadata?: StartupEventMetric["metadata"]) => {
    if (metadata === undefined) {return []}
    const descriptors = [
      { key: "cache_size", label: "cache" },
      { key: "article_count", label: "migrated" },
      { key: "documents", label: "vectors" },
    ]

    return descriptors.map(({ label, key }) => {
      const value = formatMetadataValue(metadata[key])
      if (value === undefined || value === "") {return false}
      return (
        <span key={`${label}-${value}`} className="ml-1 text-muted-foreground">
          • {label}: {value}
        </span>
      )
    })
  },

sourceStatsRowKey = (
  source: SourceStats,
): string =>
  `${source.name}-${source.category}-${source.country}-${source.url}`
,

sourceStatusTone = (status: SourceStats["status"]) => {
    switch (status) {
      case "success": {
        return "text-emerald-600 dark:text-emerald-400"
      }
      case "warning": {
        return "text-amber-600 dark:text-amber-400"
      }
      default: {
        return "text-red-600 dark:text-red-400"
      }
  }
},

textOr = (value: string | null | undefined, fallback: string): string => {
  if (value === undefined || value === null || value === "") {return fallback}
  return value
},

useCoreDebugQueries = (options: DebugQueryOptions) => {
  const dashboardDataQuery = useQuery<DashboardData>({
    queryFn: () => fetchDashboardData(options),
    queryKey: [
      "debug-dashboard",
      options.chromaLimit,
      options.chromaOffset,
      options.dbLimit,
      options.dbOffset,
      options.dbSourceFilter,
      options.dbMissingOnly,
      options.dbSortDirection,
      options.dbBeforeFilter,
      options.dbAfterFilter,
      options.cacheLimit,
      options.cacheOffset,
      options.cacheSourceFilter,
    ],
    retry: 1,
  }),
   systemStatusQuery = useQuery<SystemStatusResponse>({ queryFn: fetchDebugSystemStatus, queryKey: ["debug-system-status"], retry: 1 }),
   logLevelQuery = useQuery<LogLevelResponse>({ queryFn: fetchDebugLogLevel, queryKey: ["debug-log-level"], retry: 1 })
  return {
    dashboardDataQuery,
    logLevelQuery,
    systemStatusQuery,
  }
},

useTabDebugQueries = (options: DebugQueryOptions) => {
  const sourceStatsQuery = useQuery<SourceStats[]>({
    enabled: options.activeTab === "sources",
    queryFn: fetchSourceStats,
    queryKey: ["debug-source-stats"],
    retry: 1,
  }),
   cacheStatusQuery = useQuery<CacheStatus | null>({
    enabled: options.activeTab === "sources",
    queryFn: fetchCacheStatus,
    queryKey: ["debug-cache-status"],
    retry: 1,
  }),
   llmLogsQuery = useQuery<LlmLogResponse>({
    enabled: options.activeTab === "llm",
    queryFn: () => fetchLlmLogs({ limit: 50 }),
    queryKey: ["debug-llm-logs"],
    retry: 1,
  }),
   debugErrorsQuery = useQuery<DebugErrorsResponse>({
    enabled: options.activeTab === "errors",
    queryFn: () => fetchDebugErrors({ includeRequestStreamEvents: true, limit: 50 }),
    queryKey: ["debug-errors"],
    retry: 1,
  }),
   performanceDataQuery = useQuery<PerformanceDebugData>({
    enabled: options.activeTab === "performance",
    queryFn: fetchPerformanceDebugData,
    queryKey: ["debug-performance", options.activeTab],
    refetchInterval: options.activeTab === "performance" ? 5000 : false,
    retry: 1,
  })

  return {
    cacheStatusQuery,
    debugErrorsQuery,
    llmLogsQuery,
    performanceDataQuery,
    sourceStatsQuery,
  }
},

useDebugQueries = (options: DebugQueryOptions) => ({
  ...useCoreDebugQueries(options),
  ...useTabDebugQueries(options),
}),

usePersistentNumber = (initial: number, min: number, max: number): [number, (value: number) => void] => {
  const [value, setValue] = useState(initial),
   clampAndSet = (next: number) => {
    const clamped = Math.min(Math.max(next, min), max)
    setValue(clamped)
  }
  return [value, clampAndSet]
},


 DebugDashboardPage = () => (
  <Suspense fallback={<div className="min-h-screen bg-background" />}>
    <DebugDashboardController />
  </Suspense>
)

export default DebugDashboardPage
