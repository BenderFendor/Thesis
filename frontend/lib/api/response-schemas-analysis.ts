import { z } from "zod";
import { AnyArraySchema, AnyObjectSchema, OptionalStringSchema, ArticleFactCheckSchema, GroundingChunkSchema, WebSearchQueriesSchema, GdeltTopCameoSchema } from "./response-schemas-shared";

const CategoriesResponseSchema = z
  .object({ categories: z.array(z.string()) })
  .passthrough();

const AddRssResponseSchema = z
  .object({
    article_count: z.number(),
    category: z.string().optional(),
    country: z.string().optional(),
    duplicate_candidates: AnyArraySchema.optional(),
    inferred: AnyObjectSchema.optional(),
    name: z.string(),
    promoted: z.boolean().optional(),
    sample_articles: AnyArraySchema.optional(),
    source_type: z.string().nullable().optional(),
    status: z.string(),
    success: z.boolean(),
    url: z.string(),
  })
  .passthrough();

const AgenticResearchResponseSchema = z
  .object({
    answer: z.string(),
    query: z.string().optional(),
    referenced_articles: AnyArraySchema.optional(),
    success: z.boolean(),
    thinking_steps: AnyArraySchema.optional(),
  })
  .passthrough();

const LanguageDiagnosticExampleSchema = z
  .object({
    category: OptionalStringSchema,
    pattern: OptionalStringSchema,
    sentence: z.string(),
    term: OptionalStringSchema,
  })
  .passthrough();

const LanguageDiagnosticMetricSchema = z
  .object({
    count: z.number(),
    examples: z.array(LanguageDiagnosticExampleSchema),
    rate: z.number(),
    status: z.enum(["low", "medium", "high"]),
  })
  .passthrough();

const LanguageDiagnosticOverallSchema = z
  .object({
    score: z.number(),
    status: z.enum(["low", "medium", "high"]),
    summary: z.string(),
  })
  .passthrough();

const LanguageDiagnosticsDataSchema = z
  .object({
    actor_omission: LanguageDiagnosticMetricSchema.nullable().optional(),
    article_url: z.string(),
    error: OptionalStringSchema,
    euphemisms: LanguageDiagnosticMetricSchema.nullable().optional(),
    overall: LanguageDiagnosticOverallSchema.nullable().optional(),
    passive_voice: LanguageDiagnosticMetricSchema.nullable().optional(),
    sanitized_language: LanguageDiagnosticMetricSchema.nullable().optional(),
    sentence_count: z.number(),
    success: z.boolean(),
    title: OptionalStringSchema,
    word_count: z.number(),
  })
  .passthrough();

const ArticleAnalysisResponseSchema = z
  .object({
    article_url: z.string(),
    authors: z.array(z.string()).nullable().optional().transform((value) => value ?? undefined),
    bias_analysis: z
      .object({
        framing_bias: z.string(),
        overall_bias_score: z.string(),
        selection_bias: z.string(),
        source_diversity: z.string(),
        tone_bias: z.string(),
      })
      .passthrough()
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    error: OptionalStringSchema,
    fact_check_results: z
      .array(ArticleFactCheckSchema)
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    fact_check_suggestions: z
      .array(z.string())
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    full_text: OptionalStringSchema,
    grounding_metadata: z
      .object({
        grounding_chunks: z.array(GroundingChunkSchema).optional(),
        grounding_supports: AnyArraySchema.optional(),
        web_search_queries: WebSearchQueriesSchema.optional(),
      })
      .passthrough()
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    language_diagnostics: LanguageDiagnosticsDataSchema.nullable().optional(),
    publish_date: OptionalStringSchema,
    reporter_analysis: z
      .object({
        background: z.string(),
        expertise: z.string(),
        known_biases: z.string(),
        track_record: z.string(),
      })
      .passthrough()
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    source_analysis: z
      .object({
        credibility_assessment: z.string(),
        funding_model: z.string(),
        ownership: z.string(),
        political_leaning: z.string(),
        reputation: z.string(),
      })
      .passthrough()
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    success: z.boolean(),
    summary: OptionalStringSchema,
    title: OptionalStringSchema,
  })
  .passthrough();

