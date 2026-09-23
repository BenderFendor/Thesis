import { describe, expect, it } from "@jest/globals";
import { geoCentroid } from "d3-geo";
import { CountryCollectionSchema } from "@/components/interactive-globe-visuals-config";

describe("globe country geometry", () => {
  it("preserves polygon types and the feature type required for click centroids", () => {
    const ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
    const countries = CountryCollectionSchema.parse({
      features: [
        { geometry: { coordinates: [ring], type: "Polygon" }, properties: { ISO_A2: "US" }, type: "Feature" },
        { geometry: { coordinates: [[ring]], type: "MultiPolygon" }, properties: { ISO_A2: "GB" }, type: "Feature" },
      ],
    });
    expect(countries.features).toHaveLength(2);
    for (const feature of countries.features) {
      expect(["Polygon", "MultiPolygon"]).toContain(feature.geometry?.type);
      expect(feature.type).toBe("Feature");
      expect(geoCentroid(feature).every((coordinate) => Number.isFinite(coordinate))).toBe(true);
    }
    expect(countries.features.some((feature) => feature.geometry?.type === "MultiPolygon")).toBe(true);
  });
});
