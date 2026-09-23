import { streamNews } from "@/lib/api";
import type { Dispatch, SetStateAction } from "react";
import type { NewsArticle, StreamOptions, StreamProgress } from "@/lib/api";
import {
  endStream as perfEndStream,
  logStreamEvent as perfLogStreamEvent,
  perfLogger,
  startStream as perfStartStream,
} from "@/lib/performance-logger";
import type { ReadonlyNewsArticle } from "@/app/search/research/model/types";
import { logger } from "@/lib/logger";

interface NewsStreamCompletion {
  readonly articles: readonly ReadonlyNewsArticle[];
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
  readonly onUpdate?: (articles: readonly ReadonlyNewsArticle[]) => void;
}

interface MutableRef<TValue> {
  readonly current: ReadonlyRefValue<TValue>;
}

interface ArticleIdTracker {
  readonly add: (value: string) => void;
  readonly has: (value: string) => boolean;
}

type StateSetter<TValue> = Dispatch<SetStateAction<TValue>>;
type StreamOptionsOverride = Readonly<
  Partial<Pick<StreamOptions, "category" | "signal" | "useCache">>
>;
type StreamStarter = (streamOptions?: StreamOptionsOverride) => Promise<void>;

interface StreamCallbacks {
  readonly onError: (error: string) => void;
  readonly onProgress: (progress: Readonly<StreamProgress>) => void;
  readonly onSourceComplete: (source: string, articles: readonly ReadonlyNewsArticle[]) => void;
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

type ReadonlyRefValue<TValue> = TValue extends (...args: readonly never[]) => infer _Return
  ? TValue
  : TValue extends object
    ? Readonly<TValue>
    : TValue;

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

const ARTICLE_FLUSH_DELAY_MS = 80;
const DEFAULT_MAX_RETRIES = 3;
const EMPTY_COUNT = 0;
const FIRST_INDEX = 0;
const RANDOM_SUFFIX_LENGTH = 6;
const RANDOM_SUFFIX_RADIX = 36;
const RANDOM_SUFFIX_START = 2;
const RETRY_BACKOFF_BASE_MS = 2000;
const RETRY_BACKOFF_RADIX = 2;
const RETRY_COUNT_INCREMENT = 1;
const STREAM_CANCELLATION_MESSAGE =
    "Stream cancelled. This is expected on initial load in development. Click to retry.";
const assignRef = <TValue>(ref: MutableRef<TValue>, value: TValue): void => {
    Object.assign(ref, { current: value });
  };
const syncStreamRefs = (values: Readonly<StreamRefValues>): void => {
    assignRef(values.optionsRef, values.options);
    assignRef(values.isStreamingRef, values.isStreaming);
    assignRef(values.retryCountRef, values.retryCount);
  };
const clearFlushTimer = (timerRef: MutableRef<ReturnType<typeof setTimeout> | undefined>): void => {
    const timer = timerRef.current;
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    assignRef(timerRef, void 0);
  };
const getArticleUrlKey = (article: ReadonlyNewsArticle): string => {
    if (article.url.length > EMPTY_COUNT) {
      return `url:${article.url}`;
    }
    return "";
  };
const isNewArticle = (article: ReadonlyNewsArticle, tracker: Readonly<ArticleIdTracker>): boolean => {
    const idKey = `id:${article.id}`;
    const urlKey = getArticleUrlKey(article);
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
  };
const getNewArticles = (
    articles: readonly ReadonlyNewsArticle[],
    tracker: Readonly<ArticleIdTracker>,
  ): NewsArticle[] => articles.filter((article) => isNewArticle(article, tracker));
const createTrackingStreamId = (): string => {
    const randomSuffix = Math.random()
      .toString(RANDOM_SUFFIX_RADIX)
      .slice(RANDOM_SUFFIX_START, RANDOM_SUFFIX_START + RANDOM_SUFFIX_LENGTH);
    return `fe_stream_${Date.now()}_${randomSuffix}`;
  };
const calculateRetryDelay = (retryCount: number): number =>
    RETRY_BACKOFF_BASE_MS * RETRY_BACKOFF_RADIX ** retryCount;
const waitForRetry = (delayMs: number): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, delayMs);
    return promise;
  };
const buildStreamOptions = (
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
  };
const getProgressDetails = (progress: Readonly<StreamProgress>) => ({
    completed: progress.completed,
    message: progress.message,
    percentage: progress.percentage,
    total: progress.total,
  });
const resetStreamBuffers = (context: Readonly<StreamRunContext>): void => {
    context.seenArticleIdsRef.current.clear();
    assignRef(context.pendingArticlesRef, []);
    clearFlushTimer(context.flushTimerRef);
    assignRef(context.isStreamingRef, true);
  };
const resetStreamState = (context: Readonly<StreamRunContext>): void => {
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
  };
const prepareStream = (context: Readonly<StreamRunContext>): AbortController => {
    const controller = new AbortController(),
      previousController = context.abortControllerRef.current;
    if (previousController !== undefined) {
      previousController.abort();
    }

    assignRef(context.abortControllerRef, controller);
    assignRef(context.startingRef, true);
    resetStreamState(context);
    return controller;
  };
