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

const INITIAL_ARTICLES_MOBILE = 4
const INITIAL_ARTICLES_TABLET = 6
const INITIAL_ARTICLES_DESKTOP = 8

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
}

function SourceArticleCard({
  article,
  likedIds,
  hasRealImage,
  isArticleInQueue,
  onArticleClick,
  onLike,
  onQueueToggle,
}: SourceArticleCardProps) {
  const showImage = hasRealImage(article.image)

  return (
    <button
      type="button"
      onClick={() => onArticleClick(article)}
      className="group flex h-full min-h-72 w-full flex-col overflow-hidden bg-card text-left transition-all duration-300 ease-out hover:bg-secondary/55"
    >
      <div
        className="relative aspect-video overflow-hidden border-b border-border/60"
      >
        {showImage ? (
          <img
            src={article.image!}
            alt={article.title}
            className="h-full w-full object-cover grayscale transition duration-500 group-hover:scale-105 group-hover:grayscale-0"
            loading="lazy"
          />
        ) : (
          <div className={cn("h-full w-full", article.category === "breaking" ? "editorial-fallback-surface" : "editorial-paper-surface")} />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/20 to-transparent" />

        <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-100 transition-opacity duration-300 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => onQueueToggle(article, event)}
            className="h-8 w-8 rounded-sm border border-border/70 bg-background/70 p-0 text-foreground transition-all duration-300 ease-out hover:bg-background active:scale-95"
            title={isArticleInQueue(article.url) ? "Remove from queue" : "Add to queue"}
          >
            {isArticleInQueue(article.url) ? (
              <MinusCircle className="h-4 w-4 text-foreground/70" />
            ) : (
              <PlusCircle className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => onLike(article.id as number, event)}
            className="h-8 w-8 rounded-sm border border-border/70 bg-background/70 p-0 text-foreground transition-all duration-300 ease-out hover:bg-background active:scale-95"
            title={likedIds.has(article.id as number) ? "Unlike" : "Like"}
          >
            <Heart
              className={cn(
                "h-4 w-4",
                likedIds.has(article.id as number)
                  ? "fill-primary text-primary"
                  : "text-muted-foreground",
              )}
            />
          </Button>
        </div>

        <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2">
          <Badge
            variant={article.category === "breaking" ? "destructive" : "outline"}
            className={cn(
              "px-2 py-1 text-xs uppercase tracking-widest",
              article.category === "breaking"
                ? "rounded-sm"
                : "rounded-sm border-border/70 bg-background/75 text-muted-foreground",
            )}
          >
            {article.category}
          </Badge>
        </div>

      </div>

      <CardContent className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-3 text-xs font-medium uppercase tracking-widest text-accent">
          <span>{article.source}</span>
        </div>
        <h3 className="mb-2 font-serif text-lg leading-tight text-foreground transition-colors duration-300 group-hover:text-primary md:text-xl">
          {article.title}
        </h3>

        <p className="line-clamp-3 text-sm leading-relaxed text-foreground/80">
          {article.summary}
        </p>

        <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-4 text-xs uppercase tracking-widest text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            <span>
              {new Date(article.publishedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <span>Open brief</span>
        </div>
      </CardContent>
    </button>
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
  isScrollMode = false,
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
  const [initialArticleCount, setInitialArticleCount] = useState(INITIAL_ARTICLES_DESKTOP)
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const updateResponsiveCounts = () => {
      const width = window.innerWidth
      if (width < 640) {
        setInitialArticleCount(INITIAL_ARTICLES_MOBILE)
      } else if (width < 1024) {
        setInitialArticleCount(INITIAL_ARTICLES_TABLET)
      } else {
        setInitialArticleCount(INITIAL_ARTICLES_DESKTOP)
      }
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
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary" />
          <p className="font-sans text-muted-foreground">Curating stories...</p>
        </div>
      </div>
    )
  }

  if (useVirtualization) {
    return (
      <div className={cn("flex w-full flex-col bg-background", isScrollMode ? "h-full overflow-hidden" : "") }>
        <div className="sticky top-0 z-10 border-b border-border/70 bg-card">
          <div className="px-4 py-3 sm:px-6 lg:px-8">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search articles..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full border border-border/70 bg-background px-10 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        {paginatedArticles.length === 0 && !paginatedLoading ? (
          <div className="flex flex-1 items-center justify-center py-16 text-center">
            <div>
              <Newspaper className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              <h3 className="font-serif text-2xl text-foreground">No articles found</h3>
            </div>
          </div>
        ) : (
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
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
    <div className={cn("flex w-full flex-col bg-background", isScrollMode ? "h-full overflow-hidden" : "min-h-screen") }>
      <div className="sticky top-0 z-10 border-b border-border/70 bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-2xl">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search intelligence..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full border border-border/70 bg-background px-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex border border-border/70 bg-background p-1">
                <Button
                  variant={viewMode === "source" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setViewMode("source")
                    onViewModeChange?.("source")
                  }}
                  className={cn(
                    "h-8 rounded-sm px-3 text-[11px] uppercase tracking-[0.24em]",
                    viewMode === "source"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground",
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
                    "h-8 rounded-sm px-3 text-[11px] uppercase tracking-[0.24em]",
                    viewMode === "topic"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Layers className="mr-1.5 h-3.5 w-3.5" />
                  By Topic
                </Button>
              </div>

              {viewMode === "topic" && (
                <Select value={clusterWindow} onValueChange={(value) => setClusterWindow(value as "1d" | "1w" | "1m") }>
                  <SelectTrigger className="h-10 border-border/70 bg-background text-xs uppercase tracking-widest">
                    <SelectValue />
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
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto snap-y snap-mandatory"
        style={{ scrollPaddingTop: "1rem", scrollBehavior: "smooth" }}
      >
        <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          {showTrending && <TrendingFeed />}

          {displayArticles.length === 0 && !isLoadingState ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Newspaper className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 font-serif text-2xl text-foreground">No signals detected</h3>
              <p className="max-w-md text-muted-foreground">
                Adjust your search parameters to find relevant intelligence.
              </p>
            </div>
          ) : viewMode === "source" ? (
            sourceGroups.map((group, index) => {
              const shouldRender = visibleGroupIds.size === 0 ? index < 3 : visibleGroupIds.has(group.sourceId)
              const isExpanded = expandedSourceId === group.sourceId
              const displayedArticles = isExpanded ? group.articles : group.articles.slice(0, initialArticleCount)
              const overviewCards = displayedArticles

              return (
                <section
                  key={group.sourceId}
                  data-source-id={group.sourceId}
                  className="source-snap-section source-section-surface grid-source-group snap-start border border-border/70 bg-card"
                  style={{ scrollSnapStop: "always" }}
                >
                  <div className="border-b border-border/70 bg-background/92 px-5 py-5 md:px-6 md:py-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                      <div className="space-y-3">
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">
                          Source dossier
                        </div>
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/source/${encodeURIComponent(group.sourceId)}`}
                            className="font-serif text-3xl leading-none text-foreground transition-colors hover:text-primary md:text-4xl"
                          >
                            {group.sourceName}
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleFavorite(group.sourceId)}
                            className="h-8 w-8 rounded-sm border border-border/70 p-0 text-muted-foreground transition-all duration-300 ease-out hover:border-primary/60 hover:text-primary active:scale-95"
                          >
                            <Star
                              className={cn(
                                "h-4 w-4",
                                isFavorite(group.sourceId)
                                  ? "fill-primary text-primary"
                                  : "text-muted-foreground",
                              )}
                            />
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                        <span className="border border-border/70 bg-card px-3 py-2">{group.articles.length} articles</span>
                        <span className="border border-border/70 bg-card px-3 py-2">{group.credibility ?? "Mixed"} credibility</span>
                        <span className="border border-border/70 bg-card px-3 py-2">{group.bias ?? "Center"} bias</span>
                        <span className="hidden text-foreground/50 lg:inline">Scroll for next source</span>
                      </div>
                    </div>
                  </div>

                  {shouldRender && overviewCards.length > 0 && (
                    <div className="flex flex-col gap-0">
                      <div className="bg-border/70 p-px">
                        <div className="grid gap-px bg-border/70 md:grid-cols-2 xl:grid-cols-3">
                          {overviewCards.map((article) => (
                            <div key={article.url ? `url:${article.url}` : `id:${article.id}`} className="bg-card">
                              <SourceArticleCard
                                article={article}
                                likedIds={likedIds}
                                hasRealImage={hasRealImage}
                                isArticleInQueue={isArticleInQueue}
                                onArticleClick={handleArticleClick}
                                onLike={handleLike}
                                onQueueToggle={handleQueueToggle}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {!isExpanded && group.articles.length > initialArticleCount && (
                        <div className="border-t border-border/70 bg-background/92 px-5 py-3 text-center text-xs uppercase tracking-widest text-muted-foreground">
                          Scroll snaps source to source
                        </div>
                      )}
                    </div>
                  )}

                  {group.articles.length > initialArticleCount && (
                    <div className="border-t border-border/70 bg-background px-5 py-4 text-center md:px-6">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedSourceId(isExpanded ? null : group.sourceId)}
                        className="rounded-sm border-border/70 bg-transparent px-4 text-xs uppercase tracking-widest transition-all duration-300 ease-out active:scale-95"
                      >
                        {isExpanded ? "Show fewer" : `View all ${group.articles.length} stories`}
                      </Button>
                    </div>
                  )}
                </section>
              )
            })
          ) : (
            <div className="space-y-6">
              {clustersLoading ? (
                <div className="py-8 text-center text-xs uppercase tracking-widest text-muted-foreground">
                  Mapping topic clusters...
                </div>
              ) : clusters.length === 0 ? (
                <div className="py-8 text-center text-xs uppercase tracking-widest text-muted-foreground">
                  {clustersStatus === "initializing" ? "Building topics..." : "No topics found"}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                  {clusters.map((cluster) => {
                    const representative = cluster.representative_article
                    if (!representative) return null
                    const imageUrl = pickClusterImageUrl(cluster)
                    const isExpanded = expandedClusterId === cluster.cluster_id

                    return (
                      <div key={cluster.cluster_id} className="border border-border/70 bg-card">
                        <Card
                          onClick={() => handleExpandCluster(cluster)}
                          className={cn(
                            "group h-full cursor-pointer rounded-none border-0 bg-transparent shadow-none",
                            isExpanded ? "bg-card" : "hover:bg-card/95",
                          )}
                        >
                          <div className="relative aspect-video overflow-hidden border-b border-border/70 bg-background/60">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={representative.title}
                                className="h-full w-full object-cover grayscale transition duration-500 group-hover:scale-105 group-hover:grayscale-0"
                              />
                            ) : (
                              <div className="editorial-fallback-surface h-full w-full" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-transparent" />
                            <div className="absolute bottom-3 left-3 right-3">
                              <h3 className="font-serif text-lg leading-tight text-foreground drop-shadow-sm">
                                {cluster.label || representative.title}
                              </h3>
                            </div>
                          </div>
                          <CardContent className="flex items-center justify-between p-4 text-xs uppercase tracking-widest text-muted-foreground">
                            <span>{cluster.source_diversity} sources</span>
                            <span>{cluster.article_count} stories</span>
                          </CardContent>
                        </Card>
                      </div>
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
