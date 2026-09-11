import { describe, expect, it } from "@jest/globals";
import { computePolygonHeatFast } from "@/components/interactive-globe";

const baseFeature = {
  geometry: {
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
    type: "Polygon",
  },
  properties: { ADM0_A3: "USA", ISO_A2: "US", NAME: "United States" },
} as const;

const context = {
  displayCounts: { CA: 3, US: 2 },
  maxCount: 5,
  maxMentionCount: 5,
  mentionCounts: { CA: 1, US: 1 },
} as const;

type HeatResult = NonNullable<ReturnType<typeof computePolygonHeatFast>>;

const getHeatRatio = (heat: Readonly<HeatResult> | null): number => heat?.ratio ?? 0;

describe("computePolygonHeatFast", () => {
  it("returns heat for a country with display counts", () => {
    expect.hasAssertions();

    const heat = computePolygonHeatFast(baseFeature, context);
    expect(heat).not.toBeNull();
    expect(heat?.ratio).toBeGreaterThan(0);
  });

  it("returns zero heat when the country has no display count", () => {
    expect.hasAssertions();

    const heat = computePolygonHeatFast(baseFeature, {
      ...context,
      displayCounts: { CA: 1 },
      maxCount: 1,
      maxMentionCount: 1,
      mentionCounts: { CA: 1 },
    });
    expect(heat).not.toBeNull();
    expect(heat?.ratio).toBe(0);
    expect(heat?.sourceCount).toBe(0);
  });

  it("scales heat by the max count", () => {
    expect.hasAssertions();

    const partial = computePolygonHeatFast(baseFeature, context);
    const covered = computePolygonHeatFast(baseFeature, {
      ...context,
      displayCounts: { US: 5 },
      maxCount: 5,
    });
    expect(partial).not.toBeNull();
    expect(covered).not.toBeNull();
    expect(partial?.ratio).toBeGreaterThan(0);
    expect(getHeatRatio(covered)).toBeGreaterThan(getHeatRatio(partial));
  });

  it("handles an empty context without throwing", () => {
    expect.hasAssertions();

    const empty = { displayCounts: {}, maxCount: 0, maxMentionCount: 0, mentionCounts: {} };
    const heat = computePolygonHeatFast(baseFeature, empty);
    expect(heat).not.toBeNull();
    expect(heat?.ratio).toBe(0);
  });
});
