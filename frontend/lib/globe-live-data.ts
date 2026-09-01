import type {
  CountryArticleCounts,
  CountryListResponse,
  LocalLensResponse,
  NewsArticle,
} from "@/lib/api"

const DEFAULT_GEO_SIGNAL = {
  id: "country_mentions",
  label: "Country mentions",
} as const

function getSourceCountry(article: NewsArticle): string | null {
  const country = article.source_country || article.country
  if (!country || country === "International") {
    return null
  }
  return country
}

function getArticleTimestamp(article: NewsArticle): number {
  const parsed = article._parsedTimestamp ?? Date.parse(article.publishedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

function sortByNewest(articles:readonly  NewsArticle[]): NewsArticle[] {
  return [...articles].sort((left, right) => getArticleTimestamp(right) - getArticleTimestamp(left))
}

function dedupeArticles(articles:readonly  NewsArticle[]): NewsArticle[] {
  const seenIds = new Set<number>(),
   seenFallbackKeys = new Set<string>()

  return articles.filter((article) => {
    if (seenIds.has(article.id)) {
      return false
    }
    seenIds.add(article.id)

    const fallbackKey = `${article.url}::${article.source}::${article.title}`
    if (seenFallbackKeys.has(fallbackKey)) {
      return false
    }
    seenFallbackKeys.add(fallbackKey)
    return true
  })
}

function countDistinctSources(articles:readonly  NewsArticle[]): number {
  return new Set(
    articles
      .map((article) => article.sourceId || article.source)
      .filter((value): value is string => Boolean(value)),
  ).size
}

export function buildCountryMetricsFromArticles(
  articles:readonly  NewsArticle[],
): CountryArticleCounts {
  const sourceCounts: Record<string, number> = {},
   mentionCounts: Record<string, number> = {}
  let articlesWithCountry = 0

  articles.forEach((article) => {
    const sourceCountry = getSourceCountry(article)
    if (sourceCountry) {
      sourceCounts[sourceCountry] = (sourceCounts[sourceCountry] || 0) + 1
    }

    const mentions = article.mentioned_countries ?? []
    if (mentions.length === 0) {
      return
    }

    articlesWithCountry += 1
    mentions.forEach((countryCode) => {
      mentionCounts[countryCode] = (mentionCounts[countryCode] || 0) + 1
    })
  })

  return {
    articles_with_country: articlesWithCountry,
    articles_without_country: articles.length - articlesWithCountry,
    country_count: Object.keys(mentionCounts).length,
    counts: mentionCounts,
    geo_signals: [
      {
        ...DEFAULT_GEO_SIGNAL,
        article_count: articlesWithCountry,
        country_count: Object.keys(mentionCounts).length,
        country_counts: mentionCounts,
        total_mentions: Object.values(mentionCounts).reduce((sum, count) => sum + count, 0),
      },
      {
        article_count: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
        country_count: Object.keys(sourceCounts).length,
        country_counts: sourceCounts,
        id: "source_origin",
        label: "Source origin",
        total_mentions: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
      },
    ],
    source_counts: sourceCounts,
    total_articles: articles.length,
  }
}

export function buildCountryListFromArticles(
  articles:readonly  NewsArticle[],
): CountryListResponse {
  const countryStats = new Map<string, { articleCount: number; latestTimestamp: number; latestArticle: string | null }>()

  articles.forEach((article) => {
    const sourceCountry = getSourceCountry(article)
    if (!sourceCountry) {
      return
    }

    const timestamp = getArticleTimestamp(article),
     current = countryStats.get(sourceCountry)

    if (!current) {
      countryStats.set(sourceCountry, {
        articleCount: 1,
        latestArticle: article.publishedAt || null,
        latestTimestamp: timestamp,
      })
      return
    }

    current.articleCount += 1
    if (timestamp > current.latestTimestamp) {
      current.latestTimestamp = timestamp
      current.latestArticle = article.publishedAt || null
    }
  })

  const countries = [...countryStats.entries()]
    .map(([code, stats]) => ({
      article_count: stats.articleCount,
      code,
      latest_article: stats.latestArticle,
    }))
    .sort((left, right) => right.article_count - left.article_count || left.code.localeCompare(right.code))

  return {
    countries,
    total_countries: countries.length,
  }
}

export function buildLocalLensFromArticles({
  articles,
  code,
  countryName,
  view,
  limit,
}:Readonly< {
  articles: NewsArticle[]
  code: string
  countryName: string
  view: "internal" | "external"
  limit: number
}>): LocalLensResponse {
  const codeUpper = code.toUpperCase(),
   sortedArticles = sortByNewest(articles),

   internalPrimary = sortedArticles.filter((article) =>
    getSourceCountry(article) === codeUpper && (article.mentioned_countries ?? []).includes(codeUpper)
  ),

   internalFallback = sortedArticles.filter((article) => getSourceCountry(article) === codeUpper),
   externalMatches = sortedArticles.filter((article) => {
    const sourceCountry = getSourceCountry(article)
    return sourceCountry !== null && sourceCountry !== codeUpper && (article.mentioned_countries ?? []).includes(codeUpper)
  }),

   fullResult = dedupeArticles(
    view === "internal"
      ? (internalPrimary.length > 0
        ? internalPrimary
        : internalFallback)
      : externalMatches,
  ),

   usesSourceFallback = view === "internal" && internalPrimary.length === 0 && internalFallback.length > 0,
   limitedArticles = fullResult.slice(0, limit),
   geoSignal = usesSourceFallback
    ? { id: "source_origin", label: "Source origin" }
    : DEFAULT_GEO_SIGNAL

  return {
    articles: limitedArticles,
    country_code: codeUpper,
    country_name: countryName,
    geo_signal: geoSignal,
    has_more: fullResult.length > limit,
    limit,
    matching_strategy:
      view === "internal"
        ? (usesSourceFallback
          ? "source_origin_fallback"
          : "country_mentions")
        : "country_mentions",
    offset: 0,
    returned: limitedArticles.length,
    source_count: countDistinctSources(fullResult),
    total: fullResult.length,
    view,
    view_description:
      view === "internal"
        ? (usesSourceFallback
          ? `Recent reporting from sources based in ${countryName}`
          : `How sources in ${countryName} cover ${countryName}`)
        : `How outside sources cover ${countryName}`,
    window_hours: null,
  }
}
