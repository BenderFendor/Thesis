import {
  AtlasGraphResponseSchema,
  AtlasIndexResponseSchema,
  AtlasStatsResponseSchema,
  FundingBiasAnalysisResponseSchema,
  metricPercentage,
  parseFundingAndBias,
} from "../lib/atlas-schema";
import { describe, expect, it } from '@jest/globals';

const EXPECTED_CHI_SQUARE = 7.2,
  EXPECTED_CRAMERS_V = 0.6,
  EXPECTED_EIGHT = 8,
  EXPECTED_FOUR = 4,
  EXPECTED_ONE = 1,
  EXPECTED_TWENTY = 20,
  EXPECTED_TWO = 2,
  EXPECTED_ZERO = 0,
  FIXTURE_BOUNDED_GRAPH = {
    applied_filters: {
      bias: [],
      country: [],
      entity_types: ["outlet"],
      funding: [],
      include_evidence_preview: true,
      layout: "clustered",
      limit_edges: 1500,
      limit_nodes: 350,
      min_confidence: EXPECTED_ZERO,
      neighbors: EXPECTED_ZERO,
      relation_types: [],
    },
    edges: [],
    generated_at: "2026-07-19T12:00:00Z",
    graph_version: "v1",
    nodes: [
      {
        article_count: EXPECTED_ZERO,
        connection_count: EXPECTED_ONE,
        entity_type: "outlet",
        flags: [],
        id: "outlet:abc",
        label: "Example",
        ownership_connection_count: EXPECTED_ONE,
      },
    ],
    stats: {
      current_relationships: EXPECTED_ZERO,
      evidence_coverage: { denominator: EXPECTED_ZERO, numerator: EXPECTED_ZERO },
      ownership_coverage: { denominator: EXPECTED_ZERO, numerator: EXPECTED_ZERO },
      total_organizations: EXPECTED_ZERO,
      total_outlets: EXPECTED_ONE,
      total_people: EXPECTED_ZERO,
      total_reporters: EXPECTED_ZERO,
      unresolved_source_links: EXPECTED_ONE,
      visible_organizations: EXPECTED_ZERO,
      visible_outlets: EXPECTED_ONE,
      visible_people: EXPECTED_ZERO,
      visible_relationships: EXPECTED_ZERO,
      visible_reporters: EXPECTED_ZERO,
    },
    truncated: false,
  },
  FIXTURE_COMPUTED_FUNDING_BIAS = {
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
    population_size: EXPECTED_TWENTY,
    statistic: {
      chi_square: EXPECTED_CHI_SQUARE,
      cols: ["left", "right"],
      cramers_v: EXPECTED_CRAMERS_V,
      degrees_of_freedom: EXPECTED_ONE,
      interpretation: "strong association",
      "n": EXPECTED_TWENTY,
      rows: ["commercial", "state-funded"],
      table: [
        [EXPECTED_TWO, EXPECTED_EIGHT],
        [EXPECTED_EIGHT, EXPECTED_TWO],
      ],
    },
    trace_id: "calc_abc123",
    validation_card_skip_reason: "no gold set",
  },
  FIXTURE_DEFAULT_COVERAGE = {
    by_entity_type: {},
    by_index_status: {},
    by_relation_type: {},
    generated_at: "2026-07-22T12:00:00Z",
    graph_version: "v1",
    indexing_active: false,
    stats: {
      current_relationships: EXPECTED_ZERO,
      evidence_coverage: { denominator: EXPECTED_ZERO, numerator: EXPECTED_ZERO },
      ownership_coverage: { denominator: EXPECTED_ZERO, numerator: EXPECTED_ZERO },
      total_organizations: EXPECTED_ZERO,
      total_outlets: EXPECTED_ZERO,
      total_people: EXPECTED_ZERO,
      total_reporters: EXPECTED_ZERO,
      unresolved_source_links: EXPECTED_ZERO,
      visible_organizations: EXPECTED_ZERO,
      visible_outlets: EXPECTED_ZERO,
      visible_people: EXPECTED_ZERO,
      visible_relationships: EXPECTED_ZERO,
      visible_reporters: EXPECTED_ZERO,
    },
  },
  FIXTURE_INDEX_KIND = {
    facets: {
      bias: {},
      country: {},
      entity_type: { organization: EXPECTED_TWO },
      funding: {},
      kind: { "legal entity": EXPECTED_ONE, "organization without legal identity": EXPECTED_ONE },
    },
    items: [],
    total: EXPECTED_ZERO,
  },
  FIXTURE_RESEARCH_COVERAGE = {
    by_entity_type: { organization: EXPECTED_ONE, outlet: EXPECTED_TWO, person: EXPECTED_ONE },
    by_index_status: {},
    by_relation_type: { ownership: EXPECTED_ONE },
    generated_at: "2026-07-22T12:00:00Z",
    graph_version: "v1",
    indexing_active: false,
    research_coverage: { denominator: EXPECTED_FOUR, numerator: EXPECTED_TWO },
    research_coverage_by_entity_type: {
      organization: { denominator: EXPECTED_ONE, numerator: EXPECTED_ONE },
      outlet: { denominator: EXPECTED_TWO, numerator: EXPECTED_ONE },
      person: { denominator: EXPECTED_ONE, numerator: EXPECTED_ZERO },
    },
    stats: {
      current_relationships: EXPECTED_ONE,
      evidence_coverage: { denominator: EXPECTED_ONE, numerator: EXPECTED_ONE },
      ownership_coverage: { denominator: EXPECTED_TWO, numerator: EXPECTED_ONE },
      total_organizations: EXPECTED_ONE,
      total_outlets: EXPECTED_TWO,
      total_people: EXPECTED_ONE,
      total_reporters: EXPECTED_ZERO,
      unresolved_source_links: EXPECTED_ONE,
      visible_organizations: EXPECTED_ONE,
      visible_outlets: EXPECTED_TWO,
      visible_people: EXPECTED_ONE,
      visible_relationships: EXPECTED_ONE,
      visible_reporters: EXPECTED_ZERO,
    },
  },
  FIXTURE_UTC_GRAPH = {
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
      evidence_coverage: { denominator: EXPECTED_ONE, numerator: EXPECTED_ONE },
      ownership_coverage: { denominator: EXPECTED_ONE, numerator: EXPECTED_ZERO },
    },
    truncated: false,
  };

