export interface ComparisonCandidateArticle {
  id: number;
  source: string;
}

export function getDefaultComparisonArticleIds<
  T extends ComparisonCandidateArticle,
>(articles: readonly T[]): number[] {
  const distinctIds: number[] = [];
  const seenSources = new Set<string>();

  for (const article of articles) {
    const sourceKey = article.source.trim().toLowerCase();
    if (sourceKey && seenSources.has(sourceKey)) {
      continue;
    }
    seenSources.add(sourceKey);
    distinctIds.push(article.id);
    if (distinctIds.length === 2) {
      return distinctIds;
    }
  }

  return articles.slice(0, 2).map((article) => article.id);
}

export function getSelectedComparisonArticles<
  T extends ComparisonCandidateArticle,
>(articles: readonly T[], selectedIds: readonly number[]): T[] {
  const selectedIdSet = new Set(selectedIds);
  return articles.filter((article) => selectedIdSet.has(article.id));
}
