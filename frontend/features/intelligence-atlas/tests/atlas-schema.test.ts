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
});
