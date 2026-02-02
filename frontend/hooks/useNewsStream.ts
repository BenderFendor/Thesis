import { useState, useEffect, useRef, useCallback } from 'react'
import { streamNews, type NewsArticle, type StreamOptions, type StreamProgress } from '@/lib/api'
import { logger } from "@/lib/logger"
import {
  perfLogger,
  startStream as perfStartStream,
  logStreamEvent as perfLogStreamEvent,
  endStream as perfEndStream,
} from '@/lib/performance-logger'

const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const NEXT_PUBLIC_DOCKER_API_URL = process.env.NEXT_PUBLIC_DOCKER_API_URL || "http://localhost:8000";

interface UseNewsStreamOptions extends Omit<StreamOptions, 'onProgress' | 'onSourceComplete' | 'onError'> {
  onUpdate?: (articles: NewsArticle[]) => void
  onComplete?: (result: { articles: NewsArticle[]; sources: string[]; errors: string[] }) => void
  onError?: (error: string) => void
  autoStart?: boolean
}

export const useNewsStream = (options: UseNewsStreamOptions = {}) => {
  const [isStreaming, setIsStreaming] = useState(false)
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [progress, setProgress] = useState<StreamProgress>({ completed: 0, total: 0, percentage: 0 })
  const [status, setStatus] = useState<string>('idle')
  const [currentMessage, setCurrentMessage] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [streamId, setStreamId] = useState<string>()
  const [apiUrl, setApiUrl] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const maxRetries = 3;

  const streamPromiseRef = useRef<Promise<any> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef<boolean>(true)
  const startingRef = useRef<boolean>(false)
  const seenArticleIdsRef = useRef<Set<string>>(new Set())

  const startStream = useCallback(async (streamOptions?: Partial<StreamOptions>) => {
    if (startingRef.current || isStreaming) {
      console.warn('Stream already in progress, ignoring start request');
      return;
    }

    const streamStartTime = Date.now();
    logger.debug('Starting news stream with options:', { ...options, ...streamOptions });

    // Cancel any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    startingRef.current = true;
    
    // Reset state and clear seen articles
    seenArticleIdsRef.current.clear();
    setIsStreaming(true)
    setArticles([])
    setProgress({ completed: 0, total: 0, percentage: 0 })
    setStatus('starting')
    setCurrentMessage('Loading cached articles from database...')
    setSources([])
    setErrors([])
    setStreamId(undefined)
    setApiUrl(null)

    // Generate stream ID for tracking
    const trackingStreamId = `fe_stream_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    perfStartStream(trackingStreamId);

    try {
      const streamData = streamNews({
        useCache: options.useCache ?? true,
        category: options.category,
        ...streamOptions,
        signal: abortControllerRef.current.signal,
        onProgress: (progress) => {
          if (!isMountedRef.current) return;
          setProgress(progress);
          setCurrentMessage(progress.message || `${progress.completed}/${progress.total} sources processed`);
          setStatus('loading');
          
          // Log progress to performance logger
          perfLogStreamEvent(trackingStreamId, 'progress', {
            details: {
              completed: progress.completed,
              total: progress.total,
              percentage: progress.percentage,
              message: progress.message,
            },
          });
        },
        onSourceComplete: (source, sourceArticles) => {
          if (!isMountedRef.current) return;

          // Log source completion to performance logger
          perfLogStreamEvent(trackingStreamId, 'source_complete', {
            source,
            articleCount: sourceArticles.length,
          });

          // Filter out duplicates using a Set of article IDs
          const newArticles = sourceArticles.filter(article => {
            const urlKey = article.url ? `url:${article.url}` : null;
            const idKey = `id:${article.id}`;
            // Check if article is duplicate by URL or ID
            if (urlKey && seenArticleIdsRef.current.has(urlKey)) {
              return false; // Skip duplicate by URL
            }
            if (seenArticleIdsRef.current.has(idKey)) {
              return false; // Skip duplicate by ID
            }
            // Add both keys to track this article
            if (urlKey) {
              seenArticleIdsRef.current.add(urlKey);
            }
            seenArticleIdsRef.current.add(idKey);
            return true; // Include new article
          });

          // Add new articles to the state
          setArticles(prev => {
            const updated = [...prev, ...newArticles];
            // Call onUpdate immediately with the deduplicated articles
            options.onUpdate?.(updated);
            return updated;
          });
          setSources(prev => Array.from(new Set([...prev, source])));

        },
        onError: (error) => {
          if (!isMountedRef.current) return;
          setErrors(prev => [...prev, error]);
          options.onError?.(error);
          
          // Log error to performance logger
          perfLogStreamEvent(trackingStreamId, 'error', {
            isError: true,
            details: { error },
          });
        }
      });

      streamPromiseRef.current = streamData.promise;
      setApiUrl(streamData.url);
      
      const result = await streamData.promise;
      
      if (isMountedRef.current) {
        setArticles(result.articles);
        setSources(result.sources);
        setErrors(result.errors);
        setStreamId(result.streamId);
        setStatus('complete');
        setCurrentMessage(`Loaded ${result.articles.length} articles from ${result.sources.length} sources`);
        options.onComplete?.(result);
        setRetryCount(0); // Reset on success
        
        // End stream tracking with success
        const totalDuration = Date.now() - streamStartTime;
        perfEndStream(trackingStreamId, 'complete');
        perfLogger.logEvent('stream_end', 'stream', 'complete', {
          streamId: trackingStreamId,
          durationMs: totalDuration,
          details: {
            articleCount: result.articles.length,
            sourceCount: result.sources.length,
            errorCount: result.errors.length,
            backendStreamId: result.streamId,
          },
        });
      }
    } catch (error) {
      if (isMountedRef.current) {
        if (abortControllerRef.current?.signal.aborted) {
          setStatus('cancelled');
          setCurrentMessage('Stream was cancelled');
          perfEndStream(trackingStreamId, 'cancelled');
        } else if (retryCount < maxRetries) {
          const delay = 2000 * Math.pow(2, retryCount);
          setStatus(`retrying-${retryCount + 1}`);
          setCurrentMessage(`Connection lost, retrying... (${retryCount + 1}/${maxRetries})`);
          
          perfLogStreamEvent(trackingStreamId, 'retry', {
            details: { retryCount: retryCount + 1, delayMs: delay },
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
          setRetryCount(prev => prev + 1);
          return startStream(streamOptions);
        } else {
          setStatus('error');
          setCurrentMessage('Failed to load news. Please try again later.');
          options.onError?.(error instanceof Error ? error.message : String(error));
          perfEndStream(trackingStreamId, 'error');
        }
      }
    } finally {
      if (isMountedRef.current) {
        startingRef.current = false;
        setIsStreaming(false);
      }
    }
  }, [options]);

  const abortStream = useCallback((immediate = false) => {
    if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
      abortControllerRef.current.abort();
      if (isMountedRef.current) {
        setIsStreaming(false);
        setStatus('cancelled');
        const cancellationError = 'Stream cancelled. This is expected on initial load in development. Click to retry.';
        setCurrentMessage(cancellationError);
        if (immediate) { // Only add error for immediate cancellations (e.g., category change)
          setErrors(prev => [...prev, cancellationError]);
          options.onError?.(cancellationError);
        }
      }
    }
  }, [options.onError]);

  // WebSocket listener for image updates
  useEffect(() => {
    const ws = new WebSocket(NEXT_PUBLIC_DOCKER_API_URL.replace(/^http/, 'ws') + '/ws' || 'ws://localhost:8000/ws');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'image_update') {
        setArticles(prev =>
          prev.map(a => (a.url === data.article_url ? { ...a, image: data.image_url } : a))
        );
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Auto-start if requested
  useEffect(() => {
    if (options.autoStart && !isStreaming && status === 'idle') {
      logger.debug('Auto-starting stream');
      startStream();
    }
  }, [options.autoStart, isStreaming, status, startStream]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // On unmount, immediately abort the stream if it's still going
      if (isStreaming && abortControllerRef.current) {
        logger.debug('Component unmounting, aborting stream');
        abortControllerRef.current.abort();
      }
      isMountedRef.current = false;
    };
  }, [isStreaming]);


  const clearErrors = useCallback(() => {
    if (isMountedRef.current) {
      setErrors([]);
    }
  }, []);

  const removeError = useCallback((errorToRemove: string) => {
    if (isMountedRef.current) {
      setErrors(prev => prev.filter(error => error !== errorToRemove));
    }
  }, []);

  return {
    // State
    isStreaming,
    articles,
    progress,
    status,
    currentMessage,
    sources,
    errors,
    streamId,
    apiUrl,
    
    // Computed values
    completedSources: progress.completed,
    totalSources: progress.total,
    hasErrors: errors.length > 0,
    isComplete: status === 'complete',
    isError: status === 'error',
    
    // Actions
    startStream,
    abortStream,
    clearErrors,
    removeError,
    retryCount,
    maxRetries
  }
}
