"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import {
  Search,
  Loader2,
  AlertCircle,
  Home,
  ChevronLeft, 
  ChevronRight,
  ArrowRight,
  Cpu,
  Filter,
  Clock,
} from "lucide-react"
import { API_BASE_URL, ThinkingStep, type NewsArticle, semanticSearch, type SemanticSearchResult } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ArticleDetailModal } from "@/components/article-detail-modal"
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
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatMessagesMap, setChatMessagesMap] = useState<Record<string, Message[]>>({})
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [researchView, setResearchView] = useState<"brief" | "flow">("brief")
  const inputRef = useRef<HTMLInputElement>(null)
  const isHydratingRef = useRef(true)

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
              errorMessage = 'API Rate Limit: The AI service has reached its rate limit. Please wait a moment and try again.'
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
                content: 'Connection error. The server may be busy or experiencing rate limits. Please try again in a moment.',
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
              li: ({node, ...props}) => <li className="text-foreground/80" {...props} />,
              p: ({node, ...props}) => <p className="text-foreground/80 leading-7 mb-4" {...props} />,
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
                    className="not-prose group relative block w-full my-6 overflow-hidden rounded-xl border border-border/50 bg-[var(--news-bg-primary)]/40 hover:bg-[var(--news-bg-primary)]/60 transition-all duration-300 text-left hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5"
                  >
                    <div className="flex flex-col sm:flex-row gap-4 p-4">
                      {article.image && (
                        <div className="h-48 sm:h-24 sm:w-32 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--news-bg-secondary)]">
                          <img src={article.image} alt={article.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        </div>
                      )}
                      <div className="flex flex-col justify-between py-1 min-w-0 flex-1">
                        <div>
                          <h4 className="font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors text-base">{article.title}</h4>
                          <p className="mt-2 text-sm text-muted-foreground line-clamp-2 leading-relaxed">{article.summary}</p>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
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

  const buildArticleEmbeds = (message?: Message | null): NewsArticle[] => {
    if (!message) return []

    const structuredArticles = message.structured_articles_json?.articles ?? []
    const structuredFallback: NewsArticle[] = structuredArticles.map((article) => {
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

    if (message.referenced_articles && message.referenced_articles.length > 0) {
      return message.referenced_articles
    }

    return structuredFallback
  }

  const isEmpty = messages.length === 0
  const latestUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.type === "user"),
    [messages]
  )
  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.type === "assistant" && !message.toolType),
    [messages]
  )
  const latestSemanticMessage = useMemo(
    () => [...messages].reverse().find((message) => message.toolType === "semantic_search"),
    [messages]
  )
  const relatedArticles = useMemo(
    () => buildArticleEmbeds(latestAssistantMessage),
    [latestAssistantMessage]
  )
  const thinkingSteps = latestAssistantMessage?.thinking_steps ?? []
  const recentQueries = useMemo(
    () => messages.filter((message) => message.type === "user").slice(-6).reverse(),
    [messages]
  )

  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)] text-foreground">
      <div className="flex min-h-screen">
        <div className={`${sidebarCollapsed ? 'w-0 md:w-0' : 'w-full md:w-[280px]'} fixed inset-y-0 z-40 md:relative md:block transition-all duration-300 ease-in-out border-r border-border/60 bg-[var(--news-bg-primary)]`}>
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

        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-20 border-b border-border/60 bg-[var(--news-bg-primary)]/90 backdrop-blur">
            <div className="max-w-[1400px] mx-auto flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSidebar}
                  className="p-2 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground"
                >
                  {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Research Workspace</p>
                  <h1 className="text-lg font-semibold">Scoop Research</h1>
                  <p className="text-xs text-muted-foreground">
                    {activeChatId ? (chats.find(c => c.id === activeChatId)?.title || 'Untitled session') : 'New session'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/">
                  <Button variant="outline" size="sm" className="border-border/60">
                    <Home className="w-4 h-4 mr-2" />
                    Back to News
                  </Button>
                </Link>
              </div>
            </div>
          </header>

          <main className="flex-1 flex flex-col bg-[#050505]">
            {isEmpty ? (
              <div className="flex-1 flex flex-col p-6 lg:p-12">
                <div className="flex-1 max-w-4xl mx-auto w-full flex flex-col justify-center">
                  <div className="text-center mb-12 animate-fade-in">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-zinc-900/50 border border-zinc-800 mb-6">
                      <Cpu className="w-8 h-8 text-zinc-400" />
                    </div>
                    <h1 className="text-3xl font-medium tracking-tight text-zinc-100 mb-3">Deep Research</h1>
                    <p className="text-zinc-500 text-lg">Autonomous agent for complex news analysis</p>
                  </div>

                  <div className="relative group w-full">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-zinc-800 to-zinc-800 rounded-xl opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>
                    <div className="relative bg-[#0a0a0a] rounded-xl border border-zinc-800 p-4 shadow-2xl">
                      <form onSubmit={handleSearch}>
                        <textarea 
                          ref={inputRef as any}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSearch(e);
                            }
                          }}
                          placeholder="Ask a complex question requiring multi-step reasoning..."
                          className="w-full bg-transparent text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none text-lg min-h-[120px]"
                        />
                        <div className="flex justify-between items-center mt-4 pt-4 border-t border-zinc-900">
                          <div className="flex gap-2">
                            <button type="button" className="p-2 hover:bg-zinc-900 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors">
                              <Filter className="w-4 h-4" />
                            </button>
                            <button type="button" className="p-2 hover:bg-zinc-900 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors">
                              <Clock className="w-4 h-4" />
                            </button>
                          </div>
                          <button 
                            type="submit" 
                            disabled={!query.trim() || isSearching}
                            className="bg-zinc-100 hover:bg-white text-black px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Start Research <ArrowRight className="w-4 h-4" /></>}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                  
                  <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
                     {sampleQueries.slice(0, 3).map((q) => (
                        <button
                          key={q}
                          onClick={() => handleSampleQuery(q)}
                          className="text-left p-4 rounded-xl bg-zinc-900/30 border border-zinc-800/50 hover:bg-zinc-900/50 hover:border-zinc-700 transition-all group"
                        >
                          <p className="text-sm text-zinc-400 group-hover:text-zinc-200 transition-colors">{q}</p>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6 w-full">
                 <section className="rounded-xl border border-zinc-800 bg-[#0a0a0a] p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                      <div className="flex-1">
                        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">Research query</p>
                        <form onSubmit={handleSearch} className="mt-2 flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                            <input
                              ref={inputRef}
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                              placeholder="Ask a question..."
                              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-zinc-700 text-zinc-200 placeholder:text-zinc-600"
                              disabled={isSearching}
                            />
                          </div>
                          <Button type="submit" size="sm" disabled={!query.trim() || isSearching} className="h-10 px-4 bg-zinc-100 text-black hover:bg-white">
                            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                          </Button>
                        </form>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={researchView === "brief" ? "default" : "outline"}
                          size="sm"
                          className={researchView === "brief" ? "bg-zinc-800 text-zinc-100 hover:bg-zinc-700" : "border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"}
                          onClick={() => setResearchView("brief")}
                        >
                          Brief
                        </Button>
                        <Button
                          variant={researchView === "flow" ? "default" : "outline"}
                          size="sm"
                          className={researchView === "flow" ? "bg-zinc-800 text-zinc-100 hover:bg-zinc-700" : "border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"}
                          onClick={() => setResearchView("flow")}
                        >
                          Flow
                        </Button>
                      </div>
                    </div>
                    {(isSearching || latestAssistantMessage?.isStreaming) && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                        <span>{latestAssistantMessage?.streamingStatus || 'Running research...'}</span>
                      </div>
                    )}
                 </section>

                 <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <section className="space-y-6">
                    <div className="rounded-xl border border-zinc-800 bg-[#0a0a0a] p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">Current query</p>
                          <h2 className="text-xl font-semibold mt-2 text-zinc-100">{latestUserMessage?.content || "Research Brief"}</h2>
                          <p className="text-xs text-zinc-500 mt-2">
                            {latestAssistantMessage?.articles_searched
                              ? `${latestAssistantMessage.articles_searched} sources searched`
                              : 'Evidence stream pending'}
                          </p>
                        </div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">
                          {researchView === "brief" ? "Brief" : "Flow"}
                        </div>
                      </div>

                      <div className="mt-5">
                        {!latestAssistantMessage ? (
                          <p className="text-sm text-zinc-500">Submit a query to generate a brief.</p>
                        ) : latestAssistantMessage.error ? (
                          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <p>{latestAssistantMessage.content}</p>
                          </div>
                        ) : researchView === "flow" ? (
                          <div className="space-y-4">
                            {thinkingSteps.length === 0 && (
                              <p className="text-sm text-zinc-500">Waiting on reasoning steps from the research agent.</p>
                            )}
                            {thinkingSteps.map((step, idx) => (
                              <div key={`${step.type}-${idx}`} className="relative pl-6">
                                <div className="absolute left-0 top-2 h-2 w-2 rounded-full bg-zinc-600" />
                                {idx < thinkingSteps.length - 1 && (
                                  <div className="absolute left-1 top-4 h-full w-px bg-zinc-800" />
                                )}
                                <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
                                  <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">
                                    Step {idx + 1}: {step.type.replace('_', ' ')}
                                  </div>
                                  <p className="mt-2 text-sm text-zinc-300">{step.content}</p>
                                </div>
                              </div>
                            ))}
                            {latestAssistantMessage.content && !latestAssistantMessage.isStreaming && (
                              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
                                <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">Final brief</div>
                                <div className="mt-3">
                                  {renderContentWithEmbeds(latestAssistantMessage.content, relatedArticles)}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : latestAssistantMessage.isStreaming ? (
                          <div className="flex items-center gap-2 text-sm text-zinc-500">
                            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            <span>{latestAssistantMessage.streamingStatus || 'Analyzing...'}</span>
                          </div>
                        ) : (
                          renderContentWithEmbeds(latestAssistantMessage.content, relatedArticles)
                        )}
                      </div>
                    </div>
                  </section>

                  <aside className="space-y-6">
                    <div className="rounded-xl border border-zinc-800 bg-[#0a0a0a] p-5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">Research Log</h3>
                        <span className="text-xs text-zinc-500">{thinkingSteps.length} steps</span>
                      </div>
                      <div className="mt-3 space-y-3 text-sm">
                        {thinkingSteps.length > 0 ? (
                          thinkingSteps.slice(-6).map((step, idx) => (
                            <div key={`${step.type}-${idx}`} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                              <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">
                                {step.type.replace('_', ' ')}
                              </div>
                              <p className="mt-2 text-xs text-zinc-400 line-clamp-3">{step.content}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-zinc-500">Reasoning steps will appear as the agent works.</p>
                        )}
                      </div>
                    </div>

                    {latestSemanticMessage?.semanticResults && latestSemanticMessage.semanticResults.length > 0 && (
                      <div className="rounded-xl border border-zinc-800 bg-[#0a0a0a] p-5">
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">Related Coverage</h3>
                        <div className="mt-3 space-y-2">
                          {latestSemanticMessage.semanticResults.map(({ article, similarityScore }) => (
                            <button
                              key={`semantic-${article.url || article.id}`}
                              onClick={() => {
                                setSelectedArticle(article)
                                setIsArticleModalOpen(true)
                              }}
                              className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 hover:border-zinc-600 transition-colors"
                            >
                              <div className="text-sm font-medium text-zinc-200 line-clamp-2">{article.title}</div>
                              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                                <span>{article.source}</span>
                                {typeof similarityScore === 'number' && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                                    {Math.round(similarityScore * 100)}% match
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {relatedArticles.length > 0 && (
                      <div className="rounded-xl border border-zinc-800 bg-[#0a0a0a] p-5">
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">Sources Used</h3>
                        <div className="mt-3">
                          <HorizontalArticleEmbed
                            articles={relatedArticles.slice(0, 6)}
                            onArticleClick={(article) => {
                              setSelectedArticle(article)
                              setIsArticleModalOpen(true)
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-zinc-800 bg-[#0a0a0a] p-5">
                      <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">Recent Queries</h3>
                      <div className="mt-3 space-y-2">
                        {recentQueries.length > 0 ? (
                          recentQueries.map((message) => (
                            <button
                              key={message.id}
                              onClick={() => handleSampleQuery(message.content)}
                              className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
                            >
                              {message.content}
                            </button>
                          ))
                        ) : (
                          <p className="text-xs text-zinc-500">Run a query to build a history.</p>
                        )}
                      </div>
                    </div>
                  </aside>
                 </div>
              </div>
            )}
          </main>
        </div>
      </div>

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
