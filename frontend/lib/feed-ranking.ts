import type { ArticleTopic, NewsArticle } from "@/lib/api";
import { isUsableImage } from "@/lib/article-image";

const SCROLL_INITIAL_RENDER_COUNT = 60;
const SCROLL_RENDER_CHUNK_SIZE = 40;
const SCROLL_REVEAL_THRESHOLD = 8;
const MAX_PERSONALIZATION_SEEDS = 60;

const BOOKMARK_SIGNAL_WEIGHT = 2;
const LIKE_SIGNAL_WEIGHT = 1;
const PROFILE_CLUSTER_BOOKMARK_WEIGHT = 8;
const PROFILE_CLUSTER_LIKE_WEIGHT = 4;
const PROFILE_KEYWORD_BOOKMARK_WEIGHT = 3;
const PROFILE_KEYWORD_LIKE_WEIGHT = 1.5;
const PROFILE_CATEGORY_BOOKMARK_WEIGHT = 2;
const PROFILE_CATEGORY_LIKE_WEIGHT = 1;
const PROFILE_SOURCE_BOOKMARK_WEIGHT = 2;
const PROFILE_SOURCE_LIKE_WEIGHT = 1;
const KEYWORD_SCORE_CAP = 10;
const CATEGORY_SCORE_CAP = 4;
const SOURCE_SCORE_CAP = 2;

const DEFAULT_BUCKET_RANK = 0,
  FAVORITE_BUCKET_RANK = 2,
  FAVORITE_IMAGE_BUCKET_RANK = 3,
  IMAGE_BUCKET_RANK = 1,
  MATCHED_KEYWORD_LIMIT = 6,
  MIN_TOKEN_LENGTH = 3,
  NO_SCORE = 0,
  PROFILE_COUNT_INCREMENT = 1,
  SCORE_DECIMAL_PLACES = 2,
  STOP_WORDS = new Set([
    "about",
    "after",
    "amid",
    "also",
    "and",
    "are",
    "been",
    "before",
    "from",
    "have",
    "into",
    "more",
    "news",
    "over",
    "said",
    "some",
    "than",
    "that",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "through",
    "today",
    "were",
    "what",
    "when",
    "with",
    "would",
  ]),
  TOP_CLUSTER_LIMIT = 4,
  TOP_KEYWORD_LIMIT = 8;
const FEED_IMAGE_BLOCKED_MARKERS = ["logo", "punch", "header", "icon"];

interface PersonalizationSeed {
  readonly article: NewsArticle;
  readonly bookmarked: boolean;
  readonly createdAt?: string;
  readonly liked: boolean;
}

interface WeightedCluster {
  readonly label: string;
  readonly weight: number;
}

interface InterestProfile {
  readonly bookmarkCount: number;
  readonly categoryWeights: Readonly<Record<string, number>>;
  readonly clusterWeights: Readonly<Record<number, number>>;
  readonly keywordWeights: Readonly<Record<string, number>>;
  readonly likeCount: number;
  readonly seedArticleCount: number;
  readonly sourceWeights: Readonly<Record<string, number>>;
  readonly topClusters: readonly WeightedCluster[];
  readonly topKeywords: readonly string[];
}

interface FeedScoreComponents {
  readonly categoryScore: number;
  readonly keywordScore: number;
  readonly sourceScore: number;
}

interface FeedScoreBreakdown {
  readonly articleId: number;
  readonly bucketLabel: string;
  readonly bucketRank: number;
  readonly components: Readonly<FeedScoreComponents>;
  readonly matchedCategories: readonly string[];
  readonly matchedKeywords: readonly string[];
  readonly matchedSource?: string;
  readonly personalizedScore: number;
  readonly totalScore: number;
}

interface RankedFeedResult {
  readonly articles: NewsArticle[];
  readonly breakdowns: Readonly<Record<number, FeedScoreBreakdown>>;
}

interface RankingWeights {
  readonly bookmarkWeight: number;
  readonly categoryCap: number;
  readonly keywordCap: number;
  readonly likeWeight: number;
  readonly sourceCap: number;
}

interface ProfileAccumulator {
  readonly categoryWeights: Readonly<Record<string, number>>;
  readonly clusterLabels: Readonly<Record<number, string>>;
  readonly clusterWeights: Readonly<Record<number, number>>;
  readonly keywordWeights: Readonly<Record<string, number>>;
  readonly sourceWeights: Readonly<Record<string, number>>;
  readonly bookmarkCount: number;
  readonly likeCount: number;
}

interface FeedBucket {
  readonly label: string;
  readonly rank: number;
}

interface RankedArticle {
  readonly article: NewsArticle;
  readonly breakdown: FeedScoreBreakdown;
  readonly originalIndex: number;
}

