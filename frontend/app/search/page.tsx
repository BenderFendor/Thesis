"use client"

import { useState, useRef, useEffect } from "react"
import {
  Search,
  Loader2,
  Brain,
  Database,
  Globe,
  CheckCircle,
  AlertCircle,
  Newspaper,
  Settings,
  Bell,
  User,
  Activity,
  Home,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Sparkles
  ,ChevronLeft, ChevronRight
} from "lucide-react"
import { API_BASE_URL, ThinkingStep, type NewsArticle, semanticSearch, type SemanticSearchResult } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArticleDetailModal } from "@/components/article-detail-modal"
import { ArticleInlineEmbed } from "@/components/article-inline-embed"
import HorizontalArticleEmbed from "@/components/horizontal-article-embed"
import ChatSidebar, { ChatSummary } from '@/components/chat-sidebar'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Link from "next/link"

interface ReferencedArticlePayload {
  title?: string
  source?: string
  description?: string
  image?: string
  published?: string
  category?: string
  link?: string
  tags?: string[]
  [key: string]: unknown
}

interface StructuredArticleSummary {
  title?: string
  summary?: string
  url?: string
  source?: string
  image?: string
  published?: string
  author?: string
  category?: string
  description?: string
  link?: string
  [key: string]: unknown
}

interface StructuredArticlesPayload {
  articles?: StructuredArticleSummary[]
  clusters?: Array<Record<string, unknown>>
  [key: string]: unknown
}

interface ResearchResult {
  success: boolean
  query: string
  answer: string
  thinking_steps: ThinkingStep[]
  articles_searched: number
  referenced_articles?: ReferencedArticlePayload[]
  structured_articles?: StructuredArticlesPayload
  error?: string
}

interface Message {
  id: string
  type: 'user' | 'assistant'
  content: string
  thinking_steps?: ThinkingStep[]
  articles_searched?: number
  referenced_articles?: NewsArticle[]
  structured_articles_json?: StructuredArticlesPayload  // New: Parsed JSON articles for grid display
  timestamp: Date
  error?: boolean
  isStreaming?: boolean
  streamingStatus?: string
  toolType?: 'semantic_search'
  semanticResults?: SemanticSearchResult[]
}

type StatusMessage = { type: 'status'; message: string }
type ThinkingStepMessage = { type: 'thinking_step'; step: ThinkingStep }
type ArticlesJsonMessage = { type: 'articles_json'; data: string }
type ReferencedArticlesMessage = { type: 'referenced_articles'; articles?: ReferencedArticlePayload[] }
type CompleteMessage = { type: 'complete'; result: ResearchResult }
type ErrorMessage = { type: 'error'; message?: string }
type UnknownMessage = { type: string; [key: string]: unknown }

type ResearchStreamMessage =
  | StatusMessage
  | ThinkingStepMessage
  | ArticlesJsonMessage
  | ReferencedArticlesMessage
  | CompleteMessage
  | ErrorMessage
  | UnknownMessage

const isStatusMessage = (message: ResearchStreamMessage): message is StatusMessage => message.type === 'status'
const isThinkingStepMessage = (message: ResearchStreamMessage): message is ThinkingStepMessage => message.type === 'thinking_step'
const isArticlesJsonMessage = (message: ResearchStreamMessage): message is ArticlesJsonMessage => message.type === 'articles_json'
const isReferencedArticlesMessage = (message: ResearchStreamMessage): message is ReferencedArticlesMessage => message.type === 'referenced_articles'
const isCompleteMessage = (message: ResearchStreamMessage): message is CompleteMessage => message.type === 'complete'
const isErrorMessage = (message: ResearchStreamMessage): message is ErrorMessage => message.type === 'error'

const CHAT_STORAGE_KEY = 'news-research.chat-state'
const CHAT_STORAGE_VERSION = 1

interface StoredChatState {
  version: number
  activeChatId?: string | null
  chats: ChatSummary[]
  messages: Record<string, (Omit<Message, 'timestamp'> & { timestamp: string })[]>
}

