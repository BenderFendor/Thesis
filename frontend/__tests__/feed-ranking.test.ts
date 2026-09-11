import type { ArticleTopic, NewsArticle } from "@/lib/api";
import { buildInterestProfile, rankFeedArticles } from "@/lib/feed-ranking";

import { describe, expect, it } from "@jest/globals";
import type { PersonalizationSeed } from "@/lib/feed-ranking";
import type { DeepReadonly } from "@/lib/deep-readonly";
import fc from "fast-check";

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

type ArticleTopicIndex = Readonly<Record<number, readonly ArticleTopic[]>>;
type ArticleOverrides = DeepReadonly<Partial<Omit<NewsArticle, "_queueData">>>;

const makeArticle = (overrides: ArticleOverrides = {}): NewsArticle => {
  const article = { ...DEFAULT_ARTICLE, ...overrides };
  return {
    ...article,
    url: overrides.url ?? `https://example.com/${article.id}`,
  };
};

describe("feed ranking favorite source", () => {
  it("keeps favorite source bucket ahead of a non-favorite with higher personalization", () => {
    const favoriteArticle = makeArticle({
        id: 1,
        image: "",
        source: "Fav Source",
        sourceId: "fav-source",
      });
    const personalizedArticle = makeArticle({
        id: 2,
        image: "",
        source: "Other Source",
        sourceId: "other-source",
        title: "Trade trade trade",
      });
    const seedArticle = makeArticle({ id: 10, tags: ["trade"], title: "Trade talks" });
    const seeds: PersonalizationSeed[] = [
        {
          article: seedArticle,
          bookmarked: true,
          createdAt: new Date().toISOString(),
          liked: true,
        },
      ];
    const topicsByArticleId = {
        10: [{ cluster_id: 3, keywords: ["trade"], label: "Trade", similarity: 0.91 }],
      } satisfies ArticleTopicIndex;
    const profile = buildInterestProfile(seeds, topicsByArticleId);
    const ranked = rankFeedArticles(
        [personalizedArticle, favoriteArticle],
        profile,
        (sourceId) => sourceId === "fav-source",
      );

    const [firstArticle] = ranked.articles;
    expect(firstArticle?.id).toBe(1);
  });
});

describe("feed ranking bookmark weight", () => {
  it("gives bookmark signals at least as much weight as likes for the same topic", () => {
    expect(() => {
      fc.assert(
        fc.property(fc.integer({ max: 9999, min: 1 }), (articleId) => {
        const seedArticle = makeArticle({
            category: "politics",
            id: articleId,
            sourceId: "newswire",
            title: "Election briefing",
          });
        const topicsByArticleId = {
            [articleId]: [
              { cluster_id: 8, keywords: ["election", "vote"], label: "Election", similarity: 0.9 },
            ],
          } satisfies ArticleTopicIndex;
        const likedProfile = buildInterestProfile(
            [
              {
                article: seedArticle,
                bookmarked: false,
                createdAt: new Date().toISOString(),
                liked: true,
              },
            ],
            topicsByArticleId,
          );
        const bookmarkedProfile = buildInterestProfile(
            [
              {
                article: seedArticle,
                bookmarked: true,
                createdAt: new Date().toISOString(),
                liked: false,
              },
            ],
            topicsByArticleId,
          );

        expect(Number(bookmarkedProfile?.clusterWeights[8])).toBeGreaterThanOrEqual(
          Number(likedProfile?.clusterWeights[8]),
        );
        expect(Number(bookmarkedProfile?.keywordWeights.election)).toBeGreaterThanOrEqual(
          Number(likedProfile?.keywordWeights.election),
        );
        }),
      );
    }).not.toThrow();
  });
});

describe("feed ranking tie order", () => {
  it("preserves original order for ties", () => {
    expect.hasAssertions();

    const articles = [
        makeArticle({ id: 1, image: "", sourceId: "same-source" }),
        makeArticle({ id: 2, image: "", sourceId: "same-source" }),
        makeArticle({ id: 3, image: "", sourceId: "same-source" }),
      ],
      ranked = rankFeedArticles(articles, undefined, () => false);
    expect(ranked.articles.map((article) => article.id)).toStrictEqual([1, 2, 3]);
  });
});
