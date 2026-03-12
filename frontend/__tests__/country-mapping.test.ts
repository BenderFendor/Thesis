import { mapBackendArticles } from "@/lib/api"

const globeCountryModulePath = "@/lib/globe-country"

describe("country mapping", () => {
  it("normalizes backend country names to ISO codes and preserves lens fields", () => {
    const [mapped] = mapBackendArticles([
      {
        id: 1,
        title: "Trade brief",
        source: "BBC",
        country: "United Kingdom",
        source_country: "United Kingdom",
        mentioned_countries: ["China", "United States"],
        description: "A look at China and the United States.",
        published_at: "2026-03-06T12:00:00Z",
        url: "https://example.com/story",
      },
    ])

    expect(mapped.country).toBe("GB")
    expect(mapped.source_country).toBe("GB")
    expect(mapped.mentioned_countries).toEqual(["CN", "US"])
  })

  it("maps known globe fallback countries away from -99 ISO codes", async () => {
    const { getCountryIso } = await import(globeCountryModulePath)

    expect(
      getCountryIso({ properties: { ISO_A2: "-99", ADM0_A3: "FRA", NAME: "France" } }),
    ).toBe("FR")
    expect(
      getCountryIso({ properties: { ISO_A2: "-99", ADM0_A3: "NOR", NAME: "Norway" } }),
    ).toBe("NO")
    expect(
      getCountryIso({ properties: { ISO_A2: "DE", ADM0_A3: "DEU", NAME: "Germany" } }),
    ).toBe("DE")
    expect(
      getCountryIso({ properties: { ISO_A2: "-99", ADM0_A3: "CYN", NAME: "N. Cyprus" } }),
    ).toBeNull()
  })
})
