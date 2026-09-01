"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Dispatch, RefObject, SetStateAction } from "react"
import dynamic from "next/dynamic"
import { fetchOGImage } from '@/lib/api';
import type { NewsArticle } from '@/lib/api';
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Bookmark,
  Brain,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Heart,
  Loader2,
  Sparkles,
  Star,
} from "lucide-react"
import { useFavorites } from "@/hooks/use-favorites"
import { useLikedArticles } from "@/hooks/use-liked-articles"
import { useBookmarks } from "@/hooks/useBookmarks"
import { useScrollPersonalization } from "@/hooks/use-scroll-personalization"
import type {
  FeedScoreBreakdown} from "@/lib/feed-ranking";
import {
  RANKING_WEIGHTS,
  SCROLL_INITIAL_RENDER_COUNT,
  SCROLL_RENDER_CHUNK_SIZE,
  SCROLL_REVEAL_THRESHOLD,
  hasRealFeedImage,
} from "@/lib/feed-ranking"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

const ArticleDetailModal = dynamic(
  () => import("./article-detail-modal").then((module) => module.ArticleDetailModal),
  {
    loading: () => null,
    ssr: false,
  },
),

 OG_FETCH_CONCURRENCY = 4,
 OG_LOOKAHEAD = 6

interface FeedViewProps {
  articles: NewsArticle[]
  loading: boolean
  totalCount?: number
  debugMode?: boolean
}

type FeedPersonalizationState = ReturnType<typeof useScrollPersonalization>

interface FeedViewContentProps {
  loading: boolean
  effectiveVisibleArticles: readonly NewsArticle[]
  effectiveActiveIndex: number
  rankedArticles: readonly NewsArticle[]
  breakdowns: FeedPersonalizationState["breakdowns"]
  status: FeedPersonalizationState["status"]
  profile: FeedPersonalizationState["profile"]
  topicsLoaded: number
  seedCount: number
  debugMode: boolean
  containerRef: RefObject<HTMLDivElement | null>
  ogImages: Record<number, string>
  likedIds: ReadonlySet<number>
  bookmarkIds: ReadonlySet<number>
  isFavorite: (sourceId: string) => boolean
  onPreview: (article: NewsArticle, index: number) => void
  onLike: (articleId: number) => void
  onFavorite: (sourceId: string) => void
  onBookmark: (articleId: number) => void
  onPrevious: () => void
  onNext: () => void
  totalCount?: number
  selectedArticle: NewsArticle | null
  isArticleModalOpen: boolean
  onModalClose: () => void
  onModalBookmarkChange: (articleId: number, isBookmarked: boolean) => void
  onModalNavigate: (direction: "prev" | "next") => void
}

function formatRankingStatus(status: "basic" | "loading" | "ready" | "fallback"): string {
  switch (status) {
    case "ready": {
      return "Personalized"
    }
    case "loading": {
      return "Personalizing"
    }
    case "fallback": {
      return "Basic fallback"
    }
    case "basic":
    default: {
      return "Basic"
    }
  }
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function displayFeedSource(source: string | null | undefined): string {
  if (!source) {
    return ""
  }
  return source.length > 24 ? `${source.slice(0, 24)}...` : source
}

interface RankingPanelProps {
  status: "basic" | "loading" | "ready" | "fallback"
  totalLoaded: number
  renderedCount: number
  bufferRemaining: number
  breakdown: FeedScoreBreakdown | null
  topicsLoaded: number
  seedCount: number
  topKeywords: string[]
  topClusters: { label: string; weight: number }[]
  debugMode: boolean
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
}: RankingPanelProps) {
  const [isOpen, setIsOpen] = useState(false),
   triggerLabel = formatRankingStatus(status)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="absolute top-6 right-6 z-20 flex w-80 max-w-full flex-col items-end gap-2 md:top-8 md:right-8">
        <RankingPanelTrigger isOpen={isOpen} status={status} triggerLabel={triggerLabel} />
        <RankingPanelDetails
          breakdown={breakdown}
          bufferRemaining={bufferRemaining}
          debugMode={debugMode}
          renderedCount={renderedCount}
          seedCount={seedCount}
          topClusters={topClusters}
          topKeywords={topKeywords}
          topicsLoaded={topicsLoaded}
          totalLoaded={totalLoaded}
        />
      </div>
    </Collapsible>
  )
}

