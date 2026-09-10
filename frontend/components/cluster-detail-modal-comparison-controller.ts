"use client";

import type { ClusterArticle } from "@/lib/api";
import {
  buildComparisonSourceOptions,
  getDefaultComparisonArticleIds,
  getSelectedComparisonArticles,
} from "@/lib/cluster-comparison";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { comparisonArticleSourceId } from "./cluster-detail-modal-comparison";
import { getComparisonPair, requestComparison } from "./cluster-detail-modal-comparison-request";
import type {
  ArticleContentLoader,
  ClusterDetailResponse,
  ComparisonArticle,
  ComparisonData,
} from "./cluster-detail-modal-types";

const normalizeComparisonArticle = (article: ClusterArticle): ComparisonArticle => ({
  ...article,
  source_id: article.source_id?.trim() ?? undefined,
});

const buildComparisonRequestKey = (articleIds: readonly number[]): string =>
  [...articleIds].toSorted((left, right) => left - right).join(":");

interface ClusterComparisonControllerOptions {
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly setArticleContents: Dispatch<SetStateAction<Map<number, string | null>>>;
  readonly loadArticleContent: ArticleContentLoader;
}

interface ComparisonSelection {
  readonly articles: readonly ComparisonArticle[];
  readonly requestKey: string;
}

interface ComparisonSelectionError {
  readonly message: string;
  readonly notify: boolean;
}

type ComparisonSelectionResult = ComparisonSelection | ComparisonSelectionError | null;

type ComparisonDataSetter = Dispatch<SetStateAction<ComparisonData | null>>;
type ComparisonErrorSetter = Dispatch<SetStateAction<string | null>>;
type ComparisonLoadingSetter = Dispatch<SetStateAction<boolean>>;
type ComparisonRequestKeySetter = Dispatch<SetStateAction<string | null>>;

const getSameSourceError = (
  selectedPair: readonly [ComparisonArticle, ComparisonArticle],
): ComparisonSelectionError | null => {
  const [sourceOne, sourceTwo] = selectedPair;
  if (sourceOne.source.trim().toLowerCase() !== sourceTwo.source.trim().toLowerCase()) {
    return null;
  }
  return {
    message: "Compare Sources needs coverage from at least two outlets.",
    notify: true,
  };
};

const getComparisonSelectionForArticles = (
  selectedArticles: readonly ComparisonArticle[],
  requestKey: string,
): ComparisonSelectionResult => {
  const selectedPair = getComparisonPair(selectedArticles);
  if (selectedPair === null) {
    return { message: "Select one article from two distinct outlets.", notify: false };
  }
  const sameSourceError = getSameSourceError(selectedPair);
  if (sameSourceError !== null) {
    return sameSourceError;
  }
  return { articles: selectedArticles, requestKey };
};

const getComparisonSelection = (
  articleIds: readonly number[],
  clusterDetail: ClusterDetailResponse | undefined,
  comparisonRequestKey: string | null,
  comparisonArticles: readonly ComparisonArticle[],
): ComparisonSelectionResult => {
  if (articleIds.length < 2 || !clusterDetail) {
    return null;
  }
  const requestKey = buildComparisonRequestKey(articleIds);
  if (comparisonRequestKey === requestKey) {
    return null;
  }
  const selectedArticles = getSelectedComparisonArticles(comparisonArticles, articleIds);
  return getComparisonSelectionForArticles(selectedArticles, requestKey);
};

const reportComparisonSelectionError = (
  error: ComparisonSelectionError,
  setComparisonData: ComparisonDataSetter,
  setComparisonError: ComparisonErrorSetter,
): void => {
  setComparisonData(null);
  setComparisonError(error.message);
  if (error.notify) {
    toast.error(error.message);
  }
};

const mergeComparisonEntries = (
  setArticleContents: Dispatch<SetStateAction<Map<number, string | null>>>,
  contentEntries: readonly (readonly [number, string | null])[],
): void => {
  setArticleContents((previous) => {
    const next = new Map(previous);
    for (const [articleId, text] of contentEntries) {
      next.set(articleId, text);
    }
    return next;
  });
};

const reportComparisonLoadError = (
  error: Error,
  setComparisonRequestKey: ComparisonRequestKeySetter,
  setComparisonData: ComparisonDataSetter,
  setComparisonError: ComparisonErrorSetter,
): void => {
  console.error("Failed to load comparison:", error);
  setComparisonRequestKey(null);
  setComparisonData(null);
  setComparisonError(error.message);
  toast.error(error.message);
};

interface ComparisonLoadOptions {
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly articleIds: readonly number[];
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly comparisonRequestKey: string | null;
  readonly loadArticleContent: ArticleContentLoader;
  readonly setArticleContents: Dispatch<SetStateAction<Map<number, string | null>>>;
  readonly setComparisonData: ComparisonDataSetter;
  readonly setComparisonError: ComparisonErrorSetter;
  readonly setComparisonLoading: ComparisonLoadingSetter;
  readonly setComparisonRequestKey: ComparisonRequestKeySetter;
}

