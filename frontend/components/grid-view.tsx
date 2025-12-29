"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Clock,
  Newspaper,
  Heart,
  Search,
  PlusCircle,
  MinusCircle,
  Star,
  RefreshCw,
  ExternalLink,
  Info,
  ChevronRight,
} from "lucide-react"
import { SourceInfoModal } from "./source-info-modal"
import { ArticleDetailModal } from "./article-detail-modal"
import { VirtualizedGrid } from "./virtualized-grid"
import type { NewsArticle } from "@/lib/api"
import { get_logger } from "@/lib/utils"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { useFavorites } from "@/hooks/useFavorites"
import { usePaginatedNews } from "@/hooks/usePaginatedNews"
import { FEATURE_FLAGS } from "@/lib/constants"

const logger = get_logger("GridView")
const isDev = process.env.NODE_ENV !== "production"

// Virtual grid constants for optimization
const COLUMN_WIDTH = 320
const ROW_HEIGHT = 420
const GAP = 12
const CARD_WIDTH = 280
const NUM_OF_ARTICLES = 20

interface GridViewProps {
  articles: NewsArticle[]
  loading: boolean
  onCountChange?: (count: number) => void
  apiUrl?: string | null
  useVirtualization?: boolean
}

interface SourceGroup {
  sourceId: string
  sourceName: string
  articles: NewsArticle[]
  credibility?: string
  bias?: string
}

