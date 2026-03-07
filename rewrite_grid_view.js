const fs = require('fs');

const code = `
"use client"

import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react"
import Link from "next/link"
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
import { motion, AnimatePresence } from "framer-motion"

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
  getClusterPreviewStats,
  hasRealClusterImage,
  pickClusterImageUrl,
} from "@/lib/cluster-display"
import { fetchAllClusters } from "@/lib/api"

const logger = get_logger("GridView")
const isDev = process.env.NODE_ENV !== "production"

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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
}

function BentoArticleCard({
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
  onLike: (articleId: number) => void
  onQueueToggle: (article: NewsArticle) => void
}) {
  const showImage = hasRealImage(article.image)

  return (
    <motion.article 
      variants={itemVariants}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onArticleClick(article)}
      className="group relative flex flex-col h-full gap-4 overflow-hidden rounded-lg bg-card p-4 border border-border shadow-sm transition-all duration-300 ease-out hover:shadow-xl hover:border-primary/50 cursor-pointer"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted flex-shrink-0">
        {showImage ? (
          <img 
            src={article.image!} 
            alt={article.title} 
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105" 
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-muted">
            <h3 className="font-serif text-lg leading-tight text-foreground line-clamp-3 text-center">{article.title}</h3>
          </div>
        )}
        
        {/* Actions overlay */}
        <div className="absolute top-2 right-2 flex gap-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
           <Button
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation()
              onQueueToggle(article)
            }}
            className="h-8 w-8 rounded-md bg-background/80 backdrop-blur-md border border-border/50 text-foreground hover:bg-card active:scale-95"
          >
            {isArticleInQueue(article.url) ? <MinusCircle className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation()
              onLike(article.id as number)
            }}
            className="h-8 w-8 rounded-md bg-background/80 backdrop-blur-md border border-border/50 text-foreground hover:bg-card active:scale-95"
          >
            <Heart className={\`h-4 w-4 \${likedIds.has(article.id as number) ? "fill-primary text-primary" : ""}\`} />
          </Button>
        </div>
      </div>

      <div className="flex flex-col flex-1 gap-2">
        <div className="flex items-center justify-between">
          <span className="font-sans text-xs font-semibold tracking-widest text-accent uppercase line-clamp-1">
            {article.source}
          </span>
          <span className="font-sans text-xs text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            {new Date(article.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
        <h3 className="font-serif text-xl text-foreground leading-snug line-clamp-3 group-hover:text-primary transition-colors">
          {article.title}
        </h3>
        <p className="font-sans text-sm text-muted-foreground line-clamp-2 mt-auto pt-2">
          {article.summary}
        </p>
      </div>
    </motion.article>
  )
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

  const handleLike = useCallback((articleId: number) => {
    void toggleLike(articleId)
  }, [toggleLike])

  const handleQueueToggle = useCallback((article: NewsArticle) => {
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

  // Topics loading logic...
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
      {/* Header / Search Area */}
      <div className="flex-shrink-0 px-4 sm:px-8 py-4 border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search intelligence..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex p-1 bg-card rounded-lg border border-border">
              <Button
                variant={viewMode === "source" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setViewMode("source")
                  onViewModeChange?.("source")
                }}
                className={cn("h-8 px-3 rounded-md transition-all", viewMode === "source" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                <List className="w-4 h-4 mr-2" />
                Sources
              </Button>
              <Button
                variant={viewMode === "topic" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setViewMode("topic")
                  onViewModeChange?.("topic")
                }}
                className={cn("h-8 px-3 rounded-md transition-all", viewMode === "topic" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                <Layers className="w-4 h-4 mr-2" />
                Topics
              </Button>
            </div>
            {viewMode === "topic" && (
              <Select value={clusterWindow} onValueChange={(v) => setClusterWindow(v as "1d"|"1w"|"1m")}>
                <SelectTrigger className="h-10 w-32 bg-card border-border rounded-lg text-sm">
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

      <div className={cn("flex-1 overflow-y-auto px-0 py-6", isScrollMode ? "snap-y snap-mandatory" : "")}>
        {showTrending && <TrendingFeed />}

        {displayArticles.length === 0 && !isLoadingState ? (
           <div className="text-center py-20 flex-1 flex flex-col items-center justify-center">
             <Newspaper className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
             <h3 className="font-serif text-2xl text-foreground mb-2">No signals detected</h3>
             <p className="text-muted-foreground font-sans max-w-md">Adjust your search parameters to find relevant intelligence.</p>
           </div>
        ) : viewMode === "source" ? (
          <div className="flex flex-col gap-12 w-full pb-12">
            {sourceGroups.map((group) => (
              <section key={group.sourceId} className="w-full flex flex-col gap-4">
                <div className="flex items-center justify-between px-4 sm:px-8">
                  <div className="flex items-center gap-3">
                    <h2 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight">
                      {group.sourceName}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleFavorite(group.sourceId)}
                      className="h-8 w-8 rounded-full hover:bg-card active:scale-95"
                    >
                      <Star className={cn("w-5 h-5 transition-colors", isFavorite(group.sourceId) ? "fill-primary text-primary" : "text-muted-foreground")} />
                    </Button>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="hidden sm:inline-block text-sm text-muted-foreground font-sans">
                      {group.articles.length} articles
                    </span>
                    <button className="font-sans text-sm font-medium text-muted-foreground hover:text-primary transition-colors active:scale-95">
                      View All
                    </button>
                  </div>
                </div>

                {/* Horizontal Snap Scroll Container */}
                <div className="flex w-full overflow-x-auto snap-x snap-mandatory gap-4 px-4 sm:px-8 pb-6 no-scrollbar">
                  <AnimatePresence>
                    {group.articles.slice(0, 10).map((article) => (
                      <div key={article.url || article.id} className="w-72 sm:w-80 md:w-96 shrink-0 snap-start h-full">
                        <BentoArticleCard
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
                  </AnimatePresence>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="px-4 sm:px-8 pb-12">
            {/* Topic mode - grid of topics */}
            {clustersLoading ? (
              <div className="text-center py-8 text-muted-foreground">Mapping topic clusters...</div>
            ) : (
              <motion.div 
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
              >
                {clusters.map((cluster) => {
                  const rep = cluster.representative_article
                  if (!rep) return null
                  const img = pickClusterImageUrl(cluster)
                  const isExpanded = expandedClusterId === cluster.cluster_id
                  return (
                    <motion.div variants={itemVariants} key={cluster.cluster_id} className="flex flex-col gap-4">
                      <div 
                        onClick={() => handleExpandCluster(cluster)}
                        className={cn("group relative aspect-square w-full overflow-hidden rounded-xl cursor-pointer border transition-all duration-300", isExpanded ? "border-primary shadow-lg" : "border-border shadow-sm hover:border-primary/50")}
                      >
                        {img ? (
                          <img src={img} alt="Topic" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        ) : (
                          <div className="w-full h-full bg-card flex items-center justify-center"><Layers className="w-12 h-12 text-muted-foreground/30" /></div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent pointer-events-none" />
                        <div className="absolute bottom-0 left-0 right-0 p-4">
                           <h3 className="font-serif text-xl font-bold text-foreground leading-snug drop-shadow-md">
                             {cluster.label || rep.title}
                           </h3>
                           <div className="flex items-center gap-2 mt-2">
                             <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm text-[10px]">{cluster.article_count} articles</Badge>
                           </div>
                        </div>
                      </div>
                      
                      {isExpanded && clusterArticlesCache.has(cluster.cluster_id) && (
                        <div className="flex w-[90vw] max-w-full overflow-x-auto snap-x snap-mandatory gap-4 pb-4 no-scrollbar -ml-4 pl-4 sm:-ml-8 sm:pl-8">
                           {clusterArticlesCache.get(cluster.cluster_id)?.map(article => (
                             <div key={article.id} className="w-72 shrink-0 snap-start">
                                <BentoArticleCard
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
                      )}
                    </motion.div>
                  )
                })}
              </motion.div>
            )}
          </div>
        )}
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
`

fs.writeFileSync('frontend/components/grid-view.tsx', code);
