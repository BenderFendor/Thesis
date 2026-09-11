import {
  buildCountryListFromArticles,
  buildCountryMetricsFromArticles,
  buildLocalLensFromArticles,
} from "@/lib/globe-live-data";
import { describe, expect, it } from "@jest/globals";
import type { NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import fc from "fast-check";

const DEFAULT_ARTICLE: NewsArticle = {
  bias: "center",
  category: "general",
  country: "US",
  credibility: "high",
  id: 1,
  image: "/placeholder.svg",
  originalLanguage: "en",
  publishedAt: "2026-04-09T00:00:00.000Z",
  source: "Source",
  sourceId: "source",
  summary: "Summary",
  tags: [],
  title: "Article",
  translated: false,
  url: "https://example.com/1",
};

type ArticleOverrides = DeepReadonly<Partial<Omit<NewsArticle, "_queueData">>>;

const makeArticle = (overrides: ArticleOverrides = {}): NewsArticle => {
  const { _parsedTimestamp: parsedTimestampOverride } = overrides;
  const publishedAt = overrides.publishedAt ?? DEFAULT_ARTICLE.publishedAt;
  const article = { ...DEFAULT_ARTICLE, ...overrides, publishedAt };
  return {
    ...article,
    _parsedTimestamp: parsedTimestampOverride ?? Date.parse(publishedAt),
    url: overrides.url ?? `https://example.com/${article.id}`,
  };
};

const createGlobeArticles = (): NewsArticle[] => [
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
];

describe("globe live data metrics", () => {
  it("preserves article totals in derived country metrics", () => {
    expect.hasAssertions();

    const articleArbitrary = fc.record({
      country: fc.constantFrom("US", "GB", "DE", "International"),
      id: fc.integer({ max: 10_000, min: 1 }),
      mentioned_countries: fc.array(fc.constantFrom("US", "GB", "DE"), { maxLength: 4 }),
      source: fc.stringMatching(/^[A-Z][a-z]{1,8}$/u),
      sourceId: fc.stringMatching(/^[a-z]{1,8}$/u),
      source_country: fc.option(fc.constantFrom("US", "GB", "DE"), { nil: undefined }),
    });

    expect(() => {
      fc.assert(
        fc.property(fc.array(articleArbitrary, { maxLength: 25 }), (rawArticles) => {
          const articles = rawArticles.map((article, index) =>
              makeArticle({
                ...article,
                _parsedTimestamp: Date.parse(
                  `2026-04-09T00:00:${String(index).padStart(2, "0")}.000Z`,
                ),
                id: article.id + index,
                publishedAt: `2026-04-09T00:00:${String(index).padStart(2, "0")}.000Z`,
                url: `https://example.com/${article.id}-${index}`,
              }),
            ),
            metrics = buildCountryMetricsFromArticles(articles);
          expect(metrics.total_articles).toBe(articles.length);
          expect(metrics.articles_with_country + metrics.articles_without_country).toBe(
            articles.length,
          );
        }),
      );
    }).not.toThrow();
  });
});

describe("globe live data metadata", () => {
  it("builds country metadata and local lens views from the shared live dataset", () => {
    expect.hasAssertions();

    const articles = createGlobeArticles();
    const countryList = buildCountryListFromArticles(articles);
    expect(countryList.countries[0]).toMatchObject({
      article_count: 2,
      code: "JP",
    });

    const internalLens = buildLocalLensFromArticles({
      articles,
      code: "JP",
      countryName: "Japan",
      limit: 10,
      view: "internal",
    });
    const externalLens = buildLocalLensFromArticles({
      articles,
      code: "JP",
      countryName: "Japan",
      limit: 10,
      view: "external",
    });
    expect({
      externalArticleSource: externalLens.articles[0]?.source,
      externalTotal: externalLens.total,
      internalArticleSource: internalLens.articles[0]?.source,
      internalMatchingStrategy: internalLens.matching_strategy,
      internalTotal: internalLens.total,
    }).toStrictEqual({
      externalArticleSource: "World Wire",
      externalTotal: 1,
      internalArticleSource: "Tokyo Times",
      internalMatchingStrategy: "country_mentions",
      internalTotal: 1,
    });
  });
});

describe("globe live data deduplication", () => {
  it("dedupes duplicate articles in local lens results", () => {
    expect.hasAssertions();

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
      });

    expect(externalLens.total).toBe(1);
    expect(externalLens.returned).toBe(1);
    expect(externalLens.articles).toHaveLength(1);
    expect(externalLens.articles[0]?.id).toBe(42);
  });
});
