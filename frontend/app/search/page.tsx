"use client"

import { useState } from "react"
import { Search, Sparkles, Loader2, Brain, Database, Globe, CheckCircle, AlertCircle, Newspaper } from "lucide-react"
import { performNewsResearch, ThinkingStep } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"

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
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Brain className="h-8 w-8 text-emerald-500" />
          <h1 className="text-4xl font-bold">News Research Assistant</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          AI-powered analysis of your news articles with transparent reasoning
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Search through articles, compare sources, and analyze coverage with visible chain-of-thought
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Ask me anything..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 h-12 text-base"
              disabled={isSearching}
            />
          </div>
          <Button 
            type="submit" 
            size="lg"
            disabled={isSearching || !query.trim()}
            className="px-6"
          >
            {isSearching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Search
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Sample Queries */}
      {!result && !isSearching && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg">Try these sample queries</CardTitle>
            <CardDescription>
              Click on any query to see how the agentic search works
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sampleQueries.map((sample, index) => (
              <button
                key={index}
                onClick={() => handleSampleQuery(sample)}
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent hover:border-accent-foreground transition-colors"
              >
                <div className="flex items-start gap-2">
                  <Search className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm">{sample}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isSearching && (
        <Card className="mb-8">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-emerald-500" />
              <div className="text-center">
                <p className="font-medium">Research in progress...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Searching through articles and analyzing coverage
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && !isSearching && (
        <div className="space-y-4">
          {/* Research Stats */}
          {result.success && (
            <div className="flex gap-2 items-center justify-center text-sm text-muted-foreground">
              <Database className="h-4 w-4" />
              <span>Searched {result.articles_searched} articles</span>
              {result.thinking_steps.length > 0 && (
                <>
                  <span className="mx-2">•</span>
                  <Brain className="h-4 w-4" />
                  <span>{result.thinking_steps.length} reasoning steps</span>
                </>
              )}
            </div>
          )}

          {/* Chain of Thought */}
          {result.success && result.thinking_steps.length > 0 && showThinking && (
            <Card className="border-emerald-200 dark:border-emerald-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-4 w-4 text-emerald-500" />
                  Agent's Reasoning Process
                </CardTitle>
                <CardDescription>
                  See how the AI agent analyzed your question
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.thinking_steps.map((step, index) => {
                  const getStepIcon = () => {
                    switch (step.type) {
                      case 'action': return <Sparkles className="h-4 w-4 text-blue-500" />
                      case 'tool_start': return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />
                      case 'observation': return <CheckCircle className="h-4 w-4 text-green-500" />
                      case 'answer': return <Newspaper className="h-4 w-4 text-emerald-500" />
                      default: return <Brain className="h-4 w-4 text-gray-500" />
                    }
                  }

                  return (
                    <div key={index} className="flex gap-3 p-3 rounded-lg bg-muted/50">
                      <div className="flex-shrink-0 mt-0.5">
                        {getStepIcon()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {step.type.replace('_', ' ')}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(step.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{step.content}</p>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          {/* Final Answer */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <CardTitle className="text-lg mb-1">Research Results</CardTitle>
                  <CardDescription className="text-base">
                    {result.query}
                  </CardDescription>
                </div>
                {result.success && (
                  <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2 py-1 rounded-full">
                    <CheckCircle className="h-3 w-3" />
                    <span>Complete</span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {result.success ? (
                <div className="prose dark:prose-invert max-w-none">
                  <p className="whitespace-pre-wrap text-foreground leading-relaxed">
                    {result.answer}
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-4 rounded-lg border border-destructive bg-destructive/10">
                  <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive mb-1">Research Failed</p>
                    <p className="text-sm text-muted-foreground">
                      {result.error || "An error occurred while processing your query"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setQuery("")
                setResult(null)
              }}
            >
              <Search className="mr-2 h-4 w-4" />
              New Research
            </Button>
            {result.thinking_steps.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => setShowThinking(!showThinking)}
              >
                <Brain className="mr-2 h-4 w-4" />
                {showThinking ? 'Hide' : 'Show'} Reasoning
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Info Card */}
      <Card className="mt-8 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            How News Research Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <strong className="text-foreground">1. Article Database Search:</strong>
            <p className="text-muted-foreground mt-1">
              The agent searches through all articles in the platform, analyzing titles, content, sources, and categories.
            </p>
          </div>
          <div>
            <strong className="text-foreground">2. Source Coverage Analysis:</strong>
            <p className="text-muted-foreground mt-1">
              Compare how different news sources cover topics, identify bias, and understand diverse perspectives.
            </p>
          </div>
          <div>
            <strong className="text-foreground">3. Transparent Reasoning:</strong>
            <p className="text-muted-foreground mt-1">
              See exactly how the AI agent thinks - which tools it uses, what it finds, and how it reaches conclusions.
            </p>
          </div>
          <div>
            <strong className="text-foreground">4. Web Search Fallback:</strong>
            <p className="text-muted-foreground mt-1">
              When needed, the agent can search the web for additional context or background information.
            </p>
          </div>
          <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800">
            <p className="text-xs text-muted-foreground">
              Powered by LangChain + Google Gemini 2.0 Flash • Searching {result?.articles_searched || 'your'} articles
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
