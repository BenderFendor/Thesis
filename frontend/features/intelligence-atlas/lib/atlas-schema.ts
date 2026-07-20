import { z } from "zod";

export const AtlasEntityTypeSchema = z.enum(["source", "organization", "reporter"]);
export const AtlasRelationTypeSchema = z.enum([
  "ownership", "owned_by", "parent_org", "part_of", "publishes", "employed_by",
  "current_outlet", "coauthor", "shared_outlet",
]);
export const AtlasConfidenceTierSchema = z.enum(["verified", "strong", "likely", "unresolved", "conflicting", "stale"]);
export const AtlasFactStatusSchema = z.enum(["candidate", "accepted", "disputed", "rejected", "superseded"]);
const NullableDateSchema = z.string().datetime({ offset: true }).nullable().optional();

export const AtlasEvidenceSchema = z.object({
  id: z.string(), source_type: z.string(), source_name: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(), retrieved_at: NullableDateSchema,
  excerpt: z.string().nullable().optional(), snapshot_sha256: z.string().nullable().optional(),
  locator: z.record(z.string(), z.unknown()).default({}), entailment: z.string().nullable().optional(),
});

export const AtlasNodeSchema = z.object({
  id: z.string(), entity_type: AtlasEntityTypeSchema, label: z.string(), subtitle: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(), funding_type: z.string().nullable().optional(),
  bias_rating: z.string().nullable().optional(), factual_reporting: z.string().nullable().optional(),
  credibility_score: z.number().nullable().optional(), article_count: z.number().int().nonnegative().default(0),
  connection_count: z.number().int().nonnegative().default(0), ownership_connection_count: z.number().int().nonnegative().default(0),
  status: z.string().nullable().optional(), confidence_tier: AtlasConfidenceTierSchema.nullable().optional(),
  profile_path: z.string().nullable().optional(), updated_at: NullableDateSchema, flags: z.array(z.string()).default([]),
});

export const AtlasEdgeSchema = z.object({
  id: z.string(), source_id: z.string(), target_id: z.string(), relation_type: AtlasRelationTypeSchema,
  direction: z.enum(["directed", "undirected"]).default("directed"), weight: z.number().default(1),
  ownership_percentage: z.number().nullable().optional(), confidence: z.number().min(0).max(1).nullable().optional(),
  confidence_tier: AtlasConfidenceTierSchema.nullable().optional(), evidence_count: z.number().int().nonnegative().default(0),
  evidence_preview: z.array(AtlasEvidenceSchema).default([]), valid_from: NullableDateSchema, valid_to: NullableDateSchema,
  last_verified_at: NullableDateSchema, is_inferred: z.boolean().default(false), raw_relation_type: z.string().nullable().optional(),
  fact_status: AtlasFactStatusSchema.default("candidate"), accepted_fact: z.boolean().default(false),
  qualifiers: z.record(z.string(), z.unknown()).default({}), claim_ids: z.array(z.string()).default([]),
  recorded_at: NullableDateSchema, retracted_at: NullableDateSchema,
  acceptance_policy_version: z.string().nullable().optional(), evidence_root_count: z.number().int().nonnegative().default(0),
});

const AtlasCoverageMetricSchema = z.object({ numerator: z.number().int().nonnegative().default(0), denominator: z.number().int().nonnegative().default(0) });
export const AtlasStatsSchema = z.object({
  total_sources: z.number().int().nonnegative().default(0), total_organizations: z.number().int().nonnegative().default(0),
  total_reporters: z.number().int().nonnegative().default(0), visible_sources: z.number().int().nonnegative().default(0),
  visible_organizations: z.number().int().nonnegative().default(0), visible_reporters: z.number().int().nonnegative().default(0),
  visible_relationships: z.number().int().nonnegative().default(0), current_relationships: z.number().int().nonnegative().default(0),
  accepted_relationships: z.number().int().nonnegative().default(0), candidate_relationships: z.number().int().nonnegative().default(0),
  disputed_relationships: z.number().int().nonnegative().default(0), ownership_coverage: AtlasCoverageMetricSchema,
  evidence_coverage: AtlasCoverageMetricSchema, unresolved_source_links: z.number().int().nonnegative().default(0),
});

