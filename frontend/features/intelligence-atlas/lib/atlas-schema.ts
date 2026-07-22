import { z } from "zod";

export const AtlasEntityTypeSchema = z.enum(["outlet", "organization", "person", "reporter"]);
export const AtlasRelationTypeSchema = z.enum([
  "ownership", "owned_by", "parent_org", "part_of", "publishes", "employed_by",
  "current_outlet", "coauthor", "shared_outlet", "founded_by", "sibling_via_owner",
]);
export const AtlasConfidenceTierSchema = z.enum(["verified", "strong", "likely", "unresolved", "conflicting", "stale"]);
export const AtlasFactStatusSchema = z.enum(["candidate", "accepted", "disputed", "rejected", "superseded"]);

const OffsetDateSchema = z.string().datetime({ offset: true });
const AtlasDateSchema = z.string().transform((value, context) => {
  const offsetDate = OffsetDateSchema.safeParse(value);
  if (offsetDate.success) return offsetDate.data;

  // PostgreSQL stores UTC datetimes without tzinfo in this project. FastAPI
  // serializes those values as ISO strings without an offset, so restore the
  // UTC marker at the API boundary instead of rejecting the whole graph.
  const utcCandidate = `${value}Z`;
  const utcDate = OffsetDateSchema.safeParse(utcCandidate);
  if (utcDate.success) return utcDate.data;

  context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid datetime" });
  return z.NEVER;
});
const NullableDateSchema = AtlasDateSchema.nullable().optional();

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
  credibility_score: z.number().nullable().optional(), analysis_scores: z.record(z.string(), z.number()).default({}),
  article_count: z.number().int().nonnegative().default(0),
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
  total_outlets: z.number().int().nonnegative().default(0), total_organizations: z.number().int().nonnegative().default(0),
  total_people: z.number().int().nonnegative().default(0),
  total_reporters: z.number().int().nonnegative().default(0), visible_outlets: z.number().int().nonnegative().default(0),
  visible_organizations: z.number().int().nonnegative().default(0), visible_people: z.number().int().nonnegative().default(0),
  visible_reporters: z.number().int().nonnegative().default(0),
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
  graph_version: z.string(), generated_at: AtlasDateSchema, nodes: z.array(AtlasNodeSchema),
  edges: z.array(AtlasEdgeSchema), stats: AtlasStatsSchema, applied_filters: AtlasGraphFiltersSchema,
  truncated: z.boolean(), truncation_reason: z.string().nullable().optional(), next_expansion_token: z.string().nullable().optional(),
});
export const AtlasStatsResponseSchema = z.object({
  graph_version: z.string(), generated_at: AtlasDateSchema, stats: AtlasStatsSchema,
  by_entity_type: z.record(z.string(), z.number()), by_relation_type: z.record(z.string(), z.number()),
  by_index_status: z.record(z.string(), z.number()), last_indexed_at: NullableDateSchema, indexing_active: z.boolean(),
});
export const AtlasSearchItemSchema = z.object({
  id: z.string(), entity_type: AtlasEntityTypeSchema, label: z.string(), subtitle: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(), confidence_tier: AtlasConfidenceTierSchema.nullable().optional(),
  profile_path: z.string().nullable().optional(),
});
export const AtlasSearchResponseSchema = z.object({
  query: z.string(),
  outlets: z.array(AtlasSearchItemSchema),
  organizations: z.array(AtlasSearchItemSchema),
  people: z.array(AtlasSearchItemSchema),
  reporters: z.array(AtlasSearchItemSchema),
});
export const AtlasConnectionSchema = z.object({ edge: AtlasEdgeSchema, entity: AtlasNodeSchema });
export const AtlasEntityRecordSchema = z.object({
  id: z.string(), entity_type: AtlasEntityTypeSchema, label: z.string(), subtitle: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(), status: z.string().nullable().optional(),
  confidence_tier: AtlasConfidenceTierSchema.nullable().optional(), last_verified_at: NullableDateSchema,
  profile_path: z.string().nullable().optional(), details: z.record(z.string(), z.unknown()),
  evidence: z.array(AtlasEvidenceSchema), connections: z.array(AtlasConnectionSchema),
});
export const AtlasIndexResponseSchema = z.object({ items: z.array(AtlasNodeSchema), total: z.number().int().nonnegative(), next_cursor: z.string().nullable().optional(), facets: z.record(z.string(), z.record(z.string(), z.number())) });

