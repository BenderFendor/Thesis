import {
  buildCoverageBreakdown,
  buildSourceSummary,
  sortExpandedArticles,
} from "@/lib/globe-workspace";
import { describe, expect, it } from '@jest/globals';
import type { NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";

type ArticleOverrides = DeepReadonly<
  Partial<Pick<NewsArticle, "id" | "mentioned_countries" | "publishedAt" | "source">>
>;

describe("globe workspace calculations", () => {
  const article = (overrides: ArticleOverrides): NewsArticle => ({
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
    url: "https://example.com/article",
    ...overrides,
  });

  it("ranks source summaries and coverage by article count", () => {  expect.hasAssertions();

    const articles = [
      article({ id: 1, mentioned_countries: ["US", "GB"], source: "Wire A" }),
      article({ id: 2, mentioned_countries: ["US"], source: "Wire A" }),
      article({ id: 3, mentioned_countries: ["GB"], source: "Wire B" }),
    ];

    expect(buildSourceSummary(articles)).toStrictEqual([
      { count: 2, name: "Wire A" },
      { count: 1, name: "Wire B" },
    ]);
    expect(buildCoverageBreakdown(articles)).toStrictEqual([
      { count: 2, country: "US" },
      { count: 2, country: "GB" },
    ]);
  });

  it("sorts recent and oldest views without mutating the input", () => {  expect.hasAssertions();

    const articles = [
      article({ id: 1, publishedAt: "2026-04-09T01:00:00.000Z" }),
      article({ id: 2, publishedAt: "2026-04-09T03:00:00.000Z" }),
    ];

    expect(sortExpandedArticles(articles, "recent").map(({ id }) => id)).toStrictEqual([2, 1]);
    expect(sortExpandedArticles(articles, "oldest").map(({ id }) => id)).toStrictEqual([1, 2]);
    expect(articles.map(({ id }) => id)).toStrictEqual([1, 2]);
  });
});
