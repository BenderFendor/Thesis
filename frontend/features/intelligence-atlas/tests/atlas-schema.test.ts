import { AtlasGraphResponseSchema, metricPercentage } from "../lib/atlas-schema";

describe("Atlas runtime graph schema", () => {
  it("accepts a bounded typed graph and rejects dangling shape errors", () => {
    const graph = AtlasGraphResponseSchema.parse({
      graph_version: "v1",
      generated_at: "2026-07-19T12:00:00Z",
      nodes: [
        {
          id: "source:abc",
          entity_type: "source",
          label: "Example",
          article_count: 0,
          connection_count: 1,
          ownership_connection_count: 1,
          flags: [],
        },
      ],
      edges: [],
      stats: {
        total_sources: 1,
        total_organizations: 0,
        total_reporters: 0,
        visible_sources: 1,
        visible_organizations: 0,
        visible_reporters: 0,
        visible_relationships: 0,
        current_relationships: 0,
        ownership_coverage: { numerator: 0, denominator: 1 },
        evidence_coverage: { numerator: 0, denominator: 0 },
        unresolved_source_links: 1,
      },
      applied_filters: {
        entity_types: ["source"],
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
    expect(graph.nodes[0]?.id).toBe("source:abc");
    expect(metricPercentage(graph.stats.ownership_coverage)).toBe(0);
  });

  it("normalizes UTC database datetimes that arrive without an offset", () => {
    const graph = AtlasGraphResponseSchema.parse({
      graph_version: "v2",
      generated_at: "2026-07-20T09:32:21.474610Z",
      nodes: [
        {
          id: "source:abc",
          entity_type: "source",
          label: "Example",
          updated_at: "2026-07-19T17:24:14.994289",
        },
      ],
      edges: [
        {
          id: "edge:1",
          source_id: "source:abc",
          target_id: "source:abc",
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
