import { describe, expect, it } from '@jest/globals';
import fc from "fast-check"

import { buildInterestProfile, rankFeedArticles } from '@/lib/feed-ranking';
import type { PersonalizationSeed } from '@/lib/feed-ranking';
import type { ArticleTopic, NewsArticle } from "@/lib/api"

const DEFAULT_ARTICLE: NewsArticle = {
  bias: "center",
  category: "politics",
  country: "US",
  credibility: "high",
  id: 1,
  image: "https://images.example.com/photo.jpg",
  originalLanguage: "en",
  publishedAt: "2026-04-23T12:00:00.000Z",
  source: "Reuters",
  sourceId: "reuters",
  summary: "Markets react to trade policy changes.",
  tags: ["politics", "trade"],
  title: "Trade policy update",
  translated: false,
  url: "https://example.com/1",
};

function makeArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
  const article = { ...DEFAULT_ARTICLE, ...overrides };
  return {
    ...article,
    url: overrides.url ?? `https://example.com/${article.id}`,
  };
}

describe("feed ranking", () => {
  it("keeps favorite source bucket ahead of a non-favorite with higher personalization", () => {  expect.hasAssertions();
  
    const favoriteArticle = makeArticle({ id: 1, image: "", source: "Fav Source", sourceId: "fav-source" }),
     personalizedArticle = makeArticle({ id: 2, image: "", source: "Other Source", sourceId: "other-source", title: "Trade trade trade" }),

     seedArticle = makeArticle({ id: 10, tags: ["trade"], title: "Trade talks" }),
     seeds: PersonalizationSeed[] = [
      { article: seedArticle, bookmarked: true, createdAt: new Date().toISOString(), liked: true },
    ],
     topicsByArticleId: Record<number, ArticleTopic[]> = {
      10: [{ cluster_id: 3, keywords: ["trade"], label: "Trade", similarity: 0.91 }],
    },
     profile = buildInterestProfile(seeds, topicsByArticleId),
     ranked = rankFeedArticles(
      [personalizedArticle, favoriteArticle],
      profile,
      (sourceId) => sourceId === "fav-source",
    )

    expect(ranked.articles[0]!.id).toBe(1)
  })

  it("gives bookmark signals at least as much weight as likes for the same topic", () => {  expect.hasAssertions();
  
    fc.assert(
      fc.property(fc.integer({ max: 9999, min: 1 }), (articleId) => {
        const seedArticle = makeArticle({ category: "politics", id: articleId, sourceId: "newswire", title: "Election briefing" }),
         topicsByArticleId: Record<number, ArticleTopic[]> = {
          [articleId]: [{ cluster_id: 8, keywords: ["election", "vote"], label: "Election", similarity: 0.9 }],
        },

         likedProfile = buildInterestProfile(
          [{ article: seedArticle, bookmarked: false, createdAt: new Date().toISOString(), liked: true }],
          topicsByArticleId,
        ),
         bookmarkedProfile = buildInterestProfile(
          [{ article: seedArticle, bookmarked: true, createdAt: new Date().toISOString(), liked: false }],
          topicsByArticleId,
        )

        expect(bookmarkedProfile?.clusterWeights[8] || 0).toBeGreaterThanOrEqual(likedProfile?.clusterWeights[8] || 0)
        expect(bookmarkedProfile?.keywordWeights.election || 0).toBeGreaterThanOrEqual(likedProfile?.keywordWeights.election || 0)
      }),
    )
  })

  it("preserves original order for ties", () => {  expect.hasAssertions();
  
    const articles = [
      makeArticle({ id: 1, image: "", sourceId: "same-source" }),
      makeArticle({ id: 2, image: "", sourceId: "same-source" }),
      makeArticle({ id: 3, image: "", sourceId: "same-source" }),
    ],

     ranked = rankFeedArticles(articles, undefined, () => false)
    expect(ranked.articles.map((article) => article.id)).toStrictEqual([1, 2, 3])
  })
})
