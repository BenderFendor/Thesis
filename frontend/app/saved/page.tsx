"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { type NewsArticle } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArticleDetailModal } from "@/components/article-detail-modal"
import { 
  ArrowLeft, 
  Bookmark, 
  Heart, 
  Loader2, 
  List,
  Sparkles,
  PlusCircle,
  MinusCircle,
  Trash2,
  Inbox,
  Newspaper,
  ChevronRight,
  ChevronDown,
  X
} from "lucide-react"
import Link from "next/link"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { useLikedArticles } from "@/hooks/useLikedArticles"
import { useBookmarks } from "@/hooks/useBookmarks"
import ReactMarkdown from "react-markdown"
import { cn } from "@/lib/utils"
import { API_BASE_URL } from "@/lib/api"

export default function SavedArticlesPage() {
  const [bookmarks, setBookmarks] = useState<NewsArticle[]>([])
  const [likedArticles, setLikedArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("all")
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [expandedArticleUrl, setExpandedArticleUrl] = useState<string | null>(null)
  const [queueDigest, setQueueDigest] = useState<string | null>(null)
  const [digestLoading, setDigestLoading] = useState(false)
  const [showDigest, setShowDigest] = useState(false)
  
  const { 
    queuedArticles, 
    addArticleToQueue, 
    removeArticleFromQueue, 
    isArticleInQueue 
  } = useReadingQueue()
  const { toggleLike, likedIds, refresh: refreshLiked } = useLikedArticles()
  const { toggleBookmark, bookmarkIds, refresh: refreshBookmarks } = useBookmarks()

  const loadData = async () => {
    setLoading(true)
    try {
      const [bookmarksData, likedData] = await Promise.all([
        refreshBookmarks(),
        refreshLiked(),
      ])
      const bookmarkArticles = (bookmarksData ?? []).map((entry) => entry.article)
      const likedArticlesList = (likedData ?? []).map((entry) => entry.article)
      setBookmarks(bookmarkArticles)
      setLikedArticles(likedArticlesList)
    } catch (error) {
      console.error("Failed to load saved articles:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleArticleClick = (article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }

  const hasRealImage = useCallback((src?: string | null) => {
    if (!src) return false
    const trimmed = src.trim()
    if (!trimmed) return false
    if (trimmed === "none") return false
    const lower = trimmed.toLowerCase()
    return (
      !lower.includes("/placeholder.svg") &&
      !lower.includes("/placeholder.jpg")
    )
  }, [])

  const generateQueueDigest = async () => {
    if (queuedArticles.length === 0) return;

    try {
      setDigestLoading(true);
      const articleSummaries = queuedArticles.map((article) => ({
        title: article.title,
        source: article.source,
        url: article.url,
        summary: article.summary || "",
        category: article.category || "Uncategorized",
      }));

      const grouped = articleSummaries.reduce(
        (acc, article) => {
          const cat = article.category;
          if (!acc[cat]) acc[cat] = [];
          acc[cat].push(article);
          return acc;
        },
        {} as Record<string, typeof articleSummaries>
      );

      const response = await fetch(
        `${API_BASE_URL}/api/queue/digest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articles: articleSummaries,
            grouped,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setQueueDigest(data.digest || data.content);
        setShowDigest(true);
      }
    } catch (e) {
      console.error("Error generating digest:", e);
    } finally {
      setDigestLoading(false);
    }
  };

  // Combine all saved articles
  const allSavedArticles = useMemo(() => {
    const bookmarkMap = new Map(bookmarks.map(b => [b.url, { ...b, type: "bookmark" as const }]))
    const likedMap = new Map(likedArticles.map(l => [l.url, { ...l, type: "liked" as const }]))
    
    // Merge, with bookmarks taking precedence for type
    const allArticles = new Map<string, NewsArticle & { type: "bookmark" | "liked" | "both" }>()
    
    bookmarkMap.forEach((article, url) => {
      allArticles.set(url, article)
    })
    
    likedMap.forEach((article, url) => {
      if (allArticles.has(url)) {
        const existing = allArticles.get(url)!
        allArticles.set(url, { ...existing, type: "both" })
      } else {
        allArticles.set(url, article)
      }
    })
    
    return Array.from(allArticles.values())
  }, [bookmarks, likedArticles])

  const renderArticleCard = (article: NewsArticle & { type?: "bookmark" | "liked" | "both" }, index?: number) => {
    const showImage = hasRealImage(article.image)
    const isExpanded = expandedArticleUrl === article.url
    const inQueue = isArticleInQueue(article.url)
    const readTime = article._queueData?.readingTimeMinutes
    const isLiked = typeof article.id === "number" ? likedIds.has(article.id) : false
    const isBookmarked = typeof article.id === "number" ? bookmarkIds.has(article.id) : false

    return (
      <div
        key={article.url}
        onClick={() => setExpandedArticleUrl(isExpanded ? null : article.url)}
        className={cn(
          "w-full transition-all duration-300 ease-out cursor-pointer text-left group",
          "transform hover:scale-[1.02]"
        )}
        style={{
          marginLeft: typeof index === 'number' ? `${Math.min(index * 4, 16)}px` : 0,
          marginTop: typeof index === 'number' && index > 0 ? "-8px" : "0px",
        }}
      >
        <div
          className={cn(
            "relative rounded-2xl border overflow-hidden backdrop-blur-sm",
            "transition-all duration-300",
            "p-4 flex flex-col",
            isExpanded
              ? "shadow-2xl ring-2"
              : "shadow-lg group-hover:shadow-xl"
          )}
          style={{
            backgroundColor: isExpanded
              ? "var(--news-bg-secondary)"
              : "var(--card)",
            borderColor: isExpanded
              ? "var(--primary)"
              : "var(--border)",
            outlineColor: isExpanded
              ? "var(--primary)"
              : undefined,
            outlineWidth: isExpanded ? "2px" : "0px",
            outlineOffset: isExpanded ? "0px" : "0px",
          }}
        >
          <div className="flex items-start gap-3">
            {/* Index Badge or Type Icon */}
            <div
              className="flex-shrink-0 text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center"
              style={{
                backgroundColor: article.type === 'liked' ? "var(--destructive)" : "var(--primary)",
                color: "var(--primary-foreground)",
              }}
            >
              {article.type === 'liked' ? (
                <Heart className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Bookmark className="w-3.5 h-3.5 fill-current" />
              )}
            </div>

            {/* Title and Source */}
            <div className="flex-1 min-w-0">
              <h3
                className={cn(
                  "font-bold leading-tight group-hover:text-primary transition-colors font-serif",
                  isExpanded
                    ? "text-base"
                    : "text-sm line-clamp-2"
                )}
              >
                {article.title}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  {article.source}
                </p>
                {readTime && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: "rgba(168, 85, 247, 0.2)",
                      color: "var(--primary)",
                    }}
                  >
                    {readTime}m
                  </span>
                )}
                {article.type === 'both' && (
                  <Badge variant="outline" className="text-[9px]">
                    <Heart className="w-3 h-3 mr-1" /> Liked
                  </Badge>
                )}
              </div>
            </div>

            {/* Image Thumbnail */}
            {showImage && (
              <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden">
                <img
                  src={article.image}
                  alt={article.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Expand Indicator */}
            <div className="flex-shrink-0 self-center">
              {isExpanded ? (
                <ChevronDown className="w-5 h-5 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Expanded Content */}
          {isExpanded && (
            <div className="mt-4 pt-4 border-t border-border/50">
              {showImage && (
                <div className="mb-4 rounded-lg overflow-hidden">
                  <img
                    src={article.image}
                    alt={article.title}
                    className="w-full h-48 object-cover"
                  />
                </div>
              )}
              
              <p className="text-sm text-muted-foreground mb-4 line-clamp-4">
                {article.summary}
              </p>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleArticleClick(article)
                  }}
                >
                  Read Article
                </Button>
                
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (inQueue) {
                      removeArticleFromQueue(article.url)
                    } else {
                      addArticleToQueue(article)
                    }
                  }}
                >
                  {inQueue ? (
                    <><MinusCircle className="w-4 h-4 mr-1" /> Remove from Queue</>
                  ) : (
                    <><PlusCircle className="w-4 h-4 mr-1" /> Add to Queue</>
                  )}
                </Button>

                {typeof article.id === "number" && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        void toggleLike(article.id)
                      }}
                      className={isLiked ? "text-red-400" : "text-muted-foreground"}
                    >
                      <Heart className={`w-4 h-4 mr-1 ${isLiked ? "fill-current" : ""}`} />
                      Like
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        void toggleBookmark(article.id)
                      }}
                      className={isBookmarked ? "text-yellow-400" : "text-muted-foreground"}
                    >
                      <Bookmark className={`w-4 h-4 mr-1 ${isBookmarked ? "fill-current" : ""}`} />
                      Bookmark
                    </Button>
                  </>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  asChild
                >
                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                    Open Source
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)]">
      {/* Header */}
      <header className="border-b border-white/10 bg-[var(--news-bg-secondary)]/60 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to News
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold font-serif text-foreground">Saved Articles</h1>
                <p className="text-sm text-muted-foreground">
                  Your bookmarks, liked articles, and reading queue
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => {
                  loadData()
                }}
                disabled={loading}
                variant="outline"
                size="sm"
              >
                <Loader2 className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 bg-[var(--news-bg-secondary)] border border-white/10">
            <TabsTrigger value="all" className="gap-2">
              <Newspaper className="w-4 h-4" />
              All Saved
              <Badge variant="secondary" className="ml-1">
                {allSavedArticles.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="gap-2">
              <Bookmark className="w-4 h-4" />
              Bookmarks
              <Badge variant="secondary" className="ml-1">
                {bookmarks.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="liked" className="gap-2">
              <Heart className="w-4 h-4" />
              Liked
              <Badge variant="secondary" className="ml-1">
                {likedArticles.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-2">
              <List className="w-4 h-4" />
              Reading Queue
              <Badge variant="secondary" className="ml-1">
                {queuedArticles.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* All Saved Tab */}
          <TabsContent value="all" className="mt-0">
            {showDigest && queueDigest ? (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-serif font-bold">Reading Digest</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDigest(false)}
                  >
                    <X className="w-4 h-4 mr-1" /> Close Digest
                  </Button>
                </div>
                <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
                  <CardContent className="p-6 prose prose-invert max-w-none">
                    <ReactMarkdown>{queueDigest}</ReactMarkdown>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mr-3" />
                <span className="text-muted-foreground">Loading saved articles...</span>
              </div>
            ) : allSavedArticles.length === 0 ? (
              <Card className="border-dashed border-white/20 bg-[var(--news-bg-secondary)]/50">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Inbox className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2 font-serif">No saved articles yet</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Articles you bookmark or like will appear here. Click the bookmark or heart icon on any article to save it.
                  </p>
                  <Link href="/" className="mt-4">
                    <Button>Browse News</Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content - Saved Articles */}
                <div className="lg:col-span-2">
                  <div className="space-y-3">
                    {allSavedArticles.map((article, index) => renderArticleCard(article, index))}
                  </div>
                </div>

                {/* Sidebar - Reading Queue & Digest */}
                <div className="space-y-6">
                  {/* Reading Queue Card */}
                  <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-serif font-bold text-lg">Reading Queue</h3>
                        <Badge>{queuedArticles.length}</Badge>
                      </div>
                      
                      {queuedArticles.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          Your queue is empty. Add articles from your saved items.
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {queuedArticles.slice(0, 5).map((article, index) => (
                            <div
                              key={article.url}
                              className="flex items-center gap-2 p-2 rounded-lg bg-[var(--news-bg-primary)]/50 cursor-pointer hover:bg-[var(--news-bg-primary)]"
                              onClick={() => handleArticleClick(article)}
                            >
                              <span className="text-xs font-bold text-primary w-5">{index + 1}</span>
                              <span className="text-sm line-clamp-1 flex-1">{article.title}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeArticleFromQueue(article.url)
                                }}
                              >
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                          {queuedArticles.length > 5 && (
                            <p className="text-xs text-muted-foreground text-center">
                              +{queuedArticles.length - 5} more articles
                            </p>
                          )}
                        </div>
                      )}

                      {queuedArticles.length > 0 && (
                        <Button
                          className="w-full mt-4"
                          variant="outline"
                          onClick={generateQueueDigest}
                          disabled={digestLoading}
                        >
                          {digestLoading ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                          ) : (
                            <><Sparkles className="w-4 h-4 mr-2" /> Generate Digest</>
                          )}
                        </Button>
                      )}
                    </CardContent>
                  </Card>

                  {/* Stats Card */}
                  <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
                    <CardContent className="p-4">
                      <h3 className="font-serif font-bold text-lg mb-4">Your Library</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground flex items-center gap-2">
                            <Bookmark className="w-4 h-4" /> Bookmarks
                          </span>
                          <Badge variant="secondary">{bookmarks.length}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground flex items-center gap-2">
                            <Heart className="w-4 h-4" /> Liked
                          </span>
                          <Badge variant="secondary">{likedArticles.length}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground flex items-center gap-2">
                            <List className="w-4 h-4" /> In Queue
                          </span>
                          <Badge variant="secondary">{queuedArticles.length}</Badge>
                        </div>
                        <div className="pt-3 border-t border-white/10">
                          <div className="flex items-center justify-between font-bold">
                            <span className="text-sm">Total Saved</span>
                            <Badge>{allSavedArticles.length}</Badge>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Bookmarks Tab */}
          <TabsContent value="bookmarks" className="mt-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mr-3" />
                <span className="text-muted-foreground">Loading bookmarks...</span>
              </div>
            ) : bookmarks.length === 0 ? (
              <Card className="border-dashed border-white/20 bg-[var(--news-bg-secondary)]/50">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Bookmark className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2 font-serif">No bookmarks yet</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Articles you bookmark will appear here. Click the bookmark icon on any article to save it for later.
                  </p>
                  <Link href="/" className="mt-4">
                    <Button>Browse News</Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {bookmarks.map((bookmark, index) => renderArticleCard({ ...bookmark, type: "bookmark" }, index))}
              </div>
            )}
          </TabsContent>

          {/* Liked Tab */}
          <TabsContent value="liked" className="mt-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mr-3" />
                <span className="text-muted-foreground">Loading liked articles...</span>
              </div>
            ) : likedArticles.length === 0 ? (
              <Card className="border-dashed border-white/20 bg-[var(--news-bg-secondary)]/50">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Heart className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2 font-serif">No liked articles yet</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Articles you like will appear here. Click the heart icon on any article to show your appreciation.
                  </p>
                  <Link href="/" className="mt-4">
                    <Button>Browse News</Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {likedArticles.map((liked, index) => renderArticleCard({ ...liked, type: "liked" }, index))}
              </div>
            )}
          </TabsContent>

          {/* Reading Queue Tab */}
          <TabsContent value="queue" className="mt-0">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-serif font-bold">Articles to Read</h2>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={generateQueueDigest}
                    disabled={digestLoading || queuedArticles.length === 0}
                  >
                    {digestLoading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="w-4 h-4 mr-2" /> Reading Digest</>
                    )}
                  </Button>
                  <Badge className="text-base px-3 py-1">{queuedArticles.length}</Badge>
                </div>
              </div>

              {showDigest && queueDigest && (
                <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
                  <CardContent className="p-6 prose prose-invert max-w-none">
                    <ReactMarkdown>{queueDigest}</ReactMarkdown>
                  </CardContent>
                </Card>
              )}

              {queuedArticles.length === 0 ? (
                <Card className="border-dashed border-white/20 bg-[var(--news-bg-secondary)]/50">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <List className="w-12 h-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2 font-serif">Your queue is empty</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Add articles to your reading queue from your saved items or directly from the news feed.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {queuedArticles.map((article, index) => (
                    <div
                      key={article.url}
                      className="group relative rounded-2xl border border-white/10 bg-[var(--news-bg-secondary)] p-4 transition-all hover:border-primary/50"
                      style={{
                        marginLeft: `${Math.min(index * 4, 16)}px`,
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex-shrink-0 text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center"
                          style={{
                            backgroundColor: "var(--primary)",
                            color: "var(--primary-foreground)",
                          }}
                        >
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 
                            className="font-bold font-serif text-sm leading-tight cursor-pointer hover:text-primary"
                            onClick={() => handleArticleClick(article)}
                          >
                            {article.title}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            {article.source}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleArticleClick(article)}
                            >
                              Read
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeArticleFromQueue(article.url)}
                            >
                              <Trash2 className="w-4 h-4 mr-1" /> Remove
                            </Button>
                          </div>
                        </div>
                        {hasRealImage(article.image) && (
                          <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden">
                            <img
                              src={article.image}
                              alt={article.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
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
