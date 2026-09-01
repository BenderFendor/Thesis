"use client"

import type {
  ArticleAnalysis,
  FactCheckResult,
  Highlight,
  LanguageDiagnosticExample,
  LanguageDiagnosticMetric,
  LanguageDiagnostics,
  NewsArticle,
  NewsSource,
  SourceDebugData,
} from "../lib/api"
import type { LocalHighlight } from "../lib/highlight-store"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  API_BASE_URL,
  analyzeArticle,
  createHighlight,
  deleteHighlight,
  fetchLanguageDiagnostics,
  fetchSourceDebugData,
  getHighlightsForArticle,
  getSourceById,
  performAgenticSearch,
  updateHighlight,
} from "@/lib/api"
import {
  createHighlightFingerprint,
  dedupeLocalHighlights,
  generateClientId,
  loadHighlightStore,
  markFailed,
  markPending,
  markSynced,
  mergeHighlights,
  saveHighlightStore,
  toRemoteHighlights,
} from "@/lib/highlight-store"
import { buildObsidianMarkdown, highlightStableId } from "@/lib/highlight-utils"
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  Bug,
  CheckCircle2,
  Copy,
  DollarSign,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  Heart,
  Link as LinkIcon,
  Loader2,
  Maximize2,
  Minimize2,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  ScanText,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArticleContent } from "@/components/article-content"
import { HighlightNotePopover } from "@/components/highlight-note-popover"
import { HighlightToolbar } from "@/components/highlight-toolbar"
import InlineDefinition from "@/components/inline-definition"
import { RelatedArticles } from "@/components/related-articles"
import { ReporterProfilePanel } from "@/components/reporter-profile"
import { SourceResearchPanel } from "@/components/source-research-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useBookmarks } from "@/hooks/useBookmarks"
import { useDebugMode } from "@/hooks/use-debug-mode"
import { useFavorites } from "@/hooks/use-favorites"
import { useInlineDefinition } from "@/hooks/use-inline-definition"
import { useLikedArticles } from "@/hooks/use-liked-articles"
import { useReadingHistory } from "@/hooks/useReadingHistory"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { logUserAction } from "@/lib/performance-logger"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import Link from "next/link"
import { toast } from "sonner"

type FactCheckStatus = FactCheckResult["verification_status"]
type FactCheckStatusFilter = FactCheckStatus | "all"
type LanguageMetricKey = "passive_voice" | "actor_omission" | "euphemisms"
type LanguageStatus = "low" | "medium" | "high"
type ModalHighlightSyncStatus = "idle" | "syncing" | "failed" | "offline"

interface ArticleExtractionResponse {
  readonly text?: string
  readonly full_text?: string
}

interface HighlightRange {
  readonly start: number
  readonly end: number
}

interface CreateHighlightPayload {
  readonly highlightedText: string
  readonly color: Highlight["color"]
  readonly range: HighlightRange
}

interface UpdateHighlightPayload {
  readonly highlightId: number
  readonly note: string
}

interface DeleteHighlightPayload {
  readonly highlightId: number
}

type HighlightClickHandler = (stableId: string, element: Readonly<HTMLElement>) => void
type CreateHighlightHandler = (payload: Readonly<CreateHighlightPayload>) => Promise<void> | void
type UpdateHighlightHandler = (payload: Readonly<UpdateHighlightPayload>) => Promise<void> | void
type DeleteHighlightHandler = (payload: Readonly<DeleteHighlightPayload>) => Promise<void> | void

interface LanguageForensicsCardProps {
  readonly diagnostics?: Readonly<LanguageDiagnostics> | null
  readonly loading: boolean
  readonly error?: string | null
}

interface LanguageMetricCardProps {
  readonly label: string
  readonly metric?: Readonly<LanguageDiagnosticMetric>
}

interface LanguageExampleCardProps {
  readonly example: Readonly<LanguageDiagnosticExample>
}

const EMPTY_COUNT = 0,
 HIGHLIGHT_HISTORY_LIMIT = 20,
 HIGHLIGHT_STORE_VERSION = 1,
 MAX_LANGUAGE_EXAMPLES = 4,
 PERCENTAGE_MULTIPLIER = 100,
 VERIFICATION_STYLE_MAP = {
  false: "bg-rose-500/15 text-rose-200 border border-rose-500/40",
  "partially-verified": "bg-amber-500/15 text-amber-200 border border-amber-500/40",
  unverified: "bg-slate-600/20 text-slate-200 border border-slate-500/40",
  verified: "bg-primary/15 text-primary border border-primary/40",
} satisfies Record<FactCheckStatus, string>,

 VERIFICATION_LABEL_MAP = {
  false: "false",
  "partially-verified": "partially verified",
  unverified: "unverified",
  verified: "verified",
} satisfies Record<FactCheckStatus, string>,

 STATUS_FILTERS: FactCheckStatusFilter[] = ["all", "verified", "partially-verified", "unverified", "false"],

 fullArticleCache = new Map<string, string | undefined>(),

 LANGUAGE_STATUS_STYLE = {
  high: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-200",
} satisfies Record<LanguageStatus, string>,

 LANGUAGE_METRIC_LABELS: readonly Readonly<{ key: LanguageMetricKey; label: string }>[] = [
  { key: "passive_voice", label: "Passive voice" },
  { key: "actor_omission", label: "Actor omission" },
  { key: "euphemisms", label: "Euphemisms" },
],

 LANGUAGE_EXAMPLE_KEYS = ["passive_voice", "actor_omission", "euphemisms", "sanitized_language"] as const,

 isNonEmptyString = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value.trim() !== "",

 getExampleLabel = (example: Readonly<LanguageDiagnosticExample>): string => {
  if (isNonEmptyString(example.category)) {return example.category}
  if (isNonEmptyString(example.pattern)) {return example.pattern}
  return "example"
},

 isExtractableUrl = (url?: string | null) => {
  if (url === undefined || url === null || url.trim() === "") {return false}
  return /^https?:\/\//iu.test(url)
},

 isOptionalExtractionText = (value: unknown): boolean => {
  if (value === undefined) {
    return true
  }
  return typeof value === "string"
},

 isArticleExtractionResponse = (value: unknown): value is ArticleExtractionResponse => {
  if (typeof value !== "object" || value === null) {return false}
  // SAFETY: JSON objects are inspected only after the object/null guard above.
  const candidate = value as Record<string, unknown>
  if (!isOptionalExtractionText(candidate.text)) {
    return false
  }
  return isOptionalExtractionText(candidate.full_text)
},

 getInitialArticleText = (article: Readonly<NewsArticle>) => {
  if (article.hasFullContent === true && isNonEmptyString(article.content)) {
    return article.content
  }

  return
},

 getArticleCacheKey = (article: Readonly<NewsArticle>) => {
  if (isExtractableUrl(article.url)) {
    return article.url
  }
  return `article_${article.id}`
},

 fetchFullArticleText = async (
  article: Readonly<NewsArticle>,
  articleCacheKey: string,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  if (fullArticleCache.has(articleCacheKey)) {
    return fullArticleCache.get(articleCacheKey)
  }

  const initialText = getInitialArticleText(article)
  if (!isExtractableUrl(article.url)) {
    fullArticleCache.set(articleCacheKey, initialText)
    return initialText
  }

  const resolvedText = await requestFullArticleText(article.url, initialText, signal)
  fullArticleCache.set(articleCacheKey, resolvedText)
  return resolvedText
},

 requestFullArticleText = async (
  articleUrl: string,
  initialText: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  try {
    const response = await fetch(`${API_BASE_URL}/article/extract?url=${encodeURIComponent(articleUrl)}`, {
      signal,
    }),
     extractedText = await readExtractionText(response)
    return extractedText ?? initialText
  } catch (error) {
    return handleExtractionError(error, initialText)
  }
},

 readExtractionText = async (response: Response): Promise<string | undefined> => {
  if (!response.ok) {
    return
  }

  // SAFETY: the response body is narrowed by isArticleExtractionResponse before field access.
  const rawData = await response.json() as unknown
  if (!isArticleExtractionResponse(rawData)) {
    return
  }
  return rawData.text ?? rawData.full_text
},

 handleExtractionError = (error: unknown, initialText: string | undefined): string | undefined => {
  if (!(error instanceof DOMException && error.name === "AbortError")) {
    console.error("Failed to fetch full article:", error)
  }
  return initialText
};

interface HighlightSyncController {
  readonly latestSyncToken: { current: number }
  readonly services: ArticleDetailServices
  readonly setHighlights: (highlights: LocalHighlight[]) => void
  readonly setStatus: (status: ModalHighlightSyncStatus) => void
}