const RANKING_WEIGHTS: Readonly<RankingWeights> = {
  bookmarkWeight: BOOKMARK_SIGNAL_WEIGHT,
  categoryCap: CATEGORY_SCORE_CAP,
  keywordCap: KEYWORD_SCORE_CAP,
  likeWeight: LIKE_SIGNAL_WEIGHT,
  sourceCap: SOURCE_SCORE_CAP,
};

const normalizeToken = (value: string): string => value.trim().toLowerCase();

const tokenizeArticle = (article: NewsArticle): string[] => {
  const parts = [
      article.title,
      article.summary,
      article.category,
      article.source,
      ...(article.tags ?? []),
    ],
    tokens = parts
      .join(" ")
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s]/gu, " ")
      .split(/\s+/u)
      .map((token) => normalizeToken(token))
      .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token));
  return [...new Set(tokens)];
};

type TextWeightMap = Readonly<Record<string, number>>;
type ClusterWeightMap = Readonly<Record<number, number>>;

const addClusterWeight = (
    target: ClusterWeightMap,
    key: number,
    value: number,
  ) => ({ ...target, [key]: (target[key] ?? NO_SCORE) + value } satisfies ClusterWeightMap),
  addTextWeight = (target: TextWeightMap, key: string, value: number) => {
    if (key === "") {
      return target;
    }
    return { ...target, [key]: (target[key] ?? NO_SCORE) + value } satisfies TextWeightMap;
  },
  addTextWeights = (
    target: TextWeightMap,
    keys: readonly string[],
    value: number,
  ) => ({
    ...target,
    ...Object.fromEntries(keys.map((key) => [key, (target[key] ?? NO_SCORE) + value])),
  } satisfies TextWeightMap);

const collectTopicKeywords = (topics: readonly ArticleTopic[]): string[] => {
  const keywords = topics.flatMap((topic) => topic.keywords ?? []);
  return [...new Set(keywords.map((keyword) => normalizeToken(keyword)))].filter(
    (keyword) => keyword.length > NO_SCORE,
  );
};

const topEntries = (weights: TextWeightMap, limit: number): string[] =>
    Object.entries(weights)
      .toSorted((left, right) => right[1] - left[1])
      .slice(NO_SCORE, limit)
      .map(([key]) => key);
const topClusterEntries = (
    weights: ClusterWeightMap,
    labels: Readonly<Record<number, string>>,
    limit: number,
  ): WeightedCluster[] =>
    Object.entries(weights)
      .toSorted((left, right) => right[1] - left[1])
      .slice(NO_SCORE, limit)
      .map(([clusterId, weight]) => ({
        label: labels[Number(clusterId)] ?? `cluster ${clusterId}`,
        weight,
      }));
const createProfileAccumulator = (): ProfileAccumulator => ({
    bookmarkCount: NO_SCORE,
    categoryWeights: {},
    clusterLabels: {},
    clusterWeights: {},
    keywordWeights: {},
    likeCount: NO_SCORE,
    sourceWeights: {},
  });
const addLexicalSignal = (
    accumulator: ProfileAccumulator,
    categoryKey: string,
    sourceKey: string,
    keywords: readonly string[],
    signal: "bookmark" | "like",
  ): ProfileAccumulator => {
    const categoryWeight =
        (() => {
  if (signal === "bookmark") {
    return PROFILE_CATEGORY_BOOKMARK_WEIGHT;
  }
  return PROFILE_CATEGORY_LIKE_WEIGHT;
})(),
      keywordWeight =
        (() => {
  if (signal === "bookmark") {
    return PROFILE_KEYWORD_BOOKMARK_WEIGHT;
  }
  return PROFILE_KEYWORD_LIKE_WEIGHT;
})(),
      sourceWeight =
        (() => {
  if (signal === "bookmark") {
    return PROFILE_SOURCE_BOOKMARK_WEIGHT;
  }
  return PROFILE_SOURCE_LIKE_WEIGHT;
})();
    return {
      ...accumulator,
      categoryWeights: addTextWeight(accumulator.categoryWeights, categoryKey, categoryWeight),
      keywordWeights: addTextWeights(accumulator.keywordWeights, keywords, keywordWeight),
      sourceWeights: addTextWeight(accumulator.sourceWeights, sourceKey, sourceWeight),
    };
  };
