"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { logUserAction } from "@/lib/performance-logger"
import Link from "next/link"
import { X, ExternalLink, Heart, Bookmark, AlertTriangle, DollarSign, Bug, Link as LinkIcon, Sparkles, Maximize2, Minimize2, Loader2, Search, RefreshCw, CheckCircle2, XCircle, Copy, PlusCircle, MinusCircle, Star, Edit2, Trash2, Eye, EyeOff, Download, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { type NewsArticle, getSourceById, type NewsSource, fetchSourceDebugData, type SourceDebugData, analyzeArticle, type ArticleAnalysis, API_BASE_URL, performAgenticSearch, type FactCheckResult, type Highlight, getHighlightsForArticle, createHighlight, updateHighlight, deleteHighlight } from "@/lib/api"
import { useDebugMode } from "@/hooks/useDebugMode"
import { useLikedArticles } from "@/hooks/useLikedArticles"
import { loadHighlightStore, mergeHighlights, saveHighlightStore, toRemoteHighlights, type LocalHighlight, type HighlightSyncStatus, generateClientId, markFailed, markPending, markSynced, createHighlightFingerprint, dedupeLocalHighlights } from "@/lib/highlight-store"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { useFavorites } from "@/hooks/useFavorites"
import { useReadingHistory } from "@/hooks/useReadingHistory"
import { useInlineDefinition } from "@/hooks/useInlineDefinition"
import { useBookmarks } from "@/hooks/useBookmarks"
import InlineDefinition from "@/components/inline-definition"
import { ReporterProfilePanel } from "@/components/reporter-profile"
import { SourceResearchPanel } from "@/components/source-research-panel"
import { RelatedArticles } from "@/components/related-articles"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toast } from "sonner"
import { ArticleContent } from "@/components/article-content"
import { HighlightToolbar } from "@/components/highlight-toolbar"
import { HighlightNotePopover } from "@/components/highlight-note-popover"
import { buildObsidianMarkdown } from "@/lib/highlight-utils"

type FactCheckStatus = FactCheckResult["verification_status"]
type FactCheckStatusFilter = FactCheckStatus | "all"

const VERIFICATION_STYLE_MAP: Record<FactCheckStatus, string> = {
  verified: "bg-primary/15 text-primary border border-primary/40",
  "partially-verified": "bg-amber-500/15 text-amber-200 border border-amber-500/40",
  unverified: "bg-slate-600/20 text-slate-200 border border-slate-500/40",
  false: "bg-rose-500/15 text-rose-200 border border-rose-500/40"
}

const VERIFICATION_LABEL_MAP: Record<FactCheckStatus, string> = {
  verified: "verified",
  "partially-verified": "partially verified",
  unverified: "unverified",
  false: "false"
}

const STATUS_FILTERS: FactCheckStatusFilter[] = ["all", "verified", "partially-verified", "unverified", "false"]

const fullArticleCache = new Map<string, string | null>()

const isExtractableUrl = (url?: string | null) => {
  if (!url) return false
  return /^https?:\/\//i.test(url)
}

const getInitialArticleText = (article: NewsArticle) => {
  if (article.hasFullContent && article.content) {
    return article.content
  }

  return null
}

const getArticleCacheKey = (article: NewsArticle) => {
  if (isExtractableUrl(article.url)) {
    return article.url
  }
  return `article_${article.id}`
}

async function fetchFullArticleText(
  article: NewsArticle,
  articleCacheKey: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const cached = fullArticleCache.get(articleCacheKey)
  if (cached !== undefined) {
    return cached
  }

  const initialText = getInitialArticleText(article)
  if (!isExtractableUrl(article.url)) {
    fullArticleCache.set(articleCacheKey, initialText)
    return initialText
  }

  try {
    const response = await fetch(`${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`, {
      signal,
    })
    if (!response.ok) {
      return initialText
    }

    const data = await response.json()
    const extractedText = data.text || data.full_text || null
    const resolvedText = extractedText || initialText
    fullArticleCache.set(articleCacheKey, resolvedText)
    return resolvedText
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      console.error("Failed to fetch full article:", error)
    }
    return initialText
  }
}

interface ArticleDetailModalProps {
  article: NewsArticle | null
  isOpen: boolean
  onClose: () => void
  onBookmarkChange?: (articleId: number, isBookmarked: boolean) => void
  onNavigate?: (direction: "prev" | "next") => void
  layoutIdPrefix?: string
}

export function ArticleDetailModal(props: ArticleDetailModalProps) {
  const { article, isOpen } = props
  if (!isOpen || !article) return null

  return (
    <ArticleDetailModalContent
      key={`${article.id}:${article.url}`}
      {...props}
      article={article}
    />
  )
}

