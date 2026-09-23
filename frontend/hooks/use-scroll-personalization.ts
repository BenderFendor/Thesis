"use client";

import type { ArticleTopic, BookmarkEntry, LikedEntry, NewsArticle } from "@/lib/api";

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
import {
  fetchBookmarks,
  fetchBulkArticleTopics,
  fetchLikedArticles,
  mapBackendArticle,
} from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useEffect, useMemo, useRef, useState } from "react";

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
  readonly setBreakdowns: (value: Readonly<Record<number, FeedScoreBreakdown>> | undefined) => void;
  readonly setProfile: (value: Readonly<InterestProfile> | undefined) => void;
  readonly setRankedArticles: (value: readonly NewsArticle[] | undefined) => void;
  readonly setSeedCount: (value: number) => void;
  readonly setStatus: (value: PersonalizationStatus) => void;
  readonly setTopicsLoaded: (value: number) => void;
}

type TopicMap = Record<number, readonly ArticleTopic[]>;

const NO_ITEMS = 0;
const REQUEST_VERSION_INCREMENT = 1;
const topicCache = new Map<number, readonly ArticleTopic[]>();
const getSeedTimestamp = (seed: Readonly<PersonalizationSeed>): number => {
    if (seed.createdAt === undefined) {
      return NO_ITEMS;
    }
    return new Date(seed.createdAt).getTime();
  };
const savedEntryToNewsArticle = (entry: Readonly<BookmarkEntry | LikedEntry>): NewsArticle =>
    mapBackendArticle({
      article_id: entry.article_id,
      category: entry.category,
      image: entry.image,
      published: entry.published,
      source: entry.source,
      summary: entry.summary,
      title: entry.title,
      url: entry.url,
    });
const mergeBookmarkSeed = (
    merged: Map<number, PersonalizationSeed>,
    bookmark: Readonly<BookmarkEntry>,
  ): void => {
    const existing = merged.get(bookmark.article_id);
    merged.set(bookmark.article_id, {
      article: savedEntryToNewsArticle(bookmark),
      bookmarked: true,
      createdAt: bookmark.created_at ?? undefined,
      liked: existing?.liked ?? false,
    });
  };
const mergeLikedSeed = (
    merged: Map<number, PersonalizationSeed>,
    liked: Readonly<LikedEntry>,
  ): void => {
    const existing = merged.get(liked.article_id);
    merged.set(liked.article_id, {
      article: savedEntryToNewsArticle(liked),
      bookmarked: existing?.bookmarked ?? false,
      createdAt: existing?.createdAt ?? liked.created_at ?? undefined,
      liked: true,
    });
  };
const dedupeSeeds = (
    bookmarks: readonly DeepReadonly<BookmarkEntry>[],
    likes: readonly DeepReadonly<LikedEntry>[],
  ): PersonalizationSeed[] => {
    const merged = new Map<number, PersonalizationSeed>();
    for (const bookmark of bookmarks) {
      mergeBookmarkSeed(merged, bookmark);
    }
    for (const liked of likes) {
      mergeLikedSeed(merged, liked);
    }
    return [...merged.values()]
      .toSorted((left, right) => getSeedTimestamp(right) - getSeedTimestamp(left))
      .slice(NO_ITEMS, MAX_PERSONALIZATION_SEEDS);
  };
const getArticleIds = (
    articles: readonly NewsArticle[],
    seeds: readonly PersonalizationSeed[],
  ): number[] => [
    ...new Set([...articles.map((article) => article.id), ...seeds.map((seed) => seed.article.id)]),
  ];
const buildTopicMap = (articleIds: readonly number[]): TopicMap => {
    const entries = articleIds.flatMap((articleId) => {
      const cached = topicCache.get(articleId);
      if (cached === undefined) {
  return [];
}
return [[articleId, cached] as const];
    });
    const topicMap = Object.fromEntries(entries) satisfies TopicMap;
    return topicMap;
  };