const addTopicSignal = (
    accumulator: ProfileAccumulator,
    topic: ArticleTopic,
    signal: "bookmark" | "like",
  ): ProfileAccumulator => {
    const clusterWeight =
        (() => {
  if (signal === "bookmark") {
    return PROFILE_CLUSTER_BOOKMARK_WEIGHT;
  }
  return PROFILE_CLUSTER_LIKE_WEIGHT;
})(),
      keywordWeight =
        (() => {
  if (signal === "bookmark") {
    return PROFILE_KEYWORD_BOOKMARK_WEIGHT;
  }
  return PROFILE_KEYWORD_LIKE_WEIGHT;
})();
    return {
      ...accumulator,
      clusterWeights: addClusterWeight(accumulator.clusterWeights, topic.cluster_id, clusterWeight),
      keywordWeights: addTextWeights(
        accumulator.keywordWeights,
        collectTopicKeywords([topic]),
        keywordWeight,
      ),
    };
  };
const applyTopicSignals = (
    accumulator: ProfileAccumulator,
    topics: readonly ArticleTopic[],
    bookmarked: boolean,
    liked: boolean,
  ): ProfileAccumulator => {
    let next = accumulator;
    for (const topic of topics) {
      if (bookmarked) {
        next = addTopicSignal(next, topic, "bookmark");
      }
      if (liked) {
        next = addTopicSignal(next, topic, "like");
      }
    }
    return next;
  };
const applySeedSignals = (
    accumulator: ProfileAccumulator,
    seed: PersonalizationSeed,
    topics: readonly ArticleTopic[],
  ): ProfileAccumulator => {
    const categoryKey = normalizeToken(seed.article.category ?? ""),
      lexicalKeywords = tokenizeArticle(seed.article),
      sourceKey = normalizeToken(seed.article.sourceId ?? seed.article.source ?? ""),
      topicLabels = Object.fromEntries(
        topics.map((topic) => [topic.cluster_id, topic.label]),
      ) satisfies Readonly<Record<number, string>>;
    let next = {
      ...accumulator,
      clusterLabels: { ...accumulator.clusterLabels, ...topicLabels },
    };
    if (seed.bookmarked) {
      next = {
        ...addLexicalSignal(next, categoryKey, sourceKey, lexicalKeywords, "bookmark"),
        bookmarkCount: next.bookmarkCount + PROFILE_COUNT_INCREMENT,
      };
    }
    if (seed.liked) {
      next = {
        ...addLexicalSignal(next, categoryKey, sourceKey, lexicalKeywords, "like"),
        likeCount: next.likeCount + PROFILE_COUNT_INCREMENT,
      };
    }
    return applyTopicSignals(next, topics, seed.bookmarked, seed.liked);
  };
const finalizeInterestProfile = (
    accumulator: ProfileAccumulator,
    seedArticleCount: number,
  ): InterestProfile => ({
    bookmarkCount: accumulator.bookmarkCount,
    categoryWeights: accumulator.categoryWeights,
    clusterWeights: accumulator.clusterWeights,
    keywordWeights: accumulator.keywordWeights,
    likeCount: accumulator.likeCount,
    seedArticleCount,
    sourceWeights: accumulator.sourceWeights,
    topClusters: topClusterEntries(
      accumulator.clusterWeights,
      accumulator.clusterLabels,
      TOP_CLUSTER_LIMIT,
    ),
    topKeywords: topEntries(accumulator.keywordWeights, TOP_KEYWORD_LIMIT),
  });

const buildInterestProfile = (
  seeds: readonly PersonalizationSeed[],
  topicsByArticleId: Readonly<Record<number, readonly ArticleTopic[]>>,
): InterestProfile | undefined => {
  if (seeds.length === NO_SCORE) {
    return void 0;
  }
  let accumulator = createProfileAccumulator();
  for (const seed of seeds) {
    const topics = topicsByArticleId[seed.article.id] ?? [];
    accumulator = applySeedSignals(accumulator, seed, topics);
  }
  return finalizeInterestProfile(accumulator, seeds.length);
};

