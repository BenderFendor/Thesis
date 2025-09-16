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
import { useNewsStream } from "@/hooks/useNewsStream"

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

export function GridView() {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [selectedCountry, setSelectedCountry] = useState("All")
  const [selectedCredibility, setSelectedCredibility] = useState("All")
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(false)
  const [useStream, setUseStream] = useState(true)
  const gridRef = useRef<HTMLDivElement>(null)

  // SSE Stream hook
  const streamHook = useNewsStream({
    onUpdate: useCallback((newArticles: NewsArticle[]) => {
      setArticles(newArticles)
      setLoading(false)
      console.log(`🔄 Grid View: Stream updated with ${newArticles.length} articles`)
    }, []),
    onComplete: useCallback(() => {
      console.log('🔄 Grid View: Stream completed')
      setLoading(false)
    }, []),
    onError: useCallback((error: string) => {
      console.error('Grid View: Stream error:', error)
      setLoading(false)
    }, [])
  })

  // Traditional API loading function
  const loadNewsFromAPI = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    console.log('🔄 Grid View: Fetching news from API...')
    try {
      const fetchedArticles = await fetchNews({ limit: 1000 }) // Get all articles
      setArticles(fetchedArticles)
      console.log(`🔄 Grid View: Loaded ${fetchedArticles.length} articles from API at ${new Date().toLocaleTimeString()}`)
      
      if (fetchedArticles.length === 0) {
        console.log(`⚠️ Grid View: No articles loaded. This will show "No articles found" message.`)
      }
    } catch (error) {
      console.error('Failed to load news:', error)
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  // Initial load and refresh setup with fallback if stream yields nothing
  useEffect(() => {
    let fallbackTimer: NodeJS.Timeout | undefined
    if (useStream) {
      setLoading(true)
      console.log('🔄 Grid View: Starting news stream...')
      streamHook.startStream()
      // If no articles arrive within 7s, fall back to REST
      fallbackTimer = setTimeout(async () => {
        if (articles.length === 0) {
          console.log('⏳ No streamed articles yet; falling back to REST fetch')
          await loadNewsFromAPI()
        }
      }, 7000)
    } else {
      console.log('🔄 Grid View: Loading news from API...')
      loadNewsFromAPI()
      const refreshInterval = setInterval(() => {
        console.log('🔄 Starting background article refresh...')
        loadNewsFromAPI(false)
      }, 5 * 60 * 1000)
      return () => clearInterval(refreshInterval)
    }
    return () => {
      if (fallbackTimer) clearTimeout(fallbackTimer)
    }
  }, [useStream])

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

  // Debug filtering results
  useEffect(() => {
    console.log(`🔍 Grid View Filter Debug:`, {
      totalArticles: articles.length,
      filteredArticles: filteredNews.length,
      filters: {
        searchTerm,
        selectedCategory,
        selectedCountry, 
        selectedCredibility
      }
    });
    
    if (articles.length > 0 && filteredNews.length === 0) {
      console.log(`⚠️ Grid View: Filters eliminated all articles. Original articles:`, 
        articles.slice(0, 3).map(a => ({ title: a.title, category: a.category, country: a.country, credibility: a.credibility }))
      );
    }
  }, [articles, filteredNews.length, searchTerm, selectedCategory, selectedCountry, selectedCredibility])

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
            {useStream && streamHook.isStreaming && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-muted-foreground">{streamHook.currentMessage}</p>
                <div className="flex items-center justify-center gap-2">
                  <Progress value={streamHook.progress} className="w-32" />
                  <span className="text-sm">{streamHook.progress.toFixed(0)}%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {streamHook.completedSources}/{streamHook.totalSources} sources
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header and Filters */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">News Grid</h2>
            <p className="text-muted-foreground">Browse news articles from around the world</p>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="secondary" className="text-sm">
              {filteredNews.length} articles
            </Badge>
            {useStream && streamHook.isStreaming && (
              <Badge variant="outline" className="text-sm">
                {streamHook.completedSources}/{streamHook.totalSources} sources
              </Badge>
            )}
          </div>
        </div>

        {/* Stream Controls */}
        <div className="flex items-center justify-between bg-muted/30 p-4 rounded-lg">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setUseStream(!useStream)}
                variant={useStream ? "default" : "outline"}
                size="sm"
              >
                {useStream ? "Live Stream" : "Static Load"}
              </Button>
              
              {useStream ? (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      console.log('🔄 Grid View: Manually starting stream...')
                      streamHook.startStream()
                    }}
                    disabled={streamHook.isStreaming}
                    size="sm"
                    variant="outline"
                  >
                    <Play className="w-4 h-4 mr-1" />
                    Start Stream
                  </Button>
                  <Button
                    onClick={() => {
                      console.log('🔄 Grid View: Stopping stream...')
                      streamHook.stopStream()
                    }}
                    disabled={!streamHook.isStreaming}
                    size="sm"
                    variant="outline"
                  >
                    <Square className="w-4 h-4 mr-1" />
                    Stop
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => {
                    console.log('🔄 Grid View: Manually refreshing from API...')
                    loadNewsFromAPI()
                  }}
                  disabled={loading}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              )}
            </div>
          </div>

          {useStream && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{streamHook.currentMessage}</span>
              {streamHook.progress > 0 && (
                <div className="flex items-center gap-2 min-w-[120px]">
                  <Progress value={streamHook.progress} className="w-20" />
                  <span>{streamHook.progress.toFixed(0)}%</span>
                </div>
              )}
            </div>
          )}
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
