import { hasText } from "@/lib/utils";
import type { NewsArticle } from "@/lib/api";

interface SourceGroup {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly articles: readonly NewsArticle[];
  readonly credibility?: string;
  readonly bias?: string;
  readonly sourceCountry?: string;
}

interface MutableSourceGroup extends Omit<SourceGroup, "articles"> {
  articles: NewsArticle[];
}

const PARSED_TIMESTAMP_KEY = "_parsedTimestamp" as const;

const UNITED_STATES_PRIORITY_COUNTRIES = new Set([
  "US",
  "USA",
  "UNITED STATES",
  "UNITED STATES OF AMERICA",
]);

const isUnitedStatesSource = (group: SourceGroup): boolean => {
  const sourceCountry = group.sourceCountry?.trim().toUpperCase();
  if (hasText(sourceCountry) && UNITED_STATES_PRIORITY_COUNTRIES.has(sourceCountry)) {
    return true;
  }

  return group.articles.some((article) => {
    const articleSourceCountry = article.source_country?.trim().toUpperCase();
    if (hasText(articleSourceCountry) && UNITED_STATES_PRIORITY_COUNTRIES.has(articleSourceCountry)) {
      return true;
    }

    const articleCountry = article.country?.trim().toUpperCase();
    return Boolean(articleCountry && UNITED_STATES_PRIORITY_COUNTRIES.has(articleCountry));
  });
};

const getArticleKey = (article: NewsArticle): string => {
  const url = article.url?.trim();
  if (url) {
    return `url:${url}`;
  }
  return `id:${article.id}`;
};

const buildSourceGroups = (articles: readonly NewsArticle[]): SourceGroup[] => {
  const groups = new Map<string, MutableSourceGroup>(),
    seenArticles = new Set<string>();

  for (const article of articles) {
    const articleKey = getArticleKey(article);
    if (!seenArticles.has(articleKey)) {
      seenArticles.add(articleKey);

      const sourceId = article.sourceId || article.source;
      const existingGroup = groups.get(sourceId);

      if (existingGroup) {
        existingGroup.articles.push(article);
      } else {
        groups.set(sourceId, {
          articles: [article],
          bias: article.bias,
          credibility: article.credibility,
          sourceCountry: article.source_country ?? article.country,
          sourceId,
          sourceName: article.source,
        });
      }
    }
  }

  return [...groups.values()];
};

const compareSourceGroupsForGrid = (a: SourceGroup, b: SourceGroup): number => {
  const aIsUnitedStates = (() => {
  if (isUnitedStatesSource(a)) {
    return 1;
  }
  return 0;
})(),
    bIsUnitedStates = (() => {
  if (isUnitedStatesSource(b)) {
    return 1;
  }
  return 0;
})();
  if (aIsUnitedStates !== bIsUnitedStates) {
    return bIsUnitedStates - aIsUnitedStates;
  }

  const aLatestTimestamp = Math.max(
      ...a.articles.map((article) => article[PARSED_TIMESTAMP_KEY] ?? 0),
    ),
    bLatestTimestamp = Math.max(
      ...b.articles.map((article) => article[PARSED_TIMESTAMP_KEY] ?? 0),
    );
  if (aLatestTimestamp !== bLatestTimestamp) {
    return bLatestTimestamp - aLatestTimestamp;
  }

  const nameSort = a.sourceName.localeCompare(b.sourceName);
  if (nameSort !== 0) {
    return nameSort;
  }

  return a.sourceId.localeCompare(b.sourceId);
};

const getVisibleSourceIds = (
  sourceGroups: readonly SourceGroup[],
  favoriteSourceIds: ReadonlySet<string>,
  batchCount: number,
  batchSize: number,
): Set<string> => {
  const visibleFavoriteIds = sourceGroups
      .filter((group) => favoriteSourceIds.has(group.sourceId))
      .map((group) => group.sourceId),
    visibleNonFavoriteIds = sourceGroups
      .filter((group) => !favoriteSourceIds.has(group.sourceId))
      .slice(0, Math.max(0, batchCount) * Math.max(1, batchSize))
      .map((group) => group.sourceId);

  return new Set([...visibleFavoriteIds, ...visibleNonFavoriteIds]);
};

export { buildSourceGroups, compareSourceGroupsForGrid, getVisibleSourceIds };
export type { SourceGroup };
