import { describe, expect, it } from '@jest/globals';
import { buildSourceGroups, compareSourceGroupsForGrid } from "@/lib/source-groups"
import type { NewsArticle } from "@/lib/api"

function createArticle(overrides: Partial<NewsArticle>): NewsArticle {
  return {
    _parsedTimestamp: overrides._parsedTimestamp ?? Date.parse("2026-04-23T12:00:00Z"),
    _queueData: overrides._queueData,
    author: overrides.author,
    authors: overrides.authors,
    bias: overrides.bias ?? "center",
    category: overrides.category ?? "general",
    content: overrides.content,
    country: overrides.country ?? "US",
    credibility: overrides.credibility ?? "high",
    geo_signal: overrides.geo_signal,
    hasFullContent: overrides.hasFullContent,
    id: overrides.id ?? 1,
    image: overrides.image ?? "none",
    isPersisted: overrides.isPersisted,
    mentioned_countries: overrides.mentioned_countries,
    originalLanguage: overrides.originalLanguage ?? "en",
    publishedAt: overrides.publishedAt ?? "2026-04-23T12:00:00Z",
    source: overrides.source ?? "Example News",
    sourceId: overrides.sourceId ?? "example-news",
    source_country: overrides.source_country,
    summary: overrides.summary ?? "Summary",
    tags: overrides.tags ?? [],
    title: overrides.title ?? "Test article",
    translated: overrides.translated ?? false,
    url: overrides.url ?? `https://example.com/${overrides.id ?? 1}`,
  }
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
