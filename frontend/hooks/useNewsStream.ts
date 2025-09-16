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

    try {
      const streamPromise = streamNews({
        useCache: options.useCache ?? true,
        ...streamOptions,
        signal: abortControllerRef.current.signal,
        onProgress: (progress) => {
          console.log('📊 Stream progress:', progress);
          if (!isMountedRef.current) return;
          setProgress(progress);
          setCurrentMessage(progress.message || `${progress.completed}/${progress.total} sources processed`);
          setStatus('loading');
        },
        onSourceComplete: (source, sourceArticles) => {
          console.log(`✅ Source ${source} completed with ${sourceArticles.length} articles`);
          if (!isMountedRef.current) return;
          setArticles(prev => {
            const newArticles = [...prev, ...sourceArticles];
            options.onUpdate?.(newArticles);
            return newArticles;
          });
          setSources(prev => Array.from(new Set([...prev, source])));
        },
        onError: (error) => {
          console.warn('⚠️ Stream error:', error);
          if (!isMountedRef.current) return;
          setErrors(prev => [...prev, error]);
          options.onError?.(error);
        }
      });

      streamPromiseRef.current = streamPromise;
      
      const result = await streamPromise;
      
      console.log('🏁 Stream completed:', {
        articlesCount: result.articles.length,
        sourcesCount: result.sources.length,
        errorsCount: result.errors.length,
        streamId: result.streamId
      });

      if (isMountedRef.current) {
        setArticles(result.articles);
        setSources(result.sources);
        setErrors(result.errors);
        setStreamId(result.streamId);
        setStatus('complete');
        setCurrentMessage(`Completed! Loaded ${result.articles.length} articles from ${result.sources.length} sources`);
        setProgress({ completed: result.sources.length, total: result.sources.length, percentage: 100 });
      }
      
      options.onComplete?.(result);
      
    } catch (error: any) {
      console.error('💥 Stream failed:', error);
      if (isMountedRef.current) {
        setStatus('error');
        setCurrentMessage(`Stream failed: ${error.message}`);
        setErrors(prev => [...prev, error.message]);
      }
      options.onError?.(error.message);
    } finally {
      startingRef.current = false;
      if (isMountedRef.current) {
        setIsStreaming(false);
      }
      streamPromiseRef.current = null;
      abortControllerRef.current = null;
    }
  }, [options]);

  const stopStream = useCallback(() => {
    console.log('🛑 Stopping stream');
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    if (streamPromiseRef.current) {
      streamPromiseRef.current = null;
    }
    
    if (isMountedRef.current) {
      setIsStreaming(false);
      setStatus('stopped');
      setCurrentMessage('Stream stopped by user');
    }
  }, []);

  const resetStream = useCallback(() => {
    console.log('🔄 Resetting stream state');
    stopStream();
    setArticles([]);
    setProgress({ completed: 0, total: 0, percentage: 0 });
    setStatus('idle');
    setCurrentMessage('');
    setSources([]);
    setErrors([]);
    setStreamId(undefined);
  }, [stopStream]);

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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    // State
    isStreaming,
    articles,
    progress: progress.percentage,
    progressDetails: progress,
    status,
    currentMessage,
    sources,
    errors,
    streamId,
    
    // Computed values
    completedSources: progress.completed,
    totalSources: progress.total,
    hasErrors: errors.length > 0,
    isComplete: status === 'complete',
    isError: status === 'error',
    
    // Actions
    startStream,
    stopStream,
    resetStream
  }
}
