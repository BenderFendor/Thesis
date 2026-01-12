"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Globe, MapPin, ExternalLink, Star, Clock, Newspaper, AlertTriangle, Bug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ArticleDetailModal } from "@/components/article-detail-modal"
import { SourceResearchPanel } from "@/components/source-research-panel"
import { type NewsSource, type NewsArticle, getSourceById } from "@/lib/api"
import { isDebugMode } from "@/lib/logger"
import { useFavorites } from "@/hooks/useFavorites"
import { useNewsStream } from "@/hooks/useNewsStream"

interface SourcePageProps {
  params: { sourceId: string }
}

export default function SourcePage({ params }: SourcePageProps) {
  const sourceId = decodeURIComponent(params.sourceId)
  const router = useRouter()
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [allArticles, setAllArticles] = useState<NewsArticle[]>([])
  const [debugMode, setDebugModeState] = useState(false)
  const { isFavorite, toggleFavorite } = useFavorites()

  const { data: source, isLoading: sourceLoading, error: sourceError } = useQuery({
    queryKey: ["source", sourceId],
    queryFn: () => getSourceById(sourceId),
    staleTime: 1000 * 60 * 5,
  })

  const onUpdate = useCallback((articles: NewsArticle[]) => {
    setAllArticles(articles)
  }, [])

  const { isStreaming } = useNewsStream({
    onUpdate,
    autoStart: true,
    useCache: true,
  })

  const articles = useMemo(() => {
    return allArticles.filter(article => article.sourceId === sourceId)
  }, [allArticles, sourceId])

  const articlesLoading = isStreaming && allArticles.length === 0

  useEffect(() => {
    setDebugModeState(isDebugMode())
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "thesis_debug_mode") {
        setDebugModeState(isDebugMode())
      }
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const getBiasColor = (bias: string) => {
    switch (bias) {
      case "left": return "bg-blue-500/10 text-blue-400 border-blue-500/20"
      case "center": return "bg-white/5 text-muted-foreground border-white/10"
      case "right": return "bg-red-500/10 text-red-400 border-red-500/20"
      default: return "bg-white/5 text-muted-foreground border-white/10"
    }
  }

  const getCredibilityColor = (credibility: string) => {
    switch (credibility) {
      case "high": return "bg-primary/10 text-primary border-primary/20"
      case "medium": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
      case "low": return "bg-red-500/10 text-red-400 border-red-500/20"
      default: return "bg-white/5 text-muted-foreground border-white/10"
    }
  }

  const hasRealImage = (src?: string | null) => {
    if (!src) return false
    const trimmed = src.trim()
    if (!trimmed) return false
    const lower = trimmed.toLowerCase()
    return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg")
  }

  const handleArticleClick = (article: NewsArticle) => {
    setSelectedArticle(article)
    setModalOpen(true)
  }

  if (sourceLoading) {
    return (
      <div className="min-h-screen bg-[var(--news-bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-foreground animate-in fade-in duration-500">
          <div className="h-px w-24 bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-pulse" />
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Loading Source</div>
        </div>
      </div>
    )
  }

  if (sourceError || !source) {
    return (
      <div className="min-h-screen bg-[var(--news-bg-primary)] flex flex-col items-center justify-center gap-6">
        <div className="p-4 rounded-full bg-yellow-500/10 border border-yellow-500/20">
          <AlertTriangle className="w-6 h-6 text-yellow-500" />
        </div>
        <div className="text-center space-y-2">
          <p className="font-serif text-xl text-foreground">Source Unavailable</p>
          <p className="text-sm text-muted-foreground font-mono">{sourceError ? "Failed to load source data" : "Source not found"}</p>
        </div>
        <Button variant="outline" onClick={() => router.back()} className="border-white/10 bg-transparent hover:bg-white/5 text-[10px] font-mono uppercase tracking-[0.3em]">
          <ArrowLeft className="w-3 h-3 mr-2" />
          Return
        </Button>
      </div>
    )
  }

  const websiteHostname = source.url ? (() => {
    try {
      return new URL(source.url).hostname
    } catch {
      return undefined
    }
  })() : undefined

  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)] text-foreground flex flex-col">
      {/* Top Header - Minimal */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[var(--news-bg-primary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--news-bg-primary)]/80">
        <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => router.back()}
              className="h-8 px-2 text-muted-foreground hover:text-foreground hover:bg-white/5"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em]">Back</span>
            </Button>
            
            <div className="h-4 w-px bg-white/10" />
            
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-lg font-bold tracking-tight">{source.name}</h1>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleFavorite(source.id)}
                className="h-6 w-6 rounded-full hover:bg-white/5"
              >
                <Star
                  className={`w-3.5 h-3.5 transition-colors ${
                    isFavorite(source.id) ? "fill-primary text-primary" : "text-muted-foreground"
                  }`}
                />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`rounded-sm px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] ${getCredibilityColor(source.credibility)}`}>
              {source.credibility} Credibility
            </Badge>
            <Badge variant="outline" className={`rounded-sm px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] ${getBiasColor(source.bias)}`}>
              {source.bias} Bias
            </Badge>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Sidebar - Fixed height, fits in viewport */}
          <div className="lg:col-span-3">
            <div className="sticky top-20 flex flex-col gap-4 max-h-[calc(100vh-6rem)] overflow-hidden">
              {/* Source Info Card */}
              <div className="rounded-lg border border-white/10 bg-[var(--news-bg-secondary)] p-4 shrink-0">
                <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground block mb-3">
                  Overview
                </span>
                
                <div className="space-y-3">
                  <div className="grid grid-cols-[70px_1fr] gap-2 text-sm">
                    <span className="text-muted-foreground text-xs flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" /> Origin
                    </span>
                    <span className="text-foreground text-xs">{source.country}</span>
                  </div>
                  
                  <div className="grid grid-cols-[70px_1fr] gap-2 text-sm">
                    <span className="text-muted-foreground text-xs flex items-center gap-1.5">
                      <Globe className="w-3 h-3" /> Lang
                    </span>
                    <span className="uppercase text-foreground text-xs">{source.language}</span>
                  </div>
                  
                  {source.category && source.category.length > 0 && (
                    <div className="grid grid-cols-[70px_1fr] gap-2 text-sm">
                      <span className="text-muted-foreground text-xs flex items-center gap-1.5">
                        <Newspaper className="w-3 h-3" /> Focus
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {source.category.slice(0, 3).map((cat) => (
                          <span key={cat} className="inline-flex items-center rounded-sm bg-white/5 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-white/10">
                  <Button asChild variant="outline" size="sm" className="justify-center border-white/10 bg-transparent hover:bg-white/5 text-[9px] h-7">
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Site
                    </a>
                  </Button>
                  
                  {debugMode && (
                    <Button asChild variant="outline" size="sm" className="justify-center border-white/10 bg-transparent hover:bg-white/5 text-[9px] h-7">
                      <Link href={`/sources/${encodeURIComponent(source.name)}/debug`}>
                        <Bug className="w-3 h-3 mr-1" />
                        Debug
                      </Link>
                    </Button>
                  )}
                </div>
              </div>

              {/* Research Panel - Scrollable */}
              <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-secondary)]">
                <SourceResearchPanel
                  sourceName={source.name}
                  website={websiteHostname}
                />
              </div>
            </div>
          </div>

          {/* Main Content - Articles Grid */}
          <div className="lg:col-span-9 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <h2 className="font-serif text-2xl font-medium tracking-tight">Latest Coverage</h2>
              <div className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  {articlesLoading ? "Syncing..." : `${articles.length} Stories`}
                </span>
              </div>
            </div>

            {articlesLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {[...Array(6)].map((_, i) => (
                  <div key={i} className="aspect-[4/3] bg-[var(--news-bg-secondary)] rounded-lg border border-white/10 animate-pulse" />
                ))}
              </div>
            ) : articles.length === 0 ? (
              <div className="py-24 text-center border border-dashed border-white/10 rounded-lg">
                <p className="text-muted-foreground font-serif italic">No recent coverage found from this source.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence mode="popLayout">
                  {articles.map((article, i) => (
                    <motion.div
                      key={article.url || article.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3, delay: i * 0.03 }}
                    >
                      <Card
                        className="group relative border border-white/10 bg-[var(--news-bg-secondary)] rounded-lg cursor-pointer overflow-hidden hover:border-white/20 hover:bg-[#1a1a1a] transition-all h-full"
                        onClick={() => handleArticleClick(article)}
                      >
                        <div className="aspect-[16/9] w-full overflow-hidden bg-white/5 relative">
                          {hasRealImage(article.image) ? (
                            <img
                              src={article.image}
                              alt=""
                              className="w-full h-full object-cover grayscale transition-all duration-500 group-hover:grayscale-0 group-hover:scale-105 opacity-80 group-hover:opacity-100"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-white/5">
                               <Newspaper className="w-8 h-8 text-white/10" />
                            </div>
                          )}
                          
                          {/* Overlay Gradient */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                          
                          {/* Category Badge on Image */}
                          <div className="absolute top-3 left-3">
                            <Badge variant="secondary" className="bg-black/50 backdrop-blur border-white/10 text-[9px] font-mono uppercase tracking-wider text-white hover:bg-black/70">
                              {article.category}
                            </Badge>
                          </div>
                        </div>

                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                             <Clock className="w-3 h-3" />
                             {new Date(article.publishedAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                          </div>
                          
                          <h3 className="font-serif text-base font-medium leading-snug group-hover:text-primary transition-colors line-clamp-2">
                            {article.title}
                          </h3>
                          
                          <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2">
                            {article.summary}
                          </p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </main>

      <ArticleDetailModal
        article={selectedArticle}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  )
}
