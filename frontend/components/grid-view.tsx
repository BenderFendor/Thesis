"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Clock, MapPin, Info, RefreshCw, Newspaper, ExternalLink } from "lucide-react"
import { FixedSizeList as List } from "react-window"
import AutoSizer from "react-virtualized-auto-sizer"
import { SourceInfoModal } from "./source-info-modal"
import { ArticleDetailModal } from "./article-detail-modal"
import { CollapsibleFilters } from "./collapsible-filters"
import type { NewsArticle } from "@/lib/api"
import { get_logger } from "@/lib/utils"

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
const countries = ["All", "United States", "United Kingdom", "Germany", "France", "Canada", "Australia", "India", "China", "Japan", "Russia", "Spain"]
const credibilityLevels = ["All", "High", "Medium", "Low"]

// Virtual grid constants for optimization
const COLUMN_COUNT = 4
const COLUMN_WIDTH = 300
const ROW_HEIGHT = 420
const GAP = 16

interface GridViewProps {
  articles: NewsArticle[]
  loading: boolean
  onCountChange?: (count: number) => void
  apiUrl?: string | null
}

export function GridView({ articles, loading, onCountChange, apiUrl }: GridViewProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [selectedCountry, setSelectedCountry] = useState("All")
  const [selectedCredibility, setSelectedCredibility] = useState("All")
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)

  // Filter articles based on user selections
  const filteredNews = useMemo(() => {
    return articles.filter((article: NewsArticle) => {
      const matchesSearch =
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.summary.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCategory = selectedCategory === "All" || article.category === selectedCategory
      const matchesCountry = selectedCountry === "All" || article.country === selectedCountry
      const matchesCredibility =
        selectedCredibility === "All" || article.credibility === selectedCredibility.toLowerCase()

      return matchesSearch && matchesCategory && matchesCountry && matchesCredibility
    })
  }, [articles, searchTerm, selectedCategory, selectedCountry, selectedCredibility])

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
        selectedCountry,
        selectedCredibility,
      },
    })
  }, [
    articles.length,
    filteredNews.length,
    searchTerm,
    selectedCategory,
    selectedCountry,
    selectedCredibility,
  ])

  const getCredibilityColor = (credibility: string) => {
    switch (credibility) {
      case "high":
        return "default"
      case "medium":
        return "secondary"
      case "low":
        return "destructive"
      default:
        return "outline"
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
            padding: `${GAP / 2}px`,
          }}
        >
          {rowArticles.map((article) => (
            <Card
              key={article.id}
              className="h-full cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02] group border-border bg-card"
              onClick={() => handleArticleClick(article)}
            >
              <div className="relative overflow-hidden h-48">
                <img
                  src={article.image || "/placeholder.svg"}
                  alt={article.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-3 left-3 flex gap-2">
                  <Badge
                    variant={getCredibilityColor(article.credibility)}
                    className="text-xs font-medium px-2 py-1 rounded-full backdrop-blur-sm bg-black/70 text-white border-0"
                  >
                    {article.credibility}
                  </Badge>
                  <span
                    className="text-xs rounded-full px-2 py-1 backdrop-blur-sm bg-black/70 text-white border-0 font-medium"
                    title={`${article.bias} bias`}
                  >
                    {getBiasIndicator(article.bias)}
                  </span>
                </div>
                <div className="absolute top-3 right-3 flex gap-2">
                  <Badge className="text-xs font-medium px-2 py-1 rounded-full backdrop-blur-sm bg-black/70 text-white border-0">
                    {article.category}
                  </Badge>
                  {article.translated && (
                    <Badge className="text-xs font-medium px-2 py-1 rounded-full backdrop-blur-sm bg-black/70 text-white border-0">
                      Translated
                    </Badge>
                  )}
                </div>
              </div>

              <CardContent className="p-4 flex-1 flex flex-col h-auto">
                <h3 className="font-serif font-semibold text-base line-clamp-2 group-hover:text-primary transition-colors mb-3">
                  {article.title}
                </h3>

                <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  <span>{article.country}</span>
                  <span>•</span>
                  <Clock className="w-3 h-3" />
                  <span>
                    {new Date(article.publishedAt).toLocaleDateString()}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-3 mt-2">
                  {article.summary}
                </p>

                <div className="flex items-center justify-between mt-auto pt-4 opacity-80 group-hover:opacity-100 transition-opacity duration-300">
                  <SourceInfoModal sourceId={article.sourceId}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs font-medium text-primary p-0 h-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Info className="w-3 h-3 mr-1" />
                      {article.source}
                    </Button>
                  </SourceInfoModal>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(article.url, "_blank")
                    }}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )
    },
    [filteredNews, handleArticleClick],
  )

  if (loading) {
    return (
      <div className="space-y-6 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16">
        <div className="bg-[#202020] p-4 rounded-xl border border-gray-800">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading news articles...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Collapsible Filters */}
      <div className="px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16">
        <CollapsibleFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          selectedCountry={selectedCountry}
          onCountryChange={setSelectedCountry}
          selectedCredibility={selectedCredibility}
          onCredibilityChange={setSelectedCredibility}
        />
      </div>

      {/* Virtualized Grid */}
      {filteredNews.length === 0 && !loading ? (
        <div className="text-center py-16 flex-1 flex items-center justify-center">
          <div className="mx-auto">
            <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--card)' }}>
              <Newspaper className="w-8 h-8" style={{ color: 'var(--muted-foreground)' }} />
            </div>
            <h3 className="text-lg font-medium" style={{ color: 'var(--foreground)' }}>No articles found</h3>
            <p className="mt-1 max-w-md mx-auto" style={{ color: 'var(--muted-foreground)' }}>Try adjusting your search or filters to find what you're looking for.</p>
            <Button
              variant="outline"
              className="mt-4"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              onClick={() => {
                setSearchTerm('')
                setSelectedCategory('All')
                setSelectedCountry('All')
                setSelectedCredibility('All')
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
                height={height - 100}
                overscanCount={2}
              >
                {Row}
              </List>
            )}
          </AutoSizer>
        </div>
      )}

      {/* Footer Stats */}
      <div className="px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-4 border-t border-border">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {filteredNews.length} of {articles.length} articles</span>
          <span>Optimized with virtual scrolling</span>
        </div>
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
