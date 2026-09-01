import { z } from "zod";

const AtlasEntityTypeSchema = z.enum(["outlet", "organization", "person", "reporter"]),
 AtlasRelationTypeSchema = z.enum([
  "ownership", "owned_by", "parent_org", "part_of", "publishes", "employed_by",
  "current_outlet", "coauthor", "shared_outlet", "founded_by", "sibling_via_owner",
]),
 AtlasConfidenceTierSchema = z.enum(["verified", "strong", "likely", "unresolved", "conflicting", "stale"]),
 AtlasFactStatusSchema = z.enum(["candidate", "accepted", "disputed", "rejected", "superseded"]),
 AtlasLifecycleStateSchema = z.enum(["current", "historical", "proposed", "pending", "disputed", "rejected", "superseded"]),

 OffsetDateSchema = z.string().datetime({ offset: true }),
 AtlasDateSchema = z.string().transform((value, context) => {
  const offsetDate = OffsetDateSchema.safeParse(value);
  if (offsetDate.success) {return offsetDate.data;}

  // PostgreSQL stores UTC datetimes without tzinfo in this project. FastAPI
  // Serializes those values as ISO strings without an offset, so restore the
  // UTC marker at the API boundary instead of rejecting the whole graph.
  const utcCandidate = `${value}Z`,
   utcDate = OffsetDateSchema.safeParse(utcCandidate);
  if (utcDate.success) {return utcDate.data;}

  context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid datetime" });
  return z.NEVER;
}),
 NullableDateSchema = AtlasDateSchema.nullable().optional(),

 AtlasEvidenceSchema = z.object({
  acceptance_decision: z.string().nullable().optional(), contradictions: z.array(z.string()).optional(), entailment: z.string().nullable().optional(), evidence_class: z.string().nullable().optional(), excerpt: z.string().nullable().optional(), id: z.string(), locator: z.record(z.string(), z.unknown()).default({}), policy_version: z.string().nullable().optional(), retrieved_at: NullableDateSchema, snapshot_sha256: z.string().nullable().optional(), source_name: z.string().nullable().optional(), source_type: z.string(), source_url: z.string().nullable().optional(),
}),

 AtlasNodeSchema = z.object({
  analysis_scores: z.record(z.string(), z.number()).default({}), article_count: z.number().int().nonnegative().default(0), bias_rating: z.string().nullable().optional(), confidence_tier: AtlasConfidenceTierSchema.nullable().optional(), connection_count: z.number().int().nonnegative().default(0), country_code: z.string().nullable().optional(), credibility_score: z.number().nullable().optional(), current_parent: z.string().nullable().optional(), entity_type: AtlasEntityTypeSchema, evidence_coverage: z.string().default("not researched"), factual_reporting: z.string().nullable().optional(), flags: z.array(z.string()).default([]), freshness: z.string().default("unknown"), funding_type: z.string().nullable().optional(), id: z.string(), label: z.string(), ownership_connection_count: z.number().int().nonnegative().default(0), pending_change: z.string().nullable().optional(), profile_path: z.string().nullable().optional(), status: z.string().nullable().optional(), subtitle: z.string().nullable().optional(), unresolved_gap: z.string().nullable().optional(), updated_at: NullableDateSchema,
}),

 AtlasEdgeSchema = z.object({
  acceptance_policy_version: z.string().nullable().optional(), accepted_fact: z.boolean().default(false), beneficial_interest: z.record(z.string(), z.string()).nullable().optional(), claim_ids: z.array(z.string()).default([]), confidence: z.number().min(0).max(1).nullable().optional(), confidence_tier: AtlasConfidenceTierSchema.nullable().optional(), direction: z.enum(["directed", "undirected"]).default("directed"), display_group: z.string(), economic_interest: z.record(z.string(), z.string()).nullable().optional(), evidence_count: z.number().int().nonnegative().default(0), evidence_preview: z.array(AtlasEvidenceSchema).default([]), evidence_root_count: z.number().int().nonnegative().default(0), fact_status: AtlasFactStatusSchema.default("candidate"), id: z.string(), is_inferred: z.boolean().default(false), last_verified_at: NullableDateSchema, lifecycle_state: AtlasLifecycleStateSchema.default("current"), ownership_percentage: z.number().nullable().optional(), predicate: z.string(), qualifiers: z.record(z.string(), z.unknown()).default({}), raw_relation_type: z.string().nullable().optional(), recorded_at: NullableDateSchema, relation_type: AtlasRelationTypeSchema, relation_type_deprecated: z.boolean().default(true), retracted_at: NullableDateSchema, source_id: z.string(), target_id: z.string(), valid_from: NullableDateSchema, valid_to: NullableDateSchema, voting_interest: z.record(z.string(), z.string()).nullable().optional(), weight: z.number().default(1),
}),

 AtlasCoverageMetricSchema = z.object({ denominator: z.number().int().nonnegative().default(0), numerator: z.number().int().nonnegative().default(0) }),
 AtlasStatsSchema = z.object({
  accepted_relationships: z.number().int().nonnegative().default(0), candidate_relationships: z.number().int().nonnegative().default(0), current_relationships: z.number().int().nonnegative().default(0), disputed_relationships: z.number().int().nonnegative().default(0), evidence_coverage: AtlasCoverageMetricSchema, ownership_coverage: AtlasCoverageMetricSchema, total_organizations: z.number().int().nonnegative().default(0), total_outlets: z.number().int().nonnegative().default(0), total_people: z.number().int().nonnegative().default(0), total_reporters: z.number().int().nonnegative().default(0), unresolved_source_links: z.number().int().nonnegative().default(0), visible_organizations: z.number().int().nonnegative().default(0), visible_outlets: z.number().int().nonnegative().default(0), visible_people: z.number().int().nonnegative().default(0), visible_relationships: z.number().int().nonnegative().default(0), visible_reporters: z.number().int().nonnegative().default(0),
}),

 AtlasGraphFiltersSchema = z.object({
  accepted_only: z.boolean().optional(), as_of: NullableDateSchema, bias: z.array(z.string()).default([]), country: z.array(z.string()).default([]), entity_types: z.array(AtlasEntityTypeSchema).default([]), funding: z.array(z.string()).default([]), include_evidence_preview: z.boolean().default(true), known_at: NullableDateSchema, layout: z.enum(["clustered", "ownership", "geography", "radial"]).default("clustered"), limit_edges: z.number().int().positive().default(1500), limit_nodes: z.number().int().positive().default(350), min_confidence: z.number().min(0).max(1).default(0), neighbors: z.number().int().min(0).max(2).default(0), q: z.string().nullable().optional(), relation_types: z.array(AtlasRelationTypeSchema).default([]), selected: z.string().nullable().optional(),
}),

 AtlasGraphResponseSchema = z.object({
  applied_filters: AtlasGraphFiltersSchema, edges: z.array(AtlasEdgeSchema), generated_at: AtlasDateSchema, graph_version: z.string(), next_expansion_token: z.string().nullable().optional(), nodes: z.array(AtlasNodeSchema), stats: AtlasStatsSchema, truncated: z.boolean(), truncation_reason: z.string().nullable().optional(),
}),
 AtlasStatsResponseSchema = z.object({
  by_entity_type: z.record(z.string(), z.number()), by_index_status: z.record(z.string(), z.number()), by_relation_type: z.record(z.string(), z.number()), generated_at: AtlasDateSchema, graph_version: z.string(), indexing_active: z.boolean(), last_indexed_at: NullableDateSchema, research_coverage: AtlasCoverageMetricSchema.default({ denominator: 0, numerator: 0 }), research_coverage_by_entity_type: z.record(z.string(), AtlasCoverageMetricSchema).default({}), stats: AtlasStatsSchema,
}),
 AtlasSearchItemSchema = z.object({
  confidence_tier: AtlasConfidenceTierSchema.nullable().optional(), country_code: z.string().nullable().optional(), current_parent: z.string().nullable().optional(), entity_type: AtlasEntityTypeSchema, evidence_coverage: z.string().default("not researched"), freshness: z.string().default("unknown"), id: z.string(), label: z.string(), pending_change: z.string().nullable().optional(), profile_path: z.string().nullable().optional(), subtitle: z.string().nullable().optional(), unresolved_gap: z.string().nullable().optional(),
}),
 AtlasSearchResponseSchema = z.object({
  organizations: z.array(AtlasSearchItemSchema),
  outlets: z.array(AtlasSearchItemSchema),
  people: z.array(AtlasSearchItemSchema),
  query: z.string(),
  reporters: z.array(AtlasSearchItemSchema),
}),
 AtlasConnectionSchema = z.object({ edge: AtlasEdgeSchema, entity: AtlasNodeSchema }),
 AtlasDossierStatementSchema = z.object({
  answer: z.string(), evidence: z.array(AtlasEvidenceSchema).default([]), label: z.string(), lifecycle_state: AtlasLifecycleStateSchema.nullable().optional(), predicate: z.string().nullable().optional(), qualifiers: z.record(z.string(), z.unknown()).default({}), state: z.enum(["known", "unknown", "not_researched", "source_unavailable", "chain_incomplete"]),
}),
 AtlasDossierSectionSchema = z.object({
  key: z.enum(["summary", "identity_public_records", "ownership_control", "newsroom_people", "funding_government_awards", "advertising_sponsorship", "publishing_distribution", "evidence_conflicts_freshness_gaps"]),
  statements: z.array(AtlasDossierStatementSchema).default([]),
  title: z.string(),
}),
 AtlasEntityRecordSchema = z.object({
  confidence_tier: AtlasConfidenceTierSchema.nullable().optional(), connections: z.array(AtlasConnectionSchema), country_code: z.string().nullable().optional(), details: z.record(z.string(), z.unknown()), dossier_sections: z.array(AtlasDossierSectionSchema).default([]), entity_kind: z.string().nullable().optional(), entity_type: AtlasEntityTypeSchema, evidence: z.array(AtlasEvidenceSchema), id: z.string(), label: z.string(), last_verified_at: NullableDateSchema, profile_path: z.string().nullable().optional(), status: z.string().nullable().optional(), subtitle: z.string().nullable().optional(),
}),
 AtlasIndexResponseSchema = z.object({ facets: z.record(z.string(), z.record(z.string(), z.number())), items: z.array(AtlasNodeSchema), next_cursor: z.string().nullable().optional(), total: z.number().int().nonnegative() }),
 EvidenceIngestRunSchema = z.object({
  accepted_count: z.number().int().nonnegative(), adapter: z.string(), adapter_version: z.string(), candidate_count: z.number().int().nonnegative(), claims_count: z.number().int().nonnegative(), completed_at: NullableDateSchema, documents_count: z.number().int().nonnegative(), failure: z.string().nullable().optional(), id: z.string(), missing_credentials: z.array(z.string()).default([]), network_mode: z.enum(["live", "offline", "disabled"]), observations_count: z.number().int().nonnegative(), retryable: z.boolean(), scope: z.record(z.string(), z.unknown()).default({}), snapshots_count: z.number().int().nonnegative(), started_at: AtlasDateSchema, status: z.enum(["running", "success", "partial", "failed", "blocked", "skipped"]),
}),
 AtlasIngestStatusResponseSchema = z.object({
  freshness: z.enum(["fresh", "stale", "never", "running", "partial"]),
  has_retryable_failures: z.boolean(),
  last_success_at: NullableDateSchema,
  missing_credentials: z.array(z.string()).default([]),
  runs: z.array(EvidenceIngestRunSchema).default([]),
}),

