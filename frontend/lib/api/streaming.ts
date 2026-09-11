// SSE news stream: connect, pump, parse, and settle.
// This is the genuinely complex part of the API layer (cancellation, retries,
// event parsing with double-encoded payloads).

import type {
  NewsArticle,
  ReadonlyNewsArticle,
  StreamOptions,
  StreamProgress,
  StreamReader,
  StreamRejectHandler,
  StreamResolveHandler,
  StreamResult,
  StreamRuntime,
} from "./types";
import { API_BASE_URL } from "./client";
import { StreamEventSchema } from "./schemas";
import { mapBackendArticles } from "./article";
import type { DeepReadonly } from "../deep-readonly";

const STREAM_CACHE_LOAD_TIMEOUT_MS = 15_000;
const STREAM_MESSAGE_TIMEOUT_MS = 120_000;
const STREAM_STALL_CHECK_INTERVAL_MS = 3000;
const STREAM_TIMEOUT_CHECK_INTERVAL_MS = 5000;
const STREAM_BATCH_SIZE = 500;

interface StreamConnection {
  readonly promise: Promise<StreamResult>;
  readonly url: string;
}

type ParsedStreamEvent = DeepReadonly<ReturnType<typeof StreamEventSchema.parse>>;

const streamNews = (options: StreamOptions = {}): StreamConnection => {
  const sseUrl = buildStreamUrl(options);
  console.debug(
    `Starting news stream with useCache=${options.useCache ?? true} and category=${options.category}`,
  );
  {
    const { promise, resolve, reject } = Promise.withResolvers<StreamResult>();
    startStreamConnection(sseUrl, options, createStreamRuntime(options, resolve, reject));
    return { promise, url: sseUrl } satisfies StreamConnection;
  }
};

const buildStreamUrl = (options: Readonly<StreamOptions>): string => {
  const params = new URLSearchParams({
    use_cache: String(options.useCache ?? true),
  });
  if (options.category !== undefined && options.category !== null && options.category !== "") {
    params.set("category", options.category);
  }
  return `${API_BASE_URL}/news/stream?${params.toString()}`;
};

const startStreamConnection = (
  sseUrl: string,
  options: Readonly<StreamOptions>,
  rt: Readonly<StreamRuntime>,
): void => {
  void (async () => {
    console.debug(`Connecting to unified stream endpoint: ${sseUrl}`);
    try {
      await connectAndPumpStream(sseUrl, options.signal, rt);
    } catch (error) {
      const normalizedError = (() => {
        if (error instanceof Error) {
          return error;
        }
        return new Error(String(error));
      })();
      console.error("Stream fetch error:", error);
      settleStreamConnectionError(normalizedError, rt);
    }
  })();
};

const configureStreamAbort = (
  signal: Readonly<AbortSignal> | undefined,
  rt: Readonly<StreamRuntime>,
  abortController: AbortController,
): boolean => {
  Object.assign(rt, {
    abort: () => {
      abortController.abort();
    },
  });
  if (signal === undefined) {
    return false;
  }
  if (signal.aborted) {
    rt.abort();
    streamResolve(rt, ["Aborted before connection"]);
    return true;
  }
  signal.addEventListener("abort", rt.abort, { once: true });
  return false;
};

