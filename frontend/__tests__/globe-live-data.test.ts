import { describe, expect, it } from '@jest/globals';
import fc from "fast-check"
import type { NewsArticle } from "@/lib/api"
import {
  buildCountryListFromArticles,
  buildCountryMetricsFromArticles,
  buildLocalLensFromArticles,
} from "@/lib/globe-live-data"

function makeArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    _parsedTimestamp: overrides._parsedTimestamp ?? Date.parse(overrides.publishedAt ?? "2026-04-09T00:00:00.000Z"),
    bias: overrides.bias ?? "center",
    category: overrides.category ?? "general",
    country: overrides.country ?? "US",
    credibility: overrides.credibility ?? "high",
    id: overrides.id ?? 1,
    image: overrides.image ?? "/placeholder.svg",
    mentioned_countries: overrides.mentioned_countries,
    originalLanguage: overrides.originalLanguage ?? "en",
    publishedAt: overrides.publishedAt ?? "2026-04-09T00:00:00.000Z",
    source: overrides.source ?? "Source",
    sourceId: overrides.sourceId ?? "source",
    source_country: overrides.source_country,
    summary: overrides.summary ?? "Summary",
    tags: overrides.tags ?? [],
    title: overrides.title ?? "Article",
    translated: overrides.translated ?? false,
    url: overrides.url ?? `https://example.com/${overrides.id ?? 1}`,
  }
}

describe("globe live data", () => {
  it("preserves article totals in derived country metrics", () => {  expect.hasAssertions();
  
    const articleArbitrary = fc.record({
      country: fc.constantFrom("US", "GB", "DE", "International"),
      id: fc.integer({ max: 10_000, min: 1 }),
      mentioned_countries: fc.array(fc.constantFrom("US", "GB", "DE"), { maxLength: 4 }),
      source: fc.stringMatching(/^[A-Z][a-z]{1,8}$/),
      sourceId: fc.stringMatching(/^[a-z]{1,8}$/),
      source_country: fc.option(fc.constantFrom("US", "GB", "DE"), { nil: undefined }),
    })

    fc.assert(
      fc.property(fc.array(articleArbitrary, { maxLength: 25 }), (rawArticles) => {
        const articles = rawArticles.map((article, index) =>
          makeArticle({
            ...article,
            _parsedTimestamp: Date.parse(`2026-04-09T00:00:${String(index).padStart(2, "0")}.000Z`),
            id: article.id + index,
            publishedAt: `2026-04-09T00:00:${String(index).padStart(2, "0")}.000Z`,
            url: `https://example.com/${article.id}-${index}`,
          }),
        ),

         metrics = buildCountryMetricsFromArticles(articles)
        expect(metrics.total_articles).toBe(articles.length)
        expect(metrics.articles_with_country + metrics.articles_without_country).toBe(
          articles.length,
        )
      }),
    )
  })

  it("builds country metadata and local lens views from the shared live dataset", () => {  expect.hasAssertions();
  
    const articles = [
      makeArticle({
        _parsedTimestamp: Date.parse("2026-04-09T02:00:00.000Z"),
        country: "JP",
        id: 1,
        mentioned_countries: ["JP"],
        publishedAt: "2026-04-09T02:00:00.000Z",
        source: "Tokyo Times",
        sourceId: "tokyo-times",
        source_country: "JP",
      }),
      makeArticle({
        _parsedTimestamp: Date.parse("2026-04-09T03:00:00.000Z"),
        country: "US",
        id: 2,
        mentioned_countries: ["JP"],
        publishedAt: "2026-04-09T03:00:00.000Z",
        source: "World Wire",
        sourceId: "world-wire",
        source_country: "US",
      }),
      makeArticle({
        _parsedTimestamp: Date.parse("2026-04-09T04:00:00.000Z"),
        country: "JP",
        id: 3,
        mentioned_countries: [],
        publishedAt: "2026-04-09T04:00:00.000Z",
        source: "Kyoto Daily",
        sourceId: "kyoto-daily",
        source_country: "JP",
      }),
    ],

     countryList = buildCountryListFromArticles(articles)
    expect(countryList.countries[0]).toMatchObject({
      article_count: 2,
      code: "JP",
    })

    const internalLens = buildLocalLensFromArticles({
      articles,
      code: "JP",
      countryName: "Japan",
      limit: 10,
      view: "internal",
    })
    expect(internalLens.total).toBe(1)
    expect(internalLens.matching_strategy).toBe("country_mentions")
    expect(internalLens.articles[0]?.source).toBe("Tokyo Times")

    const externalLens = buildLocalLensFromArticles({
      articles,
      code: "JP",
      countryName: "Japan",
      limit: 10,
      view: "external",
    })
    expect(externalLens.total).toBe(1)
    expect(externalLens.articles[0]?.source).toBe("World Wire")
  })

  it("dedupes duplicate articles in local lens results", () => {  expect.hasAssertions();
  
    const duplicate = makeArticle({
      _parsedTimestamp: Date.parse("2026-04-09T03:00:00.000Z"),
      country: "US",
      id: 42,
      mentioned_countries: ["JP"],
      publishedAt: "2026-04-09T03:00:00.000Z",
      source: "World Wire",
      sourceId: "world-wire",
      source_country: "US",
      url: "https://example.com/world-wire-jp",
    }),

     externalLens = buildLocalLensFromArticles({
      articles: [duplicate, duplicate],
      code: "JP",
      countryName: "Japan",
      limit: 10,
      view: "external",
    })

    expect(externalLens.total).toBe(1)
    expect(externalLens.returned).toBe(1)
    expect(externalLens.articles).toHaveLength(1)
    expect(externalLens.articles[0]?.id).toBe(42)
  })
})
