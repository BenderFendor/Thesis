"use client"

import {
  Fragment,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
  type KeyboardEvent,
  type MouseEvent,
} from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CardContent } from "@/components/ui/card"
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
  List,
  Layers,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { ArticleDetailModal } from "./article-detail-modal"
import { ClusterDetailModal } from "./cluster-detail-modal"
import { TrendingFeed } from "./trending-feed"
import type { NewsArticle, AllCluster, TrendingCluster } from "@/lib/api"
import { get_logger, cn } from "@/lib/utils"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { useLikedArticles } from "@/hooks/useLikedArticles"
import { useFavorites } from "@/hooks/useFavorites"
import {
  clusterArticlesToNewsArticles,
  getClusterPreviewStats,
  hasRealClusterImage,
  pickClusterImageUrl,
} from "@/lib/cluster-display"
import {
  buildSourceGroups,
  getCollapsedVisibleArticleCount,
  getVisibleSourceIds,
} from "@/lib/source-groups"
import { fetchAllClusters, fetchClusterArticles } from "@/lib/api"

const VirtualizedGrid = lazy(() =>
  import("./virtualized-grid").then((module) => ({
    default: module.VirtualizedGrid,
  })),
)

const logger = get_logger("GridView")
const SOURCE_GROUP_BATCH_SIZE = 10
const COLLAPSED_SOURCE_ARTICLE_COUNT = 20

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
  isScrollMode?: boolean
  totalCount?: number
}

interface SourceArticleCardProps {
  article: NewsArticle
  likedIds: Set<number>
  hasRealImage: (src?: string | null) => boolean
  isArticleInQueue: (url: string) => boolean
  onArticleClick: (article: NewsArticle) => void
  onLike: (articleId: number, event?: MouseEvent<HTMLButtonElement>) => void
  onQueueToggle: (article: NewsArticle, event?: MouseEvent<HTMLButtonElement>) => void
  index: number
}

