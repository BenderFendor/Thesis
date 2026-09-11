"use client";

import type {
  CountryArticleCounts,
  CountryListItem,
  LocalLensResponse,
  NewsArticle,
} from "@/lib/api";
import type {
  CountrySelection,
  CoverageEntry,
  ExpandedSortMode,
  ReadonlyArticle,
  ReadonlyCountryArticleCounts,
  SourceSummaryEntry,
  TopicSignalEntry,
  WorkspaceLeader,
  WorkspaceSource,
} from "@/lib/globe-workspace";
import {
  buildCountryListFromArticles,
  buildCountryMetricsFromArticles,
  buildLocalLensFromArticles,
} from "@/lib/globe-live-data";
import {
  buildCoverageBreakdown,
  buildSourceCoverageLeaders,
  buildSourceSummary,
  buildSourceWorkspace,
  buildTopicSignals,
  buildVerificationStats,
  calculateIntensityScore,
  getCountryMetric,
  intensityLabel,
  latestTimestamp,
  signalTotal,
  sortExpandedArticles,
} from "@/lib/globe-workspace";
import { useMemo } from "react";
import { z } from "zod";

const EMPTY_COUNT = 0;
const TOP_SOURCE_LIMIT = 5;
const CountryNameSchema = z.string();
type ReadonlyGeoData = Readonly<{
  readonly countries?: Readonly<Record<string, Readonly<{ readonly name?: string }>>>;
}>;

type GlobeDisplayOptions = Readonly<{
  readonly articles: readonly NewsArticle[];
  readonly geoData: ReadonlyGeoData | undefined;
  readonly selectedCountry: CountrySelection;
  readonly selectedCountryName: string | null;
  readonly lensLimit: number;
  readonly viewMode: "internal" | "external";
  readonly expandedSort: ExpandedSortMode;
}>;

interface LocalLensOptions {
  readonly articles: readonly NewsArticle[];
  readonly geoData: ReadonlyGeoData | undefined;
  readonly lensLimit: number;
  readonly selectedCountry: CountrySelection;
  readonly selectedCountryName: string | null;
  readonly viewMode: "internal" | "external";
}

interface GlobeCoreData {
  readonly countryList: ReturnType<typeof buildCountryListFromArticles>;
  readonly countryMetrics: CountryArticleCounts;
  readonly globalSourceCount: number;
  readonly globalSourceSummary: SourceSummaryEntry[];
  readonly localLensData: LocalLensResponse | undefined;
}

interface GlobeWorkspaceData {
  readonly lensArticles: readonly NewsArticle[];
  readonly sourceCoverageLeaders: WorkspaceLeader[];
  readonly sourceSummary: SourceSummaryEntry[];
  readonly sourceWorkspace: WorkspaceSource[];
  readonly verificationStats: { readonly highPct: number };
}

interface GlobePresentationData extends GlobeWorkspaceData {
  readonly articleCount: number;
  readonly countryMetrics: CountryArticleCounts;
  readonly coverageBreakdown: CoverageEntry[];
  readonly expandedArticles: ReadonlyArticle[];
  readonly focusLabel: string;
  readonly heatLabel: string;
  readonly intensityScore: number;
  readonly latestLensTimestamp: number | undefined;
  readonly localLensData: LocalLensResponse | undefined;
  readonly selectedCountryCoverage: number;
  readonly selectedCountryMentionVolume: number;
  readonly selectedCountryMeta: CountryListItem | undefined;
  readonly selectedCountryOriginVolume: number;
  readonly selectedCountrySourceVolume: number;
  readonly topSources: SourceSummaryEntry[];
  readonly topicSignals: TopicSignalEntry[];
  readonly sourceCount: number;
}

interface SelectedCountryMetrics {
  readonly intensityScore: number;
  readonly selectedCountryCoverage: number;
  readonly selectedCountryMentionVolume: number;
  readonly selectedCountryOriginVolume: number;
  readonly selectedCountrySourceVolume: number;
}

interface ArticlePresentation {
  readonly coverageBreakdown: CoverageEntry[];
  readonly expandedArticles: ReadonlyArticle[];
  readonly latestLensTimestamp: number | undefined;
  readonly topicSignals: TopicSignalEntry[];
}

