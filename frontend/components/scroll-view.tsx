"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Heart,
  MessageCircle,
  Share2,
  ExternalLink,
  MapPin,
  Clock,
  ChevronUp,
  ChevronDown,
  Bookmark,
  Info,
  Eye,
  Play,
  Square,
  RefreshCw,
} from "lucide-react"
import { SourceInfoModal } from "./source-info-modal"
import { ArticleDetailModal } from "./article-detail-modal"
import { fetchNews, getSourceById, type NewsArticle } from "@/lib/api"
import { useNewsStream } from "@/hooks/useNewsStream"

export function ScrollView() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [likedArticles, setLikedArticles] = useState<Set<number>>(new Set())
  const [bookmarkedArticles, setBookmarkedArticles] = useState<Set<number>>(new Set())
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [scrollNews, setScrollNews] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(false)
  const [useStream, setUseStream] = useState(true)
  const [currentSource, setCurrentSource] = useState<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // SSE Stream hook
  const streamHook = useNewsStream({
    onUpdate: useCallback((newArticles: NewsArticle[]) => {
      setScrollNews(newArticles)
      setLoading(false)
      console.log(`🔄 Scroll View: Stream updated with ${newArticles.length} articles`)
    }, []),
    onComplete: useCallback(() => {
      console.log('🔄 Scroll View: Stream completed')
      setLoading(false)
    }, []),
    onError: useCallback((error: string) => {
      console.error('Scroll View: Stream error:', error)
      setLoading(false)
    }, [])
  })

  // Traditional API loading function
  const loadNewsFromAPI = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const articles = await fetchNews({ limit: 1000 }) // Get all articles
      setScrollNews(articles)
      console.log(`🔄 Scroll View: Loaded ${articles.length} articles from API at ${new Date().toLocaleTimeString()}`)
      
      if (articles.length === 0) {
        console.log(`⚠️ Scroll View: No articles loaded. This will show "No articles available" message.`)
      }
    } catch (error) {
      console.error('Failed to load news:', error)
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  // Initial load and refresh setup
  useEffect(() => {
    if (useStream) {
      // Start with stream
      setLoading(true)
      streamHook.startStream()
    } else {
      // Load from API
      loadNewsFromAPI()
      
      // Set up background refresh every 3 minutes for API mode
      const refreshInterval = setInterval(() => {
        console.log('🔄 Starting background scroll view refresh...')
        loadNewsFromAPI(false) // Don't show loading spinner for background updates
      }, 3 * 60 * 1000) // 3 minutes
      
      return () => clearInterval(refreshInterval)
    }
  }, [useStream])

  useEffect(() => {
    const loadCurrentSource = async () => {
      if (scrollNews.length > 0 && scrollNews[currentIndex]) {
        const source = await getSourceById(scrollNews[currentIndex].sourceId)
        setCurrentSource(source)
      }
    }
    
    loadCurrentSource()
  }, [currentIndex, scrollNews])

  const handleScroll = (direction: "up" | "down") => {
    if (direction === "up" && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    } else if (direction === "down" && currentIndex < scrollNews.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handleLike = (articleId: number) => {
    const newLiked = new Set(likedArticles)
    if (newLiked.has(articleId)) {
      newLiked.delete(articleId)
    } else {
      newLiked.add(articleId)
    }
    setLikedArticles(newLiked)
  }

  const handleBookmark = (articleId: number) => {
    const newBookmarked = new Set(bookmarkedArticles)
    if (newBookmarked.has(articleId)) {
      newBookmarked.delete(articleId)
    } else {
      newBookmarked.add(articleId)
    }
    setBookmarkedArticles(newBookmarked)
  }

  const handleViewArticle = (article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        event.preventDefault()
        handleScroll("up")
      } else if (event.key === "ArrowDown") {
        event.preventDefault()
        handleScroll("down")
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [currentIndex])

  useEffect(() => {
    let scrollTimeout: NodeJS.Timeout

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()

      clearTimeout(scrollTimeout)

      scrollTimeout = setTimeout(() => {
        if (event.deltaY > 0) {
          handleScroll("down")
        } else if (event.deltaY < 0) {
          handleScroll("up")
        }
      }, 100)
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false })
    }

    return () => {
      clearTimeout(scrollTimeout)
      if (container) {
        container.removeEventListener("wheel", handleWheel)
      }
    }
  }, [currentIndex])

  useEffect(() => {
    let startY = 0
    let endY = 0

    const handleTouchStart = (event: TouchEvent) => {
      startY = event.touches[0].clientY
    }

    const handleTouchEnd = (event: TouchEvent) => {
      endY = event.changedTouches[0].clientY
      const deltaY = startY - endY

      if (Math.abs(deltaY) > 50) {
        if (deltaY > 0) {
          handleScroll("down")
        } else {
          handleScroll("up")
        }
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener("touchstart", handleTouchStart)
      container.addEventListener("touchend", handleTouchEnd)
    }

    return () => {
      if (container) {
        container.removeEventListener("touchstart", handleTouchStart)
        container.removeEventListener("touchend", handleTouchEnd)
      }
    }
  }, [currentIndex])

  const currentArticle = scrollNews[currentIndex]

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

  if (loading) {
    return (
      <div className="relative h-[calc(100vh-140px)] overflow-hidden flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading news articles...</p>
        </div>
      </div>
    )
  }

  if (scrollNews.length === 0) {
    console.log(`📺 Scroll View: Displaying "No articles available" message (loading: ${loading})`);
    return (
      <div className="relative h-[calc(100vh-140px)] overflow-hidden flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No articles available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
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
                  onClick={streamHook.startStream}
                  disabled={streamHook.isStreaming}
                  size="sm"
                  variant="outline"
                >
                  <Play className="w-4 h-4 mr-1" />
                  Start Stream
                </Button>
                <Button
                  onClick={streamHook.stopStream}
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
                onClick={() => loadNewsFromAPI()}
                disabled={loading}
                size="sm"
                variant="outline"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            )}
          </div>
          
          <Badge variant="secondary" className="text-sm">
            {scrollNews.length} articles
          </Badge>
          {useStream && streamHook.isStreaming && (
            <Badge variant="outline" className="text-sm">
              {streamHook.completedSources}/{streamHook.totalSources} sources
            </Badge>
          )}
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

      <div className="relative h-[calc(100vh-200px)] overflow-hidden" ref={containerRef}>
        {/* Navigation Arrows */}
      <div className="absolute right-4 top-1/2 transform -translate-y-1/2 z-20 flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleScroll("up")}
          disabled={currentIndex === 0}
          className="w-10 h-10 p-0 bg-background/80 backdrop-blur-sm border-border"
        >
          <ChevronUp className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleScroll("down")}
          disabled={currentIndex === scrollNews.length - 1}
          className="w-10 h-10 p-0 bg-background/80 backdrop-blur-sm border-border"
        >
          <ChevronDown className="w-4 h-4" />
        </Button>
      </div>

      {/* Progress Indicator */}
      <div className="absolute left-4 top-1/2 transform -translate-y-1/2 z-20 flex flex-col gap-1">
        {scrollNews.map((_, index) => (
          <div
            key={index}
            className={`w-1 h-8 rounded-full transition-all duration-300 ${
              index === currentIndex ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Article Content */}
      <div className="relative h-full">
        <Card className="h-full flex flex-col overflow-hidden bg-card border-border">
          {/* Article Image */}
          <div className="relative h-3/5 overflow-hidden">
            <img
              src={currentArticle.image || "/placeholder.svg"}
              alt={currentArticle.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

            {/* Top Badges */}
            <div className="absolute top-4 left-4 flex gap-2">
              <Badge variant={getCredibilityColor(currentArticle.credibility)}>{currentArticle.credibility}</Badge>
              <span className="text-white text-sm" title={`${currentArticle.bias} bias`}>
                {getBiasIndicator(currentArticle.bias)}
              </span>
              <Badge variant="outline" className="bg-background/80 backdrop-blur-sm border-border">
                {currentArticle.category}
              </Badge>
              {currentArticle.translated && (
                <Badge variant="outline" className="bg-background/80 backdrop-blur-sm border-border">
                  Translated
                </Badge>
              )}
            </div>

            {/* Article Meta */}
            <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
              <div className="flex items-center gap-2 text-sm mb-3">
                <MapPin className="w-4 h-4" />
                <span>{currentArticle.country}</span>
                <span>•</span>
                <Clock className="w-4 h-4" />
                <span>{currentArticle.publishedAt}</span>
              </div>
              <h2 className="text-2xl font-bold mb-3 text-balance leading-tight">{currentArticle.title}</h2>
              <p className="text-sm text-white/90 mb-3 line-clamp-2">{currentArticle.summary}</p>
              <div className="flex items-center justify-between">
                <SourceInfoModal sourceId={currentArticle.sourceId}>
                  <Button variant="ghost" size="sm" className="text-primary-foreground p-0 h-auto">
                    <Info className="w-4 h-4 mr-1" />
                    {currentArticle.source}
                  </Button>
                </SourceInfoModal>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleViewArticle(currentArticle)}
                  className="bg-background/20 backdrop-blur-sm border-white/20 text-white hover:bg-background/30"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  View Article
                </Button>
              </div>
            </div>
          </div>

          {/* Article Content */}
          <CardContent className="flex-1 p-6 overflow-y-auto bg-card">
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{currentArticle.content}</p>

              {/* Source Funding Information */}
                            {currentSource?.funding && (
                <div className="p-3 bg-muted/50 rounded-lg border border-border">
                  <h4 className="text-sm font-medium mb-2 text-foreground">Source Funding</h4>
                  <div className="space-y-1">
                    {currentSource.funding.map((fund: string, index: number) => (
                      <div key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="w-2 h-2 bg-primary rounded-full" />
                        <span>{fund}</span>
                      </div>
                    ))}
                  </div>
                  {currentSource.funding.some((f: string) => f.includes("Government") || f.includes("State")) && (
                    <Badge variant="secondary" className="mt-2 text-xs">
                      Government Funded
                    </Badge>
                  )}
                </div>
              )}

              {/* Interaction Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div className="flex items-center gap-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleLike(currentArticle.id)}
                    className={`gap-2 ${likedArticles.has(currentArticle.id) ? "text-red-500" : ""}`}
                  >
                    <Heart className={`w-4 h-4 ${likedArticles.has(currentArticle.id) ? "fill-current" : ""}`} />
                    <span className="text-sm">
                      {currentArticle.likes + (likedArticles.has(currentArticle.id) ? 1 : 0)}
                    </span>
                  </Button>

                  <Button variant="ghost" size="sm" className="gap-2">
                    <MessageCircle className="w-4 h-4" />
                    <span className="text-sm">{currentArticle.comments}</span>
                  </Button>

                  <Button variant="ghost" size="sm" className="gap-2">
                    <Share2 className="w-4 h-4" />
                    <span className="text-sm">{currentArticle.shares}</span>
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleBookmark(currentArticle.id)}
                    className={bookmarkedArticles.has(currentArticle.id) ? "text-primary" : ""}
                  >
                    <Bookmark
                      className={`w-4 h-4 ${bookmarkedArticles.has(currentArticle.id) ? "fill-current" : ""}`}
                    />
                  </Button>

                  <Button variant="ghost" size="sm" onClick={() => window.open(currentArticle.url, "_blank")}>
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 right-4 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-border">
        Use ↑↓ keys, scroll wheel, or swipe to navigate • Click "View Article" for details
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
    </div>
  )
}
