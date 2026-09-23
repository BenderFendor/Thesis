import { z } from "zod";

const DEBUG_OPTIONAL_SCHEMAS = {
  boolean: z.boolean().optional(),
  number: z.number().optional(),
  string: z.string().optional(),
};

const DEBUG_SCHEMA_BASE = {
  articleCandidate: z.object({
    priority: DEBUG_OPTIONAL_SCHEMAS.number,
    source: DEBUG_OPTIONAL_SCHEMAS.string,
    url: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  backendDebugSummary: z.object({
    errors: DEBUG_OPTIONAL_SCHEMAS.number,
    slow_operations: DEBUG_OPTIONAL_SCHEMAS.number,
    total_events: DEBUG_OPTIONAL_SCHEMAS.number,
  }),
  debugActiveStream: z.object({
    duration_so_far: DEBUG_OPTIONAL_SCHEMAS.number,
    request_path: DEBUG_OPTIONAL_SCHEMAS.string,
    stream_id: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  debugLogEvent: z.object({
    event_type: DEBUG_OPTIONAL_SCHEMAS.string,
    message: DEBUG_OPTIONAL_SCHEMAS.string,
    timestamp: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  debugLogFile: z.object({
    created: DEBUG_OPTIONAL_SCHEMAS.string,
    filename: DEBUG_OPTIONAL_SCHEMAS.string,
    modified: DEBUG_OPTIONAL_SCHEMAS.string,
    size_bytes: DEBUG_OPTIONAL_SCHEMAS.number,
    size_kb: DEBUG_OPTIONAL_SCHEMAS.number,
  }),
  debugSlowOperation: z.object({
    duration_ms: DEBUG_OPTIONAL_SCHEMAS.number,
    event_type: DEBUG_OPTIONAL_SCHEMAS.string,
    request_id: DEBUG_OPTIONAL_SCHEMAS.string,
    stream_id: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  feedInfo: z.object({ title: DEBUG_OPTIONAL_SCHEMAS.string }),
  imageExtraction: z.object({
    image_error: DEBUG_OPTIONAL_SCHEMAS.string,
    image_error_details: DEBUG_OPTIONAL_SCHEMAS.string,
    image_url: DEBUG_OPTIONAL_SCHEMAS.string,
    selected_source: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  pipelineFetch: z.object({
    errors: DEBUG_OPTIONAL_SCHEMAS.number,
    not_modified: DEBUG_OPTIONAL_SCHEMAS.number,
  }),
  rssStatus: z.object({ entries_count: DEBUG_OPTIONAL_SCHEMAS.number }),
  systemCache: z.object({
    age_seconds: DEBUG_OPTIONAL_SCHEMAS.number,
    article_count: DEBUG_OPTIONAL_SCHEMAS.number,
    healthy: DEBUG_OPTIONAL_SCHEMAS.boolean,
    incremental_enabled: DEBUG_OPTIONAL_SCHEMAS.boolean,
    last_updated: DEBUG_OPTIONAL_SCHEMAS.string,
    sources_tracked: DEBUG_OPTIONAL_SCHEMAS.number,
    update_count: DEBUG_OPTIONAL_SCHEMAS.number,
    update_in_progress: DEBUG_OPTIONAL_SCHEMAS.boolean,
  }),
  systemRuntime: z.object({
    pid: DEBUG_OPTIONAL_SCHEMAS.number,
    platform: DEBUG_OPTIONAL_SCHEMAS.string,
    python_version: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
};

const DEBUG_SCHEMA_COMPOSITES = {
  rssSampleEntry: z.object({
    image_extraction: DEBUG_SCHEMA_BASE.imageExtraction.optional(),
    title: DEBUG_OPTIONAL_SCHEMAS.string,
  }),
  systemComponents: z.object({
    cache: DEBUG_SCHEMA_BASE.systemCache.optional(),
    database: z.object({ healthy: DEBUG_OPTIONAL_SCHEMAS.boolean }).optional(),
    embedding_queue: z
      .object({
        batch_size: DEBUG_OPTIONAL_SCHEMAS.number,
        depth: DEBUG_OPTIONAL_SCHEMAS.number,
        max_per_minute: DEBUG_OPTIONAL_SCHEMAS.number,
      })
      .optional(),
    vector_store: z.object({ healthy: DEBUG_OPTIONAL_SCHEMAS.boolean }).optional(),
  }),
  systemPipeline: z.object({ fetch: DEBUG_SCHEMA_BASE.pipelineFetch.optional() }),
};

const DEBUG_SCHEMAS = {
  articleParserTestResult: z.object({
    candidates: z.array(DEBUG_SCHEMA_BASE.articleCandidate).optional(),
    error: DEBUG_OPTIONAL_SCHEMAS.string,
    error_details: DEBUG_OPTIONAL_SCHEMAS.string,
    image_url: DEBUG_OPTIONAL_SCHEMAS.string,
    success: DEBUG_OPTIONAL_SCHEMAS.boolean,
  }),
  backendDebugReport: z.object({
    active_streams: z.array(DEBUG_SCHEMA_BASE.debugActiveStream).optional(),
    generated_at: DEBUG_OPTIONAL_SCHEMAS.string,
    recommendations: z.array(z.string()).optional(),
    summary: DEBUG_SCHEMA_BASE.backendDebugSummary.optional(),
  }),
  debugLogEvents: z.object({
    events: z.array(DEBUG_SCHEMA_BASE.debugLogEvent).optional(),
  }),
  debugLogFiles: z.object({
    files: z.array(DEBUG_SCHEMA_BASE.debugLogFile).optional(),
  }),
  debugSlowOperations: z.object({
    operations: z.array(DEBUG_SCHEMA_BASE.debugSlowOperation).optional(),
  }),
  logLevel: z.object({ level: DEBUG_OPTIONAL_SCHEMAS.string }),
  rssParserTestResult: z.object({
    error: DEBUG_OPTIONAL_SCHEMAS.string,
    feed_info: DEBUG_SCHEMA_BASE.feedInfo.optional(),
    parse_time_seconds: DEBUG_OPTIONAL_SCHEMAS.number,
    sample_entries: z.array(DEBUG_SCHEMA_COMPOSITES.rssSampleEntry).optional(),
    status: DEBUG_SCHEMA_BASE.rssStatus.optional(),
    success: DEBUG_OPTIONAL_SCHEMAS.boolean,
  }),
  systemStatus: z.object({
    components: DEBUG_SCHEMA_COMPOSITES.systemComponents.optional(),
    pipeline: DEBUG_SCHEMA_COMPOSITES.systemPipeline.optional(),
    runtime: DEBUG_SCHEMA_BASE.systemRuntime.optional(),
  }),
};

const DEBUG_DEFAULT_OFFSET = 0;
const DEBUG_DEFAULT_PAGE_SIZE = 25;
const DEBUG_DRIFT_SAMPLE_LIMIT = 20;
const DEBUG_MAX_DATABASE_PAGE_SIZE = 200;
const DEBUG_MAX_OFFSET = 5000;
const DEBUG_MAX_PAGE_SIZE = 500;
const DEBUG_MIN_PAGE_SIZE = 5;
const DEBUG_PARSER_SAMPLE_LIMIT = 5;
const DEBUG_TABS = [
  "system",
  "sources",
  "storage",
  "parser",
  "controls",
  "llm",
  "errors",
  "performance",
] as const;
type DebugTab = (typeof DEBUG_TABS)[number];
const DEFAULT_DEBUG_TAB: DebugTab = "storage";
const EMPTY_DEBUG_LIST: readonly never[] = [];

export {
  DEBUG_DEFAULT_OFFSET,
  DEBUG_DEFAULT_PAGE_SIZE,
  DEBUG_DRIFT_SAMPLE_LIMIT,
  DEBUG_MAX_DATABASE_PAGE_SIZE,
  DEBUG_MAX_OFFSET,
  DEBUG_MAX_PAGE_SIZE,
  DEBUG_MIN_PAGE_SIZE,
  DEBUG_PARSER_SAMPLE_LIMIT,
  DEBUG_SCHEMA_BASE,
  DEBUG_SCHEMA_COMPOSITES,
  DEBUG_SCHEMAS,
  DEBUG_TABS,
  DEFAULT_DEBUG_TAB,
  EMPTY_DEBUG_LIST,
};
