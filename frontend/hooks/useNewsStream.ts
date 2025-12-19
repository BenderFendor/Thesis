import { useState, useEffect, useRef, useCallback } from 'react'
import { streamNews, type NewsArticle, type StreamOptions, type StreamProgress } from '@/lib/api'

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
  const seenArticleIdsRef = useRef<Set<number>>(new Set())

  const startStream = useCallback(async (streamOptions?: Partial<StreamOptions>) => {
    if (startingRef.current || isStreaming) {
      console.warn('Stream already in progress, ignoring start request');
      return;
    }

    console.log('Starting news stream with options:', { ...options, ...streamOptions });

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
        },
        onSourceComplete: (source, sourceArticles) => {
          if (!isMountedRef.current) return;

          // Filter out duplicates using a Set of article IDs
          const newArticles = sourceArticles.filter(article => {
            if (seenArticleIdsRef.current.has(article.id)) {
              return false; // Skip duplicate
            }
            seenArticleIdsRef.current.add(article.id);
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
      }
    } catch (error) {
      if (isMountedRef.current) {
        if (abortControllerRef.current?.signal.aborted) {
          setStatus('cancelled');
          setCurrentMessage('Stream was cancelled');
        } else if (retryCount < maxRetries) {
          const delay = 2000 * Math.pow(2, retryCount);
          setStatus(`retrying-${retryCount + 1}`);
          setCurrentMessage(`Connection lost, retrying... (${retryCount + 1}/${maxRetries})`);
          
          await new Promise(resolve => setTimeout(resolve, delay));
          setRetryCount(prev => prev + 1);
          return startStream(streamOptions);
        } else {
          setStatus('error');
          setCurrentMessage('Failed to load news. Please try again later.');
          options.onError?.(error instanceof Error ? error.message : String(error));
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
      console.log('Auto-starting stream');
      startStream();
    }
  }, [options.autoStart, isStreaming, status, startStream]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // On unmount, immediately abort the stream if it's still going
      if (isStreaming && abortControllerRef.current) {
        console.log('Component unmounting, aborting stream');
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
