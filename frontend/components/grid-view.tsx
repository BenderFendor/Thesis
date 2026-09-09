"use client";

import type { AllCluster, ClusterArticle, NewsArticle, TrendingCluster } from "@/lib/api";
import { GridViewContent, VirtualizedModeView } from "./grid-view-layout";
import {
  buildSourceGroups,
  compareSourceGroupsForGrid,
  getVisibleSourceIds,
} from "@/lib/source-groups";
import { fetchAllClusters, fetchClusterArticles } from "@/lib/api";
import { getStoredGridViewMode, setStoredGridViewMode } from "@/lib/view-mode-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeepReadonly } from "@/app/search/research/model/types";
import type { GridChangeEvent } from "./grid-view-layout";
import type { GridViewMode } from "@/lib/view-mode-storage";
import { Loader2 } from "lucide-react";
import { getLogger, hasText } from "@/lib/utils";
import { useArticleDetail } from "@/hooks/use-article-detail";
import { useFavorites } from "@/hooks/use-favorites";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/use-reading-queue";

type GridButtonEvent = Readonly<{ stopPropagation: () => void }>;
type ReadonlyGridCluster = DeepReadonly<AllCluster>;
type ReadonlyGridClusterArticle = DeepReadonly<ClusterArticle>;
type ReadonlyGridGdeltContext = NonNullable<ReadonlyGridCluster["gdelt_context"]>;
type GridGdeltContext = NonNullable<ClusterArticle["gdelt_context"]>;
type GridClusterWindow = "1d" | "1w" | "1m";

const copyGridGdeltContext = (context: ReadonlyGridGdeltContext): GridGdeltContext => ({
  goldstein_avg: context.goldstein_avg,
  goldstein_bucket: context.goldstein_bucket,
  goldstein_max: context.goldstein_max,
  goldstein_min: context.goldstein_min,
  tone_avg: context.tone_avg,
  tone_baseline_avg: context.tone_baseline_avg,
  tone_delta_vs_cluster: context.tone_delta_vs_cluster,
  top_cameo: context.top_cameo?.map((cameo) => ({
    code: cameo.code,
    count: cameo.count,
    label: cameo.label,
  })),
  total_events: context.total_events,
});

const copyGridClusterArticle = (article: ReadonlyGridClusterArticle): ClusterArticle => ({
  author: article.author,
  authors: (() => {
  if (article.authors) {
    return [...article.authors];
  }
  return void 0;
})(),
  gdelt_context: (() => {
  if (article.gdelt_context) {
    return copyGridGdeltContext(article.gdelt_context);
  }
  return null;
})(),
  id: article.id,
  image_url: article.image_url,
  published_at: article.published_at,
  similarity: article.similarity,
  source: article.source,
  source_id: article.source_id,
  summary: article.summary,
  title: article.title,
  url: article.url,
});

const SOURCE_GROUP_BATCH_SIZE = 10;
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

interface GridSourceControllerOptions {
  readonly articles: readonly NewsArticle[];
  readonly controlledViewMode?: GridViewMode;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly onViewModeChange?: (mode: GridViewMode) => void;
}

const useGridSourceController = ({
  articles,
  controlledViewMode,
  isFavorite,
  onViewModeChange,
}: Readonly<GridSourceControllerOptions>) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [uncontrolledViewMode, setUncontrolledViewMode] = useState<GridViewMode>(
      () => controlledViewMode ?? getStoredGridViewMode(),
    );
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [sourceBatchCount, setSourceBatchCount] = useState(1);
  const viewMode = controlledViewMode ?? uncontrolledViewMode;
  const filteredNews = useMemo(() => {
      if (!searchTerm) {
        return articles;
      }
      const normalizedSearch = searchTerm.toLowerCase();
      return articles.filter(
        (article) =>
          article.title.toLowerCase().includes(normalizedSearch) ||
          article.summary?.toLowerCase().includes(normalizedSearch) ||
          article.source.toLowerCase().includes(normalizedSearch),
      );
    }, [articles, searchTerm]);
  const sourceGroups = useMemo(
      () =>
        buildSourceGroups(filteredNews).toSorted((a, b) => {
          const favoriteDifference =
            Number(isFavorite(b.sourceId)) - Number(isFavorite(a.sourceId));
          return favoriteDifference || compareSourceGroupsForGrid(a, b);
        }),
      [filteredNews, isFavorite],
    );
  const sortedSourceIds = useMemo(() => sourceGroups.map((group) => group.sourceId), [sourceGroups]);
  const visibleSourceIds = useMemo(() => {
      if (viewMode !== "source") {
        return new Set<string>();
      }
      const favoriteSourceIds = new Set(
        sourceGroups.filter((group) => isFavorite(group.sourceId)).map((group) => group.sourceId),
      );
      return getVisibleSourceIds(
        sourceGroups,
        favoriteSourceIds,
        sourceBatchCount,
        SOURCE_GROUP_BATCH_SIZE,
      );
    }, [isFavorite, sourceBatchCount, sourceGroups, viewMode]);
  const visibleSourceGroups = useMemo(
      () => sourceGroups.filter((group) => visibleSourceIds.has(group.sourceId)),
      [sourceGroups, visibleSourceIds],
    );
  const hasMoreSourceGroups = viewMode === "source" && visibleSourceIds.size < sortedSourceIds.length;

  useEffect(() => {
    if (!controlledViewMode) {
      setStoredGridViewMode(viewMode);
    }
  }, [controlledViewMode, viewMode]);

  const resetSourceBrowseState = () => {
      setSourceBatchCount(1);
      setExpandedSourceId(null);
    };
  const handleSearchChange = (event: GridChangeEvent) => {
      resetSourceBrowseState();
      setSearchTerm(event.target.value);
    };
  const handleModeSelect = (mode: GridViewMode) => {
      resetSourceBrowseState();
      setUncontrolledViewMode(mode);
      onViewModeChange?.(mode);
    };
  const toggleSource = (sourceId: string) => {
      setExpandedSourceId((previous) => ((() => {
  if (previous === sourceId) {
    return null;
  }
  return sourceId;
})()));
    };
  const loadMoreSources = () => {
      setSourceBatchCount((previous) => previous + 1);
    };

  return {
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
  };
};