function ArticleDetailModalContent({ article, isOpen, onClose, onBookmarkChange, onNavigate, layoutIdPrefix }: ArticleDetailModalProps & { article: NewsArticle }) {
  const { isLiked, toggleLike } = useLikedArticles()
  const { isBookmarked, toggleBookmark } = useBookmarks()
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue()
  const { isFavorite, toggleFavorite } = useFavorites()
  const { markAsRead } = useReadingHistory()
  const [showSourceDetails, setShowSourceDetails] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugData, setDebugData] = useState<SourceDebugData | null>(null)
  const debugMode = useDebugMode()
  const [matchedEntryIndex, setMatchedEntryIndex] = useState<number | null>(null)
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const handleNavigate = useCallback((direction: "prev" | "next") => {
    if (!onNavigate) return
    onNavigate(direction)
  }, [onNavigate])

  const isTextInputFocused = () => {
    const active = document.activeElement
    if (!active) return false
    if (active instanceof HTMLInputElement) return true
    if (active instanceof HTMLTextAreaElement) return true
    if (active instanceof HTMLElement && active.isContentEditable) return true
    return false
  }
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [claimsOpen, setClaimsOpen] = useState(false)
  const [activeStatusFilter, setActiveStatusFilter] = useState<FactCheckStatusFilter>("all")
  const [selectedClaim, setSelectedClaim] = useState<FactCheckResult | null>(null)
  const [agenticLoading, setAgenticLoading] = useState(false)
  const [agenticAnswer, setAgenticAnswer] = useState<string | null>(null)
  const [agenticError, setAgenticError] = useState<string | null>(null)
  const [agenticHistory, setAgenticHistory] = useState<Array<{ claim: string; answer: string; timestamp: number }>>([])
  const [showHighlights, setShowHighlights] = useState(true)
  const [highlightColor, setHighlightColor] = useState<Highlight["color"]>("yellow")
  const [sidebarEditingId, setSidebarEditingId] = useState<number | null>(null)
  const [sidebarEditingNote, setSidebarEditingNote] = useState("")
  const [aiAnalysisRequested, setAiAnalysisRequested] = useState(false)
  const [highlights, setHighlights] = useState<LocalHighlight[]>([])
  const [highlightSyncStatus, setHighlightSyncStatus] = useState<"idle" | "syncing" | "failed" | "offline">("idle")
  const [, setHighlightsHistory] = useState<LocalHighlight[][]>([])
  const latestHighlightSyncRef = useRef(0)
  const articleContentRef = useRef<HTMLDivElement>(null)
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null)
  const [highlightPopoverOpen, setHighlightPopoverOpen] = useState(false)
  const [highlightPopoverAnchorEl, setHighlightPopoverAnchorEl] = useState<HTMLElement | null>(null)
  const [highlightPopoverHighlight, setHighlightPopoverHighlight] = useState<Highlight | null>(null)
  const lastCreatedClientIdRef = useRef<string | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const [articleScrollProgress, setArticleScrollProgress] = useState(0)
  const [wikiPanelOpen, setWikiPanelOpen] = useState(false)
  const [wikiPanelTab, setWikiPanelTab] = useState<"source" | "reporter">("source")
  const articleCacheKey = getArticleCacheKey(article)
  const {
    data: source,
    isLoading: sourceLoading,
  } = useQuery<NewsSource | null>({
    queryKey: ["source", article.sourceId],
    queryFn: async () => (await getSourceById(article.sourceId)) || null,
    retry: 1,
  })
  const {
    data: fullArticleText,
    isFetching: articleLoading,
  } = useQuery<string | null>({
    queryKey: ["article-full-text", articleCacheKey],
    queryFn: ({ signal }) => fetchFullArticleText(article, articleCacheKey, signal),
    placeholderData: getInitialArticleText(article),
    retry: 1,
    staleTime: 1000 * 60 * 5,
  })

  const pushToHistory = useCallback((currentHighlights: LocalHighlight[]) => {
    setHighlightsHistory((prev) => [...prev, currentHighlights].slice(-20)) // keep last 20 states
  }, [])

  const handleUndo = useCallback(() => {
    setHighlightsHistory((prev) => {
      if (prev.length === 0) return prev
      const newHistory = [...prev]
      const previousState = newHistory.pop()
      if (previousState && article?.url) {
        setHighlights((current) => {
          const nextState = previousState.map(ph => {
            const currentEquivalent = current.find(ch => ch.client_id === ph.client_id)
            if (!currentEquivalent && !ph.deleted) {
              return markPending({ highlight: ph, op: ph.server_id ? "update" : "create" })
            }
            if (currentEquivalent?.deleted && !ph.deleted) {
               return markPending({ highlight: { ...ph, deleted: false }, op: ph.server_id ? "update" : "create" })
            }
            return ph
          })

          current.forEach(ch => {
            if (!previousState.find(ph => ph.client_id === ch.client_id) && !ch.deleted) {
              nextState.push(markPending({ highlight: { ...ch, deleted: true }, op: "delete" }))
            }
          })

          saveHighlightStore({ version: 1, article_url: article.url, highlights: nextState })
          void syncHighlights(article.url, nextState)
          return nextState
        })
      }
      return newHistory
    })
  }, [article?.url])

  const updateHighlightsWithHistory = useCallback((updater: (prev: LocalHighlight[]) => LocalHighlight[]) => {
    setHighlights((prev) => {
      pushToHistory(prev)
      const next = updater(prev)
      if (article?.url) {
        saveHighlightStore({ version: 1, article_url: article.url, highlights: next })
        void syncHighlights(article.url, next)
      }
      return next
    })
  }, [article?.url, pushToHistory])

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (!isTextInputFocused()) {
          e.preventDefault()
          handleUndo()
        }
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [handleUndo])

  const HIGHLIGHT_DEBUG =
    typeof window !== "undefined" &&
    window.localStorage.getItem("debug_highlights") === "1"

  useEffect(() => {
    if (!article?.url) {
      setHighlights([])
      setHighlightSyncStatus("idle")
      return
    }

    const store = loadHighlightStore(article.url)
    setHighlights(store.highlights)

    if (HIGHLIGHT_DEBUG) {
      console.debug("[Highlights] loaded local store", {
        url: article.url,
        count: store.highlights.length,
      })
    }

    getHighlightsForArticle(article.url)
      .then((serverHighlights) => {
        if (HIGHLIGHT_DEBUG) {
          console.debug("[Highlights] fetched server highlights", {
            url: article.url,
            count: serverHighlights.length,
          })
        }

        const merged = mergeHighlights({
          articleUrl: article.url,
          local: store.highlights,
          server: serverHighlights,
        })

        if (HIGHLIGHT_DEBUG) {
          console.debug("[Highlights] merged highlights", {
            url: article.url,
            count: merged.length,
          })
        }

        setHighlights(merged)
        saveHighlightStore({ version: 1, article_url: article.url, highlights: merged })
      })
      .catch((e) => {
        console.error("Failed to load highlights", e)
        if (HIGHLIGHT_DEBUG) {
          console.debug("[Highlights] fetch failed", {
            url: article.url,
            online: navigator.onLine,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      })
  }, [HIGHLIGHT_DEBUG, article?.url])

  const syncHighlights = async (articleUrl: string, current: LocalHighlight[]) => {
    const syncToken = Date.now()
    latestHighlightSyncRef.current = syncToken
    setHighlightSyncStatus("syncing")

    const actionable = current.filter((item) => item.pending_op)
    if (actionable.length === 0) {
      setHighlightSyncStatus(navigator.onLine ? "idle" : "offline")
      return
    }

    let next = [...current]

    for (const item of actionable) {
      if (latestHighlightSyncRef.current !== syncToken) return

      try {
        if (item.pending_op === "create") {
          const created = await createHighlight({
            article_url: item.article_url,
            highlighted_text: item.highlighted_text,
            color: item.color,
            note: item.note,
            character_start: item.character_start,
            character_end: item.character_end,
          })
          next = next.map((h) => (h.client_id === item.client_id ? markSynced({ highlight: h, server: created }) : h))
        } else if (item.pending_op === "update") {
          const id = item.server_id ?? item.id
          if (!id) {
            next = next.map((h) => (h.client_id === item.client_id ? markFailed({ highlight: h, error: "missing server id" }) : h))
          } else {
            const updated = await updateHighlight(id, {
              note: item.note,
              color: item.color,
              character_start: item.character_start,
              character_end: item.character_end,
              highlighted_text: item.highlighted_text,
            })
            next = next.map((h) => (h.client_id === item.client_id ? markSynced({ highlight: h, server: updated }) : h))
          }
        } else if (item.pending_op === "delete") {
          const id = item.server_id ?? item.id
          if (id) {
            await deleteHighlight(id)
          }
          next = next.filter((h) => h.client_id !== item.client_id)
        }
      } catch (error) {
        if (!navigator.onLine) {
          setHighlightSyncStatus("offline")
        } else {
          setHighlightSyncStatus("failed")
        }
        next = next.map((h) => (h.client_id === item.client_id ? markFailed({ highlight: h, error }) : h))
      } finally {
        if (articleUrl) {
          saveHighlightStore({ version: 1, article_url: articleUrl, highlights: next })
          setHighlights(next)
        }
      }
    }

    if (latestHighlightSyncRef.current === syncToken) {
      setHighlightSyncStatus(navigator.onLine ? "idle" : "offline")
    }
  }

  // Track reading history when article is opened
  useEffect(() => {
    if (isOpen && article && typeof article.id === "number") {
      markAsRead(article.id, article.title, article.source)
    }
  }, [isOpen, article, markAsRead])

  useEffect(() => {
    if (!isOpen || !isExpanded || !onNavigate) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInputFocused()) return

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault()
        handleNavigate("next")
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault()
        handleNavigate("prev")
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleNavigate, isOpen, isExpanded, onNavigate])

  const loadDebug = async () => {
    if (!article) return
    try {
      setDebugLoading(true)
      const data = await fetchSourceDebugData(article.source)
      setDebugData(data)
      // Try to match entry by link, else by title
      let idx: number | null = null
      if (data?.parsed_entries?.length) {
        idx = data.parsed_entries.findIndex(e => e.link === article.url)
        if (idx === -1) {
          const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
          const at = norm(article.title)
          idx = data.parsed_entries.findIndex(e => norm(e.title) === at)
        }
        if (idx === -1) idx = null
      }
      setMatchedEntryIndex(idx)
    } catch (e) {
      console.error('Failed to fetch debug data:', e)
      setDebugData(null)
      setMatchedEntryIndex(null)
    } finally {
      setDebugLoading(false)
    }
  }

  const loadAiAnalysis = async () => {
    if (!article) return
    try {
      setAiAnalysisRequested(true)
      setAiAnalysisLoading(true)
      const analysis = await analyzeArticle(article.url, article.source)
      setAiAnalysis(analysis)
    } catch (e) {
      console.error('Failed to analyze article:', e)
      setAiAnalysis({
        success: false,
        article_url: article.url,
        error: e instanceof Error ? e.message : 'Failed to analyze article'
      })
    } finally {
      setAiAnalysisLoading(false)
    }
  }

  const runAgenticSearch = async (claim: FactCheckResult | null) => {
    if (!claim) return

    setAgenticLoading(true)
    setAgenticAnswer(null)
    setAgenticError(null)

    try {
      const enrichedQuery = [
        `Fact-check this claim: ${claim.claim}`,
        article?.title ? `Article title: ${article.title}` : null,
        article?.source ? `Publisher: ${article.source}` : null,
        claim.evidence ? `Existing evidence summary: ${claim.evidence}` : null,
        "Respond with a concise verification summary and cite authoritative sources."
      ]
        .filter(Boolean)
        .join(" \n")

      const response = await performAgenticSearch(enrichedQuery, 10)

      if (response.success && response.answer) {
        setAgenticAnswer(response.answer)
        setAgenticHistory((prev) => [{ claim: claim.claim, answer: response.answer, timestamp: Date.now() }, ...prev].slice(0, 5))
      } else {
        setAgenticError("Agentic search returned no direct answer. Try again or open the research workspace for a deeper dive.")
      }
    } catch (error) {
      setAgenticError(error instanceof Error ? error.message : "Agentic search failed.")
    } finally {
      setAgenticLoading(false)
    }
  }


  const handleLikeToggle = async () => {
    if (!article?.id || article.isPersisted === false) return

    await toggleLike(article.id)
  }

  const handleBookmarkToggle = async () => {
    if (!article?.id || article.isPersisted === false) return

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
  }

  const factCheckResults = useMemo(
    () => (!isOpen || !article ? [] : (aiAnalysis?.fact_check_results ?? [])),
    [aiAnalysis?.fact_check_results, article, isOpen],
  )
  const canRequestAiAnalysis = !aiAnalysisRequested || Boolean(aiAnalysis?.error)
  const aiActionLabel = (() => {
    if (!aiAnalysisRequested) return "Run AI Analysis"
    if (aiAnalysisLoading) return "Running AI Analysis"
    if (aiAnalysis?.error) return "Retry AI Analysis"
    return "AI Analysis Ready"
  })()

  const statusCounts = useMemo(() => {
    return factCheckResults.reduce(
      (acc, result) => {
        acc[result.verification_status] = (acc[result.verification_status] ?? 0) + 1
        return acc
      },
      {
        verified: 0,
        "partially-verified": 0,
        unverified: 0,
        false: 0
      } as Record<FactCheckStatus, number>
    )
  }, [factCheckResults])

  const filteredClaims = useMemo(() => {
    if (activeStatusFilter === "all") return factCheckResults
    return factCheckResults.filter((claim) => claim.verification_status === activeStatusFilter)
  }, [factCheckResults, activeStatusFilter])

  const getConfidenceColor = (confidence: FactCheckResult["confidence"]) => {
    switch (confidence) {
      case "high":
        return "bg-primary/15 text-primary border border-primary/40"
      case "medium":
        return "bg-amber-500/15 text-amber-200 border border-amber-500/40"
      case "low":
        return "bg-rose-500/15 text-rose-200 border border-rose-500/40"
      default:
        return "bg-slate-600/20 text-slate-200 border border-slate-500/40"
    }
  }

  const getCredibilityColor = (credibility: string) => {
    switch (credibility) {
      case "high":
        return "bg-primary/15 text-primary border-primary/30"
      case "medium":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
      case "low":
        return "bg-red-500/20 text-red-400 border-red-500/30"
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30"
    }
  }

   // Inline definition hook (Alt+select)
   const { result: inlineResult, open: inlineOpen, setOpen: setInlineOpen, anchorPosition: inlineAnchorPosition } = useInlineDefinition()

   const handleHighlightClick = (highlightStableId: string, element: HTMLElement) => {
     const found = highlights.find((item) => {
       const stableId = item.id ? `server:${item.id}` : `client:${item.client_id}`
       return stableId === highlightStableId
     }) ?? null
     setActiveHighlightId(highlightStableId)
     setHighlightPopoverHighlight(found ? toRemoteHighlights([found])[0] ?? null : null)
     setHighlightPopoverAnchorEl(element)
     setHighlightPopoverOpen(true)
   }

    const handleSaveHighlightNote = async (highlightId: number, note: string) => {
      if (!article) return
      updateHighlightsWithHistory((prev) => {
        const updatedLocal = prev.map((item) => {
          const id = item.server_id ?? item.id
          if (id !== highlightId) return item
          return markPending({ highlight: { ...item, note }, op: "update" })
        })
        return updatedLocal
      })
    }


  const getBiasColor = (bias: string) => {
    switch (bias) {
      case "left":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30"
      case "center":
        return "bg-gray-500/20 text-gray-400 border-gray-500/30"
      case "right":
        return "bg-red-500/20 text-red-400 border-red-500/30"
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30"
    }
  }

  const hasRealImage = (src?: string | null) => {
    if (!src) return false
    const trimmed = src.trim()
    if (!trimmed) return false
    if (trimmed === "none") return false
    const lower = trimmed.toLowerCase()
    return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg")
  }

  const formatDate = (date: string) => {
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return date
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const currentArticle = article
  const canPersistArticle = currentArticle.isPersisted !== false
  const heroImage = currentArticle && hasRealImage(currentArticle.image) ? currentArticle.image : null
  const heroLayoutId = layoutIdPrefix && currentArticle ? `${layoutIdPrefix}-image-${currentArticle.id}` : undefined
  const titleLayoutId = layoutIdPrefix && currentArticle ? `${layoutIdPrefix}-title-${currentArticle.id}` : undefined
  const articleTextForMetrics = (fullArticleText || currentArticle?.content || currentArticle?.summary || "").trim()
  const wordCount = articleTextForMetrics ? articleTextForMetrics.split(/\s+/).filter(Boolean).length : 0
  const estimatedReadMinutes = Math.max(1, Math.ceil(wordCount / 230))
  const summaryText = (currentArticle?.summary || "").trim()
  const contentText = (currentArticle?.content || "").trim()
  const fullText = (fullArticleText || "").trim()
  const articleWikiContext = (fullText || contentText || summaryText).trim()
  const reporterName = currentArticle?.author?.trim() || currentArticle?.authors?.find((value) => value.trim().length > 0) || ""
  const showSummary = Boolean(
    summaryText &&
      summaryText !== fullText &&
      summaryText !== contentText
  )
  const articleHost = currentArticle && isExtractableUrl(currentArticle.url) ? new URL(currentArticle.url).hostname : undefined
  const hasReporterWiki = Boolean(reporterName)
  const hasSourceWiki = Boolean(currentArticle?.source?.trim())
  const openSourceWiki = () => {
    if (!hasSourceWiki) return
    setWikiPanelTab("source")
    setWikiPanelOpen(true)
  }
  const openReporterWiki = () => {
    if (!hasReporterWiki) return
    setWikiPanelTab("reporter")
    setWikiPanelOpen(true)
  }
  const handleClaimsOpenChange = (open: boolean) => {
    setClaimsOpen(open)
    if (!open) {
      setSelectedClaim(null)
      setAgenticAnswer(null)
      setAgenticError(null)
      setActiveStatusFilter("all")
      return
    }

    if (!selectedClaim && factCheckResults.length > 0) {
      setSelectedClaim(factCheckResults[0])
    }
  }
  const visibleHighlights = useMemo(
    () => toRemoteHighlights(highlights.filter((h) => !h.deleted)),
    [highlights],
  )
  const obsidianMarkdown = useMemo(
    () =>
      buildObsidianMarkdown({
        article: {
          url: currentArticle?.url || "",
          title: currentArticle?.title || "",
          author: reporterName || currentArticle?.author,
          publishedAt: currentArticle?.publishedAt || "",
          content: currentArticle?.content,
          summary: currentArticle?.summary || "",
        },
        fullArticleText,
        highlights: visibleHighlights,
      }),
    [currentArticle, fullArticleText, reporterName, visibleHighlights],
  )

  useEffect(() => {
    const container = contentScrollRef.current
    if (!container || !isOpen) return

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
  }, [isOpen, isExpanded, currentArticle?.url, fullArticleText])

  if (!isOpen || !currentArticle) return null

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={`${isExpanded
          ? "h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] rounded-2xl sm:max-w-[calc(100vw-1rem)]"
          : "max-h-[85vh] w-full max-w-6xl rounded-2xl sm:max-w-6xl"
          } gap-0 overflow-hidden border border-border/50 bg-background/95 p-0 shadow-2xl shadow-black/60`}
      >
      {/* Inline Definition Popover */}
       <InlineDefinition
         result={inlineResult}
         open={inlineOpen}
         setOpen={setInlineOpen}
         anchorPosition={inlineAnchorPosition}
       />
       <HighlightNotePopover
          open={highlightPopoverOpen}
          highlight={highlightPopoverHighlight}
          anchorEl={highlightPopoverAnchorEl}
          onClose={() => setHighlightPopoverOpen(false)}
          onSave={handleSaveHighlightNote}
        />
        <Sheet open={wikiPanelOpen} onOpenChange={setWikiPanelOpen}>
          <SheetContent className="w-full border-l border-white/10 bg-background p-0 sm:max-w-xl">
            <div className="flex h-full flex-col">
              <SheetHeader className="border-b border-white/10 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SheetTitle className="font-serif text-xl">
                      {wikiPanelTab === "source" ? currentArticle.source : reporterName}
                    </SheetTitle>
                    <SheetDescription className="mt-1 text-xs">
                      Inline wiki preview from cached public-source research with direct links to the full wiki pages.
                    </SheetDescription>
                  </div>
                  {wikiPanelTab === "source" && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/wiki/source/${encodeURIComponent(currentArticle.source)}`}>
                        Open full wiki
                      </Link>
                    </Button>
                  )}
                </div>
                {hasSourceWiki && hasReporterWiki && (
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setWikiPanelTab("source")}
                      className={`rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] transition-colors ${
                        wikiPanelTab === "source"
                          ? "border-white/20 bg-white/10 text-foreground"
                          : "border-white/10 bg-transparent text-muted-foreground hover:bg-white/5"
                      }`}
                    >
                      Source
                    </button>
                    <button
                      type="button"
                      onClick={() => setWikiPanelTab("reporter")}
                      className={`rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] transition-colors ${
                        wikiPanelTab === "reporter"
                          ? "border-white/20 bg-white/10 text-foreground"
                          : "border-white/10 bg-transparent text-muted-foreground hover:bg-white/5"
                      }`}
                    >
                      Reporter
                    </button>
                  </div>
                )}
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-4">
                {wikiPanelTab === "source" ? (
                  <SourceResearchPanel
                    sourceName={currentArticle.source}
                    website={articleHost}
                    autoRun={true}
                  />
                ) : reporterName ? (
                  <ReporterProfilePanel
                    reporterName={reporterName}
                    organization={currentArticle.source}
                    articleContext={articleWikiContext}
                  />
                ) : (
                  <div className="rounded-lg border border-white/10 bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                    Reporter information is not available for this article.
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex h-full flex-col overflow-hidden">
        {/* Header Controls */}
          <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/40 bg-background/75 p-4 backdrop-blur-xl">
          <div className="flex items-center gap-2 flex-1">
            {onNavigate ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleNavigate("prev")}
                  className="rounded-md border border-border/40 bg-card/60 px-4 text-xs uppercase tracking-wider text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
                  title="Previous (ArrowLeft)"
                >
                  Prev
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleNavigate("next")}
                  className="rounded-md border border-border/40 bg-card/60 px-4 text-xs uppercase tracking-wider text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
                  title="Next (ArrowRight)"
                >
                  Next
                </Button>
              </>
            ) : null}
          </div>
          <div className="flex items-center justify-center flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
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

        {/* Content Wrapper */}
        <div ref={contentScrollRef} className="no-scrollbar relative flex-1 overflow-y-auto bg-background">
          <div className="pointer-events-none absolute inset-y-24 right-2 z-10 hidden w-2 rounded-full bg-white/5 lg:block">
            <div
              className="w-full rounded-full bg-primary/80 transition-[height] duration-150"
              style={{ height: `${Math.max(articleScrollProgress * 100, 8)}%` }}
            />
          </div>
          {/* Hero Section */}
          <div className={`relative overflow-hidden ${isExpanded ? 'min-h-96 h-[60vh]' : 'h-56'} ${heroImage ? "bg-card" : "editorial-modal-fallback"}`}>
            {heroImage ? (
              <>
                <motion.img
                  layoutId={heroLayoutId}
                  src={heroImage}
                  alt={article.title}
                  className="h-full w-full object-cover opacity-70"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
              </>
            ) : (
              <div className="editorial-modal-fallback absolute inset-0" />
            )}

            {/* Hero Content */}
            <div className="absolute inset-0 flex flex-col justify-end">
              <div className="mx-auto w-full max-w-6xl px-6 pb-10 md:px-8 md:pb-12">
                {/* Badges */}
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

                {/* Title */}
                <motion.h1
                  layoutId={titleLayoutId}
                  className={`mb-6 font-serif leading-tight text-foreground ${isExpanded ? 'text-4xl md:text-6xl' : 'text-2xl md:text-4xl'
                    }`}
                >
                  {article.title}
                </motion.h1>

                {/* Meta */}
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      openSourceWiki()
                    }}
                    className="font-medium hover:text-primary hover:underline transition-colors"
                  >
                    {article.source}
                  </button>
                  <Link
                    href={`/source/${encodeURIComponent(article.sourceId)}`}
                    className="text-muted-foreground hover:text-primary transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose()
                    }}
                    title="Open source page"
                  >
                    <LinkIcon className="h-3.5 w-3.5" />
                  </Link>
                  <Link
                    href={`/wiki/source/${encodeURIComponent(article.source)}`}
                    className="text-muted-foreground hover:text-primary transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
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
                        onClick={(e) => {
                          e.stopPropagation()
                          openReporterWiki()
                        }}
                        title="Open reporter wiki preview"
                      >
                        Reporter: {reporterName}
                      </button>
                      <Link
                        href={`/wiki/reporters?search=${encodeURIComponent(reporterName)}`}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        onClick={(e) => {
                          e.stopPropagation()
                          onClose()
                        }}
                        title="Search reporter in wiki"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                      </Link>
                    </>
                  )}
                  {!reporterName && currentArticle.authors && currentArticle.authors.length > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-foreground/80 text-xs">
                        {currentArticle.authors.slice(0, 2).join(", ")}
                      </span>
                    </>
                  )}
                  <span>•</span>
                  <span>{formatDate(article.publishedAt)}</span>
                  <span>•</span>
                  <span>{article.country}</span>
                  {article.translated && (
                    <>
                      <span>•</span>
                      <Badge variant="outline" className="text-xs">
                        Translated from {article.originalLanguage.toUpperCase()}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className={isExpanded ? "mx-auto max-w-6xl px-6 py-10 md:px-8 md:py-12" : "px-6 py-8 md:px-8"}>
            {/* Summary Quote */}
            {showSummary && (
              <div className={isExpanded ? "mb-12 border-l-4 border-primary bg-card/50 px-6 py-4" : "mb-8 border-l-4 border-primary bg-card/50 px-5 py-4"}>
                <p className={`text-foreground/80 leading-relaxed italic ${isExpanded ? 'text-2xl' : 'text-lg'
                  }`}>
                  {article.summary}
                </p>
              </div>
            )}

            {/* Two Column Layout */}
            <div className={`grid gap-8 ${isExpanded ? 'grid-cols-1 lg:grid-cols-3 gap-12' : 'grid-cols-1'
              }`}>
              {/* Main Article Content - 2/3 width */}
              <div className={isExpanded ? "lg:col-span-2 space-y-8" : "space-y-6"}>
                {/* Full Article Content - Show immediately */}
                <div className="space-y-6">
                  <h2 className={`font-bold text-foreground mb-6 font-serif ${isExpanded ? 'text-3xl' : 'text-xl'
                    }`}>Full Article</h2>

                  {articleLoading && fullArticleText && (
                    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border/50 bg-card/60 p-4">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                      <p className="text-muted-foreground text-sm">Updating full article text...</p>
                    </div>
                  )}

                  {articleLoading && !fullArticleText ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card/60 p-6">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                      <p className="text-muted-foreground">Loading full article text...</p>
                    </div>
                  ) : (
                    <>
                        <ArticleContent
                          ref={articleContentRef}
                          content={fullArticleText || article.summary || ""}
                            highlights={showHighlights ? visibleHighlights : []}

                          activeHighlightId={activeHighlightId}
                          onHighlightClick={handleHighlightClick}
                          className={`reading-prose ${isExpanded ? 'space-y-6' : 'space-y-5'}`}
                        />
                        <HighlightToolbar
                        articleUrl={article.url}
                        containerRef={articleContentRef}
                        highlightColor={highlightColor}
                        autoCreate
                         highlights={visibleHighlights}
                        onCreate={async ({ highlightedText, color, range }) => {
                          const nextFingerprint = createHighlightFingerprint({
                            character_start: range.start,
                            character_end: range.end,
                            highlighted_text: highlightedText,
                          })
                          const hasDuplicate = highlights.some((item) => {
                            if (item.deleted) return false
                            return (
                              createHighlightFingerprint({
                                character_start: item.character_start,
                                character_end: item.character_end,
                                highlighted_text: item.highlighted_text,
                              }) === nextFingerprint
                            )
                          })

                          if (hasDuplicate) {
                            toast.error("That exact text is already highlighted")
                            return
                          }

                          const clientId = generateClientId()
                          lastCreatedClientIdRef.current = clientId

                          const nextLocal: LocalHighlight = markPending({
                            highlight: {
                              client_id: clientId,
                              sync_status: "pending",
                              pending_op: "create",
                              local_updated_at: new Date().toISOString(),
                              article_url: article.url,
                              highlighted_text: highlightedText,
                              color,
                              character_start: range.start,
                              character_end: range.end,
                            },
                            op: "create",
                          })

                          updateHighlightsWithHistory((prev) => {
                            return dedupeLocalHighlights([...prev, nextLocal])
                          })

                          setTimeout(() => {
                            const anchor = articleContentRef.current?.querySelector(
                              `mark[data-highlight-stable-id=\"client:${clientId}\"]`
                            ) as HTMLElement | null

                            setHighlightPopoverHighlight(toRemoteHighlights([nextLocal])[0] ?? null)
                            setHighlightPopoverAnchorEl(anchor)
                            setHighlightPopoverOpen(true)
                          }, 10)
                        }}
                        onUpdate={async ({ highlightId, note }) => {
                          updateHighlightsWithHistory((prev) => {
                            return prev.map((item) => {
                              const id = item.server_id ?? item.id
                              if (id !== highlightId) return item
                              return markPending({ highlight: { ...item, note }, op: "update" })
                            })
                          })
                        }}
                        onDelete={async ({ highlightId }) => {
                          updateHighlightsWithHistory((prev) => {
                            return prev.map((item) => {
                              const id = item.server_id ?? item.id
                              if (id !== highlightId) return item
                              return markPending({ highlight: item, op: "delete" })
                            })
                          })
                        }}
                      />
                    </>
                  )}
                </div>

                {/* AI Analysis Note - Only show if AI provides additional insights */}
                {aiAnalysis?.full_text && aiAnalysis.full_text !== fullArticleText && aiAnalysis.full_text !== article.content && (
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
                )}

                {/* Tags */}
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-3">Tags</h4>
                  <div className="flex flex-wrap gap-2">
                    {article.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-6 border-t border-gray-800 relative z-10 mb-20">
                  <div className="flex items-center gap-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void handleLikeToggle()
                      }}
                      className={article?.id && isLiked(article.id) ? "text-red-400" : "text-gray-400"}
                      disabled={!canPersistArticle}
                      title={canPersistArticle ? "Like article" : "Only indexed articles can be liked."}
                    >
                      <Heart className={`h-4 w-4 mr-2 ${article?.id && isLiked(article.id) ? "fill-current" : ""}`} />
                      Like
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => article && toggleFavorite(article.sourceId)}
                      className={article && isFavorite(article.sourceId) ? "text-yellow-400" : "text-gray-400"}
                      title={article && isFavorite(article.sourceId) ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Star className={`h-4 w-4 mr-2 ${article && isFavorite(article.sourceId) ? "fill-current" : ""}`} />
                      Favorite
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBookmarkToggle}
                      className={article?.id && isBookmarked(article.id) ? "text-yellow-400" : "text-gray-400"}
                      disabled={bookmarkLoading || !canPersistArticle}
                      title={canPersistArticle ? "Bookmark article" : "Only indexed articles can be bookmarked."}
                    >
                      <Bookmark className={`h-4 w-4 ${article?.id && isBookmarked(article.id) ? "fill-current" : ""}`} />
                      Bookmark
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadAiAnalysis}
                      disabled={!canRequestAiAnalysis || aiAnalysisLoading}
                      className={aiAnalysisRequested && !aiAnalysis?.error ? "text-emerald-400" : "text-gray-400"}
                      title="AI analysis is opt-in to reduce API calls"
                    >
                      {aiAnalysisLoading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      {aiActionLabel}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (article && isArticleInQueue(article.url)) {
                          removeArticleFromQueue(article.url)
                        } else if (article) {
                          addArticleToQueue(article)
                        }
                      }}
                      className={article && isArticleInQueue(article.url) ? "text-blue-400" : "text-gray-400"}
                    >
                      {article && isArticleInQueue(article.url) ? (
                        <MinusCircle className="h-4 w-4 mr-2" />
                      ) : (
                        <PlusCircle className="h-4 w-4 mr-2" />
                      )}
                      {article && isArticleInQueue(article.url) ? "Remove from Queue" : "Add to Queue"}
                    </Button>

                  </div>
                  {!canPersistArticle ? (
                    <span className="text-xs text-muted-foreground">
                      This article is readable here, but likes and bookmarks only work for indexed archive items.
                    </span>
                  ) : null}
                  <Button variant="outline" size="sm" asChild>
                    <a href={article.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Read Original
                    </a>
                  </Button>
                </div>
              </div>

                  {/* Sidebar - 1/3 width - Only show in expanded mode */}
              {isExpanded && (
                <div className="lg:col-span-1 space-y-6">
                  <div className="rounded-lg border border-border/60 bg-secondary/70 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">Reader</div>
                        <h2 className="text-lg font-semibold text-foreground">Annotations</h2>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-muted-foreground">{highlights.length}</span>
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">
                          {highlightSyncStatus === "syncing"
                            ? "Saving"
                            : highlightSyncStatus === "offline"
                              ? "Offline"
                              : highlightSyncStatus === "failed"
                                ? "Failed"
                                : "Synced"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {highlightSyncStatus === "failed" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void syncHighlights(article.url, highlights)
                          }}
                          className="gap-2"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Retry sync
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowHighlights((prev) => !prev)}
                        className="gap-2"
                      >
                        {showHighlights ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {showHighlights ? "Hide" : "Show"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {wordCount > 0 ? `${wordCount} words • ${estimatedReadMinutes} min read` : `${estimatedReadMinutes} min read`}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["yellow", "blue", "red", "green", "purple"] as const).map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => {
                            setHighlightColor(color)

                            const lastClientId = lastCreatedClientIdRef.current
                            if (!lastClientId) return

                            updateHighlightsWithHistory((prev) => {
                              return prev.map((item) => {
                                if (item.client_id !== lastClientId) return item
                                return markPending({ highlight: { ...item, color }, op: "update" })
                              })
                            })
                          }}
                          className={`h-7 w-7 rounded border ${highlightColor === color ? "border-foreground" : "border-transparent"} ${
                            color === "yellow"
                              ? "bg-amber-200/80 text-amber-900"
                              : color === "blue"
                                ? "bg-sky-200/80 text-sky-900"
                                : color === "red"
                                  ? "bg-rose-200/80 text-rose-900"
                                  : color === "green"
                                    ? "bg-emerald-200/80 text-emerald-900"
                                    : "bg-purple-200/80 text-purple-900"
                          }`}
                          aria-label={`Annotation color ${color}`}
                        />
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const markdown = obsidianMarkdown
                          const title = article.title.replace(/[:\\/]/g, "-")
                          
                          try {
                            await navigator.clipboard.writeText(markdown)
                            const obsidianUrl = `obsidian://new?file=${encodeURIComponent("News Clippings/" + title)}&clipboard=true`
                            window.location.href = obsidianUrl
                            toast.success("Opening in Obsidian...")
                          } catch {
                            const obsidianUrl = `obsidian://new?file=${encodeURIComponent("News Clippings/" + title)}&content=${encodeURIComponent(markdown)}`
                            window.location.href = obsidianUrl
                            toast.success("Opening in Obsidian...")
                          }
                          
                          logUserAction("highlight_sent_to_obsidian", { url: article.url })
                        }}
                        className="col-span-2 gap-2 border-accent/40 bg-accent/15 text-accent-foreground hover:bg-accent/25"
                      >
                        <PlusCircle className="h-4 w-4" />
                        Add to Obsidian
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await navigator.clipboard.writeText(obsidianMarkdown)
                          toast.success("Obsidian Markdown copied")
                          logUserAction("highlight_markdown_copied", { url: article.url })
                        }}
                        className="gap-2"
                      >
                        <Copy className="h-4 w-4" />
                        Copy
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const sanitizeFilename = (value: string) =>
                            value
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, "-")
                              .replace(/(^-|-$)+/g, "")
                              .slice(0, 80) || "annotations"

                          const blob = new Blob([obsidianMarkdown], { type: "text/markdown" })
                          const fileName = `${sanitizeFilename(article.title)}.md`
                          const link = document.createElement("a")
                          link.href = URL.createObjectURL(blob)
                          link.download = fileName
                          link.click()
                          URL.revokeObjectURL(link.href)
                          logUserAction("highlight_markdown_downloaded", { url: article.url })
                          toast.success("Obsidian Markdown exported")
                        }}
                        className="gap-2"
                      >
                        <Download className="h-4 w-4" />
                        Export
                      </Button>
                    </div>

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
                      onClick={() => contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
                      className="mt-2 w-full gap-2"
                    >
                      <Minimize2 className="h-4 w-4 rotate-180" />
                      Back to top
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {highlights.length === 0 ? (
                      <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
                        No annotations yet.
                      </div>
                    ) : (
                      highlights
                        .filter(h => !h.deleted)
                        .sort((a, b) => a.character_start - b.character_start)
                        .map((highlight, idx) => (
                           <div key={highlight.id ? `server:${highlight.id}` : `client:${highlight.client_id}`} className="relative rounded-lg border border-border/60 bg-background/60 p-4 space-y-3">
                            <div className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background font-mono text-xs font-bold text-muted-foreground shadow-sm">
                              {idx + 1}
                            </div>
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => {
                                 const stableId = highlight.id ? `server:${highlight.id}` : `client:${highlight.client_id}`
                                  const el = articleContentRef.current?.querySelector(
                                    `mark[data-highlight-stable-id=\"${stableId}\"]`
                                  ) as HTMLElement | null
                                  if (el) {
                                    handleHighlightClick(stableId, el)
                                  }

                              }}
                            >
                              <div
                                className={`rounded-md px-3 py-2 text-sm ${
                                  highlight.color === "yellow"
                                    ? "bg-amber-200/80 text-amber-900"
                                    : highlight.color === "blue"
                                      ? "bg-sky-200/80 text-sky-900"
                                      : highlight.color === "red"
                                        ? "bg-rose-200/80 text-rose-900"
                                        : highlight.color === "green"
                                          ? "bg-emerald-200/80 text-emerald-900"
                                          : "bg-purple-200/80 text-purple-900"
                                }`}
                              >
                                {highlight.highlighted_text}
                              </div>
                            </button>

                            {sidebarEditingId === highlight.id ? (
                              <div className="space-y-2">
                                <textarea
                                  value={sidebarEditingNote}
                                  onChange={(event) => setSidebarEditingNote(event.target.value)}
                                  placeholder="Add a note..."
                                  rows={3}
                                  className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm text-foreground"
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      await handleSaveHighlightNote(highlight.id!, sidebarEditingNote)
                                      setSidebarEditingId(null)
                                      setSidebarEditingNote("")
                                    }}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSidebarEditingId(null)
                                      setSidebarEditingNote("")
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap break-words">
                                  {highlight.note?.trim() ? highlight.note : "No note"}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setSidebarEditingId(highlight.id!)
                                      setSidebarEditingNote(highlight.note || "")
                                    }}
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={async () => {
                                      try {
                                        const removed = highlight

                                        updateHighlightsWithHistory((prev) => {
                                          return prev.map((item) => {
                                            const id = item.server_id ?? item.id
                                            if (id !== removed.id) return item
                                            return markPending({ highlight: item, op: "delete" })
                                          })
                                        })

                                        toast("Annotation removed", {
                                          action: {
                                            label: "Undo",
                                            onClick: () => {
                                              updateHighlightsWithHistory((prev) => {
                                                return prev.map((item) => {
                                                  if (item.client_id !== removed.client_id) return item
                                                  return {
                                                    ...item,
                                                    deleted: false,
                                                    sync_status: "pending" as HighlightSyncStatus,
                                                    pending_op: undefined,
                                                    local_updated_at: new Date().toISOString(),
                                                    last_error: undefined,
                                                  }
                                                })
                                              })
                                            },
                                          },
                                        })
                                      } catch (error) {
                                        console.error("Failed to delete highlight", error)
                                        toast.error("Failed to delete annotation")
                                      }
                                    }}
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                    )}
                  </div>

                  {!aiAnalysisRequested && (
                    <div className="rounded-sm border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">
                      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">AI Analysis</p>
                      <p className="mt-2 text-foreground/80 font-serif">
                        AI analysis is off by default. Use the “Run Analysis” button when you need it.
                      </p>
                    </div>
                  )}

                  <SourceResearchPanel
                    sourceName={article.source}
                    website={articleHost}
                  />

                  <RelatedArticles
                    articleId={article.id}
                    onArticleClick={(relatedArticle) => {
                      window.open(relatedArticle.url, "_blank", "noopener,noreferrer");
                    }}
                    limit={5}
                  />

                  {aiAnalysisRequested && aiAnalysisLoading && (
                    <div className="rounded-lg border border-border/60 bg-secondary/70 p-5 text-sm text-muted-foreground">
                      Running AI analysis…
                    </div>
                  )}

                  {aiAnalysisRequested && aiAnalysis && aiAnalysis.error && (
                    <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-200">
                      {aiAnalysis.error}
                    </div>
                  )}

                  {/* AI Analysis - Integrated */}
                  {aiAnalysis && aiAnalysis.success && (
                    <div className="sticky top-6 space-y-6">
                      {/* AI Summary */}
                      {aiAnalysis.summary && (
                        <div className="bg-gradient-to-br from-primary/15 to-amber-500/10 border border-primary/30 rounded-lg p-6">
                          <div className="flex items-center gap-2 mb-3">
                            <Sparkles className="h-5 w-5 text-primary" />
                            <h3 className="text-lg font-semibold text-white">AI Summary</h3>
                          </div>
                          <p className="text-gray-300 leading-relaxed text-sm">{aiAnalysis.summary}</p>
                        </div>
                      )}

                      {/* Bias Analysis */}
                      {aiAnalysis.bias_analysis && (
                        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-yellow-400" />
                            Bias Analysis
                          </h3>
                          {aiAnalysis.bias_analysis.overall_bias_score && (
                            <div className="mb-3">
                              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                                Score: {aiAnalysis.bias_analysis.overall_bias_score}/10
                              </Badge>
                            </div>
                          )}
                          <div className="space-y-3 text-sm">
                            <div>
                              <span className="text-gray-400">Tone:</span>
                              <p className="text-white mt-1">{aiAnalysis.bias_analysis.tone_bias}</p>
                            </div>
                            <div>
                              <span className="text-gray-400">Framing:</span>
                              <p className="text-white mt-1">{aiAnalysis.bias_analysis.framing_bias}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Source Analysis */}
                      {aiAnalysis.source_analysis && (
                        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                          <h3 className="text-lg font-semibold text-white mb-4">Source Info</h3>
                          <div className="space-y-3 text-sm">
                            <div>
                              <span className="text-gray-400">Credibility:</span>
                              <p className="text-white mt-1">{aiAnalysis.source_analysis.credibility_assessment}</p>
                            </div>
                            <div>
                              <span className="text-gray-400">Political Leaning:</span>
                              <p className="text-white mt-1">{aiAnalysis.source_analysis.political_leaning}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Fact Check Results Preview */}
                      {factCheckResults.length > 0 && (
                        <Dialog open={claimsOpen} onOpenChange={handleClaimsOpenChange}>
                          <DialogTrigger asChild>
                            <button
                              type="button"
                              onClick={() => {
                                if (!selectedClaim && factCheckResults.length) {
                                  setSelectedClaim(factCheckResults[0])
                                }
                              }}
                              className="group relative w-full overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/10 to-transparent p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/60 hover:shadow-xl hover:shadow-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                              aria-label="Open verified claims report"
                            >
                              <div className="pointer-events-none absolute -right-20 -top-20 h-40 w-40 rounded-full bg-primary/10 blur-3xl transition-opacity duration-500 group-hover:opacity-60" />
                              <div className="mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-5 w-5 text-primary/80 transition-transform duration-300 group-hover:rotate-3" />
                                  <h3 className="text-lg font-semibold text-foreground">Fact Check Results</h3>
                                </div>
                                <span className="rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground/90">
                                  {factCheckResults.length} claims
                                </span>
                              </div>
                              <div className="space-y-3">
                                {factCheckResults.slice(0, 3).map((result, index) => (
                                  <div
                                    key={`${result.claim}-${index}`}
                                    className="flex items-start gap-3 rounded-lg border border-transparent bg-primary/10 p-3 transition-all duration-300 group-hover:border-primary/40"
                                  >
                                    <Badge className={`${VERIFICATION_STYLE_MAP[result.verification_status]} text-xs uppercase tracking-wide`}>
                                      {VERIFICATION_LABEL_MAP[result.verification_status]}
                                    </Badge>
                                    <p className="text-sm text-foreground/80 line-clamp-2">&quot;{result.claim}&quot;</p>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-5 flex items-center justify-between text-xs text-foreground/70">
                                <span>Click to review the full verification report</span>
                                <div className="flex items-center gap-2 font-semibold">
                                  <span>Open</span>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </div>
                              </div>
                            </button>
                          </DialogTrigger>

                          <DialogContent className="sm:max-w-2xl border border-primary/30 bg-slate-950/95 text-slate-100 shadow-2xl shadow-primary/10">
                            <DialogHeader className="space-y-1">
                              <DialogTitle className="flex items-center gap-2 text-foreground">
                                <Sparkles className="h-5 w-5 text-primary/80" />
                                Verified Claims
                              </DialogTitle>
                              <p className="text-xs text-foreground/70">
                                Check statements, filter by confidence, and run live searches for evidence.
                              </p>
                            </DialogHeader>

                            <div className="grid gap-6 md:grid-cols-3">
                              <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                  {STATUS_FILTERS.map((status) => {
                                    const isAll = status === "all"
                                    const count = isAll ? factCheckResults.length : statusCounts[status as FactCheckStatus]
                                    const isDisabled = !isAll && count === 0
                                    const isActive = activeStatusFilter === status

                                    return (
                                      <button
                                        key={status}
                                        type="button"
                                        className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-all ${isActive ? "border-primary/60 bg-primary/15 text-foreground shadow-lg shadow-black/20" : "border-primary/30 text-foreground/75 hover:border-primary/60 hover:text-foreground"} ${isDisabled ? "cursor-not-allowed opacity-40 hover:border-primary/30 hover:text-foreground/75" : "cursor-pointer"}`}
                                        onClick={() => {
                                          if (isDisabled) return
                                          setActiveStatusFilter(status)
                                        }}
                                      >
                                        {status === "all" ? "All" : VERIFICATION_LABEL_MAP[status as FactCheckStatus]}
                                        <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-bold text-foreground/80">
                                          {count}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>

                                <div>
                                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/70">Claims</h4>
                                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                                    {filteredClaims.map((claim, index) => {
                                      const isActive = selectedClaim?.claim === claim.claim
                                      return (
                                        <button
                                          key={`${claim.claim}-${index}`}
                                          type="button"
                                          className={`w-full rounded-lg border bg-slate-900/70 p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 ${isActive ? "border-primary/60 shadow-lg shadow-primary/20" : "border-slate-800/80"}`}
                                          onClick={() => {
                                            setSelectedClaim(claim)
                                            setAgenticAnswer(null)
                                            setAgenticError(null)
                                          }}
                                        >
                                          <div className="flex items-center gap-2">
                                            <Badge className={`${VERIFICATION_STYLE_MAP[claim.verification_status]} text-xs uppercase tracking-wide`}>
                                              {VERIFICATION_LABEL_MAP[claim.verification_status]}
                                            </Badge>
                                            <span className="text-xs text-foreground/80 line-clamp-2">{claim.claim}</span>
                                          </div>
                                        </button>
                                      )
                                    })}

                                    {filteredClaims.length === 0 && (
                                      <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-4 text-xs text-slate-300/70">
                                        No claims in this category yet. Try another filter.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-4">
                                {selectedClaim ? (
                                  <div className="space-y-4">
                                    <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-inner shadow-primary/10">
                                      <div className="mb-4 flex items-start justify-between gap-3">
                                        <Badge className={`${VERIFICATION_STYLE_MAP[selectedClaim.verification_status]} text-xs uppercase tracking-wide`}>
                                          {VERIFICATION_LABEL_MAP[selectedClaim.verification_status]}
                                        </Badge>
                                        <Badge className={`${getConfidenceColor(selectedClaim.confidence)} text-xs uppercase tracking-wide`}>
                                          confidence: {selectedClaim.confidence}
                                        </Badge>
                                      </div>
                                      <p className="text-sm text-foreground/90">&quot;{selectedClaim.claim}&quot;</p>
                                      {selectedClaim.notes && (
                                        <p className="mt-3 text-xs text-slate-300/80">{selectedClaim.notes}</p>
                                      )}
                                      <div className="mt-4 space-y-2">
                                        <h5 className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Evidence</h5>
                                        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-200/80">
                                          {selectedClaim.evidence || "Evidence details not provided."}
                                        </div>
                                        <div className="flex flex-wrap gap-2 text-xs text-slate-300/70">
                                          {selectedClaim.sources?.slice(0, 4).map((source, idx) => (
                                            <a
                                              key={`${source}-${idx}`}
                                              href={source}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="group/link inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 transition hover:border-primary/60 hover:text-foreground"
                                            >
                                              <LinkIcon className="h-3 w-3" />
                                              <span className="max-w-48 truncate">{source}</span>
                                              <ExternalLink className="h-3 w-3 transition group-hover/link:translate-x-0.5" />
                                            </a>
                                          ))}
                                          {(!selectedClaim.sources || selectedClaim.sources.length === 0) && (
                                            <span className="rounded-full border border-slate-700 px-3 py-1">No sources provided</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
                                        <button
                                          type="button"
                                          className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1 transition hover:border-primary/60 hover:text-foreground"
                                          onClick={() => {
                                            if (typeof navigator !== "undefined") {
                                              navigator.clipboard.writeText(`${selectedClaim.claim}\n\nEvidence: ${selectedClaim.evidence ?? "N/A"}`).catch(() => null)
                                            }
                                          }}
                                        >
                                          <Copy className="h-3.5 w-3.5" />
                                          Copy claim
                                        </button>
                                        <Button variant="outline" size="sm" asChild>
                                          <a
                                            href={`/search?query=${encodeURIComponent(selectedClaim.claim)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <Search className="mr-1 h-3.5 w-3.5" />
                                            Open research workspace
                                          </a>
                                        </Button>
                                      </div>
                                    </div>

                                    <div className="rounded-xl border border-primary/30 bg-primary/10 p-5">
                                      <div className="mb-3 flex items-start justify-between gap-3">
                                        <div>
                                          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                            <Search className="h-4 w-4" /> Live Research
                                          </h4>
                                          <p className="text-xs text-foreground/70">
                                            Search for recent evidence.
                                          </p>
                                        </div>
                                        {agenticHistory.length > 0 && (
                                          <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-wide text-foreground/80">
                                            Last run {new Date(agenticHistory[0].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                          onClick={() => runAgenticSearch(selectedClaim)}
                                          disabled={agenticLoading}
                                          className="inline-flex items-center gap-2"
                                        >
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
                                          onClick={() => runAgenticSearch(selectedClaim)}
                                          disabled={agenticLoading}
                                        >
                                          <RefreshCw className="h-3.5 w-3.5" />
                                          Retry
                                        </Button>
                                      </div>

                                      {agenticError && (
                                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                                          <XCircle className="mt-0.5 h-4 w-4" />
                                          <span>{agenticError}</span>
                                        </div>
                                      )}

                                      {agenticAnswer && (
                                        <div className="mt-4 space-y-2 rounded-lg border border-primary/40 bg-primary/10 p-4 text-sm text-foreground">
                                          <div className="flex items-start gap-2 text-xs uppercase tracking-wide text-foreground/70">
                                            <CheckCircle2 className="mt-0.5 h-4 w-4" />
                                            Agent response
                                          </div>
                                          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{agenticAnswer}</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-slate-800/80 bg-slate-900/70 p-6 text-center text-sm text-slate-300/70">
                                    <Sparkles className="h-6 w-6 text-primary/80" />
                                    <p>Select a claim from the list to view its evidence and run deeper research.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}

                      {/* Fact Check Suggestions */}
                      {aiAnalysis.fact_check_suggestions && aiAnalysis.fact_check_suggestions.length > 0 && (
                        <div className="bg-cyan-500/5 border border-cyan-500/30 rounded-lg p-6">
                          <h3 className="text-lg font-semibold text-white mb-3">Fact Check</h3>
                          <ul className="space-y-2 text-sm">
                            {aiAnalysis.fact_check_suggestions.slice(0, 3).map((suggestion, index) => (
                              <li key={index} className="flex items-start gap-2">
                                <span className="text-cyan-400 mt-1">•</span>
                                <span className="text-gray-300">{suggestion}</span>
                              </li>
                            ))}
                          </ul>
                    </div>
                  )}

                </div>
              )}

                  {/* Source Transparency */}
                  <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-400" />
                        Source
                      </h3>
                      <Button variant="outline" size="sm" onClick={() => setShowSourceDetails(!showSourceDetails)}>
                        {showSourceDetails ? "Hide" : "Show"}
                      </Button>
                    </div>

                    {sourceLoading ? (
                      <div className="flex items-center justify-center p-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      </div>
                    ) : source ? (
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
                              onClick={(e) => {
                                e.stopPropagation()
                                openReporterWiki()
                              }}
                            >
                              {reporterName}
                            </button>
                            <Link
                              href={`/wiki/reporters?search=${encodeURIComponent(reporterName)}`}
                              className="text-muted-foreground hover:text-primary transition-colors"
                              onClick={(e) => {
                                e.stopPropagation()
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
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openSourceWiki()
                                }}
                              >
                                {source.name}
                              </button>
                              <Link
                                href={`/wiki/source/${encodeURIComponent(source.name)}`}
                                className="text-muted-foreground hover:text-primary transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
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
                    ) : (
                      <p className="text-gray-400 text-sm">Source info unavailable</p>
                    )}

                    {debugMode && (
                      <>
                        {/* Debug Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setDebugOpen(!debugOpen); if (!debugOpen) loadDebug(); }}
                          className="w-full mt-4"
                        >
                          <Bug className="h-4 w-4 mr-1" /> {debugOpen ? "Hide" : "Show"} Debug
                        </Button>

                        {/* Debug Panel */}
                        {debugOpen && (
                          <div className="mt-4 p-4 bg-black/40 rounded border border-gray-800">
                            {debugLoading ? (
                              <div className="flex items-center justify-center p-4">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                              </div>
                            ) : debugData ? (
                              <div className="space-y-2 text-xs">
                                <div className="text-gray-400">Entries: {debugData.feed_status?.entries_count}</div>
                                <div className="text-gray-400">Has Images: {debugData.image_analysis?.entries_with_images}/{debugData.image_analysis?.total_entries}</div>
                                {matchedEntryIndex !== null && (
                                  <div className="text-primary">Matched at index: {matchedEntryIndex}</div>
                                )}
                              </div>
                            ) : (
                              <div className="text-gray-400 text-xs">No debug data</div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

            </div>

              {/* Compact AI Loading Indicator */}
              {!isExpanded && aiAnalysisLoading && (
                <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-primary/15 to-amber-500/10 border border-primary/30 rounded-lg">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                  <p className="text-sm text-gray-400">AI is analyzing article in background...</p>
                </div>
              )}

              {/* Compact AI Summary - Show when not expanded */}
              {!isExpanded && aiAnalysis?.summary && (
                <div className="bg-gradient-to-br from-primary/15 to-amber-500/10 border border-primary/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-white">AI Summary</h3>
                  </div>
                  <p className="text-gray-300 leading-relaxed text-sm">{aiAnalysis.summary}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsExpanded(true)}
                    className="mt-3 w-full"
                  >
                    <Maximize2 className="h-4 w-4 mr-2" />
                    Expand for Full AI Analysis
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
