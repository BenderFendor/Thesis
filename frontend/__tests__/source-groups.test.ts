import { buildSourceGroups, compareSourceGroupsForGrid } from "@/lib/source-groups";
import { describe, expect, it } from "@jest/globals";
import type { NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";

const DEFAULT_ARTICLE: NewsArticle = {
  bias: "center",
  category: "general",
  country: "US",
  credibility: "high",
  id: 1,
  image: "none",
  originalLanguage: "en",
  publishedAt: "2026-04-23T12:00:00Z",
  source: "Example News",
  sourceId: "example-news",
  summary: "Summary",
  tags: [],
  title: "Test article",
  translated: false,
  url: "https://example.com/1",
};

type ArticleOverrides = DeepReadonly<Partial<Omit<NewsArticle, "_queueData">>>;

const createArticle = (overrides: ArticleOverrides): NewsArticle => {
  const { _parsedTimestamp: parsedTimestampOverride } = overrides,
    article = { ...DEFAULT_ARTICLE, ...overrides },
    parsedTimestamp = parsedTimestampOverride ?? Date.parse(article.publishedAt);
  return {
    ...article,
    _parsedTimestamp: parsedTimestamp,
    url: overrides.url ?? `https://example.com/${article.id}`,
  };
};

describe("source group ordering", () => {
  it("keeps United States sources ahead of non-US sources in grid ordering", () => {
    expect.hasAssertions();

    const groups = buildSourceGroups([
      createArticle({
        country: "DE",
        id: 1,
        source: "Berlin Bulletin",
        sourceId: "berlin-bulletin",
        source_country: "DE",
      }),
      createArticle({
        country: "US",
        id: 2,
        source: "Capitol Wire",
        sourceId: "capitol-wire",
        source_country: "US",
      }),
      createArticle({
        country: "FR",
        id: 3,
        source: "Paris Dispatch",
        sourceId: "paris-dispatch",
        source_country: "FR",
      }),
    ]).toSorted(compareSourceGroupsForGrid);

    expect(groups.map((group) => group.sourceId)).toStrictEqual([
      "capitol-wire",
      "berlin-bulletin",
      "paris-dispatch",
    ]);
  });
});
