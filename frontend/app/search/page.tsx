"use client"

import { useState, useRef, useEffect } from "react"
import { Search, Sparkles, Loader2, Brain, Database, Globe, CheckCircle, AlertCircle, Newspaper, Settings, Bell, User, Activity, Home, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react"
import { performNewsResearch, ThinkingStep, type NewsArticle } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArticleDetailModal } from "@/components/article-detail-modal"
import { ArticleInlineEmbed } from "@/components/article-inline-embed"
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

interface Message {
  id: string
  type: 'user' | 'assistant'
  content: string
  thinking_steps?: ThinkingStep[]
  articles_searched?: number
  timestamp: Date
  error?: boolean
}

export default function NewsResearchPage() {
  const [query, setQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [expandedThinking, setExpandedThinking] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!query.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: query,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setQuery("")
    setIsSearching(true)

    try {
      const response = await performNewsResearch(userMessage.content, true)
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: response.answer,
        thinking_steps: response.thinking_steps,
        articles_searched: response.articles_searched,
        timestamp: new Date(),
        error: !response.success
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: error instanceof Error ? error.message : "An error occurred while processing your request.",
        timestamp: new Date(),
        error: true
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsSearching(false)
      inputRef.current?.focus()
    }
  }

  const sampleQueries = [
    "What are the different perspectives on climate change?",
    "Compare how different sources cover technology news",
    "Summarize the latest political developments",
    "Which sources have covered AI recently?",
    "Analyze bias in coverage of international conflicts"
  ]

  const handleSampleQuery = (sampleQuery: string) => {
    setQuery(sampleQuery)
    inputRef.current?.focus()
  }

  const toggleThinking = (messageId: string) => {
    setExpandedThinking(prev => prev === messageId ? null : messageId)
  }

  const extractUrls = (text: string): string[] => {
    const urlRegex = /https?:\/\/[\w.-]+(?:\/[\w\-./?%&=+#]*)?/gi
    const matches = text.match(urlRegex) || []
    // de-duplicate
    return Array.from(new Set(matches))
  }

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
      {/* Header - Minimal */}
      <header className="border-b fixed top-0 left-0 right-0 z-50 backdrop-blur-lg" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--news-bg-secondary)' + 'E6' }}>
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <ArrowLeft className="w-4 h-4" style={{ color: 'var(--muted-foreground)' }} />
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Back</span>
            </Link>
            
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-semibold">News Research</h1>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm">
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col pt-16">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto px-4 py-8 max-w-4xl">

            {/* Welcome State */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6" style={{ backgroundColor: 'var(--primary)' + '20' }}>
                  <Brain className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold mb-2">News Research Assistant</h2>
                <p className="text-sm mb-8" style={{ color: 'var(--muted-foreground)' }}>
                  Ask me anything about the news. I'll search through articles and provide analysis.
                </p>
                
                {/* Sample Queries */}
                <div className="w-full max-w-2xl space-y-2">
                  <p className="text-xs font-medium mb-3" style={{ color: 'var(--muted-foreground)' }}>Try asking:</p>
                  {sampleQueries.map((sample, index) => (
                    <button
                      key={index}
                      onClick={() => handleSampleQuery(sample)}
                      className="w-full text-left p-3 rounded-lg border hover:border-primary transition-all text-sm"
                      style={{ 
                        backgroundColor: 'var(--news-bg-secondary)', 
                        borderColor: 'var(--border)',
                      }}
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((message) => (
              <div key={message.id} className="mb-6">
                {message.type === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] p-4 rounded-2xl" style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                      <p className="text-sm leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] space-y-3">
                      {/* Assistant Message */}
                      <div className="p-4 rounded-2xl border" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
                        {message.error ? (
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{message.content}</p>
                          </div>
                        ) : (
                          <div className="prose prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-foreground prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground prose-a:text-primary prose-code:text-primary prose-pre:bg-muted/50 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                strong: ({node, ...props}) => <span className="font-semibold" {...props} />,
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>

                      {/* Inline Article Embeds */}
                      {(() => {
                        const urls = extractUrls(message.content)
                        if (urls.length === 0) return null
                        return (
                          <div className="space-y-2">
                            {urls.map((u) => (
                              <ArticleInlineEmbed
                                key={u}
                                url={u}
                                onOpen={(article) => { setSelectedArticle(article); setIsArticleModalOpen(true) }}
                              />
                            ))}
                          </div>
                        )
                      })()}
                      
                      {/* Metadata */}
                      {message.articles_searched !== undefined && (
                        <div className="flex items-center gap-3 text-xs px-2" style={{ color: 'var(--muted-foreground)' }}>
                          <div className="flex items-center gap-1">
                            <Database className="w-3 h-3" />
                            <span>{message.articles_searched} articles</span>
                          </div>
                          {message.thinking_steps && message.thinking_steps.length > 0 && (
                            <>
                              <span>•</span>
                              <button
                                onClick={() => toggleThinking(message.id)}
                                className="flex items-center gap-1 hover:text-primary transition-colors"
                              >
                                <Brain className="w-3 h-3" />
                                <span>{message.thinking_steps.length} reasoning steps</span>
                                {expandedThinking === message.id ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      
                      {/* Thinking Steps */}
                      {message.thinking_steps && expandedThinking === message.id && (
                        <div className="p-4 rounded-xl border space-y-2" style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)' }}>
                          <div className="flex items-center gap-2 mb-3">
                            <Brain className="w-4 h-4 text-primary" />
                            <span className="text-xs font-medium">Agent's Reasoning Process</span>
                          </div>
                          {message.thinking_steps.map((step, index) => {
                            const getStepIcon = () => {
                              switch (step.type) {
                                case 'action': return <Sparkles className="h-3 w-3 text-blue-400" />
                                case 'tool_start': return <Loader2 className="h-3 w-3 text-yellow-400" />
                                case 'observation': return <CheckCircle className="h-3 w-3 text-green-400" />
                                case 'answer': return <Newspaper className="h-3 w-3 text-primary" />
                                default: return <Brain className="h-3 w-3 text-gray-400" />
                              }
                            }

                            const getStepLabel = (type: string) => {
                              switch (type) {
                                case 'action': return 'Action'
                                case 'tool_start': return 'Tool'
                                case 'observation': return 'Result'
                                case 'answer': return 'Answer'
                                default: return type
                              }
                            }

                            let displayContent = step.content
                            if (step.type === 'action' && step.content.includes('Input:')) {
                              try {
                                const toolMatch = step.content.match(/tool:\s*([^\n]+)/i)
                                const inputMatch = step.content.match(/Input:\s*([\s\S]+)/)
                                if (toolMatch && inputMatch) {
                                  displayContent = `Using tool: ${toolMatch[1]}\n\nInput: ${inputMatch[1].trim()}`
                                }
                              } catch (e) {
                                // Keep original
                              }
                            }

                            return (
                              <div key={index} className="flex gap-2 p-2 rounded text-xs" style={{ backgroundColor: 'var(--news-bg-secondary)' }}>
                                <div className="flex-shrink-0 mt-0.5">
                                  {getStepIcon()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-xs">{getStepLabel(step.type)}</span>
                                    <span style={{ color: 'var(--muted-foreground)' }}>
                                      {new Date(step.timestamp).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                                    {displayContent}
                                  </p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Loading State */}
            {isSearching && (
              <div className="flex justify-start mb-6">
                <div className="max-w-[85%] p-4 rounded-2xl border" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Researching...</span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area - Fixed at bottom */}
        <div className="border-t backdrop-blur-lg" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--news-bg-secondary)' + 'E6' }}>
          <div className="container mx-auto px-4 py-4 max-w-4xl">
            <form onSubmit={handleSearch}>
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  type="text"
                  placeholder="Ask me anything about the news..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 h-12 text-sm rounded-xl border-2 focus:border-primary transition-colors"
                  style={{ 
                    backgroundColor: 'var(--news-bg-primary)', 
                    borderColor: 'var(--border)',
                  }}
                  disabled={isSearching}
                />
                <Button 
                  type="submit" 
                  size="lg"
                  disabled={isSearching || !query.trim()}
                  className="px-6 h-12 rounded-xl"
                >
                  {isSearching ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </form>
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