const getStreamReader = (response: Response): StreamReader => {
  if (!response.ok) {
    throw new Error(`Stream request failed with status ${response.status}: ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("No response body received from stream");
  }
  return response.body.getReader();
};

const connectAndPumpStream = async (
  sseUrl: string,
  signal: Readonly<AbortSignal> | undefined,
  rt: Readonly<StreamRuntime>,
): Promise<void> => {
  const abortController = new AbortController();
  if (configureStreamAbort(signal, rt, abortController)) {
    return;
  }
  const response = await fetch(sseUrl, {
    headers: { Accept: "text/event-stream" },
    method: "GET",
    signal: abortController.signal,
  });
  const reader = getStreamReader(response);
  console.debug("Stream connection opened, reading body...");
  installStreamTimers(rt);
  await pumpStreamEvents(rt, reader);
};

const createStreamRuntime = (
  options: Readonly<StreamOptions>,
  resolve: StreamResolveHandler,
  reject: StreamRejectHandler,
): StreamRuntime => {
  const articles: NewsArticle[] = [];
  const sources = new Set<string>();
  const errors: string[] = [];
  return {
    abort: () => {},
    addArticles: (...newArticles: readonly NewsArticle[]) => {
      articles.push(...newArticles);
    },
    addError: (error: string) => {
      errors.push(error);
    },
    addSource: (source: string) => {
      sources.add(source);
    },
    articles,
    clearTimers: () => {},
    errors,
    hasReceivedData: false,
    lastMessageTime: Date.now(),
    onError: options.onError,
    onProgress: options.onProgress,
    onSourceComplete: options.onSourceComplete,
    reject,
    resolve,
    settled: false,
    get sources(): readonly string[] {
      return [...sources];
    },
    streamId: undefined,
  };
};

const parseStreamEvent = (eventData: string): ParsedStreamEvent => {
  try {
    return StreamEventSchema.parse(JSON.parse(eventData));
  } catch {
    console.warn("[streamNews] First JSON.parse failed, attempting to re-parse");
    const decodedEventData = String(JSON.parse(`"${eventData}"`));
    return StreamEventSchema.parse(JSON.parse(decodedEventData));
  }
};

const dispatchStreamEvent = (data: ParsedStreamEvent, rt: Readonly<StreamRuntime>): void => {
  if (data.stream_id !== undefined && rt.streamId === undefined) {
    Object.assign(rt, { streamId: data.stream_id });
  }
  console.debug(`Stream event [${data.status}]:`, {
    articlesCount: data.articles?.length,
    message: data.message,
    progress: data.progress,
    source: data.source,
    streamId: data.stream_id,
  });
  streamEventHandlers[data.status](data, rt);
};

const settleStreamConnectionError = (error: Readonly<Error>, rt: Readonly<StreamRuntime>): void => {
  if (rt.settled) {
    return;
  }
  Object.assign(rt, { settled: true });
  rt.clearTimers();
  if (error.name === "AbortError") {
    rt.resolve({
      articles: removeDuplicateArticles(rt.articles),
      errors: [...rt.errors, "Aborted"],
      sources: [...rt.sources],
      streamId: rt.streamId,
    });
    return;
  }
  rt.reject(error);
};

const reportStreamParseError = (
  error: Error,
  eventData: string,
  rt: Readonly<StreamRuntime>,
): void => {
  console.error("Error parsing stream event:", error, "Raw data:", eventData);
  const message = error.message;
  rt.onError?.(`Parse error: ${message}`);
};

const removeDuplicateArticles = (articles: readonly NewsArticle[]): NewsArticle[] => {
  const seen = new Set<string>(),
    seenIds = new Set<number>();
  return articles.filter((article) => {
    // Check for duplicate IDs first (most reliable)
    if (seenIds.has(article.id)) {
      return false;
    }
    seenIds.add(article.id);

    // Also check for duplicate title-source combinations
    const key = `${article.title}-${article.source}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const streamResolve = (rt: Readonly<StreamRuntime>, extraErrors?: readonly string[]): void => {
  if (rt.settled) {
    return;
  }
  Object.assign(rt, { settled: true });
  rt.clearTimers();
  rt.resolve({
    articles: removeDuplicateArticles(rt.articles),
    errors: [...rt.errors, ...(extraErrors ?? [])],
    sources: [...rt.sources],
    streamId: rt.streamId,
  });
};

const streamReject = (rt: Readonly<StreamRuntime>, error: Readonly<Error>): void => {
  if (rt.settled) {
    return;
  }
  Object.assign(rt, { settled: true });
  rt.clearTimers();
  rt.reject(error);
};

const readStreamEvents = async (
  rt: Readonly<StreamRuntime>,
  reader: StreamReader,
  decoder: Readonly<TextDecoder>,
  buffer: string,
): Promise<void> => {
  try {
    const { done, value } = await reader.read();
    if (done) {
      resolveCompletedStream(rt);
      return;
    }
    Object.assign(rt, { lastMessageTime: Date.now() });
    await readStreamEvents(rt, reader, decoder, processStreamChunk(buffer, value, decoder, rt));
  } catch (readError) {
    const normalizedError = (() => {
      if (readError instanceof Error) {
        return readError;
      }
      return new Error(String(readError));
    })();
    handleStreamReadError(normalizedError, rt);
  }
};

const pumpStreamEvents = (rt: Readonly<StreamRuntime>, reader: StreamReader): Promise<void> =>
  readStreamEvents(rt, reader, new TextDecoder(), "");

const installStreamTimers = (rt: Readonly<StreamRuntime>): void => {
  let stallInterval: ReturnType<typeof setInterval> | undefined = undefined,
    timeoutInterval: ReturnType<typeof setInterval> | undefined = undefined;
  Object.assign(rt, {
    clearTimers: () => {
      clearInterval(timeoutInterval);
      clearInterval(stallInterval);
    },
  });
  timeoutInterval = setInterval(() => {
    const timeSinceLastMessage = Date.now() - rt.lastMessageTime;
    if (timeSinceLastMessage > STREAM_MESSAGE_TIMEOUT_MS) {
      console.error("Stream timeout - no data received in 2 minutes");
      rt.abort();
    }
  }, STREAM_TIMEOUT_CHECK_INTERVAL_MS);
  stallInterval = setInterval(() => {
    const isStalled =
      rt.hasReceivedData &&
      !rt.settled &&
      Date.now() - rt.lastMessageTime > STREAM_CACHE_LOAD_TIMEOUT_MS;
    if (isStalled) {
      console.warn(`Stream ${rt.streamId} stalled after cache load - auto-completing`);
      streamResolve(rt, ["Stream auto-completed due to inactivity after cache load"]);
    }
  }, STREAM_STALL_CHECK_INTERVAL_MS);
};

const handleCacheDataEvent = (data: ParsedStreamEvent, rt: Readonly<StreamRuntime>): void => {
  Object.assign(rt, { hasReceivedData: true });
  if (data.articles && Array.isArray(data.articles)) {
    const mappedArticles = mapBackendArticles(data.articles);
    const cacheAge = data.cache_age_seconds ?? 999;
    console.debug(
      `Stream ${rt.streamId} cache data: ${mappedArticles.length} articles (cache age: ${cacheAge}s, fresh: ${cacheAge < 120})`,
    );
    queueStreamBatches(mappedArticles, rt, "cache-batch", () => ({
      completed: rt.sources.length,
      message: `Loaded ${mappedArticles.length} cached articles`,
      percentage: 0,
      total: rt.sources.length,
    }));
    if (cacheAge < 120) {
      console.debug(`Cache is fresh (${cacheAge}s), waiting for completion or timeout after 5s...`);
      setTimeout(() => {
        if (!rt.settled && rt.hasReceivedData) {
          console.debug("Auto-completing stream after fresh cache timeout");
          rt.abort();
        }
      }, 5000);
    }
  } else {
    console.warn(
      "[streamNews] 'cache_data' event received but 'articles' is not an array or is missing.",
      data,
    );
  }
};

const handleCompleteEvent = (data: ParsedStreamEvent, rt: Readonly<StreamRuntime>): void => {
  console.debug(`Stream ${rt.streamId} complete:`, {
    failedSources: data.failed_sources,
    message: data.message,
    successfulSources: data.successful_sources,
    totalArticles: data.total_articles,
  });
  streamResolve(rt);
};

const handleErrorEvent = (data: ParsedStreamEvent, rt: Readonly<StreamRuntime>): void => {
  console.error(`Stream ${rt.streamId} error:`, data.error);
  if (rt.hasReceivedData) {
    streamResolve(rt, [data.error ?? "Stream error"]);
  } else {
    streamReject(rt, new Error(data.error ?? "Stream error"));
  }
};

const handleInitialEvent = (data: ParsedStreamEvent, rt: Readonly<StreamRuntime>): void => {
  Object.assign(rt, { hasReceivedData: true });
  if (data.articles && Array.isArray(data.articles)) {
    const mappedArticles = mapBackendArticles(data.articles);
    const cacheAge = data.cache_age_seconds ?? 999;
    console.debug(
      `Stream ${rt.streamId} INITIAL data: ${mappedArticles.length} articles (cache age: ${cacheAge}s)`,
    );
    queueStreamBatches(mappedArticles, rt, "initial-batch", () => ({
      completed: 0,
      message: `Instantly loaded ${mappedArticles.length} articles from cache`,
      percentage: 0,
      total: 0,
    }));
  } else {
    console.warn(
      "[streamNews] 'initial' event received but 'articles' is not an array or is missing.",
      data,
    );
  }
};

const handleSourceCompleteEvent = (data: ParsedStreamEvent, rt: Readonly<StreamRuntime>): void => {
  Object.assign(rt, { hasReceivedData: true });
  if (
    data.articles &&
    data.source !== undefined &&
    data.source !== null &&
    data.source !== ""
  ) {
    const mappedArticles = mapBackendArticles(data.articles);
    rt.addArticles(...mappedArticles);
    rt.addSource(data.source);
    console.debug(
      `Stream ${rt.streamId} source complete: ${data.source} (${mappedArticles.length} articles)`,
    );
    rt.onSourceComplete?.(data.source, mappedArticles);
    if (data.progress) {
      rt.onProgress?.(data.progress);
    }
  }
};

const handleSourceErrorEvent = (data: ParsedStreamEvent, rt: Readonly<StreamRuntime>): void => {
  const errorMsg = `Error loading ${data.source}: ${data.error}`;
  console.warn(`Stream ${rt.streamId} source error:`, errorMsg);
  rt.addError(errorMsg);
  rt.onError?.(errorMsg);
  if (data.progress) {
    rt.onProgress?.(data.progress);
  }
};

const handleStartingEvent = (data: ParsedStreamEvent, rt: Readonly<StreamRuntime>): void => {
  console.debug(`Stream ${rt.streamId} starting: ${data.message}`);
  rt.onProgress?.({
    completed: 0,
    message: data.message,
    percentage: 0,
    total: 0,
  });
};

const streamEventHandlers = {
  cache_data: handleCacheDataEvent,
  complete: handleCompleteEvent,
  error: handleErrorEvent,
  initial: handleInitialEvent,
  source_complete: handleSourceCompleteEvent,
  source_error: handleSourceErrorEvent,
  starting: handleStartingEvent,
};

const recordStreamBatch = (batch: readonly ReadonlyNewsArticle[], rt: Readonly<StreamRuntime>): void => {
  rt.addArticles(...batch); batch.forEach((article) => { rt.addSource(article.source); });
};

const queueStreamBatches = (
  articlesToQueue: readonly ReadonlyNewsArticle[],
  rt: Readonly<StreamRuntime>,
  batchLabel: string,
  finalProgress: () => StreamProgress,
): void => {
  const queueBatch = (offset: number): void => {
    if (offset >= articlesToQueue.length) {
      rt.onProgress?.(finalProgress());
      return;
    }
    const batch = articlesToQueue.slice(offset, offset + STREAM_BATCH_SIZE);
    recordStreamBatch(batch, rt);
    rt.onSourceComplete?.(`${batchLabel}-${Math.floor(offset / STREAM_BATCH_SIZE)}`, batch);
    if (offset + STREAM_BATCH_SIZE < articlesToQueue.length) {
      setTimeout(() => {
        queueBatch(offset + STREAM_BATCH_SIZE);
      }, 0);
      return;
    }
    rt.onProgress?.(finalProgress());
  };
  queueBatch(0);
};

const processStreamChunk = (
  buffer: string,
  chunk: Readonly<Uint8Array>,
  decoder: Readonly<TextDecoder>,
  rt: Readonly<StreamRuntime>,
): string => {
  const lines = `${buffer}${decoder.decode(chunk, { stream: true })}`.split("\n");
  lines.slice(0, -1).forEach((line) => {
    processStreamDataLine(line, rt);
  });
  return lines.at(-1) ?? "";
};

const processStreamDataLine = (line: string, rt: Readonly<StreamRuntime>): void => {
  if (!line || line.startsWith(":")) {
    return;
  }
  if (!line.startsWith("data: ")) {
    return;
  }
  const eventData = line.slice(6);
  try {
    dispatchStreamEvent(parseStreamEvent(eventData), rt);
  } catch (parseError) {
    reportStreamParseError(
      (() => {
  if (parseError instanceof Error) {
    return parseError;
  }
  return new Error(String(parseError));
})(),
      eventData,
      rt,
    );
  }
};

const handleStreamReadError = (readError: Readonly<Error>, rt: Readonly<StreamRuntime>): void => {
  rt.clearTimers();
  if (readError.name === "AbortError") {
    console.warn("Stream reader aborted");
    streamResolve(rt, ["Stream aborted"]);
    return;
  }
  if (isLikelyNetworkError(readError)) {
    console.warn("News stream disconnected before completion.");
  } else {
    console.error("Stream reader error:", readError);
  }
  streamReject(rt, readError);
};

const isLikelyNetworkError = (error: Readonly<Error>): boolean => {
  const message = error.message.toLowerCase();
  return (
    error.name === "TypeError" ||
    error.name === "NetworkError" ||
    message.includes("networkerror") ||
    message.includes("failed to fetch") ||
    message.includes("input stream") ||
    message.includes("load failed")
  );
};

const resolveCompletedStream = (rt: Readonly<StreamRuntime>): void => {
  console.debug("Stream reader completed");
  if (rt.hasReceivedData) {
    streamResolve(rt);
  } else {
    streamReject(rt, new Error("Stream ended without receiving data"));
  }
};
export { streamNews, removeDuplicateArticles };