const ArticleTopicSchema = z
  .object({
    cluster_id: z.number(),
    keywords: z.array(z.string()).optional(),
    label: z.string(),
    similarity: z.number().nullable(),
  })
  .passthrough();

const ArticleTopicsResponseSchema = z
  .object({ article_id: z.number(), topics: z.array(ArticleTopicSchema) })
  .passthrough();

const BulkArticleTopicsResponseSchema = z
  .object({ articles: z.record(z.string(), z.array(ArticleTopicSchema)) })
  .passthrough();

const BlindspotLensSchema = z
  .object({
    available: z.boolean(),
    description: z.string(),
    id: z.enum(["bias", "credibility", "geography", "institutional_populist"]),
    label: z.string(),
    unavailable_reason: OptionalStringSchema,
  })
  .passthrough();

const BlindspotLaneSchema = z
  .object({
    cluster_count: z.number(),
    description: z.string(),
    id: z.enum(["pole_a", "shared", "pole_b"]),
    label: z.string(),
  })
  .passthrough();

const BlindspotSummarySchema = z
  .object({
    category: OptionalStringSchema,
    eligible_clusters: z.number(),
    generated_at: z.string(),
    source_filters: z.array(z.string()),
    window: z.string(),
  })
  .passthrough();

const BlindspotViewerResponseSchema = z
  .object({
    available_lenses: z.array(BlindspotLensSchema),
    cards: AnyArraySchema,
    lanes: z.array(BlindspotLaneSchema),
    selected_lens: BlindspotLensSchema,
    status: z.string(),
    summary: BlindspotSummarySchema,
  })
  .passthrough();

const BookmarkEntrySchema = z
  .object({
    article_id: z.number(),
    bookmark_id: z.number(),
    category: z.string(),
    created_at: OptionalStringSchema,
    image: OptionalStringSchema,
    published: OptionalStringSchema,
    source: z.string(),
    summary: OptionalStringSchema,
    title: z.string(),
    url: z.string(),
  })
  .passthrough();

const BookmarkListResponseSchema = z
  .object({
    bookmarks: z.array(BookmarkEntrySchema),
    total: z.number(),
  })
  .passthrough();

const BreakingResponseSchema = z
  .object({
    clusters: AnyArraySchema,
    total: z.number(),
    window_hours: z.number(),
  })
  .passthrough();

const CacheDebugResponseSchema = z
  .object({
    articles: AnyArraySchema,
    limit: z.number(),
    offset: z.number(),
    returned: z.number(),
    source: OptionalStringSchema,
    total: z.number(),
  })
  .passthrough();

const CacheDeltaResponseSchema = z
  .object({
    cache_sampled: z.number(),
    cache_total: z.number(),
    db_total: z.number(),
    missing_in_db_count: z.number(),
    missing_in_db_sample: z.array(z.string()),
    sample_limit: z.number(),
    sample_offset: z.number(),
    source: OptionalStringSchema,
  })
  .passthrough();

const ChromaDebugArticleSchema = z
  .object({
    id: z.string(),
    metadata: AnyObjectSchema,
    preview: z.string(),
  })
  .passthrough();

const ChromaDebugResponseSchema = z
  .object({
    articles: z.array(ChromaDebugArticleSchema),
    limit: z.number(),
    offset: z.number(),
    returned: z.number(),
    total: z.number(),
  })
  .passthrough();

