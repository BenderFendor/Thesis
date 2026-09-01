import { DEFAULT_ATLAS_QUERY_STATE, parseAtlasQueryState, serializeAtlasQueryState } from '../lib/atlas-query-state';
import { describe, expect, it } from '@jest/globals';
import { AtlasGraphFiltersSchema } from '../lib/atlas-schema';
import type { AtlasQueryState } from '../lib/atlas-query-state';
import { atlasGraphQueryString } from '../lib/atlas-api';

const CLOSED_INSPECTOR_NEIGHBORS = 1,
 EXPECTED_MIN_CONFIDENCE = 1,
 EXPECTED_NEIGHBORS = 2;

describe("atlas query state parsing", () => {
  it("round-trips shareable investigation state", () => {
    expect.hasAssertions();
    const state: AtlasQueryState = {
      ...DEFAULT_ATLAS_QUERY_STATE,
      country: ["GB", "US"],
      entities: ["outlet", "organization", "person", "reporter"],
      focus: true,
      funding: ["commercial"],
      layout: "radial",
      minConfidence: 0.65,
      neighbors: EXPECTED_NEIGHBORS,
      panel: "inspector",
      // oxlint-disable-next-line id-length -- The URL state contract uses q.
      q: "Reuters",
      relations: ["ownership", "employed_by"],
      selected: "outlet:abc",
      view: "graph",
    };
    expect(parseAtlasQueryState(serializeAtlasQueryState(state))).toStrictEqual(state);
  });

  it("falls back safely for malformed values", () => {
    expect.hasAssertions();
    const parsed = parseAtlasQueryState(
      new URLSearchParams("entities=bad&relations=wrong&neighbors=99&layout=nope&min_confidence=8"),
    );
    expect(parsed.entities).toStrictEqual(DEFAULT_ATLAS_QUERY_STATE.entities);
    expect(parsed.relations).toStrictEqual(DEFAULT_ATLAS_QUERY_STATE.relations);
    expect(parsed.neighbors).toBe(EXPECTED_NEIGHBORS);
    expect(parsed.layout).toBe("clustered");
    expect(parsed.minConfidence).toBe(EXPECTED_MIN_CONFIDENCE);
  });

  it("defaults to the directory view when no state is present", () => {
    expect.hasAssertions();
    const parsed = parseAtlasQueryState(new URLSearchParams(""));
    expect(parsed.view).toBe("directory");
  });

  it("infers the graph view for legacy selected-entity deep-links with no view param", () => {
    expect.hasAssertions();
    const parsed = parseAtlasQueryState(new URLSearchParams("selected=outlet:abc"));
    expect(parsed.view).toBe("graph");
  });

  it("does not crash on an unknown legacy view value", () => {
    expect.hasAssertions();
    const parsed = parseAtlasQueryState(new URLSearchParams("view=canvas"));
    expect(parsed.view).toBe("directory");
  });
});

describe("atlas query state legacy normalization", () => {
  it("normalizes the legacy 'source' entity type and id prefix on read", () => {
    expect.hasAssertions();
    const parsed = parseAtlasQueryState(
      new URLSearchParams("entities=source,organization&selected=source:abc"),
    );
    expect(parsed.entities).toStrictEqual(["outlet", "organization"]);
    expect(parsed.selected).toBe("outlet:abc");
  });
});

describe("atlas query state serialization", () => {
  it("preserves the backend comma-delimited list query contract", () => {  expect.hasAssertions();
    const filters = AtlasGraphFiltersSchema.parse({
      bias: ["independent"],
      country: ["GB", "US"],
      entity_types: ["outlet", "organization"],
      funding: ["commercial"],
      relation_types: ["ownership", "employed_by"],
    }),
     query = new URLSearchParams(atlasGraphQueryString(filters));
    expect(query.get("entity_types")).toBe("outlet,organization");
    expect(query.get("relation_types")).toBe("ownership,employed_by");
    expect(query.get("country")).toBe("GB,US");
  });

  it("keeps a selected entity while explicitly closing the inspector", () => {
    expect.hasAssertions();
    const state: AtlasQueryState = {
      ...DEFAULT_ATLAS_QUERY_STATE,
      neighbors: CLOSED_INSPECTOR_NEIGHBORS,
      panel: "none",
      selected: "organization:1",
    };
    expect(serializeAtlasQueryState(state).get("selected")).toBe("organization:1");
    expect(serializeAtlasQueryState(state).get("panel")).toBe("none");
    expect(parseAtlasQueryState(serializeAtlasQueryState(state))).toStrictEqual(state);
  });
});
