import type { NewsArticle, StreamProgress } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ARTICLE_FLUSH_DELAY_MS,
  DEFAULT_MAX_RETRIES,
  EMPTY_COUNT,
  abortActiveStream,
  assignRef,
  clearFlushTimer,
  runStream,
  syncStreamRefs,
} from "./use-news-stream-core";
import type {
  NewsStreamResult,
  StreamLifecycleContext,
  StreamOptionsOverride,
  StreamStarter,
  StreamRefValues,
  StreamRunContext,
  UseNewsStreamOptions,
  UseNewsStreamResult,
} from "./use-news-stream-core";
import {
  buildWebSocketUrl,
  cleanupStreamOnUnmount,
  handleImageUpdate,
} from "./use-news-stream-websocket";

interface MessageDataEvent {
  readonly data: unknown;
}

const useNewsStreamState = (options: Readonly<UseNewsStreamOptions>) => {
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
    streamPromiseRef = useRef<Promise<NewsStreamResult> | undefined>(void 0);
  return { abortControllerRef, apiUrl, articles, currentMessage, errors, flushTimerRef, isMountedRef, isStreaming, isStreamingRef, optionsRef, pendingArticlesRef, progress, retryCount, retryCountRef, seenArticleIdsRef, setApiUrl, setArticles, setCurrentMessage, setErrors, setIsStreaming, setProgress, setRetryCount, setSources, setStatus, setStreamId, sources, startStreamRef, startingRef, status, streamId, streamPromiseRef };
};

const useStreamControls = (state: Readonly<StreamLifecycleContext>) => {
  const {
    abortControllerRef,
    isMountedRef,
    isStreamingRef,
    optionsRef,
    setCurrentMessage,
    setErrors,
    setIsStreaming,
    setStatus,
    startingRef,
  } = state;
  const abortStream = useCallback((immediate = false): void => {
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
  }, [abortControllerRef, isMountedRef, isStreamingRef, optionsRef, setCurrentMessage, setErrors, setIsStreaming, setStatus, startingRef]);
  const clearErrors = useCallback((): void => {
    if (isMountedRef.current) {
      setErrors([]);
    }
  }, [isMountedRef, setErrors]);
  const removeError = useCallback((errorToRemove: string): void => {
    if (isMountedRef.current) {
      setErrors((previous: readonly string[]) => previous.filter((error) => error !== errorToRemove));
    }
  }, [isMountedRef, setErrors]);
  return { abortStream, clearErrors, removeError };
};

const useStreamFlush = (
  state: Readonly<
    Pick<
      StreamRunContext,
      "flushTimerRef" | "isMountedRef" | "optionsRef" | "pendingArticlesRef" | "setArticles"
    >
  >,
) => {
  const { flushTimerRef, isMountedRef, optionsRef, pendingArticlesRef, setArticles } = state;
  const flushPendingArticles = useCallback((): void => {
    clearFlushTimer(flushTimerRef);
    if (pendingArticlesRef.current.length === EMPTY_COUNT || !isMountedRef.current) {
      return;
    }
    const batch = [...pendingArticlesRef.current];
    assignRef(pendingArticlesRef, []);
    setArticles((previous: readonly NewsArticle[]) => {
      const updated = [...previous, ...batch];
      optionsRef.current.onUpdate?.(updated);
      return updated;
    });
  }, [flushTimerRef, isMountedRef, optionsRef, pendingArticlesRef, setArticles]);
  const scheduleArticlesFlush = useCallback((): void => {
    if (flushTimerRef.current !== undefined) {
      return;
    }
    assignRef(flushTimerRef, setTimeout(flushPendingArticles, ARTICLE_FLUSH_DELAY_MS));
  }, [flushPendingArticles, flushTimerRef]);
  return { flushPendingArticles, scheduleArticlesFlush };
};

