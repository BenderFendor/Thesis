import {
  filterArticlesByLens,
  getLensSourceIds,
  getLensStats,
  type NewsLensId,
} from "@/lib/news-lens";
import type { NewsArticle, NewsSource } from "@/lib/api";

function source(overrides: Partial<NewsSource>): NewsSource {
  return {
    id: "source",
    slug: "source",
    name: "Source",
    country: "US",
    url: "https://example.com",
    rssUrl: "https://example.com/rss",
    credibility: "medium",
    bias: "center",
    category: ["general"],
    language: "en",
    funding: ["Unknown"],
    ...overrides,
  };
}

function article(overrides: Partial<NewsArticle>): NewsArticle {
  return {
    id: 1,
    title: "Article",
    source: "Source",
    sourceId: "source",
    url: "https://example.com/article",
    country: "US",
    credibility: "medium",
    bias: "center",
    summary: "Summary",
    image: "",
    publishedAt: "2026-05-31T00:00:00Z",
    category: "general",
    tags: [],
    originalLanguage: "en",
    translated: false,
    ...overrides,
  };
}

describe("news lens filtering", () => {
  const sources = [
    source({ id: "reuters", slug: "reuters", name: "Reuters", sourceType: "wire" }),
    source({ id: "local", slug: "local", name: "Local Paper", sourceType: "local" }),
    source({
      id: "paywall",
      slug: "paywall",
      name: "Paywall Daily",
      isPaywalled: true,
    }),
  ];

  it("selects source ids for a lens", () => {
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

  it("filters articles by source metadata", () => {
    const articles = [
      article({ id: 1, source: "Reuters", sourceId: "reuters" }),
      article({ id: 2, source: "Paywall Daily", sourceId: "paywall" }),
    ];

    const filtered = filterArticlesByLens(articles, sources, "low-paywall");

    expect(filtered.map((item) => item.id)).toEqual([1]);
  });
});
