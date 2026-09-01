"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ArticleTopic,
  BookmarkEntry,
  LikedEntry,
  NewsArticle,
} from "@/lib/api";
import {
  fetchBookmarks,
  fetchBulkArticleTopics,
  fetchLikedArticles,
} from "@/lib/api";
import type {
  FeedScoreBreakdown,
  InterestProfile,
  PersonalizationSeed,
  RankedFeedResult,
} from "@/lib/feed-ranking";
import {
  MAX_PERSONALIZATION_SEEDS,
  buildInterestProfile,
  rankFeedArticles,
} from "@/lib/feed-ranking";

type PersonalizationStatus = "basic" | "loading" | "ready" | "fallback";

interface UseScrollPersonalizationOptions {
  readonly articles: readonly NewsArticle[];
  readonly enabled?: boolean;
  readonly isFavorite: (sourceId: string) => boolean;
}

interface UseScrollPersonalizationResult {
  readonly breakdowns: Readonly<Record<number, FeedScoreBreakdown>>;
  readonly profile?: Readonly<InterestProfile>;
  readonly rankedArticles: readonly NewsArticle[];
  readonly seedCount: number;
  readonly status: PersonalizationStatus;
  readonly topicsLoaded: number;
}

interface PersonalizationLoadResult {
  readonly profile?: Readonly<InterestProfile>;
  readonly ranking?: Readonly<RankedFeedResult>;
  readonly seedCount: number;
  readonly status: Exclude<PersonalizationStatus, "loading">;
  readonly topicsLoaded: number;
}

interface PersonalizationSetters {
  readonly setBreakdowns: (
    value: Readonly<Record<number, FeedScoreBreakdown>> | undefined,
  ) => void;
  readonly setProfile: (value: Readonly<InterestProfile> | undefined) => void;
  readonly setRankedArticles: (value: readonly NewsArticle[] | undefined) => void;
  readonly setSeedCount: (value: number) => void;
  readonly setStatus: (value: PersonalizationStatus) => void;
  readonly setTopicsLoaded: (value: number) => void;
}

const NO_ITEMS = 0,
 REQUEST_VERSION_INCREMENT = 1,
 topicCache = new Map<number, readonly ArticleTopic[]>(),

 getSeedTimestamp = (seed: Readonly<PersonalizationSeed>): number => {
  if (seed.createdAt === undefined) {
    return NO_ITEMS;
  }
  return new Date(seed.createdAt).getTime();
},

 mergeBookmarkSeed = (
  merged: Map<number, PersonalizationSeed>,
  bookmark: Readonly<BookmarkEntry>,
): void => {
  const existing = merged.get(bookmark.articleId);
  merged.set(bookmark.articleId, {
    article: bookmark.article,
    bookmarked: true,
    createdAt: bookmark.createdAt,
    liked: existing?.liked ?? false,
  });
},

 mergeLikedSeed = (
  merged: Map<number, PersonalizationSeed>,
  liked: Readonly<LikedEntry>,
): void => {
  const existing = merged.get(liked.articleId);
  merged.set(liked.articleId, {
    article: liked.article,
    bookmarked: existing?.bookmarked ?? false,
    createdAt: existing?.createdAt ?? liked.createdAt,
    liked: true,
  });
},

 dedupeSeeds = (
  bookmarks: readonly BookmarkEntry[],
  likes: readonly LikedEntry[],
): PersonalizationSeed[] => {
  const merged = new Map<number, PersonalizationSeed>();
  for (const bookmark of bookmarks) {
    mergeBookmarkSeed(merged, bookmark);
  }
  for (const liked of likes) {
    mergeLikedSeed(merged, liked);
  }
  return [...merged.values()]
    .sort((left, right) => getSeedTimestamp(right) - getSeedTimestamp(left))
    .slice(NO_ITEMS, MAX_PERSONALIZATION_SEEDS);
},

 getArticleIds = (
  articles: readonly NewsArticle[],
  seeds: readonly PersonalizationSeed[],
): number[] => [
  ...new Set([
    ...articles.map((article) => article.id),
    ...seeds.map((seed) => seed.article.id),
  ]),
],

 buildTopicMap = (
  articleIds: readonly number[],
): Record<number, readonly ArticleTopic[]> => {
  const topicMap: Record<number, readonly ArticleTopic[]> = {};
  for (const articleId of articleIds) {
    const cached = topicCache.get(articleId);
    if (cached !== undefined) {
      topicMap[articleId] = cached;
    }
  }
  return topicMap;
},

 hydrateMissingTopics = async (articleIds: readonly number[]): Promise<boolean> => {
  const missingIds = articleIds.filter((articleId) => !topicCache.has(articleId));
  if (missingIds.length === NO_ITEMS) {
    return true;
  }
  try {
    const response = await fetchBulkArticleTopics(missingIds);
    for (const articleIdText of Object.keys(response.articles)) {
      const articleId = Number(articleIdText),
       topics = response.articles[articleId];
      if (topics !== undefined) {
        topicCache.set(articleId, topics);
      }
    }
    return true;
  } catch {
    return false;
  }
},

 createBasicResult = (seedCount = NO_ITEMS): PersonalizationLoadResult => ({
  seedCount,
  status: "basic",
  topicsLoaded: topicCache.size,
}),

 createFallbackResult = (seedCount = NO_ITEMS): PersonalizationLoadResult => ({
  seedCount,
  status: "fallback",
  topicsLoaded: topicCache.size,
}),

 loadPersonalization = async (
  articles: readonly NewsArticle[],
  isFavorite: (sourceId: string) => boolean,
): Promise<PersonalizationLoadResult> => {
  let bookmarks: BookmarkEntry[],
   likes: LikedEntry[];
  try {
    [bookmarks, likes] = await Promise.all([fetchBookmarks(), fetchLikedArticles()]);
  } catch {
    return createFallbackResult();
  }
  const seeds = dedupeSeeds(bookmarks, likes);
  if (seeds.length === NO_ITEMS) {
    return createBasicResult();
  }
  const articleIds = getArticleIds(articles, seeds),
   topicsAvailable = await hydrateMissingTopics(articleIds);
  if (!topicsAvailable) {
    return createFallbackResult(seeds.length);
  }
  const topicMap = buildTopicMap(articleIds),
   profile = buildInterestProfile(seeds, topicMap);
  if (profile === undefined) {
    return createBasicResult(seeds.length);
  }
  return {
    profile,
    ranking: rankFeedArticles(articles, profile, isFavorite),
    seedCount: seeds.length,
    status: "ready",
    topicsLoaded: Object.keys(topicMap).length,
  };
},

 applyLoadResult = (
  result: Readonly<PersonalizationLoadResult>,
  setters: Readonly<PersonalizationSetters>,
): void => {
  setters.setProfile(result.profile);
  setters.setRankedArticles(result.ranking?.articles);
  setters.setBreakdowns(result.ranking?.breakdowns);
  setters.setSeedCount(result.seedCount);
  setters.setStatus(result.status);
  setters.setTopicsLoaded(result.topicsLoaded);
};

