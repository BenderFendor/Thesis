import { useState, useEffect, useRef } from 'react'
import type { NewsArticle } from '@/lib/api'

interface SSENewsArticle {
  title: string
  link: string
  description: string
  published: string
  source: string
  category: string
  image?: string
}

interface StreamEvent {
  status: string
  message?: string
  source?: string
  articles?: SSENewsArticle[]
  source_stat?: any
  error?: string
  progress?: {
    completed: number
    total: number
    percentage: number
  }
}

interface UseNewsStreamOptions {
  onUpdate?: (articles: NewsArticle[]) => void
  onProgress?: (progress: { completed: number; total: number; percentage: number }) => void
  onComplete?: () => void
  onError?: (error: string) => void
}

export const useNewsStream = (options: UseNewsStreamOptions = {}) => {
  const [isStreaming, setIsStreaming] = useState(false)
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<string>('idle')
  const [completedSources, setCompletedSources] = useState(0)
  const [totalSources, setTotalSources] = useState(0)
  const [currentMessage, setCurrentMessage] = useState('')
  const eventSourceRef = useRef<EventSource | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const startStream = () => {
    if (isStreaming) return

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    setIsStreaming(true)
    setArticles([])
    setProgress(0)
    setStatus('starting')
    setCurrentMessage('Connecting to news stream...')
    setCompletedSources(0)
    setTotalSources(0)

    // Create EventSource connection
  const sseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '') + '/news/stream'
  console.log(`[36mConnecting to SSE at: ${sseUrl}[0m`)
  const eventSource = new EventSource(sseUrl)
    eventSourceRef.current = eventSource

    // Set a timeout to prevent hanging
    timeoutRef.current = setTimeout(() => {
      console.warn('SSE stream timeout - closing connection')
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      setStatus('error')
      setCurrentMessage('Stream timeout')
      setIsStreaming(false)
      options.onError?.('Stream timeout')
    }, 60000) // 60 seconds timeout

    eventSource.onopen = () => {
      console.log('SSE connection opened')
      setStatus('connected')
      setCurrentMessage('Connected! Loading news articles...')
    }

    eventSource.onmessage = (event) => {
      try {
        // Some SSE messages may not be valid JSON or may be ping/status messages.
        const parsed = JSON.parse(event.data)
        if (!parsed || typeof parsed !== 'object') {
          console.warn('Received unexpected SSE payload, ignoring:', event.data)
          return
        }

        const data: StreamEvent = parsed as StreamEvent
        console.log('SSE Event received:', data)

        switch (data.status) {
          case 'starting':
            setStatus('loading')
            setCurrentMessage(data.message || 'Loading news articles...')
            break

          case 'partial_update':
            if (Array.isArray(data.articles) && data.source) {
              // Map SSE articles to NewsArticle format
              const mappedArticles: NewsArticle[] = data.articles.map((article, index) => ({
                id: Date.now() + index, // Generate unique ID
                title: article.title,
                source: article.source,
                sourceId: article.source.toLowerCase().replace(/\s+/g, '-'),
                country: 'Unknown', // Will be filled from source data
                credibility: 'medium' as const,
                bias: 'center' as const,
                summary: article.description,
                content: article.description,
                image: article.image || '',
                publishedAt: article.published,
                category: article.category,
                url: article.link,
                likes: 0,
                comments: 0,
                shares: 0,
                tags: [],
                originalLanguage: 'en',
                translated: false
              }))

              setArticles(prev => {
                const newArticles = [...prev, ...mappedArticles]
                options.onUpdate?.(newArticles)
                return newArticles
              })
              setCurrentMessage(`Loaded ${data.articles.length} articles from ${data.source}`)

              if (data.progress) {
                setProgress(data.progress.percentage)
                setCompletedSources(data.progress.completed)
                setTotalSources(data.progress.total)
                options.onProgress?.(data.progress)
              }
            }
            break

          case 'source_error':
            console.warn(`Error loading from ${data.source}:`, data.error)
            options.onError?.(`Error loading from ${data.source}: ${data.error}`)
            if (data.progress) {
              setProgress(data.progress.percentage)
              setCompletedSources(data.progress.completed)
              setTotalSources(data.progress.total)
              options.onProgress?.(data.progress)
            }
            break

          case 'complete':
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current)
              timeoutRef.current = null
            }
            setStatus('complete')
            setCurrentMessage(data.message || 'Stream completed!')
            setProgress(100)
            setIsStreaming(false)
            eventSource.close()
            options.onComplete?.()
            break

          default:
            console.log('Unknown SSE event status:', data.status)
        }
      } catch (error) {
        console.error('Error parsing SSE event:', error)
        options.onError?.('Error parsing stream data')
      }
    }

    eventSource.onerror = (error) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      console.error('SSE connection error:', error)
      setStatus('error')
      setCurrentMessage('Connection error occurred')
      setIsStreaming(false)
      eventSource.close()
      options.onError?.('Connection error occurred')
    }
  }

  const stopStream = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsStreaming(false)
    setStatus('stopped')
    setCurrentMessage('Stream stopped')
  }

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  return {
    isStreaming,
    articles,
    progress,
    status,
    completedSources,
    totalSources,
    currentMessage,
    startStream,
    stopStream
  }
}
