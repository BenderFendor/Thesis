import { describe, expect, it } from "@jest/globals";
import { mapBackendArticles } from "@/lib/api";
import { getCountryIso } from "@/lib/globe-country";

describe("country mapping", () => {
  it("normalizes backend country names to ISO codes and preserves lens fields", () => {
    expect.hasAssertions();

    const [mapped] = mapBackendArticles([
      {
        country: "United Kingdom",
        description: "A look at China and the United States.",
        id: 1,
        mentioned_countries: ["China", "United States"],
        published_at: "2026-03-06T12:00:00Z",
        source: "BBC",
        source_country: "United Kingdom",
        title: "Trade brief",
        url: "https://example.com/story",
      },
    ]);

    expect(mapped).toStrictEqual(
      expect.objectContaining({
        country: "GB",
        mentioned_countries: ["CN", "US"],
        source_country: "GB",
      }),
    );
  });

  it("maps known globe fallback countries away from -99 ISO codes", () => {
    expect.hasAssertions();

    expect(getCountryIso({ properties: { ADM0_A3: "FRA", ISO_A2: "-99", NAME: "France" } })).toBe(
      "FR",
    );
    expect(getCountryIso({ properties: { ADM0_A3: "NOR", ISO_A2: "-99", NAME: "Norway" } })).toBe(
      "NO",
    );
    expect(getCountryIso({ properties: { ADM0_A3: "DEU", ISO_A2: "DE", NAME: "Germany" } })).toBe(
      "DE",
    );
    expect(
      getCountryIso({ properties: { ADM0_A3: "CYN", ISO_A2: "-99", NAME: "N. Cyprus" } }),
    ).toBeNull();
  });
});
