"use client";

import type { AllCluster, NewsArticle } from "@/lib/api";
import { GridViewContent, VirtualizedModeView } from "./grid-view-layout";
import { fetchAllClusters, fetchClusterArticles } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeepReadonly } from "@/app/search/research/model/types";
import type { GridViewMode } from "@/lib/view-mode-storage";
import { Loader2 } from "lucide-react";
import { getLogger, hasText } from "@/lib/utils";
import { useFavorites } from "@/hooks/use-favorites";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/use-reading-queue";
import { useGridModalController } from "./grid-view-modal-controller";
import { useGridSourceController } from "./grid-view-source-controller";

type GridButtonEvent = Readonly<{ stopPropagation: () => void }>;
type ReadonlyGridCluster = DeepReadonly<AllCluster>;
type GridClusterWindow = "1d" | "1w" | "1m";
const LOADING_STYLE = { minHeight: "calc(100vh - 140px)" };
const logger = getLogger("GridView");

interface GridViewProps {
  readonly articles: readonly NewsArticle[];
  readonly loading: boolean;
  readonly apiUrl?: string | null;
  readonly useVirtualization?: boolean;
  readonly showTrending?: boolean;
  readonly topicSortMode?: "sources" | "articles" | "recent";
  readonly viewMode?: GridViewMode;
  readonly onViewModeChange?: (mode: GridViewMode) => void;
  readonly isScrollMode?: boolean;
  readonly totalCount?: number;
}

const formatGridKeywordLabel = (keywords?: readonly string[]) => {
    if (!keywords || keywords.length === 0) {
      return "";
    }
    return keywords.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  };
const normalizeGridLabel = (value: string) =>
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, " ")
      .trim();
const stripGridTitleSuffix = (value: string) => value.split(/\s[-|\u2013\u2014]\s/u)[0]?.trim() ?? "";
const getGridTitleCandidate = (cluster: ReadonlyGridCluster): string => {
    const title = cluster.representative_article?.title;
    if (hasText(title)) {
      return stripGridTitleSuffix(title);
    }
    return "";
  };
const hasMatchingGridLabels = (label: string, keywords: string | undefined, title: string): boolean =>
    Boolean(title && label && hasText(keywords) && label === keywords);
const chooseGridClusterLabel = (label: string, title: string, keywords: string | undefined): string =>
    (label || title || keywords) ?? "Topic";
const getGridClusterDisplayLabel = (cluster: ReadonlyGridCluster) => {
    const label = cluster.label?.trim() ?? "";
    const keywordLabel = formatGridKeywordLabel(cluster.keywords);
    const titleCandidate = getGridTitleCandidate(cluster);
    const normalizedLabel = (() => {
  if (label) {
    return normalizeGridLabel(label);
  }
  return "";
})();
    const normalizedKeywords = (() => {
  if (keywordLabel) {
    return normalizeGridLabel(keywordLabel);
  }
  return "";
})();
    const labelsMatch = hasMatchingGridLabels(normalizedLabel, normalizedKeywords, titleCandidate);
    if (labelsMatch) {
  return titleCandidate;
}
return chooseGridClusterLabel(label, titleCandidate, keywordLabel);
  };

interface GridTopicControllerOptions {
  readonly clusterWindow: GridClusterWindow;
  readonly viewMode: GridViewMode;
  readonly topicSortMode: "sources" | "articles" | "recent";
}

