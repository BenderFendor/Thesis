import { API_BASE_URL, streamNews } from '@/lib/api';
import type { NewsArticle, StreamOptions, StreamProgress } from '@/lib/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  endStream as perfEndStream,
  logStreamEvent as perfLogStreamEvent,
  perfLogger,
  startStream as perfStartStream,
} from "@/lib/performance-logger";
import { logger } from "@/lib/logger";
import { z } from "zod";

interface NewsStreamCompletion {
  readonly articles: readonly Readonly<NewsArticle>[];
  readonly errors: readonly string[];
  readonly sources: readonly string[];
}

interface NewsStreamResult extends NewsStreamCompletion {
  readonly streamId?: string;
}

interface UseNewsStreamOptions extends Omit<
  StreamOptions,
  "onProgress" | "onSourceComplete" | "onError"
> {
  readonly onComplete?: (result: Readonly<NewsStreamCompletion>) => void;
  readonly onError?: (error: string) => void;
  readonly onUpdate?: (articles: readonly Readonly<NewsArticle>[]) => void;
}

interface MutableRef<TValue> {
  current: TValue;
}

interface ArticleIdTracker {
  readonly add: (value: string) => void;
  readonly has: (value: string) => boolean;
}

type StateSetter<TValue> = Dispatch<SetStateAction<TValue>>;
type StreamOptionsOverride = Readonly<
  Partial<Pick<StreamOptions, "category" | "signal" | "useCache">>
>;
type StreamStarter = (
  streamOptions?: StreamOptionsOverride,
) => Promise<void>;

interface StreamCallbacks {
  readonly onError: (error: string) => void;
  readonly onProgress: (progress: Readonly<StreamProgress>) => void;
  readonly onSourceComplete: (
    source: string,
    articles: readonly Readonly<NewsArticle>[],
  ) => void;
}

interface StreamLifecycleContext {
  readonly abortControllerRef: MutableRef<AbortController | undefined>;
  readonly isMountedRef: MutableRef<boolean>;
  readonly isStreamingRef: MutableRef<boolean>;
  readonly optionsRef: MutableRef<Readonly<UseNewsStreamOptions>>;
  readonly setCurrentMessage: StateSetter<string>;
  readonly setErrors: StateSetter<string[]>;
  readonly setIsStreaming: StateSetter<boolean>;
  readonly setStatus: StateSetter<string>;
  readonly startingRef: MutableRef<boolean>;
}

interface StreamRunContext extends StreamLifecycleContext {
  readonly flushPendingArticles: () => void;
  readonly flushTimerRef: MutableRef<ReturnType<typeof setTimeout> | undefined>;
  readonly maxRetries: number;
  readonly pendingArticlesRef: MutableRef<NewsArticle[]>;
  readonly retryCountRef: MutableRef<number>;
  readonly scheduleArticlesFlush: () => void;
  readonly seenArticleIdsRef: MutableRef<Set<string>>;
  readonly setApiUrl: StateSetter<string | undefined>;
  readonly setArticles: StateSetter<NewsArticle[]>;
  readonly setProgress: StateSetter<StreamProgress>;
  readonly setRetryCount: StateSetter<number>;
  readonly setSources: StateSetter<string[]>;
  readonly setStreamId: StateSetter<string | undefined>;
  readonly startStreamRef: MutableRef<StreamStarter | undefined>;
  readonly streamPromiseRef: MutableRef<Promise<NewsStreamResult> | undefined>;
}

interface StreamRefValues {
  readonly isStreaming: boolean;
  readonly isStreamingRef: MutableRef<boolean>;
  readonly options: Readonly<UseNewsStreamOptions>;
  readonly optionsRef: MutableRef<Readonly<UseNewsStreamOptions>>;
  readonly retryCount: number;
  readonly retryCountRef: MutableRef<number>;
}

interface ImageUpdate {
  readonly article_url: string;
  readonly image_url: string;
  readonly type: typeof IMAGE_UPDATE_TYPE;
}

