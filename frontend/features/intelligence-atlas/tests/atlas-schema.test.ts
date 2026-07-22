import {
  AtlasGraphResponseSchema,
  FundingBiasAnalysisResponseSchema,
  metricPercentage,
  parseFundingAndBias,
} from "../lib/atlas-schema";

describe("Atlas runtime graph schema", () => {
  it("accepts a bounded typed graph and rejects dangling shape errors", () => {
    const graph = AtlasGraphResponseSchema.parse({
      graph_version: "v1",
      generated_at: "2026-07-19T12:00:00Z",
      nodes: [
        {
          id: "outlet:abc",
          entity_type: "outlet",
          label: "Example",
          article_count: 0,
          connection_count: 1,
          ownership_connection_count: 1,
          flags: [],
        },
      ],
      edges: [],
      stats: {
        total_outlets: 1,
        total_organizations: 0,
        total_people: 0,
        total_reporters: 0,
        visible_outlets: 1,
        visible_organizations: 0,
        visible_people: 0,
        visible_reporters: 0,
        visible_relationships: 0,
        current_relationships: 0,
        ownership_coverage: { numerator: 0, denominator: 1 },
        evidence_coverage: { numerator: 0, denominator: 0 },
        unresolved_source_links: 1,
      },
      applied_filters: {
        entity_types: ["outlet"],
        relation_types: [],
        country: [],
        funding: [],
        bias: [],
        min_confidence: 0,
        neighbors: 0,
        layout: "clustered",
        limit_nodes: 350,
        limit_edges: 1500,
        include_evidence_preview: true,
      },
      truncated: false,
    });
    expect(graph.nodes[0]?.id).toBe("outlet:abc");
    expect(metricPercentage(graph.stats.ownership_coverage)).toBe(0);
  });

  it("normalizes UTC database datetimes that arrive without an offset", () => {
    const graph = AtlasGraphResponseSchema.parse({
      graph_version: "v2",
      generated_at: "2026-07-20T09:32:21.474610Z",
      nodes: [
        {
          id: "outlet:abc",
          entity_type: "outlet",
          label: "Example",
          updated_at: "2026-07-19T17:24:14.994289",
        },
      ],
      edges: [
        {
          id: "edge:1",
          source_id: "outlet:abc",
          target_id: "outlet:abc",
          relation_type: "shared_outlet",
          evidence_preview: [
            {
              id: "evidence:1",
              source_type: "article_byline",
              retrieved_at: "2026-04-17T20:24:39.422665",
            },
          ],
          valid_from: "2026-04-17T20:24:39.422665",
          last_verified_at: "2026-04-17T20:24:39.422665",
        },
      ],
      stats: {
        ownership_coverage: { numerator: 0, denominator: 1 },
        evidence_coverage: { numerator: 1, denominator: 1 },
      },
      applied_filters: {},
      truncated: false,
    });

    expect(graph.nodes[0]?.updated_at).toBe("2026-07-19T17:24:14.994289Z");
    expect(graph.edges[0]?.evidence_preview[0]?.retrieved_at).toBe(
      "2026-04-17T20:24:39.422665Z",
    );
  });
});

describe("parseFundingAndBias", () => {
  it("returns null when the details bag has no funding_and_bias key", () => {
    expect(parseFundingAndBias({})).toBeNull();
  });

  it("defensively parses a well-formed funding_and_bias block, defaulting missing arrays", () => {
    const result = parseFundingAndBias({
      funding_and_bias: {
        funding_type: { value: "commercial", origin: "legacy" },
        bias_rating: {
          value: "Left-Center",
          origin: "claim",
          asserted_by: "mbfc",
          claim_ids: ["claim-1"],
          evidence_count: 1,
        },
        factual_reporting: { value: null, origin: null },
      },
    });
    expect(result).not.toBeNull();
    expect(result?.funding_type.value).toBe("commercial");
    expect(result?.funding_type.claim_ids).toEqual([]);
    expect(result?.bias_rating.origin).toBe("claim");
    expect(result?.bias_rating.evidence).toEqual([]);
  });

  it("returns null when a required field is missing from the block", () => {
    expect(parseFundingAndBias({ funding_and_bias: { funding_type: {} } })).toBeNull();
  });
});

describe("FundingBiasAnalysisResponseSchema", () => {
  it("parses the empty-state response", () => {
    const parsed = FundingBiasAnalysisResponseSchema.parse({ available: false });
    expect(parsed.available).toBe(false);
    expect(parsed.methodology ?? null).toBeNull();
  });

  it("parses a computed response with a contingency table and statistic", () => {
    const parsed = FundingBiasAnalysisResponseSchema.parse({
      available: true,
      methodology: {
        preregistration_id: "prereg_funding_bias_methodology_v1",
        title: "Catalog funding-type vs. MBFC bias-rating association",
        locked_at: "2026-07-20T00:00:00Z",
        specification: { population: "...", limitations: ["a", "b"] },
        deviations: [],
      },
      statistic: {
        n: 20,
        rows: ["commercial", "state-funded"],
        cols: ["left", "right"],
        table: [
          [2, 8],
          [8, 2],
        ],
        chi_square: 7.2,
        degrees_of_freedom: 1,
        cramers_v: 0.6,
        interpretation: "strong association",
        note: null,
      },
      trace_id: "calc_abc123",
      algorithm_version: "funding_bias_analysis/1.0",
      computed_at: "2026-07-20T00:00:00Z",
      population_size: 20,
      validation_card_skip_reason: "no gold set",
    });
    expect(parsed.statistic?.cramers_v).toBe(0.6);
    expect(parsed.statistic?.table[0]).toEqual([2, 8]);
  });
});
