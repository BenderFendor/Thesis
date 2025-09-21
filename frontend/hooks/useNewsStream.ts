import { useState, useEffect, useRef, useCallback } from 'react'
import { streamNews, type NewsArticle, type StreamOptions, type StreamProgress } from '@/lib/api'

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

  const startStream = useCallback(async (streamOptions?: Partial<StreamOptions>) => {
    if (startingRef.current || isStreaming) {
      console.warn('⚠️ Stream already in progress, ignoring start request');
      return;
    }

    console.log('🚀 Starting news stream with options:', { ...options, ...streamOptions });

    // Cancel any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    startingRef.current = true;
    
    // Reset state
    setIsStreaming(true)
    setArticles([])
    setProgress({ completed: 0, total: 0, percentage: 0 })
    setStatus('starting')
    setCurrentMessage('Initializing stream...')
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

          // Add new articles to the state
          setArticles(prev => {
            const updated = [...prev, ...sourceArticles];
            // Call onUpdate immediately with the new articles
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

  const abortStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      if (isMountedRef.current) {
        setIsStreaming(false);
        setStatus('cancelled');
        setCurrentMessage('Stream was cancelled');
      }
    }
  }, []);

  // WebSocket listener for image updates
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws');

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
      console.log('🚀 Auto-starting stream');
      startStream();
    }
  }, [options.autoStart, isStreaming, status, startStream]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortStream();
    };
  }, [abortStream]);

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
    retryCount,
    maxRetries
  }
}
