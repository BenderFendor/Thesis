import { z } from "zod";

const AnyArraySchema = z.array(z.any());
const AnyObjectSchema = z.record(z.string(), z.any());
const ApiObjectResponseSchema = z.record(z.string(), z.unknown());
const OptionalStringSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const DossierItemSchema = z
  .object({
    label: z.string().optional(),
    notes: z.string().optional(),
    sources: z.array(z.string()).optional(),
    value: z.string().optional(),
  })
  .passthrough();

const DossierSectionSchema = z
  .object({
    id: z.string(),
    items: z.array(DossierItemSchema),
    status: z.enum(["available", "missing"]),
    title: z.string(),
  })
  .passthrough();

const ArticleFactCheckSchema = z
  .object({
    claim: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    evidence: z.string(),
    notes: z.string().optional(),
    sources: z.array(z.string()),
    verification_status: z.enum(["verified", "partially-verified", "unverified", "false"]),
  })
  .passthrough();

const GroundingChunkSchema = z
  .object({ title: z.string().optional(), uri: z.string().optional() })
  .passthrough();

const WebSearchQueriesSchema = z.array(z.string());

const SourceDebugHttpStatusSchema = z.number().or(z.string());

const SourceDebugUrlSchema = z.union([z.string(), z.array(z.string())]);

const GdeltTopCameoSchema = z
  .object({
    code: z.string().nullable().optional(),
    count: z.number(),
    label: z.string().nullable().optional(),
  })
  .passthrough();

const SourceCoverageEntrySchema = z
  .object({
    article_count: z.number(),
    centroid_distance: z.number().optional(),
    diversity_score: z.number().optional(),
    spread: z.number().optional(),
  })
  .passthrough();

const StoryLineSchema = z
  .object({
    confidence: z.number().nullable().optional(),
    current_summary: z.string().nullable().optional(),
    earliest_article_id: z.number().nullable().optional(),
    external_cluster_id: z.number(),
    first_seen_at: z.string().nullable().optional(),
    id: z.number(),
    keywords: z.array(z.string()).optional(),
    label: z.string().nullable().optional(),
    last_seen_at: z.string().nullable().optional(),
  })
  .passthrough();

const SourceCredibilityDataQualitySchema = z
  .object({
    completeness_pct: z.number(),
    dimensions_available: z.number(),
    dimensions_total: z.number(),
    last_updated: z.string().nullable(),
  })
  .passthrough();

const SourceCredibilityProvenanceSchema = z
  .object({
    last_updated: z.string().optional(),
    provenance_tag: z.string().optional(),
    source: z.string(),
    url: z.string(),
  })
  .passthrough();

const SourceCredibilityDimensionSchema = z
  .object({
    confidence: z.number(),
    dimension: z.string(),
    explanation: z.string(),
    provenance: z.array(SourceCredibilityProvenanceSchema),
    score: z.number().nullable(),
    signals_available: z.number(),
    signals_missing: z.number(),
    status: z.string(),
  })
  .passthrough();

const SourceDebugSubFeedSchema = z
  .object({
    article_count: z.number(),
    error: z.string().optional(),
    status: z.enum(["success", "warning", "error"]),
    url: z.string(),
  })
  .passthrough();

const PolicySignalSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    matched_terms: z.array(z.string()),
    sources: z.array(z.string()),
    status: z.literal("available"),
  })
  .passthrough();

const SourceResearchCitationSchema = z
  .object({ label: z.string(), note: OptionalStringSchema, url: OptionalStringSchema })
  .passthrough();

const StartupMetricEventSchema = z
  .object({
    completed_at: OptionalStringSchema,
    detail: OptionalStringSchema,
    duration_seconds: z.number().nullable().optional(),
    metadata: AnyObjectSchema.optional(),
    name: z.string(),
    started_at: OptionalStringSchema,
  })
  .passthrough();

const WikiAnalysisCitationSchema = z
  .object({
    snippet: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

const WikiSourceCitationSchema = z
  .object({ label: z.string(), note: z.string().optional(), url: z.string().optional() })
  .passthrough();

const WikiOwnershipEntrySchema = z
  .object({ name: z.string(), ownership_percentage: z.number().optional() })
  .passthrough();

export {
  AnyArraySchema,
  AnyObjectSchema,
  ApiObjectResponseSchema,
  OptionalStringSchema,
  DossierItemSchema,
  DossierSectionSchema,
  ArticleFactCheckSchema,
  GroundingChunkSchema,
  WebSearchQueriesSchema,
  SourceDebugHttpStatusSchema,
  SourceDebugUrlSchema,
  GdeltTopCameoSchema,
  SourceCoverageEntrySchema,
  StoryLineSchema,
  SourceCredibilityDataQualitySchema,
  SourceCredibilityProvenanceSchema,
  SourceCredibilityDimensionSchema,
  SourceDebugSubFeedSchema,
  PolicySignalSchema,
  SourceResearchCitationSchema,
  StartupMetricEventSchema,
  WikiAnalysisCitationSchema,
  WikiSourceCitationSchema,
  WikiOwnershipEntrySchema,
};