type StreamFlushActions = ReturnType<typeof useStreamFlush>;
type StreamStarterState = Readonly<
  Omit<StreamRunContext, "flushPendingArticles" | "maxRetries" | "scheduleArticlesFlush">
>;
const createStreamStarter = (
  state: StreamStarterState,
  flush: Readonly<StreamFlushActions>,
): StreamStarter =>
  (streamOptions?: StreamOptionsOverride): Promise<void> =>
    runStream({ ...state, ...flush, maxRetries: DEFAULT_MAX_RETRIES }, streamOptions);

const useStreamStarter = (
  state: StreamStarterState,
  flush: Readonly<StreamFlushActions>,
): StreamStarter => {
  const [startStream, setStartStream] = useState(() => createStreamStarter(state, flush));
  void setStartStream;
  return startStream;
};

const useStreamSynchronization = (
  options: Readonly<UseNewsStreamOptions>,
  state: Readonly<
    Pick<StreamRefValues, "isStreaming" | "isStreamingRef" | "optionsRef" | "retryCount" | "retryCountRef">
  >,
  startStreamRef: StreamRunContext["startStreamRef"],
  startStream: StreamStarter,
): void => {
  const {
    isStreaming,
    isStreamingRef,
    optionsRef,
    retryCount,
    retryCountRef,
  } = state;
  useEffect(() => {
    syncStreamRefs({ isStreaming, isStreamingRef, options, optionsRef, retryCount, retryCountRef });
  }, [isStreaming, isStreamingRef, options, optionsRef, retryCount, retryCountRef]);
  useEffect(() => {
    assignRef(startStreamRef, startStream);
    return () => {
      assignRef(startStreamRef, void 0);
    };
  }, [startStream, startStreamRef]);
};

const useStreamSocket = (
  state: Readonly<Pick<StreamRunContext, "setArticles">>,
): void => {
  const { setArticles } = state;
  useEffect(() => {
    const handleMessage = (event: MessageDataEvent): void => {
      handleImageUpdate(event, setArticles);
    };
    const ws = new WebSocket(buildWebSocketUrl());
    Object.assign(ws, { onmessage: handleMessage });
    return () => {
      ws.close();
    };
  }, [setArticles]);
};

const useStreamUnmount = (
  state: Readonly<
    Pick<StreamRunContext, "abortControllerRef" | "flushTimerRef" | "isMountedRef" | "isStreamingRef">
  >,
): void => {
  const { abortControllerRef, flushTimerRef, isMountedRef, isStreamingRef } = state;
  useEffect(() => {
    assignRef(isMountedRef, true);
    return () => {
      cleanupStreamOnUnmount({ abortControllerRef, flushTimerRef, isMountedRef, isStreamingRef });
    };
  }, [abortControllerRef, flushTimerRef, isMountedRef, isStreamingRef]);
};

const useNewsStream = (options: Readonly<UseNewsStreamOptions> = {}): UseNewsStreamResult => {
  const state = useNewsStreamState(options);
  const controls = useStreamControls(state);
  const flush = useStreamFlush(state);
  const startStream = useStreamStarter(state, flush);
  useStreamSynchronization(options, state, state.startStreamRef, startStream);
  useStreamSocket(state);
  useStreamUnmount(state);
  return {
    abortStream: controls.abortStream,
    apiUrl: state.apiUrl,
    articles: state.articles,
    clearErrors: controls.clearErrors,
    completedSources: state.progress.completed,
    currentMessage: state.currentMessage,
    errors: state.errors,
    hasErrors: state.errors.length > EMPTY_COUNT,
    isComplete: state.status === "complete",
    isError: state.status === "error",
    isStreaming: state.isStreaming,
    maxRetries: DEFAULT_MAX_RETRIES,
    progress: state.progress,
    removeError: controls.removeError,
    retryCount: state.retryCount,
    sources: state.sources,
    startStream,
    status: state.status,
    streamId: state.streamId,
    totalSources: state.progress.total,
  };
};

export { useNewsStream };
