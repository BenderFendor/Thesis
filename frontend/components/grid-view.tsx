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
import type { NewsArticle } from "@/lib/api"
import { get_logger } from "@/lib/utils"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { useFavorites } from "@/hooks/useFavorites"

const logger = get_logger("GridView")

const categories = [
  "All",
  "Politics",
  "Economy",
  "Environment",
  "Technology",
  "Education",
  "Healthcare",
  "Energy",
  "Trade",
]

// Virtual grid constants for optimization
const COLUMN_COUNT = 4
const COLUMN_WIDTH = 320
const ROW_HEIGHT = 420  // Increased to prevent card content overlap
const GAP = 12
const ROW_GAP = 16  // Vertical gap between rows
const NUM_OF_ARTICLES = 12
interface GridViewProps {
  articles: NewsArticle[]
  loading: boolean
  onCountChange?: (count: number) => void
  apiUrl?: string | null
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
}: GridViewProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(
    null
  )
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [likedArticles, setLikedArticles] = useState<Set<number>>(new Set())
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } =
    useReadingQueue()
  const { isFavorite, toggleFavorite } = useFavorites()

  // Snap-scrolling support: focusable container and current source index
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [currentGroupIndex, setCurrentGroupIndex] = useState<number>(0)

  const scrollToGroup = useCallback((index: number) => {
    const container = containerRef.current
    if (!container) return
    const groups = Array.from(
      container.querySelectorAll<HTMLElement>(".grid-source-group")
    )
    const safeIndex = Math.max(0, Math.min(index, groups.length - 1))
    const target = groups[safeIndex]
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
      setCurrentGroupIndex(safeIndex)
    }
  }, [])

  const goNextGroup = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const groups = container.querySelectorAll<HTMLElement>(".grid-source-group")
    if (groups.length === 0) return
    const next = Math.min(currentGroupIndex + 1, groups.length - 1)
    if (next !== currentGroupIndex) scrollToGroup(next)
  }, [currentGroupIndex, scrollToGroup])

  const goPrevGroup = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const groups = container.querySelectorAll<HTMLElement>(".grid-source-group")
    if (groups.length === 0) return
    const prev = Math.max(currentGroupIndex - 1, 0)
    if (prev !== currentGroupIndex) scrollToGroup(prev)
  }, [currentGroupIndex, scrollToGroup])

  // Helper to chunk articles into rows of COLUMN_COUNT
  const chunkArticlesIntoRows = useCallback((articles: NewsArticle[]) => {
    const rows: NewsArticle[][] = []
    for (let i = 0; i < articles.length; i += COLUMN_COUNT) {
      rows.push(articles.slice(i, i + COLUMN_COUNT))
    }
    return rows
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onKey = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl && /INPUT|TEXTAREA|SELECT/.test(activeEl.tagName)) return
      switch (e.key) {
        case 'ArrowDown':
        case 'PageDown':
          e.preventDefault()
          goNextGroup()
          break
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault()
          goPrevGroup()
          break
        case 'Home':
          e.preventDefault()
          scrollToGroup(0)
          break
        case 'End':
          e.preventDefault()
          {
            const groups = container.querySelectorAll<HTMLElement>('.grid-source-group')
            scrollToGroup(groups.length - 1)
          }
          break
        default:
          break
      }
    }

    let wheelTimeout: ReturnType<typeof setTimeout> | null = null
    const onWheel = (ev: WheelEvent) => {
      if (Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return
      ev.preventDefault()

      if (wheelTimeout) {
        clearTimeout(wheelTimeout)
      }

      const jumpSize = Math.max(1, Math.floor(Math.abs(ev.deltaY) / 100))
      const direction = ev.deltaY > 0 ? 1 : -1
      const targetIndex = currentGroupIndex + direction * jumpSize

      wheelTimeout = setTimeout(() => {
        scrollToGroup(targetIndex)
      }, 50) // A short debounce to prevent chaotic rapid-fire calls
    }

    let startY = 0
    let startTime = 0
    const onTouchStart = (ev: TouchEvent) => {
      startY = ev.touches[0].clientY
      startTime = Date.now()
    }
    const onTouchEnd = (ev: TouchEvent) => {
      const endY = ev.changedTouches[0].clientY
      const endTime = Date.now()
      const deltaY = startY - endY
      const duration = endTime - startTime

      if (Math.abs(deltaY) < 50) return // Ignore small movements

      const velocity = Math.abs(deltaY / duration)
      const jumpSize = Math.max(1, Math.round(velocity * 2)) // Velocity multiplier

      const direction = deltaY > 0 ? 1 : -1
      const targetIndex = currentGroupIndex + direction * jumpSize
      scrollToGroup(targetIndex)
    }

    container.addEventListener('keydown', onKey)
    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('keydown', onKey)
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchend', onTouchEnd)
      if (wheelTimeout) clearTimeout(wheelTimeout)
    }
  }, [goNextGroup, goPrevGroup, scrollToGroup])

  // Observe groups to update currentGroupIndex on manual scroll/snap
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let observer: IntersectionObserver | null = null
    const groups = Array.from(container.querySelectorAll<HTMLElement>('.grid-source-group'))
    if (groups.length > 0 && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const index = groups.indexOf(entry.target as HTMLElement)
              if (index >= 0) setCurrentGroupIndex(index)
            }
          })
        },
        { root: container, threshold: 0.6 }
      )
      groups.forEach((g) => observer!.observe(g))
    }
    return () => {
      if (observer) observer.disconnect()
    }
  }, [articles])

  // Filter articles based on user selections
  const filteredNews = useMemo(() => {
    const result = articles.filter((article: NewsArticle) => {
      const matchesSearch =
        !searchTerm ||
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.summary?.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCategory =
        selectedCategory === "All" || article.category?.toLowerCase() === selectedCategory.toLowerCase()

      return matchesSearch && matchesCategory
    })
    console.log(`🔍 GridView filter: ${articles.length} articles → ${result.length} after filtering (searchTerm="${searchTerm}", selectedCategory="${selectedCategory}")`)
    return result
  }, [articles, searchTerm, selectedCategory])

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
        selectedCategory,
      },
    })
    console.log(`🎬 GridView render check: articles=${articles.length}, filteredNews=${filteredNews.length}, loading=${loading}`)
  }, [articles.length, filteredNews.length, searchTerm, selectedCategory, loading])

  const getCredibilityColor = (credibility: string) => {
    switch (credibility?.toLowerCase()) {
      case "high":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      case "medium":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
      case "low":
        return "bg-red-500/20 text-red-400 border-red-500/30"
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30"
    }
  }

  const getBiasIndicator = (bias: string) => {
    switch (bias) {
      case "left":
        return "🔵"
      case "right":
        return "🔴"
      case "center":
        return "⚪"
      default:
        return "⚫"
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

    // Convert to array and sort by number of articles
    return Array.from(groups.values()).sort(
      (a, b) => b.articles.length - a.articles.length
    )
  }, [filteredNews])

  if (loading) {
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

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background">
      {/* Category Filter Header - Now below nav/top bar */}
      <div className="flex-shrink-0 border-b border-border/30 bg-background/40 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {categories.map((category) => (
            <Button
              key={category}
              onClick={() => setSelectedCategory(category)}
              variant={selectedCategory === category ? 'default' : 'outline'}
              className="text-sm font-medium whitespace-nowrap px-3 py-2 h-auto"
            >
              {category}
            </Button>
          ))}
        </div>
        <div className="text-sm text-muted-foreground mt-2">
          Showing {filteredNews.length} articles from {sourceGroups.length}{" "}
          sources
        </div>
      </div>

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

      {/* Source-Grouped Grid */}
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
              Try adjusting your search or filters to find what you are looking
              for.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setSearchTerm("")
                setSelectedCategory("All")
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset filters
            </Button>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          tabIndex={0}
          role="region"
          aria-label="Sources scroller"
          className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 py-4"
          style={{ outline: 'none' }}
        >
          <div className="space-y-6">
            {sourceGroups.map((group) => (
              <div
                key={group.sourceId}
                className="grid-source-group bg-card/40 rounded-lg border border-border/50 overflow-hidden scroll-mt-4"
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
                      {expandedSourceId === group.sourceId
                        ? group.articles.length
                        : Math.min(NUM_OF_ARTICLES, group.articles.length)}{" "}
                      of {group.articles.length} articles
                    </span>
                    {group.articles.length > NUM_OF_ARTICLES && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs hover:text-primary"
                        onClick={() =>
                          setExpandedSourceId(
                            expandedSourceId === group.sourceId
                              ? null
                              : group.sourceId
                          )
                        }
                      >
                        {expandedSourceId === group.sourceId
                          ? "Show less"
                          : "View all"}
                        <ChevronRight
                          className={`w-3 h-3 ml-1 transition-transform ${
                            expandedSourceId === group.sourceId
                              ? "rotate-90"
                              : ""
                          }`}
                        />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Articles Grid */}
                <div className="p-3">
                  {expandedSourceId === group.sourceId &&
                  group.articles.length > NUM_OF_ARTICLES ? (
                    <div
                      className="inner-snap-container"
                      style={{
                        maxHeight: '60vh',
                        overflowY: 'auto',
                        scrollSnapType: 'y mandatory',
                        WebkitOverflowScrolling: 'touch',
                      }}
                    >
                      {chunkArticlesIntoRows(group.articles).map(
                        (row, rowIndex) => (
                          <div
                            key={rowIndex}
                            className="snap-start"
                            style={{ scrollSnapAlign: 'start' }}
                          >
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-2">
                              {row.map((article) => (
                                <button
                                  key={article.id}
                                  onClick={() => handleArticleClick(article)}
                                  className="group text-left transition-all duration-200"
                                >
                                  <Card className="h-full overflow-hidden flex flex-col hover:border-primary hover:shadow-lg transition-all duration-200 bg-card/70 hover:bg-card border-border/60 cursor-pointer">
                                    <div className="relative h-40 overflow-hidden bg-muted/40 flex-shrink-0">
                                      <img
                                        src={
                                          article.image || '/placeholder.svg'
                                        }
                                        alt={article.title}
                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                                      />
                                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
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
                                            handleLike(article.id as number)
                                          }}
                                          className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
                                        >
                                          <Heart
                                            className={`w-3 h-3 ${
                                              likedArticles.has(
                                                article.id as number
                                              )
                                                ? 'fill-red-500 text-red-500'
                                                : 'text-white'
                                            }`}
                                          />
                                        </Button>
                                      </div>
                                      <div className="absolute bottom-1 left-1">
                                        <Badge
                                          variant="outline"
                                          className="text-[8px] font-semibold px-1.5 py-0 bg-black/70 text-white border-white/20"
                                        >
                                          {article.category}
                                        </Badge>
                                      </div>
                                    </div>
                                    <CardContent className="flex-1 flex flex-col p-2">
                                      <h3 className="text-md font-semibold text-foreground leading-snug line-clamp-4 mb-1 font-serif">
                                        {article.title}
                                      </h3>
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-auto pt-1">
                                        <Clock className="w-3 h-3" />
                                        <span>
                                          {new Date(
                                            article.publishedAt
                                          ).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                          })}
                                        </span>
                                      </div>
                                    </CardContent>
                                  </Card>
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {group.articles
                        .slice(
                          0,
                          expandedSourceId === group.sourceId
                            ? group.articles.length
                            : NUM_OF_ARTICLES
                        )
                        .map((article) => (
                          <button
                            key={article.id}
                            onClick={() => handleArticleClick(article)}
                            className="group text-left transition-all duration-200"
                          >
                            <Card className="h-full overflow-hidden flex flex-col hover:border-primary hover:shadow-lg transition-all duration-200 bg-card/70 hover:bg-card border-border/60 cursor-pointer">
                              {/* Compact Image */}
                              <div className="relative h-40 overflow-hidden bg-muted/40 flex-shrink-0">
                                <img
                                  src={article.image || '/placeholder.svg'}
                                  alt={article.title}
                                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

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
                                      handleLike(article.id as number)
                                    }}
                                    className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
                                  >
                                    <Heart
                                      className={`w-3 h-3 ${
                                        likedArticles.has(article.id as number)
                                          ? 'fill-red-500 text-red-500'
                                          : 'text-white'
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
                                {/* Title */}
                                <h3 className="text-md font-semibold text-foreground leading-snug line-clamp-4 mb-1 font-serif">
                                  {article.title}
                                </h3>

                                {/* Meta Info */}
                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-auto pt-1">
                                  <Clock className="w-3 h-3" />
                                  <span>
                                    {new Date(
                                      article.publishedAt
                                    ).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                                  </span>
                                </div>
                              </CardContent>
                            </Card>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
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
