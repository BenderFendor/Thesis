import { describe, expect, it } from '@jest/globals';
import { DEFAULT_ATLAS_QUERY_STATE, parseAtlasQueryState, serializeAtlasQueryState } from '../lib/atlas-query-state';
import type { AtlasQueryState } from '../lib/atlas-query-state';

describe("atlas query state", () => {
  it("round-trips shareable investigation state", () => {  expect.hasAssertions();
  
    const state: AtlasQueryState = {
      ...DEFAULT_ATLAS_QUERY_STATE,
      country: ["GB", "US"],
      entities: ["outlet", "organization", "person", "reporter"],
      focus: true,
      funding: ["commercial"],
      layout: "radial",
      minConfidence: 0.65,
      neighbors: 2,
      panel: "inspector",
      q: "Reuters",
      relations: ["ownership", "employed_by"],
      selected: "outlet:abc",
      view: "graph",
    },

     parsed = parseAtlasQueryState(serializeAtlasQueryState(state));
    expect(parsed).toStrictEqual(state);
  });

  it("falls back safely for malformed values", () => {  expect.hasAssertions();
  
    const parsed = parseAtlasQueryState(
      new URLSearchParams("entities=bad&relations=wrong&neighbors=99&layout=nope&min_confidence=8"),
    );
    expect(parsed.entities).toStrictEqual(DEFAULT_ATLAS_QUERY_STATE.entities);
    expect(parsed.relations).toStrictEqual(DEFAULT_ATLAS_QUERY_STATE.relations);
    expect(parsed.neighbors).toBe(2);
    expect(parsed.layout).toBe("clustered");
    expect(parsed.minConfidence).toBe(1);
  });

  it("defaults to the directory view when no state is present", () => {  expect.hasAssertions();
  
    const parsed = parseAtlasQueryState(new URLSearchParams(""));
    expect(parsed.view).toBe("directory");
  });

  it("infers the graph view for legacy selected-entity deep-links with no view param", () => {  expect.hasAssertions();
  
    const parsed = parseAtlasQueryState(new URLSearchParams("selected=outlet:abc"));
    expect(parsed.view).toBe("graph");
  });

  it("does not crash on an unknown legacy view value", () => {  expect.hasAssertions();
  
    const parsed = parseAtlasQueryState(new URLSearchParams("view=canvas"));
    expect(parsed.view).toBe("directory");
  });

  it("normalizes the legacy 'source' entity type and id prefix on read", () => {  expect.hasAssertions();
  
    const parsed = parseAtlasQueryState(
      new URLSearchParams("entities=source,organization&selected=source:abc"),
    );
    expect(parsed.entities).toStrictEqual(["outlet", "organization"]);
    expect(parsed.selected).toBe("outlet:abc");
  });

  it("keeps a selected entity while explicitly closing the inspector", () => {  expect.hasAssertions();
  
    const state: AtlasQueryState = {
      ...DEFAULT_ATLAS_QUERY_STATE,
      neighbors: 1,
      panel: "none",
      selected: "organization:1",
    },

     serialized = serializeAtlasQueryState(state);
    expect(serialized.get("selected")).toBe("organization:1");
    expect(serialized.get("panel")).toBe("none");
    expect(parseAtlasQueryState(serialized)).toStrictEqual(state);
  });
});
