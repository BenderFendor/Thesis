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
  referenced_articles?: NewsArticle[]
  timestamp: Date
  error?: boolean
  isStreaming?: boolean
  streamingStatus?: string
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
    const userQuery = query
    setQuery("")
    setIsSearching(true)

    // Create a placeholder assistant message for streaming updates
    const assistantId = (Date.now() + 1).toString()
    const streamingMessage: Message = {
      id: assistantId,
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
      streamingStatus: 'Starting research...'
    }
    setMessages(prev => [...prev, streamingMessage])

    try {
      // Use EventSource for SSE streaming
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const eventSource = new EventSource(
        `${baseUrl}/api/news/research/stream?query=${encodeURIComponent(userQuery)}&include_thinking=true`
      )

      const thinkingSteps: ThinkingStep[] = []
      let finalResult: any = null
      let lastMessageTime = Date.now()
      
      // Set up a timeout to detect stalled streams
      const stallTimeout = setInterval(() => {
        const timeSinceLastMessage = Date.now() - lastMessageTime
        if (timeSinceLastMessage > 60000) { // 60 seconds without any message
          clearInterval(stallTimeout)
          eventSource.close()
          setMessages(prev => prev.map(msg => 
            msg.id === assistantId 
              ? { 
                  ...msg, 
                  content: 'The request timed out. This may be due to API rate limits or server issues. Please try again in a moment.', 
                  error: true, 
                  isStreaming: false,
                  streamingStatus: undefined
                }
              : msg
          ))
          setIsSearching(false)
        }
      }, 5000) // Check every 5 seconds

      eventSource.onmessage = (event) => {
        lastMessageTime = Date.now() // Reset timeout on each message
        const data = JSON.parse(event.data)
        
        if (data.type === 'status') {
          // Update streaming status message
          setMessages(prev => prev.map(msg => 
            msg.id === assistantId 
              ? { ...msg, streamingStatus: data.message }
              : msg
          ))
        } else if (data.type === 'thinking_step') {
          // Collect thinking steps
          thinkingSteps.push(data.step)
          setMessages(prev => prev.map(msg => 
            msg.id === assistantId 
              ? { ...msg, thinking_steps: [...thinkingSteps], streamingStatus: `Processing: ${data.step.type}...` }
              : msg
          ))
        } else if (data.type === 'complete') {
          // Final result received
          clearInterval(stallTimeout)
          finalResult = data.result
          eventSource.close()
          
          // Convert backend articles to frontend format
          const referencedArticles = finalResult.referenced_articles?.map((article: any) => ({
            id: Date.now() + Math.random(),
            title: article.title || 'No title',
            source: article.source || 'Unknown',
            sourceId: (article.source || 'unknown').toLowerCase().replace(/\s+/g, '-'),
            country: 'United States',
            credibility: 'medium' as const,
            bias: 'center' as const,
            summary: article.description || 'No description',
            content: article.description || 'No description',
            image: article.image || "/placeholder.svg",
            publishedAt: article.published || new Date().toISOString(),
            category: article.category || 'general',
            url: article.link || '',
            likes: 0,
            comments: 0,
            shares: 0,
            tags: [article.category, article.source].filter(Boolean),
            originalLanguage: "en",
            translated: false
          })) || []
          
          // Update with final content
          setMessages(prev => prev.map(msg => 
            msg.id === assistantId 
              ? {
                  ...msg,
                  content: finalResult.answer,
                  thinking_steps: thinkingSteps,
                  articles_searched: finalResult.articles_searched,
                  referenced_articles: referencedArticles,
                  isStreaming: false,
                  streamingStatus: undefined,
                  error: !finalResult.success
                }
              : msg
          ))
          
          setIsSearching(false)
          inputRef.current?.focus()
        } else if (data.type === 'error') {
          clearInterval(stallTimeout)
          eventSource.close()
          
          // Check if it's an API rate limit error
          let errorMessage = data.message
          if (errorMessage.toLowerCase().includes('rate limit') || 
              errorMessage.toLowerCase().includes('quota') ||
              errorMessage.toLowerCase().includes('429')) {
            errorMessage = '⚠️ API Rate Limit: The AI service has reached its rate limit. Please wait a moment and try again.'
          }
          
          setMessages(prev => prev.map(msg => 
            msg.id === assistantId 
              ? { ...msg, content: errorMessage, error: true, isStreaming: false, streamingStatus: undefined }
              : msg
          ))
          setIsSearching(false)
        }
      }

      eventSource.onerror = (error) => {
        console.error('SSE error:', error)
        clearInterval(stallTimeout)
        eventSource.close()
        setMessages(prev => prev.map(msg => 
          msg.id === assistantId 
            ? { 
                ...msg, 
                content: '⚠️ Connection error. The server may be busy or experiencing rate limits. Please try again in a moment.', 
                error: true, 
                isStreaming: false,
                streamingStatus: undefined
              }
            : msg
        ))
        setIsSearching(false)
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: error instanceof Error ? error.message : "An error occurred while processing your request.",
        timestamp: new Date(),
        error: true
      }
      setMessages(prev => [...prev, errorMessage])
      setIsSearching(false)
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
    // Enhanced regex to capture URLs including those in parentheses and markdown links
    const urlRegex = /https?:\/\/[^\s\)]+/gi
    const matches = text.match(urlRegex) || []
    // de-duplicate and clean up
    return Array.from(new Set(matches.map(url => url.replace(/[,\.]$/, ''))))
  }

  const renderContentWithEmbeds = (content: string, articles: NewsArticle[]) => {
    if (!articles || articles.length === 0) {
      return (
        <div className="prose prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-foreground prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground prose-a:text-primary prose-code:text-primary prose-pre:bg-muted/50 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              strong: ({node, ...props}) => <span className="font-semibold" {...props} />,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )
    }

    // Replace URLs with article cards inline using a custom markdown component
    return (
      <div className="prose prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-foreground prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground prose-code:text-primary prose-pre:bg-muted/50 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={{
            strong: ({node, ...props}) => <span className="font-semibold" {...props} />,
            a: ({node, href, children, ...props}) => {
              // Check if this link matches one of our articles
              const article = articles.find(a => a.url === href)
              if (article) {
                return (
                  <button
                    onClick={() => { setSelectedArticle(article); setIsArticleModalOpen(true) }}
                    className="not-prose my-3 w-full border rounded-lg p-3 flex gap-3 items-start text-left hover:border-primary hover:bg-primary/5 transition-all duration-200 group"
                    style={{ backgroundColor: 'var(--news-bg-primary)', borderColor: 'var(--border)' }}
                  >
                    <div className="h-16 w-24 flex-shrink-0 overflow-hidden rounded-md bg-black/40 border" style={{ borderColor: 'var(--border)' }}>
                      <img src={article.image} alt="preview" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">{article.title}</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>{article.source}</div>
                    </div>
                  </button>
                )
              }
              // Regular link
              return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" {...props}>{children}</a>
            }
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
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
                      className="w-full text-left p-3 rounded-lg border hover:border-primary hover:bg-primary/5 hover:scale-[1.01] transition-all duration-200 text-sm group"
                      style={{ 
                        backgroundColor: 'var(--news-bg-secondary)', 
                        borderColor: 'var(--border)',
                      }}
                    >
                      <span className="group-hover:text-primary transition-colors">{sample}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((message) => (
              <div key={message.id} className="mb-6">
                {message.type === 'user' ? (
                  <div className="flex justify-end animate-in slide-in-from-right duration-300">
                    <div className="max-w-[80%] p-4 rounded-2xl hover:shadow-lg transition-shadow" style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                      <p className="text-sm leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-start animate-in slide-in-from-left duration-300">
                    <div className="max-w-[85%] space-y-3 w-full">
                      {/* Assistant Message with inline embeds */}
                      <div className="p-4 rounded-2xl border hover:shadow-lg transition-all duration-200" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
                        {message.isStreaming ? (
                          <div className="flex items-start gap-3">
                            <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm font-medium mb-1">Researching...</p>
                              <p className="text-xs animate-pulse" style={{ color: 'var(--muted-foreground)' }}>
                                {message.streamingStatus || 'Processing...'}
                              </p>
                            </div>
                          </div>
                        ) : message.error ? (
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{message.content}</p>
                          </div>
                        ) : (
                          renderContentWithEmbeds(message.content, message.referenced_articles || [])
                        )}
                      </div>
                      
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
                      
                      {/* Perplexity-style Thinking Steps */}
                      {message.thinking_steps && message.thinking_steps.length > 0 && expandedThinking === message.id && (
                        <div className="rounded-xl border overflow-hidden animate-in slide-in-from-top duration-300" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
                          <div className="p-3 border-b flex items-center gap-2" style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)' }}>
                            <Brain className="w-4 h-4 text-primary" />
                            <span className="text-xs font-semibold">Reasoning Process</span>
                          </div>
                          <div className="p-3 space-y-1">
                          {message.thinking_steps.map((step, index) => {
                            const getStepIcon = () => {
                              switch (step.type) {
                                case 'thought': return <Brain className="h-3 w-3 text-purple-400" />
                                case 'action': return <Sparkles className="h-3 w-3 text-blue-400" />
                                case 'tool_start': return <Loader2 className="h-3 w-3 text-yellow-400" />
                                case 'observation': return <CheckCircle className="h-3 w-3 text-green-400" />
                                case 'answer': return <Newspaper className="h-3 w-3 text-primary" />
                                default: return <Brain className="h-3 w-3 text-gray-400" />
                              }
                            }

                            const getStepLabel = (type: string) => {
                              switch (type) {
                                case 'thought': return 'Thinking'
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
                              <div key={index} className="flex gap-2 p-2 rounded hover:bg-muted/50 transition-colors duration-150 group">
                                <div className="flex-shrink-0 mt-0.5">
                                  {getStepIcon()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-xs group-hover:text-primary transition-colors">{getStepLabel(step.type)}</span>
                                    <span className="text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                                      {new Date(step.timestamp).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                                    {displayContent}
                                  </p>
                                </div>
                              </div>
                            )
                          })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Loading state is now shown inline in the streaming message */}
            
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