const cacheTopicResponse = (articles: Readonly<Record<number, readonly ArticleTopic[]>>): void => {
    for (const articleIdText of Object.keys(articles)) {
      const articleId = Number(articleIdText),
        topics = articles[articleId];
      if (topics !== undefined) {
        topicCache.set(articleId, topics);
      }
    }
  };
const hydrateMissingTopics = async (articleIds: readonly number[]): Promise<boolean> => {
    const missingIds = articleIds.filter((articleId) => !topicCache.has(articleId));
    if (missingIds.length === NO_ITEMS) {
      return true;
    }
    try {
      const response = await fetchBulkArticleTopics(missingIds);
      cacheTopicResponse(response.articles);
      return true;
    } catch {
      return false;
    }
  };
const createBasicResult = (seedCount = NO_ITEMS): PersonalizationLoadResult => ({
    seedCount,
    status: "basic",
    topicsLoaded: topicCache.size,
  });
const createFallbackResult = (seedCount = NO_ITEMS): PersonalizationLoadResult => ({
    seedCount,
    status: "fallback",
    topicsLoaded: topicCache.size,
  });
type PersonalizationSeedEntries = Readonly<{
  bookmarks: BookmarkEntry[];
  likes: LikedEntry[];
}>;

const fetchPersonalizationSeedEntries = async (): Promise<PersonalizationSeedEntries | undefined> => {
    try {
      const [bookmarkResponse, likedResponse] = await Promise.all([
        fetchBookmarks(),
        fetchLikedArticles(),
      ]);
      return { bookmarks: bookmarkResponse.bookmarks, likes: likedResponse.liked };
    } catch {
      return void 0;
    }
  };
const loadPersonalizationForSeeds = async (
    articles: readonly NewsArticle[],
    seeds: readonly PersonalizationSeed[],
    isFavorite: (sourceId: string) => boolean,
  ): Promise<PersonalizationLoadResult> => {
    const articleIds = getArticleIds(articles, seeds),
      topicsAvailable = await hydrateMissingTopics(articleIds);
    if (!topicsAvailable) {
      return createFallbackResult(seeds.length);
    }
    const topicMap = buildTopicMap(articleIds);
    const profile = buildInterestProfile(seeds, topicMap);
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
  };
const loadPersonalization = async (
    articles: readonly NewsArticle[],
    isFavorite: (sourceId: string) => boolean,
  ): Promise<PersonalizationLoadResult> => {
    const seedEntries = await fetchPersonalizationSeedEntries();
    if (seedEntries === undefined) {
      return createFallbackResult();
    }
    const seeds = dedupeSeeds(seedEntries.bookmarks, seedEntries.likes);
    if (seeds.length === NO_ITEMS) {
      return createBasicResult();
    }
    return loadPersonalizationForSeeds(articles, seeds, isFavorite);
  };
const applyLoadResult = (
    result: DeepReadonly<PersonalizationLoadResult>,
    setters: Readonly<PersonalizationSetters>,
  ): void => {
    setters.setProfile(result.profile);
    setters.setRankedArticles(result.ranking?.articles);
    setters.setBreakdowns(result.ranking?.breakdowns);
    setters.setSeedCount(result.seedCount);
    setters.setStatus(result.status);
    setters.setTopicsLoaded(result.topicsLoaded);
  };

interface PersonalizationLoaderOptions extends PersonalizationSetters {
  readonly articles: readonly NewsArticle[];
  readonly enabled: boolean;
  readonly isFavorite: (sourceId: string) => boolean;
}

interface PersonalizationResultOptions {
  readonly basicRanking: Readonly<RankedFeedResult>;
  readonly enabled: boolean;
  readonly personalizedArticles: readonly NewsArticle[] | undefined;
  readonly personalizedBreakdowns: Readonly<Record<number, FeedScoreBreakdown>> | undefined;
  readonly profile: Readonly<InterestProfile> | undefined;
  readonly seedCount: number;
  readonly status: PersonalizationStatus;
  readonly topicsLoaded: number;
}

