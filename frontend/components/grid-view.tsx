"use client"

import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Clock,
  Newspaper,
  Heart,
  Search,
  PlusCircle,
  MinusCircle,
  Star,
  RefreshCw,
  List,
  Layers,
  ChevronRight,
  ChevronDown,
  Loader2,
} from "lucide-react"
import { ArticleDetailModal } from "./article-detail-modal"

const VirtualizedGrid = lazy(() => import("./virtualized-grid").then(module => ({ default: module.VirtualizedGrid })))

import { TrendingFeed } from "./trending-feed"
import type { NewsArticle, AllCluster } from "@/lib/api"
import { get_logger } from "@/lib/utils"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { useLikedArticles } from "@/hooks/useLikedArticles"
import { useFavorites } from "@/hooks/useFavorites"
import { usePaginatedNews } from "@/hooks/usePaginatedNews"
import { FEATURE_FLAGS } from "@/lib/constants"
import { fetchAllClusters, fetchClusterArticles } from "@/lib/api"

const logger = get_logger("GridView")
const isDev = process.env.NODE_ENV !== "production"

// Responsive article counts per row: mobile=2, tablet=3, desktop=4
// Initial articles shown: mobile=4 (2 rows), tablet=6 (2 rows), desktop=8 (2 rows)
const INITIAL_ARTICLES_MOBILE = 4
const INITIAL_ARTICLES_TABLET = 6
const INITIAL_ARTICLES_DESKTOP = 8

