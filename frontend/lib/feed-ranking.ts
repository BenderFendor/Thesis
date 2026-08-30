import type { ArticleTopic, NewsArticle } from "@/lib/api";

export const SCROLL_PAGE_SIZE = 500;
export const SCROLL_INITIAL_RENDER_COUNT = 60;
export const SCROLL_RENDER_CHUNK_SIZE = 40;
export const SCROLL_REVEAL_THRESHOLD = 8;
export const SCROLL_BUFFER_FETCH_THRESHOLD = 120;
export const MAX_PERSONALIZATION_SEEDS = 60;

export const BOOKMARK_SIGNAL_WEIGHT = 2;
export const LIKE_SIGNAL_WEIGHT = 1;
export const PROFILE_CLUSTER_BOOKMARK_WEIGHT = 8;
export const PROFILE_CLUSTER_LIKE_WEIGHT = 4;
export const PROFILE_KEYWORD_BOOKMARK_WEIGHT = 3;
export const PROFILE_KEYWORD_LIKE_WEIGHT = 1.5;
export const PROFILE_CATEGORY_BOOKMARK_WEIGHT = 2;
export const PROFILE_CATEGORY_LIKE_WEIGHT = 1;
export const PROFILE_SOURCE_BOOKMARK_WEIGHT = 2;
export const PROFILE_SOURCE_LIKE_WEIGHT = 1;
export const KEYWORD_SCORE_CAP = 10;
export const CATEGORY_SCORE_CAP = 4;
export const SOURCE_SCORE_CAP = 2;

const DEFAULT_BUCKET_RANK = 0;
const IMAGE_BUCKET_RANK = 1;
const FAVORITE_BUCKET_RANK = 2;
const FAVORITE_IMAGE_BUCKET_RANK = 3;
const NO_SCORE = 0;
const MIN_TOKEN_LENGTH = 3;
const TOP_KEYWORD_LIMIT = 8;
const TOP_CLUSTER_LIMIT = 4;
const MATCHED_KEYWORD_LIMIT = 6;
const SCORE_DECIMAL_PLACES = 2;
const PROFILE_COUNT_INCREMENT = 1;

const STOP_WORDS = new Set([
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
]);

export interface PersonalizationSeed {
  readonly article: Readonly<NewsArticle>;
  readonly bookmarked: boolean;
  readonly createdAt?: string;
  readonly liked: boolean;
}

export interface WeightedCluster {
  readonly label: string;
  readonly weight: number;
}