const useGridTopicController = ({
    clusterWindow,
    viewMode,
    topicSortMode,
  }: Readonly<GridTopicControllerOptions>) => {
    const [clusters, setClusters] = useState<AllCluster[]>([]),
      [clustersLoading, setClustersLoading] = useState(false),
      [clustersStatus, setClustersStatus] = useState<string | null>(null),
      [expandedClusterId, setExpandedClusterId] = useState<number | null>(null),
      [clusterArticlesCache, setClusterArticlesCache] = useState<Map<number, NewsArticle[]>>(
        new Map(),
      );

    useEffect(() => {
      if (viewMode !== "topic") {
        return () => {};
      }
      let cancelled = false,
        retryTimer: ReturnType<typeof setTimeout> | null = null;

      const loadClusters = async () => {
        setClustersLoading(true);
        try {
          const data = await fetchAllClusters(clusterWindow, 2, 100);
          if (cancelled) {
            return;
          }
          setClusters(data.clusters);
          setClustersStatus(data.status ?? null);
          setExpandedClusterId((previous) =>
            (() => {
  if (previous !== null && data.clusters.some(cluster => cluster.cluster_id === previous)) {
    return previous;
  }
  return null;
})(),
          );
          if (data.status === "initializing") {
            retryTimer = setTimeout(() => {
              void loadClusters();
            }, 15_000);
          }
        } catch (error) {
          if (!cancelled) {
            logger.error("Failed to load clusters:", error);
          }
        } finally {
          if (!cancelled) {
            setClustersLoading(false);
          }
        }
      };

      void loadClusters();
      return () => {
        cancelled = true;
        if (retryTimer) {
          clearTimeout(retryTimer);
        }
      };
    }, [clusterWindow, viewMode]);

    const clusterTimes = useMemo(() => {
        const times = new Map<number, number>();
        for (const cluster of clusters) {
          const publishedAt = cluster.representative_article?.published_at,
            timestamp = (() => {
  if (hasText(publishedAt)) {
    return new Date(publishedAt).getTime();
  }
  return 0;
})();
          times.set(cluster.cluster_id, (() => {
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
})());
        }
        return times;
      }, [clusters]);
    const sortedClusters = useMemo(() => {
        const items = [...clusters];
        items.sort((clusterA, clusterB) => {
          if (topicSortMode === "articles") {
            return clusterB.article_count - clusterA.article_count;
          }
          if (topicSortMode === "recent") {
            return (
              (clusterTimes.get(clusterB.cluster_id) ?? 0) -
              (clusterTimes.get(clusterA.cluster_id) ?? 0)
            );
          }
          return clusterB.source_diversity - clusterA.source_diversity;
        });
        return items;
      }, [clusterTimes, clusters, topicSortMode]);
    const expandedCluster =
        (() => {
  if (expandedClusterId === null) {
    return void 0;
  }
  return sortedClusters.find(cluster => cluster.cluster_id === expandedClusterId) ?? null;
})();
    const expandedClusterArticles = (() => {
  if (expandedCluster) {
    return clusterArticlesCache.get(expandedCluster.cluster_id) ?? [];
  }
  return [];
})();
    const handleExpandCluster = useCallback(
        async (cluster: ReadonlyGridCluster) => {
          const clusterId = cluster.cluster_id;
          if (expandedClusterId === clusterId) {
            setExpandedClusterId(null);
            return;
          }

          const section = document.querySelector<HTMLElement>(`[data-cluster-id="${clusterId}"]`);
          setExpandedClusterId(clusterId);
          globalThis.setTimeout(() => {
            section?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 0);
          const cachedArticles = clusterArticlesCache.get(clusterId);
          if (cachedArticles && cachedArticles.length > 0) {
            return;
          }

          try {
            const fullArticles = await fetchClusterArticles(clusterId);
            setClusterArticlesCache((previous) => new Map(previous).set(clusterId, fullArticles));
          } catch (error) {
            logger.warn("Failed to load full topic cluster articles", { clusterId, error });
          }
        },
        [clusterArticlesCache, expandedClusterId],
      );

    return {
      clusters,
      clustersLoading,
      clustersStatus,
      expandedCluster,
      expandedClusterArticles,
      expandedClusterId,
      handleExpandCluster,
      setExpandedClusterId,
      sortedClusters,
    };
  };

export const GridView = ({
  articles,
  loading,
  apiUrl: _apiUrl,
  useVirtualization = false,
  showTrending = true,
  topicSortMode = "sources",
  viewMode: controlledViewMode,
  onViewModeChange,
  isScrollMode: _isScrollMode = false,
  totalCount,
}: Readonly<GridViewProps>) => {
  void _apiUrl;
  void _isScrollMode;

  const { likedIds, toggleLike } = useLikedArticles();
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();
  const { isFavorite, toggleFavorite } = useFavorites();
  const {
      expandedSourceId,
      filteredNews,
      handleModeSelect,
      handleSearchChange,
      hasMoreSourceGroups,
      loadMoreSources,
      searchTerm,
      sortedSourceIds,
      toggleSource,
      viewMode,
      visibleSourceGroups,
      visibleSourceIds,
    } = useGridSourceController({
      articles,
      controlledViewMode,
      isFavorite,
      onViewModeChange,
    });
  const [clusterWindow, setClusterWindow] = useState<"1d" | "1w" | "1m">("1w");
  const topic = useGridTopicController({ clusterWindow, topicSortMode, viewMode });
  const modal = useGridModalController();
  const isLoadingState = loading;
  const displayArticles = filteredNews;
  const resolvedTotalCount = totalCount ?? filteredNews.length;
  const handleLike = useCallback(
      (articleId: number, event?: GridButtonEvent) => {
        event?.stopPropagation();
        void toggleLike(articleId);
      },
      [toggleLike],
    );
  const handleQueueToggle = useCallback(
      (article: NewsArticle, event?: GridButtonEvent) => {
        event?.stopPropagation();
        if (isArticleInQueue(article.url)) {
          void removeArticleFromQueue(article.url);
        } else {
          void addArticleToQueue(article);
        }
      },
      [addArticleToQueue, isArticleInQueue, removeArticleFromQueue],
    );

  const { setExpandedClusterId } = topic;
  const closeExpandedCluster = useCallback(() => {
      setExpandedClusterId(null);
    }, [setExpandedClusterId]);
  const sourceResult = useMemo(
      () => ({
        expandedSourceId,
        isArticleInQueue,
        isFavorite,
        likedIds,
        onArticleClick: modal.handleArticleClick,
        onLike: handleLike,
        onQueueToggle: handleQueueToggle,
        onToggleExpand: toggleSource,
        onToggleFavorite: toggleFavorite,
      }),
      [
        expandedSourceId,
        handleLike,
        handleQueueToggle,
        isArticleInQueue,
        isFavorite,
        likedIds,
        modal.handleArticleClick,
        toggleFavorite,
        toggleSource,
      ],
    );
  const topicResult = useMemo(
      () => ({
        clusters: topic.clusters,
        clustersLoading: topic.clustersLoading,
        clustersStatus: topic.clustersStatus,
        expandedCluster: topic.expandedCluster ?? null,
        expandedClusterArticles: topic.expandedClusterArticles,
        expandedClusterId: topic.expandedClusterId,
        getDisplayLabel: getGridClusterDisplayLabel,
        isArticleInQueue,
        likedIds,
        onArticleClick: modal.handleArticleClick,
        onCloseExpanded: closeExpandedCluster,
        onCompare: modal.handleOpenClusterCompare,
        onExpand: topic.handleExpandCluster,
        onLike: handleLike,
        onQueueToggle: handleQueueToggle,
        sortedClusters: topic.sortedClusters,
      }),
      [
        closeExpandedCluster,
        handleLike,
        handleQueueToggle,
        isArticleInQueue,
        likedIds,
        modal.handleArticleClick,
        modal.handleOpenClusterCompare,
        topic.clusters,
        topic.clustersLoading,
        topic.clustersStatus,
        topic.expandedCluster,
        topic.expandedClusterArticles,
        topic.expandedClusterId,
        topic.handleExpandCluster,
        topic.sortedClusters,
      ],
    );
  const results = useMemo(
      () => ({
        displayArticles,
        hasMoreSourceGroups,
        isLoadingState,
        onLoadMoreSources: loadMoreSources,
        showTrending,
        source: sourceResult,
        topic: topicResult,
        totalSourceCount: sortedSourceIds.length,
        viewMode,
        visibleSourceCount: visibleSourceIds.size,
        visibleSourceGroups,
      }),
      [
        displayArticles,
        hasMoreSourceGroups,
        isLoadingState,
        loadMoreSources,
        showTrending,
        sortedSourceIds.length,
        sourceResult,
        topicResult,
        viewMode,
        visibleSourceGroups,
        visibleSourceIds.size,
      ],
    );
  const overlays = useMemo(
      () => ({
        isArticleModalOpen: modal.isArticleModalOpen,
        isClusterModalOpen: modal.isClusterModalOpen,
        onArticleModalClose: modal.handleModalClose,
        onArticleModalNavigate: modal.handleModalNavigate,
        onClusterModalClose: modal.closeClusterModal,
        onScrollToTop: modal.scrollToTop,
        selectedArticle: modal.selectedArticle,
        selectedCluster: modal.selectedCluster,
        showScrollTop: modal.showScrollTop,
      }),
      [
        modal.closeClusterModal,
        modal.handleModalClose,
        modal.handleModalNavigate,
        modal.isArticleModalOpen,
        modal.isClusterModalOpen,
        modal.scrollToTop,
        modal.selectedArticle,
        modal.selectedCluster,
        modal.showScrollTop,
      ],
    );

  if (isLoadingState && displayArticles.length === 0) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-background"
        style={LOADING_STYLE}
      >
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary/50" />
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Curating stories...
          </p>
        </div>
      </div>
    );
  }

  if (useVirtualization) {
    return (
      <VirtualizedModeView
        searchTerm={searchTerm}
        empty={displayArticles.length === 0 && !isLoadingState}
        displayArticles={displayArticles}
        resolvedTotalCount={resolvedTotalCount}
        isArticleModalOpen={modal.isArticleModalOpen}
        selectedArticle={modal.selectedArticle}
        onSearchChange={handleSearchChange}
        onArticleClick={modal.handleArticleClick}
        onModalClose={modal.handleModalClose}
        onModalNavigate={modal.handleModalNavigate}
      />
    );
  }

  return (
    <GridViewContent
      searchTerm={searchTerm}
      viewMode={viewMode}
      clusterWindow={clusterWindow}
      onSearchChange={handleSearchChange}
      onModeSelect={handleModeSelect}
      onClusterWindow={setClusterWindow}
      setContainerElement={modal.setContainerElement}
      results={results}
      overlays={overlays}
    />
  );
};