// Columns for cluster grid: mobile=2, tablet=3, desktop=4
const CLUSTER_COLS_MOBILE = 2
const CLUSTER_COLS_TABLET = 3
const CLUSTER_COLS_DESKTOP = 4

  interface GridViewProps {
  articles: NewsArticle[]
  loading: boolean
  onCountChange?: (count: number) => void
  apiUrl?: string | null
  useVirtualization?: boolean
  showTrending?: boolean
  topicSortMode?: "sources" | "articles" | "recent"
  viewMode?: "source" | "topic"
  onViewModeChange?: (mode: "source" | "topic") => void
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
  showTrending = false,
  topicSortMode = "sources",
  viewMode: controlledViewMode,
  onViewModeChange,
}: GridViewProps) {
  const hasRealImage = useCallback((src?: string | null) => {
    if (!src) return false
    const trimmed = src.trim()
    if (!trimmed) return false
    if (trimmed === "none") return false
    const lower = trimmed.toLowerCase()
    return (
      !lower.includes("/placeholder.svg") &&
      !lower.includes("/placeholder.jpg")
    )
  }, [])

  const formatKeywordLabel = useCallback((keywords?: string[]) => {
    if (!keywords || keywords.length === 0) return null
    return keywords
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }, [])

  const normalizeLabel = useCallback((value: string) => {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  }, [])

  const stripTitleSuffix = useCallback((value: string) => {
    return value.split(/\s[-|–—]\s/)[0].trim()
  }, [])

  const getClusterDisplayLabel = useCallback(
    (cluster: AllCluster) => {
      const label = cluster.label?.trim() || ""
      const keywordLabel = formatKeywordLabel(cluster.keywords)
      const titleCandidate = cluster.representative_article?.title
        ? stripTitleSuffix(cluster.representative_article.title)
        : ""
      const normalizedLabel = label ? normalizeLabel(label) : ""
      const normalizedKeywords = keywordLabel ? normalizeLabel(keywordLabel) : ""
      const useTitle =
        titleCandidate &&
        normalizedLabel &&
        normalizedKeywords &&
        normalizedLabel === normalizedKeywords
      if (useTitle) return titleCandidate
      return label || titleCandidate || keywordLabel || "Topic"
    },
    [formatKeywordLabel, normalizeLabel, stripTitleSuffix]
  )

  const [searchTerm, setSearchTerm] = useState("")
  const [viewMode, setViewMode] = useState<"source" | "topic">(
    controlledViewMode ?? "source"
  )
  const [clusters, setClusters] = useState<AllCluster[]>([])
  const [clustersLoading, setClustersLoading] = useState(false)
  const [clusterWindow, setClusterWindow] = useState<"1d" | "1w" | "1m">("1w")
  const [expandedClusterId, setExpandedClusterId] = useState<number | null>(null)
  const [clusterArticlesCache, setClusterArticlesCache] = useState<Map<number, NewsArticle[]>>(new Map())
  const [clusterArticlesLoading, setClusterArticlesLoading] = useState<number | null>(null)
  const [initialArticleCount, setInitialArticleCount] = useState(INITIAL_ARTICLES_DESKTOP)
  // Removed internal category state as it is handled by the parent
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(
    null
  )
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const { likedIds, toggleLike } = useLikedArticles()
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string>>(new Set())
  const [clusterColsPerRow, setClusterColsPerRow] = useState(CLUSTER_COLS_DESKTOP)
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

    const updateResponsiveCounts = () => {
      const width = window.innerWidth
      if (width < 640) {
        setInitialArticleCount(INITIAL_ARTICLES_MOBILE)
        setClusterColsPerRow(CLUSTER_COLS_MOBILE)
      } else if (width < 1024) {
        setInitialArticleCount(INITIAL_ARTICLES_TABLET)
        setClusterColsPerRow(CLUSTER_COLS_TABLET)
      } else {
        setInitialArticleCount(INITIAL_ARTICLES_DESKTOP)
        setClusterColsPerRow(CLUSTER_COLS_DESKTOP)
      }
    }

    updateResponsiveCounts()

    const observer = new ResizeObserver(() => {
      updateResponsiveCounts()
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  // Filter articles based on user selections
  const filteredNews = useMemo(() => {
    if (!searchTerm) return articles

    const result = articles.filter((article: NewsArticle) => {
      const matchesSearch =
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
  }, [articles, searchTerm, isDev])

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
        return "bg-white/5 text-foreground border-white/20"
      case "medium":
        return "bg-white/5 text-foreground/70 border-white/15"
      case "low":
        return "bg-white/5 text-foreground/60 border-white/10"
      default:
        return "bg-white/5 text-muted-foreground border-white/10"
    }
  }

  const getBiasIndicator = (bias: string) => {
    const baseClass = "inline-flex h-2 w-2 rounded-full"
    switch (bias) {
      case "left":
        return <span className={`${baseClass} bg-white/40`} />
      case "right":
        return <span className={`${baseClass} bg-white/70`} />
      case "center":
        return <span className={`${baseClass} bg-white/20`} />
      default:
        return <span className={`${baseClass} bg-white/10`} />
    }
  }

  const handleArticleClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }, [])

  const handleLike = useCallback((articleId: number) => {
    void toggleLike(articleId)
  }, [toggleLike])

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

  const handleExpandCluster = useCallback(async (clusterId: number) => {
    if (expandedClusterId === clusterId) {
      setExpandedClusterId(null)
      return
    }
    
    setExpandedClusterId(clusterId)
    
    if (!clusterArticlesCache.has(clusterId)) {
      setClusterArticlesLoading(clusterId)
      try {
        const articles = await fetchClusterArticles(clusterId)
        setClusterArticlesCache(prev => new Map(prev).set(clusterId, articles))
      } catch (err) {
        logger.error("Failed to fetch cluster articles:", err)
      } finally {
        setClusterArticlesLoading(null)
      }
    }
  }, [expandedClusterId, clusterArticlesCache])

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

  // Load view mode from localStorage
  useEffect(() => {
    if (controlledViewMode) return
    const saved = localStorage.getItem("viewMode") as "source" | "topic" | null
    if (saved === "source" || saved === "topic") {
      setViewMode(saved)
    }
  }, [controlledViewMode])

  // Persist view mode to localStorage
  useEffect(() => {
    if (controlledViewMode) return
    localStorage.setItem("viewMode", viewMode)
  }, [viewMode, controlledViewMode])

  useEffect(() => {
    if (!controlledViewMode) return
    setViewMode(controlledViewMode)
  }, [controlledViewMode])

  // Load clusters when in topic mode
  useEffect(() => {
    if (viewMode === "topic") {
      setClustersLoading(true)
      fetchAllClusters(clusterWindow, 2, 100)
        .then((data) => {
          setClusters(data.clusters)
          setExpandedClusterId(null)
        })
        .catch((err) => {
          logger.error("Failed to load clusters:", err)
        })
        .finally(() => {
          setClustersLoading(false)
        })
    }
  }, [viewMode, clusterWindow])

  const getClusterTime = useCallback((cluster: AllCluster) => {
    const publishedAt = cluster.representative_article?.published_at
    if (!publishedAt) return 0
    const ts = new Date(publishedAt).getTime()
    return Number.isNaN(ts) ? 0 : ts
  }, [])

  const sortedClusters = useMemo(() => {
    const items = [...clusters]
    items.sort((a, b) => {
      if (topicSortMode === "articles") {
        return b.article_count - a.article_count
      }
      if (topicSortMode === "recent") {
        return getClusterTime(b) - getClusterTime(a)
      }
      return b.source_diversity - a.source_diversity
    })
    return items
  }, [clusters, getClusterTime, topicSortMode])

  // Group clusters into rows based on current column count
  const clusterRows = useMemo(() => {
    const rows: AllCluster[][] = []
    for (let i = 0; i < sortedClusters.length; i += clusterColsPerRow) {
      rows.push(sortedClusters.slice(i, i + clusterColsPerRow))
    }
    return rows
  }, [sortedClusters, clusterColsPerRow])

  // Find which row contains the expanded cluster
  const expandedRowIndex = useMemo(() => {
    if (expandedClusterId === null) return -1
    return clusterRows.findIndex(row => 
      row.some(cluster => cluster.cluster_id === expandedClusterId)
    )
  }, [clusterRows, expandedClusterId])

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
        <div className="bg-[var(--news-bg-secondary)]/70 p-8 rounded-none border border-white/10">
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
      <div className="w-full h-full flex flex-col overflow-hidden bg-[var(--news-bg-primary)]">
        {/* Search Bar */}
        <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 py-3 border-b border-white/10 bg-[var(--news-bg-secondary)]/60 backdrop-blur-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search articles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 text-base rounded-none bg-[var(--news-bg-primary)] border border-white/10 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Virtualized Grid */}
        {paginatedArticles.length === 0 && !paginatedLoading ? (
          <div className="text-center py-16 flex-1 flex items-center justify-center">
            <div className="mx-auto">
              <div
                className="mx-auto w-16 h-16 rounded-none flex items-center justify-center mb-4"
                style={{ backgroundColor: "var(--news-bg-secondary)" }}
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
                className="mt-4 border-white/10"
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
          <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
            <VirtualizedGrid
              articles={paginatedArticles}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
              onArticleClick={handleArticleClick}
              totalCount={totalCount}
            />
          </Suspense>
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
    <div className="w-full h-full flex flex-col overflow-hidden bg-[var(--news-bg-primary)]">
      {/* Search Bar */}
      <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 py-3 border-b border-white/10 bg-[var(--news-bg-secondary)]/60 backdrop-blur-sm">
        <div className="flex items-center gap-4 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search articles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 text-base rounded-none bg-[var(--news-bg-primary)] border border-white/10 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {/* View Mode Toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-[var(--news-bg-primary)] border border-white/10 rounded-lg p-1">
              <Button
                variant={viewMode === "source" ? "default" : "ghost"}
                size="sm"
                onClick={() => {
                  setViewMode("source")
                  onViewModeChange?.("source")
                }}
                title="Group by source"
                className={viewMode === "source" ? "" : "text-muted-foreground"}
              >
                <List className="w-4 h-4 mr-2" />
                By Source
              </Button>
              <Button
                variant={viewMode === "topic" ? "default" : "ghost"}
                size="sm"
                onClick={() => {
                  setViewMode("topic")
                  onViewModeChange?.("topic")
                }}
                title="Group by topic"
                className={viewMode === "topic" ? "" : "text-muted-foreground"}
              >
                <Layers className="w-4 h-4 mr-2" />
                By Topic
              </Button>
            </div>
            {viewMode === "topic" && (
              <Select value={clusterWindow} onValueChange={(value) => setClusterWindow(value as "1d" | "1w" | "1m")}>
                <SelectTrigger
                  className="h-8 px-2 text-xs bg-[var(--news-bg-primary)] border border-white/10 rounded-none"
                  title="Topic window"
                >
                  <SelectValue placeholder="Window" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d">Last 24h</SelectItem>
                  <SelectItem value="1w">Last 7d</SelectItem>
                  <SelectItem value="1m">Last 30d</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      {/* Source-Grouped Grid with CSS Snap Scroll */}
      {filteredNews.length === 0 && !loading ? (
        <div className="text-center py-16 flex-1 flex items-center justify-center">
          <div className="mx-auto">
            <div
              className="mx-auto w-16 h-16 rounded-none flex items-center justify-center mb-4"
              style={{ backgroundColor: "var(--news-bg-secondary)" }}
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
              className="mt-4 border-white/10"
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
          <div className="space-y-0">
            {/* Trending Feed Section */}
            {showTrending && (
              <TrendingFeed />
            )}
            {viewMode === "source" ? (
              sourceGroups.map((group, index) => {
              // Optimization: Only render groups near the viewport
              const shouldRender =
                visibleGroupIds.size === 0
                  ? index < 3
                  : visibleGroupIds.has(group.sourceId)
              const isExpanded = expandedSourceId === group.sourceId
              const displayedArticles = isExpanded
                ? group.articles
                : group.articles.slice(0, initialArticleCount)

              return (
                <div
                key={group.sourceId}
                data-source-id={group.sourceId}
                className="grid-source-group bg-[var(--news-bg-secondary)] border border-white/10 overflow-hidden"
                style={{
                  scrollSnapAlign: "start",
                  scrollSnapStop: "always",
                  minHeight: shouldRender ? "auto" : "300px",
                  contentVisibility: "auto",
                  containIntrinsicSize: "360px",
                }}
              >
                {/* Source Header */}
                <div className="bg-[var(--news-bg-primary)] px-5 py-4 border-b border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Newspaper className="w-5 h-5 text-primary" />
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/source/${encodeURIComponent(group.sourceId)}`}
                        className="font-serif text-lg font-bold tracking-tight hover:text-primary transition-colors"
                      >
                        {group.sourceName}
                      </Link>
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
                              ? "fill-current text-foreground"
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

                {/* Articles Vertical Grid */}
                {shouldRender && (
                <div className="p-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {displayedArticles.map((article) => {
                      const showImage = hasRealImage(article.image)

                      return (
                        <div
                          key={article.url ? `url:${article.url}` : `id:${article.id}`}
                          onClick={() => handleArticleClick(article)}
                          className="group w-full text-left transition-colors duration-200 snap-start cursor-pointer"
                        >
                          <Card className="h-full overflow-hidden flex flex-col border border-white/10 bg-[var(--news-bg-secondary)] transition-colors duration-200 group-hover:border-primary/60 cursor-pointer rounded-none shadow-none">
                            {/* Compact Image (or no-image fallback) */}
                            <div className="relative aspect-video overflow-hidden bg-[var(--news-bg-primary)]/40 flex-shrink-0">
                              {showImage ? (
                                <>
                                  <img
                                    src={article.image}
                                    alt={article.title}
                                    className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition duration-300"
                                    loading="lazy"
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                                </>
                              ) : (
                                <>
                                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted/20 to-background" />
                                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.05),transparent_60%)]" />
                                  <div className="absolute inset-0 p-4 flex flex-col items-center justify-center text-center">
                                    <h3 className="text-sm md:text-base font-bold text-foreground/90 leading-snug line-clamp-4 font-serif tracking-tight drop-shadow-sm">
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
                                    <MinusCircle className="w-3 h-3 text-foreground/70" />
                                  ) : (
                                    <PlusCircle className="w-3 h-3 text-foreground" />
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
                                      likedIds.has(article.id as number)
                                        ? "fill-current text-foreground"
                                        : "text-muted-foreground"
                                    }`}
                                  />
                                </Button>
                              </div>

                              {/* Category Badge */}
                              <div className="absolute bottom-2 left-2">
                                <Badge
                                  variant="outline"
                                  className="text-[8px] font-semibold px-1.5 py-0 bg-black/70 text-foreground border-white/20 uppercase tracking-widest"
                                >
                                  {article.category}
                                </Badge>
                              </div>
                            </div>

                            {/* Content */}
                            <CardContent className="flex-1 flex flex-col p-4">
                              {/* Title - Only show here if image is present */}
                              {showImage && (
                                <>
                                  <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2 mb-2 font-serif">
                                    {article.title}
                                  </h3>
                                  <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2 mb-2">
                                    {article.summary}
                                  </p>
                                </>
                              )}

                              {/* Extra context when there's no image */}
                              {!showImage && (
                                <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-3 mb-2">
                                  {article.summary}
                                </p>
                              )}

                              {/* Meta Info */}
                              <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-auto pt-2 border-t border-white/10">
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
                         </div>
                       )
                    })}
                  </div>
                  {group.articles.length > initialArticleCount && (
                    <div className="mt-3 flex justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setExpandedSourceId(isExpanded ? null : group.sourceId)
                        }
                        className="text-xs border-white/10 bg-transparent"
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
              )
            })
            ) : (
              clustersLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading topics...
                </div>
              ) : clusters.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No topics found
                </div>
              ) : (
                <div className="space-y-0">
                  {clusterRows.map((row, rowIndex) => {
                    const isExpandedRow = rowIndex === expandedRowIndex
                    const expandedCluster = isExpandedRow 
                      ? row.find(c => c.cluster_id === expandedClusterId)
                      : null
                    const cachedArticles = expandedCluster 
                      ? clusterArticlesCache.get(expandedCluster.cluster_id)
                      : null
                    const isLoadingArticles = expandedCluster 
                      ? clusterArticlesLoading === expandedCluster.cluster_id
                      : false

                    return (
                      <div key={`row-${rowIndex}`}>
                        {/* Cluster Cards Row */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-3">
                          {row.map((cluster) => {
                            const representative = cluster.representative_article
                            if (!representative) return null
                            
                            const isThisExpanded = expandedClusterId === cluster.cluster_id
                            const showImage = hasRealImage(representative.image_url)
                            const displayLabel = getClusterDisplayLabel(cluster)

                            return (
                              <button
                                key={cluster.cluster_id}
                                onClick={() => handleExpandCluster(cluster.cluster_id)}
                                className={`group w-full text-left transition-all duration-200 ${
                                  isThisExpanded 
                                    ? "ring-2 ring-primary" 
                                    : ""
                                }`}
                              >
                                <Card className={`h-full overflow-hidden flex flex-col border bg-[var(--news-bg-secondary)] transition-colors duration-200 cursor-pointer rounded-none shadow-none ${
                                  isThisExpanded 
                                    ? "border-primary" 
                                    : "border-white/10 group-hover:border-primary/60"
                                }`}>
                                  {/* Hero Image */}
                                  <div className="relative aspect-video overflow-hidden bg-[var(--news-bg-primary)]/40 flex-shrink-0">
                                    {showImage ? (
                                      <>
                                        <img
                                          src={representative.image_url!}
                                          alt={representative.title}
                                          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition duration-300"
                                          loading="lazy"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                      </>
                                    ) : (
                                      <>
                                        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted/20 to-background" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <Layers className="w-12 h-12 text-muted-foreground/30" />
                                        </div>
                                      </>
                                    )}
                                    
                                    {/* Expand indicator */}
                                    <div className="absolute top-2 right-2">
                                      {isThisExpanded ? (
                                        <ChevronDown className="w-5 h-5 text-white drop-shadow-lg" />
                                      ) : (
                                        <ChevronRight className="w-5 h-5 text-white/70 group-hover:text-white drop-shadow-lg" />
                                      )}
                                    </div>

                                    {/* Title overlay on image */}
                                    <div className="absolute bottom-0 left-0 right-0 p-3">
                                      <h3 className="font-serif text-sm font-bold text-white leading-snug line-clamp-2 drop-shadow-lg">
                                        {displayLabel}
                                      </h3>
                                    </div>
                                  </div>

                                  {/* Meta Info */}
                                  <CardContent className="p-3 flex items-center justify-between gap-2">
                                    <Badge variant="outline" className="text-[9px] bg-transparent border-white/20">
                                      {cluster.source_diversity} sources
                                    </Badge>
                                    <Badge variant="outline" className="text-[9px] bg-transparent border-white/20">
                                      {cluster.article_count} articles
                                    </Badge>
                                  </CardContent>
                                </Card>
                              </button>
                            )
                          })}
                        </div>

                        {/* Inline Expansion Panel - appears below the row */}
                        {isExpandedRow && expandedCluster && (
                          <div className="mx-3 mb-3 bg-[var(--news-bg-secondary)] border border-primary/50 overflow-hidden">
                            {/* Expansion Header */}
                            <div className="bg-[var(--news-bg-primary)] px-5 py-4 border-b border-white/10 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <Layers className="w-5 h-5 text-primary" />
                                <span className="font-serif text-lg font-bold tracking-tight">
                                  {getClusterDisplayLabel(expandedCluster)}
                                </span>
                                <Badge variant="outline" className="text-[10px] bg-[var(--news-bg-secondary)]">
                                  {expandedCluster.source_diversity} sources
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className="text-[10px] bg-[var(--news-bg-secondary)]">
                                  {expandedCluster.article_count} articles
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setExpandedClusterId(null)}
                                  className="h-8 px-3 text-xs"
                                >
                                  Close
                                </Button>
                              </div>
                            </div>

                            {/* Articles Grid */}
                            <div className="p-3">
                              {isLoadingArticles ? (
                                <div className="flex items-center justify-center py-8">
                                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                  <span className="ml-2 text-sm text-muted-foreground">Loading articles...</span>
                                </div>
                              ) : cachedArticles && cachedArticles.length > 0 ? (
                                <>
                                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {cachedArticles.map((article) => {
                                      const showArticleImage = hasRealImage(article.image)

                                      return (
                                        <button
                                          key={article.url ? `url:${article.url}` : `id:${article.id}`}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleArticleClick(article)
                                          }}
                                          className="group w-full text-left transition-colors duration-200"
                                        >
                                          <Card className="h-full overflow-hidden flex flex-col border border-white/10 bg-[var(--news-bg-secondary)] transition-colors duration-200 group-hover:border-primary/60 cursor-pointer rounded-none shadow-none">
                                            {/* Image */}
                                            <div className="relative aspect-video overflow-hidden bg-[var(--news-bg-primary)]/40 flex-shrink-0">
                                              {showArticleImage ? (
                                                <>
                                                  <img
                                                    src={article.image}
                                                    alt={article.title}
                                                    className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition duration-300"
                                                    loading="lazy"
                                                  />
                                                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                                                </>
                                              ) : (
                                                <>
                                                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted/20 to-background" />
                                                  <div className="absolute inset-0 p-4 flex flex-col items-center justify-center text-center">
                                                    <h3 className="text-sm font-bold text-foreground/90 leading-snug line-clamp-4 font-serif">
                                                      {article.title}
                                                    </h3>
                                                  </div>
                                                </>
                                              )}

                                              {/* Source Badge */}
                                              <div className="absolute top-2 left-2">
                                                <Badge
                                                  variant="outline"
                                                  className="text-[9px] font-semibold px-1.5 py-0 bg-black/70 text-foreground border-white/20"
                                                >
                                                  {article.source}
                                                </Badge>
                                              </div>

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
                                                    <MinusCircle className="w-3 h-3 text-foreground/70" />
                                                  ) : (
                                                    <PlusCircle className="w-3 h-3 text-foreground" />
                                                  )}
                                                </Button>
                                              </div>
                                            </div>

                                            {/* Content */}
                                            <CardContent className="flex-1 flex flex-col p-3">
                                              {showArticleImage && (
                                                <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2 font-serif">
                                                  {article.title}
                                                </h3>
                                              )}
                                              <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-auto pt-2">
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
                                  
                                  {/* Keywords */}
                                  {expandedCluster.keywords.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap mt-4 pt-3 border-t border-white/10">
                                      <span className="text-xs text-muted-foreground">Keywords:</span>
                                      {expandedCluster.keywords.slice(0, 8).map((keyword) => (
                                        <Badge
                                          key={keyword}
                                          variant="outline"
                                          className="text-[10px] bg-[var(--news-bg-secondary)]"
                                        >
                                          {keyword}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                  No articles found for this topic
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Pager UI */}
      <div className="p-2 text-xs text-muted-foreground text-center">
        Use ↑/↓ keys, PageUp/PageDown, mouse wheel or swipe to move between
        {viewMode === "source" ? (
          <>
            sources — {currentGroupIndex + 1} / {sourceGroups.length}
          </>
        ) : (
          <>
            topics — {sortedClusters.length}
          </>
        )}
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
