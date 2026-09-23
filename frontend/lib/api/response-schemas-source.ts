import { z } from "zod";
import { AnyArraySchema, AnyObjectSchema, OptionalStringSchema, DossierSectionSchema, SourceDebugHttpStatusSchema, SourceDebugUrlSchema, SourceCredibilityDataQualitySchema, SourceCredibilityDimensionSchema, SourceDebugSubFeedSchema, PolicySignalSchema, SourceResearchCitationSchema, StartupMetricEventSchema, WikiAnalysisCitationSchema, WikiSourceCitationSchema, WikiOwnershipEntrySchema } from "./response-schemas-shared";

const SourceCredibilityProfileSchema = z
  .object({
    data_quality: SourceCredibilityDataQualitySchema,
    dimensions: z.record(z.string(), SourceCredibilityDimensionSchema),
    domain: z.string(),
    status: z.string(),
  })
  .passthrough();

const SourceDebugDataSchema = z
  .object({
    all_urls: z.array(z.string()).optional(),
    cached_articles: AnyArraySchema,
    debug_timestamp: z.string(),
    error: z.string().optional(),
    feed_metadata: z
      .object({
        description: z.string(),
        generator: z.string(),
        language: z.string(),
        link: z.string(),
        title: z.string(),
        updated: z.string(),
      })
      .passthrough(),
    feed_status: z
      .object({
        bozo: z.boolean(),
        bozo_exception: z.string(),
        entries_count: z.number(),
        http_status: SourceDebugHttpStatusSchema,
      })
      .passthrough(),
    image_analysis: z
      .object({
        entries_with_images: z.number(),
        image_sources: AnyArraySchema,
        total_entries: z.number(),
      })
      .passthrough(),
    parsed_entries: AnyArraySchema,
    rss_url: z.string(),
    source_config: AnyObjectSchema.nullable(),
    source_name: z.string(),
    source_statistics: z
      .object({
        article_count: z.number(),
        bias_rating: z.string(),
        category: z.string(),
        country: z.string(),
        error_message: z.string().nullable(),
        funding_type: z.string(),
        is_consolidated: z.boolean().optional(),
        last_checked: z.string(),
        name: z.string(),
        status: z.string(),
        sub_feeds: z.array(SourceDebugSubFeedSchema).optional(),
        url: SourceDebugUrlSchema,
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const SourceResearchValueSchema = z
  .object({
    label: OptionalStringSchema,
    notes: OptionalStringSchema,
    sources: z.array(z.string()).nullable().optional(),
    value: z.string(),
  })
  .passthrough();

const SourceReporterSummarySchema = z
  .object({ article_count: z.number(), name: z.string() })
  .passthrough();

const PolicyTransparencySummarySchema = z
  .object({
    available_signals: z.number(),
    checked_pages: z.number(),
    signals: z.array(PolicySignalSchema),
  })
  .passthrough();

const AdsTxtSummarySchema = z
  .object({
    authorized_sellers: z.number(),
    contact: z.array(z.string()),
    direct_sellers: z.number(),
    duplicate_records: z.number(),
    invalid_lines: z.number(),
    manager_domains: z.array(z.string()),
    owner_domains: z.array(z.string()),
    resellers: z.number(),
    url: z.string(),
  })
  .passthrough();

const SellersJsonSummarySchema = z
  .object({
    available_sellers_json: z.number(),
    checked_ad_systems: z.number(),
    checked_records: z.number(),
    manager_domain_matches: z.number(),
    matched_records: z.number(),
    missing_seller_ids: z.number(),
    owner_domain_matches: z.number(),
    systems: AnyArraySchema,
  })
  .passthrough();

const SourceResearchProfileSchema = z
  .object({
    ads_txt: AdsTxtSummarySchema.nullable().optional(),
    canonical_name: OptionalStringSchema,
    citations: z
      .array(SourceResearchCitationSchema)
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    dossier_sections: z
      .array(DossierSectionSchema)
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    fields: z.record(z.string(), z.array(SourceResearchValueSchema)),
    key_reporters: z.array(SourceReporterSummarySchema),
    match_explanation: OptionalStringSchema,
    match_status: z
      .enum(["matched", "ambiguous", "none"])
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    name: z.string(),
    overview: OptionalStringSchema,
    policy_transparency: PolicyTransparencySummarySchema.nullable().optional(),
    search_links: z
      .record(z.string(), z.string())
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    sellers_json: SellersJsonSummarySchema.nullable().optional(),
    website: OptionalStringSchema,
    wikidata_qid: OptionalStringSchema,
    wikidata_url: OptionalStringSchema,
    wikipedia_url: OptionalStringSchema,
  })
  .passthrough();

const SourceStatsSchema = z
  .object({
    article_count: z.number(),
    bias_rating: OptionalStringSchema,
    category: z.string(),
    country: z.string(),
    error_message: OptionalStringSchema,
    funding_type: OptionalStringSchema,
    last_checked: z.string(),
    name: z.string(),
    status: z.string(),
    url: z.string(),
  })
  .passthrough();

const SourceStatsListSchema = z
  .object({
    sources: z.array(SourceStatsSchema),
    total_sources: z.number(),
  })
  .passthrough();

const StartupMetricsWireSchema = z
  .object({
    completed_at: OptionalStringSchema,
    duration_seconds: z.number().nullable().optional(),
    events: z.array(StartupMetricEventSchema),
    notes: AnyObjectSchema,
    started_at: OptionalStringSchema,
  })
  .passthrough();

const StorageDriftReportSchema = z
  .object({
    dangling_in_chroma: z.array(z.string()),
    dangling_in_chroma_count: z.number(),
    database_missing_embeddings: z.number(),
    database_total_articles: z.number(),
    database_with_embeddings: z.number(),
    missing_in_chroma: AnyArraySchema,
    missing_in_chroma_count: z.number(),
    vector_total_documents: z.number(),
  })
  .passthrough();

const WikiIndexStatusSchema = z
  .object({
    by_status: z.record(z.string(), z.number()),
    by_type: z.record(z.string(), z.number()),
    total_entries: z.number(),
  })
  .passthrough();

const WikiIndexTriggerResponseSchema = z
  .object({ message: z.string(), status: z.string() })
  .passthrough();

const WikiReporterCardSchema = z
  .object({
    article_count: z.number(),
    id: z.number(),
    name: z.string(),
  })
  .passthrough();

const WikiReporterDossierSchema = z
  .object({
    article_count: z.number(),
    citations: AnyArraySchema,
    dossier_sections: AnyArraySchema,
    id: z.number(),
    name: z.string(),
    recent_articles: AnyArraySchema,
  })
  .passthrough();

const WikiAnalysisAxisSchema = z
  .object({
    axis_name: z.string(),
    citations: z.array(WikiAnalysisCitationSchema).optional(),
    confidence: z.string().optional(),
    empirical_basis: z.string().optional(),
    last_scored_at: z.string().optional(),
    prose_explanation: z.string().optional(),
    score: z.number(),
    scored_by: z.string().optional(),
  })
  .passthrough();

const WikiSourceReporterSchema = z
  .object({
    article_count: z.number(),
    id: z.number(),
    name: z.string(),
    political_leaning: z.string().optional(),
    topics: z.array(z.string()).optional(),
  })
  .passthrough();

const WikiSourceOrganizationSchema = z
  .object({
    annual_revenue: z.number().optional(),
    ein: z.string().optional(),
    factual_reporting: z.string().optional(),
    funding_sources: AnyArraySchema.optional(),
    funding_type: z.string().optional(),
    id: z.number(),
    major_advertisers: AnyArraySchema.optional(),
    media_bias_rating: z.string().optional(),
    name: z.string(),
    org_type: z.string().optional(),
    research_confidence: z.string().optional(),
    wikipedia_url: z.string().optional(),
  })
  .passthrough();

const WikiSourceProfileSchema = z
  .object({
    analysis_axes: z.array(WikiAnalysisAxisSchema),
    article_count: z.number(),
    citations: z.array(WikiSourceCitationSchema),
    dossier_sections: z.array(DossierSectionSchema),
    geographic_focus: z.array(z.string()),
    name: z.string(),
    organization: WikiSourceOrganizationSchema.nullable().optional(),
    ownership_chain: z.array(WikiOwnershipEntrySchema),
    reporters: z.array(WikiSourceReporterSchema),
    topic_focus: z.array(z.string()),
  })
  .passthrough();

const ReporterProfileSchema = z
  .object({
    cached: z.boolean(),
    name: z.string(),
  })
  .passthrough();

const OgImageResponseSchema = z
  .object({ image_url: z.string().nullable() })
  .passthrough();

const InlineDefineResponseSchema = z
  .object({
    definition: OptionalStringSchema,
    error: OptionalStringSchema,
    success: z.boolean(),
    term: z.string(),
  })
  .passthrough();

export {
  SourceCredibilityProfileSchema,
  SourceDebugDataSchema,
  SourceResearchProfileSchema,
  SourceStatsListSchema,
  StartupMetricsWireSchema,
  StorageDriftReportSchema,
  WikiIndexStatusSchema,
  WikiIndexTriggerResponseSchema,
  WikiReporterCardSchema,
  WikiReporterDossierSchema,
  WikiSourceProfileSchema,
  ReporterProfileSchema,
  OgImageResponseSchema,
  InlineDefineResponseSchema,
};
