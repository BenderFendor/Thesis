import { z } from "zod";

import { mapBackendArticles, mapBackendSource } from "./article";
import { API_BASE_URL, api, query } from "./client";
import type {
  AddRssResponse,
  CacheRefreshProgress,
  CacheStatus,
  NewsSource,
  PaginatedResponse,
  ReadonlyBackendArticle,
  SourceDebugData,
  SourceStats,
} from "./types";
import {
  AddRssResponseSchema,
  CategoriesResponseSchema,
  SourceDebugDataSchema,
  SourceStatsListSchema,
} from "./response-schemas";
import { BackendSourceSchema, CacheStatusSchema, PaginatedPayloadSchema } from "./schemas";

const CacheRefreshProgressWireSchema = z
  .object({
    articles_from_source: z.number().optional(),
    failed_sources: z.number().optional(),
    message: z.string().optional(),
    source: z.string().nullish(),
    successful_sources: z.number().optional(),
    total_articles: z.number().optional(),
    total_sources_processed: z.number().optional(),
  })
  .passthrough();


const parseCacheRefreshEvent = (line: string): CacheRefreshProgress | undefined => {
  if (!line.startsWith("data:")) {
    return void 0;
  }
  try {
    const rawEvent: unknown = JSON.parse(line.slice(5).trim());
    const parsed = CacheRefreshProgressWireSchema.safeParse(rawEvent);
    if (!parsed.success) {
      return void 0;
    }
    return {
      articlesFromSource: parsed.data.articles_from_source,
      failedSources: parsed.data.failed_sources,
      message: parsed.data.message,
      source: parsed.data.source ?? undefined,
      successfulSources: parsed.data.successful_sources,
      totalArticles: parsed.data.total_articles,
      totalSourcesProcessed: parsed.data.total_sources_processed,
    };
  } catch {
    return void 0;
  }
};

const emitCacheRefreshLine = (
  line: string,
  onProgress: ((progress: CacheRefreshProgress) => void) | undefined,
): void => {
  const event = parseCacheRefreshEvent(line);
  if (event !== undefined) {
    onProgress?.(event);
  }
};

type PaginatedQueryValue = string | number | boolean | null | undefined;

type BrowseIndexParams = Readonly<{
  category?: string | null;
  source?: string | null;
  sources?: string | null;
  search?: string | null;
}>;

type PaginatedResponseOptions = Readonly<{
  includeLimit?: boolean;
  includePreviousCursor?: boolean;
}>;

interface PaginatedResponsePayload {
  readonly articles?: readonly ReadonlyBackendArticle[];
  readonly has_more?: boolean;
  readonly limit?: number;
  readonly next_cursor?: string | null;
  readonly prev_cursor?: string | null;
  readonly total?: number;
}

const buildPaginatedResponse = (
  data: PaginatedResponsePayload,
  options: PaginatedResponseOptions,
): PaginatedResponse => {
  let previousCursor = data.prev_cursor ?? null;
  if (options.includePreviousCursor === false) {
    previousCursor = null;
  }
  let limit = 0;
  if (options.includeLimit === true) {
    limit = data.limit ?? 0;
  }
  return {
    articles: mapBackendArticles(data.articles ?? []),
    has_more: data.has_more ?? false,
    limit,
    next_cursor: data.next_cursor ?? null,
    prev_cursor: previousCursor,
    total: data.total ?? 0,
  };
};

const fetchPaginatedResponse = async (
  path: string,
  params: Readonly<Record<string, PaginatedQueryValue>>,
  options: PaginatedResponseOptions = {},
): Promise<PaginatedResponse> => {
  const payload: unknown = await api(`${path}${query(params)}`, z.unknown());
  const parsed = PaginatedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Browse index response is invalid.");
  }
  return buildPaginatedResponse(parsed.data, options);
};

interface SourceCacheState {
  sources: NewsSource[];
}

const sourceCache: SourceCacheState = { sources: [] };

function fetchNewsIndex(params: BrowseIndexParams = {}): Promise<PaginatedResponse> {
  return fetchPaginatedResponse("/news/index/cached", {
    category: params.category,
    search: params.search,
    source: params.source,
    sources: params.sources,
  });
}

const fetchLiveBrowseIndex = fetchNewsIndex;

const fetchBrowseIndex = (params: BrowseIndexParams = {}): Promise<PaginatedResponse> =>
  fetchPaginatedResponse("/news/index", {
    category: params.category,
    search: params.search,
    source: params.source,
    sources: params.sources,
  });

const fetchCachedNewsPaginated = (
  params: Readonly<{
    limit?: number;
    offset?: number;
    category?: string | null;
    source?: string | null;
    sources?: string | null;
    search?: string | null;
  }> = {},
): Promise<PaginatedResponse> =>
  fetchPaginatedResponse(
    "/news/page/cached",
    {
      category: params.category,
      limit: params.limit,
      offset: params.offset,
      search: params.search,
      source: params.source,
      sources: params.sources,
    },
    { includeLimit: true, includePreviousCursor: false },
  );

