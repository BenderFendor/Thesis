export interface ComparisonCandidateArticle {
  id: number;
  source: string;
  source_id?: string;
  published_at?: string | null;
  _parsedTimestamp?: number;
}

export interface ComparisonSourceOption<T extends ComparisonCandidateArticle> {
  sourceId: string;
  sourceName: string;
  articles: T[];
}

function normalizeSourceKey<T extends ComparisonCandidateArticle>(article: T): string {
  const explicit = article.source_id?.trim().toLowerCase();
  if (explicit) return explicit;
  return article.source.trim().toLowerCase().replace(/\s+/g, "-");
}

function recencyValue<T extends ComparisonCandidateArticle>(article: T): number {
  if (typeof article._parsedTimestamp === "number") {
    return article._parsedTimestamp;
  }
  if (!article.published_at) return 0;
  const timestamp = new Date(article.published_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildComparisonSourceOptions<
  T extends ComparisonCandidateArticle,
>(articles: readonly T[]): ComparisonSourceOption<T>[] {
  const groups = new Map<string, ComparisonSourceOption<T>>();

  articles.forEach((article) => {
    const sourceId = normalizeSourceKey(article);
    if (!groups.has(sourceId)) {
      groups.set(sourceId, {
        sourceId,
        sourceName: article.source,
        articles: [],
      });
    }
    groups.get(sourceId)!.articles.push(article);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      articles: group.articles
        .map((article) => ({ article, recency: recencyValue(article) }))
        .sort((a, b) => b.recency - a.recency)
        .map(({ article }) => article),
    }))
    .sort((a, b) => b.articles.length - a.articles.length);
}

export function getDefaultComparisonArticleIds<
  T extends ComparisonCandidateArticle,
>(articles: readonly T[]): number[] {
  const groups = buildComparisonSourceOptions(articles);
  if (groups.length < 2) {
    return articles.slice(0, 2).map((article) => article.id);
  }

  return groups
    .slice(0, 2)
    .map((group) => group.articles[0]?.id)
    .filter((value): value is number => typeof value === "number");
}

export function getSelectedComparisonArticles<
  T extends ComparisonCandidateArticle,
>(articles: readonly T[], selectedIds: readonly number[]): T[] {
  const articleById = new Map(articles.map((article) => [article.id, article]));
  return selectedIds
    .map((id) => articleById.get(id))
    .filter((article): article is T => Boolean(article));
}
