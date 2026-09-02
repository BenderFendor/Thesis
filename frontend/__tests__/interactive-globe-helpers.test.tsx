import { computePolygonHeatFast } from "@/components/interactive-globe";

const baseFeature = {
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  properties: { ADM0_A3: "USA", ISO_A2: "US", NAME: "United States" },
} as const;

const context = {
  displayCounts: { US: 2, CA: 3 },
  maxCount: 5,
  maxMentionCount: 5,
  mentionCounts: { US: 1, CA: 1 },
} as const;

describe("computePolygonHeatFast", () => {
  it("returns heat for a country with display counts", () => {
    const heat = computePolygonHeatFast(baseFeature as never, context);
    expect(heat).not.toBeNull();
    if (heat === null) {throw new Error("expected heat");}
    expect(heat.ratio).toBeGreaterThan(0);
  });

  it("returns zero heat when the country has no display count", () => {
    const heat = computePolygonHeatFast(baseFeature as never, { ...context, displayCounts: { CA: 1 }, mentionCounts: { CA: 1 }, maxCount: 1, maxMentionCount: 1 });
    expect(heat).not.toBeNull();
    if (heat === null) {throw new Error("expected heat");}
    expect(heat.ratio).toBe(0);
    expect(heat.sourceCount).toBe(0);
  });

  it("scales heat by the max count", () => {
    const partial = computePolygonHeatFast(baseFeature as never, context);
    const covered = computePolygonHeatFast(baseFeature as never, { ...context, displayCounts: { US: 5 }, maxCount: 5 });
    if (partial === null || covered === null) {throw new Error("expected heat");}
    expect(partial.ratio).toBeGreaterThan(0);
    expect(partial.ratio).toBeLessThan(covered.ratio);
  });

  it("handles an empty context without throwing", () => {
    const empty = { displayCounts: {}, maxCount: 0, maxMentionCount: 0, mentionCounts: {} };
    const heat = computePolygonHeatFast(baseFeature as never, empty);
    expect(heat).not.toBeNull();
    if (heat === null) {throw new Error("expected heat");}
    expect(heat.ratio).toBe(0);
  });
});
