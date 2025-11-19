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
  Sparkles,
  ChevronLeft, 
  ChevronRight,
  ArrowRight,
  ArrowUp,
  Share2,
  MoreHorizontal,
  Plus
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

  const handleDeleteChats = (ids: string[]) => {
    const remainingChats = chats.filter(chat => !ids.includes(chat.id))
    
    // If active chat is deleted, switch to the first available remaining chat
    let nextChatId = activeChatId
    if (activeChatId && ids.includes(activeChatId)) {
      nextChatId = remainingChats[0]?.id ?? null
    }

    // Remove messages for deleted chats
    const newChatMessagesMap = { ...chatMessagesMap }
    ids.forEach(id => {
      delete newChatMessagesMap[id]
    })

    setChats(remainingChats)
    setChatMessagesMap(newChatMessagesMap)

    if (activeChatId !== nextChatId || (activeChatId && ids.includes(activeChatId))) {
      setActiveChatId(nextChatId || null)
      setMessages(nextChatId ? (newChatMessagesMap[nextChatId] || []) : [])
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

    semanticSearch(trimmedQuery, { limit: 3 })
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
        <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              strong: ({node, ...props}) => <span className="font-semibold text-white" {...props} />,
              a: ({node, href, children, ...props}) => {
                return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline decoration-primary/30 underline-offset-2" {...props}>{children}</a>
              },
              h1: ({node, ...props}) => <h1 className="text-xl font-semibold text-white mt-6 mb-3" {...props} />,
              h2: ({node, ...props}) => <h2 className="text-lg font-semibold text-white mt-5 mb-2" {...props} />,
              h3: ({node, ...props}) => <h3 className="text-base font-medium text-white mt-4 mb-2" {...props} />,
              ul: ({node, ...props}) => <ul className="my-3 space-y-1" {...props} />,
              li: ({node, ...props}) => <li className="text-neutral-300" {...props} />,
              p: ({node, ...props}) => <p className="text-neutral-300 leading-7 mb-4" {...props} />,
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
      <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={{
            strong: ({node, ...props}) => <span className="font-semibold text-white" {...props} />,
            h1: ({node, ...props}) => <h1 className="text-xl font-semibold text-white mt-6 mb-3" {...props} />,
            h2: ({node, ...props}) => <h2 className="text-lg font-semibold text-white mt-5 mb-2" {...props} />,
            h3: ({node, ...props}) => <h3 className="text-base font-medium text-white mt-4 mb-2" {...props} />,
            ul: ({node, ...props}) => <ul className="my-3 space-y-1" {...props} />,
            li: ({node, ...props}) => <li className="text-neutral-300" {...props} />,
            p: ({node, ...props}) => <p className="text-neutral-300 leading-7 mb-4" {...props} />,
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
                    className="not-prose group relative block w-full my-6 overflow-hidden rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-300 text-left hover:shadow-2xl hover:shadow-black/50 hover:-translate-y-0.5"
                  >
                    <div className="flex flex-col sm:flex-row gap-4 p-4">
                      {article.image && (
                        <div className="h-48 sm:h-24 sm:w-32 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                          <img src={article.image} alt={article.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        </div>
                      )}
                      <div className="flex flex-col justify-between py-1 min-w-0 flex-1">
                        <div>
                          <h4 className="font-medium text-neutral-100 line-clamp-2 group-hover:text-primary transition-colors text-base">{article.title}</h4>
                          <p className="mt-2 text-sm text-neutral-400 line-clamp-2 leading-relaxed">{article.summary}</p>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                          <span className="text-primary/80">{article.source}</span>
                          <span>•</span>
                          <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              }
              
              // Regular link (not an article)
              return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline decoration-primary/30 underline-offset-2" {...props}>{children}</a>
            }
          }}
        >
          {cleanedContent}
        </ReactMarkdown>
      </div>
    )
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex h-screen w-full bg-[#09090b] text-neutral-100 font-sans selection:bg-primary/20">
      {/* Sidebar */}
      <div className={`${sidebarCollapsed ? 'w-0 md:w-0' : 'w-full md:w-[280px]'} fixed inset-y-0 z-50 md:relative md:block transition-all duration-300 ease-in-out border-r border-white/5 bg-[#09090b]`}>
        <ChatSidebar
          chats={chats}
          onSelect={handleSelectChat}
          onNewChat={handleNewChat}
          onRename={handleRenameChat}
          onDelete={handleDeleteChat}
          onDeleteMultiple={handleDeleteChats}
          activeId={activeChatId}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full relative min-w-0 bg-[#09090b]">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#09090b]/80 backdrop-blur-md z-10 absolute top-0 left-0 right-0">
          <div className="flex items-center gap-2">
            <button onClick={toggleSidebar} className="p-2 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition-colors md:hidden">
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
            <button onClick={toggleSidebar} className="p-2 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition-colors hidden md:block">
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
            <span className="font-medium text-sm text-neutral-400 ml-2">
              {activeChatId ? (chats.find(c => c.id === activeChatId)?.title || 'Untitled Research') : 'New Research'}
            </span>
          </div>
          <div className="flex items-center gap-2">
             <Link href="/" className="p-2 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition-colors">
                <Home size={18} />
             </Link>
          </div>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto scroll-smooth pt-14">
          <div className={`mx-auto px-4 transition-all duration-500 ${isEmpty ? 'h-full flex flex-col justify-center items-center max-w-2xl' : 'max-w-3xl py-8'}`}>
            
            {isEmpty ? (
              <div className="w-full space-y-8 -mt-20 animate-in fade-in zoom-in-95 duration-500">
                <div className="text-center space-y-6">
                  <div className="inline-flex items-center justify-center p-4 rounded-3xl bg-white/5 ring-1 ring-white/10 mb-4 shadow-2xl shadow-primary/10 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <Brain className="w-10 h-10 text-primary relative z-10" />
                  </div>
                  <h1 className="text-3xl md:text-4xl font-medium tracking-tight text-white">
                    What do you want to know?
                  </h1>
                </div>
                
                {/* Search Input (Centered) */}
                <form onSubmit={handleSearch} className="relative w-full group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/30 via-purple-500/30 to-blue-500/30 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
                  <div className="relative flex items-center bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl transition-all duration-200 focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/50">
                    <Search className="ml-5 w-5 h-5 text-neutral-500" />
                    <input 
                      ref={inputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search for news, topics, or analysis..."
                      className="w-full bg-transparent border-none px-4 py-5 text-lg placeholder:text-neutral-500 focus:outline-none focus:ring-0 text-white"
                    />
                    <div className="pr-3">
                      <Button type="submit" size="icon" disabled={!query.trim()} className="h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 text-white border-0 transition-all disabled:opacity-50">
                        <ArrowRight className="w-5 h-5" />
                      </Button>
                    </div>
                  </div>
                </form>

                {/* Suggestions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
                  {sampleQueries.slice(0, 4).map((q, i) => (
                    <button 
                      key={i} 
                      onClick={() => handleSampleQuery(q)} 
                      className="text-left p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all text-sm text-neutral-400 hover:text-white group"
                    >
                      <span className="line-clamp-1 group-hover:translate-x-1 transition-transform duration-200">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-10 pb-24">
                {messages.map((message) => (
                  <div key={message.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {message.type === 'user' ? (
                      <div className="flex justify-end mb-8">
                        <div className="bg-white/10 text-white px-6 py-4 rounded-3xl rounded-tr-sm max-w-[85%] text-base leading-relaxed shadow-sm backdrop-blur-sm">
                          {message.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-6 mb-8 group">
                        <div className="flex-shrink-0 mt-1 hidden sm:block">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-b from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10 shadow-lg shadow-primary/5">
                            <Brain className="w-5 h-5 text-primary" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 space-y-6">
                          {/* Semantic Search Results */}
                          {message.toolType === 'semantic_search' && message.semanticResults && (
                            <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                              <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2 bg-white/5">
                                <Sparkles className="w-4 h-4 text-emerald-400" />
                                <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Related Coverage</span>
                              </div>
                              <div className="divide-y divide-white/5">
                                {message.semanticResults.map(({ article, similarityScore }) => (
                                  <button
                                    key={`semantic-${article.url || article.id}`}
                                    onClick={() => {
                                      setSelectedArticle(article)
                                      setIsArticleModalOpen(true)
                                    }}
                                    className="w-full text-left p-4 hover:bg-white/5 transition-colors flex gap-4 group/item"
                                  >
                                    {article.image && (
                                      <div className="w-16 h-12 rounded-md overflow-hidden flex-shrink-0 bg-neutral-800">
                                        <img src={article.image} alt="" className="w-full h-full object-cover opacity-70 group-hover/item:opacity-100 transition-opacity" />
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <h4 className="text-sm font-medium text-neutral-200 line-clamp-1 group-hover/item:text-primary transition-colors">{article.title}</h4>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs text-neutral-500">{article.source}</span>
                                        {typeof similarityScore === 'number' && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            {Math.round(similarityScore * 100)}% match
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Thinking Steps */}
                          {message.thinking_steps && message.thinking_steps.length > 0 && (
                            <div className="rounded-xl border border-white/10 bg-[#121214] overflow-hidden">
                              <button 
                                onClick={() => toggleThinking(message.id)}
                                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                              >
                                <div className="flex items-center gap-2 text-xs font-medium text-neutral-400">
                                  <Activity className="w-4 h-4" />
                                  <span>Reasoning Process</span>
                                  <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-500">{message.thinking_steps.length} steps</span>
                                </div>
                                {expandedThinking === message.id ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
                              </button>
                              
                              {expandedThinking === message.id && (
                                <div className="px-4 py-3 border-t border-white/5 space-y-3 bg-black/20">
                                  {message.thinking_steps.map((step, idx) => (
                                    <div key={idx} className="flex gap-3 text-xs">
                                      <div className="mt-0.5 text-neutral-500 font-mono">{(idx + 1).toString().padStart(2, '0')}</div>
                                      <div className="flex-1">
                                        <div className="font-medium text-neutral-300 mb-0.5 capitalize">{step.type.replace('_', ' ')}</div>
                                        <div className="text-neutral-500 leading-relaxed">{step.content}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Main Content */}
                          {message.isStreaming ? (
                            <div className="space-y-4">
                              <div className="flex items-center gap-3 text-neutral-400">
                                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                <span className="text-sm animate-pulse">{message.streamingStatus || 'Analyzing...'}</span>
                              </div>
                            </div>
                          ) : message.error ? (
                            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 flex-shrink-0" />
                              <p>{message.content}</p>
                            </div>
                          ) : (
                            <div className="text-neutral-200">
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
                            </div>
                          )}

                          {/* Sources Grid (Bottom) */}
                          {!message.isStreaming && !message.error && message.referenced_articles && message.referenced_articles.length > 0 && (
                            <div className="pt-6 border-t border-white/5">
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-4 flex items-center gap-2">
                                <Database className="w-3 h-3" />
                                Sources Used
                              </h4>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {message.referenced_articles.map((article) => (
                                  <button
                                    key={`source-${article.id}`}
                                    onClick={() => {
                                      setSelectedArticle(article)
                                      setIsArticleModalOpen(true)
                                    }}
                                    className="text-left group flex flex-col h-full p-3 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/10 transition-all"
                                  >
                                    {article.image && (
                                      <div className="w-full aspect-video rounded-lg overflow-hidden bg-neutral-800 mb-2">
                                        <img src={article.image} alt="" className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0 flex flex-col">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] font-bold text-neutral-400">
                                          {article.source.slice(0, 1)}
                                        </div>
                                        <span className="text-[10px] font-medium text-neutral-400 truncate">{article.source}</span>
                                      </div>
                                      <h5 className="text-xs font-medium text-neutral-300 line-clamp-2 group-hover:text-white transition-colors">
                                        {article.title}
                                      </h5>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Bottom Input (Only when not empty) */}
        {!isEmpty && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent z-20">
            <div className="max-w-3xl mx-auto">
              <form onSubmit={handleSearch} className="relative flex items-center bg-[#18181b] border border-white/10 rounded-xl shadow-2xl shadow-black/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
                <input 
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask a follow-up question..."
                  className="w-full bg-transparent border-none px-4 py-3.5 text-base placeholder:text-neutral-500 focus:outline-none focus:ring-0 text-white"
                  disabled={isSearching}
                />
                <div className="pr-2 flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={isSearching || !query.trim()} className="h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 p-0 flex items-center justify-center">
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                  </Button>
                </div>
              </form>
              <div className="text-center mt-2">
                <p className="text-[10px] text-neutral-600">AI can make mistakes. Check sources.</p>
              </div>
            </div>
          </div>
        )}
      </div>

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