function SourceArticleCard({
  article,
  likedIds,
  hasRealImage,
  isArticleInQueue,
  onArticleClick,
  onLike,
  onQueueToggle,
  index,
}: SourceArticleCardProps) {
  const showImage = hasRealImage(article.image)

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onArticleClick(article)
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.05, ease: [0.25, 0.1, 0.25, 1.0] }}
      role="button"
      tabIndex={0}
      onClick={() => onArticleClick(article)}
      onKeyDown={handleCardKeyDown}
      className="group flex h-full min-h-80 w-full flex-col overflow-hidden rounded-2xl border border-white/5 bg-black/20 text-left shadow-xl transition-all duration-500 ease-out hover:border-white/10 hover:bg-white/[0.03] hover:shadow-2xl"
    >
      <div className="relative m-2 aspect-video overflow-hidden rounded-xl bg-white/5">
        {showImage ? (
          <img
            src={article.image ?? undefined}
            alt={article.title}
            className="h-full w-full object-cover grayscale transition duration-700 group-hover:scale-105 group-hover:grayscale-0"
            loading="lazy"
          />
        ) : (
          <div
            className={cn(
              "h-full w-full opacity-50 transition duration-700 group-hover:scale-105",
              article.category === "breaking" ? "editorial-fallback-surface" : "editorial-paper-surface",
            )}
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="absolute right-3 top-3 z-10 flex translate-y-[-10px] gap-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => onQueueToggle(article, event)}
            className="h-8 w-8 rounded-full bg-black/40 p-0 text-white backdrop-blur-md transition-all duration-300 hover:bg-white hover:text-black active:scale-95"
            title={isArticleInQueue(article.url) ? "Remove from queue" : "Add to queue"}
          >
            {isArticleInQueue(article.url) ? (
              <MinusCircle className="h-4 w-4" />
            ) : (
              <PlusCircle className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => onLike(article.id as number, event)}
            className="h-8 w-8 rounded-full bg-black/40 p-0 text-white backdrop-blur-md transition-all duration-300 hover:bg-white hover:text-black active:scale-95"
            title={likedIds.has(article.id as number) ? "Unlike" : "Like"}
          >
            <Heart
              className={cn(
                "h-4 w-4 transition-colors",
                likedIds.has(article.id as number)
                  ? "fill-red-500 text-red-500 hover:text-red-600"
                  : "text-white",
              )}
            />
          </Button>
        </div>

        <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2">
          <Badge
            variant={article.category === "breaking" ? "destructive" : "outline"}
            className={cn(
              "rounded-md border-0 px-2 py-0.5 text-xs font-medium uppercase tracking-widest backdrop-blur-md",
              article.category === "breaking"
                ? "bg-red-500/90 text-white shadow-lg"
                : "bg-black/50 text-white/90",
            )}
          >
            {article.category}
          </Badge>
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col p-5 pt-4">
        <div className="mb-3 flex items-center text-xs font-semibold uppercase tracking-widest text-primary/80">
          <span>{article.source}</span>
        </div>
        <h3 className="mb-3 font-serif text-lg font-medium leading-snug text-foreground/90 transition-colors duration-300 group-hover:text-white md:text-xl">
          {article.title}
        </h3>

        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground/80">{article.summary}</p>

        <div className="mt-auto flex items-center justify-between pt-5 text-xs uppercase tracking-widest text-muted-foreground/60 transition-opacity duration-300 group-hover:text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3" />
            <span>
              {new Date(article.publishedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <span className="text-primary/0 transition-colors duration-300 group-hover:text-primary">
            Open brief -&gt;
          </span>
        </div>
      </CardContent>
    </motion.article>
  )
}

export function GridView({
  articles,
  loading,
  onCountChange,
  apiUrl: _apiUrl,
  useVirtualization = false,
  showTrending = true,
  topicSortMode = "sources",
  viewMode: controlledViewMode,
  onViewModeChange,
  isScrollMode: _isScrollMode = false,
  totalCount,
}: GridViewProps) {
  void _apiUrl
  void _isScrollMode

  const hasRealImage = useCallback((src?: string | null) => hasRealClusterImage(src), [])

  const [searchTerm, setSearchTerm] = useState("")
  const [viewMode, setViewMode] = useState<"source" | "topic">(controlledViewMode ?? "source")
  const [clusters, setClusters] = useState<AllCluster[]>([])
  const [clustersLoading, setClustersLoading] = useState(false)
  const [clustersStatus, setClustersStatus] = useState<string | null>(null)
  const [clusterWindow, setClusterWindow] = useState<"1d" | "1w" | "1m">("1w")
  const [expandedClusterId, setExpandedClusterId] = useState<number | null>(null)
  const [clusterArticlesCache, setClusterArticlesCache] = useState<Map<number, NewsArticle[]>>(new Map())
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [selectedCluster, setSelectedCluster] = useState<TrendingCluster | null>(null)
  const [isClusterModalOpen, setIsClusterModalOpen] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const { likedIds, toggleLike } = useLikedArticles()
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue()
  const { isFavorite, toggleFavorite } = useFavorites()
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [sourceBatchCount, setSourceBatchCount] = useState(1)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const resetSourceBrowseState = useCallback(() => {
    setSourceBatchCount(1)
    setExpandedSourceId(null)
  }, [])

  const formatKeywordLabel = useCallback((keywords?: string[]) => {
    if (!keywords || keywords.length === 0) return null
    return keywords.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
  }, [])

  const normalizeLabel = useCallback((value: string) => {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  }, [])

  const stripTitleSuffix = useCallback((value: string) => {
    return value.split(/\s[-|\u2013\u2014]\s/)[0].trim()
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
    [formatKeywordLabel, normalizeLabel, stripTitleSuffix],
  )

  const filteredNews = useMemo(() => {
    if (!searchTerm) return articles
    return articles.filter(
      (article) =>
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.summary?.toLowerCase().includes(searchTerm.toLowerCase()),
    )
  }, [articles, searchTerm])

  const displayArticles = filteredNews
  const isLoadingState = loading
  const resolvedTotalCount = totalCount ?? filteredNews.length

  useEffect(() => {
    onCountChange?.(filteredNews.length)
  }, [filteredNews.length, onCountChange])

  useEffect(() => {
    if (controlledViewMode) {
      setViewMode(controlledViewMode)
      return
    }

    const saved = localStorage.getItem("viewMode") as "source" | "topic" | null
    if (saved === "source" || saved === "topic") {
      setViewMode(saved)
    }
  }, [controlledViewMode])

  useEffect(() => {
    if (controlledViewMode) return
    localStorage.setItem("viewMode", viewMode)
  }, [viewMode, controlledViewMode])

  const handleArticleClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }, [])

  const handleLike = useCallback(
    (articleId: number, event?: MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation()
      void toggleLike(articleId)
    },
    [toggleLike],
  )

  const handleQueueToggle = useCallback(
    (article: NewsArticle, event?: MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation()
      if (isArticleInQueue(article.url)) {
        removeArticleFromQueue(article.url)
      } else {
        addArticleToQueue(article)
      }
    },
    [isArticleInQueue, removeArticleFromQueue, addArticleToQueue],
  )

  const sourceGroups = useMemo(() => {
    return buildSourceGroups(filteredNews).sort((a, b) => {
      const aFav = isFavorite(a.sourceId) ? 1 : 0
      const bFav = isFavorite(b.sourceId) ? 1 : 0
      if (aFav !== bFav) return bFav - aFav

      return 0
    })
  }, [filteredNews, isFavorite])

  const sortedSourceIds = useMemo(
    () => sourceGroups.map((group) => group.sourceId),
    [sourceGroups],
  )

  const visibleSourceIds = useMemo(() => {
    if (viewMode !== "source") return new Set<string>()

    return getVisibleSourceIds(
      sourceGroups,
      new Set(sourceGroups.filter((group) => isFavorite(group.sourceId)).map((group) => group.sourceId)),
      sourceBatchCount,
      SOURCE_GROUP_BATCH_SIZE,
    )
  }, [isFavorite, sourceBatchCount, sourceGroups, viewMode])

  const hasMoreSourceGroups = useMemo(() => {
    if (viewMode !== "source") return false
    return visibleSourceIds.size < sortedSourceIds.length
  }, [sortedSourceIds.length, viewMode, visibleSourceIds.size])

  const visibleSourceGroups = useMemo(
    () => sourceGroups.filter((group) => visibleSourceIds.has(group.sourceId)),
    [sourceGroups, visibleSourceIds],
  )

  const collapsedVisibleArticleCount = useMemo(
    () =>
      getCollapsedVisibleArticleCount(
        sourceGroups,
        visibleSourceIds,
        COLLAPSED_SOURCE_ARTICLE_COUNT,
      ),
    [sourceGroups, visibleSourceIds],
  )

  useEffect(() => {
    if (viewMode !== "source") return
    onCountChange?.(collapsedVisibleArticleCount)
  }, [collapsedVisibleArticleCount, onCountChange, viewMode])

  useEffect(() => {
    setSourceBatchCount((prev) => {
      if (viewMode !== "source") return prev
      const favoriteCount = sourceGroups.filter((group) => isFavorite(group.sourceId)).length
      const minimumVisible = favoriteCount + SOURCE_GROUP_BATCH_SIZE
      const currentlyVisible = favoriteCount + prev * SOURCE_GROUP_BATCH_SIZE
      if (currentlyVisible >= minimumVisible) return prev
      return 1
    })
  }, [isFavorite, sourceGroups, viewMode])

  useEffect(() => {
    if (viewMode !== "topic") return
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const loadClusters = async () => {
      setClustersLoading(true)
      try {
        const data = await fetchAllClusters(clusterWindow, 2, 100)
        if (cancelled) return
        setClusters(data.clusters)
        setClustersStatus(data.status ?? null)
        setExpandedClusterId(null)

        if (data.status === "initializing") {
          retryTimer = setTimeout(() => {
            void loadClusters()
          }, 15000)
        }
      } catch (err) {
        if (!cancelled) {
          logger.error("Failed to load clusters:", err)
        }
      } finally {
        if (!cancelled) setClustersLoading(false)
      }
    }

    void loadClusters()
    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [viewMode, clusterWindow])

  const getClusterTime = useCallback((cluster: AllCluster) => {
    const publishedAt = cluster.representative_article?.published_at
    if (!publishedAt) return 0
    const timestamp = new Date(publishedAt).getTime()
    return Number.isNaN(timestamp) ? 0 : timestamp
  }, [])

  const clusterTimes = useMemo(() => {
    const times = new Map<number, number>()
    for (const cluster of clusters) {
      times.set(cluster.cluster_id, getClusterTime(cluster))
    }
    return times
  }, [clusters, getClusterTime])

  const sortedClusters = useMemo(() => {
    const items = [...clusters]
    items.sort((a, b) => {
      if (topicSortMode === "articles") {
        return b.article_count - a.article_count
      }
      if (topicSortMode === "recent") {
        return (clusterTimes.get(b.cluster_id) ?? 0) - (clusterTimes.get(a.cluster_id) ?? 0)
      }
      return b.source_diversity - a.source_diversity
    })
    return items
  }, [clusterTimes, clusters, topicSortMode])

  const handleExpandCluster = useCallback(
    async (cluster: AllCluster) => {
      const clusterId = cluster.cluster_id
      if (expandedClusterId === clusterId) {
        setExpandedClusterId(null)
        return
      }

      const section = document.querySelector<HTMLElement>(
        `[data-cluster-id="${clusterId}"]`,
      )
      setExpandedClusterId(clusterId)
      window.setTimeout(() => {
        section?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 0)
      if (!clusterArticlesCache.has(clusterId) || clusterArticlesCache.get(clusterId)?.length === 0) {
        const previewArticles = clusterArticlesToNewsArticles(cluster.articles)
        setClusterArticlesCache((prev) => new Map(prev).set(clusterId, previewArticles))

        try {
          const fullArticles = await fetchClusterArticles(clusterId)
          setClusterArticlesCache((prev) => new Map(prev).set(clusterId, fullArticles))
        } catch (error) {
          logger.warn("Failed to load full topic cluster articles", {
            clusterId,
            error,
          })
        }
      }
    },
    [expandedClusterId, clusterArticlesCache],
  )

  const expandedCluster = useMemo(() => {
    if (expandedClusterId === null) return null
    return sortedClusters.find((cluster) => cluster.cluster_id === expandedClusterId) ?? null
  }, [sortedClusters, expandedClusterId])

  const expandedClusterArticles = useMemo(() => {
    if (!expandedCluster) return []
    return clusterArticlesCache.get(expandedCluster.cluster_id) ?? []
  }, [clusterArticlesCache, expandedCluster])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      setShowScrollTop(container.scrollTop > 640)
    }

    handleScroll()
    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  const handleOpenClusterCompare = useCallback(
    (cluster: AllCluster, event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      setSelectedCluster({
        ...cluster,
        trending_score: cluster.source_diversity,
        velocity: cluster.window_count,
        articles: cluster.articles ?? [],
      })
      setIsClusterModalOpen(true)
    },
    [],
  )

  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  if (isLoadingState && displayArticles.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background" style={{ minHeight: "calc(100vh - 140px)" }}>
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary/50" />
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Curating stories...</p>
        </div>
      </div>
    )
  }

  if (useVirtualization) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="sticky top-0 z-10 border-b border-white/5 bg-background/80 backdrop-blur-xl">
          <div className="px-4 py-3 sm:px-6 lg:px-8">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search articles..."
                value={searchTerm}
                onChange={(event) => {
                  resetSourceBrowseState()
                  setSearchTerm(event.target.value)
                }}
                className="w-full rounded-xl bg-white/5 px-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
        </div>

        {displayArticles.length === 0 && !isLoadingState ? (
          <div className="flex flex-1 items-center justify-center py-16 text-center">
            <div>
              <Newspaper className="mx-auto mb-4 h-10 w-10 text-muted-foreground/30" />
              <h3 className="font-serif text-2xl text-foreground/50">No articles found</h3>
            </div>
          </div>
        ) : (
          <Suspense fallback={<Skeleton className="h-96 w-full opacity-20" />}>
            <VirtualizedGrid
              articles={displayArticles}
              hasNextPage={false}
              isFetchingNextPage={false}
              fetchNextPage={() => {}}
              onArticleClick={handleArticleClick}
              totalCount={resolvedTotalCount}
            />
          </Suspense>
        )}

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

  return (
    <div className="relative flex w-full flex-col overflow-hidden bg-background" style={{ height: "calc(100vh - 140px)" }}>
      <div className="sticky top-0 z-40 shrink-0 border-b border-white/5 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full flex-col gap-4 px-6 py-4 lg:px-8" style={{ maxWidth: "1800px" }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-xl">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <input
                type="text"
                placeholder="Search the news..."
                value={searchTerm}
                onChange={(event) => {
                  resetSourceBrowseState()
                  setSearchTerm(event.target.value)
                }}
                className="w-full rounded-xl bg-white/5 px-10 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex w-full sm:w-auto rounded-lg border border-white/5 bg-white/5 p-1">
                <Button
                  variant={viewMode === "source" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    resetSourceBrowseState()
                    setViewMode("source")
                    onViewModeChange?.("source")
                  }}
                  className={cn(
                    "flex-1 sm:flex-none h-7 rounded-md px-2 sm:px-3 text-[10px] sm:text-xs uppercase tracking-widest transition-all",
                    viewMode === "source"
                      ? "bg-white/10 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <List className="mr-1.5 h-3.5 w-3.5" />
                  By Source
                </Button>
                <Button
                  variant={viewMode === "topic" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    resetSourceBrowseState()
                    setViewMode("topic")
                    onViewModeChange?.("topic")
                  }}
                  className={cn(
                    "flex-1 sm:flex-none h-7 rounded-md px-2 sm:px-3 text-[10px] sm:text-xs uppercase tracking-widest transition-all",
                    viewMode === "topic"
                      ? "bg-white/10 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Layers className="mr-1.5 h-3.5 w-3.5" />
                  By Topic
                </Button>
              </div>

              {viewMode === "topic" && (
                <Select value={clusterWindow} onValueChange={(value) => setClusterWindow(value as "1d" | "1w" | "1m")}>
                  <SelectTrigger className="h-9 rounded-lg border-white/5 bg-white/5 text-xs uppercase tracking-widest">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg border-white/10 bg-background/95 backdrop-blur-xl">
                    <SelectItem value="1d" className="text-xs uppercase tracking-widest">
                      Last 24h
                    </SelectItem>
                    <SelectItem value="1w" className="text-xs uppercase tracking-widest">
                      Last 7d
                    </SelectItem>
                    <SelectItem value="1m" className="text-xs uppercase tracking-widest">
                      Last 30d
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto scroll-smooth pb-24"
      >
        <div className="mx-auto flex w-full flex-col gap-16 px-6 py-8 lg:px-8" style={{ maxWidth: "1800px" }}>
          {showTrending && <TrendingFeed />}

          {displayArticles.length === 0 && !isLoadingState ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-32 text-center">
              <Newspaper className="mb-6 h-16 w-16 text-white/10" />
              <h3 className="mb-2 font-serif text-3xl text-foreground/80">No signals detected</h3>
              <p className="max-w-md text-sm text-muted-foreground/60">
                Adjust your search parameters to find relevant intelligence.
              </p>
            </motion.div>
          ) : viewMode === "source" ? (
            visibleSourceGroups.map((group, index) => {
              const isExpanded = expandedSourceId === group.sourceId
              const displayedArticles = isExpanded
                ? group.articles
                : group.articles.slice(0, COLLAPSED_SOURCE_ARTICLE_COUNT)

              return (
                <section
                  key={group.sourceId}
                  data-source-id={group.sourceId}
                  className="grid-source-group flex flex-col"
                >
                  <div className="mb-4 sm:mb-6 flex flex-col gap-3 sm:gap-4 border-b border-white/5 pb-3 sm:pb-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-2 sm:space-y-3">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <Link
                          href={`/source/${encodeURIComponent(group.sourceId)}`}
                          className="font-serif text-4xl leading-none text-foreground transition-colors hover:text-primary sm:text-4xl md:text-5xl"
                        >
                          {group.sourceName}
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleFavorite(group.sourceId)}
                          className="h-10 w-10 sm:h-9 sm:w-9 rounded-full bg-white/5 p-0 text-muted-foreground transition-all duration-300 hover:bg-white/10 hover:text-primary active:scale-95 shrink-0"
                        >
                          <Star
                            className={cn(
                              "h-5 w-5 sm:h-4 sm:w-4",
                              isFavorite(group.sourceId)
                                ? "fill-amber-400 text-amber-400"
                                : "text-white/40",
                            )}
                          />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 sm:px-3 sm:py-1.5 font-medium text-white/80">
                        {group.articles.length} articles
                      </span>
                      {group.credibility && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 sm:px-3 sm:py-1.5 font-medium text-white/80">
                          {group.credibility} credibility
                        </span>
                      )}
                      {group.bias && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 sm:px-3 sm:py-1.5 font-medium text-white/80">
                          {group.bias} bias
                        </span>
                      )}
                    </div>
                  </div>

                  {displayedArticles.length > 0 && (
                    <div className="flex-1">
                      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                        <AnimatePresence>
                          {displayedArticles.map((article, itemIndex) => (
                            <SourceArticleCard
                              key={article.url ? `url:${article.url}` : `id:${article.id}`}
                              article={article}
                              index={itemIndex}
                              likedIds={likedIds}
                              hasRealImage={hasRealImage}
                              isArticleInQueue={isArticleInQueue}
                              onArticleClick={handleArticleClick}
                              onLike={handleLike}
                              onQueueToggle={handleQueueToggle}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}

                  {group.articles.length > COLLAPSED_SOURCE_ARTICLE_COUNT && (
                    <div className="mt-8 flex justify-center pb-8">
                      <Button
                        variant="outline"
                        onClick={() => setExpandedSourceId(isExpanded ? null : group.sourceId)}
                        className="rounded-full border-white/10 bg-transparent px-8 py-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-all duration-300 hover:bg-white/5 hover:text-white"
                      >
                        {isExpanded ? "Show fewer stories" : `View all ${group.articles.length} stories`}
                      </Button>
                    </div>
                  )}
                </section>
              )
            })
          ) : (
            <div className="space-y-6">
              {clustersLoading ? (
                <div className="py-24 text-center text-xs uppercase tracking-widest text-muted-foreground">
                  <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary/40" />
                  Mapping topic clusters...
                </div>
              ) : clusters.length === 0 ? (
                <div className="py-24 text-center text-xs uppercase tracking-widest text-muted-foreground">
                  {clustersStatus === "initializing" ? "Building topics..." : "No topics found"}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {sortedClusters.map((cluster, index) => {
                      const representative = cluster.representative_article
                      if (!representative) return null

                      const imageUrl = pickClusterImageUrl(cluster)
                      const isExpanded = expandedClusterId === cluster.cluster_id
                      const previewStats = getClusterPreviewStats(cluster)

                      return (
                        <Fragment key={cluster.cluster_id}>
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.05 }}
                            data-cluster-id={cluster.cluster_id}
                            className={cn(
                              "group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-black/20 transition-all duration-500 hover:bg-white/[0.03] scroll-mt-6",
                              isExpanded ? "border-primary/50 ring-1 ring-primary/40" : "border-white/5",
                            )}
                            
                            onClick={() => handleExpandCluster(cluster)}
                          >
                            <div className="relative m-2 aspect-video overflow-hidden rounded-xl bg-white/5">
                              {imageUrl ? (
                                <img
                                  src={imageUrl}
                                  alt={representative.title}
                                  className="h-full w-full object-cover grayscale transition duration-700 group-hover:scale-105 group-hover:grayscale-0"
                                />
                              ) : (
                                <div className="editorial-fallback-surface h-full w-full opacity-50 transition duration-700 group-hover:scale-105" />
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                              <div className="absolute right-4 top-4 z-10 text-white drop-shadow-md">
                                {isExpanded ? (
                                  <ChevronDown className="h-5 w-5" />
                                ) : (
                                  <ChevronRight className="h-5 w-5 text-white/75 group-hover:text-white" />
                                )}
                              </div>
                              <div className="absolute left-4 top-4 z-10">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(event) => handleOpenClusterCompare(cluster, event)}
                                  className="h-8 rounded-full bg-black/50 px-3 text-xs uppercase tracking-widest text-white backdrop-blur hover:bg-black/70"
                                >
                                  Compare
                                </Button>
                              </div>
                              <div className="absolute bottom-4 left-4 right-4">
                                <h3 className="font-serif text-xl font-medium leading-snug text-white drop-shadow-md">
                                  {getClusterDisplayLabel(cluster)}
                                </h3>
                              </div>
                            </div>
                            <CardContent className="flex items-center justify-between p-5 pt-3 text-xs uppercase tracking-widest text-muted-foreground/70">
                              <span className="flex items-center gap-2">
                                <Newspaper className="h-3.5 w-3.5 text-primary/70" /> {previewStats.sourceCount} sources
                              </span>
                              <span className="flex items-center gap-2">
                                <List className="h-3.5 w-3.5 text-primary/70" /> {previewStats.articleCount} stories
                              </span>
                            </CardContent>
                          </motion.div>

                          {isExpanded && expandedCluster && (
                            <div
                              data-cluster-expanded-for={cluster.cluster_id}
                              className="col-span-full overflow-hidden rounded-2xl border border-primary/30 bg-black/20"
                            >
                              <div className="flex flex-col gap-4 border-b border-white/10 bg-black/30 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                                <div className="flex flex-wrap items-center gap-3">
                                  <Layers className="h-5 w-5 text-primary" />
                                  <h3 className="font-serif text-2xl text-foreground">
                                    {getClusterDisplayLabel(expandedCluster)}
                                  </h3>
                                  <Badge
                                    variant="outline"
                                    className="border-white/10 bg-white/5 text-xs uppercase tracking-widest text-muted-foreground"
                                  >
                                    {getClusterPreviewStats(expandedCluster).sourceCount} sources
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="border-white/10 bg-white/5 text-xs uppercase tracking-widest text-muted-foreground"
                                  >
                                    {getClusterPreviewStats(expandedCluster).articleCount} stories
                                  </Badge>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setExpandedClusterId(null)
                                  }}
                                  className="w-fit rounded-full border border-white/10 bg-transparent px-4 text-xs uppercase tracking-widest text-muted-foreground hover:bg-white/5 hover:text-white"
                                >
                                  Close topic
                                </Button>
                              </div>

                              <div className="space-y-6 px-6 py-6">
                                {expandedClusterArticles.length > 0 ? (
                                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {expandedClusterArticles.map((article, index) => (
                                      <SourceArticleCard
                                        key={article.url ? `cluster-url:${article.url}` : `cluster-id:${article.id}`}
                                        article={article}
                                        index={index}
                                        likedIds={likedIds}
                                        hasRealImage={hasRealImage}
                                        isArticleInQueue={isArticleInQueue}
                                        onArticleClick={handleArticleClick}
                                        onLike={handleLike}
                                        onQueueToggle={handleQueueToggle}
                                      />
                                    ))}
                                  </div>
                                ) : (
                                  <div className="py-12 text-center text-xs uppercase tracking-widest text-muted-foreground">
                                    No articles found for this topic
                                  </div>
                                )}

                                {expandedCluster.keywords.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                                    <span className="text-xs uppercase tracking-widest text-muted-foreground">Keywords</span>
                                    {expandedCluster.keywords.slice(0, 8).map((keyword) => (
                                      <Badge
                                        key={keyword}
                                        variant="outline"
                                        className="border-white/10 bg-white/5 text-xs uppercase tracking-widest text-muted-foreground"
                                      >
                                        {keyword}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {!useVirtualization && viewMode === "source" && hasMoreSourceGroups && (
            <div className="flex justify-center pb-8">
              <Button
                        variant="outline"
                        onClick={() => setSourceBatchCount((prev) => prev + 1)}
                        className="rounded-full border-white/10 bg-transparent px-8 py-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-all duration-300 hover:bg-white/5 hover:text-white disabled:opacity-60"
                      >
                        {`Load 10 more sources (${visibleSourceIds.size}/${sortedSourceIds.length})`}
                      </Button>
                    </div>
                  )}
        </div>
      </div>

      <ArticleDetailModal
        article={selectedArticle}
        isOpen={isArticleModalOpen}
        onClose={() => {
          setIsArticleModalOpen(false)
          setSelectedArticle(null)
        }}
      />
      {showScrollTop && (
        <Button
          type="button"
          size="icon"
          onClick={scrollToTop}
          className="absolute bottom-8 right-8 z-40 h-12 w-12 rounded-full border border-white/10 bg-background/85 shadow-xl backdrop-blur"
        >
          <ChevronUp className="h-5 w-5" />
        </Button>
      )}
      <ClusterDetailModal
        cluster={selectedCluster}
        isBreaking={false}
        isOpen={isClusterModalOpen}
        onClose={() => {
          setIsClusterModalOpen(false)
          setSelectedCluster(null)
        }}
      />
    </div>
  )
}
