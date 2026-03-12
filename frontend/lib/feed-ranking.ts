import { ArticleTopic, NewsArticle } from "@/lib/api"

export const SCROLL_PAGE_SIZE = 500
export const SCROLL_INITIAL_RENDER_COUNT = 60
export const SCROLL_RENDER_CHUNK_SIZE = 40
export const SCROLL_REVEAL_THRESHOLD = 8
export const SCROLL_BUFFER_FETCH_THRESHOLD = 120
export const MAX_PERSONALIZATION_SEEDS = 60

export const BOOKMARK_SIGNAL_WEIGHT = 2
export const LIKE_SIGNAL_WEIGHT = 1
export const PROFILE_CLUSTER_BOOKMARK_WEIGHT = 8
export const PROFILE_CLUSTER_LIKE_WEIGHT = 4
export const PROFILE_KEYWORD_BOOKMARK_WEIGHT = 3
export const PROFILE_KEYWORD_LIKE_WEIGHT = 1.5
export const PROFILE_CATEGORY_BOOKMARK_WEIGHT = 2
export const PROFILE_CATEGORY_LIKE_WEIGHT = 1
export const PROFILE_SOURCE_BOOKMARK_WEIGHT = 2
export const PROFILE_SOURCE_LIKE_WEIGHT = 1
export const KEYWORD_SCORE_CAP = 10
export const CATEGORY_SCORE_CAP = 4
export const SOURCE_SCORE_CAP = 2

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
])

export interface PersonalizationSeed {
  article: NewsArticle
  liked: boolean
  bookmarked: boolean
  createdAt?: string
}

export interface InterestProfile {
  clusterWeights: Record<number, number>
  keywordWeights: Record<string, number>
  categoryWeights: Record<string, number>
  sourceWeights: Record<string, number>
  bookmarkCount: number
  likeCount: number
  seedArticleCount: number
  topKeywords: string[]
  topClusters: Array<{ label: string; weight: number }>
}

export interface FeedScoreBreakdown {
  articleId: number
  bucketRank: number
  bucketLabel: string
  totalScore: number
  personalizedScore: number
  components: {
    keywordScore: number
    categoryScore: number
    sourceScore: number
  }
  matchedKeywords: string[]
  matchedCategories: string[]
  matchedSource: string | null
}

export interface RankedFeedResult {
  articles: NewsArticle[]
  breakdowns: Record<number, FeedScoreBreakdown>
}

export interface RankingWeights {
  bookmarkWeight: number
  likeWeight: number
  keywordCap: number
  categoryCap: number
  sourceCap: number
}

export const RANKING_WEIGHTS: RankingWeights = {
  bookmarkWeight: BOOKMARK_SIGNAL_WEIGHT,
  likeWeight: LIKE_SIGNAL_WEIGHT,
  keywordCap: KEYWORD_SCORE_CAP,
  categoryCap: CATEGORY_SCORE_CAP,
  sourceCap: SOURCE_SCORE_CAP,
}

export function hasRealFeedImage(image?: string | null): boolean {
  if (!image) return false
  const trimmed = image.trim()
  if (!trimmed || trimmed === "none") return false
  const lower = trimmed.toLowerCase()
  if (lower.includes("placeholder") || lower.endsWith(".svg")) return false
  return !lower.includes("logo") && !lower.includes("punch") && !lower.includes("header") && !lower.includes("icon")
}

export function normalizeToken(value: string): string {
  return value.trim().toLowerCase()
}

export function tokenizeArticle(article: NewsArticle): string[] {
  const parts = [
    article.title,
    article.summary,
    article.category,
    article.source,
    ...(article.tags || []),
  ]
  const tokens = parts
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
  return Array.from(new Set(tokens))
}

function addWeight(target: Record<string | number, number>, key: string | number, value: number): void {
  if (!key && key !== 0) return
  target[key] = (target[key] || 0) + value
}

function collectTopicKeywords(topics: ArticleTopic[]): string[] {
  const keywords = topics.flatMap((topic) => topic.keywords || [])
  return Array.from(new Set(keywords.map(normalizeToken).filter(Boolean)))
}

function topEntries(weights: Record<string, number>, limit: number): string[] {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key)
}

function topClusterEntries(weights: Record<number, number>, labels: Record<number, string>, limit: number): Array<{ label: string; weight: number }> {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([clusterId, weight]) => ({
      label: labels[Number(clusterId)] || `cluster ${clusterId}`,
      weight,
    }))
}

