// Runtime schemas kept only for contracts that have historically drifted
// (backend emits explicit null where the type says optional).

import { z } from "zod";

export const BackendArticleSchema = z
  .object({
    article_id: z.number().optional(),
    article_url: z.string().nullish(),
    author: z.string().nullish(),
    authors: z.array(z.string()).nullish(),
    bias: z.string().nullish(),
    category: z.string().nullish(),
    content: z.string().nullish(),
    country: z.string().nullish(),
    credibility: z.string().nullish(),
    description: z.string().nullish(),
    geo_signal: z.object({
      id: z.string(),
      label: z.string(),
    }).nullish(),
    id: z.number().optional(),
    image: z.string().nullish(),
    image_url: z.string().nullish(),
    is_persisted: z.boolean().optional(),
    link: z.string().nullish(),
    mentioned_countries: z.array(z.string()).nullish(),
    original_language: z.string().nullish(),
    original_url: z.string().nullish(),
    published: z.string().nullish(),
    publishedAt: z.string().nullish(),
    published_at: z.string().nullish(),
    source: z.string().nullish(),
    source_country: z.string().nullish(),
    source_id: z.string().nullish(),
    source_name: z.string().nullish(),
    summary: z.string().nullish(),
    title: z.string().nullish(),
    translated: z.boolean().optional(),
    url: z.string().nullish(),
  })
  .passthrough();

export const PaginatedPayloadSchema = z.object({
  articles: z.array(BackendArticleSchema).optional(),
  has_more: z.boolean().optional(),
  limit: z.number().optional(),
  next_cursor: z.string().nullable().optional(),
  prev_cursor: z.string().nullable().optional(),
  total: z.number().optional(),
}).passthrough();

export const BackendSourceSchema = z
  .object({
    bias_rating: z.string().optional(),
    category: z.string().optional(),
    country: z.string().default("US"),
    credibility_score: z.number().optional().nullable(),
    factual_rating: z.string().optional().nullable(),
    funding_type: z.string().optional(),
    id: z.string().optional(),
    is_paywalled: z.boolean().optional(),
    name: z.string(),
    ownership_label: z.string().optional(),
    rssUrl: z.string().optional(),
    slug: z.string().optional(),
    source_type: z.string().optional().nullable(),
    url: z.string(),
  })
  .passthrough();

export const CacheStatusSchema = z
  .object({
    cache_age_seconds: z.number(),
    category_breakdown: z.record(z.string(), z.number()),
    last_updated: z.string(),
    sources_with_errors: z.number(),
    sources_with_warnings: z.number(),
    sources_working: z.number(),
    total_articles: z.number(),
    total_sources: z.number(),
    update_in_progress: z.boolean(),
  })
  .passthrough();

export const StreamEventSchema = z
  .object({
    articles: z.array(BackendArticleSchema).optional(),
    cache_age_seconds: z.number().optional(),
    error: z.string().optional(),
    failed_sources: z.number().optional(),
    message: z.string().optional(),
    progress: z.object({
      completed: z.number(),
      total: z.number(),
      percentage: z.number(),
      currentSource: z.string().optional(),
      message: z.string().optional(),
    }).optional(),
    source: z.string().optional(),
    source_stat: z.record(z.string(), z.unknown()).optional(),
    status: z.enum([
      "starting",
      "initial",
      "cache_data",
      "source_complete",
      "source_error",
      "complete",
      "error",
    ]),
    stream_id: z.string().optional(),
    successful_sources: z.number().optional(),
    timestamp: z.string().optional(),
    total_articles: z.number().optional(),
  })
  .passthrough();