const createStreamCallbacks = (context: Readonly<StreamRunContext>, trackingStreamId: string): StreamCallbacks => {
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
        if (progressMessage !== undefined && progressMessage !== "") {
          message = progressMessage;
        }
        context.setCurrentMessage(message);
        context.setProgress({ ...streamProgress });
        context.setStatus("loading");
        perfLogStreamEvent(trackingStreamId, "progress", {
          details: getProgressDetails(streamProgress),
        });
      },
      onSourceComplete = (source: string, sourceArticles: readonly ReadonlyNewsArticle[]): void => {
        if (!context.isMountedRef.current) {
          return;
        }
        perfLogStreamEvent(trackingStreamId, "source_complete", {
          articleCount: sourceArticles.length,
          source,
        });
        const newArticles = getNewArticles(sourceArticles, context.seenArticleIdsRef.current);
        if (newArticles.length > EMPTY_COUNT) {
          assignRef(context.pendingArticlesRef, [
            ...context.pendingArticlesRef.current,
            ...newArticles,
          ]);
          context.scheduleArticlesFlush();
        }
        context.setSources((previous: readonly string[]) => [...new Set([...previous, source])]);
      };

    return { onError, onProgress, onSourceComplete };
  };
const consumeStream = (
    context: Readonly<StreamRunContext>,
    controller: AbortController,
    trackingStreamId: string,
    streamOptions: StreamOptionsOverride | undefined,
  ): Promise<NewsStreamResult> => {
    const callbacks = createStreamCallbacks(context, trackingStreamId),
      streamData = streamNews(
        buildStreamOptions(callbacks, context.optionsRef.current, controller.signal, streamOptions),
      );
    assignRef(context.streamPromiseRef, streamData.promise);
    context.setApiUrl(streamData.url);
    return streamData.promise;
  };
const applyCompletionState = (
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
  };
const completeStream = (
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
  };
const cancelStreamFailure = (context: Readonly<StreamRunContext>, trackingStreamId: string): void => {
    context.setCurrentMessage("Stream was cancelled");
    context.setStatus("cancelled");
    perfEndStream(trackingStreamId, "cancelled");
  };
const reportStreamFailure = (
    context: Readonly<StreamRunContext>,
    errorMessage: string,
    trackingStreamId: string,
  ): void => {
    context.setCurrentMessage("Failed to load news. Please try again later.");
    context.setStatus("error");
    context.optionsRef.current.onError?.(errorMessage);
    perfEndStream(trackingStreamId, "error");
  };
const retryStreamFailure = async (
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
  };
const handleStreamFailure = async (
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
  };
const finishStreamAttempt = (context: Readonly<StreamRunContext>): void => {
    if (!context.isMountedRef.current) {
      return;
    }
    assignRef(context.isStreamingRef, false);
    context.setIsStreaming(false);
    assignRef(context.startingRef, false);
  };
const getErrorMessage = (error: Error | string): string => {
    if (error instanceof Error) {
      return error.message;
    }
    return error;
  };
const handleStreamAttemptError = async (
    context: Readonly<StreamRunContext>,
    error: Error | string,
    streamOptions: StreamOptionsOverride | undefined,
    trackingStreamId: string,
  ): Promise<void> => {
    if (context.isMountedRef.current) {
      await handleStreamFailure(context, getErrorMessage(error), streamOptions, trackingStreamId);
    }
  };
const runStreamAttempt = async (
    context: Readonly<StreamRunContext>,
    streamStartTime: number,
    streamOptions: StreamOptionsOverride | undefined,
  ): Promise<void> => {
    const controller = prepareStream(context),
      trackingStreamId = createTrackingStreamId();
    perfStartStream(trackingStreamId);
    try {
      const result = await consumeStream(context, controller, trackingStreamId, streamOptions);
      context.flushPendingArticles();
      if (context.isMountedRef.current) {
        completeStream(context, result, streamStartTime, trackingStreamId);
      }
    } catch (error) {
      const normalizedError = (() => {
  if (error instanceof Error) {
    return error;
  }
  return String(error);
})();
      await handleStreamAttemptError(context, normalizedError, streamOptions, trackingStreamId);
    } finally {
      finishStreamAttempt(context);
    }
  };
const runStream = async (
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
  };
const finishActiveAbort = (context: Readonly<StreamLifecycleContext>, immediate: boolean): void => {
    if (!context.isMountedRef.current) {
      return;
    }
    assignRef(context.isStreamingRef, false);
    context.setIsStreaming(false);
    context.setStatus("cancelled");
    context.setCurrentMessage(STREAM_CANCELLATION_MESSAGE);
    if (!immediate) {
      return;
    }
    context.setErrors((previous: readonly string[]) => [...previous, STREAM_CANCELLATION_MESSAGE]);
    context.optionsRef.current.onError?.(STREAM_CANCELLATION_MESSAGE);
  };
const abortActiveStream = (context: Readonly<StreamLifecycleContext>, immediate: boolean): void => {
    const controller = context.abortControllerRef.current;
    if (!context.startingRef.current && !context.isStreamingRef.current) {
      return;
    }
    if (controller === undefined || controller.signal.aborted) {
      return;
    }
    controller.abort();
    finishActiveAbort(context, immediate);
  };

export {
  type ArticleIdTracker,
  ARTICLE_FLUSH_DELAY_MS,
  DEFAULT_MAX_RETRIES,
  EMPTY_COUNT,
  FIRST_INDEX,
  type MutableRef,
  type NewsStreamCompletion,
  type NewsStreamResult,
  type ReadonlyRefValue,
  type StateSetter,
  type StreamCallbacks,
  type StreamLifecycleContext,
  type StreamOptionsOverride,
  type StreamRefValues,
  type StreamRunContext,
  type StreamStarter,
  type UseNewsStreamOptions,
  type UseNewsStreamResult,
  abortActiveStream,
  assignRef,
  clearFlushTimer,
  runStream,
  syncStreamRefs,
};
