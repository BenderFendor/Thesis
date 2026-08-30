import { describe, expect, it } from '@jest/globals';
import {
  AtlasGraphResponseSchema,
  AtlasIndexResponseSchema,
  AtlasStatsResponseSchema,
  FundingBiasAnalysisResponseSchema,
  metricPercentage,
  parseFundingAndBias,
} from "../lib/atlas-schema";

describe("atlas runtime graph schema", () => {
  it("accepts a bounded typed graph and rejects dangling shape errors", () => {  expect.hasAssertions();
  
    const graph = AtlasGraphResponseSchema.parse({
      applied_filters: {
        bias: [],
        country: [],
        entity_types: ["outlet"],
        funding: [],
        include_evidence_preview: true,
        layout: "clustered",
        limit_edges: 1500,
        limit_nodes: 350,
        min_confidence: 0,
        neighbors: 0,
        relation_types: [],
      },
      edges: [],
      generated_at: "2026-07-19T12:00:00Z",
      graph_version: "v1",
      nodes: [
        {
          article_count: 0,
          connection_count: 1,
          entity_type: "outlet",
          flags: [],
          id: "outlet:abc",
          label: "Example",
          ownership_connection_count: 1,
        },
      ],
      stats: {
        current_relationships: 0,
        evidence_coverage: { denominator: 0, numerator: 0 },
        ownership_coverage: { denominator: 1, numerator: 0 },
        total_organizations: 0,
        total_outlets: 1,
        total_people: 0,
        total_reporters: 0,
        unresolved_source_links: 1,
        visible_organizations: 0,
        visible_outlets: 1,
        visible_people: 0,
        visible_relationships: 0,
        visible_reporters: 0,
      },
      truncated: false,
    });
    expect(graph.nodes[0]?.id).toBe("outlet:abc");
    expect(metricPercentage(graph.stats.ownership_coverage)).toBe(0);
  });

  it("normalizes UTC database datetimes that arrive without an offset", () => {  expect.hasAssertions();
  
    const graph = AtlasGraphResponseSchema.parse({
      applied_filters: {},
      edges: [
        {
          display_group: "newsroom_people",
          evidence_preview: [
            {
              id: "evidence:1",
              retrieved_at: "2026-04-17T20:24:39.422665",
              source_type: "article_byline",
            },
          ],
          id: "edge:1",
          last_verified_at: "2026-04-17T20:24:39.422665",
          predicate: "shared_outlet",
          relation_type: "shared_outlet",
          source_id: "outlet:abc",
          target_id: "outlet:abc",
          valid_from: "2026-04-17T20:24:39.422665",
        },
      ],
      generated_at: "2026-07-20T09:32:21.474610Z",
      graph_version: "v2",
      nodes: [
        {
          entity_type: "outlet",
          id: "outlet:abc",
          label: "Example",
          updated_at: "2026-07-19T17:24:14.994289",
        },
      ],
      stats: {
        evidence_coverage: { denominator: 1, numerator: 1 },
        ownership_coverage: { denominator: 1, numerator: 0 },
      },
      truncated: false,
    });

    expect(graph.nodes[0]?.updated_at).toBe("2026-07-19T17:24:14.994289Z");
    expect(graph.edges[0]?.evidence_preview[0]?.retrieved_at).toBe(
      "2026-04-17T20:24:39.422665Z",
    );
  });
});

describe("parseFundingAndBias", () => {
  it("returns undefined when the details bag has no funding_and_bias key", () => {  expect.hasAssertions();
  
    expect(parseFundingAndBias({})).toBeNull();
  });

  it("defensively parses a well-formed funding_and_bias block, defaulting missing arrays", () => {  expect.hasAssertions();
  
    const result = parseFundingAndBias({
      funding_and_bias: {
        bias_rating: {
          asserted_by: "mbfc",
          claim_ids: ["claim-1"],
          evidence_count: 1,
          origin: "claim",
          value: "Left-Center",
        },
        factual_reporting: { origin: null, value: null },
        funding_type: { origin: "legacy", value: "commercial" },
      },
    });
    expect(result).not.toBeNull();
    expect(result?.funding_type.value).toBe("commercial");
    expect(result?.funding_type.claim_ids).toStrictEqual([]);
    expect(result?.bias_rating.origin).toBe("claim");
    expect(result?.bias_rating.evidence).toStrictEqual([]);
  });

  it("returns undefined when a required field is missing from the block", () => {  expect.hasAssertions();
  
    expect(parseFundingAndBias({ funding_and_bias: { funding_type: {} } })).toBeNull();
  });
});

