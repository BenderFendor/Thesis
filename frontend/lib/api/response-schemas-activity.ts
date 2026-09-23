import { z } from "zod";
import { AnyArraySchema, OptionalStringSchema, SourceCoverageEntrySchema, StoryLineSchema } from "./response-schemas-shared";
import { LanguageDiagnosticsDataSchema } from "./response-schemas-analysis";

const HighlightSchema = z
  .object({
    article_url: z.string(),
    character_end: z.number(),
    character_start: z.number(),
    client_id: z.string().optional(),
    color: z.enum(["yellow", "blue", "red", "green", "purple"]),
    created_at: OptionalStringSchema,
    highlighted_text: z.string(),
    id: z.number().optional(),
    note: OptionalStringSchema,
    updated_at: OptionalStringSchema,
    user_id: z.number().optional(),
  })
  .passthrough();

const LanguageDiagnosticsResponseSchema = LanguageDiagnosticsDataSchema;

const LikedEntrySchema = z
  .object({
    article_id: z.number(),
    category: z.string(),
    created_at: OptionalStringSchema,
    image: OptionalStringSchema,
    liked_id: z.number(),
    published: OptionalStringSchema,
    source: z.string(),
    summary: OptionalStringSchema,
    title: z.string(),
    url: z.string(),
  })
  .passthrough();

const LikedListResponseSchema = z
  .object({
    liked: z.array(LikedEntrySchema),
    total: z.number(),
  })
  .passthrough();

const SearchSuggestionSchema = z
  .object({ cluster_id: z.number(), label: z.string(), relevance: z.number() })
  .passthrough();

const SearchSuggestionsResponseSchema = z
  .object({ query: z.string(), suggestions: z.array(SearchSuggestionSchema) })
  .passthrough();

const SourceCoverageResponseSchema = z
  .object({
    error: z.string().optional(),
    global_article_count: z.number(),
    sources: z.record(z.string(), SourceCoverageEntrySchema),
  })
  .passthrough();

const NoveltyScoreResponseSchema = z
  .object({
    article_id: z.number(),
    avg_similarity_to_history: z.number(),
    history_size: z.number(),
    max_similarity_to_history: z.number(),
    novelty_score: z.number(),
    reason: z.string().optional(),
  })
  .passthrough();

const QueueDigestSchema = z
  .object({
    digest_items: AnyArraySchema,
    estimated_read_time_minutes: z.number(),
    generated_at: z.string(),
    total_items: z.number(),
  })
  .passthrough();

const QueueOverviewSchema = z
  .object({
    completed_count: z.number(),
    daily_items: z.number(),
    estimated_total_read_time_minutes: z.number(),
    permanent_items: z.number(),
    reading_count: z.number(),
    total_items: z.number(),
    unread_count: z.number(),
  })
  .passthrough();

const ReadingQueueItemSchema = z
  .object({
    added_at: z.string(),
    archived_at: z.string().nullable().optional(),
    article_id: z.number(),
    article_image: OptionalStringSchema,
    article_source: z.string(),
    article_title: z.string(),
    article_url: z.string(),
    created_at: z.string().nullable().optional(),
    estimated_read_time_minutes: z.number().nullable().optional(),
    full_text: OptionalStringSchema,
    id: z.number().nullable().optional(),
    position: z.number(),
    queue_type: z.string(),
    read_status: z.string(),
    shelf_id: z.number().nullable().optional(),
    unresolved_question: OptionalStringSchema,
    updated_at: z.string().nullable().optional(),
    user_id: z.number().nullable().optional(),
    why_saved: OptionalStringSchema,
    word_count: z.number().nullable().optional(),
  })
  .passthrough();

const ReadingShelfSchema = z
  .object({
    created_at: z.string().nullable().optional(),
    description: OptionalStringSchema,
    id: z.number().nullable().optional(),
    name: z.string(),
    updated_at: z.string().nullable().optional(),
    user_id: z.number().nullable(),
  })
  .passthrough();

const RelatedArticlesResponseSchema = z
  .object({
    article_id: z.number(),
    related: AnyArraySchema,
    total: z.number(),
  })
  .passthrough();

const AllClustersResponseSchema = z
  .object({
    clusters: AnyArraySchema,
    computed_at: OptionalStringSchema,
    status: OptionalStringSchema,
    total: z.number(),
    window: z.string(),
  })
  .passthrough();

const TrendingResponseSchema = z
  .object({
    clusters: AnyArraySchema,
    total: z.number(),
    window: z.string(),
  })
  .passthrough();

const StoryLineageResponseSchema = z
  .object({
    article_edges: AnyArraySchema.optional(),
    claim_edges: AnyArraySchema.optional(),
    claims: AnyArraySchema.optional(),
    corrections: AnyArraySchema.optional(),
    reason: OptionalStringSchema,
    status: z.string(),
    story: StoryLineSchema.nullable().optional(),
  })
  .passthrough();

export {
  HighlightSchema,
  LanguageDiagnosticsResponseSchema,
  LikedEntrySchema,
  LikedListResponseSchema,
  NoveltyScoreResponseSchema,
  QueueDigestSchema,
  QueueOverviewSchema,
  ReadingQueueItemSchema,
  ReadingShelfSchema,
  RelatedArticlesResponseSchema,
  SourceCoverageResponseSchema,
  SearchSuggestionsResponseSchema,
  AllClustersResponseSchema,
  TrendingResponseSchema,
  StoryLineageResponseSchema,
};