export function buildInterestProfile(
  seeds: PersonalizationSeed[],
  topicsByArticleId: Record<number, ArticleTopic[]>,
): InterestProfile | null {
  if (seeds.length === 0) {
    return null
  }

  const clusterWeights: Record<number, number> = {}
  const keywordWeights: Record<string, number> = {}
  const categoryWeights: Record<string, number> = {}
  const sourceWeights: Record<string, number> = {}
  const clusterLabels: Record<number, string> = {}

  let bookmarkCount = 0
  let likeCount = 0

  for (const seed of seeds) {
    const topics = topicsByArticleId[seed.article.id] || []
    const categoryKey = normalizeToken(seed.article.category || "")
    const sourceKey = normalizeToken(seed.article.sourceId || seed.article.source || "")
    const lexicalKeywords = tokenizeArticle(seed.article)

    if (seed.bookmarked) {
      bookmarkCount += 1
      if (categoryKey) addWeight(categoryWeights, categoryKey, PROFILE_CATEGORY_BOOKMARK_WEIGHT)
      if (sourceKey) addWeight(sourceWeights, sourceKey, PROFILE_SOURCE_BOOKMARK_WEIGHT)
      for (const keyword of lexicalKeywords) {
        addWeight(keywordWeights, keyword, PROFILE_KEYWORD_BOOKMARK_WEIGHT)
      }
    }

    if (seed.liked) {
      likeCount += 1
      if (categoryKey) addWeight(categoryWeights, categoryKey, PROFILE_CATEGORY_LIKE_WEIGHT)
      if (sourceKey) addWeight(sourceWeights, sourceKey, PROFILE_SOURCE_LIKE_WEIGHT)
      for (const keyword of lexicalKeywords) {
        addWeight(keywordWeights, keyword, PROFILE_KEYWORD_LIKE_WEIGHT)
      }
    }

    for (const topic of topics) {
      clusterLabels[topic.cluster_id] = topic.label
      if (seed.bookmarked) {
        addWeight(clusterWeights, topic.cluster_id, PROFILE_CLUSTER_BOOKMARK_WEIGHT)
      }
      if (seed.liked) {
        addWeight(clusterWeights, topic.cluster_id, PROFILE_CLUSTER_LIKE_WEIGHT)
      }

      for (const keyword of collectTopicKeywords([topic])) {
        if (seed.bookmarked) {
          addWeight(keywordWeights, keyword, PROFILE_KEYWORD_BOOKMARK_WEIGHT)
        }
        if (seed.liked) {
          addWeight(keywordWeights, keyword, PROFILE_KEYWORD_LIKE_WEIGHT)
        }
      }
    }
  }

  return {
    clusterWeights,
    keywordWeights,
    categoryWeights,
    sourceWeights,
    bookmarkCount,
    likeCount,
    seedArticleCount: seeds.length,
    topKeywords: topEntries(keywordWeights, 8),
    topClusters: topClusterEntries(clusterWeights, clusterLabels, 4),
  }
}

function getBucket(article: NewsArticle, isFavorite: (sourceId: string) => boolean): { rank: number; label: string } {
  const favorite = isFavorite(article.sourceId)
  const hasImage = hasRealFeedImage(article.image)

  if (favorite && hasImage) {
    return { rank: 3, label: "favorite source + image" }
  }
  if (favorite) {
    return { rank: 2, label: "favorite source" }
  }
  if (hasImage) {
    return { rank: 1, label: "image" }
  }
  return { rank: 0, label: "default" }
}

function clamp(value: number, max: number): number {
  return Math.min(value, max)
}

export function scoreArticle(
  article: NewsArticle,
  profile: InterestProfile | null,
  isFavorite: (sourceId: string) => boolean,
): FeedScoreBreakdown {
  const bucket = getBucket(article, isFavorite)
  const tokens = tokenizeArticle(article)
  const normalizedCategory = normalizeToken(article.category || "")
  const normalizedSource = normalizeToken(article.sourceId || article.source || "")

  if (!profile) {
    return {
      articleId: article.id,
      bucketRank: bucket.rank,
      bucketLabel: bucket.label,
      totalScore: 0,
      personalizedScore: 0,
      components: {
        keywordScore: 0,
        categoryScore: 0,
        sourceScore: 0,
      },
      matchedKeywords: [],
      matchedCategories: [],
      matchedSource: null,
    }
  }

  const matchedKeywords = tokens.filter((token) => (profile.keywordWeights[token] || 0) > 0)
  const keywordScore = clamp(
    matchedKeywords.reduce((sum, token) => sum + (profile.keywordWeights[token] || 0), 0),
    KEYWORD_SCORE_CAP,
  )

  const matchedCategories = normalizedCategory && profile.categoryWeights[normalizedCategory] ? [normalizedCategory] : []
  const categoryScore = clamp(profile.categoryWeights[normalizedCategory] || 0, CATEGORY_SCORE_CAP)

  const matchedSource = normalizedSource && profile.sourceWeights[normalizedSource] ? normalizedSource : null
  const sourceScore = clamp(profile.sourceWeights[normalizedSource] || 0, SOURCE_SCORE_CAP)

  const personalizedScore = Number((keywordScore + categoryScore + sourceScore).toFixed(2))

  return {
    articleId: article.id,
    bucketRank: bucket.rank,
    bucketLabel: bucket.label,
    totalScore: personalizedScore,
    personalizedScore,
    components: {
      keywordScore: Number(keywordScore.toFixed(2)),
      categoryScore: Number(categoryScore.toFixed(2)),
      sourceScore: Number(sourceScore.toFixed(2)),
    },
    matchedKeywords: matchedKeywords.slice(0, 6),
    matchedCategories,
    matchedSource,
  }
}

export function rankFeedArticles(
  articles: NewsArticle[],
  profile: InterestProfile | null,
  isFavorite: (sourceId: string) => boolean,
): RankedFeedResult {
  const breakdowns: Record<number, FeedScoreBreakdown> = {}

  const ranked = articles
    .map((article, index) => {
      const breakdown = scoreArticle(article, profile, isFavorite)
      breakdowns[article.id] = breakdown
      return { article, index, breakdown }
    })
    .sort((a, b) => {
      if (a.breakdown.bucketRank !== b.breakdown.bucketRank) {
        return b.breakdown.bucketRank - a.breakdown.bucketRank
      }
      if (a.breakdown.totalScore !== b.breakdown.totalScore) {
        return b.breakdown.totalScore - a.breakdown.totalScore
      }
      return a.index - b.index
    })
    .map((entry) => entry.article)

  return { articles: ranked, breakdowns }
}
