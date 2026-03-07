const fs = require('fs');

const code = `"use client"

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

const logger = get_logger("GridView")

const INITIAL_ARTICLES_MOBILE = 4
const INITIAL_ARTICLES_TABLET = 6
const INITIAL_ARTICLES_DESKTOP = 8
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
  isScrollMode?: boolean
}

interface SourceGroup {
  sourceId: string
  sourceName: string
  articles: NewsArticle[]
  credibility?: string
  bias?: string
}

function SourceArticleCard({
  article,
  likedIds,
  hasRealImage,
  isArticleInQueue,
  onArticleClick,
  onLike,
  onQueueToggle,
}: {
  article: NewsArticle
  likedIds: Set<number>
  hasRealImage: (src?: string | null) => boolean
  isArticleInQueue: (url: string) => boolean
  onArticleClick: (article: NewsArticle) => void
  onLike: (articleId: number, e: React.MouseEvent) => void
  onQueueToggle: (article: NewsArticle, e: React.MouseEvent) => void
}) {
  const showImage = hasRealImage(article.image)

  return (
    <div
      onClick={() => onArticleClick(article)}
      className="group w-full text-left transition-colors duration-200 cursor-pointer h-full"
    >
      <Card className="h-full overflow-hidden flex flex-col border border-border bg-[var(--news-bg-secondary)] transition-colors duration-200 group-hover:border-primary/60 rounded-none shadow-none relative">
        <div className="relative aspect-video overflow-hidden bg-[var(--news-bg-primary)]/40 flex-shrink-0">
          {showImage ? (
            <>
              <img
                src={article.image!}
                alt={article.title}
                className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition duration-300"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted/20 to-background" />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                <Newspaper className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <h3 className="font-serif text-base leading-snug text-foreground/80 line-clamp-3 tracking-tight">
                  {article.title}
                </h3>
              </div>
            </>
          )}

          <div className="absolute top-2 right-2 flex gap-1 z-10">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => onQueueToggle(article, e)}
              className="h-7 w-7 p-0 bg-black/60 hover:bg-black/80 rounded-sm"
              title={isArticleInQueue(article.url) ? "Remove from queue" : "Add to queue"}
            >
              {isArticleInQueue(article.url) ? (
                <MinusCircle className="h-3.5 w-3.5 text-foreground/70" />
              ) : (
                <PlusCircle className="h-3.5 w-3.5 text-foreground" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => onLike(article.id as number, e)}
              className="h-7 w-7 p-0 bg-black/60 hover:bg-black/80 rounded-sm"
              title={likedIds.has(article.id as number) ? "Unlike" : "Like"}
            >
              <Heart
                className={\`h-3.5 w-3.5 \${
                  likedIds.has(article.id as number) ? "fill-current text-foreground" : "text-muted-foreground"
                }\`}
              />
            </Button>
          </div>
        </div>

        <CardContent className="flex-1 flex flex-col p-5">
          {showImage && (
            <h3 className="text-base font-bold text-foreground leading-snug line-clamp-3 mb-2 font-serif group-hover:text-primary transition-colors">
              {article.title}
            </h3>
          )}
          <p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2 mb-3">
            {article.summary}
          </p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-auto pt-3 border-t border-border/50">
            <Clock className="w-3 h-3" />
            <span>{new Date(article.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            {article.category && (
              <span className="ml-auto uppercase tracking-widest text-[9px] font-semibold text-muted-foreground">
                {article.category}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function GridView({
  articles,
  loading,
  onCountChange,
  apiUrl,
  useVirtualization = false,
  showTrending = true,
  topicSortMode = "sources",
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
  const [clusterColsPerRow, setClusterColsPerRow] = useState(CLUSTER_COLS_DESKTOP)
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string>>(new Set())

  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
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
    return articles.filter(article => 
      article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      article.summary?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [articles, searchTerm])

  useEffect(() => {
    onCountChange?.(filteredNews.length)
  }, [filteredNews.length, onCountChange])

  const handleArticleClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }, [])

  const handleLike = useCallback((articleId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    void toggleLike(articleId)
  }, [toggleLike])

  const handleQueueToggle = useCallback((article: NewsArticle, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isArticleInQueue(article.url)) {
      removeArticleFromQueue(article.url)
    } else {
      addArticleToQueue(article)
    }
  }, [isArticleInQueue, removeArticleFromQueue, addArticleToQueue])

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
      groups.get(sourceKey)!.articles.push(article)
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
      { root: container, rootMargin: "800px 0px", threshold: 0.1 }
    )
    const groups = container.querySelectorAll(".grid-source-group")
    groups.forEach((g) => observer.observe(g))
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
    return () => { cancelled = true }
  }, [viewMode, clusterWindow])

  const handleExpandCluster = useCallback((cluster: AllCluster) => {
    const clusterId = cluster.cluster_id
    if (expandedClusterId === clusterId) {
      setExpandedClusterId(null)
      return
    }
    setExpandedClusterId(clusterId)
    if (!clusterArticlesCache.has(clusterId)) {
      const clusterArts = clusterArticlesToNewsArticles(cluster.articles)
      setClusterArticlesCache(prev => new Map(prev).set(clusterId, clusterArts))
    }
  }, [expandedClusterId, clusterArticlesCache])

  const displayArticles = useVirtualization ? paginatedArticles : filteredNews
  const isLoadingState = useVirtualization ? paginatedLoading : loading

  if (isLoadingState && displayArticles.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="animate-spin h-12 w-12 text-primary mx-auto mb-4" />
          <p className="text-muted-foreground font-sans">Curating stories...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("w-full flex flex-col bg-background", isScrollMode ? "h-full overflow-hidden" : "min-h-screen")}>
      <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 py-3 border-b border-border bg-[var(--news-bg-secondary)] z-10 sticky top-0">
        <div className="flex items-center gap-4 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search intelligence..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-none bg-[var(--news-bg-primary)] border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[var(--news-bg-primary)] border border-border rounded-none p-1">
              <Button
                variant={viewMode === "source" ? "default" : "ghost"}
                size="sm"
                onClick={() => {
                  setViewMode("source")
                  onViewModeChange?.("source")
                }}
                className={cn("h-7 px-3 rounded-none text-xs uppercase tracking-widest", viewMode === "source" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                <List className="w-3.5 h-3.5 mr-1.5" />
                By Source
              </Button>
              <Button
                variant={viewMode === "topic" ? "default" : "ghost"}
                size="sm"
                onClick={() => {
                  setViewMode("topic")
                  onViewModeChange?.("topic")
                }}
                className={cn("h-7 px-3 rounded-none text-xs uppercase tracking-widest", viewMode === "topic" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                <Layers className="w-3.5 h-3.5 mr-1.5" />
                By Topic
              </Button>
            </div>
            {viewMode === "topic" && (
              <Select value={clusterWindow} onValueChange={(v) => setClusterWindow(v as "1d"|"1w"|"1m")}>
                <SelectTrigger className="h-9 px-2 text-xs bg-[var(--news-bg-primary)] border-border rounded-none uppercase tracking-widest">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  <SelectItem value="1d">Last 24h</SelectItem>
                  <SelectItem value="1w">Last 7d</SelectItem>
                  <SelectItem value="1m">Last 30d</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      <div 
        ref={containerRef}
        className={cn("flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6", isScrollMode ? "snap-y snap-mandatory" : "")}
      >
        <div className="space-y-6 max-w-[1600px] mx-auto">
          {showTrending && <TrendingFeed />}

          {displayArticles.length === 0 && !isLoadingState ? (
            <div className="text-center py-20 flex-1 flex flex-col items-center justify-center">
              <Newspaper className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="font-serif text-2xl text-foreground mb-2">No signals detected</h3>
              <p className="text-muted-foreground font-sans max-w-md">Adjust your search parameters to find relevant intelligence.</p>
            </div>
          ) : viewMode === "source" ? (
            sourceGroups.map((group, index) => {
              const shouldRender = visibleGroupIds.size === 0 ? index < 3 : visibleGroupIds.has(group.sourceId)
              const isExpanded = expandedSourceId === group.sourceId
              const displayedArticles = isExpanded ? group.articles : group.articles.slice(0, initialArticleCount)

              return (
                <div
                  key={group.sourceId}
                  data-source-id={group.sourceId}
                  className="grid-source-group bg-[var(--news-bg-secondary)] border border-border overflow-hidden"
                  style={{
                    scrollSnapAlign: "start",
                    scrollSnapStop: "always",
                    minHeight: shouldRender ? "auto" : "300px",
                  }}
                >
                  <div className="bg-[var(--news-bg-primary)] px-5 py-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Link href={\`/source/\${encodeURIComponent(group.sourceId)}\`} className="font-serif text-2xl font-bold tracking-tight hover:text-primary transition-colors">
                          {group.sourceName}
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleFavorite(group.sourceId)}
                          className="h-6 w-6 p-0"
                        >
                          <Star className={cn("w-4 h-4 transition-colors", isFavorite(group.sourceId) ? "fill-primary text-primary" : "text-muted-foreground")} />
                        </Button>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                      {group.articles.length} articles
                    </span>
                  </div>

                  {shouldRender && (
                    <div className="p-4 md:p-5">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {displayedArticles.map((article) => (
                          <SourceArticleCard
                            key={article.id}
                            article={article}
                            likedIds={likedIds}
                            hasRealImage={hasRealImage}
                            isArticleInQueue={isArticleInQueue}
                            onArticleClick={handleArticleClick}
                            onLike={handleLike}
                            onQueueToggle={handleQueueToggle}
                          />
                        ))}
                      </div>
                      {group.articles.length > initialArticleCount && (
                        <div className="mt-5 flex justify-center border-t border-border pt-4">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setExpandedSourceId(isExpanded ? null : group.sourceId)}
                            className="text-xs uppercase tracking-widest rounded-none bg-transparent"
                          >
                            {isExpanded ? "Show fewer" : \`View all \${group.articles.length} stories\`}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <div className="space-y-6">
              {clustersLoading ? (
                <div className="text-center py-8 text-muted-foreground uppercase tracking-widest text-xs">Mapping topic clusters...</div>
              ) : clusters.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground uppercase tracking-widest text-xs">No topics found</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {clusters.map((cluster) => {
                    const rep = cluster.representative_article
                    if (!rep) return null
                    const img = pickClusterImageUrl(cluster)
                    const isExpanded = expandedClusterId === cluster.cluster_id
                    
                    return (
                      <div key={cluster.cluster_id} className="flex flex-col gap-4 grid-source-group" style={{ scrollSnapAlign: "start" }}>
                        <Card 
                          onClick={() => handleExpandCluster(cluster)}
                          className={cn("h-full overflow-hidden flex flex-col border transition-all duration-200 cursor-pointer rounded-none shadow-none group relative", isExpanded ? "border-primary" : "border-border bg-[var(--news-bg-secondary)] hover:border-primary/60")}
                        >
                           <div className="relative aspect-video overflow-hidden bg-[var(--news-bg-primary)]/40 flex-shrink-0">
                             {img ? (
                               <>
                                 <img src={img} alt="Topic" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition duration-300" />
                                 <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                               </>
                             ) : (
                               <>
                                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted/20 to-background" />
                                <div className="absolute inset-0 flex items-center justify-center"><Layers className="w-12 h-12 text-muted-foreground/30" /></div>
                               </>
                             )}
                             
                             <div className="absolute bottom-3 left-3 right-3">
                               <h3 className="font-serif text-base font-bold text-white leading-snug drop-shadow-md line-clamp-3">
                                 {cluster.label || rep.title}
                               </h3>
                             </div>
                             
                             <div className="absolute top-2 right-2">
                               {isExpanded ? <ChevronDown className="w-4 h-4 text-white drop-shadow" /> : <ChevronRight className="w-4 h-4 text-white/70 group-hover:text-white drop-shadow" />}
                             </div>
                           </div>
                           <CardContent className="p-3 flex items-center justify-between border-t border-border/50">
                             <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">{cluster.source_diversity} sources</span>
                             <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">{cluster.article_count} stories</span>
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
`;

fs.writeFileSync('frontend/components/grid-view.tsx', code);
