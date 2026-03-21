"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { type NewsArticle, fetchOGImage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Heart,
  Bookmark,
  ExternalLink,
  Star,
  ChevronDown,
  ChevronUp,
  Brain,
  Sparkles,
  Loader2,
} from "lucide-react"
import { ArticleDetailModal } from "./article-detail-modal"
import { useFavorites } from "@/hooks/useFavorites"
import { useLikedArticles } from "@/hooks/useLikedArticles"
import { useBookmarks } from "@/hooks/useBookmarks"
import { useScrollPersonalization } from "@/hooks/useScrollPersonalization"
import {
  FeedScoreBreakdown,
  hasRealFeedImage,
  RANKING_WEIGHTS,
  SCROLL_INITIAL_RENDER_COUNT,
  SCROLL_RENDER_CHUNK_SIZE,
  SCROLL_REVEAL_THRESHOLD,
} from "@/lib/feed-ranking"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

const OG_FETCH_CONCURRENCY = 4
const OG_LOOKAHEAD = 6

interface FeedViewProps {
  articles: NewsArticle[]
  loading: boolean
  totalCount?: number
  debugMode?: boolean
}

function formatRankingStatus(status: "basic" | "loading" | "ready" | "fallback"): string {
  switch (status) {
    case "ready":
      return "Personalized"
    case "loading":
      return "Personalizing"
    case "fallback":
      return "Basic fallback"
    case "basic":
    default:
      return "Basic"
  }
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function RankingPanel({
  status,
  totalLoaded,
  renderedCount,
  bufferRemaining,
  breakdown,
  topicsLoaded,
  seedCount,
  topKeywords,
  topClusters,
  debugMode,
}: {
  status: "basic" | "loading" | "ready" | "fallback"
  totalLoaded: number
  renderedCount: number
  bufferRemaining: number
  breakdown: FeedScoreBreakdown | null
  topicsLoaded: number
  seedCount: number
  topKeywords: string[]
  topClusters: Array<{ label: string; weight: number }>
  debugMode: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerLabel = formatRankingStatus(status)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="absolute top-6 right-6 z-20 flex w-80 max-w-full flex-col items-end gap-2 md:top-8 md:right-8">
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            title={`Ranking: ${triggerLabel}`}
            className={cn(
              "h-auto rounded-md border-white/20 bg-black/40 font-sans uppercase tracking-wider text-white/80 backdrop-blur-md hover:bg-black/55 transition-all duration-200 flex items-center",
              isOpen 
                ? "px-3 py-2 text-[10px] md:text-xs gap-1.5 md:gap-2" 
                : "w-8 h-8 p-0 justify-center md:w-auto md:h-auto md:px-3 md:py-2 md:text-xs md:gap-2 md:justify-start"
            )}
          >
            {status === "loading" ? <Loader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin shrink-0" /> : <Brain className="h-4 w-4 md:h-3.5 md:w-3.5 shrink-0" />}
            
            <span className={cn("whitespace-nowrap", isOpen ? "block" : "hidden md:block")}>
              <span className="hidden sm:inline">Ranking: </span>
              {triggerLabel}
            </span>

            <span className={cn("shrink-0", isOpen ? "block" : "hidden md:block")}>
              {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </span>
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="w-full rounded-xl border border-white/15 bg-black/65 p-4 text-left text-white/85 backdrop-blur-xl">
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2 uppercase tracking-wider text-white/60">
              <span>{totalLoaded} loaded</span>
              <span>{renderedCount} rendered</span>
              <span>{bufferRemaining} buffered</span>
            </div>

            <div className="space-y-1">
              <div className="font-sans uppercase tracking-wider text-white/60">Rules</div>
              <div>1. Favorite sources stay ahead of non-favorites.</div>
              <div>2. Real images stay ahead inside their bucket.</div>
              <div>3. Bookmarks count 2x likes in the profile.</div>
              <div>4. Ties keep original order.</div>
            </div>

            <div className="space-y-1">
              <div className="font-sans uppercase tracking-wider text-white/60">Weights</div>
              <div>bookmark = {RANKING_WEIGHTS.bookmarkWeight}</div>
              <div>like = {RANKING_WEIGHTS.likeWeight}</div>
              <div>keyword cap = {RANKING_WEIGHTS.keywordCap}</div>
              <div>category cap = {RANKING_WEIGHTS.categoryCap}</div>
              <div>source cap = {RANKING_WEIGHTS.sourceCap}</div>
            </div>

            <div className="space-y-1">
              <div className="font-sans uppercase tracking-wider text-white/60">Profile</div>
              <div>{seedCount} saved likes and bookmarks</div>
              <div>{topicsLoaded} topic payloads loaded</div>
              {topKeywords.length > 0 && <div>keywords: {topKeywords.join(", ")}</div>}
              {topClusters.length > 0 && (
                <div>
                  clusters: {topClusters.map((cluster) => `${cluster.label} (${formatScore(cluster.weight)})`).join(", ")}
                </div>
              )}
            </div>
            
            {breakdown && (
              <div className="space-y-1 border-t border-white/10 pt-3">
                <div className="font-sans uppercase tracking-wider text-white/60">Current article</div>
                <div>bucket: {breakdown.bucketLabel}</div>
                <div>total score: {formatScore(breakdown.totalScore)}</div>
                <div>keyword score: {formatScore(breakdown.components.keywordScore)}</div>
                <div>category score: {formatScore(breakdown.components.categoryScore)}</div>
                <div>source score: {formatScore(breakdown.components.sourceScore)}</div>
                {breakdown.matchedKeywords.length > 0 && <div>matched keywords: {breakdown.matchedKeywords.join(", ")}</div>}
                {breakdown.matchedCategories.length > 0 && <div>matched category: {breakdown.matchedCategories.join(", ")}</div>}
                {breakdown.matchedSource && <div>matched source: {breakdown.matchedSource}</div>}
              </div>
            )}

            {debugMode && (
              <div className="flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-white/55">
                <Sparkles className="h-3.5 w-3.5" />
                Scroll uses a 500-article ranked buffer and reveals items in chunks.
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function FeedView({
  articles: propArticles,
  loading,
  totalCount,
  debugMode = false,
}: FeedViewProps) {
  const { likedIds, toggleLike } = useLikedArticles()
  const { bookmarkIds, toggleBookmark } = useBookmarks()
  const { isFavorite, toggleFavorite } = useFavorites()
  const {
    rankedArticles,
    breakdowns,
    status,
    profile,
    topicsLoaded,
    seedCount,
  } = useScrollPersonalization({
    articles: propArticles,
    isFavorite,
    enabled: propArticles.length > 0,
  })

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [activeArticleId, setActiveArticleId] = useState<number | null>(null)
  const [renderCount, setRenderCount] = useState(SCROLL_INITIAL_RENDER_COUNT)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const requestedOgImagesRef = useRef<Set<number>>(new Set())
  const [ogImages, setOgImages] = useState<Record<number, string>>({})

  const visibleArticles = useMemo(
    () => rankedArticles.slice(0, Math.min(renderCount, rankedArticles.length)),
    [rankedArticles, renderCount],
  )

  const targetActiveIndex = useMemo(() => {
    const trackedArticleId = activeArticleId ?? visibleArticles[activeIndex]?.id ?? rankedArticles[0]?.id ?? null
    if (trackedArticleId == null) {
      return 0
    }

    const nextIndex = rankedArticles.findIndex((article) => article.id === trackedArticleId)
    if (nextIndex === -1) {
      return Math.min(activeIndex, Math.max(0, rankedArticles.length - 1))
    }

    return nextIndex
  }, [activeArticleId, activeIndex, rankedArticles, visibleArticles])

  const effectiveActiveIndex = rankedArticles.length === 0
    ? 0
    : Math.min(targetActiveIndex, Math.max(0, rankedArticles.length - 1))

  const effectiveRenderCount = useMemo(() => {
    if (rankedArticles.length === 0) {
      return 0
    }

    const minimumForActive = effectiveActiveIndex + SCROLL_REVEAL_THRESHOLD + 1
    return Math.min(
      Math.max(renderCount, SCROLL_INITIAL_RENDER_COUNT, minimumForActive),
      rankedArticles.length,
    )
  }, [effectiveActiveIndex, rankedArticles.length, renderCount])

  const effectiveVisibleArticles = useMemo(
    () => rankedArticles.slice(0, effectiveRenderCount),
    [effectiveRenderCount, rankedArticles],
  )

  const displaySource = useCallback((article: NewsArticle) => {
    if (!article.source) return ""
    return article.source.length > 24 ? `${article.source.slice(0, 24)}...` : article.source
  }, [])

  useEffect(() => {
    let cancelled = false

    const fetchImages = async () => {
      const start = Math.max(0, effectiveActiveIndex - OG_LOOKAHEAD)
      const end = Math.min(effectiveVisibleArticles.length, effectiveActiveIndex + OG_LOOKAHEAD + 1)
      const candidates = effectiveVisibleArticles
        .slice(start, end)
        .filter(
          (article) =>
            !hasRealFeedImage(article.image) &&
            article.url &&
            !requestedOgImagesRef.current.has(article.id),
        )

      if (candidates.length === 0) {
        return
      }

      candidates.forEach((article) => {
        requestedOgImagesRef.current.add(article.id)
      })

      const pending = [...candidates]
      const newImages: Record<number, string> = {}

      const worker = async () => {
        while (pending.length > 0 && !cancelled) {
          const article = pending.shift()
          if (!article) {
            return
          }

          const imageUrl = await fetchOGImage(article.url)
          if (imageUrl) {
            newImages[article.id] = imageUrl
          }
        }
      }

      const workers = Array.from({ length: Math.min(OG_FETCH_CONCURRENCY, pending.length) }, () => worker())
      await Promise.all(workers)

      if (!cancelled && Object.keys(newImages).length > 0) {
        setOgImages((prev) => ({ ...prev, ...newImages }))
      }
    }

    void fetchImages()

    return () => {
      cancelled = true
    }
  }, [effectiveActiveIndex, effectiveVisibleArticles])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-index"))
            if (index >= effectiveVisibleArticles.length - SCROLL_REVEAL_THRESHOLD && renderCount < rankedArticles.length) {
              setRenderCount((prev) => Math.min(prev + SCROLL_RENDER_CHUNK_SIZE, rankedArticles.length))
            }
            setActiveArticleId(rankedArticles[index]?.id ?? null)
            setActiveIndex(index)
          }
        })
      },
      {
        root: container,
        threshold: 0.6,
      },
    )

    const children = container.querySelectorAll("[data-index]")
    children.forEach((child) => observer.observe(child))

    return () => {
      children.forEach((child) => observer.unobserve(child))
      observer.disconnect()
    }
  }, [effectiveVisibleArticles.length, rankedArticles, renderCount, rankedArticles.length])

  const scrollToNext = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    if (effectiveActiveIndex >= effectiveVisibleArticles.length - 1) return
    const nextElement = container.querySelector(`[data-index="${effectiveActiveIndex + 1}"]`)
    nextElement?.scrollIntoView({ behavior: "smooth" })
  }, [effectiveActiveIndex, effectiveVisibleArticles.length])

  const scrollToPrev = useCallback(() => {
    const container = containerRef.current
    if (!container || effectiveActiveIndex <= 0) return
    const prevElement = container.querySelector(`[data-index="${effectiveActiveIndex - 1}"]`)
    prevElement?.scrollIntoView({ behavior: "smooth" })
  }, [effectiveActiveIndex])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        scrollToNext()
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        scrollToPrev()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [scrollToNext, scrollToPrev])

  const handleLike = useCallback(
    (articleId: number) => {
      void toggleLike(articleId)
    },
    [toggleLike],
  )

  const handleBookmark = useCallback(
    async (articleId: number) => {
      if (!articleId) return
      await toggleBookmark(articleId)
    },
    [toggleBookmark],
  )

  const handleModalBookmarkChange = useCallback(
    (articleId: number, isBookmarked: boolean) => {
      if (isBookmarked !== bookmarkIds.has(articleId)) {
        void toggleBookmark(articleId)
      }
    },
    [bookmarkIds, toggleBookmark],
  )

  const handleArticlePreview = useCallback((article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }, [])

  if (loading) {
    return (
      <div className="flex-1 h-full w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Indexing articles...</span>
        </div>
      </div>
    )
  }

  if (effectiveVisibleArticles.length === 0) {
    return (
      <div className="flex-1 h-full w-full flex items-center justify-center bg-background">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">No coverage found for this category.</span>
      </div>
    )
  }

  const currentBreakdown = breakdowns[effectiveVisibleArticles[effectiveActiveIndex]?.id] || null

  return (
    <div className="relative flex-1 h-full min-h-0 w-full overflow-hidden bg-background">
      <RankingPanel
        status={status}
        totalLoaded={rankedArticles.length}
        renderedCount={effectiveVisibleArticles.length}
        bufferRemaining={Math.max(0, rankedArticles.length - effectiveVisibleArticles.length)}
        breakdown={currentBreakdown}
        topicsLoaded={topicsLoaded}
        seedCount={seedCount}
        topKeywords={profile?.topKeywords || []}
        topClusters={profile?.topClusters || []}
        debugMode={debugMode}
      />

      <div ref={containerRef} className="h-full w-full overflow-y-auto snap-y snap-proximity no-scrollbar">
        {effectiveVisibleArticles.map((article, index) => (
          <section
            key={`${article.id}-${index}`}
            data-index={index}
            className="snap-start w-full relative cursor-pointer group"
            style={{ height: "calc(100vh - 64px)" }}
            onClick={() => handleArticlePreview(article)}
          >
            <div className="absolute inset-0 w-full h-full overflow-hidden">
              <motion.img
                layoutId={`feed-image-${article.id}`}
                src={article.image || ogImages[article.id] || "/placeholder.svg"}
                alt={article.title}
                className="w-full h-full object-cover opacity-60 transition-transform duration-700 group-hover:scale-105"
                onError={(event) => {
                  const target = event.target as HTMLImageElement
                  if (target.src !== ogImages[article.id] && ogImages[article.id]) {
                    target.src = ogImages[article.id]
                  } else if (target.src !== "/placeholder.svg") {
                    target.src = "/placeholder.svg"
                  }
                }}
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/30 pointer-events-none" />

            <div className="relative z-10 h-full flex flex-col justify-end p-6 pb-24 md:p-10 lg:p-12 md:pb-10 lg:pb-12">
              <div className="absolute top-6 left-6 right-6 md:top-8 md:left-8 md:right-8 flex flex-wrap items-center gap-2 pr-44 md:pr-0 pointer-events-none">
                <Badge className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/30 px-2 py-0.5 md:px-3 md:py-1 font-sans text-xs uppercase tracking-wider pointer-events-auto">
                  {article.category}
                </Badge>
                <Badge variant="outline" className="font-sans uppercase tracking-wider border-white/20 bg-black/40 backdrop-blur-sm text-white/90 px-2 py-0.5 md:px-3 md:py-1 text-xs pointer-events-auto">
                  {article.credibility} credibility
                </Badge>
                {currentBreakdown?.articleId === article.id && currentBreakdown.personalizedScore > 0 && (
                  <Badge variant="outline" className="font-sans uppercase tracking-wider border-primary/40 bg-primary/15 text-primary px-2 py-0.5 md:px-3 md:py-1 text-xs pointer-events-auto">
                    score {formatScore(currentBreakdown.personalizedScore)}
                  </Badge>
                )}
              </div>

              <div className="flex flex-col md:flex-row md:items-end gap-6 md:gap-10 max-w-7xl mx-auto w-full">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-3 font-sans text-xs uppercase tracking-widest text-primary font-bold">
                    <span className="w-8 h-px bg-primary" />
                    {displaySource(article)}
                  </div>

                  <motion.h1 layoutId={`feed-title-${article.id}`} className="text-3xl md:text-5xl lg:text-6xl font-serif leading-tight text-balance text-white drop-shadow-lg tracking-tight">
                    {article.title}
                  </motion.h1>

                  <p className="text-base md:text-xl text-white/80 line-clamp-3 max-w-3xl drop-shadow font-sans leading-relaxed">
                    {article.summary}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    <span className="font-sans text-xs text-white/70 tracking-widest uppercase">
                      {new Date(article.publishedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>

                    <a href={article.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/10 text-white border-white/20 hover:bg-white/20 font-sans text-xs uppercase tracking-wider rounded-lg active:scale-95 transition-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-2" />
                        Source
                      </Button>
                    </a>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col items-center gap-2 md:gap-4 bg-black/40 backdrop-blur-xl p-2 md:p-3 border border-white/20 rounded-xl self-start md:self-auto">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 md:h-12 md:w-12 rounded-lg hover:bg-white/20 transition-all active:scale-95"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleLike(article.id)
                    }}
                  >
                    <Heart
                      className={cn(
                        "w-5 h-5 md:w-6 md:h-6 transition-all",
                        likedIds.has(article.id) ? "fill-primary text-primary scale-110" : "text-white/80",
                      )}
                    />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 md:h-12 md:w-12 rounded-lg hover:bg-white/20 transition-all active:scale-95"
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleFavorite(article.sourceId)
                    }}
                  >
                    <Star
                      className={cn(
                        "w-5 h-5 md:w-6 md:h-6 transition-all",
                        isFavorite(article.sourceId) ? "fill-amber-400 text-amber-400 scale-110" : "text-white/80",
                      )}
                    />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 md:h-12 md:w-12 rounded-lg hover:bg-white/20 transition-all active:scale-95"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleBookmark(article.id)
                    }}
                  >
                    <Bookmark
                      className={cn(
                        "w-5 h-5 md:w-6 md:h-6 transition-all",
                        bookmarkIds.has(article.id) ? "fill-white text-white scale-110" : "text-white/80",
                      )}
                    />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ))}

        {effectiveVisibleArticles.length < rankedArticles.length && (
          <div className="flex min-h-28 items-center justify-center border-t border-white/10 bg-black/40 px-6 py-8 text-center text-xs uppercase tracking-widest text-white/70">
            {`Queued ${rankedArticles.length - effectiveVisibleArticles.length} more ranked stories${typeof totalCount === "number" ? ` (${effectiveVisibleArticles.length}/${totalCount})` : ""}`}
          </div>
        )}
      </div>

      <div className="absolute right-6 lg:right-8 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-20 hidden md:flex">
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToPrev}
          disabled={effectiveActiveIndex === 0}
          className="rounded-xl border-white/20 bg-black/40 backdrop-blur-xl hover:bg-primary hover:border-primary text-white disabled:opacity-20 transition-all active:scale-95"
        >
          <ChevronUp className="w-5 h-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToNext}
          disabled={effectiveActiveIndex === effectiveVisibleArticles.length - 1}
          className="rounded-xl border-white/20 bg-black/40 backdrop-blur-xl hover:bg-primary hover:border-primary text-white disabled:opacity-20 transition-all active:scale-95"
        >
          <ChevronDown className="w-5 h-5" />
        </Button>
      </div>

      <ArticleDetailModal article={selectedArticle} isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} onBookmarkChange={handleModalBookmarkChange} />
    </div>
  )
}