interface UseNewsStreamResult {
  readonly abortStream: (immediate?: boolean) => void;
  readonly apiUrl: string | undefined;
  readonly articles: NewsArticle[];
  readonly clearErrors: () => void;
  readonly completedSources: number;
  readonly currentMessage: string;
  readonly errors: string[];
  readonly hasErrors: boolean;
  readonly isComplete: boolean;
  readonly isError: boolean;
  readonly isStreaming: boolean;
  readonly maxRetries: number;
  readonly progress: StreamProgress;
  readonly removeError: (errorToRemove: string) => void;
  readonly retryCount: number;
  readonly sources: string[];
  readonly startStream: StreamStarter;
  readonly status: string;
  readonly streamId: string | undefined;
  readonly totalSources: number;
}

const ARTICLE_FLUSH_DELAY_MS = 80,
  DEFAULT_MAX_RETRIES = 3,
  EMPTY_COUNT = 0,
  FIRST_INDEX = 0,
  HTTP_PROTOCOL_PATTERN = /^http/u,
  IMAGE_UPDATE_SCHEMA = z.object({
    article_url: z.string(),
    image_url: z.string(),
    type: z.literal("image_update"),
  }),
  IMAGE_UPDATE_TYPE = "image_update",
  RANDOM_SUFFIX_LENGTH = 6,
  RANDOM_SUFFIX_RADIX = 36,
  RANDOM_SUFFIX_START = 2,
  RETRY_BACKOFF_BASE_MS = 2000,
  RETRY_BACKOFF_RADIX = 2,
  RETRY_COUNT_INCREMENT = 1,
  STREAM_CANCELLATION_MESSAGE =
    "Stream cancelled. This is expected on initial load in development. Click to retry.",
  WEBSOCKET_PATH = "/ws",

  assignRef = <TValue>(
  ref: MutableRef<TValue>,
  value: TValue,
): void => {
  ref.current = value;
  },

  syncStreamRefs = (values: Readonly<StreamRefValues>): void => {
  assignRef(values.optionsRef, values.options);
  assignRef(values.isStreamingRef, values.isStreaming);
  assignRef(values.retryCountRef, values.retryCount);
  },

  clearFlushTimer = (
  timerRef: MutableRef<ReturnType<typeof setTimeout> | undefined>,
): void => {
  const timer = timerRef.current;
  if (timer === undefined) {
    return;
  }
  clearTimeout(timer);
  timerRef.current = undefined;
  },

  isNewArticle = (
  article: Readonly<NewsArticle>,
  tracker: Readonly<ArticleIdTracker>,
): boolean => {
  const idKey = `id:${article.id}`;
  let urlKey = "";
  if (article.url.length > EMPTY_COUNT) {
    urlKey = `url:${article.url}`;
  }
  if (urlKey.length > EMPTY_COUNT && tracker.has(urlKey)) {
    return false;
  }
  if (tracker.has(idKey)) {
    return false;
  }
  if (urlKey.length > EMPTY_COUNT) {
    tracker.add(urlKey);
  }
  tracker.add(idKey);
  return true;
  },

  getNewArticles = (
  articles: readonly Readonly<NewsArticle>[],
  tracker: Readonly<ArticleIdTracker>,
): NewsArticle[] => articles.filter((article) => isNewArticle(article, tracker)),

  createTrackingStreamId = (): string => {
  const randomSuffix = Math.random()
    .toString(RANDOM_SUFFIX_RADIX)
    .slice(RANDOM_SUFFIX_START, RANDOM_SUFFIX_START + RANDOM_SUFFIX_LENGTH);
  return `fe_stream_${Date.now()}_${randomSuffix}`;
  },

  calculateRetryDelay = (retryCount: number): number =>
  RETRY_BACKOFF_BASE_MS * RETRY_BACKOFF_RADIX ** retryCount,

  waitForRetry = (delayMs: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, delayMs);
  return promise;
  },

  buildStreamOptions = (
  callbacks: Readonly<StreamCallbacks>,
  options: Readonly<UseNewsStreamOptions>,
  signal: AbortSignal,
  streamOptions?: StreamOptionsOverride,
): StreamOptions => {
  const baseOptions = {
    category: options.category,
    useCache: options.useCache ?? true,
  };
  return {
    ...baseOptions,
    ...streamOptions,
    onError: callbacks.onError,
    onProgress: callbacks.onProgress,
    onSourceComplete: callbacks.onSourceComplete,
    signal,
  };
  },

  resetStreamBuffers = (context: Readonly<StreamRunContext>): void => {
  context.seenArticleIdsRef.current.clear();
  context.pendingArticlesRef.current = [];
  clearFlushTimer(context.flushTimerRef);
  context.isStreamingRef.current = true;
  },

  resetStreamState = (context: Readonly<StreamRunContext>): void => {
  resetStreamBuffers(context);
  context.setApiUrl(undefined);
  context.setArticles([]);
  context.setCurrentMessage("Loading cached articles from database...");
  context.setErrors([]);
  context.setIsStreaming(true);
  context.setProgress({
    completed: EMPTY_COUNT,
    percentage: EMPTY_COUNT,
    total: EMPTY_COUNT,
  });
  context.setSources([]);
  context.setStatus("starting");
  context.setStreamId(undefined);
  },

  prepareStream = (
  context: Readonly<StreamRunContext>,
): AbortController => {
  const controller = new AbortController(),
    previousController = context.abortControllerRef.current;
  if (previousController !== undefined) {
    previousController.abort();
  }

  context.abortControllerRef.current = controller;
  context.startingRef.current = true;
  resetStreamState(context);
  return controller;
  },

  createStreamCallbacks = (
  context: Readonly<StreamRunContext>,
  trackingStreamId: string,
): StreamCallbacks => {
  const onError = (error: string): void => {
    if (!context.isMountedRef.current) {
      return;
    }
    context.setErrors((previous: readonly string[]) => [...previous, error]);
    context.optionsRef.current.onError?.(error);
    perfLogStreamEvent(trackingStreamId, "error", {
      details: { error },
      isError: true,
    });
  },

  onProgress = (streamProgress: Readonly<StreamProgress>): void => {
    if (!context.isMountedRef.current) {
      return;
    }
    const { message: progressMessage } = streamProgress;
    let message = `${streamProgress.completed}/${streamProgress.total} sources processed`;
    if (
      progressMessage !== undefined &&
      progressMessage !== ""
    ) {
      message = progressMessage;
    }
    context.setCurrentMessage(message);
    context.setProgress({ ...streamProgress });
    context.setStatus("loading");
    perfLogStreamEvent(trackingStreamId, "progress", {
      details: {
        completed: streamProgress.completed,
        message: streamProgress.message,
        percentage: streamProgress.percentage,
        total: streamProgress.total,
      },
    });
  },

  onSourceComplete = (
    source: string,
    sourceArticles: readonly Readonly<NewsArticle>[],
  ): void => {
    if (!context.isMountedRef.current) {
      return;
    }
    perfLogStreamEvent(trackingStreamId, "source_complete", {
      articleCount: sourceArticles.length,
      source,
    });
    const newArticles = getNewArticles(
      sourceArticles,
      context.seenArticleIdsRef.current,
    );
    if (newArticles.length > EMPTY_COUNT) {
      context.pendingArticlesRef.current.push(...newArticles);
      context.scheduleArticlesFlush();
    }
    context.setSources((previous: readonly string[]) => [
      ...new Set([...previous, source]),
    ]);
  };

  return { onError, onProgress, onSourceComplete };
  },

  consumeStream = (
  context: Readonly<StreamRunContext>,
  controller: AbortController,
  trackingStreamId: string,
  streamOptions: StreamOptionsOverride | undefined,
): Promise<NewsStreamResult> => {
  const callbacks = createStreamCallbacks(context, trackingStreamId),
    streamData = streamNews(
      buildStreamOptions(
        callbacks,
        context.optionsRef.current,
        controller.signal,
        streamOptions,
      ),
    );
  context.streamPromiseRef.current = streamData.promise;
  context.setApiUrl(streamData.url);
  return streamData.promise;
  },

  applyCompletionState = (
  context: Readonly<StreamRunContext>,
  result: Readonly<NewsStreamResult>,
): void => {
  context.setArticles([...result.articles]);
  context.setCurrentMessage(
    `Loaded ${result.articles.length} articles from ${result.sources.length} sources`,
  );
  context.setErrors([...result.errors]);
  context.setSources([...result.sources]);
  context.setStatus("complete");
  context.setStreamId(result.streamId);
  context.optionsRef.current.onComplete?.(result);
  context.setRetryCount(EMPTY_COUNT);
  },

  completeStream = (
  context: Readonly<StreamRunContext>,
  result: Readonly<NewsStreamResult>,
  streamStartTime: number,
  trackingStreamId: string,
): void => {
  applyCompletionState(context, result);
  perfEndStream(trackingStreamId, "complete");
  perfLogger.logEvent("stream_end", "stream", "complete", {
    details: {
      articleCount: result.articles.length,
      backendStreamId: result.streamId,
      errorCount: result.errors.length,
      sourceCount: result.sources.length,
    },
    durationMs: Date.now() - streamStartTime,
    streamId: trackingStreamId,
  });
  },

  cancelStreamFailure = (
  context: Readonly<StreamRunContext>,
  trackingStreamId: string,
): void => {
  context.setCurrentMessage("Stream was cancelled");
  context.setStatus("cancelled");
  perfEndStream(trackingStreamId, "cancelled");
  },

  reportStreamFailure = (
  context: Readonly<StreamRunContext>,
  errorMessage: string,
  trackingStreamId: string,
): void => {
  context.setCurrentMessage("Failed to load news. Please try again later.");
  context.setStatus("error");
  context.optionsRef.current.onError?.(errorMessage);
  perfEndStream(trackingStreamId, "error");
  },

  retryStreamFailure = async (
  context: Readonly<StreamRunContext>,
  streamOptions: StreamOptionsOverride | undefined,
  trackingStreamId: string,
): Promise<void> => {
  const delay = calculateRetryDelay(context.retryCountRef.current),
    nextRetryCount = context.retryCountRef.current + RETRY_COUNT_INCREMENT,
    retryStarter = context.startStreamRef.current;
  context.setCurrentMessage(
    `Connection lost, retrying... (${nextRetryCount}/${context.maxRetries})`,
  );
  context.setStatus(`retrying-${nextRetryCount}`);
  perfLogStreamEvent(trackingStreamId, "retry", {
    details: { delayMs: delay, retryCount: nextRetryCount },
  });
  await waitForRetry(delay);
  context.setRetryCount(nextRetryCount);
  if (retryStarter !== undefined) {
    await retryStarter(streamOptions);
  }
  },

  handleStreamFailure = async (
  context: Readonly<StreamRunContext>,
  errorMessage: string,
  streamOptions: StreamOptionsOverride | undefined,
  trackingStreamId: string,
): Promise<void> => {
  const abortController = context.abortControllerRef.current;
  if (abortController?.signal.aborted === true) {
    cancelStreamFailure(context, trackingStreamId);
    return;
  }
  if (context.retryCountRef.current >= context.maxRetries) {
    reportStreamFailure(context, errorMessage, trackingStreamId);
    return;
  }
  await retryStreamFailure(context, streamOptions, trackingStreamId);
  },

  finishStreamAttempt = (context: Readonly<StreamRunContext>): void => {
  if (!context.isMountedRef.current) {
    return;
  }
  context.isStreamingRef.current = false;
  context.setIsStreaming(false);
  context.startingRef.current = false;
  },

  getErrorMessage = (error: unknown): string => {
  const message = String(error);
  if (error instanceof Error) {
    return error.message;
  }
  return message;
  },

  handleStreamAttemptError = async (
  context: Readonly<StreamRunContext>,
  error: unknown,
  streamOptions: StreamOptionsOverride | undefined,
  trackingStreamId: string,
): Promise<void> => {
  if (context.isMountedRef.current) {
    await handleStreamFailure(
      context,
      getErrorMessage(error),
      streamOptions,
      trackingStreamId,
    );
  }
  },

  runStreamAttempt = async (
  context: Readonly<StreamRunContext>,
  streamStartTime: number,
  streamOptions: StreamOptionsOverride | undefined,
): Promise<void> => {
  const controller = prepareStream(context),
    trackingStreamId = createTrackingStreamId();
  perfStartStream(trackingStreamId);
  try {
    const result = await consumeStream(
      context,
      controller,
      trackingStreamId,
      streamOptions,
    );
    context.flushPendingArticles();
    if (context.isMountedRef.current) {
      completeStream(context, result, streamStartTime, trackingStreamId);
    }
  } catch (error) {
    await handleStreamAttemptError(
      context,
      error,
      streamOptions,
      trackingStreamId,
    );
  } finally {
    finishStreamAttempt(context);
  }
  },

  runStream = async (
  context: Readonly<StreamRunContext>,
  streamOptions: StreamOptionsOverride | undefined,
): Promise<void> => {
  if (context.startingRef.current || context.isStreamingRef.current) {
    console.warn("Stream already in progress, ignoring start request");
    return;
  }
  const streamStartTime = Date.now();
  logger.debug("Starting news stream with options:", {
    ...context.optionsRef.current,
    ...streamOptions,
  });
  await runStreamAttempt(context, streamStartTime, streamOptions);
  },

  finishActiveAbort = (
  context: Readonly<StreamLifecycleContext>,
  immediate: boolean,
): void => {
  if (!context.isMountedRef.current) {
    return;
  }
  context.isStreamingRef.current = false;
  context.setIsStreaming(false);
  context.setStatus("cancelled");
  context.setCurrentMessage(STREAM_CANCELLATION_MESSAGE);
  if (!immediate) {
    return;
  }
  context.setErrors((previous: readonly string[]) => [
    ...previous,
    STREAM_CANCELLATION_MESSAGE,
  ]);
  context.optionsRef.current.onError?.(STREAM_CANCELLATION_MESSAGE);
  },

  abortActiveStream = (
  context: Readonly<StreamLifecycleContext>,
  immediate: boolean,
): void => {
  const controller = context.abortControllerRef.current;
  if (
    !context.startingRef.current &&
    !context.isStreamingRef.current
  ) {
    return;
  }
  if (controller === undefined || controller.signal.aborted) {
    return;
  }
  controller.abort();
  finishActiveAbort(context, immediate);
  },

  parseImageUpdate = (rawData: string): ImageUpdate | undefined => {
  try {
    const parsed = IMAGE_UPDATE_SCHEMA.safeParse(JSON.parse(rawData));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    return undefined;
  }
  return undefined;
  },

  updateArticleImage = (
  article: Readonly<NewsArticle>,
  update: Readonly<ImageUpdate>,
): NewsArticle => {
  if (article.url === update.article_url) {
    return { ...article, image: update.image_url };
  }
  return article;
  },

  handleImageUpdate = (
  event: Readonly<MessageEvent<unknown>>,
  setArticles: StateSetter<NewsArticle[]>,
): void => {
  const stringData = z.string().safeParse(event.data);
  if (!stringData.success) {
    return;
  }
  const update = parseImageUpdate(stringData.data);
  if (update === undefined) {
    return;
  }
  setArticles((previous: readonly NewsArticle[]) =>
    previous.map((article) => updateArticleImage(article, update)),
  );
  },

  buildWebSocketUrl = (): string =>
  `${API_BASE_URL.replace(HTTP_PROTOCOL_PATTERN, "ws")}${WEBSOCKET_PATH}`,

  cleanupStreamOnUnmount = (
  context: Readonly<Pick<StreamRunContext, "abortControllerRef" | "flushTimerRef" | "isMountedRef" | "isStreamingRef">>,
): void => {
  clearFlushTimer(context.flushTimerRef);
  const controller = context.abortControllerRef.current;
  if (context.isStreamingRef.current && controller !== undefined) {
    logger.debug("Component unmounting, aborting stream");
    controller.abort();
  }
  assignRef(context.isMountedRef, false);
  },

  useNewsStream = (
  options: Readonly<UseNewsStreamOptions> = {},
): UseNewsStreamResult => {
  const [apiUrl, setApiUrl] = useState<string>(),
    [articles, setArticles] = useState<NewsArticle[]>([]),
    [currentMessage, setCurrentMessage] = useState(""),
    [errors, setErrors] = useState<string[]>([]),
    [isStreaming, setIsStreaming] = useState(false),
    [progress, setProgress] = useState<StreamProgress>({
      completed: EMPTY_COUNT,
      percentage: EMPTY_COUNT,
      total: EMPTY_COUNT,
    }),
    [retryCount, setRetryCount] = useState(EMPTY_COUNT),
    [sources, setSources] = useState<string[]>([]),
    [status, setStatus] = useState("idle"),
    [streamId, setStreamId] = useState<string>(),
    abortControllerRef = useRef<AbortController | undefined>(void 0),
    flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(void 0),
    isMountedRef = useRef(true),
    isStreamingRef = useRef(isStreaming),
    optionsRef = useRef<Readonly<UseNewsStreamOptions>>(options),
    pendingArticlesRef = useRef<NewsArticle[]>([]),
    retryCountRef = useRef(retryCount),
    seenArticleIdsRef = useRef(new Set<string>()),
    startStreamRef = useRef<StreamStarter | undefined>(void 0),
    startingRef = useRef(false),
    streamPromiseRef = useRef<Promise<NewsStreamResult> | undefined>(void 0),
    abortStream = useCallback((immediate = false): void => {
      abortActiveStream(
        {
          abortControllerRef,
          isMountedRef,
          isStreamingRef,
          optionsRef,
          setCurrentMessage,
          setErrors,
          setIsStreaming,
          setStatus,
          startingRef,
        },
        immediate,
      );
    }, []),
    clearErrors = useCallback((): void => {
      if (isMountedRef.current) {
        setErrors([]);
      }
    }, []),
    flushPendingArticles = useCallback((): void => {
      clearFlushTimer(flushTimerRef);
      if (
        pendingArticlesRef.current.length === EMPTY_COUNT ||
        !isMountedRef.current
      ) {
        return;
      }
      const batch = pendingArticlesRef.current.splice(FIRST_INDEX);
      setArticles((previous: readonly NewsArticle[]) => {
        const updated = [...previous, ...batch];
        optionsRef.current.onUpdate?.(updated);
        return updated;
      });
    }, []),
    removeError = useCallback((errorToRemove: string): void => {
      if (isMountedRef.current) {
        setErrors((previous: readonly string[]) =>
          previous.filter((error) => error !== errorToRemove),
        );
      }
    }, []),
    scheduleArticlesFlush = useCallback((): void => {
      if (flushTimerRef.current !== undefined) {
        return;
      }
      assignRef(
        flushTimerRef,
        setTimeout(flushPendingArticles, ARTICLE_FLUSH_DELAY_MS),
      );
    }, [flushPendingArticles]),
    startStream = useCallback(
      (streamOptions?: StreamOptionsOverride): Promise<void> =>
        runStream(
          {
            abortControllerRef,
            flushPendingArticles,
            flushTimerRef,
            isMountedRef,
            isStreamingRef,
            maxRetries: DEFAULT_MAX_RETRIES,
            optionsRef,
            pendingArticlesRef,
            retryCountRef,
            scheduleArticlesFlush,
            seenArticleIdsRef,
            setApiUrl,
            setArticles,
            setCurrentMessage,
            setErrors,
            setIsStreaming,
            setProgress,
            setRetryCount,
            setSources,
            setStatus,
            setStreamId,
            startStreamRef,
            startingRef,
            streamPromiseRef,
          },
          streamOptions,
        ),
      [flushPendingArticles, scheduleArticlesFlush],
    );

  useEffect(() => {
    syncStreamRefs({
      isStreaming,
      isStreamingRef,
      options,
      optionsRef,
      retryCount,
      retryCountRef,
    });
  }, [isStreaming, options, retryCount]);

  useEffect(() => {
    assignRef(startStreamRef, startStream);
    return () => {
      assignRef(startStreamRef, void 0);
    };
  }, [startStream]);

  useEffect(() => {
    const handleMessage = (event: Readonly<MessageEvent<unknown>>): void => {
      handleImageUpdate(event, setArticles);
    },
      ws = new WebSocket(buildWebSocketUrl());
    Object.assign(ws, { onmessage: handleMessage });
    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    assignRef(isMountedRef, true);
    return () => {
      cleanupStreamOnUnmount({
        abortControllerRef,
        flushTimerRef,
        isMountedRef,
        isStreamingRef,
      });
    };
  }, []);

  return {
    abortStream,
    apiUrl,
    articles,
    clearErrors,
    completedSources: progress.completed,
    currentMessage,
    errors,
    hasErrors: errors.length > EMPTY_COUNT,
    isComplete: status === "complete",
    isError: status === "error",
    isStreaming,
    maxRetries: DEFAULT_MAX_RETRIES,
    progress,
    removeError,
    retryCount,
    sources,
    startStream,
    status,
    streamId,
    totalSources: progress.total,
  };
  };

export { useNewsStream };
