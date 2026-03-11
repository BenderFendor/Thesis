import type { NewsArticle } from "@/lib/api"

export interface SourceGroup {
  sourceId: string
  sourceName: string
  articles: NewsArticle[]
  credibility?: string
  bias?: string
}

function getArticleKey(article: NewsArticle): string {
  const url = article.url?.trim()
  if (url) return `url:${url}`
  return `id:${article.id}`
}

export function buildSourceGroups(articles: NewsArticle[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>()
  const seenArticles = new Set<string>()

  for (const article of articles) {
    const articleKey = getArticleKey(article)
    if (seenArticles.has(articleKey)) {
      continue
    }
    seenArticles.add(articleKey)

    const sourceId = article.sourceId || article.source
    const existingGroup = groups.get(sourceId)

    if (existingGroup) {
      existingGroup.articles.push(article)
      continue
    }

    groups.set(sourceId, {
      sourceId,
      sourceName: article.source,
      articles: [article],
      credibility: article.credibility,
      bias: article.bias,
    })
  }

  return Array.from(groups.values())
}

export function getVisibleSourceIds(
  sourceGroups: SourceGroup[],
  favoriteSourceIds: Set<string>,
  batchCount: number,
  batchSize: number,
): Set<string> {
  const visibleFavoriteIds = sourceGroups
    .filter((group) => favoriteSourceIds.has(group.sourceId))
    .map((group) => group.sourceId)

  const visibleNonFavoriteIds = sourceGroups
    .filter((group) => !favoriteSourceIds.has(group.sourceId))
    .slice(0, Math.max(0, batchCount) * Math.max(1, batchSize))
    .map((group) => group.sourceId)

  return new Set([...visibleFavoriteIds, ...visibleNonFavoriteIds])
}

export function getCollapsedVisibleArticleCount(
  sourceGroups: SourceGroup[],
  visibleSourceIds: Set<string>,
  collapsedArticleCount: number,
): number {
  const safeCollapsedCount = Math.max(1, collapsedArticleCount)

  return sourceGroups.reduce((total, group) => {
    if (!visibleSourceIds.has(group.sourceId)) {
      return total
    }

    return total + Math.min(group.articles.length, safeCollapsedCount)
  }, 0)
}
