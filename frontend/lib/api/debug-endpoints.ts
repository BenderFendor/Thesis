import type {
  CacheDebugResponse,
  CacheDeltaResponse,
  ChromaDebugResponse,
  DatabaseDebugResponse,
  DebugErrorsResponse,
  FrontendDebugReportPayload,
  LlmLogResponse,
  StartupMetricsResponse,
  StorageDriftReport,
} from "./types";
import { api, query } from "./client";
import {
  ApiObjectResponseSchema,
  CacheDebugResponseSchema,
  CacheDeltaResponseSchema,
  ChromaDebugResponseSchema,
  DatabaseDebugResponseSchema,
  DebugErrorsResponseSchema,
  LlmLogResponseSchema,
  StartupMetricsWireSchema,
  StorageDriftReportSchema,
} from "./response-schemas";

const fetchDebugErrors = (
  options: Readonly<{
    limit?: number;
    offset?: number;
    includeRequestStreamEvents?: boolean;
  }> = {},
): Promise<DebugErrorsResponse> =>
  api(
    `/debug/errors${query({
      include_request_stream_events: options.includeRequestStreamEvents,
      limit: options.limit,
      offset: options.offset,
    })}`,
    DebugErrorsResponseSchema,
  );

const fetchLlmLogs = (
  options: Readonly<{ limit?: number; offset?: number; service?: string; success?: boolean }> = {},
): Promise<LlmLogResponse> =>
  api(
    `/debug/llm/logs${query({
      limit: options.limit,
      offset: options.offset,
      service: options.service,
      success: options.success,
    })}`,
    LlmLogResponseSchema,
  );

const fetchStartupMetrics = async (): Promise<StartupMetricsResponse> => {
  const raw = await api("/debug/startup", StartupMetricsWireSchema);
  return {
    completedAt: raw.completed_at ?? null,
    durationSeconds: raw.duration_seconds ?? null,
    events: raw.events.map((event) => ({
      completedAt: event.completed_at ?? null,
      detail: event.detail ?? null,
      durationSeconds: event.duration_seconds ?? null,
      metadata: event.metadata,
      name: event.name,
      startedAt: event.started_at ?? null,
    })),
    notes: raw.notes,
    startedAt: raw.started_at ?? null,
  };
};

const fetchCacheDebugArticles = (
  params: Readonly<{ limit?: number; offset?: number; source?: string }> = {},
): Promise<CacheDebugResponse> =>
  api(
    `/debug/cache/articles${query({ limit: params.limit, offset: params.offset, source: params.source })}`,
    CacheDebugResponseSchema,
  );

const fetchCacheDelta = (
  params: Readonly<{
    sample_limit?: number;
    sample_offset?: number;
    source?: string;
    sample_preview_limit?: number;
  }> = {},
): Promise<CacheDeltaResponse> =>
  api(
    `/debug/cache/delta${query({
      sample_limit: params.sample_limit,
      sample_offset: params.sample_offset,
      sample_preview_limit: params.sample_preview_limit,
      source: params.source,
    })}`,
    CacheDeltaResponseSchema,
  );

const fetchChromaDebugArticles = (
  params: Readonly<{ limit?: number; offset?: number }> = {},
): Promise<ChromaDebugResponse> =>
  api(`/debug/chroma/articles${query({ limit: params.limit, offset: params.offset })}`, ChromaDebugResponseSchema);

const fetchDatabaseDebugArticles = (
  params: Readonly<{
    limit?: number;
    offset?: number;
    source?: string;
    missing_embeddings_only?: boolean;
    sort_direction?: "asc" | "desc";
    published_before?: string;
    published_after?: string;
  }> = {},
): Promise<DatabaseDebugResponse> =>
  api(
    `/debug/database/articles${query({
      limit: params.limit,
      missing_embeddings_only: params.missing_embeddings_only,
      offset: params.offset,
      published_after: params.published_after,
      published_before: params.published_before,
      sort_direction: params.sort_direction,
      source: params.source,
    })}`,
    DatabaseDebugResponseSchema,
  );

const fetchStorageDrift = (sampleLimit = 50): Promise<StorageDriftReport> =>
  api(`/debug/storage/drift${query({ sample_limit: sampleLimit })}`, StorageDriftReportSchema);

const sendFrontendDebugReport = async (payload: FrontendDebugReportPayload): Promise<void> => {
  try {
    await api("/debug/logs/frontend", ApiObjectResponseSchema, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    console.error("Failed to send frontend debug report:", error);
  }
};

export {
  fetchCacheDebugArticles,
  fetchCacheDelta,
  fetchChromaDebugArticles,
  fetchDatabaseDebugArticles,
  fetchDebugErrors,
  fetchLlmLogs,
  fetchStartupMetrics,
  fetchStorageDrift,
  sendFrontendDebugReport,
};
export type {
  CacheDebugResponse,
  CacheDeltaResponse,
  ChromaDebugResponse,
  DatabaseDebugResponse,
  DebugErrorsResponse,
  FrontendDebugReportPayload,
  LlmLogResponse,
  StartupMetricsResponse,
  StorageDriftReport,
} from "./types";
