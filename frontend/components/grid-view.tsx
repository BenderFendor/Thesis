"use client"

import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
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
  Loader2,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { ArticleDetailModal } from "./article-detail-modal"
import { TrendingFeed } from "./trending-feed"
import type { NewsArticle, AllCluster } from "@/lib/api"
import { get_logger, cn } from "@/lib/utils"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { useLikedArticles } from "@/hooks/useLikedArticles"
import { useFavorites } from "@/hooks/useFavorites"
import { usePaginatedNews } from "@/hooks/usePaginatedNews"
import { FEATURE_FLAGS } from "@/lib/constants"
import {
  clusterArticlesToNewsArticles,
  hasRealClusterImage,
  pickClusterImageUrl,
} from "@/lib/cluster-display"
import { fetchAllClusters } from "@/lib/api"

const VirtualizedGrid = lazy(() =>
  import("./virtualized-grid").then((module) => ({
    default: module.VirtualizedGrid,
  })),
)

const logger = get_logger("GridView")

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
}

interface SourceGroup {
  sourceId: string
  sourceName: string
  articles: NewsArticle[]
  credibility?: string
  bias?: string
}

interface SourceArticleCardProps {
  article: NewsArticle
  likedIds: Set<number>
  hasRealImage: (src?: string | null) => boolean
  isArticleInQueue: (url: string) => boolean
  onArticleClick: (article: NewsArticle) => void
  onLike: (articleId: number, event?: React.MouseEvent) => void
  onQueueToggle: (article: NewsArticle, event?: React.MouseEvent) => void
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

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.05, ease: [0.25, 0.1, 0.25, 1.0] }}
      type="button"
      onClick={() => onArticleClick(article)}
      className="group flex h-full min-h-80 w-full flex-col overflow-hidden text-left transition-all duration-500 ease-out bg-black/20 hover:bg-white/[0.03] border border-white/5 rounded-2xl shadow-xl hover:shadow-2xl hover:border-white/10"
    >
      <div className="relative aspect-video overflow-hidden m-2 rounded-xl bg-white/5">
        {showImage ? (
          <img
            src={article.image!}
            alt={article.title}
            className="h-full w-full object-cover grayscale transition duration-700 group-hover:scale-105 group-hover:grayscale-0"
            loading="lazy"
          />
        ) : (
          <div className={cn("h-full w-full opacity-50 transition duration-700 group-hover:scale-105", article.category === "breaking" ? "editorial-fallback-surface" : "editorial-paper-surface")} />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-0 transition-all duration-300 md:group-hover:opacity-100 md:group-focus-within:opacity-100 translate-y-[-10px] group-hover:translate-y-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => onQueueToggle(article, event)}
            className="h-8 w-8 rounded-full bg-black/40 backdrop-blur-md p-0 text-white transition-all duration-300 hover:bg-white hover:text-black active:scale-95"
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
            className="h-8 w-8 rounded-full bg-black/40 backdrop-blur-md p-0 text-white transition-all duration-300 hover:bg-white hover:text-black active:scale-95"
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
              "px-2 py-0.5 text-xs uppercase tracking-widest rounded-md backdrop-blur-md font-medium border-0",
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
        <h3 className="mb-3 font-serif text-lg md:text-xl font-medium leading-snug text-foreground/90 transition-colors duration-300 group-hover:text-white">
          {article.title}
        </h3>

        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground/80">
          {article.summary}
        </p>

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
          <span className="text-primary/0 transition-colors duration-300 group-hover:text-primary">Open brief →</span>
        </div>
      </CardContent>
    </motion.button>
  )
}

