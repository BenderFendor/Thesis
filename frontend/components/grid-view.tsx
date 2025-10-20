"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Clock,
  MapPin,
  Info,
  RefreshCw,
  Newspaper,
  ExternalLink,
  Heart,
  Search,
  PlusCircle,
  MinusCircle,
  Star,
} from "lucide-react"
import { FixedSizeList as List } from "react-window"
import AutoSizer from "react-virtualized-auto-sizer"
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
const COLUMN_COUNT = 5
const COLUMN_WIDTH = 260
const ROW_HEIGHT = 380  // Increased to prevent card content overlap
const GAP = 12
const ROW_GAP = 16  // Vertical gap between rows

interface GridViewProps {
  articles: NewsArticle[]
  loading: boolean
  onCountChange?: (count: number) => void
  apiUrl?: string | null
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
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } =
    useReadingQueue()
  const { isFavorite, toggleFavorite } = useFavorites()

  // Filter articles based on user selections
  const filteredNews = useMemo(() => {
    return articles.filter((article: NewsArticle) => {
      const matchesSearch =
        !searchTerm ||
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.summary?.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCategory =
        selectedCategory === "All" || article.category === selectedCategory

      return matchesSearch && matchesCategory
    })
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
  }, [articles.length, filteredNews.length, searchTerm, selectedCategory])

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

  // Calculate row count for virtual grid
  const rowCount = Math.ceil(filteredNews.length / COLUMN_COUNT)

  // Virtual grid row renderer - each row contains up to COLUMN_COUNT articles
  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const startIdx = index * COLUMN_COUNT
      const rowArticles = filteredNews.slice(startIdx, startIdx + COLUMN_COUNT)

      return (
        <div
          style={{
            ...style,
            display: "grid",
            gridTemplateColumns: `repeat(${COLUMN_COUNT}, 1fr)`,
            gap: `${GAP}px`,
            padding: `${ROW_GAP / 2}px ${GAP / 2}px`,
            height: `${ROW_HEIGHT - 100}px`,
          }}
        >
          {rowArticles.map((article) => (
            <button
              key={article.id}
              onClick={() => handleArticleClick(article)}
              className="group h-full text-left transition-all duration-200"
            >
              <Card className="h-full overflow-hidden flex flex-col hover:border-primary hover:shadow-lg transition-all duration-200 bg-card/70 hover:bg-card border-border/60 cursor-pointer">
                {/* Image Container */}
                <div className="relative h-32 overflow-hidden bg-muted/40 flex-shrink-0">
                  <img
                    src={article.image || "/placeholder.svg"}
                    alt={article.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

                  {/* Top Badges */}
                  <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap">
                    <Badge
                      className={`text-[10px] font-semibold px-2 py-0.5 ${getCredibilityColor(
                        article.credibility
                      )}`}
                    >
                      {article.credibility}
                    </Badge>
                    <span
                      className="text-xs bg-black/70 text-white px-2 py-0.5 rounded font-medium"
                      title={`${article.bias} bias`}
                    >
                      {getBiasIndicator(article.bias)}
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="absolute top-2 right-2 flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleQueueToggle(article)
                      }}
                      className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70"
                      title={
                        isArticleInQueue(article.url)
                          ? "Remove from queue"
                          : "Add to queue"
                      }
                    >
                      {isArticleInQueue(article.url) ? (
                        <MinusCircle className="w-4 h-4 text-blue-400" />
                      ) : (
                        <PlusCircle className="w-4 h-4 text-white" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavorite(article.sourceId)
                      }}
                      className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70"
                      title={
                        isFavorite(article.sourceId)
                          ? "Remove from favorites"
                          : "Add to favorites"
                      }
                    >
                      <Star
                        className={`w-4 h-4 transition-colors ${
                          isFavorite(article.sourceId)
                            ? "fill-yellow-500 text-yellow-500"
                            : "text-white"
                        }`}
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleLike(article.id as number)
                      }}
                      className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70"
                    >
                      <Heart
                        className={`w-4 h-4 ${
                          likedArticles.has(article.id as number)
                            ? "fill-red-500 text-red-500"
                            : "text-white"
                        }`}
                      />
                    </Button>
                  </div>
                </div>

                {/* Content */}
                <CardContent className="flex-1 flex flex-col p-2.5">
                  {/* Category Badge */}
                  <Badge
                    variant="outline"
                    className="w-fit text-[9px] font-semibold mb-1.5 px-1.5 py-0.5 bg-background/80 text-muted-foreground border-border/50"
                  >
                    {article.category}
                  </Badge>

                  {/* Title */}
                  <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2 mb-1.5 font-serif">
                    {article.title}
                  </h3>

                  {/* Summary */}
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-auto leading-relaxed">
                    {article.summary}
                  </p>

                  {/* Meta Info */}
                  <div className="space-y-1.5 pt-2 border-t border-border/30 mt-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span>
                          {new Date(article.publishedAt).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                            }
                          )}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(article.url, "_blank")
                        }}
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* Source */}
                    <SourceInfoModal sourceId={article.sourceId}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs font-medium text-primary p-0 h-auto w-full justify-start hover:bg-transparent hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Info className="w-3 h-3 mr-1 flex-shrink-0" />
                        <span className="truncate">{article.source}</span>
                      </Button>
                    </SourceInfoModal>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )
    },
    [filteredNews, handleArticleClick, handleLike, handleQueueToggle, isArticleInQueue, likedArticles],
  )

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
      <div className="flex-shrink-0 border-b border-border/30 bg-background/40 backdrop-blur-sm px-3 sm:px-4 lg:px-6 py-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {categories.map((category) => (
            <Button
              key={category}
              onClick={() => setSelectedCategory(category)}
              variant={selectedCategory === category ? 'default' : 'outline'}
              className="text-xs font-medium whitespace-nowrap px-2 py-1 h-auto"
            >
              {category}
            </Button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Showing {filteredNews.length} of {articles.length} articles
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex-shrink-0 px-3 sm:px-4 lg:px-6 py-2 border-b border-border/30 bg-background/40 backdrop-blur-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search articles..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm rounded-lg bg-background/80 border border-border/50 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Virtualized Grid */}
      {filteredNews.length === 0 && !loading ? (
        <div className="text-center py-16 flex-1 flex items-center justify-center">
          <div className="mx-auto">
            <div
              className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: "var(--card)" }}
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
        <div className="flex-1 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16">
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <List
                itemCount={rowCount}
                itemSize={ROW_HEIGHT}
                width={width}
                height={height}
                overscanCount={2}
              >
                {Row}
              </List>
            )}
          </AutoSizer>
        </div>
      )}

      {/* Category Filter Header removed as requested */}

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