const ClusterDetailSchema = z
  .object({
    article_count: z.number(),
    articles: AnyArraySchema,
    first_seen: OptionalStringSchema,
    gdelt_context: z
      .object({
        goldstein_avg: z.number().nullable().optional(),
        goldstein_bucket: z.string().nullable().optional(),
        goldstein_max: z.number().nullable().optional(),
        goldstein_min: z.number().nullable().optional(),
        tone_avg: z.number().nullable().optional(),
        tone_baseline_avg: z.number().nullable().optional(),
        tone_delta_vs_cluster: z.number().nullable().optional(),
        top_cameo: z.array(GdeltTopCameoSchema),
        total_events: z.number(),
      })
      .passthrough()
      .nullable()
      .optional(),
    id: z.number(),
    is_active: z.boolean(),
    keywords: z.array(z.string()),
    label: OptionalStringSchema,
    last_seen: OptionalStringSchema,
  })
  .passthrough();

const ContradictionPanelResponseSchema = z
  .object({
    agreed_facts: AnyArraySchema.optional(),
    article_count: z.number(),
    claims: AnyArraySchema.optional(),
    reason: OptionalStringSchema,
    source_count: z.number(),
    status: z.string(),
    unconfirmed_gaps: z.array(z.string()).optional(),
  })
  .passthrough();

const CountryGeoDataSchema = z
  .object({
    countries: z.record(z.string(), AnyObjectSchema),
    total: z.number(),
  })
  .passthrough();

const DatabaseDebugResponseSchema = z
  .object({
    articles: AnyArraySchema,
    limit: z.number(),
    missing_embeddings_only: z.boolean(),
    newest_published: OptionalStringSchema,
    offset: z.number(),
    oldest_published: OptionalStringSchema,
    published_after: OptionalStringSchema,
    published_before: OptionalStringSchema,
    returned: z.number(),
    sort_direction: z.string(),
    source: OptionalStringSchema,
    total: z.number(),
  })
  .passthrough();

const DebugErrorEntrySchema = z
  .object({
    component: z.string().optional(),
    error_message: z.string().optional(),
    error_type: z.string().optional(),
    event_type: z.string().optional(),
    message: z.string().optional(),
    model: z.string().optional(),
    operation: z.string().optional(),
    request_id: z.string().optional(),
    service: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

const LlmLogEntrySchema = z
  .object({
    duration_ms: z.number().optional(),
    error_message: z.string().optional(),
    error_type: z.string().optional(),
    finish_reason: z.string().optional(),
    messages: z.array(AnyObjectSchema).optional(),
    model: z.string().optional(),
    request_id: z.string().optional(),
    service: z.string().optional(),
    success: z.boolean().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

const LlmLogResponseSchema = z
  .object({
    available: z.boolean(),
    entries: z.array(LlmLogEntrySchema),
    path: z.string(),
    returned: z.number(),
    service: OptionalStringSchema,
    success_filter: z.boolean().nullable().optional(),
    total: z.number(),
  })
  .passthrough();

const DebugErrorsResponseSchema = z
  .object({
    include_request_stream_events: z.boolean(),
    log_file: LlmLogResponseSchema,
    recent_request_stream_errors: z.array(DebugErrorEntrySchema),
    returned_recent_errors: z.number(),
  })
  .passthrough();

export {
  CategoriesResponseSchema,
  AddRssResponseSchema,
  AgenticResearchResponseSchema,
  ArticleAnalysisResponseSchema,
  ArticleTopicSchema,
  ArticleTopicsResponseSchema,
  BulkArticleTopicsResponseSchema,
  BlindspotViewerResponseSchema,
  BookmarkEntrySchema,
  BookmarkListResponseSchema,
  BreakingResponseSchema,
  CacheDebugResponseSchema,
  CacheDeltaResponseSchema,
  ChromaDebugResponseSchema,
  ClusterDetailSchema,
  ContradictionPanelResponseSchema,
  CountryGeoDataSchema,
  DatabaseDebugResponseSchema,
  DebugErrorsResponseSchema,
  LanguageDiagnosticsDataSchema,
  LlmLogResponseSchema,
};
