import type { DeepReadonly, ReadonlyNewsArticle } from "@/app/search/research/model/types";
import type { CountryArticleCounts } from "@/lib/api";

type ReadonlyArticle = ReadonlyNewsArticle;
type ArticleList = readonly ReadonlyArticle[];
type ReadonlyCountryArticleCounts = DeepReadonly<CountryArticleCounts>;
type CountrySelection = string | null;
type ExpandedSortMode = "recent" | "oldest" | "source";

interface SourceSummaryEntry {
  readonly name: string;
  readonly count: number;
}

interface WorkspaceSource extends SourceSummaryEntry {
  readonly latestArticle: ReadonlyArticle | undefined;
  readonly latestPublishedAt: string | undefined;
  readonly credibilityShare: number;
  readonly countries: readonly string[];
}

interface WorkspaceLeader extends WorkspaceSource {
  readonly share: number;
}

interface CoverageEntry {
  readonly country: string;
  readonly count: number;
}

interface TopicSignalEntry {
  readonly label: string;
  readonly count: number;
}

interface VerificationStats {
  readonly highPct: number;
}

const EMPTY_COUNT = 0;
const FIRST_INDEX = 0;
const COVERAGE_LIMIT = 6;
const MAX_PERCENT = 100;
const MIN_SOURCE_SHARE = 8;
const TOPIC_SIGNAL_LIMIT = 8;
const WORKSPACE_SOURCE_LIMIT = 12;

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > EMPTY_COUNT;

const hasCountrySelection = (country: CountrySelection): country is string =>
  country !== null && country !== "";

const sourceLabel = (article: ReadonlyArticle): string => {
  if (hasText(article.source_country) && article.source_country !== "International") {
    return `${article.source} · ${article.source_country}`;
  }
  return article.source;
};

const sourceNameFor = (article: ReadonlyArticle): string => {
  if (hasText(article.source)) {
    return article.source;
  }
  return "Unknown";
};

const articleRenderKey = (article: ReadonlyArticle, index: number): string => {
  let identity = article.url;
  if (article.id > EMPTY_COUNT) {
    identity = String(article.id);
  }
  return `${identity}-${article.url}-${index}`;
};

const signalTotal = (
  metrics: ReadonlyCountryArticleCounts | undefined,
  signalId: string,
  countryCode: CountrySelection,
): number => {
  if (metrics?.geo_signals === undefined || countryCode === null || countryCode === "") {
    return EMPTY_COUNT;
  }
  const signal = metrics.geo_signals.find((item) => item.id === signalId);
  return signal?.country_counts[countryCode] ?? EMPTY_COUNT;
};

const intensityLabel = (metrics?: ReadonlyCountryArticleCounts): string => {
  if (!metrics?.counts) {
    return "Coverage heat";
  }
  if (metrics.window_hours !== undefined && metrics.window_hours > EMPTY_COUNT) {
    return `Coverage heat · ${metrics.window_hours}h`;
  }
  return "Coverage heat";
};

const buildSourceCoverageLeaders = (
  sourceWorkspace: readonly WorkspaceSource[],
): WorkspaceLeader[] => {
  const [leadSource] = sourceWorkspace;
  if (leadSource === undefined) {
    return [];
  }
  const leadCount = Math.max(leadSource.count, 1);
  return sourceWorkspace.map((source) => ({
    ...source,
    share: Math.max(MIN_SOURCE_SHARE, Math.round((source.count / leadCount) * MAX_PERCENT)),
  }));
};

const buildVerificationStats = (articles: ArticleList): VerificationStats => {
  const total = articles.length;
  if (total === EMPTY_COUNT) {
    return { highPct: EMPTY_COUNT };
  }
  const high = articles.filter((article) => article.credibility === "high").length;
  return { highPct: Math.round((high / total) * MAX_PERCENT) };
};

const getCountryMetric = (
  country: CountrySelection,
  values: Readonly<Record<string, number>> | undefined,
): number => {
  if (country === null || country === "" || values === undefined) {
    return EMPTY_COUNT;
  }
  return values[country] ?? EMPTY_COUNT;
};

const MAX_INTENSITY_SCORE = 5;

const calculateIntensityScore = (
  metrics: ReadonlyCountryArticleCounts,
  selectedCountry: CountrySelection,
  selectedCountryCoverage: number,
): number => {
  if (selectedCountry === null || selectedCountry === "") {
    return EMPTY_COUNT;
  }
  const counts = Object.values(metrics.counts);
  const maxCoverage = Math.max(...counts, EMPTY_COUNT);
  if (maxCoverage === EMPTY_COUNT) {
    return EMPTY_COUNT;
  }
  return Math.max(
    1,
    Math.min(
      MAX_INTENSITY_SCORE,
      Math.ceil((selectedCountryCoverage / maxCoverage) * MAX_INTENSITY_SCORE),
    ),
  );
};