// `AtlasEntityRecord.details` is a loosely-typed bag (backend: `dict[str, Any]`).
// These schemas describe the Phase 3 ownership-context shapes that
// `atlas_entity.py` nests inside it (`ownership_chain`, `controls`,
// `siblings_via_owner`, `role_breakdown`, `external_ids`) and parse them
// Defensively rather than widening the base `details` contract.
 AtlasOwnershipChainHopSchema = z.object({
  claim_ids: z.array(z.string()).default([]), entity_id: z.string(), entity_type: AtlasEntityTypeSchema, evidence_count: z.number().int().nonnegative().default(0), label: z.string(), percentage: z.number().nullable().optional(), percentage_range: z.object({ lower: z.number(), upper: z.number() }).nullable().optional(), profile_path: z.string().nullable().optional(),
}),
 AtlasControlsEntrySchema = z.object({
  claim_ids: z.array(z.string()).default([]), entity_id: z.string(), entity_type: AtlasEntityTypeSchema, evidence_count: z.number().int().nonnegative().default(0), label: z.string(), percentage: z.number().nullable().optional(), profile_path: z.string().nullable().optional(), relation_type: z.string().nullable().optional(),
}),
 AtlasSiblingEntrySchema = z.object({
  claim_ids: z.array(z.string()).default([]), entity_id: z.string(), entity_type: AtlasEntityTypeSchema, evidence_count: z.number().int().nonnegative().default(0), label: z.string(), profile_path: z.string().nullable().optional(),
}),
 AtlasExternalIdSchema = z.object({
  scheme: z.string(), url: z.string().nullable().optional(), value: z.string(),
});
type AtlasOwnershipChainHop = z.infer<typeof AtlasOwnershipChainHopSchema>;
type AtlasControlsEntry = z.infer<typeof AtlasControlsEntrySchema>;
type AtlasSiblingEntry = z.infer<typeof AtlasSiblingEntrySchema>;
type AtlasExternalId = z.infer<typeof AtlasExternalIdSchema>;

