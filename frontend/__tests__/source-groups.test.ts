import { describe, expect, it } from '@jest/globals';
import { buildSourceGroups, compareSourceGroupsForGrid } from "@/lib/source-groups"
import type { NewsArticle } from "@/lib/api"

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

function createArticle(overrides: Partial<NewsArticle>): NewsArticle {
  const article = { ...DEFAULT_ARTICLE, ...overrides };
  return {
    ...article,
    _parsedTimestamp: overrides._parsedTimestamp ?? Date.parse(article.publishedAt),
    url: overrides.url ?? `https://example.com/${article.id}`,
  };
}

describe("source group ordering", () => {
  it("keeps United States sources ahead of non-US sources in grid ordering", () => {  expect.hasAssertions();
  
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
    ]).sort(compareSourceGroupsForGrid)

    expect(groups.map((group) => group.sourceId)).toStrictEqual([
      "capitol-wire",
      "berlin-bulletin",
      "paris-dispatch",
    ])
  })
})
