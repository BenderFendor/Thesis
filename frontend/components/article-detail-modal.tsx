"use client"

import { useState, useEffect, useMemo } from "react"
import { X, ExternalLink, Heart, Bookmark, AlertTriangle, DollarSign, Bug, Link as LinkIcon, Rss, Sparkles, Maximize2, Minimize2, Loader2, Search, RefreshCw, CheckCircle2, XCircle, Copy, PlusCircle, MinusCircle, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { type NewsArticle, getSourceById, type NewsSource, fetchSourceDebugData, type SourceDebugData, analyzeArticle, type ArticleAnalysis, API_BASE_URL, createBookmark, deleteBookmark, performAgenticSearch, type FactCheckResult } from "@/lib/api"
import { useReadingQueue } from "@/hooks/useReadingQueue"
import { useFavorites } from "@/hooks/useFavorites"
import { useInlineDefinition } from "@/hooks/useInlineDefinition"
import InlineDefinition from "@/components/inline-definition"

type FactCheckStatus = FactCheckResult["verification_status"]
type FactCheckStatusFilter = FactCheckStatus | "all"

const VERIFICATION_STYLE_MAP: Record<FactCheckStatus, string> = {
  verified: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/40",
  "partially-verified": "bg-amber-500/15 text-amber-200 border border-amber-500/40",
  unverified: "bg-slate-600/20 text-slate-200 border border-slate-500/40",
  false: "bg-rose-500/15 text-rose-200 border border-rose-500/40"
}

const VERIFICATION_LABEL_MAP: Record<FactCheckStatus, string> = {
  verified: "verified",
  "partially-verified": "partially verified",
  unverified: "unverified",
  false: "false"
}

const STATUS_FILTERS: FactCheckStatusFilter[] = ["all", "verified", "partially-verified", "unverified", "false"]

interface ArticleDetailModalProps {
  article: NewsArticle | null
  isOpen: boolean
  onClose: () => void
  initialIsBookmarked?: boolean
  onBookmarkChange?: (articleId: number, isBookmarked: boolean) => void
}

export function ArticleDetailModal({ article, isOpen, onClose, initialIsBookmarked = false, onBookmarkChange }: ArticleDetailModalProps) {
  const [isLiked, setIsLiked] = useState(false)
  const [isBookmarked, setIsBookmarked] = useState(initialIsBookmarked)
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue()
  const { isFavorite, toggleFavorite } = useFavorites()
  const [showSourceDetails, setShowSourceDetails] = useState(false)
  const [source, setSource] = useState<NewsSource | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugData, setDebugData] = useState<SourceDebugData | null>(null)
  const [matchedEntryIndex, setMatchedEntryIndex] = useState<number | null>(null)
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [fullArticleText, setFullArticleText] = useState<string | null>(null)
  const [articleLoading, setArticleLoading] = useState(false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [claimsOpen, setClaimsOpen] = useState(false)
  const [activeStatusFilter, setActiveStatusFilter] = useState<FactCheckStatusFilter>("all")
  const [selectedClaim, setSelectedClaim] = useState<FactCheckResult | null>(null)
  const [agenticLoading, setAgenticLoading] = useState(false)
  const [agenticAnswer, setAgenticAnswer] = useState<string | null>(null)
  const [agenticError, setAgenticError] = useState<string | null>(null)
  const [agenticHistory, setAgenticHistory] = useState<Array<{ claim: string; answer: string; timestamp: number }>>([])

  useEffect(() => {
    const loadSource = async () => {
      if (!article) return
      
      setSourceLoading(true)
      try {
        const fetchedSource = await getSourceById(article.sourceId)
        setSource(fetchedSource || null)
      } catch (error) {
        console.error('Failed to load source:', error)
        setSource(null)
      } finally {
        setSourceLoading(false)
      }
    }
    
    if (isOpen && article) {
      loadSource()
    }
  }, [isOpen, article])

  useEffect(() => {
    if (article) {
      setIsBookmarked(initialIsBookmarked)
    }
  }, [initialIsBookmarked, article?.id])

  // Load full article text immediately when modal opens
  useEffect(() => {
    const loadFullArticle = async () => {
      if (!article) return
      
      setArticleLoading(true)
      setFullArticleText(null)
      
      try {
        // Use the newspaper library endpoint to get full article text
        const response = await fetch(`${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`)
        if (response.ok) {
          const data = await response.json()
          setFullArticleText(data.text || data.full_text || null)
        }
      } catch (e) {
        console.error('Failed to fetch full article:', e)
      } finally {
        setArticleLoading(false)
      }
    }
    
    if (isOpen && article) {
      loadFullArticle()
    }
  }, [article?.url, isOpen])

  // Auto-load AI analysis when modal opens (background)
  useEffect(() => {
    setDebugOpen(false)
    setDebugData(null)
    setMatchedEntryIndex(null)
    setAiAnalysis(null)
    setClaimsOpen(false)
    setSelectedClaim(null)
    setAgenticAnswer(null)
    setAgenticError(null)
    setAgenticHistory([])
    setActiveStatusFilter("all")
    
    if (isOpen && article) {
      loadAiAnalysis()
    }
  }, [article?.url, isOpen])

  useEffect(() => {
    if (!claimsOpen) {
      setSelectedClaim(null)
      setAgenticAnswer(null)
      setAgenticError(null)
      setActiveStatusFilter("all")
      return
    }

    if (!selectedClaim && aiAnalysis?.fact_check_results?.length) {
      setSelectedClaim(aiAnalysis.fact_check_results[0])
    }
  }, [claimsOpen, aiAnalysis?.fact_check_results, selectedClaim])

  const loadDebug = async () => {
    if (!article) return
    try {
      setDebugLoading(true)
      const data = await fetchSourceDebugData(article.source)
      setDebugData(data)
      // Try to match entry by link, else by title
      let idx: number | null = null
      if (data?.parsed_entries?.length) {
        idx = data.parsed_entries.findIndex(e => e.link === article.url)
        if (idx === -1) {
          const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
          const at = norm(article.title)
          idx = data.parsed_entries.findIndex(e => norm(e.title) === at)
        }
        if (idx === -1) idx = null
      }
      setMatchedEntryIndex(idx)
    } catch (e) {
      console.error('Failed to fetch debug data:', e)
      setDebugData(null)
      setMatchedEntryIndex(null)
    } finally {
      setDebugLoading(false)
    }
  }

  const loadAiAnalysis = async () => {
    if (!article) return
    try {
      setAiAnalysisLoading(true)
      const analysis = await analyzeArticle(article.url, article.source)
      setAiAnalysis(analysis)
    } catch (e) {
      console.error('Failed to analyze article:', e)
      setAiAnalysis({
        success: false,
        article_url: article.url,
        error: e instanceof Error ? e.message : 'Failed to analyze article'
      })
    } finally {
      setAiAnalysisLoading(false)
    }
  }

  const runAgenticSearch = async (claim: FactCheckResult | null) => {
    if (!claim) return

    setAgenticLoading(true)
    setAgenticAnswer(null)
    setAgenticError(null)

    try {
      const enrichedQuery = [
        `Fact-check this claim: ${claim.claim}`,
        article?.title ? `Article title: ${article.title}` : null,
        article?.source ? `Publisher: ${article.source}` : null,
        claim.evidence ? `Existing evidence summary: ${claim.evidence}` : null,
        "Respond with a concise verification summary and cite authoritative sources."
      ]
        .filter(Boolean)
        .join(" \n")

      const response = await performAgenticSearch(enrichedQuery, 10)

      if (response.success && response.answer) {
        setAgenticAnswer(response.answer)
        setAgenticHistory((prev) => [{ claim: claim.claim, answer: response.answer, timestamp: Date.now() }, ...prev].slice(0, 5))
      } else {
        setAgenticError("Agentic search returned no direct answer. Try again or open the research workspace for a deeper dive.")
      }
    } catch (error) {
      setAgenticError(error instanceof Error ? error.message : "Agentic search failed.")
    } finally {
      setAgenticLoading(false)
    }
  }

  const handleBookmarkToggle = async () => {
    if (!article?.id) return

    setBookmarkLoading(true)
    try {
      if (isBookmarked) {
        await deleteBookmark(article.id)
        setIsBookmarked(false)
        onBookmarkChange?.(article.id, false)
      } else {
        await createBookmark(article.id)
        setIsBookmarked(true)
        onBookmarkChange?.(article.id, true)
      }
    } catch (error) {
      console.error('Failed to toggle bookmark:', error)
    } finally {
      setBookmarkLoading(false)
    }
  }

  const factCheckResults = !isOpen || !article ? [] : (aiAnalysis?.fact_check_results ?? [])

  const statusCounts = useMemo(() => {
    return factCheckResults.reduce(
      (acc, result) => {
        acc[result.verification_status] = (acc[result.verification_status] ?? 0) + 1
        return acc
      },
      {
        verified: 0,
        "partially-verified": 0,
        unverified: 0,
        false: 0
      } as Record<FactCheckStatus, number>
    )
  }, [factCheckResults])

  const filteredClaims = useMemo(() => {
    if (activeStatusFilter === "all") return factCheckResults
    return factCheckResults.filter((claim) => claim.verification_status === activeStatusFilter)
  }, [factCheckResults, activeStatusFilter])

  const getConfidenceColor = (confidence: FactCheckResult["confidence"]) => {
    switch (confidence) {
      case "high":
        return "bg-emerald-500/15 text-emerald-200 border border-emerald-500/40"
      case "medium":
        return "bg-amber-500/15 text-amber-200 border border-amber-500/40"
      case "low":
        return "bg-rose-500/15 text-rose-200 border border-rose-500/40"
      default:
        return "bg-slate-600/20 text-slate-200 border border-slate-500/40"
    }
  }

  const getCredibilityColor = (credibility: string) => {
    switch (credibility) {
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

  // Inline definition hook (highlight → popover)
  const { result: inlineResult, open: inlineOpen, setOpen: setInlineOpen, anchorRef: inlineAnchorRef } = useInlineDefinition()

  const getBiasColor = (bias: string) => {
    switch (bias) {
      case "left":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30"
      case "center":
        return "bg-gray-500/20 text-gray-400 border-gray-500/30"
      case "right":
        return "bg-red-500/20 text-red-400 border-red-500/30"
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30"
    }
  }

  if (!isOpen || !article) return null

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      {/* Inline Definition Popover */}
      <InlineDefinition
        result={inlineResult}
        open={inlineOpen}
        setOpen={setInlineOpen}
        anchorRef={inlineAnchorRef}
      />
      <div className={`bg-black border border-gray-800 rounded-lg transition-all duration-300 ${
        isExpanded 
          ? 'w-full h-full max-w-none max-h-none overflow-y-auto' 
          : 'max-w-4xl w-full max-h-[90vh] overflow-hidden'
      }`}>
        {/* Header Controls */}
        <div className="flex items-center justify-end gap-2 p-4 border-b border-gray-800 sticky top-0 bg-black z-10">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsExpanded(!isExpanded)}
            className="bg-black/50 hover:bg-black/70 backdrop-blur-sm border border-gray-800"
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClose}
            className="bg-black/50 hover:bg-black/70 backdrop-blur-sm border border-gray-800"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content Wrapper */}
        <div className={isExpanded ? "" : "overflow-y-auto max-h-[calc(90vh-80px)]"}>        
        {/* Hero Image Section */}
        <div className={`relative bg-gradient-to-b from-gray-900 to-black overflow-hidden ${
          isExpanded ? 'h-[60vh] min-h-[400px]' : 'h-48'
        }`}>
          <img 
            src={article.image || "/placeholder.svg"} 
            alt={article.title} 
            className="w-full h-full object-cover opacity-60" 
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
          
          {/* Hero Content */}
          <div className="absolute inset-0 flex flex-col justify-end">
            <div className="max-w-5xl mx-auto w-full px-8 pb-12">
              {/* Badges */}
              <div className="flex items-center gap-3 mb-6">
                <Badge className={getCredibilityColor(article.credibility)}>
                  {article.credibility.toUpperCase()} CREDIBILITY
                </Badge>
                <Badge className={getBiasColor(article.bias)}>{article.bias.toUpperCase()} BIAS</Badge>
              </div>
              
              {/* Title */}
              <h1 className={`font-bold text-white mb-6 leading-tight font-serif ${
                isExpanded ? 'text-5xl md:text-6xl' : 'text-2xl md:text-3xl'
              }`}>
                {article.title}
              </h1>
              
              {/* Meta */}
              <div className="flex items-center gap-4 text-sm text-gray-300">
                <span className="font-medium">{article.source}</span>
                <span>•</span>
                <span>{article.publishedAt}</span>
                <span>•</span>
                <span>{article.country}</span>
                {article.translated && (
                  <>
                    <span>•</span>
                    <Badge variant="outline" className="text-xs">
                      Translated from {article.originalLanguage.toUpperCase()}
                    </Badge>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className={isExpanded ? "max-w-5xl mx-auto px-8 py-12" : "px-6 py-6"}>
          {/* Summary Quote */}
          <div className={isExpanded ? "mb-12 border-l-4 border-emerald-500 pl-6 py-2" : "mb-6 border-l-4 border-emerald-500 pl-4 py-2"}>
            <p className={`text-gray-200 leading-relaxed font-light italic ${
              isExpanded ? 'text-2xl' : 'text-lg'
            }`}>
              "{article.summary}"
            </p>
          </div>

          {/* Two Column Layout */}
          <div className={`grid gap-8 ${
            isExpanded ? 'grid-cols-1 lg:grid-cols-3 gap-12' : 'grid-cols-1'
          }`}>
            {/* Main Article Content - 2/3 width */}
            <div className={isExpanded ? "lg:col-span-2 space-y-8" : "space-y-6"}>
              {/* Full Article Content - Show immediately */}
              <div className={isExpanded ? "prose prose-invert prose-lg max-w-none" : "prose prose-invert max-w-none"}>
                <h2 className={`font-bold text-white mb-6 font-serif ${
                  isExpanded ? 'text-3xl' : 'text-xl'
                }`}>Full Article</h2>
                
                {articleLoading ? (
                  <div className="flex items-center gap-3 p-6 bg-gray-900/50 rounded-lg border border-gray-800">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-400"></div>
                    <p className="text-gray-400">Loading full article text...</p>
                  </div>
                ) : fullArticleText ? (
                  <div className={`text-gray-300 leading-relaxed whitespace-pre-wrap ${
                    isExpanded ? 'text-lg space-y-6' : 'text-base space-y-4'
                  }`}>
                    {fullArticleText}
                  </div>
                ) : (
                  <div className={`text-gray-300 leading-relaxed space-y-4 ${
                    isExpanded ? 'text-lg space-y-6' : 'text-base'
                  }`}>
                    {article.content || article.summary}
                  </div>
                )}
              </div>

              {/* AI Analysis Note - Only show if AI provides additional insights */}
              {aiAnalysis?.full_text && aiAnalysis.full_text !== fullArticleText && aiAnalysis.full_text !== article.content && (
                <div className="bg-purple-500/5 border border-purple-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-purple-400" />
                    <h3 className="text-sm font-semibold text-white">AI Enhanced Version Available</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">AI has extracted an enhanced version of this article with better formatting.</p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-purple-400 hover:text-purple-300">Show AI Version</summary>
                    <div className="mt-3 text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {aiAnalysis.full_text}
                    </div>
                  </details>
                </div>
              )}

              {/* Tags */}
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-3">Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {article.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-6 border-t border-gray-800">
                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsLiked(!isLiked)}
                    className={isLiked ? "text-red-400" : "text-gray-400"}
                  >
                    <Heart className={`h-4 w-4 mr-2 ${isLiked ? "fill-current" : ""}`} />
                    Like
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => article && toggleFavorite(article.sourceId)}
                    className={article && isFavorite(article.sourceId) ? "text-yellow-400" : "text-gray-400"}
                    title={article && isFavorite(article.sourceId) ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Star className={`h-4 w-4 mr-2 ${article && isFavorite(article.sourceId) ? "fill-current" : ""}`} />
                    Favorite
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBookmarkToggle}
                    className={isBookmarked ? "text-yellow-400" : "text-gray-400"}
                    disabled={bookmarkLoading}
                  >
                    <Bookmark className={`h-4 w-4 ${isBookmarked ? "fill-current" : ""}`} />
                    Bookmark
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (article && isArticleInQueue(article.url)) {
                        removeArticleFromQueue(article.url)
                      } else if (article) {
                        addArticleToQueue(article)
                      }
                    }}
                    className={article && isArticleInQueue(article.url) ? "text-blue-400" : "text-gray-400"}
                  >
                    {article && isArticleInQueue(article.url) ? (
                      <MinusCircle className="h-4 w-4 mr-2" />
                    ) : (
                      <PlusCircle className="h-4 w-4 mr-2" />
                    )}
                    {article && isArticleInQueue(article.url) ? "Remove from Queue" : "Add to Queue"}
                  </Button>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Read Original
                  </a>
                </Button>
              </div>
            </div>

            {/* Sidebar - 1/3 width - Only show in expanded mode */}
            {isExpanded && (
            <div className="lg:col-span-1 space-y-6">
              {/* AI Analysis - Integrated */}
              {aiAnalysis && aiAnalysis.success && (
                <div className="sticky top-6 space-y-6">
                  {/* AI Summary */}
                  {aiAnalysis.summary && (
                    <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg p-6">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="h-5 w-5 text-purple-400" />
                        <h3 className="text-lg font-semibold text-white">AI Summary</h3>
                      </div>
                      <p className="text-gray-300 leading-relaxed text-sm">{aiAnalysis.summary}</p>
                    </div>
                  )}

                  {/* Bias Analysis */}
                  {aiAnalysis.bias_analysis && (
                    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-400" />
                        Bias Analysis
                      </h3>
                      {aiAnalysis.bias_analysis.overall_bias_score && (
                        <div className="mb-3">
                          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                            Score: {aiAnalysis.bias_analysis.overall_bias_score}/10
                          </Badge>
                        </div>
                      )}
                      <div className="space-y-3 text-sm">
                        <div>
                          <span className="text-gray-400">Tone:</span>
                          <p className="text-white mt-1">{aiAnalysis.bias_analysis.tone_bias}</p>
                        </div>
                        <div>
                          <span className="text-gray-400">Framing:</span>
                          <p className="text-white mt-1">{aiAnalysis.bias_analysis.framing_bias}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Source Analysis */}
                  {aiAnalysis.source_analysis && (
                    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-white mb-4">Source Info</h3>
                      <div className="space-y-3 text-sm">
                        <div>
                          <span className="text-gray-400">Credibility:</span>
                          <p className="text-white mt-1">{aiAnalysis.source_analysis.credibility_assessment}</p>
                        </div>
                        <div>
                          <span className="text-gray-400">Political Leaning:</span>
                          <p className="text-white mt-1">{aiAnalysis.source_analysis.political_leaning}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Fact Check Results Preview */}
                  {factCheckResults.length > 0 && (
                    <Dialog open={claimsOpen} onOpenChange={setClaimsOpen}>
                      <DialogTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedClaim && factCheckResults.length) {
                              setSelectedClaim(factCheckResults[0])
                            }
                          }}
                          className="group relative w-full overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-emerald-500/10 to-emerald-500/0 p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-emerald-400/60 hover:shadow-[0_0_30px_rgba(16,185,129,0.25)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                          aria-label="Open verified claims report"
                        >
                          <div className="pointer-events-none absolute -right-20 -top-20 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl transition-opacity duration-500 group-hover:opacity-60" />
                          <div className="mb-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Sparkles className="h-5 w-5 text-emerald-300 transition-transform duration-300 group-hover:rotate-3" />
                              <h3 className="text-lg font-semibold text-emerald-100">Fact Check Results</h3>
                            </div>
                            <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100/90">
                              {factCheckResults.length} claims
                            </span>
                          </div>
                          <div className="space-y-3">
                            {factCheckResults.slice(0, 3).map((result, index) => (
                              <div
                                key={`${result.claim}-${index}`}
                                className="flex items-start gap-3 rounded-lg border border-transparent bg-emerald-500/10 p-3 transition-all duration-300 group-hover:border-emerald-400/40"
                              >
                                <Badge className={`${VERIFICATION_STYLE_MAP[result.verification_status]} text-[0.65rem] uppercase tracking-wide`}>
                                  {VERIFICATION_LABEL_MAP[result.verification_status]}
                                </Badge>
                                <p className="text-sm text-emerald-50/85 line-clamp-2">"{result.claim}"</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-5 flex items-center justify-between text-xs text-emerald-100/70">
                            <span>Click to review the full verification report</span>
                            <div className="flex items-center gap-2 font-semibold">
                              <span>Open</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </div>
                          </div>
                        </button>
                      </DialogTrigger>

                      <DialogContent className="sm:max-w-2xl border border-emerald-500/30 bg-slate-950/95 text-slate-100 shadow-2xl shadow-emerald-500/10">
                        <DialogHeader className="space-y-1">
                          <DialogTitle className="flex items-center gap-2 text-emerald-100">
                            <Sparkles className="h-5 w-5 text-emerald-300" />
                            Verified Claims
                          </DialogTitle>
                          <p className="text-xs text-emerald-200/70">
                            Cross-check statements, filter by confidence, and trigger live agentic research for additional corroboration.
                          </p>
                        </DialogHeader>

                        <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_1fr]">
                          <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                              {STATUS_FILTERS.map((status) => {
                                const isAll = status === "all"
                                const count = isAll ? factCheckResults.length : statusCounts[status as FactCheckStatus]
                                const isDisabled = !isAll && count === 0
                                const isActive = activeStatusFilter === status

                                return (
                                  <button
                                    key={status}
                                    type="button"
                                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-all ${isActive ? "border-emerald-400 bg-emerald-500/15 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.25)]" : "border-emerald-500/20 text-emerald-200/75 hover:border-emerald-400/40 hover:text-emerald-100"} ${isDisabled ? "cursor-not-allowed opacity-40 hover:border-emerald-500/20 hover:text-emerald-200/75" : "cursor-pointer"}`}
                                    onClick={() => {
                                      if (isDisabled) return
                                      setActiveStatusFilter(status)
                                    }}
                                  >
                                    {status === "all" ? "All" : VERIFICATION_LABEL_MAP[status as FactCheckStatus]}
                                    <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-100/80">
                                      {count}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>

                            <div>
                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-200/70">Claims</h4>
                              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                                {filteredClaims.map((claim, index) => {
                                  const isActive = selectedClaim?.claim === claim.claim
                                  return (
                                    <button
                                      key={`${claim.claim}-${index}`}
                                      type="button"
                                      className={`w-full rounded-lg border bg-slate-900/70 p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/60 hover:shadow-lg hover:shadow-emerald-500/10 ${isActive ? "border-emerald-400/60 shadow-lg shadow-emerald-500/20" : "border-slate-800/80"}`}
                                      onClick={() => {
                                        setSelectedClaim(claim)
                                        setAgenticAnswer(null)
                                        setAgenticError(null)
                                      }}
                                    >
                                      <div className="flex items-center gap-2">
                                        <Badge className={`${VERIFICATION_STYLE_MAP[claim.verification_status]} text-[0.6rem] uppercase tracking-wide`}>
                                          {VERIFICATION_LABEL_MAP[claim.verification_status]}
                                        </Badge>
                                        <span className="text-xs text-emerald-100/80 line-clamp-2">{claim.claim}</span>
                                      </div>
                                    </button>
                                  )
                                })}

                                {filteredClaims.length === 0 && (
                                  <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-4 text-xs text-slate-300/70">
                                    No claims in this category yet. Try another filter.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            {selectedClaim ? (
                              <div className="space-y-4">
                                <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-inner shadow-emerald-500/10">
                                  <div className="mb-4 flex items-start justify-between gap-3">
                                    <Badge className={`${VERIFICATION_STYLE_MAP[selectedClaim.verification_status]} text-[0.65rem] uppercase tracking-wide`}>
                                      {VERIFICATION_LABEL_MAP[selectedClaim.verification_status]}
                                    </Badge>
                                    <Badge className={`${getConfidenceColor(selectedClaim.confidence)} text-[0.65rem] uppercase tracking-wide`}>
                                      confidence: {selectedClaim.confidence}
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-emerald-50/90">"{selectedClaim.claim}"</p>
                                  {selectedClaim.notes && (
                                    <p className="mt-3 text-xs text-slate-300/80">{selectedClaim.notes}</p>
                                  )}
                                  <div className="mt-4 space-y-2">
                                    <h5 className="text-xs font-semibold uppercase tracking-wide text-emerald-200/60">Evidence</h5>
                                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-200/80">
                                      {selectedClaim.evidence || "Evidence details not provided."}
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-300/70">
                                      {selectedClaim.sources?.slice(0, 4).map((source, idx) => (
                                        <a
                                          key={`${source}-${idx}`}
                                          href={source}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="group/link inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 transition hover:border-emerald-400/60 hover:text-emerald-100"
                                        >
                                          <LinkIcon className="h-3 w-3" />
                                          <span className="max-w-[12rem] truncate">{source}</span>
                                          <ExternalLink className="h-3 w-3 transition group-hover/link:translate-x-0.5" />
                                        </a>
                                      ))}
                                      {(!selectedClaim.sources || selectedClaim.sources.length === 0) && (
                                        <span className="rounded-full border border-slate-700 px-3 py-1">No sources provided</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1 transition hover:border-emerald-400/60 hover:text-emerald-100"
                                      onClick={() => {
                                        if (typeof navigator !== "undefined") {
                                          navigator.clipboard.writeText(`${selectedClaim.claim}\n\nEvidence: ${selectedClaim.evidence ?? "N/A"}`).catch(() => null)
                                        }
                                      }}
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                      Copy claim
                                    </button>
                                    <Button variant="outline" size="sm" asChild>
                                      <a
                                        href={`/search?query=${encodeURIComponent(selectedClaim.claim)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <Search className="mr-1 h-3.5 w-3.5" />
                                        Open research workspace
                                      </a>
                                    </Button>
                                  </div>
                                </div>

                                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-5">
                                  <div className="mb-3 flex items-start justify-between gap-3">
                                    <div>
                                      <h4 className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
                                        <Search className="h-4 w-4" /> Live Agentic Research
                                      </h4>
                                      <p className="text-xs text-emerald-200/70">
                                        Run the LangChain agent with enriched context to surface the latest corroborating evidence.
                                      </p>
                                    </div>
                                    {agenticHistory.length > 0 && (
                                      <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-wide text-emerald-200/80">
                                        Last run {new Date(agenticHistory[0].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      onClick={() => runAgenticSearch(selectedClaim)}
                                      disabled={agenticLoading}
                                      className="inline-flex items-center gap-2"
                                    >
                                      {agenticLoading ? (
                                        <>
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                          Researching
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="h-4 w-4" />
                                          Agentic Research
                                        </>
                                      )}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="inline-flex items-center gap-2 text-emerald-200/80 hover:text-emerald-100"
                                      onClick={() => runAgenticSearch(selectedClaim)}
                                      disabled={agenticLoading}
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" />
                                      Retry
                                    </Button>
                                  </div>

                                  {agenticError && (
                                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                                      <XCircle className="mt-0.5 h-4 w-4" />
                                      <span>{agenticError}</span>
                                    </div>
                                  )}

                                  {agenticAnswer && (
                                    <div className="mt-4 space-y-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                                      <div className="flex items-start gap-2 text-xs uppercase tracking-wide text-emerald-200/70">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4" />
                                        Agent response
                                      </div>
                                      <p className="whitespace-pre-line text-sm leading-relaxed text-emerald-50/90">{agenticAnswer}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-slate-800/80 bg-slate-900/70 p-6 text-center text-sm text-slate-300/70">
                                <Sparkles className="h-6 w-6 text-emerald-300" />
                                <p>Select a claim from the list to view its evidence and run deeper research.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}

                  {/* Fact Check Suggestions */}
                  {aiAnalysis.fact_check_suggestions && aiAnalysis.fact_check_suggestions.length > 0 && (
                    <div className="bg-cyan-500/5 border border-cyan-500/30 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-white mb-3">Fact Check</h3>
                      <ul className="space-y-2 text-sm">
                        {aiAnalysis.fact_check_suggestions.slice(0, 3).map((suggestion, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <span className="text-cyan-400 mt-1">•</span>
                            <span className="text-gray-300">{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Source Transparency */}
              <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-400" />
                    Source
                  </h3>
                  <Button variant="outline" size="sm" onClick={() => setShowSourceDetails(!showSourceDetails)}>
                    {showSourceDetails ? "Hide" : "Show"}
                  </Button>
                </div>

                {sourceLoading ? (
                  <div className="flex items-center justify-center p-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  </div>
                ) : source ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-green-400" />
                      <span className="text-gray-400">Funding:</span>
                      <span className="text-white text-xs">{source.funding?.join(", ") || "N/A"}</span>
                    </div>

                    {showSourceDetails && (
                      <div className="space-y-3 pt-3 border-t border-gray-700 text-sm">
                        <div>
                          <span className="text-gray-400">Publisher:</span>
                          <span className="text-white ml-2">{source.name}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">Country:</span>
                          <span className="text-white ml-2">{source.country}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">Source info unavailable</p>
                )}

                {/* Debug Button */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => { setDebugOpen(!debugOpen); if (!debugOpen) loadDebug(); }}
                  className="w-full mt-4"
                >
                  <Bug className="h-4 w-4 mr-1" /> {debugOpen ? "Hide" : "Show"} Debug
                </Button>

                {/* Debug Panel */}
                {debugOpen && (
                  <div className="mt-4 p-4 bg-black/40 rounded border border-gray-800">
                    {debugLoading ? (
                      <div className="flex items-center justify-center p-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      </div>
                    ) : debugData ? (
                      <div className="space-y-2 text-xs">
                        <div className="text-gray-400">Entries: {debugData.feed_status?.entries_count}</div>
                        <div className="text-gray-400">Has Images: {debugData.image_analysis?.entries_with_images}/{debugData.image_analysis?.total_entries}</div>
                        {matchedEntryIndex !== null && (
                          <div className="text-emerald-400">Matched at index: {matchedEntryIndex}</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-400 text-xs">No debug data</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Compact AI Loading Indicator */}
            {!isExpanded && aiAnalysisLoading && (
              <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-400"></div>
                <p className="text-sm text-gray-400">AI is analyzing article in background...</p>
              </div>
            )}

            {/* Compact AI Summary - Show when not expanded */}
            {!isExpanded && aiAnalysis?.summary && (
              <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  <h3 className="text-sm font-semibold text-white">AI Summary</h3>
                </div>
                <p className="text-gray-300 leading-relaxed text-sm">{aiAnalysis.summary}</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsExpanded(true)}
                  className="mt-3 w-full"
                >
                  <Maximize2 className="h-4 w-4 mr-2" />
                  Expand for Full AI Analysis
                </Button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