export function GridView({
  articles,
  loading,
  onCountChange,
  apiUrl,
  useVirtualization = false,
}: GridViewProps) {
  const hasRealImage = useCallback((src?: string | null) => {
    if (!src) return false
    const trimmed = src.trim()
    if (!trimmed) return false
    const lower = trimmed.toLowerCase()
    return (
      !lower.includes("/placeholder.svg") &&
      !lower.includes("/placeholder.jpg")
    )
  }, [])

  const [searchTerm, setSearchTerm] = useState("")
  // Removed internal category state as it is handled by the parent
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(
    null
  )
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [likedArticles, setLikedArticles] = useState<Set<number>>(new Set())
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string>>(new Set())
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } =
    useReadingQueue()
  const { isFavorite, toggleFavorite } = useFavorites()

  // Paginated news hook for virtualization mode
  const {
    articles: paginatedArticles,
    totalCount,
    isLoading: paginatedLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = usePaginatedNews({
    limit: FEATURE_FLAGS.PAGINATION_PAGE_SIZE,
    search: searchTerm || undefined,
    useCached: true,
    enabled: useVirtualization, // Only enable when virtualization is active
  })

  if (isDev) {
    logger.debug("Feature flags", {
      USE_VIRTUALIZATION: FEATURE_FLAGS.USE_VIRTUALIZATION,
      USE_PAGINATION: FEATURE_FLAGS.USE_PAGINATION,
      PAGINATION_PAGE_SIZE: FEATURE_FLAGS.PAGINATION_PAGE_SIZE,
      useVirtualizationProp: useVirtualization,
    })
  }

  // Snap-scrolling support
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [currentGroupIndex, setCurrentGroupIndex] = useState<number>(0)
  const scrollRafRef = useRef<number | null>(null)
  const [rowSize, setRowSize] = useState<number>(3)

  // Track current group index by scroll position
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      if (scrollRafRef.current !== null) return
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null
      const groups = Array.from(
        container.querySelectorAll<HTMLElement>(".grid-source-group")
      )
      if (groups.length === 0) return

      // Find which group is most centered in viewport
      const containerRect = container.getBoundingClientRect()
      const containerCenter = containerRect.height / 2

      let closestIndex = 0
      let closestDistance = Infinity

      groups.forEach((group, index) => {
        const rect = group.getBoundingClientRect()
        const groupCenter = rect.top - containerRect.top + rect.height / 2
        const distance = Math.abs(groupCenter - containerCenter)
        if (distance < closestDistance) {
          closestDistance = distance
          closestIndex = index
        }
      })

      setCurrentGroupIndex(closestIndex)
      })
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", handleScroll)
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateRowSize = () => {
      const width = container.clientWidth
      const next = Math.max(1, Math.floor((width + GAP) / (CARD_WIDTH + GAP)))
      setRowSize((prev) => (prev === next ? prev : next))
    }

    updateRowSize()

    const observer = new ResizeObserver(() => {
      updateRowSize()
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  // Filter articles based on user selections
  const filteredNews = useMemo(() => {
    const result = articles.filter((article: NewsArticle) => {
      const matchesSearch =
        !searchTerm ||
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.summary?.toLowerCase().includes(searchTerm.toLowerCase())
      
      return matchesSearch
    })
    if (isDev) {
      logger.debug("Filter results", {
        total: articles.length,
        filtered: result.length,
        searchTerm,
      })
    }
    return result
  }, [articles, searchTerm])

  // Notify parent about filtered count
  useEffect(() => {
    try {
      onCountChange?.(filteredNews.length)
    } catch (e) {
      logger.error("Failed to notify parent of count change", e)
    }
  }, [filteredNews.length, onCountChange])

  // Debug logging (controlled by logger feature)
  useEffect(() => {
    logger.debug("Filter state changed", {
      totalArticles: articles.length,
      filteredCount: filteredNews.length,
      filters: {
        searchTerm,
      },
    })
    if (isDev) {
      logger.debug("Render check", {
        articles: articles.length,
        filteredNews: filteredNews.length,
        loading,
      })
    }
  }, [articles.length, filteredNews.length, searchTerm, loading])

  const getCredibilityColor = (credibility: string) => {
    switch (credibility?.toLowerCase()) {
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

  const getBiasIndicator = (bias: string) => {
    const baseClass = "inline-flex h-2 w-2 rounded-full"
    switch (bias) {
      case "left":
        return <span className={`${baseClass} bg-blue-400`} />
      case "right":
        return <span className={`${baseClass} bg-red-400`} />
      case "center":
        return <span className={`${baseClass} bg-neutral-300`} />
      default:
        return <span className={`${baseClass} bg-neutral-600`} />
    }
  }

  const handleArticleClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }, [])

  const handleLike = useCallback((articleId: number) => {
    setLikedArticles((prev) => {
      const next = new Set(prev)
      if (next.has(articleId)) {
        next.delete(articleId)
      } else {
        next.add(articleId)
      }
      return next
    })
  }, [])

  const handleQueueToggle = useCallback(
    (article: NewsArticle) => {
      if (isArticleInQueue(article.url)) {
        removeArticleFromQueue(article.url)
      } else {
        addArticleToQueue(article)
      }
    },
    [isArticleInQueue, removeArticleFromQueue, addArticleToQueue],
  )

  // Group articles by source with deduplication
  const sourceGroups = useMemo(() => {
    const groups = new Map<string, SourceGroup>()
    const seenUrls = new Set<string>() // Track article URLs to prevent duplicates

    filteredNews.forEach((article) => {
      // Skip if we've already seen this article URL
      if (seenUrls.has(article.url)) {
        return
      }
      seenUrls.add(article.url)

      const sourceKey = article.sourceId || article.source
      if (!groups.has(sourceKey)) {
        groups.set(sourceKey, {
          sourceId: sourceKey,
          sourceName: article.source,
          articles: [],
          credibility: article.credibility,
          bias: article.bias,
        })
      }
      groups.get(sourceKey)!.articles.push(article)
    })

    // Convert to array and sort: favorites first, then by article count
    return Array.from(groups.values()).sort((a, b) => {
      const aFav = isFavorite(a.sourceId) ? 1 : 0
      const bFav = isFavorite(b.sourceId) ? 1 : 0

      if (aFav !== bFav) return bFav - aFav // Higher value (favorite) first

      return bFav - aFav || b.articles.length - a.articles.length
    })
  }, [filteredNews, isFavorite])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const groups = Array.from(
      container.querySelectorAll<HTMLElement>(".grid-source-group")
    )
    if (groups.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleGroupIds((prev) => {
          let next = prev
          let changed = false

          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            const sourceId = (entry.target as HTMLElement).dataset.sourceId
            if (!sourceId || prev.has(sourceId)) return
            if (!changed) {
              next = new Set(prev)
              changed = true
            }
            next.add(sourceId)
          })

          return changed ? next : prev
        })
      },
      {
        root: container,
        rootMargin: "800px 0px",
        threshold: 0.1,
      }
    )

    groups.forEach((group) => observer.observe(group))
    return () => observer.disconnect()
  }, [sourceGroups])

  // Determine which articles to display based on mode
  const displayArticles = useVirtualization ? paginatedArticles : filteredNews
  const isLoadingState = useVirtualization ? paginatedLoading : loading
  const displayTotalCount = useVirtualization ? totalCount : filteredNews.length

  if (isDev) {
    logger.debug("Mode check", {
      useVirtualization,
      isLoadingState,
      displayArticlesLength: displayArticles.length,
      paginatedArticlesLength: paginatedArticles.length,
      paginatedLoading,
      filteredNewsLength: filteredNews.length,
      passedLoading: loading,
      passedArticlesLength: articles.length,
      hasNextPage,
      totalCount,
      willShowLoadingSpinner: isLoadingState && displayArticles.length === 0,
    })
  }

  if (isLoadingState && displayArticles.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="bg-card/50 p-8 rounded-xl border border-border/50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading news articles...</p>
          </div>
        </div>
      </div>
    )
  }

  // Virtualized Grid Mode - high performance for large datasets
  if (useVirtualization) {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden bg-background">
        {/* Search Bar */}
        <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 py-3 border-b border-border/30 bg-background/40 backdrop-blur-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search articles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 text-base rounded-lg bg-background/80 border border-border/50 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Virtualized Grid */}
        {paginatedArticles.length === 0 && !paginatedLoading ? (
          <div className="text-center py-16 flex-1 flex items-center justify-center">
            <div className="mx-auto">
              <div
                className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: "var(--background)" }}
              >
                <Newspaper
                  className="w-8 h-8"
                  style={{ color: "var(--muted-foreground)" }}
                />
              </div>
              <h3 className="text-lg font-medium">No articles found</h3>
              <p className="mt-1 max-w-md mx-auto text-sm text-muted-foreground">
                Try adjusting your search to find what you are
                looking for.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setSearchTerm("")
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset search
              </Button>
            </div>
          </div>
        ) : (
          <VirtualizedGrid
            articles={paginatedArticles}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            onArticleClick={handleArticleClick}
            totalCount={totalCount}
          />
        )}

        {/* Article Detail Modal */}
        <ArticleDetailModal
          article={selectedArticle}
          isOpen={isArticleModalOpen}
          onClose={() => {
            setIsArticleModalOpen(false)
            setSelectedArticle(null)
          }}
        />
      </div>
    )
  }

  // Legacy source-grouped mode (default when virtualization is disabled)

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background">
      {/* Search Bar */}
      <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 py-3 border-b border-border/30 bg-background/40 backdrop-blur-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search articles..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 text-base rounded-lg bg-background/80 border border-border/50 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Source-Grouped Grid with CSS Snap Scroll */}
      {filteredNews.length === 0 && !loading ? (
        <div className="text-center py-16 flex-1 flex items-center justify-center">
          <div className="mx-auto">
            <div
              className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: "var(--background)" }}
            >
              <Newspaper
                className="w-8 h-8"
                style={{ color: "var(--muted-foreground)" }}
              />
            </div>
            <h3 className="text-lg font-medium">No articles found</h3>
            <p className="mt-1 max-w-md mx-auto text-sm text-muted-foreground">
              Try adjusting your search to find what you are looking
              for.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setSearchTerm("")
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset search
            </Button>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 overflow-y-scroll px-3 sm:px-4 lg:px-6 py-4 snap-y snap-mandatory"
          style={{
            scrollPaddingTop: "1rem",
            scrollBehavior: "smooth",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div className="space-y-6">
            {sourceGroups.map((group, index) => {
              // Optimization: Only render groups near the viewport
              const shouldRender =
                visibleGroupIds.size === 0
                  ? index < 3
                  : visibleGroupIds.has(group.sourceId)
              const isExpanded = expandedSourceId === group.sourceId
              const displayedArticles = isExpanded
                ? group.articles
                : group.articles.slice(0, NUM_OF_ARTICLES)
              const rows: NewsArticle[][] = []
              const safeRowSize = Math.max(1, rowSize)
              for (let i = 0; i < displayedArticles.length; i += safeRowSize) {
                rows.push(displayedArticles.slice(i, i + safeRowSize))
              }

              return (
              <div
                key={group.sourceId}
                data-source-id={group.sourceId}
                className="grid-source-group bg-card/40 rounded-lg border border-border/50 overflow-hidden"
                style={{
                  scrollSnapAlign: "center",
                  scrollSnapStop: "always",
                  scrollMargin: "2rem",
                  minHeight: shouldRender ? "auto" : "300px",
                  contentVisibility: "auto",
                  containIntrinsicSize: "360px",
                }}
              >
                {/* Source Header */}
                <div className="bg-card/60 px-4 py-3 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Newspaper className="w-5 h-5 text-primary" />
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-md">
                        {group.sourceName}
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleFavorite(group.sourceId)}
                        className="h-6 w-6 p-0"
                        title={
                          isFavorite(group.sourceId)
                            ? "Remove from favorites"
                            : "Add to favorites"
                        }
                      >
                        <Star
                          className={`w-3.5 h-3.5 transition-colors ${
                            isFavorite(group.sourceId)
                              ? "fill-yellow-500 text-yellow-500"
                              : "text-muted-foreground"
                          }`}
                        />
                      </Button>
                    </div>
                    {group.credibility && (
                      <Badge
                        className={`text-[10px] font-semibold px-2 py-0.5 ${getCredibilityColor(
                          group.credibility
                        )}`}
                      >
                        {group.credibility}
                      </Badge>
                    )}
                    {group.bias && (
                      <span className="text-xs" title={`${group.bias} bias`}>
                        {getBiasIndicator(group.bias)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {group.articles.length} articles
                    </span>
                  </div>
                </div>

                {/* Articles Horizontal List (Snap Scroll) */}
                {shouldRender && (
                <div className="p-3">
                  <div
                    className="max-h-[520px] overflow-y-auto pr-1 space-y-4 snap-y snap-mandatory"
                    style={{
                      scrollbarWidth: "thin",
                      WebkitOverflowScrolling: "touch",
                    }}
                    onScroll={(e) => {
                      if (isExpanded) return
                      if (group.articles.length <= NUM_OF_ARTICLES) return

                      const el = e.currentTarget
                      const distanceFromBottom =
                        el.scrollHeight - (el.scrollTop + el.clientHeight)
                      if (distanceFromBottom <= 32) {
                        setExpandedSourceId(group.sourceId)
                      }
                    }}
                  >
                    {rows.map((row, rowIndex) => (
                      <div
                        key={`${group.sourceId}-row-${rowIndex}`}
                        className="grid gap-3 snap-start"
                        style={{
                          gridTemplateColumns: `repeat(${safeRowSize}, minmax(0, 1fr))`,
                          scrollSnapStop: "always",
                        }}
                      >
                        {row.map((article, colIndex) => {
                          const showImage = hasRealImage(article.image)

                          return (
                          <button
                            key={article.url ? `url:${article.url}` : `id:${article.id}`}
                            onClick={() => handleArticleClick(article)}
                            className="w-full text-left transition-all duration-200"
                          >
                            <Card className="h-full overflow-hidden flex flex-col hover:border-primary hover:shadow-lg transition-all duration-200 bg-card/70 hover:bg-card border-border/60 cursor-pointer">
                              {/* Compact Image (or no-image fallback) */}
                              <div className="relative h-40 overflow-hidden bg-muted/40 flex-shrink-0">
                                {showImage ? (
                                  <>
                                    <img
                                      src={article.image}
                                      alt={article.title}
                                      className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
                                      loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                                  </>
                                ) : (
                                  <>
                                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted/20 to-background" />
                                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.05),transparent_60%)]" />
                                    <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center">
                                      <h3 className="text-lg md:text-xl font-semibold text-foreground/90 leading-snug line-clamp-5 font-serif tracking-tight drop-shadow-sm">
                                        {article.title}
                                      </h3>
                                    </div>
                                  </>
                                )}

                                {/* Action Buttons */}
                                <div className="absolute top-1 right-1 flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleQueueToggle(article)
                                    }}
                                    className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
                                  >
                                    {isArticleInQueue(article.url) ? (
                                      <MinusCircle className="w-3 h-3 text-blue-400" />
                                    ) : (
                                      <PlusCircle className="w-3 h-3 text-white" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleQueueToggle(article)
                                    }}
                                    className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
                                  >
                                    <Heart
                                      className={`w-3 h-3 ${
                                        likedArticles.has(article.id as number)
                                          ? "fill-red-500 text-red-500"
                                          : "text-white"
                                      }`}
                                    />
                                  </Button>
                                </div>

                                {/* Category Badge */}
                                <div className="absolute bottom-1 left-1">
                                  <Badge
                                    variant="outline"
                                    className="text-[8px] font-semibold px-1.5 py-0 bg-black/70 text-white border-white/20"
                                  >
                                    {article.category}
                                  </Badge>
                                </div>
                              </div>

                              {/* Content */}
                              <CardContent className="flex-1 flex flex-col p-2">
                                {/* Title - Only show here if image is present */}
                                {showImage && (
                                  <h3 className="text-base font-semibold text-foreground leading-snug line-clamp-3 mb-2 font-serif">
                                    {article.title}
                                  </h3>
                                )}

                                {/* Extra context when there's no image */}
                                {!showImage && (
                                  <p className="text-xs text-muted-foreground line-clamp-6 mb-2 mt-1">
                                    {article.summary}
                                  </p>
                                )}

                                {/* Meta Info */}
                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-auto pt-1">
                                  <Clock className="w-3 h-3" />
                                  <span>
                                    {new Date(article.publishedAt).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </span>
                                </div>
                              </CardContent>
                            </Card>
                          </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                  {group.articles.length > NUM_OF_ARTICLES && (
                    <div className="mt-3 flex justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setExpandedSourceId(isExpanded ? null : group.sourceId)
                        }
                        className="text-xs border-border/60 bg-transparent"
                      >
                        {isExpanded
                          ? "Show fewer"
                          : `View all ${group.articles.length}`}
                      </Button>
                    </div>
                  )}
                </div>
                )}
              </div>
            )})}
          </div>
        </div>
      )}

      {/* Pager UI */}
      <div className="p-2 text-xs text-muted-foreground text-center">
        Use ↑/↓ keys, PageUp/PageDown, mouse wheel or swipe to move between
        sources — {currentGroupIndex + 1} / {sourceGroups.length}
      </div>

      {/* Article Detail Modal */}
      <ArticleDetailModal
        article={selectedArticle}
        isOpen={isArticleModalOpen}
        onClose={() => {
          setIsArticleModalOpen(false)
          setSelectedArticle(null)
        }}
      />
    </div>
  )
}
