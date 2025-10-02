"use client"

import { useState } from "react"
import { Search, Sparkles, Loader2, Brain, Database, Globe, CheckCircle, AlertCircle, Newspaper, Settings, Bell, User, Activity, Home, ArrowLeft } from "lucide-react"
import { performNewsResearch, ThinkingStep, type NewsArticle } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArticleDetailModal } from "@/components/article-detail-modal"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Link from "next/link"

interface ResearchResult {
  success: boolean
  query: string
  answer: string
  thinking_steps: ThinkingStep[]
  articles_searched: number
  error?: string
}

export default function NewsResearchPage() {
  const [query, setQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [result, setResult] = useState<ResearchResult | null>(null)
  const [showThinking, setShowThinking] = useState(true)
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!query.trim()) return

    setIsSearching(true)
    setResult(null)

    try {
      const response = await performNewsResearch(query, showThinking)
      setResult(response)
    } catch (error) {
      setResult({
        success: false,
        query,
        answer: "",
        thinking_steps: [],
        articles_searched: 0,
        error: error instanceof Error ? error.message : "An error occurred"
      })
    } finally {
      setIsSearching(false)
    }
  }

  const sampleQueries = [
    "What are the different perspectives on climate change in our articles?",
    "Compare how different sources are covering technology news",
    "Summarize the latest political developments",
    "Which sources have covered artificial intelligence recently?",
    "Analyze bias in coverage of international conflicts"
  ]

  const handleSampleQuery = (sampleQuery: string) => {
    setQuery(sampleQuery)
  }

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
      {/* Header - Same as main page */}
      <header className="border-b fixed top-0 left-0 right-0 z-50 shadow-lg" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--news-bg-secondary)' }}>
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Globe className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-serif text-foreground">Scoop</h1>
                <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Multi-perspective news aggregation from around the globe</p>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Home className="w-4 h-4" />
                  Home
                </Button>
              </Link>
              <Link href="/sources">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Activity className="w-4 h-4" />
                  Sources
                </Button>
              </Link>
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="w-4 h-4" />
              </Button>
              <Link href="/settings">
                <Button variant="ghost" size="sm">
                  <Settings className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/profile">
                <Button variant="ghost" size="sm">
                  <User className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 pt-28 pb-12 max-w-5xl">
        {/* Page Header */}
        <div className="mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm mb-4 hover:text-primary transition-colors" style={{ color: 'var(--muted-foreground)' }}>
            <ArrowLeft className="w-4 h-4" />
            Back to News Grid
          </Link>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--primary)' }}>
              <Brain className="h-6 w-6" style={{ color: 'var(--primary-foreground)' }} />
            </div>
            <div>
              <h2 className="text-3xl font-bold font-serif">News Research Assistant</h2>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                AI-powered analysis with transparent chain-of-thought reasoning
              </p>
            </div>
          </div>
        </div>

        {/* Search Form */}
        <div className="mb-8">
          <form onSubmit={handleSearch}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5" style={{ color: 'var(--muted-foreground)' }} />
                <Input
                  type="text"
                  placeholder="Ask me anything about the news..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-12 h-14 text-base rounded-xl border-2 focus:border-primary transition-colors"
                  style={{ 
                    backgroundColor: 'var(--news-bg-secondary)', 
                    borderColor: 'var(--border)',
                  }}
                  disabled={isSearching}
                />
              </div>
              <Button 
                type="submit" 
                size="lg"
                disabled={isSearching || !query.trim()}
                className="px-8 h-14 rounded-xl gap-2"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5" />
                    Search
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>

        {/* Sample Queries */}
        {!result && !isSearching && (
          <div className="mb-8 p-6 rounded-xl border" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-1">Try these sample queries</h3>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Click on any query to see the AI research assistant in action
              </p>
            </div>
            <div className="space-y-2">
              {sampleQueries.map((sample, index) => (
                <button
                  key={index}
                  onClick={() => handleSampleQuery(sample)}
                  className="w-full text-left p-4 rounded-lg border hover:border-primary transition-all group"
                  style={{ 
                    backgroundColor: 'var(--card)', 
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform" style={{ backgroundColor: 'var(--muted)' }}>
                      <Search className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
                    </div>
                    <span className="text-sm leading-relaxed pt-1">{sample}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading State */}
        {isSearching && (
          <div className="mb-8 p-12 rounded-xl border" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
            <div className="flex flex-col items-center justify-center gap-6">
              <div className="relative">
                <div className="w-20 h-20 border-4 rounded-full" style={{ borderColor: 'var(--muted)' }}></div>
                <div className="absolute top-0 left-0 w-20 h-20 border-t-4 border-primary rounded-full animate-spin"></div>
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                  <Brain className="w-8 h-8 text-primary" />
                </div>
              </div>
              <div className="text-center">
                <p className="font-semibold text-lg mb-2">Research in progress...</p>
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Searching through articles and analyzing coverage
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {result && !isSearching && (
          <div className="space-y-6">
            {/* Research Stats */}
            {result.success && (
              <div className="flex gap-4 items-center justify-center text-sm p-4 rounded-lg" style={{ backgroundColor: 'var(--news-bg-secondary)', color: 'var(--muted-foreground)' }}>
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  <span>{result.articles_searched} articles searched</span>
                </div>
                {result.thinking_steps.length > 0 && (
                  <>
                    <span>•</span>
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      <span>{result.thinking_steps.length} reasoning steps</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Chain of Thought */}
            {result.success && result.thinking_steps.length > 0 && showThinking && (
              <div className="p-6 rounded-xl border" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--ring)' }}>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2 mb-1">
                    <Brain className="h-5 w-5 text-primary" />
                    Agent's Reasoning Process
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    See how the AI agent analyzed your question step-by-step
                  </p>
                </div>
                <div className="space-y-3">
                  {result.thinking_steps.map((step, index) => {
                    const getStepIcon = () => {
                      switch (step.type) {
                        case 'action': return <Sparkles className="h-4 w-4 text-blue-400" />
                        case 'tool_start': return <Loader2 className="h-4 w-4 text-yellow-400" />
                        case 'observation': return <CheckCircle className="h-4 w-4 text-green-400" />
                        case 'answer': return <Newspaper className="h-4 w-4 text-primary" />
                        default: return <Brain className="h-4 w-4 text-gray-400" />
                      }
                    }

                    const getStepLabel = (type: string) => {
                      switch (type) {
                        case 'action': return 'Action'
                        case 'tool_start': return 'Tool Execution'
                        case 'observation': return 'Observation'
                        case 'answer': return 'Final Answer'
                        default: return type.replace('_', ' ').charAt(0).toUpperCase() + type.slice(1)
                      }
                    }

                    // Parse JSON-like content for action steps
                    let displayContent = step.content
                    if (step.type === 'action' && step.content.includes('Input:')) {
                      try {
                        const toolMatch = step.content.match(/tool:\s*([^\n]+)/i)
                        const inputMatch = step.content.match(/Input:\s*([\s\S]+)/)
                        if (toolMatch && inputMatch) {
                          displayContent = `Using tool: ${toolMatch[1]}\n\nInput: ${inputMatch[1].trim()}`
                        }
                      } catch (e) {
                        // Keep original content if parsing fails
                      }
                    }

                    return (
                      <div key={index} className="flex gap-3 p-4 rounded-lg" style={{ backgroundColor: 'var(--muted)' }}>
                        <div className="flex-shrink-0 mt-0.5">
                          {getStepIcon()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="text-xs">
                              {getStepLabel(step.type)}
                            </Badge>
                            <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                              {new Date(step.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{displayContent}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Final Answer */}
            <div className="p-6 rounded-xl border" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
              <div className="mb-6 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-2">Research Results</h3>
                    <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                      {result.query}
                    </p>
                  </div>
                  {result.success && (
                    <Badge className="bg-primary/10 text-primary border-primary/20">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Complete
                    </Badge>
                  )}
                </div>
              </div>
              
              {result.success ? (
                <div className="prose prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground prose-a:text-primary prose-code:text-primary prose-pre:bg-muted/50">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {result.answer}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-4 rounded-lg border border-destructive" style={{ backgroundColor: 'var(--destructive)' + '10' }}>
                  <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-destructive mb-1">Research Failed</p>
                    <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                      {result.error || "An error occurred while processing your query"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-center gap-3">
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setQuery("")
                  setResult(null)
                }}
                className="gap-2"
              >
                <Search className="h-4 w-4" />
                New Research
              </Button>
              {result.thinking_steps.length > 0 && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => setShowThinking(!showThinking)}
                  className="gap-2"
                >
                  <Brain className="h-4 w-4" />
                  {showThinking ? 'Hide' : 'Show'} Reasoning
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Info Card */}
        <div className="mt-12 p-6 rounded-xl border" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--ring)' }}>
          <div className="mb-4">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              How News Research Works
            </h3>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <strong className="text-foreground">1. Article Database Search:</strong>
              <p className="mt-1" style={{ color: 'var(--muted-foreground)' }}>
                The agent searches through all articles in the platform, analyzing titles, content, sources, and categories.
              </p>
            </div>
            <div>
              <strong className="text-foreground">2. Source Coverage Analysis:</strong>
              <p className="mt-1" style={{ color: 'var(--muted-foreground)' }}>
                Compare how different news sources cover topics, identify bias, and understand diverse perspectives.
              </p>
            </div>
            <div>
              <strong className="text-foreground">3. Transparent Reasoning:</strong>
              <p className="mt-1" style={{ color: 'var(--muted-foreground)' }}>
                See exactly how the AI agent thinks - which tools it uses, what it finds, and how it reaches conclusions.
              </p>
            </div>
            <div>
              <strong className="text-foreground">4. Web Search Fallback:</strong>
              <p className="mt-1" style={{ color: 'var(--muted-foreground)' }}>
                When needed, the agent can search the web for additional context or background information.
              </p>
            </div>
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                Powered by LangChain + Google Gemini 2.0 Flash • Searching {result?.articles_searched || 'your'} articles
              </p>
            </div>
          </div>
        </div>
      </main>

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
