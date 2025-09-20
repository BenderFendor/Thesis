"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { ExternalLink, Search, Filter, Clock, MapPin, Info, Play, Square, RefreshCw } from "lucide-react"
import { SourceInfoModal } from "./source-info-modal"
import { ArticleDetailModal } from "./article-detail-modal"
import { fetchNews, getSourceById, type NewsArticle } from "@/lib/api"

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
  const gridRef = useRef<HTMLDivElement>(null)

  const filteredNews = articles.filter((article: NewsArticle) => {
    const matchesSearch =
      article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      article.summary.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === "All" || article.category === selectedCategory
    const matchesCountry = selectedCountry === "All" || article.country === selectedCountry
    const matchesCredibility =
      selectedCredibility === "All" || article.credibility === selectedCredibility.toLowerCase()

    return matchesSearch && matchesCategory && matchesCountry && matchesCredibility
  })

  // Notify parent about current filtered count when it changes
  useEffect(() => {
    try {
      onCountChange?.(filteredNews.length)
    } catch (e) {
      // ignore
    }
  }, [filteredNews.length, onCountChange])

  // Debug filtering results
  useEffect(() => {
    const requestInfo = {
      sentUrl: apiUrl || `API call is handled by parent component`,
      filtersApplied: {
        searchTerm,
        selectedCategory,
        selectedCountry,
        selectedCredibility,
      },
    }

    const responseInfo = {
      totalArticlesReceived: articles.length,
      filteredArticlesCount: filteredNews.length,
      sampleArticles: articles.slice(0, 3).map(a => ({ 
        title: a.title, 
        category: a.category, 
        country: a.country, 
        credibility: a.credibility 
      })),
    }

    console.log(`🔍 Grid View Filter Debug:`, {
      requestInfo,
      responseInfo,
    })

    if (articles.length > 0 && filteredNews.length === 0) {
      console.log(
        `⚠️ Grid View: Filters eliminated all articles.`,
        { 
          filters: requestInfo.filtersApplied, 
          articlesPreview: responseInfo.sampleArticles 
        }
      )
    }
  }, [articles, filteredNews.length, searchTerm, selectedCategory, selectedCountry, selectedCredibility, apiUrl])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!gridRef.current) return

      const grid = gridRef.current
      const cards = grid.querySelectorAll("[data-card]")
      const gridComputedStyle = window.getComputedStyle(grid)
      const columns = gridComputedStyle.getPropertyValue("grid-template-columns").split(" ").length

      if (event.key === "ArrowDown") {
        event.preventDefault()
        const cardHeight = cards[0]?.getBoundingClientRect().height || 0
        const gap = 24 // 1.5rem gap
        const scrollAmount = cardHeight + gap
        grid.scrollBy({ top: scrollAmount, behavior: "smooth" })
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        const cardHeight = cards[0]?.getBoundingClientRect().height || 0
        const gap = 24 // 1.5rem gap
        const scrollAmount = cardHeight + gap
        grid.scrollBy({ top: -scrollAmount, behavior: "smooth" })
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [filteredNews])

  const getGridColumns = () => {
    if (typeof window === "undefined") return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"

    const width = window.innerWidth
    if (width >= 1536) return "grid-cols-6" // 2xl
    if (width >= 1280) return "grid-cols-5" // xl
    if (width >= 1024) return "grid-cols-4" // lg
    if (width >= 768) return "grid-cols-3" // md
    if (width >= 640) return "grid-cols-2" // sm
    return "grid-cols-1"
  }

  const [gridColumns, setGridColumns] = useState(getGridColumns())

  useEffect(() => {
    const handleResize = () => {
      setGridColumns(getGridColumns())
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

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

  const handleArticleClick = (article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading news articles...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filters (header moved to page.tsx) */}
      <div className="space-y-4">
        {/* Keep badges and filters but header/title handled by page-level component */}
        <div className="flex items-center justify-between">
          <div />
          <div className="flex items-center gap-4">
            <Badge variant="secondary" className="text-sm">
              {filteredNews.length} articles
            </Badge>
          </div>
        </div>
        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search articles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-input border-border"
            />
          </div>

          <div className="flex gap-2">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[140px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedCountry} onValueChange={setSelectedCountry}>
              <SelectTrigger className="w-[140px]">
                <MapPin className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((country) => (
                  <SelectItem key={country} value={country}>
                    {country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedCredibility} onValueChange={setSelectedCredibility}>
              <SelectTrigger className="w-[140px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Credibility" />
              </SelectTrigger>
              <SelectContent>
                {credibilityLevels.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* News Grid */}
      <div
        ref={gridRef}
        className={`grid ${gridColumns} gap-6 max-h-[calc(100vh-300px)] overflow-y-auto scroll-smooth`}
        style={{ scrollSnapType: "y mandatory" }}
      >
        {filteredNews.map((article: NewsArticle) => {
          return (
            <Card
              key={article.id}
              data-card
              className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 bg-card border-border cursor-pointer"
              style={{ scrollSnapAlign: "start" }}
              onClick={() => handleArticleClick(article)}
            >
              <div className="relative overflow-hidden rounded-t-lg">
                <img
                  src={article.image || "/placeholder.svg"}
                  alt={article.title}
                  className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-3 left-3 flex gap-1">
                  <Badge variant={getCredibilityColor(article.credibility)} className="text-xs">
                    {article.credibility}
                  </Badge>
                  <span
                    className="text-xs bg-background/80 backdrop-blur-sm rounded px-1 border border-border"
                    title={`${article.bias} bias`}
                  >
                    {getBiasIndicator(article.bias)}
                  </span>
                </div>
                <div className="absolute top-3 right-3 flex gap-1">
                  <Badge variant="outline" className="text-xs bg-background/80 backdrop-blur-sm border-border">
                    {article.category}
                  </Badge>
                  {article.translated && (
                    <Badge variant="outline" className="text-xs bg-background/80 backdrop-blur-sm border-border">
                      Translated
                    </Badge>
                  )}
                </div>
              </div>

              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="w-3 h-3" />
                    <span>{article.country}</span>
                    <span>•</span>
                    <Clock className="w-3 h-3" />
                    <span>{article.publishedAt}</span>
                  </div>

                  <h3 className="font-semibold text-sm line-clamp-2 group-hover:text-primary transition-colors">
                    {article.title}
                  </h3>

                  <p className="text-xs text-muted-foreground line-clamp-3">{article.summary}</p>

                  <div className="flex items-center justify-between pt-2">
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

                  {/* Source funding info removed for now - would need async handling */}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="text-xs text-muted-foreground text-center bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-border">
        Use ↑↓ arrow keys to scroll by rows • Grid adapts to your screen resolution
      </div>

      {/* No Results */}
      {filteredNews.length === 0 && (
        <Card className="p-12 text-center">
          <div className="space-y-4">
            <Search className="w-12 h-12 text-muted-foreground mx-auto" />
            <div>
              <h3 className="text-lg font-semibold">No articles found</h3>
              <p className="text-muted-foreground">Try adjusting your search terms or filters</p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSearchTerm("")
                setSelectedCategory("All")
                setSelectedCountry("All")
                setSelectedCredibility("All")
              }}
            >
              Clear filters
            </Button>
          </div>
        </Card>
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
