import fc from "fast-check"
import type { NewsArticle } from "@/lib/api"
import {
  buildCountryListFromArticles,
  buildCountryMetricsFromArticles,
  buildLocalLensFromArticles,
} from "@/lib/globe-live-data"

function makeArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Article",
    source: overrides.source ?? "Source",
    sourceId: overrides.sourceId ?? "source",
    country: overrides.country ?? "US",
    credibility: overrides.credibility ?? "high",
    bias: overrides.bias ?? "center",
    summary: overrides.summary ?? "Summary",
    image: overrides.image ?? "/placeholder.svg",
    publishedAt: overrides.publishedAt ?? "2026-04-09T00:00:00.000Z",
    _parsedTimestamp: overrides._parsedTimestamp ?? Date.parse(overrides.publishedAt ?? "2026-04-09T00:00:00.000Z"),
    category: overrides.category ?? "general",
    url: overrides.url ?? `https://example.com/${overrides.id ?? 1}`,
    tags: overrides.tags ?? [],
    originalLanguage: overrides.originalLanguage ?? "en",
    translated: overrides.translated ?? false,
    source_country: overrides.source_country,
    mentioned_countries: overrides.mentioned_countries,
  }
}

describe("globe live data", () => {
  it("preserves article totals in derived country metrics", () => {
    const articleArbitrary = fc.record({
      id: fc.integer({ min: 1, max: 10_000 }),
      sourceId: fc.stringMatching(/^[a-z]{1,8}$/),
      source: fc.stringMatching(/^[A-Z][a-z]{1,8}$/),
      country: fc.constantFrom("US", "GB", "DE", "International"),
      source_country: fc.option(fc.constantFrom("US", "GB", "DE"), { nil: undefined }),
      mentioned_countries: fc.array(fc.constantFrom("US", "GB", "DE"), { maxLength: 4 }),
    })

    fc.assert(
      fc.property(fc.array(articleArbitrary, { maxLength: 25 }), (rawArticles) => {
        const articles = rawArticles.map((article, index) =>
          makeArticle({
            ...article,
            id: article.id + index,
            publishedAt: `2026-04-09T00:00:${String(index).padStart(2, "0")}.000Z`,
            _parsedTimestamp: Date.parse(`2026-04-09T00:00:${String(index).padStart(2, "0")}.000Z`),
            url: `https://example.com/${article.id}-${index}`,
          }),
        )

        const metrics = buildCountryMetricsFromArticles(articles)
        expect(metrics.total_articles).toBe(articles.length)
        expect(metrics.articles_with_country + metrics.articles_without_country).toBe(
          articles.length,
        )
      }),
    )
  })

  it("builds country metadata and local lens views from the shared live dataset", () => {
    const articles = [
      makeArticle({
        id: 1,
        source: "Tokyo Times",
        sourceId: "tokyo-times",
        country: "JP",
        source_country: "JP",
        mentioned_countries: ["JP"],
        publishedAt: "2026-04-09T02:00:00.000Z",
        _parsedTimestamp: Date.parse("2026-04-09T02:00:00.000Z"),
      }),
      makeArticle({
        id: 2,
        source: "World Wire",
        sourceId: "world-wire",
        country: "US",
        source_country: "US",
        mentioned_countries: ["JP"],
        publishedAt: "2026-04-09T03:00:00.000Z",
        _parsedTimestamp: Date.parse("2026-04-09T03:00:00.000Z"),
      }),
      makeArticle({
        id: 3,
        source: "Kyoto Daily",
        sourceId: "kyoto-daily",
        country: "JP",
        source_country: "JP",
        mentioned_countries: [],
        publishedAt: "2026-04-09T04:00:00.000Z",
        _parsedTimestamp: Date.parse("2026-04-09T04:00:00.000Z"),
      }),
    ]

    const countryList = buildCountryListFromArticles(articles)
    expect(countryList.countries[0]).toMatchObject({
      code: "JP",
      article_count: 2,
    })

    const internalLens = buildLocalLensFromArticles({
      articles,
      code: "JP",
      countryName: "Japan",
      view: "internal",
      limit: 10,
    })
    expect(internalLens.total).toBe(1)
    expect(internalLens.matching_strategy).toBe("country_mentions")
    expect(internalLens.articles[0]?.source).toBe("Tokyo Times")

    const externalLens = buildLocalLensFromArticles({
      articles,
      code: "JP",
      countryName: "Japan",
      view: "external",
      limit: 10,
    })
    expect(externalLens.total).toBe(1)
    expect(externalLens.articles[0]?.source).toBe("World Wire")
  })

  it("dedupes duplicate articles in local lens results", () => {
    const duplicate = makeArticle({
      id: 42,
      source: "World Wire",
      sourceId: "world-wire",
      country: "US",
      source_country: "US",
      mentioned_countries: ["JP"],
      publishedAt: "2026-04-09T03:00:00.000Z",
      _parsedTimestamp: Date.parse("2026-04-09T03:00:00.000Z"),
      url: "https://example.com/world-wire-jp",
    })

    const externalLens = buildLocalLensFromArticles({
      articles: [duplicate, duplicate],
      code: "JP",
      countryName: "Japan",
      view: "external",
      limit: 10,
    })

    expect(externalLens.total).toBe(1)
    expect(externalLens.returned).toBe(1)
    expect(externalLens.articles).toHaveLength(1)
    expect(externalLens.articles[0]?.id).toBe(42)
  })
})