const usePersonalizationLoader = ({
  articles,
  enabled,
  isFavorite,
  setBreakdowns,
  setProfile,
  setRankedArticles,
  setSeedCount,
  setStatus,
  setTopicsLoaded,
}: Readonly<PersonalizationLoaderOptions>): void => {
  const requestVersionRef = useRef(NO_ITEMS);
  useEffect(() => {
    requestVersionRef.current += REQUEST_VERSION_INCREMENT;
    const requestVersion = requestVersionRef.current;
    if (!enabled) {
      return () => {};
    }
    let cancelled = false;
    globalThis.queueMicrotask(() => {
      if (!cancelled) {
        setStatus("loading");
      }
    });
    const load = async (): Promise<void> => {
      const result = await loadPersonalization(articles, isFavorite);
      const requestIsCurrent = requestVersionRef.current === requestVersion;
      if (cancelled || !requestIsCurrent) {
        return;
      }
      applyLoadResult(result, {
        setBreakdowns,
        setProfile,
        setRankedArticles,
        setSeedCount,
        setStatus,
        setTopicsLoaded,
      });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [articles, enabled, isFavorite, setBreakdowns, setProfile, setRankedArticles, setSeedCount, setStatus, setTopicsLoaded]);
};

const createPersonalizationResult = (
  options: DeepReadonly<PersonalizationResultOptions>,
): UseScrollPersonalizationResult => {
  const {
    basicRanking,
    enabled,
    personalizedArticles,
    personalizedBreakdowns,
    profile,
    seedCount,
    status,
    topicsLoaded,
  } = options;
  const usePersonalizedRanking = enabled && personalizedArticles !== undefined;
  return {
    breakdowns:
      (() => {
        if (usePersonalizedRanking && personalizedBreakdowns !== undefined) { return personalizedBreakdowns; }
        return basicRanking.breakdowns;
      })(),
    profile: (() => {
      if (enabled) { return profile; }
      return void 0;
    })(),
    rankedArticles: (() => {
      if (usePersonalizedRanking) { return personalizedArticles; }
      return basicRanking.articles;
    })(),
    seedCount: (() => {
      if (enabled) { return seedCount; }
      return NO_ITEMS;
    })(),
    status: (() => {
      if (enabled) { return status; }
      return "basic";
    })(),
    topicsLoaded: (() => {
      if (enabled) { return topicsLoaded; }
      return NO_ITEMS;
    })(),
  };
};

export const useScrollPersonalization = ({
  articles,
  enabled = true,
  isFavorite,
}: Readonly<UseScrollPersonalizationOptions>): UseScrollPersonalizationResult => {
  const basicRanking = useMemo(() => rankFeedArticles(articles, undefined, isFavorite), [articles, isFavorite]),
    [status, setStatus] = useState<PersonalizationStatus>("basic"),
    [profile, setProfile] = useState<Readonly<InterestProfile>>(),
    [personalizedBreakdowns, setPersonalizedBreakdowns] =
      useState<Readonly<Record<number, FeedScoreBreakdown>>>(),
    [personalizedArticles, setPersonalizedArticles] = useState<readonly NewsArticle[]>(),
    [topicsLoaded, setTopicsLoaded] = useState(NO_ITEMS),
    [seedCount, setSeedCount] = useState(NO_ITEMS);
  usePersonalizationLoader({
    articles,
    enabled,
    isFavorite,
    setBreakdowns: setPersonalizedBreakdowns,
    setProfile,
    setRankedArticles: setPersonalizedArticles,
    setSeedCount,
    setStatus,
    setTopicsLoaded,
  });
  return useMemo(
    () =>
      createPersonalizationResult({
        basicRanking,
        enabled,
        personalizedArticles,
        personalizedBreakdowns,
        profile,
        seedCount,
        status,
        topicsLoaded,
      }),
    [
      basicRanking,
      enabled,
      personalizedArticles,
      personalizedBreakdowns,
      profile,
      seedCount,
      status,
      topicsLoaded,
    ],
  );
};