interface RankingPanelTriggerProps {
  isOpen: boolean
  status: RankingPanelProps["status"]
  triggerLabel: string
}

function RankingPanelTrigger({ isOpen, status, triggerLabel }: RankingPanelTriggerProps) {
  return (
    <CollapsibleTrigger asChild>
      <Button
        variant="outline"
        size="sm"
        title={`Ranking: ${triggerLabel}`}
        className={cn(
          "h-auto rounded-md border-white/20 bg-black/40 font-sans uppercase tracking-wider text-white/80 backdrop-blur-md hover:bg-black/55 transition-all duration-200 flex items-center",
          isOpen
            ? "px-3 py-2 text-[10px] md:text-xs gap-1.5 md:gap-2"
            : "w-8 h-8 p-0 justify-center md:w-auto md:h-auto md:px-3 md:py-2 md:text-xs md:gap-2 md:justify-start",
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
  )
}

interface RankingPanelDetailsProps {
  breakdown: FeedScoreBreakdown | null
  bufferRemaining: number
  debugMode: boolean
  renderedCount: number
  seedCount: number
  topClusters: { label: string; weight: number }[]
  topKeywords: string[]
  topicsLoaded: number
  totalLoaded: number
}

function RankingPanelDetails({
  breakdown,
  bufferRemaining,
  debugMode,
  renderedCount,
  seedCount,
  topClusters,
  topKeywords,
  topicsLoaded,
  totalLoaded,
}: RankingPanelDetailsProps) {
  return (
    <CollapsibleContent className="w-full rounded-xl border border-white/15 bg-black/65 p-4 text-left text-white/85 backdrop-blur-xl">
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap gap-2 uppercase tracking-wider text-white/60">
          <span>{totalLoaded} loaded</span>
          <span>{renderedCount} rendered</span>
          <span>{bufferRemaining} buffered</span>
        </div>
        <RankingRules />
        <RankingWeights />
        <RankingProfile
          seedCount={seedCount}
          topClusters={topClusters}
          topKeywords={topKeywords}
          topicsLoaded={topicsLoaded}
        />
        {breakdown && <RankingBreakdown breakdown={breakdown} />}
        {debugMode && <RankingDebugNotice />}
      </div>
    </CollapsibleContent>
  )
}

function RankingRules() {
  return (
    <div className="space-y-1">
      <div className="font-sans uppercase tracking-wider text-white/60">Rules</div>
      <div>1. Favorite sources stay ahead of non-favorites.</div>
      <div>2. Real images stay ahead inside their bucket.</div>
      <div>3. Bookmarks count 2x likes in the profile.</div>
      <div>4. Ties keep original order.</div>
    </div>
  )
}

function RankingWeights() {
  return (
    <div className="space-y-1">
      <div className="font-sans uppercase tracking-wider text-white/60">Weights</div>
      <div>bookmark = {RANKING_WEIGHTS.bookmarkWeight}</div>
      <div>like = {RANKING_WEIGHTS.likeWeight}</div>
      <div>keyword cap = {RANKING_WEIGHTS.keywordCap}</div>
      <div>category cap = {RANKING_WEIGHTS.categoryCap}</div>
      <div>source cap = {RANKING_WEIGHTS.sourceCap}</div>
    </div>
  )
}

function RankingProfile({
  seedCount,
  topClusters,
  topKeywords,
  topicsLoaded,
}: Readonly<Pick<RankingPanelDetailsProps, "seedCount" | "topClusters" | "topKeywords" | "topicsLoaded">>) {
  return (
    <div className="space-y-1">
      <div className="font-sans uppercase tracking-wider text-white/60">Profile</div>
      <div>{seedCount} saved likes and bookmarks</div>
      <div>{topicsLoaded} topic payloads loaded</div>
      {topKeywords.length > 0 && <div>keywords: {topKeywords.join(", ")}</div>}
      {topClusters.length > 0 && (
        <div>clusters: {topClusters.map((cluster) => `${cluster.label} (${formatScore(cluster.weight)})`).join(", ")}</div>
      )}
    </div>
  )
}

function RankingBreakdown({ breakdown }: Readonly<{ breakdown: FeedScoreBreakdown }>) {
  return (
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
  )
}

function RankingDebugNotice() {
  return (
    <div className="flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-white/55">
      <Sparkles className="h-3.5 w-3.5" />
      Scroll uses a 500-article ranked buffer and reveals items in chunks.
    </div>
  )
}

interface FeedImageLoaderOptions {
  readonly activeIndex: number
  readonly visibleArticles: readonly NewsArticle[]
}

function useFeedImageLoader({ activeIndex, visibleArticles }: FeedImageLoaderOptions): Record<number, string> {
  const requestedImagesRef = useRef<Set<number>>(new Set()),
   [ogImages, setOgImages] = useState<Record<number, string>>({})

  useEffect(() => {
    let cancelled = false

    const fetchImages = async (): Promise<void> => {
      const start = Math.max(0, activeIndex - OG_LOOKAHEAD),
       end = Math.min(visibleArticles.length, activeIndex + OG_LOOKAHEAD + 1),
       candidates = visibleArticles.slice(start, end).filter(
        (article) =>
          !hasRealFeedImage(article.image) &&
          article.url &&
          !requestedImagesRef.current.has(article.id),
      )

      if (candidates.length === 0) {
        return
      }

      candidates.forEach((article) => {
        requestedImagesRef.current.add(article.id)
      })

      const pending = [...candidates],
       newImages: Record<number, string> = {},
       worker = async (): Promise<void> => {
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

      await Promise.all(
        Array.from({ length: Math.min(OG_FETCH_CONCURRENCY, pending.length) }, worker),
      )

      if (!cancelled && Object.keys(newImages).length > 0) {
        setOgImages((previous) => ({ ...previous, ...newImages }))
      }
    }

    void fetchImages()
    return () => {
      cancelled = true
    }
  }, [activeIndex, visibleArticles])

  return ogImages
}

interface FeedIntersectionOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly visibleCount: number
  readonly rankedArticles: readonly NewsArticle[]
  readonly renderCount: number
  readonly setRenderCount: Dispatch<SetStateAction<number>>
  readonly setActiveArticleId: Dispatch<SetStateAction<number | null>>
  readonly setActiveIndex: Dispatch<SetStateAction<number>>
}

function useFeedIntersectionObserver({
  containerRef,
  visibleCount,
  rankedArticles,
  renderCount,
  setRenderCount,
  setActiveArticleId,
  setActiveIndex,
}: FeedIntersectionOptions): void {
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) {
            return
          }

          const index = Number(entry.target.dataset.index)
          if (index >= visibleCount - SCROLL_REVEAL_THRESHOLD && renderCount < rankedArticles.length) {
            setRenderCount((previous) => Math.min(previous + SCROLL_RENDER_CHUNK_SIZE, rankedArticles.length))
          }
          setActiveArticleId(rankedArticles[index]?.id ?? null)
          setActiveIndex(index)
        })
      },
      { root: container, threshold: 0.6 },
    ),

     children = container.querySelectorAll("[data-index]")
    children.forEach((child) =>{  observer.observe(child); })
    return () => {
      children.forEach((child) =>{  observer.unobserve(child); })
      observer.disconnect()
    }
  }, [containerRef, rankedArticles, renderCount, setActiveArticleId, setActiveIndex, setRenderCount, visibleCount])
}

