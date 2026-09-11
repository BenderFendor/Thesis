import { hasText } from "@/lib/utils";

interface ComparisonCandidateArticle {
  readonly id: number;
  readonly source: string;
  readonly source_id?: string;
  readonly published_at?: string | null;
  readonly _parsedTimestamp?: number;
}

interface ComparisonSourceOption<ArticleType extends ComparisonCandidateArticle> {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly articles: readonly ArticleType[];
}

interface MutableComparisonSourceOption<ArticleType extends ComparisonCandidateArticle> {
  articles: ArticleType[];
  sourceId: string;
  sourceName: string;
}

const PARSED_TIMESTAMP_KEY = "_parsedTimestamp" as const;

const normalizeSourceKey = function normalizeSourceKey(
  article: ComparisonCandidateArticle,
): string {
  const explicit = article.source_id?.trim().toLowerCase();
  if (hasText(explicit)) {
    return explicit;
  }
  return article.source.trim().toLowerCase().replaceAll(/\s+/gu, "-");
};

const recencyValue = function recencyValue(article: ComparisonCandidateArticle): number {
  const parsedTimestamp = article[PARSED_TIMESTAMP_KEY];
  if (parsedTimestamp !== undefined) {
    return parsedTimestamp;
  }
  if (!hasText(article.published_at)) {
    return 0;
  }
  const timestamp = new Date(article.published_at).getTime();
  if (Number.isFinite(timestamp)) {
  return timestamp;
}
return 0;
};

const buildComparisonSourceOptions = function buildComparisonSourceOptions<
  ArticleType extends ComparisonCandidateArticle,
>(articles: readonly ArticleType[]): ComparisonSourceOption<ArticleType>[] {
  const groups = new Map<string, MutableComparisonSourceOption<ArticleType>>();

  articles.forEach((article) => {
    const sourceId = normalizeSourceKey(article);
    const group = groups.get(sourceId);
    if (group) {
      group.articles.push(article);
      return;
    }
    groups.set(sourceId, {
      articles: [article],
      sourceId,
      sourceName: article.source,
    });
  });

  return [...groups.values()]
    .map((group) => ({
      articles: group.articles
        .map((article) => ({ article, recency: recencyValue(article) }))
        .toSorted((first, second) => second.recency - first.recency)
        .map(({ article }) => article),
      sourceId: group.sourceId,
      sourceName: group.sourceName,
    }))
    .toSorted((first, second) => second.articles.length - first.articles.length);
};

const getDefaultComparisonArticleIds = function getDefaultComparisonArticleIds(
  articles: readonly ComparisonCandidateArticle[],
): number[] {
  const groups = buildComparisonSourceOptions(articles);
  if (groups.length < 2) {
    return articles.slice(0, 2).map((article) => article.id);
  }

  return groups
    .slice(0, 2)
    .map((group) => group.articles[0]?.id)
    .filter((value): value is number => typeof value === "number");
};

const getSelectedComparisonArticles = function getSelectedComparisonArticles<
  ArticleType extends ComparisonCandidateArticle,
>(articles: readonly ArticleType[], selectedIds: readonly number[]): ArticleType[] {
  const articleById = new Map(articles.map((article) => [article.id, article]));
  return selectedIds
    .map((id) => articleById.get(id))
    .filter((article): article is ArticleType => Boolean(article));
};
export {
  buildComparisonSourceOptions,
  getDefaultComparisonArticleIds,
  getSelectedComparisonArticles,
};
export type { ComparisonSourceOption };