export function GridView({
  articles,
  loading,
  onCountChange,
  apiUrl: _apiUrl,
  useVirtualization = false,
  showTrending = true,
  topicSortMode: _topicSortMode = "sources",
  viewMode: controlledViewMode,
  onViewModeChange,
  isScrollMode: _isScrollMode = false,
}: GridViewProps) {
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
  const { likedIds, toggleLike } = useLikedArticles()
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue()
  const { isFavorite, toggleFavorite } = useFavorites()
  const [initialArticleCount, setInitialArticleCount] = useState(9) // Fallback 3x3
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Determine dynamic columns and set rows to 3
  useEffect(() => {
    const updateResponsiveCounts = () => {
      const width = window.innerWidth
      let cols = 1
      if (width >= 1536) cols = 5 // 2xl
      else if (width >= 1280) cols = 4 // xl
      else if (width >= 1024) cols = 3 // lg
      else if (width >= 640) cols = 2 // sm
      
      setInitialArticleCount(cols * 3) // 3 rows
    }

    updateResponsiveCounts()
    window.addEventListener("resize", updateResponsiveCounts)
    return () => window.removeEventListener("resize", updateResponsiveCounts)
  }, [])

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
    enabled: useVirtualization,
  })

  const filteredNews = useMemo(() => {
    if (!searchTerm) return articles
    return articles.filter(
      (article) =>
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.summary?.toLowerCase().includes(searchTerm.toLowerCase()),
    )
  }, [articles, searchTerm])

  useEffect(() => {
    onCountChange?.(filteredNews.length)
  }, [filteredNews.length, onCountChange])

  const handleArticleClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }, [])

  const handleLike = useCallback(
    (articleId: number, event?: React.MouseEvent) => {
      event?.stopPropagation()
      void toggleLike(articleId)
    },
    [toggleLike],
  )

  const handleQueueToggle = useCallback(
    (article: NewsArticle, event?: React.MouseEvent) => {
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
    const groups = new Map<string, SourceGroup>()
    const seenUrls = new Set<string>()

    filteredNews.forEach((article) => {
      if (seenUrls.has(article.url)) return
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
      groups.get(sourceKey)?.articles.push(article)
    })

    return Array.from(groups.values()).sort((a, b) => {
      const aFav = isFavorite(a.sourceId) ? 1 : 0
      const bFav = isFavorite(b.sourceId) ? 1 : 0
      if (aFav !== bFav) return bFav - aFav
      return b.articles.length - a.articles.length
    })
  }, [filteredNews, isFavorite])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

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
      { root: container, rootMargin: "800px 0px", threshold: 0.1 },
    )

    const groups = container.querySelectorAll(".grid-source-group")
    groups.forEach((group) => observer.observe(group))
    return () => observer.disconnect()
  }, [sourceGroups])

  useEffect(() => {
    if (viewMode !== "topic") return
    let cancelled = false

    const loadClusters = async () => {
      setClustersLoading(true)
      try {
        const data = await fetchAllClusters(clusterWindow, 2, 100)
        if (cancelled) return
        setClusters(data.clusters)
        setClustersStatus(data.status ?? null)
      } catch (err) {
        logger.error("Failed to load clusters:", err)
      } finally {
        if (!cancelled) setClustersLoading(false)
      }
    }

    void loadClusters()
    return () => {
      cancelled = true
    }
  }, [viewMode, clusterWindow])

  const handleExpandCluster = useCallback(
    (cluster: AllCluster) => {
      const clusterId = cluster.cluster_id
      if (expandedClusterId === clusterId) {
        setExpandedClusterId(null)
        return
      }

      setExpandedClusterId(clusterId)
      if (!clusterArticlesCache.has(clusterId)) {
        const clusterArticles = clusterArticlesToNewsArticles(cluster.articles)
        setClusterArticlesCache((prev) => new Map(prev).set(clusterId, clusterArticles))
      }
    },
    [expandedClusterId, clusterArticlesCache],
  )

  const displayArticles = useVirtualization ? paginatedArticles : filteredNews
  const isLoadingState = useVirtualization ? paginatedLoading : loading

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
      <div className="flex w-full flex-col bg-background h-full overflow-hidden">
        <div className="sticky top-0 z-10 border-b border-white/5 bg-background/80 backdrop-blur-xl">
          <div className="px-4 py-3 sm:px-6 lg:px-8">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search articles..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-xl bg-white/5 px-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
        </div>

        {paginatedArticles.length === 0 && !paginatedLoading ? (
          <div className="flex flex-1 items-center justify-center py-16 text-center">
            <div>
              <Newspaper className="mx-auto mb-4 h-10 w-10 text-muted-foreground/30" />
              <h3 className="font-serif text-2xl text-foreground/50">No articles found</h3>
            </div>
          </div>
        ) : (
          <Suspense fallback={<Skeleton className="h-96 w-full opacity-20" />}>
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
    <div className="flex w-full flex-col bg-background relative overflow-hidden" style={{ height: "calc(100vh - 140px)" }}>
      <div className="sticky top-0 z-40 border-b border-white/5 bg-background/80 backdrop-blur-xl shrink-0">
        <div className="mx-auto flex w-full flex-col gap-4 px-6 py-4 lg:px-8" style={{ maxWidth: "1800px" }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-xl">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <input
                type="text"
                placeholder="Search intelligence..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-xl bg-white/5 px-10 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg bg-white/5 p-1 border border-white/5">
                <Button
                  variant={viewMode === "source" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setViewMode("source")
                    onViewModeChange?.("source")
                  }}
                  className={cn(
                    "h-7 rounded-md px-3 text-xs uppercase tracking-widest transition-all",
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
                    setViewMode("topic")
                    onViewModeChange?.("topic")
                  }}
                  className={cn(
                    "h-7 rounded-md px-3 text-xs uppercase tracking-widest transition-all",
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
                <Select value={clusterWindow} onValueChange={(value) => setClusterWindow(value as "1d" | "1w" | "1m") }>
                  <SelectTrigger className="h-9 rounded-lg border-white/5 bg-white/5 text-xs uppercase tracking-widest">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg border-white/10 bg-background/95 backdrop-blur-xl">
                    <SelectItem value="1d" className="text-xs uppercase tracking-widest">Last 24h</SelectItem>
                    <SelectItem value="1w" className="text-xs uppercase tracking-widest">Last 7d</SelectItem>
                    <SelectItem value="1m" className="text-xs uppercase tracking-widest">Last 30d</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto snap-y snap-mandatory scroll-smooth pb-24"
        style={{ scrollPaddingTop: "1rem" }}
      >
        <div className="mx-auto flex w-full flex-col gap-16 px-6 py-8 lg:px-8" style={{ maxWidth: "1800px" }}>
          {showTrending && <TrendingFeed />}

          {displayArticles.length === 0 && !isLoadingState ? (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="flex flex-col items-center justify-center py-32 text-center"
            >
              <Newspaper className="mb-6 h-16 w-16 text-white/10" />
              <h3 className="mb-2 font-serif text-3xl text-foreground/80">No signals detected</h3>
              <p className="max-w-md text-sm text-muted-foreground/60">
                Adjust your search parameters to find relevant intelligence.
              </p>
            </motion.div>
          ) : viewMode === "source" ? (
            sourceGroups.map((group, index) => {
              const shouldRender = visibleGroupIds.size === 0 ? index < 3 : visibleGroupIds.has(group.sourceId)
              const isExpanded = expandedSourceId === group.sourceId
              const displayedArticles = isExpanded ? group.articles : group.articles.slice(0, initialArticleCount)

              return (
                <section
                  key={group.sourceId}
                  data-source-id={group.sourceId}
                  className="grid-source-group snap-start scroll-mt-6 flex flex-col"
                  style={{ scrollSnapStop: "normal", minHeight: "calc(100vh - 160px)" }}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-6 pb-4 border-b border-white/5">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-widest text-primary/70">
                        Source dossier
                      </div>
                      <div className="flex items-center gap-4">
                        <Link
                          href={`/source/${encodeURIComponent(group.sourceId)}`}
                          className="font-serif text-4xl leading-none text-foreground transition-colors hover:text-primary md:text-5xl"
                        >
                          {group.sourceName}
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleFavorite(group.sourceId)}
                          className="h-9 w-9 rounded-full bg-white/5 p-0 text-muted-foreground transition-all duration-300 hover:bg-white/10 hover:text-primary active:scale-95"
                        >
                          <Star
                            className={cn(
                              "h-4 w-4",
                              isFavorite(group.sourceId)
                                ? "fill-amber-400 text-amber-400"
                                : "text-white/40",
                            )}
                          />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                      <span className="rounded-full bg-white/5 px-3 py-1.5 font-medium border border-white/5 text-white/80">{group.articles.length} articles</span>
                      <span className="rounded-full bg-white/5 px-3 py-1.5 font-medium border border-white/5">{group.credibility ?? "Mixed"} credibility</span>
                      <span className="rounded-full bg-white/5 px-3 py-1.5 font-medium border border-white/5">{group.bias ?? "Center"} bias</span>
                    </div>
                  </div>

                  {shouldRender && displayedArticles.length > 0 && (
                    <div className="flex-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                        <AnimatePresence>
                          {displayedArticles.map((article, i) => (
                            <SourceArticleCard
                              key={article.url ? `url:${article.url}` : `id:${article.id}`}
                              article={article}
                              index={i}
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

                  {group.articles.length > initialArticleCount && (
                    <div className="mt-8 flex justify-center pb-8">
                      <Button
                        variant="outline"
                        onClick={() => setExpandedSourceId(isExpanded ? null : group.sourceId)}
                        className="rounded-full border-white/10 bg-transparent px-8 py-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:bg-white/5 hover:text-white transition-all duration-300"
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {clusters.map((cluster, i) => {
                    const representative = cluster.representative_article
                    if (!representative) return null
                    const imageUrl = pickClusterImageUrl(cluster)

                    return (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                        key={cluster.cluster_id} 
                        className="group flex flex-col rounded-2xl border border-white/5 bg-black/20 hover:bg-white/[0.03] transition-all duration-500 overflow-hidden cursor-pointer snap-start scroll-mt-6"
                        style={{ scrollSnapStop: "normal" }}
                        onClick={() => handleExpandCluster(cluster)}
                      >
                        <div className="relative aspect-video overflow-hidden m-2 rounded-xl bg-white/5">
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
                          <div className="absolute bottom-4 left-4 right-4">
                            <h3 className="font-serif text-xl font-medium leading-snug text-white drop-shadow-md">
                              {cluster.label || representative.title}
                            </h3>
                          </div>
                        </div>
                        <CardContent className="flex items-center justify-between p-5 pt-3 text-xs uppercase tracking-widest text-muted-foreground/70">
                          <span className="flex items-center gap-2"><Newspaper className="h-3.5 w-3.5 text-primary/70" /> {cluster.source_diversity} sources</span>
                          <span className="flex items-center gap-2"><List className="h-3.5 w-3.5 text-primary/70" /> {cluster.article_count} stories</span>
                        </CardContent>
                      </motion.div>
                    )
                  })}
                </div>
              )}
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
    </div>
  )
}
