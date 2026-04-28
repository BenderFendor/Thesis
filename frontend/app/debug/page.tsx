"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GlobalNavigation } from "@/components/global-navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { SafeImage } from "@/components/safe-image"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ChromaDebugResponse,
  DatabaseDebugResponse,
  StorageDriftReport,
  StartupMetricsResponse,
  CacheDebugResponse,
  CacheDeltaResponse,
  fetchCacheDebugArticles,
  fetchCacheDelta,
  fetchChromaDebugArticles,
  fetchDebugErrors,
  fetchDatabaseDebugArticles,
  fetchCacheStatus,
  fetchLlmLogs,
  fetchSourceStats,
  fetchStorageDrift,
  fetchStartupMetrics,
  refreshCache,
  API_BASE_URL,
} from "@/lib/api"
import { useDebugMode } from "@/hooks/useDebugMode"
import { logger, setDebugMode } from "@/lib/logger"
import { exportDebugData } from "@/lib/performance-logger"
import type {
  CacheStatus,
  DebugErrorsResponse,
  LlmLogResponse,
  SourceStats,
} from "@/lib/api"

function usePersistentNumber(initial: number, min: number, max: number): [number, (value: number) => void] {
  const [value, setValue] = useState(initial)
  const clampAndSet = (next: number) => {
    const clamped = Math.min(Math.max(next, min), max)
    setValue(clamped)
  }
  return [value, clampAndSet]
}

const IMAGE_ERROR_LABELS: Record<string, string> = {
  NO_IMAGE_IN_FEED: "No image in RSS",
  IMAGE_URL_INVALID: "Invalid image URL",
  IMAGE_FETCH_FAILED: "Image fetch failed",
  IMAGE_FETCH_TIMEOUT: "Image fetch timeout",
  IMAGE_UNSUPPORTED_TYPE: "Unsupported image type",
  MIXED_CONTENT_BLOCKED: "Mixed content blocked",
  FRONTEND_RENDER_FAILED: "Frontend render failed",
  OG_IMAGE_NOT_FOUND: "No og:image found",
  ARTICLE_FETCH_FAILED: "Article fetch failed",
}

const IMAGE_ERROR_DETAILS: Record<string, string> = {
  NO_IMAGE_IN_FEED: "No image candidates found in the RSS entry.",
  IMAGE_URL_INVALID: "The article URL is malformed or missing.",
  IMAGE_FETCH_FAILED: "Remote server rejected the image request.",
  IMAGE_FETCH_TIMEOUT: "Fetching the image timed out.",
  IMAGE_UNSUPPORTED_TYPE: "Image type is not supported by the extractor.",
  MIXED_CONTENT_BLOCKED: "HTTPS page blocked an HTTP image URL.",
  FRONTEND_RENDER_FAILED: "Browser could not render the image asset.",
  OG_IMAGE_NOT_FOUND: "No og:image or twitter:image metadata found.",
  ARTICLE_FETCH_FAILED: "Failed to download the article HTML.",
}

const getImageErrorLabel = (value?: string | null) => {
  if (!value) return "None"
  return IMAGE_ERROR_LABELS[value] || value
}

const getImageErrorDetails = (value?: string | null) => {
  if (!value) return ""
  return IMAGE_ERROR_DETAILS[value] || ""
}

function sourceStatsRowKey(
  source: SourceStats,
  index: number,
): string {
  return `${source.name}-${source.category}-${source.country}-${source.url}-${index}`
}

function debugArticleRowKey(
  articleId: number | string,
  fallback: string,
): string {
  return `${articleId}-${fallback}`
}

type UnknownRecord = Record<string, unknown>

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

interface BackendDebugReport {
  generated_at?: string
  summary?: {
    total_events?: number
    slow_operations?: number
    errors?: number
  }
  active_streams?: UnknownRecord[]
  recommendations?: string[]
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
  backendDebugReport: BackendDebugReport | null
  backendLogEvents: UnknownRecord[]
  backendSlowOps: UnknownRecord[]
  backendLogFiles: UnknownRecord[]
  frontendPerfData: ReturnType<typeof exportDebugData>
}

const DEBUG_TABS = [
  "system",
  "sources",
  "storage",
  "parser",
  "controls",
  "llm",
  "errors",
  "performance",
] as const

type DebugTab = (typeof DEBUG_TABS)[number]

const DEFAULT_DEBUG_TAB: DebugTab = "storage"

const isDebugTab = (value: string | null): value is DebugTab =>
  Boolean(value) && DEBUG_TABS.includes(value as DebugTab)

