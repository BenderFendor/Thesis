import fc from "fast-check"

import {
  buildInterestProfile,
  rankFeedArticles,
  type PersonalizationSeed,
} from "@/lib/feed-ranking"
import { ArticleTopic, NewsArticle } from "@/lib/api"

function makeArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Trade policy update",
    source: overrides.source ?? "Reuters",
    sourceId: overrides.sourceId ?? "reuters",
    country: overrides.country ?? "US",
    credibility: overrides.credibility ?? "high",
    bias: overrides.bias ?? "center",
    summary: overrides.summary ?? "Markets react to trade policy changes.",
    image: overrides.image ?? "https://images.example.com/photo.jpg",
    publishedAt: overrides.publishedAt ?? new Date().toISOString(),
    category: overrides.category ?? "politics",
    url: overrides.url ?? `https://example.com/${overrides.id ?? 1}`,
    tags: overrides.tags ?? ["politics", "trade"],
    originalLanguage: overrides.originalLanguage ?? "en",
    translated: overrides.translated ?? false,
  }
}

describe("feed ranking", () => {
  it("keeps favorite source bucket ahead of a non-favorite with higher personalization", () => {
    const favoriteArticle = makeArticle({ id: 1, sourceId: "fav-source", source: "Fav Source", image: "" })
    const personalizedArticle = makeArticle({ id: 2, sourceId: "other-source", source: "Other Source", image: "", title: "Trade trade trade" })

    const seedArticle = makeArticle({ id: 10, title: "Trade talks", tags: ["trade"] })
    const seeds: PersonalizationSeed[] = [
      { article: seedArticle, liked: true, bookmarked: true, createdAt: new Date().toISOString() },
    ]
    const topicsByArticleId: Record<number, ArticleTopic[]> = {
      10: [{ cluster_id: 3, label: "Trade", similarity: 0.91, keywords: ["trade"] }],
    }
    const profile = buildInterestProfile(seeds, topicsByArticleId)
    const ranked = rankFeedArticles(
      [personalizedArticle, favoriteArticle],
      profile,
      (sourceId) => sourceId === "fav-source",
    )

    expect(ranked.articles[0].id).toBe(1)
  })

  it("gives bookmark signals at least as much weight as likes for the same topic", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), (articleId) => {
        const seedArticle = makeArticle({ id: articleId, title: "Election briefing", category: "politics", sourceId: "newswire" })
        const topicsByArticleId: Record<number, ArticleTopic[]> = {
          [articleId]: [{ cluster_id: 8, label: "Election", similarity: 0.9, keywords: ["election", "vote"] }],
        }

        const likedProfile = buildInterestProfile(
          [{ article: seedArticle, liked: true, bookmarked: false, createdAt: new Date().toISOString() }],
          topicsByArticleId,
        )
        const bookmarkedProfile = buildInterestProfile(
          [{ article: seedArticle, liked: false, bookmarked: true, createdAt: new Date().toISOString() }],
          topicsByArticleId,
        )

        expect((bookmarkedProfile?.clusterWeights[8] || 0) >= (likedProfile?.clusterWeights[8] || 0)).toBe(true)
        expect((bookmarkedProfile?.keywordWeights.election || 0) >= (likedProfile?.keywordWeights.election || 0)).toBe(true)
      }),
    )
  })

  it("preserves original order for ties", () => {
    const articles = [
      makeArticle({ id: 1, image: "", sourceId: "same-source" }),
      makeArticle({ id: 2, image: "", sourceId: "same-source" }),
      makeArticle({ id: 3, image: "", sourceId: "same-source" }),
    ]

    const ranked = rankFeedArticles(articles, null, () => false)
    expect(ranked.articles.map((article) => article.id)).toEqual([1, 2, 3])
  })
})
