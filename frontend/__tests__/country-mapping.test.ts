import { mapBackendArticles } from "@/lib/api"

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
})