export const AtlasGraphFiltersSchema = z.object({
  q: z.string().nullable().optional(), entity_types: z.array(AtlasEntityTypeSchema).default([]),
  relation_types: z.array(AtlasRelationTypeSchema).default([]), country: z.array(z.string()).default([]),
  funding: z.array(z.string()).default([]), bias: z.array(z.string()).default([]),
  min_confidence: z.number().min(0).max(1).default(0), selected: z.string().nullable().optional(),
  neighbors: z.number().int().min(0).max(2).default(0),
  layout: z.enum(["clustered", "ownership", "geography", "radial"]).default("clustered"),
  limit_nodes: z.number().int().positive().default(350), limit_edges: z.number().int().positive().default(1500),
  include_evidence_preview: z.boolean().default(true), as_of: NullableDateSchema, known_at: NullableDateSchema,
  accepted_only: z.boolean().optional(),
});

export const AtlasGraphResponseSchema = z.object({
  graph_version: z.string(), generated_at: z.string().datetime({ offset: true }), nodes: z.array(AtlasNodeSchema),
  edges: z.array(AtlasEdgeSchema), stats: AtlasStatsSchema, applied_filters: AtlasGraphFiltersSchema,
  truncated: z.boolean(), truncation_reason: z.string().nullable().optional(), next_expansion_token: z.string().nullable().optional(),
});
export const AtlasStatsResponseSchema = z.object({
  graph_version: z.string(), generated_at: z.string().datetime({ offset: true }), stats: AtlasStatsSchema,
  by_entity_type: z.record(z.string(), z.number()), by_relation_type: z.record(z.string(), z.number()),
  by_index_status: z.record(z.string(), z.number()), last_indexed_at: NullableDateSchema, indexing_active: z.boolean(),
});
export const AtlasSearchItemSchema = z.object({
  id: z.string(), entity_type: AtlasEntityTypeSchema, label: z.string(), subtitle: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(), confidence_tier: AtlasConfidenceTierSchema.nullable().optional(),
  profile_path: z.string().nullable().optional(),
});
export const AtlasSearchResponseSchema = z.object({ query: z.string(), sources: z.array(AtlasSearchItemSchema), organizations: z.array(AtlasSearchItemSchema), reporters: z.array(AtlasSearchItemSchema) });
export const AtlasConnectionSchema = z.object({ edge: AtlasEdgeSchema, entity: AtlasNodeSchema });
export const AtlasEntityRecordSchema = z.object({
  id: z.string(), entity_type: AtlasEntityTypeSchema, label: z.string(), subtitle: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(), status: z.string().nullable().optional(),
  confidence_tier: AtlasConfidenceTierSchema.nullable().optional(), last_verified_at: NullableDateSchema,
  profile_path: z.string().nullable().optional(), details: z.record(z.string(), z.unknown()),
  evidence: z.array(AtlasEvidenceSchema), connections: z.array(AtlasConnectionSchema),
});
export const AtlasIndexResponseSchema = z.object({ items: z.array(AtlasNodeSchema), total: z.number().int().nonnegative(), next_cursor: z.string().nullable().optional(), facets: z.record(z.string(), z.record(z.string(), z.number())) });

export type AtlasEntityType = z.infer<typeof AtlasEntityTypeSchema>;
export type AtlasRelationType = z.infer<typeof AtlasRelationTypeSchema>;
export type AtlasConfidenceTier = z.infer<typeof AtlasConfidenceTierSchema>;
export type AtlasFactStatus = z.infer<typeof AtlasFactStatusSchema>;
export type AtlasEvidence = z.infer<typeof AtlasEvidenceSchema>;
export type AtlasNode = z.infer<typeof AtlasNodeSchema>;
export type AtlasEdge = z.infer<typeof AtlasEdgeSchema>;
export type AtlasGraphFilters = z.infer<typeof AtlasGraphFiltersSchema>;
export type AtlasGraphResponse = z.infer<typeof AtlasGraphResponseSchema>;
export type AtlasStatsResponse = z.infer<typeof AtlasStatsResponseSchema>;
export type AtlasSearchItem = z.infer<typeof AtlasSearchItemSchema>;
export type AtlasSearchResponse = z.infer<typeof AtlasSearchResponseSchema>;
export type AtlasEntityRecord = z.infer<typeof AtlasEntityRecordSchema>;
export type AtlasIndexResponse = z.infer<typeof AtlasIndexResponseSchema>;

export function metricPercentage(metric: { numerator: number; denominator: number }): number {
  if (metric.denominator <= 0) return 0;
  return Math.round((metric.numerator / metric.denominator) * 1000) / 10;
}
