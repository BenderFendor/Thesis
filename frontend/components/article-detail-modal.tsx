"use client"

import { useState, useEffect } from "react"
import { X, ExternalLink, Heart, Bookmark, AlertTriangle, DollarSign, Bug, Link as LinkIcon, Rss, Sparkles, Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { type NewsArticle, getSourceById, type NewsSource, fetchSourceDebugData, type SourceDebugData, analyzeArticle, type ArticleAnalysis, API_BASE_URL } from "@/lib/api"
import { ArticleAnalysisDisplay } from "@/components/article-analysis"

interface ArticleDetailModalProps {
  article: NewsArticle | null
  isOpen: boolean
  onClose: () => void
}

export function ArticleDetailModal({ article, isOpen, onClose }: ArticleDetailModalProps) {
  const [isLiked, setIsLiked] = useState(false)
  const [isBookmarked, setIsBookmarked] = useState(false)
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
    
    if (isOpen && article) {
      loadAiAnalysis()
    }
  }, [article?.url, isOpen])

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

  if (!isOpen || !article) return null

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

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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
                    onClick={() => setIsBookmarked(!isBookmarked)}
                    className={isBookmarked ? "text-yellow-400" : "text-gray-400"}
                  >
                    <Bookmark className={`h-4 w-4 ${isBookmarked ? "fill-current" : ""}`} />
                    Bookmark
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
                  {aiAnalysis.fact_check_results && aiAnalysis.fact_check_results.length > 0 && (
                    <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-emerald-400" />
                        Fact Check Results
                      </h3>
                      <div className="space-y-3">
                        {aiAnalysis.fact_check_results.slice(0, 3).map((result, index) => (
                          <div key={index} className="text-sm">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={
                                result.verification_status === 'verified' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                                result.verification_status === 'partially-verified' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                                result.verification_status === 'false' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                                'bg-gray-500/20 text-gray-400 border-gray-500/30'
                              }>
                                {result.verification_status.replace('-', ' ')}
                              </Badge>
                            </div>
                            <p className="text-gray-300 text-xs line-clamp-2">"{result.claim}"</p>
                          </div>
                        ))}
                        {aiAnalysis.fact_check_results.length > 3 && (
                          <p className="text-xs text-gray-400 mt-2">
                            +{aiAnalysis.fact_check_results.length - 3} more verified claims
                          </p>
                        )}
                      </div>
                    </div>
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