export default function NewsResearchPage() {
  const [query, setQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [expandedThinking, setExpandedThinking] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatMessagesMap, setChatMessagesMap] = useState<Record<string, Message[]>>({})
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isHydratingRef = useRef(true)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const handleNewChat = () => {
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    const newChat: ChatSummary = { id, title: 'Untitled research', lastMessage: '', updatedAt: new Date().toISOString() }
    setChats(prev => [newChat, ...prev])
    setChatMessagesMap(prev => ({ ...prev, [id]: [] }))
    setActiveChatId(id)
    setMessages([])
  }

  const toggleSidebar = () => setSidebarCollapsed(prev => !prev)

  const handleSelectChat = (id: string) => {
    setActiveChatId(id)
    setMessages(chatMessagesMap[id] || [])
  }

  const handleRenameChat = (id: string, title: string) => {
    setChats(prev => prev.map(chat => chat.id === id ? { ...chat, title } : chat))
  }

  const handleDeleteChat = (id: string) => {
    const remainingChats = chats.filter(chat => chat.id !== id)
    const nextChatId = activeChatId === id ? (remainingChats[0]?.id ?? null) : activeChatId
    const { [id]: _removed, ...restMessages } = chatMessagesMap

    setChats(remainingChats)
    setChatMessagesMap(restMessages)

    if (activeChatId === id) {
      setActiveChatId(nextChatId || null)
      setMessages(nextChatId ? (restMessages[nextChatId] || []) : [])
    }
  }

  // Hydrate chats from localStorage on first load
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = window.localStorage.getItem(CHAT_STORAGE_KEY)
      if (!stored) {
        return
      }

      const parsed = JSON.parse(stored) as StoredChatState
      if (!parsed || typeof parsed !== 'object') {
        return
      }

      if (parsed.version !== CHAT_STORAGE_VERSION) {
        // Future migration logic can go here; for now, ignore incompatible versions
        return
      }

      const revivedMessages: Record<string, Message[]> = {}
      Object.entries(parsed.messages || {}).forEach(([chatId, items]) => {
        revivedMessages[chatId] = items.map((item) => ({
          ...item,
          timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
          isStreaming: false,
        }))
      })

      setChats(parsed.chats || [])
      setChatMessagesMap(revivedMessages)

      const targetChatId = parsed.activeChatId && revivedMessages[parsed.activeChatId]
        ? parsed.activeChatId
        : (parsed.chats && parsed.chats.length > 0 ? parsed.chats[0].id : null)

      if (targetChatId) {
        setActiveChatId(targetChatId)
        setMessages(revivedMessages[targetChatId] || [])
      }
    } catch (error) {
      console.warn('Failed to hydrate chat history', error)
    } finally {
      // Allow dependent effects to run on the next tick to avoid treating hydration updates as user edits
      window.setTimeout(() => {
        isHydratingRef.current = false
      }, 0)
    }
  }, [])

  // Persist current messages into the active chat and update chat summary
  useEffect(() => {
    if (!activeChatId || isHydratingRef.current) return
    setChatMessagesMap(prev => ({ ...prev, [activeChatId]: messages }))
    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, lastMessage: messages.length ? (messages[messages.length - 1].content.slice(0, 200)) : '', updatedAt: new Date().toISOString() } : c))
  }, [messages, activeChatId])

  // Persist chats & messages to localStorage whenever they change (post-hydration)
  useEffect(() => {
    if (typeof window === 'undefined' || isHydratingRef.current) return

    try {
      const serializableMessages: StoredChatState['messages'] = {}
      Object.entries(chatMessagesMap).forEach(([chatId, items]) => {
        serializableMessages[chatId] = items.map((item) => ({
          ...item,
          timestamp: item.timestamp instanceof Date ? item.timestamp.toISOString() : new Date(item.timestamp).toISOString(),
        }))
      })

      const payload: StoredChatState = {
        version: CHAT_STORAGE_VERSION,
        activeChatId,
        chats,
        messages: serializableMessages,
      }

      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload))
    } catch (error) {
      console.warn('Failed to persist chat history', error)
    }
  }, [chats, chatMessagesMap, activeChatId])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedQuery = query.trim()
    if (!trimmedQuery) return

  // If there's no active chat, create one automatically and name it from the prompt.
  let newChatTitle: string | undefined = undefined
  if (!activeChatId) {
      // Prefer first sentence; fallback to first 4 words
      const firstSentence = (trimmedQuery.split(/[\.\n]/)[0] || '').trim()
      const firstFour = trimmedQuery.split(/\s+/).slice(0, 4).join(' ')
      const titleBase = firstSentence || firstFour || 'New Chat'
      const title = titleBase.slice(0, 60)
      const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
      const newChat = { id, title, lastMessage: trimmedQuery.slice(0, 120), updatedAt: new Date().toISOString() }
  // add the chat; seed an empty array — messages state (below) will be persisted into the chat via useEffect
  setChats(prev => [newChat, ...prev])
  setChatMessagesMap(prev => ({ ...prev, [id]: [] }))
      setActiveChatId(id)
      newChatTitle = title
    }

    const timestamp = Date.now()
  const assistantId = `assistant-${timestamp}`
    const semanticToolId = `semantic-${timestamp}`

    const userMessage: Message = {
      id: `user-${timestamp}`,
      type: 'user',
      content: trimmedQuery,
      timestamp: new Date()
    }

    const thinkingSteps: ThinkingStep[] = []
    let structuredArticles: StructuredArticlesPayload | undefined
  let finalResult: ResearchResult | undefined

    setMessages(prev => [...prev, userMessage])
    setQuery("")
    setIsSearching(true)


  // Include chat title in the initial assistant placeholder to give context (saves tokens vs re-requesting)
  const currentChatTitle = newChatTitle || chats.find(c => c.id === activeChatId)?.title || undefined
    const streamingPlaceholder: Message = {
      id: assistantId,
      type: 'assistant',
      content: currentChatTitle ? `Topic: ${currentChatTitle}` : "",
      timestamp: new Date(),
      isStreaming: true,
      streamingStatus: "Starting research..."
    }

    setMessages(prev => [...prev, streamingPlaceholder])

    semanticSearch(trimmedQuery, { limit: 6 })
      .then((response) => {
        const relevant = response.results
          .filter((result: SemanticSearchResult) => {
            const { article, similarityScore } = result
            if (!article?.summary) return false
            if (typeof similarityScore === 'number') {
              return similarityScore >= 0.55
            }
            return true
          })
          .slice(0, 5)

        if (relevant.length === 0) {
          return
        }

        const toolMessage: Message = {
          id: semanticToolId,
          type: 'assistant',
          content: 'Semantic search surfaced related coverage.',
          timestamp: new Date(),
          toolType: 'semantic_search',
          semanticResults: relevant
        }

        setMessages(prev => {
          const withoutExisting = prev.filter(msg => msg.id !== semanticToolId)
          const insertAt = withoutExisting.findIndex(msg => msg.id === assistantId)

          if (insertAt === -1) {
            return [...withoutExisting, toolMessage]
          }

          const next = [...withoutExisting]
          next.splice(insertAt, 0, toolMessage)
          return next
        })
      })
      .catch((error) => {
        console.warn('Semantic search unavailable:', error)
      })

    try {
      const streamUrl = new URL(`${API_BASE_URL}/api/news/research/stream`)
      streamUrl.searchParams.set('query', trimmedQuery)
      streamUrl.searchParams.set('include_thinking', 'true')

      const eventSource = new EventSource(streamUrl.toString())
      const stallTimeout = window.setTimeout(() => {
        setMessages(prev => prev.map(msg =>
          msg.id === assistantId
            ? { ...msg, streamingStatus: 'Still working — gathering more coverage...' }
            : msg
        ))
      }, 30000)

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ResearchStreamMessage

          if (isStatusMessage(data)) {
            setMessages(prev =>
              prev.map((msg) => {
                if (msg.id !== assistantId) {
                  return msg
                }
                return {
                  ...msg,
                  streamingStatus: data.message
                }
              })
            )
          } else if (isThinkingStepMessage(data)) {
            thinkingSteps.push(data.step)
            setMessages(prev =>
              prev.map((msg) => {
                if (msg.id !== assistantId) {
                  return msg
                }
                return {
                  ...msg,
                  thinking_steps: [...thinkingSteps],
                  streamingStatus: `Processing: ${data.step.type}...`
                }
              })
            )
          } else if (isArticlesJsonMessage(data)) {
            try {
              // Try parsing directly first (new backend format)
              let parsed: StructuredArticlesPayload | null = null
              try {
                parsed = JSON.parse(data.data) as StructuredArticlesPayload
              } catch (e) {
                // Fallback to regex if it's wrapped in markdown (old format)
                const jsonMatch = data.data.match(/```json:articles\n([\s\S]*?)\n```/)
                if (jsonMatch) {
                  parsed = JSON.parse(jsonMatch[1]) as StructuredArticlesPayload
                }
              }

              if (parsed) {
                structuredArticles = parsed
                setMessages(prev =>
                  prev.map((msg) => {
                    if (msg.id !== assistantId) {
                      return msg
                    }
                    return {
                      ...msg,
                      structured_articles_json: structuredArticles,
                      streamingStatus: 'Received article data...'
                    }
                  })
                )
              }
            } catch (jsonError) {
              console.error('Failed to parse structured articles:', jsonError)
            }
          } else if (isReferencedArticlesMessage(data)) {
            const referencedArticlesPayload: ReferencedArticlePayload[] = Array.isArray(data.articles) ? data.articles : []
            const referencedArticles: NewsArticle[] = referencedArticlesPayload.map((article) => {
              const tags = [article.category, article.source].filter((value): value is string => Boolean(value))

              return {
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
                tags,
                originalLanguage: 'en',
                translated: false
              }
            })

            setMessages(prev =>
              prev.map((msg) => {
                if (msg.id !== assistantId) {
                  return msg
                }
                return {
                  ...msg,
                  referenced_articles: referencedArticles,
                  streamingStatus: 'Processing articles...'
                }
              })
            )
          } else if (isCompleteMessage(data)) {
            window.clearTimeout(stallTimeout)
            finalResult = data.result
            eventSource.close()

            const referencedArticles: NewsArticle[] = (finalResult.referenced_articles ?? []).map((article) => {
              const tags = [article.category, article.source].filter((value): value is string => Boolean(value))

              return {
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
                tags,
                originalLanguage: 'en',
                translated: false
              }
            })

            setMessages(prev =>
              prev.map((msg) => {
                if (msg.id !== assistantId) {
                  return msg
                }
                return {
                  ...msg,
                  content: finalResult?.answer || 'No answer returned.',
                  thinking_steps: [...thinkingSteps],
                  articles_searched: finalResult?.articles_searched,
                  referenced_articles: referencedArticles,
                  structured_articles_json: structuredArticles ?? msg.structured_articles_json,
                  isStreaming: false,
                  streamingStatus: undefined,
                  error: !finalResult?.success
                }
              })
            )

            setIsSearching(false)
            inputRef.current?.focus()
          } else if (isErrorMessage(data)) {
            window.clearTimeout(stallTimeout)
            eventSource.close()

            let errorMessage = data.message || 'The research agent encountered an error.'
            const lowered = errorMessage.toLowerCase()
            if (lowered.includes('rate limit') || lowered.includes('quota') || lowered.includes('429')) {
              errorMessage = '⚠️ API Rate Limit: The AI service has reached its rate limit. Please wait a moment and try again.'
            }

            setMessages(prev =>
              prev.map((msg) => {
                if (msg.id !== assistantId) {
                  return msg
                }
                return {
                  ...msg,
                  content: errorMessage,
                  error: true,
                  isStreaming: false,
                  streamingStatus: undefined
                }
              })
            )
            setIsSearching(false)
          }
        } catch (parseError) {
          console.error('Failed to parse research stream message:', parseError)
        }
      }

      eventSource.onerror = (error) => {
        console.error('SSE error:', error)
        window.clearTimeout(stallTimeout)
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
      console.error('Failed to start research stream:', error)
      setMessages(prev => prev.map(msg =>
        msg.id === assistantId
          ? {
              ...msg,
              content: error instanceof Error ? error.message : 'An error occurred while starting the research stream.',
              error: true,
              isStreaming: false,
              streamingStatus: undefined
            }
          : msg
      ))
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
    // Remove parentheses around standalone URLs (not markdown links)
    // Match patterns like " (https://...)" or "(https://...)" but not "[text](url)"
    const cleanedContent = content.replace(/(?<!\])\(https?:\/\/[^\)]+\)/gi, (match) => {
      return match.slice(1, -1); // Remove the surrounding parentheses
    });

    if (!articles || articles.length === 0) {
      // No articles, just render text
      return (
        <div className="prose prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-foreground prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground prose-a:text-primary prose-code:text-primary prose-pre:bg-muted/50 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              strong: ({node, ...props}) => <span className="font-semibold" {...props} />,
              a: ({node, href, children, ...props}) => {
                return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" {...props}>{children}</a>
              }
            }}
          >
            {cleanedContent}
          </ReactMarkdown>
        </div>
      )
    }

    // Create a URL to article mapping for quick lookup
    const urlToArticleMap = new Map<string, NewsArticle>();
    articles.forEach(article => {
      if (article.url) {
        urlToArticleMap.set(article.url, article);
        // Also add without trailing slash
        urlToArticleMap.set(article.url.replace(/\/$/, ''), article);
      }
    });

    return (
      <div className="prose prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-foreground prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground prose-code:text-primary prose-pre:bg-muted/50 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={{
            strong: ({node, ...props}) => <span className="font-semibold" {...props} />,
            a: ({node, href, children, ...props}) => {
              // Check if this URL matches one of our articles
              const article = href ? (urlToArticleMap.get(href) || urlToArticleMap.get(href.replace(/\/$/, ''))) : null;
              
              if (article) {
                // Replace the link with an inline article card
                return (
                  <button
                    onClick={() => {
                      setSelectedArticle(article);
                      setIsArticleModalOpen(true);
                    }}
                    className="not-prose block my-3 w-full"
                  >
                    <div className="mb-4 transition-all duration-500 ease-in-out hover:scale-[1.01] hover:shadow-xl bg-gradient-to-br from-black via-zinc-900 to-zinc-950 rounded-xl border border-zinc-800 p-4 flex flex-col gap-2">
                      <div className="flex items-center gap-4">
                        {article.image && (
                          <img src={article.image} alt={article.title} className="w-20 h-20 object-cover rounded-lg shadow-md transition-all duration-500" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-base text-slate-50 mb-1 flex items-center gap-2 line-clamp-2">
                            {article.title.length > 120 ? article.title.slice(0, 120) + '...' : article.title}
                            {article.url && (
                                <a href={article.url} target="_blank" rel="noopener noreferrer" className="ml-2 px-2 py-1 rounded bg-primary/20 text-primary text-xs font-medium transition hover:bg-primary/40 flex-shrink-0">Read</a>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 mb-1">{article.source} • {new Date(article.publishedAt).toLocaleDateString()}</div>
                            <p className="text-sm text-slate-300 leading-relaxed line-clamp-2">
                              {article.summary && article.summary.length > 150 ? article.summary.slice(0, 150) + '...' : article.summary}
                            </p>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              }
              
              // Regular link (not an article)
              return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" {...props}>{children}</a>
            }
          }}
        >
          {cleanedContent}
        </ReactMarkdown>
      </div>
    )
  }

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
      {/* Header - Minimal */}
      <header className="border-b fixed top-0 left-0 right-0 z-50 backdrop-blur-lg" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--news-bg-secondary)' + 'E6' }}>
        <div className="container mx-auto px-4 py-3">
          {/* Small screens: simple flex header */}
          <div className="flex items-center justify-between md:hidden">
            <div className="flex items-center gap-2">
              <button onClick={toggleSidebar} className="p-2 rounded-md hover:bg-neutral-800/30">
                {sidebarCollapsed ? <ChevronRight className="w-4 h-4 text-neutral-300" /> : <ChevronLeft className="w-4 h-4 text-neutral-300" />}
              </button>
              <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <ArrowLeft className="w-4 h-4" style={{ color: 'var(--muted-foreground)' }} />
                <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Back</span>
              </Link>
            </div>
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

          {/* md+ screens: grid header aligned with sidebar width */}
          <div className="hidden md:block">
            <div className="grid" style={{ gridTemplateColumns: sidebarCollapsed ? '64px 1fr 64px' : '18rem 1fr 64px', alignItems: 'center' }}>
              <div className="flex items-center">
                <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <ArrowLeft className="w-4 h-4" style={{ color: 'var(--muted-foreground)' }} />
                  <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Back</span>
                </Link>
              </div>

              <div className="flex items-center justify-center">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  <h1 className="text-lg font-semibold">News Research</h1>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm">
                  <Settings className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 pt-16 overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - hidden on very small screens */}
          <div className="hidden md:flex flex-shrink-0 h-full">
            <ChatSidebar
              chats={chats}
              onSelect={handleSelectChat}
              onNewChat={handleNewChat}
              onRename={handleRenameChat}
              onDelete={handleDeleteChat}
              activeId={activeChatId}
              collapsed={sidebarCollapsed}
              onToggle={toggleSidebar}
            />
          </div>

          {/* Right/Main column */}
          <div className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
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
                      {message.toolType === 'semantic_search' && message.semanticResults ? (
                        <div className="p-4 rounded-2xl border hover:shadow-lg transition-all duration-200" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-400 mb-3">
                            <Sparkles className="w-4 h-4" />
                            Semantic matches
                          </div>
                          <div className="space-y-3">
                            {message.semanticResults.map(({ article, similarityScore }) => (
                              <button
                                key={`semantic-${article.url || article.id}`}
                                onClick={() => {
                                  setSelectedArticle(article)
                                  setIsArticleModalOpen(true)
                                }}
                                className="w-full text-left group"
                              >
                                <div
                                  className="p-3 rounded-xl border transition-all duration-200 hover:border-primary hover:bg-primary/10 flex gap-3"
                                  style={{ borderColor: 'var(--border)' }}
                                >
                                  {article.image && (
                                    <div className="w-20 h-16 rounded-md overflow-hidden flex-shrink-0 bg-black/40">
                                      <img
                                        src={article.image}
                                        alt={article.title}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                      />
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex items-center gap-2 text-xs font-medium text-primary/80 uppercase">
                                      <span>{article.source}</span>
                                      {typeof similarityScore === 'number' && (
                                        <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                                          {(similarityScore * 100).toFixed(1)}% match
                                        </span>
                                      )}
                                    </div>
                                    <h3 className="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                                      {article.title}
                                    </h3>
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                      {article.summary}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 rounded-2xl border hover:shadow-lg transition-all duration-200" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
                          {/* Assistant Message with inline embeds */}
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
                            <>
                              {(() => {
                                const structuredFallback: NewsArticle[] = (message.structured_articles_json?.articles ?? []).map((article) => {
                                  const tags = [article.category, article.source].filter((value): value is string => Boolean(value))
                                  const link = typeof article.link === 'string' && article.link
                                    ? article.link
                                    : typeof article.url === 'string'
                                      ? article.url
                                      : ''
                                  const description = article.summary || article.description || 'No description'

                                  return {
                                    id: Date.now() + Math.random(),
                                    title: article.title || 'No title',
                                    source: article.source || 'Unknown',
                                    sourceId: (article.source || 'unknown').toLowerCase().replace(/\s+/g, '-'),
                                    country: 'United States',
                                    credibility: 'medium' as const,
                                    bias: 'center' as const,
                                    summary: description,
                                    content: description,
                                    image: article.image || "/placeholder.svg",
                                    publishedAt: article.published || new Date().toISOString(),
                                    category: article.category || 'general',
                                    url: link,
                                    tags,
                                    originalLanguage: 'en',
                                    translated: false
                                  }
                                })

                                const articlesToEmbed: NewsArticle[] = (message.referenced_articles && message.referenced_articles.length > 0)
                                  ? message.referenced_articles
                                  : structuredFallback

                                return renderContentWithEmbeds(message.content, articlesToEmbed)
                              })()}
                            
                            {/* Sources Section */}
                            {message.referenced_articles && message.referenced_articles.length > 0 && (
                              <div className="mt-6 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
                                <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--muted-foreground)' }}>
                                  <Database className="w-3 h-3" />
                                  Sources
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {message.referenced_articles.map((article) => (
                                    <button
                                      key={`source-${article.id}`}
                                      onClick={() => {
                                        setSelectedArticle(article)
                                        setIsArticleModalOpen(true)
                                      }}
                                      className="text-left group p-3 rounded-xl border transition-all duration-200 hover:border-primary/30"
                                      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
                                    >
                                      <div className="flex items-start gap-3">
                                        {article.image && (
                                          <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                                            <img src={article.image} alt="" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                          </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <h5 className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors mb-1">
                                            {article.title}
                                          </h5>
                                          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                                            <span className="font-medium" style={{ color: 'var(--foreground)' }}>{article.source}</span>
                                            <span>•</span>
                                            <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        </div>
                      )}

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