interface FeedScrollNavigationOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly activeIndex: number
  readonly visibleCount: number
  readonly modalOpen: boolean
}

function useFeedScrollNavigation({
  containerRef,
  activeIndex,
  visibleCount,
  modalOpen,
}: FeedScrollNavigationOptions): { scrollToNext: () => void; scrollToPrev: () => void } {
  const scrollToNext = useCallback(() => {
    const container = containerRef.current
    if (!container || activeIndex >= visibleCount - 1) {
      return
    }
    container.querySelector(`[data-index="${activeIndex + 1}"]`)?.scrollIntoView({ behavior: "smooth" })
  }, [activeIndex, containerRef, visibleCount]),

   scrollToPrev = useCallback(() => {
    const container = containerRef.current
    if (!container || activeIndex <= 0) {
      return
    }
    container.querySelector(`[data-index="${activeIndex - 1}"]`)?.scrollIntoView({ behavior: "smooth" })
  }, [activeIndex, containerRef])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (modalOpen) {
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        scrollToNext()
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        scrollToPrev()
      }
    }

    globalThis.addEventListener("keydown", handleKeyDown)
    return () =>{  globalThis.removeEventListener("keydown", handleKeyDown); }
  }, [modalOpen, scrollToNext, scrollToPrev])

  return { scrollToNext, scrollToPrev }
}

