"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
  fetchChromaDebugArticles,
  fetchDatabaseDebugArticles,
  fetchStorageDrift,
  fetchStartupMetrics,
  API_BASE_URL,
} from "@/lib/api"
import { logger, isDebugMode, setDebugMode } from "@/lib/logger"

function usePersistentNumber(initial: number, min: number, max: number): [number, (value: number) => void] {
  const [value, setValue] = useState(initial)
  const clampAndSet = (next: number) => {
    const clamped = Math.min(Math.max(next, min), max)
    setValue(clamped)
  }
  return [value, clampAndSet]
}

export default function DebugDashboardPage() {
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

  const [chromaData, setChromaData] = useState<ChromaDebugResponse | null>(null)
  const [dbData, setDbData] = useState<DatabaseDebugResponse | null>(null)
  const [driftData, setDriftData] = useState<StorageDriftReport | null>(null)
  const [startupMetrics, setStartupMetrics] = useState<StartupMetricsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Phase 3: New state for system status, log level, parser tester
  const [activeTab, setActiveTab] = useState("storage")
  const [systemStatus, setSystemStatus] = useState<any>(null)
  const [logLevel, setLogLevel] = useState<string>("INFO")
  const [frontendDebugMode, setFrontendDebugMode] = useState(false)

  // Parser tester state
  const [rssTestUrl, setRssTestUrl] = useState("")
  const [rssTestResult, setRssTestResult] = useState<any>(null)
  const [rssTestLoading, setRssTestLoading] = useState(false)
  const [articleTestUrl, setArticleTestUrl] = useState("")
  const [articleTestResult, setArticleTestResult] = useState<any>(null)
  const [articleTestLoading, setArticleTestLoading] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [chromaResponse, dbResponse, driftResponse, startupResponse] = await Promise.all([
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
      ])
      setChromaData(chromaResponse)
      setDbData(dbResponse)
      setDriftData(driftResponse)
      setStartupMetrics(startupResponse)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load debug data"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [
    chromaLimit,
    chromaOffset,
    dbLimit,
    dbOffset,
    dbSourceFilter,
    dbMissingOnly,
    dbSortDirection,
    dbBeforeFilter,
    dbAfterFilter,
  ])

  useEffect(() => {
    loadData()
  }, [loadData])

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
    return `${value.toFixed(2)}s`
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

  // Phase 3: Load system status
  const loadSystemStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/debug/system/status`)
      if (response.ok) {
        const data = await response.json()
        setSystemStatus(data)
      }
    } catch (err) {
      logger.error("Failed to load system status", err)
    }
  }, [])

  // Phase 3: Load backend log level
  const loadLogLevel = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/debug/loglevel`)
      if (response.ok) {
        const data = await response.json()
        setLogLevel(data.level)
      }
    } catch (err) {
      logger.error("Failed to load log level", err)
    }
  }, [])

  // Phase 3: Set backend log level
  const handleSetLogLevel = async (level: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/debug/loglevel?level=${level}`, {
        method: "POST",
      })
      if (response.ok) {
        const data = await response.json()
        setLogLevel(data.level)
      }
    } catch (err) {
      logger.error("Failed to set log level", err)
    }
  }

  // Phase 3: Toggle frontend debug mode
  const handleToggleFrontendDebug = () => {
    const newMode = !frontendDebugMode
    setDebugMode(newMode)
    setFrontendDebugMode(newMode)
  }

  // Load frontend debug mode on mount
  useEffect(() => {
    setFrontendDebugMode(isDebugMode())
    loadSystemStatus()
    loadLogLevel()
  }, [loadSystemStatus, loadLogLevel])

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
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Debug Console</h1>
          <p className="text-sm text-muted-foreground">
            System status, storage inspection, parser testing, and runtime controls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-sm text-muted-foreground">Refreshing...</span>}
          <Button onClick={loadData} variant="default">
            Refresh data
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="parser">Parser Tester</TabsTrigger>
          <TabsTrigger value="logs">Logging</TabsTrigger>
        </TabsList>

        {/* System Status Tab */}
        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Status</CardTitle>
              <CardDescription>Component health and runtime information</CardDescription>
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
                        Database: {systemStatus.components?.database?.healthy ? "Healthy" : "Unavailable"}
                      </p>
                      <p>
                        Vector Store: {systemStatus.components?.vector_store?.healthy ? "Healthy" : "Unavailable"}
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

          {/* Startup Timeline (existing content) */}
          <Card>
            <CardHeader>
              <CardTitle>Startup Timeline</CardTitle>
              <CardDescription>Backend startup phase breakdown</CardDescription>
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

        {/* Storage Tab (existing content) */}
        <TabsContent value="storage" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Chroma Snapshot</CardTitle>
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

            <Card>
              <CardHeader>
                <CardTitle>Database Snapshot</CardTitle>
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

            <Card>
              <CardHeader>
                <CardTitle>Storage Drift</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>DB rows with embeddings: {driftStats?.database_with_embeddings ?? "-"}</p>
                <p>Chroma vectors: {driftStats?.vector_total_documents ?? "-"}</p>
                <p>Missing in Chroma: {driftStats?.missing_in_chroma_count ?? "-"}</p>
                <p>Dangling in Chroma: {driftStats?.dangling_in_chroma_count ?? "-"}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle>Database filters</CardTitle>
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

          <Card>
            <CardHeader>
              <CardTitle>Startup timeline</CardTitle>
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

          <Card>
            <CardHeader>
              <CardTitle>Chroma documents</CardTitle>
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
                    <TableRow key={article.id}>
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

          <Card>
            <CardHeader>
              <CardTitle>Postgres articles</CardTitle>
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
                    <TableRow key={article.id}>
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

          <Card>
            <CardHeader>
              <CardTitle>Drift samples</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Articles missing in Chroma</h3>
                <ul className="space-y-1 text-xs">
                  {missingSamples.length > 0 ? (
                    missingSamples.map((entry) => (
                      <li key={entry.id} className="rounded bg-muted p-2">
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
          <Card>
            <CardHeader>
              <CardTitle>RSS Feed Parser</CardTitle>
              <CardDescription>Test RSS parsing on any feed URL</CardDescription>
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
                  {rssTestResult.sample_entries?.length > 0 && (
                    <div className="mt-2">
                      <h4 className="font-medium text-sm mb-2">Sample Entries</h4>
                      <div className="space-y-2">
                        {rssTestResult.sample_entries.map((entry: any, idx: number) => (
                          <div key={idx} className="text-xs p-2 bg-muted rounded">
                            <p className="font-medium">{entry.title}</p>
                            <p className="text-muted-foreground">
                              Image: {entry.image_extraction?.image_url || entry.image_extraction?.image_error || "None"}
                            </p>
                            {entry.image_extraction?.selected_source && (
                              <p className="text-muted-foreground">Source: {entry.image_extraction.selected_source}</p>
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

          <Card>
            <CardHeader>
              <CardTitle>Article Image Extractor</CardTitle>
              <CardDescription>Test og:image extraction from article pages</CardDescription>
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
                      <img
                        src={articleTestResult.image_url}
                        alt="Preview"
                        className="max-w-xs rounded border"
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    </div>
                  )}
                  {articleTestResult.candidates?.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-1">All Candidates</h4>
                      <ul className="text-xs space-y-1">
                        {articleTestResult.candidates.map((c: any, idx: number) => (
                          <li key={idx} className="p-1 bg-muted rounded">
                            [{c.priority}] {c.source}: {c.url?.slice(0, 60)}...
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {articleTestResult.error && (
                    <p className="text-sm text-red-600">
                      {articleTestResult.error}: {articleTestResult.error_details}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logging Tab */}
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Backend Log Level</CardTitle>
              <CardDescription>Change runtime log verbosity</CardDescription>
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

          <Card>
            <CardHeader>
              <CardTitle>Frontend Debug Mode</CardTitle>
              <CardDescription>Toggle verbose frontend logging</CardDescription>
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
      </Tabs >
    </div >
  )
}

