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
      entities: ["outlet", "organization", "person", "reporter"],
      relations: ["ownership", "employed_by"],
      country: ["GB", "US"],
      funding: ["commercial"],
      minConfidence: 0.65,
      selected: "outlet:abc",
      neighbors: 2,
      focus: true,
      layout: "radial",
      panel: "inspector",
      view: "graph",
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

  it("defaults to the directory view when no state is present", () => {
    const parsed = parseAtlasQueryState(new URLSearchParams(""));
    expect(parsed.view).toBe("directory");
  });

  it("infers the graph view for legacy selected-entity deep-links with no view param", () => {
    const parsed = parseAtlasQueryState(new URLSearchParams("selected=outlet:abc"));
    expect(parsed.view).toBe("graph");
  });

  it("does not crash on an unknown legacy view value", () => {
    const parsed = parseAtlasQueryState(new URLSearchParams("view=canvas"));
    expect(parsed.view).toBe("directory");
  });

  it("normalizes the legacy 'source' entity type and id prefix on read", () => {
    const parsed = parseAtlasQueryState(
      new URLSearchParams("entities=source,organization&selected=source:abc"),
    );
    expect(parsed.entities).toEqual(["outlet", "organization"]);
    expect(parsed.selected).toBe("outlet:abc");
  });

  it("keeps a selected entity while explicitly closing the inspector", () => {
    const state: AtlasQueryState = {
      ...DEFAULT_ATLAS_QUERY_STATE,
      selected: "organization:1",
      neighbors: 1,
      panel: "none",
    };

    const serialized = serializeAtlasQueryState(state);
    expect(serialized.get("selected")).toBe("organization:1");
    expect(serialized.get("panel")).toBe("none");
    expect(parseAtlasQueryState(serialized)).toEqual(state);
  });
});