export interface InterestProfile {
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

export interface FeedScoreComponents {
  readonly categoryScore: number;
  readonly keywordScore: number;
  readonly sourceScore: number;
}

export interface FeedScoreBreakdown {
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

export interface RankedFeedResult {
  readonly articles: NewsArticle[];
  readonly breakdowns: Readonly<Record<number, FeedScoreBreakdown>>;
}

export interface RankingWeights {
  readonly bookmarkWeight: number;
  readonly categoryCap: number;
  readonly keywordCap: number;
  readonly likeWeight: number;
  readonly sourceCap: number;
}

interface ProfileAccumulator {
  readonly categoryWeights: Record<string, number>;
  readonly clusterLabels: Record<number, string>;
  readonly clusterWeights: Record<number, number>;
  readonly keywordWeights: Record<string, number>;
  readonly sourceWeights: Record<string, number>;
  bookmarkCount: number;
  likeCount: number;
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

export const RANKING_WEIGHTS: Readonly<RankingWeights> = {
  bookmarkWeight: BOOKMARK_SIGNAL_WEIGHT,
  categoryCap: CATEGORY_SCORE_CAP,
  keywordCap: KEYWORD_SCORE_CAP,
  likeWeight: LIKE_SIGNAL_WEIGHT,
  sourceCap: SOURCE_SCORE_CAP,
};

export const hasRealFeedImage = (image: NewsArticle["image"]): boolean => {
  if (typeof image !== "string") {
    return false;
  }
  const trimmed = image.trim();
  if (trimmed.length === NO_SCORE || trimmed === "none") {
    return false;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("placeholder") || lower.endsWith(".svg")) {
    return false;
  }
  const blockedMarkers = ["logo", "punch", "header", "icon"];
  return !blockedMarkers.some((marker) => lower.includes(marker));
};

export const normalizeToken = (value: string): string => value.trim().toLowerCase();

export const tokenizeArticle = (article: Readonly<NewsArticle>): string[] => {
  const parts = [
    article.title,
    article.summary,
    article.category,
    article.source,
    ...(article.tags ?? []),
  ];
  const tokens = parts
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .split(/\s+/u)
    .map(normalizeToken)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token));
  return [...new Set(tokens)];
};

const addWeight = (
  target: Record<string | number, number>,
  key: string | number,
  value: number,
): void => {
  if (typeof key === "string" && key.length === NO_SCORE) {
    return;
  }
  target[key] = (target[key] ?? NO_SCORE) + value;
};

const collectTopicKeywords = (topics: readonly ArticleTopic[]): string[] => {
  const keywords = topics.flatMap((topic) => topic.keywords ?? []);
  return [...new Set(keywords.map(normalizeToken).filter((keyword) => keyword.length > NO_SCORE))];
};

const topEntries = (
  weights: Readonly<Record<string, number>>,
  limit: number,
): string[] =>
  Object.entries(weights)
    .sort((left, right) => right[1] - left[1])
    .slice(NO_SCORE, limit)
    .map(([key]) => key);

const topClusterEntries = (
  weights: Readonly<Record<number, number>>,
  labels: Readonly<Record<number, string>>,
  limit: number,
): WeightedCluster[] =>
  Object.entries(weights)
    .sort((left, right) => right[1] - left[1])
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
  accumulator: Readonly<ProfileAccumulator>,
  categoryKey: string,
  sourceKey: string,
  keywords: readonly string[],
  signal: "bookmark" | "like",
): void => {
  const categoryWeight =
    signal === "bookmark" ? PROFILE_CATEGORY_BOOKMARK_WEIGHT : PROFILE_CATEGORY_LIKE_WEIGHT;
  const sourceWeight =
    signal === "bookmark" ? PROFILE_SOURCE_BOOKMARK_WEIGHT : PROFILE_SOURCE_LIKE_WEIGHT;
  const keywordWeight =
    signal === "bookmark" ? PROFILE_KEYWORD_BOOKMARK_WEIGHT : PROFILE_KEYWORD_LIKE_WEIGHT;
  addWeight(accumulator.categoryWeights, categoryKey, categoryWeight);
  addWeight(accumulator.sourceWeights, sourceKey, sourceWeight);
  for (const keyword of keywords) {
    addWeight(accumulator.keywordWeights, keyword, keywordWeight);
  }
};

const addTopicSignal = (
  accumulator: Readonly<ProfileAccumulator>,
  topic: Readonly<ArticleTopic>,
  signal: "bookmark" | "like",
): void => {
  const clusterWeight =
    signal === "bookmark" ? PROFILE_CLUSTER_BOOKMARK_WEIGHT : PROFILE_CLUSTER_LIKE_WEIGHT;
  const keywordWeight =
    signal === "bookmark" ? PROFILE_KEYWORD_BOOKMARK_WEIGHT : PROFILE_KEYWORD_LIKE_WEIGHT;
  addWeight(accumulator.clusterWeights, topic.cluster_id, clusterWeight);
  for (const keyword of collectTopicKeywords([topic])) {
    addWeight(accumulator.keywordWeights, keyword, keywordWeight);
  }
};

const applySeedSignals = (
  accumulator: ProfileAccumulator,
  seed: Readonly<PersonalizationSeed>,
  topics: readonly ArticleTopic[],
): void => {
  const categoryKey = normalizeToken(seed.article.category ?? "");
  const sourceKey = normalizeToken(seed.article.sourceId ?? seed.article.source ?? "");
  const lexicalKeywords = tokenizeArticle(seed.article);
  if (seed.bookmarked) {
    accumulator.bookmarkCount += PROFILE_COUNT_INCREMENT;
    addLexicalSignal(accumulator, categoryKey, sourceKey, lexicalKeywords, "bookmark");
  }
  if (seed.liked) {
    accumulator.likeCount += PROFILE_COUNT_INCREMENT;
    addLexicalSignal(accumulator, categoryKey, sourceKey, lexicalKeywords, "like");
  }
  for (const topic of topics) {
    accumulator.clusterLabels[topic.cluster_id] = topic.label;
    if (seed.bookmarked) {
      addTopicSignal(accumulator, topic, "bookmark");
    }
    if (seed.liked) {
      addTopicSignal(accumulator, topic, "like");
    }
  }
};