const getOfflineSyncStatus = (): ModalHighlightSyncStatus =>
  globalThis.navigator.onLine ? "idle" : "offline",

 replaceSyncedHighlight = (
  highlights: readonly LocalHighlight[],
  clientId: string,
  update: (highlight: LocalHighlight) => LocalHighlight,
): LocalHighlight[] => highlights.map((highlight) => (
  highlight.client_id === clientId ? update(highlight) : highlight
)),

 syncCreatedHighlight = async (
  item: Readonly<LocalHighlight>,
  current: readonly LocalHighlight[],
  services: ArticleDetailServices,
): Promise<LocalHighlight[]> => {
  const created = await services.createHighlight({
    article_url: item.article_url,
    character_end: item.character_end,
    character_start: item.character_start,
    color: item.color,
    highlighted_text: item.highlighted_text,
    note: item.note,
  })
  return replaceSyncedHighlight(current, item.client_id, (highlight) =>
    markSynced({ highlight, server: created }),
  )
},

 syncUpdatedHighlight = async (
  item: Readonly<LocalHighlight>,
  current: readonly LocalHighlight[],
  services: ArticleDetailServices,
): Promise<LocalHighlight[]> => {
  const id = item.server_id ?? item.id
  if (id === undefined) {
    return replaceSyncedHighlight(current, item.client_id, (highlight) =>
      markFailed({ error: "missing server id", highlight }),
    )
  }
  const updated = await services.updateHighlight(id, {
    character_end: item.character_end,
    character_start: item.character_start,
    color: item.color,
    highlighted_text: item.highlighted_text,
    note: item.note,
  })
  return replaceSyncedHighlight(current, item.client_id, (highlight) =>
    markSynced({ highlight, server: updated }),
  )
},

 syncDeletedHighlight = async (
  item: Readonly<LocalHighlight>,
  current: readonly LocalHighlight[],
  services: ArticleDetailServices,
): Promise<LocalHighlight[]> => {
  const id = item.server_id ?? item.id
  if (id !== undefined) {
    await services.deleteHighlight(id)
  }
  return current.filter((highlight) => highlight.client_id !== item.client_id)
},

 syncOneHighlight = async (
  item: Readonly<LocalHighlight>,
  current: readonly LocalHighlight[],
  services: ArticleDetailServices,
): Promise<LocalHighlight[]> => {
  if (item.pending_op === "create") {
    return syncCreatedHighlight(item, current, services)
  }

  if (item.pending_op === "update") {
    return syncUpdatedHighlight(item, current, services)
  }

  if (item.pending_op === "delete") {
    return syncDeletedHighlight(item, current, services)
  }

  return [...current]
},

 getHighlightSyncFailureStatus = (): ModalHighlightSyncStatus => {
  if (getOfflineSyncStatus() === "offline") {
    return "offline"
  }
  return "failed"
},

 attemptHighlightSync = async (
  item: Readonly<LocalHighlight>,
  current: readonly LocalHighlight[],
  controller: Readonly<HighlightSyncController>,
): Promise<LocalHighlight[]> => {
  try {
    return await syncOneHighlight(item, current, controller.services)
  } catch (error) {
    controller.setStatus(getHighlightSyncFailureStatus())
    return replaceSyncedHighlight(current, item.client_id, (highlight) =>
      markFailed({ error, highlight }),
    )
  }
},

 persistHighlightSync = (
  articleUrl: string,
  highlights: readonly LocalHighlight[],
  controller: Readonly<HighlightSyncController>,
): void => {
  if (articleUrl === "") {
    return
  }
  saveHighlightStore({ article_url: articleUrl, highlights: [...highlights], version: HIGHLIGHT_STORE_VERSION })
  controller.setHighlights([...highlights])
},

 syncHighlightItems = async (
  articleUrl: string,
  actionable: readonly LocalHighlight[],
  index: number,
  current: readonly LocalHighlight[],
  syncToken: number,
  controller: Readonly<HighlightSyncController>,
): Promise<void> => {
  const item = actionable[index]
  if (item === undefined) {
    if (controller.latestSyncToken.current === syncToken) {
      controller.setStatus(getOfflineSyncStatus())
    }
    return
  }
  if (controller.latestSyncToken.current !== syncToken) {
    return
  }

  const next = await attemptHighlightSync(item, current, controller)
  persistHighlightSync(articleUrl, next, controller)
  await syncHighlightItems(articleUrl, actionable, index + 1, next, syncToken, controller)
},

 syncHighlights = async (
  articleUrl: string,
  current: readonly LocalHighlight[],
  controller: Readonly<HighlightSyncController>,
): Promise<void> => {
  const syncToken = Date.now()
  controller.latestSyncToken.current = syncToken
  controller.setStatus("syncing")
  const actionable = current.filter((item) => item.pending_op !== undefined)
  if (actionable.length === EMPTY_COUNT) {
    controller.setStatus(getOfflineSyncStatus())
    return
  }
  await syncHighlightItems(articleUrl, actionable, EMPTY_COUNT, current, syncToken, controller)
},

 LanguageMetricCard = ({ label, metric }: Readonly<LanguageMetricCardProps>) => (
  <div className="rounded-md border border-border/50 bg-background/45 px-3 py-2">
    <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className="mt-1 flex items-baseline gap-2">
      <span className="text-lg font-semibold text-foreground">{metric?.count ?? EMPTY_COUNT}</span>
      <span className="text-xs text-muted-foreground">
        {Math.round((metric?.rate ?? EMPTY_COUNT) * PERCENTAGE_MULTIPLIER)}%
      </span>
    </div>
  </div>
),

 LanguageExampleCard = ({ example }: Readonly<LanguageExampleCardProps>) => (
  <div className="rounded-md border border-border/50 bg-background/35 px-3 py-2">
    <div className="mb-1 flex items-center gap-2">
      <Badge variant="outline" className="text-xs uppercase tracking-widest">
        {getExampleLabel(example)}
      </Badge>
      {isNonEmptyString(example.term ?? undefined) ? (
        <span className="text-xs text-muted-foreground">{example.term}</span>
      ) : undefined}
    </div>
    <p className="line-clamp-3 text-xs leading-relaxed text-foreground/75">{example.sentence}</p>
  </div>
),

 LanguageForensicsHeading = () => (
  <>
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Language Forensics</p>
    <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-foreground">
      <ScanText className="h-5 w-5 text-primary" />
      Framing diagnostics
    </h3>
  </>
),

 LanguageForensicsHeader = ({ status, loading }: Readonly<{ status: LanguageStatus; loading: boolean }>) => (
  <div className="mb-4 flex items-start justify-between gap-3">
    <div>
      <LanguageForensicsHeading />
    </div>
    <Badge className={`${LANGUAGE_STATUS_STYLE[status]} uppercase tracking-wide`}>
      {loading ? "Scanning" : status}
    </Badge>
  </div>
),

 getLanguageMetrics = (diagnostics: Readonly<LanguageDiagnostics> | null | undefined) =>
  LANGUAGE_METRIC_LABELS.map(({ key, label }) => ({
    key,
    label,
    metric: diagnostics?.[key] ?? undefined,
  })),

 getLanguageExamples = (diagnostics: Readonly<LanguageDiagnostics> | null | undefined) =>
  LANGUAGE_EXAMPLE_KEYS.flatMap((key) => diagnostics?.[key]?.examples ?? []).slice(EMPTY_COUNT, MAX_LANGUAGE_EXAMPLES),

 LanguageForensicsError = ({ error }: Readonly<{ error?: string | null }>) =>
  isNonEmptyString(error) ? (
    <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      {error}
    </div>
  ) : undefined,

 LanguageForensicsSummary = ({
  summary,
  loading,
}: Readonly<{ summary?: string | null; loading: boolean }>) => (
  isNonEmptyString(summary) ? (
    <p className="mt-4 text-sm leading-relaxed text-foreground/80">{summary}</p>
  ) : (
    <p className="mt-4 text-sm text-muted-foreground">
      {loading ? "Scanning article language." : "No diagnostic result available for this article."}
    </p>
  )
),

 LanguageForensicsExamples = ({
  examples,
}: Readonly<{ examples: readonly LanguageDiagnosticExample[] }>) => (
  examples.length > EMPTY_COUNT ? (
    <div className="mt-4 space-y-2">
      {examples.map((example) => <LanguageExampleCard key={example.sentence} example={example} />)}
    </div>
  ) : undefined
),

 LanguageForensicsMetrics = ({
  metrics,
}: Readonly<{
  metrics: readonly Readonly<{ key: LanguageMetricKey; label: string; metric: LanguageDiagnosticMetric | undefined }>[]
}>) => (
  <div className="grid grid-cols-3 gap-2">
    {metrics.map(({ key, label, metric }) => (
      <LanguageMetricCard key={key} label={label} metric={metric} />
    ))}
  </div>
),

 getLanguageForensicsState = (diagnostics: Readonly<LanguageDiagnostics> | null | undefined) => ({
  examples: getLanguageExamples(diagnostics),
  metrics: getLanguageMetrics(diagnostics),
  status: diagnostics?.overall?.status ?? "low",
}),

 LanguageForensicsCard = ({ diagnostics, loading, error }: Readonly<LanguageForensicsCardProps>) => {
  const { examples, metrics, status } = getLanguageForensicsState(diagnostics)

  return (
    <div className="rounded-lg border border-border/60 bg-secondary/70 p-5">
      <LanguageForensicsHeader status={status} loading={loading} />
      <LanguageForensicsError error={error} />
      <LanguageForensicsMetrics metrics={metrics} />
      <LanguageForensicsSummary summary={diagnostics?.overall?.summary} loading={loading} />
      <LanguageForensicsExamples examples={examples} />
    </div>
  )
},

 isTextInputFocused = (): boolean => {
  const active = globalThis.document.activeElement
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable)
},

 getConfidenceColor = (confidence: FactCheckResult["confidence"]) => {
  switch (confidence) {
    case "high": {
      return "bg-primary/15 text-primary border border-primary/40"
    }
    case "medium": {
      return "bg-amber-500/15 text-amber-200 border border-amber-500/40"
    }
    case "low": {
      return "bg-rose-500/15 text-rose-200 border border-rose-500/40"
    }
    default: {
      return "bg-slate-600/20 text-slate-200 border border-slate-500/40"
    }
  }
},

 getCredibilityColor = (credibility: string) => {
  switch (credibility) {
    case "high": {
      return "bg-primary/15 text-primary border-primary/30"
    }
    case "medium": {
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    }
    case "low": {
      return "bg-red-500/20 text-red-400 border-red-500/30"
    }
    default: {
      return "bg-gray-500/20 text-gray-400 border-gray-500/30"
    }
  }
},

 getBiasColor = (bias: string) => {
  switch (bias) {
    case "left": {
      return "bg-blue-500/20 text-blue-400 border-blue-500/30"
    }
    case "center": {
      return "bg-gray-500/20 text-gray-400 border-gray-500/30"
    }
    case "right": {
      return "bg-red-500/20 text-red-400 border-red-500/30"
    }
    default: {
      return "bg-gray-500/20 text-gray-400 border-gray-500/30"
    }
  }
},

 hasRealImage = (src?: string | null): boolean => {
  const normalized = src?.trim().toLowerCase()
  return normalized !== undefined && normalized !== "" && normalized !== "none" &&
    !normalized.includes("/placeholder.svg") && !normalized.includes("/placeholder.jpg")
},

 formatDate = (date: string) => {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) {return date}
  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
},

 getArticleTextForMetrics = (
  fullArticleText: string | null | undefined,
  content: string | undefined,
  summary: string | undefined,
) => (fullArticleText || content || summary || "").trim(),

 getArticleWordMetrics = (text: string) => {
  const wordCount = text ? text.split(/\s+/u).filter(Boolean).length : 0
  return { estimatedReadMinutes: Math.max(1, Math.ceil(wordCount / 230)), wordCount }
},

 getReporterName = (article: NewsArticle) =>
  article.author?.trim() || article.authors?.find((value) => value.trim().length > 0) || "",

 getArticleHost = (url?: string | null) =>
  url && isExtractableUrl(url) ? new URL(url).hostname : undefined,

 shouldShowSummary = (
  summary: string | undefined,
  content: string | undefined,
  fullArticleText: string | null | undefined,
) => {
  const summaryText = (summary || "").trim(),
   contentText = (content || "").trim(),
   fullText = (fullArticleText || "").trim()
  return Boolean(summaryText && summaryText !== fullText && summaryText !== contentText)
},

 getArticleWikiContext = (
  fullArticleText: string | null | undefined,
  content: string | undefined,
  summary: string | undefined,
) => (fullArticleText || "").trim() || (content || "").trim() || (summary || "").trim(),

 getRenderedLanguageDiagnostics = (
  aiAnalysis: ArticleAnalysis | null | undefined,
  languageDiagnostics: LanguageDiagnostics | null | undefined,
) => (aiAnalysis?.language_diagnostics?.success ? aiAnalysis.language_diagnostics : languageDiagnostics),

 getWikiSheetTitle = (tab: "source" | "reporter", source: string, reporterName: string): string => {
  if (tab === "source") {
    return source
  }
  return reporterName
},

 getWikiTabClassName = (active: boolean): string => {
  if (active) {
    return "rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] transition-colors border-white/20 bg-white/10 text-foreground"
  }
  return "rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] transition-colors border-white/10 bg-transparent text-muted-foreground hover:bg-white/5"
},

 ModalWikiTabs = ({
  tab,
  hasSourceWiki,
  hasReporterWiki,
  onTabChange,
}: Readonly<{
  tab: "source" | "reporter"
  hasSourceWiki: boolean
  hasReporterWiki: boolean
  onTabChange: (tab: "source" | "reporter") => void
}>) => {
  if (!(hasSourceWiki && hasReporterWiki)) {
    return
  }
  return (
    <div className="mt-4 flex items-center gap-2">
      <button
        type="button"
        onClick={() =>{  onTabChange("source"); }}
        className={getWikiTabClassName(tab === "source")}
      >
        Source
      </button>
      <button
        type="button"
        onClick={() =>{  onTabChange("reporter"); }}
        className={getWikiTabClassName(tab === "reporter")}
      >
        Reporter
      </button>
    </div>
  )
},

 ModalWikiBody = ({
  tab,
  source,
  reporterName,
  articleHost,
  articleWikiContext,
}: Readonly<{
  tab: "source" | "reporter"
  source: string
  reporterName: string
  articleHost?: string
  articleWikiContext: string
}>) => {
  if (tab === "source") {
    return <SourceResearchPanel sourceName={source} website={articleHost} autoRun />
  }
  if (reporterName !== "") {
    return (
      <ReporterProfilePanel
        reporterName={reporterName}
        organization={source}
        articleContext={articleWikiContext}
      />
    )
  }
  return (
    <div className="rounded-lg border border-white/10 bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
      Reporter information is not available for this article.
    </div>
  )
},

 ModalWikiSheet = ({
  open,
  onOpenChange,
  tab,
  onTabChange,
  source,
  reporterName,
  hasSourceWiki,
  hasReporterWiki,
  articleHost,
  articleWikiContext,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: "source" | "reporter"
  onTabChange: (tab: "source" | "reporter") => void
  source: string
  reporterName: string
  hasSourceWiki: boolean
  hasReporterWiki: boolean
  articleHost?: string
  articleWikiContext: string
}) =>
  (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full border-l border-white/10 bg-background p-0 sm:max-w-xl">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-white/10 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SheetTitle className="font-serif text-xl">
                  {getWikiSheetTitle(tab, source, reporterName)}
                </SheetTitle>
                <SheetDescription className="mt-1 text-xs">
                  Inline wiki preview from cached public-source research with direct links to the full wiki pages.
                </SheetDescription>
              </div>
              {tab === "source" && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/wiki/source/${encodeURIComponent(source)}`}>
                    Open full wiki
                  </Link>
                </Button>
              )}
            </div>
            <ModalWikiTabs
              tab={tab}
              hasSourceWiki={hasSourceWiki}
              hasReporterWiki={hasReporterWiki}
              onTabChange={onTabChange}
            />
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <ModalWikiBody
              tab={tab}
              source={source}
              reporterName={reporterName}
              articleHost={articleHost}
              articleWikiContext={articleWikiContext}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  ),


 ModalHeaderControls = ({
  onNavigate,
  handleNavigate,
  isExpanded,
  onToggleExpanded,
  onClose,
}: {
  onNavigate?: (direction: "prev" | "next") => void
  handleNavigate: (direction: "prev" | "next") => void
  isExpanded: boolean
  onToggleExpanded: () => void
  onClose: () => void
}) =>
  (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/40 bg-background/75 p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 flex-1">
        {onNavigate ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>{  handleNavigate("prev"); }}
              className="rounded-md border border-border/40 bg-card/60 px-4 text-xs uppercase tracking-wider text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
              title="Previous (ArrowLeft)"
            >
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>{  handleNavigate("next"); }}
              className="rounded-md border border-border/40 bg-card/60 px-4 text-xs uppercase tracking-wider text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
              title="Next (ArrowRight)"
            >
              Next
            </Button>
          </>
        ) : undefined}
      </div>
      <div className="flex items-center justify-center flex-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleExpanded}
          className="h-9 w-9 rounded-md border border-border/40 bg-card/60 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
        >
          {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>
      <div className="flex items-center justify-end flex-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-9 w-9 rounded-md border border-border/40 bg-card/60 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  ),


 ModalProgressRail = ({
  trackRef,
  progress,
}: {
  trackRef: { current: HTMLDivElement | null }
  progress: number
}) =>
  (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label="Article reading progress"
      aria-controls="article-detail-scroll-region"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className="absolute inset-y-24 right-2 z-10 hidden w-3 cursor-row-resize rounded-full bg-white/5 lg:block"
    >
      <div
        className="pointer-events-none w-full rounded-full bg-primary/80 transition-[height] duration-150"
        style={{ height: `${Math.max(progress * 100, 8)}%` }}
      />
    </div>
  ),


 getModalHeroLayoutId = (
  layoutIdPrefix: string | undefined,
  articleId: number,
  suffix: string,
): string | undefined => {
  if (layoutIdPrefix === undefined) {
    return
  }
  return `${layoutIdPrefix}-${suffix}-${articleId}`
},

 getModalHeroClassName = (isExpanded: boolean, hasImage: boolean): string => {
  const classes = ["relative", "overflow-hidden"]
  classes.push(isExpanded ? "min-h-96 h-[60vh]" : "h-56", hasImage ? "bg-card" : "editorial-modal-fallback")
  return classes.join(" ")
},

 getModalHeroTitleClassName = (isExpanded: boolean): string => {
  const classes = ["mb-6", "font-serif", "leading-tight", "text-foreground"]
  classes.push(isExpanded ? "text-4xl md:text-6xl" : "text-2xl md:text-4xl")
  return classes.join(" ")
},

 ModalHeroVisual = ({ image }: Readonly<{ image: string | undefined }>) => {
  if (image === undefined) {
    return <div className="editorial-modal-fallback absolute inset-0" />
  }
  return (
    <>
      <motion.img
        src={image}
        alt=""
        className="h-full w-full object-cover opacity-70"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
    </>
  )
},

 ModalHero = ({
  article,
  isExpanded,
  layoutIdPrefix,
  reporterName,
  onOpenSourceWiki,
  onOpenReporterWiki,
  onClose,
}: {
  article: NewsArticle
  isExpanded: boolean
  layoutIdPrefix?: string
  reporterName: string
  onOpenSourceWiki: () => void
  onOpenReporterWiki: () => void
  onClose: () => void
}) => {
  const heroImage = hasRealImage(article.image) ? article.image : undefined

  return (
    <div className={getModalHeroClassName(isExpanded, heroImage !== undefined)}>
      <ModalHeroVisual image={heroImage} />

      {/* Hero Content */}
      <div className="absolute inset-0 flex flex-col justify-end">
        <div className="mx-auto w-full max-w-6xl px-6 pb-10 md:px-8 md:pb-12">
          <ModalHeroBadges article={article} />

          {/* Title */}
          <motion.h1
            layoutId={getModalHeroLayoutId(layoutIdPrefix, article.id, "title")}
            className={getModalHeroTitleClassName(isExpanded)}
          >
            {article.title}
          </motion.h1>

          <ModalHeroMeta
            article={article}
            reporterName={reporterName}
            onOpenSourceWiki={onOpenSourceWiki}
            onOpenReporterWiki={onOpenReporterWiki}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  )
},

 ModalHeroBadges = ({ article }: Readonly<{ article: NewsArticle }>) => (
  <div className="flex flex-wrap items-center gap-3 mb-6">
    <Badge className={getCredibilityColor(article.credibility)}>
      {article.credibility.toUpperCase()} CREDIBILITY
    </Badge>
    <Badge className={getBiasColor(article.bias)}>{article.bias.toUpperCase()} BIAS</Badge>
    {article.category && (
      <Badge variant="outline" className="text-xs uppercase">
        {article.category}
      </Badge>
    )}
  </div>
),

 ModalHeroMeta = ({
  article,
  reporterName,
  onOpenSourceWiki,
  onOpenReporterWiki,
  onClose,
}: {
  article: NewsArticle
  reporterName: string
  onOpenSourceWiki: () => void
  onOpenReporterWiki: () => void
  onClose: () => void
}) => (
  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onOpenSourceWiki()
      }}
      className="font-medium hover:text-primary hover:underline transition-colors"
    >
      {article.source}
    </button>
    <Link
      href={`/source/${encodeURIComponent(article.sourceId)}`}
      className="text-muted-foreground hover:text-primary transition-colors"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
      title="Open source page"
    >
      <LinkIcon className="h-3.5 w-3.5" />
    </Link>
    <Link
      href={`/wiki/source/${encodeURIComponent(article.source)}`}
      className="text-muted-foreground hover:text-primary transition-colors"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
      title="View wiki profile"
    >
      <BookOpen className="h-3.5 w-3.5" />
    </Link>
    {reporterName && (
      <>
        <span>•</span>
        <button
          type="button"
          className="hover:text-primary hover:underline transition-colors"
          onClick={(event) => {
            event.stopPropagation()
            onOpenReporterWiki()
          }}
          title="Open reporter wiki preview"
        >
          Reporter: {reporterName}
        </button>
        <Link
          href={`/wiki/reporters?search=${encodeURIComponent(reporterName)}`}
          className="text-muted-foreground hover:text-primary transition-colors"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          title="Search reporter in wiki"
        >
          <BookOpen className="h-3.5 w-3.5" />
        </Link>
      </>
    )}
    {!reporterName && article.authors && article.authors.length > 0 && (
      <>
        <span>•</span>
        <span className="text-foreground/80 text-xs">{article.authors.slice(0, 2).join(", ")}</span>
      </>
    )}
    <span>•</span>
    <span>{formatDate(article.publishedAt)}</span>
    <span>•</span>
    <span>{article.country}</span>
    {article.translated && (
      <>
        <span>•</span>
        <Badge variant="outline" className="text-xs">Translated from {article.originalLanguage.toUpperCase()}</Badge>
      </>
    )}
  </div>
),

 ModalSummaryQuote = ({ summary, isExpanded }: { summary: string; isExpanded: boolean }) =>
  (
    <div className={isExpanded ? "mb-12 border-l-4 border-primary bg-card/50 px-6 py-4" : "mb-8 border-l-4 border-primary bg-card/50 px-5 py-4"}>
      <p className={`text-foreground/80 leading-relaxed italic ${isExpanded ? 'text-2xl' : 'text-lg'
        }`}>
        {summary}
      </p>
    </div>
  ),


 getModalReaderTitleClassName = (isExpanded: boolean): string => {
  if (isExpanded) {
    return "font-bold text-foreground mb-6 font-serif text-3xl"
  }
  return "font-bold text-foreground mb-6 font-serif text-xl"
},

 getModalReaderText = (fullArticleText: string | null | undefined, articleSummary: string): string => {
  if (isNonEmptyString(fullArticleText)) {
    return fullArticleText
  }
  if (articleSummary !== "") {
    return articleSummary
  }
  return ""
},

 getVisibleReaderHighlights = (
  showHighlights: boolean,
  visibleHighlights: readonly Highlight[],
): readonly Highlight[] => {
  if (showHighlights) {
    return visibleHighlights
  }
  return []
},

 ModalArticleReaderLoading = ({ updating }: Readonly<{ updating: boolean }>) => {
  if (updating) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border/50 bg-card/60 p-4">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
        <p className="text-muted-foreground text-sm">Updating full article text...</p>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card/60 p-6">
      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
      <p className="text-muted-foreground">Loading full article text...</p>
    </div>
  )
},

 ModalArticleReaderBody = ({
  fullArticleText,
  articleUrl,
  articleSummary,
  showHighlights,
  visibleHighlights,
  activeHighlightId,
  onHighlightClick,
  articleContentRef,
  isExpanded,
  highlightColor,
  onCreate,
  onUpdate,
  onDelete,
}: Readonly<{
  fullArticleText: string | null | undefined
  articleUrl: string
  articleSummary: string
  showHighlights: boolean
  visibleHighlights: readonly Highlight[]
  activeHighlightId: string | null
  onHighlightClick: (stableId: string, element: HTMLElement) => void
  articleContentRef: { current: HTMLDivElement | null }
  isExpanded: boolean
  highlightColor: Highlight["color"]
  onCreate: CreateHighlightHandler
  onUpdate: UpdateHighlightHandler
  onDelete: DeleteHighlightHandler
}>) => (
  <>
    <ArticleContent
      ref={articleContentRef}
      content={getModalReaderText(fullArticleText, articleSummary)}
      highlights={getVisibleReaderHighlights(showHighlights, visibleHighlights)}
      activeHighlightId={activeHighlightId}
      onHighlightClick={onHighlightClick}
      className={isExpanded ? "reading-prose space-y-6" : "reading-prose space-y-5"}
    />
    <HighlightToolbar
      articleUrl={articleUrl}
      containerRef={articleContentRef}
      highlightColor={highlightColor}
      autoCreate
      highlights={visibleHighlights}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />
  </>
),

 ModalArticleReaderContent = (props: Readonly<{
  articleLoading: boolean
  fullArticleText: string | null | undefined
  articleUrl: string
  articleSummary: string
  showHighlights: boolean
  visibleHighlights: readonly Highlight[]
  activeHighlightId: string | null
  onHighlightClick: (stableId: string, element: HTMLElement) => void
  articleContentRef: { current: HTMLDivElement | null }
  isExpanded: boolean
  highlightColor: Highlight["color"]
  onCreate: CreateHighlightHandler
  onUpdate: UpdateHighlightHandler
  onDelete: DeleteHighlightHandler
}>) => {
  if (props.articleLoading) {
    if (isNonEmptyString(props.fullArticleText)) {
      return <><ModalArticleReaderLoading updating /><ModalArticleReaderBody {...props} /></>
    }
    return <ModalArticleReaderLoading updating={false} />
  }
  return <ModalArticleReaderBody {...props} />
},


 ModalArticleReader = ({
  articleLoading,
  fullArticleText,
  articleUrl,
  articleSummary,
  showHighlights,
  visibleHighlights,
  activeHighlightId,
  onHighlightClick,
  articleContentRef,
  isExpanded,
  highlightColor,
  onCreate,
  onUpdate,
  onDelete,
}: {
  articleLoading: boolean
  fullArticleText: string | null | undefined
  articleUrl: string
  articleSummary: string
  showHighlights: boolean
  visibleHighlights: Highlight[]
  activeHighlightId: string | null
  onHighlightClick: (stableId: string, element: HTMLElement) => void
  articleContentRef: { current: HTMLDivElement | null }
  isExpanded: boolean
  highlightColor: Highlight["color"]
  onCreate: (payload: {
    highlightedText: string
    color: Highlight["color"]
    range: { start: number; end: number }
  }) => Promise<void> | void
  onUpdate: (payload: { highlightId: number; note: string }) => Promise<void> | void
  onDelete: (payload: { highlightId: number }) => Promise<void> | void
}) => (
  <div className="space-y-6">
    <h2 className={getModalReaderTitleClassName(isExpanded)}>Full Article</h2>
    <ModalArticleReaderContent
      articleLoading={articleLoading}
      fullArticleText={fullArticleText}
      articleUrl={articleUrl}
      articleSummary={articleSummary}
      showHighlights={showHighlights}
      visibleHighlights={visibleHighlights}
      activeHighlightId={activeHighlightId}
      onHighlightClick={onHighlightClick}
      articleContentRef={articleContentRef}
      isExpanded={isExpanded}
      highlightColor={highlightColor}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />
  </div>
),


 ModalAiCleanNote = ({
  aiAnalysis,
  fullArticleText,
  articleContent,
}: {
  aiAnalysis: ArticleAnalysis | null
  fullArticleText: string | null | undefined
  articleContent?: string
}) => {
  if (!(aiAnalysis?.full_text && aiAnalysis.full_text !== fullArticleText && aiAnalysis.full_text !== articleContent)) {
    return null
  }
  return (
    <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-white">Clean Reading View</h3>
      </div>
      <p className="text-sm text-gray-400 mb-3">A clean text version is available.</p>
      <details className="text-sm">
        <summary className="cursor-pointer text-primary hover:text-primary/80">Show AI Version</summary>
        <div className="mt-3 text-gray-300 leading-relaxed whitespace-pre-wrap">
          {aiAnalysis.full_text}
        </div>
      </details>
    </div>
  )
},

 ModalTags = ({ tags }: { tags: string[] }) =>
  (
    <div>
      <h4 className="text-sm font-medium text-gray-400 mb-3">Tags</h4>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-xs">
            {tag}
          </Badge>
        ))}
      </div>
    </div>
  )


interface ModalActionsProps {
  readonly article: Readonly<NewsArticle>
  readonly canPersist: boolean
  readonly bookmarkLoading: boolean
  readonly aiAnalysisLoading: boolean
  readonly canRequestAiAnalysis: boolean
  readonly aiAnalysisRequested: boolean
  readonly aiHasError: boolean
  readonly aiActionLabel: string
  readonly isLiked: (articleId: number) => boolean
  readonly isFavorite: (sourceId: string) => boolean
  readonly isBookmarked: (articleId: number) => boolean
  readonly isArticleInQueue: (url: string) => boolean
  readonly onLike: () => void
  readonly onFavorite: () => void
  readonly onBookmark: () => void
  readonly onAiAnalysis: () => void
  readonly onQueueToggle: () => void
}

interface ModalActionButtonsProps {
  readonly canPersist: boolean
  readonly bookmarkLoading: boolean
  readonly aiAnalysisLoading: boolean
  readonly canRequestAiAnalysis: boolean
  readonly aiAnalysisRequested: boolean
  readonly aiHasError: boolean
  readonly aiActionLabel: string
  readonly liked: boolean
  readonly favorited: boolean
  readonly bookmarked: boolean
  readonly inQueue: boolean
  readonly onLike: () => void
  readonly onFavorite: () => void
  readonly onBookmark: () => void
  readonly onAiAnalysis: () => void
  readonly onQueueToggle: () => void
}

interface ActionIconProps {
  readonly active: boolean
}

const getActionClassName = (active: boolean, activeClass: string): string => {
  if (active) {return activeClass}
  return "text-gray-400"
},

 getActionIconClassName = (active: boolean): string => {
  if (active) {return "fill-current"}
  return ""
},

 LikeActionIcon = ({ active }: Readonly<ActionIconProps>) => (
  <Heart className={`h-4 w-4 mr-2 ${getActionIconClassName(active)}`} />
),

 FavoriteActionIcon = ({ active }: Readonly<ActionIconProps>) => (
  <Star className={`h-4 w-4 mr-2 ${getActionIconClassName(active)}`} />
),

 BookmarkActionIcon = ({ active }: Readonly<ActionIconProps>) => (
  <Bookmark className={`h-4 w-4 ${getActionIconClassName(active)}`} />
),

 AnalysisActionIcon = ({ loading }: Readonly<{ loading: boolean }>) => {
  if (loading) {return <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
  return <Sparkles className="h-4 w-4 mr-2" />
},

 QueueActionIcon = ({ active }: Readonly<ActionIconProps>) => {
  if (active) {return <MinusCircle className="h-4 w-4 mr-2" />}
  return <PlusCircle className="h-4 w-4 mr-2" />
},

 LikeActionButton = ({ active, canPersist, onClick }: Readonly<{
  readonly active: boolean
  readonly canPersist: boolean
  readonly onClick: () => void
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={getActionClassName(active, "text-red-400")}
    disabled={!canPersist}
    title={canPersist ? "Like article" : "Only indexed articles can be liked."}
  >
    <LikeActionIcon active={active} />
    Like
  </Button>
),

 FavoriteActionButton = ({ active, onClick }: Readonly<{
  readonly active: boolean
  readonly onClick: () => void
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={getActionClassName(active, "text-yellow-400")}
    title={active ? "Remove from favorites" : "Add to favorites"}
  >
    <FavoriteActionIcon active={active} />
    Favorite
  </Button>
),

 BookmarkActionButton = ({ active, canPersist, loading, onClick }: Readonly<{
  readonly active: boolean
  readonly canPersist: boolean
  readonly loading: boolean
  readonly onClick: () => void
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={getActionClassName(active, "text-yellow-400")}
    disabled={loading || !canPersist}
    title={canPersist ? "Bookmark article" : "Only indexed articles can be bookmarked."}
  >
    <BookmarkActionIcon active={active} />
    Bookmark
  </Button>
),

 AnalysisActionButton = ({
  active,
  aiActionLabel,
  aiAnalysisLoading,
  aiHasError,
  canRequestAiAnalysis,
  onClick,
}: Readonly<{
  readonly active: boolean
  readonly aiActionLabel: string
  readonly aiAnalysisLoading: boolean
  readonly aiHasError: boolean
  readonly canRequestAiAnalysis: boolean
  readonly onClick: () => void
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    disabled={!canRequestAiAnalysis || aiAnalysisLoading}
    className={getActionClassName(active && !aiHasError, "text-emerald-400")}
    title="AI analysis is opt-in to reduce API calls"
  >
    <AnalysisActionIcon loading={aiAnalysisLoading} />
    {aiActionLabel}
  </Button>
),

 QueueActionButton = ({ active, onClick }: Readonly<{
  readonly active: boolean
  readonly onClick: () => void
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={getActionClassName(active, "text-blue-400")}
  >
    <QueueActionIcon active={active} />
    {active ? "Remove from Queue" : "Add to Queue"}
  </Button>
),

 ModalActionButtons = ({
  aiActionLabel,
  aiAnalysisLoading,
  aiAnalysisRequested,
  aiHasError,
  bookmarked,
  bookmarkLoading,
  canPersist,
  canRequestAiAnalysis,
  favorited,
  inQueue,
  liked,
  onAiAnalysis,
  onBookmark,
  onFavorite,
  onLike,
  onQueueToggle,
}: Readonly<ModalActionButtonsProps>) => (
  <div className="flex items-center gap-4">
    <LikeActionButton active={liked} canPersist={canPersist} onClick={onLike} />
    <FavoriteActionButton active={favorited} onClick={onFavorite} />
    <BookmarkActionButton active={bookmarked} canPersist={canPersist} loading={bookmarkLoading} onClick={onBookmark} />
    <AnalysisActionButton
      active={aiAnalysisRequested}
      aiActionLabel={aiActionLabel}
      aiAnalysisLoading={aiAnalysisLoading}
      aiHasError={aiHasError}
      canRequestAiAnalysis={canRequestAiAnalysis}
      onClick={onAiAnalysis}
    />
    <QueueActionButton active={inQueue} onClick={onQueueToggle} />
  </div>
),

 getModalActionStates = (
  article: Readonly<NewsArticle>,
  isLiked: (articleId: number) => boolean,
  isFavorite: (sourceId: string) => boolean,
  isBookmarked: (articleId: number) => boolean,
  isArticleInQueue: (url: string) => boolean,
) => ({
  bookmarked: article.id !== EMPTY_COUNT && isBookmarked(article.id),
  favorited: isFavorite(article.sourceId),
  inQueue: isArticleInQueue(article.url),
  liked: article.id !== EMPTY_COUNT && isLiked(article.id),
}),

 ModalActions = ({
  article,
  canPersist,
  bookmarkLoading,
  aiAnalysisLoading,
  canRequestAiAnalysis,
  aiAnalysisRequested,
  aiHasError,
  aiActionLabel,
  isLiked,
  isFavorite,
  isBookmarked,
  isArticleInQueue,
  onLike,
  onFavorite,
  onBookmark,
  onAiAnalysis,
  onQueueToggle,
}: Readonly<ModalActionsProps>) => {
  const { liked, favorited, bookmarked, inQueue } = getModalActionStates(article, isLiked, isFavorite, isBookmarked, isArticleInQueue)

  return (
    <div className="flex items-center justify-between pt-6 border-t border-gray-800 relative z-10 mb-20">
      <ModalActionButtons
        aiActionLabel={aiActionLabel}
        aiAnalysisLoading={aiAnalysisLoading}
        aiAnalysisRequested={aiAnalysisRequested}
        aiHasError={aiHasError}
        bookmarked={bookmarked}
        bookmarkLoading={bookmarkLoading}
        canPersist={canPersist}
        canRequestAiAnalysis={canRequestAiAnalysis}
        favorited={favorited}
        inQueue={inQueue}
        liked={liked}
        onAiAnalysis={onAiAnalysis}
        onBookmark={onBookmark}
        onFavorite={onFavorite}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
      />
      {canPersist ? undefined : (
        <span className="text-xs text-muted-foreground">
          This article is readable here, but likes and bookmarks only work for indexed archive items.
        </span>
      )}
      <Button variant="outline" size="sm" asChild>
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4 mr-2" />
          Read Original
        </a>
      </Button>
    </div>
  )
},

 HIGHLIGHT_STATUS_LABELS = {
  failed: "Failed",
  idle: "Synced",
  offline: "Offline",
  syncing: "Saving",
} satisfies Record<"idle" | "syncing" | "failed" | "offline", string>,

 HIGHLIGHT_COLOR_CLASSES = {
  blue: "bg-sky-200/80 text-sky-900",
  green: "bg-emerald-200/80 text-emerald-900",
  purple: "bg-purple-200/80 text-purple-900",
  red: "bg-rose-200/80 text-rose-900",
  yellow: "bg-amber-200/80 text-amber-900",
} satisfies Record<Highlight["color"], string>,

 getHighlightStatusLabel = (status: "idle" | "syncing" | "failed" | "offline"): string => HIGHLIGHT_STATUS_LABELS[status],

 getHighlightToggleLabel = (showHighlights: boolean): string => {
  if (showHighlights) {
    return "Hide"
  }
  return "Show"
},

 getHighlightWordSummary = (wordCount: number, estimatedReadMinutes: number): string => {
  if (wordCount > 0) {
    return `${wordCount} words • ${estimatedReadMinutes} min read`
  }
  return `${estimatedReadMinutes} min read`
},

 ModalAnnotationsHeader = ({
  highlightCount,
  highlightSyncStatus,
}: Readonly<{
  highlightCount: number
  highlightSyncStatus: "idle" | "syncing" | "failed" | "offline"
}>) => (
  <div className="flex items-center justify-between">
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Reader</div>
      <h2 className="text-lg font-semibold text-foreground">Annotations</h2>
    </div>
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs text-muted-foreground">{highlightCount}</span>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {getHighlightStatusLabel(highlightSyncStatus)}
      </div>
    </div>
  </div>
),

 ModalAnnotationsControls = ({
  highlightSyncStatus,
  onRetrySync,
  showHighlights,
  onToggleShowHighlights,
  wordCount,
  estimatedReadMinutes,
}: Readonly<{
  highlightSyncStatus: "idle" | "syncing" | "failed" | "offline"
  onRetrySync: () => void
  showHighlights: boolean
  onToggleShowHighlights: () => void
  wordCount: number
  estimatedReadMinutes: number
}>) => (
  <div className="mt-3 flex flex-wrap items-center gap-2">
    {highlightSyncStatus === "failed" && (
      <Button type="button" variant="outline" size="sm" onClick={onRetrySync} className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Retry sync
      </Button>
    )}
    <Button type="button" variant="outline" size="sm" onClick={onToggleShowHighlights} className="gap-2">
      {showHighlights ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      {getHighlightToggleLabel(showHighlights)}
    </Button>
    <span className="text-xs text-muted-foreground">
      {getHighlightWordSummary(wordCount, estimatedReadMinutes)}
    </span>
  </div>
),

 ModalAnnotationColorPicker = ({
  highlightColor,
  onColorSelect,
}: Readonly<{
  highlightColor: Highlight["color"]
  onColorSelect: (color: Highlight["color"]) => void
}>) => (
  <div className="mt-3 flex flex-wrap gap-2">
    {(["yellow", "blue", "red", "green", "purple"] as const).map((color) => (
      <button
        key={color}
        type="button"
        onClick={() =>{  onColorSelect(color); }}
        className={`h-7 w-7 rounded border ${highlightColor === color ? "border-foreground" : "border-transparent"} ${HIGHLIGHT_COLOR_CLASSES[color]}`}
        aria-label={`Annotation color ${color}`}
      />
    ))}
  </div>
),

 ModalObsidianAddButton = ({ articleTitle, articleUrl, obsidianMarkdown }: Readonly<{
  articleTitle: string
  articleUrl: string
  obsidianMarkdown: string
}>) => {
  const title = articleTitle.replaceAll(/[:\\/]/gu, "-"),
   openObsidian = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(obsidianMarkdown)
      globalThis.location.href = `obsidian://new?file=${encodeURIComponent(`News Clippings/${title}`)}&clipboard=true`
      toast.success("Opening in Obsidian...")
    } catch {
      globalThis.location.href = `obsidian://new?file=${encodeURIComponent(`News Clippings/${title}`)}&content=${encodeURIComponent(obsidianMarkdown)}`
      toast.success("Opening in Obsidian...")
    }
    logUserAction("highlight_sent_to_obsidian", { url: articleUrl })
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={openObsidian} className="col-span-2 gap-2 border-accent/40 bg-accent/15 text-accent-foreground hover:bg-accent/25">
      <PlusCircle className="h-4 w-4" />
      Add to Obsidian
    </Button>
  )
},

 ModalCopyAnnotationsButton = ({ articleUrl, obsidianMarkdown }: Readonly<{
  articleUrl: string
  obsidianMarkdown: string
}>) => {
  const copyAnnotations = async (): Promise<void> => {
    await navigator.clipboard.writeText(obsidianMarkdown)
    toast.success("Obsidian Markdown copied")
    logUserAction("highlight_markdown_copied", { url: articleUrl })
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copyAnnotations} className="gap-2">
      <Copy className="h-4 w-4" />
      Copy
    </Button>
  )
},

 ModalExportAnnotationsButton = ({ articleTitle, articleUrl, obsidianMarkdown }: Readonly<{
  articleTitle: string
  articleUrl: string
  obsidianMarkdown: string
}>) => {
  const exportAnnotations = (): void => {
    const sanitizeFilename = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/(^-|-$)+/gu, "").slice(0, 80) || "annotations",
     blob = new Blob([obsidianMarkdown], { type: "text/markdown" }),
     fileName = `${sanitizeFilename(articleTitle)}.md`,
     link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    link.click()
    URL.revokeObjectURL(link.href)
    logUserAction("highlight_markdown_downloaded", { url: articleUrl })
    toast.success("Obsidian Markdown exported")
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={exportAnnotations} className="gap-2">
      <Download className="h-4 w-4" />
      Export
    </Button>
  )
},

 ModalAnnotationExportActions = ({ articleTitle, articleUrl, obsidianMarkdown }: Readonly<{
  articleTitle: string
  articleUrl: string
  obsidianMarkdown: string
}>) => (
  <div className="mt-3 grid grid-cols-2 gap-2">
    <ModalObsidianAddButton articleTitle={articleTitle} articleUrl={articleUrl} obsidianMarkdown={obsidianMarkdown} />
    <ModalCopyAnnotationsButton articleUrl={articleUrl} obsidianMarkdown={obsidianMarkdown} />
    <ModalExportAnnotationsButton articleTitle={articleTitle} articleUrl={articleUrl} obsidianMarkdown={obsidianMarkdown} />
  </div>
),

 ModalAnnotationsPanel = ({
  highlightCount,
  highlightSyncStatus,
  onRetrySync,
  showHighlights,
  onToggleShowHighlights,
  wordCount,
  estimatedReadMinutes,
  highlightColor,
  onColorSelect,
  obsidianMarkdown,
  articleTitle,
  articleUrl,
  articleScrollProgress,
  onBackToTop,
}: {
  highlightCount: number
  highlightSyncStatus: "idle" | "syncing" | "failed" | "offline"
  onRetrySync: () => void
  showHighlights: boolean
  onToggleShowHighlights: () => void
  wordCount: number
  estimatedReadMinutes: number
  highlightColor: Highlight["color"]
  onColorSelect: (color: Highlight["color"]) => void
  obsidianMarkdown: string
  articleTitle: string
  articleUrl: string
  articleScrollProgress: number
  onBackToTop: () => void
}) =>
  (
    <div className="rounded-lg border border-border/60 bg-secondary/70 p-4">
      <ModalAnnotationsHeader highlightCount={highlightCount} highlightSyncStatus={highlightSyncStatus} />
      <ModalAnnotationsControls
        highlightSyncStatus={highlightSyncStatus}
        onRetrySync={onRetrySync}
        showHighlights={showHighlights}
        onToggleShowHighlights={onToggleShowHighlights}
        wordCount={wordCount}
        estimatedReadMinutes={estimatedReadMinutes}
      />

      <ModalAnnotationColorPicker highlightColor={highlightColor} onColorSelect={onColorSelect} />

      <ModalAnnotationExportActions
        articleTitle={articleTitle}
        articleUrl={articleUrl}
        obsidianMarkdown={obsidianMarkdown}
      />

      <p className="mt-2 text-xs text-muted-foreground">
        Select text to highlight. Click a highlight to add a note.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        <div>Reading progress</div>
        <div className="font-mono text-foreground">{Math.round(articleScrollProgress * 100)}%</div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onBackToTop}
        className="mt-2 w-full gap-2"
      >
        <Minimize2 className="h-4 w-4 rotate-180" />
        Back to top
      </Button>
    </div>
  ),


 getModalHighlightClassName = (active: boolean, color: Highlight["color"]): string => {
  const classes = ["rounded-md", "px-3", "py-2", "text-sm", HIGHLIGHT_COLOR_CLASSES[color]]
  classes.push(active ? "border-foreground" : "border-transparent")
  return classes.join(" ")
},

 ModalHighlightFocusButton = ({
  highlight,
  articleContentRef,
  onHighlightClick,
}: Readonly<{
  highlight: LocalHighlight
  articleContentRef: { current: HTMLDivElement | null }
  onHighlightClick: (stableId: string, element: HTMLElement) => void
}>) => {
  const focusHighlight = (): void => {
    const stableId = highlightStableId(highlight),
     element = articleContentRef.current?.querySelector(`mark[data-highlight-stable-id="${stableId}"]`)
    if (element instanceof HTMLElement) {
      onHighlightClick(stableId, element)
    }
  }
  return (
    <button type="button" className="w-full text-left" onClick={focusHighlight}>
      <div className={getModalHighlightClassName(false, highlight.color)}>{highlight.highlighted_text}</div>
    </button>
  )
},

 ModalHighlightEditor = ({
  highlight,
  editingNote,
  onCancelEdit,
  onNoteChange,
  onSaveNote,
}: Readonly<{
  highlight: LocalHighlight
  editingNote: string
  onCancelEdit: () => void
  onNoteChange: (value: string) => void
  onSaveNote: (stableId: string, note: string) => void
}>) => (
  <div className="space-y-2">
    <textarea
      value={editingNote}
      onChange={(event) =>{  onNoteChange(event.target.value); }}
      placeholder="Add a note..."
      rows={3}
      className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm text-foreground"
    />
    <div className="flex gap-2">
      <Button size="sm" onClick={() =>{  onSaveNote(highlightStableId(highlight), editingNote); }}>
        Save
      </Button>
      <Button size="sm" variant="outline" onClick={onCancelEdit}>
        Cancel
      </Button>
    </div>
  </div>
),

 getHighlightNote = (note: string | undefined): string => {
  if (note !== undefined && note.trim() !== "") {
    return note
  }
  return "No note"
},

 ModalHighlightSummary = ({
  highlight,
  articleTitle,
  articleSource,
  onStartEdit,
  onDelete,
}: Readonly<{
  highlight: LocalHighlight
  articleTitle: string
  articleSource: string
  onStartEdit: (highlight: LocalHighlight) => void
  onDelete: (highlight: LocalHighlight) => void
}>) => (
  <div className="flex items-center justify-between gap-3">
    <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap break-words">
      {getHighlightNote(highlight.note)}
    </div>
    <div className="flex items-center gap-1">
      <Link
        href={`/search?query=${encodeURIComponent(`Context: ${articleTitle} by ${articleSource}\n\nExplain this highlighted passage:\n\n> ${highlight.highlighted_text}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-transparent text-muted-foreground transition-all hover:bg-primary/15 hover:border-primary/40 hover:text-primary"
        title="Research this highlight"
      >
        <Search className="h-3.5 w-3.5" />
      </Link>
      <Button type="button" variant="ghost" size="sm" onClick={() =>{  onStartEdit(highlight); }}>
        <Edit2 className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() =>{  onDelete(highlight); }} className="text-destructive hover:text-destructive">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  </div>
),

 ModalHighlightItem = ({
  highlight,
  index,
  articleTitle,
  articleSource,
  onHighlightClick,
  articleContentRef,
  editingId,
  editingNote,
  onStartEdit,
  onCancelEdit,
  onNoteChange,
  onSaveNote,
  onDelete,
}: Readonly<{
  highlight: LocalHighlight
  index: number
  articleTitle: string
  articleSource: string
  onHighlightClick: (stableId: string, element: HTMLElement) => void
  articleContentRef: { current: HTMLDivElement | null }
  editingId: string | null
  editingNote: string
  onStartEdit: (highlight: LocalHighlight) => void
  onCancelEdit: () => void
  onNoteChange: (value: string) => void
  onSaveNote: (stableId: string, note: string) => void
  onDelete: (highlight: LocalHighlight) => void
}>) => (
  <div className="relative rounded-lg border border-border/60 bg-background/60 p-4 space-y-3">
    <div className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background font-mono text-xs font-bold text-muted-foreground shadow-sm">
      {index + 1}
    </div>
    <ModalHighlightFocusButton
      highlight={highlight}
      articleContentRef={articleContentRef}
      onHighlightClick={onHighlightClick}
    />
    {editingId === highlightStableId(highlight) ? (
      <ModalHighlightEditor
        highlight={highlight}
        editingNote={editingNote}
        onCancelEdit={onCancelEdit}
        onNoteChange={onNoteChange}
        onSaveNote={onSaveNote}
      />
    ) : (
      <ModalHighlightSummary
        highlight={highlight}
        articleTitle={articleTitle}
        articleSource={articleSource}
        onStartEdit={onStartEdit}
        onDelete={onDelete}
      />
    )}
  </div>
),

 ModalHighlightsContent = (props: Readonly<{
  highlights: readonly LocalHighlight[]
  articleTitle: string
  articleSource: string
  onHighlightClick: (stableId: string, element: HTMLElement) => void
  articleContentRef: { current: HTMLDivElement | null }
  editingId: string | null
  editingNote: string
  onStartEdit: (highlight: LocalHighlight) => void
  onCancelEdit: () => void
  onNoteChange: (value: string) => void
  onSaveNote: (stableId: string, note: string) => void
  onDelete: (highlight: LocalHighlight) => void
}>) => {
  if (props.highlights.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
        No annotations yet.
      </div>
    )
  }
  return props.highlights
    .filter((highlight) => !highlight.deleted)
    .sort((a, b) => a.character_start - b.character_start)
    .map((highlight, index) => (
      <ModalHighlightItem key={highlightStableId(highlight)} index={index} {...props} highlight={highlight} />
    ))
},

 ModalHighlightsList = ({
  highlights,
  articleTitle,
  articleSource,
  onHighlightClick,
  articleContentRef,
  editingId,
  editingNote,
  onStartEdit,
  onCancelEdit,
  onNoteChange,
  onSaveNote,
  onDelete,
}: {
  highlights: LocalHighlight[]
  articleTitle: string
  articleSource: string
  onHighlightClick: (stableId: string, element: HTMLElement) => void
  articleContentRef: { current: HTMLDivElement | null }
  editingId: string | null
  editingNote: string
  onStartEdit: (highlight: LocalHighlight) => void
  onCancelEdit: () => void
  onNoteChange: (value: string) => void
  onSaveNote: (stableId: string, note: string) => void
  onDelete: (highlight: LocalHighlight) => void
}) => (
  <div className="space-y-3">
    <ModalHighlightsContent
      highlights={highlights}
      articleTitle={articleTitle}
      articleSource={articleSource}
      onHighlightClick={onHighlightClick}
      articleContentRef={articleContentRef}
      editingId={editingId}
      editingNote={editingNote}
      onStartEdit={onStartEdit}
      onCancelEdit={onCancelEdit}
      onNoteChange={onNoteChange}
      onSaveNote={onSaveNote}
      onDelete={onDelete}
    />
  </div>
),

 ModalAiDisabledState = ({ visible }: Readonly<{ visible: boolean }>) => visible ? (
  <div className="rounded-sm border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">AI Analysis</p>
    <p className="mt-2 text-foreground/80 font-serif">
      AI analysis is off by default. Use the “Run Analysis” button when you need it.
    </p>
  </div>
) : undefined,

 ModalAiLoadingState = ({ visible }: Readonly<{ visible: boolean }>) => visible ? (
  <div className="rounded-lg border border-border/60 bg-secondary/70 p-5 text-sm text-muted-foreground">
    Running AI analysis…
  </div>
) : undefined,

 ModalAiErrorState = ({ error }: Readonly<{ error?: string | null }>) => error ? (
  <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-200">
    {error}
  </div>
) : undefined,

 ModalAiStatusBlocks = ({
  aiAnalysisRequested,
  aiAnalysisLoading,
  aiAnalysis,
}: {
  aiAnalysisRequested: boolean
  aiAnalysisLoading: boolean
  aiAnalysis: ArticleAnalysis | null
}) => (
  <>
    <ModalAiDisabledState visible={!aiAnalysisRequested} />
    <ModalAiLoadingState visible={aiAnalysisRequested && aiAnalysisLoading} />
    <ModalAiErrorState error={aiAnalysisRequested ? aiAnalysis?.error : undefined} />
  </>
),

 FactCheckLaunchCard = ({
  factCheckResults,
  selectedClaim,
  onSelectClaim,
}: {
  factCheckResults: FactCheckResult[]
  selectedClaim: FactCheckResult | null
  onSelectClaim: (claim: FactCheckResult) => void
}) => (
  <button
    type="button"
    onClick={() => {
      if (!selectedClaim && factCheckResults.length > 0) {
        onSelectClaim(factCheckResults[0]!)
      }
    }}
    className="group relative w-full overflow-hidden rounded-2xl border border-border/60 bg-card/70 p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:bg-card/90 hover:shadow-xl hover:shadow-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    aria-label="Open verified claims report"
  >
    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-80" />
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary/80 transition-transform duration-300 group-hover:rotate-3" />
        <h3 className="text-lg font-semibold text-foreground">Fact Check Results</h3>
      </div>
      <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground/85">
        {factCheckResults.length} claims
      </span>
    </div>
    <p className="mb-4 max-w-xl text-sm text-muted-foreground">
      Review each claim, inspect the model’s evidence summary, and run live research without leaving the article.
    </p>
    <div className="space-y-3">
      {factCheckResults.slice(0, 3).map((result, index) => (
        <div
          key={`${result.claim}-${index}`}
          className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3 transition-all duration-300 group-hover:border-primary/30"
        >
          <Badge className={`${VERIFICATION_STYLE_MAP[result.verification_status]} text-xs uppercase tracking-wide`}>
            {VERIFICATION_LABEL_MAP[result.verification_status]}
          </Badge>
          <p className="line-clamp-2 text-sm text-foreground/80">&quot;{result.claim}&quot;</p>
        </div>
      ))}
    </div>
    <div className="mt-5 flex items-center justify-between text-xs text-foreground/70">
      <span>Open the verification workspace</span>
      <div className="flex items-center gap-2 font-semibold">
        <span>Open</span>
        <ExternalLink className="h-3.5 w-3.5" />
      </div>
    </div>
  </button>
),

 FactCheckClaimSidebar = ({
  factCheckResults,
  statusCounts,
  activeStatusFilter,
  onFilterChange,
  filteredClaims,
  selectedClaim,
  onSelectClaim,
}: {
  factCheckResults: FactCheckResult[]
  statusCounts: Record<FactCheckStatus, number>
  activeStatusFilter: FactCheckStatusFilter
  onFilterChange: (filter: FactCheckStatusFilter) => void
  filteredClaims: FactCheckResult[]
  selectedClaim: FactCheckResult | null
  onSelectClaim: (claim: FactCheckResult) => void
}) => (
  <div className="border-b border-border/60 bg-card/40 p-5 md:col-span-4 md:border-b-0 md:border-r lg:col-span-3">
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Claim Filters</p>
    </div>
    <div className="flex flex-wrap gap-2">
      {STATUS_FILTERS.map((status) => {
        const isAll = status === "all",
         count = isAll ? factCheckResults.length : statusCounts[status],
         isDisabled = !isAll && count === 0,
         isActive = activeStatusFilter === status

        return (
          <button
            key={status}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-all ${isActive ? "border-primary/50 bg-primary/10 text-foreground" : "border-border/60 bg-background/40 text-foreground/75 hover:border-primary/40 hover:text-foreground"} ${isDisabled ? "cursor-not-allowed opacity-40 hover:border-border/60 hover:text-foreground/75" : "cursor-pointer"}`}
            onClick={() => {
              if (isDisabled) {return}
              onFilterChange(status)
            }}
          >
            {status === "all" ? "All" : VERIFICATION_LABEL_MAP[status]}
            <span className="ml-2 rounded-full bg-background/70 px-2 py-0.5 text-xs font-bold text-foreground/80">
              {count}
            </span>
          </button>
        )
      })}
    </div>
    <div className="mt-5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Claims</h4>
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1 md:max-h-full">
        {filteredClaims.map((claim, index) => {
          const isActive = selectedClaim?.claim === claim.claim
          return (
            <button
              key={`${claim.claim}-${index}`}
              type="button"
              className={`w-full rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 ${isActive ? "border-primary/50 bg-primary/10 shadow-lg shadow-black/20" : "border-border/60 bg-background/45"}`}
              onClick={() => {
                onSelectClaim(claim)
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <Badge className={`${VERIFICATION_STYLE_MAP[claim.verification_status]} text-xs uppercase tracking-wide`}>
                  {VERIFICATION_LABEL_MAP[claim.verification_status]}
                </Badge>
              </div>
              <span className="line-clamp-3 text-sm text-foreground/85">{claim.claim}</span>
            </button>
          )
        })}
        {filteredClaims.length === 0 && (
          <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-xs text-muted-foreground">
            No claims in this category yet. Try another filter.
          </div>
        )}
      </div>
    </div>
  </div>
),

 FactCheckClaimSources = ({ sources }: Readonly<{ sources: FactCheckResult["sources"] }>) => (
  <div className="flex flex-wrap gap-2 text-xs text-foreground/75">
    {sources?.slice(0, 4).map((source, idx) => (
      <a
        key={`${source}-${idx}`}
        href={source}
        target="_blank"
        rel="noopener noreferrer"
        className="group/link inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-3 py-1 transition hover:border-primary/40 hover:text-foreground"
      >
        <LinkIcon className="h-3 w-3" />
        <span className="max-w-48 truncate">{source}</span>
        <ExternalLink className="h-3 w-3 transition group-hover/link:translate-x-0.5" />
      </a>
    ))}
    {(!sources || sources.length === 0) && (
      <span className="rounded-full border border-border/60 px-3 py-1">No sources provided</span>
    )}
  </div>
),

 FactCheckClaimActions = ({ claim, evidence }: Readonly<{ claim: string; evidence: FactCheckResult["evidence"] }>) => (
  <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 transition hover:border-primary/40 hover:text-foreground"
      onClick={() => {
        if (typeof navigator !== "undefined") {
          navigator.clipboard.writeText(`${claim}\n\nEvidence: ${evidence ?? "N/A"}`).catch(() => null)
        }
      }}
    >
      <Copy className="h-3.5 w-3.5" />
      Copy claim
    </button>
    <Button variant="outline" size="sm" asChild>
      <a href={`/search?query=${encodeURIComponent(claim)}`} target="_blank" rel="noopener noreferrer">
        <Search className="mr-1 h-3.5 w-3.5" />
        Open research workspace
      </a>
    </Button>
  </div>
),

 FactCheckClaimEvidence = ({ selectedClaim }: { selectedClaim: FactCheckResult }) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge className={`${VERIFICATION_STYLE_MAP[selectedClaim.verification_status]} text-xs uppercase tracking-wide`}>
          {VERIFICATION_LABEL_MAP[selectedClaim.verification_status]}
        </Badge>
        <Badge className={`${getConfidenceColor(selectedClaim.confidence)} text-xs uppercase tracking-wide`}>
          confidence: {selectedClaim.confidence}
        </Badge>
      </div>
    </div>
    <p className="text-base font-medium leading-relaxed text-foreground">&quot;{selectedClaim.claim}&quot;</p>
    {selectedClaim.notes && <p className="mt-3 text-sm text-muted-foreground">{selectedClaim.notes}</p>}
    <div className="mt-4 space-y-2">
      <h5 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Evidence</h5>
      <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-sm leading-relaxed text-foreground/85">
        {selectedClaim.evidence || "Evidence details not provided."}
      </div>
      <FactCheckClaimSources sources={selectedClaim.sources} />
    </div>
    <FactCheckClaimActions claim={selectedClaim.claim} evidence={selectedClaim.evidence} />
  </div>
),

 FactCheckLiveResearch = ({
  selectedClaim,
  agenticLoading,
  agenticError,
  agenticAnswer,
  agenticHistory,
  onRunAgenticSearch,
}: {
  selectedClaim: FactCheckResult
  agenticLoading: boolean
  agenticError: string | null
  agenticAnswer: string | null
  agenticHistory: { claim: string; answer: string; timestamp: number }[]
  onRunAgenticSearch: (claim: FactCheckResult) => void
}) => (
  <div className="rounded-2xl border border-border/60 bg-slate-950/90 p-5">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Search className="h-4 w-4" /> Live Research
        </h4>
        <p className="text-xs text-muted-foreground">Query the current research backend with this claim and article context.</p>
      </div>
      {agenticHistory.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-1 text-xs uppercase tracking-wide text-foreground/80">
          Last run {new Date(agenticHistory[0]!.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() =>{  onRunAgenticSearch(selectedClaim); }} disabled={agenticLoading} className="inline-flex items-center gap-2">
        {agenticLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Researching
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Live Research
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="inline-flex items-center gap-2 text-foreground/80 hover:text-foreground"
        onClick={() =>{  onRunAgenticSearch(selectedClaim); }}
        disabled={agenticLoading}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
    {agenticError && (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
        <XCircle className="mt-0.5 h-4 w-4" />
        <span>{agenticError}</span>
      </div>
    )}
    {agenticAnswer && (
      <div className="mt-4 space-y-2 rounded-xl border border-primary/25 bg-primary/10 p-4 text-sm text-foreground">
        <div className="flex items-start gap-2 text-xs uppercase tracking-widest text-foreground/70">
          <CheckCircle2 className="mt-0.5 h-4 w-4" />
          Research answer
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{agenticAnswer}</p>
      </div>
    )}
  </div>
),

 FactCheckClaimDetails = ({
  selectedClaim,
  agenticLoading,
  agenticError,
  agenticAnswer,
  agenticHistory,
  onRunAgenticSearch,
}: {
  selectedClaim: FactCheckResult | null
  agenticLoading: boolean
  agenticError: string | null
  agenticAnswer: string | null
  agenticHistory: { claim: string; answer: string; timestamp: number }[]
  onRunAgenticSearch: (claim: FactCheckResult) => void
}) => (
  <div className="space-y-5 overflow-y-auto p-6 md:col-span-8 lg:col-span-9">
    {selectedClaim ? (
      <div className="space-y-4">
        <FactCheckClaimEvidence selectedClaim={selectedClaim} />
        <FactCheckLiveResearch
          selectedClaim={selectedClaim}
          agenticLoading={agenticLoading}
          agenticError={agenticError}
          agenticAnswer={agenticAnswer}
          agenticHistory={agenticHistory}
          onRunAgenticSearch={onRunAgenticSearch}
        />
      </div>
    ) : (
      <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
        <Sparkles className="h-6 w-6 text-primary/80" />
        <p>Select a claim from the list to view its evidence and run deeper research.</p>
      </div>
    )}
  </div>
),

 ModalFactCheckDialog = ({
  factCheckResults,
  claimsOpen,
  onOpenChange,
  statusCounts,
  activeStatusFilter,
  onFilterChange,
  filteredClaims,
  selectedClaim,
  onSelectClaim,
  agenticLoading,
  agenticError,
  agenticAnswer,
  agenticHistory,
  onRunAgenticSearch,
}: {
  factCheckResults: FactCheckResult[]
  claimsOpen: boolean
  onOpenChange: (open: boolean) => void
  statusCounts: Record<FactCheckStatus, number>
  activeStatusFilter: FactCheckStatusFilter
  onFilterChange: (filter: FactCheckStatusFilter) => void
  filteredClaims: FactCheckResult[]
  selectedClaim: FactCheckResult | null
  onSelectClaim: (claim: FactCheckResult) => void
  agenticLoading: boolean
  agenticError: string | null
  agenticAnswer: string | null
  agenticHistory: { claim: string; answer: string; timestamp: number }[]
  onRunAgenticSearch: (claim: FactCheckResult) => void
}) => (
  <Dialog open={claimsOpen} onOpenChange={onOpenChange}>
    <DialogTrigger asChild>
      <FactCheckLaunchCard
        factCheckResults={factCheckResults}
        selectedClaim={selectedClaim}
        onSelectClaim={onSelectClaim}
      />
    </DialogTrigger>
    <DialogContent className="max-h-screen overflow-hidden border border-border/60 bg-background/95 p-0 text-foreground shadow-2xl shadow-black/60 sm:max-w-5xl">
      <DialogHeader className="border-b border-border/60 px-6 py-5">
        <DialogTitle className="flex items-center gap-2 text-foreground">
          <Sparkles className="h-5 w-5 text-primary/80" />
          Verification Report
        </DialogTitle>
        <p className="text-sm text-muted-foreground">Review claims, inspect evidence, and run live research against the same article context.</p>
      </DialogHeader>
      <div className="grid max-h-screen md:grid-cols-12">
        <FactCheckClaimSidebar
          factCheckResults={factCheckResults}
          statusCounts={statusCounts}
          activeStatusFilter={activeStatusFilter}
          onFilterChange={onFilterChange}
          filteredClaims={filteredClaims}
          selectedClaim={selectedClaim}
          onSelectClaim={onSelectClaim}
        />
        <FactCheckClaimDetails
          selectedClaim={selectedClaim}
          agenticLoading={agenticLoading}
          agenticError={agenticError}
          agenticAnswer={agenticAnswer}
          agenticHistory={agenticHistory}
          onRunAgenticSearch={onRunAgenticSearch}
        />
      </div>
    </DialogContent>
  </Dialog>
),
 ModalAiSummary = ({ summary }: Readonly<{ summary?: string }>) => summary ? (
  <div className="rounded-2xl border border-border/60 bg-slate-950/85 p-6 shadow-2xl shadow-black/40">
    <div className="mb-3 flex items-center gap-2">
      <Sparkles className="h-5 w-5 text-primary" />
      <h3 className="text-lg font-semibold text-foreground">AI Summary</h3>
    </div>
    <p className="text-sm leading-relaxed text-foreground/85">{summary}</p>
  </div>
) : undefined,

 ModalAiBiasAnalysis = ({ analysis }: Readonly<{ analysis: NonNullable<ArticleAnalysis["bias_analysis"]> }>) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-6">
    <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
      <AlertTriangle className="h-5 w-5 text-yellow-400" />
      Bias Analysis
    </h3>
    {analysis.overall_bias_score && (
      <div className="mb-3">
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          Score: {analysis.overall_bias_score}/10
        </Badge>
      </div>
    )}
    <div className="space-y-3 text-sm">
      <div>
        <span className="text-muted-foreground">Tone:</span>
        <p className="mt-1 text-foreground">{analysis.tone_bias}</p>
      </div>
      <div>
        <span className="text-muted-foreground">Framing:</span>
        <p className="mt-1 text-foreground">{analysis.framing_bias}</p>
      </div>
    </div>
  </div>
),

 ModalAiSourceAnalysis = ({ analysis }: Readonly<{ analysis: NonNullable<ArticleAnalysis["source_analysis"]> }>) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-6">
    <h3 className="mb-4 text-lg font-semibold text-foreground">Source Info</h3>
    <div className="space-y-3 text-sm">
      <div>
        <span className="text-muted-foreground">Credibility:</span>
        <p className="mt-1 text-foreground">{analysis.credibility_assessment}</p>
      </div>
      <div>
        <span className="text-muted-foreground">Political Leaning:</span>
        <p className="mt-1 text-foreground">{analysis.political_leaning}</p>
      </div>
    </div>
  </div>
),

 ModalFactCheckSuggestions = ({ suggestions }: Readonly<{ suggestions?: NonNullable<ArticleAnalysis["fact_check_suggestions"]> }>) => suggestions && suggestions.length > 0 ? (
  <div className="bg-cyan-500/5 border border-cyan-500/30 rounded-lg p-6">
    <h3 className="text-lg font-semibold text-white mb-3">Fact Check</h3>
    <ul className="space-y-2 text-sm">
      {suggestions.slice(0, 3).map((suggestion, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="text-cyan-400 mt-1">•</span>
          <span className="text-gray-300">{suggestion}</span>
        </li>
      ))}
    </ul>
  </div>
) : undefined,

 ModalAiAnalysisBlock = ({
  aiAnalysis,
  factCheckResults,
  claimsOpen,
  onOpenChange,
  statusCounts,
  activeStatusFilter,
  onFilterChange,
  filteredClaims,
  selectedClaim,
  onSelectClaim,
  agenticLoading,
  agenticError,
  agenticAnswer,
  agenticHistory,
  onRunAgenticSearch,
}: {
  aiAnalysis: ArticleAnalysis
  factCheckResults: FactCheckResult[]
  claimsOpen: boolean
  onOpenChange: (open: boolean) => void
  statusCounts: Record<FactCheckStatus, number>
  activeStatusFilter: FactCheckStatusFilter
  onFilterChange: (filter: FactCheckStatusFilter) => void
  filteredClaims: FactCheckResult[]
  selectedClaim: FactCheckResult | null
  onSelectClaim: (claim: FactCheckResult) => void
  agenticLoading: boolean
  agenticError: string | null
  agenticAnswer: string | null
  agenticHistory: { claim: string; answer: string; timestamp: number }[]
  onRunAgenticSearch: (claim: FactCheckResult) => void
}) => (
  <div className="sticky top-6 space-y-6">
    <ModalAiSummary summary={aiAnalysis.summary} />
    {aiAnalysis.bias_analysis && <ModalAiBiasAnalysis analysis={aiAnalysis.bias_analysis} />}
    {aiAnalysis.source_analysis && <ModalAiSourceAnalysis analysis={aiAnalysis.source_analysis} />}
    {factCheckResults.length > 0 && (
      <ModalFactCheckDialog
        factCheckResults={factCheckResults}
        claimsOpen={claimsOpen}
        onOpenChange={onOpenChange}
        statusCounts={statusCounts}
        activeStatusFilter={activeStatusFilter}
        onFilterChange={onFilterChange}
        filteredClaims={filteredClaims}
        selectedClaim={selectedClaim}
        onSelectClaim={onSelectClaim}
        agenticLoading={agenticLoading}
        agenticError={agenticError}
        agenticAnswer={agenticAnswer}
        agenticHistory={agenticHistory}
        onRunAgenticSearch={onRunAgenticSearch}
      />
    )}
    <ModalFactCheckSuggestions suggestions={aiAnalysis.fact_check_suggestions} />
  </div>
),


 ModalSourceContent = ({
  sourceLoading,
  source,
  article,
  reporterName,
  showSourceDetails,
  onOpenSourceWiki,
  onOpenReporterWiki,
  onClose,
}: Readonly<{
  sourceLoading: boolean
  source: NewsSource | null | undefined
  article: NewsArticle
  reporterName: string
  showSourceDetails: boolean
  onOpenSourceWiki: () => void
  onOpenReporterWiki: () => void
  onClose: () => void
}>) => {
  if (sourceLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    )
  }
  if (source === undefined || source === null) {
    return <p className="text-gray-400 text-sm">Source info unavailable</p>
  }
  return (
    <SourceTransparencyDetails
      source={source}
      article={article}
      reporterName={reporterName}
      showSourceDetails={showSourceDetails}
      onOpenSourceWiki={onOpenSourceWiki}
      onOpenReporterWiki={onOpenReporterWiki}
      onClose={onClose}
    />
  )
},

 ModalSourceDebug = ({
  debugMode,
  debugOpen,
  debugLoading,
  debugData,
  matchedEntryIndex,
  onToggleDebug,
}: Readonly<{
  debugMode: boolean
  debugOpen: boolean
  debugLoading: boolean
  debugData: SourceDebugData | null
  matchedEntryIndex: number | null
  onToggleDebug: () => void
}>) => {
  if (!debugMode) {
    return
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={onToggleDebug} className="w-full mt-4">
        <Bug className="h-4 w-4 mr-1" /> {debugOpen ? "Hide" : "Show"} Debug
      </Button>
      {debugOpen && <SourceDebugPanel loading={debugLoading} data={debugData} matchedEntryIndex={matchedEntryIndex} />}
    </>
  )
},

 ModalSourceTransparency = ({
  sourceLoading,
  source,
  article,
  reporterName,
  showSourceDetails,
  onToggleDetails,
  debugMode,
  debugOpen,
  debugLoading,
  debugData,
  matchedEntryIndex,
  onToggleDebug,
  onOpenSourceWiki,
  onOpenReporterWiki,
  onClose,
}: {
  sourceLoading: boolean
  source: NewsSource | null | undefined
  article: NewsArticle
  reporterName: string
  showSourceDetails: boolean
  onToggleDetails: () => void
  debugMode: boolean
  debugOpen: boolean
  debugLoading: boolean
  debugData: SourceDebugData | null
  matchedEntryIndex: number | null
  onToggleDebug: () => void
  onOpenSourceWiki: () => void
  onOpenReporterWiki: () => void
  onClose: () => void
}) =>
  (
    <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-400" />
          Source
        </h3>
        <Button variant="outline" size="sm" onClick={onToggleDetails}>
          {showSourceDetails ? "Hide" : "Show"}
        </Button>
      </div>

      <ModalSourceContent
        sourceLoading={sourceLoading}
        source={source}
        article={article}
        reporterName={reporterName}
        showSourceDetails={showSourceDetails}
        onOpenSourceWiki={onOpenSourceWiki}
        onOpenReporterWiki={onOpenReporterWiki}
        onClose={onClose}
      />
      <ModalSourceDebug
        debugMode={debugMode}
        debugOpen={debugOpen}
        debugLoading={debugLoading}
        debugData={debugData}
        matchedEntryIndex={matchedEntryIndex}
        onToggleDebug={onToggleDebug}
      />
    </div>
  ),

 SourceTransparencyDetails = ({
  source,
  article,
  reporterName,
  showSourceDetails,
  onOpenSourceWiki,
  onOpenReporterWiki,
  onClose,
}: {
  source: NewsSource
  article: NewsArticle
  reporterName: string
  showSourceDetails: boolean
  onOpenSourceWiki: () => void
  onOpenReporterWiki: () => void
  onClose: () => void
}) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2 text-sm">
      <DollarSign className="h-4 w-4 text-green-400" />
      <span className="text-gray-400">Funding:</span>
      <span className="text-white text-xs">{source.funding?.join(", ") || "N/A"}</span>
    </div>
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-400">Published:</span>
      <span className="text-white text-xs">{formatDate(article.publishedAt)}</span>
    </div>
    {reporterName && (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-400">Reporter:</span>
        <button
          type="button"
          className="text-white text-xs hover:text-primary hover:underline transition-colors"
          onClick={(event) => {
            event.stopPropagation()
            onOpenReporterWiki()
          }}
        >
          {reporterName}
        </button>
        <Link
          href={`/wiki/reporters?search=${encodeURIComponent(reporterName)}`}
          className="text-muted-foreground hover:text-primary transition-colors"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          title="Open reporter wiki page"
        >
          <BookOpen className="h-3 w-3" />
        </Link>
      </div>
    )}
    {showSourceDetails && (
      <div className="space-y-3 pt-3 border-t border-gray-700 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Publisher:</span>
          <button
            type="button"
            className="text-white hover:text-primary hover:underline transition-colors"
            onClick={(event) => {
              event.stopPropagation()
              onOpenSourceWiki()
            }}
          >
            {source.name}
          </button>
          <Link
            href={`/wiki/source/${encodeURIComponent(source.name)}`}
            className="text-muted-foreground hover:text-primary transition-colors"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
            title="View wiki profile"
          >
            <BookOpen className="h-3 w-3" />
          </Link>
        </div>
        <div>
          <span className="text-gray-400">Country:</span>
          <span className="text-white ml-2">{source.country}</span>
        </div>
      </div>
    )}
  </div>
),

 ModalDebugContent = ({ data, matchedEntryIndex }: Readonly<{
  data: SourceDebugData
  matchedEntryIndex: number | null
}>) => (
  <div className="space-y-2 text-xs">
    <div className="text-gray-400">Entries: {data.feed_status?.entries_count}</div>
    <div className="text-gray-400">Has Images: {data.image_analysis?.entries_with_images}/{data.image_analysis?.total_entries}</div>
    {matchedEntryIndex !== null && <div className="text-primary">Matched at index: {matchedEntryIndex}</div>}
  </div>
),

 ModalDebugState = ({ data, matchedEntryIndex }: Readonly<{
  data: SourceDebugData | null
  matchedEntryIndex: number | null
}>) => {
  if (data === null) {
    return <div className="text-gray-400 text-xs">No debug data</div>
  }
  return <ModalDebugContent data={data} matchedEntryIndex={matchedEntryIndex} />
},

 SourceDebugPanel = ({
  loading,
  data,
  matchedEntryIndex,
}: {
  loading: boolean
  data: SourceDebugData | null
  matchedEntryIndex: number | null
}) => {
  if (loading) {
    return (
      <div className="mt-4 p-4 bg-black/40 rounded border border-gray-800">
        <div className="flex items-center justify-center p-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      </div>
    )
  }
  return (
    <div className="mt-4 p-4 bg-black/40 rounded border border-gray-800">
      <ModalDebugState data={data} matchedEntryIndex={matchedEntryIndex} />
    </div>
  )
},


 getFactCheckReadyLabel = (factCheckCount: number): string => {
  if (factCheckCount === 1) {
    return "1 claim ready for verification review"
  }
  return `${factCheckCount} claims ready for verification review`
},

 ModalAiProgressNotice = ({ visible }: Readonly<{ visible: boolean }>) => {
  if (!visible) {
    return
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-slate-950/85 p-4">
      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
      <p className="text-sm text-muted-foreground">AI is analyzing the article in the background.</p>
    </div>
  )
},

 ModalAiSummaryCard = ({
  visible,
  summary,
  factCheckCount,
  onExpand,
}: Readonly<{
  visible: boolean
  summary: string | undefined
  factCheckCount: number
  onExpand: () => void
}>) => {
  if (!visible || summary === undefined || summary === "") {
    return
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-slate-950/85 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">AI Summary</h3>
      </div>
      <p className="text-sm leading-relaxed text-foreground/85">{summary}</p>
      {factCheckCount > 0 && (
        <p className="mt-3 text-xs uppercase tracking-widest text-muted-foreground">
          {getFactCheckReadyLabel(factCheckCount)}
        </p>
      )}
      <Button variant="outline" size="sm" onClick={onExpand} className="mt-3 w-full border-border/60 bg-background/50">
        <Maximize2 className="h-4 w-4 mr-2" />
        Expand for Full AI Analysis
      </Button>
    </div>
  )
},

 ModalCompactAiSection = ({
  isExpanded,
  aiAnalysisLoading,
  aiAnalysis,
  factCheckCount,
  onExpand,
}: {
  isExpanded: boolean
  aiAnalysisLoading: boolean
  aiAnalysis: ArticleAnalysis | null
  factCheckCount: number
  onExpand: () => void
}) => (
  <>
    <ModalAiProgressNotice visible={!isExpanded && aiAnalysisLoading} />
    <ModalAiSummaryCard
      visible={!isExpanded}
      summary={aiAnalysis?.summary}
      factCheckCount={factCheckCount}
      onExpand={onExpand}
    />
  </>
),



 getAiActionLabel = (
  requested: boolean,
  loading: boolean,
  analysis: ArticleAnalysis | undefined,
): string => {
  if (!requested) {return "Run AI Analysis"}
  if (loading) {return "Running AI Analysis"}
  if (analysis?.error) {return "Retry AI Analysis"}
  return "AI Analysis Ready"
},

 getFactCheckStatusCounts = (
  results: readonly FactCheckResult[],
): Record<FactCheckStatus, number> => results.reduce<Record<FactCheckStatus, number>>(
  (counts, result) => ({ ...counts, [result.verification_status]: counts[result.verification_status] + 1 }),
  { false: 0, "partially-verified": 0, unverified: 0, verified: 0 },
),

 filterFactCheckResults = (
  results: readonly FactCheckResult[],
  filter: FactCheckStatusFilter,
): FactCheckResult[] => filter === "all"
  ? [...results]
  : results.filter((claim) => claim.verification_status === filter),

 getVisibleRemoteHighlights = (highlights: readonly LocalHighlight[]): Highlight[] =>
  toRemoteHighlights(highlights.filter((highlight) => !highlight.deleted)),

 getArticleObsidianMarkdown = (
  article: Readonly<NewsArticle>,
  fullArticleText: string | undefined,
  reporterName: string,
  highlights:readonly Highlight[],
): string => buildObsidianMarkdown({
  article: {
    author: reporterName || article.author,
    content: article.content,
    publishedAt: article.publishedAt || "",
    summary: article.summary || "",
    title: article.title || "",
    url: article.url || "",
  },
  fullArticleText,
  highlights,
})

interface ArticleDetailServices {
  analyzeArticle: typeof analyzeArticle
  createHighlight: typeof createHighlight
  deleteHighlight: typeof deleteHighlight
  fetchLanguageDiagnostics: typeof fetchLanguageDiagnostics
  fetchSourceDebugData: typeof fetchSourceDebugData
  getHighlightsForArticle: typeof getHighlightsForArticle
  getSourceById: typeof getSourceById
  performAgenticSearch: typeof performAgenticSearch
  updateHighlight: typeof updateHighlight
}

const DEFAULT_ARTICLE_DETAIL_SERVICES: ArticleDetailServices = {
  analyzeArticle,
  createHighlight,
  deleteHighlight,
  fetchLanguageDiagnostics,
  fetchSourceDebugData,
  getHighlightsForArticle,
  getSourceById,
  performAgenticSearch,
  updateHighlight,
}

interface ArticleDetailModalProps {
  article: NewsArticle | null
  isOpen: boolean
  onClose: () => void
  onBookmarkChange?: (articleId: number, isBookmarked: boolean) => void
  onNavigate?: (direction: "prev" | "next") => void
  layoutIdPrefix?: string
  services?: ArticleDetailServices
}

const ArticleDetailModal = (props: ArticleDetailModalProps) => {
  const { article, isOpen } = props
  if (!isOpen || !article) {return null}

  return (
    <ArticleDetailModalContent
      key={`${article.id}:${article.url}`}
      {...props}
      article={article}
    />
  )
};

interface ArticleDetailDialogBodyProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onDialogOpenChange: (open: boolean) => void
  readonly currentArticle: Readonly<NewsArticle>
  readonly layoutIdPrefix?: string
  readonly inlineResult: ReturnType<typeof useInlineDefinition>["result"]
  readonly inlineOpen: boolean
  readonly setInlineOpen: (open: boolean) => void
  readonly inlineAnchorPosition: ReturnType<typeof useInlineDefinition>["anchorPosition"]
  readonly highlightPopoverOpen: boolean
  readonly highlightPopoverHighlight: LocalHighlight | undefined
  readonly highlightPopoverAnchorEl: HTMLElement | undefined
  readonly onCloseHighlightPopover: () => void
  readonly onSaveHighlightNote: (highlightId: string, note: string) => Promise<void>
  readonly wikiPanelOpen: boolean
  readonly setWikiPanelOpen: (open: boolean) => void
  readonly wikiPanelTab: "source" | "reporter"
  readonly setWikiPanelTab: (tab: "source" | "reporter") => void
  readonly reporterName: string
  readonly hasSourceWiki: boolean
  readonly hasReporterWiki: boolean
  readonly articleHost?: string
  readonly articleWikiContext: string
  readonly onNavigate?: (direction: "prev" | "next") => void
  readonly handleNavigate: (direction: "prev" | "next") => void
  readonly isExpanded: boolean
  readonly onToggleExpanded: () => void
  readonly articleScrollProgress: number
  readonly progressTrackRef: { current: HTMLDivElement | null }
  readonly contentScrollRef: { current: HTMLDivElement | null }
  readonly articleContentRef: { current: HTMLDivElement | null }
  readonly fullArticleText: string | undefined
  readonly articleLoading: boolean
  readonly showSummary: boolean
  readonly visibleHighlights: Highlight[]
  readonly showHighlights: boolean
  readonly activeHighlightId: string | undefined
  readonly highlightColor: Highlight["color"]
  readonly onHighlightClick: HighlightClickHandler
  readonly onCreate: CreateHighlightHandler
  readonly onUpdate: UpdateHighlightHandler
  readonly onDelete: DeleteHighlightHandler
  readonly aiAnalysis: ArticleAnalysis | undefined
  readonly aiAnalysisLoading: boolean
  readonly bookmarkLoading: boolean
  readonly canPersistArticle: boolean
  readonly canRequestAiAnalysis: boolean
  readonly aiAnalysisRequested: boolean
  readonly aiHasError: boolean
  readonly aiActionLabel: string
  readonly isLiked: (articleId: number) => boolean
  readonly isFavorite: (sourceId: string) => boolean
  readonly isBookmarked: (articleId: number) => boolean
  readonly isArticleInQueue: (url: string) => boolean
  readonly onLike: () => void
  readonly onFavorite: () => void
  readonly onBookmark: () => void
  readonly onAiAnalysis: () => void
  readonly onQueueToggle: () => void
  readonly highlights: readonly LocalHighlight[]
  readonly highlightSyncStatus: ModalHighlightSyncStatus
  readonly onRetrySync: () => void
  readonly onToggleShowHighlights: () => void
  readonly wordCount: number
  readonly estimatedReadMinutes: number
  readonly onColorSelect: (color: Highlight["color"]) => void
  readonly obsidianMarkdown: string
  readonly onBackToTop: () => void
  readonly editingId: string | undefined
  readonly editingNote: string
  readonly onStartEdit: (highlight: LocalHighlight) => void
  readonly onCancelEdit: () => void
  readonly onNoteChange: (value: string) => void
  readonly onSaveNote: (stableId: string, note: string) => void
  readonly onHighlightDelete: (highlight: LocalHighlight) => void
  readonly languageDiagnostics: Readonly<LanguageDiagnostics> | null | undefined
  readonly languageDiagnosticsLoading: boolean
  readonly languageDiagnosticsError?: string
  readonly sourceLoading: boolean
  readonly source: NewsSource | undefined
  readonly showSourceDetails: boolean
  readonly onToggleSourceDetails: () => void
  readonly debugMode: boolean
  readonly debugOpen: boolean
  readonly debugLoading: boolean
  readonly debugData: SourceDebugData | undefined
  readonly matchedEntryIndex: number | undefined
  readonly onToggleDebug: () => void
  readonly onOpenSourceWiki: () => void
  readonly onOpenReporterWiki: () => void
  readonly onRelatedArticleClick: (article: Readonly<{ url: string }>) => void
  readonly factCheckResults: FactCheckResult[]
  readonly claimsOpen: boolean
  readonly onClaimsOpenChange: (open: boolean) => void
  readonly statusCounts: Record<FactCheckStatus, number>
  readonly activeStatusFilter: FactCheckStatusFilter
  readonly onFilterChange: (filter: FactCheckStatusFilter) => void
  readonly filteredClaims: FactCheckResult[]
  readonly selectedClaim: FactCheckResult | undefined
  readonly onSelectClaim: (claim: Readonly<FactCheckResult>) => void
  readonly agenticLoading: boolean
  readonly agenticError: string | undefined
  readonly agenticAnswer: string | undefined
  readonly agenticHistory: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]
  readonly onRunAgenticSearch: (claim: FactCheckResult | undefined) => Promise<void>
}

const ArticleDetailDialogOverlays = (props: Readonly<ArticleDetailDialogBodyProps>) => (
  <>
    <InlineDefinition
      result={props.inlineResult}
      open={props.inlineOpen}
      setOpen={props.setInlineOpen}
      anchorPosition={props.inlineAnchorPosition}
    />
    <HighlightNotePopover
      open={props.highlightPopoverOpen}
      highlight={props.highlightPopoverHighlight ?? null}
      anchorEl={props.highlightPopoverAnchorEl ?? null}
      onClose={props.onCloseHighlightPopover}
      onSave={props.onSaveHighlightNote}
      articleTitle={props.currentArticle.title}
      articleSource={props.currentArticle.source}
    />
    <ModalWikiSheet
      open={props.wikiPanelOpen}
      onOpenChange={props.setWikiPanelOpen}
      tab={props.wikiPanelTab}
      onTabChange={props.setWikiPanelTab}
      source={props.currentArticle.source}
      reporterName={props.reporterName}
      hasSourceWiki={props.hasSourceWiki}
      hasReporterWiki={props.hasReporterWiki}
      articleHost={props.articleHost}
      articleWikiContext={props.articleWikiContext}
    />
  </>
),

 ArticleDetailPrimaryColumn = (props: Readonly<ArticleDetailDialogBodyProps>) => (
  <div className={props.isExpanded ? "lg:col-span-2 space-y-8" : "space-y-6"}>
    <ModalArticleReader
      articleLoading={props.articleLoading}
      fullArticleText={props.fullArticleText ?? null}
      articleUrl={props.currentArticle.url}
      articleSummary={props.currentArticle.summary}
      showHighlights={props.showHighlights}
      visibleHighlights={props.visibleHighlights}
      activeHighlightId={props.activeHighlightId ?? null}
      onHighlightClick={props.onHighlightClick}
      articleContentRef={props.articleContentRef}
      isExpanded={props.isExpanded}
      highlightColor={props.highlightColor}
      onCreate={props.onCreate}
      onUpdate={props.onUpdate}
      onDelete={props.onDelete}
    />
    <ModalAiCleanNote
      aiAnalysis={props.aiAnalysis ?? null}
      fullArticleText={props.fullArticleText}
      articleContent={props.currentArticle.content}
    />
    <ModalTags tags={props.currentArticle.tags} />
    <ModalActions
      article={props.currentArticle}
      canPersist={props.canPersistArticle}
      bookmarkLoading={props.bookmarkLoading}
      aiAnalysisLoading={props.aiAnalysisLoading}
      canRequestAiAnalysis={props.canRequestAiAnalysis}
      aiAnalysisRequested={props.aiAnalysisRequested}
      aiHasError={props.aiHasError}
      aiActionLabel={props.aiActionLabel}
      isLiked={props.isLiked}
      isFavorite={props.isFavorite}
      isBookmarked={props.isBookmarked}
      isArticleInQueue={props.isArticleInQueue}
      onLike={props.onLike}
      onFavorite={props.onFavorite}
      onBookmark={props.onBookmark}
      onAiAnalysis={props.onAiAnalysis}
      onQueueToggle={props.onQueueToggle}
    />
  </div>
),

 ArticleDetailSidebarReaderTools = (props: Readonly<ArticleDetailDialogBodyProps>) => (
  <>
    <ModalAnnotationsPanel
      highlightCount={props.highlights.length}
      highlightSyncStatus={props.highlightSyncStatus}
      onRetrySync={props.onRetrySync}
      showHighlights={props.showHighlights}
      onToggleShowHighlights={props.onToggleShowHighlights}
      wordCount={props.wordCount}
      estimatedReadMinutes={props.estimatedReadMinutes}
      highlightColor={props.highlightColor}
      onColorSelect={props.onColorSelect}
      obsidianMarkdown={props.obsidianMarkdown}
      articleTitle={props.currentArticle.title}
      articleUrl={props.currentArticle.url}
      articleScrollProgress={props.articleScrollProgress}
      onBackToTop={props.onBackToTop}
    />
    <ModalHighlightsList
      highlights={[...props.highlights]}
      articleTitle={props.currentArticle.title}
      articleSource={props.currentArticle.source}
      onHighlightClick={props.onHighlightClick}
      articleContentRef={props.articleContentRef}
      editingId={props.editingId ?? null}
      editingNote={props.editingNote}
      onStartEdit={props.onStartEdit}
      onCancelEdit={props.onCancelEdit}
      onNoteChange={props.onNoteChange}
      onSaveNote={props.onSaveNote}
      onDelete={props.onHighlightDelete}
    />
    <ModalAiStatusBlocks
      aiAnalysisRequested={props.aiAnalysisRequested}
      aiAnalysisLoading={props.aiAnalysisLoading}
      aiAnalysis={props.aiAnalysis ?? null}
    />
    <LanguageForensicsCard
      diagnostics={props.languageDiagnostics}
      loading={props.languageDiagnosticsLoading}
      error={props.languageDiagnosticsError ?? props.languageDiagnostics?.error ?? undefined}
    />
  </>
),

 ArticleDetailSidebarAnalysis = (props: Readonly<ArticleDetailDialogBodyProps>) => {
  if (!props.aiAnalysis?.success) {return null}
  return (
    <ModalAiAnalysisBlock
      aiAnalysis={props.aiAnalysis}
      factCheckResults={props.factCheckResults}
      claimsOpen={props.claimsOpen}
      onOpenChange={props.onClaimsOpenChange}
      statusCounts={props.statusCounts}
      activeStatusFilter={props.activeStatusFilter}
      onFilterChange={props.onFilterChange}
      filteredClaims={props.filteredClaims}
      selectedClaim={props.selectedClaim ?? null}
      onSelectClaim={props.onSelectClaim}
      agenticLoading={props.agenticLoading}
      agenticError={props.agenticError ?? null}
      agenticAnswer={props.agenticAnswer ?? null}
      agenticHistory={[...props.agenticHistory]}
      onRunAgenticSearch={props.onRunAgenticSearch}
    />
  )
},

 ArticleDetailSidebarResearch = (props: Readonly<ArticleDetailDialogBodyProps>) => (
  <>
    <SourceResearchPanel sourceName={props.currentArticle.source} website={props.articleHost} />
    <RelatedArticles articleId={props.currentArticle.id} onArticleClick={props.onRelatedArticleClick} limit={5} />
    <ArticleDetailSidebarAnalysis {...props} />
    <ModalSourceTransparency
      sourceLoading={props.sourceLoading}
      source={props.source}
      article={props.currentArticle}
      reporterName={props.reporterName}
      showSourceDetails={props.showSourceDetails}
      onToggleDetails={props.onToggleSourceDetails}
      debugMode={props.debugMode}
      debugOpen={props.debugOpen}
      debugLoading={props.debugLoading}
      debugData={props.debugData ?? null}
      matchedEntryIndex={props.matchedEntryIndex ?? null}
      onToggleDebug={props.onToggleDebug}
      onOpenSourceWiki={props.onOpenSourceWiki}
      onOpenReporterWiki={props.onOpenReporterWiki}
      onClose={props.onClose}
    />
  </>
),

 ArticleDetailExpandedSidebar = (props: Readonly<ArticleDetailDialogBodyProps>) => (
  <div className="lg:col-span-1 space-y-6">
    <ArticleDetailSidebarReaderTools {...props} />
    <ArticleDetailSidebarResearch {...props} />
  </div>
),

 ArticleDetailDialogColumns = (props: Readonly<ArticleDetailDialogBodyProps>) => (
  <div className={`grid gap-8 ${props.isExpanded ? "grid-cols-1 lg:grid-cols-3 gap-12" : "grid-cols-1"}`}>
    <ArticleDetailPrimaryColumn {...props} />
    {props.isExpanded ? <ArticleDetailExpandedSidebar {...props} /> : undefined}
  </div>
),

 ArticleDetailDialogScrollContent = (props: Readonly<ArticleDetailDialogBodyProps>) => (
  <div id="article-detail-scroll-region" ref={props.contentScrollRef} className="no-scrollbar relative flex-1 overflow-y-auto bg-background">
    <ModalProgressRail trackRef={props.progressTrackRef} progress={props.articleScrollProgress} />
    <ModalHero
      article={props.currentArticle}
      isExpanded={props.isExpanded}
      layoutIdPrefix={props.layoutIdPrefix}
      reporterName={props.reporterName}
      onOpenSourceWiki={props.onOpenSourceWiki}
      onOpenReporterWiki={props.onOpenReporterWiki}
      onClose={props.onClose}
    />
    <div className={props.isExpanded ? "mx-auto max-w-6xl px-6 py-10 md:px-8 md:py-12" : "px-6 py-8 md:px-8"}>
      {props.showSummary ? <ModalSummaryQuote summary={props.currentArticle.summary} isExpanded={props.isExpanded} /> : undefined}
      <ArticleDetailDialogColumns {...props} />
      <ModalCompactAiSection
        isExpanded={props.isExpanded}
        aiAnalysisLoading={props.aiAnalysisLoading}
        aiAnalysis={props.aiAnalysis ?? null}
        factCheckCount={props.factCheckResults.length}
        onExpand={props.onToggleExpanded}
      />
    </div>
  </div>
),

 ArticleDetailDialogBody = (props: Readonly<ArticleDetailDialogBodyProps>) => (
  <Dialog open={props.isOpen} onOpenChange={props.onDialogOpenChange}>
    <DialogContent
      showCloseButton={false}
      className={`${props.isExpanded ? "h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] rounded-2xl sm:max-w-[calc(100vw-1rem)]" : "max-h-[85vh] w-full max-w-6xl rounded-2xl sm:max-w-6xl"} gap-0 overflow-hidden border border-border/50 bg-background/95 p-0 shadow-2xl shadow-black/60`}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>{props.currentArticle.title}</DialogTitle>
      </DialogHeader>
      <ArticleDetailDialogOverlays {...props} />
      <div className="flex h-full flex-col overflow-hidden">
        <ModalHeaderControls
          onNavigate={props.onNavigate}
          handleNavigate={props.handleNavigate}
          isExpanded={props.isExpanded}
          onToggleExpanded={props.onToggleExpanded}
          onClose={props.onClose}
        />
        <ArticleDetailDialogScrollContent {...props} />
      </div>
    </DialogContent>
  </Dialog>
),

 ARTICLE_SCROLL_FACTORS: Readonly<Record<string, number>> = {
  ArrowDown: 0.12,
  ArrowUp: -0.12,
 PageDown: 0.9,
  PageUp: -0.9,
};

type ArticleScrollAction =
  | { readonly kind: "scroll"; readonly amount: number }
  | { readonly direction: "next" | "prev"; readonly kind: "navigate" }

const getArticleScrollAction = (
  key: string,
  height: number,
  isExpanded: boolean,
  onNavigate?: (direction: "prev" | "next") => void,
): ArticleScrollAction | undefined => {
  const factor = ARTICLE_SCROLL_FACTORS[key]
  if (factor !== undefined) {
    const minimum = 72
    return { amount: Math.max(height * Math.abs(factor), minimum) * Math.sign(factor), kind: "scroll" }
  }
  if (!isExpanded || !onNavigate) {return undefined}
  if (key === "ArrowRight") {return { direction: "next", kind: "navigate" }}
  if (key === "ArrowLeft") {return { direction: "prev", kind: "navigate" }}
  return undefined
},

 ArticleScrollKeyListener = ({
  claimsOpen,
  contentScrollRef,
  handleNavigate,
  isExpanded,
  isOpen,
  onNavigate,
  wikiPanelOpen,
}: Readonly<{
  claimsOpen: boolean
  contentScrollRef: { current: HTMLDivElement | null }
  handleNavigate: (direction: "prev" | "next") => void
  isExpanded: boolean
  isOpen: boolean
  onNavigate?: (direction: "prev" | "next") => void
  wikiPanelOpen: boolean
}>): null => {
  const applyArticleScrollAction = (
    event: KeyboardEvent,
    action: ArticleScrollAction,
    container: HTMLDivElement,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (action.kind === "scroll") {
      container.scrollBy({ behavior: "smooth", top: action.amount })
      return
    }
    handleNavigate(action.direction)
  }

  useEffect(() => {
    if (!isOpen) {return}

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInputFocused() || claimsOpen || wikiPanelOpen) {return}
      const container = contentScrollRef.current
      if (!container) {return}
      const action = getArticleScrollAction(event.key, container.clientHeight, isExpanded, onNavigate)
      if (!action) {return}

      applyArticleScrollAction(event, action, container)
    }

    globalThis.addEventListener("keydown", handleKeyDown, true)
    return () => { globalThis.removeEventListener("keydown", handleKeyDown, true) }
  }, [claimsOpen, contentScrollRef, handleNavigate, isExpanded, isOpen, onNavigate, wikiPanelOpen])
  return null
};

interface DebugLoaderState {
  readonly article: NewsArticle
  readonly services: ArticleDetailServices
  readonly setDebugData: (data: SourceDebugData | undefined) => void
  readonly setDebugLoading: (loading: boolean) => void
  readonly setMatchedEntryIndex: (index: number | undefined) => void
}

const normalizeDebugText = (value: string): string => value.toLowerCase().replaceAll(/\s+/gu, " ").trim(),

 findDebugEntryIndex = (data: SourceDebugData | undefined, article: NewsArticle): number | undefined => {
  const entries = data?.parsed_entries ?? []
  if (entries.length === 0) {
    return
  }
  const urlIndex = entries.findIndex((entry) => entry.link === article.url)
  if (urlIndex !== -1) {
    return urlIndex
  }
  const articleTitle = normalizeDebugText(article.title),
   titleIndex = entries.findIndex((entry) => normalizeDebugText(entry.title) === articleTitle)
  if (titleIndex === -1) {
    return
  }
  return titleIndex
},

 loadDebugData = async ({
  article,
  services,
  setDebugData,
  setDebugLoading,
  setMatchedEntryIndex,
}: Readonly<DebugLoaderState>): Promise<void> => {
  setDebugLoading(true)
  try {
    const data = await services.fetchSourceDebugData(article.source)
    setDebugData(data)
    setMatchedEntryIndex(findDebugEntryIndex(data, article))
  } catch (error) {
    console.error("Failed to fetch debug data:", error)
    setDebugData(undefined)
    setMatchedEntryIndex(undefined)
  } finally {
    setDebugLoading(false)
  }
},

 loadAiAnalysisData = async ({
  article,
  services,
  setAiAnalysis,
  setAiAnalysisLoading,
  setAiAnalysisRequested,
}: Readonly<{
  article: NewsArticle
  services: ArticleDetailServices
  setAiAnalysis: (analysis: ArticleAnalysis) => void
  setAiAnalysisLoading: (loading: boolean) => void
  setAiAnalysisRequested: (requested: boolean) => void
}>): Promise<void> => {
  setAiAnalysisRequested(true)
  setAiAnalysisLoading(true)
  try {
    setAiAnalysis(await services.analyzeArticle(article.url, article.source))
  } catch (error) {
    console.error("Failed to analyze article:", error)
    setAiAnalysis({
      article_url: article.url,
      error: error instanceof Error ? error.message : "Failed to analyze article",
      success: false,
    })
  } finally {
    setAiAnalysisLoading(false)
  }
},

 appendAgenticQueryPart = (parts: string[], label: string, value: string | undefined): void => {
  if (value !== undefined && value !== "") {
    parts.push(`${label}: ${value}`)
  }
},

 buildAgenticQuery = (article: NewsArticle, claim: FactCheckResult): string => {
  const parts = [`Fact-check this claim: ${claim.claim}`]
  appendAgenticQueryPart(parts, "Article title", article.title)
  appendAgenticQueryPart(parts, "Publisher", article.source)
  appendAgenticQueryPart(parts, "Existing evidence summary", claim.evidence)
  parts.push("Respond with a concise verification summary and cite authoritative sources.")
  return parts.join(" \n")
},

 publishAgenticAnswer = (
  response: Awaited<ReturnType<ArticleDetailServices["performAgenticSearch"]>>,
  claim: FactCheckResult,
  setAgenticAnswer: (answer: string | undefined) => void,
  setAgenticHistory: (update: (previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]) => void,
): boolean => {
  if (!(response.success && response.answer)) {
    return false
  }
  setAgenticAnswer(response.answer)
  setAgenticHistory((previous) => [{ answer: response.answer, claim: claim.claim, timestamp: Date.now() }, ...previous].slice(0, 5))
  return true
},

 runAgenticSearchRequest = async ({
  article,
  claim,
  services,
  setAgenticAnswer,
  setAgenticError,
  setAgenticHistory,
}: Readonly<{
  article: NewsArticle
  claim: FactCheckResult
  services: ArticleDetailServices
  setAgenticAnswer: (answer: string | undefined) => void
  setAgenticError: (error: string | undefined) => void
  setAgenticHistory: (update: (previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]) => void
}>): Promise<void> => {
  const response = await services.performAgenticSearch(buildAgenticQuery(article, claim), 10)
  if (!publishAgenticAnswer(response, claim, setAgenticAnswer, setAgenticHistory)) {
    setAgenticError("Agentic search returned no direct answer. Try again or open the research workspace for a deeper dive.")
  }
},

 runAgenticSearchData = async ({
  article,
  claim,
  services,
  setAgenticAnswer,
  setAgenticError,
  setAgenticHistory,
  setAgenticLoading,
}: Readonly<{
  article: NewsArticle
  claim: FactCheckResult | undefined
  services: ArticleDetailServices
  setAgenticAnswer: (answer: string | undefined) => void
  setAgenticError: (error: string | undefined) => void
  setAgenticHistory: (update: (previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]) => void
  setAgenticLoading: (loading: boolean) => void
}>): Promise<void> => {
  if (claim === undefined) {return}
  setAgenticLoading(true)
  setAgenticAnswer(undefined)
  setAgenticError(undefined)
  try {
    await runAgenticSearchRequest({ article, claim, services, setAgenticAnswer, setAgenticError, setAgenticHistory })
  } catch (error) {
    setAgenticError(error instanceof Error ? error.message : "Agentic search failed.")
  } finally {
    setAgenticLoading(false)
  }
},

 getHighlightPendingOperation = (highlight: LocalHighlight): "create" | "update" => {
  if (highlight.server_id !== undefined) {
    return "update"
  }
  return "create"
},

 restorePreviousHighlight = (
  previousHighlight: LocalHighlight,
  currentEquivalent: LocalHighlight | undefined,
): LocalHighlight => {
  if (currentEquivalent === undefined && !previousHighlight.deleted) {
    return markPending({
      highlight: previousHighlight,
      op: getHighlightPendingOperation(previousHighlight),
    })
  }
  if (currentEquivalent?.deleted === true && !previousHighlight.deleted) {
    return markPending({
      highlight: { ...previousHighlight, deleted: false },
      op: getHighlightPendingOperation(previousHighlight),
    })
  }
  return previousHighlight
},

 shouldRestoreDeletedHighlight = (
  previousState: readonly LocalHighlight[],
  currentHighlight: LocalHighlight,
): boolean => !previousState.some((highlight) => highlight.client_id === currentHighlight.client_id) && !currentHighlight.deleted,

 restoreHighlightState = (
  previousState: readonly LocalHighlight[],
  current: readonly LocalHighlight[],
): LocalHighlight[] => [
  ...previousState.map((previousHighlight) => restorePreviousHighlight(
    previousHighlight,
    current.find((highlight) => highlight.client_id === previousHighlight.client_id),
  )),
  ...current
    .filter((currentHighlight) => shouldRestoreDeletedHighlight(previousState, currentHighlight))
    .map((currentHighlight) => markPending({
      highlight: { ...currentHighlight, deleted: true },
      op: "delete",
    })),
],

 restoreDeletedHighlight = (
  highlights: readonly LocalHighlight[],
  clientId: string,
): LocalHighlight[] => highlights.map((highlight) => {
  if (highlight.client_id !== clientId) {return highlight}
  return {
    ...highlight,
    deleted: false,
    last_error: undefined,
    local_updated_at: new Date().toISOString(),
    pending_op: undefined,
    sync_status: "pending",
  }
}),

 hasDuplicateHighlight = (
  highlights: readonly LocalHighlight[],
  highlightedText: string,
  range: HighlightRange,
): boolean => {
  const fingerprint = createHighlightFingerprint({
    character_end: range.end,
    character_start: range.start,
    highlighted_text: highlightedText,
  })
  return highlights.some((highlight) => {
    if (highlight.deleted) {return false}
    return createHighlightFingerprint({
      character_end: highlight.character_end,
      character_start: highlight.character_start,
      highlighted_text: highlight.highlighted_text,
    }) === fingerprint
  })
},

 buildPendingHighlight = ({
  articleUrl,
  clientId,
  color,
  highlightedText,
  range,
}: {
  articleUrl: string
  clientId: string
  color: Highlight["color"]
  highlightedText: string
  range: HighlightRange
}): LocalHighlight => markPending({
  highlight: {
    article_url: articleUrl,
    character_end: range.end,
    character_start: range.start,
    client_id: clientId,
    color,
    highlighted_text: highlightedText,
    local_updated_at: new Date().toISOString(),
    pending_op: "create",
    sync_status: "pending",
  },
  op: "create",
});

interface ModalHighlightLoaderProps {
  readonly article: NewsArticle
  readonly services: ArticleDetailServices
  readonly debugEnabled: boolean
  readonly setHighlights: (highlights: LocalHighlight[]) => void
  readonly setStatus: (status: ModalHighlightSyncStatus) => void
}

const ModalHighlightLoader = ({
  article,
  debugEnabled,
  services,
  setHighlights,
  setStatus,
}: Readonly<ModalHighlightLoaderProps>): null => {
  useEffect(() => {
    if (!article.url) {
      setHighlights([])
      setStatus("idle")
      return
    }

    const store = loadHighlightStore(article.url)
    setHighlights(store.highlights)

    if (debugEnabled) {
      console.debug("[Highlights] loaded local store", {
        count: store.highlights.length,
        url: article.url,
      })
    }

    services.getHighlightsForArticle(article.url)
      .then((serverHighlights) => {
        if (debugEnabled) {
          console.debug("[Highlights] fetched server highlights", {
            count: serverHighlights.length,
            url: article.url,
          })
        }

        const merged = mergeHighlights({
          articleUrl: article.url,
          local: store.highlights,
          server: serverHighlights,
        })

        if (debugEnabled) {
          console.debug("[Highlights] merged highlights", {
            count: merged.length,
            url: article.url,
          })
        }

        setHighlights(merged)
        saveHighlightStore({ article_url: article.url, highlights: merged, version: HIGHLIGHT_STORE_VERSION })
      })
      .catch((error) => {
        console.error("Failed to load highlights", error)
        if (debugEnabled) {
          console.debug("[Highlights] fetch failed", {
            error: error instanceof Error ? error.message : String(error),
            online: navigator.onLine,
            url: article.url,
          })
        }
      })
  }, [article.url, debugEnabled, services, setHighlights, setStatus])

  return null
},

 ModalReadingHistoryTracker = ({
  article,
  isOpen,
  markAsRead,
}: Readonly<{
  readonly article: NewsArticle
  readonly isOpen: boolean
  readonly markAsRead: (articleId: number, title: string, source: string) => void
}>): null => {
  useEffect(() => {
    if (isOpen && typeof article.id === "number") {
      markAsRead(article.id, article.title, article.source)
    }
  }, [article, isOpen, markAsRead])

  return null
},

 ModalUndoShortcut = ({
  handleUndo,
}: Readonly<{ readonly handleUndo: () => void }>): null => {
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "z" && !isTextInputFocused()) {
        event.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => { window.removeEventListener("keydown", handleGlobalKeyDown) }
  }, [handleUndo])

  return null
},

 ModalProgressPointer = ({
  contentScrollRef,
  isOpen,
  progressTrackRef,
}: Readonly<{
  readonly contentScrollRef: { current: HTMLDivElement | null }
  readonly isOpen: boolean
  readonly progressTrackRef: { current: HTMLDivElement | null }
}>): null => {
  const scrollArticleContentToProgress = useCallback((nextProgress: number) => {
    const container = contentScrollRef.current
    if (!container) {return}

    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight),
     clampedProgress = Math.min(1, Math.max(0, nextProgress))
    container.scrollTo({ behavior: "auto", top: maxScroll * clampedProgress })
  }, [contentScrollRef]),

   resolveProgressFromPointer = useCallback((clientY: number) => {
    const track = progressTrackRef.current
    if (!track) {return}

    const rect = track.getBoundingClientRect()
    if (rect.height <= 0) {return}
    return (clientY - rect.top) / rect.height
  }, [progressTrackRef])

  useEffect(() => {
    if (!isOpen) {return}

    const handlePointerMove = (event: PointerEvent) => {
      const nextProgress = resolveProgressFromPointer(event.clientY)
      if (nextProgress === undefined) {return}
      scrollArticleContentToProgress(nextProgress)
    },

     handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    },

     handlePointerDown = (event: PointerEvent) => {
      const track = progressTrackRef.current
      if (!track || !track.contains(event.target as Node)) {return}

      event.preventDefault()
      const nextProgress = resolveProgressFromPointer(event.clientY)
      if (nextProgress !== undefined) {
        scrollArticleContentToProgress(nextProgress)
      }

      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointerdown", handlePointerDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [isOpen, progressTrackRef, resolveProgressFromPointer, scrollArticleContentToProgress])

  return null
},

 ModalScrollProgressTracker = ({
  articleUrl,
  contentScrollRef,
  fullArticleText,
  isExpanded,
  isOpen,
  setArticleScrollProgress,
}: Readonly<{
  readonly articleUrl: string
  readonly contentScrollRef: { current: HTMLDivElement | null }
  readonly fullArticleText: string | undefined
  readonly isExpanded: boolean
  readonly isOpen: boolean
  readonly setArticleScrollProgress: (progress: number) => void
}>): null => {
  useEffect(() => {
    const container = contentScrollRef.current
    if (!container || !isOpen) {return}

    const updateProgress = () => {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
      if (maxScroll === 0) {
        setArticleScrollProgress(0)
        return
      }
      setArticleScrollProgress(Math.min(1, container.scrollTop / maxScroll))
    }

    updateProgress()
    container.addEventListener("scroll", updateProgress, { passive: true })
    window.addEventListener("resize", updateProgress)

    return () => {
      container.removeEventListener("scroll", updateProgress)
      window.removeEventListener("resize", updateProgress)
    }
  }, [articleUrl, contentScrollRef, fullArticleText, isExpanded, isOpen, setArticleScrollProgress])

  return null
},

 ModalClaimSelectionEffect = ({
  claimsOpen,
  factCheckResults,
  selectedClaim,
  setSelectedClaim,
}: Readonly<{
  readonly claimsOpen: boolean
  readonly factCheckResults: readonly FactCheckResult[]
  readonly selectedClaim: FactCheckResult | undefined
  readonly setSelectedClaim: (claim: FactCheckResult | undefined) => void
}>): null => {
  useEffect(() => {
    if (!claimsOpen) {return}

    if (factCheckResults.length === 0) {
      setSelectedClaim(undefined)
      return
    }

    if (!selectedClaim) {
      setSelectedClaim(factCheckResults[0])
      return
    }

    const stillPresent = factCheckResults.some((claim) => claim.claim === selectedClaim.claim)
    if (!stillPresent) {
      setSelectedClaim(factCheckResults[0])
    }
  }, [claimsOpen, factCheckResults, selectedClaim, setSelectedClaim])

  return null
},

 getNextHighlightOp = (highlight: LocalHighlight, fallback: "update" | "delete"): "create" | "update" | "delete" => {
  if (highlight.pending_op === "create") {return "create"}
  if (!(highlight.server_id ?? highlight.id)) {
    return fallback === "delete" ? "delete" : "create"
  }
  return fallback
},

 appendHighlightHistory = (
  history: readonly LocalHighlight[][],
  currentHighlights:readonly LocalHighlight[],
): LocalHighlight[][] => [...history, [...currentHighlights]].slice(-HIGHLIGHT_HISTORY_LIMIT),

 persistHighlightChanges = (
  articleUrl: string | undefined,
  highlights:readonly LocalHighlight[],
  runHighlightSync: (url: string, current: readonly LocalHighlight[]) => void,
): void => {
  if (!articleUrl) {return}
  saveHighlightStore({ article_url: articleUrl, highlights: [...highlights], version: HIGHLIGHT_STORE_VERSION })
  runHighlightSync(articleUrl, highlights)
},

 updateHighlightByServerId = (
  highlights: readonly LocalHighlight[],
  highlightId: number,
  updater: (highlight: LocalHighlight) => LocalHighlight,
): LocalHighlight[] => highlights.map((highlight) => {
  const id = highlight.server_id ?? highlight.id
  if (id !== highlightId) {return highlight}
  return updater(highlight)
}),

 updateHighlightByClientId = (
  highlights: readonly LocalHighlight[],
  clientId: string,
  updater: (highlight: LocalHighlight) => LocalHighlight,
): LocalHighlight[] => highlights.map((highlight) => (
  highlight.client_id === clientId ? updater(highlight) : highlight
)),

 getPreviousHighlightHistory = (
  history: readonly LocalHighlight[][],
): { nextHistory: LocalHighlight[][]; previousState: LocalHighlight[] | undefined } => {
  const nextHistory = [...history],
   previousState = nextHistory.pop()
  return { nextHistory, previousState }
};

interface ArticleBookmarkActionProps {
  readonly article: NewsArticle
  readonly isBookmarked: (articleId: number) => boolean
  readonly onBookmarkChange?: (articleId: number, isBookmarked: boolean) => void
  readonly setBookmarkLoading: (loading: boolean) => void
  readonly toggleBookmark: (articleId: number) => Promise<void>
}

const toggleArticleBookmark = async ({
  article,
  isBookmarked,
  onBookmarkChange,
  setBookmarkLoading,
  toggleBookmark,
}: Readonly<ArticleBookmarkActionProps>): Promise<void> => {
  if (!article.id || article.isPersisted === false) {return}

  setBookmarkLoading(true)
  try {
    const currentlyBookmarked = isBookmarked(article.id)
    await toggleBookmark(article.id)
    onBookmarkChange?.(article.id, !currentlyBookmarked)
  } catch (error) {
    console.error("Failed to toggle bookmark:", error)
  } finally {
    setBookmarkLoading(false)
  }
},

 updateClaimsDialog = ({
  factCheckResults,
  open,
  selectedClaim,
  setActiveStatusFilter,
  setAgenticAnswer,
  setAgenticError,
  setClaimsOpen,
  setSelectedClaim,
}: Readonly<{
  readonly factCheckResults: readonly FactCheckResult[]
  readonly open: boolean
  readonly selectedClaim: FactCheckResult | undefined
  readonly setActiveStatusFilter: (filter: FactCheckStatusFilter) => void
  readonly setAgenticAnswer: (answer: string | undefined) => void
  readonly setAgenticError: (error: string | undefined) => void
  readonly setClaimsOpen: (open: boolean) => void
  readonly setSelectedClaim: (claim: FactCheckResult | undefined) => void
}>): void => {
  setClaimsOpen(open)
  if (!open) {
    setSelectedClaim(undefined)
    setAgenticAnswer(undefined)
    setAgenticError(undefined)
    setActiveStatusFilter("all")
    return
  }

  if (!selectedClaim && factCheckResults.length > 0) {
    setSelectedClaim(factCheckResults[0])
  }
},

 toggleArticleQueue = ({
  addArticleToQueue,
  article,
  isArticleInQueue,
  removeArticleFromQueue,
}: Readonly<{
  readonly addArticleToQueue: (article: NewsArticle) => void
  readonly article: NewsArticle
  readonly isArticleInQueue: (url: string) => boolean
  readonly removeArticleFromQueue: (url: string) => void
}>): void => {
  if (isArticleInQueue(article.url)) {
    removeArticleFromQueue(article.url)
    return
  }
  addArticleToQueue(article)
},

 toggleArticleFavorite = (
  article: NewsArticle,
  toggleFavorite: (sourceId: string) => void,
): void => {
  toggleFavorite(article.sourceId)
},

 openModalWikiPanel = ({
  available,
  setOpen,
  setTab,
  tab,
}: Readonly<{
  readonly available: boolean
  readonly setOpen: (open: boolean) => void
  readonly setTab: (tab: "source" | "reporter") => void
  readonly tab: "source" | "reporter"
}>): void => {
  if (!available) {return}
  setTab(tab)
  setOpen(true)
},

 toggleArticleLike = async (
  article: NewsArticle,
  toggleLike: (articleId: number) => Promise<void>,
): Promise<void> => {
  if (!article.id || article.isPersisted === false) {return}
  await toggleLike(article.id)
},

 toggleDebugPanel = ({
  isOpen,
  loadDebug,
  setOpen,
}: Readonly<{
  readonly isOpen: boolean
  readonly loadDebug: () => void
  readonly setOpen: (open: boolean) => void
}>): void => {
  setOpen(!isOpen)
  if (!isOpen) {loadDebug()}
},

 deleteHighlightWithUndo = ({
  getNextHighlightOp,
  removed,
  updateHighlightByStableId,
  updateHighlightsWithHistory,
}: Readonly<{
  readonly getNextHighlightOp: (highlight: LocalHighlight, fallback: "update" | "delete") => "create" | "update" | "delete"
  readonly removed: LocalHighlight
  readonly updateHighlightByStableId: (stableId: string, updater: (highlight: LocalHighlight) => LocalHighlight) => void
  readonly updateHighlightsWithHistory: (updater: (previous: LocalHighlight[]) => LocalHighlight[]) => void
}>): void => {
  try {
    updateHighlightByStableId(highlightStableId(removed), (item) =>
      markPending({
        highlight: item,
        op: getNextHighlightOp(item, "delete"),
      })
    )

    toast("Annotation removed", {
      action: {
        label: "Undo",
        onClick: () => {
          updateHighlightsWithHistory((previous) => restoreDeletedHighlight(previous, removed.client_id))
        },
      },
    })
  } catch (error) {
    console.error("Failed to delete highlight", error)
    toast.error("Failed to delete annotation")
  }
},

 getHighlightDebugEnabled = (): boolean =>
  typeof window !== "undefined" && window.localStorage.getItem("debug_highlights") === "1",

 getArticleDetailAnalysisState = (
  analysis: ArticleAnalysis | undefined,
  analysisLoading: boolean,
  analysisRequested: boolean,
  activeStatusFilter: FactCheckStatusFilter,
) => {
  const factCheckResults = analysis?.fact_check_results ?? []
  return {
    aiActionLabel: getAiActionLabel(analysisRequested, analysisLoading, analysis),
    aiHasError: Boolean(analysis?.error),
    canRequestAiAnalysis: !analysisRequested || Boolean(analysis?.error),
    factCheckResults,
    filteredClaims: filterFactCheckResults(factCheckResults, activeStatusFilter),
    statusCounts: getFactCheckStatusCounts(factCheckResults),
  }
},

 getArticleDetailArticleState = (
  article: NewsArticle,
  fullArticleText: string | undefined,
) => {
  const articleTextForMetrics = getArticleTextForMetrics(fullArticleText, article.content, article.summary),
   { wordCount, estimatedReadMinutes } = getArticleWordMetrics(articleTextForMetrics),
   reporterName = getReporterName(article)
  return {
    articleHost: getArticleHost(article.url),
    articleTextForMetrics,
    articleWikiContext: getArticleWikiContext(fullArticleText, article.content, article.summary),
    estimatedReadMinutes,
    hasReporterWiki: Boolean(reporterName),
    hasSourceWiki: Boolean(article.source.trim()),
    reporterName,
    showSummary: shouldShowSummary(article.summary, article.content, fullArticleText),
    wordCount,
  }
},

 getLanguageDiagnosticsError = (
  error: unknown,
  diagnostics: Readonly<LanguageDiagnostics> | null | undefined,
): string | undefined => {
  if (error instanceof Error) {return error.message}
  if (typeof error === "string") {return error}
  return diagnostics?.error ?? undefined
};

type LocalHighlightStateSetter = (
  value: LocalHighlight[] | ((previous: LocalHighlight[]) => LocalHighlight[]),
) => void
type LocalHighlightHistorySetter = (
  value: LocalHighlight[][] | ((previous: LocalHighlight[][]) => LocalHighlight[][]),
) => void

interface ModalHighlightHistoryProps {
  readonly article: NewsArticle
  readonly latestHighlightSyncRef: { current: number }
  readonly services: ArticleDetailServices
  readonly setHighlightSyncStatus: (status: ModalHighlightSyncStatus) => void
  readonly setHighlights: LocalHighlightStateSetter
  readonly setHighlightsHistory: LocalHighlightHistorySetter
}

const useModalHighlightHistory = ({
  article,
  latestHighlightSyncRef,
  services,
  setHighlightSyncStatus,
  setHighlights,
  setHighlightsHistory,
}: Readonly<ModalHighlightHistoryProps>) => {
  const pushToHistory = useCallback((currentHighlights:readonly LocalHighlight[]) => {
    setHighlightsHistory((previous) => appendHighlightHistory(previous, currentHighlights))
  }, [setHighlightsHistory]),

   runHighlightSync = useCallback((articleUrl: string, current: readonly LocalHighlight[]) => {
    void syncHighlights(articleUrl, current, {
      latestSyncToken: latestHighlightSyncRef,
      services,
      setHighlights,
      setStatus: setHighlightSyncStatus,
    })
  }, [latestHighlightSyncRef, services, setHighlightSyncStatus, setHighlights]),

   handleUndo = useCallback(() => {
    setHighlightsHistory((previous) => {
      const { nextHistory, previousState } = getPreviousHighlightHistory(previous)
      if (!previousState || !article.url) {return nextHistory}

      setHighlights((current) => {
        const nextState = restoreHighlightState(previousState, current)
        persistHighlightChanges(article.url, nextState, runHighlightSync)
        return nextState
      })
      return nextHistory
    })
  }, [article.url, runHighlightSync, setHighlights, setHighlightsHistory]),

   updateHighlightsWithHistory = useCallback((updater: (previous: LocalHighlight[]) => LocalHighlight[]) => {
    setHighlights((previous) => {
      pushToHistory(previous)
      const next = updater(previous)
      persistHighlightChanges(article.url, next, runHighlightSync)
      return next
    })
  }, [article.url, pushToHistory, runHighlightSync, setHighlights])

  return { handleUndo, runHighlightSync, updateHighlightsWithHistory }
};

interface ModalHighlightActionsProps {
  readonly article: NewsArticle
  readonly articleContentRef: { current: HTMLDivElement | null }
  readonly highlights: LocalHighlight[]
  readonly lastCreatedClientIdRef: { current: string | undefined }
  readonly setActiveHighlightId: (id: string | undefined) => void
  readonly setHighlightColor: (color: Highlight["color"]) => void
  readonly setHighlightPopoverAnchorEl: (element: HTMLElement | undefined) => void
  readonly setHighlightPopoverHighlight: (highlight: LocalHighlight | undefined) => void
  readonly setHighlightPopoverOpen: (open: boolean) => void
  readonly updateHighlightsWithHistory: (updater: (previous: LocalHighlight[]) => LocalHighlight[]) => void
  readonly runHighlightSync: (articleUrl: string, current: readonly LocalHighlight[]) => void
  readonly setShowHighlights: (update: boolean | ((previous: boolean) => boolean)) => void
}

const useModalHighlightActions = ({
  article,
  articleContentRef,
  highlights,
  lastCreatedClientIdRef,
  runHighlightSync,
  setActiveHighlightId,
  setHighlightColor,
  setHighlightPopoverAnchorEl,
  setHighlightPopoverHighlight,
  setHighlightPopoverOpen,
  setShowHighlights,
  updateHighlightsWithHistory,
}: Readonly<ModalHighlightActionsProps>) => {
  const updateHighlightByStableId = useCallback(
    (stableId: string, updater: (highlight: LocalHighlight) => LocalHighlight) => {
      updateHighlightsWithHistory((previous) => updateHighlightByClientId(previous, stableId, updater))
    },
    [updateHighlightsWithHistory],
  ),

   handleHighlightClick = useCallback((stableId: string, element: HTMLElement) => {
    const found = highlights.find((item) => highlightStableId(item) === stableId)
    setActiveHighlightId(stableId)
    setHighlightPopoverHighlight(found)
    setHighlightPopoverAnchorEl(element)
    setHighlightPopoverOpen(true)
  }, [highlights, setActiveHighlightId, setHighlightPopoverAnchorEl, setHighlightPopoverHighlight, setHighlightPopoverOpen]),

   handleSaveHighlightNote = useCallback(async (highlightId: string, note: string): Promise<void> => {
    updateHighlightByStableId(highlightId, (item) =>
      markPending({
        highlight: { ...item, note },
        op: getNextHighlightOp(item, "update"),
      })
    )
  }, [updateHighlightByStableId]),

   handleToolbarCreate = useCallback(async ({ highlightedText, color, range }: Readonly<CreateHighlightPayload>): Promise<void> => {
    if (hasDuplicateHighlight(highlights, highlightedText, range)) {
      toast.error("That exact text is already highlighted")
      return
    }

    const clientId = generateClientId()
    lastCreatedClientIdRef.current = clientId
    const nextLocal = buildPendingHighlight({ articleUrl: article.url, clientId, color, highlightedText, range })
    updateHighlightsWithHistory((previous) => dedupeLocalHighlights([...previous, nextLocal]))

    setTimeout(() => {
      const anchor = articleContentRef.current?.querySelector(
        `mark[data-highlight-stable-id="client:${clientId}"]`
      ) as HTMLElement | null
      setHighlightPopoverHighlight(nextLocal)
      setHighlightPopoverAnchorEl(anchor ?? undefined)
      setHighlightPopoverOpen(true)
    }, 10)
  }, [article.url, articleContentRef, highlights, lastCreatedClientIdRef, setHighlightPopoverAnchorEl, setHighlightPopoverHighlight, setHighlightPopoverOpen, updateHighlightsWithHistory]),

   handleToolbarUpdate = useCallback(async ({ highlightId, note }: Readonly<UpdateHighlightPayload>): Promise<void> => {
    updateHighlightsWithHistory((previous) => updateHighlightByServerId(previous, highlightId, (item) =>
      markPending({ highlight: { ...item, note }, op: "update" })
    ))
  }, [updateHighlightsWithHistory]),

   handleToolbarDelete = useCallback(async ({ highlightId }: Readonly<DeleteHighlightPayload>): Promise<void> => {
    updateHighlightsWithHistory((previous) => updateHighlightByServerId(previous, highlightId, (item) =>
      markPending({ highlight: item, op: "delete" })
    ))
  }, [updateHighlightsWithHistory]),

   handleRetrySync = useCallback(() => {
    runHighlightSync(article.url, highlights)
  }, [article.url, highlights, runHighlightSync]),

   handleToggleShowHighlights = useCallback(() => {
    setShowHighlights((previous) => !previous)
  }, [setShowHighlights]),

   handleColorSelect = useCallback((color: Highlight["color"]) => {
    setHighlightColor(color)
    const lastClientId = lastCreatedClientIdRef.current
    if (!lastClientId) {return}
    updateHighlightsWithHistory((previous) =>
      updateHighlightByClientId(previous, lastClientId, (item) => markPending({
        highlight: { ...item, color },
        op: getNextHighlightOp(item, "update"),
      }))
    )
  }, [lastCreatedClientIdRef, setHighlightColor, updateHighlightsWithHistory])

  return {
    handleColorSelect,
    handleHighlightClick,
    handleRetrySync,
    handleSaveHighlightNote,
    handleToggleShowHighlights,
    handleToolbarCreate,
    handleToolbarDelete,
    handleToolbarUpdate,
    updateHighlightByStableId,
  }
};

interface ModalHighlightEditorActionsProps {
  readonly handleSaveHighlightNote: (highlightId: string, note: string) => Promise<void>
  readonly setSidebarEditingId: (id: string | undefined) => void
  readonly setSidebarEditingNote: (note: string) => void
  readonly updateHighlightByStableId: (stableId: string, updater: (highlight: LocalHighlight) => LocalHighlight) => void
  readonly updateHighlightsWithHistory: (updater: (previous: LocalHighlight[]) => LocalHighlight[]) => void
}

const useModalHighlightEditorActions = ({
  handleSaveHighlightNote,
  setSidebarEditingId,
  setSidebarEditingNote,
  updateHighlightByStableId,
  updateHighlightsWithHistory,
}: Readonly<ModalHighlightEditorActionsProps>) => {
  const handleStartEdit = useCallback((highlight: LocalHighlight) => {
    setSidebarEditingId(highlightStableId(highlight))
    setSidebarEditingNote(highlight.note || "")
  }, [setSidebarEditingId, setSidebarEditingNote]),

   handleCancelEdit = useCallback(() => {
    setSidebarEditingId(undefined)
    setSidebarEditingNote("")
  }, [setSidebarEditingId, setSidebarEditingNote]),

   handleSaveNote = useCallback(async (stableId: string, note: string): Promise<void> => {
    await handleSaveHighlightNote(stableId, note)
    setSidebarEditingId(undefined)
    setSidebarEditingNote("")
  }, [handleSaveHighlightNote, setSidebarEditingId, setSidebarEditingNote]),

   handleHighlightDelete = useCallback((removed: LocalHighlight) => {
    deleteHighlightWithUndo({
      getNextHighlightOp,
      removed,
      updateHighlightByStableId,
      updateHighlightsWithHistory,
    })
  }, [updateHighlightByStableId, updateHighlightsWithHistory])

  return { handleCancelEdit, handleHighlightDelete, handleSaveNote, handleStartEdit }
};

interface ArticleDetailModalViewProps extends ArticleDetailDialogBodyProps {
  readonly article: NewsArticle
  readonly debugEnabled: boolean
  readonly handleUndo: () => void
  readonly markAsRead: (articleId: number, title?: string, source?: string) => void
  readonly services: ArticleDetailServices
  readonly setArticleScrollProgress: (progress: number) => void
  readonly setHighlightSyncStatus: (status: ModalHighlightSyncStatus) => void
  readonly setHighlights: LocalHighlightStateSetter
  readonly setSelectedClaim: (claim: FactCheckResult | undefined) => void
}

const ArticleDetailModalView = (props: Readonly<ArticleDetailModalViewProps>) => (
  <>
    <ModalUndoShortcut handleUndo={props.handleUndo} />
    <ModalHighlightLoader
      article={props.article}
      debugEnabled={props.debugEnabled}
      services={props.services}
      setHighlights={props.setHighlights}
      setStatus={props.setHighlightSyncStatus}
    />
    <ModalReadingHistoryTracker article={props.article} isOpen={props.isOpen} markAsRead={props.markAsRead} />
    <ModalProgressPointer
      contentScrollRef={props.contentScrollRef}
      isOpen={props.isOpen}
      progressTrackRef={props.progressTrackRef}
    />
    <ModalClaimSelectionEffect
      claimsOpen={props.claimsOpen}
      factCheckResults={props.factCheckResults}
      selectedClaim={props.selectedClaim}
      setSelectedClaim={props.setSelectedClaim}
    />
    <ModalScrollProgressTracker
      articleUrl={props.currentArticle.url}
      contentScrollRef={props.contentScrollRef}
      fullArticleText={props.fullArticleText}
      isExpanded={props.isExpanded}
      isOpen={props.isOpen}
      setArticleScrollProgress={props.setArticleScrollProgress}
    />
    <ArticleScrollKeyListener
      claimsOpen={props.claimsOpen}
      contentScrollRef={props.contentScrollRef}
      handleNavigate={props.handleNavigate}
      isExpanded={props.isExpanded}
      isOpen={props.isOpen}
      onNavigate={props.onNavigate}
      wikiPanelOpen={props.wikiPanelOpen}
    />
    <ArticleDetailDialogBody {...props} />
  </>
),

 useModalArticleState = ({
  article,
  services,
  onNavigate,
}: Readonly<{
  article: NewsArticle
  services: ArticleDetailServices
  onNavigate?: (direction: "prev" | "next") => void
}>) => {
  const { isLiked, toggleLike } = useLikedArticles(),
   { isBookmarked, toggleBookmark } = useBookmarks(),
   { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue(),
   { isFavorite, toggleFavorite } = useFavorites(),
   { markAsRead } = useReadingHistory(),
   [showSourceDetails, setShowSourceDetails] = useState(false),
   [debugOpen, setDebugOpen] = useState(false),
   [debugLoading, setDebugLoading] = useState(false),
   [debugData, setDebugData] = useState<SourceDebugData | undefined>(),
   debugMode = useDebugMode(),
   [matchedEntryIndex, setMatchedEntryIndex] = useState<number | undefined>(),
   [aiAnalysisLoading, setAiAnalysisLoading] = useState(false),
   [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis | undefined>(),
   [isExpanded, setIsExpanded] = useState(false),
   handleNavigate = useCallback((direction: "prev" | "next") => {
    onNavigate?.(direction)
  }, [onNavigate]),
   [bookmarkLoading, setBookmarkLoading] = useState(false),
   [claimsOpen, setClaimsOpen] = useState(false),
   [activeStatusFilter, setActiveStatusFilter] = useState<FactCheckStatusFilter>("all"),
   [selectedClaim, setSelectedClaim] = useState<FactCheckResult | undefined>(),
   [agenticLoading, setAgenticLoading] = useState(false),
   [agenticAnswer, setAgenticAnswer] = useState<string | undefined>(),
   [agenticError, setAgenticError] = useState<string | undefined>(),
   [agenticHistory, setAgenticHistory] = useState<readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]>([]),
   [showHighlights, setShowHighlights] = useState(true),
   [highlightColor, setHighlightColor] = useState<Highlight["color"]>("yellow"),
   [sidebarEditingId, setSidebarEditingId] = useState<string | undefined>(),
   [sidebarEditingNote, setSidebarEditingNote] = useState(""),
   [aiAnalysisRequested, setAiAnalysisRequested] = useState(false),
   [highlights, setHighlights] = useState<LocalHighlight[]>([]),
   [highlightSyncStatus, setHighlightSyncStatus] = useState<"idle" | "syncing" | "failed" | "offline">("idle"),
   [, setHighlightsHistory] = useState<LocalHighlight[][]>([]),
   latestHighlightSyncRef = useRef(0),
   articleContentRef = useRef<HTMLDivElement>(null),
   [activeHighlightId, setActiveHighlightId] = useState<string | undefined>(),
   [highlightPopoverOpen, setHighlightPopoverOpen] = useState(false),
   [highlightPopoverAnchorEl, setHighlightPopoverAnchorEl] = useState<HTMLElement | undefined>(),
   [highlightPopoverHighlight, setHighlightPopoverHighlight] = useState<LocalHighlight | undefined>(),
   lastCreatedClientIdRef = useRef<string | undefined>(void 0),
   contentScrollRef = useRef<HTMLDivElement>(null),
   progressTrackRef = useRef<HTMLDivElement>(null),
   [articleScrollProgress, setArticleScrollProgress] = useState(0),
   [wikiPanelOpen, setWikiPanelOpen] = useState(false),
   [wikiPanelTab, setWikiPanelTab] = useState<"source" | "reporter">("source"),
   articleCacheKey = getArticleCacheKey(article),
   {
    data: source,
    isLoading: sourceLoading,
  } = useQuery<NewsSource | undefined>({
    queryFn: async () => (await services.getSourceById(article.sourceId)) ?? undefined,
    queryKey: ["source", article.sourceId],
    retry: 1,
  }),
   {
    data: fullArticleText,
    isFetching: articleLoading,
  } = useQuery<string | undefined>({
    placeholderData: getInitialArticleText(article),
    queryFn: ({ signal }) => fetchFullArticleText(article, articleCacheKey, signal),
    queryKey: ["article-full-text", articleCacheKey],
    retry: 1,
    staleTime: 1000 * 60 * 5,
  }),
   { handleUndo, runHighlightSync, updateHighlightsWithHistory } = useModalHighlightHistory({
    article,
    latestHighlightSyncRef,
    services,
    setHighlightSyncStatus,
    setHighlights,
    setHighlightsHistory,
  }),
   {
    handleColorSelect,
    handleHighlightClick,
    handleRetrySync,
    handleSaveHighlightNote,
    handleToggleShowHighlights,
    handleToolbarCreate,
    handleToolbarDelete,
    handleToolbarUpdate,
    updateHighlightByStableId,
  } = useModalHighlightActions({
    article,
    articleContentRef,
    highlights,
    lastCreatedClientIdRef,
    runHighlightSync,
    setActiveHighlightId,
    setHighlightColor,
    setHighlightPopoverAnchorEl,
    setHighlightPopoverHighlight,
    setHighlightPopoverOpen,
    setShowHighlights,
    updateHighlightsWithHistory,
  }),
   { handleCancelEdit, handleHighlightDelete, handleSaveNote, handleStartEdit } = useModalHighlightEditorActions({
    handleSaveHighlightNote,
    setSidebarEditingId,
    setSidebarEditingNote,
    updateHighlightByStableId,
    updateHighlightsWithHistory,
  })

  return {
    activeHighlightId,
    activeStatusFilter,
    addArticleToQueue,
    agenticAnswer,
    agenticError,
    agenticHistory,
    agenticLoading,
    aiAnalysis,
    aiAnalysisLoading,
    aiAnalysisRequested,
    articleCacheKey,
    articleContentRef,
    articleLoading,
    articleScrollProgress,
    bookmarkLoading,
    claimsOpen,
    contentScrollRef,
    debugData,
    debugLoading,
    debugMode,
    debugOpen,
    fullArticleText,
    handleCancelEdit,
    handleColorSelect,
    handleHighlightClick,
    handleHighlightDelete,
    handleNavigate,
    handleRetrySync,
    handleSaveHighlightNote,
    handleSaveNote,
    handleStartEdit,
    handleToggleShowHighlights,
    handleToolbarCreate,
    handleToolbarDelete,
    handleToolbarUpdate,
    handleUndo,
    highlightColor,
    highlightPopoverAnchorEl,
    highlightPopoverHighlight,
    highlightPopoverOpen,
    highlightSyncStatus,
    highlights,
    isArticleInQueue,
    isBookmarked,
    isExpanded,
    isFavorite,
    isLiked,
    latestHighlightSyncRef,
    markAsRead,
    matchedEntryIndex,
    progressTrackRef,
    removeArticleFromQueue,
    selectedClaim,
    setActiveStatusFilter,
    setAgenticAnswer,
    setAgenticError,
    setAgenticHistory,
    setAgenticLoading,
    setAiAnalysis,
    setAiAnalysisLoading,
    setAiAnalysisRequested,
    setArticleScrollProgress,
    setBookmarkLoading,
    setClaimsOpen,
    setDebugData,
    setDebugLoading,
    setDebugOpen,
    setHighlightColor,
    setHighlightPopoverOpen,
    setHighlightSyncStatus,
    setHighlights,
    setIsExpanded,
    setMatchedEntryIndex,
    setSelectedClaim,
    setShowSourceDetails,
    setSidebarEditingId,
    setSidebarEditingNote,
    setWikiPanelOpen,
    setWikiPanelTab,
    showHighlights,
    showSourceDetails,
    sidebarEditingId,
    sidebarEditingNote,
    source,
    sourceLoading,
    toggleBookmark,
    toggleFavorite,
    toggleLike,
    wikiPanelOpen,
    wikiPanelTab,
  }
},

 ArticleDetailModalContent = ({ article, isOpen, onClose, onBookmarkChange, onNavigate, layoutIdPrefix, services = DEFAULT_ARTICLE_DETAIL_SERVICES }: ArticleDetailModalProps & { article: NewsArticle }) => {
  const {
    activeHighlightId,
    activeStatusFilter,
    addArticleToQueue,
    agenticAnswer,
    agenticError,
    agenticHistory,
    agenticLoading,
    aiAnalysis,
    aiAnalysisLoading,
    aiAnalysisRequested,
    articleContentRef,
    articleLoading,
    articleScrollProgress,
    bookmarkLoading,
    claimsOpen,
    contentScrollRef,
    debugData,
    debugLoading,
    debugMode,
    debugOpen,
    setDebugOpen,
    fullArticleText,
    handleCancelEdit,
    handleColorSelect,
    handleHighlightClick,
    handleHighlightDelete,
    handleNavigate,
    handleRetrySync,
    handleSaveHighlightNote,
    handleSaveNote,
    handleStartEdit,
    handleToolbarCreate,
    handleToolbarDelete,
    handleToolbarUpdate,
    handleUndo,
    handleToggleShowHighlights,
    highlightColor,
    highlightPopoverAnchorEl,
    highlightPopoverHighlight,
    highlightPopoverOpen,
    highlightSyncStatus,
    highlights,
    isArticleInQueue,
    isBookmarked,
    isExpanded,
    isFavorite,
    isLiked,
    latestHighlightSyncRef,
    markAsRead,
    matchedEntryIndex,
    progressTrackRef,
    removeArticleFromQueue,
    selectedClaim,
    setActiveStatusFilter,
    setAgenticAnswer,
    setAgenticError,
    setAgenticHistory,
    setAgenticLoading,
    setAiAnalysis,
    setAiAnalysisLoading,
    setAiAnalysisRequested,
    setArticleScrollProgress,
    setBookmarkLoading,
    setClaimsOpen,
    setDebugData,
    setDebugLoading,
    setHighlightPopoverOpen,
    setHighlightSyncStatus,
    setHighlights,
    setIsExpanded,
    setMatchedEntryIndex,
    setSelectedClaim,
    setShowSourceDetails,
    setSidebarEditingId,
    setSidebarEditingNote,
    setWikiPanelOpen,
    setWikiPanelTab,
    showHighlights,
    showSourceDetails,
    sidebarEditingId,
    sidebarEditingNote,
    source,
    sourceLoading,
    toggleBookmark,
    toggleFavorite,
    toggleLike,
    wikiPanelOpen,
    wikiPanelTab,
  } = useModalArticleState({ article, onNavigate, services }),

   HIGHLIGHT_DEBUG = getHighlightDebugEnabled(),

   loadDebug = () => loadDebugData({
    article,
    services,
    setDebugData,
    setDebugLoading,
    setMatchedEntryIndex,
  }),

   loadAiAnalysis = () => loadAiAnalysisData({
    article,
    services,
    setAiAnalysis,
    setAiAnalysisLoading,
    setAiAnalysisRequested,
  }),

   runAgenticSearch = (claim: FactCheckResult | undefined) => runAgenticSearchData({
    article,
    claim,
    services,
    setAgenticAnswer,
    setAgenticError,
    setAgenticHistory,
    setAgenticLoading,
  }),


   handleLikeToggle = () => {
    void toggleArticleLike(article, toggleLike)
  },

   handleBookmarkToggle = () => {
    void toggleArticleBookmark({ article, isBookmarked, onBookmarkChange, setBookmarkLoading, toggleBookmark })
  },

   {
    aiActionLabel,
    aiHasError,
    canRequestAiAnalysis,
    factCheckResults,
    filteredClaims,
    statusCounts,
  } = getArticleDetailAnalysisState(aiAnalysis, aiAnalysisLoading, aiAnalysisRequested, activeStatusFilter),

   // Inline definition hook (Alt+select)
    { result: inlineResult, open: inlineOpen, setOpen: setInlineOpen, anchorPosition: inlineAnchorPosition } = useInlineDefinition(),


   currentArticle = article,
   canPersistArticle = currentArticle.isPersisted !== false,
   {
    articleHost,
    articleTextForMetrics,
    articleWikiContext,
    estimatedReadMinutes,
    hasReporterWiki,
    hasSourceWiki,
    reporterName,
    showSummary,
    wordCount,
  } = getArticleDetailArticleState(currentArticle, fullArticleText),
   {
    data: languageDiagnostics,
    isFetching: languageDiagnosticsLoading,
    error: languageDiagnosticsQueryError,
  } = useQuery<LanguageDiagnostics>({
    enabled: isOpen && wordCount >= 20,
    queryFn: () =>
      services.fetchLanguageDiagnostics({
        sourceName: currentArticle.source,
        text: articleTextForMetrics,
        title: currentArticle.title,
        url: currentArticle.url,
      }),
    queryKey: ["article-language-diagnostics", currentArticle.url, articleTextForMetrics.slice(0, 120)],
    retry: 1,
    staleTime: 1000 * 60 * 5,
  }),
   renderedLanguageDiagnostics = getRenderedLanguageDiagnostics(aiAnalysis, languageDiagnostics),
   openSourceWiki = () => {
    openModalWikiPanel({ available: hasSourceWiki, setOpen: setWikiPanelOpen, setTab: setWikiPanelTab, tab: "source" })
  },
   openReporterWiki = () => {
    openModalWikiPanel({ available: hasReporterWiki, setOpen: setWikiPanelOpen, setTab: setWikiPanelTab, tab: "reporter" })
  },
   handleClaimsOpenChange = (open: boolean) => {
    updateClaimsDialog({
      factCheckResults,
      open,
      selectedClaim,
      setActiveStatusFilter,
      setAgenticAnswer,
      setAgenticError,
      setClaimsOpen,
      setSelectedClaim,
    })
  },

   visibleHighlights = getVisibleRemoteHighlights(highlights),
   obsidianMarkdown = getArticleObsidianMarkdown(currentArticle, fullArticleText, reporterName, visibleHighlights),

   handleBackToTop = () => {
    contentScrollRef.current?.scrollTo({ behavior: "smooth", top: 0 })
  },

   handleToggleDebug = () => {
    toggleDebugPanel({ isOpen: debugOpen, loadDebug, setOpen: setDebugOpen })
  },

   handleSelectClaim = (claim: FactCheckResult) => {
    setSelectedClaim(claim)
    setAgenticAnswer(undefined)
    setAgenticError(undefined)
  },

   handleQueueToggle = () => {
    toggleArticleQueue({ addArticleToQueue, article, isArticleInQueue, removeArticleFromQueue })
  },

   handleFavoriteToggle = () => {
    toggleArticleFavorite(article, toggleFavorite)
  },

   onDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {onClose()}
  }, [onClose]),
   onCloseHighlightPopover = useCallback(() => {
    setHighlightPopoverOpen(false)
  }, []),
   onToggleExpanded = useCallback(() => {
    setIsExpanded((expanded) => !expanded)
  }, []),
   onToggleSourceDetails = useCallback(() => {
    setShowSourceDetails((visible) => !visible)
  }, []),
   onRelatedArticleClick = useCallback((relatedArticle: Readonly<{ url: string }>) => {
    globalThis.open(relatedArticle.url, "_blank", "noopener,noreferrer")
  }, [])

  if (!isOpen || !currentArticle) {return null}

  const viewProps: ArticleDetailModalViewProps = {
    activeHighlightId,
    activeStatusFilter,
    agenticAnswer,
    agenticError,
    agenticHistory,
    agenticLoading,
    aiActionLabel,
    aiAnalysis,
    aiAnalysisLoading,
    aiAnalysisRequested,
    aiHasError,
    article,
    articleContentRef,
    articleHost,
    articleLoading,
    articleScrollProgress,
    articleWikiContext,
    bookmarkLoading,
    canPersistArticle,
    canRequestAiAnalysis,
    claimsOpen,
    contentScrollRef,
    currentArticle,
    debugData,
    debugEnabled: HIGHLIGHT_DEBUG,
    debugLoading,
    debugMode,
    debugOpen,
    editingId: sidebarEditingId,
    editingNote: sidebarEditingNote,
    estimatedReadMinutes,
    factCheckResults,
    filteredClaims,
    fullArticleText,
    handleNavigate,
    handleUndo,
    hasReporterWiki,
    hasSourceWiki,
    highlightColor,
    highlightPopoverAnchorEl,
    highlightPopoverHighlight,
    highlightPopoverOpen,
    highlightSyncStatus,
    highlights,
    inlineAnchorPosition,
    inlineOpen,
    inlineResult,
    isArticleInQueue,
    isBookmarked,
    isExpanded,
    isFavorite,
    isLiked,
    isOpen,
    languageDiagnostics: renderedLanguageDiagnostics,
    languageDiagnosticsError: getLanguageDiagnosticsError(languageDiagnosticsQueryError, renderedLanguageDiagnostics),
    languageDiagnosticsLoading,
    layoutIdPrefix,
    markAsRead,
    matchedEntryIndex,
    obsidianMarkdown,
    onAiAnalysis: loadAiAnalysis,
    onBackToTop: handleBackToTop,
    onBookmark: handleBookmarkToggle,
    onCancelEdit: handleCancelEdit,
    onClaimsOpenChange: handleClaimsOpenChange,
    onClose,
    onCloseHighlightPopover,
    onColorSelect: handleColorSelect,
    onCreate: handleToolbarCreate,
    onDelete: handleToolbarDelete,
    onDialogOpenChange,
    onFavorite: handleFavoriteToggle,
    onFilterChange: setActiveStatusFilter,
    onHighlightClick: handleHighlightClick,
    onHighlightDelete: handleHighlightDelete,
    onLike: handleLikeToggle,
    onNavigate,
    onNoteChange: setSidebarEditingNote,
    onOpenReporterWiki: openReporterWiki,
    onOpenSourceWiki: openSourceWiki,
    onQueueToggle: handleQueueToggle,
    onRelatedArticleClick,
    onRetrySync: handleRetrySync,
    onRunAgenticSearch: runAgenticSearch,
    onSaveHighlightNote: handleSaveHighlightNote,
    onSaveNote: handleSaveNote,
    onSelectClaim: handleSelectClaim,
    onStartEdit: handleStartEdit,
    onToggleDebug: handleToggleDebug,
    onToggleExpanded,
    onToggleShowHighlights: handleToggleShowHighlights,
    onToggleSourceDetails,
    onUpdate: handleToolbarUpdate,
    progressTrackRef,
    reporterName,
    selectedClaim,
    services,
    setArticleScrollProgress,
    setHighlightSyncStatus,
    setHighlights,
    setInlineOpen,
    setSelectedClaim,
    setWikiPanelOpen,
    setWikiPanelTab,
    showHighlights,
    showSourceDetails,
    showSummary,
    source,
    sourceLoading,
    statusCounts,
    visibleHighlights,
    wikiPanelOpen,
    wikiPanelTab,
    wordCount,
  }

  return <ArticleDetailModalView {...viewProps} />
};

export { ArticleDetailModal }
export type { ArticleDetailServices }