// Phase 5's `funding_and_bias` details block (`atlas_entity._funding_and_
// Bias_block`): each field independently prefers an accepted evidence-spine
// Claim (origin="claim", carrying claim_ids/evidence) over the legacy
// SourceMetadata/Organization value (origin="legacy", no evidence) --
// Origin is undefined only when neither exists.
const AtlasFundingBiasFieldSchema = z.object({
  asserted_by: z.string().nullable().optional(),
  claim_ids: z.array(z.string()).default([]),
  evidence: z.array(AtlasEvidenceSchema).default([]),
  evidence_count: z.number().int().nonnegative().default(0),
  origin: z.enum(["claim", "legacy"]).nullable().optional(),
  source: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
}),
 AtlasFundingAndBiasSchema = z.object({
  bias_rating: AtlasFundingBiasFieldSchema,
  factual_reporting: AtlasFundingBiasFieldSchema,
  funding_type: AtlasFundingBiasFieldSchema,
});
type AtlasFundingBiasField = z.infer<typeof AtlasFundingBiasFieldSchema>;
type AtlasFundingAndBias = z.infer<typeof AtlasFundingAndBiasSchema>;

function parseFundingAndBias(details: Record<string, unknown>): AtlasFundingAndBias | null {
  const raw = details.funding_and_bias;
  if (!raw || typeof raw !== "object") {return null;}
  const parsed = AtlasFundingAndBiasSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseArrayField<S extends z.ZodTypeAny>(
  details: Record<string, unknown>,
  key: string,
  schema: S,
): z.output<S>[] {
  const raw = details[key];
  if (!Array.isArray(raw)) {return [];}
  return raw.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data as z.output<S>] : [];
  });
}