describe("atlas runtime graph schema", () => {
  it("accepts a bounded typed graph and rejects dangling shape errors", () => {
    expect.hasAssertions();
    const graph = AtlasGraphResponseSchema.parse(FIXTURE_BOUNDED_GRAPH);
    expect(graph.nodes[EXPECTED_ZERO]?.id).toBe("outlet:abc");
    expect(metricPercentage(graph.stats.ownership_coverage)).toBe(EXPECTED_ZERO);
  });

  it("normalizes UTC database datetimes that arrive without an offset", () => {
    expect.hasAssertions();
    const graph = AtlasGraphResponseSchema.parse(FIXTURE_UTC_GRAPH);
    expect(graph.nodes[EXPECTED_ZERO]?.updated_at).toBe("2026-07-19T17:24:14.994289Z");
    expect(graph.edges[EXPECTED_ZERO]?.evidence_preview[EXPECTED_ZERO]?.retrieved_at).toBe(
      "2026-04-17T20:24:39.422665Z",
    );
  });
});

describe("parseFundingAndBias", () => {
  it("returns undefined when the details bag has no funding_and_bias key", () => {  expect.hasAssertions();

    expect(parseFundingAndBias({})).toBeNull();
  });

  it("defensively parses a well-formed funding_and_bias block, defaulting missing arrays", () => {
    expect.hasAssertions();

    const result = parseFundingAndBias({
      funding_and_bias: {
        bias_rating: {
          asserted_by: "mbfc",
          claim_ids: ["claim-1"],
          evidence_count: 1,
          origin: "claim",
          value: "Left-Center",
        },
        factual_reporting: {},
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
  it("parses the empty-state response", () => {
    expect.hasAssertions();

    const parsed = FundingBiasAnalysisResponseSchema.parse({ available: false });
    expect(parsed.available).toBe(false);
    expect(parsed.methodology).toBeUndefined();
  });

  it("parses a computed response with a contingency table and statistic", () => {
    expect.hasAssertions();
    const parsed = FundingBiasAnalysisResponseSchema.parse(FIXTURE_COMPUTED_FUNDING_BIAS);
    expect(parsed.statistic?.cramers_v).toBe(EXPECTED_CRAMERS_V);
    expect(parsed.statistic?.table[EXPECTED_ZERO]).toStrictEqual([EXPECTED_TWO, EXPECTED_EIGHT]);
  });
});

describe("atlas stats research-coverage metric", () => {
  it("parses research_coverage and its per-entity-type breakdown", () => {
    expect.hasAssertions();
    const parsed = AtlasStatsResponseSchema.parse(FIXTURE_RESEARCH_COVERAGE);
    expect(parsed.research_coverage).toStrictEqual({ denominator: EXPECTED_FOUR, numerator: EXPECTED_TWO });
    expect(parsed.research_coverage_by_entity_type.organization).toStrictEqual({
      denominator: EXPECTED_ONE,
      numerator: EXPECTED_ONE,
    });
  });

  it("defaults research_coverage when the backend omits it", () => {
    expect.hasAssertions();
    const parsed = AtlasStatsResponseSchema.parse(FIXTURE_DEFAULT_COVERAGE);
    expect(parsed.research_coverage).toStrictEqual({ denominator: EXPECTED_ZERO, numerator: EXPECTED_ZERO });
    expect(parsed.research_coverage_by_entity_type).toStrictEqual({});
  });
});

describe("atlas index kind facet", () => {
  it("parses the kind facet alongside the existing country/funding/bias facets", () => {
    expect.hasAssertions();
    const parsed = AtlasIndexResponseSchema.parse(FIXTURE_INDEX_KIND);
    expect(parsed.facets.kind).toStrictEqual({ "legal entity": EXPECTED_ONE, "organization without legal identity": EXPECTED_ONE });
  });
});
