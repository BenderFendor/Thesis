"use client";

import { hasText } from "@/lib/utils";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type {
  ArticleAnalysis,
  ArticleBookmarkActionProps,
  ArticleDetailServices,
  DebugLoaderState,
  FactCheckResult,
  FactCheckStatus,
  FactCheckStatusFilter,
  Highlight,
  LanguageDiagnostics,
  LocalHighlight,
  NewsArticle,
  SourceDebugData,
} from "../lib/article-detail-modal-data";
import { buildObsidianMarkdown, toRemoteHighlights } from "../lib/article-detail-modal-data";
import {
  getArticleHost,
  getArticleTextForMetrics,
  getArticleWikiContext,
  getArticleWordMetrics,
  getReporterName,
  shouldShowSummary,
} from "./article-detail-modal-reader";

const AGENTIC_HISTORY_LIMIT = 5;
const AGENTIC_MAX_RESULTS = 10;
const COUNT_INCREMENT = 1;
const EMPTY_COUNT = 0;
const NOT_FOUND = -1;

const appendAgenticQueryPart = (
    parts: readonly string[],
    label: string,
    value: string | undefined,
  ): string[] => ((() => {
  if (value === undefined || value === "") {
    return [...parts];
  }
  return [...parts, `${label}: ${value}`];
})());

const buildAgenticQuery = (article: NewsArticle, claim: FactCheckResult): string => {
  let parts = [`Fact-check this claim: ${claim.claim}`];
  parts = appendAgenticQueryPart(parts, "Article title", article.title);
  parts = appendAgenticQueryPart(parts, "Publisher", article.source);
  parts = appendAgenticQueryPart(parts, "Existing evidence summary", claim.evidence);
  parts = [...parts, "Respond with a concise verification summary and cite authoritative sources."];
  return parts.join(" \n");
};

const filterFactCheckResults = (
  results: readonly FactCheckResult[],
  filter: FactCheckStatusFilter,
): FactCheckResult[] => {
  if (filter === "all") {
    return [...results];
  }
  return results.filter((claim) => claim.verification_status === filter);
};

const findDebugEntryIndex = (
  data: DeepReadonly<SourceDebugData> | undefined,
  article: NewsArticle,
): number | undefined => {
  const articleTitle = normalizeDebugText(article.title),
    entries = data?.parsed_entries ?? [],
    titleIndex = entries.findIndex((entry) => normalizeDebugText(entry.title) === articleTitle),
    urlIndex = entries.findIndex((entry) => entry.link === article.url);
  if (entries.length === EMPTY_COUNT) {
    return void 0;
  }
  if (urlIndex !== NOT_FOUND) {
    return urlIndex;
  }
  if (titleIndex !== NOT_FOUND) {
    return titleIndex;
  }
  return void 0;
};

const getAiActionLabel = (
  requested: boolean,
  loading: boolean,
  analysis: ArticleAnalysis | undefined,
): string => {
  if (!requested) {
    return "Run AI Analysis";
  }
  if (loading) {
    return "Running AI Analysis";
  }
  if (hasText(analysis?.error)) {
    return "Retry AI Analysis";
  }
  return "AI Analysis Ready";
};

const getArticleDetailAnalysisState = (
  analysis: ArticleAnalysis | undefined,
  analysisLoading: boolean,
  analysisRequested: boolean,
  activeStatusFilter: FactCheckStatusFilter,
) => {
  const factCheckResults = analysis?.fact_check_results ?? [];
  return {
    aiActionLabel: getAiActionLabel(analysisRequested, analysisLoading, analysis),
    aiHasError: Boolean(analysis?.error),
    canRequestAiAnalysis: !analysisRequested || Boolean(analysis?.error),
    factCheckResults,
    filteredClaims: filterFactCheckResults(factCheckResults, activeStatusFilter),
    statusCounts: getFactCheckStatusCounts(factCheckResults),
  };
};

const getArticleDetailArticleState = (article: NewsArticle, fullArticleText: string | undefined) => {
  const articleTextForMetrics = getArticleTextForMetrics(
      fullArticleText,
      article.content,
      article.summary,
    ),
    { wordCount, estimatedReadMinutes } = getArticleWordMetrics(articleTextForMetrics),
    reporterName = getReporterName(article);
  return {
    articleHost: getArticleHost(article.url),
    articleTextForMetrics,
    articleWikiContext: getArticleWikiContext(fullArticleText, article.content, article.summary),
    estimatedReadMinutes,
    hasReporterWiki: Boolean(reporterName),
    hasSourceWiki: Boolean(article.source.trim()),
    reporterName,
    showSummary: shouldShowSummary(article.summary, article.content, fullArticleText),
    wordCount,
  };
};