const fetchNewsPaginated = (
  params: Readonly<{
    limit?: number;
    cursor?: string | null;
    category?: string | null;
    source?: string | null;
    sources?: string | null;
    search?: string | null;
    sort_order?: string;
  }> = {},
): Promise<PaginatedResponse> =>
  fetchPaginatedResponse(
    "/news/page",
    {
      category: params.category,
      cursor: params.cursor,
      limit: params.limit,
      search: params.search,
      sort_order: params.sort_order,
      source: params.source,
      sources: params.sources,
    },
    { includeLimit: true },
  );

// --- Sources ---

const fetchSources = async (): Promise<NewsSource[]> => {
  const payload: unknown = await api("/news/sources", z.unknown());
  const parsed = z.array(BackendSourceSchema).safeParse(payload);
  if (!parsed.success) {
    console.warn("fetchSources received malformed payload");
    return [];
  }
  return parsed.data.map(mapBackendSource);
};

const fetchCategories = async (): Promise<string[]> => {
  const payload = await api("/categories", CategoriesResponseSchema);
  return payload.categories;
};

const getSourceById = async (id: string): Promise<NewsSource | undefined> => {
  if (sourceCache.sources.length === 0) {
    sourceCache.sources = await fetchSources();
  }
  const normalized = id.trim().toLowerCase();
  return sourceCache.sources.find((source) => source.id === normalized);
};

const isSourceStatsStatus = (value: string): value is SourceStats["status"] =>
  ["success", "warning", "error"].includes(value);

const normalizeSourceStatsStatus = (value: string): SourceStats["status"] => {
  if (isSourceStatsStatus(value)) {
    return value;
  }
  return "error";
};

const fetchSourceStats = async (): Promise<SourceStats[]> => {
  const payload = await api("/news/sources/stats", SourceStatsListSchema);
  return payload.sources.map((source) => ({
    article_count: source.article_count,
    bias_rating: source.bias_rating ?? undefined,
    category: source.category,
    country: source.country,
    error_message: source.error_message ?? undefined,
    funding_type: source.funding_type ?? undefined,
    last_checked: source.last_checked,
    name: source.name,
    status: normalizeSourceStatsStatus(source.status),
    url: source.url,
  }));
};

const fetchSourceDebugData = (sourceName: string): Promise<SourceDebugData> =>
  api(`/debug/sources/${encodeURIComponent(sourceName)}`, SourceDebugDataSchema);

const validateRssUrl = (url: string): Promise<AddRssResponse> =>
  api("/sources/rss/validate", AddRssResponseSchema, {
    body: JSON.stringify({ url }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const promoteRssSource = (
  request: Readonly<{
    url: string;
    name?: string;
    category?: string;
    country?: string;
    source_type?: string;
    funding_type?: string;
    bias_rating?: string;
    ownership_label?: string;
    factual_reporting?: string;
    is_paywalled?: boolean;
  }>,
): Promise<AddRssResponse> =>
  api("/sources/rss/promote", AddRssResponseSchema, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

// --- Cache ---

const fetchCacheStatus = async (): Promise<CacheStatus | null> => {
  try {
    const payload: unknown = await api("/cache/status", z.unknown());
    const parsed = CacheStatusSchema.safeParse(payload);
    if (!parsed.success) {
      console.error("Failed to parse cache status:", parsed.error);
      return null;
    }
    return parsed.data;
  } catch (error) {
    console.error("Failed to fetch cache status:", error);
    return null;
  }
};

const consumeCacheRefreshStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onProgress: ((progress: CacheRefreshProgress) => void) | undefined,
): Promise<void> => {
  const decoder = new TextDecoder();
  const readNextChunk = async (pending: string): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) {
      emitCacheRefreshLine(`${pending}${decoder.decode()}`, onProgress);
      return void 0;
    }
    const lines = `${pending}${decoder.decode(value, { stream: true })}`.split("\n");
    const nextPending = lines.pop() ?? "";
    for (const line of lines) {
      emitCacheRefreshLine(line, onProgress);
    }
    return readNextChunk(nextPending);
  };

  await readNextChunk("");
};

const refreshCache = async (
  onProgress?: (progress: CacheRefreshProgress) => void,
): Promise<boolean> => {
  const response = await fetch(`${API_BASE_URL}/cache/refresh/stream`, { method: "POST" });
  if (!response.ok || response.body === null) {
    return false;
  }
  await consumeCacheRefreshStream(response.body.getReader(), onProgress);
  return true;
};


export {
  fetchLiveBrowseIndex,
  fetchBrowseIndex,
  fetchCachedNewsPaginated,
  fetchNewsPaginated,
  fetchSources,
  fetchCategories,
  getSourceById,
  fetchSourceStats,
  fetchSourceDebugData,
  validateRssUrl,
  promoteRssSource,
  fetchCacheStatus,
  refreshCache,
};
