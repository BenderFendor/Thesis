import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL,streamNews } from '@/lib/api';
import type { NewsArticle, StreamOptions, StreamProgress } from '@/lib/api';
import { logger } from "@/lib/logger";
import {
  endStream as perfEndStream,
  logStreamEvent as perfLogStreamEvent,
  perfLogger,
  startStream as perfStartStream,
} from "@/lib/performance-logger";

interface UseNewsStreamOptions extends Omit<
  StreamOptions,
  "onProgress" | "onSourceComplete" | "onError"
> {
  onUpdate?: (articles:readonly  NewsArticle[]) => void;
  onComplete?: (result:Readonly< {
    articles: NewsArticle[];
    sources: string[];
    errors: string[];
  }>) => void;
  onError?: (error: string) => void;
}

export const useNewsStream = (options: UseNewsStreamOptions = {}) => {
  const [isStreaming, setIsStreaming] = useState(false),
   [articles, setArticles] = useState<NewsArticle[]>([]),
   [progress, setProgress] = useState<StreamProgress>({
    completed: 0,
    percentage: 0,
    total: 0,
  }),
   [status, setStatus] = useState<string>("idle"),
   [currentMessage, setCurrentMessage] = useState(""),
   [sources, setSources] = useState<string[]>([]),
   [errors, setErrors] = useState<string[]>([]),
   [streamId, setStreamId] = useState<string>(),
   [apiUrl, setApiUrl] = useState<string | null>(undefined),
   [retryCount, setRetryCount] = useState(0),
   maxRetries = 3,

   streamPromiseRef = useRef<Promise<unknown> | null>(undefined),
   abortControllerRef = useRef<AbortController | null>(undefined),
   isMountedRef = useRef<boolean>(true),
   startingRef = useRef<boolean>(false),
   optionsRef = useRef(options),
   isStreamingRef = useRef(isStreaming),
   retryCountRef = useRef(retryCount),
   seenArticleIdsRef = useRef<Set<string>>(new Set()),
   pendingArticlesRef = useRef<NewsArticle[]>([]),
   flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(undefined);

  optionsRef.current = options;
  isStreamingRef.current = isStreaming;
  retryCountRef.current = retryCount;

  const flushPendingArticles = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = undefined;
    }
    if (pendingArticlesRef.current.length === 0 || !isMountedRef.current) {
      return;
    }

    const batch = pendingArticlesRef.current.splice(
      0,
    );
    setArticles((prev) => {
      const updated = [...prev, ...batch];
      optionsRef.current.onUpdate?.(updated);
      return updated;
    });
  }, []),

   scheduleArticlesFlush = useCallback(() => {
    if (flushTimerRef.current) {
      return;
    }
    flushTimerRef.current = setTimeout(() => {
      flushPendingArticles();
    }, 80);
  }, [flushPendingArticles]),

   startStream = useCallback(
    async (streamOptions?: Partial<StreamOptions>) => {
      if (startingRef.current || isStreamingRef.current) {
        console.warn("Stream already in progress, ignoring start request");
        return;
      }

      const streamStartTime = Date.now();
      logger.debug("Starting news stream with options:", {
        ...optionsRef.current,
        ...streamOptions,
      });

      // Cancel any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      startingRef.current = true;

      // Reset state and clear seen articles
      seenArticleIdsRef.current.clear();
      pendingArticlesRef.current = [];
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = undefined;
      }
      isStreamingRef.current = true;
      setIsStreaming(true);
      setArticles([]);
      setProgress({ completed: 0, percentage: 0, total: 0 });
      setStatus("starting");
      setCurrentMessage("Loading cached articles from database...");
      setSources([]);
      setErrors([]);
      setStreamId(undefined);
      setApiUrl(undefined);

      // Generate stream ID for tracking
      const trackingStreamId = `fe_stream_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      perfStartStream(trackingStreamId);

      try {
        const streamData = streamNews({
          useCache: optionsRef.current.useCache ?? true,
          category: optionsRef.current.category,
          ...streamOptions,
          signal: abortControllerRef.current.signal,
          onProgress: (progress) => {
            if (!isMountedRef.current) {return;}
            setProgress(progress);
            setCurrentMessage(
              progress.message ||
                `${progress.completed}/${progress.total} sources processed`,
            );
            setStatus("loading");

            // Log progress to performance logger
            perfLogStreamEvent(trackingStreamId, "progress", {
              details: {
                completed: progress.completed,
                message: progress.message,
                percentage: progress.percentage,
                total: progress.total,
              },
            });
          },
          onSourceComplete: (source, sourceArticles) => {
            if (!isMountedRef.current) {return;}

            // Log source completion to performance logger
            perfLogStreamEvent(trackingStreamId, "source_complete", {
              articleCount: sourceArticles.length,
              source,
            });

            // Filter out duplicates using a Set of article IDs
            const newArticles = sourceArticles.filter((article) => {
              const urlKey = article.url ? `url:${article.url}` : null,
               idKey = `id:${article.id}`;
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

            if (newArticles.length > 0) {
              pendingArticlesRef.current.push(...newArticles);
              scheduleArticlesFlush();
            }
            setSources((prev) => [...new Set([...prev, source])]);
          },
          onError: (error) => {
            if (!isMountedRef.current) {return;}
            setErrors((prev) => [...prev, error]);
            optionsRef.current.onError?.(error);

            // Log error to performance logger
            perfLogStreamEvent(trackingStreamId, "error", {
              details: { error },
              isError: true,
            });
          },
        });

        streamPromiseRef.current = streamData.promise;
        setApiUrl(streamData.url);

        const result = await streamData.promise;
        flushPendingArticles();

        if (isMountedRef.current) {
          setArticles(result.articles);
          setSources(result.sources);
          setErrors(result.errors);
          setStreamId(result.streamId);
          setStatus("complete");
          setCurrentMessage(
            `Loaded ${result.articles.length} articles from ${result.sources.length} sources`,
          );
          optionsRef.current.onComplete?.(result);
          setRetryCount(0); // Reset on success

          // End stream tracking with success
          const totalDuration = Date.now() - streamStartTime;
          perfEndStream(trackingStreamId, "complete");
          perfLogger.logEvent("stream_end", "stream", "complete", {
            details: {
              articleCount: result.articles.length,
              backendStreamId: result.streamId,
              errorCount: result.errors.length,
              sourceCount: result.sources.length,
            },
            durationMs: totalDuration,
            streamId: trackingStreamId,
          });
        }
      } catch (error) {
        if (isMountedRef.current) {
          if (abortControllerRef.current?.signal.aborted) {
            setStatus("cancelled");
            setCurrentMessage("Stream was cancelled");
            perfEndStream(trackingStreamId, "cancelled");
          } else if (retryCountRef.current < maxRetries) {
            const nextRetryCount = retryCountRef.current + 1,
             delay = 2000 * 2 ** retryCountRef.current;
            setStatus(`retrying-${nextRetryCount}`);
            setCurrentMessage(
              `Connection lost, retrying... (${nextRetryCount}/${maxRetries})`,
            );

            perfLogStreamEvent(trackingStreamId, "retry", {
              details: { delayMs: delay, retryCount: nextRetryCount },
            });

            await new Promise((resolve) => setTimeout(resolve, delay));
            setRetryCount(nextRetryCount);
            return startStream(streamOptions);
          } else {
            setStatus("error");
            setCurrentMessage("Failed to load news. Please try again later.");
            optionsRef.current.onError?.(
              error instanceof Error ? error.message : String(error),
            );
            perfEndStream(trackingStreamId, "error");
          }
        }
      } finally {
        if (isMountedRef.current) {
          startingRef.current = false;
          isStreamingRef.current = false;
          setIsStreaming(false);
        }
      }
    },
    [flushPendingArticles, scheduleArticlesFlush],
  ),

   abortStream = useCallback(
    (immediate = false) => {
      if (
        (startingRef.current || isStreamingRef.current) &&
        abortControllerRef.current &&
        !abortControllerRef.current.signal.aborted
      ) {
        abortControllerRef.current.abort();
        if (isMountedRef.current) {
          isStreamingRef.current = false;
          setIsStreaming(false);
          setStatus("cancelled");
          const cancellationError =
            "Stream cancelled. This is expected on initial load in development. Click to retry.";
          setCurrentMessage(cancellationError);
          if (immediate) {
            // Only add error for immediate cancellations (e.g., category change)
            setErrors((prev) => [...prev, cancellationError]);
            optionsRef.current.onError?.(cancellationError);
          }
        }
      }
    },
    [],
  );

  // WebSocket listener for image updates
  useEffect(() => {
    const ws = new WebSocket(
      `${API_BASE_URL.replace(/^http/, "ws")  }/ws` ||
        "ws://localhost:8000/ws",
    );

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "image_update") {
        setArticles((prev) =>
          prev.map((a) =>
            a.url === data.article_url ? { ...a, image: data.image_url } : a,
          ),
        );
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = undefined;
      }
      // On unmount, immediately abort the stream if it's still going
      if (isStreamingRef.current && abortControllerRef.current) {
        logger.debug("Component unmounting, aborting stream");
        abortControllerRef.current.abort();
      }
      isMountedRef.current = false;
    };
  }, []);

  const clearErrors = useCallback(() => {
    if (isMountedRef.current) {
      setErrors([]);
    }
  }, []),

   removeError = useCallback((errorToRemove: string) => {
    if (isMountedRef.current) {
      setErrors((prev) => prev.filter((error) => error !== errorToRemove));
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
    isComplete: status === "complete",
    isError: status === "error",

    // Actions
    startStream,
    abortStream,
    clearErrors,
    removeError,
    retryCount,
    maxRetries,
  };
};
