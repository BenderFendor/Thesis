import type { CacheStatus, NewsArticle } from "@/lib/api"
import {
  getSharedArticleCount,
  getSharedSourceCount,
  getSharedViewArticles,
  getSharedViewLoading,
  type UnifiedNewsView,
} from "@/lib/news-view-state"

const sampleArticles: NewsArticle[] = [
  {
    id: 1,
    title: "Article A",
    source: "Test News",
    sourceId: "test-news",
    country: "US",
    credibility: "high",
    bias: "center",
    summary: "Summary",
    image: "/placeholder.svg",
    publishedAt: "2026-04-09T00:00:00.000Z",
    category: "general",
    url: "https://example.com/a",
    tags: [],
    originalLanguage: "en",
    translated: false,
  },
]

describe("news view state", () => {
  it.each<UnifiedNewsView>(["globe", "grid", "scroll", "blindspot"])(
    "returns the same shared article dataset for %s",
    (view) => {
      expect(getSharedViewArticles(view, sampleArticles)).toBe(sampleArticles)
    },
  )

  it("uses the current dataset total once the live index has resolved", () => {
    const cacheStatus: CacheStatus = {
      last_updated: "2026-04-09T00:00:00.000Z",
      update_in_progress: false,
      total_articles: 3000,
      total_sources: 205,
      sources_working: 205,
      sources_with_errors: 0,
      sources_with_warnings: 0,
      category_breakdown: {},
      cache_age_seconds: 0,
    }

    expect(getSharedArticleCount(cacheStatus, 1200, sampleArticles, false)).toBe(1200)
  })

  it("falls back to cache totals only while the live index is still loading", () => {
    const cacheStatus: CacheStatus = {
      last_updated: "2026-04-09T00:00:00.000Z",
      update_in_progress: false,
      total_articles: 3000,
      total_sources: 205,
      sources_working: 205,
      sources_with_errors: 0,
      sources_with_warnings: 0,
      category_breakdown: {},
      cache_age_seconds: 0,
    }

    expect(getSharedArticleCount(cacheStatus, 0, [], true)).toBe(3000)
    expect(getSharedArticleCount(null, 1200, sampleArticles, false)).toBe(1200)
    expect(getSharedArticleCount(null, 0, [], false)).toBe(0)
  })

  it("counts live sources from the current dataset after loading", () => {
    const cacheStatus: CacheStatus = {
      last_updated: "2026-04-09T00:00:00.000Z",
      update_in_progress: false,
      total_articles: 3000,
      total_sources: 205,
      sources_working: 205,
      sources_with_errors: 0,
      sources_with_warnings: 0,
      category_breakdown: {},
      cache_age_seconds: 0,
    }

    expect(getSharedSourceCount(cacheStatus, sampleArticles, false)).toBe(1)
    expect(getSharedSourceCount(cacheStatus, [], true)).toBe(205)
  })

  it("shares the same loading state across views", () => {
    expect(getSharedViewLoading(true)).toBe(true)
    expect(getSharedViewLoading(false)).toBe(false)
  })
})