function parseOwnershipChain(details: Record<string, unknown>): AtlasOwnershipChainHop[] {
  return parseArrayField(details, "ownership_chain", AtlasOwnershipChainHopSchema);
}
function parseControls(details: Record<string, unknown>): AtlasControlsEntry[] {
  return parseArrayField(details, "controls", AtlasControlsEntrySchema);
}
function parseSiblingsViaOwner(details: Record<string, unknown>): AtlasSiblingEntry[] {
  return parseArrayField(details, "siblings_via_owner", AtlasSiblingEntrySchema);
}
function parseExternalIds(details: Record<string, unknown>): AtlasExternalId[] {
  return parseArrayField(details, "external_ids", AtlasExternalIdSchema);
}
function parseRoleBreakdown(details: Record<string, unknown>): Record<string, number> {
  const raw = details.role_breakdown;
  if (!raw || typeof raw !== "object") {return {};}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

type AtlasEntityType = z.infer<typeof AtlasEntityTypeSchema>;
type AtlasRelationType = z.infer<typeof AtlasRelationTypeSchema>;
type AtlasConfidenceTier = z.infer<typeof AtlasConfidenceTierSchema>;
type AtlasFactStatus = z.infer<typeof AtlasFactStatusSchema>;
type AtlasLifecycleState = z.infer<typeof AtlasLifecycleStateSchema>;
type AtlasEvidence = z.infer<typeof AtlasEvidenceSchema>;
type AtlasNode = z.infer<typeof AtlasNodeSchema>;
type AtlasEdge = z.infer<typeof AtlasEdgeSchema>;
type AtlasGraphFilters = z.infer<typeof AtlasGraphFiltersSchema>;
type AtlasGraphResponse = z.infer<typeof AtlasGraphResponseSchema>;
type AtlasStatsResponse = z.infer<typeof AtlasStatsResponseSchema>;
type AtlasSearchItem = z.infer<typeof AtlasSearchItemSchema>;
type AtlasSearchResponse = z.infer<typeof AtlasSearchResponseSchema>;
type AtlasEntityRecord = z.infer<typeof AtlasEntityRecordSchema>;
type AtlasIndexResponse = z.infer<typeof AtlasIndexResponseSchema>;
type AtlasIngestStatusResponse = z.infer<typeof AtlasIngestStatusResponseSchema>;

const AtlasMeasurementRecordSchema = z.object({
  algorithm_version: z.string(), created_at: AtlasDateSchema, id: z.string(), measurement_name: z.string(), result: z.record(z.string(), z.unknown()),
}),
 AtlasMeasurementsResponseSchema = z.object({
  measurements: z.array(AtlasMeasurementRecordSchema).default([]),
  source_name: z.string().nullable().optional(),
});
type AtlasMeasurementsResponse = z.infer<typeof AtlasMeasurementsResponseSchema>;

// `GET /api/wiki/atlas/analysis/funding-bias` -- the catalog-wide,
// Pre-registered funding-type x bias-rating correlation (Phase 5 Part B).
const FundingBiasSpecificationSchema = z.object({
  algorithm_version: z.string().optional(),
  interpretation_bands: z.record(z.string(), z.string()).default({}),
  limitations: z.array(z.string()).default([]),
  measure: z.string().optional(),
  population: z.string().optional(),
  predicates_consulted: z.array(z.string()).default([]),
}).passthrough(),
 FundingBiasMethodologySchema = z.object({
  deviations: z.array(z.unknown()).default([]),
  locked_at: AtlasDateSchema,
  preregistration_id: z.string(),
  specification: FundingBiasSpecificationSchema,
  title: z.string(),
}),
 FundingBiasStatisticSchema = z.object({
  chi_square: z.number().nullable().optional(),
  cols: z.array(z.string()),
  cramers_v: z.number().nullable().optional(),
  degrees_of_freedom: z.number().int().nullable().optional(),
  interpretation: z.string().nullable().optional(),
  n: z.number().int().nonnegative(),
  note: z.string().nullable().optional(),
  rows: z.array(z.string()),
  table: z.array(z.array(z.number().int())),
}),
 FundingBiasAnalysisResponseSchema = z.object({
  algorithm_version: z.string().nullable().optional(),
  available: z.boolean().default(false),
  computed_at: NullableDateSchema,
  methodology: FundingBiasMethodologySchema.nullable().optional(),
  population_size: z.number().int().nonnegative().default(0),
  statistic: FundingBiasStatisticSchema.nullable().optional(),
  trace_id: z.string().nullable().optional(),
  validation_card_skip_reason: z.string().nullable().optional(),
});
type FundingBiasMethodology = z.infer<typeof FundingBiasMethodologySchema>;
type FundingBiasStatistic = z.infer<typeof FundingBiasStatisticSchema>;
type FundingBiasAnalysisResponse = z.infer<typeof FundingBiasAnalysisResponseSchema>;
type FundingBiasSpecification = z.infer<typeof FundingBiasSpecificationSchema>;

function metricPercentage(metric:Readonly< { numerator: number; denominator: number }>): number {
  if (metric.denominator <= 0) {return 0;}
  return Math.round((metric.numerator / metric.denominator) * 1000) / 10;
}

export {
  type AtlasConfidenceTier,
  AtlasConfidenceTierSchema,
  AtlasConnectionSchema,
  type AtlasControlsEntry,
  AtlasControlsEntrySchema,
  AtlasDossierSectionSchema,
  AtlasDossierStatementSchema,
  type AtlasEdge,
  AtlasEdgeSchema,
  type AtlasEntityRecord,
  AtlasEntityRecordSchema,
  type AtlasEntityType,
  AtlasEntityTypeSchema,
  type AtlasEvidence,
  AtlasEvidenceSchema,
  type AtlasFactStatus,
  AtlasFactStatusSchema,
  type AtlasFundingAndBias,
  AtlasFundingAndBiasSchema,
  type AtlasFundingBiasField,
  AtlasFundingBiasFieldSchema,
  type AtlasGraphFilters,
  AtlasGraphFiltersSchema,
  type AtlasGraphResponse,
  AtlasGraphResponseSchema,
  type AtlasIndexResponse,
  AtlasIndexResponseSchema,
  type AtlasIngestStatusResponse,
  AtlasIngestStatusResponseSchema,
  type AtlasLifecycleState,
  AtlasLifecycleStateSchema,
  type AtlasMeasurementsResponse,
  AtlasMeasurementsResponseSchema,
  type AtlasNode,
  AtlasNodeSchema,
  type AtlasOwnershipChainHop,
  AtlasOwnershipChainHopSchema,
  type AtlasRelationType,
  AtlasRelationTypeSchema,
  type AtlasSearchItem,
  AtlasSearchItemSchema,
  type AtlasSearchResponse,
  AtlasSearchResponseSchema,
  type AtlasStatsResponse,
  AtlasStatsResponseSchema,
  AtlasStatsSchema,
  EvidenceIngestRunSchema,
  type FundingBiasAnalysisResponse,
  FundingBiasAnalysisResponseSchema,
  type FundingBiasMethodology,
  FundingBiasMethodologySchema,
  type FundingBiasSpecification,
  FundingBiasSpecificationSchema,
  type FundingBiasStatistic,
  FundingBiasStatisticSchema,
  metricPercentage,
  parseControls,
  parseExternalIds,
  parseFundingAndBias,
  parseOwnershipChain,
  parseRoleBreakdown,
  parseSiblingsViaOwner,
};