// `AtlasEntityRecord.details` is a loosely-typed bag (backend: `dict[str, Any]`).
// These schemas describe the Phase 3 ownership-context shapes that
// `atlas_entity.py` nests inside it (`ownership_chain`, `controls`,
// `siblings_via_owner`, `role_breakdown`, `external_ids`) and parse them
// defensively rather than widening the base `details` contract.
export const AtlasOwnershipChainHopSchema = z.object({
  entity_id: z.string(), label: z.string(), entity_type: AtlasEntityTypeSchema,
  profile_path: z.string().nullable().optional(),
  percentage: z.number().nullable().optional(),
  percentage_range: z.object({ lower: z.number(), upper: z.number() }).nullable().optional(),
  evidence_count: z.number().int().nonnegative().default(0),
  claim_ids: z.array(z.string()).default([]),
});
export const AtlasControlsEntrySchema = z.object({
  entity_id: z.string(), label: z.string(), entity_type: AtlasEntityTypeSchema,
  profile_path: z.string().nullable().optional(),
  relation_type: z.string().nullable().optional(),
  percentage: z.number().nullable().optional(),
  evidence_count: z.number().int().nonnegative().default(0),
  claim_ids: z.array(z.string()).default([]),
});
export const AtlasSiblingEntrySchema = z.object({
  entity_id: z.string(), label: z.string(), entity_type: AtlasEntityTypeSchema,
  profile_path: z.string().nullable().optional(),
  evidence_count: z.number().int().nonnegative().default(0),
  claim_ids: z.array(z.string()).default([]),
});
export const AtlasExternalIdSchema = z.object({
  scheme: z.string(), value: z.string(), url: z.string().nullable().optional(),
});
export type AtlasOwnershipChainHop = z.infer<typeof AtlasOwnershipChainHopSchema>;
export type AtlasControlsEntry = z.infer<typeof AtlasControlsEntrySchema>;
export type AtlasSiblingEntry = z.infer<typeof AtlasSiblingEntrySchema>;
export type AtlasExternalId = z.infer<typeof AtlasExternalIdSchema>;

// Phase 5's `funding_and_bias` details block (`atlas_entity._funding_and_
// bias_block`): each field independently prefers an accepted evidence-spine
// claim (origin="claim", carrying claim_ids/evidence) over the legacy
// SourceMetadata/Organization value (origin="legacy", no evidence) --
// origin is null only when neither exists.
export const AtlasFundingBiasFieldSchema = z.object({
  value: z.string().nullable().optional(),
  origin: z.enum(["claim", "legacy"]).nullable().optional(),
  asserted_by: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  claim_ids: z.array(z.string()).default([]),
  evidence_count: z.number().int().nonnegative().default(0),
  evidence: z.array(AtlasEvidenceSchema).default([]),
});
export const AtlasFundingAndBiasSchema = z.object({
  funding_type: AtlasFundingBiasFieldSchema,
  bias_rating: AtlasFundingBiasFieldSchema,
  factual_reporting: AtlasFundingBiasFieldSchema,
});
export type AtlasFundingBiasField = z.infer<typeof AtlasFundingBiasFieldSchema>;
export type AtlasFundingAndBias = z.infer<typeof AtlasFundingAndBiasSchema>;

export function parseFundingAndBias(details: Record<string, unknown>): AtlasFundingAndBias | null {
  const raw = details.funding_and_bias;
  if (!raw || typeof raw !== "object") return null;
  const parsed = AtlasFundingAndBiasSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseArrayField<S extends z.ZodTypeAny>(
  details: Record<string, unknown>,
  key: string,
  schema: S,
): z.output<S>[] {
  const raw = details[key];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data as z.output<S>] : [];
  });
}

export function parseOwnershipChain(details: Record<string, unknown>): AtlasOwnershipChainHop[] {
  return parseArrayField(details, "ownership_chain", AtlasOwnershipChainHopSchema);
}
export function parseControls(details: Record<string, unknown>): AtlasControlsEntry[] {
  return parseArrayField(details, "controls", AtlasControlsEntrySchema);
}
export function parseSiblingsViaOwner(details: Record<string, unknown>): AtlasSiblingEntry[] {
  return parseArrayField(details, "siblings_via_owner", AtlasSiblingEntrySchema);
}
export function parseExternalIds(details: Record<string, unknown>): AtlasExternalId[] {
  return parseArrayField(details, "external_ids", AtlasExternalIdSchema);
}
export function parseRoleBreakdown(details: Record<string, unknown>): Record<string, number> {
  const raw = details.role_breakdown;
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

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

// `GET /api/wiki/atlas/analysis/funding-bias` -- the catalog-wide,
// pre-registered funding-type x bias-rating correlation (Phase 5 Part B).
export const FundingBiasMethodologySchema = z.object({
  preregistration_id: z.string(),
  title: z.string(),
  locked_at: AtlasDateSchema,
  specification: z.record(z.string(), z.unknown()),
  deviations: z.array(z.unknown()).default([]),
});
export const FundingBiasStatisticSchema = z.object({
  n: z.number().int().nonnegative(),
  rows: z.array(z.string()),
  cols: z.array(z.string()),
  table: z.array(z.array(z.number().int())),
  chi_square: z.number().nullable().optional(),
  degrees_of_freedom: z.number().int().nullable().optional(),
  cramers_v: z.number().nullable().optional(),
  interpretation: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
export const FundingBiasAnalysisResponseSchema = z.object({
  available: z.boolean().default(false),
  methodology: FundingBiasMethodologySchema.nullable().optional(),
  statistic: FundingBiasStatisticSchema.nullable().optional(),
  trace_id: z.string().nullable().optional(),
  algorithm_version: z.string().nullable().optional(),
  computed_at: NullableDateSchema,
  population_size: z.number().int().nonnegative().default(0),
  validation_card_skip_reason: z.string().nullable().optional(),
});
export type FundingBiasMethodology = z.infer<typeof FundingBiasMethodologySchema>;
export type FundingBiasStatistic = z.infer<typeof FundingBiasStatisticSchema>;
export type FundingBiasAnalysisResponse = z.infer<typeof FundingBiasAnalysisResponseSchema>;

export function metricPercentage(metric: { numerator: number; denominator: number }): number {
  if (metric.denominator <= 0) return 0;
  return Math.round((metric.numerator / metric.denominator) * 1000) / 10;
}