export const useScrollPersonalization = ({
  articles,
  enabled = true,
  isFavorite,
}: Readonly<UseScrollPersonalizationOptions>): UseScrollPersonalizationResult => {
  const basicRanking = useMemo(
    () => rankFeedArticles(articles, undefined, isFavorite),
    [articles, isFavorite],
  ),
   [status, setStatus] = useState<PersonalizationStatus>("basic"),
   [profile, setProfile] = useState<Readonly<InterestProfile>>(),
   [personalizedBreakdowns, setPersonalizedBreakdowns] =
    useState<Readonly<Record<number, FeedScoreBreakdown>>>(),
   [personalizedArticles, setPersonalizedArticles] =
    useState<readonly NewsArticle[]>(),
   [topicsLoaded, setTopicsLoaded] = useState(NO_ITEMS),
   [seedCount, setSeedCount] = useState(NO_ITEMS),
   requestVersionRef = useRef(NO_ITEMS);

  useEffect(() => {
    requestVersionRef.current += REQUEST_VERSION_INCREMENT;
    const requestVersion = requestVersionRef.current;
    if (!enabled) {
      return;
    }
    let cancelled = false;
    globalThis.queueMicrotask(() => {
      if (!cancelled) {
        setStatus("loading");
      }
    });
    void loadPersonalization(articles, isFavorite).then((result) => {
      const requestIsCurrent = requestVersionRef.current === requestVersion;
      if (cancelled || !requestIsCurrent) {
        return;
      }
      applyLoadResult(result, {
        setBreakdowns: setPersonalizedBreakdowns,
        setProfile,
        setRankedArticles: setPersonalizedArticles,
        setSeedCount,
        setStatus,
        setTopicsLoaded,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [articles, enabled, isFavorite]);

  return useMemo(() => {
    const usePersonalizedRanking = enabled && personalizedArticles !== undefined;
    return {
      breakdowns:
        usePersonalizedRanking && personalizedBreakdowns !== undefined
          ? personalizedBreakdowns
          : basicRanking.breakdowns,
      profile: enabled ? profile : undefined,
      rankedArticles: usePersonalizedRanking
        ? personalizedArticles
        : basicRanking.articles,
      seedCount: enabled ? seedCount : NO_ITEMS,
      status: enabled ? status : "basic",
      topicsLoaded: enabled ? topicsLoaded : NO_ITEMS,
    };
  }, [
    basicRanking.articles,
    basicRanking.breakdowns,
    enabled,
    personalizedArticles,
    personalizedBreakdowns,
    profile,
    seedCount,
    status,
    topicsLoaded,
  ]);
};
