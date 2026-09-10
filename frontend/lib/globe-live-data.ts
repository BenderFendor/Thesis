import { hasText } from "@/lib/utils";
import type {
  CountryArticleCounts,
  CountryListResponse,
  LocalLensResponse,
  NewsArticle,
} from "@/lib/api";

const PARSED_TIMESTAMP_KEY = "_parsedTimestamp" as const;

const DEFAULT_GEO_SIGNAL = {
  id: "country_mentions",
  label: "Country mentions",
} as const;

const getSourceCountry = (article: NewsArticle): string | null => {
  const country = article.source_country ?? article.country;
  if (!country || country === "International") {
    return null;
  }
  return country;
};

const getArticleTimestamp = (article: NewsArticle): number => {
  const parsed = article[PARSED_TIMESTAMP_KEY] ?? Date.parse(article.publishedAt);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return 0;
};

const sortByNewest = (articles: readonly NewsArticle[]): NewsArticle[] =>
  [...articles].toSorted((left, right) => getArticleTimestamp(right) - getArticleTimestamp(left));

const dedupeArticles = (articles: readonly NewsArticle[]): NewsArticle[] => {
  const seenFallbackKeys = new Set<string>(),
    seenIds = new Set<number>();

  return articles.filter((article) => {
    if (seenIds.has(article.id)) {
      return false;
    }
    seenIds.add(article.id);

    const fallbackKey = `${article.url}::${article.source}::${article.title}`;
    if (seenFallbackKeys.has(fallbackKey)) {
      return false;
    }
    seenFallbackKeys.add(fallbackKey);
    return true;
  });
};

const countDistinctSources = (articles: readonly NewsArticle[]): number =>
  new Set(
    articles
      .map((article) => article.sourceId || article.source)
      .filter((value): value is string => Boolean(value)),
  ).size;

const sumCountValues = (counts: Readonly<Record<string, number>>): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

interface CountryArticleCountState {
  readonly articlesWithCountry: number;
  readonly mentionCounts: Record<string, number>;
  readonly sourceCounts: Record<string, number>;
}

const collectCountryArticleCounts = (
  articles: readonly NewsArticle[],
): CountryArticleCountState => {
  const mentionCounts: Record<string, number> = {},
    sourceCounts: Record<string, number> = {};
  let articlesWithCountry = 0;

  articles.forEach((article) => {
    const sourceCountry = getSourceCountry(article);
    if (hasText(sourceCountry)) {
      sourceCounts[sourceCountry] = (sourceCounts[sourceCountry] ?? 0) + 1;
    }

    const mentions = article.mentioned_countries ?? [];
    if (mentions.length === 0) {
      return;
    }

    articlesWithCountry += 1;
    mentions.forEach((countryCode) => {
      mentionCounts[countryCode] = (mentionCounts[countryCode] ?? 0) + 1;
    });
  });

  return { articlesWithCountry, mentionCounts, sourceCounts };
};

const buildCountryGeoSignals = (
  mentionCounts: Readonly<Record<string, number>>,
  sourceCounts: Readonly<Record<string, number>>,
  articlesWithCountry: number,
): CountryArticleCounts["geo_signals"] => [
  {
    ...DEFAULT_GEO_SIGNAL,
    article_count: articlesWithCountry,
    country_count: Object.keys(mentionCounts).length,
    country_counts: mentionCounts,
    total_mentions: sumCountValues(mentionCounts),
  },
  {
    article_count: sumCountValues(sourceCounts),
    country_count: Object.keys(sourceCounts).length,
    country_counts: sourceCounts,
    id: "source_origin",
    label: "Source origin",
    total_mentions: sumCountValues(sourceCounts),
  },
];

const buildCountryMetricsFromArticles = (
  articles: readonly NewsArticle[],
): CountryArticleCounts => {
  const { articlesWithCountry, mentionCounts, sourceCounts } =
    collectCountryArticleCounts(articles);
  return {
    articles_with_country: articlesWithCountry,
    articles_without_country: articles.length - articlesWithCountry,
    country_count: Object.keys(mentionCounts).length,
    counts: mentionCounts,
    geo_signals: buildCountryGeoSignals(mentionCounts, sourceCounts, articlesWithCountry),
    source_counts: sourceCounts,
    total_articles: articles.length,
  };
};

interface CountryStat {
  readonly articleCount: number;
  readonly latestTimestamp: number;
  readonly latestArticle: string | null;
}

const updateExistingCountryStat = (
  current: Readonly<CountryStat>,
  article: NewsArticle,
  timestamp: number,
): CountryStat => {
  const next = { ...current, articleCount: current.articleCount + 1 };
  if (timestamp > current.latestTimestamp) {
    return {
      ...next,
      latestArticle: article.publishedAt || null,
      latestTimestamp: timestamp,
    };
  }
  return next;
};