const clamp = (value: number, maximum: number): number => Math.min(value, maximum),
  createBasicBreakdown = (article: NewsArticle, bucket: FeedBucket): FeedScoreBreakdown => ({
    articleId: article.id,
    bucketLabel: bucket.label,
    bucketRank: bucket.rank,
    components: {
      categoryScore: NO_SCORE,
      keywordScore: NO_SCORE,
      sourceScore: NO_SCORE,
    },
    matchedCategories: [],
    matchedKeywords: [],
    personalizedScore: NO_SCORE,
    totalScore: NO_SCORE,
  }),
  getBucket = (article: NewsArticle, isFavorite: (sourceId: string) => boolean): FeedBucket => {
    const favorite = isFavorite(article.sourceId),
      hasImage =
        isUsableImage(article.image) &&
        !FEED_IMAGE_BLOCKED_MARKERS.some((marker) => article.image.toLowerCase().includes(marker));
    if (favorite && hasImage) {
      return { label: "favorite source + image", rank: FAVORITE_IMAGE_BUCKET_RANK };
    }
    if (favorite) {
      return { label: "favorite source", rank: FAVORITE_BUCKET_RANK };
    }
    if (hasImage) {
      return { label: "image", rank: IMAGE_BUCKET_RANK };
    }
    return { label: "default", rank: DEFAULT_BUCKET_RANK };
  },
  getKeywordScore = (
    matchedKeywords: readonly string[],
    profile: Readonly<InterestProfile>,
  ): number =>
    clamp(
      matchedKeywords.reduce(
        (sum, token) => sum + (profile.keywordWeights[token] ?? NO_SCORE),
        NO_SCORE,
      ),
      KEYWORD_SCORE_CAP,
    ),
  getMatchedKeywords = (tokens: readonly string[], profile: Readonly<InterestProfile>): string[] =>
    tokens.filter((token) => (profile.keywordWeights[token] ?? NO_SCORE) > NO_SCORE),
  roundScore = (score: number): number => Number(score.toFixed(SCORE_DECIMAL_PLACES));

const getScoreMetric = (
  value: string,
  weights: Readonly<Record<string, number>>,
  cap: number,
) => {
  const weight = weights[value] ?? NO_SCORE;
  return { score: clamp(weight, cap), weight };
};

const getMatchedValues = (value: string, weight: number): string[] => {
  if (weight > NO_SCORE) {
    return [value];
  }
  return [];
};

const scoreArticle = (
  article: NewsArticle,
  profile: Readonly<InterestProfile> | undefined,
  isFavorite: (sourceId: string) => boolean,
): FeedScoreBreakdown => {
  const bucket = getBucket(article, isFavorite);
  if (profile === undefined) {
    return createBasicBreakdown(article, bucket);
  }
  const articleTokens = tokenizeArticle(article),
    category = normalizeToken(article.category ?? ""),
    categoryMetric = getScoreMetric(category, profile.categoryWeights, CATEGORY_SCORE_CAP),
    keywordMatches = getMatchedKeywords(articleTokens, profile),
    keywordScore = getKeywordScore(keywordMatches, profile),
    matchedCategories = getMatchedValues(category, categoryMetric.weight),
    source = normalizeToken(article.sourceId ?? article.source ?? ""),
    sourceMetric = getScoreMetric(source, profile.sourceWeights, SOURCE_SCORE_CAP),
    sourceValue = getMatchedValues(source, sourceMetric.weight)[0],
    totalScore = roundScore(keywordScore + categoryMetric.score + sourceMetric.score);
  return {
    articleId: article.id,
    bucketLabel: bucket.label,
    bucketRank: bucket.rank,
    components: {
      categoryScore: roundScore(categoryMetric.score),
      keywordScore: roundScore(keywordScore),
      sourceScore: roundScore(sourceMetric.score),
    },
    matchedCategories,
    matchedKeywords: keywordMatches.slice(NO_SCORE, MATCHED_KEYWORD_LIMIT),
    matchedSource: sourceValue,
    personalizedScore: totalScore,
    totalScore,
  };
};

const compareRankedArticles = (
  left: Readonly<RankedArticle>,
  right: Readonly<RankedArticle>,
): number => {
  const bucketDifference = right.breakdown.bucketRank - left.breakdown.bucketRank;
  if (bucketDifference !== NO_SCORE) {
    return bucketDifference;
  }
  const scoreDifference = right.breakdown.totalScore - left.breakdown.totalScore;
  if (scoreDifference !== NO_SCORE) {
    return scoreDifference;
  }
  return left.originalIndex - right.originalIndex;
};

const rankFeedArticles = (
  articles: readonly NewsArticle[],
  profile: Readonly<InterestProfile> | undefined,
  isFavorite: (sourceId: string) => boolean,
): RankedFeedResult => {
  const breakdowns: Record<number, FeedScoreBreakdown> = {},
    ranked = articles.map((article, originalIndex): RankedArticle => {
      const breakdown = scoreArticle(article, profile, isFavorite);
      breakdowns[article.id] = breakdown;
      return { article, breakdown, originalIndex };
    });
  const sorted = ranked.toSorted(compareRankedArticles);
  return {
    articles: sorted.map((entry) => entry.article),
    breakdowns,
  };
};
export {
  SCROLL_INITIAL_RENDER_COUNT,
  SCROLL_RENDER_CHUNK_SIZE,
  SCROLL_REVEAL_THRESHOLD,
  MAX_PERSONALIZATION_SEEDS,
  RANKING_WEIGHTS,
  buildInterestProfile,
  rankFeedArticles,
};
export type { PersonalizationSeed, InterestProfile, FeedScoreBreakdown, RankedFeedResult };