const executeComparisonLoad = async (
  options: ComparisonLoadOptions,
  selection: ComparisonSelection,
): Promise<void> => {
  options.setComparisonRequestKey(selection.requestKey);
  options.setComparisonLoading(true);
  try {
    const result = await requestComparison(
      selection.articles,
      options.articleContents,
      options.loadArticleContent,
    );
    mergeComparisonEntries(options.setArticleContents, result.contentEntries);
    options.setComparisonData(result.data);
  } catch (error) {
    const normalizedError = (() => {
      if (error instanceof Error) {
        return error;
      }
      return new Error("Failed to compare the selected sources.");
    })();
    reportComparisonLoadError(
      normalizedError,
      options.setComparisonRequestKey,
      options.setComparisonData,
      options.setComparisonError,
    );
  } finally {
    options.setComparisonLoading(false);
  }
};

const runComparisonLoad = async (options: ComparisonLoadOptions): Promise<void> => {
  const selection = getComparisonSelection(
    options.articleIds,
    options.clusterDetail,
    options.comparisonRequestKey,
    options.comparisonArticles,
  );
  if (selection === null) {
    return;
  }
  if ("message" in selection) {
    reportComparisonSelectionError(
      selection,
      options.setComparisonData,
      options.setComparisonError,
    );
    return;
  }
  await executeComparisonLoad(options, selection);
};

interface ComparisonDataLoaderOptions {
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly loadArticleContent: ArticleContentLoader;
  readonly setArticleContents: Dispatch<SetStateAction<Map<number, string | null>>>;
}

const useComparisonDataLoader = (options: ComparisonDataLoaderOptions) => {
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonRequestKey, setComparisonRequestKey] = useState<string | null>(null);
  const loadComparisonData = useCallback(
    async (articleIds: readonly number[]) =>
      runComparisonLoad({
        articleContents: options.articleContents,
        articleIds,
        clusterDetail: options.clusterDetail,
        comparisonArticles: options.comparisonArticles,
        comparisonRequestKey,
        loadArticleContent: options.loadArticleContent,
        setArticleContents: options.setArticleContents,
        setComparisonData,
        setComparisonError,
        setComparisonLoading,
        setComparisonRequestKey,
      }),
    [
      comparisonRequestKey,
      options.articleContents,
      options.clusterDetail,
      options.comparisonArticles,
      options.loadArticleContent,
      options.setArticleContents,
    ],
  );
  return {
    comparisonData,
    comparisonError,
    comparisonLoading,
    loadComparisonData,
    setComparisonData,
    setComparisonError,
    setComparisonRequestKey,
  };
};

const reportUnavailableComparison = (
  setComparisonData: ComparisonDataSetter,
  setComparisonError: ComparisonErrorSetter,
): void => {
  const message = "Compare Sources needs coverage from at least two outlets.";
  reportComparisonSelectionError({ message, notify: true }, setComparisonData, setComparisonError);
};

const resetComparisonState = (
  comparisonIds: readonly number[],
  setSelectedArticlesForComparison: Dispatch<SetStateAction<number[]>>,
  setComparisonData: ComparisonDataSetter,
  setComparisonMode: Dispatch<SetStateAction<boolean>>,
  setComparisonRequestKey: ComparisonRequestKeySetter,
): void => {
  setSelectedArticlesForComparison([...comparisonIds]);
  setComparisonData(null);
  setComparisonMode(true);
  setComparisonRequestKey(null);
};

interface OpenComparisonOptions {
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly setComparisonData: ComparisonDataSetter;
  readonly setComparisonError: ComparisonErrorSetter;
  readonly setComparisonMode: Dispatch<SetStateAction<boolean>>;
  readonly setComparisonRequestKey: ComparisonRequestKeySetter;
  readonly setSelectedArticlesForComparison: Dispatch<SetStateAction<number[]>>;
}

const openComparison = (options: OpenComparisonOptions): void => {
  if (!options.clusterDetail) {
    return;
  }
  options.setComparisonError(null);
  const comparisonIds = getDefaultComparisonArticleIds(options.comparisonArticles);
  if (comparisonIds.length < 2) {
    reportUnavailableComparison(options.setComparisonData, options.setComparisonError);
    return;
  }
  resetComparisonState(
    comparisonIds,
    options.setSelectedArticlesForComparison,
    options.setComparisonData,
    options.setComparisonMode,
    options.setComparisonRequestKey,
  );
};

const useComparisonOpenHandler = (options: OpenComparisonOptions) => {
  const {
    clusterDetail,
    comparisonArticles,
    setComparisonData,
    setComparisonError,
    setComparisonMode,
    setComparisonRequestKey,
    setSelectedArticlesForComparison,
  } = options;
  return useCallback(() => {
    openComparison({
      clusterDetail,
      comparisonArticles,
      setComparisonData,
      setComparisonError,
      setComparisonMode,
      setComparisonRequestKey,
      setSelectedArticlesForComparison,
    });
  }, [
    clusterDetail,
    comparisonArticles,
    setComparisonData,
    setComparisonError,
    setComparisonMode,
    setComparisonRequestKey,
    setSelectedArticlesForComparison,
  ]);
};

