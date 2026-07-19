import {
  DEFAULT_ATLAS_QUERY_STATE,
  parseAtlasQueryState,
  serializeAtlasQueryState,
  type AtlasQueryState,
} from "../lib/atlas-query-state";

describe("Atlas query state", () => {
  it("round-trips shareable investigation state", () => {
    const state: AtlasQueryState = {
      ...DEFAULT_ATLAS_QUERY_STATE,
      q: "Reuters",
      entities: ["source", "organization", "reporter"],
      relations: ["ownership", "employed_by"],
      country: ["GB", "US"],
      funding: ["commercial"],
      minConfidence: 0.65,
      selected: "source:abc",
      neighbors: 2,
      focus: true,
      layout: "radial",
      panel: "inspector",
    };

    const parsed = parseAtlasQueryState(serializeAtlasQueryState(state));
    expect(parsed).toEqual(state);
  });

  it("falls back safely for malformed values", () => {
    const parsed = parseAtlasQueryState(
      new URLSearchParams("entities=bad&relations=wrong&neighbors=99&layout=nope&min_confidence=8"),
    );
    expect(parsed.entities).toEqual(DEFAULT_ATLAS_QUERY_STATE.entities);
    expect(parsed.relations).toEqual(DEFAULT_ATLAS_QUERY_STATE.relations);
    expect(parsed.neighbors).toBe(2);
    expect(parsed.layout).toBe("clustered");
    expect(parsed.minConfidence).toBe(1);
  });
});