const finalizeInterestProfile = (
  accumulator: Readonly<ProfileAccumulator>,
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

export const buildInterestProfile = (
  seeds: readonly PersonalizationSeed[],
  topicsByArticleId: Readonly<Record<number, readonly ArticleTopic[]>>,
): InterestProfile | undefined => {
  if (seeds.length === NO_SCORE) {
    return undefined;
  }
  const accumulator = createProfileAccumulator();
  for (const seed of seeds) {
    const topics = topicsByArticleId[seed.article.id] ?? [];
    applySeedSignals(accumulator, seed, topics);
  }
  return finalizeInterestProfile(accumulator, seeds.length);
};

const getBucket = (
  article: Readonly<NewsArticle>,
  isFavorite: (sourceId: string) => boolean,
): FeedBucket => {
  const favorite = isFavorite(article.sourceId);
  const hasImage = hasRealFeedImage(article.image);
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
};

const clamp = (value: number, maximum: number): number => Math.min(value, maximum);

const getMatchedKeywords = (
  tokens: readonly string[],
  profile: Readonly<InterestProfile>,
): string[] =>
  tokens.filter((token) => (profile.keywordWeights[token] ?? NO_SCORE) > NO_SCORE);

const getKeywordScore = (
  matchedKeywords: readonly string[],
  profile: Readonly<InterestProfile>,
): number =>
  clamp(
    matchedKeywords.reduce(
      (sum, token) => sum + (profile.keywordWeights[token] ?? NO_SCORE),
      NO_SCORE,
    ),
    KEYWORD_SCORE_CAP,
  );

const roundScore = (score: number): number => Number(score.toFixed(SCORE_DECIMAL_PLACES));

const createBasicBreakdown = (
  article: Readonly<NewsArticle>,
  bucket: Readonly<FeedBucket>,
): FeedScoreBreakdown => ({
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
});

export const scoreArticle = (
  article: Readonly<NewsArticle>,
  profile: Readonly<InterestProfile> | undefined,
  isFavorite: (sourceId: string) => boolean,
): FeedScoreBreakdown => {
  const bucket = getBucket(article, isFavorite);
  if (profile === undefined) {
    return createBasicBreakdown(article, bucket);
  }
  const tokens = tokenizeArticle(article);
  const normalizedCategory = normalizeToken(article.category ?? "");
  const normalizedSource = normalizeToken(article.sourceId ?? article.source ?? "");
  const matchedKeywords = getMatchedKeywords(tokens, profile);
  const keywordScore = getKeywordScore(matchedKeywords, profile);
  const categoryWeight = profile.categoryWeights[normalizedCategory] ?? NO_SCORE;
  const categoryScore = clamp(categoryWeight, CATEGORY_SCORE_CAP);
  const sourceWeight = profile.sourceWeights[normalizedSource] ?? NO_SCORE;
  const sourceScore = clamp(sourceWeight, SOURCE_SCORE_CAP);
  const personalizedScore = roundScore(keywordScore + categoryScore + sourceScore);
  const matchedCategories = categoryWeight > NO_SCORE ? [normalizedCategory] : [];
  const matchedSource = sourceWeight > NO_SCORE ? normalizedSource : undefined;
  return {
    articleId: article.id,
    bucketLabel: bucket.label,
    bucketRank: bucket.rank,
    components: {
      categoryScore: roundScore(categoryScore),
      keywordScore: roundScore(keywordScore),
      sourceScore: roundScore(sourceScore),
    },
    matchedCategories,
    matchedKeywords: matchedKeywords.slice(NO_SCORE, MATCHED_KEYWORD_LIMIT),
    matchedSource,
    personalizedScore,
    totalScore: personalizedScore,
  };
};

const compareRankedArticles = (left: Readonly<RankedArticle>, right: Readonly<RankedArticle>): number => {
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

export const rankFeedArticles = (
  articles: readonly NewsArticle[],
  profile: Readonly<InterestProfile> | undefined,
  isFavorite: (sourceId: string) => boolean,
): RankedFeedResult => {
  const breakdowns: Record<number, FeedScoreBreakdown> = {};
  const ranked = articles.map((article, originalIndex): RankedArticle => {
    const breakdown = scoreArticle(article, profile, isFavorite);
    breakdowns[article.id] = breakdown;
    return { article, breakdown, originalIndex };
  });
  ranked.sort(compareRankedArticles);
  return {
    articles: ranked.map((entry) => entry.article),
    breakdowns,
  };
};