interface FeedActionButtonsProps {
  readonly article: NewsArticle
  readonly liked: boolean
  readonly favorite: boolean
  readonly bookmarked: boolean
  readonly onLike: (articleId: number) => void
  readonly onFavorite: (sourceId: string) => void
  readonly onBookmark: (articleId: number) => void
}

function FeedActionButtons({
  article,
  liked,
  favorite,
  bookmarked,
  onLike,
  onFavorite,
  onBookmark,
}: FeedActionButtonsProps): React.JSX.Element {
  return (
    <div className="flex flex-row md:flex-col items-center gap-2 md:gap-4 bg-black/40 backdrop-blur-xl p-2 md:p-3 border border-white/20 rounded-xl self-start md:self-auto">
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 md:h-12 md:w-12 rounded-lg hover:bg-white/20 transition-all active:scale-95"
        onClick={(event) => {
          event.stopPropagation()
          onLike(article.id)
        }}
      >
        <Heart className={cn("w-5 h-5 md:w-6 md:h-6 transition-all", liked ? "fill-primary text-primary scale-110" : "text-white/80")} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 md:h-12 md:w-12 rounded-lg hover:bg-white/20 transition-all active:scale-95"
        onClick={(event) => {
          event.stopPropagation()
          onFavorite(article.sourceId)
        }}
      >
        <Star className={cn("w-5 h-5 md:w-6 md:h-6 transition-all", favorite ? "fill-amber-400 text-amber-400 scale-110" : "text-white/80")} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 md:h-12 md:w-12 rounded-lg hover:bg-white/20 transition-all active:scale-95"
        onClick={(event) => {
          event.stopPropagation()
          onBookmark(article.id)
        }}
      >
        <Bookmark className={cn("w-5 h-5 md:w-6 md:h-6 transition-all", bookmarked ? "fill-white text-white scale-110" : "text-white/80")} />
      </Button>
    </div>
  )
}

interface FeedStoryProps {
  readonly article: NewsArticle
  readonly index: number
  readonly breakdown: FeedScoreBreakdown | null
  readonly ogImage: string | undefined
  readonly liked: boolean
  readonly favorite: boolean
  readonly bookmarked: boolean
  readonly onPreview: (article: NewsArticle, index: number) => void
  readonly onLike: (articleId: number) => void
  readonly onFavorite: (sourceId: string) => void
  readonly onBookmark: (articleId: number) => void
}

