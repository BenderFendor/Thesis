"use client"

import { useState, useEffect } from "react"
import { X, ExternalLink, Heart, Bookmark, AlertTriangle, DollarSign, Bug, Link as LinkIcon, Rss, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { type NewsArticle, getSourceById, type NewsSource, fetchSourceDebugData, type SourceDebugData, analyzeArticle, type ArticleAnalysis } from "@/lib/api"
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
  const [aiAnalysisOpen, setAiAnalysisOpen] = useState(false)
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis | null>(null)

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

  // Reset debugger state when article changes or modal opens
  useEffect(() => {
    setDebugOpen(false)
    setDebugData(null)
    setMatchedEntryIndex(null)
    setAiAnalysisOpen(false)
    setAiAnalysis(null)
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
        return "bg-primary/15 text-primary border-primary/30"
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
      <div className="bg-black border border-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Badge className={getCredibilityColor(article.credibility)}>
              {article.credibility.toUpperCase()} CREDIBILITY
            </Badge>
            <Badge className={getBiasColor(article.bias)}>{article.bias.toUpperCase()} BIAS</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Article Image */}
          <div className="relative h-64 bg-gray-900">
            <img src={article.image || "/placeholder.svg"} alt={article.title} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          <div className="p-6">
            {/* Title and Meta */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-white mb-3">{article.title}</h1>
              <div className="flex items-center gap-4 text-sm text-gray-400 mb-4">
                <span>{article.source}</span>
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

            {/* Article Content */}
            <div className="prose prose-invert max-w-none mb-8">
              <p className="text-lg text-gray-300 leading-relaxed mb-6">{article.summary}</p>
              <div className="text-gray-300 leading-relaxed">{article.content}</div>
            </div>

            {/* Source Information */}
            <div className="bg-gray-900/50 rounded-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-400" />
                  Source Transparency
                </h3>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => { setAiAnalysisOpen(true); loadAiAnalysis(); }}
                    className="bg-gradient-to-r from-primary/20 to-amber-500/20 hover:from-primary/30 hover:to-amber-500/30 border-primary/30"
                  >
                    <Sparkles className="h-4 w-4 mr-1" /> AI Analysis
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowSourceDetails(!showSourceDetails)}>
                    {showSourceDetails ? "Hide Details" : "Show Details"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setDebugOpen(true); loadDebug(); }}>
                    <Bug className="h-4 w-4 mr-1" /> Debug Images
                  </Button>
                </div>
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
                      <span className="text-white">{source.funding?.join(", ") || "Not available"}</span>
                    </div>

                    {showSourceDetails && (
                      <div className="space-y-3 pt-3 border-t border-gray-700">
                        <div className="text-sm">
                          <span className="text-gray-400">Publisher:</span>
                          <span className="text-white ml-2">{source.name}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-gray-400">Country:</span>
                          <span className="text-white ml-2">{source.country}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-gray-400">RSS Feed:</span>
                          <span className="text-blue-400 ml-2 font-mono text-xs">{source.rssUrl}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-gray-400">Categories:</span>
                          <span className="text-white ml-2">{source.category?.join(", ") || "General"}</span>
                        </div>

                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-3 mt-4">
                          <h4 className="text-yellow-400 font-medium mb-2">Funding Analysis</h4>
                          <p className="text-sm text-gray-300">
                            {source.funding?.some(f => f.includes("Government") || f.includes("State")) ? (
                              <>
                                This source receives government funding, which may influence editorial perspective.
                                Consider cross-referencing with independent sources.
                              </>
                            ) : source.funding?.some(f => f.includes("Subscription")) ? (
                              <>
                                This source is primarily funded by subscriptions, indicating editorial independence from
                                advertisers and government influence.
                              </>
                            ) : (
                              <>
                                This source uses mixed funding models. Review funding sources for potential editorial
                                influence.
                              </>
                            )}
                          </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center p-4">
                  <p className="text-gray-400">Source information not available</p>
                </div>
              )}
            </div>

            {/* AI Analysis Panel */}
            {aiAnalysisOpen && (
              <div className="bg-gray-900/60 rounded-lg p-6 mb-6 border border-primary/30">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" /> AI-Powered Article Analysis
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => setAiAnalysisOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {aiAnalysisLoading ? (
                  <div className="flex flex-col items-center justify-center p-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                    <p className="text-gray-400">Analyzing article with AI...</p>
                    <p className="text-sm text-gray-500 mt-2">This may take 10-30 seconds</p>
                  </div>
                ) : aiAnalysis ? (
                  <ArticleAnalysisDisplay analysis={aiAnalysis} />
                ) : (
                  <div className="text-gray-400 text-center p-6">No analysis available.</div>
                )}
              </div>
            )}

            {/* Debug Panel */}
            {debugOpen && (
              <div className="bg-gray-900/60 rounded-lg p-6 mb-6 border border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Bug className="h-5 w-5 text-primary" /> Image Debugger
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => setDebugOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {debugLoading ? (
                  <div className="flex items-center justify-center p-6">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  </div>
                ) : debugData ? (
                  <div className="space-y-4 text-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-3 bg-black/40 rounded border border-gray-800">
                        <h4 className="text-white font-medium mb-2">Feed</h4>
                        <div className="text-gray-400 flex items-center gap-2"><Rss className="h-4 w-4" /> {debugData.rss_url}</div>
                        <div className="text-gray-400">Entries: {debugData.feed_status?.entries_count}</div>
                        <div className="text-gray-400">Has Images: {debugData.image_analysis?.entries_with_images}/{debugData.image_analysis?.total_entries}</div>
                      </div>
                      <div className="p-3 bg-black/40 rounded border border-gray-800">
                        <h4 className="text-white font-medium mb-2">Cache Match</h4>
                        <div className="text-gray-400">Matched by: {matchedEntryIndex !== null ? 'link/title' : 'not found'}</div>
                        <div className="text-gray-400">Index: {matchedEntryIndex !== null ? matchedEntryIndex : '-'}</div>
                      </div>
                    </div>

                    {matchedEntryIndex !== null && debugData.parsed_entries?.[matchedEntryIndex] && (
                      <div className="p-3 bg-black/40 rounded border border-gray-800">
                        <h4 className="text-white font-medium mb-2">Parsed Entry</h4>
                        <div className="text-gray-300 mb-2">{debugData.parsed_entries[matchedEntryIndex].title}</div>
                        <div className="text-gray-400 break-all flex items-center gap-2"><LinkIcon className="h-4 w-4" /> {debugData.parsed_entries[matchedEntryIndex].link}</div>
                        <div className="text-gray-400 mt-2">Has Images: {debugData.parsed_entries[matchedEntryIndex].has_images ? 'yes' : 'no'}</div>
                        {debugData.parsed_entries[matchedEntryIndex].content_images?.length > 0 && (
                          <div className="mt-2">
                            <div className="text-gray-400">Content Images:</div>
                            <ul className="list-disc list-inside text-gray-400 text-xs space-y-1">
                              {debugData.parsed_entries[matchedEntryIndex].content_images.map((u, i) => (
                                <li key={i} className="break-all">{u}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {debugData.parsed_entries[matchedEntryIndex].description_images?.length > 0 && (
                          <div className="mt-2">
                            <div className="text-gray-400">Description Images:</div>
                            <ul className="list-disc list-inside text-gray-400 text-xs space-y-1">
                              {debugData.parsed_entries[matchedEntryIndex].description_images.map((u, i) => (
                                <li key={i} className="break-all">{u}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Raw JSON (collapsed) */}
                    <details className="p-3 bg-black/40 rounded border border-gray-800">
                      <summary className="cursor-pointer text-white">Raw Debug JSON</summary>
                      <pre className="mt-2 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(debugData, null, 2)}</pre>
                    </details>
                  </div>
                ) : (
                  <div className="text-gray-400">No debug data available.</div>
                )}
              </div>
            )}

            {/* Tags */}
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-400 mb-2">Tags</h4>
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
        </div>
      </div>
    </div>
  )
}