const getArticleObsidianMarkdown = (
  article: Readonly<NewsArticle>,
  fullArticleText: string | undefined,
  reporterName: string,
  highlights: readonly Highlight[],
): string =>
  buildObsidianMarkdown({
    article: {
      author: reporterName || article.author,
      content: article.content,
      publishedAt: article.publishedAt || "",
      summary: article.summary || "",
      title: article.title || "",
      url: article.url || "",
    },
    fullArticleText,
    highlights,
  });

const getVisibleRemoteHighlights = (highlights: readonly LocalHighlight[]): Highlight[] =>
  toRemoteHighlights(highlights.filter((highlight) => highlight.deleted !== true));

const getErrorMessage = (error: Error | string, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

const getFactCheckStatusCounts = (
  results: readonly FactCheckResult[],
): Record<FactCheckStatus, number> =>
  results.reduce<Record<FactCheckStatus, number>>(
    (counts, result) => {
      counts[result.verification_status] += COUNT_INCREMENT;
      return counts;
    },
    { false: 0, "partially-verified": 0, unverified: 0, verified: 0 },
  );

const getHighlightDebugEnabled = (): boolean =>
  globalThis.window !== undefined && globalThis.localStorage.getItem("debug_highlights") === "1";

const getLanguageDiagnosticsError = (
  error: Error | string | null | undefined,
  diagnostics: Readonly<LanguageDiagnostics> | null | undefined,
): string | undefined => {
  if (error instanceof Error) {
    return error.message;
  }
  return error ?? diagnostics?.error ?? undefined;
};

const loadAiAnalysisData = async ({
    article,
    services,
    setAiAnalysis,
    setAiAnalysisLoading,
    setAiAnalysisRequested,
  }: Readonly<{
    article: NewsArticle;
    services: ArticleDetailServices;
    setAiAnalysis: (analysis: ArticleAnalysis) => void;
    setAiAnalysisLoading: (loading: boolean) => void;
    setAiAnalysisRequested: (requested: boolean) => void;
  }>): Promise<void> => {
    setAiAnalysisRequested(true);
    setAiAnalysisLoading(true);
    try {
      setAiAnalysis(await services.analyzeArticle(article.url, article.source));
    } catch (error) {
      console.error("Failed to analyze article:", error);
      setAiAnalysis({
        article_url: article.url,
        error: getErrorMessage(
          (() => {
  if (error instanceof Error) {
    return error;
  }
  return String(error);
})(),
          "Failed to analyze article",
        ),
        success: false,
      });
    } finally {
      setAiAnalysisLoading(false);
    }
  };

const loadDebugData = async ({
  article,
  services,
  setDebugData,
  setDebugLoading,
  setMatchedEntryIndex,
}: Readonly<DebugLoaderState>): Promise<void> => {
  setDebugLoading(true);
  try {
    const data = await services.fetchSourceDebugData(article.source);
    setDebugData(data);
    setMatchedEntryIndex(findDebugEntryIndex(data, article));
  } catch (error) {
    console.error("Failed to fetch debug data:", error);
    setDebugData(undefined);
    setMatchedEntryIndex(undefined);
  } finally {
    setDebugLoading(false);
  }
};

const normalizeDebugText = (value: string): string =>
  value.toLowerCase().replaceAll(/\s+/gu, " ").trim();

const openModalWikiPanel = ({
  available,
  setOpen,
  setTab,
  tab,
}: Readonly<{
  readonly available: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly setTab: (tab: "source" | "reporter") => void;
  readonly tab: "source" | "reporter";
}>): void => {
  if (!available) {
    return;
  }
  setTab(tab);
  setOpen(true);
};

const publishAgenticAnswer = (
  response: Awaited<ReturnType<ArticleDetailServices["performAgenticSearch"]>>,
  claim: FactCheckResult,
  setAgenticAnswer: (answer: string | undefined) => void,
  setAgenticHistory: (
    update: (
      previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
    ) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
  ) => void,
): boolean => {
  if (!(response.success && response.answer)) {
    return false;
  }
  setAgenticAnswer(response.answer);
  setAgenticHistory((previous) =>
    [{ answer: response.answer, claim: claim.claim, timestamp: Date.now() }, ...previous].slice(
      EMPTY_COUNT,
      AGENTIC_HISTORY_LIMIT,
    ),
  );
  return true;
};

const runAgenticSearchData = async ({
    article,
    claim,
    services,
    setAgenticAnswer,
    setAgenticError,
    setAgenticHistory,
    setAgenticLoading,
  }: Readonly<{
    article: NewsArticle;
    claim: FactCheckResult | undefined;
    services: ArticleDetailServices;
    setAgenticAnswer: (answer: string | undefined) => void;
    setAgenticError: (error: string | undefined) => void;
    setAgenticHistory: (
      update: (
        previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
      ) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
    ) => void;
    setAgenticLoading: (loading: boolean) => void;
  }>): Promise<void> => {
    if (claim === undefined) {
      return;
    }
    setAgenticLoading(true);
    setAgenticAnswer(undefined);
    setAgenticError(undefined);
    try {
      await runAgenticSearchRequest({
        article,
        claim,
        services,
        setAgenticAnswer,
        setAgenticError,
        setAgenticHistory,
      });
    } catch (error) {
      setAgenticError(
        getErrorMessage((() => {
  if (error instanceof Error) {
    return error;
  }
  return String(error);
})(), "Agentic search failed."),
      );
    } finally {
      setAgenticLoading(false);
    }
  };

const runAgenticSearchRequest = async ({
  article,
  claim,
  services,
  setAgenticAnswer,
  setAgenticError,
  setAgenticHistory,
}: Readonly<{
  article: NewsArticle;
  claim: FactCheckResult;
  services: ArticleDetailServices;
  setAgenticAnswer: (answer: string | undefined) => void;
  setAgenticError: (error: string | undefined) => void;
  setAgenticHistory: (
    update: (
      previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
    ) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
  ) => void;
}>): Promise<void> => {
  const response = await services.performAgenticSearch(
    buildAgenticQuery(article, claim),
    AGENTIC_MAX_RESULTS,
  );
  if (!publishAgenticAnswer(response, claim, setAgenticAnswer, setAgenticHistory)) {
    setAgenticError(
      "Agentic search returned no direct answer. Try again or open the research workspace for a deeper dive.",
    );
  }
};

const toggleArticleBookmark = async ({
  article,
  isBookmarked,
  onBookmarkChange,
  setBookmarkLoading,
  toggleBookmark,
}: Readonly<ArticleBookmarkActionProps>): Promise<void> => {
  if (!article.id || article.isPersisted === false) {
    return;
  }

  setBookmarkLoading(true);
  try {
    const currentlyBookmarked = isBookmarked(article.id);
    await toggleBookmark(article.id);
    onBookmarkChange?.(article.id, !currentlyBookmarked);
  } catch (error) {
    console.error("Failed to toggle bookmark:", error);
  } finally {
    setBookmarkLoading(false);
  }
};

const toggleArticleFavorite = (
  article: NewsArticle,
  toggleFavorite: (sourceId: string) => void,
): void => {
  toggleFavorite(article.sourceId);
};

const toggleArticleLike = async (
  article: NewsArticle,
  toggleLike: (articleId: number) => Promise<void>,
): Promise<void> => {
  if (!article.id || article.isPersisted === false) {
    return;
  }
  await toggleLike(article.id);
};

const toggleArticleQueue = ({
  addArticleToQueue,
  article,
  isArticleInQueue,
  removeArticleFromQueue,
}: Readonly<{
  readonly addArticleToQueue: (article: NewsArticle) => void;
  readonly article: NewsArticle;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly removeArticleFromQueue: (url: string) => void;
}>): void => {
  if (isArticleInQueue(article.url)) {
    removeArticleFromQueue(article.url);
    return;
  }
  addArticleToQueue(article);
};

const toggleDebugPanel = ({
  isOpen,
  loadDebug,
  setOpen,
}: Readonly<{
  readonly isOpen: boolean;
  readonly loadDebug: () => void;
  readonly setOpen: (open: boolean) => void;
}>): void => {
  setOpen(!isOpen);
  if (!isOpen) {
    loadDebug();
  }
};

const updateClaimsDialog = ({
  factCheckResults,
  open,
  selectedClaim,
  setActiveStatusFilter,
  setAgenticAnswer,
  setAgenticError,
  setClaimsOpen,
  setSelectedClaim,
}: Readonly<{
  readonly factCheckResults: readonly FactCheckResult[];
  readonly open: boolean;
  readonly selectedClaim: FactCheckResult | undefined;
  readonly setActiveStatusFilter: (filter: FactCheckStatusFilter) => void;
  readonly setAgenticAnswer: (answer: string | undefined) => void;
  readonly setAgenticError: (error: string | undefined) => void;
  readonly setClaimsOpen: (open: boolean) => void;
  readonly setSelectedClaim: (claim: FactCheckResult | undefined) => void;
}>): void => {
  setClaimsOpen(open);
  if (!open) {
    setSelectedClaim(undefined);
    setAgenticAnswer(undefined);
    setAgenticError(undefined);
    setActiveStatusFilter("all");
    return;
  }

  if (!selectedClaim && factCheckResults.length > EMPTY_COUNT) {
    setSelectedClaim(factCheckResults[EMPTY_COUNT]);
  }
};

export {
  getArticleDetailAnalysisState,
  getArticleDetailArticleState,
  getArticleObsidianMarkdown,
  getHighlightDebugEnabled,
  getLanguageDiagnosticsError,
  getVisibleRemoteHighlights,
  loadAiAnalysisData,
  loadDebugData,
  openModalWikiPanel,
  runAgenticSearchData,
  toggleArticleBookmark,
  toggleArticleFavorite,
  toggleArticleLike,
  toggleArticleQueue,
  toggleDebugPanel,
  updateClaimsDialog,
};