describe("fundingBiasAnalysisResponseSchema", () => {
  it("parses the empty-state response", () => {  expect.hasAssertions();
  
    const parsed = FundingBiasAnalysisResponseSchema.parse({ available: false });
    expect(parsed.available).toBe(false);
    expect(parsed.methodology ?? null).toBeNull();
  });

  it("parses a computed response with a contingency table and statistic", () => {  expect.hasAssertions();
  
    const parsed = FundingBiasAnalysisResponseSchema.parse({
      algorithm_version: "funding_bias_analysis/1.0",
      available: true,
      computed_at: "2026-07-20T00:00:00Z",
      methodology: {
        deviations: [],
        locked_at: "2026-07-20T00:00:00Z",
        preregistration_id: "prereg_funding_bias_methodology_v1",
        specification: { limitations: ["a", "b"], population: "..." },
        title: "Catalog funding-type vs. MBFC bias-rating association",
      },
      population_size: 20,
      statistic: {
        chi_square: 7.2,
        cols: ["left", "right"],
        cramers_v: 0.6,
        degrees_of_freedom: 1,
        interpretation: "strong association",
        n: 20,
        note: null,
        rows: ["commercial", "state-funded"],
        table: [
          [2, 8],
          [8, 2],
        ],
      },
      trace_id: "calc_abc123",
      validation_card_skip_reason: "no gold set",
    });
    expect(parsed.statistic?.cramers_v).toBe(0.6);
    expect(parsed.statistic?.table[0]).toStrictEqual([2, 8]);
  });
});

describe("atlas stats research-coverage metric", () => {
  it("parses research_coverage and its per-entity-type breakdown", () => {  expect.hasAssertions();
  
    const parsed = AtlasStatsResponseSchema.parse({
      by_entity_type: { organization: 1, outlet: 2, person: 1 },
      by_index_status: {},
      by_relation_type: { ownership: 1 },
      generated_at: "2026-07-22T12:00:00Z",
      graph_version: "v1",
      indexing_active: false,
      last_indexed_at: null,
      research_coverage: { denominator: 4, numerator: 2 },
      research_coverage_by_entity_type: {
        organization: { denominator: 1, numerator: 1 },
        outlet: { denominator: 2, numerator: 1 },
        person: { denominator: 1, numerator: 0 },
      },
      stats: {
        current_relationships: 1,
        evidence_coverage: { denominator: 1, numerator: 1 },
        ownership_coverage: { denominator: 2, numerator: 1 },
        total_organizations: 1,
        total_outlets: 2,
        total_people: 1,
        total_reporters: 0,
        unresolved_source_links: 1,
        visible_organizations: 1,
        visible_outlets: 2,
        visible_people: 1,
        visible_relationships: 1,
        visible_reporters: 0,
      },
    });
    expect(parsed.research_coverage).toStrictEqual({ denominator: 4, numerator: 2 });
    expect(parsed.research_coverage_by_entity_type.organization).toStrictEqual({ denominator: 1, numerator: 1 });
  });

  it("defaults research_coverage when the backend omits it", () => {  expect.hasAssertions();
  
    const parsed = AtlasStatsResponseSchema.parse({
      by_entity_type: {},
      by_index_status: {},
      by_relation_type: {},
      generated_at: "2026-07-22T12:00:00Z",
      graph_version: "v1",
      indexing_active: false,
      last_indexed_at: null,
      stats: {
        current_relationships: 0,
        evidence_coverage: { denominator: 0, numerator: 0 },
        ownership_coverage: { denominator: 0, numerator: 0 },
        total_organizations: 0,
        total_outlets: 0,
        total_people: 0,
        total_reporters: 0,
        unresolved_source_links: 0,
        visible_organizations: 0,
        visible_outlets: 0,
        visible_people: 0,
        visible_relationships: 0,
        visible_reporters: 0,
      },
    });
    expect(parsed.research_coverage).toStrictEqual({ denominator: 0, numerator: 0 });
    expect(parsed.research_coverage_by_entity_type).toStrictEqual({});
  });
});

describe("atlas index kind facet", () => {
  it("parses the kind facet alongside the existing country/funding/bias facets", () => {  expect.hasAssertions();
  
    const parsed = AtlasIndexResponseSchema.parse({
      facets: {
        bias: {},
        country: {},
        entity_type: { organization: 2 },
        funding: {},
        kind: { "legal entity": 1, "organization without legal identity": 1 },
      },
      items: [],
      total: 0,
    });
    expect(parsed.facets.kind).toStrictEqual({ "legal entity": 1, "organization without legal identity": 1 });
  });
});