const briefingDescriptionFor = (
  selectedCountry: CountrySelection,
  localLensData: Readonly<{ view_description?: string }> | undefined,
): string => {
  if (selectedCountry === null || selectedCountry === "") {
    return "Select a country to compare what local outlets say with how the rest of the world covers it.";
  }
  if (hasText(localLensData?.view_description)) {
    return localLensData.view_description;
  }
  return "Choose a lens to compare internal and external coverage.";
};

const buildSourceSummary = (articles: ArticleList): SourceSummaryEntry[] => {
  const counts = new Map<string, number>();
  for (const article of articles) {
    const key = sourceNameFor(article);
    counts.set(key, (counts.get(key) ?? EMPTY_COUNT) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .toSorted((left, right) => right.count - left.count);
};

const buildSourceWorkspace = (
  lensArticles: ArticleList,
  sourceSummary: readonly SourceSummaryEntry[],
): WorkspaceSource[] =>
  sourceSummary.slice(0, WORKSPACE_SOURCE_LIMIT).map((source) => {
    const sourceArticles = lensArticles.filter((article) => sourceNameFor(article) === source.name);
    const highCredibilityCount = sourceArticles.filter(
      (article) => article.credibility === "high",
    ).length;
    const firstArticle = sourceArticles[FIRST_INDEX];
    let credibilityShare = EMPTY_COUNT;
    if (sourceArticles.length > EMPTY_COUNT) {
      credibilityShare = Math.round((highCredibilityCount / sourceArticles.length) * MAX_PERCENT);
    }
    const countries = [
      ...new Set(
        sourceArticles
          .map((article) => article.source_country ?? article.country)
          .filter((country): country is string => hasText(country)),
      ),
    ].slice(0, 3);
    return {
      count: source.count,
      countries,
      credibilityShare,
      latestArticle: firstArticle,
      latestPublishedAt: firstArticle?.publishedAt,
      name: source.name,
    };
  });

const buildTopicSignals = (articles: ArticleList): TopicSignalEntry[] => {
  const counts = new Map<string, number>();
  for (const article of articles) {
    const tokens = [...(article.tags ?? []), article.category, article.geo_signal?.label].filter(
      (token): token is string => hasText(token),
    );
    for (const token of tokens) {
      const normalized = token.trim();
      counts.set(normalized, (counts.get(normalized) ?? EMPTY_COUNT) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ count, label }))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, TOPIC_SIGNAL_LIMIT);
};

const buildCoverageBreakdown = (articles: ArticleList): CoverageEntry[] => {
  const counts = new Map<string, number>();
  for (const article of articles) {
    let countries: readonly string[] = [];
    if (
      article.mentioned_countries !== undefined &&
      article.mentioned_countries.length > EMPTY_COUNT
    ) {
      countries = article.mentioned_countries;
    } else if (hasText(article.source_country)) {
      countries = [article.source_country];
    }
    for (const country of countries) {
      counts.set(country, (counts.get(country) ?? EMPTY_COUNT) + 1);
    }
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ count, country }))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, COVERAGE_LIMIT);
};

const sortExpandedArticles = (
  articles: ArticleList,
  sortMode: ExpandedSortMode,
): ReadonlyArticle[] => {
  if (sortMode === "source") {
    return articles.toSorted((left, right) => {
      const sourceCompare = (left.source ?? "").localeCompare(right.source ?? "");
      if (sourceCompare !== EMPTY_COUNT) {
        return sourceCompare;
      }
      return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    });
  }
  const sorted = articles.toSorted(
    (left, right) => new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime(),
  );
  if (sortMode === "recent") {
    return sorted.toReversed();
  }
  return sorted;
};

const latestTimestamp = (articles: ArticleList): number | undefined => {
  const timestamps = articles
    .map((article) => new Date(article.publishedAt).getTime())
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === EMPTY_COUNT) {
    return void 0;
  }
  return Math.max(...timestamps);
};

export {
  articleRenderKey,
  briefingDescriptionFor,
  buildCoverageBreakdown,
  buildSourceCoverageLeaders,
  buildSourceSummary,
  buildSourceWorkspace,
  buildTopicSignals,
  buildVerificationStats,
  calculateIntensityScore,
  getCountryMetric,
  hasCountrySelection,
  hasText,
  intensityLabel,
  latestTimestamp,
  MAX_INTENSITY_SCORE,
  signalTotal,
  sortExpandedArticles,
  sourceLabel,
};
export type {
  CoverageEntry,
  CountrySelection,
  ExpandedSortMode,
  ReadonlyCountryArticleCounts,
  ReadonlyArticle,
  SourceSummaryEntry,
  TopicSignalEntry,
  WorkspaceLeader,
  WorkspaceSource,
};