interface LensSummary {
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly topSources: SourceSummaryEntry[];
}

interface ReadonlyCountryList {
  readonly countries: readonly Readonly<CountryListItem>[];
}

interface ReadonlyGlobeCoreData {
  readonly globalSourceCount: number;
  readonly globalSourceSummary: readonly Readonly<SourceSummaryEntry>[];
  readonly localLensData: LensData | undefined;
}

interface ReadonlyGlobeWorkspaceData {
  readonly sourceSummary: readonly Readonly<SourceSummaryEntry>[];
}

type LensData = Readonly<{
  readonly articles: readonly NewsArticle[];
  readonly source_count?: number;
  readonly total?: number;
}>;

const getLensArticles = (
  articles: readonly NewsArticle[],
  localLensData: LensData | undefined,
  selectedCountry: CountrySelection,
): NewsArticle[] => {
  if (selectedCountry === null || selectedCountry === "") {
    return [...articles];
  }
  if (localLensData?.articles === undefined) {
    return [];
  }
  return [...localLensData.articles];
};

const getSelectedCountryMetrics = (
  selectedCountry: CountrySelection,
  countryMetrics: ReadonlyCountryArticleCounts,
): SelectedCountryMetrics => {
  const selectedCountryCoverage = getCountryMetric(selectedCountry, countryMetrics.counts);
  const selectedCountryMentionVolume = signalTotal(
    countryMetrics,
    "country_mentions",
    selectedCountry,
  );
  const selectedCountryOriginVolume = signalTotal(countryMetrics, "source_origin", selectedCountry);
  const selectedCountrySourceVolume = getCountryMetric(
    selectedCountry,
    countryMetrics.source_counts,
  );
  return {
    intensityScore: calculateIntensityScore(
      countryMetrics,
      selectedCountry,
      selectedCountryCoverage,
    ),
    selectedCountryCoverage,
    selectedCountryMentionVolume,
    selectedCountryOriginVolume,
    selectedCountrySourceVolume,
  };
};

const getSelectedCountryMeta = (
  countryList: ReadonlyCountryList,
  selectedCountry: CountrySelection,
): CountryListItem | undefined => {
  if (selectedCountry === null || selectedCountry === "") {
    return void 0;
  }
  return countryList.countries.find((item) => item.code === selectedCountry);
};

const useSelectedCountryMeta = (
  countryList: ReadonlyCountryList,
  selectedCountry: CountrySelection,
): CountryListItem | undefined =>
  useMemo(
    () => getSelectedCountryMeta(countryList, selectedCountry),
    [countryList, selectedCountry],
  );

const getLensSummary = (
  options: GlobeDisplayOptions,
  coreData: ReadonlyGlobeCoreData,
  workspaceData: ReadonlyGlobeWorkspaceData,
): LensSummary => {
  const selectedLens = options.selectedCountry !== null && options.selectedCountry !== "";
  let articleCount = options.articles.length;
  let sourceCount = coreData.globalSourceCount;
  let sourceSummary = coreData.globalSourceSummary;
  if (selectedLens) {
    articleCount = coreData.localLensData?.total ?? EMPTY_COUNT;
    sourceCount = coreData.localLensData?.source_count ?? workspaceData.sourceSummary.length;
    sourceSummary = workspaceData.sourceSummary;
  }
  return {
    articleCount,
    sourceCount,
    topSources: sourceSummary.slice(0, TOP_SOURCE_LIMIT),
  };
};

const useGlobeArticlePresentation = (
  lensArticles: readonly NewsArticle[],
  expandedSort: ExpandedSortMode,
): ArticlePresentation =>
  useMemo(
    () => ({
      coverageBreakdown: buildCoverageBreakdown(lensArticles),
      expandedArticles: sortExpandedArticles(lensArticles, expandedSort),
      latestLensTimestamp: latestTimestamp(lensArticles),
      topicSignals: buildTopicSignals(lensArticles),
    }),
    [expandedSort, lensArticles],
  );