function FeedStory({
  article,
  index,
  breakdown,
  ogImage,
  liked,
  favorite,
  bookmarked,
  onPreview,
  onLike,
  onFavorite,
  onBookmark,
}: FeedStoryProps): React.JSX.Element {
  const imageSource = article.image || ogImage || "/placeholder.svg"
  return (
    <section
      key={`${article.id}-${index}`}
      data-index={index}
      className="snap-start w-full relative cursor-pointer group"
      style={{ height: "calc(100vh - 64px)" }}
      onClick={() =>{  onPreview(article, index); }}
    >
      <div className="absolute inset-0 w-full h-full overflow-hidden">
        <motion.img
          layoutId={`feed-image-${article.id}`}
          src={imageSource}
          alt={article.title}
          className="w-full h-full object-cover opacity-60 transition-transform duration-700 group-hover:scale-105"
          onError={(event) => {
            const target = event.target as HTMLImageElement
            if (ogImage && target.src !== ogImage) {
              target.src = ogImage
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
          {breakdown?.articleId === article.id && breakdown.personalizedScore > 0 && (
            <Badge variant="outline" className="font-sans uppercase tracking-wider border-primary/40 bg-primary/15 text-primary px-2 py-0.5 md:px-3 md:py-1 text-xs pointer-events-auto">
              score {formatScore(breakdown.personalizedScore)}
            </Badge>
          )}
        </div>
        <div className="flex flex-col md:flex-row md:items-end gap-6 md:gap-10 max-w-7xl mx-auto w-full">
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-3 font-sans text-xs uppercase tracking-widest text-primary font-bold">
              <span className="w-8 h-px bg-primary" />
              {displayFeedSource(article.source)}
            </div>
            <motion.h1 layoutId={`feed-title-${article.id}`} className="text-3xl md:text-5xl lg:text-6xl font-serif leading-tight text-balance text-white drop-shadow-lg tracking-tight">
              {article.title}
            </motion.h1>
            <p className="text-base md:text-xl text-white/80 line-clamp-3 max-w-3xl drop-shadow font-sans leading-relaxed">{article.summary}</p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <span className="font-sans text-xs text-white/70 tracking-widest uppercase">
                {new Date(article.publishedAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
              </span>
              <a href={article.url} target="_blank" rel="noopener noreferrer" onClick={(event) =>{  event.stopPropagation(); }}>
                <Button size="sm" variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20 font-sans text-xs uppercase tracking-wider rounded-lg active:scale-95 transition-all">
                  <ExternalLink className="w-3.5 h-3.5 mr-2" />
                  Source
                </Button>
              </a>
            </div>
          </div>
          <FeedActionButtons
            article={article}
            liked={liked}
            favorite={favorite}
            bookmarked={bookmarked}
            onLike={onLike}
            onFavorite={onFavorite}
            onBookmark={onBookmark}
          />
        </div>
      </div>
    </section>
  )
}

function FeedLoadingState(): React.JSX.Element {
  return (
    <div className="flex-1 h-full w-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Indexing articles...</span>
      </div>
    </div>
  )
}

function FeedEmptyState(): React.JSX.Element {
  return (
    <div className="flex-1 h-full w-full flex items-center justify-center bg-background">
      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">No coverage found for this category.</span>
    </div>
  )
}

interface FeedScrollControlsProps {
  readonly activeIndex: number
  readonly visibleCount: number
  readonly onPrevious: () => void
  readonly onNext: () => void
}

function FeedScrollControls({
  activeIndex,
  visibleCount,
  onPrevious,
  onNext,
}: FeedScrollControlsProps): React.JSX.Element {
  return (
    <div className="absolute right-6 lg:right-8 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-20 hidden md:flex">
      <Button
        variant="outline"
        size="icon"
        onClick={onPrevious}
        disabled={activeIndex === 0}
        className="rounded-xl border-white/20 bg-black/40 backdrop-blur-xl hover:bg-primary hover:border-primary text-white disabled:opacity-20 transition-all active:scale-95"
      >
        <ChevronUp className="w-5 h-5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onNext}
        disabled={activeIndex === visibleCount - 1}
        className="rounded-xl border-white/20 bg-black/40 backdrop-blur-xl hover:bg-primary hover:border-primary text-white disabled:opacity-20 transition-all active:scale-95"
      >
        <ChevronDown className="w-5 h-5" />
      </Button>
    </div>
  )
}

interface FeedResultsProps {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly visibleArticles: readonly NewsArticle[]
  readonly rankedArticles: readonly NewsArticle[]
  readonly breakdown: FeedScoreBreakdown | null
  readonly ogImages: Record<number, string>
  readonly likedIds: ReadonlySet<number>
  readonly bookmarkIds: ReadonlySet<number>
  readonly isFavorite: (sourceId: string) => boolean
  readonly onPreview: (article: NewsArticle, index: number) => void
  readonly onLike: (articleId: number) => void
  readonly onFavorite: (sourceId: string) => void
  readonly onBookmark: (articleId: number) => void
  readonly onPrevious: () => void
  readonly onNext: () => void
  readonly activeIndex: number
  readonly totalCount: number | undefined
}

function FeedResults({
  containerRef,
  visibleArticles,
  rankedArticles,
  breakdown,
  ogImages,
  likedIds,
  bookmarkIds,
  isFavorite,
  onPreview,
  onLike,
  onFavorite,
  onBookmark,
  onPrevious,
  onNext,
  activeIndex,
  totalCount,
}: FeedResultsProps): React.JSX.Element {
  return (
    <>
      <div ref={containerRef} className="h-full w-full overflow-y-auto snap-y snap-proximity no-scrollbar">
        {visibleArticles.map((article, index) => (
          <FeedStory
            key={`${article.id}-${index}`}
            article={article}
            index={index}
            breakdown={breakdown}
            ogImage={ogImages[article.id]}
            liked={likedIds.has(article.id)}
            favorite={isFavorite(article.sourceId)}
            bookmarked={bookmarkIds.has(article.id)}
            onPreview={onPreview}
            onLike={onLike}
            onFavorite={onFavorite}
            onBookmark={onBookmark}
          />
        ))}
        {visibleArticles.length < rankedArticles.length && (
          <div className="flex min-h-28 items-center justify-center border-t border-white/10 bg-black/40 px-6 py-8 text-center text-xs uppercase tracking-widest text-white/70">
            {`Queued ${rankedArticles.length - visibleArticles.length} more ranked stories${typeof totalCount === "number" ? ` (${visibleArticles.length}/${totalCount})` : ""}`}
          </div>
        )}
      </div>
      <FeedScrollControls
        activeIndex={activeIndex}
        visibleCount={visibleArticles.length}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </>
  )
}

interface FeedActionHandlersOptions {
  readonly bookmarkIds: ReadonlySet<number>
  readonly rankedArticles: readonly NewsArticle[]
  readonly selectedArticleIndex: number | null
  readonly toggleLike: (articleId: number) => void | Promise<void>
  readonly toggleBookmark: (articleId: number) => void | Promise<void>
  readonly setSelectedArticle: Dispatch<SetStateAction<NewsArticle | null>>
  readonly setSelectedArticleIndex: Dispatch<SetStateAction<number | null>>
  readonly setIsArticleModalOpen: Dispatch<SetStateAction<boolean>>
}

interface FeedActionHandlers {
  readonly handleLike: (articleId: number) => void
  readonly handleBookmark: (articleId: number) => void | Promise<void>
  readonly handleModalBookmarkChange: (articleId: number, isBookmarked: boolean) => void
  readonly handleArticlePreview: (article: NewsArticle, index: number) => void
  readonly handleModalNavigate: (direction: "prev" | "next") => void
  readonly handleModalClose: () => void
}

function useFeedActionHandlers({
  bookmarkIds,
  rankedArticles,
  selectedArticleIndex,
  toggleLike,
  toggleBookmark,
  setSelectedArticle,
  setSelectedArticleIndex,
  setIsArticleModalOpen,
}: FeedActionHandlersOptions): FeedActionHandlers {
  const handleLike = useCallback(
    (articleId: number) => {
      void toggleLike(articleId)
    },
    [toggleLike],
  )

  const handleBookmark = useCallback(
    async (articleId: number) => {
      if (!articleId) {return}
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

  const handleArticlePreview = useCallback((article: NewsArticle, index: number) => {
    setSelectedArticle(article)
    setSelectedArticleIndex(index)
    setIsArticleModalOpen(true)
  }, [setIsArticleModalOpen, setSelectedArticle, setSelectedArticleIndex])

  const handleModalNavigate = useCallback((direction: "prev" | "next") => {
    if (selectedArticleIndex === null) {return}

    const nextIndex =
      direction === "next" ? selectedArticleIndex + 1 : selectedArticleIndex - 1
    if (nextIndex < 0 || nextIndex >= rankedArticles.length) {return}

    setSelectedArticleIndex(nextIndex)
    setSelectedArticle(rankedArticles[nextIndex] ?? null)
  }, [rankedArticles, selectedArticleIndex, setSelectedArticle, setSelectedArticleIndex])

  const handleModalClose = useCallback(() => {
    setIsArticleModalOpen(false)
    setSelectedArticle(null)
    setSelectedArticleIndex(null)
  }, [setIsArticleModalOpen, setSelectedArticle, setSelectedArticleIndex])

  return {
    handleArticlePreview,
    handleBookmark,
    handleLike,
    handleModalBookmarkChange,
    handleModalClose,
    handleModalNavigate,
  }
}

interface FeedRankingState {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly effectiveActiveIndex: number
  readonly effectiveVisibleArticles: readonly NewsArticle[]
  readonly ogImages: Record<number, string>
}

interface FeedRankingStateOptions {
  readonly rankedArticles: readonly NewsArticle[]
}

function useFeedRankingState({ rankedArticles }: FeedRankingStateOptions): FeedRankingState {
  const [activeIndex, setActiveIndex] = useState(0),
   [activeArticleId, setActiveArticleId] = useState<number | null>(null),
   [renderCount, setRenderCount] = useState(SCROLL_INITIAL_RENDER_COUNT),
   containerRef = useRef<HTMLDivElement | null>(null),

   visibleArticles = useMemo(
    () => rankedArticles.slice(0, Math.min(renderCount, rankedArticles.length)),
    [rankedArticles, renderCount],
  ),

   targetActiveIndex = useMemo(() => {
    const trackedArticleId = activeArticleId ?? visibleArticles[activeIndex]?.id ?? rankedArticles[0]?.id ?? null
    if (trackedArticleId == null) {
      return 0
    }

    const nextIndex = rankedArticles.findIndex((article) => article.id === trackedArticleId)
    if (nextIndex === -1) {
      return Math.min(activeIndex, Math.max(0, rankedArticles.length - 1))
    }

    return nextIndex
  }, [activeArticleId, activeIndex, rankedArticles, visibleArticles]),

   effectiveActiveIndex = rankedArticles.length === 0
    ? 0
    : Math.min(targetActiveIndex, Math.max(0, rankedArticles.length - 1)),

   effectiveRenderCount = useMemo(() => {
    if (rankedArticles.length === 0) {
      return 0
    }

    const minimumForActive = effectiveActiveIndex + SCROLL_REVEAL_THRESHOLD + 1
    return Math.min(
      Math.max(renderCount, SCROLL_INITIAL_RENDER_COUNT, minimumForActive),
      rankedArticles.length,
    )
  }, [effectiveActiveIndex, rankedArticles.length, renderCount]),

   effectiveVisibleArticles = useMemo(
    () => rankedArticles.slice(0, effectiveRenderCount),
    [effectiveRenderCount, rankedArticles],
  ),
  ogImages = useFeedImageLoader({
    activeIndex: effectiveActiveIndex,
    visibleArticles: effectiveVisibleArticles,
  })

  useFeedIntersectionObserver({
    containerRef,
    rankedArticles,
    renderCount,
    setActiveArticleId,
    setActiveIndex,
    setRenderCount,
    visibleCount: effectiveVisibleArticles.length,
  })

  return {
    containerRef,
    effectiveActiveIndex,
    effectiveVisibleArticles,
    ogImages,
  }
}

export function FeedView({
  articles: propArticles,
  loading,
  totalCount,
  debugMode = false,
}: FeedViewProps) {
  const { likedIds, toggleLike } = useLikedArticles(),
   { bookmarkIds, toggleBookmark } = useBookmarks(),
   { isFavorite, toggleFavorite } = useFavorites(),
   {
    rankedArticles,
    breakdowns,
    status,
    profile,
    topicsLoaded,
    seedCount,
  } = useScrollPersonalization({
    articles: propArticles,
    enabled: propArticles.length > 0,
    isFavorite,
  })

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null),
   [selectedArticleIndex, setSelectedArticleIndex] = useState<number | null>(null),
   [isArticleModalOpen, setIsArticleModalOpen] = useState(false),
   {
    containerRef,
    effectiveActiveIndex,
    effectiveVisibleArticles,
    ogImages,
   } = useFeedRankingState({ rankedArticles })

  const { scrollToNext, scrollToPrev } = useFeedScrollNavigation({
    activeIndex: effectiveActiveIndex,
    containerRef,
    modalOpen: isArticleModalOpen,
    visibleCount: effectiveVisibleArticles.length,
  })

  const {
    handleArticlePreview,
    handleBookmark,
    handleLike,
    handleModalBookmarkChange,
    handleModalClose,
    handleModalNavigate,
  } = useFeedActionHandlers({
    bookmarkIds,
    rankedArticles,
    selectedArticleIndex,
    toggleLike,
    toggleBookmark,
    setSelectedArticle,
    setSelectedArticleIndex,
    setIsArticleModalOpen,
  })

  return (
    <FeedViewContent
      bookmarkIds={bookmarkIds}
      breakdowns={breakdowns}
      containerRef={containerRef}
      debugMode={debugMode}
      effectiveActiveIndex={effectiveActiveIndex}
      effectiveVisibleArticles={effectiveVisibleArticles}
      isArticleModalOpen={isArticleModalOpen}
      isFavorite={isFavorite}
      likedIds={likedIds}
      loading={loading}
      ogImages={ogImages}
      onFavorite={toggleFavorite}
      onLike={handleLike}
      onModalBookmarkChange={handleModalBookmarkChange}
      onModalClose={handleModalClose}
      onModalNavigate={handleModalNavigate}
      onNext={scrollToNext}
      onPrevious={scrollToPrev}
      onPreview={handleArticlePreview}
      onBookmark={(articleId) => void handleBookmark(articleId)}
      profile={profile}
      rankedArticles={rankedArticles}
      seedCount={seedCount}
      selectedArticle={selectedArticle}
      status={status}
      topicsLoaded={topicsLoaded}
      totalCount={totalCount}
    />
  )
}

function FeedViewContent({
  loading,
  effectiveVisibleArticles,
  effectiveActiveIndex,
  rankedArticles,
  breakdowns,
  status,
  profile,
  topicsLoaded,
  seedCount,
  debugMode,
  containerRef,
  ogImages,
  likedIds,
  bookmarkIds,
  isFavorite,
  onPreview,
  onLike,
  onFavorite,
  onBookmark,
  onPrevious,
  onNext,
  totalCount,
  selectedArticle,
  isArticleModalOpen,
  onModalClose,
  onModalBookmarkChange,
  onModalNavigate,
}: FeedViewContentProps) {
  if (loading) {
    return <FeedLoadingState />
  }

  if (effectiveVisibleArticles.length === 0) {
    return <FeedEmptyState />
  }

  const currentBreakdown = breakdowns[effectiveVisibleArticles[effectiveActiveIndex]!.id] ?? null

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
        topKeywords={[...(profile?.topKeywords ?? [])]}
        topClusters={[...(profile?.topClusters ?? [])]}
        debugMode={debugMode}
      />
      <FeedResults
        containerRef={containerRef}
        visibleArticles={effectiveVisibleArticles}
        rankedArticles={rankedArticles}
        breakdown={currentBreakdown}
        ogImages={ogImages}
        likedIds={likedIds}
        bookmarkIds={bookmarkIds}
        isFavorite={isFavorite}
        onPreview={onPreview}
        onLike={onLike}
        onFavorite={onFavorite}
        onBookmark={onBookmark}
        onPrevious={onPrevious}
        onNext={onNext}
        activeIndex={effectiveActiveIndex}
        totalCount={totalCount}
      />
      {isArticleModalOpen && selectedArticle && (
        <ArticleDetailModal
          article={selectedArticle}
          isOpen={isArticleModalOpen}
          onClose={onModalClose}
          onBookmarkChange={onModalBookmarkChange}
          onNavigate={onModalNavigate}
        />
      )}
    </div>
  )
}
