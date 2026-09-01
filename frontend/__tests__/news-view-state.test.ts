import { describe, expect, it } from '@jest/globals';
import type { CacheStatus, NewsArticle } from "@/lib/api"
import { getSharedArticleCount, getSharedSourceCount, getSharedViewArticles, getSharedViewLoading } from '@/lib/news-view-state';
import type { UnifiedNewsView } from '@/lib/news-view-state';

const sampleArticles: NewsArticle[] = [
  {
    bias: "center",
    category: "general",
    country: "US",
    credibility: "high",
    id: 1,
    image: "/placeholder.svg",
    originalLanguage: "en",
    publishedAt: "2026-04-09T00:00:00.000Z",
    source: "Test News",
    sourceId: "test-news",
    summary: "Summary",
    tags: [],
    title: "Article A",
    translated: false,
    url: "https://example.com/a",
  },
]

describe("news view state", () => {
  it.each<UnifiedNewsView>(["globe", "grid", "scroll", "blindspot"])(
    "returns the same shared article dataset for %s",
    (view) => {
      expect(getSharedViewArticles(view, sampleArticles)).toBe(sampleArticles)
    },
  )

  it("uses the current dataset total once the live index has resolved", () => {  expect.hasAssertions();

    const cacheStatus: CacheStatus = {
      cache_age_seconds: 0,
      category_breakdown: {},
      last_updated: "2026-04-09T00:00:00.000Z",
      sources_with_errors: 0,
      sources_with_warnings: 0,
      sources_working: 205,
      total_articles: 3000,
      total_sources: 205,
      update_in_progress: false,
    }

    expect(getSharedArticleCount(cacheStatus, 1200, sampleArticles, false)).toBe(1200)
  })

  it("falls back to cache totals only while the live index is still loading", () => {  expect.hasAssertions();

    const cacheStatus: CacheStatus = {
      cache_age_seconds: 0,
      category_breakdown: {},
      last_updated: "2026-04-09T00:00:00.000Z",
      sources_with_errors: 0,
      sources_with_warnings: 0,
      sources_working: 205,
      total_articles: 3000,
      total_sources: 205,
      update_in_progress: false,
    }

    expect(getSharedArticleCount(cacheStatus, 0, [], true)).toBe(3000)
    expect(getSharedArticleCount(undefined, 1200, sampleArticles, false)).toBe(1200)
    expect(getSharedArticleCount(undefined, 0, [], false)).toBe(0)
  })

  it("counts live sources from the current dataset after loading", () => {  expect.hasAssertions();

    const cacheStatus: CacheStatus = {
      cache_age_seconds: 0,
      category_breakdown: {},
      last_updated: "2026-04-09T00:00:00.000Z",
      sources_with_errors: 0,
      sources_with_warnings: 0,
      sources_working: 205,
      total_articles: 3000,
      total_sources: 205,
      update_in_progress: false,
    }

    expect(getSharedSourceCount(cacheStatus, sampleArticles, false)).toBe(1)
    expect(getSharedSourceCount(cacheStatus, [], true)).toBe(205)
  })

  it("shares the same loading state across views", () => {  expect.hasAssertions();

    expect(getSharedViewLoading(true)).toBe(true)
    expect(getSharedViewLoading(false)).toBe(false)
  })
})
