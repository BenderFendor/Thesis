import type { CacheStatus, NewsArticle } from "@/lib/api"

type UnifiedNewsView = "globe" | "grid" | "scroll" | "blindspot" | "live-news"

function getSharedViewArticles(
  _view: UnifiedNewsView,
  articles:readonly  NewsArticle[],
): NewsArticle[]
function getSharedViewArticles(
  _view: UnifiedNewsView,
  articles:readonly  NewsArticle[],
): readonly NewsArticle[]
function getSharedViewArticles(
  _view: UnifiedNewsView,
  articles: readonly NewsArticle[],
): readonly NewsArticle[] {
  return articles
}

const getSharedViewLoading = (isLoading: boolean): boolean => {
  return isLoading
}

function getSharedArticleCount(
  cacheStatus: CacheStatus | null | undefined,
  totalCount: number,
  articles:readonly  NewsArticle[],
  isLoading: boolean,
): number {
  if (totalCount > 0 || (!isLoading && totalCount === 0)) {
    return totalCount
  }

  if (articles.length > 0 || !isLoading) {
    return articles.length
  }

  return cacheStatus?.total_articles ?? 0
}

function getSharedSourceCount(
  cacheStatus: CacheStatus | null | undefined,
  articles:readonly  NewsArticle[],
  isLoading: boolean,
): number {
  const sourceCount = new Set(
    articles
      .map((article) => article.sourceId || article.source)
      .filter((value): value is string => Boolean(value)),
  ).size

  if (sourceCount > 0 || !isLoading) {
    return sourceCount
  }

  return cacheStatus?.sources_working ?? 0
}
export { getSharedViewArticles, getSharedViewLoading, getSharedArticleCount, getSharedSourceCount };
export type { UnifiedNewsView };