export default function DebugDashboardPage() {
  const router = useRouter()
  const [chromaLimit, setChromaLimit] = usePersistentNumber(25, 5, 500)
  const [chromaOffset, setChromaOffset] = usePersistentNumber(0, 0, 5000)

  const [dbLimit, setDbLimit] = usePersistentNumber(25, 5, 200)
  const [dbOffset, setDbOffset] = usePersistentNumber(0, 0, 5000)
  const [dbSortDirection, setDbSortDirection] = useState<"asc" | "desc">("desc")
  const [dbMissingOnly, setDbMissingOnly] = useState(false)
  const [dbSourceDraft, setDbSourceDraft] = useState("")
  const [dbSourceFilter, setDbSourceFilter] = useState<string | undefined>(undefined)
  const [dbBeforeDraft, setDbBeforeDraft] = useState("")
  const [dbBeforeFilter, setDbBeforeFilter] = useState<string | undefined>(undefined)
  const [dbAfterDraft, setDbAfterDraft] = useState("")
  const [dbAfterFilter, setDbAfterFilter] = useState<string | undefined>(undefined)

  const [cacheLimit, setCacheLimit] = usePersistentNumber(25, 5, 500)
  const [cacheOffset, setCacheOffset] = usePersistentNumber(0, 0, 5000)
  const [cacheSourceDraft, setCacheSourceDraft] = useState("")
  const [cacheSourceFilter, setCacheSourceFilter] = useState<string | undefined>(undefined)

  // Phase 3: New state for system status, log level, parser tester
  const [activeTab, setActiveTab] = useState<DebugTab>(DEFAULT_DEBUG_TAB)
  const [embedded, setEmbedded] = useState(false)
  const frontendDebugMode = useDebugMode()
  const [cacheRefreshRunning, setCacheRefreshRunning] = useState(false)
  const [cacheRefreshMessage, setCacheRefreshMessage] = useState<string | null>(null)
  const [cacheRefreshError, setCacheRefreshError] = useState<string | null>(null)

  // Parser tester state
  const [rssTestUrl, setRssTestUrl] = useState("")
  const [rssTestResult, setRssTestResult] = useState<RssParserTestResult | null>(null)
  const [rssTestLoading, setRssTestLoading] = useState(false)
  const [articleTestUrl, setArticleTestUrl] = useState("")
  const [articleTestResult, setArticleTestResult] = useState<ArticleParserTestResult | null>(null)
  const [articleTestLoading, setArticleTestLoading] = useState(false)

  // Performance logging state
  const dashboardDataQuery = useQuery<DashboardData>({
    queryKey: [
      "debug-dashboard",
      chromaLimit,
      chromaOffset,
      dbLimit,
      dbOffset,
      dbSourceFilter,
      dbMissingOnly,
      dbSortDirection,
      dbBeforeFilter,
      dbAfterFilter,
      cacheLimit,
      cacheOffset,
      cacheSourceFilter,
    ],
    queryFn: async () => {
      const [
        chromaData,
        dbData,
        driftData,
        startupMetrics,
        cacheData,
        cacheDelta,
      ] = await Promise.all([
        fetchChromaDebugArticles({ limit: chromaLimit, offset: chromaOffset }),
        fetchDatabaseDebugArticles({
          limit: dbLimit,
          offset: dbOffset,
          source: dbSourceFilter,
          missing_embeddings_only: dbMissingOnly,
          sort_direction: dbSortDirection,
          published_before: dbBeforeFilter,
          published_after: dbAfterFilter,
        }),
        fetchStorageDrift(100),
        fetchStartupMetrics(),
        fetchCacheDebugArticles({
          limit: cacheLimit,
          offset: cacheOffset,
          source: cacheSourceFilter,
        }),
        fetchCacheDelta({
          sample_limit: cacheLimit,
          sample_offset: cacheOffset,
          source: cacheSourceFilter,
          sample_preview_limit: 50,
        }),
      ])

      return {
        chromaData,
        dbData,
        driftData,
        startupMetrics,
        cacheData,
        cacheDelta,
      }
    },
    retry: 1,
  })
  const loadData = () => {
    void dashboardDataQuery.refetch()
  }
  const chromaData = dashboardDataQuery.data?.chromaData ?? null
  const dbData = dashboardDataQuery.data?.dbData ?? null
  const driftData = dashboardDataQuery.data?.driftData ?? null
  const startupMetrics = dashboardDataQuery.data?.startupMetrics ?? null
  const cacheData = dashboardDataQuery.data?.cacheData ?? null
  const cacheDelta = dashboardDataQuery.data?.cacheDelta ?? null
  const loading = dashboardDataQuery.isLoading
  const error =
    dashboardDataQuery.error instanceof Error
      ? dashboardDataQuery.error.message
      : null

  const systemStatusQuery = useQuery<SystemStatusResponse>({
    queryKey: ["debug-system-status"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/debug/system/status`)
      if (!response.ok) {
        throw new Error("Failed to load system status")
      }
      return (await response.json()) as SystemStatusResponse
    },
    retry: 1,
  })
  const systemStatus = systemStatusQuery.data ?? null

  const logLevelQuery = useQuery<LogLevelResponse>({
    queryKey: ["debug-log-level"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/debug/loglevel`)
      if (!response.ok) {
        throw new Error("Failed to load log level")
      }
      return (await response.json()) as LogLevelResponse
    },
    retry: 1,
  })
  const logLevel = logLevelQuery.data?.level ?? "INFO"

  const sourceStatsQuery = useQuery<SourceStats[]>({
    queryKey: ["debug-source-stats"],
    queryFn: fetchSourceStats,
    enabled: activeTab === "sources",
    retry: 1,
  })
  const cacheStatusQuery = useQuery<CacheStatus | null>({
    queryKey: ["debug-cache-status"],
    queryFn: fetchCacheStatus,
    enabled: activeTab === "sources",
    retry: 1,
  })
  const llmLogsQuery = useQuery<LlmLogResponse>({
    queryKey: ["debug-llm-logs"],
    queryFn: () => fetchLlmLogs({ limit: 50 }),
    enabled: activeTab === "llm",
    retry: 1,
  })
  const debugErrorsQuery = useQuery<DebugErrorsResponse>({
    queryKey: ["debug-errors"],
    queryFn: () => fetchDebugErrors({ limit: 50, includeRequestStreamEvents: true }),
    enabled: activeTab === "errors",
    retry: 1,
  })

  const performanceDataQuery = useQuery<PerformanceDebugData>({
    queryKey: ["debug-performance", activeTab],
    queryFn: async () => {
      const [reportResponse, eventsResponse, slowResponse, filesResponse] =
        await Promise.all([
          fetch(`${API_BASE_URL}/debug/logs/report`),
          fetch(`${API_BASE_URL}/debug/logs/events?limit=100`),
          fetch(`${API_BASE_URL}/debug/logs/slow`),
          fetch(`${API_BASE_URL}/debug/logs/files`),
        ])

      const report = reportResponse.ok
        ? ((await reportResponse.json()) as BackendDebugReport)
        : null
      const eventsData = eventsResponse.ok ? await eventsResponse.json() : {}
      const slowData = slowResponse.ok ? await slowResponse.json() : {}
      const filesData = filesResponse.ok ? await filesResponse.json() : {}

      return {
        backendDebugReport: report,
        backendLogEvents: Array.isArray(eventsData.events)
          ? (eventsData.events as UnknownRecord[])
          : [],
        backendSlowOps: Array.isArray(slowData.operations)
          ? (slowData.operations as UnknownRecord[])
          : [],
        backendLogFiles: Array.isArray(filesData.files)
          ? (filesData.files as UnknownRecord[])
          : [],
        frontendPerfData: exportDebugData(),
      }
    },
    enabled: activeTab === "performance",
    retry: 1,
    refetchInterval: activeTab === "performance" ? 5000 : false,
  })
  const backendDebugReport = performanceDataQuery.data?.backendDebugReport ?? null
  const frontendPerfData = performanceDataQuery.data?.frontendPerfData ?? null
  const backendLogEvents = performanceDataQuery.data?.backendLogEvents ?? []
  const backendSlowOps = performanceDataQuery.data?.backendSlowOps ?? []
  const backendLogFiles = performanceDataQuery.data?.backendLogFiles ?? []
  const loadPerformanceData = () => {
    void performanceDataQuery.refetch()
  }

  const loadSystemStatus = () => {
    void systemStatusQuery.refetch()
  }

  const loadLogLevel = () => {
    void logLevelQuery.refetch()
  }
  const loadSourceData = () => {
    void sourceStatsQuery.refetch()
    void cacheStatusQuery.refetch()
  }
  const loadLlmLogs = () => {
    void llmLogsQuery.refetch()
  }
  const loadDebugErrors = () => {
    void debugErrorsQuery.refetch()
  }

  const handleSetLogLevel = async (level: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/debug/loglevel?level=${level}`, {
        method: "POST",
      })
      if (response.ok) {
        await loadLogLevel()
      }
    } catch (err) {
      logger.error("Failed to set log level", err)
    }
  }

  const handleToggleFrontendDebug = () => {
    setDebugMode(!frontendDebugMode)
  }

  const handleRefreshCache = async () => {
    setCacheRefreshRunning(true)
    setCacheRefreshError(null)
    setCacheRefreshMessage("Starting cache refresh...")
    try {
      const success = await refreshCache((event) => {
        const message =
          event.message ||
          (event.source
            ? `Processed ${event.source}${event.articlesFromSource != null ? ` · ${event.articlesFromSource} articles` : ""}`
            : null) ||
          (event.totalSourcesProcessed != null
            ? `Processed ${event.totalSourcesProcessed} sources`
            : "Refreshing cache...")
        setCacheRefreshMessage(message)
      })
      if (!success) {
        throw new Error("Cache refresh did not complete successfully.")
      }
      setCacheRefreshMessage("Cache refresh completed.")
      loadSourceData()
      loadSystemStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cache refresh failed."
      setCacheRefreshError(message)
      setCacheRefreshMessage(null)
    } finally {
      setCacheRefreshRunning(false)
    }
  }

  const chromaStats = useMemo(() => {
    if (!chromaData) return null
    return {
      total: chromaData.total ?? chromaData.returned,
      showing: chromaData.returned,
    }
  }, [chromaData])

  const dbStats = useMemo(() => {
    if (!dbData) return null
    return {
      total: dbData.total,
      showing: dbData.returned,
      oldest: dbData.oldest_published,
      newest: dbData.newest_published,
    }
  }, [dbData])

  const cacheStats = useMemo(() => {
    if (!cacheData) return null
    return {
      total: cacheData.total,
      showing: cacheData.returned,
    }
  }, [cacheData])

  const driftStats = useMemo(() => driftData, [driftData])

  const missingSamples = useMemo(
    () => driftData?.missing_in_chroma?.slice(0, 20) ?? [],
    [driftData?.missing_in_chroma]
  )
  const danglingSamples = useMemo(
    () => driftData?.dangling_in_chroma?.slice(0, 20) ?? [],
    [driftData?.dangling_in_chroma]
  )

  const startupEvents = useMemo(() => {
    if (!startupMetrics?.events?.length) {
      return []
    }
    return [...startupMetrics.events].sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0
      return aTime - bTime
    })
  }, [startupMetrics?.events])

  const formatTimestamp = (value?: string | null) => {
    if (!value) return "—"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString()
  }

  const formatDuration = (value?: number | null, fallback = "—") => {
    if (value == null) return fallback
    if (value > 1000) {
      return `${Math.round(value).toLocaleString()}s`
    }
    return `${value.toFixed(2)}s`
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const tab = params.get("tab")
    setEmbedded(params.get("embedded") === "1")
    if (isDebugTab(tab)) {
      setActiveTab(tab)
    }
  }, [])

  const sourceStats = sourceStatsQuery.data ?? []
  const cacheStatus = cacheStatusQuery.data ?? null
  const llmLogs = llmLogsQuery.data ?? null
  const debugErrors = debugErrorsQuery.data ?? null
  const healthySources = sourceStats.filter((source) => source.status === "success").length
  const warningSources = sourceStats.filter((source) => source.status === "warning").length
  const failedSources = sourceStats.filter((source) => source.status === "error").length
  const sourceStatusTone = (status: SourceStats["status"]) => {
    switch (status) {
      case "success":
        return "text-emerald-600 dark:text-emerald-400"
      case "warning":
        return "text-amber-600 dark:text-amber-400"
      default:
        return "text-red-600 dark:text-red-400"
    }
  }

  const handleTabChange = (value: string) => {
    if (!isDebugTab(value)) return
    setActiveTab(value)
    const nextParams = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    )
    nextParams.set("tab", value)
    router.replace(`/debug?${nextParams.toString()}`)
    if (value === "performance") {
      loadPerformanceData()
    } else if (value === "sources") {
      loadSourceData()
    } else if (value === "llm") {
      loadLlmLogs()
    } else if (value === "errors") {
      loadDebugErrors()
    }
  }

  const formatMetadataValue = (value: unknown): string | null => {
    if (value == null) return null
    if (typeof value === "number") return value.toString()
    if (typeof value === "string") return value
    if (typeof value === "boolean") return value ? "true" : "false"
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const renderMetadataBadges = (metadata?: Record<string, unknown>) => {
    if (!metadata) return null
    const descriptors = [
      { label: "cache", key: "cache_size" },
      { label: "migrated", key: "article_count" },
      { label: "vectors", key: "documents" },
    ]

    return descriptors.map(({ label, key }) => {
      const value = formatMetadataValue(metadata[key])
      if (!value) return null
      return (
        <span key={`${label}-${value}`} className="ml-1 text-muted-foreground">
          • {label}: {value}
        </span>
      )
    })
  }

  const applyDbFilters = () => {
    setDbSourceFilter(dbSourceDraft.trim() || undefined)
    setDbBeforeFilter(dbBeforeDraft || undefined)
    setDbAfterFilter(dbAfterDraft || undefined)
  }

  const applyCacheFilters = () => {
    setCacheSourceFilter(cacheSourceDraft.trim() || undefined)
  }

  // Phase 3: Test RSS parser
  const testRssParser = async () => {
    if (!rssTestUrl.trim()) return
    setRssTestLoading(true)
    setRssTestResult(null)
    try {
      const response = await fetch(
        `${API_BASE_URL}/debug/parser/test/rss?url=${encodeURIComponent(rssTestUrl)}&max_entries=5`,
        { method: "POST" }
      )
      const data = await response.json()
      setRssTestResult(data)
    } catch (err) {
      setRssTestResult({ error: err instanceof Error ? err.message : "Test failed" })
    } finally {
      setRssTestLoading(false)
    }
  }

  // Phase 3: Test article parser
  const testArticleParser = async () => {
    if (!articleTestUrl.trim()) return
    setArticleTestLoading(true)
    setArticleTestResult(null)
    try {
      const response = await fetch(
        `${API_BASE_URL}/debug/parser/test/article?url=${encodeURIComponent(articleTestUrl)}`,
        { method: "POST" }
      )
      const data = await response.json()
      setArticleTestResult(data)
    } catch (err) {
      setArticleTestResult({ error: err instanceof Error ? err.message : "Test failed" })
    } finally {
      setArticleTestLoading(false)
    }
  }

  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      {!embedded && <GlobalNavigation />}
      <div className={`flex-1 overflow-y-auto relative z-10 custom-scrollbar ${embedded ? "p-4" : "p-6"}`}>
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
                  <Link href="/wiki">Open Wiki</Link>
                </Button>
                <Button onClick={loadData} variant="default">
                  Refresh data
                </Button>
              </div>
            </div>
          )}

      {error && (
        <Card className="border-red-500/30 bg-red-500/10 bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
          <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
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

        {/* System Status Tab */}
        <TabsContent value="system" className="space-y-4">
          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">System Status</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Component health and runtime information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {systemStatus ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="font-medium mb-2">Components</h3>
                    <div className="space-y-2 text-sm">
                      <p>
                        Cache: {systemStatus.components?.cache?.healthy ? "Healthy" : "Unhealthy"}
                        ({systemStatus.components?.cache?.article_count} articles)
                      </p>
                      <p>
                        Cache updated: {formatTimestamp(systemStatus.components?.cache?.last_updated)}
                      </p>
                      <p>
                        Cache age: {formatDuration(systemStatus.components?.cache?.age_seconds)}
                      </p>
                      <p>
                        Cache refresh: {systemStatus.components?.cache?.update_in_progress ? "Running" : "Idle"}
                      </p>
                      <p>
                        Cache updates: {systemStatus.components?.cache?.update_count ?? "—"}
                      </p>
                      <p>
                        Incremental cache: {systemStatus.components?.cache?.incremental_enabled ? "Enabled" : "Disabled"}
                      </p>
                      <p>
                        Sources tracked: {systemStatus.components?.cache?.sources_tracked ?? "—"}
                      </p>
                      <p>
                        Database: {systemStatus.components?.database?.healthy ? "Healthy" : "Unavailable"}
                      </p>
                      <p>
                        Vector Store: {systemStatus.components?.vector_store?.healthy ? "Healthy" : "Unavailable"}
                      </p>
                      <p>
                        Embedding queue: {systemStatus.components?.embedding_queue?.depth ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">Runtime</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>Python: {systemStatus.runtime?.python_version?.split(" ")[0]}</p>
                      <p>Platform: {systemStatus.runtime?.platform}</p>
                      <p>PID: {systemStatus.runtime?.pid}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Loading system status...</p>
              )}
              <Button variant="outline" size="sm" onClick={loadSystemStatus}>
                Refresh Status
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Pipeline Signals</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">RSS fetch cadence, cache behavior, and embeddings</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3 text-sm">
              <div>
                <p className="text-muted-foreground">ETag hits</p>
                <p className="text-lg font-semibold">
                  {systemStatus?.pipeline?.fetch?.not_modified ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Not-modified responses in current run
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Fetch errors</p>
                <p className="text-lg font-semibold">
                  {systemStatus?.pipeline?.fetch?.errors ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Failures during feed fetch
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Embedding queue depth</p>
                <p className="text-lg font-semibold">
                  {systemStatus?.components?.embedding_queue?.depth ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Batch size {systemStatus?.components?.embedding_queue?.batch_size ?? "—"} ·
                  max/min {systemStatus?.components?.embedding_queue?.max_per_minute ?? "—"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Startup Timeline (existing content) */}
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
                      <TableCell className="font-medium capitalize">{event.name.replace(/_/g, " ")}</TableCell>
                      <TableCell>{formatDuration(event.durationSeconds)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {event.detail || "-"}
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
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium font-serif">Ingestion And Sources</h2>
              <p className="text-sm text-muted-foreground">
                Source health, cache coverage, and refresh controls in one place.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={loadSourceData}>
                Refresh source data
              </Button>
              <Button onClick={handleRefreshCache} disabled={cacheRefreshRunning}>
                {cacheRefreshRunning ? "Refreshing cache..." : "Run cache refresh"}
              </Button>
            </div>
          </div>

          {(cacheRefreshMessage || cacheRefreshError) && (
            <Card className={cacheRefreshError ? "border-red-500/30 bg-red-500/10 bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg" : "bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg"}>
              <CardContent className="py-4 text-sm">
                {cacheRefreshError || cacheRefreshMessage}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Total Sources</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {cacheStatus?.total_sources ?? sourceStats.length}
              </CardContent>
            </Card>
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Healthy</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                {cacheStatus?.sources_working ?? healthySources}
              </CardContent>
            </Card>
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Warnings</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-amber-600 dark:text-amber-400">
                {cacheStatus?.sources_with_warnings ?? warningSources}
              </CardContent>
            </Card>
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Errors</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-red-600 dark:text-red-400">
                {cacheStatus?.sources_with_errors ?? failedSources}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_1.8fr]">
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Cache Snapshot</CardTitle>
                <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
                  Last update {formatTimestamp(cacheStatus?.last_updated)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Total cached articles: {cacheStatus?.total_articles ?? "—"}</p>
                <p>Refresh state: {cacheStatus?.update_in_progress ? "Running" : "Idle"}</p>
                <p>Cache age: {formatDuration(cacheStatus?.cache_age_seconds)}</p>
                <div className="space-y-1">
                  <p className="font-medium">Category breakdown</p>
                  {cacheStatus?.category_breakdown && Object.keys(cacheStatus.category_breakdown).length > 0 ? (
                    <div className="space-y-1 text-muted-foreground">
                      {Object.entries(cacheStatus.category_breakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([category, count]) => (
                          <div key={category} className="flex items-center justify-between">
                            <span>{category}</span>
                            <span>{count}</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No category breakdown available.</p>
                  )}
                </div>
              </CardContent>
            </Card>

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
                          <TableHead>Source</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Country</TableHead>
                          <TableHead>Articles</TableHead>
                          <TableHead>Checked</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sourceStats.map((source, index) => (
                          <TableRow key={sourceStatsRowKey(source, index)}>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="font-medium">{source.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {source.category} · {source.funding_type || "unknown funding"}
                                </div>
                                {source.error_message && (
                                  <div className="text-xs text-red-600 dark:text-red-400">
                                    {source.error_message}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className={sourceStatusTone(source.status)}>
                              {source.status}
                            </TableCell>
                            <TableCell>{source.country || "—"}</TableCell>
                            <TableCell>{source.article_count}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatTimestamp(source.last_checked)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No source statistics available.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Storage Tab (existing content) */}
        <TabsContent value="storage" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Cache Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Total cached: {cacheStats?.total ?? "-"}</p>
                <p>Showing: {cacheStats?.showing ?? "-"}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span>Limit</span>
                  <Select
                    value={String(cacheLimit)}
                    onValueChange={(value) => setCacheLimit(Number(value))}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50, 100, 200, 500].map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span>Offset</span>
                  <Input
                    type="number"
                    className="w-24"
                    value={cacheOffset}
                    onChange={(event) => setCacheOffset(Number(event.target.value))}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Chroma Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Total vectors: {chromaStats?.total ?? "-"}</p>
                <p>Showing: {chromaStats?.showing ?? "-"}</p>
                <div className="flex items-center gap-2">
                  <span>Limit</span>
                  <Select
                    value={String(chromaLimit)}
                    onValueChange={(value) => setChromaLimit(Number(value))}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50, 100, 200, 500].map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span>Offset</span>
                  <Input
                    type="number"
                    className="w-24"
                    value={chromaOffset}
                    onChange={(event) => setChromaOffset(Number(event.target.value))}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Database Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Total rows: {dbStats?.total ?? "-"}</p>
                <p>Showing: {dbStats?.showing ?? "-"}</p>
                <p>
                  Range: {dbStats?.oldest ? new Date(dbStats.oldest).toLocaleString() : "?"} → {" "}
                  {dbStats?.newest ? new Date(dbStats.newest).toLocaleString() : "?"}
                </p>
                <div className="flex flex-wrap gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={dbMissingOnly}
                      onChange={(event) => setDbMissingOnly(event.target.checked)}
                    />
                    Missing embeddings only
                  </label>
                  <Select
                    value={dbSortDirection}
                    onValueChange={(value: "asc" | "desc") => setDbSortDirection(value)}
                  >
                    <SelectTrigger className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="desc">Newest first</SelectItem>
                      <SelectItem value="asc">Oldest first</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    className="w-24"
                    value={dbOffset}
                    onChange={(event) => setDbOffset(Number(event.target.value))}
                    placeholder="Offset"
                  />
                  <Input
                    type="number"
                    className="w-24"
                    value={dbLimit}
                    onChange={(event) => setDbLimit(Number(event.target.value))}
                    placeholder="Limit"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Storage Drift</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>DB rows with embeddings: {driftStats?.database_with_embeddings ?? "-"}</p>
                <p>Chroma vectors: {driftStats?.vector_total_documents ?? "-"}</p>
                <p>Missing in Chroma: {driftStats?.missing_in_chroma_count ?? "-"}</p>
                <p>Dangling in Chroma: {driftStats?.dangling_in_chroma_count ?? "-"}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="font-serif">Cache filters</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Source (e.g. bbc)"
                  className="w-40"
                  value={cacheSourceDraft}
                  onChange={(event) => setCacheSourceDraft(event.target.value)}
                />
                <Button variant="secondary" onClick={applyCacheFilters}>
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
                  onChange={(event) => setDbSourceDraft(event.target.value)}
                />
                <Input
                  type="datetime-local"
                  className="w-56"
                  value={dbAfterDraft}
                  onChange={(event) => setDbAfterDraft(event.target.value)}
                  placeholder="Published after"
                />
                <Input
                  type="datetime-local"
                  className="w-56"
                  value={dbBeforeDraft}
                  onChange={(event) => setDbBeforeDraft(event.target.value)}
                  placeholder="Published before"
                />
                <Button variant="secondary" onClick={applyDbFilters}>
                  Apply filters
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Cache vs database delta</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Compares the current cache window against Postgres</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
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

              <div>
                <p className="text-xs text-muted-foreground mb-2">Missing cache URLs (sample)</p>
                <div className="max-h-40 overflow-auto rounded border border-border bg-muted/30 p-3 text-xs">
                  {cacheDelta?.missing_in_db_sample?.length ? (
                    <ul className="space-y-1">
                      {cacheDelta.missing_in_db_sample.map((url) => (
                        <li key={url} className="break-all">{url}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No missing URLs in sample.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Startup timeline</CardTitle>
              <p className="text-sm text-muted-foreground">
                Breakdown of backend startup phases: DB init, cache preload, vector store, and RSS refresh.
              </p>
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
                      <TableCell className="font-medium capitalize">{event.name.replace(/_/g, " ")}</TableCell>
                      <TableCell>{formatDuration(event.durationSeconds)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {event.detail || "—"}
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
                        String(article.metadata?.source || "unknown"),
                      )}
                    >
                      <TableCell className="font-mono text-xs">{article.id}</TableCell>
                      <TableCell>{String(article.metadata?.title || "(no title)")}</TableCell>
                      <TableCell>{String(article.metadata?.source || "?")}</TableCell>
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
                  {cacheData?.articles?.map((article, index) => (
                    <TableRow key={`${article.link}-${index}`}>
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
                        {article.published ? new Date(article.published).toLocaleString() : "-"}
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

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Drift samples</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Articles missing in Chroma</h3>
                <ul className="space-y-1 text-xs">
                  {missingSamples.length > 0 ? (
                    missingSamples.map((entry) => (
                      <li
                        key={debugArticleRowKey(entry.id, entry.chroma_id || "missing")}
                        className="rounded bg-muted p-2"
                      >
                        #{entry.id} - {entry.chroma_id || "(no chroma id)"}
                      </li>
                    ))
                  ) : (
                    <li className="text-muted-foreground">No gaps detected.</li>
                  )}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Dangling Chroma IDs</h3>
                <ul className="space-y-1 text-xs">
                  {danglingSamples.length > 0 ? (
                    danglingSamples.map((chromaId) => (
                      <li key={chromaId} className="rounded bg-muted p-2 font-mono">
                        {chromaId}
                      </li>
                    ))
                  ) : (
                    <li className="text-muted-foreground">No extra vectors detected.</li>
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Parser Tester Tab */}
        <TabsContent value="parser" className="space-y-4">
          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">RSS Feed Parser</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Test RSS parsing on any feed URL</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter RSS feed URL..."
                  value={rssTestUrl}
                  onChange={(e) => setRssTestUrl(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={testRssParser} disabled={rssTestLoading}>
                  {rssTestLoading ? "Testing..." : "Test Feed"}
                </Button>
              </div>
              {rssTestResult && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={rssTestResult.success ? "text-green-600" : "text-red-600"}>
                      {rssTestResult.success ? "Success" : "Failed"}
                    </span>
                    {rssTestResult.parse_time_seconds && (
                      <span className="text-sm text-muted-foreground">
                        ({rssTestResult.parse_time_seconds}s)
                      </span>
                    )}
                  </div>
                  {rssTestResult.feed_info && (
                    <div className="text-sm">
                      <p><strong>Title:</strong> {rssTestResult.feed_info.title}</p>
                      <p><strong>Entries:</strong> {rssTestResult.status?.entries_count}</p>
                    </div>
                  )}
                  {(rssTestResult.sample_entries ?? []).length > 0 && (
                    <div className="mt-2">
                      <h4 className="font-medium text-sm mb-2">Sample Entries</h4>
                      <div className="space-y-2">
                {(rssTestResult.sample_entries ?? []).map((entry: RssSampleEntry, idx: number) => (
                  <div key={idx} className="text-xs p-2 bg-muted rounded">
                    <p className="font-medium">{entry.title}</p>
                    <p className="text-muted-foreground">
                      Image: {entry.image_extraction?.image_url || getImageErrorLabel(entry.image_extraction?.image_error) || "None"}
                    </p>
                    {entry.image_extraction?.selected_source && (
                      <p className="text-muted-foreground">Source: {entry.image_extraction.selected_source}</p>
                    )}
                    {entry.image_extraction?.image_error && (
                      <p className="text-muted-foreground">
                        Error detail: {getImageErrorDetails(entry.image_extraction?.image_error) || entry.image_extraction?.image_error_details}
                      </p>
                    )}
                  </div>
                ))}
                      </div>
                    </div>
                  )}
                  {rssTestResult.error && (
                    <p className="text-sm text-red-600">{rssTestResult.error}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Article Image Extractor</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Test og:image extraction from article pages</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter article URL..."
                  value={articleTestUrl}
                  onChange={(e) => setArticleTestUrl(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={testArticleParser} disabled={articleTestLoading}>
                  {articleTestLoading ? "Testing..." : "Extract Image"}
                </Button>
              </div>
              {articleTestResult && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={articleTestResult.success ? "text-green-600" : "text-red-600"}>
                      {articleTestResult.success ? "Found" : "Not Found"}
                    </span>
                  </div>
                  {articleTestResult.image_url && (
                    <div className="space-y-2">
                      <p className="text-sm break-all">{articleTestResult.image_url}</p>
                      <SafeImage
                        src={articleTestResult.image_url}
                        alt="Preview"
                        width={320}
                        height={180}
                        className="max-w-xs rounded border"
                      />
                    </div>
                  )}
                  {(articleTestResult.candidates ?? []).length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-1">All Candidates</h4>
                      <ul className="text-xs space-y-1">
                        {(articleTestResult.candidates ?? []).map((c: ArticleCandidate, idx: number) => (
                          <li key={idx} className="p-1 bg-muted rounded">
                            [{c.priority}] {c.source}: {c.url?.slice(0, 60)}...
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {articleTestResult.error && (
                    <p className="text-sm text-red-600">
                      {getImageErrorLabel(articleTestResult.error)}: {articleTestResult.error_details || getImageErrorDetails(articleTestResult.error)}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

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
                    <div className="text-xs text-muted-foreground">{IMAGE_ERROR_DETAILS[key]}</div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logging Tab */}
        <TabsContent value="controls" className="space-y-4">
          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Backend Log Level</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Change runtime log verbosity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="text-sm">Current level:</span>
                <Select value={logLevel} onValueChange={handleSetLogLevel}>
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
                    onChange={handleToggleFrontendDebug}
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

        <TabsContent value="llm" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium font-serif">LLM Calls</h2>
              <p className="text-sm text-muted-foreground">
                Parsed model calls with latency and outcome details.
              </p>
            </div>
            <Button variant="outline" onClick={loadLlmLogs}>
              Refresh LLM logs
            </Button>
          </div>

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
              <div>
                <p className="text-sm text-muted-foreground">Returned</p>
                <p className="text-2xl font-semibold">{llmLogs?.returned ?? 0}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Successes</p>
                <p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                  {llmLogs?.entries.filter((entry) => entry.success).length ?? 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Failures</p>
                <p className="text-2xl font-semibold text-red-600 dark:text-red-400">
                  {llmLogs?.entries.filter((entry) => entry.success === false).length ?? 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg latency</p>
                <p className="text-2xl font-semibold">
                  {llmLogs?.entries.length
                    ? `${Math.round(
                        llmLogs.entries.reduce(
                          (total, entry) => total + (entry.duration_ms ?? 0),
                          0,
                        ) / llmLogs.entries.length,
                      )}ms`
                    : "—"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Recent Calls</CardTitle>
            </CardHeader>
            <CardContent>
              {llmLogs?.entries.length ? (
                <div className="space-y-3 max-h-[36rem] overflow-y-auto">
                  {llmLogs.entries.map((entry, index) => (
                    <div key={`${entry.request_id || "llm"}-${index}`} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {entry.service || "unknown service"} · {entry.model || "unknown model"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTimestamp(entry.timestamp)} · request {entry.request_id || "n/a"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className={entry.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                            {entry.success ? "success" : "failed"}
                          </span>
                          <span>{entry.duration_ms != null ? `${Math.round(entry.duration_ms)}ms` : "—"}</span>
                          <span>{entry.messages?.length ?? 0} messages</span>
                        </div>
                      </div>
                      {(entry.error_type || entry.error_message || entry.finish_reason) && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {entry.finish_reason && <span>Finish: {entry.finish_reason}</span>}
                          {entry.error_type && <span className="ml-3">Type: {entry.error_type}</span>}
                          {entry.error_message && <span className="ml-3">{entry.error_message}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No LLM calls logged yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium font-serif">Errors</h2>
              <p className="text-sm text-muted-foreground">
                Combined API error log plus recent request and stream failures.
              </p>
            </div>
            <Button variant="outline" onClick={loadDebugErrors}>
              Refresh errors
            </Button>
          </div>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Error Summary</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
                {debugErrors?.log_file.available
                  ? `${debugErrors.log_file.total} API errors logged`
                  : "Session error log file not available."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Logged API errors</p>
                <p className="text-2xl font-semibold">
                  {debugErrors?.log_file.total ?? 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recent request/stream errors</p>
                <p className="text-2xl font-semibold text-red-600 dark:text-red-400">
                  {debugErrors?.returned_recent_errors ?? 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Showing</p>
                <p className="text-2xl font-semibold">
                  {(debugErrors?.log_file.entries.length ?? 0) + (debugErrors?.recent_request_stream_errors.length ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Recent Failures</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {debugErrors && (debugErrors.log_file.entries.length > 0 || debugErrors.recent_request_stream_errors.length > 0) ? (
                <>
                  {debugErrors.log_file.entries.map((entry, index) => (
                    <div key={`log-${entry.request_id || index}`} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {entry.service || "unknown service"} · {entry.model || "unknown model"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTimestamp(entry.timestamp)} · request {entry.request_id || "n/a"}
                          </p>
                        </div>
                        <span className="text-red-600 dark:text-red-400">
                          {entry.error_type || "error"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {entry.error_message || "No error message recorded."}
                      </p>
                    </div>
                  ))}
                  {debugErrors.recent_request_stream_errors.map((entry, index) => (
                    <div key={`event-${entry.request_id || index}`} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {entry.event_type || entry.component || "request error"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTimestamp(entry.timestamp)} · request {entry.request_id || "n/a"}
                          </p>
                        </div>
                        <span className="text-red-600 dark:text-red-400">
                          {entry.operation || "request"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {entry.message || entry.error_message || "No error message recorded."}
                      </p>
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No recent errors logged.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium font-serif">Performance Debugging</h2>
            <Button onClick={loadPerformanceData} variant="outline" size="sm">
              Refresh
            </Button>
          </div>

          {/* Backend Debug Report Summary */}
          {backendDebugReport && (
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Backend Debug Report</CardTitle>
                <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
                  Generated at {backendDebugReport.generated_at ? new Date(String(backendDebugReport.generated_at)).toLocaleString() : "unknown"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <p className="text-2xl font-bold">{backendDebugReport.summary?.total_events ?? 0}</p>
                    <p className="text-sm text-muted-foreground">Total Events</p>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <p className="text-2xl font-bold text-yellow-600">
                      {backendDebugReport.summary?.slow_operations ?? 0}
                    </p>
                    <p className="text-sm text-muted-foreground">Slow Operations</p>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <p className="text-2xl font-bold text-red-600">
                      {backendDebugReport.summary?.errors ?? 0}
                    </p>
                    <p className="text-sm text-muted-foreground">Errors</p>
                  </div>
                </div>

                {/* Active Streams */}
                {(backendDebugReport.active_streams ?? []).length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2">Active Streams</h3>
                    <div className="space-y-2">
                      {(backendDebugReport.active_streams ?? []).map((stream: Record<string, unknown>, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                          <span className="font-mono">{String(stream.stream_id).substring(0, 8)}...</span>
                          <span>{stream.request_path as string}</span>
                          <span className="text-muted-foreground">
                            {((stream.duration_so_far as number) || 0).toFixed(1)}s
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {(backendDebugReport.recommendations ?? []).length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2">Recommendations</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {(backendDebugReport.recommendations ?? []).map((rec: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-yellow-500">!</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Slow Operations */}
          {backendSlowOps.length > 0 && (
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Slow Operations</CardTitle>
                <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Operations exceeding performance thresholds</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {backendSlowOps.map((op: Record<string, unknown>, idx: number) => (
                    <div
                      key={idx}
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
                          {op.stream_id ? String(op.stream_id).substring(0, 8) : op.request_id ? String(op.request_id).substring(0, 8) : ""}
                        </span>
                      </div>
                      <span className="text-red-600 font-medium">
                        {typeof op.duration_ms === "number" ? `${op.duration_ms.toFixed(0)}ms` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Backend Events */}
          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Recent Backend Events</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Last 100 debug events from the backend</CardDescription>
            </CardHeader>
            <CardContent>
              {backendLogEvents.length > 0 ? (
                <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-xs">
                  {backendLogEvents.slice(0, 50).map((event: Record<string, unknown>, idx: number) => (
                    <div key={idx} className="flex items-start gap-2 p-1 hover:bg-muted rounded">
                      <span className="text-muted-foreground w-20 flex-shrink-0">
                        {new Date(event.timestamp as string).toLocaleTimeString()}
                      </span>
                      <span className={`px-1 rounded text-xs flex-shrink-0 ${
                        event.event_type === "error" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                        event.event_type === "stream_event" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                        event.event_type === "request_start" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      }`}>
                        {String(event.event_type)}
                      </span>
                      <span className="flex-1 truncate">{String(event.message || "")}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No events logged yet</p>
              )}
            </CardContent>
          </Card>

          {/* Frontend Performance */}
          {frontendPerfData && (
            <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
              <CardHeader>
                <CardTitle className="font-serif">Frontend Performance</CardTitle>
                <CardDescription className="font-mono text-[10px] tracking-widest uppercase">Browser-side metrics and stream tracking</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <p className="text-xl font-bold">{frontendPerfData.summary.totalEvents}</p>
                    <p className="text-xs text-muted-foreground">Total Events</p>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <p className="text-xl font-bold text-red-600">{frontendPerfData.summary.errorCount}</p>
                    <p className="text-xs text-muted-foreground">Errors</p>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <p className="text-xl font-bold">{frontendPerfData.activeStreams.length}</p>
                    <p className="text-xs text-muted-foreground">Active Streams</p>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <p className="text-xl font-bold">{frontendPerfData.summary.slowOperationsCount}</p>
                    <p className="text-xs text-muted-foreground">Slow Operations</p>
                  </div>
                </div>

                {/* Active Frontend Streams */}
                {frontendPerfData.activeStreams.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2 text-sm">Active Frontend Streams</h3>
                    <div className="space-y-1">
                      {frontendPerfData.activeStreams.map((stream, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                          <span className="font-mono text-xs">{stream.streamId.substring(0, 12)}...</span>
                          <span>{stream.eventCount} events</span>
                          <span className="text-muted-foreground">
                            {((Date.now() - stream.startTime) / 1000).toFixed(1)}s
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Frontend Events */}
                <div>
                  <h3 className="font-medium mb-2 text-sm">Recent Frontend Events</h3>
                  <div className="space-y-1 max-h-40 overflow-y-auto font-mono text-xs">
                    {frontendPerfData.recentEvents.slice(-20).reverse().map((event, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-1 hover:bg-muted rounded">
                        <span className="text-muted-foreground w-20 flex-shrink-0">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`px-1 rounded ${
                          event.eventType === "error" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                          event.eventType === "stream_event" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                          "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        }`}>
                          {event.eventType}
                        </span>
                        <span className="flex-1 truncate">{event.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Log Files Browser */}
          <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif">Debug Log Files</CardTitle>
              <CardDescription className="font-mono text-[10px] tracking-widest uppercase">JSON Lines log files saved on the backend</CardDescription>
            </CardHeader>
            <CardContent>
              {backendLogFiles.length > 0 ? (
                <div className="space-y-2">
                  {backendLogFiles.map((file: Record<string, unknown>, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-2 border rounded text-sm">
                      <div>
                        <span className="font-mono">{String(file.filename)}</span>
                        <span className="ml-2 text-muted-foreground text-xs">
                          {typeof file.size_bytes === "number" ? `${(file.size_bytes / 1024).toFixed(1)} KB` : ""}
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
        </TabsContent>
      </Tabs >
        </div>
      </div>
    </div>
  )
}
