import { buildSourceGroups, compareSourceGroupsForGrid } from "@/lib/source-groups"
import type { NewsArticle } from "@/lib/api"

function createArticle(overrides: Partial<NewsArticle>): NewsArticle {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Test article",
    source: overrides.source ?? "Example News",
    sourceId: overrides.sourceId ?? "example-news",
    country: overrides.country ?? "US",
    credibility: overrides.credibility ?? "high",
    bias: overrides.bias ?? "center",
    summary: overrides.summary ?? "Summary",
    image: overrides.image ?? "none",
    publishedAt: overrides.publishedAt ?? "2026-04-23T12:00:00Z",
    _parsedTimestamp: overrides._parsedTimestamp ?? Date.parse("2026-04-23T12:00:00Z"),
    category: overrides.category ?? "general",
    url: overrides.url ?? `https://example.com/${overrides.id ?? 1}`,
    tags: overrides.tags ?? [],
    originalLanguage: overrides.originalLanguage ?? "en",
    translated: overrides.translated ?? false,
    source_country: overrides.source_country,
    mentioned_countries: overrides.mentioned_countries,
    geo_signal: overrides.geo_signal,
    author: overrides.author,
    authors: overrides.authors,
    content: overrides.content,
    hasFullContent: overrides.hasFullContent,
    isPersisted: overrides.isPersisted,
    _queueData: overrides._queueData,
  }
}

describe("source group ordering", () => {
  it("keeps United States sources ahead of non-US sources in grid ordering", () => {
    const groups = buildSourceGroups([
      createArticle({
        id: 1,
        source: "Berlin Bulletin",
        sourceId: "berlin-bulletin",
        country: "DE",
        source_country: "DE",
      }),
      createArticle({
        id: 2,
        source: "Capitol Wire",
        sourceId: "capitol-wire",
        country: "US",
        source_country: "US",
      }),
      createArticle({
        id: 3,
        source: "Paris Dispatch",
        sourceId: "paris-dispatch",
        country: "FR",
        source_country: "FR",
      }),
    ]).sort(compareSourceGroupsForGrid)

    expect(groups.map((group) => group.sourceId)).toEqual([
      "capitol-wire",
      "berlin-bulletin",
      "paris-dispatch",
    ])
  })
})