interface GridTopicControllerOptions {
  readonly clusterWindow: GridClusterWindow;
  readonly viewMode: GridViewMode;
  readonly topicSortMode: "sources" | "articles" | "recent";
}

const useGridModalController = () => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const setContainerElement = (element: HTMLDivElement | null) => {
        containerRef.current = element;
      };
    const {
        article: selectedArticle,
        close: closeArticleDetail,
        isOpen: isArticleModalOpen,
        open: openArticleDetail,
      } = useArticleDetail();
    const [selectedArticleIndex, setSelectedArticleIndex] = useState<number | null>(null);
    const [modalArticles, setModalArticles] = useState<NewsArticle[]>([]);
    const [selectedCluster, setSelectedCluster] = useState<TrendingCluster | null>(null);
    const [isClusterModalOpen, setIsClusterModalOpen] = useState(false);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const handleArticleClick = useCallback(
        (article: NewsArticle, contextArticles: readonly NewsArticle[]) => {
          const nextIndex = contextArticles.findIndex((item) =>
            (() => {
  if (article.url && item.url) {
    return item.url === article.url;
  }
  return item.id === article.id;
})(),
          );
          setModalArticles([...contextArticles]);
          setSelectedArticleIndex((() => {
  if (nextIndex === -1) {
    return null;
  }
  return nextIndex;
})());
          openArticleDetail(article);
        },
        [openArticleDetail, setModalArticles, setSelectedArticleIndex],
      );
    const handleModalNavigate = useCallback(
        (direction: "prev" | "next") => {
          if (selectedArticleIndex === null) {
            return;
          }
          const nextIndex =
            (() => {
  if (direction === "next") {
    return selectedArticleIndex + 1;
  }
  return selectedArticleIndex - 1;
})();
          if (nextIndex < 0 || nextIndex >= modalArticles.length) {
            return;
          }
          const nextArticle = modalArticles[nextIndex];
          if (nextArticle === undefined) {
            return;
          }
          setSelectedArticleIndex(nextIndex);
          openArticleDetail(nextArticle);
        },
        [modalArticles, openArticleDetail, selectedArticleIndex, setSelectedArticleIndex],
      );
    const handleModalClose = useCallback(() => {
        closeArticleDetail();
        setSelectedArticleIndex(null);
        setModalArticles([]);
      }, [closeArticleDetail, setModalArticles, setSelectedArticleIndex]);
    const handleOpenClusterCompare = useCallback(
        (cluster: ReadonlyGridCluster, event: GridButtonEvent) => {
          event.stopPropagation();
          setSelectedCluster({
            ...cluster,
            articles: (cluster.articles ?? []).map((article) => copyGridClusterArticle(article)),
            gdelt_context: (() => {
  if (cluster.gdelt_context) {
    return copyGridGdeltContext(cluster.gdelt_context);
  }
  return null;
})(),
            keywords: [...cluster.keywords],
            representative_article: (() => {
  if (cluster.representative_article) {
    return copyGridClusterArticle(cluster.representative_article);
  }
  return null;
})(),
            trending_score: cluster.source_diversity,
            velocity: cluster.window_count,
          });
          setIsClusterModalOpen(true);
        },
        [],
      );
    const closeClusterModal = () => {
        setIsClusterModalOpen(false);
        setSelectedCluster(null);
      };

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return () => {};
      }
      const handleScroll = () => {
        setShowScrollTop(container.scrollTop > 500);
      };
      handleScroll();
      container.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        container.removeEventListener("scroll", handleScroll);
      };
    }, []);
    const scrollToTop = () => {
      containerRef.current?.scrollTo({ behavior: "smooth", top: 0 });
    };

    return {
      closeClusterModal,
      containerRef,
      handleArticleClick,
      handleModalClose,
      handleModalNavigate,
      handleOpenClusterCompare,
      isArticleModalOpen,
      isClusterModalOpen,
      scrollToTop,
      selectedArticle,
      selectedCluster,
      setContainerElement,
      showScrollTop,
    };
  },
  useGridTopicController = ({
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
        items.sort((a, b) => {
          if (topicSortMode === "articles") {
            return b.article_count - a.article_count;
          }
          if (topicSortMode === "recent") {
            return (clusterTimes.get(b.cluster_id) ?? 0) - (clusterTimes.get(a.cluster_id) ?? 0);
          }
          return b.source_diversity - a.source_diversity;
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