const updateCountryStats = (countryStats: Map<string, CountryStat>, article: NewsArticle): void => {
  const sourceCountry = getSourceCountry(article);
  if (!hasText(sourceCountry)) {
    return;
  }

  const current = countryStats.get(sourceCountry),
    timestamp = getArticleTimestamp(article);
  if (!current) {
    countryStats.set(sourceCountry, {
      articleCount: 1,
      latestArticle: article.publishedAt || null,
      latestTimestamp: timestamp,
    });
    return;
  }

  countryStats.set(sourceCountry, updateExistingCountryStat(current, article, timestamp));
};

const buildCountryListFromArticles = (articles: readonly NewsArticle[]): CountryListResponse => {
  const countryStats = new Map<string, CountryStat>();
  articles.forEach((article) => {
    updateCountryStats(countryStats, article);
  });

  const countries = [...countryStats.entries()]
    .map(([code, stats]) => ({
      article_count: stats.articleCount,
      code,
      latest_article: stats.latestArticle,
    }))
    .toSorted(
      (left, right) =>
        right.article_count - left.article_count || left.code.localeCompare(right.code),
    );

  return {
    countries,
    total_countries: countries.length,
  };
};

type LocalLensView = "internal" | "external";

interface LocalLensRequest {
  readonly articles: readonly NewsArticle[];
  readonly code: string;
  readonly countryName: string;
  readonly limit: number;
  readonly view: LocalLensView;
}

interface LocalLensArticleSets {
  readonly internalPrimary: readonly NewsArticle[];
  readonly internalFallback: readonly NewsArticle[];
  readonly externalMatches: readonly NewsArticle[];
}

const findLocalLensArticleSets = (
  articles: readonly NewsArticle[],
  codeUpper: string,
): LocalLensArticleSets => ({
  externalMatches: articles.filter((article) => {
    const sourceCountry = getSourceCountry(article);
    return (
      sourceCountry !== null &&
      sourceCountry !== codeUpper &&
      (article.mentioned_countries ?? []).includes(codeUpper)
    );
  }),
  internalFallback: articles.filter((article) => getSourceCountry(article) === codeUpper),
  internalPrimary: articles.filter(
    (article) =>
      getSourceCountry(article) === codeUpper &&
      (article.mentioned_countries ?? []).includes(codeUpper),
  ),
});

const selectLocalLensArticles = (
  view: LocalLensView,
  articleSets: LocalLensArticleSets,
): readonly NewsArticle[] => {
  if (view === "internal") {
    if (articleSets.internalPrimary.length > 0) {
      return articleSets.internalPrimary;
    }
    return articleSets.internalFallback;
  }
  return articleSets.externalMatches;
};

const usesLocalSourceFallback = (view: LocalLensView, articleSets: LocalLensArticleSets): boolean =>
  view === "internal" &&
  articleSets.internalPrimary.length === 0 &&
  articleSets.internalFallback.length > 0;

const getLocalLensGeoSignal = (usesSourceFallback: boolean) => {
  if (usesSourceFallback) {
    return {
      id: "source_origin",
      label: "Source origin",
    } as const;
  }
  return DEFAULT_GEO_SIGNAL;
};

const getLocalLensMatchingStrategy = (
  view: LocalLensView,
  usesSourceFallback: boolean,
): LocalLensResponse["matching_strategy"] => {
  if (view === "internal" && usesSourceFallback) {
    return "source_origin_fallback";
  }
  return "country_mentions";
};

const getLocalLensDescription = (
  view: LocalLensView,
  usesSourceFallback: boolean,
  countryName: string,
): string => {
  if (view === "internal" && usesSourceFallback) {
    return `Recent reporting from sources based in ${countryName}`;
  }
  if (view === "internal") {
    return `How sources in ${countryName} cover ${countryName}`;
  }
  return `How outside sources cover ${countryName}`;
};

const buildLocalLensFromArticles = ({
  articles,
  code,
  countryName,
  view,
  limit,
}: LocalLensRequest): LocalLensResponse => {
  const codeUpper = code.toUpperCase();
  const sortedArticles = sortByNewest(articles);
  const articleSets = findLocalLensArticleSets(sortedArticles, codeUpper);
  const fullResult = dedupeArticles(selectLocalLensArticles(view, articleSets));
  const usesSourceFallback = usesLocalSourceFallback(view, articleSets);
  const limitedArticles = fullResult.slice(0, limit);

  return {
    articles: limitedArticles,
    country_code: codeUpper,
    country_name: countryName,
    geo_signal: getLocalLensGeoSignal(usesSourceFallback),
    has_more: fullResult.length > limit,
    limit,
    matching_strategy: getLocalLensMatchingStrategy(view, usesSourceFallback),
    offset: 0,
    returned: limitedArticles.length,
    source_count: countDistinctSources(fullResult),
    total: fullResult.length,
    view,
    view_description: getLocalLensDescription(view, usesSourceFallback, countryName),
    window_hours: null,
  };
};
export {
  buildCountryMetricsFromArticles,
  buildCountryListFromArticles,
  buildLocalLensFromArticles,
};
