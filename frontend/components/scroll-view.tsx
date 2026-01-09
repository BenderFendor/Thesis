"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Heart,
  ExternalLink,
  MapPin,
  Clock,
  ChevronUp,
  ChevronDown,
  Bookmark,
  Info,
  Play,
  Square,
  RefreshCw,
} from "lucide-react"
import { SourceInfoModal } from "./source-info-modal"
import { ArticleDetailModal } from "./article-detail-modal"
import { fetchNews, getSourceById, type NewsArticle } from "@/lib/api"

export function ScrollView({ articles, loading }: { articles: NewsArticle[], loading: boolean }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [likedArticles, setLikedArticles] = useState<Set<number>>(new Set())
  const [bookmarkedArticles, setBookmarkedArticles] = useState<Set<number>>(new Set())
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [currentSource, setCurrentSource] = useState<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // SSE Stream hook - removed, now handled by parent
  // const streamHook = useNewsStream({
  //   onUpdate: useCallback((newArticles: NewsArticle[]) => {
  //     setScrollNews(newArticles)
  //     setLoading(false)
  //     console.log(`Scroll View: Stream updated with ${newArticles.length} articles`)
  //   }, []),
  //   onComplete: useCallback(() => {
  //     console.log('Scroll View: Stream completed')
  //     setLoading(false)
  //   }, []),
  //   onError: useCallback((error: string) => {
  //     console.error('Scroll View: Stream error:', error)
  //     setLoading(false)
  //   }, [])
  // })

  // Traditional API loading function - removed, now handled by parent
  // const loadNewsFromAPI = async (showLoading = true) => {
  //   if (showLoading) setLoading(true)
  //   try {
  //     const articles = await fetchNews({ limit: 1000 }) // Get all articles
  //     setScrollNews(articles)
  //     console.log(`Scroll View: Loaded ${articles.length} articles from API at ${new Date().toLocaleTimeString()}`)
  //     
  //     if (articles.length === 0) {
  //     console.log(`Scroll View: No articles loaded. This will show "No articles available" message.`)
  //     }
  //   } catch (error) {
  //     console.error('Failed to load news:', error)
  //   } finally {
  //     if (showLoading) setLoading(false)
  //   }
  // }

  // Initial load and refresh setup - removed, now handled by parent
  // useEffect(() => {
  //   setLoading(true)
  //   streamHook.startStream()
  //   const fallbackTimer = setTimeout(async () => {
  //     if (scrollNews.length === 0) {
  //       console.log('No streamed articles yet in ScrollView; falling back to REST fetch')
  //       await loadNewsFromAPI()
  //     }
  //   }, 7000)

  //   return () => clearTimeout(fallbackTimer)
  // }, [])

  useEffect(() => {
    const loadCurrentSource = async () => {
      if (articles.length > 0 && articles[currentIndex]) {
        const source = await getSourceById(articles[currentIndex].sourceId)
        setCurrentSource(source)
      }
    }
    
    loadCurrentSource()
  }, [currentIndex, articles])

  const handleScroll = (direction: "up" | "down") => {
    if (direction === "up" && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    } else if (direction === "down" && currentIndex < articles.length - 1) {
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

  const currentArticle = articles[currentIndex]

  const getCredibilityColor = (credibility: string) => {
    return "outline"
  }

  const getBiasIndicator = (bias: string) => {
    const baseClass = "inline-flex h-2 w-2 rounded-full"
    switch (bias) {
      case "left":
        return <span className={`${baseClass} bg-white/40`} />
      case "right":
        return <span className={`${baseClass} bg-white/70`} />
      case "center":
        return <span className={`${baseClass} bg-white/20`} />
      default:
        return <span className={`${baseClass} bg-white/10`} />
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

  if (articles.length === 0) {
    console.log(`Scroll View: Displaying "No articles available" message (loading: ${loading})`)
    return (
      <div className="relative h-[calc(100vh-140px)] overflow-hidden flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No articles available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Stream Controls - Simplified */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[var(--news-bg-secondary)]/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/70 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span className="text-xs font-medium text-muted-foreground">Live</span>
            </div>
        </div>
        
        <Badge variant="outline" className="text-xs font-normal bg-transparent border-white/10">
          {articles.length} articles
        </Badge>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-none mx-4 mb-4 border border-white/10 shadow-sm" ref={containerRef}>
        {/* Navigation Arrows */}
      <div className="absolute right-4 top-1/2 transform -translate-y-1/2 z-20 flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleScroll("up")}
          disabled={currentIndex === 0}
          className="w-10 h-10 p-0 bg-[var(--news-bg-secondary)]/80 backdrop-blur-sm border-white/10"
        >
          <ChevronUp className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleScroll("down")}
          disabled={currentIndex === articles.length - 1}
          className="w-10 h-10 p-0 bg-[var(--news-bg-secondary)]/80 backdrop-blur-sm border-white/10"
        >
          <ChevronDown className="w-4 h-4" />
        </Button>
      </div>

      {/* Progress Indicator */}
      <div className="absolute left-4 top-1/2 transform -translate-y-1/2 z-20 flex flex-col gap-1">
        {articles.map((_, index) => (
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
        <Card
          className="h-full flex flex-col overflow-hidden bg-[var(--news-bg-secondary)] border border-white/10 rounded-none cursor-pointer"
          onClick={() => handleViewArticle(currentArticle)}
        >
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
              <span className="text-foreground text-sm" title={`${currentArticle.bias} bias`}>
                {getBiasIndicator(currentArticle.bias)}
              </span>
              <Badge variant="outline" className="bg-[var(--news-bg-secondary)]/80 backdrop-blur-sm border-white/10">
                {currentArticle.category}
              </Badge>
              {currentArticle.translated && (
                <Badge variant="outline" className="bg-[var(--news-bg-secondary)]/80 backdrop-blur-sm border-white/10">
                  Translated
                </Badge>
              )}
            </div>

            {/* Article Meta */}
            <div className="absolute bottom-0 left-0 right-0 p-6 text-foreground">
              <div className="flex items-center gap-2 text-sm mb-3">
                <MapPin className="w-4 h-4" />
                <span>{currentArticle.country}</span>
                <span>•</span>
                <Clock className="w-4 h-4" />
                <span>{currentArticle.publishedAt}</span>
              </div>
              <h2 className="text-2xl font-bold mb-3 text-balance leading-tight">{currentArticle.title}</h2>
              <p className="text-sm text-foreground/80 mb-3 line-clamp-2">{currentArticle.summary}</p>
              <div className="flex items-center justify-between">
                <SourceInfoModal sourceId={currentArticle.sourceId}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-foreground p-0 h-auto"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Info className="w-4 h-4 mr-1" />
                    {currentArticle.source}
                  </Button>
                </SourceInfoModal>
              </div>
            </div>
          </div>

          {/* Article Content */}
          <CardContent className="flex-1 p-6 overflow-y-auto bg-[var(--news-bg-secondary)]">
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{currentArticle.content}</p>

              {/* Source Funding Information */}
                            {currentSource?.funding && (
                <div className="p-3 bg-[var(--news-bg-secondary)]/60 border border-white/10">
                  <h4 className="text-sm font-medium mb-2 text-foreground">Source Funding</h4>
                  <div className="space-y-1">
                    {currentSource.funding.map((fund: string, index: number) => (
                      <div key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="w-2 h-2 bg-white/40 rounded-full" />
                        <span>{fund}</span>
                      </div>
                    ))}
                  </div>
                  {currentSource.funding.some((f: string) => f.includes("Government") || f.includes("State")) && (
                    <Badge variant="outline" className="mt-2 text-xs border-white/10 bg-white/5">
                      Government Funded
                    </Badge>
                  )}
                </div>
              )}

              {/* Interaction Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <div className="flex items-center gap-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleLike(currentArticle.id)
                    }}
                    className={`gap-2 ${likedArticles.has(currentArticle.id) ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    <Heart className={`w-4 h-4 ${likedArticles.has(currentArticle.id) ? "fill-current" : ""}`} />
                    <span className="text-sm">Like</span>
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleBookmark(currentArticle.id)
                    }}
                    className={bookmarkedArticles.has(currentArticle.id) ? "text-foreground" : "text-muted-foreground"}
                  >
                    <Bookmark
                      className={`w-4 h-4 ${bookmarkedArticles.has(currentArticle.id) ? "fill-current" : ""}`}
                    />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      window.open(currentArticle.url, "_blank")
                    }}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 right-4 text-xs text-muted-foreground bg-[var(--news-bg-secondary)]/80 backdrop-blur-sm rounded-none px-3 py-2 border border-white/10">
        Use ↑↓ keys, scroll wheel, or swipe to navigate • Click a card for details
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
