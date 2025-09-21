"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { ExternalLink, Search, Filter, Clock, MapPin, Info, Play, Square, RefreshCw, Newspaper } from "lucide-react"
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
    <div className="space-y-6 max-w-[2000px] mx-auto" style={{ padding: '0 1rem' }}>
      {/* Filters */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div />
          <div className="flex items-center gap-4">
            <Badge variant="secondary" className="text-sm">
              {filteredNews.length} articles
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4" style={{ color: 'var(--muted-foreground)' }} />
            <Input
              placeholder="Search articles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 w-full sm:max-w-sm"
              style={{
                backgroundColor: 'var(--input)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
          </div>

          <div className="flex gap-2">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-10 w-full sm:w-[180px]" style={{
                backgroundColor: 'var(--input)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)'
              }}>
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue className="text-white" placeholder="Filter by category" />
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
              <SelectTrigger className="h-10 w-full sm:w-[180px]" style={{
                backgroundColor: 'var(--input)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)'
              }}>
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
              <SelectTrigger className="h-10 w-full sm:w-[180px]" style={{
                backgroundColor: 'var(--input)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)'
              }}>
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

      {/* News Grid Container */}
      <div 
        ref={gridRef}
        className="overflow-y-auto h-[calc(100vh-200px)] snap-y snap-mandatory [&::-webkit-scrollbar]:hidden"
        style={{
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          scrollBehavior: 'smooth',
          overscrollBehavior: 'contain',
          scrollSnapType: 'y mandatory'
        }}
      >
        <div className="space-y-6 w-full">
          {Array.from({ length: Math.ceil(filteredNews.length / 4) }).map((_, rowIndex) => {
            const startIdx = rowIndex * 4;
            const rowArticles = filteredNews.slice(startIdx, startIdx + 4);
            
            return (
              <div 
                key={rowIndex} 
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full"
                style={{
                  scrollSnapAlign: 'start',
                  scrollMargin: '1rem',
                  minHeight: 'min-content',
                  padding: '1rem 0'
                }}
              >
                {rowArticles.map((article) => (
                  <Card
                    key={article.id}
                    data-card
                    className="group h-full flex flex-col overflow-hidden border rounded-lg transition-all duration-300 transform hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/20"
                    style={{
                      backgroundColor: 'var(--news-card-bg)',
                      borderColor: 'var(--border)'
                    }}
                    onClick={() => handleArticleClick(article)}
                  >
                    <div className="relative overflow-hidden">
                      <img
                        src={article.image || "/placeholder.svg"}
                        alt={article.title}
                        className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
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

                    <CardContent className="p-5 flex-1 flex flex-col">
                      <h3 className="font-semibold text-base line-clamp-2 group-hover:text-primary transition-colors mb-3">
                        {article.title}
                      </h3>

                      <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        <span>{article.country}</span>
                        <span>•</span>
                        <Clock className="w-3 h-3" />
                        <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-3 mt-2">{article.summary}</p>

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
          })}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t text-xs flex items-center justify-between" style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
        <span>Use ↑↓ arrow keys to scroll by rows</span>
        <span>Grid adapts to your screen resolution</span>
      </div>

      {/* No Results */}
      {filteredNews.length === 0 && !loading && (
        <div className="text-center py-16">
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
              setSearchTerm('');
              setSelectedCategory('All');
              setSelectedCountry('All');
              setSelectedCredibility('All');
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset filters
          </Button>
        </div>
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