const getLocalLensData = (options: LocalLensOptions): LocalLensResponse | undefined => {
  const { articles, geoData, lensLimit, selectedCountry, selectedCountryName, viewMode } = options;
  if (selectedCountry === null || selectedCountry === "") {
    return void 0;
  }
  const countryNameResult = CountryNameSchema.safeParse(
    geoData?.countries?.[selectedCountry]?.name,
  );
  let countryName = selectedCountryName ?? selectedCountry;
  if (countryNameResult.success) {
    countryName = countryNameResult.data;
  }
  return buildLocalLensFromArticles({
    articles: [...articles],
    code: selectedCountry,
    countryName,
    limit: lensLimit,
    view: viewMode,
  });
};

const useGlobeCoreData = (
  options: Readonly<{
    readonly articles: readonly NewsArticle[];
    readonly geoData: ReadonlyGeoData | undefined;
    readonly selectedCountry: CountrySelection;
    readonly selectedCountryName: string | null;
    readonly lensLimit: number;
    readonly viewMode: "internal" | "external";
    readonly expandedSort: ExpandedSortMode;
  }>,
): GlobeCoreData => {
  const { articles, geoData, lensLimit, selectedCountry, selectedCountryName, viewMode } = options;
  const countryList = useMemo(() => buildCountryListFromArticles(articles), [articles]);
  const countryMetrics = useMemo(() => buildCountryMetricsFromArticles(articles), [articles]);
  const globalSourceCount = useMemo(
    () =>
      new Set(
        articles
          .map((article) => article.sourceId ?? article.source)
          .filter((source) => source !== ""),
      ).size,
    [articles],
  );
  const globalSourceSummary = useMemo(
    () => buildSourceSummary(articles).slice(0, TOP_SOURCE_LIMIT),
    [articles],
  );
  const localLensData = useMemo(
    () =>
      getLocalLensData({
        articles,
        geoData,
        lensLimit,
        selectedCountry,
        selectedCountryName,
        viewMode,
      }),
    [articles, geoData, lensLimit, selectedCountry, selectedCountryName, viewMode],
  );
  return { countryList, countryMetrics, globalSourceCount, globalSourceSummary, localLensData };
};

const useGlobeWorkspaceData = (
  articles: readonly NewsArticle[],
  selectedCountry: CountrySelection,
  localLensData: LensData | undefined,
): GlobeWorkspaceData => {
  const lensArticles = getLensArticles(articles, localLensData, selectedCountry);
  return useMemo(() => {
    const sourceSummary = buildSourceSummary(lensArticles);
    const sourceWorkspace = buildSourceWorkspace(lensArticles, sourceSummary);
    return {
      lensArticles,
      sourceCoverageLeaders: buildSourceCoverageLeaders(sourceWorkspace),
      sourceSummary,
      sourceWorkspace,
      verificationStats: buildVerificationStats(lensArticles),
    };
  }, [lensArticles]);
};

const useGlobeDisplayData = (
  options: Readonly<{
    readonly articles: readonly NewsArticle[];
    readonly geoData: ReadonlyGeoData | undefined;
    readonly selectedCountry: CountrySelection;
    readonly selectedCountryName: string | null;
    readonly lensLimit: number;
    readonly viewMode: "internal" | "external";
    readonly expandedSort: ExpandedSortMode;
  }>,
): GlobePresentationData => {
  const coreData = useGlobeCoreData(options);
  const workspaceData = useGlobeWorkspaceData(
    options.articles,
    options.selectedCountry,
    coreData.localLensData,
  );
  const selectedCountryMetrics = getSelectedCountryMetrics(
    options.selectedCountry,
    coreData.countryMetrics,
  );
  const selectedCountryMeta = useSelectedCountryMeta(coreData.countryList, options.selectedCountry);
  const lensSummary = getLensSummary(options, coreData, workspaceData);
  const articlePresentation = useGlobeArticlePresentation(
    workspaceData.lensArticles,
    options.expandedSort,
  );
  return {
    ...coreData,
    ...workspaceData,
    ...articlePresentation,
    ...lensSummary,
    countryMetrics: coreData.countryMetrics,
    focusLabel: options.selectedCountryName ?? "Global Focus",
    heatLabel: intensityLabel(coreData.countryMetrics),
    ...selectedCountryMetrics,
    selectedCountryMeta,
  };
};
export { useGlobeDisplayData };