interface ComparisonSourceChangeOptions {
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly setComparisonRequestKey: ComparisonRequestKeySetter;
  readonly setSelectedArticlesForComparison: Dispatch<SetStateAction<number[]>>;
}

const changeComparisonSource = (
  sourceId: string,
  nextArticleId: string,
  options: ComparisonSourceChangeOptions,
): void => {
  const parsedId = Number(nextArticleId);
  if (!Number.isFinite(parsedId)) {
    return;
  }
  options.setSelectedArticlesForComparison((previous) => {
    const nextArticles = getSelectedComparisonArticles(options.comparisonArticles, previous).filter(
      (article) => comparisonArticleSourceId(article) !== sourceId,
    );
    options.setComparisonRequestKey(null);
    return [...nextArticles.map((article) => article.id), parsedId];
  });
};

const useComparisonSourceHandler = (options: ComparisonSourceChangeOptions) => {
  const { comparisonArticles, setComparisonRequestKey, setSelectedArticlesForComparison } = options;
  return useCallback(
    (sourceId: string, nextArticleId: string) => {
      changeComparisonSource(sourceId, nextArticleId, {
        comparisonArticles,
        setComparisonRequestKey,
        setSelectedArticlesForComparison,
      });
    },
    [comparisonArticles, setComparisonRequestKey, setSelectedArticlesForComparison],
  );
};

interface ComparisonSelectionControllerOptions {
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly setComparisonData: ComparisonDataSetter;
  readonly setComparisonError: ComparisonErrorSetter;
  readonly setComparisonRequestKey: ComparisonRequestKeySetter;
}

const useComparisonSelectionController = ({
  clusterDetail,
  comparisonArticles,
  setComparisonData,
  setComparisonError,
  setComparisonRequestKey,
}: ComparisonSelectionControllerOptions) => {
  const [comparisonMode, setComparisonMode] = useState(false);
  const [selectedArticlesForComparison, setSelectedArticlesForComparison] = useState<number[]>([]);
  const handleTabChange = useCallback((value: string) => {
    setComparisonMode(value === "compare");
  }, []);
  const handleOpenComparison = useComparisonOpenHandler({
    clusterDetail,
    comparisonArticles,
    setComparisonData,
    setComparisonError,
    setComparisonMode,
    setComparisonRequestKey,
    setSelectedArticlesForComparison,
  });
  const handleComparisonSourceChange = useComparisonSourceHandler({
    comparisonArticles,
    setComparisonRequestKey,
    setSelectedArticlesForComparison,
  });
  return {
    comparisonMode,
    handleComparisonSourceChange,
    handleOpenComparison,
    handleTabChange,
    selectedArticlesForComparison,
  };
};

const getSelectedComparisonArticlesOrEmpty = (
  clusterDetail: ClusterDetailResponse | undefined,
  comparisonArticles: readonly ComparisonArticle[],
  selectedArticles: readonly number[],
): readonly ComparisonArticle[] => {
  if (!clusterDetail) {
    return [];
  }
  return getSelectedComparisonArticles(comparisonArticles, selectedArticles);
};

const getComparisonSourceOptionsOrEmpty = (
  clusterDetail: ClusterDetailResponse | undefined,
  comparisonArticles: readonly ComparisonArticle[],
) => {
  if (!clusterDetail) {
    return [];
  }
  return buildComparisonSourceOptions(comparisonArticles);
};

const useClusterComparisonController = ({
  articleContents,
  clusterDetail,
  loadArticleContent,
  setArticleContents,
}: ClusterComparisonControllerOptions) => {
  const comparisonArticles = useMemo(
    () => (clusterDetail?.articles ?? []).map((article) => normalizeComparisonArticle(article)),
    [clusterDetail],
  );
  const data = useComparisonDataLoader({
    articleContents,
    clusterDetail,
    comparisonArticles,
    loadArticleContent,
    setArticleContents,
  });
  const selection = useComparisonSelectionController({
    clusterDetail,
    comparisonArticles,
    setComparisonData: data.setComparisonData,
    setComparisonError: data.setComparisonError,
    setComparisonRequestKey: data.setComparisonRequestKey,
  });
  const { loadComparisonData } = data;
  useEffect(() => {
    if (selection.comparisonMode && selection.selectedArticlesForComparison.length >= 2) {
      globalThis.queueMicrotask(
        () => void loadComparisonData(selection.selectedArticlesForComparison),
      );
    }
  }, [loadComparisonData, selection.comparisonMode, selection.selectedArticlesForComparison]);
  return {
    comparisonArticles: getSelectedComparisonArticlesOrEmpty(
      clusterDetail,
      comparisonArticles,
      selection.selectedArticlesForComparison,
    ),
    comparisonData: data.comparisonData,
    comparisonError: data.comparisonError,
    comparisonLoading: data.comparisonLoading,
    comparisonMode: selection.comparisonMode,
    comparisonSourceOptions: getComparisonSourceOptionsOrEmpty(clusterDetail, comparisonArticles),
    handleComparisonSourceChange: selection.handleComparisonSourceChange,
    handleOpenComparison: selection.handleOpenComparison,
    handleTabChange: selection.handleTabChange,
  };
};

export { useClusterComparisonController };
