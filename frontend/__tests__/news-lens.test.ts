import { describe, expect, it } from '@jest/globals';
import { filterArticlesByLens, getLensSourceIds, getLensStats } from '@/lib/news-lens';
import type { NewsLensId } from '@/lib/news-lens';
import type { NewsArticle, NewsSource } from "@/lib/api";

function source(overrides: Partial<NewsSource>): NewsSource {
  return {
    bias: "center",
    category: ["general"],
    country: "US",
    credibility: "medium",
    funding: ["Unknown"],
    id: "source",
    language: "en",
    name: "Source",
    rssUrl: "https://example.com/rss",
    slug: "source",
    url: "https://example.com",
    ...overrides,
  };
}

function article(overrides: Partial<NewsArticle>): NewsArticle {
  return {
    bias: "center",
    category: "general",
    country: "US",
    credibility: "medium",
    id: 1,
    image: "",
    originalLanguage: "en",
    publishedAt: "2026-05-31T00:00:00Z",
    source: "Source",
    sourceId: "source",
    summary: "Summary",
    tags: [],
    title: "Article",
    translated: false,
    url: "https://example.com/article",
    ...overrides,
  };
}

describe("news lens filtering", () => {
  const sources = [
    source({ id: "reuters", name: "Reuters", slug: "reuters", sourceType: "wire" }),
    source({ id: "local", name: "Local Paper", slug: "local", sourceType: "local" }),
    source({
      id: "paywall",
      isPaywalled: true,
      name: "Paywall Daily",
      slug: "paywall",
    }),
  ];

  it("selects source ids for a lens", () => {  expect.hasAssertions();
  
    const ids = getLensSourceIds(sources, "wire");
    expect(ids.has("reuters")).toBe(true);
    expect(ids.has("local")).toBe(false);
  });

  it.each<NewsLensId>(["all", "wire", "local", "low-paywall"])(
    "reports included and excluded counts for %s",
    (lens) => {
      const stats = getLensStats(sources, lens);
      expect(stats.included + stats.excluded).toBe(sources.length);
    },
  );

  it("filters articles by source metadata", () => {  expect.hasAssertions();
  
    const articles = [
      article({ id: 1, source: "Reuters", sourceId: "reuters" }),
      article({ id: 2, source: "Paywall Daily", sourceId: "paywall" }),
    ],

     filtered = filterArticlesByLens(articles, sources, "low-paywall");

    expect(filtered.map((item) => item.id)).toStrictEqual([1]);
  });
});
